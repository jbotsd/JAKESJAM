export * from './types.js';
export * from './constants.js';
export { World } from './World.js';
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
