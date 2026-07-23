# Cohesion — one truth, one voice, one finished loop

**Status:** North star + staged build contract, same discipline as
`docs/venue-goal.md`. Child of `docs/design-axioms.md` (A2: honest-partial
over padded), `docs/chassis-design-axioms.md` (CA1-CA6), `docs/ui-axioms.md`,
`docs/classes-goal.md`, and `docs/six-axes-goal.md` (whose Phase 4 human gate
this doc absorbs as Pillar 4). Written 2026-07-23 after the max-health
divergence bug proved the display layer and the sim have been telling
different stories.

**One sentence:** every number the game shows is a number the sim enforces,
every word the game speaks is in one register (crucible during, gravity
after), every rule announces itself at its site, every started loop closes,
and the repo's docs agree with its code — with every claim below verified by
a tool, not a vibe.

**Completion discipline (hard rule, learned the hard way):** every
acceptance test in this doc is verifiable by tool calls — `bun test`, `tsc`,
`grep`, `curl`, a Playwright screenshot, a replay render. Tests requiring
Jake's eye are labeled **AWAITING JAKE** and are *evidence to collect, never
gates that block the loop*. If a condition can only be satisfied by a human,
it does not belong in an acceptance list.

**Why this doc exists (the finding):** on 2026-07-22 Jake caught Kindled
spawning at 100/125. The fix revealed the pattern: `characters.ts` promises
four physical class identities (maxHealth 100/125/85/100, moveSpeed
1/0.88/1.14/0.96, sizeScale 1/1.18/0.92/1.05, recoilControl 1/1.25/0.9/1)
and the sim enforced **none of them** — health was hardcoded to 100 at nine
sites (fixed), and speed/size/recoil still never leave the display table.
`resolvePlayerBuild` starts every class at `moveSpeedMultiplier: 1`
(cards-only), `weapon.ts` admits in a comment "the sim can't see
per-character sizeScale", and recoil control multiplies nothing. The four
chassis are currently the same body wearing four costumes. Cohesion starts
with making the costume true.

**Ordering:** P1 first (it changes what "balance" even measures). P2, P3, P5
are display/docs-only and run in parallel with anything. P4 runs only after
P1 merges — balancing before the chassis is real would be balancing fiction.

**Contested calls — defaults taken** (each reversible, each isolated;
Jake can overrule any without unwinding the rest):

| # | Call | Default taken |
|---|---|---|
| 1 | sizeScale reaches hitboxes (Kindled genuinely bigger target, Interstice smaller — a real gameplay change) | YES — it's the promise the roster card already makes; shipped as its OWN commit behind one constant (`CLASS_HITBOX_SCALE_ENABLED`) so Jake can feel it in isolation on :8088 and flip it off with one line |
| 2 | In-play register | **DECIDED BY JAKE 2026-07-23**: gnostic, optimistic, self-empowering — the battleground where *iron begets iron*. NOT tribunal/war-crimes deadpan during play. |
| 3 | Where the war-crimes gravity lands | End-of-match surfaces only (results overlay, final-blow recap, run epitaphs) — the *record* of what was done. Never mid-fight, never in the draft. |
| 4 | `characters.ts` numeric stats become re-exports of the sim table | YES — one table, sim-owned; display imports it. Two tables that must be kept in sync is how the 125hp bug happened. |
| 5 | Stale docs archived, not deleted | YES — `docs/archive/` with a one-line staleness banner each; history stays greppable |

**What is deliberately NOT built:** no new mechanics anywhere in this doc
(the language pass is display-only, ids are wire-load-bearing and never
change); no fifth class, no new VFX categories (P3 reuses the existing
construct/particle/status grammar); no accounts or persistence; no Zig ABI
changes (class speed folds in TS-side after `createWeaponBuild`, the exact
pattern the dashCharges floor already established — the wasm-mode
`USE_WASM_STEP_WORLD` parity deferral is recorded beside the existing B2
gap, same as six-axes-goal.md did).

