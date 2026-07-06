//! Projectile motion kernel — bit-exact port of the integration
//! layer of `client/src/sim/projectile.ts` `stepProjectile`.
//!
//! Phase C scope (this PR): straight + gravity pathing, position
//! integration, lifetime decay, terrain collision. Player
//! collision, splits, sticky, impacts, homing/boomerang/float/
//! accelerate/bounce stay TS-side and land in follow-on cuts.
//!
//! See ADR-0006 and `docs/zig-wasm-migration.md`.

const std = @import("std");
const collision = @import("collision.zig");
const trig = @import("trig.zig");
const rng = @import("rng.zig");
const world_state = @import("world_state.zig");

// Phase H1 — orchestration constants that mirror
// client/src/sim/projectile.ts. Bit-exact bumps require parity-test
// updates on both sides.
pub const STICKY_FUSE_MS: f64 = 720.0;
const SPLIT_SPREAD: f64 = std.math.pi * 0.95;
const SPLIT_DAMAGE_SCALE: f64 = 0.42;
const SPLIT_LIFETIME_SCALE: f64 = 0.42;
const SPLIT_RANGE_SCALE: f64 = 0.32;
const SPLIT_MAX: u32 = 8;
const SPLIT_MIN_LIFETIME_MS: f64 = 280.0;
const SPLIT_RADIUS_SCALE: f64 = 0.78;
const SPLIT_RADIUS_MIN: f64 = 2.0;
const SPLIT_SPEED_SCALE: f64 = 0.82;
const SPLIT_SPEED_MIN: f64 = 180.0;
const SPLIT_IMPACT_RADIUS_SCALE: f64 = 0.45;

pub const Pathing = enum(u8) {
    straight = 0,
    gravity = 1,
    // float, accelerate, boomerang, homing, anti-homing, bounce —
    // pending. Caller dispatches those in TS until ported.
    _,
};

const GRAVITY_PATHING_ACCEL_DEFAULT: f64 = 1450.0;

pub const ProjectileKinematics = extern struct {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    age_ms: f64,
    lifetime_ms: f64,
    radius: f64,
    gravity_scale: f64, // 0 = use default 1450
    traveled_px: f64,
    pathing: u8, // matches Pathing enum
    _pad0: u8 = 0,
    _pad1: u8 = 0,
    _pad2: u8 = 0,
    _pad3: i32 = 0,
};

pub const StepResult = extern struct {
    /// 1 = expired this tick (lifetime, terrain), 0 = still alive
    expired: i32,
    /// Index of platform hit, -1 if no terrain hit. Caller can use
    /// this to drive splits / impacts.
    terrain_hit_index: i32,
};

