# GOAL — Escalation Engine (draft doctrine, done-done)

**Status:** North star. Single conflict-winner for “how builds grow and who gets to draft.”  
**Supersedes on conflict:** loser-only ROUNDS catch-up as *default*, death-draft-as-primary in pillars, any “winner freezes” balance notes.  
**Does not supersede:** `CLAUDE.md` on sim authority / deploy / aegis controls — this goal only owns **progression & draft economics**.  
**Last written:** 2026-07-09.

---

## Mission

Make **build escalation the always-on product**, not a consolation prize for losing.

JAKESJAM’s content engine is the crystal-rounds picker. Fairness must **never** be purchased by starving the player who is winning of that engine. Catch-up exists, but as **asymmetric offer quality / pity / caps** — not as **winner silence**.

**Done =** every human in a match touches the draft every round (except deliberate solo edge cases), winners still feel their gun mutate, snowball is bounded by hard math, one doctrine is true in code + docs + UI + bots + tests, and a live funnel playtest confirms “winning still gets more interesting.”

---

## What this is not

| Not this | Why |
|----------|-----|
| A card content pass | Orthogonal axes / new cards are separate; this is *who gets offers when* and *how power is capped* |
| A return to arena pickups | Pickups stay deleted; progression stays phase-gated |
| Death-draft as the primary loop | Pillars’ “die → draft” is **retired** as primary; death stays short and clean |
| Copy-paste ROUNDS 1v1 catch-up | FFA + multi-round FFA is a different category; we re-derive catch-up |
| Zig / netcode work | Draft policy is TS-only (`CLAUDE.md`); no Zig mirror |
| FTUE / Practice Zone redesign | Those own teaching spaces; they **consume** this doctrine, they don’t redefine it |

---

## The reasoning flaw this kills

**Proxy:** “Score snowball is bad → deny the winner a draft.”  
**Product:** “The picker is THE feature → denying the winner the picker makes success less fun.”

Loser-only draft made a 2–0 score lead stop being a 2–0 *power* lead by making a 2–0 score lead also a **content drought** for the lead. That inverts the fantasy: the best players experience the least of the game’s identity.

---

## Locked doctrine (one page, no alternatives)

### Loop (canonical)

```
countdown → fighting → round-over hold → DRAFTING (all humans) → countdown → …
```

1. **Universal round-end draft.** Every player still in the match roster (alive or mid-respawn) receives offers when the match enters `drafting`, **including the round winner**.
2. **Draws:** everyone drafts (unchanged).
3. **Solo / one human + bots:** human always drafts; bots follow bot policy below.
4. **No mid-round death draft.** Death is for respawn + juice, not picker UI. Frequency of “the decision” comes from **short rounds**, not death spam.
5. **Catch-up is additive, not exclusive.** Losers get *better offers*; winners still get *offers*.
6. **Hard ceilings beat soft silence.** `maxStacks`, rate/damage soft-caps, and unique flags bound snowball so universal draft cannot explode TTK.

### Offer policy (elegant asymmetry)

| Role | How determined | Offers | Pool bias |
|------|----------------|--------|-----------|
| **All players** | Always | `DRAFT_OFFER_COUNT` (3) | Base pool after unique/maxStacks filters |
| **Catch-up tier** | Ranked by round outcome / score / streak (see below) | Same count | **Richer** sample: higher weight on impact/utility/wild; optional guaranteed non-duplicate bucket diversity |
| **Winner tier** | Round `winnerPlayerId` (or score leader on multi-kill edge cases) | Same count | **Stable** sample: normal weights; may include “crown” flex later (phase 2) |

**Catch-up eligibility (deterministic, FFA-safe):**

```
catchUp(pid) =
  pid !== winnerPlayerId
  OR (winnerPlayerId == null && true)  // draw: everyone equal base; no extra bias needed
```

For FFA with N>2, “loser-only” was already “everyone but one.” Universal draft changes **one seat**: the winner. That single seat is the entire product bug.

Optional refinement (phase 2, only if playtests demand):

- **Streak pity:** players on a ≥2 round loss streak get one “high-impact” forced bucket in their 3.
- **Leader crown:** winner’s third offer may be from a small `crown` subset (cosmetic power / flex, not raw DPS) — only if catch-up alone feels flat for winners.

### Power bounds (non-negotiable math)

These already exist in spirit; this goal makes them **the** snowball solution:

| Guardrail | Rule |
|-----------|------|
| `maxStacks` | Enforced at **offer roll** (already) and at **apply** (assert / no-op if bypassed) |
| `unique` | Never offered if owned |
| Fire-rate / projectile-count soft caps | Keep 1.5s TTK floor for baseline 1v1 pre-chaos (existing combat-balance skill) |
| No draft denial for balance | **Forbidden** as a design tool after this goal ships |

### Bots

- Bots receive offers under the same `enterDrafting` rules (including winners).
- Bot picker: first legal offer within `DRAFT_BOT_PICK_MS` (existing early-return when no offers — delete that path’s “winner has no offers” assumption).
- Bots must **not** be the only ones testing winner-draft UI.

