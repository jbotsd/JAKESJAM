---
name: roguelite-draft-design
description: >
  Card-draft economy, rarity curves, synergy density, telemetry-driven
  balance. Use when adding cards to client/src/sim/data/cards.ts,
  changing draft offer count, weighting rolls, or anything that mutates
  WeaponBuild over a multi-round match. Also use when reviewing why
  Card X feels mandatory or Card Y is never picked.
version: 1.0.0
---

# Rogue-lite Draft Design

## Why this skill exists

JAKESJAM's pivot is "io-style always-on world + rogue-lite card-draft
progression". The draft loop (lose round → roll 3 cards → pick 1)
*is* the meta-game. Get it wrong and matches feel either snowball-y
(losers stay losing) or homogenous (everyone picks the same 2 cards).
Mega Crit and Tom Cadwell have already published exactly how to keep
a draft alive over hundreds of runs without per-card hand-tuning.
This skill encodes their methodology against `sim/data/cards.ts`.

## The hard line

**Balance with telemetry, not vibes. Cap any card's pick rate at
≈55% of offers and any card's banish/skip rate at ≈55% — anything
outside that band is broken and ships a balance patch in the next
build, not "next sprint".**

## What the KOL says

**Anthony Giovannetti, "Slay the Spire: Metrics Driven Design and
Balance"** (GDC 2019). Mega Crit shipped weekly balance patches for a
year of Early Access using a single dashboard:

> "We look at win-rate per card and pick-rate per card. If a card is
> picked >55% of the time it's offered, it's too strong. If it's
> picked <15%, it's too weak. We do not balance cards in isolation —
> we balance the offer pool."
> — Giovannetti, GDC 2019 (slides p. 18–24)

Their secondary rule: **never nerf a fun card, buff its competition
instead**. Player perception of "patches make my deck worse" is the
churn killer.

**Tom Cadwell, "Level Up Your Game: The Untapped Potential of
Roguelikes"** (GDC 2017, Riot Games). Cadwell argues mastery comes
from *variance you can plan around*, not pure RNG:

> "Players need to feel they shaped the run. If RNG dominates, every
> defeat is the system's fault. If skill dominates, the genre
> collapses. Aim for ~70% skill expression / 30% variance per pick."
> — Cadwell, GDC 2017

## How JAKESJAM applies it

Concrete files and shapes:

- `client/src/sim/data/cards.ts` — the card definitions. Currently
  flat — needs `rarity`, `tags`, `weight`.
- `client/src/sim/data/cardTypes.ts` — `CardDef` shape. Add
  `rarity: 'common' | 'uncommon' | 'rare' | 'mythic'` and
  `weight: number`.
- `client/src/sim/data/weaponBuild.ts::createWeaponBuild` — applies
  cards to the base weapon. The unit test boundary for synergy.
- `client/src/sim/round.ts::stepRound` — `drafting` phase rolls
  offers. The roll function lives here and reads from `cards.ts`.
- `client/src/game/ui/CardDraftOverlay.ts` — display only. Rarity
  must be visually distinct (color border, particle aura).
- Telemetry: post draft-offer + draft-pick events to Convex via
  `convex/matches.recordDraftEvent` for the dashboard. Fire and
  forget — never block the draft phase on Convex.

`DRAFT_OFFER_COUNT = 3`. Keep it at 3. Cadwell's research: 3 is the
sweet spot for choice paralysis vs meaningful agency. Slay the Spire
also uses 3.

## Recipes

### 1. Rarity-weighted offer rolls (deterministic)

```ts
// client/src/sim/round.ts (in drafting phase)
import { rngNext } from './rng';
import { CARDS } from './data/cards';

const RARITY_WEIGHTS = {
  common:   60,
  uncommon: 30,
  rare:      9,
  mythic:    1,
} as const;

function rollDraftOffers(
  state: WorldState,
  playerId: PlayerId,
): readonly CardId[] {
  const owned = new Set(state.players[playerId].cards.map(c => c.id));
  const eligible = CARDS.filter(c => !c.unique || !owned.has(c.id));

  const offers: CardId[] = [];
  for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
    const totalWeight = eligible
      .filter(c => !offers.includes(c.id))
      .reduce((s, c) => s + (c.weight ?? 1) * RARITY_WEIGHTS[c.rarity], 0);
    const r = rngNext(state) * totalWeight;
    // ... walk eligible list, pick when cumulative > r
    offers.push(picked);
  }
  return offers;
}
```

RNG MUST go through `state.rngState` via `rngNext()` — never
`Math.random()`. See `game-sim-determinism`.

### 2. The "pity timer" — Cadwell's variance shaping

A player who hasn't seen a `rare` in 4 drafts gets one of their next
3 offers slot-promoted. Stops the "I never see good cards" feedback
loop without breaking RNG determinism (the pity counter is part of
`PlayerEntity`).

```ts
// In PlayerEntity:
draftsSinceRare: number;

// In rollDraftOffers, after picking each offer:
if (state.players[playerId].draftsSinceRare >= 4 && offer.rarity === 'common') {
  // Re-roll this slot at rare+ tier
  offer = rollAtMinimumRarity(state, 'rare', eligible);
}
```

