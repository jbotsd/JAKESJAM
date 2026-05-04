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
