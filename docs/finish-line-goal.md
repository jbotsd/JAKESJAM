# The Finish Line — everything left, exhaustively, one /goal

**Status:** Successor to `convergence-goal.md` (Z0-Z2 CLOSED, Track V/L/B
CLOSED as of 2026-07-25) and the melee-feel ledger (both class loops
render-complete). This doc is the next exhaustive list — every remaining
engineering item, every doc-hygiene gap, every human sign-off — in one
place, built to run under ultracode exactly like its predecessor. Built
2026-07-25 from a full-repo survey (14 docs + git log + code grep), not
from memory — numbers here supersede any stale count in an older doc
(two are caught and fixed in Track D below).

**Completion discipline:** identical house rule — tool-verifiable
acceptance only; AWAITING JAKE rows are evidence to collect, never a
loop gate.

**Scope call (contested, default taken):** this doc covers everything
**in-scope by default** except Track R, which stays opt-in exactly as
`convergence-goal.md` established — render/perf work is a different
motive (frames, not correctness/feel/voice) and shouldn't silently
piggyback onto this list. Say the word to activate it.

---

## Track Z — Close the Zig-first suite

**Z3 — Sweep until dry + the honest bench (DONE, 2026-07-26).** No sim
code changed. The divergence-sweep meter's canonical 5 seeds re-ran
byte-identical to Z1c's last row (376.5/247.5/230.0/274.2/437.9px). A
throwaway driver copying its exact harness logic then swept 500
additional seeds across 8 rounds (seed ranges + rounds logged in
`multiSeedDivergence.test.ts`'s own header ledger) looking for anything
the canonical 5 miss: round 1 found a genuinely worse ceiling (seed=45,
final 1669.3px / mid-match peak 1877.3px — still under the file's
2000px bound, still finite), then 7 CONSECUTIVE rounds (well past the
2-consecutive bar) found nothing worse. DRY, honestly reached — real
worst-case ceiling on today's code is ~1.7-1.9k px, not the ~440px the
canonical 5 alone imply, but still inside the bound on all 505 seeds
tried. `tools/wasm-bench.ts` re-ran fresh (6 back-to-back runs,
averaged) and `zig-wasm-perf-baseline.md`'s stale banner is replaced
with a current 2026-07-26 baseline. The 2026-07-20 spot-check's
"wasm-swap stepPlayer faster than TS-native, not a settled conclusion"
footnote is now SETTLED: confirmed in 6 of 6 runs, ~2× faster on
average (1126.9ns vs 556.5ns).

**Z4 — The flip (AWAITING JAKE, unblocked — Z3 is done).**
`USE_WASM_STEP_WORLD=1` on :8088 for a real session. Ready to ask for.

**Z5 — The residuals Z1c documented rather than hid** (real gaps, not
doctrine — distinguish from Six Axes' *intentional* TS-only Layer-2
actives, which are NOT bugs and NOT in this list):
1. `kindled_resolve`'s cast is a genuine no-op in Zig (`world.zig:3091`
   `.kindled_resolve => {}`) — consumption shipped, the cast itself
   never fires under wasm. Close it.
2. classModifiers-codegen gap: 9 cards' leech/other class-specific
   modifiers don't cross to Zig at all (only `Stolen Fangs` has a
   documented stopgap patch). Either port the codegen properly or
   enumerate + accept the remaining 8 with the same stopgap pattern.
3. Hitscan resolution's documented v1 scope cuts: no decoy/destructible
   hitscan candidates, no split-spawn, no impact-AOE routing, no
   mirror-shield retrace, no shooter-side amp chain (Facet Break/Focus
   Hex/Rally Light/Kindled Resolve/Ghost Guard) on the hitscan path.
   Each is its own small port, same pattern as Z1c's items.

Acceptance per Z5 item: the noted comment/gap is closed, a parity test
proves it, full suites + meter stay green.

## Track F — Finish the melee-feel loops

**F1 — The STAB verb — BUILT (2026-07-26, branch `feat/interstice-stab-verb`,
awaiting human-supervised review/merge).** Both class loops declared
render-complete with this as the one deferred sim addition. The Interstice
section's original design note only named the CADENCE ("arc-arc-STAB"), not
concrete numbers — the actual chain position/damage/knockback numbers +
full gameplay reasoning were decided during this build (a real, flagged
judgment call, not a transcribed spec) and now live in their own "STAB verb
design decision" section in `docs/slash-feel-ledger.md`, structurally
mirroring the shield-bash's own decision block. Built: TS melee FSM
(World.ts) + Zig mirror (world.zig) + a tick-identical parity test
(meleeSwingMemoryBridge gate F) + a dedicated TS suite (ninjaStab.test.ts),
plus the render pass (thrust animation on ProceduralPlayerRig, its own
construct reach/sweep + debris register, camera-kick/whiff-watch timing —
reusing Interstice's existing R1 rows 3-9 chassis tuning unchanged, same
precedent Kindled's own bash set). Open for a future wave: on-camera
live-tape verification (the bash's own K5-K12/I5-I13 tape passes are a
dozens-of-iterations investment, out of scope for this build task) and F2's
audio wiring once unblocked.

**F2 — Audio wiring (blocked on Jake).** `~/Music/jakesjam-slash-audio/`
has 34 candidates + ranked recommendations in `CANDIDATES.md`, untouched
since the curator populated it (single batch, no picks yet). Once
picked: wire per R1 rows 13/14's already-specified timing (whoosh at cut
start, contact ±2t of the sim gate, kill layer +0-50ms stacked) — this
half is pure execution, no further design needed.

