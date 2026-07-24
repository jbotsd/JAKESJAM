// Phase 97 — encode `ResolvedWeaponBuild` (TS shape, computed by
// `createWeaponBuild` from the player's cards + base weapon) into
// the byte-stable `ResolvedFireConfigBytes` shape WasmHost writes
// at `player_fire_config[i]`. The wasm sim's I21 fire branch
// reads from there each tick when `valid=1`; without this, every
// player fires bare starter pistol (the cards-don't-apply bug).
//
// Field order + encoding mirrors `ResolvedFireConfig` in
// sim/src/world_state.zig (line 359). Enum tags use the order
// declared by the wasm-side u8 enums: see
// `client/src/sim/wasm/worldStateBridge.ts` PROJECTILE_PATHINGS /
// ELEMENT_TYPES / PROJECTILE_IMPACTS / PROJECTILE_SHAPES tables.

import type { ResolvedWeaponBuild } from "./cardTypes.js";
import type { ResolvedFireConfigBytes } from "../wasm/wasmHost.js";

// Mirrors the u8 enum order in sim/src/world_state.zig.
const PATHING_INDEX: Record<string, number> = {
  straight: 0,
  gravity: 1,
  bounce: 2,
  boomerang: 3,
  homing: 4,
  "anti-homing": 5,
  float: 6,
  accelerate: 7,
};
const ELEMENT_INDEX: Record<string, number> = {
  crystal: 0,
  neutral: 1,
  fire: 2,
  ice: 3,
  lightning: 4,
  void: 5,
  radiant: 6,
  electric: 7,
  toxic: 8,
  sticky: 9,
  explosive: 10,
};
const IMPACT_INDEX: Record<string, number> = {
  none: 0,
  explosive: 1,
  sticky: 2,
  "pierce-chain": 3,
  "slow-field": 4,
};
const SHAPE_INDEX: Record<string, number> = {
  circle: 0,
  triangle: 1,
  square: 2,
  hexagon: 3,
  orb: 4,
  x: 5,
  bar: 6,
};
// Mirrors cards_gen.zig's CardMod.delivery ordinals (gen_card_data.ts's
// DELIVERY array order) — the same enum world_state.zig's appended
// `ResolvedFireConfig.delivery` field (Track Z1c item 1) uses.
const DELIVERY_INDEX: Record<string, number> = {
  projectile: 0,
  raycast: 1,
  "continuous-beam": 2,
  "area-pulse": 3,
};

/**
 * Convert a resolved weapon build (cards already applied) into the
 * byte-stable bag of numbers WasmHost will splat into wasm memory.
 *
 * Defensive defaults: if a field is undefined / out-of-range, fall
 * back to a reasonable starter-pistol-like value rather than NaN.
 */
export function packResolvedFireConfig(
  build: ResolvedWeaponBuild,
): ResolvedFireConfigBytes {
  const p = build.projectile;
  return {
    damage: build.damage,
    fireRate: build.fireRate,
    projectileSpeed: build.projectileSpeed,
    projectileLifetimeSeconds: build.projectileLifetimeSeconds,
    spreadRadians: build.spreadRadians,
    rangePx: p.rangePx,
    homingStrength: p.homingStrength ?? 0,
    accelerationMultiplier: p.accelerationMultiplier ?? 0,
    gravityScale: p.gravityScale ?? 0,
    slowMultiplier: p.slowMultiplier ?? 1,
    impactRadiusPx: p.impactRadiusPx ?? 0,
    sizeMultiplier: p.sizeMultiplier ?? 1,
    speedMultiplier: p.speedMultiplier ?? 1,
    lifetimeMultiplier: p.lifetimeMultiplier ?? 1,
    projectileCount: Math.max(1, p.count ?? 1),
    bounces: Math.max(0, p.bounces ?? 0),
    pierceCount: Math.max(0, p.pierceCount ?? 0),
    splitCount: Math.max(0, p.splitCount ?? 0),
    shapeIdx: SHAPE_INDEX[p.shape] ?? 0,
    elementIdx: ELEMENT_INDEX[p.element] ?? 1,
    pathingIdx: PATHING_INDEX[p.pathing] ?? 0,
    impactIdx: IMPACT_INDEX[p.impact ?? "none"] ?? 0,
    moveSpeedMultiplier: build.moveSpeedMultiplier,
    gravityMultiplier: build.gravityMultiplier,
    jumpMultiplier: build.jumpMultiplier,
    wallJumpMultiplier: build.wallJumpMultiplier,
    wallSlideMultiplier: build.wallSlideMultiplier,
    shieldChargeMultiplier: build.shieldChargeMultiplier,
    shieldRechargeMultiplier: build.shieldRechargeMultiplier,
    parryCoverMultiplier: build.parryCoverMultiplier,
    parryCooldownMultiplier: build.parryCooldownMultiplier,
    maxHealthAdd: build.maxHealthAdd,
    airJumps: build.airJumps,
    dashCharges: build.dashCharges,
    dashCooldownMultiplier: build.dashCooldownMultiplier,
    mirrorShield: build.mirrorShield ? 1 : 0,
    directionalShield: build.directionalShield ? 1 : 0,
    // Fully-resolved fire recoil (Track Z0c Item A) — the exact product
    // weapon.ts:600-604 computes from the build at fire time: clamped
    // build.recoilImpulse × the per-projectile recoilMultiplier channel.
    // Chaos / Recoil Step / chassis recoil-control stay fire-time terms on
    // both sides (see ResolvedFireConfig.recoil_impulse's Zig doc comment).
    recoilImpulse: build.recoilImpulse * (p.recoilMultiplier ?? 1),
    // Delivery identity (Track Z1c item 1) — already fully resolved by
    // createWeaponBuild by the time it reaches here (class-gated base seed
    // + card upgrades + THE GEOMETRICIAN RULING's post-loop wizard-forces-
    // raycast enforcement all happened upstream), so this is a pure enum
    // lookup, not a re-derivation. `?? 1` mirrors weapon_build.zig's
    // `StarterBase.delivery` fallback (raycast) for a build whose
    // `.delivery` somehow isn't one of the four known strings.
    delivery: DELIVERY_INDEX[build.delivery] ?? 1,
    // Passive Tithe leech (Track Z1c "six-axes axis payloads") — Stolen
    // Fangs' class-gated Priest reading, card-pool-v2.md "Tithe". Pure
    // pass-through of the already-resolved build field, same shape as
    // every other augment above. See world_state.zig's ResolvedFireConfig.
    // leech_fraction doc comment for the classModifiers-gap stopgap this
    // field depends on (fireConfigShared.ts patches it in separately since
    // Zig's own card codegen can't derive a classModifiers override).
    leechFraction: build.leechFraction,
  };
}
