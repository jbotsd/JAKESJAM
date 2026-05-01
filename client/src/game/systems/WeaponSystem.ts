// Weapon build resolution lives in client/src/sim/data/weaponBuild.ts so the
// authoritative server and the prediction client compute identical builds
// from the same card hand. Re-exported here to keep existing client imports
// (notably MatchScene's offline path) stable.
export {
  applyCard,
  clampBuild,
  createWeaponBuild,
  findCardsById,
  mergeProjectileModifier,
} from "../../sim/data/weaponBuild";
export type { ResolvedWeaponBuild } from "../../sim/data/cardTypes";
