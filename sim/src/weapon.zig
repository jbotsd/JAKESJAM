//! Weapon math primitives — bit-exact port of the kernel ops in
//! `client/src/sim/weapon.ts`. Phase F1b (ADR-0006).
//!
//! Scope: muzzle position math, recoil impulse, fire-rate cooldown
//! tick, per-shot spread offset. The full stepWeapon orchestration
//! (build resolution, chaos profile, projectile spawn) stays TS-side
//! because it depends on data tables + RNG threading + entity ID
//! allocation that don't have a clean wasm ABI.
//!
//! Trig flows through the comptime LUT in `trig.zig`. `@sqrt` in
//! Zig is IEEE 754 (deterministic across hosts).

const std = @import("std");
const trig = @import("trig.zig");
const world_state = @import("world_state.zig");

pub const MuzzlePosition = extern struct {
    x: f64,
    y: f64,
};

pub const RecoilImpulse = extern struct {
    /// Velocity delta to APPLY (caller does `vx += this.dvx`).
    dvx: f64,
    dvy: f64,
};

/// Compute where a projectile spawns relative to the player rig.
/// Aim direction × reach px from the player center. Matches
/// `playerMuzzlePosition` in weapon.ts byte-for-byte.
pub fn muzzlePosition(
    player_x: f64,
    player_y: f64,
    aim_x: f64,
    aim_y: f64,
    reach: f64,
) MuzzlePosition {
    const dx = aim_x - player_x;
    const dy = aim_y - player_y;
    const len_raw = @sqrt(dx * dx + dy * dy);
    // Match `|| 1` JS pattern: zero distance ⇒ unit length to avoid
    // divide-by-zero. `len_raw` is NaN-free for finite inputs.
    const len = if (len_raw == 0.0) 1.0 else len_raw;
    return .{
        .x = player_x + (dx / len) * reach,
        .y = player_y + (dy / len) * reach,
    };
}

/// Recoil impulse to subtract from player velocity.
/// Matches `weapon.ts`:
///   next.vx -= lutCos(baseAngle) * recoil
///   next.vy -= lutSin(baseAngle) * recoil * 0.45
pub fn recoilImpulse(base_angle: f64, recoil_strength: f64) RecoilImpulse {
    return .{
        .dvx = -(trig.lutCos(base_angle) * recoil_strength),
        .dvy = -(trig.lutSin(base_angle) * recoil_strength * 0.45),
    };
}

/// Tick fire cooldown. Match `Math.max(0, cooldown - dtMs)`.
pub fn tickCooldown(cooldown_ms: f64, dt_ms: f64) f64 {
    const next = cooldown_ms - dt_ms;
    return if (next < 0.0) 0.0 else next;
}

/// Per-shot angle offset for an N-projectile fan. Matches the
/// `i / (projectileCount - 1)` interpolation in weapon.ts.
/// `projectile_count` MUST be >= 1; caller is responsible for that
/// invariant (weapon.ts uses `Math.max(1, ...)`).
pub fn spreadOffset(
    projectile_count: u32,
    index: u32,
    total_spread: f64,
) f64 {
    if (projectile_count <= 1) return 0.0;
    // Match TS exactly: `-total / 2 + (total * i) / (n - 1)`.
    // The divisor MUST be applied AFTER the multiply or float
    // rounding diverges from V8's evaluation order.
    const i_f = @as(f64, @floatFromInt(index));
    const denom = @as(f64, @floatFromInt(projectile_count - 1));
    return -total_spread / 2.0 + (total_spread * i_f) / denom;
}

/// Cooldown derived from build.fireRate (shots/sec) clamped to a
/// floor. Matches `1000 / max(MIN_FIRE_RATE, fireRate * chaos)`.
pub fn cooldownFromFireRate(fire_rate: f64, min_fire_rate: f64) f64 {
    const clamped = if (fire_rate < min_fire_rate) min_fire_rate else fire_rate;
    return 1000.0 / clamped;
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn weapon_muzzle_position(
    player_x: f64,
    player_y: f64,
    aim_x: f64,
    aim_y: f64,
    reach: f64,
    out_ptr: *MuzzlePosition,
) void {
    out_ptr.* = muzzlePosition(player_x, player_y, aim_x, aim_y, reach);
}

pub export fn weapon_recoil(
    base_angle: f64,
    recoil_strength: f64,
    out_ptr: *RecoilImpulse,
) void {
    out_ptr.* = recoilImpulse(base_angle, recoil_strength);
}

pub export fn weapon_tick_cooldown(cooldown_ms: f64, dt_ms: f64) f64 {
    return tickCooldown(cooldown_ms, dt_ms);
}

pub export fn weapon_spread_offset(
    projectile_count: u32,
    index: u32,
    total_spread: f64,
) f64 {
    return spreadOffset(projectile_count, index, total_spread);
}

pub export fn weapon_cooldown_from_fire_rate(fire_rate: f64, min_fire_rate: f64) f64 {
    return cooldownFromFireRate(fire_rate, min_fire_rate);
}

pub export fn sizeof_muzzle_position() u32 {
    return @sizeOf(MuzzlePosition);
}

pub export fn sizeof_recoil_impulse() u32 {
    return @sizeOf(RecoilImpulse);
}

// =================================================================
// Phase H2 — fire-decision orchestration. Mutates PlayerEntity in
// place: tick fire_cooldown_ms down by dt_ms; if fire requested AND
// alive AND cooldown reached 0, set cooldown to the build-resolved
// post-fire cooldown and report fired=1. Caller spawns projectiles
// externally using the resolved-build data.

pub const FireDecision = extern struct {
    fired: u8,
    _pad: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },
};

const InputBitFire: u32 = 1 << 6;

/// Tick the player's fire cooldown and decide whether to fire this
/// tick. Caller computes `cooldown_after_fire_ms` from the resolved
/// weapon build (e.g. `weaponCooldownFromFireRate(fireRate, minRate)`)
/// — keeping data tables out of the core sim layer.
pub fn weaponTickFire(
    player: *world_state.PlayerEntity,
    fire_requested: bool,
    dt_ms: f64,
    cooldown_after_fire_ms: f64,
) FireDecision {
    const decremented = @max(0.0, player.fire_cooldown_ms - dt_ms);
    if (!fire_requested or !player.flags.alive or decremented > 0) {
        player.fire_cooldown_ms = decremented;
        return .{ .fired = 0 };
    }
    // Fire window opens. Reset cooldown for the next shot.
    player.fire_cooldown_ms = cooldown_after_fire_ms;
    return .{ .fired = 1 };
}

pub export fn weapon_tick_fire(
    player_ptr: *world_state.PlayerEntity,
    fire_requested: u32,
    dt_ms: f64,
    cooldown_after_fire_ms: f64,
    out_ptr: *FireDecision,
) void {
    out_ptr.* = weaponTickFire(
        player_ptr,
        fire_requested != 0,
        dt_ms,
        cooldown_after_fire_ms,
    );
}

/// Convenience: tick + check whether the Fire input bit is set in
/// the keys bitmask. Saves the host one wasm boundary call.
pub export fn weapon_tick_fire_with_keys(
    player_ptr: *world_state.PlayerEntity,
    keys: u32,
    dt_ms: f64,
    cooldown_after_fire_ms: f64,
    out_ptr: *FireDecision,
) void {
    out_ptr.* = weaponTickFire(
        player_ptr,
        (keys & InputBitFire) != 0,
        dt_ms,
        cooldown_after_fire_ms,
    );
}

pub export fn sizeof_fire_decision() u32 {
    return @sizeOf(FireDecision);
}
