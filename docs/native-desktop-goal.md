# NATIVE DESKTOP — the same Zig core in a shell that owes TypeScript nothing

**Written 2026-08-09.** Expands `gospel-goal.md` Track N into an
exhaustive, runnable `/goal`. Direction was ratified 2026-08-05 inside
"GO ALL ZIG" — the native desktop is the gospel's declared end-state
artifact (#3). This doc is authoritative for N-item detail the same way
`open-doors-goal.md` is authoritative for Track D detail; gospel keeps
the orchestration and the priority algebra. Nothing here amends gospel —
where they appear to disagree, gospel wins and this doc gets fixed.

**Ground truth:** this doc's Status block (maintained commit-by-commit) ·
`gospel-goal.md` Status for cross-track state · `sim/build.zig` +
`sim/src/` for what the core actually exports.

**Scope of "no TS":** the *desktop artifact* contains zero TypeScript,
zero JS runtime, zero web view — a single native binary plus assets.
The browser client and the Bun server keep existing; de-TS-ing *them* is
Track E3's lane, not this doc's. A reader who wants "the whole product
is Zig" is reading the wrong doc — that end state is gospel E3 + this.

---

## End state (tool-satisfiable, per the deadlock law)

1. **N0 · Port passport.** A native (x86_64-linux first) CLI steps any
   archived `.jjr` replay headless and emits state hashes; for every
   replay in `server/.replays/` the native hash stream is bit-identical
   to the wasm path's. Wired into `zig build` as a test step so it runs
   forever after.
2. **N2 · Playable offline.** A windowed ReleaseFast build: full round
   cycle (spawn → fight → bell → draft → emission → ceremony → again)
   against bots, 60 Hz sustained (frame p99 ≤ 16.6 ms across a 5-minute
   bot match), input-to-sim ≤ 1 frame, audio live, zero network.
3. **N3 · First-class client.** The native build joins the public :8088
   host and completes a full match in a lobby shared with a browser
   client — zero protocol errors server-side, zero divergence/resync
   events across ≥30 min of play.

When all three are green this goal folds back into gospel's re-aim loop
(N4 distribution stays parked until N3 is real — see Non-goals).

## Verified starting position (soaked 2026-08-09, receipts below)

- **The sim is done and portable.** 17,520 lines of Zig across 20
  modules (`world`, `combat`, `projectile`, `draft`, `round`,
  `collision`, `destructible`, `satellite`, `rng`, `trig`, cards
  codegen…). E1 closed the last four behavior gaps 2026-08-05. The
  142-test native suite already compiles and runs the core natively —
  `build.zig` only *ships* wasm32, but portability is proven, not hoped.
- **E2 is not flipped.** Verified against the running host's
  environment (`/proc/<pid>/environ`, 2026-08-09): `USE_WASM_STEP_WORLD`
  unset — live authority is still TS. Gospel sequences N strictly after
  E2; **N0 is explicitly exempt** (allowed once E1 merged, and E1 is
  merged). E2's own gate (2 h headless bot soak, zero divergence, flat
  heap, then flip with kill-switch) is prerequisite-free and is the
  single cheapest unblock for everything past N0.
- **What exists only in TS today** (the port/replace surface):
  - Presentation shell `client/src/game/` — **54,392 lines** of Phaser
    4.2.1: `OnlineMatchScene` 3,506 · `ProceduralPlayerRig` 3,385 ·
    `LightConstruct` 2,824 · `HangoutScene` 1,835 · `StatusVfxController`
    1,667 · `CardDraftOverlay` 1,590 · `ProceduralAudio` 1,117 ·
    `CosmicArenaLayer` 1,085 · long tail. Mostly *procedural* rendering
    (rigs, constructs, particles, glow) — shapes and shaders, not sprite
    sheets. That ports to a native 2D batch renderer far better than an
    asset-heavy game would.
  - Bot brain `server/src/worldBots.ts` (706) + `botArenaNav.ts` (208).
  - Map generation `client/src/sim/data/maps.ts` (201, seeded `gen:N`
    arenas + named maps) + `server/src/mapStore.ts` (285).
  - Netcode `client/src/net/` ~3.7k; the snapshot-delta bit codec core
    is only 177 lines (`snapshotDeltaBits.ts`).
  - World-init: TS constructs initial state and packs it through
    `worldStateBridge` — the core has `world_state_set_spawn_points`
    but no full native constructor. Shells currently *hand the sim a
    world*; a native shell needs the sim to *make its own*.
