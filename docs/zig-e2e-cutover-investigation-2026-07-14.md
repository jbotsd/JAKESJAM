# Zig e2e cutover investigation — 2026-07-14

Full session log for the "finish the full Zig `step_world` cutover, with
mathematically-verified evidence" investigation. Branch:
`zig-e2e/full-cutover-2026-07-14`. This doc is the honest, dated record —
update it if this work continues in a later session rather than trusting
memory of what was actually proven vs. still open.

## Why this investigation happened

`step_world` (the full-Zig sim orchestrator) has been flipped on in
production twice and reverted both times — once in May 2026, once on
2026-07-05/06. The July revert's own commit message (`2137c31`) is explicit
that **root cause was never fully identified**: extensive scripted/
Playwright checks stayed green while live human play kept surfacing
unplayable symptoms that never reproduced on demand. That incident is what
`docs/escalation-engine-goal.md`'s "Forbidden 'green but unplayable'" rule
generalizes from. See `server/src/matchHost.ts:62-77` for the in-code
warning against re-attempting this without real human playtesting.

This investigation's premise: the "green but unplayable" gap likely wasn't
one bug — it was probably several REAL, findable structural divergences
between the TS orchestrator (`World.ts` `stepWithRuntime`, production
authority) and the Zig orchestrator (`world.zig` `step_world`, opt-in only)
that narrow per-function parity tests structurally cannot catch, because
they test one system in isolation rather than the ORCHESTRATION sequencing
around otherwise-correct sub-systems.

## What was found and fixed (all committed, all test-verified)

1. **Tick-ordering bug (the headline finding)** — `sim/src/world.zig`'s
   weapon-fire ran AFTER projectile motion/impact in the per-tick sequence
   (opposite of `World.ts`, which fires within the same per-player pass
   that runs first). A freshly-fired Zig projectile got ZERO motion this
   tick (`ageMs=0`, 0.4px traveled) vs TS's 47.3px. Directly matches the
   July incident's "shot doesn't go the distance" bug report. Fixed by
   reordering `step_world`'s sections to match `World.ts`'s actual sequence
   — see commit `3d465f3`.
2. **No `is_fighting` gate on movement/fire** — players could walk, jump,
   and fire during countdown/drafting in Zig; TS explicitly freezes both.
   Fixed in the same commit.
3. **Shield/parry-readiness ran after projectile-impact** (which reads
   shield/parry state) — a player's defensive input was always one tick
   stale for combat purposes. Fixed in the same commit.
4. **Round-winner detection ran BEFORE this tick's combat** instead of
   after — match-end lagged the kill that caused it by one tick. Fixed in
   the same commit.
5. **Fire-hazard chaos modifier was an admitted incomplete stub** —
   hardcoded -800..800/-400..400 box (not real map bounds), wrong radius/
   damage/lifetime constants entirely, no phase gate, and used an ad-hoc
   RNG instead of the shared parity-tested one. Rewritten to match TS
   exactly, including the accumulator-carry behavior the old code was
   silently dropping. Commit `bf8e444`.
6. **Fire-patch/pickup/satellite/fire-hazard relative ordering** and
   **burn-DoT position** brought in line with `World.ts`'s actual sequence
   (was: fire-hazard→fire-patches→projectiles→satellites→pickups,
   burn-DoT last; now: satellites→projectiles→fire-patches→pickups→
   fire-hazard, burn-DoT right after player movement). Commits `bf8e444`,
   `d6b5868`.
7. **Sudden-death shrink-zone storm ported from scratch** — this was the
   ONE sim concern with zero Zig code at all beforehand. Commit `9aeabaa`.
8. **Muzzle-offset + alternating-hand throw geometry ported** — Zig was
   spawning projectiles dead-center on the player; TS spawns from an
   offset, hand-alternating muzzle position and derives the fire angle
   from THAT point, not the player's raw x/y. This was silently making
   every single fired shot's position AND angle wrong. After the port,
   `tickOrderParity.test.ts`'s TS-vs-Zig same-tick fired-shot comparison
   is byte-identical (47.3221px both sides, exact vx/vy match). Commit
   `888345c`.

