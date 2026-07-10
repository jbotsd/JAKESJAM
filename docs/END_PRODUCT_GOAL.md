# JAKESJAM — End-Product Goal

*The definition of done for the render/capture/platform overhaul. Everything
here is phrased as an outcome a player or viewer experiences, with a
verifiable acceptance test. Implementation lives in
[RENDER_OVERHAUL_PLAN.md](./RENDER_OVERHAUL_PLAN.md).*

---

## Vision

**One game, every screen, always smooth, always sharing.**

JAKESJAM is a fast arena brawler that runs from a Raspberry Pi taped behind
a TV to a 240Hz gaming rig — same match, same sim, same character that Jake's
procedural rig makes feel alive — where every device plays at the best that
hardware can honestly deliver, and every great moment turns into a
share-ready clip without anyone pressing record.

---

## 1. The player on any device gets the best version their hardware allows

**Outcome:** you open `play.elyad.io` on anything with a browser and it just
plays well. No settings safari required — but a settings panel exists and
always wins.

| Device | The promise |
|---|---|
| **Raspberry Pi 4/5 / old laptop** | Playable, readable, honest: 720p, 30fps (Pi 4) / 60fps (Pi 5), baked-rig visuals, zero fullscreen glow layers. It looks like a deliberate "clean" style, not a broken one. |
| **Phone (iOS/Android)** | A first-class client, not a shrunken desktop: dynamic twin-stick touch controls, aim assist (disclosed, server-validated), 60fps sustained through a 15-minute thermal soak, screen never sleeps mid-match, and pulling down a notification doesn't kill your slot. |
| **Ordinary laptop** | Native-res crisp (DPR-aware), 60fps, tasteful effects. |
| **Gaming desktop (4070+)** | The hardware is *used*: supersampled anti-aliased vector art, 120–240Hz motion, full effects stack (bloom, lighting, chromatic-on-damage, thousands of particles) — and the live procedural rig in full glory. |

**Acceptance tests**
- Pi 5 in Chromium: median frame time ≤ 16.7ms over a 10-minute bot match at
  720p; no interaction ever blocks on a frame spike > 100ms.
  **MEASURED ON THE REAL Pi 5 2026-07-10 (the living-room rpi, VideoCore
  VII / V3D 7.1.7 confirmed hardware-accelerated)**: auto-detection picked
  potato correctly; governor floored renderScale at 0.5 (960×540). First
  measurement: ~10fps in combat — two causes found and FIXED same session:
  (1) the Pi was software-encoding clips of itself (capture now disabled
  on potato; the replay renderer covers its highlights), (2) the cosmic
  vault's additive fullscreen stack (now gated at fxLevel 0). Result:
  ~20fps sustained in combat at 540p — 2× in one session, "deliberately
  clean" look verified by screenshot (baked rigs + contract FX, zero
  fullscreen glow). Remaining gap to 30fps target: platform-layer fill and
  ARM sim cost are the next suspects; row stays OPEN but is now measured,
  instrumented, and improving on real hardware.
- Mid-range Android phone: 60fps for 15 continuous minutes (thermal
  equilibrium), touch-only player completes a match and lands kills.
- iPhone Safari: lock the screen 10s mid-match, unlock → rejoined and
  playing within 3s, same entity, no manual refresh.
- 4080 dev box: 165Hz monitor shows 165fps render with tick-interpolated
  motion; MSAA on; renderScale 1.5 sustained.
- The quality auto-pick is never final: a visible settings panel
  (Auto/Low/Med/High/Ultra + resolution slider, Krunker-style) persists and
  overrides detection on every device.

## 2. The game *looks* dramatically better — starting with the strongest hardware

**Outcome:** the vector art style stops being sabotaged by its own config.

- Anti-aliased geometry everywhere on capable GPUs — no jagged rig limbs,
  no shimmering arcs.
- Sub-pixel smooth camera pans — no 1px stepping when the action camera
  drifts slowly.
- Sharp at native resolution on any display (HiDPI laptops included), with
  supersampling as the high-end luxury.
- The procedural rig remains the game's visual identity: on desktop it is
  *exactly the current rig*, enhanced only by AA and smoother motion. The
  baked twin on low-end devices moves identically (same springs, same
  poses) — a phone player recognises the same character.
- High tiers gain a composed effects stack (emissive bloom, arena lighting,
  damage feedback post-fx) that never costs readability: max-tier effects
  are readability-neutral by design and individually toggleable.

**Acceptance tests**
- Side-by-side screenshots (old config vs new) show AA'd edges and
  DPR-crisp text; slow-pan capture shows no whole-pixel stepping.