- **Replay format is on our side.** `.jjr` = header + protocol version +
  RNG seed + input stream (never WorldState). A native harness re-steps
  inputs and compares hashes — exactly what N0 needs, no format work.
- **Assets:** `assets/sfx-memes/` 27 MB canonical recordings +
  `client/public/` 57 MB (fonts, audio, img, video). The native build
  needs a packer and decoders, not new art.
- **The TS sim mirror does not need porting.** `client/src/sim/` 34.7k
  lines retires under E3; it is already duplicated by the Zig core.

## The Laws (inherited + N-specific)

- **NL0 · Gospel laws apply wholesale** — L1 Zig-first, L2 toolchain
  pin 0.15.2 (jump ≥0.17.1 only through the documented gate), L3
  re-entry protocol, L4 tool-satisfiable gates / consent rows never
  auto-fired, L5 fan-out discipline, L7 standing hard rules (Bun only;
  no AI attribution; crystal/diamond grammar, no triangle/eye; meme SFX
  are canonical recordings — the native shell *plays files*, never
  synthesizes replacements; `ProceduralAudio`'s in-game synth engine is
  game audio, not meme SFX, and is explicitly fine to port), L8 honest
  meters.
- **NL1 · The shell is not the sim.** The native shell may contain zero
  game behavior — rendering, windowing, audio playback, input capture,
  sockets, asset IO only. Any behavior discovered living in the shell
  is a bug filed against Track E, exactly like TS shell behavior. The
  test: the headless N0 harness and the windowed N2 build must produce
  identical hashes for identical input streams.
- **NL2 · Hash-first determinism.** Native x86_64 float semantics must
  match wasm bit-for-bit. Concretely: no `@mulAdd`/FMA contraction
  differences (build native sim objects with the same float-strictness
  the wasm target gets), the shared trig LUT everywhere, no libm calls
  in sim paths. The N0 replay cross-check is the permanent enforcement;
  it runs in `zig build test` forever, not once.
- **NL3 · Baked tier first.** N2's visual bar at first light is the
  render overhaul's *baked* tier (the Pi/phone path), not the live
  desktop tier. Feel parity with the browser build is a footage-loop
  polish tail *after* N2's gates are green — tracked here, never
  blocking N2 acceptance. Stationary >1 s is still a bug on native.
- **NL4 · Decisions are spiked, not vibed.** The renderer/audio/window
  lib pick (N1) is **DECIDED — raylib, ADR-0008 (2026-08-09)**, on a
  written scored comparison with SDL3 as the named fallback and
  explicit switch triggers; one confirmation spike remains (N1.1), not
  three. Technical picks (lib, TLS approach)
  are machine decisions with receipts; money/accounts/distribution
  (Steam, code signing, storefronts) are Jake rows — built dark, never
  fired on silence.
- **NL5 · Single-writer files (native additions):** `sim/build.zig`,
  `sim/native/shell.zig` (once it exists), `sim/src/world.zig` (already
  listed in gospel). Worktree-per-writer for everything else.
- **NL6 · This box bites.** The dev desktop has a known RTX 4080 /
  nvidia-open context-teardown hard-lock (see memory:
  `env_nvidia_gpu_lockup`). Renderer spikes that churn GL/Vulkan
  context create/destroy loops are run with sysrq enabled and
  nvidia-persistenced active, work committed *before* first launch of a
  new spike, and never while the public host has humans on. A wedged
  spike must cost a reboot, not a lost lane.

## Phase N0 — PORT PASSPORT (unblocked NOW)

- **0.1 · Native build target.** `zig build native` produces an
  x86_64-linux executable linking the existing sim modules (the native
  test module in `build.zig` is the template — this is promotion, not
  invention). ReleaseFast + Debug both build. Acceptance: binary runs,
  prints sim version/export count.
- **0.2 · `.jjr` reader in Zig.** Parse header (schema version,
  protocol version, seed, match-start roster, mid-match roster deltas)
  + input chunks. Acceptance: round-trips every file in
  `server/.replays/` (12 files, ~100 MB) without error; unknown schema
  versions fail loud with the version printed.
- **0.3 · Headless stepper + hash stream.** Step the world from seed +
  inputs, emit the existing state hash every N ticks (N configurable,
  default 60) to stdout/file. Acceptance: full-match step of the
  largest replay (21.9 MB) completes; wall-clock recorded as the first
  native bench number (this becomes the fastest sim test loop we have).
