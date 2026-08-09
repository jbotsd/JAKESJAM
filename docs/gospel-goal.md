# GOSPEL — one engine, open doors, a native desktop at the end

**Written 2026-08-05. Ratified by Jake the same day: "GO ALL ZIG."**

This is the orchestration layer for the rest of JAKESJAM's build-out. It
subsumes `open-doors-goal.md` (which stays authoritative for its own item
details and sequencing — this doc does not restate them) the same way
`convergence-goal.md` once absorbed `cohesion-goal.md`. It adds three
things on top: the **Zig-first law**, the **engine-to-gospel track** (the
Zig sim becomes the single source of truth everywhere), and the **native
desktop end state**. It is written to be run as an endless `/goal` under
ultracode: it never terminates — it re-aims.

**Ground truth:** this doc's Status block (maintained commit-by-commit) ·
`open-doors-goal.md` Status for Track D detail · `finish-line-goal.md`
for its remaining evidence rows · `venue-goal.md` acceptance criteria.

---

## End state (the milestone the loop drives through, not where it stops)

1. **One sim.** The Zig core is the entire game simulation — authority on
   the server, prediction on the client, bit-identical replays everywhere.
   TypeScript is a presentation shell (DOM, render, netcode plumbing) that
   could be rewritten without touching game behavior.
2. **Open doors.** A stranger on any device is in a live fight in <15 s,
   understands it, finishes a cycle with a ceremony, and chooses "again"
   (open-doors north star; its numeric gates are the bar).
3. **A native desktop build** — the same Zig core inside a native
   shell — playable against bots offline (N2) and joining the public
   server as a first-class client (N3).

When all three are green the loop does not exit: it re-aims at the next
weakest thing against the "best game in the world" bar (footage first,
per the standing directive).

## The Laws (every session, every wave)

- **L1 · Zig-first.** Any change to game *behavior* (movement, combat,
  scoring, drafting, run records, bot policy, round flow) lands in the
  Zig core. TS may only implement what the sim cannot reach: DOM, render,
  audio playback, sockets, storage. If a behavior change is urgent while
  TS is still authoritative, it lands in BOTH sides with a parity test —
  never TS-only. After the flip (E2), behavior lands Zig-only with native
  tests; TS mirrors are retired, not extended.
- **L2 · Toolchain (locked 2026-08-05, evidence below).** Zig pinned at
  **0.15.2** (`.tool-versions` + `minimum_zig_version`). Do NOT move to
  0.16.x — it is a dead-end tag (zero patches, 0.17 imminent) and its
  LLVM 21 ships with loop auto-vectorization DISABLED (miscompilation
  workaround, persists through 0.17.x; 0.15.2's LLVM 20 still
  vectorizes — 0.15.2 is currently the fastest-runtime Zig). Plan ONE
  deliberate jump to ≥0.17.1 (or 0.18.x if release-perf matters by then,
  which restores vectorization), gated by: `zig build test` (125+) → TS
  parity suites (`client/src/sim/wasm/__tests__/`, 325+) → multi-seed
  divergence sweep → golden-replay determinism. Empirical receipt: the
  whole gate was run against a 0.16.0-built sim.wasm on 2026-08-05 —
  zero source changes needed, 125/125 native, 325 pass/0 fail/30,531
  asserts, artifact within 3 bytes — so the eventual jump is cheap and
  the harness provably catches what matters. (0.17 changes `@bitCast`
  semantics — exactly the class of thing the gate exists for.) Zig's
  canonical repo is now Codeberg, not GitHub.
- **L3 · Re-entry protocol.** Every session on this goal: (1) read this
  Status block; (2) footage/telemetry FIRST — newest replays/clips +
  warehouse funnel numbers; stationary >1 s = bug; (3) pick the weakest
  point by leverage, not the most interesting one; (4) fix → verify →
  commit small → update Status. Never report "done" — report what is
  next-weakest.
- **L4 · Human gates are evidence rows, never blockers.** Every
  completion condition in this doc is tool-satisfiable. Jake-owned
  decisions get built behind config flags with the recommended default
  DARK (current behavior preserved) so ratification is a one-line flip.
  Consent-class actions are NEVER auto-fired on silence: outreach sends,
  vault369-style domain cutovers, PAX submission, announcer voice choice,
  flipping the email-gate position live. Parked ≠ blocking: no machine
  lane may wait on a human row.
