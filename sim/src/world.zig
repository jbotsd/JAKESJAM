//! Phase I1 — step_world orchestrator skeleton.
//!
//! Drives one tick of the simulation by walking the entity arrays
//! in WorldState and dispatching to the per-module H1-H7 helpers
//! in deterministic order:
//!
//!   1. round.step_phase — phase machine
//!   2. fire patches — tick remaining_ms in place
//!   3. destructibles — passive (HP changes happen via projectile
//!                     resolution below)
//!   4. projectiles — pre_step lifecycle (sticky / lifetime expire)
//!                    and per-pair destructible hit resolution
//!   5. satellites — orbit + cooldown
//!   6. combat — per-player tick_shield (parry start handled via
//!               input, not iterated here)
//!
//! Score keeping, drafting transitions, projectile spawning, and
//! events emission stay TS-side via the Phase G2 worldStateBridge
//! for now. Phase I2-I4 lift those into wasm as data tables port.
//!
//! Pure-additive — `step_world` is a NEW export. The legacy `step`
//! no-op stays as the boot smoke. Phase J cuts swap the host's
//! call site from the TS World.step to step_world.

const std = @import("std");
const world_state = @import("world_state.zig");
const round = @import("round.zig");
const projectile = @import("projectile.zig");
const destructible = @import("destructible.zig");
const fire = @import("fire.zig");
const combat = @import("combat.zig");
const chaos = @import("data/chaos.zig");
const collision_types = @import("collision.zig");
const satellite = @import("satellite.zig");
const player_mod = @import("player.zig");
const weapon = @import("weapon.zig");
const weapons_data = @import("data/weapons.zig");
const trig = @import("trig.zig");
const rng = @import("rng.zig");

/// Per-tick step. Mutates `state` in place. Returns 0 on success;
/// reserved non-zero values for future error reporting.
/// Decide a round winner during fighting phase. Returns:
///   * winner index ≥ 0 if exactly one player alive (KO)
///   * winner index ≥ 0 if time-out (highest health)
///   * -1 if no winner yet
/// Grace after ALL humans die before the bot-shootout guard ends the round
/// (parity with round.ts NO_HUMAN_SURVIVOR_END_MS).
const NO_HUMAN_SURVIVOR_END_MS: f64 = 6000;

/// Half the player body height (parity with World.ts PLAYER_HALF_HEIGHT).
const PLAYER_HALF_HEIGHT: f64 = 28;

// Arena bounds for the ceiling clamp + void-plane kill (parity with World.ts).
// Module-level (not packed in WorldState) — one sim instance, same lifetime as
// the statics cache; set by the host on match start.
var g_ceiling_clamp_y: f64 = 0;
var g_has_ceiling: bool = false;
var g_kill_plane_y: f64 = 0; // map.size.y + KILL_PLANE_MARGIN_PX; 0 = disabled

/// Host sets arena bounds on match start: ceiling-clamp Y (World.ts
/// computeCeilingClampY, has_ceiling=0 when the map has no ceiling) and the
/// void kill-plane Y (map.size.y + KILL_PLANE_MARGIN_PX).
pub export fn world_state_set_arena_bounds(
    ceiling_y: f64,
    has_ceiling: i32,
    kill_plane_y: f64,
) void {
    g_ceiling_clamp_y = ceiling_y;
    g_has_ceiling = has_ceiling != 0;
    g_kill_plane_y = kill_plane_y;
}

// Map size (parity with World.ts's fire-hazard positioning, which uses
// runtime.map.size directly). 0 = not yet set by host; the fire-hazard
// spawn skips positioning until this is populated (added 2026-07-14 — see
// the fire-hazard section below for why the old hardcoded -800..800 /
// -400..400 box was a real bug, not a design choice).
var g_map_width: f64 = 0;
var g_map_height: f64 = 0;

/// Host sets the map's logical size (map.size.x, map.size.y) on match
/// start, same lifetime as the statics cache and arena bounds above.
pub export fn world_state_set_map_size(width: f64, height: f64) void {
    g_map_width = width;
    g_map_height = height;
}

/// A player whose id begins with "bot_" is AI (parity with round.ts BOT_ID_PREFIX).
fn isBotPlayer(p: *const world_state.PlayerEntity) bool {
    if (p.id_len < 4) return false;
    return p.id_bytes[0] == 'b' and p.id_bytes[1] == 'o' and
        p.id_bytes[2] == 't' and p.id_bytes[3] == '_';
}

/// Highest-health player index (time-out / force-resolve tiebreak).
fn highestHealthIdx(state: *const world_state.WorldState) i32 {
    var best_idx: i32 = 0;
    var best_health: f64 = state.players[0].health;
    var k: u32 = 1;
    while (k < state.player_count) : (k += 1) {
        if (state.players[k].health > best_health) {
            best_health = state.players[k].health;
            best_idx = @intCast(k);
        }
    }
    return best_idx;
}

fn detectRoundWinner(state: *const world_state.WorldState) i32 {
    if (state.header.round_phase != @intFromEnum(round.RoundPhase.fighting))
        return -1;
    var alive_count: u32 = 0;
    var alive_idx: i32 = -1;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.players[i].flags.alive) {
            alive_count += 1;
            alive_idx = @intCast(i);
        }
    }
    if (alive_count == 1) return alive_idx; // KO
    // Bot-shootout guard (parity with round.ts): humans present but ALL dead,
    // and the round has run ≥ NO_HUMAN_SURVIVOR_END_MS → force-resolve so the
    // lobby isn't stuck watching bots duel. Computed fresh each tick, so a live
    // human (alive_humans>0) cancels it.
    if (state.player_count > 0) {
        var humans: u32 = 0;
        var alive_humans: u32 = 0;
        var h: u32 = 0;
        while (h < state.player_count) : (h += 1) {
            if (!isBotPlayer(&state.players[h])) {
                humans += 1;
                if (state.players[h].flags.alive) alive_humans += 1;
            }
        }
        const elapsed = round.ROUND_TIME_LIMIT_MS - state.header.countdown_remaining_ms;
        if (humans > 0 and alive_humans == 0 and elapsed >= NO_HUMAN_SURVIVOR_END_MS) {
            return highestHealthIdx(state);
        }
    }
    // Time-out path: highest health among the dead/alive set wins.
    if (state.header.countdown_remaining_ms <= 0 and state.player_count > 0) {
        return highestHealthIdx(state);
    }
    return -1;
}

/// Push an event into state.events[event_count++]. Drops silently
/// when the buffer is full (caller should drain every tick).
fn emitEvent(
    state: *world_state.WorldState,
    kind: world_state.SimEventKind,
    a: i32,
    b: i32,
    eid: u32,
    scalar: f64,
    x: f64,
    y: f64,
) void {
    if (state.event_count >= world_state.MAX_EVENTS_PER_TICK) return;
    state.events[state.event_count] = .{
        .kind = @intFromEnum(kind),
        .player_idx_a = a,
        .player_idx_b = b,
        .entity_id = eid,
        .scalar = scalar,
        .x = x,
        .y = y,
    };
    state.event_count += 1;
}