- **0.4 · Cross-check gate.** Same hash cadence exported from the wasm
  path (reuse the parity harness); a comparator runs both on every
  archived replay. Acceptance: **bit-identical across all replays**, and
  the comparator lands in `zig build test` + the client parity suite so
  the passport is checked on every future sim change. Any mismatch is a
  NL2 float-semantics bug and blocks all N work until root-caused.
- **0.5 · Native world-init.** `world_init(seed, map_id, roster)` in the
  core (exported to wasm too) so shells stop hand-packing initial
  state. TS bridge keeps its packing path working (parity-tested) until
  E3 retires it. Acceptance: N0 harness can *create* a world natively
  and self-play bots (once N-BOT lands) without any packed-state input.

## Interlock lanes (Track E work this goal needs; they land per L1, once)

- **N-BOT · Bot brain into the core.** Port `worldBots.ts` +
  `botArenaNav.ts` (~900 lines) to `sim/src/bot.zig` with parity tests
  against the TS brain (same seed, same decisions, N seeds × M ticks).
  This is simultaneously Doors 3.2's "bot ramp" landing site — do it
  once, in Zig. Required for N2; also upgrades the E2 soak (soaked bots
  = sim-native bots, closer to the shipped truth).
- **N-MAP · Map gen into the core.** Port `maps.ts` seeded generation +
  the named maps to `sim/src/map_gen.zig`; server reads gen output
  through the bridge instead of generating in TS (TS copy retires under
  E3, parity-tested until then). Required for N2 offline; kills a whole
  class of "browser and desktop disagree about the arena" bugs before
  they exist.
- **N-AIM · E4 aim-intent substrate.** Mouse-exact dialect is what the
  desktop ships first; the assisted/stick dialects arrive with gamepad
  support. Desktop input feeds the same aim contract as browser input
  or NL1 is violated.
- **E2 · The flip** (owned by gospel, restated for sequencing): all N
  phases past N0 wait for it. It is prerequisite-free today.

## Phase N1 — SHELL: DECIDED, one confirmation spike (after E2)

**Shell lib = raylib. Fallback = SDL3. Decision, full alternative
analysis, and switch triggers: `docs/adr/0008-native-shell-raylib.md`
(2026-08-09).** The original three-spike plan (sokol/SDL3/raylib) is
replaced by that ADR's scored comparison plus a single confirmation
spike — NL4 is satisfied by a real comparison, not a ceremonial one.
Criteria that drove it: one dependency covering batched 2D + additive
blend + render-to-texture, TTF text, and ogg/mp3 decode of the 27 MB
canonical SFX bank; caller-owned frame loop; cheap Windows
cross-compile; available on-box today (`extra/raylib 6.0`).

- **1.1 · Confirmation spike** (one worktree lane, timeboxed). Bar:
  open a window; render 500 moving additive-blended shapes at 60 Hz
  with frame p99 printed; draw HUD text from a TTF; play one canonical
  meme SFX decoded from file; read mouse + one gamepad. Built via
  `@cImport` on `raylib.h` (no third-party bindings) **inside the repo
  or under `mise exec`** — `/usr/bin/zig` is 0.16.0 and only the mise
  shim resolves the pinned 0.15.2, so a scratch-dir spike returns
  misleading C-interop data. A spike that fights the box (NL6) records
  that as a finding — and as a live check against ADR-0008's
  GL-instability switch trigger.
- **1.2 · Promote or fall back.** Bar met → promote to
  `sim/native/shell.zig` skeleton, ADR-0008 Status flips from
  spike-gated to confirmed. Bar missed → SDL3 per the ADR's triggers,
  follow-up ADR, no re-argument of sokol or the webview wrapper (both
  rejected on the record).
- **1.3 · Netcode groundwork note** (carried, unchanged): plain threads
  + nonblocking sockets, **no** std.Io async, **no** Zig std TLS
  (0.15/0.16) for anything. The N3 transport/TLS row stays OPEN — see
  3.2; recommendation on record is wss:// through the existing endpoint
  with vendored mbedTLS (installed on-box, 3.6.5), zero server changes,
  no new exposed port.

## Phase N2 — PLAYABLE OFFLINE (the mountain, climbed at the baked tier)

