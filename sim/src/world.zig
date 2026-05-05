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

pub fn stepWorld(state: *world_state.WorldState, dt_ms: f64) i32 {
    state.header.tick += 1;

    // 0. Resolve the chaos profile for this tick. Today the
    //    profile isn't applied to the per-module ticks (the TS
    //    orchestrator still scales dt by timeScale, etc.), but
    //    landing the lookup here proves the data layer plugs
    //    into the orchestrator. Phase I4+ wires the profile into
    //    the per-module calls.
    const chaos_profile = chaos.chaosProfileFromMask(state.header.chaos_mask);
    _ = chaos_profile;

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
        dt_ms,
        winner_idx >= 0,
    );
    state.header.round_phase = phase_result.new_phase;
    state.header.countdown_remaining_ms =
        phase_result.new_countdown_remaining_ms;
    if (phase_result.transitioned == 1 and
        phase_result.new_phase == @intFromEnum(round.RoundPhase.countdown))
    {
        state.header.round_index += 1;
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
        const damage_this_tick = patch_ptr.damage_per_second * (dt_ms / 1000.0);
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
        _ = fire.fireEntityTick(patch_ptr, dt_ms);
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
        const result = projectile.projectilePreStep(proj_ptr, dt_ms);
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
                dt_ms,
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
            proj_ptr.lifetime_ms -= dt_ms;
            if (proj_ptr.flags.has_age) proj_ptr.age_ms = kine.age_ms;
            if (proj_ptr.flags.has_traveled) proj_ptr.traveled_px = kine.traveled_px;
            proj_ptr.flags.returning = kine.returning != 0;
            proj_ptr.bounces_remaining = @intCast(kine.bounces_remaining);
            _ = r;
        }
    }

    // 4. Per-pair projectile × destructible HP application.
    //    O(N×M) but N,M ≤ 256×64 in the worst case. The full
    //    spatial-grid path lands when the orchestrator owns
    //    spawn / despawn (Phase I3+).
    var pi2: u32 = 0;
    while (pi2 < state.projectile_count) : (pi2 += 1) {
        const proj_ptr = &state.projectiles[pi2];
        var di: u32 = 0;
        while (di < state.destructible_count) : (di += 1) {
            const dest_ptr = &state.destructibles[di];
            _ = destructible.resolveProjectileHit(proj_ptr, dest_ptr);
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
        _ = satellite.satelliteTickWorld(
            sat_ptr,
            owner_x,
            owner_y,
            target_x,
            target_y,
            has_target,
            can_fire,
            dt_ms,
        );
    }

    // 6. Combat — per-player shield drain + parry start (I4 +
    //    I4b). Defaults match `combat_*` exports.
    var pi3: u32 = 0;
    while (pi3 < state.player_count) : (pi3 += 1) {
        const player_ptr = &state.players[pi3];
        combat.tickShield(
            player_ptr,
            player_ptr.current_keys,
            dt_ms,
            0.0, // max_charge_override = 0 → use stored shield_max_charge
            combat.SHIELD_DRAIN_PER_SECOND,
            combat.SHIELD_RECHARGE_PER_SECOND,
        );
        _ = combat.tryStartParry(
            player_ptr,
            player_ptr.current_keys,
            player_ptr.prev_keys,
            state.header.tick,
            dt_ms,
            combat.PARRY_ACTIVE_MS,
            combat.PARRY_COOLDOWN_MS_DEFAULT,
        );
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