---

## Pillar 1 — Chassis truth (the sim enforces what the roster promises)

**Outcome:** one sim-owned class stat table; movement speed, hitbox size,
and recoil control are real per-class physics; the display layer *reads*
that table instead of duplicating it.

**Acceptance tests**

1. **One table.** `client/src/sim/data/cardTypes.ts` (beside
   `baseMaxHealthForArchetype`, which merges INTO it) exports
   `chassisStatsForArchetype(characterId)` returning
   `{ maxHealth, moveSpeedMultiplier, sizeScale, recoilControlMultiplier }`
   for all four archetypes. Unit test pins all sixteen values.
2. **Speed is real.** `resolvePlayerBuild` folds the class
   `moveSpeedMultiplier` into the build AFTER `createWeaponBuild` (the
   dashCharges-floor pattern — Zig `createWeaponBuild` parity untouched).
   Tests: a bare Kindled build resolves `moveSpeedMultiplier ≈ 0.88`, bare
   Interstice `≈ 1.14`, bare Geometrician exactly `1`; a speed card stacks
   via `orthogonalScale` on top of the class factor, and the existing clamp
   (0.45–1.55) still holds. The `World.ts` speed product (`slowMul * … *
   build.moveSpeedMultiplier`) needs zero changes — an integration test
   proves a bare Interstice outruns a bare Kindled over 60 ticks of
   held-right on flat ground.
3. **Recoil control is real.** `stepWeapon`'s recoil impulse divides by the
   class `recoilControlMultiplier`. Test: one shot fired by a bare Kindled
   imparts less |self-knockback velocity| than the same shot from a bare
   Geometrician; Recoil Step's existing rider still composes.
4. **Hitboxes are real (own commit, flagged).** `playerHitboxAABB` /
   headshot zone scale by class `sizeScale` behind
   `CLASS_HITBOX_SCALE_ENABLED = true`. Tests: Kindled AABB is strictly
   larger than Geometrician's, Interstice strictly smaller; a ray that
   grazes past a Geometrician at its edge HITS a Kindled standing in the
   same spot. Visual/hitbox agreement: the rig's render scale
   (`PLAYER_VISUAL_SCALE × sizeScale`) and the hitbox use the SAME sizeScale
   source — grep proves no second hardcoded scale table.
5. **The display reads the sim.** `client/src/game/data/characters.ts`
   imports `chassisStatsForArchetype` for every numeric stat — grep: the
   literals `125`, `0.88`, `1.18`, `1.25`, `1.14`, `0.92`, `0.9`, `0.96`,
   `1.05`, `85` appear in exactly one file (the sim table). The
   `kitSummary` strings' numbers ("125hp", "85hp") are asserted against the
   table by a unit test so copy can never silently drift again.
6. **Nothing else regresses.** Full client + server suites pass; the
   balance-sim harness (`scripts/balance-sim.ts`) still runs to completion
   on the new physics.
7. **AWAITING JAKE:** Kindled feels heavy, Interstice feels darting, on
   :8088 — evidence: one clip of each, side by side.

## Pillar 2 — One voice (iron begets iron; the record at the end)

**Outcome:** two registers, one arc. During play and drafting the game
speaks gnostic, optimistic self-empowerment — contest as crucible, growth
through pressure, *iron begets iron*. At match end, the tone turns to the
weight of the record — the aftermath reads like testimony to something
enormous. (Register decided by Jake 2026-07-23, superseding the earlier
"war-crimes language pass" direction — the gravity survives, but it lands
ONLY at the end.)

**Register spec (the two voices, so any session can write in them):**

- **In-play (crucible):** second person, earned, forward-leaning, terse.
  The draft is arming, not transgressing. Pressure is a teacher; the
  opponent is the whetstone. Never jokey, never grimdark, never tribunal.
  Touchstones: *"Iron begets iron."* / *"What breaks you, arms you."* /
  *"You are more than you were."*