/// Step a projectile by one tick. Mutates `k` in place.
///   - Velocity update per pathing type
///   - Position integration
///   - Lifetime decay
///   - Terrain collision via circleHitsAny
///
/// Returns expired flag + terrain hit index. Caller handles events,
/// splits, player collision (in TS for now).
pub fn step(
    k: *ProjectileKinematics,
    dt_ms: f64,
    statics: []const collision.AABB,
) StepResult {
    const dt_sec = dt_ms / 1000.0;

    // Lifetime: even before motion, expire if remaining <= 0.
    const remaining = k.lifetime_ms - dt_ms;
    if (remaining <= 0.0) {
        return .{ .expired = 1, .terrain_hit_index = -1 };
    }

    // Pathing — velocity update.
    const pathing = @as(Pathing, @enumFromInt(k.pathing));
    switch (pathing) {
        .gravity => {
            const g = if (k.gravity_scale > 0.0) k.gravity_scale else GRAVITY_PATHING_ACCEL_DEFAULT;
            k.vy += g * dt_sec;
        },
        .straight => {},
        else => {},
    }

    // Position integration + traveled distance.
    const prev_x = k.x;
    const prev_y = k.y;
    k.x = prev_x + k.vx * dt_sec;
    k.y = prev_y + k.vy * dt_sec;
    const dx = k.x - prev_x;
    const dy = k.y - prev_y;
    k.traveled_px += @sqrt(dx * dx + dy * dy);
    k.age_ms += dt_ms;
    k.lifetime_ms = remaining;

    // Terrain hit (uses circle vs static AABBs).
    const hit_idx = collision.circleHitsAny(k.x, k.y, k.radius, statics);
    if (hit_idx >= 0) {
        return .{ .expired = 1, .terrain_hit_index = hit_idx };
    }

    return .{ .expired = 0, .terrain_hit_index = -1 };
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn step_projectile(
    state_ptr: *ProjectileKinematics,
    dt_ms: f64,
    statics_ptr: [*]const collision.AABB,
    statics_count: u32,
    out_ptr: *StepResult,
) void {
    out_ptr.* = step(state_ptr, dt_ms, statics_ptr[0..statics_count]);
}

pub export fn sizeof_projectile_kinematics() u32 {
    return @sizeOf(ProjectileKinematics);
}

pub export fn sizeof_projectile_step_result() u32 {
    return @sizeOf(StepResult);
}

// ── Per-pathing velocity-update helpers ───────────────────────────────────
//
// The full stepProjectile uses these via a switch on `pathing`. Because
// the existing ProjectileKinematics struct doesn't carry the entity id
// or all per-pathing state, we expose these as pure wasm functions that
// the TS caller composes. Each takes vx/vy + the relevant pathing
// parameters and writes the new vx/vy to out pointers.

pub const FLOAT_OSC_LATERAL: f64 = 22.0;
pub const FLOAT_OSC_FORWARD: f64 = 11.0;
pub const FLOAT_OSC_LATERAL_HZ: f64 = 9.0;
pub const FLOAT_OSC_FORWARD_HZ: f64 = 5.0;

/// Float pathing: sin/cos oscillation phase-keyed by entity id.
/// Bit-exact port of `projectile.ts`:
///   vy += sin(ageSec * LATERAL_HZ + id) * LATERAL * dtSec
///   vx += cos(ageSec * FORWARD_HZ + id) * FORWARD * dtSec
pub fn applyFloatPathing(
    vx_in: f64,
    vy_in: f64,
    age_ms: f64,
    id: f64,
    dt_ms: f64,
    out_vx: *f64,
    out_vy: *f64,
) void {
    const age_sec = age_ms / 1000.0;
    const dt_sec = dt_ms / 1000.0;
    out_vy.* = vy_in + trig.lutSin(age_sec * FLOAT_OSC_LATERAL_HZ + id) * FLOAT_OSC_LATERAL * dt_sec;
    out_vx.* = vx_in + trig.lutCos(age_sec * FLOAT_OSC_FORWARD_HZ + id) * FLOAT_OSC_FORWARD * dt_sec;
}

/// Accelerate pathing: scale velocity by (1 + k * dt).
pub fn applyAcceleratePathing(
    vx_in: f64,
    vy_in: f64,
    k_factor: f64,
    dt_ms: f64,
    out_vx: *f64,
    out_vy: *f64,
) void {
    const dt_sec = dt_ms / 1000.0;
    const factor = 1.0 + k_factor * dt_sec;
    out_vx.* = vx_in * factor;
    out_vy.* = vy_in * factor;
}

/// Rotate a velocity vector toward a target point at most `turn_rate
/// * dt_sec` radians. Used by homing/anti-homing/boomerang pathings.
/// Bit-exact port of `rotateVelocityToward` in projectile.ts.
pub fn rotateVelocityToward(
    vx_in: f64,
    vy_in: f64,
    px: f64,
    py: f64,
    target_x: f64,
    target_y: f64,
    turn_rate: f64,
    dt_sec: f64,
    out_vx: *f64,
    out_vy: *f64,
) void {
    const speed = @sqrt(vx_in * vx_in + vy_in * vy_in);
    if (speed <= 0.0) {
        out_vx.* = vx_in;
        out_vy.* = vy_in;
        return;
    }
    const current = trig.lutAtan2(vy_in, vx_in);
    const desired = trig.lutAtan2(target_y - py, target_x - px);
    const next_angle = rotateAngleToward(current, desired, turn_rate * dt_sec);
    out_vx.* = trig.lutCos(next_angle) * speed;
    out_vy.* = trig.lutSin(next_angle) * speed;
}

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;

fn wrapAngle(angle: f64) f64 {
    var a = angle;
    while (a < -PI) a += TWO_PI;
    while (a >= PI) a -= TWO_PI;
    return a;
}

fn rotateAngleToward(current: f64, target: f64, max_step: f64) f64 {
    const difference = wrapAngle(target - current);
    if (@abs(difference) <= max_step) return target;
    const sign: f64 = if (difference > 0.0) 1.0 else if (difference < 0.0) -1.0 else 0.0;
    return current + sign * max_step;
}

// ── wasm ABI exports for the helpers ──────────────────────────────────────

pub export fn projectile_apply_float(
    vx: f64,
    vy: f64,
    age_ms: f64,
    id: f64,
    dt_ms: f64,
    out_vx: *f64,
    out_vy: *f64,
) void {
    applyFloatPathing(vx, vy, age_ms, id, dt_ms, out_vx, out_vy);
}

pub export fn projectile_apply_accelerate(
    vx: f64,
    vy: f64,
    k_factor: f64,
    dt_ms: f64,
    out_vx: *f64,
    out_vy: *f64,
) void {
    applyAcceleratePathing(vx, vy, k_factor, dt_ms, out_vx, out_vy);
}

pub export fn projectile_rotate_velocity_toward(
    vx: f64,
    vy: f64,
    px: f64,
    py: f64,
    target_x: f64,
    target_y: f64,
    turn_rate: f64,
    dt_sec: f64,
    out_vx: *f64,
    out_vy: *f64,
) void {
    rotateVelocityToward(vx, vy, px, py, target_x, target_y, turn_rate, dt_sec, out_vx, out_vy);
}

// ── Homing target lookup + boomerang state machine ────────────────────────

pub const BOOMERANG_RANGE_FRACTION: f64 = 0.55;
pub const BOOMERANG_TURN_RATE: f64 = 8.4;
pub const HOMING_TURN_RATE_DEFAULT: f64 = 4.0;

/// Find the closest alive non-owner player by squared distance.
/// Caller passes parallel arrays already sorted by player id (string
/// order, matching TS `Object.keys(players).sort()`).
///
///   player_xs / player_ys: position arrays
///   player_alive:          1/0 mask, parallel to xs/ys
///   owner_idx:             index to exclude (-1 = no owner)
///   n_players:             length of all arrays
///
/// Returns the index of the closest valid candidate, or -1 if none.
pub fn closestNonOwnerPlayer(
    from_x: f64,
    from_y: f64,
    owner_idx: i32,
    player_xs: []const f64,
    player_ys: []const f64,
    player_alive: []const u8,
    n_players: u32,
) i32 {
    var best: i32 = -1;
    var best_sq: f64 = std.math.inf(f64);
    var i: u32 = 0;
    while (i < n_players) : (i += 1) {
        const ii: i32 = @intCast(i);
        if (owner_idx >= 0 and ii == owner_idx) continue;
        if (player_alive[i] == 0) continue;
        const dx = player_xs[i] - from_x;
        const dy = player_ys[i] - from_y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best_sq) {
            best = ii;
            best_sq = d2;
        }
    }
    return best;
}

