//! Per-satellite tick kernel — bit-exact port of the orbit math
//! in `client/src/sim/satellite.ts`. Phase F1c (ADR-0006).
//!
//! Scope: per-tick orbit advance + cooldown decay + lifetime tick
//! + fire-decision math (compute world position from angle, atan2
//! aim toward target). Caller (TS) handles iteration, owner +
//! target lookup, projectile insertion.
//!
//! Trig uses the comptime LUT in `trig.zig` so satellite math is
//! bit-identical to the TS-side `lutCos/lutSin/lutAtan2` impls
//! (which read the SAME LUT bytes from wasm memory at boot).

const std = @import("std");
const trig = @import("trig.zig");
const world_state = @import("world_state.zig");

/// Constants mirror `client/src/sim/satellite.ts`.
pub const ORBIT_RAD_PER_SEC: f64 = 3.141592653589793 / 1.5; // π/1.5
pub const SATELLITE_FIRE_COOLDOWN_MS: f64 = 600.0;

pub const TickInput = extern struct {
    angle: f64,
    orbit_radius: f64,
    fire_cooldown_ms: f64,
    lifetime_ms: f64,
    owner_x: f64,
    owner_y: f64,
    target_x: f64,
    target_y: f64,
    /// 1 = target valid, 0 = no live target this tick
    has_target: i32,
    /// 1 = round phase is "fighting", else 0
    can_fire: i32,
    dt_ms: f64,
};

pub const TickOutput = extern struct {
    /// Updated state (caller writes back into the satellite entity).
    new_angle: f64,
    new_fire_cooldown_ms: f64,
    new_lifetime_ms: f64,
    /// Spawn coordinates if `wants_fire` is set.
    fire_x: f64,
    fire_y: f64,
    fire_aim_angle: f64,
    /// 1 = caller should despawn this satellite (lifetime expired).
    expired: i32,
    /// 1 = caller should spawn a projectile this tick using fire_*
    /// fields.
    wants_fire: i32,
};

pub fn tickSatellite(in: TickInput) TickOutput {
    var out: TickOutput = .{
        .new_angle = in.angle,
        .new_fire_cooldown_ms = in.fire_cooldown_ms,
        .new_lifetime_ms = in.lifetime_ms,
        .fire_x = 0,
        .fire_y = 0,
        .fire_aim_angle = 0,
        .expired = 0,
        .wants_fire = 0,
    };

    // Lifetime: Infinity stays Infinity (Inf - finite = Inf).
    const remaining = in.lifetime_ms - in.dt_ms;
    if (remaining <= 0.0) {
        out.expired = 1;
        return out;
    }
    out.new_lifetime_ms = remaining;

    const dt_sec = in.dt_ms / 1000.0;

    // Advance orbit angle.
    out.new_angle = in.angle + ORBIT_RAD_PER_SEC * dt_sec;

    // Tick fire cooldown (clamp at 0).
    const cooldown = in.fire_cooldown_ms - in.dt_ms;
    out.new_fire_cooldown_ms = if (cooldown < 0.0) 0.0 else cooldown;

    // Try to fire.
    if (out.new_fire_cooldown_ms <= 0.0 and in.can_fire == 1 and in.has_target == 1) {
        const sx = in.owner_x + trig.lutCos(out.new_angle) * in.orbit_radius;
        const sy = in.owner_y + trig.lutSin(out.new_angle) * in.orbit_radius;
        out.fire_x = sx;
        out.fire_y = sy;
        out.fire_aim_angle = trig.lutAtan2(in.target_y - sy, in.target_x - sx);
        out.new_fire_cooldown_ms = SATELLITE_FIRE_COOLDOWN_MS;
        out.wants_fire = 1;
    }

    return out;
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn satellite_tick(
    in_ptr: *const TickInput,
    out_ptr: *TickOutput,
) void {
    out_ptr.* = tickSatellite(in_ptr.*);
}

pub export fn sizeof_satellite_tick_input() u32 {
    return @sizeOf(TickInput);
}

pub export fn sizeof_satellite_tick_output() u32 {
    return @sizeOf(TickOutput);
}

pub export fn satellite_orbit_rad_per_sec() f64 {
    return ORBIT_RAD_PER_SEC;
}

pub export fn satellite_fire_cooldown_ms() f64 {
    return SATELLITE_FIRE_COOLDOWN_MS;
}

// =================================================================
// Phase H3 — orchestration helper operating on
// world_state.SatelliteEntity directly. Mutates angle/cooldown/
// lifetime in place; reads owner+target from caller-supplied
// floats (looked up from the Players array externally).

pub fn satelliteTickWorld(
    sat: *world_state.SatelliteEntity,
    owner_x: f64,
    owner_y: f64,
    target_x: f64,
    target_y: f64,
    has_target: u8,
    can_fire: u8,
    dt_ms: f64,
) TickOutput {
    const tick_in = TickInput{
        .angle = sat.angle,
        .orbit_radius = sat.orbit_radius,
        .fire_cooldown_ms = sat.fire_cooldown_ms,
        .lifetime_ms = sat.lifetime_ms,
        .owner_x = owner_x,
        .owner_y = owner_y,
        .target_x = target_x,
        .target_y = target_y,
        .has_target = @intCast(has_target),
        .can_fire = @intCast(can_fire),
        .dt_ms = dt_ms,
    };
    const out = tickSatellite(tick_in);
    sat.angle = out.new_angle;
    sat.fire_cooldown_ms = out.new_fire_cooldown_ms;
    sat.lifetime_ms = out.new_lifetime_ms;
    return out;
}

pub export fn satellite_tick_world(
    sat_ptr: *world_state.SatelliteEntity,
    owner_x: f64,
    owner_y: f64,
    target_x: f64,
    target_y: f64,
    has_target: u32,
    can_fire: u32,
    dt_ms: f64,
    out_ptr: *TickOutput,
) void {
    out_ptr.* = satelliteTickWorld(
        sat_ptr,
        owner_x,
        owner_y,
        target_x,
        target_y,
        @intCast(has_target),
        @intCast(can_fire),
        dt_ms,
    );
}
