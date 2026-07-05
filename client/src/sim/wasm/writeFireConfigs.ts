// Thin wrapper: hand the CLIENT wasm instance the world state; the Zig sim
// resolves each player's build (weapon_build.zig) into player_fire_config.
// The TS resolution (createWeaponBuild / packResolvedFireConfig) is gone.

import type { WorldState } from "../types.js";
import { wasmHost } from "./wasmHost.js";

export function writeFireConfigsForState(state: WorldState): void {
  wasmHost.writeFireConfigs(state);
}

/** No-op shim: build resolution no longer caches TS-side (it's in Zig). */
export function __clearFireConfigCacheForTests(): void {}