/// Boomerang return-trigger: `!returning && range > 0 && traveled >
/// range * BOOMERANG_RANGE_FRACTION`. Returns whether the projectile
/// should flip into return mode this tick.
pub fn boomerangShouldReturn(
    returning_already: bool,
    traveled_px: f64,
    range_px: f64,
) bool {
    if (returning_already) return false;
    if (range_px <= 0.0) return false;
    return traveled_px > range_px * BOOMERANG_RANGE_FRACTION;
}

// ── wasm exports ──────────────────────────────────────────────────────────

pub export fn projectile_closest_non_owner_player(
    from_x: f64,
    from_y: f64,
    owner_idx: i32,
    player_xs_ptr: [*]const f64,
    player_ys_ptr: [*]const f64,
    player_alive_ptr: [*]const u8,
    n_players: u32,
) i32 {
    return closestNonOwnerPlayer(
        from_x,
        from_y,
        owner_idx,
        player_xs_ptr[0..n_players],
        player_ys_ptr[0..n_players],
        player_alive_ptr[0..n_players],
        n_players,
    );
}

pub export fn projectile_boomerang_should_return(
    returning_already: i32,
    traveled_px: f64,
    range_px: f64,
) i32 {
    return if (boomerangShouldReturn(returning_already != 0, traveled_px, range_px)) 1 else 0;
}