---

## Architecture

### Single source of truth

```
client/src/sim/round.ts          enterDrafting(), draft role helpers
client/src/sim/data/cards.ts     pool + buckets + maxStacks + unique
client/src/sim/weaponBuild.ts    resolution (unchanged contract)
client/src/sim/World.ts          phase wiring only; no second draft policy
client/src/sim/RoundOrchestrator.ts  auto-pick / resolve
UI: CardDraftOverlay             keys off draftingOffers only
Bots: botDriver / draft AI       keys off draftingOffers only
Net: server authority already owns round transitions — no protocol change
     if offers map simply includes winner id
```

**Invariant:** If `round.phase === "drafting"`, then  
`Object.keys(draftingOffers)` is exactly the set of draft-eligible player ids, and **winner ∈ that set** when `winnerPlayerId` is non-null (unless winner left the match).

### Module design (clean seams)

```
round.ts
  enterDrafting(state, players, tick, rng)
    → buildEligibleIds(state, players)      // pure
    → classifyDraftRole(pid, state)         // "standard" | "catch_up" | "winner"
    → rollOffers(pid, role, player, rng)    // pure; uses weighted pick
    → emit card-offered events for each

  draftWeights.ts  (new, small)
    weightsForRole(role): bucket → weight
    pickOffers(pool, count, rng, weights): id[]
```

Keep `enterDrafting` readable: eligibility and weighting split so tests don’t need the whole phase machine.

### Determinism contract

- Sorted player id iteration (already).
- RNG advances only inside offer rolls; role classification is pure from `RoundState` + scores.
- No `Date.now`, no client-side offer generation.
- Winner inclusion must not change offer sequences for other players in a way that breaks replay: **fix order of RNG consumption** — process ids in sorted order; winner’s roll is just another seat in that order (today winner is skipped, which *already* shifts the RNG stream for lower-sorted losers when winner id sorts early). Document the stream change in changelog; update golden tests.

### UI / UX contract

- Overlay shows picker iff `draftingOffers[localId]?.length > 0`.
- Winner must see the same draft UX (no “you won, waiting…” dead air without a picker).
- Optional one-line banner: “Catch-up draft” vs “Victory draft” (cosmetic only; same 3-card grid).
- Timer / auto-resolve unchanged (`DRAFT_WINDOW_MS`).
- Mobile compact cards remain valid for 3 offers.

### Net / authority

- No new messages. Snapshot already carries round + offers + cards.
- Server is sole writer of `enterDrafting` results.
- Clients never invent offers for the winner “for juice.”

### Feature flag (ship safely)

```ts
// constants or round.ts
export type DraftPolicy = "universal_v1" | "loser_only_legacy";
// default: "universal_v1"
// env / match config: DRAFT_POLICY=loser_only_legacy for A/B on live host only
```

Legacy path remains one function branch for one release window, then deleted.

---

## Doc conflict resolution (mandatory deliverable)

| File | Action |
|------|--------|
| `CLAUDE.md` | Add 3 bullets under mechanics: universal draft; catch-up = weight not silence; maxStacks is snowball tool |
| `docs/jakesjam-design-pillars.md` | Rewrite pillars 1–2 and match loop; delete “die → draft” primary; death is not the picker |
| `docs/game-design-document.md` | Align upgrade table to universal + catch-up weights; banner old ROUNDS-only sections |
| `README.md` | Controls + loop one-liners match CLAUDE (also fix jetpack/parry while touching) |
| `docs/escalation-engine-goal.md` | This file — conflict winner for progression |
| Stale comments | `OnlineMatchScene` Ability/parry comments; any “winner sits out” comments in sim/UI |

**Rule:** After ship, if a doc contradicts this goal on draft policy, the doc is wrong.

---

## Implementation plan (phased, elegant)

### Phase 0 — Lock (docs only, same day)

- [ ] Land this goal file.
- [ ] Patch `CLAUDE.md` + pillars loop to universal doctrine (no code yet).
- [ ] Write the acceptance playtest script (below) into `docs/playtest-escalation.md` (short).

### Phase 1 — Sim core (half day)

- [ ] `buildEligibleIds`: all roster players (not `!== winner`).
- [ ] `classifyDraftRole` + `draftWeights.ts` (catch_up vs standard; winner uses standard).
- [ ] Keep `maxStacks` / `unique` filters.
- [ ] Update `enterDrafting` tests: winner has offers; catch-up still includes all non-winners; draw = all standard.
- [ ] Update any test that asserted winner excluded.
- [ ] Changelog note on RNG stream change for replays.

### Phase 2 — Wire + bots + UI (hours)

- [ ] Confirm UI keys only on offers map (no winner-hide branch).
- [ ] Bot draft: winner bots pick; remove “no offers → skip forever” assuming loser-only.
- [ ] Banner strings optional.
- [ ] `DRAFT_POLICY` flag default `universal_v1`.

