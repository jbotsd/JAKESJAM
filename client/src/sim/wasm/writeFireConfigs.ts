// Thin wrapper: hand the CLIENT wasm instance the world state; the Zig sim
// resolves each player's build (weapon_build.zig) into player_fire_config.
// The TS resolution (createWeaponBuild / packResolvedFireConfig) is gone.
//
// Track Z1b: the production step path no longer calls this — loadout
// delivery moved INSIDE runWasmStepSync (worldWasmBackend.ts's
// writeLoadoutsIntoMemory), AFTER the pack, because a pre-step write here
// was zero-filled by the step's own pack before step_world ever ran
// (finding (c)). Kept for older test harnesses; calling it pre-step is
// harmless (redundant) now.

import type { WorldState } from "../types.js";
import { wasmHost } from "./wasmHost.js";

export function writeFireConfigsForState(state: WorldState): void {
  wasmHost.writeFireConfigs(state);
}

/** No-op shim: build resolution no longer caches TS-side (it's in Zig). */
export function __clearFireConfigCacheForTests(): void {}