pub export fn projectile_boomerang_turn_rate() f64 {
    return BOOMERANG_TURN_RATE;
}

pub export fn projectile_homing_turn_rate_default() f64 {
    return HOMING_TURN_RATE_DEFAULT;
}

// ── Bounce resolve + anti-homing helpers ──────────────────────────────────

pub const BounceResolve = extern struct {
    /// 1 = bounced this tick (hit a static), 0 = no bounce
    bounced: i32,
    /// Index of platform hit, -1 if no bounce
    hit_index: i32,
    /// Reflected velocity (post-bounce). Same as input if no bounce.
    new_vx: f64,
    new_vy: f64,
    /// Nudged-back position (post-bounce). Same as input if no bounce.
    new_x: f64,
    new_y: f64,
    /// Decremented bounces_remaining (only if bounced).
    new_bounces_remaining: i32,
    _pad: i32 = 0,
};

/// Resolve a projectile-vs-static bounce step. Mirrors the bounce
/// branch of `stepProjectile` in projectile.ts:
///   1. circleBounce against statics at current position
///   2. If hit: reflect velocity on the indicated axes
///   3. Nudge-back from prev position by max(1, radius/2) along
///      the reflected direction so the projectile doesn't tunnel
///   4. Decrement bounces_remaining
///
/// Bit-exact: uses `@sqrt` (IEEE 754 deterministic) — caller's TS
/// must use `Math.sqrt(bvx*bvx + bvy*bvy)` for parity, NOT
/// `Math.hypot` (overflow-safe scaling can ULP-differ).
pub fn bounceResolve(
    cur_x: f64,
    cur_y: f64,
    prev_x: f64,
    prev_y: f64,
    vx: f64,
    vy: f64,
    radius: f64,
    bounces_remaining: i32,
    statics: []const collision.AABB,
) BounceResolve {
    var out: BounceResolve = .{
        .bounced = 0,
        .hit_index = -1,
        .new_vx = vx,
        .new_vy = vy,
        .new_x = cur_x,
        .new_y = cur_y,
        .new_bounces_remaining = bounces_remaining,
    };

    if (bounces_remaining <= 0) return out;

    var bounce: collision.CircleBounce = undefined;
    if (!collision.circleBounce(cur_x, cur_y, prev_x, prev_y, radius, statics, &bounce)) {
        return out;
    }

    var bvx = vx;
    var bvy = vy;
    if (bounce.reflect_x == 1) bvx = -vx;
    if (bounce.reflect_y == 1) bvy = -vy;

    const len_raw = @sqrt(bvx * bvx + bvy * bvy);
    const len = if (len_raw == 0.0) 1.0 else len_raw;
    const nudge_raw = radius * 0.5;
    const nudge = if (nudge_raw < 1.0) 1.0 else nudge_raw;

    out.bounced = 1;
    out.hit_index = bounce.index;
    out.new_vx = bvx;
    out.new_vy = bvy;
    out.new_x = prev_x + (bvx / len) * nudge;
    out.new_y = prev_y + (bvy / len) * nudge;
    out.new_bounces_remaining = bounces_remaining - 1;
    return out;
}

