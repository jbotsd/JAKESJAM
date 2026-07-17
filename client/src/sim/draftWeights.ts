// Draft offer weighting for the Escalation Engine doctrine
// (docs/escalation-engine-goal.md).
//
// Universal round-end draft: every roster seat gets offers. Catch-up is
// additive — non-winners sample a richer pool via weights — never by
// deleting the winner's seat.

import { nextFloat } from "./rng.js";
import type { CardDefinition, WeaponBucket } from "./data/cardTypes.js";

/** Draft seat role for one player in one enterDrafting call. */
export type DraftRole = "standard" | "catch_up" | "winner";

/**
 * Classify a player's draft role from the round winner id.
 * - Draw (`winnerPlayerId` null): everyone is `standard` (equal base pool).
 * - Has winner: winner is `winner` (standard weights); everyone else is
 *   `catch_up` (boosted impact/utility/element + higher rarities).
 */
export function classifyDraftRole(
  playerId: string,
  winnerPlayerId: string | null,
): DraftRole {
  if (winnerPlayerId == null) return "standard";
  if (playerId === winnerPlayerId) return "winner";
  return "catch_up";
}

/** Buckets that catch-up seats weight more heavily. Ability cards are
 *  identity-rich (six-axes Layer 2) — non-winners see them more often,
 *  which also self-corrects any cooldown-snowball toward the leader. */
const CATCH_UP_BUCKETS: ReadonlySet<WeaponBucket> = new Set([
  "impact",
  "utility",
  "element",
  "ability",
]);

/**
 * Relative pick weight for a card under a draft role.
 * Standard/winner: uniform 1. Catch-up: boost impact/utility/element and
 * higher rarities so losers sample punchier offers without denying winners.
 */
export function weightForCard(card: CardDefinition, role: DraftRole): number {
  if (role !== "catch_up") return 1;
  let w = 1;
  const buckets = card.buckets ?? [];
  if (buckets.some((b) => CATCH_UP_BUCKETS.has(b))) w += 2;
  if (card.rarity === "uncommon") w += 1;
  if (card.rarity === "rare" || card.rarity === "legendary") w += 2;
  return w;
}

/**
 * Weighted pick. Weights must be ≥ 0; if total weight is 0, falls back to
 * uniform first element (caller should not pass empty arrays).
 * Returns [newRngState, pickedItem].
 */
export function pickWeighted<T>(
  state: number,
  items: readonly T[],
  weightOf: (item: T) => number,
): [number, T] {
  if (items.length === 0) {
    throw new Error("pickWeighted: empty items");
  }
  let total = 0;
  const weights = new Array<number>(items.length);
  for (let i = 0; i < items.length; i++) {
    const w = Math.max(0, weightOf(items[i]!));
    weights[i] = w;
    total += w;
  }
  if (total <= 0) {
    const [n] = nextFloat(state);
    return [n, items[0]!];
  }
  const [n, f] = nextFloat(state);
  let r = f * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return [n, items[i]!];
  }
  return [n, items[items.length - 1]!];
}
