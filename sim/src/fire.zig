//! Fire patch tick — bit-exact port of `client/src/sim/fire.ts`.
//!
//! Fire patches are AoE DoT zones spawned when a flammable
//! destructible breaks under fire damage. The per-patch tick is
//! pure arithmetic — only float ops are subtraction (lifetime
//! decay) and multiplication (damage = dps * dt). Both are bit-
//! deterministic in IEEE 754 across hosts; this port is for code
//! organisation completeness rather than to fix a host-divergence
//! bug. Keeping the impl in Zig lets D3 eventually delete the TS
//! orchestrator without losing the kernel.
//!
//! Phase F1e (ADR-0006). See docs/zig-wasm-migration.md.

const std = @import("std");
const collision = @import("collision.zig");
const world_state = @import("world_state.zig");

pub const FirePatch = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    remaining_ms: f64,
    damage_per_second: f64,
};

pub const TickResult = extern struct {
    /// New remaining_ms. <= 0 means the patch has burnt out.
    new_remaining_ms: f64,
    /// 1 = patch is alive after this tick, 0 = expired
    alive: i32,
    _pad: i32 = 0,
};

/// Tick a single fire patch. Decrement `remaining_ms` by `dt_ms`.
/// Returns the new lifetime + alive flag. Does NOT decide which
/// players got hit — caller iterates players + computes damage via
/// `firePatchHitsPlayer` or `firePatchDamage`.
pub fn tickFirePatch(remaining_ms: f64, dt_ms: f64) TickResult {
    const next = remaining_ms - dt_ms;
    return .{
        .new_remaining_ms = next,
        .alive = if (next > 0.0) 1 else 0,
    };
}

/// Damage a fire patch deals over a tick: `dps * (dt_ms / 1000)`.
/// Pure float arithmetic; identical bits across IEEE 754 hosts.
pub fn firePatchDamage(damage_per_second: f64, dt_ms: f64) f64 {
    return damage_per_second * (dt_ms / 1000.0);
}

/// Returns whether a fire patch overlaps a player AABB. Uses the
/// patch's bounding-box AABB (not strict circle) — matches
/// `client/src/sim/fire.ts` exactly so cheap broad-phase parity
/// holds.
pub fn firePatchHitsPlayerAABB(
    patch: FirePatch,
    player_aabb: collision.AABB,
) bool {
    const patch_aabb = collision.AABB{
        .x = patch.x - patch.radius,
        .y = patch.y - patch.radius,
        .w = patch.radius * 2.0,
        .h = patch.radius * 2.0,
    };
    return (patch_aabb.x < player_aabb.x + player_aabb.w) and
        (patch_aabb.x + patch_aabb.w > player_aabb.x) and
        (patch_aabb.y < player_aabb.y + player_aabb.h) and
        (patch_aabb.y + patch_aabb.h > player_aabb.y);
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn fire_patch_tick(
    remaining_ms: f64,
    dt_ms: f64,
    out_ptr: *TickResult,
) void {
    out_ptr.* = tickFirePatch(remaining_ms, dt_ms);
}

pub export fn fire_patch_damage(damage_per_second: f64, dt_ms: f64) f64 {
    return firePatchDamage(damage_per_second, dt_ms);
}

pub export fn fire_patch_hits_player(
    patch_x: f64,
    patch_y: f64,
    patch_radius: f64,
    player_x: f64,
    player_y: f64,
    player_w: f64,
    player_h: f64,
) i32 {
    const patch = FirePatch{
        .x = patch_x,
        .y = patch_y,
        .radius = patch_radius,
        .remaining_ms = 0,
        .damage_per_second = 0,
    };
    const player_aabb = collision.AABB{
        .x = player_x,
        .y = player_y,
        .w = player_w,
        .h = player_h,
    };
    return if (firePatchHitsPlayerAABB(patch, player_aabb)) 1 else 0;
}

pub export fn sizeof_fire_patch_tick_result() u32 {
    return @sizeOf(TickResult);
}

// =================================================================
// Phase H6 — orchestration helpers operating on FireEntity from
// the WorldState extern struct. Mutate in place; caller iterates
// fires × players for hit emission.

/// Tick a fire patch in place. Returns 1 if alive, 0 if expired.
pub fn fireEntityTick(fire: *world_state.FireEntity, dt_ms: f64) i32 {
    const next = fire.remaining_ms - dt_ms;
    fire.remaining_ms = next;
    return if (next > 0.0) 1 else 0;
}

pub export fn fire_patch_tick_world(
    fire_ptr: *world_state.FireEntity,
    dt_ms: f64,
) i32 {
    return fireEntityTick(fire_ptr, dt_ms);
}

/// True if a fire patch overlaps a player's AABB. Owner-self
/// avoidance is the orchestrator's responsibility (compare
/// `fire.owner_id_bytes` to the player's id externally).
pub fn fireEntityHitsPlayerAABB(
    fire: *const world_state.FireEntity,
    player_x: f64,
    player_y: f64,
    player_w: f64,
    player_h: f64,
) bool {
    const patch = FirePatch{
        .x = fire.x,
        .y = fire.y,
        .radius = fire.radius,
        .remaining_ms = fire.remaining_ms,
        .damage_per_second = fire.damage_per_second,
    };
    const player_aabb = collision.AABB{
        .x = player_x,
        .y = player_y,
        .w = player_w,
        .h = player_h,
    };
    return firePatchHitsPlayerAABB(patch, player_aabb);
}

pub export fn fire_patch_hits_player_world(
    fire_ptr: *const world_state.FireEntity,
    player_x: f64,
    player_y: f64,
    player_w: f64,
    player_h: f64,
) i32 {
    return if (fireEntityHitsPlayerAABB(fire_ptr, player_x, player_y, player_w, player_h)) 1 else 0;
}
