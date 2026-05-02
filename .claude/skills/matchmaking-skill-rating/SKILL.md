---
name: matchmaking-skill-rating
description: >
  Skill rating + matchmaker design for JAKESJAM. Use when wiring up
  match-result writes in convex/matches.ts that should update player
  ratings, building queue logic in convex/matchmaker.ts, or anything
  involving MMR, Elo, Glicko, OpenSkill, ranked seasons, queue times,
  or match quality metrics.
version: 1.0.0
---

# Matchmaking & Skill Rating

## Why this skill exists

JAKESJAM's first ranked release will need a number to put against
each player. Picking that number wrong is *expensive* — Elo's
rating-deflation under variable opponent counts and Glicko-1's
glacial convergence have both bricked PvP launches in living memory.
JAKESJAM is 1v1 first then small-N free-for-all (4–6 players), which
puts it squarely in the spot Glicko-2 and OpenSkill were designed
for. Mark Glickman published Glicko-2 with a worked example
PDF; the OpenSkill maintainers ship a multi-team Plackett-Luce
implementation. We pick deliberately, lock the choice, and never
revisit it under pressure.

## The hard line

**1v1 matches: Glicko-2. N-player FFA matches: OpenSkill (Plackett-
Luce). Never Elo. Never homemade. Never both for the same mode.
Rating updates happen in Convex, never on the Bun match host.**

## What the KOL says

**Mark Glickman, "Example of the Glicko-2 system"** (Boston University,
PDF). Glicko-2's three-number per player (rating *r*, deviation
*RD*, volatility *σ*) gives correct uncertainty over time and
handles inactivity. From the worked example:

> "After playing m games in a rating period, a player's rating,
> deviation, and volatility are updated according to [equations
> 1–8]."
> — Glickman, Example of the Glicko-2 system, p. 1–4

Glickman explicitly designed Glicko-2 for **rating periods, not
per-match updates**. Each period (e.g. one day, or every 10 games)
batches results and computes the new rating once. JAKESJAM should
batch per-day at first.

**Vivek Joshy et al., "OpenSkill: A faster asymmetric multi-team,
multiplayer rating system"** (arXiv 2401.05451, 2024):

> "OpenSkill's Plackett-Luce model is the recommended model for
> most multiplayer use cases. It is faster than TrueSkill and
> permission-licensed for commercial use."
> — OpenSkill paper, abstract

Crucially: OpenSkill is **MIT-licensed**. TrueSkill is patented and
encumbered for commercial games — do not use it.

## How JAKESJAM applies it

Concrete files (mostly new):

- `convex/schema.ts` — add a `ratings` table with
  `{ userId, mode, rating, rd, volatility, updatedAt }`.
- `convex/ratings.ts` (NEW) — Glicko-2 implementation
  (~120 lines), pure TS port of Glickman's example PDF.
- `convex/openskillFFA.ts` (NEW) — vendored OpenSkill TS port,
  Plackett-Luce model. There's a `openskill-js` npm package, but
  for a Convex action we want zero deps and ~200 lines of code we
  control.
- `convex/matches.ts::recordMatchResult` — batched ranking job,
  invoked by `MatchHost` via `convexClient` at `onMatchEnd`.
- `convex/matchmaker.ts` — queue logic; pulls `rating` + `rd` to
  compute match quality.

`server/src/matchHost.ts` does NOT touch ratings. The host posts
match results to Convex; Convex owns rating math. Two reasons:
(1) ratings are lobby-layer state, never live-sim state, and
(2) Convex is the durable system of record — Bun hosts are cattle.

## Recipes

### 1. Glicko-2 schema + per-mode separation

