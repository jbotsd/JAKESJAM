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

**Z3 — Sweep until dry + the honest bench (NOT STARTED).** The
divergence-sweep meter (`multiSeedDivergence.test.ts`) has been run
per-item all week but never to loop-until-dry (2 consecutive rounds, 0
new divergence, logged coverage — the original acceptance bar). Then
`tools/wasm-bench.ts` re-runs fresh and `zig-wasm-perf-baseline.md`'s
2026-05-05 staleness banner gets replaced with real numbers — whatever
they say. (Its one appended 2026-07-20 spot-check, marked "not a settled
conclusion," found wasm-swap stepPlayer FASTER than TS-native for the
first time — 661.7ns vs 1284ns — which is itself worth confirming
properly, not left as a footnote.)

**Z4 — The flip (AWAITING JAKE, blocked on Z3).** `USE_WASM_STEP_WORLD=1`
on :8088 for a real session. Not ready to ask for yet — Z3 isn't done.

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

**F1 — The STAB verb (unblocked — sim files are free now).** Both class
loops declared render-complete with this as the one deferred sim
addition. Full design spec already sits in
`docs/slash-feel-ledger.md`'s Interstice section (chain position,
damage/knockback numbers, gameplay reasoning) — build it: TS melee FSM +
Zig mirror + parity test, then the render pass (thrust animation, its
own hit-stop/flash/camera-kick tuning per R1's channel discipline).

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
- The Z4 flip, once Z3 lands

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

- Z3 sweep+bench: **NOT STARTED**
- Z4 flip: **AWAITING JAKE** (blocked on Z3)
- Z5 residuals: **NOT STARTED** (3 items)
- F1 STAB verb: **NOT STARTED** (unblocked)
- F2 audio wiring: **BLOCKED ON JAKE** (picks)
- F3 live-eyes verification: **NOT STARTED**
- P legibility (9 rows): **NOT STARTED** (unblocked)
- D doc hygiene (4 items): **NOT STARTED**
- B balance tuning: **NOT STARTED** (unblocked, ready)
- Human gates: **6 items AWAITING JAKE**, collected, none blocking
- R render/perf: **OPT-IN, not activated**