/// Compute the mirror target for anti-homing: `(2*x - tx, 2*y - ty)`.
/// The projectile rotates AWAY from the real target by chasing this
/// reflected point. Pure arithmetic.
pub fn antiHomingTarget(
    x: f64,
    y: f64,
    target_x: f64,
    target_y: f64,
    out_tx: *f64,
    out_ty: *f64,
) void {
    out_tx.* = x * 2.0 - target_x;
    out_ty.* = y * 2.0 - target_y;
}

// ── wasm exports ──────────────────────────────────────────────────────────

pub export fn projectile_bounce_resolve(
    cur_x: f64,
    cur_y: f64,
    prev_x: f64,
    prev_y: f64,
    vx: f64,
    vy: f64,
    radius: f64,
    bounces_remaining: i32,
    statics_ptr: [*]const collision.AABB,
    statics_count: u32,
    out_ptr: *BounceResolve,
) void {
    out_ptr.* = bounceResolve(
        cur_x,
        cur_y,
        prev_x,
        prev_y,
        vx,
        vy,
        radius,
        bounces_remaining,
        statics_ptr[0..statics_count],
    );
}

pub export fn projectile_anti_homing_target(
    x: f64,
    y: f64,
    target_x: f64,
    target_y: f64,
    out_tx: *f64,
    out_ty: *f64,
) void {
    antiHomingTarget(x, y, target_x, target_y, out_tx, out_ty);
}

pub export fn sizeof_bounce_resolve() u32 {
    return @sizeOf(BounceResolve);
}

// ── Full-dispatch step_projectile_v2 — all pathings in one call ───────────
//
// Extends the per-tick projectile step to dispatch every pathing
// type internally instead of relying on TS-side switch. Use this
// when the TS caller wants to run the entire projectile flight
// physics through wasm in a single boundary crossing.
//
// V1 (`step_projectile` + `ProjectileKinematics`) stays around for
// the simpler straight+gravity case. V2 supersedes it.

pub const PathingV2 = enum(u8) {
    straight = 0,
    gravity = 1,
    float = 2,
    accelerate = 3,
    boomerang = 4,
    homing = 5,
    anti_homing = 6,
    bounce = 7,
    _,
};

pub const ProjectileKinematicsV2 = extern struct {
    // Motion
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    // Lifetime
    age_ms: f64,
    lifetime_ms: f64,
    // Collision
    radius: f64,
    // Pathing params
    gravity_scale: f64, // 0 = use default 1450 for gravity pathing
    traveled_px: f64,
    origin_x: f64,
    origin_y: f64,
    range_px: f64,
    acceleration_multiplier: f64, // for accelerate pathing
    homing_strength: f64, // 0 = use default for homing
    id: f64, // entity id (used for float phase keying)
    // Discrete state (i32-aligned for ABI stability)
    pathing: i32, // matches PathingV2 enum
    returning: i32, // boomerang state machine
    bounces_remaining: i32,
    _pad: i32 = 0,
};

pub const StepResultV2 = extern struct {
    /// 1 = expired this tick (lifetime, terrain non-bounce, etc.)
    expired: i32,
    /// Index of platform hit, -1 if no terrain hit. For bounce
    /// pathing, this is set on a successful bounce too (and the
    /// projectile keeps going with reflected velocity). For other
    /// pathings, terrain hit means expire.
    terrain_hit_index: i32,
    /// 1 = projectile bounced this tick (only set for bounce pathing)
    bounced: i32,
    _pad: i32 = 0,
};