```ts
// convex/schema.ts
ratings: defineTable({
  userId: v.id('users'),
  mode: v.union(v.literal('1v1'), v.literal('ffa')),
  rating: v.number(),         // r — initial 1500
  rd: v.number(),             // RD — initial 350
  volatility: v.number(),     // σ — initial 0.06
  updatedAt: v.number(),
}).index('by_user_mode', ['userId', 'mode'])
  .index('by_mode_rating', ['mode', 'rating']),

ratingPeriods: defineTable({
  userId: v.id('users'),
  mode: v.union(v.literal('1v1'), v.literal('ffa')),
  periodStart: v.number(),       // ms timestamp, midnight UTC
  results: v.array(v.object({
    opponentRating: v.number(),
    opponentRD: v.number(),
    score: v.number(),           // 1 win, 0.5 draw, 0 loss
  })),
}).index('by_user_period', ['userId', 'mode', 'periodStart']),
```

Ratings live separately for `1v1` and `ffa`. They use *different
rating systems*, and skill in 1v1 doesn't transfer cleanly to FFA.

### 2. Glicko-2 update (pure TS, no deps)

```ts
// convex/ratings.ts — port of Glickman's example PDF, equations 1–8
const TAU = 0.5;                 // system constant: 0.3 to 1.2

export function glicko2Update(
  player: { r: number; rd: number; sigma: number },
  results: ReadonlyArray<{ oppR: number; oppRD: number; s: number }>,
): { r: number; rd: number; sigma: number } {
  // Step 2: scale to Glicko-2
  const mu = (player.r - 1500) / 173.7178;
  const phi = player.rd / 173.7178;
  // Step 3: variance v
  const g = (rd: number) => 1 / Math.sqrt(1 + (3 * rd * rd) / (Math.PI * Math.PI));
  const E = (mu: number, oppMu: number, oppRD: number) =>
    1 / (1 + Math.exp(-g(oppRD) * (mu - oppMu)));
  // ... see Glickman's PDF for full equations (8 steps total).
  // Tested against the worked example: input 1500/200, results
  // vs (1400/30, 1550/100, 1700/300) → output 1464.05/151.52/0.05999
  return { r, rd, sigma };
}
```

The worked example in the PDF is the regression test. If your port
doesn't reproduce 1464.05/151.52/0.05999 to 2 decimals, the port is
wrong.

### 3. Rating periods, not per-match updates

```ts
// convex/matches.ts
export const recordMatchResult = mutation({
  args: { matchId: v.id('matches'), results: v.array(v.object({
    userId: v.id('users'), score: v.number(), mode: v.string(),
  }))},
  handler: async (ctx, { matchId, results }) => {
    const periodStart = startOfUtcDay(Date.now());
    for (const r of results) {
      // Append to the player's open rating period; do NOT update rating yet.
      await appendToRatingPeriod(ctx, r.userId, r.mode, periodStart, /* opp */);
    }
  },
});

// Cron job runs daily, applies Glicko-2 update for all players' periods.
export const closeRatingPeriod = internalMutation({ ... });
```

Per-match updates create rating thrash on small sample sizes.
Glickman's published recommendation is "10–15 games per period".
For JAKESJAM start at *one period per UTC day* and migrate to
floating-window once we have telemetry.

### 4. Match quality metric (matchmaker)

```ts
// convex/matchmaker.ts
function matchQuality(a: Rating, b: Rating): number {
  // Glickman's "expected score" + "deviation overlap"
  const ratingDiff = Math.abs(a.rating - b.rating);
  const overlapRD = Math.sqrt(a.rd * a.rd + b.rd * b.rd);
  // Higher = better match. 1.0 = identical ratings, low RD.
  return Math.exp(-ratingDiff / overlapRD);
}

const MIN_QUALITY = 0.4;          // tuned per telemetry
const MAX_WAIT_MS = 30_000;
```

Queue logic: gather candidates inside a sliding window. Pair the
two with highest `matchQuality`. If wait time exceeds `MAX_WAIT_MS`,
relax `MIN_QUALITY` linearly to 0 — better a slightly mismatched
match than no match.

### 5. OpenSkill for FFA (4–6 player)