- **End-of-match (the record):** the enormity of what was done, stated
  plainly. Tallies read as testimony; the fallen get dignity; the victor's
  line is ascendant, not gloating. Touchstones: *"Let the record show."* /
  *"Nine unmade. One refined."*

**Acceptance tests**

1. **Scope is display-only.** Card `id`s byte-identical before/after (grep
   diff of the id list); the Zig codegen (`cards_gen.zig`) is regenerated
   with zero mechanical field changes — only display strings differ.
2. **The pass covers every in-play surface:** all card names / descriptions
   / flavorText in `cards.ts` (all rarities), the draft offer UI, the
   BuildChangeToast, ability/axis chip labels, death-overlay subtitle. A
   copy inventory table (surface → old string → new string) lands beside
   this doc as `docs/voice-pass-inventory.md` so the review is one file.
3. **The gravity surfaces:** `MatchResultsOverlay` (cycle end) and the
   final-blow / run-summary lines rewritten in the record register.
   Mid-fight surfaces are grep-clean of record-register vocabulary (the
   words "record", "unmade", "testimony" do not appear in HUD/toast/draft
   strings).
4. **Voice lint.** A unit test holds a small banned-list per register
   (in-play strings may not contain tribunal vocabulary: "prohibited",
   "tribunal", "war crime", "illegal"; jokey filler stays out of both) —
   cheap, but it stops regression-by-vibes.
5. **AWAITING JAKE:** copy sign-off, same as the six-axes naming
   sign-off precedent ("Interstice Writ" / "Shelter Writ").

## Pillar 3 — Legibility completion (every rule announces itself)

**Outcome:** doctrine #10 ("at every point it should be clear what's going
on") holds for all four classes at equal polish — the last un-polished
class gets its VFX pass, the last silent event gets its sound, and every
live axis/ability effect has a world-space read at its site.

**Acceptance tests**

1. **Interstice VFX pass** (the one class without one — chassis workboard
   4.1): melee arc, Paper Double spawn/burst, Razor Route, Ghost Guard get
   site reads built from the existing construct grammar
   (`LightConstruct.ts` / `ConstructVfxController`), cyan per CA4's earned-
   color law, tether shapes only where CA5 allows. Verified in the live
   construct harness (the established `constructHarness.ts` loop) with
   screenshots; no shared-pool starvation (the tether lesson).
