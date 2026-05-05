//! JAKESJAM-specific data — chaos modifier definitions.
//!
//! Mirror of `client/src/sim/data/chaosModifiers.ts`. Lives in
//! `sim/src/data/` per the package-boundary discipline:
//! game-agnostic core sim modules MUST NOT import from this
//! directory; only the orchestrator (`world.zig`) does.
//!
//! The orchestrator passes a packed bitmask of active chaos
//! modifier ids into `step_world` (Phase H8); the bitmask
//! resolves into a `ChaosProfile` via `chaosProfileFromMask`,
//! and every per-tick effect (gravity, time-scale, damage,
//! fire-rate, recoil, projectile shape randomisation, fire
//! hazard interval) is composed multiplicatively / OR-wise.

const std = @import("std");

/// Chaos modifier id tag — the bit position in the `mask` u32
/// passed to `chaosProfileFromMask` corresponds to this enum
/// value. Order MUST match `CHAOS_MODIFIER_IDS` in
/// `client/src/sim/data/chaosModifiers.ts` so the TS↔wasm
/// bridge maps array index → bit slot deterministically.
pub const ChaosModifierId = enum(u32) {
    low_gravity = 0,
    slow_motion = 1,
    golden_gun = 2,
    slappers_only = 3,
    fire_hazard = 4,
    random_shapes = 5,
    max_recoil = 6,
};

/// Resolved per-tick chaos effect bundle. Multiplicatively
/// composed across the active modifiers. Booleans OR-ed.
/// `fire_hazard_interval_ms` is the smallest defined interval
/// among active modifiers (only `fire_hazard` sets it today);
/// 0 means no fire hazard active.
pub const ChaosProfile = extern struct {
    gravity_multiplier: f64,
    time_scale: f64,
    damage_multiplier: f64,
    fire_rate_multiplier: f64,
    recoil_multiplier: f64,
    fire_hazard_interval_ms: f64,
    disable_projectiles: u8,
    random_shapes: u8,
    fire_hazard_active: u8,
    _pad: [5]u8 = .{ 0, 0, 0, 0, 0 },
};

const ChaosModifierDef = struct {
    id: ChaosModifierId,
    gravity_multiplier: f64 = 1.0,
    time_scale: f64 = 1.0,
    damage_multiplier: f64 = 1.0,
    fire_rate_multiplier: f64 = 1.0,
    recoil_multiplier: f64 = 1.0,
    disable_projectiles: bool = false,
    random_shapes: bool = false,
    fire_hazard_interval_ms: f64 = 0.0, // 0 = no hazard
};

const CHAOS_TABLE = [_]ChaosModifierDef{
    .{ .id = .low_gravity, .gravity_multiplier = 0.46 },
    .{ .id = .slow_motion, .time_scale = 0.55 },
    .{ .id = .golden_gun, .damage_multiplier = 9.0, .fire_rate_multiplier = 0.28, .recoil_multiplier = 1.8 },
    .{ .id = .slappers_only, .disable_projectiles = true, .recoil_multiplier = 2.8 },
    .{ .id = .fire_hazard, .fire_hazard_interval_ms = 2400.0 },
    .{ .id = .random_shapes, .random_shapes = true },
    .{ .id = .max_recoil, .recoil_multiplier = 3.6 },
};

pub const NEUTRAL_PROFILE = ChaosProfile{
    .gravity_multiplier = 1.0,
    .time_scale = 1.0,
    .damage_multiplier = 1.0,
    .fire_rate_multiplier = 1.0,
    .recoil_multiplier = 1.0,
    .fire_hazard_interval_ms = 0.0,
    .disable_projectiles = 0,
    .random_shapes = 0,
    .fire_hazard_active = 0,
};

/// Resolve a u32 bitmask of active chaos modifiers into a single
/// per-tick effect profile. Bit N corresponds to
/// `ChaosModifierId` value N. Empty mask → NEUTRAL_PROFILE.
pub fn chaosProfileFromMask(mask: u32) ChaosProfile {
    if (mask == 0) return NEUTRAL_PROFILE;

    var p = NEUTRAL_PROFILE;
    var fire_hazard_min: f64 = -1.0; // -1 = unset (zig has no Optional<f64> in extern)

    inline for (CHAOS_TABLE) |def| {
        const bit: u32 = @as(u32, 1) << @intCast(@intFromEnum(def.id));
        if ((mask & bit) != 0) {
            p.gravity_multiplier *= def.gravity_multiplier;
            p.time_scale *= def.time_scale;
            p.damage_multiplier *= def.damage_multiplier;
            p.fire_rate_multiplier *= def.fire_rate_multiplier;
            p.recoil_multiplier *= def.recoil_multiplier;
            if (def.disable_projectiles) p.disable_projectiles = 1;
            if (def.random_shapes) p.random_shapes = 1;
            if (def.fire_hazard_interval_ms > 0) {
                p.fire_hazard_active = 1;
                if (fire_hazard_min < 0 or
                    def.fire_hazard_interval_ms < fire_hazard_min)
                {
                    fire_hazard_min = def.fire_hazard_interval_ms;
                }
            }
        }
    }
    if (fire_hazard_min > 0) p.fire_hazard_interval_ms = fire_hazard_min;
    return p;
}

// =================================================================
// Wasm exports.

pub export fn chaos_profile_from_mask(
    mask: u32,
    out_ptr: *ChaosProfile,
) void {
    out_ptr.* = chaosProfileFromMask(mask);
}

pub export fn sizeof_chaos_profile() u32 {
    return @sizeOf(ChaosProfile);
}

pub export fn chaos_modifier_count() u32 {
    return CHAOS_TABLE.len;
}