Every fix above shipped with a dedicated test proving the specific bug
existed before the fix and is closed after it (not just "tests still
pass") — see `tickOrderParity.test.ts`, `fireHazardParity.test.ts`,
`suddenDeathParity.test.ts`. Full regression suite stayed green throughout
(client 840+/0 fail, server 169/0 fail, zig build + zig build test clean).

## Performance — real numbers, both native and through the actual wasm boundary

| Path | ms/tick (8 players) | Notes |
|---|---|---|
| TS-native (`stepWithRuntime`) | 0.057 avg | `client/bench/simTick.bench.ts`, existing tool |
| Zig-native (no wasm, ReleaseFast) | 0.0073 avg (7288 ns) | NEW: `sim/bench/step_world_bench.zig`, `zig build bench` — ~7.8x faster than TS-native |
| Zig via the real wasm boundary | 0.048 avg | NEW: `tools/step-world-wasm-bench.ts` — still faster than TS-native, but the pack/unpack/fire-config-resolve overhead visibly eats most of the native advantage |

Also structural, not just speed: TS's bench shows ~27MB heap growth per
3000 ticks (GC pressure from per-tick object/record spreads). Zig's
`WorldState` is one fixed-size extern struct — zero dynamic allocation per
tick, a class of GC-stutter risk TS cannot structurally avoid regardless of
optimization.

## Multi-tick, multi-player divergence — the deepest correctness check

**`multiSeedDivergence.test.ts`** drives a realistic multi-player,
multi-tick (1200 ticks = 20s), scripted-movement-and-combat match through
both orchestrators in lockstep (same inputs every tick) and measures full
game-state drift. Player movement runs the SAME compiled wasm `stepPlayer`
on both sides (already how production runs today via the Layer-F backend
swap), so any divergence found is attributable to orchestration-level
differences, not movement-kernel drift (which `worldLongHorizon.test.ts`
already covers thoroughly).

**Original result across 5 seeds** (before the fix described below):
4/5 seeds showed a BOUNDED divergence (jumps once early, then flat).
Seed=1 was qualitatively different: UNBOUNDED, roughly linear growth —
~16px/tick, reaching 19,315px apart by the end of the run.

Ruled out as the cause: the `chaos.randomShapes` RNG draw in
`weapon.ts`'s `stepWeapon` (confirmed gated behind a condition that's
false in this test — no chaos modifiers are enabled).

**Root cause, confirmed and fixed, same session.** Tracing seed=1
tick-by-tick found it: `multiSeedDivergence.test.ts`'s harness never
called `setWorldArenaBounds`, so Zig's void-plane kill-plane gate
(`g_kill_plane_y > 0`) was never armed, while TS's equivalent check reads
`runtime.map.size.y` directly and needs no separate setup call. Result:
two players who fell through the floor got correctly void-killed in TS
(`alive=false, health=0`) but stayed alive-and-falling forever in Zig,
still responding to movement input the whole match — exactly the "one
side dead-and-frozen, one side alive-and-moving" pattern the linear
growth showed.

A false alarm complicated verifying this: a follow-up diagnostic that
added the missing call ALSO appeared to freeze TS's own movement
entirely. Bisected with three further isolated diagnostics (all
throwaway, not committed) rather than trusting the scary-looking
result:
1. Arena-bounds call alone (no Zig interaction at all) — TS movement
   fine. Ruled out the setup call itself as the cause.
2. Interleaved TS+Zig calls, 1 player, with arena-bounds — Zig frozen
   (both x AND y, zero gravity even).
3. Zig alone, same 1-player setup, ZERO TS interleaving — **also
   frozen**. This ruled out cross-contamination between the two wasm
   backends entirely (the thing the previous session assumed) — the
   freeze happened with no TS involvement whatsoever.

The actual explanation: a **1-player match trivially satisfies
`detectRoundWinner`'s "alive_count == 1 → KO winner"** check from tick
one (there's only ever one player, so "everyone else is dead" is
vacuously true). The round correctly ends immediately, and this
session's own `is_fighting` gate (added earlier in this investigation)
correctly freezes movement outside the fighting phase. Not a bug —
correct behavior for a degenerate test scenario that the isolated
diagnostics happened to use for simplicity. The REAL 4-player
`multiSeedDivergence.test.ts` harness doesn't have this degenerate
case, so this false alarm never applied there.