pub fn stepV2(
    k: *ProjectileKinematicsV2,
    dt_ms: f64,
    statics: []const collision.AABB,
    // Player arrays (for homing/anti-homing). Sorted by player id
    // (string order matches TS Object.keys.sort()).
    player_xs: []const f64,
    player_ys: []const f64,
    player_alive: []const u8,
    owner_idx: i32,
) StepResultV2 {
    const dt_sec = dt_ms / 1000.0;
    // The muzzle can legitimately place a freshly-spawned projectile
    // overlapping (or immediately adjacent to) nearby static geometry — e.g.
    // firing steeply upward spawns it close enough to a low ceiling that
    // even this first tick's motion still overlaps. Expiring on that very
    // first step destroys the projectile before any external observer
    // (snapshot, render) ever sees it. Reproduced live: shots fired at a
    // steep upward angle vanished with zero travel (0/30 samples at 20ms
    // polling), while level-aimed shots from the same spot worked fine.
    const is_first_tick = k.age_ms <= 0.0;

    // Lifetime: even before motion, expire if remaining <= 0.
    const remaining = k.lifetime_ms - dt_ms;
    if (remaining <= 0.0) {
        return .{ .expired = 1, .terrain_hit_index = -1, .bounced = 0 };
    }

    // Pathing — velocity update.
    const pathing = @as(PathingV2, @enumFromInt(@as(u8, @intCast(k.pathing & 0xff))));
    switch (pathing) {
        .straight => {},
        .gravity => {
            const g = if (k.gravity_scale > 0.0) k.gravity_scale else GRAVITY_PATHING_ACCEL_DEFAULT;
            k.vy += g * dt_sec;
        },
        .float => {
            // Match TS: use ageMs at START of this tick (pre-increment)
            // for phase keying — projectile.ts reads `ageSec = nextAgeMs / 1000`
            // where nextAgeMs = (proj.ageMs ?? 0) + dtMs. So phase reflects
            // the END-of-tick age. We follow that contract here too.
            const next_age_ms = k.age_ms + dt_ms;
            var new_vx: f64 = undefined;
            var new_vy: f64 = undefined;
            applyFloatPathing(k.vx, k.vy, next_age_ms, k.id, dt_ms, &new_vx, &new_vy);
            k.vx = new_vx;
            k.vy = new_vy;
        },
        .accelerate => {
            var new_vx: f64 = undefined;
            var new_vy: f64 = undefined;
            applyAcceleratePathing(k.vx, k.vy, k.acceleration_multiplier, dt_ms, &new_vx, &new_vy);
            k.vx = new_vx;
            k.vy = new_vy;
        },
        .boomerang => {
            // Trigger return mode if past range fraction.
            if (boomerangShouldReturn(k.returning != 0, k.traveled_px, k.range_px)) {
                k.returning = 1;
            }
            if (k.returning != 0) {
                var new_vx: f64 = undefined;
                var new_vy: f64 = undefined;
                rotateVelocityToward(
                    k.vx,
                    k.vy,
                    k.x,
                    k.y,
                    k.origin_x,
                    k.origin_y,
                    BOOMERANG_TURN_RATE,
                    dt_sec,
                    &new_vx,
                    &new_vy,
                );
                k.vx = new_vx;
                k.vy = new_vy;
            }
        },
        .homing, .anti_homing => {
            const target_idx = closestNonOwnerPlayer(
                k.x,
                k.y,
                owner_idx,
                player_xs,
                player_ys,
                player_alive,
                @intCast(player_xs.len),
            );
            if (target_idx >= 0) {
                const ti: usize = @intCast(target_idx);
                var tx: f64 = undefined;
                var ty: f64 = undefined;
                if (pathing == .anti_homing) {
                    antiHomingTarget(k.x, k.y, player_xs[ti], player_ys[ti], &tx, &ty);
                } else {
                    tx = player_xs[ti];
                    ty = player_ys[ti];
                }
                const turn_rate = if (k.homing_strength > 0.0) k.homing_strength else HOMING_TURN_RATE_DEFAULT;
                var new_vx: f64 = undefined;
                var new_vy: f64 = undefined;
                rotateVelocityToward(k.vx, k.vy, k.x, k.y, tx, ty, turn_rate, dt_sec, &new_vx, &new_vy);
                k.vx = new_vx;
                k.vy = new_vy;
            }
        },
        .bounce => {},
        else => {},
    }

    // Position integration + traveled distance.
    const prev_x = k.x;
    const prev_y = k.y;
    k.x = prev_x + k.vx * dt_sec;
    k.y = prev_y + k.vy * dt_sec;
    const dx = k.x - prev_x;
    const dy = k.y - prev_y;
    k.traveled_px += @sqrt(dx * dx + dy * dy);
    k.age_ms += dt_ms;
    k.lifetime_ms = remaining;

    // Terrain handling — bounce vs expire.
    if (pathing == .bounce and k.bounces_remaining > 0) {
        var br: BounceResolve = undefined;
        br = bounceResolve(k.x, k.y, prev_x, prev_y, k.vx, k.vy, k.radius, k.bounces_remaining, statics);
        if (br.bounced == 1) {
            k.x = br.new_x;
            k.y = br.new_y;
            k.vx = br.new_vx;
            k.vy = br.new_vy;
            k.bounces_remaining = br.new_bounces_remaining;
            return .{ .expired = 0, .terrain_hit_index = br.hit_index, .bounced = 1 };
        }
    }

    const hit_idx = collision.circleHitsAny(k.x, k.y, k.radius, statics);
    if (hit_idx >= 0 and !is_first_tick) {
        return .{ .expired = 1, .terrain_hit_index = hit_idx, .bounced = 0 };
    }

    return .{ .expired = 0, .terrain_hit_index = -1, .bounced = 0 };
}