### 3. Synergy tags, not stat soup

Every card declares 1–3 `tags`. WeaponBuild gives a small "synergy
bonus" (5–10% damage) when 3+ cards share a tag. Players see the tag
chip on the card and *plan* around it. This is Cadwell's "70% skill
expression" pattern.

```ts
// client/src/sim/data/cardTypes.ts
export type CardTag = 'fire' | 'pierce' | 'aoe' | 'rapid' | 'heavy'
  | 'mobility' | 'sustain' | 'control';

export type CardDef = {
  id: CardId;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
  weight: number;       // base sample weight inside its rarity bucket
  tags: readonly CardTag[];
  unique: boolean;
  // ... existing fields
};
```

### 4. Telemetry hook — pick rate per offer slot

```ts
// On draft commit, after the sim step:
void convexClient.mutation(api.draft.recordDraftEvent, {
  matchId, roundIndex, playerId,
  offers: offerIds,        // 3-tuple
  picked: pickedId,        // 1 of the 3
  ownedCardCount: state.players[playerId].cards.length,
});
```

Dashboard query: `pickRate(card) = picks / offerings`. Bucket by
`ownedCardCount` so you can see "Card X is picked 80% in opening
draft, 10% in late draft" — that's a knowledge problem, not a
balance problem, and the fix is signposting, not a nerf.

### 5. The "loser bonus" — anti-snowball without rubber-banding

Slay the Spire doesn't have it (single-player), but JAKESJAM is PvP.
Mega Crit's metric-driven mindset says: don't guess, measure. Track
`comebackRate` (rounds won by the player currently behind on score).
If it sits below 25%, the loser draft pool needs +1 offer. If above
45%, drop back to 3. No hand-tuning of individual cards.

```ts
// client/src/sim/round.ts
const offerCount = playerIsBehind(state, playerId)
  ? DRAFT_OFFER_COUNT_BEHIND   // start at 3, telemetry decides
  : DRAFT_OFFER_COUNT;
```

Keep both constants in `sim/constants.ts`. Adjust between matches
(via Convex feature flag) without redeploying the sim.

### 6. The 12-card opening pool

Per `AGENTS.md`: "first card pool should be small, around 12 cards."
Giovannetti's GDC slides confirm: a small, well-tuned pool beats a
big, untuned one. Lock the MVP at 12 commons with 4 tags (3 cards
per tag), no rarities yet. Add rarity tiers only after telemetry
shows clean pick-rate data.

## Anti-patterns

- **Adding a card with `+5% damage` and no tag.** It picks 99% of
  the time on every weapon — Slay the Spire's classic "Strength"
  trap. Either give it a downside or restrict by weapon archetype.
- **Nerfing a fun card.** Buff its competition. Players forgive
  power creep, they don't forgive "my favorite card got worse".
- **Letting a `unique: true` card roll twice in one draft.** Player
  loses an offer slot. Filter `owned` cards in the roll function.
- **Calling `Math.random()` anywhere in the draft logic.** Sim
  determinism dies, replays diverge.
- **Drafting from `OnlineMatchScene` directly.** Drafting is a sim
  phase. The scene reads `state.round.phase === 'drafting'` and
  shows `CardDraftOverlay`. The actual roll happens in the sim,
  same on server and client.
- **Auto-pick on disconnect/timeout that's silent.** Tell the
  player the game picked for them and *which* card it picked.
  Mega Crit's data: silent forced choices are the #1 rage-quit
  trigger.
- **>5 offers.** Choice paralysis kills the rhythm. Cadwell and
  Mega Crit both land on 3.

## Pre-flight checklist

- [ ] Every new card has `rarity`, `weight`, `tags`, `unique`
      explicitly set.
- [ ] Card pool fits the MVP cap (~12) until telemetry justifies
      expansion.
- [ ] Draft roll calls `rngNext(state)`, not `Math.random()`.
- [ ] `unique: true` cards filtered out of offers when already
      owned.
- [ ] Draft offer + pick telemetry posted to Convex (non-blocking).
- [ ] No card grants a flat unconditional buff with no opportunity
      cost.
- [ ] At least 2 cards in the pool actively *counter* the most
      common build (anti-rapid, anti-heavy, etc.).
- [ ] CardDraftOverlay surfaces the tag chips so synergy is
      legible to first-time players.
- [ ] Pity timer (`draftsSinceRare`) is part of `PlayerEntity` and
      survives serialization/snapshot delta.

## Source

- Anthony Giovannetti, "'Slay the Spire': Metrics Driven Design and
  Balance" — GDC 2019. Slides:
  https://media.gdcvault.com/gdc2019/presentations/Giovannetti_Anthony_SlayTheSpire.pdf
- Video: https://www.youtube.com/watch?v=7rqfbvnO_H0
- Tom Cadwell, "Level Up Your Game: The Untapped Potential of
  Roguelikes" — GDC 2017.
  https://www.gdcvault.com/play/1022119/Level-Up-Your-Game-The
