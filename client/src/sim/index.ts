export * from './types.js';
export * from './constants.js';
export { World } from './World.js';
export {
  aabbOverlap,
  circleOverlapsAABB,
  circleHitsAnyCached,
  circleBounceCached,
  platformToAABB,
  centerToAABB,
  buildSpatialGrid,
  buildStaticCache,
  queryGrid,
  resolveMove,
  resolveMoveCached,
  sweepAABB,
  sweepAABBCached,
  pointInAABB,
  SPATIAL_CELL_SIZE,
} from './collision.js';
export type {
  AABB,
  SweepHit,
  SpatialGrid,
  StaticCollisionCache,
} from './collision.js';
// Constants (PARRY_*, SHIELD_*, ORBIT_*, SATELLITE_*, JETPACK_*,
// KILL_PLANE_MARGIN_PX, EXPLOSION_*, FIRE_PATCH_*) are exported via
// `export * from './constants.js'` above. Function exports below.
export {
  isHitInParryArc,
  isParryActive,
  tickShield,
  tryDeflectDamage,
  tryStartParry,
} from './combat.js';
export {
  stepDestructibles,
  buildFireEntity,
  destructibleAABB,
} from './destructible.js';
export type { SpawnedFireSpec, StepDestructiblesResult } from './destructible.js';
export { stepFirePatches } from './fire.js';
export type { StepFirePatchesResult } from './fire.js';
export {
  stepPickups,
  clearExpiredBuffs,
  OVERCHARGE_DURATION_MS,
  DAMAGE_AMP_MS,
  SPEED_BOOST_MS,
  MELEE_MODE_MS,
  SLOW_DEBUFF_MS,
  VULNERABILITY_MS,
  BLOCK_JAMMER_MS,
  BOSS_MODE_MS,
  DEFAULT_RESPAWN_MS,
  PLAYER_FOOTPRINT_RADIUS,
  SLOW_TRAP_MULTIPLIER,
  CARD_OFFER_COUNT,
} from './pickup.js';
export type {
  CardDefinition,
  CardId,
  CardVisualDefinition,
  ImpactBehavior,
  ProjectileModifier,
  ResolvedWeaponBuild,
  WeaponBucket,
  WeaponCardModifier,
  WeaponDefinition,
  WeaponDelivery,
  WeaponId,
} from './data/cardTypes.js';
export {
  applyCard,
  clampBuild,
  createWeaponBuild,
  findCardsById,
  mergeProjectileModifier,
} from './data/weaponBuild.js';
export { crystalRoundsCards, prototypeCards } from './data/cards.js';
export { starterWeapon, weapons } from './data/weapons.js';
export {
  hashPlayerEntity,
  hashProjectileEntity,
  hashWorldStateLite,
} from './hash.js';
export type { WorldHashLite } from './hash.js';