// Wasm export
pub export fn step_projectile_v2(
    state_ptr: *ProjectileKinematicsV2,
    dt_ms: f64,
    statics_ptr: [*]const collision.AABB,
    statics_count: u32,
    player_xs_ptr: [*]const f64,
    player_ys_ptr: [*]const f64,
    player_alive_ptr: [*]const u8,
    n_players: u32,
    owner_idx: i32,
    out_ptr: *StepResultV2,
) void {
    out_ptr.* = stepV2(
        state_ptr,
        dt_ms,
        statics_ptr[0..statics_count],
        player_xs_ptr[0..n_players],
        player_ys_ptr[0..n_players],
        player_alive_ptr[0..n_players],
        owner_idx,
    );
}

pub export fn sizeof_projectile_kinematics_v2() u32 {
    return @sizeOf(ProjectileKinematicsV2);
}

pub export fn sizeof_projectile_step_result_v2() u32 {
    return @sizeOf(StepResultV2);
}

// =================================================================
// Phase H1 — orchestration helpers operating on the WorldState
// extern struct's ProjectileEntity. These are the smallest pieces
// of the TS `stepProjectile` orchestrator we can lift to wasm
// without dragging in the player array, the events bus, or the
// spatial cache. They land here, not in world.zig, because they're
// pure projectile lifecycle decisions — the orchestrator (Phase I)
// will dispatch on their results.

/// Outcome of `projectile_pre_step`. The orchestrator dispatches
/// based on this before deciding to call step_projectile_v2.
pub const PreStepResult = enum(u8) {
    /// Run the v2 motion kernel as normal.
    advance = 0,
    /// Sticky fuse > 0; projectile holds position. Caller MUST keep
    /// it alive (no v2 step). `sticky_fuse_ms` and `age_ms` already
    /// decremented in place by this call.
    sticky_linger = 1,
    /// Sticky fuse expired this tick. Caller should despawn (after
    /// optionally spawning splits via `projectile_split_velocities`).
    sticky_expired = 2,
    /// Lifetime ran out this tick. Caller should despawn (after
    /// optionally spawning splits).
    lifetime_expired = 3,
};

