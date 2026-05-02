// Skill rating type sketch — Glicko-2 (1v1) + OpenSkill Plackett-Luce (FFA).
//
// Per skills/matchmaking-skill-rating SKILL.md. Scope of THIS file:
//   - Type interfaces ONLY. No live ratings math, no Convex calls.
//   - Adaptor signatures the future implementation must conform to.
//   - Feature flag gate so adaptors short-circuit until intentionally enabled.
//
// Why server/src/ and not convex/: matchmaking-skill-rating SKILL.md is firm
// that "rating updates run in Convex, never on the Bun match host". This file
// is the type contract the BUN host calls into via convexClient — Convex owns
// the actual math. Keeping the sketch here lets us reference these types from
// matchHost.onMatchEnd plumbing without forcing a Convex schema migration in
// the same commit.
//
// Persistence (Convex schema additions, when wired):
//   ratings:        { userId, mode, rating, rd, volatility, updatedAt }
//   ratingPeriods:  { userId, mode, periodStart, results: [...] }
// See matchmaking-skill-rating SKILL.md §"Glicko-2 schema + per-mode separation"
// for the exact `defineTable` shape.

/** Rating mode separation — 1v1 and FFA use different rating systems and
 *  must NEVER share a row per SKILL.md ("different skill, different
 *  variance, different metagame"). */
export type RatingMode = "1v1" | "ffa";

/** Glicko-2 player rating triple. r=rating, rd=deviation, sigma=volatility.
 *  Initial values per Glickman's PDF: r=1500, rd=350, sigma=0.06. */
export type Glicko2Rating = {
  r: number;
  rd: number;
  sigma: number;
};

/** OpenSkill Plackett-Luce rating pair. mu=skill, sigma=uncertainty.
 *  Initial values per OpenSkill manual: mu=25, sigma=25/3 ≈ 8.333. */
export type OpenSkillRating = {
  mu: number;
  sigma: number;
};

/** Per-match outcome for rating updates. Score = 1 win, 0.5 draw, 0 loss
 *  (Glicko-2 convention). For FFA, see `OpenSkillResult` below — ranking
 *  position is what matters, not pairwise scores. */
export type Glicko2Result = {
  oppR: number;
  oppRD: number;
  s: number;
};

/** OpenSkill input is an ordered ranking of players (index 0 = winner,
 *  highest index = last place). Ties allowed by repeating ratings. */
export type OpenSkillResult = ReadonlyArray<OpenSkillRating>;

/** Compact summary used by both UI and matchmaker. `displayRating` returns
 *  null for provisional ratings (rd > 100) per Glickman's recommendation. */
export type RatingSummary = {
  mode: RatingMode;
  glicko2?: Glicko2Rating;
  openskill?: OpenSkillRating;
  /** Unix ms of the most recent update. Used to decide rating-period
   *  membership (rolling-window or fixed-day). */
  updatedAt: number;
  /** Number of completed rating periods. Affects display (provisional vs
   *  confident). */
  periodsPlayed: number;
};

/**
 * Adaptor a Convex function exposes for the bun host to call. Wraps the actual
 * Convex mutation behind a feature flag so we don't accidentally activate
 * ratings before the math + UI are ready.
 *
 * Implementation arrives in `convex/ratings.ts` (NEW file, not in this commit).
 * The adapter here is the contract the bun host depends on; Convex must
 * fulfill it to enable ratings system-wide.
 */
export interface RatingAdaptor {
  /**
   * Append a per-match result to the player's open rating period. Idempotent
   * by (matchId, userId). Per SKILL.md: rating math is BATCHED into periods
   * via cron; this method does NOT compute a new rating.
   */
  appendMatchResult(args: {
    userId: string;
    matchId: string;
    mode: RatingMode;
    /** For 1v1: scalar (1/0.5/0) plus the opponent's rating snapshot.
     *  For FFA: the player's final rank (0=winner) plus all opponent ratings. */
    glicko2Result?: Glicko2Result;
    openskillRanking?: OpenSkillResult;
  }): Promise<void>;

  /** Read the latest rating summary for a user/mode pair. Hot path for the
   *  matchmaker — must be cheap (single doc read). */
  getRating(args: { userId: string; mode: RatingMode }): Promise<RatingSummary | null>;
}

// ── Feature flag ─────────────────────────────────────────────────────────────
//
// Set RATINGS_ENABLED to true ONLY after:
//   1. convex/ratings.ts implements glicko2Update (regression-tested against
//      Glickman's PDF worked example: 1500/200 + 3 results → 1464.05/151.52/0.05999)
//   2. convex/openskillFFA.ts implements Plackett-Luce update (regression-tested
//      against OpenSkill manual's worked example)
//   3. convex/schema.ts has `ratings` + `ratingPeriods` tables defined
//   4. A daily cron mutation closes rating periods and applies updates
//   5. Display logic gates on `rd > 100` → "Provisional"

export const RATINGS_ENABLED: boolean =
  process.env.JAKESJAM_RATINGS_ENABLED === "1";

/**
 * No-op adaptor used while RATINGS_ENABLED is false. Calls succeed but do
 * nothing — the bun host can safely call `await ratings.appendMatchResult(...)`
 * in the post-match path without worrying about whether ratings are wired.
 */
export const noopRatingAdaptor: RatingAdaptor = {
  async appendMatchResult() {
    /* feature off */
  },
  async getRating() {
    return null;
  },
};

/**
 * Returns the active rating adaptor. Today: always returns the no-op.
 * When ratings ship, this becomes:
 *
 *   if (!RATINGS_ENABLED) return noopRatingAdaptor;
 *   return new ConvexRatingAdaptor(convexClient);
 *
 * — keeping the call sites in matchHost unchanged.
 */
export function ratingAdaptor(): RatingAdaptor {
  if (!RATINGS_ENABLED) return noopRatingAdaptor;
  // TODO(matchmaking-skill-rating): wire the real Convex adaptor here once
  // convex/ratings.ts ships.
  return noopRatingAdaptor;
}