- **2.1 · Frame loop + world render.** Fixed-tick sim (the same tick
  the server runs) decoupled from render; interpolated presentation;
  camera. Arena, destructibles, satellites, projectiles, players as
  baked-tier procedural draws. Acceptance: N0 replay *rendered* — watch
  an archived match play back windowed, hashes still matching while
  drawing (NL1's proof-of-innocence for the shell).
- **2.2 · Input dialect (mouse-exact).** Keyboard map per the current
  control truth (CLAUDE.md): move, Shift shield, left-click alternating
  throws, right-click/C aegis slide, E emission at full charge, 1-4
  drafted actives. Acceptance: input→sim ≤ 1 frame, measured not
  asserted; the full-charge client-side arm gate reproduced exactly
  (humans can never reach the parry, same as browser).
- **2.3 · Round cycle + draft UI.** Bell, round flow, universal
  round-end draft (winner drafts too, weights identical — they come
  from the core, not the shell), emission compose/cast, ceremony,
  "again". The draft overlay is the one genuinely *new* UI build
  (browser's is 1,590 lines of Phaser DOM-adjacent work) — native
  version starts functional-ugly at the baked tier per NL3.
- **2.4 · Bots + offline match.** N-BOT brains fill the roster; full
  FFA cycle vs bots with all four classes present (chassis rule: the
  Geometrician stays raycast, in any shell, forever). Acceptance: the
  end-state gate #2 numbers, measured over a scripted 5-minute soak,
  numbers logged to Status per L8.
- **2.5 · Audio.** Canonical SFX decode+playback (never synthesized
  substitutes) + the `ProceduralAudio` synth graph ported to the native
  mixer. Acceptance: A/B capture of the same replay browser-vs-native,
  event-aligned; missing/extra cues listed, not hand-waved.
- **2.6 · HUD + killfeed + nameplates.** Baked-tier text rendering;
  killfeed data comes from the core (Doors 4.6's landing site — again,
  once, in Zig). Class-identity legibility per the chassis axioms
  (colour stays earned: cyan/gold/white).
- **2.7 · Asset pack.** Deterministic packer (Bun script is fine —
  it's a build tool, not the artifact): fonts + SFX + music manifest →
  one binary-adjacent pack file with content hashes. No network fetch
  at runtime, ever, offline means offline.
- **2.8 · The polish tail (post-acceptance, footage-driven).** Live-tier
  VFX (constructs, status effects, tethers — Interstice/Syzygist only),
  screen-shake/juice parity, announcer hooks (voice choice stays Jake's
  Decision 3). Runs as normal L3 footage loops; never blocks N2 "done".

## Phase N3 — NETWORKED (first-class client)

- **3.1 · Codec port.** `snapshotDeltaBits.ts` (177 lines) + the delta
  escalation rules (identityChanged self-healing included) to Zig, with
  a golden-vector suite: captured browser-session byte streams decode
  identically in both implementations. The codec becomes core-owned;
  TS keeps a mirror until E3 (parity-tested, per L1's both-sides rule).
- **3.2 · Transport.** WebSocket client over plain threads +
  nonblocking sockets. **TLS decision row (machine, with receipts):**
  Zig std TLS is disqualified by the standing verdict, so it's (a)
  direct ws:// to :8088 (LAN + tailnet fine; public path is
  TLS-terminated today), (b) vendor a C TLS lib (mbedTLS/BearSSL) via
  interop, or (c) host exposes a dedicated non-TLS game port with the
  same auth story. Spike (b) and (c), pick in an ADR. No shipping a
  client that silently downgrades transport security — the pick is
  documented and deliberate.
- **3.3 · Prediction + reconciliation.** Same predict/reconcile
  contract the browser client runs, but both sides of it are now the
  same Zig core — divergence should be structurally impossible;
  the meter proves it (zero resyncs ≥30 min, logged).
- **3.4 · Mixed-lobby acceptance.** The end-state gate #3, run for
  real: native + browser client in one public lobby, full match,
  server logs clean. A stranger on the browser build must not be able
  to tell which opponent was native. Admission tickets / pending-entrant
  flow (Doors 1.3/1.4) honored identically — the native client is a
  client, not a special guest.

## Phase N4 — DISTRIBUTION (parked)

Packaging, icons, Windows/macOS targets, Steam. Out of scope until N3
is real (gospel's own rule). Every N4 item that costs money or creates
accounts is a Jake row. Do not open this section early because it is
fun; it is fun, and it is parked.

## Meters (Track P extensions, run continuously)

- **Passport:** native-vs-wasm hash equality over all archived replays —
  every sim change, forever (N0.4).
- **Bench:** native headless ticks/sec per replay (N0.3 baseline) —
  regressions reported per L8, including toolchain-jump deltas (the
  0.15.2 vectorization advantage is an empirical claim; this meter is
  where it gets re-verified when the ≥0.17.1 jump happens).
- **Frame:** p50/p99 frame time + input latency on the N2 soak.
- **Size/boot:** binary + pack size, cold-start-to-lobby time (browser
  open-doors gate is <15 s to a live fight; native should embarrass it —
  target <5 s, measured).

## Priority algebra (inherits gospel; N-local ordering)

Gospel: D Phase 0-1 → E1 ✓ → **E2** → D 2-3 → E3/E4 → **N0-N2** →
D 4-5 → **N3+**. N-local: N0 is exempt from the E2 wait and is the
correct *next* N-move today. Within N: N0 → (E2) → N-BOT + N-MAP + N1
(parallel lanes, L5) → N2 items in order → N3. The polish tail (2.8)
yields to every numbered item.

## Distance (calibrated 2026-08-09 against demonstrated wave velocity)

E1 — six lanes, ~350 new tests — landed in one day (2026-08-05), so in
sessions, honestly: N0 ≈ 1 · E2 soak+flip ≈ 1 (mostly wall-clock) ·
N1 spikes+ADR ≈ 1-2 · N-BOT/N-MAP ≈ 1 wave together · N2 to
gates-green at baked tier ≈ 3-6 · N3 ≈ 1-2 + the TLS ADR. **Offline
desktop vs bots: plausibly 1-2 weeks of current cadence. Feel-parity +
public-server: that plus a footage-driven polish tail measured in
weeks.** These are estimates, not gates; the gates are the numbers.

## Non-goals (recorded so silence can't expand scope)

Web/wasm shell targets for the native code (the browser client already
exists); mobile native; consoles (the aim dialect keeps the door open,
nothing more); N64 romhack fantasies (the MIPS receipt in gospel L2
stays a receipt); rewriting the Bun server in Zig (E3's conversation,
not this doc's); Steam before N3.

---

## STATUS — ground truth, newest first

- 2026-08-09 (b) · **N1 DECIDED: raylib** — `docs/adr/0008-native-shell-
  raylib.md`, SDL3 named fallback, switch triggers recorded (Deck/Steam
  Input becomes real · GL instability costs lanes on this box · VFX
  outgrow GL 3.3 · multi-window). Three-spike plan replaced by the
  ADR's scored comparison + one confirmation spike (N1.1); NL4 amended.
  Reversed an initial same-day SDL3 recommendation — two premises
  against raylib were withdrawn as wrong (it does NOT own the frame
  loop; its gamepad path rides GLFW's copy of the SDL controller
  mapping DB), and SDL_Render was found to supply no text and WAV-only
  audio, making the SDL path three C deps where raylib is one (its
  audio layer already IS miniaudio + dr_libs). Decisive argument:
  NL1 + the N0 hash passport make the shell swap-able and *provably*
  behavior-neutral, so a reversible decision should optimize
  speed-to-playable, and N4/Steam is parked. Standing costs on the
  record: OpenGL-only (no backend flip when the NL6 4080 lock bites),
  no Steam Input/gyro. Verified on-box: `extra/raylib 6.0-1`,
  `sdl3 3.4.14-1`, `mbedtls 3.6.5-1`. N3 transport/TLS row still OPEN.
- 2026-08-09 · **Doc created** from a full soak + measured port-surface
  audit. Verified this session: E2 unflipped on the live host
  (`USE_WASM_STEP_WORLD` absent from the running server's env); sim =
  17,520 Zig lines, 142 native tests passing (native compilation
  already proven via the test module); port surface = 54,392-line
  Phaser presentation + 914-line bot brain + 486-line map gen +
  177-line delta codec core; `.jjr` confirmed input-stream+seed
  (native re-sim needs no format work); world-init is TS-packed (no
  native constructor — hence N0.5); assets = 27 MB canonical SFX +
  57 MB public. Also logged for Track P (found during the soak, fix
  queued, not this doc's lane): `data-warehouse/report.ts` counts 20
  `@example.com` test rows as "email signups" — L8 violation, real
  signup count is ~0-1. **All N items OPEN. Next-weakest: N0.1-0.4
  (unblocked now) and gospel's E2 soak-and-flip (unblocks everything
  else).**