/// Internal — pure decision logic. Mutates `proj` in place for the
/// linger case. Independent of wasm ABI so we can unit-test it from
/// Zig if we want.
pub fn projectilePreStep(
    proj: *world_state.ProjectileEntity,
    dt_ms: f64,
) PreStepResult {
    if (proj.flags.has_sticky_fuse and proj.sticky_fuse_ms > 0) {
        const fuse = proj.sticky_fuse_ms - dt_ms;
        if (fuse > 0) {
            proj.sticky_fuse_ms = fuse;
            if (proj.flags.has_age) {
                proj.age_ms += dt_ms;
            }
            return .sticky_linger;
        }
        return .sticky_expired;
    }
    const remaining = proj.lifetime_ms - dt_ms;
    if (remaining <= 0) {
        return .lifetime_expired;
    }
    return .advance;
}

pub export fn projectile_pre_step(
    proj_ptr: *world_state.ProjectileEntity,
    dt_ms: f64,
) u8 {
    return @intFromEnum(projectilePreStep(proj_ptr, dt_ms));
}

/// Output of split-velocity computation. The orchestrator
/// materialises children using parent.x/y + these velocities.
pub const SplitVelocity = extern struct {
    vx: f64,
    vy: f64,
    angle: f64,
};

/// Compute the velocity fan for split children. Bit-exact mirror of
/// `spawnSplit` in client/src/sim/projectile.ts. Returns the new
/// RNG state (caller threads it through subsequent splits).
pub fn projectileSplitVelocities(
    parent: *const world_state.ProjectileEntity,
    rng_in: u32,
    out: []SplitVelocity,
) struct { rng_state: u32, count: u32 } {
    const raw_count: u32 = if (parent.flags.has_split) parent.split_count else 0;
    const split_count: u32 = @min(raw_count, SPLIT_MAX);
    if (split_count == 0) {
        return .{ .rng_state = rng_in, .count = 0 };
    }
    const cap: u32 = @intCast(out.len);
    const emit_count: u32 = @min(split_count, cap);

    const speed = @sqrt(parent.vx * parent.vx + parent.vy * parent.vy);
    const base_angle: f64 = if (speed > 0)
        trig.lutAtan2(parent.vy, parent.vx)
    else
        0;

    var state = rng_in;
    var i: u32 = 0;
    while (i < emit_count) : (i += 1) {
        const t: f64 = if (split_count == 1)
            0.5
        else
            @as(f64, @floatFromInt(i)) /
                @as(f64, @floatFromInt(split_count - 1));
        // Per-shard rng jitter — mirrors `nextFloat` in TS.
        state = rng.nextU32(state);
        const jitter: f64 = @as(f64, @floatFromInt(state)) / 4294967296.0;
        const angle = base_angle - SPLIT_SPREAD / 2.0 +
            SPLIT_SPREAD * t + (jitter - 0.5) * 0.06;
        const child_speed = @max(SPLIT_SPEED_MIN, speed * SPLIT_SPEED_SCALE);
        out[i] = .{
            .vx = trig.lutCos(angle) * child_speed,
            .vy = trig.lutSin(angle) * child_speed,
            .angle = angle,
        };
    }
    return .{ .rng_state = state, .count = emit_count };
}

/// Wasm export. Returns packed u64: hi 32 = new RNG state, lo 32 =
/// number of velocity entries written. The host caps `out_cap` at
/// SPLIT_MAX (= 8); higher caps are truncated.
pub export fn projectile_split_velocities(
    parent_ptr: *const world_state.ProjectileEntity,
    rng_in: u32,
    out_ptr: [*]SplitVelocity,
    out_cap: u32,
) u64 {
    const result = projectileSplitVelocities(
        parent_ptr,
        rng_in,
        out_ptr[0..out_cap],
    );
    const hi: u64 = @as(u64, @intCast(result.rng_state)) << 32;
    const lo: u64 = @as(u64, @intCast(result.count));
    return hi | lo;
}

pub export fn projectile_sticky_fuse_default_ms() f64 {
    return STICKY_FUSE_MS;
}

pub export fn projectile_split_max() u32 {
    return SPLIT_MAX;
}

pub export fn sizeof_split_velocity() u32 {
    return @sizeOf(SplitVelocity);
}