- Rig A/B: a 5s clip of the live rig and the baked rig performing the same
  recorded actions, viewed at phone size — motion indistinguishable.
  **A-SIDE BASELINE PINNED 2026-07-10**: live-vector rig rendered by the
  ReplayScene from stored replay `world-1783689217085.jjr`, ticks
  12000–13200 — clips `c144f036…` (1920×938) + `3cd60d29…` (vertical),
  pinned in the clip store with reproduction notes. The B side is ONE
  command once the baked backend exists: render the identical slice with
  the baked rig — same replay, same ticks, same camera, only the painter
  differs. The A/B is deterministic by construction.
  **BOTH SIDES EXIST + DETERMINISM PROVEN (later same night)**: the baked
  twin shipped as BakedPlayerRig — a subclass overriding ONLY the leaf
  painters (textured quads from canvas-baked parts), so every line of the
  live rig's spring/IK pose pipeline executes unchanged: motion-identical
  BY CONSTRUCTION. Canonical LUT-gated pair pinned: A = clip 5a8beb3c
  (live), B = clip 4facc5b6 (baked), same replay slice, frame-300 framing
  verified pixel-identical. Building the pair also CAUGHT the pre-wasm
  trig fallback live (two renders of the same slice diverged) —
  ReplayScene now awaits the LUT before stepping. Remaining: Jake's eye
  on the pair at phone size + visual iteration on the baked part art
  (potato tier only; desktop untouched).
- Toggling every effect at Ultra changes look, never gameplay legibility.

## 3. Smoothness is engineered, not hoped for

**Outcome:** the "glitchy bundle of liquid" era is permanently over, on every
tier.

- The sim stays fixed-tick 60Hz and bit-deterministic (Zig↔TS parity),
  identical across all tiers — fidelity never touches gameplay.
- Render is decoupled: interpolated remote entities (with capped
  extrapolation), monotonic render clock, adaptive interp delay under load —
  and now also *upward* decoupled: 120–240Hz displays get genuinely smoother
  motion, not repeated frames.
- Zero per-frame heap churn in the hot path: no allocation-driven GC hitches
  during a fight.
- A frame-time governor watches every session and trades resolution →
  particles → effects (in that order) before ever letting frame time slip;
  it steps back up conservatively.

**Acceptance tests**
- 10-minute fight on each tier: zero GC pauses > 5ms attributable to the
  render path (performance timeline); p99 frame time within 1.5× median.
- Kill-clip frame-by-frame analysis (the ffmpeg/centroid method) shows no
  velocity reversals on remote bodies during normal play.
  **PASSED 2026-07-10** — rendered-position series sampled per rAF in the
  live world during 8s of bot combat (176 samples × 3 bodies): remote
  bodies showed 0 instantaneous velocity reversals and 0 discontinuities
  across 133 sustained-motion pairs; the only direction changes were
  smooth decelerate-through-zero turns (−238→−84→+220 px/s class). The
  pre-fix signature (instant ±3900 px/s flips, 22 of 33 samples) is gone.
- Artificially throttled CPU (4× slowdown): governor degrades resolution
  visibly but motion stays continuous — no freeze-leap, no rubber-banding.
  **PASSED 2026-07-10** (8× CDP CPU throttle: renderScale stepped 1.0→0.5,
  frame rate recovered, no motion freeze).

## 4. Every great moment becomes a clip — with zero recording tax

**Outcome:** highlights are a *property of the match*, not of who happened to
be recording.

- **Nobody's game pays for capture.** The host/stream box records via the
  GPU's dedicated encoder (native replay buffer, saved on kill signal);
  remote players' browsers either encode entirely off the main thread or —
  end state — don't record at all.
- **End state: clips are rendered from replays, not screens.** Every match
  already stores kilobytes of deterministic inputs; a headless renderer on
  the server re-runs the real game and produces pixel-true video
  faster-than-realtime for *any* player's highlight, any camera angle,
  after the fact. A player on a Pi gets the same gorgeous 60fps clip as a
  player on a 4080, because the clip is rendered by the server, not their
  device.
- Deliverables are platform-perfect: vertical 720×1280+ with the
  action-tracking pan, H.264 high-profile NVENC at social-survivable
  quality (1440×2560 for Shorts), sub-minute from kill to shareable link on
  `play.elyad.io`.
- The clips backend (quota, pinning, ops console) keeps working unchanged.

**Acceptance tests**
- Host instance: frame-time delta with recording on vs off < 2% (native
  NVENC buffer).
- Remote players: encode fully off the main thread.
  **SHIPPED+VERIFIED 2026-07-10**: WebCodecs worker path live — per
  captured frame the main thread does one VideoFrame(canvas) + transfer;
  encode (latencyMode quality) + MP4 mux run in clipEncoderWorker.
  Probe-verified end-to-end: trigger → worker mp4 → upload → NVENC
  vertical → share URLs public, frames non-black. MediaRecorder remains
  the no-WebCodecs fallback.
- Kill → shareable vertical clip URL in < 60s, crisp enough that text/HUD
  in the clip is readable on a phone.
  **LOOP EVIDENCE 2026-07-10** (automated player): probe clicked the world
  URL → joined → fought via bot driver → trigger → 1920×938 mezzanine +
  NVENC 720×1280 vertical uploaded ≈13s later → share page `/c/<id>` and
  vertical media both public 200 with og:video tags. Capture ran with
  preserveDrawingBuffer:false via POST_RENDER; frames verified non-black.
  **REAL-USER LOOP 2026-07-10 19:50**: during Jake's live playtest his
  own kills auto-produced TWO clip pairs through play.elyad.io (1920×962
  mezzanines from his viewport + NVENC 720×1280 verticals, ~10s each),
  share pages public 200 — the goal's one-sentence loop (click link →
  fight → server hands you the highlight) has been completed by a human
  at the standard tier.
