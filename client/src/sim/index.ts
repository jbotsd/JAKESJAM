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
export {
  PARRY_ACTIVE_MS,
  PARRY_COOLDOWN_MS_DEFAULT,
  PARRY_ARC_RADIANS,
  SHIELD_MAX_CHARGE_DEFAULT,
  SHIELD_DRAIN_PER_SECOND,
  SHIELD_RECHARGE_PER_SECOND,
  SHIELD_HIT_DRAIN_MULTIPLIER,
  isHitInParryArc,
  isParryActive,
  tickShield,
  tryDeflectDamage,
  tryStartParry,
} from './combat.js';
export {
  ORBIT_RADIUS_PX,
  ORBIT_RAD_PER_SEC,
  SATELLITE_FIRE_COOLDOWN_MS,
  SATELLITE_DAMAGE,
  SATELLITE_PROJECTILE_SPEED,
  SATELLITE_PROJECTILE_LIFETIME_MS,
  SATELLITE_PROJECTILE_RADIUS,
} from './satellite.js';
export {
  JETPACK_MAX_FUEL,
  JETPACK_THRUST,
  JETPACK_FUEL_DRAIN_PER_SECOND,
  JETPACK_GROUND_RECHARGE_PER_SECOND,
  JETPACK_AIR_RECHARGE_PER_SECOND,
  JETPACK_MIN_UPWARD_VELOCITY,
} from './player.js';
export {
  EXPLOSION_RADIUS,
  EXPLOSION_DAMAGE,
  FIRE_PATCH_DEFAULT_LIFETIME_MS,
  FIRE_PATCH_DEFAULT_RADIUS,
  FIRE_PATCH_DEFAULT_DPS,
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
