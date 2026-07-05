// Build resolution now lives in Zig (sim/src/weapon_build.zig). The host's only
// job is to tell the sim which cards each player holds — as indices into the
// codegen'd card table (cards_gen.zig, same order as crystalRoundsCards filtered
// to cards-with-modifiers) — then call the Zig resolver, which writes
// player_fire_config in place. No TS createWeaponBuild / packResolvedFireConfig.

import type { PlayerId, WorldState } from "../types.js";
import { WORLD_STATE_TOTAL_SIZE } from "./worldStateBridge.js";
import { crystalRoundsCards } from "../data/cards.js";

// card id → index into the Zig card table. Mirrors cards_gen.zig ordering
// (crystalRoundsCards filtered to those with a modifier).
const CARD_INDEX = new Map<string, number>();
crystalRoundsCards
  .filter((c) => c.modifier)
  .forEach((c, i) => CARD_INDEX.set(c.id, i));

export type FireConfigResolverExports = {
  memory: WebAssembly.Memory;
  resolve_player_fire_config: (
    state_ptr: number,
    player_index: number,
    indices_ptr: number,
    count: number,
  ) => void;
};

/**
 * Resolve every player's build IN THE ZIG SIM: write their card indices to a
 * scratch byte buffer and call resolve_player_fire_config, which fills
 * state.player_fire_config[i]. Order matches packPlayer (sorted ids), so index
 * i lands on players[i]. Must run BEFORE the pack (pack skips the fire-config
 * region, so the written config persists into step_world).
 */
export function resolveFireConfigsViaZig(
  ex: FireConfigResolverExports,
  statePtr: number,
  state: WorldState,
): void {
  const sortedPids = Object.keys(state.players).sort();
  // Transient scratch (consumed immediately by each export call, before the
  // statics write reuses the same region). 8 bytes = MAX_PLAYER_CARDS.
  const scratch = statePtr + WORLD_STATE_TOTAL_SIZE + 64;
  const heap = new Uint8Array(ex.memory.buffer);
  for (let i = 0; i < sortedPids.length; i++) {
    const player = state.players[sortedPids[i] as PlayerId];
    if (!player) continue;
    let n = 0;
    for (const cardId of player.cards) {
      const idx = CARD_INDEX.get(cardId);
      if (idx !== undefined && n < 8) {
        heap[scratch + n] = idx;
        n += 1;
      }
    }
    ex.resolve_player_fire_config(statePtr, i, scratch, n);
  }
}
