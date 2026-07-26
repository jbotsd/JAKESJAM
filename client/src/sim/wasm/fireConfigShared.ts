// Build resolution now lives in Zig (sim/src/weapon_build.zig). The host's only
// job is to tell the sim which cards each player holds — as indices into the
// codegen'd card table (cards_gen.zig) — then call the Zig resolver, which
// writes the loadout in place. No TS createWeaponBuild / packResolvedFireConfig.

import type { PlayerEntity, PlayerId, WorldState } from "../types.js";
import { WORLD_STATE_TOTAL_SIZE, RESOLVED_FIRE_CONFIG_SIZE } from "./worldStateBridge.js";
import { crystalRoundsCards } from "../data/cards.js";
import { resolvePlayerBuild } from "../weapon.js";
import { packResolvedFireConfig } from "../data/packResolvedFireConfig.js";
import { createWeaponBuild, findCardsById } from "../data/weaponBuild.js";
import { baseWeaponForClass } from "../data/weapons.js";
import { classIdForArchetype, type ClassId } from "../data/cardTypes.js";
import type { ResolvedFireConfigBytes } from "./wasmHost.js";

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
   *  — already existed for test use, e.g. loadoutBridge.test.ts's gate A).
   *  Reused here (Track Z1c "six-axes axis payloads") to patch the ONE
   *  `leech_fraction` field the Zig card resolver can't derive on its own —
   *  see `LEECH_FRACTION_PATCH` below. Optional so older sim.wasm builds
   *  degrade gracefully (passive Tithe leech just stays inert for them,
   *  same as before this pass). */
  offset_player_fire_config?: () => number;
};

/** Byte offset of `ResolvedFireConfig.leech_fraction` within one player's
 *  slot (world_state.zig: offset 252, an f32 reusing `delivery`'s own
 *  trailing pad — see that field's doc comment). */
const LEECH_FRACTION_OFFSET = 252;

/**
 * STOPGAP (Track Z1c "six-axes axis payloads", documented, not silent):
 * Zig's card codegen (`gen_card_data.ts` → `cards_gen.zig`'s `CardMod`)
 * carries no `classModifiers` data at all (weapon_build.zig's
 * `resolve_player_fire_config` doc comment already flags this exact gap
 * for a different field) — so a class-gated leech reading (Stolen Fangs'
 * Priest-only `classModifiers.priest.leechFraction`, the only card that
 * sets this field today) can never resolve correctly through the normal
 * Zig card resolver above. Porting `classModifiers` generally is a much
 * larger, separate item (9 cards, several fields each); this patches JUST
 * the one field this pass adds, straight from the REAL TS build resolution
 * (`resolvePlayerBuild`, the same production function World.ts/weapon.ts
 * use), the same "host resolves in TS, patches into wasm memory" shape
 * every other augment field on `ResolvedFireConfig` already uses.
 */
function patchLeechFraction(
  ex: FireConfigResolverExports,
  statePtr: number,
  playerIndex: number,
  leechFraction: number,
): void {
  if (typeof ex.offset_player_fire_config !== "function") return;
  const view = new DataView(ex.memory.buffer);
  const base =
    statePtr +
    ex.offset_player_fire_config() +
    playerIndex * RESOLVED_FIRE_CONFIG_SIZE +
    LEECH_FRACTION_OFFSET;
  view.setFloat32(base, leechFraction, true);
}

/**
 * Track Z5 item 2 — the general classModifiers-codegen gap this file's own
 * header comment (and `patchLeechFraction`'s) already named: Zig's card
 * codegen carries no `classModifiers` data at all, only the top-level
 * class-blind `modifier`, so ANY card with a `classModifiers` entry
 * silently resolves as if that entry didn't exist for every class it names.
 * Nine cards have one (grepped directly against cards.ts): `seeker-facets`,
 * `cluster-bomb`, `slow-field`, `molten-core`, `frost-prism`,
 * `crystal-plating`, `spring-heel`, `double-jump`, `stolen-fangs`.
 * `stolen-fangs` already had its own narrow stopgap above
 * (`patchLeechFraction`, Track Z1c) — this generalizes the SAME "host
 * resolves in TS, patches into wasm memory" shape to the remaining 8,
 * rather than porting the codegen generally (a much larger change: every
 * one of these touches several different `ResolvedFireConfig` fields, and
 * `weapon_build.zig`'s resolver would need a whole second per-class literal
 * table alongside `cards_gen.zig`'s existing class-blind one).
 *
 * `CLASS_MODIFIER_GAP_FIELDS[cardId][classId]` lists exactly the
 * `ResolvedFireConfigBytes` field names THAT card's `classModifiers[classId]`
 * touches (hand-enumerated against cards.ts, one entry per card × listed
 * class — classes a card doesn't mention fall back to the class-blind
 * `modifier`, which Zig already resolves correctly, so they're deliberately
 * absent here rather than patched to a no-op value). Each listed field gets
 * OVERWRITTEN with the real `resolvePlayerBuild` value — safe regardless of
 * what OTHER cards also touch the same field, since that TS build already
 * composes every held card (gap or not) into one final number; only fields
 * NOT in this list are left as Zig's own (correct, class-blind) resolution.
 *
 * One documented overlap with a SEPARATE, pre-existing, already-recorded
 * gap (weaponBuildParity.test.ts's own note: `weapon_build.zig`'s
 * `StarterBase` resolves every class from the same class-blind BASE weapon
 * stats, so a live Priest/Paladin's actual base damage/speed/etc never
 * matches TS independent of classModifiers): `slow-field`'s Priest
 * `damageMultiplier` and `cluster-bomb`'s Paladin `fireRateMultiplier` both
 * patch a field (`damage`/`fireRate`) that ALSO carries that separate gap.
 * Patching here still lands on the correct TS-truth number (strictly more
 * correct, never a regression), it just also incidentally closes that
 * other gap FOR THOSE TWO NARROW card+class combinations — recorded here,
 * not silently absorbed, so a future reader doesn't mistake it for scope
 * creep on this item.
 */
