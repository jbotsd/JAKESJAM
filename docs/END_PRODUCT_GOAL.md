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
- Artificially throttled CPU (4× slowdown): governor degrades resolution
  visibly but motion stays continuous — no freeze-leap, no rubber-banding.

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
- Kill → shareable vertical clip URL in < 60s, crisp enough that text/HUD
  in the clip is readable on a phone.
- Replay-rendered clip of a stored match is pixel-plausible against a live
  screen recording of the same match (same events, same positions, same
  camera behaviour) and renders ≥ 2× realtime on the 4080.
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

---

## The one-sentence goal

> Anyone, on anything, clicks one link and gets the smoothest, best-looking
> version of the same fight their hardware can honestly produce — and the
> server hands them the highlight reel afterwards.
