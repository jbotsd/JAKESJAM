// Phase 97 — host-side helper that resolves each player's
// `ResolvedWeaponBuild` (cards + base weapon → numbers) and writes
// the bytes into wasm memory at `player_fire_config[i]`. The wasm
// sim's I21 fire branch reads from those slots when `valid=1`;
// without this every player fires bare starter pistol.
//
// Lives in its own module so `World.ts` (the only call site
// today) doesn't pull in `wasmStepStrategy.ts` (which imports
// World.ts itself, creating a cycle).
//
// Per-player cache keyed by `weaponId|cards.join(",")` — only
// re-resolves when the signature changes (drafting phase). Hot
// path is the cache-hit branch which is just a bytes lookup.

import type { WorldState } from "../types.js";
import { wasmHost } from "./wasmHost.js";
import {
  resolveFireConfigsForState,
  clearFireConfigResolveCache,
} from "./fireConfigShared.js";

/**
 * Resolve + write per-player fire configs for the current `state` into the
 * CLIENT wasm instance. Resolution (shared with serverWasmHost) is in
 * fireConfigShared so client prediction + server authority pack identical
 * bytes. Order matches packPlayer (sorted player ids).
 */
export function writeFireConfigsForState(state: WorldState): void {
  wasmHost.writeFireConfigs(resolveFireConfigsForState(state));
}

/** Test-only: clear the resolution cache. */
export function __clearFireConfigCacheForTests(): void {
  clearFireConfigResolveCache();
}
