//! JAKESJAM-specific data — base weapon definitions.
//!
//! Mirror of `client/src/sim/data/weapons.ts`. Lives in
//! `sim/src/data/` per the package-boundary discipline.
//!
//! Today the table holds one entry (`starter-pistol`). The
//! exports give the orchestrator a way to look up base weapon
//! stats by id without re-marshaling the TS data through the
//! wire on every tick.

const std = @import("std");
const world_state = @import("../world_state.zig");

pub const WeaponId = enum(u32) {
    starter_pistol = 0,
};

/// Base weapon stats. Mirrors `WeaponDefinition` in
/// client/src/sim/data/cardTypes.ts (the fields the sim layer
/// actually consumes — the rest are render / UI only).
pub const WeaponBase = extern struct {
    damage: f64,
    fire_rate: f64,
    projectile_speed: f64,
    projectile_lifetime_seconds: f64,
    spread_radians: f64,
    recoil_impulse: f64,
    knockback_impulse: f64,
    projectile_count: u32,
    projectile_range_px: f64,
    projectile_size_multiplier: f64,
    projectile_speed_multiplier: f64,
    projectile_lifetime_multiplier: f64,
    projectile_gravity_scale: f64,
    projectile_homing_strength: f64,
    projectile_acceleration_multiplier: f64,
    projectile_slow_multiplier: f64,
    projectile_impact_radius_px: f64,
    projectile_bounces: u32,
    projectile_pierce_count: u32,
    projectile_split_count: u32,
    projectile_shape: world_state.ProjectileShape,
    projectile_element: world_state.ElementType,
    projectile_pathing: world_state.ProjectilePathing,
    projectile_impact: world_state.ProjectileImpact,
    weapon_id: WeaponId,
};

const STARTER_PISTOL = WeaponBase{
    // Mirrors client/src/sim/data/weapons.ts: bumped 10->12 (balance audit,
    // snappier round-1 pre-card TTK). projectile_speed speed-bump attempt
    // REVERTED (2026-07-20) — see weapons.ts's own doc comment: every value
    // tried above 650 broke a real collision test identically, not a
    // gradual risk. Left at the known-good 650 pending a real investigation.
    .damage = 12.0,
    .fire_rate = 4.0,
    .projectile_speed = 650.0,
    .projectile_lifetime_seconds = 1.2,
    .spread_radians = 0.03,
    .recoil_impulse = 95.0,
    .knockback_impulse = 120.0,
    .projectile_count = 1,
    .projectile_range_px = 720.0,
    .projectile_size_multiplier = 1.0,
    .projectile_speed_multiplier = 1.0,
    .projectile_lifetime_multiplier = 1.0,
    .projectile_gravity_scale = 0.0,
    .projectile_homing_strength = 0.0,
    .projectile_acceleration_multiplier = 0.0,
    .projectile_slow_multiplier = 1.0,
    .projectile_impact_radius_px = 0.0,
    .projectile_bounces = 0,
    .projectile_pierce_count = 0,
    .projectile_split_count = 0,
    .projectile_shape = .hexagon,
    .projectile_element = .crystal,
    .projectile_pathing = .straight,
    .projectile_impact = .none,
    .weapon_id = .starter_pistol,
};

const WEAPONS = [_]WeaponBase{
    STARTER_PISTOL,
};

pub fn weaponBaseById(id: WeaponId) WeaponBase {
    return WEAPONS[@intFromEnum(id)];
}

// =================================================================
// Wasm exports.

pub export fn weapon_base_by_id(id: u32, out_ptr: *WeaponBase) void {
    if (id >= WEAPONS.len) {
        out_ptr.* = STARTER_PISTOL; // safe fallback
        return;
    }
    out_ptr.* = WEAPONS[id];
}

pub export fn weapon_count() u32 {
    return WEAPONS.len;
}

pub export fn sizeof_weapon_base() u32 {
    return @sizeOf(WeaponBase);
}
