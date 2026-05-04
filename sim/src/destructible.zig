//! Destructible math primitives — bit-exact port of the kernel
//! ops in `client/src/sim/destructible.ts`. Phase F1e (ADR-0006).
//!
//! Scope: HP damage application, blast-radius squared-distance
//! check, center→AABB conversion. The orchestration (entity
//! dictionary mutation, event emission, fire-patch spawn requests)
//! stays TS — that's bookkeeping, not float math.

const std = @import("std");
const collision = @import("collision.zig");

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