const CLASS_MODIFIER_GAP_FIELDS: Readonly<
  Record<string, Partial<Record<ClassId, ReadonlyArray<keyof ResolvedFireConfigBytes>>>>
> = {
  "seeker-facets": {
    wizard: ["delivery", "projectileSpeed", "damage", "pathingIdx", "homingStrength"],
    paladin: ["pathingIdx", "homingStrength"],
    priest: ["delivery", "projectileSpeed", "pathingIdx", "homingStrength"],
  },
  "cluster-bomb": {
    wizard: ["fireRate", "splitCount", "sizeMultiplier"],
    paladin: ["fireRate", "splitCount", "sizeMultiplier"],
  },
  "slow-field": {
    priest: ["damage", "impactIdx", "impactRadiusPx", "slowMultiplier"],
  },
  "molten-core": {
    wizard: ["elementIdx", "impactRadiusPx"],
    paladin: ["elementIdx", "impactRadiusPx"],
  },
  "frost-prism": {
    wizard: ["elementIdx", "impactIdx", "slowMultiplier"],
    paladin: ["elementIdx", "impactIdx", "slowMultiplier"],
  },
  "crystal-plating": {
    wizard: ["maxHealthAdd", "moveSpeedMultiplier", "shapeIdx", "sizeMultiplier", "elementIdx"],
    paladin: ["maxHealthAdd", "moveSpeedMultiplier", "shapeIdx", "sizeMultiplier", "elementIdx"],
  },
  "spring-heel": {
    wizard: ["jumpMultiplier", "wallJumpMultiplier"],
    paladin: ["jumpMultiplier", "wallJumpMultiplier"],
  },
  // Both classes' `airJumpsAdd` happens to equal the class-blind
  // `modifier.airJumpsAdd` already (1, same as every class) — no OBSERVABLE
  // divergence exists today (Zig's fallback is already numerically right),
  // but the crossing is wired for real here like every other entry, so a
  // future re-tune of either class's number starts correct immediately
  // instead of silently falling back to the wrong (class-blind) one.
  "double-jump": {
    wizard: ["airJumps"],
    paladin: ["airJumps"],
  },
};

/** Byte offset + wire width of each `ResolvedFireConfigBytes` field this
 *  gap patch can touch (world_state.zig's `ResolvedFireConfig` layout,
 *  verified directly against `weaponBuildParity.test.ts`'s own offset
 *  table — the two must never drift apart independently). */
const FIELD_OFFSETS: Readonly<
  Partial<Record<keyof ResolvedFireConfigBytes, { off: number; kind: "f64" | "u32" | "u8" }>>
> = {
  damage: { off: 0, kind: "f64" },
  fireRate: { off: 8, kind: "f64" },
  projectileSpeed: { off: 16, kind: "f64" },
  homingStrength: { off: 48, kind: "f64" },
  slowMultiplier: { off: 72, kind: "f64" },
  impactRadiusPx: { off: 80, kind: "f64" },
  sizeMultiplier: { off: 88, kind: "f64" },
  splitCount: { off: 124, kind: "u32" },
  shapeIdx: { off: 128, kind: "u8" },
  elementIdx: { off: 129, kind: "u8" },
  pathingIdx: { off: 130, kind: "u8" },
  impactIdx: { off: 131, kind: "u8" },
  moveSpeedMultiplier: { off: 136, kind: "f64" },
  jumpMultiplier: { off: 152, kind: "f64" },
  wallJumpMultiplier: { off: 160, kind: "f64" },
  maxHealthAdd: { off: 208, kind: "f64" },
  airJumps: { off: 216, kind: "u32" },
  delivery: { off: 248, kind: "u8" },
};