**F3 — The two "needs your live eyes" verifications** carried over from
the loops: pool behavior under a real extended multi-round session
(flagged, not just strip-tested), and a final in-arena feel pass on both
classes together (not just each in isolation).

## Track P — The last 9 legibility rows

`docs/legibility-audit.md` sits at 70 SHIPPED / 9 PARTIAL / 0 MISSING.
The 9: `borrowed-time`, `double-jump` (Kindled stomp-jump ring),
`glass-ward`, `haste`, `kindled-resolve`, `paper-double`, `recoil-step`,
`regen`, `severance`. Several were explicitly deferred as
"melee-loop-owned" (blocked on the single-writer lock on
ProceduralPlayerRig/ConstructVfxController) — that lock is released now
that both feel loops are done, so these are unblocked, not still queued.
Acceptance: same doctrine-#10 site-read bar as the 70 already shipped;
flip each row to SHIPPED with its presenter file:line.

## Track D — Doc hygiene (small, fast, prevents future confusion)

1. `cohesion-goal.md`'s Status block still says P2 (voice) and P3
   (legibility) "NOT STARTED" — false as of 2026-07-24; both were
   executed via `convergence-goal.md`'s Track V/L. Update the lines to
   point at convergence-goal.md's actual completion.
2. `convergence-goal.md`'s own Track L status line says "0 MISSING /
   32 PARTIAL / 47 SHIPPED" — stale against `legibility-audit.md`'s real
   current 70/9/0 (the Track-L-polish-lane fixes landed after that line
   was written and the summary was never refreshed). Fix the number.
3. `venue-goal.md`'s Evidence Ledger only has entries for Pillar 0 and 1
   (2026-07-16), but Pillars 2-6 are functionally live (confirmed via a
   real `/venue/summary` query showing bell admission + elastic bots +
   starter draft all working) and their commits exist in git log
   (S2.B/S2.C/S2.E/S2.F, 2026-07-16/17). This is a doc/evidence gap, not
   a functionality gap — backfill the ledger entries so the doc
   correctly reflects what already shipped.
4. `client/src/sim/wasm/worldWasmBackend.ts`'s header comment is
   Phase-J0-era and claims player physics/weapons/drafting are "NOT YET
   covered" by wasm — false since Z2. Update or delete the stale claim.

## Track B — The balance tuning pass (now genuinely ready)