- **L5 · Fan-out discipline.** Worktree-per-writer, branch `track-x/...`,
  merge `--no-edit`, delete after. Single-writer files: `world.zig`,
  `cards.ts`, `main.ts`, `style.css`. Worktrees need node_modules
  symlinks (root + client + server). `sim.wasm` is gitignored — `zig
  build` after pulling Zig changes or wasm suites fail stale.
- **L6 · Live-host discipline.** Server sim changes require a :8088
  restart to be live (check ops for humans first; telemetry shows ~zero
  traffic, but look). The ops console is LAN-only :8089 — never route it
  through the public port. Client changes require a dist rebuild to be
  live.
- **L7 · Standing hard rules apply** (memory-enforced): Bun only; no AI
  attribution in commits; sizing-on-fleek (4 canonical viewports) before
  any UI change is "done"; no browser tabs in published footage; meme
  SFX are canonical recordings, never synthesized (the announcer VOICE
  layer is explicitly Jake's Decision 3, outside that rule); no
  triangle/eye symbolism — crystal/diamond grammar.
- **L8 · Honest meters.** Report parity/divergence/bench numbers as they
  land, including regressions (the convergence doc's meter lessons).
  Silent scope cuts are recorded in the nearest section header, never
  dropped.

## Track D — DOORS (subsumes open-doors-goal.md, Phases 0–5)

Sequencing, items, acceptance: `open-doors-goal.md`. Two amendments:

- **D-law:** sim-adjacent Doors items — run record (2.1), shared-draft
  order (2.1), bot ramp (3.2), lobby presence floor (3.1's displaced-bot
  return), round-cap taper (1.5), killfeed data (4.6) — are Track E
  features wearing Doors clothes: they land in the Zig core per L1,
  ideally after E2 so they land once. Pure shell items (gate position,
  fonts, preload, unfurl, overlays, copy) proceed TS-side immediately.
- **D-priority:** Phases 0–1 outrank everything in this doc. The funnel
  is the reason the machine exists (1 signup, ~zero traffic).

## Track E — ENGINE TO GOSPEL

- **E1 · Completeness** (the four documented gaps that make Zig the whole
  game): split-spawn orchestrator in `world.zig` (children materialize on
  death/expiry for every delivery path; `projectileSplitVelocities` is
  parity-proven and never called); classModifiers carried in Zig codegen
  (retire `patchClassModifierGapFields` — 9 cards); Paper Doubles through
  `worldStateBridge` pack/unpack; hangout flag in `step_world` (lift the
  TS-only PvP-immunity pin).
- **E2 · The flip.** Zig authority live on the public host
  (USE_WASM_STEP_WORLD=1 equivalent as default) with a kill-switch env.
  Direction RATIFIED 2026-08-05 ("GO ALL ZIG") — no consent gate remains;
  execution is evidence-gated only: full server suite green under wasm
  step, headless bot-only soak (≥2 h, zero divergence events, heap flat),
  then flip + observe + Status entry. Jake's taped evening stays valuable
  as feel-verification, not as a precondition.
- **E3 · De-mirror.** After E2 is stable: TS `World.ts` step path retires
  progressively (dead code deleted, not maintained); parity suites freeze
  as a regression archive keyed to the last mirrored commit; new behavior
  ships Zig-native with `sim/test/` coverage only.
- **E4 · Aim-intent substrate.** Input semantics (mouse exact / touch
  assisted / stick assisted+snap) become a sim-level input dialect so
  every platform shell feeds the same aim contract. Serves touch fairness
  today, gamepad/Steam-Deck browser play tomorrow, desktop + any console
  later.

## Track N — NATIVE DESKTOP (the end-state artifact)

Strictly after E2; N0 may start once E1 is merged.

**Item detail now lives in `native-desktop-goal.md` (2026-08-09)** —
authoritative for N phases, laws NL0-NL6, interlock lanes (N-BOT,
N-MAP, N-AIM), meters, and acceptance, the same way open-doors-goal.md
is authoritative for Track D. The N0-N4 summaries below stay as the
orchestration view.

- **N0 · Native harness.** `sim` compiles native (x86_64 first) behind a
  tiny CLI: step a `.jjr` replay headless, emit state hashes;
  cross-check = the same hashes as the wasm path. This is the port
  passport — and the fastest possible sim test loop as a bonus.
- **N1 · Shell — DECIDED 2026-08-09: raylib** (ADR-0008; SDL3 is the
  named fallback with recorded switch triggers). One confirmation spike
  remains, not three;
  netcode = plain threads + nonblocking sockets (research verdict: do NOT
  build on std.Io async — only Io.Threaded is production-grade, evented
  backends can't do sockets yet; do NOT trust 0.15/0.16 std TLS for
  anything). `@cImport` → `addTranslateC` migration lands here if the
  jump (L2) has happened by then.
- **N2 · Playable offline.** Windowed desktop build, bots, full round
  cycle, 60 Hz, ReleaseFast. "Working desktop version" minimum bar.
- **N3 · Networked.** Desktop client speaks the snapshot-delta protocol
  to the public :8088 host — same lobbies as browser players.
- **N4 · Distribution** (later: packaging, Steam). Out of scope until
  N3 is real.

## Track P — PROOF (runs continuously, never completes)

Open-doors 5.1–5.4 (funnel telemetry → warehouse, footage-study cadence,
stranger test, soak/load) + the engine meters (divergence sweep, bench,
replay hashes) + this doc's Status hygiene. The footage-first standing
directive lives here: 3 un-studied replays from 2026-07-31 are the
current queue.

## Priority algebra (when lanes conflict)

D Phase 0–1 → E1 → E2 → D Phase 2–3 (sim parts now Zig-native) → E3/E4
→ N0–N2 → D Phase 4–5 polish → N3+. Parallelism is encouraged (L5);
the algebra only settles conflicts for the single most-senior lane.

## Decisions ledger

Jake's seven (open-doors §Decisions) stand, plus: **Z4/E2 direction
ratified 2026-08-05** ("GO ALL ZIG" — execution evidence-gated, above);
**toolchain locked** (L2). Flag-dark builds per L4 for: email-gate
position (1.2), bell taper (1.5), announcer (4.3), board persistence.

---

## STATUS — ground truth, newest first

- 2026-08-09 (b) · **N1 shell DECIDED: raylib** (ADR-0008, SDL3 named
  fallback + switch triggers; reverses a same-day SDL3 recommendation
  on two withdrawn premises). Three spikes → one confirmation spike.
  Full reasoning in the ADR and native-desktop-goal Status.
- 2026-08-09 · **Track N expanded into `native-desktop-goal.md`**
  (authoritative for N detail; this doc keeps orchestration). Session
  soak re-verified ground truth: E2 still UNFLIPPED on the live host
  (`USE_WASM_STEP_WORLD` absent from the running :8088 server's env —
  the 07-31 replays' backend=wasm lines were the client swap-module
  layer, caveat from 08-05 (d) resolved); hosts healthy, bot-only
  since 07-31, zero commits since wave 2. Port-surface audit measured:
  54,392-line Phaser shell / 914-line bot brain / 486-line map gen /
  177-line delta codec core; `.jjr` = input-stream+seed (N0 needs no
  format work). L8 finding (Track P, fix queued): warehouse report.ts
  counts 20 `@example.com` test rows as "email signups" — real count
  ~0-1. Next-weakest unchanged: E2 headless soak → flip; N0 is
  unblocked and parallel-safe (L5).
  live.** Six lanes, one smoke.zig EOF-append conflict (resolved
  base+both-tails), full gates green post-merge: zig 142/142, client
  1949/0 (128k asserts), server 349/0 both authority modes, typechecks
  clean. Landed: admission tickets + pre-open hold (1.3 — 5/8 new tests
  verified-failing pre-fix), pending-entrant overlay ("YOU'RE IN"/NEXT
  BELL, never ELIMINATED — real sites were ~1198/1343, doc refs were
  stale) (1.4), lobby touch combat + persistent NEXT BELL countdown
  (1.5a; taper untouched = Decision 2), classModifiers through the
  codegen + true merge semantics + class starter bases (stopgap
  RETIRED), Paper Doubles + real next_entity_id through the bridge,
  hangout flag in step_world (pin LIFTED, both hosts). **First live
  boot caught what every suite missed:** the lobby's trainingDummy
  wasn't in the codec enum → per-tick encode throw + TS fallback;
  fixed additive both sides + round-trip gate (05dfa0e); live log clean
  since. Host restarted twice (bot-only), dist + sim.wasm live.
  NEW E-items from the wave: world.zig homing-at-integration passes
  empty player arrays (homing never turns under wasm — reachable now
  via priest tendrils); hangout dummy melee/edge-arc alternates
  unported (per-swing dedupe blocker); zero-damage cosmetic
  hit-confirm events dropped on wasm hangout path. E2 flip is now
  prerequisite-free: next = headless bot soak under wasm authority,
  then flip with kill-switch.
- 2026-08-05 (d) · **Track P: 2026-07-31 replay STUDIED** (first of the
  footage queue) — 3 windows rendered via the host's own headless
  pipeline, motion-analyzed, full-res verified. Findings in
  docs/clip-sheets/study-2026-08-05-jul31-replay.md: S1 bot idle floor
  violated (7.7 s statue bot, HIGH), S2 spectator director dwells on
  idle subjects (HIGH), S3 HUD-less renders read countdowns as dead
  air (MED), S4 render pipeline envelope documented (≤~45 s windows;
  upload 413 above; full-match encode wedges). S1+S2 = wave-3 lane
  candidates. Also recorded: all three 07-31 replays ran
  backend=wasm/fallback=0 live — verify which layer before treating E2
  as pre-flipped. Wave 2 (6 lanes) still in flight.
- 2026-08-05 (c) · **Wave 1 merged — Doors Phase 0 COMPLETE, E1
  split-spawn (real-projectile half) CLOSED.** Three parallel worktree
  lanes (doc-drift d18641b · honest-copy 46843d2 · split-spawn d6b1b9d,
  which also fixed four adjacent stepV2 lifecycle holes — see
  finish-line Z5 for the full record). Post-merge gates all green:
  zig 132/132, client 1909/0 (110,676 asserts), server 338/0 plus
  338/0 under USE_WASM_STEP_WORLD=1. Host restarted (bot-only, zero
  humans), new dist + sim.wasm live. Inline same day: 0.5 short-desktop
  fold fix (e35112e, 4-viewport verified), 0.8 hygiene (~84 MB).
  Next-weakest: Doors Phase 1 (1.3 admission race + 1.4 false
  ELIMINATED are the cruellest), E1 remainder (classModifiers codegen,
  Paper Double bridge, hangout flag), 2026-07-31 replay renders.
- 2026-08-05 (b) · Doors 0.2 (unfurl, 09c5960) + 0.3 (fonts) + 0.4
  (media preload) DONE in f926af4; dist rebuilt and serving. Next-weakest:
  Doors 0.5–0.8 (0.5 needs the 4-viewport pass), then E1, then the
  2026-07-31 replay renders (Track P queue).
- 2026-08-05 · **Doc created; goal live.** Phase 0.1 DONE — the 29 Jul
  dirty tree landed as six lossless commits (a8a4eaa net identity-
  escalation +tests · 10b359e CrazyGames removal · c3895ca global render
  governor · 5799ef5 Discord CTA/toast · 90f5bbe ops LAN-only listener +
  clip routes · 6d02055 marketing bank); worktree == HEAD verified; new
  suites green (12+2 pass). **Toolchain locked 0.15.2** per L2 — full
  research receipts: 0.16.0 current-stable-but-dead-end (0 patches,
  0.17.0 milestone 94%, weeks away), LLVM-21 vectorization disablement
  confirmed via release notes, async = API-shipped/not-complete
  (Io.Threaded only; evented can't socket; stackless unshipped,
  #23446), 0.15.2→0.16 migration for the sim empirically ZERO source
  changes (built + 125/125 + full 325-test parity + divergence sweep
  green against a 0.16-built sim.wasm on this box; artifact 3 bytes
  apart, identical 157-export surface), MIPS-III/N64 codegen verified
  emitting correct delay-slot ELF (Zig64 precedent; no -mfix4300 pass —
  far-future N64 caveat). Next-weakest: Doors 0.2 (unfurl `__ORIGIN__`)
  → 0.3 font → 0.4 preload, then E1.
