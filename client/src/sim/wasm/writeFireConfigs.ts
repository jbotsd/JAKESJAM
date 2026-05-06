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

import type { PlayerId, WorldState } from "../types.js";
import { wasmHost, type ResolvedFireConfigBytes } from "./wasmHost.js";
import { createWeaponBuild } from "../data/weaponBuild.js";
import { starterWeapon, weapons } from "../data/weapons.js";
import { crystalRoundsCards } from "../data/cards.js";
import { packResolvedFireConfig } from "../data/packResolvedFireConfig.js";

const cache = new Map<
  string,
  { signature: string; bytes: ResolvedFireConfigBytes }
>();

/**
 * Resolve + write per-player fire configs for the current
 * `state`. Order matches packPlayer (sorted player ids), so the
 * `i`th config lands on `players[i]` in wasm memory.
 *
 * Idempotent at the byte level — calling twice with the same
 * state writes identical bytes. Cache invalidation is by
 * card-signature, so re-resolution only happens when a player
 * picks a card.
 */
export function writeFireConfigsForState(state: WorldState): void {
  const sortedPids = Object.keys(state.players).sort();
  const fireConfigs: Array<ResolvedFireConfigBytes | null> = [];
  for (const pid of sortedPids) {
    const player = state.players[pid as PlayerId];
    if (!player) {
      fireConfigs.push(null);
      continue;
    }
    const cardSig = `${player.weaponId}|${player.cards.join(",")}`;
    const cached = cache.get(pid);
    if (cached && cached.signature === cardSig) {
      fireConfigs.push(cached.bytes);
      continue;
    }
    const baseWeapon =
      weapons.find((w) => w.id === player.weaponId) ?? starterWeapon;
    const cardDefs = player.cards
      .map((id) => crystalRoundsCards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    const build = createWeaponBuild(baseWeapon, cardDefs);
    const bytes = packResolvedFireConfig(build);
    cache.set(pid, { signature: cardSig, bytes });
    fireConfigs.push(bytes);
  }
  wasmHost.writeFireConfigs(fireConfigs);
}

/** Test-only: clear the resolution cache. */
export function __clearFireConfigCacheForTests(): void {
  cache.clear();
}
