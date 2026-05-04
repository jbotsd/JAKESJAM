//! Combat math primitives — bit-exact port of the kernel ops in
//! `client/src/sim/combat.ts`. Phase F1d (ADR-0006).
//!
//! Scope: parry-arc cosine check, shield drain/recharge math, angle
//! wrap helper. The orchestration (state-machine for parry timing,
//! deflection event emission) stays TS-side — those are control
//! flow + entity bookkeeping, not float math.

const std = @import("std");
const trig = @import("trig.zig");

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;

/// Parry arc — full angular width within which incoming shards
/// can be deflected. Mirrors `combat.ts` `PARRY_ARC_RADIANS = π/3`.
pub const PARRY_ARC_RADIANS: f64 = PI / 3.0;

/// Wrap an angle into [-π, π). Matches `combat.ts` `wrapAngle`.
pub fn wrapAngle(angle: f64) f64 {
    var a = angle;
    while (a < -PI) a += TWO_PI;
    while (a >= PI) a -= TWO_PI;
    return a;
}

/// True if a projectile incoming from `(proj_x, proj_y)` (with
/// fallback velocity `(proj_vx, proj_vy)` when the projectile is
/// at the player center) lies within the parry arc centered on
/// `facing`.
///
/// Bit-exact port of `combat.ts` `isHitInParryArc`. Uses the
/// comptime LUT for atan2.
pub fn isHitInParryArc(
    player_x: f64,
    player_y: f64,
    facing: f64,
    proj_x: f64,
    proj_y: f64,
    proj_vx: f64,
    proj_vy: f64,
) bool {
    const dx = proj_x - player_x;
    const dy = proj_y - player_y;
    const source_angle = if (dx == 0.0 and dy == 0.0)
        trig.lutAtan2(-proj_vy, -proj_vx)
    else
        trig.lutAtan2(dy, dx);
    const delta = wrapAngle(source_angle - facing);
    return @abs(delta) <= PARRY_ARC_RADIANS / 2.0;
}

/// Shield drain over a tick: `dps * (dt_ms / 1000)`. Pure float
/// arithmetic; identical bits across IEEE 754 hosts.
pub fn shieldDrain(drain_per_second: f64, dt_ms: f64) f64 {
    return drain_per_second * (dt_ms / 1000.0);
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn combat_wrap_angle(angle: f64) f64 {
    return wrapAngle(angle);
}

pub export fn combat_is_hit_in_parry_arc(
    player_x: f64,
    player_y: f64,
    facing: f64,
    proj_x: f64,
    proj_y: f64,
    proj_vx: f64,
    proj_vy: f64,
) i32 {
    return if (isHitInParryArc(player_x, player_y, facing, proj_x, proj_y, proj_vx, proj_vy)) 1 else 0;
}

pub export fn combat_shield_drain(drain_per_second: f64, dt_ms: f64) f64 {
    return shieldDrain(drain_per_second, dt_ms);
}

pub export fn combat_parry_arc_radians() f64 {
    return PARRY_ARC_RADIANS;
}
