// card id <-> index into the Zig card table. Mirrors cards_gen.zig ordering
// (crystalRoundsCards filtered to those with a modifier). Shared by
// fireConfigShared.ts (build resolution) and worldStateBridge.ts (native
// drafting card_ids/draft_offers pack/unpack, 2026-07-14) — kept as its own
// module so those two don't import each other (worldStateBridge already
// exports WORLD_STATE_TOTAL_SIZE, which fireConfigShared consumes).

import { crystalRoundsCards } from "../data/cards.js";

const MODIFIER_CARDS = crystalRoundsCards.filter((c) => c.modifier);

export const CARD_INDEX = new Map<string, number>();
MODIFIER_CARDS.forEach((c, i) => CARD_INDEX.set(c.id, i));

/** Reverse lookup — index -> card id, for unpacking Zig's card_ids/
 *  draft_offers back into TS strings. */
export const CARD_ID_AT_INDEX: string[] = MODIFIER_CARDS.map((c) => c.id);