**Fix applied and verified**: added the same `setWorldArenaBounds` call
`World.ts`'s `syncWorldStaticsToWasm` always makes in real production to
`multiSeedDivergence.test.ts` itself. Reran the full 5-seed, 1200-tick,
4-player sweep: **seed=1 now matches the other 4/5 seeds exactly** —
bounded divergence (jumps to 595-908px within the first ~40-120 ticks,
correlated with a death event, then FLAT for the rest of the match).
Tightened the test's own assertion from a 100,000px placeholder to
2,000px (max observed across all 5 seeds: 1,084px) now that there's a
real number worth gating on. All 5/5 seeds pass.

This is genuinely resolved, not just documented-and-deferred: the
unbounded-drift class of divergence is gone, root-caused, and the fix
is committed with the reasoning for why it was a harness gap (confirmed
via the production code path already handling this correctly) rather
than a product bug.

Not yet investigated, in rough priority order for a follow-up session:
1. Whether TS and Zig's exact damage/kill resolution order diverges when
   MULTIPLE projectiles could hit the same player in overlapping ticks
   (order-of-resolution matters for who gets credit / exact death tick
   when health is close to zero from more than one source) — the likely
   explanation for the remaining ~500-1000px bounded gaps.
2. The fine-grained per-player sub-order within the combined movement+
   combat loop — TS: move → fire → parry → shield; Zig (still, after this
   session's fixes): move → shield/parry → fire. Explicitly deferred in
   commit `3d465f3`'s message as "not proven to matter."
3. Whether the deflect/parry/mirror-shield velocity-reflection math
   (`vx = -vx * 1.15` pattern, present in both TS and Zig) produces
   identical results given the two implementations' aim/positions have
   now diverged slightly by the time a parry happens.

## Not attempted this session

- **Native drafting in `round.zig`** — the round-phase machine still can't
  draft; the server's `applyDraftingOverlay` workaround remains the only
  path. Scoped in the earlier gap-inventory research as "medium effort,
  needs new WorldState fields for offer/pick bookkeeping" — bigger than
  anything else in this session, not started.
- **Extended live human playtest** — the ONE thing the codebase's own
  history says is non-negotiable before re-enabling `USE_WASM_STEP_WORLD`
  in production ("Forbidden 'green but unplayable'"). Nothing in this
  session substitutes for it. Do not flip that flag based on this doc
  alone.
- **Re-enabling `USE_WASM_STEP_WORLD` or `?wasm-world` by default** —
  deliberately not touched. Still opt-in only.

## Bottom line

Genuine, proven progress: six real structural bugs found and fixed with
hard before/after evidence (tick-order, missing phase gates, shield/parry
staleness, round-winner-detection lag, an incomplete fire-hazard stub, and
wrong muzzle geometry — the last now byte-identical to TS), one
previously-unported sim concern (sudden death) built and verified, real
performance numbers gathered for the first time on the full orchestrator
(not just individual kernels: ~7.8x native speedup, still faster than TS
through the real wasm boundary), and a previously-nonexistent multi-tick,
multi-seed cross-implementation divergence sweep that found a genuine bug
(seed=1's unbounded drift), root-caused it precisely (a missing
production-equivalent setup call), fixed it, and re-verified the fix
closes it — not a claim taken on faith, a number that changed from
19,315px unbounded to 908px bounded and stayed there across a full re-run.

The historical "green but unplayable" failure mode is meaningfully better
understood now: tick-order and setup-completeness bugs are a proven real
category with concrete examples, not a mystery. Every fix in this session
shipped with the test that proves the bug existed and proves it's closed.

What's still genuinely open, not glossed over:
- **Native drafting in `round.zig`** is real, scoped, unstarted work — the
  round-phase machine still can't draft on its own; the server's
  `applyDraftingOverlay` remains the only path. This is the last
  structural gap between "step_world is a complete, self-contained
  replacement for stepWithRuntime" and where it stands today.
- Three smaller, lower-confidence orchestration-order questions listed
  above (multi-hit resolution order, the fine-grained move/fire/parry/
  shield sub-order, parry-reflection math) — none proven to matter, flagged
  for a future pass if further divergence sweeps ever surface them.
- **A live human playtest remains the final, non-negotiable gate** before
  `USE_WASM_STEP_WORLD` is ever re-enabled in production. This is not a
  formality this session skipped out of laziness — it's the codebase's own
  explicit, hard-won lesson from the exact incident this investigation was
  responding to: automated verification, however thorough, was already
  proven insufficient once. No amount of additional test-writing in a
  single session substitutes for a human actually playing it. The flag
  stays off.
