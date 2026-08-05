// Build resolution now lives in Zig (sim/src/weapon_build.zig). The host's only
// job is to tell the sim which cards each player holds — as indices into the
// codegen'd card table (cards_gen.zig) — then call the Zig resolver, which
// writes the loadout in place. No TS createWeaponBuild / packResolvedFireConfig.
//
// STOPGAPS RETIRED (Track E1, gospel-goal.md — classModifiers carried in the
// Zig codegen): this file used to patch class-gated build fields into wasm
// memory host-side after every resolve, because `cards_gen.zig` carried no
// `classModifiers` data at all:
//   - `patchLeechFraction` (Track Z1c) — Stolen Fangs' Priest-only
//     `leechFraction`, the narrow first patch;
//   - `patchClassModifierGapFields` (Track Z5 item 2) — the generalized
//     patch for the remaining 8 cards' class-conditional fields.
// Both are gone, not reduced: gen_card_data.ts now emits every card's
// `classModifiers` as per-class CardMod literals (`CardEntry.class_mods`,
// selected by `effectiveCardMod` — weaponBuild.ts's `effectiveCardModifier`
// mirrored), `leech_fraction` is a first-class CardMod field, and the
// per-class starter bases (weapons.ts `baseWeaponForClass` — priest
// tendrils / paladin heavy bolt) cross as `cards_gen.class_bases`, so the
// Zig resolver produces the whole class-aware ResolvedFireConfig itself.
// Parity: classModifierGapFieldsParity.test.ts (all 9 cards × all 4
// classes, no patch active) + weaponBuildParity.test.ts's full class walks.

import type { PlayerId, WorldState } from "../types.js";
import { WORLD_STATE_TOTAL_SIZE } from "./worldStateBridge.js";
import { crystalRoundsCards } from "../data/cards.js";

// card id → index into the Zig card table. Mirrors cards_gen.zig ordering,
// which is `crystalRoundsCards` UNFILTERED — gen_card_data.ts emits an
// entry for EVERY card ("Every card gets an entry now — not just the ones
// with a modifier"; pure-ability cards carry a `.{}` no-op mod). Track Z1b
// fix: this map used to filter to cards-with-modifiers, a leftover from
// the pre-Phase-2 codegen. The indices happened to coincide for all 59
// modifier cards (they all precede the 45 pure-ability cards in the
// array), so fire configs resolved correctly by luck — but every ABILITY
// card was silently absent from the hand Zig saw, which starved
// `resolve_player_loadout`'s EquippedActives derivation and draft.zig's
// uniqueness/rack-cap gates of the very cards they exist for.
const CARD_INDEX = new Map<string, number>();
crystalRoundsCards.forEach((c, i) => CARD_INDEX.set(c.id, i));

/** Zig card-table index for a card id (undefined = id unknown to the
 *  codegen table — should not happen for shipped cards). Exported for the
 *  hosts' draft-index ↔ card-id conversions (Track Z2). */
export function cardIndexForId(id: string): number | undefined {
  return CARD_INDEX.get(id);
}

/** Card id for a Zig card-table index (Track Z2 — draft offers surface as
 *  raw indices in `WorldState.draftMemory`; the hosts convert them back to
 *  ids for the client-facing `round.draftingOffers`). */
export function cardIdForIndex(idx: number): string | undefined {
  return crystalRoundsCards[idx]?.id;
}

export type FireConfigResolverExports = {
  memory: WebAssembly.Memory;
  resolve_player_fire_config: (
    state_ptr: number,
    player_index: number,
    indices_ptr: number,
    count: number,
  ) => void;
  /** Track Z1b — superset resolver: fire config + player_card_ids +
   *  card_count + the EquippedActives rack, all from one ordered-hand
   *  delivery (see weapon_build.zig's own doc comment). Optional so older
   *  sim.wasm builds still resolve fire configs alone. */
  resolve_player_loadout?: (
    state_ptr: number,
    player_index: number,
    indices_ptr: number,
    count: number,
  ) => void;
  /** Byte offset of `player_fire_config[0]` from `state_ptr` (world_state.zig
   *  — a test-facing export; the parity suites read resolved config bytes
   *  through it). No production caller here since the Track E1 stopgap
   *  retirement — kept in the type because it IS part of the export surface
   *  this resolver path loads. */
  offset_player_fire_config?: () => number;
};

/**
 * Resolve every player's build IN THE ZIG SIM: write their card indices to a
 * scratch byte buffer and call the resolver, which fills the loadout parallel
 * arrays. Order matches packPlayer (sorted ids), so index i lands on
 * players[i]. Must run AFTER the pack and before step_world — the hosts'
 * pack (`heap.set` of the full packed image) zero-fills the loadout arrays,
 * so anything written before it is wiped (Track Z1b finding (c); the old
 * "must run BEFORE the pack (pack skips the fire-config region)" note here
 * was wrong about what `heap.set` does to skipped-but-still-copied bytes).
 *
 * NOTE (Track E1): the Zig resolver derives each player's CLASS from the
 * `character_id` already packed at `players[i]` — so the pack-first
 * ordering above is also a CORRECTNESS requirement for the class-gated
 * resolution (base weapon + classModifiers), not just a wipe-avoidance one.
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
  // Prefer the Z1b loadout resolver (also re-establishes the hand + the
  // EquippedActives rack, both zero-filled by every pack); fall back to
  // the fire-config-only export for older sim.wasm builds.
  const resolver =
    typeof ex.resolve_player_loadout === "function"
      ? ex.resolve_player_loadout
      : ex.resolve_player_fire_config;
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
    resolver(statePtr, i, scratch, n);
  }
}
