# JAKESJAM Render & Capture Overhaul — Master Plan (2026-07-10)

Synthesis of a five-track research pass: (1) full client render-pipeline map,
(2) capture/replay pipeline map, (3) Phaser 4 renderer research, (4) capture/
encode-tech research, (5) Pi→phone→4070 scaling research. Goal: one
architecture whose fidelity scales from a Raspberry Pi to an RTX 4070 being
genuinely exercised, with phones as first-class clients, and a path to
browser-free clip rendering.

## Ground truth (what we measured/mapped)

- The client is ~entirely **immediate-mode vector art**: each player rig does
  `Graphics.clear()` + ~50–100 path ops + ~14 spring solves **per frame**
  (`rendering/ProceduralPlayerRig.ts:590,361-683`), plus 6 shared Graphics
  layers (combat FX, projectiles ×2, destructibles/fire/pickups ×3) that
  clear-and-redraw every frame. One texture exists in the whole game (128px
  glow). No atlas, no shaders, no filters.
- **Config is a pixel-art preset on a vector-art game**: `pixelArt:true`,
  `antialias:false` (aliased tessellated edges everywhere), `roundPixels:true`
  (camera pans quantize to whole pixels — fights the smooth rig + breaks
  batches), `preserveDrawingBuffer` on for all consenting players.
- **devicePixelRatio handled nowhere** → HiDPI displays get blurry upscale;
  no supersampling path for strong GPUs. Phaser 4 has no resolution knob —
  DPR is a manual pattern (game size = CSS×DPR, camera zoom compensates).
- Per-frame allocation churn: `new CustomEvent` every rAF (`main.ts:655`),
  per-frame `new Set()`/`Object.entries` in renderWorld/EntityRenderCoordinator/
  ProjectileVfx, `cardIds.join(",")` per player per frame, HUD chips/cards
  rebuilt with a linear `find()` per card per frame, ~20 `{x,y}` + 14 spring
  objects per rig per frame.
- Three rAF loops: Phaser step, music/mic FFT (+CustomEvent), clip capture.
- **Clips and replays never meet.** ClipRecorder = live screen recording
  (2D-copy canvas 30fps → MediaRecorder 16Mbps software H.264 → server NVENC
  crop-pan). ReplayRecorder = inputs+seed, deterministic re-sim proven in
  tests, stored to Convex, **consumed by nothing**.
- Determinism substrate is strong (fixed 60Hz tick, Mulberry32, LUT trig
  byte-identical Zig↔TS). Holes: `Math.sin` fallback before wasm loads;
  replays don't record which backend stepped the live match.
- Box note: ffmpeg links against NVIDIA driver **610.43.02** (the 595
  omarchy-pin memory is stale for the encode stack). h264/hevc/av1 NVENC all
  work incl. `-tune uhq` (hevc/av1); 30s 720×1280 clip @ p7 ≈ 3.7s.

## External research verdicts (sourced in the five reports)

