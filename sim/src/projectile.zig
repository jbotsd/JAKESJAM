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