Blocked all week on purpose — melee timings were still moving. They're
not anymore (both class loops declared complete). Re-run:
1. The per-class bot-policy matchup matrix (Track B's fixed instrument)
   on the SETTLED chassis + melee numbers.
2. The TTK guardrail suite on the same.
3. Apply a real tuning pass using the two banked, stat-honest findings:
   perfectly-played melee still loses the point-blank DPS trade to the
   pistol (~50 vs ~92 sustained); Kindled at 318.6px/s cannot outrun
   320px/s Syzygist tendrils (1.4px/s short — the intended evasion
   counter is mathematically unavailable to that one class).

## Human gates (collected here, never blocking, your call whenever)

- P1.7 chassis feel-check (play it — today's checklist message has this)
- Voice-pass sign-off + 9 rename candidates + 5 epigraphs +
  paper-double's 160-char trim (`docs/voice-pass-inventory.md`)
- Syzygist color-slot ratification (chassis-design-axioms.md's CA2
  already argues white is correct — this is a ratify-or-veto, not an
  open question)
- Six Axes Phase 4 — ≥5 rounds live drafting ability cards, your verdict
- Audio picks from the candidate slate (unlocks Track F2)
- The Z4 flip — Z3 landed 2026-07-26, ready to ask for now

## Track R — Render/perf (OPT-IN ONLY, not default scope)

`RENDER_OVERHAUL_PLAN.md`'s Phase 0-2 (surgical wins, QualityProfile,
texture-first renderer) haven't started; Phase 3's WebCodecs capture
path is shipped, but the gpu-screen-recorder replay-buffer path is
blocked on a real SIGSEGV on this box's nvidia-open+Hyprland stack. Say
"activate Track R" if frame-rate becomes the actual motive — until then
this is explicitly not part of the exhaustive list above, same
precedent as convergence-goal.md.

---

## Status

- Z3 sweep+bench: **DONE** (2026-07-26 — dry after round 3, 7 rounds of
  margin; bench baseline refreshed and stepPlayer reversal settled)
- Z4 flip: **AWAITING JAKE** (unblocked — Z3 is done, ready to ask)
- Z5 residuals: **DONE, item 1 + item 2 fully closed; item 3 (hitscan v1
  scope cuts) closed 3 of 5 sub-items** (2026-07-26): kindled_resolve cast
  wired (KIN_KINDLED_RESOLVE_KINDLING_COST added, parity test in
  sim/test/smoke.zig — search "Kindled Resolve: cast"); all 9
  classModifiers-codegen-gap cards now cross (8 via a generalized
  `patchClassModifierGapFields` stopgap in fireConfigShared.ts, Stolen
  Fangs' leech already had one — parity in
  classModifierGapFieldsParity.test.ts); hitscan's shooter-side amp chain +
  Ghost Guard evasion and mirror-shield retrace are now ported (parity in
  hitscanZ5ScopeCutsParity.test.ts) and impact-AOE routing is ported for
  the player-hit case. Still open: decoy/destructible hitscan candidates
  (a real geometry change, bigger than a small port) and split-spawn (no
  Zig substrate exists for ANY delivery path yet, real-projectile
  included — not a hitscan-specific gap, nothing to mirror). See
  world.zig's "Hitscan resolution" section header for the authoritative
  per-sub-item STATUS list.
- F1 STAB verb: **DONE — reviewed, MERGED, deployed live** (2026-07-26/27,
  commit 66c5e1f). TS FSM + Zig mirror + parity gate (meleeSwingMemoryBridge
  gate F) + dedicated TS suite (ninjaStab.test.ts) + the render pass (thrust
  pose, construct reach/sweep, debris register, camera-kick/whiff-watch
  timing). Full design spec + every number's reasoning in
  slash-feel-ledger.md's "STAB verb design decision" section — every number
  is a new feel judgment call, not a transcribed spec, still worth Jake's
  own sanity-check when he plays it. Open: on-camera live-tape verification
  of the render (a future wave's job, same investment class as the bash's
  own K5-K12/I5-I13 tape passes).
- F2 audio wiring: **BLOCKED ON JAKE** (picks)
- F3 live-eyes verification: **PARTIALLY DONE, ad hoc** — the 2026-07-27
  footage-study STUDY 3/4 cycle exercised real live-eyes verification on
  fresh tape (STUDY 4 confirmed D1/CL.E/CL.D/nameplate/watermark fixes on
  real gameplay), but that was scoped to clip-goal.md's own defect list,
  not F3's original "both classes together, multi-round" brief — still
  worth a dedicated pass.
- P legibility (9 rows): **DONE** (2026-07-26) — legibility-audit.md is now
  79/79 SHIPPED, 0 PARTIAL, 0 MISSING.
- D doc hygiene (4 items): **DONE** (2026-07-26) — all 4 fixed (cohesion
  P2/P3 lines, convergence Track L count, venue-goal.md Evidence Ledger
  backfill for Pillars 2-6, worldWasmBackend.ts header). The venue backfill
  surfaced a real finding beyond doc hygiene: Pillars 4 (run/draft record),
  5 (ceremony/map-vote), and 6 (naming/front-door) turned out to be
  actually UNBUILT, not just undocumented — see venue-goal.md's own ledger
  for specifics. That's new real scope, not covered by this doc's 4 items.
- B balance tuning: **DONE** (2026-07-26) — re-ran the fixed CLASS_POLICY
  matchup matrix + TTK guardrail suite on the settled chassis/melee numbers
  (before: 6/12 cross-class cells hard 0/100, all mirrors variant, matching
  30ed713's baseline exactly; TTK guardrails 37/37 green). Applied both
  banked findings: (a) melee-vs-pistol point-blank DPS — bumped
  SLASH_DAMAGE 11->14 and EDGE_DAMAGE 32->38 (World.ts), trimmed
  GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX 1.6->1.3 (constants.ts);
  stationary point-blank harness measured ~47/~39 (ninja/paladin) vs pistol
  ~84 before, ~60/~45 vs ~71 after — meaningfully narrowed, pistol identity
  intact. (b) Kindled-vs-tendril evasion — SYZ_TENDRIL_SPEED 320->305
  (below Kindled's 318.56px/s run speed, was 1.4px/s ABOVE it), lifetime
  2.6->2.75 to keep Priest's longest-basic-gun-range claim true; left
  Kindled's moveSpeedMultiplier untouched (cohesion-goal.md's
  test-pinned canonical quad, not the narrowly-scoped lever). Re-ran
  matrix+guardrails after: still 6/12 hard cells, SAME set (no new
  degenerate 0/100, no mirror flipped), TTK guardrails still 37/37.
  Kindled-vs-Geometrician and Kindled-vs-Syzygist stay hard 0% — verified
  this is a SEPARATE, out-of-scope structural fact (heavy is the slowest
  chassis in the game, 318.56px/s < both Geometrician's 362 and
  Syzygist's 347.5, so Kindled can never force melee range against either
  kiting class regardless of tendril-dodge math), not a failure of either
  banked fix. Side-effect surfaced, not hidden: Kindled-vs-Interstice
  flipped from 83% Kindled-favored to 41% (Ninja's proportionally larger
  DPS bump plus its faster chassis) — a real balance shift worth a human
  look, not a regression bug. Full before/after numbers + all touched
  files in the session report.
- Human gates: **6 items AWAITING JAKE**, collected, none blocking
- R render/perf: **OPT-IN, not activated**
