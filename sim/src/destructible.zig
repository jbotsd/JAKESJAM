//! Destructible math primitives — bit-exact port of the kernel
//! ops in `client/src/sim/destructible.ts`. Phase F1e (ADR-0006).
//!
//! Scope: HP damage application, blast-radius squared-distance
//! check, center→AABB conversion. The orchestration (entity
//! dictionary mutation, event emission, fire-patch spawn requests)
//! stays TS — that's bookkeeping, not float math.

const std = @import("std");
const collision = @import("collision.zig");
const world_state = @import("world_state.zig");

// Phase H5 — orchestration constants. Mirror
// `client/src/sim/destructible.ts` exactly.
pub const EXPLOSION_RADIUS: f64 = 80.0;
pub const EXPLOSION_DAMAGE: f64 = 28.0;
pub const FIRE_PATCH_DEFAULT_LIFETIME_MS: f64 = 1800.0;
pub const FIRE_PATCH_DEFAULT_RADIUS: f64 = 36.0;
pub const FIRE_PATCH_DEFAULT_DPS: f64 = 14.0;

/// Apply damage to an HP value, clamped at 0.
/// Matches `Math.max(0, hp - damage)`.
pub fn applyDamage(hp: f64, damage: f64) f64 {
    const next = hp - damage;
    return if (next < 0.0) 0.0 else next;
}

/// True if a player at `(px, py)` with bounding radius
/// `player_radius` overlaps a blast circle at `(cx, cy)` of radius
/// `blast_radius`. Squared-distance comparison — no sqrt.
///
/// Mirrors `client/src/sim/destructible.ts` `alivePlayersInRadius`
/// inner test:
///   dx*dx + dy*dy <= (radius + PLAYER_RADIUS) ** 2
pub fn playerInBlastRadius(
    cx: f64,
    cy: f64,
    blast_radius: f64,
    px: f64,
    py: f64,
    player_radius: f64,
) bool {
    const dx = px - cx;
    const dy = py - cy;
    const total_radius = blast_radius + player_radius;
    return dx * dx + dy * dy <= total_radius * total_radius;
}

/// Center-origin → top-left AABB. Matches `centerToAABB(cx, cy, w, h)`.
pub fn centerToAABB(cx: f64, cy: f64, w: f64, h: f64) collision.AABB {
    return .{
        .x = cx - w / 2.0,
        .y = cy - h / 2.0,
        .w = w,
        .h = h,
    };
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn destructible_apply_damage(hp: f64, damage: f64) f64 {
    return applyDamage(hp, damage);
}

pub export fn destructible_player_in_blast(
    cx: f64,
    cy: f64,
    blast_radius: f64,
    px: f64,
    py: f64,
    player_radius: f64,
) i32 {
    return if (playerInBlastRadius(cx, cy, blast_radius, px, py, player_radius)) 1 else 0;
}

pub export fn destructible_center_to_aabb(
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    out_ptr: *collision.AABB,
) void {
    out_ptr.* = centerToAABB(cx, cy, w, h);
}

// =================================================================
// Phase H5 — projectile-vs-destructible orchestration helper.
// Resolves a single projectile/destructible pair: overlap check,
// HP application, broken decision. Caller iterates the projectile
// × destructible cross product and wires events / fire spawns
// externally. Splitting it this way keeps the wasm side pure
// (no event allocation in linear memory) and lets the orchestrator
// in Phase I drive the iteration.

pub const HitResult = enum(u8) {
    no_overlap = 0,
    /// Projectile hit, destructible took damage but is still
    /// alive. Caller should remove the projectile.
    damaged = 1,
    /// Projectile hit, destructible health dropped to 0 this
    /// call. Caller emits `destructible-broken`, may emit AOE
    /// hits if `dest.flags & EXPLOSIVE`, may spawn a fire patch
    /// if `dest.flags & FLAMMABLE` and projectile element ==
    /// fire (element tag = 2 from world_state.ElementType).
    broken = 2,
};

pub fn resolveProjectileHit(
    proj: *const world_state.ProjectileEntity,
    dest: *world_state.DestructibleEntity,
) HitResult {
    if (dest.health <= 0) return .no_overlap;
    const aabb = centerToAABB(dest.x, dest.y, dest.width, dest.height);
    if (!collision.circleOverlapsAABB(proj.x, proj.y, proj.radius, aabb))
        return .no_overlap;
    dest.health = applyDamage(dest.health, proj.damage);
    return if (dest.health <= 0) .broken else .damaged;
}

pub export fn destructible_resolve_projectile_hit(
    proj_ptr: *const world_state.ProjectileEntity,
    dest_ptr: *world_state.DestructibleEntity,
) u8 {
    return @intFromEnum(resolveProjectileHit(proj_ptr, dest_ptr));
}

pub export fn destructible_explosion_radius() f64 {
    return EXPLOSION_RADIUS;
}

pub export fn destructible_explosion_damage() f64 {
    return EXPLOSION_DAMAGE;
}

pub export fn destructible_fire_patch_default_lifetime_ms() f64 {
    return FIRE_PATCH_DEFAULT_LIFETIME_MS;
}

pub export fn destructible_fire_patch_default_radius() f64 {
    return FIRE_PATCH_DEFAULT_RADIUS;
}

pub export fn destructible_fire_patch_default_dps() f64 {
    return FIRE_PATCH_DEFAULT_DPS;
}
