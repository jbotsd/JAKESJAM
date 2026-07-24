# The Convergence — one big /goal, built to be run under ultracode

**Status:** Orchestration contract for finishing the game's core in one
sustained multi-agent push. Written 2026-07-23. This doc does not replace
`cohesion-goal.md` — it ORCHESTRATES its remaining pillars (P2/P3/P4)
alongside the Zig-first suite as parallel tracks, sized and structured for
workflow fan-out (many agents, isolated worktrees, adversarial verify).
Scope call taken by default (Jake was AFK at the fork): **full
convergence** — drop a track by deleting its section, nothing else
depends on it.

**One sentence:** four parallel tracks — Zig-first determinism (Z), the
two-register voice pass (V), legibility completion (L), and the balance
instrument (B) — each decomposed into fan-out-able, tool-verifiable units,
with every human judgment collected as an AWAITING-JAKE evidence row and
never a loop gate.

**Completion discipline:** identical to cohesion-goal.md's hard rule —
tool-verifiable acceptance only; AWAITING JAKE rows are evidence to
collect, never conditions a loop waits on (the /goal-deadlock lesson).

**The honesty header (read before selling this to yourself):** Track Z is
NOT a speedup. The repo's own measurements (zig-step-world-parity-goal.md)
put wasm-swapped stepPlayer 6% SLOWER than TS-native and Zig RNG 3× slower;
the 2026-07-18 perf audit found the real lag was algorithmic and largely
fixed it. Zig-first buys **determinism** — divergence-free prediction,
replay/re-sim fidelity, cross-host portability, option value on server
scale. Browser frame-rate lives in `RENDER_OVERHAUL_PLAN.md` (baked tier),
which is deliberately NOT a track here — add it as Track R only if the
motive really is frames, and say so out loud when you do.

---

## How to run this under ultracode (the orchestration contract)

