// Re-export the canonical chaos modifier data from the sim package. The data
// moved into sim/ so the authoritative server can read the same numbers as
// the client. This wrapper preserves the old import paths used by Phaser-side
// code (MatchScene, draft UI) without forcing a wide rename.

export {
  chaosModifiers,
  getChaosModifiers,
  getChaosProfile,
  NEUTRAL_CHAOS_PROFILE,
  projectileShapes,
} from "../../sim/data/chaosModifiers";
export type {
  ChaosModifierDefinition,
  ChaosModifierId,
  ChaosProfile,
} from "../../sim/data/chaosModifiers";