pub fn stepWorld(state: *world_state.WorldState, dt_ms: f64) i32 {
    state.event_count = 0;
    state.header.tick += 1;

    // 0. Resolve the chaos profile for this tick + apply
    //    timeScale to dt (I20). All downstream per-module
    //    calls use `eff_dt` so movement, projectile flight, and
    //    cooldown decrement run at the chaos-scaled tempo.
    const chaos_profile = chaos.chaosProfileFromMask(state.header.chaos_mask);
    const eff_dt = dt_ms * chaos_profile.time_scale;

    // Read the round phase as of the START of this tick (parity with
    // World.ts's `fightingPhase` const, read once at the top before its own
    // round machine call runs at the END of the tick). Player movement +
    // weapon fire gate on this — see the 2026-07-14 tick-order fix note
    // below, at the round machine's new position, for why the round
    // machine itself moved to run LAST instead of first.
    const is_fighting = state.header.round_phase ==
        @intFromEnum(round.RoundPhase.fighting);

    // 8. Player physics (I16). Bridge PlayerEntity +
    //    PlayerMovementMemory → PlayerStep, run stepPlayer with
    //    the statics + one_way cache, write motion + memory back.
    const statics_slice = state.statics[0..state.static_count];
    const one_way_slice = state.one_way[0..state.static_count];
    var pmi: u32 = 0;
    while (pmi < state.player_count) : (pmi += 1) {
        if (!state.players[pmi].flags.alive) continue;
        // Host-resolved card build for this player (movement/shield/parry
        // augments) — parity with the TS orchestrator's resolvePlayerBuild.
        const fcfg = &state.player_fire_config[pmi];
        const has_cfg = fcfg.valid != 0;
        var ps = player_mod.PlayerStep{
            .x = state.players[pmi].x,
            .y = state.players[pmi].y,
            .vx = state.players[pmi].vx,
            .vy = state.players[pmi].vy,
            .aim_x = state.players[pmi].aim_x,
            .aim_y = state.players[pmi].aim_y,
            .jetpack_fuel = if (state.players[pmi].flags.has_jetpack_fuel)
                state.players[pmi].jetpack_fuel
            else
                100.0,
            .crouching = if (state.players[pmi].flags.crouching) 1 else 0,
            .coyote_ms = state.player_movement[pmi].coyote_ms,
            .jump_buffer_ms = state.player_movement[pmi].jump_buffer_ms,
            .jump_cut_applied = @intCast(state.player_movement[pmi].jump_cut_applied),
            .jump_released_since_jump = @intCast(state.player_movement[pmi].jump_released_since_jump),
            .grounded_last_frame = @intCast(state.player_movement[pmi].grounded_last_frame),
            .jetpack_active = @intCast(state.player_movement[pmi].jetpack_active),
            .touching_wall_dir = @intCast(state.player_movement[pmi].touching_wall_dir),
            // Augment INPUTS from the host-resolved card build.
            .jump_mul = if (has_cfg) fcfg.jump_mul else 1.0,
            .wall_jump_mul = if (has_cfg) fcfg.wall_jump_mul else 1.0,
            .wall_slide_mul = if (has_cfg) fcfg.wall_slide_mul else 1.0,
            .air_jumps = if (has_cfg) @intCast(fcfg.air_jumps) else 0,
            .dash_charges = if (has_cfg) @intCast(fcfg.dash_charges) else 0,
            .dash_cooldown_mul = if (has_cfg) fcfg.dash_cooldown_mul else 1.0,
            // Augment MEMORY carried from world state.
            .dash_cooldown_ms = state.player_movement[pmi].dash_cooldown_ms,
            .dash_active_ms = state.player_movement[pmi].dash_active_ms,
            .dash_recovery_ms = state.player_movement[pmi].dash_recovery_ms,
            .air_jumps_used = @intCast(state.player_movement[pmi].air_jumps_used),
            .dash_used_in_air = @intCast(state.player_movement[pmi].dash_used_in_air),
        };
        // Compose per-player movement speed (I37). Defaults 1.0;
        // speed_boost buff multiplies, slow_debuff / freeze /
        // slow_field debuffs multiply (≤1).
        var speed_mul: f64 = 1.0;
        const ple = &state.players[pmi];
        if (ple.flags.has_speed_boost and ple.speed_boost_until_tick > state.header.tick) {
            speed_mul *= 1.4;
        }
        if (ple.flags.has_slow_debuff and ple.slow_debuff_until_tick > state.header.tick) {
            speed_mul *= 0.5;
        }
        if (ple.flags.has_slow and ple.slowed_until_tick > state.header.tick) {
            speed_mul *= ple.slow_multiplier;
        }
        if (ple.flags.has_freeze and ple.freeze_until_tick > state.header.tick) {
            speed_mul *= ple.freeze_multiplier;
        }
        // Card move-speed + gravity augments ride the existing step multipliers.
        if (has_cfg) speed_mul *= fcfg.move_speed_mul;
        const grav_mul = chaos_profile.gravity_multiplier *
            (if (has_cfg) fcfg.gravity_mul else 1.0);
        // NB: stepPlayer RETURNS jumped-this-frame, not grounded. The grounded
        // state lives in ps.grounded_last_frame (mutated in place). The world
        // orchestrator emits no jump event, so the return is discarded.
        //
        // Gated on is_fighting (added 2026-07-14): parity with World.ts,
        // which only calls stepPlayer "if (entity.alive && fightingPhase)" —
        // players freeze during countdown/drafting. This gate did not exist
        // before; players could walk/jump/fire during the draft-pick screen.
        if (is_fighting) {
            _ = player_mod.stepPlayer(
                &ps,
                state.players[pmi].prev_keys,
                state.players[pmi].current_keys,
                state.players[pmi].aim_x,
                state.players[pmi].aim_y,
                speed_mul,
                grav_mul,
                eff_dt,
                statics_slice,
                one_way_slice,
            );
            state.players[pmi].x = ps.x;
            state.players[pmi].y = ps.y;
            state.players[pmi].vx = ps.vx;
            state.players[pmi].vy = ps.vy;
            state.players[pmi].jetpack_fuel = ps.jetpack_fuel;
            state.players[pmi].flags.has_jetpack_fuel = true;
            state.players[pmi].flags.crouching = ps.crouching != 0;
            state.players[pmi].flags.grounded = ps.grounded_last_frame != 0;
            state.player_movement[pmi].coyote_ms = ps.coyote_ms;
            state.player_movement[pmi].jump_buffer_ms = ps.jump_buffer_ms;
            state.player_movement[pmi].jump_cut_applied = @intCast(ps.jump_cut_applied);
            state.player_movement[pmi].jump_released_since_jump = @intCast(ps.jump_released_since_jump);
            state.player_movement[pmi].grounded_last_frame = @intCast(ps.grounded_last_frame);
            state.player_movement[pmi].jetpack_active = @intCast(ps.jetpack_active);
            state.player_movement[pmi].touching_wall_dir = @intCast(ps.touching_wall_dir);
            state.player_movement[pmi].dash_cooldown_ms = ps.dash_cooldown_ms;
            state.player_movement[pmi].dash_active_ms = ps.dash_active_ms;
            state.player_movement[pmi].dash_recovery_ms = ps.dash_recovery_ms;
            state.player_movement[pmi].air_jumps_used = @intCast(ps.air_jumps_used);
            state.player_movement[pmi].dash_used_in_air = @intCast(ps.dash_used_in_air);
        }
        // Ceiling clamp (parity with World.ts computeCeilingClampY): head pushed
        // above the ceiling → shove back under + kill upward velocity.
        if (g_has_ceiling) {
            const min_center_y = g_ceiling_clamp_y + PLAYER_HALF_HEIGHT;
            if (state.players[pmi].y < min_center_y) {
                state.players[pmi].y = min_center_y;
                if (state.players[pmi].vy < 0) state.players[pmi].vy = 0;
            }
        }
        // Void-plane kill (parity with World.ts): fell past the map bottom +
        // KILL_PLANE_MARGIN → force-kill so the death→respawn flow runs. Player
        // is alive here (checked at loop top). Emit hit_confirmed (damage =
        // remaining health) + player_killed like any other death.
        if (g_kill_plane_y > 0 and state.players[pmi].y > g_kill_plane_y) {
            const rem = state.players[pmi].health;
            state.players[pmi].health = 0;
            state.players[pmi].flags.alive = false;
            emitEvent(state, .hit_confirmed, @intCast(pmi), -1, 0, rem, state.players[pmi].x, state.players[pmi].y);
            emitEvent(state, .player_killed, @intCast(pmi), -1, 0, 0, state.players[pmi].x, state.players[pmi].y);
        }
    }

    // 6. Combat — per-player shield drain + parry start (I4 +
    //    I4b). Defaults match `combat_*` exports.
    var pi3: u32 = 0;
    while (pi3 < state.player_count) : (pi3 += 1) {
        const player_ptr = &state.players[pi3];
        // Card shield/parry augments from the host-resolved build. Match the TS
        // orchestrator: maxCharge = SHIELD_MAX_CHARGE_DEFAULT × chargeMul (NOT
        // the stored max), recharge × rechargeMul, parry cooldown × cooldownMul.
        const cfg3 = &state.player_fire_config[pi3];
        const has3 = cfg3.valid != 0;
        combat.tickShield(
            player_ptr,
            player_ptr.current_keys,
            eff_dt,
            combat.SHIELD_MAX_CHARGE_DEFAULT * (if (has3) cfg3.shield_charge_mul else 1.0),
            combat.SHIELD_DRAIN_PER_SECOND,
            combat.SHIELD_RECHARGE_PER_SECOND * (if (has3) cfg3.shield_recharge_mul else 1.0),
        );
        _ = combat.tryStartParry(
            player_ptr,
            player_ptr.current_keys,
            player_ptr.prev_keys,
            state.header.tick,
            eff_dt,
            combat.PARRY_ACTIVE_MS,
            combat.PARRY_COOLDOWN_MS_DEFAULT * (if (has3) cfg3.parry_cooldown_mul else 1.0),
        );
        // Weapon fire decision + projectile spawn (I21 + I45).
        // Use the host-resolved fire config when valid, else fall
        // back to the starter-pistol base from data/weapons.zig.
        // The host (J0 shim) patches state.player_fire_config[i]
        // each tick from createWeaponBuild(player.cards) so card
        // mutations (multi-shot, damage scale, etc) take effect.
        //
        // Gated on is_fighting (added 2026-07-14): parity with World.ts,
        // where stepWeapon only runs "if (entity.alive && fightingPhase)".
        // This gate did not exist before — cooldown ticked down and shots
        // could fire during countdown/drafting.
        if (is_fighting) {
        const fcfg = &state.player_fire_config[pi3];
        const damage_v: f64 = if (fcfg.valid != 0) fcfg.damage else weapons_data.weaponBaseById(.starter_pistol).damage;
        const fire_rate_v: f64 = if (fcfg.valid != 0) fcfg.fire_rate else weapons_data.weaponBaseById(.starter_pistol).fire_rate;
        const proj_speed_base: f64 = if (fcfg.valid != 0) fcfg.projectile_speed else weapons_data.weaponBaseById(.starter_pistol).projectile_speed;
        const proj_speed_mul: f64 = if (fcfg.valid != 0) fcfg.speed_multiplier else 1.0;
        const proj_lifetime_sec: f64 = if (fcfg.valid != 0) fcfg.projectile_lifetime_seconds else weapons_data.weaponBaseById(.starter_pistol).projectile_lifetime_seconds;
        const proj_lifetime_mul: f64 = if (fcfg.valid != 0) fcfg.lifetime_multiplier else 1.0;
        const spread_total: f64 = if (fcfg.valid != 0) fcfg.spread_radians else weapons_data.weaponBaseById(.starter_pistol).spread_radians;
        const proj_count: u32 = if (fcfg.valid != 0) @max(@as(u32, 1), fcfg.projectile_count) else 1;
        const proj_size_mul: f64 = if (fcfg.valid != 0) fcfg.size_multiplier else 1.0;
        const proj_range: f64 = if (fcfg.valid != 0) fcfg.range_px else weapons_data.weaponBaseById(.starter_pistol).projectile_range_px;
        const proj_bounces: u32 = if (fcfg.valid != 0) fcfg.bounces else 0;
        const proj_pierce: u32 = if (fcfg.valid != 0) fcfg.pierce_count else 0;
        const proj_splits: u32 = if (fcfg.valid != 0) fcfg.split_count else 0;
        const proj_homing: f64 = if (fcfg.valid != 0) fcfg.homing_strength else 0;
        const proj_accel: f64 = if (fcfg.valid != 0) fcfg.acceleration_multiplier else 0;
        const proj_gravity: f64 = if (fcfg.valid != 0) fcfg.gravity_scale else 0;
        const proj_slow: f64 = if (fcfg.valid != 0) fcfg.slow_multiplier else 1.0;
        const proj_impact_radius: f64 = if (fcfg.valid != 0) fcfg.impact_radius_px else 0;
        const proj_shape = if (fcfg.valid != 0) fcfg.shape else weapons_data.weaponBaseById(.starter_pistol).projectile_shape;
        const proj_element = if (fcfg.valid != 0) fcfg.element else weapons_data.weaponBaseById(.starter_pistol).projectile_element;
        const proj_pathing = if (fcfg.valid != 0) fcfg.pathing else weapons_data.weaponBaseById(.starter_pistol).projectile_pathing;
        const proj_impact_kind = if (fcfg.valid != 0) fcfg.impact else .none;
        const cd_after = weapon.cooldownFromFireRate(
            fire_rate_v * chaos_profile.fire_rate_multiplier,
            1.0,
        );
        var fire_decision: weapon.FireDecision = undefined;
        weapon.weapon_tick_fire_with_keys(
            player_ptr,
            player_ptr.current_keys,
            eff_dt,
            cd_after,
            &fire_decision,
        );
        if (fire_decision.fired == 1 and
            chaos_profile.disable_projectiles == 0)
        {
            const dx = player_ptr.aim_x - player_ptr.x;
            const dy = player_ptr.aim_y - player_ptr.y;
            const aim_angle: f64 = if (dx == 0 and dy == 0) 0 else trig.lutAtan2(dy, dx);
            const speed = proj_speed_base * proj_speed_mul;
            const lifetime_ms = @max(
                50.0,
                proj_lifetime_sec * 1000.0 * proj_lifetime_mul,
            );
            const radius_v: f64 = @max(2.0, 7.0 * proj_size_mul);

            // Multi-shot spread fan: distribute proj_count
            // projectiles evenly across spread_total radians centred
            // on aim_angle. Single-shot (count == 1) fires straight.
            var shot_i: u32 = 0;
            while (shot_i < proj_count) : (shot_i += 1) {
                if (state.projectile_count >= world_state.MAX_PROJECTILES) break;
                const offset: f64 = if (proj_count <= 1)
                    0
                else blk: {
                    const t: f64 = @as(f64, @floatFromInt(shot_i)) /
                        @as(f64, @floatFromInt(proj_count - 1));
                    break :blk -spread_total * 0.5 + t * spread_total;
                };
                const ang = aim_angle + offset;
                const slot: u32 = state.projectile_count;
                state.projectile_count += 1;
                const new_id: u32 = state.header.next_entity_id;
                state.header.next_entity_id += 1;
                state.projectiles[slot] = .{
                    .x = player_ptr.x,
                    .y = player_ptr.y,
                    .vx = trig.lutCos(ang) * speed,
                    .vy = trig.lutSin(ang) * speed,
                    .radius = radius_v,
                    .damage = damage_v,
                    .lifetime_ms = lifetime_ms,
                    .age_ms = 0,
                    .traveled_px = 0,
                    .origin_x = player_ptr.x,
                    .origin_y = player_ptr.y,
                    .homing_strength = proj_homing,
                    .acceleration_multiplier = proj_accel,
                    .gravity_scale = proj_gravity,
                    .range_px = proj_range,
                    .slow_multiplier = proj_slow,
                    .sticky_fuse_ms = 0,
                    .impact_radius_px = proj_impact_radius,
                    .id = new_id,
                    .bounces_remaining = proj_bounces,
                    .pierce_remaining = proj_pierce,
                    .split_count = proj_splits,
                    .flags = .{
                        .has_owner = true,
                        .has_impact = true,
                        .has_split = proj_splits > 0,
                        .has_slow = proj_slow != 1.0,
                        .has_homing = proj_homing != 0,
                        .has_acceleration = proj_accel != 0,
                        .has_gravity_scale = proj_gravity != 0,
                        .has_range = true,
                        .has_age = true,
                        .has_traveled = true,
                        .has_origin = true,
                        .returning = false,
                        .has_sticky_fuse = false,
                        .has_impact_radius = proj_impact_radius > 0,
                    },
                    .pathing = proj_pathing,
                    .element = proj_element,
                    .impact = proj_impact_kind,
                    .shape = proj_shape,
                    .owner_id_len = player_ptr.id_len,
                    .owner_id_bytes = player_ptr.id_bytes,
                };
                emitEvent(
                    state,
                    .shot_fired,
                    @intCast(pi3),
                    -1,
                    new_id,
                    ang,
                    player_ptr.x,
                    player_ptr.y,
                );
            }
        }
        } // if (is_fighting) — weapon fire decision + spawn

        // Roll current → prev for the next tick's edge detection.
        player_ptr.prev_keys = player_ptr.current_keys;
    }

    // 5. Satellites — orbit advance + fire decision (I8). Owner
    //    lookup walks the players array matching owner_id_bytes;
    //    target lookup picks the closest non-owner alive player.
    var si: u32 = 0;
    while (si < state.satellite_count) : (si += 1) {
        const sat_ptr = &state.satellites[si];
        // Find owner index by id_bytes match.
        var owner_x: f64 = 0;
        var owner_y: f64 = 0;
        var owner_idx: i32 = -1;
        var oj: u32 = 0;
        while (oj < state.player_count) : (oj += 1) {
            if (state.players[oj].id_len == sat_ptr.owner_id_len and
                std.mem.eql(u8, state.players[oj].id_bytes[0..sat_ptr.owner_id_len], sat_ptr.owner_id_bytes[0..sat_ptr.owner_id_len]))
            {
                owner_x = state.players[oj].x;
                owner_y = state.players[oj].y;
                owner_idx = @intCast(oj);
                break;
            }
        }
        // Closest non-owner alive player.
        var target_x: f64 = 0;
        var target_y: f64 = 0;
        var has_target: u8 = 0;
        var best_dist_sq: f64 = std.math.inf(f64);
        var ti: u32 = 0;
        while (ti < state.player_count) : (ti += 1) {
            if (@as(i32, @intCast(ti)) == owner_idx) continue;
            if (!state.players[ti].flags.alive) continue;
            const dx = state.players[ti].x - owner_x;
            const dy = state.players[ti].y - owner_y;
            const d2 = dx * dx + dy * dy;
            if (d2 < best_dist_sq) {
                best_dist_sq = d2;
                target_x = state.players[ti].x;
                target_y = state.players[ti].y;
                has_target = 1;
            }
        }
        const can_fire: u8 = if (state.header.round_phase ==
            @intFromEnum(round.RoundPhase.fighting)) 1 else 0;
        const sat_out = satellite.satelliteTickWorld(
            sat_ptr,
            owner_x,
            owner_y,
            target_x,
            target_y,
            has_target,
            can_fire,
            eff_dt,
        );
        // Satellite projectile spawn (I22). Fire at the position
        // satellite_tick_world reported with the same starter-
        // pistol base stats as I21.
        if (sat_out.wants_fire == 1 and
            state.projectile_count < world_state.MAX_PROJECTILES and
            chaos_profile.disable_projectiles == 0)
        {
            const sat_weapon = weapons_data.weaponBaseById(.starter_pistol);
            const sat_speed = sat_weapon.projectile_speed *
                sat_weapon.projectile_speed_multiplier;
            const slot: u32 = state.projectile_count;
            state.projectile_count += 1;
            const new_id: u32 = state.header.next_entity_id;
            state.header.next_entity_id += 1;
            state.projectiles[slot] = .{
                .x = sat_out.fire_x,
                .y = sat_out.fire_y,
                .vx = trig.lutCos(sat_out.fire_aim_angle) * sat_speed,
                .vy = trig.lutSin(sat_out.fire_aim_angle) * sat_speed,
                .radius = @max(2.0, 7.0 * sat_weapon.projectile_size_multiplier),
                .damage = sat_weapon.damage,
                .lifetime_ms = @max(
                    50.0,
                    sat_weapon.projectile_lifetime_seconds * 1000.0 *
                        sat_weapon.projectile_lifetime_multiplier,
                ),
                .age_ms = 0,
                .traveled_px = 0,
                .origin_x = sat_out.fire_x,
                .origin_y = sat_out.fire_y,
                .homing_strength = 0,
                .acceleration_multiplier = 0,
                .gravity_scale = 0,
                .range_px = sat_weapon.projectile_range_px,
                .slow_multiplier = 1,
                .sticky_fuse_ms = 0,
                .impact_radius_px = 0,
                .id = new_id,
                .bounces_remaining = 0,
                .pierce_remaining = 0,
                .split_count = 0,
                .flags = .{
                    .has_owner = true,
                    .has_impact = false,
                    .has_split = false,
                    .has_slow = false,
                    .has_homing = false,
                    .has_acceleration = false,
                    .has_gravity_scale = false,
                    .has_range = true,
                    .has_age = true,
                    .has_traveled = true,
                    .has_origin = true,
                    .returning = false,
                    .has_sticky_fuse = false,
                    .has_impact_radius = false,
                },
                .pathing = sat_weapon.projectile_pathing,
                .element = sat_weapon.projectile_element,
                .impact = .none,
                .shape = sat_weapon.projectile_shape,
                .owner_id_len = sat_ptr.owner_id_len,
                .owner_id_bytes = sat_ptr.owner_id_bytes,
            };
            emitEvent(
                state,
                .shot_fired,
                -1,
                -1,
                new_id,
                sat_out.fire_aim_angle,
                sat_out.fire_x,
                sat_out.fire_y,
            );
        }
    }

    // 3. Projectile pre-step lifecycle + motion (I7). Sticky /
    //    lifetime decisions first; for `advance` results the
    //    motion kernel runs via step_projectile_v2 with the REAL
    //    static-AABB cache (terrain collision + bounce). Player
    //    collision is resolved separately in phase 4; homing needs
    //    the player array and is a follow-on (empty players here).
    const proj_statics = state.statics[0..state.static_count];
    const empty_xs: []const f64 = &.{};
    const empty_ys: []const f64 = &.{};
    const empty_alive: []const u8 = &.{};
    var pi: u32 = 0;
    while (pi < state.projectile_count) : (pi += 1) {
        const proj_ptr = &state.projectiles[pi];
        const result = projectile.projectilePreStep(proj_ptr, eff_dt);
        if (result == .advance) {
            // Bridge ProjectileEntity → ProjectileKinematicsV2 →
            // step → write motion fields back.
            var kine = projectile.ProjectileKinematicsV2{
                .x = proj_ptr.x,
                .y = proj_ptr.y,
                .vx = proj_ptr.vx,
                .vy = proj_ptr.vy,
                .age_ms = if (proj_ptr.flags.has_age) proj_ptr.age_ms else 0.0,
                .lifetime_ms = proj_ptr.lifetime_ms,
                .radius = proj_ptr.radius,
                .gravity_scale = if (proj_ptr.flags.has_gravity_scale) proj_ptr.gravity_scale else 0.0,
                .traveled_px = if (proj_ptr.flags.has_traveled) proj_ptr.traveled_px else 0.0,
                .origin_x = if (proj_ptr.flags.has_origin) proj_ptr.origin_x else proj_ptr.x,
                .origin_y = if (proj_ptr.flags.has_origin) proj_ptr.origin_y else proj_ptr.y,
                .range_px = if (proj_ptr.flags.has_range) proj_ptr.range_px else 0.0,
                .acceleration_multiplier = if (proj_ptr.flags.has_acceleration) proj_ptr.acceleration_multiplier else 0.0,
                .homing_strength = if (proj_ptr.flags.has_homing) proj_ptr.homing_strength else 0.0,
                .id = @floatFromInt(proj_ptr.id),
                .pathing = @intFromEnum(proj_ptr.pathing),
                .returning = if (proj_ptr.flags.returning) 1 else 0,
                .bounces_remaining = @intCast(proj_ptr.bounces_remaining),
            };
            const r = projectile.stepV2(
                &kine,
                eff_dt,
                proj_statics,
                empty_xs,
                empty_ys,
                empty_alive,
                -1, // no owner
            );
            // Write motion-relevant fields back. Lifetime drains
            // by dt_ms regardless of expire flag — the next
            // pre_step picks up expiry.
            proj_ptr.x = kine.x;
            proj_ptr.y = kine.y;
            proj_ptr.vx = kine.vx;
            proj_ptr.vy = kine.vy;
            proj_ptr.lifetime_ms -= eff_dt;
            if (proj_ptr.flags.has_age) proj_ptr.age_ms = kine.age_ms;
            if (proj_ptr.flags.has_traveled) proj_ptr.traveled_px = kine.traveled_px;
            proj_ptr.flags.returning = kine.returning != 0;
            proj_ptr.bounces_remaining = @intCast(kine.bounces_remaining);
            // Terrain hit on a non-bouncing shard → expire it (stopped at the
            // wall). End-of-tick compaction removes lifetime<=0 projectiles.
            if (r.expired != 0) proj_ptr.lifetime_ms = 0;
        }
    }

    // 4. Per-pair projectile × {destructible, player} resolution
    //    (I11). Destructible HP application + player damage on
    //    overlap (skip owner). Projectile destroy is signalled by
    //    setting lifetime_ms = 0 so the next pre_step expires it.
    var pi2: u32 = 0;
    while (pi2 < state.projectile_count) : (pi2 += 1) {
        const proj_ptr = &state.projectiles[pi2];
        if (proj_ptr.lifetime_ms <= 0) continue;
        var di: u32 = 0;
        while (di < state.destructible_count) : (di += 1) {
            const dest_ptr = &state.destructibles[di];
            const r = destructible.resolveProjectileHit(proj_ptr, dest_ptr);
            if (r == .no_overlap) continue;
            proj_ptr.lifetime_ms = 0;
            // Explosive AOE on break (I12): radial damage to
            // every alive non-owner player within EXPLOSION_RADIUS.
            if (r == .broken) {
                emitEvent(
                    state,
                    .destructible_broken,
                    -1,
                    -1,
                    dest_ptr.id,
                    0,
                    dest_ptr.x,
                    dest_ptr.y,
                );
            }
            if (r == .broken and (dest_ptr.flags & 1) != 0) {
                var ex_p: u32 = 0;
                while (ex_p < state.player_count) : (ex_p += 1) {
                    if (!state.players[ex_p].flags.alive) continue;
                    if (proj_ptr.flags.has_owner and
                        state.players[ex_p].id_len == proj_ptr.owner_id_len and
                        std.mem.eql(u8, state.players[ex_p].id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
                    {
                        continue;
                    }
                    if (destructible.playerInBlastRadius(
                        dest_ptr.x,
                        dest_ptr.y,
                        destructible.EXPLOSION_RADIUS,
                        state.players[ex_p].x,
                        state.players[ex_p].y,
                        15.0, // PLAYER_HALF_W
                    )) {
                        // Shield-first absorption (I39).
                        var aoe_dmg = destructible.EXPLOSION_DAMAGE;
                        const ape = &state.players[ex_p];
                        if (ape.flags.shield_active and
                            ape.flags.has_shield_charge and
                            ape.shield_charge > 0)
                        {
                            ape.shield_charge -= aoe_dmg;
                            if (ape.shield_charge <= 0) {
                                const overflow = -ape.shield_charge;
                                ape.shield_charge = 0;
                                ape.flags.shield_active = false;
                                emitEvent(state, .shield_popped, @intCast(ex_p), -1, dest_ptr.id, 0, ape.x, ape.y);
                                aoe_dmg = overflow;
                            } else {
                                aoe_dmg = 0;
                            }
                        }
                        if (aoe_dmg > 0) {
                            ape.health -= aoe_dmg;
                            if (ape.health <= 0) {
                                ape.health = 0;
                                ape.flags.alive = false;
                                emitEvent(state, .player_killed, @intCast(ex_p), -1, dest_ptr.id, 0, ape.x, ape.y);
                            }
                        }
                    }
                }
            }
            break;
        }
        if (proj_ptr.lifetime_ms <= 0) continue;
        // Player overlap: circle vs AABB.
        var ph2: u32 = 0;
        while (ph2 < state.player_count) : (ph2 += 1) {
            if (!state.players[ph2].flags.alive) continue;
            // Skip owner.
            if (proj_ptr.flags.has_owner and
                state.players[ph2].id_len == proj_ptr.owner_id_len and
                std.mem.eql(u8, state.players[ph2].id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
            {
                continue;
            }
            const px = state.players[ph2].x;
            const py = state.players[ph2].y;
            const half_w: f64 = 15.0;
            const half_h: f64 = 28.0;
            const closest_x = @max(px - half_w, @min(proj_ptr.x, px + half_w));
            const closest_y = @max(py - half_h, @min(proj_ptr.y, py + half_h));
            const dx = proj_ptr.x - closest_x;
            const dy = proj_ptr.y - closest_y;
            if (dx * dx + dy * dy <= proj_ptr.radius * proj_ptr.radius) {
                // Compose damage multipliers (I36):
                //   chaos × shooter damage_amp × victim vulnerability
                var final_dmg = proj_ptr.damage * chaos_profile.damage_multiplier;
                // Shooter buff: damage_amp doubles damage while
                // active. Look up shooter by owner_id_bytes.
                if (proj_ptr.flags.has_owner) {
                    var shooter_idx: i32 = -1;
                    var sj: u32 = 0;
                    while (sj < state.player_count) : (sj += 1) {
                        if (state.players[sj].id_len == proj_ptr.owner_id_len and
                            std.mem.eql(u8, state.players[sj].id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
                        {
                            shooter_idx = @intCast(sj);
                            break;
                        }
                    }
                    if (shooter_idx >= 0) {
                        const sp = &state.players[@intCast(shooter_idx)];
                        if (sp.flags.has_damage_amp and
                            sp.damage_amp_until_tick > state.header.tick)
                        {
                            final_dmg *= 2.0;
                        }
                        if (sp.flags.has_overcharge and
                            sp.overcharge_until_tick > state.header.tick)
                        {
                            final_dmg *= 1.5;
                        }
                        if (sp.flags.has_boss_mode and
                            sp.boss_mode_until_tick > state.header.tick)
                        {
                            final_dmg *= 2.0;
                        }
                    }
                }
                // Victim buff: vulnerability multiplies incoming
                // damage (default 1.5×).
                if (state.players[ph2].flags.has_vulnerability and
                    state.players[ph2].vulnerability_until_tick > state.header.tick)
                {
                    final_dmg *= 1.5;
                }
                // Victim's resolved card build (parry cover, directional +
                // mirror shield) — parity with TS tryDeflectDamage.
                const vcfg = &state.player_fire_config[ph2];
                // Parry deflect: active parry window AND the shard's source
                // direction lies within the parry arc (widened by cover mult).
                const parry_arc = combat.PARRY_ARC_RADIANS *
                    (if (vcfg.valid != 0) vcfg.parry_cover_mul else 1.0);
                if (combat.isParryActive(&state.players[ph2], state.header.tick) and
                    combat.isHitInArc(
                        state.players[ph2].x,
                        state.players[ph2].y,
                        state.players[ph2].parry_facing,
                        proj_ptr.x,
                        proj_ptr.y,
                        proj_ptr.vx,
                        proj_ptr.vy,
                        parry_arc,
                    ))
                {
                    emitEvent(
                        state,
                        .parry_deflected,
                        @intCast(ph2),
                        -1,
                        proj_ptr.id,
                        0,
                        state.players[ph2].x,
                        state.players[ph2].y,
                    );
                    // REFLECTIVE parry (mirrors client/src/sim/World.ts): rather
                    // than dropping the shard, send it back — now OWNED by the
                    // parrier so it can strike the attacker. Travel/age reset so
                    // it doesn't instantly expire on range/lifetime.
                    proj_ptr.vx = -proj_ptr.vx * 1.15;
                    proj_ptr.vy = -proj_ptr.vy * 1.15;
                    proj_ptr.age_ms = 0;
                    proj_ptr.traveled_px = 0;
                    proj_ptr.origin_x = proj_ptr.x;
                    proj_ptr.origin_y = proj_ptr.y;
                    proj_ptr.flags.has_owner = true;
                    const parrier_len = state.players[ph2].id_len;
                    proj_ptr.owner_id_len = parrier_len;
                    @memcpy(
                        proj_ptr.owner_id_bytes[0..parrier_len],
                        state.players[ph2].id_bytes[0..parrier_len],
                    );
                    break;
                }
                // Shield pop: if the player's shield is active
                // and absorbs the hit, drop a shield_popped
                // event (and tap the shield charge — full
                // mitigation handled in a follow-on cut once
                // shield-vs-direct-damage is wired into the
                // model).
                shield_block: {
                    if (!(state.players[ph2].flags.shield_active and
                        state.players[ph2].flags.has_shield_charge and
                        state.players[ph2].shield_charge > 0)) break :shield_block;
                    // Aim shield: only blocks hits arriving within the aim cone;
                    // flank/back shots pass through to damage below.
                    if (vcfg.valid != 0 and vcfg.directional_shield != 0) {
                        const vp = &state.players[ph2];
                        const adx = vp.aim_x - vp.x;
                        const ady = vp.aim_y - vp.y;
                        const aim_facing = if (adx == 0.0 and ady == 0.0)
                            0.0
                        else
                            trig.lutAtan2(ady, adx);
                        if (!combat.isHitInArc(vp.x, vp.y, aim_facing, proj_ptr.x, proj_ptr.y, proj_ptr.vx, proj_ptr.vy, combat.SHIELD_AIM_ARC_RADIANS))
                            break :shield_block; // not covered → take the hit
                    }
                    state.players[ph2].shield_charge -=
                        final_dmg * combat.SHIELD_HIT_DRAIN_MULTIPLIER;
                    if (state.players[ph2].shield_charge <= 0) {
                        state.players[ph2].shield_charge = 0;
                        state.players[ph2].flags.shield_active = false;
                        emitEvent(
                            state,
                            .shield_popped,
                            @intCast(ph2),
                            -1,
                            proj_ptr.id,
                            0,
                            state.players[ph2].x,
                            state.players[ph2].y,
                        );
                    }
                    // Mirror shield: bounce the shard back at the attacker
                    // (owned by the blocker) instead of expiring it.
                    if (vcfg.valid != 0 and vcfg.mirror_shield != 0) {
                        proj_ptr.vx = -proj_ptr.vx * 1.15;
                        proj_ptr.vy = -proj_ptr.vy * 1.15;
                        proj_ptr.age_ms = 0;
                        proj_ptr.traveled_px = 0;
                        proj_ptr.origin_x = proj_ptr.x;
                        proj_ptr.origin_y = proj_ptr.y;
                        proj_ptr.flags.has_owner = true;
                        const rlen = state.players[ph2].id_len;
                        proj_ptr.owner_id_len = rlen;
                        @memcpy(
                            proj_ptr.owner_id_bytes[0..rlen],
                            state.players[ph2].id_bytes[0..rlen],
                        );
                    } else {
                        proj_ptr.lifetime_ms = 0;
                    }
                    break;
                }
                state.players[ph2].health -= final_dmg;
                emitEvent(
                    state,
                    .hit_confirmed,
                    @intCast(ph2),
                    -1,
                    proj_ptr.id,
                    final_dmg,
                    state.players[ph2].x,
                    state.players[ph2].y,
                );
                if (state.players[ph2].health <= 0) {
                    state.players[ph2].health = 0;
                    state.players[ph2].flags.alive = false;
                    emitEvent(
                        state,
                        .player_killed,
                        @intCast(ph2),
                        -1,
                        proj_ptr.id,
                        0,
                        state.players[ph2].x,
                        state.players[ph2].y,
                    );
                }
                // Element on-hit effects (parity with World.ts phase 6d).
                switch (proj_ptr.element) {
                    .ice => {
                        // 1-second freeze at 0.5x movement (tick-quantized).
                        const freeze_ticks: u32 = @intFromFloat(@ceil(1000.0 / @max(1.0, eff_dt)));
                        state.players[ph2].flags.has_freeze = true;
                        state.players[ph2].freeze_until_tick = state.header.tick + freeze_ticks;
                        state.players[ph2].freeze_multiplier = 0.5;
                    },
                    .lightning, .electric => {
                        // Chain HALF damage to the nearest OTHER alive player
                        // within 220px — a derived secondary hit.
                        const chain_dmg = final_dmg * 0.5;
                        const hx = state.players[ph2].x;
                        const hy = state.players[ph2].y;
                        var best: i32 = -1;
                        var best_d2: f64 = 220.0 * 220.0;
                        var ci: u32 = 0;
                        while (ci < state.player_count) : (ci += 1) {
                            if (ci == ph2 or !state.players[ci].flags.alive) continue;
                            const cdx = state.players[ci].x - hx;
                            const cdy = state.players[ci].y - hy;
                            const d2 = cdx * cdx + cdy * cdy;
                            if (d2 <= best_d2) {
                                best_d2 = d2;
                                best = @intCast(ci);
                            }
                        }
                        if (best >= 0) {
                            const cb: u32 = @intCast(best);
                            state.players[cb].health -= chain_dmg;
                            emitEvent(state, .hit_confirmed, best, -1, proj_ptr.id, chain_dmg, state.players[cb].x, state.players[cb].y);
                            if (state.players[cb].health <= 0) {
                                state.players[cb].health = 0;
                                state.players[cb].flags.alive = false;
                                emitEvent(state, .player_killed, best, -1, proj_ptr.id, 0, state.players[cb].x, state.players[cb].y);
                            }
                        }
                    },
                    else => {},
                }
                // Pierce-chain: decrement and survive; otherwise
                // sticky → linger then detonate, others → expire.
                if (proj_ptr.impact == .pierce_chain and
                    proj_ptr.pierce_remaining > 0)
                {
                    proj_ptr.pierce_remaining -= 1;
                    continue;
                }
                if (proj_ptr.impact == .sticky) {
                    proj_ptr.sticky_fuse_ms = projectile.STICKY_FUSE_MS;
                    proj_ptr.flags.has_sticky_fuse = true;
                    proj_ptr.lifetime_ms = @max(
                        proj_ptr.lifetime_ms,
                        projectile.STICKY_FUSE_MS + eff_dt,
                    );
                } else {
                    if (proj_ptr.impact == .slow_field) {
                        // Slow-field impact (I27): apply slow
                        // debuff to the hit player. Default
                        // duration 1500ms + multiplier 0.5
                        // unless the projectile carries an
                        // override.
                        const slow_dur: f64 = 1500.0;
                        const slow_dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                        const slow_ticks: u32 = @intFromFloat(@ceil(slow_dur / slow_dt));
                        state.players[ph2].slowed_until_tick =
                            state.header.tick + slow_ticks;
                        state.players[ph2].slow_multiplier =
                            if (proj_ptr.flags.has_slow) proj_ptr.slow_multiplier else 0.5;
                        state.players[ph2].flags.has_slow = true;
                        emitEvent(
                            state,
                            .none, // no dedicated kind yet
                            @intCast(ph2),
                            -1,
                            proj_ptr.id,
                            slow_dur,
                            state.players[ph2].x,
                            state.players[ph2].y,
                        );
                    }
                    proj_ptr.lifetime_ms = 0;
                }
                break;
            }
        }
    }

    // 2. Fire patches (I10): tick lifetime in place + apply DPS
    //    damage to overlapping non-owner alive players.
    //    Player AABB is approximated as 30×56 centered on (x,y).
    const PLAYER_HALF_W: f64 = 15.0;
    const PLAYER_HALF_H: f64 = 28.0;
    var fi: u32 = 0;
    while (fi < state.fire_count) : (fi += 1) {
        const patch_ptr = &state.fires[fi];
        if (patch_ptr.remaining_ms <= 0) continue;
        const damage_this_tick = patch_ptr.damage_per_second * (eff_dt / 1000.0);
        var ph: u32 = 0;
        while (ph < state.player_count) : (ph += 1) {
            if (!state.players[ph].flags.alive) continue;
            // Skip owner self-damage.
            if (patch_ptr.has_owner != 0 and
                state.players[ph].id_len == patch_ptr.owner_id_len and
                std.mem.eql(u8, state.players[ph].id_bytes[0..patch_ptr.owner_id_len], patch_ptr.owner_id_bytes[0..patch_ptr.owner_id_len]))
            {
                continue;
            }
            if (fire.fireEntityHitsPlayerAABB(
                patch_ptr,
                state.players[ph].x - PLAYER_HALF_W,
                state.players[ph].y - PLAYER_HALF_H,
                PLAYER_HALF_W * 2.0,
                PLAYER_HALF_H * 2.0,
            )) {
                // Shield-first absorption (I38) — fire DPS drains
                // shield before health if shield active + has charge.
                var dmg_to_apply = damage_this_tick;
                const pp = &state.players[ph];
                if (pp.flags.shield_active and
                    pp.flags.has_shield_charge and
                    pp.shield_charge > 0)
                {
                    pp.shield_charge -= dmg_to_apply;
                    if (pp.shield_charge <= 0) {
                        const overflow = -pp.shield_charge;
                        pp.shield_charge = 0;
                        pp.flags.shield_active = false;
                        emitEvent(
                            state,
                            .shield_popped,
                            @intCast(ph),
                            -1,
                            patch_ptr.id,
                            0,
                            pp.x,
                            pp.y,
                        );
                        dmg_to_apply = overflow;
                    } else {
                        dmg_to_apply = 0;
                    }
                }
                if (dmg_to_apply > 0) {
                    pp.health -= dmg_to_apply;
                    if (pp.health <= 0) {
                        pp.health = 0;
                        pp.flags.alive = false;
                        emitEvent(
                            state,
                            .player_killed,
                            @intCast(ph),
                            -1,
                            patch_ptr.id,
                            0,
                            pp.x,
                            pp.y,
                        );
                    }
                }
            }
        }
        _ = fire.fireEntityTick(patch_ptr, eff_dt);
    }

    // 7. Pickups (I13): for each ACTIVE pickup, check overlap
    //    against every alive player. On overlap apply the
    //    pickup's effect (health-shard heals, shield-cell adds
    //    shield_charge, others are flagged for buff durations
    //    handled TS-side until H8e ships) and deactivate the
    //    pickup. Respawn schedule is TS-driven for now.
    var ui: u32 = 0;
    while (ui < state.pickup_count) : (ui += 1) {
        const pickup_ptr = &state.pickups[ui];
        // Respawn check (I26): if inactive but respawn_at_tick is
        // in the past, re-activate. respawn_at_tick == 0 means
        // "no scheduled respawn", so skip.
        if ((pickup_ptr.flags & 1) == 0) {
            if (pickup_ptr.respawn_at_tick > 0 and
                state.header.tick >= pickup_ptr.respawn_at_tick)
            {
                pickup_ptr.flags |= 1;
                pickup_ptr.respawn_at_tick = 0;
            }
            continue;
        }
        var pp: u32 = 0;
        while (pp < state.player_count) : (pp += 1) {
            if (!state.players[pp].flags.alive) continue;
            const dx = state.players[pp].x - pickup_ptr.x;
            const dy = state.players[pp].y - pickup_ptr.y;
            const total_r = pickup_ptr.radius + 18.0; // player half-width
            if (dx * dx + dy * dy <= total_r * total_r) {
                // Apply effect inline. Numeric pickups heal /
                // restore directly; buff pickups set the matching
                // *_until_tick field + flag bit so the player's
                // existing buff machinery picks them up.
                const duration_ms: f64 = if ((pickup_ptr.flags & 2) != 0)
                    pickup_ptr.duration_ms
                else
                    0;
                const dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                const duration_ticks: u32 = @intFromFloat(@ceil(duration_ms / dt));
                const expiry_tick: u32 = state.header.tick + duration_ticks;
                switch (pickup_ptr.kind) {
                    .health_shard => {
                        state.players[pp].health = @min(
                            100.0,
                            state.players[pp].health + pickup_ptr.amount,
                        );
                    },
                    .shield_cell => {
                        if (state.players[pp].flags.has_shield_charge) {
                            state.players[pp].shield_charge = @min(
                                state.players[pp].shield_max_charge,
                                state.players[pp].shield_charge + pickup_ptr.amount,
                            );
                        }
                    },
                    .overcharge_core => {
                        state.players[pp].overcharge_until_tick = expiry_tick;
                        state.players[pp].flags.has_overcharge = true;
                    },
                    .damage_amp => {
                        state.players[pp].damage_amp_until_tick = expiry_tick;
                        state.players[pp].flags.has_damage_amp = true;
                    },
                    .speed_boost => {
                        state.players[pp].speed_boost_until_tick = expiry_tick;
                        state.players[pp].flags.has_speed_boost = true;
                    },
                    .melee_mode => {
                        state.players[pp].melee_mode_until_tick = expiry_tick;
                        state.players[pp].flags.has_melee_mode = true;
                    },
                    .slow_trap => {
                        state.players[pp].slow_debuff_until_tick = expiry_tick;
                        state.players[pp].flags.has_slow_debuff = true;
                    },
                    .vulnerability_trap => {
                        state.players[pp].vulnerability_until_tick = expiry_tick;
                        state.players[pp].flags.has_vulnerability = true;
                    },
                    .block_jammer => {
                        state.players[pp].block_jammer_until_tick = expiry_tick;
                        state.players[pp].flags.has_block_jammer = true;
                    },
                    .boss_core => {
                        state.players[pp].boss_mode_until_tick = expiry_tick;
                        state.players[pp].flags.has_boss_mode = true;
                    },
                    .card_cache => {
                        // Card draft offer — orchestrator emits
                        // event externally; no inline effect.
                    },
                }
                emitEvent(
                    state,
                    .pickup_taken,
                    @intCast(pp),
                    -1,
                    pickup_ptr.id,
                    @floatFromInt(@intFromEnum(pickup_ptr.kind)),
                    pickup_ptr.x,
                    pickup_ptr.y,
                );
                pickup_ptr.flags &= ~@as(u32, 1); // deactivate
                // Schedule respawn: respawn_ms after current
                // tick. respawn_ms field is bit 2 of flags; if
                // unset, use a default 12s.
                const respawn_ms: f64 = if ((pickup_ptr.flags & 4) != 0)
                    pickup_ptr.respawn_ms
                else
                    12_000.0;
                const respawn_dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                const respawn_ticks: u32 = @intFromFloat(@ceil(respawn_ms / respawn_dt));
                pickup_ptr.respawn_at_tick = state.header.tick + respawn_ticks;
                break;
            }
        }
    }

    // 2a. Fire-hazard chaos modifier (I33): spawn fire patches at
    //     random map positions on the configured interval.
    //
    // Rewritten 2026-07-14 — the previous version had THREE real bugs,
    // found by direct comparison against World.ts's equivalent (the
    // "4b. Fire-hazard" section):
    //   1. No is_fighting gate at all (TS: "only fires during the
    //      fighting phase") — hazards could spawn during countdown/draft.
    //   2. Position used a hardcoded -800..800 / -400..400 box via an
    //      ad-hoc xorshift derivation, NOT the shared parity-tested RNG
    //      and NOT the actual map size — the code's own old comment
    //      admitted this ("rough range... caller can clamp later"), i.e.
    //      it was a known-incomplete stub, not a finished feature.
    //   3. radius/damage/lifetime were hardcoded to DIFFERENT values than
    //      TS (radius always 36 vs TS's randomized 36-62; damage 14 vs
    //      TS's 13; lifetime 1800ms vs TS's 3000ms) — this chaos modifier
    //      would have played completely differently between backends.
    // Now: three draws from the SAME shared RNG World.ts uses (mulberry32
    // via rng.zig's nextU32, bit-exact ported — see docs/zig-wasm-*), real
    // map-size-based positioning (g_map_width/g_map_height, host-set via
    // world_state_set_map_size), and TS's exact radius/damage/lifetime
    // constants.
    if (is_fighting and
        chaos_profile.fire_hazard_active != 0 and
        chaos_profile.fire_hazard_interval_ms > 0 and
        state.fire_count < world_state.MAX_FIRE and
        g_map_width > 0 and g_map_height > 0)
    {
        const cur_timer: f64 = @floatFromInt(state.header.fire_hazard_timer_ms);
        const next_timer = cur_timer + eff_dt;
        if (next_timer >= chaos_profile.fire_hazard_interval_ms) {
            state.header.fire_hazard_timer_ms =
                @intFromFloat(next_timer - chaos_profile.fire_hazard_interval_ms);
            var rs = state.header.rng_state;
            rs = rng.nextU32(rs);
            const fx: f64 = @as(f64, @floatFromInt(rs)) / 0x100000000;
            rs = rng.nextU32(rs);
            const fy: f64 = @as(f64, @floatFromInt(rs)) / 0x100000000;
            rs = rng.nextU32(rs);
            const fr: f64 = @as(f64, @floatFromInt(rs)) / 0x100000000;
            state.header.rng_state = rs;
            const fx_span = @max(1.0, g_map_width - 160.0);
            const fy_span = @max(1.0, g_map_height - 250.0);
            const slot = state.fire_count;
            state.fire_count += 1;
            const new_id: u32 = state.header.next_entity_id;
            state.header.next_entity_id += 1;
            state.fires[slot] = .{
                .x = 80.0 + fx * fx_span,
                .y = 160.0 + fy * fy_span,
                .radius = 36.0 + fr * 26.0,
                .remaining_ms = 3000.0,
                .damage_per_second = 13.0,
                .id = new_id,
                .has_owner = 0,
                .owner_id_len = 0,
                .owner_id_bytes = @splat(0),
            };
        } else {
            state.header.fire_hazard_timer_ms = @intFromFloat(next_timer);
        }
    }

    // 8b. Burn DoT (I32). Players with has_burn + burn_until_tick
    //     > tick take burn_dps every ~1 second (timed via
    //     burn_tick_last_applied).
    var bi: u32 = 0;
    while (bi < state.player_count) : (bi += 1) {
        const pp = &state.players[bi];
        if (!pp.flags.alive) continue;
        if (!pp.flags.has_burn) continue;
        if (pp.burn_until_tick <= state.header.tick) {
            pp.flags.has_burn = false;
            continue;
        }
        // Tick at 1s cadence.
        const tick_dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
        const ticks_per_second: u32 = @intFromFloat(@ceil(1000.0 / tick_dt));
        const last = pp.burn_tick_last_applied;
        if (state.header.tick - last >= ticks_per_second) {
            pp.health -= pp.burn_dps;
            pp.burn_tick_last_applied = state.header.tick;
            if (pp.health <= 0) {
                pp.health = 0;
                pp.flags.alive = false;
                emitEvent(state, .player_killed, @intCast(bi), -1, 0, 0, pp.x, pp.y);
            }
        }
    }

    // 1. Round phase machine + winner detection (I6). MOVED HERE
    //    2026-07-14 (tick-order fix — was section "1" at the very top
    //    of the tick). Winner detection reads state.players[].health/
    //    .alive; running it BEFORE this tick's combat/projectile
    //    resolution meant a kill landed this tick wasn't reflected in
    //    round-winner detection until the FOLLOWING tick — a real,
    //    silent one-tick delay in round-end/match-end detection.
    //    Parity with World.ts, whose round-machine call is also its
    //    LAST per-tick step (section 5). When a winner emerges (KO or
    //    time-out), increment that player's score and signal the phase
    //    machine so it transitions fighting → round_over even before
    //    the time-out.
    const winner_idx = detectRoundWinner(state);
    if (winner_idx >= 0 and
        state.header.round_phase == @intFromEnum(round.RoundPhase.fighting))
    {
        const idx: u32 = @intCast(winner_idx);
        state.players[idx].score += 1;
        emitEvent(
            state,
            .round_end,
            winner_idx,
            -1,
            0,
            @floatFromInt(state.players[idx].score),
            0,
            0,
        );
        // Match-end check (I9): if this player hit target_score,
        // mark match winner. orchestrator stops advancing past
        // round_over once match_winner_idx is set.
        if (state.header.target_score > 0 and
            state.players[idx].score >= state.header.target_score)
        {
            state.header.match_winner_idx = winner_idx;
        }
    }
    const phase_result = round.roundStepPhase(
        state.header.round_phase,
        state.header.countdown_remaining_ms,
        eff_dt,
        winner_idx >= 0,
    );
    state.header.round_phase = phase_result.new_phase;
    state.header.countdown_remaining_ms =
        phase_result.new_countdown_remaining_ms;
    if (phase_result.transitioned == 1 and
        phase_result.new_phase == @intFromEnum(round.RoundPhase.countdown))
    {
        state.header.round_index += 1;
        // Reset transient entities for the new round (I28).
        // Players keep their score + buff durations; everything
        // else clears so the next round starts clean.
        state.projectile_count = 0;
        state.fire_count = 0;
        state.satellite_count = 0;
        // Heal alive players to full + clear timed buffs that
        // shouldn't carry across rounds (slow, burn, freeze).
        // Buff pickups (overcharge, damage_amp etc) DO carry per
        // the offline TS behavior.
        var ri: u32 = 0;
        while (ri < state.player_count) : (ri += 1) {
            state.players[ri].health = 100.0;
            state.players[ri].flags.alive = true;
            state.players[ri].flags.has_slow = false;
            state.players[ri].flags.has_burn = false;
            state.players[ri].flags.has_freeze = false;
        }
    }

    // 9. End-of-tick compaction (I29). Walk projectiles + fire
    //    patches; copy live entries down so the active prefix
    //    stays packed. Without this the arrays grow until the
    //    next round restart (I28) wipes them.
    var write_idx: u32 = 0;
    var read_idx: u32 = 0;
    while (read_idx < state.projectile_count) : (read_idx += 1) {
        if (state.projectiles[read_idx].lifetime_ms > 0) {
            if (write_idx != read_idx) {
                state.projectiles[write_idx] = state.projectiles[read_idx];
            }
            write_idx += 1;
        }
    }
    state.projectile_count = write_idx;

    var fwrite: u32 = 0;
    var fread: u32 = 0;
    while (fread < state.fire_count) : (fread += 1) {
        if (state.fires[fread].remaining_ms > 0) {
            if (fwrite != fread) {
                state.fires[fwrite] = state.fires[fread];
            }
            fwrite += 1;
        }
    }
    state.fire_count = fwrite;

    return 0;
}

pub export fn step_world(
    state_ptr: *world_state.WorldState,
    dt_ms: f64,
) i32 {
    return stepWorld(state_ptr, dt_ms);
}

/// Bulk-write the static AABB cache (I30). Hosts call this once
/// per match (after the map loads) so step_world has the full
/// terrain to feed into stepPlayer + step_projectile_v2.
///
/// Returns the count actually written (clamped at MAX_STATICS).
pub export fn world_state_set_statics(
    state_ptr: *world_state.WorldState,
    aabbs_ptr: [*]const collision_types.AABB,
    one_way_ptr: [*]const u8,
    count: u32,
) u32 {
    const clamped = @min(count, world_state.MAX_STATICS);
    var i: u32 = 0;
    while (i < clamped) : (i += 1) {
        state_ptr.statics[i] = aabbs_ptr[i];
        state_ptr.one_way[i] = one_way_ptr[i];
    }
    state_ptr.static_count = clamped;
    return clamped;
}

/// Set the match target_score (I9 was set on pack; this lets the
/// host change it mid-match without re-packing).
pub export fn world_state_set_target_score(
    state_ptr: *world_state.WorldState,
    target: u32,
) void {
    state_ptr.header.target_score = target;
    state_ptr.header.match_winner_idx = -1;
}
