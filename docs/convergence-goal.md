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

- Z0 harvest: **NOT STARTED**
- Z1 deferrals: **NOT STARTED**
- Z2 server honesty: **NOT STARTED**
- Z3 sweep + bench: **NOT STARTED**
- Z4 flip: **AWAITING JAKE** (after Z0–Z3)
- V voice: **NOT STARTED**
- L legibility: **NOT STARTED**
- B instrument: **NOT STARTED**