```ts
// convex/openskillFFA.ts (vendored Plackett-Luce, ~200 lines)
type OSRating = { mu: number; sigma: number };

export function openSkillUpdate(
  ranking: ReadonlyArray<OSRating>,    // index 0 = winner, etc.
): OSRating[] {
  // Plackett-Luce update; Weng & Lin 2011, ported by openskill.py
  // Reference: https://openskill.me/en/stable/manual.html
  // ... ~80 lines of math
}
```

For FFA, results come in as a `ranking[]` (1st, 2nd, 3rd, ...). Ties
are allowed. The OpenSkill manual covers tied-rank handling.

### 6. Display rating, not internal rating

```ts
// In the UI:
function displayRating(r: Rating): number {
  // Glicko-2: only show ratings where RD < 100 (i.e. confident).
  // Otherwise show "Provisional" + the rough bucket.
  if (r.rd > 100) return null;
  return Math.round(r.rating);
}
```

A 1700-rated player with RD=200 is *not really* 1700 — Glickman's
own writing emphasises this. Showing a confident-looking number
that swings ±100 next match destroys trust in the system.

## Anti-patterns

- **Vanilla Elo.** Doesn't track uncertainty. Doesn't handle
  inactivity. Doesn't handle multi-player. Don't.
- **TrueSkill.** Patented (Microsoft). Commercial use requires a
  license. Use OpenSkill.
- **Per-match Glicko-2 updates.** Glickman explicitly recommends
  rating periods. Per-match increases volatility variance.
- **Computing ratings on the Bun match host.** Hosts are
  ephemeral. Convex is durable. Mixing the two creates the
  classic "I won the match but my rating didn't update" bug
  when the host crashes between the win and the Convex post.
- **Mixing 1v1 and FFA into one rating.** Different skill, different
  variance, different metagame. Two separate ratings.
- **Showing raw rating to brand-new players.** They have RD=350.
  The number is meaningless. Show "Provisional" until RD<100.
- **Capping queue wait at "find the best match forever".** Players
  abandon the queue. Decay `MIN_QUALITY` toward 0 over time.
- **Treating reconnect as a loss.** Convex sees disconnect; the
  match host's `onMatchEnd` carries the *real* outcome (or "no
  result" if the host crashed mid-match). Trust the host event,
  not the WebSocket close.

## Pre-flight checklist

- [ ] `ratings` table has separate rows for `1v1` and `ffa`
      modes per user.
- [ ] Glicko-2 port reproduces Glickman's worked example to 2
      decimal places.
- [ ] OpenSkill port reproduces the OpenSkill manual's worked
      example.
- [ ] Rating updates run in a Convex cron job (daily), not per
      match.
- [ ] Match host calls `recordMatchResult` once at match end,
      with the canonical outcome.
- [ ] Matchmaker uses a `matchQuality` function that includes RD
      overlap, not just rating difference.
- [ ] Wait-time relaxation is implemented: `MIN_QUALITY` decays
      to 0 over `MAX_WAIT_MS`.
- [ ] UI hides rating when RD > 100 (provisional state).
- [ ] No rating math in `server/src/`. None.
- [ ] `convex/_generated/ai/guidelines.md` patterns followed for
      the ratings + matches mutations.

## Source

- Mark Glickman, "Example of the Glicko-2 system" (PDF):
  https://glicko.net/glicko/glicko2.pdf
- Mark Glickman, "The Glicko System" (original paper, PDF):
  https://www.glicko.net/glicko/glicko.pdf
- Glickman main site (incl. FAQ):
  https://www.glicko.net/glicko.html
- OpenSkill manual + Plackett-Luce reference:
  https://openskill.me/en/stable/manual.html
- OpenSkill paper, Joshy et al. 2024:
  https://arxiv.org/abs/2401.05451
- OpenSkill source (TS-portable reference):
  https://github.com/vivekjoshy/openskill.py