- **Phaser 4.2.1** fixes ScaleManager RESIZE bugs (we're exposed on 4.1),
  adds `Mesh2D` (deformable textured tris — rig without tessellation),
  runtime `setFPSLimit`, cheap stencil masks. WebGPU is NOT coming to v4;
  plan on WebGL semantics.
- **MSAA (`antialias:true`) is the single biggest pure-fidelity win** for
  tessellated vector art; `roundPixels` verified to cause 1px stepping on
  slow pans. `preserveDrawingBuffer:false` always — capture alternatives
  exist (same-task `VideoFrame`/drawImage in POST_RENDER, or captureStream).
- **Browser hardware encode on Linux/NVIDIA is a dead end** (Chromium blocks
  NVIDIA VAAPI; nvidia-vaapi-driver is decode-only; Vulkan Video encode is
  P2/draft). WebCodecs in a DedicatedWorker with `latencyMode:"quality"`
  is still a big upgrade over MediaRecorder (pull-based, off main thread,
  no realtime frame drops; `new VideoFrame(canvas)` is a GPU-side copy and
  transferable; mux with mediabunny).
- **gpu-screen-recorder** (KMS capture + NVENC + RAM replay buffer, SIGUSR1
  to save, `-sc` post-save hook) = near-zero-cost native capture for the
  local/host/stream instance. Window capture is X11-only; use region/monitor
  KMS on Hyprland.
- **Headless replay rendering is viable**: `--headless=new` + real GPU
  (`--use-angle=vulkan` or `gl-egl`, assert not-SwiftShader) running the real
  Phaser build with a `renderReplayFrame(n)` sim-driven loop → WebCodecs or
  raw frames → ffmpeg NVENC p7. Faster than realtime, pixel-true, scales to
  ALL players because replays are kilobytes of inputs. (Fallbacks:
  chrome-headless-shell + BeginFrame; @napi-rs/canvas second renderer.)
- **Pi budgets**: Pi 4 ≈ 720p30, Pi 5 ≈ 720p60/1080p30 for blend-heavy 2D;
  the wall is FILL RATE — a Pi 4 affords ~3–5 fullscreen-equivalents of
  blended fill/frame. Phones are tile-based (TBDR): blended overdraw and
  big DPR backbuffers are the killers; cap DPR at 2, cap 60fps (thermals),
  target ~⅔ peak. `preserveDrawingBuffer` is extra-expensive on TBDR.
- **Krunker precedent**: resolution slider 0.1–2× (default 0.6×!) + low-spec
  master toggle + user override always wins. detect-gpu + micro-bench +
  frame-time governor is the detection stack (iOS renderer strings opaque).
- **Deliverables**: H.264 High p7/tune-hq/cq≈19 for all social uploads (AV1
  not accepted by TikTok/IG upload APIs in 2026); upscale to 1440×2560 for
  YouTube Shorts to hit the 1440p VP9 ladder; AV1 `-tune uhq` for in-app/
  archive only; skip HEVC.
- **Phones/network**: PWA-first (iOS wake-lock now works; fullscreen API
  still blocked on iPhone; `navigator.vibrate` absent on iOS). iOS kills
  WebSockets without firing `close` → heartbeat + assume-dead-on-resume +
  full-snapshot rejoin (same code path as spawn-in). Touch = dynamic
  twin-sticks in fixed zones + disclosed aim-assist as a server-validated
  input transform. Adaptive interp delay (2–3 snapshot intervals) for
  wifi/5G p99 jitter.

## The architecture (the redesign)

Three layers replace "visuals as scattered live-Phaser side effects":

1. **Render contract**: `WorldState + SimEvents + camera → RenderFrame` —
   a plain-data frame description (bone transforms for rigs, particle spawns,
   beam segments, camera box, effect intensities). Springs/IK/juice math
   live here, engine-free. Consumers: live client (all tiers), phone client,
   headless replay renderer.
2. **Texture-first Phaser backend**: rig parts baked ONCE at load into an
   atlas at 2× res with AA (bake the crispness in), animated via sprite/
   `Mesh2D` transforms — spring motion lives in transforms, so the feel
   survives while per-player cost drops from ~100 tessellated paths to a few
   batched quads. All layers onto one atlas, consistent blend modes,
   BitmapText for HUD. Truly-dynamic strokes (aim line, beams, telegraphs)
   stay live Graphics with `pathDetailThreshold`.
3. **QualityProfile + governor**: one object every visual system reads —
   renderScale×DPR (master dial), particle caps, filter stack, fps cap.
   Boot auto-tier (platform class → detect-gpu → micro-bench) + persisted
   user override + runtime frame-time EMA governor (step renderScale ±0.1
   first, particles second, filters last; slow step-up to avoid thermal
   oscillation).

### Tier ladder (from research; sim tick identical across tiers — fidelity never touches gameplay)

| | Pi/potato | Phone | Laptop/iGPU | Desktop-high |
|---|---|---|---|---|
| Internal res | 720p (governor may drop to 540p) | CSS×min(DPR,2)×0.7–0.8 | native×DPR(≤2) | 1.0–1.5× supersample |
| FPS | 30 (Pi4)/60 (Pi5) | 60 cap | 60 | uncapped (120–240Hz interpolated) |
| Rig | baked atlas | baked | live procedural | live procedural (full aura/trails) |
| Particles | ≤150, no additive fullscreen | 300–500, area-capped | 800–1500 | 3000+, DynamicTexture decals |
| Glow/lighting | OFF (pre-baked halo sprites only) | halo sprites, no filters | 1–2 filters | bloom/chromatic/PointLights/Light2D, 4–6 passes |
| MSAA | off | off | on | on |

## Phases

### Phase 0 — surgical wins (days; no visual redesign)
1. Upgrade Phaser 4.1.0 → 4.2.1 (RESIZE fixes, Mesh2D, setFPSLimit, stencils).
2. Config flip: `antialias:true`, `pixelArt:false`, `roundPixels:false`,
   `preserveDrawingBuffer:false` — move ClipRecorder's drawImage into a
   Phaser POST_RENDER hook (same-task ⇒ no pDB needed), keep 30fps pacing.
   Visually verify the new look (MSAA edges, sub-pixel pans).
3. Manual DPR + `renderScale` plumbing (backing store = CSS×DPR×scale, camera
   zoom compensation, one `scale.resize()` to change at runtime) — the
   foundation everything else dials.
4. Alloc scrub: kill per-rAF CustomEvent (SonicField already shared), reuse
   scratch Sets/arrays in renderWorld/EntityRenderCoordinator/ProjectileVfx,
   replace per-frame `cardIds.join`, gate HUD rebuild on change, make
   spring/vec functions write into out-params.
5. clipTranscode.ts encode upgrade (drop-in): `-preset p7 -tune hq -cq 19
   -bf 3 -b_ref_mode middle -rc-lookahead 32 -multipass fullres -spatial-aq 1
   -temporal-aq 1`. (Shorts 1440×2560 is a SHARE-TIME 2× lanczos upscale of
   the vertical, not a per-kill output — auto-generating it would double
   clip storage for files that mostly never get shared.)
6. Surface `game.loop.actualFps` + frame-time EMA in the stats HUD (governor
   groundwork + Pi debugging).

### Phase 1 — QualityProfile + governor + settings UI
detect-gpu-style tiering + 1–2s hidden micro-bench + localStorage override;
Krunker-style resolution slider + quality preset in settings; governor wired
to renderScale/particle caps.

### Phase 2 — texture-first retained renderer (the big one)
Extract the render contract; the rig becomes ONE pose computation (springs/
IK — cheap, runs on every tier) with TWO paint backends selected by
QualityProfile: the existing live-vector painter (unchanged — it IS the
game's look, and desktops afford it) and a baked-atlas painter for Pi/phone
(parts baked at 2× with AA at load, animated by the same pose transforms,
Mesh2D where deformation matters). Then projectiles/destructibles/combat FX
onto the atlas; BitmapText; high-tier filter stack (bloom on emissive layer,
damage chromatic) built on 4.2 Filters.

### Phase 3 — capture rework
STATUS 2026-07-10: WebCodecs worker path SHIPPED + verified. gsr replay
buffer BLOCKED on a real bug: gpu-screen-recorder 5.13.9 SIGSEGVs during
EGL init on this box's nvidia-open 610.43.02 + Hyprland stack (verified
in-session via hyprctl dispatch exec, forced NVIDIA vendor, every
platform permutation; three core dumps in coredumpctl). Fix candidates:
upgrade to gsr 5.14.x (AUR/source build — needs Jake), or wf-recorder
with -c h264_nvenc as a buffer-less fallback.
- Host/stream instance: gpu-screen-recorder KMS region replay buffer,
  game server sends SIGUSR1 on kill events, `-sc` chains the existing
  NVENC crop-pan. Zero in-browser capture cost. (Afternoon of work.)
- Remote players: WebCodecs-in-worker pipeline (POST_RENDER `VideoFrame` →
  transfer → `VideoEncoder` quality-mode → mediabunny → upload) replacing
  the 2D-copy + MediaRecorder path entirely.

### Phase 4 — phone client
Touch twin-sticks + aim-assist input transform (server-validated), PWA
manifest + wake lock + audio unlock, heartbeat + resume-rejoin protocol,
adaptive interpolation delay, portrait camera work (base exists).

### Phase 5 — headless replay renderer (clips for everyone, no browser tax)
Pin replay backend (record wasm/TS backend id in header; fix pre-wasm
Math.* fallback hole), build ReplayScene player on the render contract,
then headless Chromium GPU farm loop `renderReplayFrame(n)` → NVENC.
Unlocks: any player's highlight from kB of inputs, spectate/scrub UI,
and eventually broadcast-look re-renders (different camera per deliverable).

## Risks / notes
- Rig bake is the identity-preserving step — budget iteration time.
- Pi Chromium can silently software-render: ship the fps readout, treat
  Pi as best-effort.
- antialias:true changes the look globally (softer edges) — Jake should
  eyeball before it ships.
- 4.2.1 upgrade: retest Graphics hairlines (issue #7198 history) and the
  PlatformPainter texture path that broke on 4.1.
- Headless Chromium: assert real GPU at startup; chunk renders (ANGLE
  leaks); launch outside firejail.