- **Opt-in:** start the session with the `ultracode` keyword (or say "use
  a workflow"), then `/goal` this doc. Without that opt-in the tracks
  still execute fine as ordinary sequential sessions — the decomposition
  below is the same either way.
- **One workflow per phase, Jake-in-the-loop between phases.** Never one
  mega-workflow for the whole doc: run a fan-out, read its results, decide,
  run the next. (Understand → port → verify → synthesize, per track.)
- **Worktree isolation for anything that writes.** Zig ports and VFX work
  run in per-agent worktrees; merge is a distinct, single-agent step.
- **Single-writer law for hot files.** `cards.ts` (Track V) and
  `world.zig` (Track Z) are single files many agents will want: agents
  PROPOSE (structured patches / copy tables via schema output), ONE
  assembler agent applies. Never let N agents edit the same file in place.
- **Adversarial verify is mandatory for parity claims.** Any "Zig now
  matches TS" claim gets an independent refuter agent trying to find a
  diverging seed/tick before it counts. Loop-until-dry: the divergence
  sweep keeps spawning until 2 consecutive rounds find nothing new.
- **Every workflow logs dropped coverage.** No silent caps (top-N cards,
  sampled seeds) — if a run bounded anything, the log says what was left.

---

## Track Z — Zig-first suite (determinism, the spine)

Ground truth from the 2026-07-23 audit: prod runs TS `stepWithRuntime`
with Zig swap modules (rng/collision/player-physics/trig). `step_world`
capability was rebuilt on main through parity-goal Phases 0–4e (11,891
lines of Zig, draft.zig, weapon_build resolver, most abilities);
`USE_WASM_STEP_WORLD` has been OFF since the 2026-07-06 revert, and the
flip is human-locked in matchHost.ts by Jake's own comment.

**Z0 — Harvest the orphan branch first (never re-derive).**
`zig-e2e/full-cutover-2026-07-14` (13 commits, 113 behind main) holds:
the multi-seed TS-vs-Zig divergence-sweep harness (`5e1676a`), the
shrink-zone storm port (`9aeabaa`), the sudden-death trigger + the
scores-reset-to-0-every-tick step_world bug find (`02b74f5`), and
byte-identical muzzle geometry (`888345c`). Acceptance: each is PORTED to
main (adapted, not blind cherry-picked — 113 commits of drift) with its
tests; the score-reset bug is verified fixed on main's step_world; the
sweep harness runs green in CI-style one command. The branch is then
deleted (its value extracted, its staleness a trap).

**Z1 — Close the named deferrals.** One pipeline item each, port → unit
test → adversarial parity verify, worktree-isolated: ally substrate
(`isAlly` + Aegis Share / Rally Light / Borrowed Time / Glass Ward),
recoil_step, team peel, ninja dash i-frames, Kindled Ward partial
mitigation, hitscan resolution (TS World.ts:4514's resolveHitscanShot),
sizeScale in Zig combat hitboxes (combat.zig's fixed constants vs main's
class-scaled TS boxes), six-axes axis payloads crossing
`player_fire_config`. Acceptance per item: the STUBBED/deferral comment in
world.zig is gone, a dedicated test exists, and the per-entity FNV hash
parity suite passes with the system exercised.

**Z2 — Server integration honesty.** The wasm path stops being a
second-class citizen: the server's drafting overlay retires onto
`draft.zig` (today "the Zig round machine skips drafting" despite
draft.zig existing); wasm SimEvents stop being dropped (today all are
discarded except round/draft overlays); the hangout hard-pin to TS is
either lifted or re-recorded with a current reason. Acceptance: grep — the
overlay branch and the event-drop branch are gone or gated with a dated
comment; venue + private-room suites pass in wasm mode.

**Z3 — Sweep until dry + honest bench.** The Z0 harness runs N seeds × M
ticks across all four classes with ability casts until 2 consecutive
expansion rounds find zero divergence (loop-until-dry, logged coverage).
Then `tools/wasm-bench.ts` re-runs fresh and
`zig-wasm-perf-baseline.md`'s staleness banner is replaced with the new
numbers — whatever they say. If wasm is still lateral-or-slower, that gets
written down; determinism remains the justification.

**Z4 — The flip. AWAITING JAKE.** `USE_WASM_STEP_WORLD=1` on :8088 for a
real session, Jake plays it. The matchHost.ts lock is his; evidence is his
verdict + a soak with zero reconcile-hash mismatches in the server log.

## Track V — One voice (= cohesion-goal.md Pillar 2, orchestrated)

Register spec and acceptance live in cohesion-goal.md P2 (crucible
in-play / the record at match end, decided 2026-07-23). Ultracode shape:
fan out the ~65-card copy pass in batches of ~10 with the register spec in
every prompt (schema output: id → old/new name, description, flavor);
judge-panel each batch against the spec (optimism, terseness, no tribunal
vocabulary in-play); ONE assembler applies to cards.ts; voice-lint test +
`docs/voice-pass-inventory.md` assembled for Jake's sign-off (AWAITING
JAKE). End-of-match record surfaces are a separate small batch with their
own judge round.

## Track L — Legibility (= cohesion-goal.md Pillar 3, orchestrated)

Fan-out: one agent per live axis effect / class active builds the
site-read audit row (event → presenter case → file:line, grep-verified);
gaps become work items in the same table. Interstice VFX pass runs in the
established construct harness with screenshot evidence; the launch-cue rip
(yt-dlp, canonical recording, never synthesized) closes the last
TODO(audio). AWAITING JAKE: per-class re-tape reads clean.

## Track B — The balance instrument (= cohesion-goal.md P4.2 prereq)

The 2026-07-23 finding stands: the shared heuristic bot policy resolves
every cross-class cell to a hard 0%/100% (verified pre- and post-chassis
— it's a policy artifact). Build the per-class-capable policy
(range-keeping for Kindled melee, evasion vs homing tendrils, class-aware
engagement distance — worldBots' melee-aware ranges are prior art), then
re-run the matrix. Acceptance: mirror cells carry variance AND at least
half the cross-class cells leave 0/100; then and only then does the
35–65% band become a tuning target. Feeds cohesion P4.1's TTK rows, which
already pass.

---

## Cross-track gates (all AWAITING JAKE, collected not waited-on)

1. Chassis feel-check on :8088 (cohesion P1.7 — already live).
2. Voice-pass sign-off (V).
3. Syzygist color-slot call (cohesion P4).
4. Six Axes Phase 4 playtest (cohesion P4).
5. The wasm flip (Z4).

## Status

- Z0 harvest: **COMPLETE** 2026-07-23 — all four orphans + the meter's
  findings landed and merged. Z0a: score/target_score patchers +
  sudden-death trigger + multi-seed divergence sweep (bebc4cd, e73c3d5).
  Z0b: fast-respawn round semantics (f0ba9a8 — incl. a timeout-path bug
  fix and chassis-aware respawn health), byte-identical muzzle geometry
  (7a9abe0, entity 624→632), shrink-zone storm with damage moved into
  Zig on evidence the wasm path previously SKIPPED it (f2129de). Sweep
  before→after: worst seed 1067px/≤3 alive-mismatches → 329px/≤1; the
  round-cycling oscillation is gone; table lives atop
  multiSeedDivergence.test.ts. The orphan branch is deleted — fully
  extracted. Z0c MERGED (dcae7f0 recoil substrate — bit-identical kick,
  closed the recoil_step Phase 4a deferral; b86a217 tick-order reorder —
  tick-T integration now equal both sides). Meter lesson recorded: the
  sweep's end-to-end numbers WORSENED (329→1696 worst) because removing
  compensating errors exposed the true gap — per-shot samples are
  equal-or-better; the blowup starts at the first death-timing
  disagreement, driven by TS's first-blood 1.15× speed boost having no
  Zig mirror (World.ts:2532 vs a lone comment). Z0d MERGED (8336c53):
  first-blood fully mirrored + wire event, parity proven at micro level
  — honest miss at the meter, but its probe produced Z0e. **Z0e MERGED
  (576a82d) — hypothesis CONFIRMED, the harvest's biggest win:**
  packWorldState never wrote the player_movement parallel array and
  BOTH full-sync hosts repack every tick, so live Zig authority always
  ran movement-amnesiac — air-accel on the ground, no ground friction,
  no ground jumps. **This was a real live wasm-mode bug, a direct
  mechanical explanation for part of the 2026-07-06 "Zig movement feels
  wrong" revert.** Fix: movement memory bridged through the state
  (off-wire), proven by a mid-flight re-pack lockstep test. Sweep
  finals: 1696/1562/1246/1667/1147 → 376/196/450/280/378 px — now
  beating the orphan branch's own steady state; t=60 deltas 0-23px.
  Recorded next: (a) death-tick disagreements × greedy respawn-seat
  choice (header hypothesis), (b) melee_swing memory still zeroed per
  pack (sibling finding — melee FSM can't leave windup on the wasm
  path; a Z1 item). NOTE for operators: sim.wasm is a
  gitignored build artifact — after pulling Zig changes, `zig build`
  before running wasm suites or they fail on the stale binary.
- Z1 deferrals: **Z1a DONE + MERGED** 2026-07-24 — three
  items, one commit each: (1) melee_swing bridged across the full-sync
  repack (Z0e's recorded sibling — the swing FSM survives every pack,
  melee resolves same-tick both sides; meleeSwingMemoryBridge.test.ts,
  verified failing 2/3 on the old pack path); (2) sizeScale mirrored into
  Zig combat hitboxes (combat.zig combatHitboxScale — melee arc,
  dash-through, projectile, fire-patch; movement box deliberately
  untouched; graze-parity gate + two residuals pinned honestly: the
  30×56-vs-26×56 projectile width approximation and Zig's missing
  headshot band, asserted at exact numbers); (3) ally substrate + all
  FOUR ally-targeted abilities (isAlly/findNearestAllyIdx/
  hasRallyLightSource + Aegis Share/Rally Light/Borrowed Time/Glass Ward,
  PlayerEntity 632→656 with bridged tail, chassis-aware requireInjured,
  debt resolution pass; ride-along fixes: haste move-mul missing from
  Zig's speed_mul, self_lattice's missing has_syz_ward flag). Meter
  byte-identical (376.5/196.2/449.6/280.4/378.0) — EXPECTED, the sweep's
  all-balanced FFA non-melee bots can't trigger any of the three (header
  has the full verdict). NEW Z1a findings for the next slice, same
  wipe-on-repack class: (a) the whole Zig-only PlayerEntity tail span
  [384,620) — every Phase-4 ability window is one-tick-only under
  full-sync; (b) player_equipped_actives zero-filled per pack — no
  ability castable at all on the live wasm path; (c) client
  runWasmStepSync writes fire configs BEFORE pack (server does it after,
  correctly). **Z1c DONE (partial) 2026-07-24** — hitscan resolution +
  headshot band CLOSED (two commits, 8f66981/2a57677): ResolvedFireConfig
  grew 248->256B for a bridged `delivery` byte (priest/paladin class-gated
  base delivery, matching baseWeaponForClass), world.zig's fire site now
  branches on it — `resolveHitscanFire`/`applyHitscanHitOnPlayer` mirror
  TS's resolveHitscanShot/resolveRangedHit (headshot/chaos/vulnerability/
  ward/parry/Self-Lattice/shield/first-blood/elemental, same-tick,
  bit-for-bit per hitscanResolveParity.test.ts); Z1a's pinned 92-vs-90.4
  headshot gap flipped to real equality via combat.zig's
  isHeadshotAtHalfHeight. DOCUMENTED v1 scope cuts (in world.zig's new
  section header, not silent): no decoy/destructible hitscan candidates,
  no split-spawn, no impact-AOE routing, no mirror-shield retrace, no
  shooter-side amp chain (Facet Break/Focus Hex/Rally Light/Kindled
  Resolve/Ghost Guard) on the hitscan path yet. Contagion self-jump guard
  (item 6, ride-along) also closed: TS's scan let a Priest re-ignite
  themselves in FFA; Zig already had the guard, TS didn't. Meter: MIXED,
  reported honestly, not spun as a clean win — 3 seeds tightened, 2
  worsened (seed=271828 360.6->437.9px), one seed's biggest single swing
  in the file's history (seed=90210 762.7->274.2px). Still open on the
  Z1 list: team peel, ninja dash i-frames, Kindled Ward partial
  mitigation, six-axes axis payloads — each judged to need item-1-grade
  investigation depth, deliberately not rushed. Aegis Share's team-peel
  READER lands with the team-peel item (window is bridged and cast-live
  already).
- Z1b: **DONE** 2026-07-24 — the whole remaining wipe-on-repack substrate,
  three commits: (a) the [384,620) ability-window tail bridged
  field-level (28 comptime offset asserts; abilityWindowBridge.test.ts —
  mid-fight windows survive explicit re-pack + 80 stepped repacks in TS
  lockstep, verified-failing 2/2 on the old skip); (b)+(c) the loadout
  delivery pipeline in ONE commit (one mechanism): new
  resolve_player_loadout export re-establishes fire config + hand +
  EquippedActives after EVERY pack (before: no ability castable at all
  under wasm), client fire-config write moved INSIDE runWasmStepSync
  post-pack (server always had it right), plus two ride-along finds —
  CARD_INDEX filtered ability cards out of the hand Zig saw (indices
  coincided for modifier cards by luck), and both hosts' mergeUnpacked
  DESTROYED the real card ids every step (count-only placeholders);
  loadoutBridge.test.ts proves valid=1 + card damage at step time and a
  sunlance cast landing after 20 repacks in TS lockstep (failing 3/3 on
  the old path). Meter: essentially flat as expected (header verdict —
  the sweep's cardless bots can't see any of it except the wizard
  channel ramp + class-aware config, which nudged 4 seeds <75px mixed).
- Z2 server honesty: **DONE** 2026-07-24 — (1) drafting overlay RETIRED:
  draft.zig owns offers/picks/auto-pick under full-sync via the
  draftMemory carrier + bridged round_winner_idx (was hardcoded -1 every
  pack — every hosted draft rolled all-standard weights) +
  world_apply_card_pick pick queue; matchHost keeps only presentation +
  hand mirroring (foldZigDraft); draftOfferParity.test.ts: same-seed
  offers BYTE-IDENTICAL, identical rng cursor, tick-identical draft
  window, 4/4 expiry auto-picks. (2) event drop branch GONE: full
  convertWasmEventsToTs stream forwarded (+ kind 13/14 draft decode);
  matchHostWasmEvents.test.ts proves shot-fired surfaces with no TS
  fallback. (3) hangout pin KEPT + re-recorded with dated evidence: it's
  a correctness pin (TS hangoutMode = PvP immunity at the damage
  resolver, round machine never steps, projectiles/hitscan ghost —
  none mirrored in Zig; lift condition = a step_world hangout flag).
  Full server suite green under USE_WASM_STEP_WORLD=1 (317 pass, venue +
  private-room coverage included).
- Z3 sweep + bench: **NOT STARTED**
- Z4 flip: **AWAITING JAKE** (after Z0–Z3)
- V voice: **APPLIED + MERGED + LIVE** 2026-07-23 (1536849) — 88/104 card
  rewrites applied (16 already in-register), codegen zero-diff, results
  overlay speaks the record register, voiceRegister.test.ts lint added.
  docs/voice-pass-inventory.md is the sign-off artifact — AWAITING JAKE:
  overall copy sign-off, 9 flagged rename candidates, 5 proposed result
  epigraphs, the paper-double 160-char trim, and the deferred DeathOverlay
  in-play line.
- L legibility: **AUDIT DONE + TOP FIXES MERGED/LIVE** 2026-07-23 —
  docs/legibility-audit.md now 0 MISSING / 32 PARTIAL / 47 SHIPPED.
  Shipped: stride-refunded site event + feet sweep, execute severance
  shear on death-FX, shadow-step blink streak, veil body shroud +
  break-snap (pure planner, 6 headless tests). AWAITING JAKE live-eyes:
  stride ring readability at speed, veil quietness-vs-fairness, shear
  timing vs the kill pop (harness could only verify the streak path).
  Still open: launch-cue rip (canonical recording — taste call), the 32
  PARTIAL rows as a future polish lane.
- B instrument: **DONE (PASS)** 2026-07-23 — commit 30ed713: per-class
  policy (Kindled closes, seeded first-swing delay fixes the mutual-range
  mirror collapse). Matrix now varies in all 4 mirrors and 6/12 cross
  cells. TWO STAT-HONEST FINDINGS for the P4 tuning pass: (1) point-blank
  pistol sustained DPS (~92) beats both melee arcs (~50) — a perfectly
  executed melee close still loses the endgame trade; (2) Kindled at
  318.6px/s cannot outrun 320px/s Syzygist tendrils — the intended evasion
  counter is unavailable to the heavy chassis specifically.