### Phase 3 — Snowball math audit (half day)

- [ ] Re-run combat-balance TTK band with **winner drafting every round** for 5 rounds of stacked offers (scripted).
- [ ] Tighten `maxStacks` / rate caps if post-universal TTK falls below floor.
- [ ] Kill remaining trap cards if any reappear under higher draft frequency.

### Phase 4 — Live funnel gate (non-skippable)

- [ ] Deploy via real path (`bun run host:public` / Tailscale funnel — not only Playwright).
- [ ] Human playtest checklist (below) signed off.
- [ ] Only then delete `loser_only_legacy` branch.

### Phase 5 — Polish (optional)

- [ ] Crown pool for winners.
- [ ] Streak pity weights.
- [ ] Telemetry: drafts_seen / drafts_picked / cards_by_role per match (if analytics exists).

---

## Test architecture

### Unit (must be green)

| Case | Expect |
|------|--------|
| 2p, P1 wins | Both have `draftingOffers` length 3 (or pool-limited) |
| 4p FFA, one winner | 4 offer entries |
| Draw (`winnerPlayerId` null) | All draft; all `standard` role |
| Winner holds unique card | Still offered other cards; unique not re-offered |
| At maxStacks on card A | A not in offers |
| RNG determinism | Same seed + state → identical offers map |
| Legacy flag | `loser_only_legacy` restores previous eligibility |

### Integration / parity

- Round phase machine: `fighting → round_over → drafting → countdown` with winner included.
- Auto-resolve at window expiry applies cards for winner too.
- Bot match: no stuck drafting phase waiting on silent winner.

### Forbidden “green but unplayable”

Phase 4 live checklist is part of **done**. Unit green alone does not close the goal (lesson from Zig thrash).

---

## Acceptance — it’s done when

### A. Product (human)

On the **real** host URL, 2–4 humans or 1 human + bots, ≥5 rounds:

1. **Winner still drafts** every round they remain in the match.  
2. Asked after a win streak: *“Did your gun get more interesting while you were winning?”* → **Yes.**  
3. Asked after a loss streak: *“Did you feel you could come back?”* → **Yes** (catch-up weights + caps, not “I got cards and the leader got nothing” as the only story).  
4. No round stuck on draft because someone had zero offers.  
5. TTK still feels snappy; no infinite spray from unbounded stacks.

### B. Engineering

1. `bun test` client + server green (including updated draft tests).  
2. `bun run typecheck` green.  
3. `CLAUDE.md` + pillars + README + this goal agree on the loop.  
4. Grep clean: no “winner sits the draft out” in active code paths (legacy flag excluded).  
5. `DRAFT_POLICY=loser_only_legacy` either removed or documented as deprecated.

### C. Elegance bar

- One function family owns eligibility (`round.ts` / `draftWeights.ts`).  
- UI has no special-case “if winner hide picker.”  
- Catch-up is data (weights), not control flow that deletes seats.  
- No second draft system for Practice / FTUE — they observe the same `enterDrafting` or don’t draft at all.

---

## Anti-patterns (do not reintroduce)

1. **Winner silence** as balance.  
2. **Death-draft primary** without rewriting the entire round machine and UI (out of scope).  
3. **Per-scene draft policy** (MatchScene vs OnlineMatchScene).  
4. **Client-generated offers** for juice.  
5. **Fixing snowball by deleting content** (cards, chaos, crown) instead of caps.  
6. **Zig port of draft policy** “for consistency.”  
7. **Docs that still show die → draft → respawn as the live loop.**  
8. **Declaring done from unit tests only.**

---

## Relationship to other goals / systems

| System | Relationship |
|--------|----------------|
| Practice Zone goal | No draft in pure movement zone; if practice ever shows cards, use same apply path, not a fork |
| FTUE / bot warmup | Teach draft once with universal rules; don’t teach “winners wait” |
| combat-balance-ttk skill | Owns numbers; this goal owns *who rolls*; Phase 3 couples them |
| Aegis / movement | Orthogonal; do not bundle |
| Clips / TikTok / Stripe | Orthogonal product surface; escalation goal does not depend on them |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Universal draft re-opens spray snowball | Phase 3 TTK script + maxStacks before funnel |
| RNG / replay breaks | Explicit test + changelog; accept stream break once |
| Players feel “everyone always same power” | Catch-up weights + first-blood + shrink zone already differentiate |
| Scope creep into death-draft | Explicitly out of scope; reopen only as new goal |

---

## Success metric (north star, not vanity)

**Drafts experienced per human per match** rises for the **score leader** from ~0 (after round 1 wins) to **~1 per round**, without average TTK collapsing below the combat band.

If that metric moves and the playtest questions pass, the 10× content ROI is real: existing cards get played by the players who stay.

---

## One-line definition of done

**Everyone escalates every round; losers escalate harder; winners never go content-dark; caps hold the math; live humans confirm it on the real host.**