2. **The launch cue exists.** `SimEventRouter.ts`'s `TODO(audio): rip a
   dedicated launch cue` is closed with a REAL ripped recording
   (never-synthesize hard rule), wired to the body-flung event; grep: that
   TODO is gone.
3. **Site-read audit table.** A table in this doc's companion
   (`docs/legibility-audit.md`) walks every live axis effect + class active
   (six-axes Layer 1 + the 4 catalogs) → its world-space read → the file
   that draws it. Every row either names a shipped read or becomes a work
   item IN the table — no silent gaps. Grep-enforceable rows (event name →
   presenter case exists in `SimEventRouter`/`eventPresentationRegistry`)
   get a unit test.
4. **Statuses on the body.** The emission-goal P2 leftover — in-world rig
   status marks (burn/freeze/slow visible on the fighter itself, not only
   the nameplate row) — ships or is explicitly re-deferred IN this doc with
   a reason. No third state.
5. **AWAITING JAKE:** a re-tape of one full fight per class reads clean at
   a glance — the footage-study loop is the evidence collector.

## Pillar 4 — Close the fight loops (balance on the real chassis)

**Outcome:** with the chassis physically real (P1), one tuning pass across
all four classes lands inside the guardrails, and the Six Axes Phase 4
human gate — the last open acceptance row in six-axes-goal.md — closes.

**Hard ordering: this pillar does not start until Pillar 1 is merged.**

**Acceptance tests**

1. **TTK bands hold on the new physics:** the weaponBuild TTK guardrails
   (`TTK_FLOOR_S`/`TTK_CEILING_S`) pass for every class's baseline
   (Kindled's 125 pool and real hitbox size included — effective-HP math in
   `combat.ts`'s WARD comments updated to cite the enforced numbers).
2. **Headless matchup matrix:** `scripts/balance-sim.ts` runs a
   round-robin of bare-class bots (all 6 pairings + mirrors) and the win
   rates land in a declared band (default 35–65% per pairing) — the report
   is committed as the tuning evidence, re-runnable in one command.
   *(FINDING 2026-07-23, recorded during execution: the current harness
   CANNOT measure this. Its one shared heuristic bot policy resolves every
   cross-class cell to a hard 0%/100% — verified identical at the pre-P1
   commit (07ee723, isolated worktree run) and post-P1, so the determinism
   is a policy artifact, not a balance signal; only the mirror cells carry
   variance. Tuning class stats to move this needle would be tuning to a
   broken instrument. PREREQ added: the harness needs a per-class-capable
   policy — at minimum, range-keeping for Kindled melee and
   evasion-vs-homing for the Syzygist tendril matchups — before the band
   is meaningful. TTK guardrails (row 1) remain valid and pass.)*
3. **Bot parity:** worldBots' melee-aware ranges still hold for the
   re-tuned classes (existing bot tests pass; a soak on :8088 shows all
   four bot classes scoring within a declared spread).
4. **Syzygist color-slot decision** (chassis workboard 3.5) is made and
   recorded in `chassis-design-axioms.md` — one line, Jake's call,
   collected here so it stops floating. **AWAITING JAKE.**
5. **Six Axes Phase 4 — AWAITING JAKE:** ≥5 rounds on play.elyad.io
   drafting ability cards live; the evidence is his verdict plus the match
   replay. Never a loop gate (the /goal deadlock lesson).

## Pillar 5 — Repo truth (the docs agree with the code)

**Outcome:** a newcomer (or a fresh session) reading `docs/` cannot be
misled about what the game is or what remains.

**Acceptance tests**

1. **Stale docs archived:** `release-readiness-checklist.md`,
   `milestone-roadmap.md`, `NEXT_ACTIONS.md` move to `docs/archive/` with a
   one-line banner each ("superseded by cohesion-goal.md, kept for
   history"). *(Acceptance made precise 2026-07-23 during execution: a
   blanket "no live doc mentions npm/Convex" grep is unachievable and
   wrong — ~20 docs mention them as history (changelog, GDD) or as the
   still-present optional `convexClient`. The enforced claim is:) * the
   three docs above — the ones presenting npm/Convex/gsr as CURRENT
   practice — are in `docs/archive/` with banners (grep: each banner
   present), and `STATE-OF-PLAY.md` states the current stack explicitly
   ("No npm. No Convex backend") so the first doc a reader meets corrects
   the record.
2. **One current-truth doc:** `docs/STATE-OF-PLAY.md` (one screen, honest):
   what's live on play.elyad.io, what the active goal docs are (this one,
   venue-goal, six-axes), what's deferred with links. The "what needs
   finishing" question gets answered by ONE file from now on.
3. **This doc stays true:** each pillar's completion flips a status line at
   the top of this file in the same commit that finishes it — grep-
   checkable (`P1: DONE`-style), no separate tracker.

---

## Status

- P1 chassis truth: **DONE (code)** 2026-07-23 — commits 52890d8 (table +
  speed + recoil + display reads sim) and 8c868bd (flagged hitbox scaling);
  P1.7 feel-check AWAITING JAKE on :8088
- P2 one voice: **NOT STARTED** (register decided 2026-07-23)
- P3 legibility: **NOT STARTED**
- P4 fight loops: **UNBLOCKED** (P1 merged) — matrix run 2026-07-23:
  harness found incapable of cross-class measurement (see P4.2's FINDING;
  per-class bot policy is the new prereq); TTK guardrails pass;
  Syzygist color + Phase 4 rows AWAITING JAKE
- P5 repo truth: **DONE** 2026-07-23 — archive/ + banners + STATE-OF-PLAY.md