- Replay-rendered clip of a stored match is pixel-plausible against a live
  screen recording of the same match (same events, same positions, same
  camera behaviour) and renders ≥ 2× realtime on the 4080.
  **FOUNDATION PASSED 2026-07-10**: a real 7-minute world match (25,476
  ticks, 69,212 inputs, 7MB .jjr) re-simulated from disk to its exact
  final state in 0.51s — **830× realtime**, backend=ts, 0 fallback ticks.
  Re-sim cost is negligible; the renderer's budget is pure rendering.
  Known format gap for the renderer: the replay header rosters only
  match-start players — mid-match join/leave must be recorded (roster
  deltas) before world replays reconstruct every participant.
  **GAP CLOSED same day**: roster events are recorded (join spawn / leave
  playerId at their ticks) and the live host + re-sim share ONE pure
  join/leave implementation (rosterOps.ts). Validated on a fresh real
  match: a mid-match joiner absent from the boot roster was reconstructed
  in the re-simmed timeline (fought, died, final state correct) at 515×
  realtime. The replay substrate — record → persist → decode → roster →
  deterministic timeline — is complete; only the visual renderer remains.
  **RENDERER SHIPPED + END-TO-END PASSED same night**: ReplayScene re-sims
  a stored .jjr with the shared roster ops and renders with the LIVE
  game's own systems (rigs, contract-backed entities, combat FX, spectator
  director camera); `?replay=latest&render=1&from=&ticks=` steps 2 ticks
  per frame into the SAME WebCodecs worker the live recorder uses →
  /clips/upload → NVENC vertical. Verified headless on a real stored
  match: 600 frames / 20s slice → 1920×938 mp4 + 720×1280 vertical, both
  share pages public, frames show the reconstructed fight (bots named,
  arena correct, director-framed). A player's device never encodes
  anything — the pillar's core claim is now TRUE in production code.
- A player who joined from a phone gets a highlight clip of their own kill
  without their phone having encoded anything.

## 5. Phones are a growth surface, not a port

**Outcome:** "send the link to a mate at the pub" is a valid onboarding
funnel; the game is installable and feels native.

- PWA install (home-screen icon, standalone, wake lock); Capacitor wrap is
  an option later, not a dependency.
- Touch scheme good enough that a touch player is competitive-with-caveats
  (aim assist), and never *feels* like the controls lost the fight.
- Connection lifecycle is bulletproof on mobile networks: heartbeat detects
  silent socket death, resume = fast full-snapshot rejoin, matches tolerate
  5–15s absences without slot loss.

**Acceptance tests**
- Cold phone → tap link → in a match in under 15s on 5G.
  **MEASURED 2026-07-10 (LAN path)**: cold browser → https://play.elyad.io/?world=1
  → rendering inside a live match in **5.7s** (full page load, wasm boot,
  WS join, spawn — through the real cloudflared tunnel). 2.6× headroom
  against the bound; the 5G re-run needs the phone but the budget is
  established.
- Airplane-mode 8s mid-match → auto-rejoin, same entity, < 3s after signal
  returns.
- A first-time touch player gets ≥ 1 kill in their first three matches
  against bots (controls + assist are actually usable).

## 6. The architecture stays honest down the line

**Outcome:** every future visual/feature lands once and works everywhere.

- One render contract (`WorldState → RenderFrame`) feeds the live client,
  every tier, the phone client, and the headless renderer — a new weapon
  effect is authored once against the contract.
- One `QualityProfile` object is the single source of truth for fidelity;
  no scattered per-device if-statements.
- Replays record everything needed to reproduce a match bit-exactly
  (including which sim backend stepped it); determinism holes (pre-wasm
  math fallback) are closed and CI-tested.
- The Phaser version stays current-stable (4.2.x+), and the renderer's
  batching is respected by construction (one atlas, blend-mode discipline).

**Acceptance test**
- Adding a hypothetical new projectile type touches: sim, contract,
  one painter, one atlas entry — and it appears correctly on desktop,
  phone, Pi, and in a replay-rendered clip with no further work.
  **INTEGRATED LITMUS EVIDENCE 2026-07-10**: the same contract producers
  (projectiles, combat FX, destructibles, satellites) were verified
  painting in all four consumer contexts in one night — standard desktop
  (live probes), phone tier (live probe, vector rig + contract
  projectiles), potato tier (live probe: BAKED rig firing a
  contract-driven projectile mid-combat), and the replay renderer (the
  pinned A/B clips are painted by the identical producers, one side per
  rig backend). One producer change provably reaches every surface;
  the real-Pi row remains the only unexercised hardware.

---

## The one-sentence goal

> Anyone, on anything, clicks one link and gets the smoothest, best-looking
> version of the same fight their hardware can honestly produce — and the
> server hands them the highlight reel afterwards.
