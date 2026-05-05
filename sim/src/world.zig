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

/// Per-tick step. Mutates `state` in place. Returns 0 on success;
/// reserved non-zero values for future error reporting.
/// Decide a round winner during fighting phase. Returns:
///   * winner index ≥ 0 if exactly one player alive (KO)
///   * winner index ≥ 0 if time-out (highest health)
///   * -1 if no winner yet
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
    // Time-out path: highest health among the dead/alive set wins.
    if (state.header.countdown_remaining_ms <= 0 and state.player_count > 0) {
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

    // 1. Round phase machine + winner detection (I6). When a
    //    winner emerges (KO or time-out), increment that player's
    //    score and signal the phase machine so it transitions
    //    fighting → round_over even before the time-out.
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
                std.mem.eql(u8,
                    state.players[ph].id_bytes[0..patch_ptr.owner_id_len],
                    patch_ptr.owner_id_bytes[0..patch_ptr.owner_id_len]))
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
                state.players[ph].health -= damage_this_tick;
                if (state.players[ph].health <= 0) {
                    state.players[ph].health = 0;
                    state.players[ph].flags.alive = false;
                }
            }
        }
        _ = fire.fireEntityTick(patch_ptr, eff_dt);
    }

    // 3. Projectile pre-step lifecycle + motion (I7). Sticky /
    //    lifetime decisions first; for `advance` results the
    //    motion kernel runs via step_projectile_v2 with empty
    //    statics + empty players (terrain + player collision
    //    arrives once the orchestrator owns the static-AABB
    //    cache + player array indexing).
    const empty_statics: []const collision_types.AABB = &.{};
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
                empty_statics,
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
            _ = r;
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
                        std.mem.eql(u8,
                            state.players[ex_p].id_bytes[0..proj_ptr.owner_id_len],
                            proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
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
                        state.players[ex_p].health -= destructible.EXPLOSION_DAMAGE;
                        if (state.players[ex_p].health <= 0) {
                            state.players[ex_p].health = 0;
                            state.players[ex_p].flags.alive = false;
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
                std.mem.eql(u8,
                    state.players[ph2].id_bytes[0..proj_ptr.owner_id_len],
                    proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
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
                const final_dmg = proj_ptr.damage * chaos_profile.damage_multiplier;
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
                std.mem.eql(u8,
                    state.players[oj].id_bytes[0..sat_ptr.owner_id_len],
                    sat_ptr.owner_id_bytes[0..sat_ptr.owner_id_len]))
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

    // 8. Player physics (I16). Bridge PlayerEntity +
    //    PlayerMovementMemory → PlayerStep, run stepPlayer with
    //    the statics + one_way cache, write motion + memory back.
    const statics_slice = state.statics[0..state.static_count];
    const one_way_slice = state.one_way[0..state.static_count];
    var pmi: u32 = 0;
    while (pmi < state.player_count) : (pmi += 1) {
        if (!state.players[pmi].flags.alive) continue;
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
        };
        const grounded = player_mod.stepPlayer(
            &ps,
            state.players[pmi].prev_keys,
            state.players[pmi].current_keys,
            state.players[pmi].aim_x,
            state.players[pmi].aim_y,
            1.0, // speed_mul — per-player slow effects apply inside stepPlayer via PlayerEntity flags
            chaos_profile.gravity_multiplier,
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
        state.players[pmi].flags.grounded = grounded;
        state.player_movement[pmi].coyote_ms = ps.coyote_ms;
        state.player_movement[pmi].jump_buffer_ms = ps.jump_buffer_ms;
        state.player_movement[pmi].jump_cut_applied = @intCast(ps.jump_cut_applied);
        state.player_movement[pmi].jump_released_since_jump = @intCast(ps.jump_released_since_jump);
        state.player_movement[pmi].grounded_last_frame = if (grounded) 1 else 0;
        state.player_movement[pmi].jetpack_active = @intCast(ps.jetpack_active);
    }

    // 6. Combat — per-player shield drain + parry start (I4 +
    //    I4b). Defaults match `combat_*` exports.
    var pi3: u32 = 0;
    while (pi3 < state.player_count) : (pi3 += 1) {
        const player_ptr = &state.players[pi3];
        combat.tickShield(
            player_ptr,
            player_ptr.current_keys,
            eff_dt,
            0.0, // max_charge_override = 0 → use stored shield_max_charge
            combat.SHIELD_DRAIN_PER_SECOND,
            combat.SHIELD_RECHARGE_PER_SECOND,
        );
        _ = combat.tryStartParry(
            player_ptr,
            player_ptr.current_keys,
            player_ptr.prev_keys,
            state.header.tick,
            eff_dt,
            combat.PARRY_ACTIVE_MS,
            combat.PARRY_COOLDOWN_MS_DEFAULT,
        );
        // Weapon fire decision + projectile spawn (I21). Today
        // every player uses the starter-pistol base stats from
        // data/weapons.zig — full card-build resolution lands in
        // a follow-on cut. Projectile_count guard prevents
        // overflow of the fixed-size array.
        const weapon_base = weapons_data.weaponBaseById(.starter_pistol);
        const cd_after = weapon.cooldownFromFireRate(
            weapon_base.fire_rate * chaos_profile.fire_rate_multiplier,
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
            state.projectile_count < world_state.MAX_PROJECTILES and
            chaos_profile.disable_projectiles == 0)
        {
            const dx = player_ptr.aim_x - player_ptr.x;
            const dy = player_ptr.aim_y - player_ptr.y;
            const aim_angle: f64 = if (dx == 0 and dy == 0) 0 else trig.lutAtan2(dy, dx);
            const speed = weapon_base.projectile_speed *
                weapon_base.projectile_speed_multiplier;
            const lifetime_ms = @max(
                50.0,
                weapon_base.projectile_lifetime_seconds * 1000.0 *
                    weapon_base.projectile_lifetime_multiplier,
            );
            const slot: u32 = state.projectile_count;
            state.projectile_count += 1;
            const new_id: u32 = state.header.next_entity_id;
            state.header.next_entity_id += 1;
            state.projectiles[slot] = .{
                .x = player_ptr.x,
                .y = player_ptr.y,
                .vx = trig.lutCos(aim_angle) * speed,
                .vy = trig.lutSin(aim_angle) * speed,
                .radius = @max(2.0, 7.0 * weapon_base.projectile_size_multiplier),
                .damage = weapon_base.damage,
                .lifetime_ms = lifetime_ms,
                .age_ms = 0,
                .traveled_px = 0,
                .origin_x = player_ptr.x,
                .origin_y = player_ptr.y,
                .homing_strength = weapon_base.projectile_homing_strength,
                .acceleration_multiplier = weapon_base.projectile_acceleration_multiplier,
                .gravity_scale = weapon_base.projectile_gravity_scale,
                .range_px = weapon_base.projectile_range_px,
                .slow_multiplier = weapon_base.projectile_slow_multiplier,
                .sticky_fuse_ms = 0,
                .impact_radius_px = weapon_base.projectile_impact_radius_px,
                .id = new_id,
                .bounces_remaining = weapon_base.projectile_bounces,
                .pierce_remaining = weapon_base.projectile_pierce_count,
                .split_count = weapon_base.projectile_split_count,
                .flags = .{
                    .has_owner = true,
                    .has_impact = true,
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
                .pathing = weapon_base.projectile_pathing,
                .element = weapon_base.projectile_element,
                .impact = weapon_base.projectile_impact,
                .shape = weapon_base.projectile_shape,
                .owner_id_len = player_ptr.id_len,
                .owner_id_bytes = player_ptr.id_bytes,
            };
            emitEvent(
                state,
                .shot_fired,
                @intCast(pi3),
                -1,
                new_id,
                aim_angle,
                player_ptr.x,
                player_ptr.y,
            );
        }

        // Roll current → prev for the next tick's edge detection.
        player_ptr.prev_keys = player_ptr.current_keys;
    }

    return 0;
}

pub export fn step_world(
    state_ptr: *world_state.WorldState,
    dt_ms: f64,
) i32 {
    return stepWorld(state_ptr, dt_ms);
}