/** See `CLASS_MODIFIER_GAP_FIELDS`'s own doc comment. Computes the real
 *  build ONCE per player (only when at least one held card actually has a
 *  gap entry for this player's class) and patches exactly the fields that
 *  card's `classModifiers` names, straight from the same production
 *  `resolvePlayerBuild` the leech patch above already trusts. */
function patchClassModifierGapFields(
  ex: FireConfigResolverExports,
  statePtr: number,
  playerIndex: number,
  player: PlayerEntity,
): void {
  if (typeof ex.offset_player_fire_config !== "function") return;
  const classId = classIdForArchetype(player.characterId);
  let fields: Set<keyof ResolvedFireConfigBytes> | null = null;
  for (const cardId of player.cards) {
    const perClass = CLASS_MODIFIER_GAP_FIELDS[cardId]?.[classId];
    if (!perClass) continue;
    fields ??= new Set();
    for (const f of perClass) fields.add(f);
  }
  if (!fields) return;

  // `resolvePlayerBuild` is safe for every field here EXCEPT
  // `moveSpeedMultiplier` (`crystal-plating` only): that wrapper folds the
  // class chassis speed factor (Kindled 0.88 / Interstice 1.14 / Syzygist
  // 0.96) ONTO the card-resolved number, a fold cohesion-goal.md P1.2's own
  // doc comment (weapon.ts's `resolvePlayerBuild`) says explicitly lives
  // ONLY on the TS side — "the folded value flows through the existing
  // World.ts speed product into Zig's `speed_mul` param, no ABI change".
  // `step_world`'s own `speed_mul` composition chain (world.zig, the block
  // right before `if (has_cfg) speed_mul *= fcfg.move_speed_mul`) has NO
  // chassis term at all — a separate, real, pre-existing gap (chassis
  // move speed is entirely unmodeled under wasm authority today,
  // independent of classModifiers and out of THIS item's scope). Patching
  // `move_speed_mul` with the chassis-folded number would silently invent
  // chassis-speed compensation for exactly the 1-2 cards that touch this
  // field — an inconsistent side effect this item doesn't own. Using the
  // RAW `createWeaponBuild` output instead (bypassing the fold entirely)
  // matches Zig's own card-only architecture exactly — the same call
  // `weaponBuildParity.test.ts`'s `ts()` helper already proves
  // byte-identical to `weapon_build.zig`'s resolver for every card without
  // a `classModifiers` entry.
  const packed = packResolvedFireConfig(resolvePlayerBuild(player));
  const rawMoveSpeedMultiplier = fields.has("moveSpeedMultiplier")
    ? createWeaponBuild(
        baseWeaponForClass(classId),
        findCardsById(crystalRoundsCards, player.cards),
        classId,
      ).moveSpeedMultiplier
    : undefined;

  const view = new DataView(ex.memory.buffer);
  const base =
    statePtr + ex.offset_player_fire_config() + playerIndex * RESOLVED_FIRE_CONFIG_SIZE;
  for (const field of fields) {
    const spec = FIELD_OFFSETS[field];
    if (!spec) continue; // unreachable given the table above; keeps TS honest
    const value = field === "moveSpeedMultiplier" ? rawMoveSpeedMultiplier! : (packed[field] as number);
    if (spec.kind === "f64") view.setFloat64(base + spec.off, value, true);
    else if (spec.kind === "u32") view.setUint32(base + spec.off, value, true);
    else view.setUint8(base + spec.off, value);
  }
}

/**
 * Resolve every player's build IN THE ZIG SIM: write their card indices to a
 * scratch byte buffer and call the resolver, which fills the loadout parallel
 * arrays. Order matches packPlayer (sorted ids), so index i lands on
 * players[i]. Must run AFTER the pack and before step_world — the hosts'
 * pack (`heap.set` of the full packed image) zero-fills the loadout arrays,
 * so anything written before it is wiped (Track Z1b finding (c); the old
 * "must run BEFORE the pack (pack skips the fire-config region)" note here
 * was wrong about what `heap.set` does to skipped-but-still-copied bytes).
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
    // Leech-fraction stopgap (see `patchLeechFraction`'s own doc comment) —
    // always overwrites (not just when >0) so a hand that DROPS the card
    // correctly zeroes it back out too, matching every other build field's
    // "re-derived fresh every tick" contract.
    patchLeechFraction(ex, statePtr, i, resolvePlayerBuild(player).leechFraction);
    // The remaining 8 cards' classModifiers gap (Track Z5 item 2) — see
    // `patchClassModifierGapFields`'s own doc comment. No "always
    // overwrite" needed here (unlike leech): `resolver` above already
    // re-resolves EVERY field fresh from THIS tick's hand before this
    // runs, so a dropped gap card naturally leaves Zig's own (correct,
    // class-blind) value standing — this only ever touches fields for a
    // card that's actually currently held.
    patchClassModifierGapFields(ex, statePtr, i, player);
  }
}
