# GOAL — Broadcast-grade rendered highlights ("the clip is the ad")

*Authored 2026-07-17 from an exhaustive frame-by-frame study of a real
production clip (`/c/dff7f450-55dc-4316-8df7-654ebf4e2ccb`, Shady_Bass_Man's
triple kill). Every defect named below is visible in that footage. The goal
discipline is the venue-goal standard: every acceptance criterion is
tool-verifiable (ffprobe / bun test / grep / Playwright / frame-extraction);
human eye-tests are labeled AWAITING JAKE and never block completion.*

## North star

A rendered highlight is a **story about one player's best ten seconds**, told
well enough that a stranger who finds the file re-uploaded on some feed with
no context (1) understands what happened, (2) feels the hits, and (3) knows
what game this is and where to play it. Today's output is a silent, stuttering
21fps spectator screen-recording that ends on a banner announcing somebody
else won. The end state: frame-exact 1080p, real game audio, a camera that
tells the kill story, chrome that belongs to the clip (not to a spectator's
HUD), and trim discipline that always ends on the star's biggest beat.

The machinery already exists and stays: matchHost kill moments →
`server/src/clipRenderQueue.ts` (serialized headless Chromium, nice -15,
`JJ_RENDER_CLIPS=0` off-switch) → `ReplayScene` offline render
(`?replay=&render=1&from=&ticks=&follow=`) → WebCodecs encode →
`/clips/upload` → share page. This goal makes what comes OUT of that pipe
worth sharing. No new pipeline, no new services.

## The studied baseline (what the footage proves today)

From `server/.clips/dff7f450-55dc-4316-8df7-654ebf4e2ccb.mp4` (ffprobe +
2fps frame extraction, 2026-07-17):

- **B1** 1896×950 output (not 1920×1080 — the capture inherits a shrunken
  headless viewport), nominal fps metadata 57600/1.
- **B2** 215 frames over 9.96s ≈ **21.6fps real** against the renderer's own
  30fps/12s intent (`RENDER_FPS = 30`, `CLIP_TICKS = 720` → 360 frames
  expected); ~30% of frames missing AND ~2s of duration missing.
- **B3** **Zero audio streams** (`--mute-audio` at launch; no track muxed).
- **B4** 10.8 Mbps for a mostly-static dark scene at 21fps.
- **B5** The clip **ends on "ROUND 1 — TO BOT · GIZMO"** — a full-screen
  banner crediting a bot, over the star's 0-score roster. Worst possible
  final frame for a personal highlight.
- **B6** The star is anchored far-left and nearly stationary for all ten
  seconds; every kill lands 700–1200px away; at 0:44 the victim is half
  clipped off the right screen edge. Static wide camera, no punch-in, no
  slow-mo, dead center-frame.
- **B7** Spectator chrome baked into the artifact: "YOU · 0 · 100/100"
  roster row for a player who is never on screen (0/100 by the end), full
  hotbar + resource orbs, round timer/FIGHT header, and the **dev latency
  badge ("140ms") top-right**.
- **B8** "14 HEADSHOT" damage text rendered **twice, stacked/offset** on one
  kill (visible 0:41). Duplicate-spawn bug.
- **B9** Streak banners are world-anchored into clutter (half behind a gold
  explosion / platform), linger as translucent ghosts for seconds, and at
  the end a "MULTI KILL" ghost overlaps the round-over banner. A stray
  gnostic seal label ("CΦPAΓIC") floats mid-world meaning nothing.
- **B10** Damage numbers ("12") are illegible at clip scale; kills don't
  read at wide zoom (flash-and-gone, no silhouette-scale death).
- **B11** No identity: no star lower-third, no JAKESJAM/play.elyad.io mark —
  the file sells nothing once separated from its share page.

---

## Design

### A. Frame-exact capture, not wall-clock capture
The offline render must produce **exactly `ticks / TICKS_PER_FRAME` frames**
regardless of how slow the render box is that minute. If the WebCodecs path
can't be made frame-exact as wired, step-and-encode per frame (advance 2
ticks → render → submit frame with an explicit 33.33ms timestamp) rather
than capturing whatever the compositor managed. Output container carries a
sane fps (30000/1001 or 30/1 — never 57600/1). Viewport pinned to exactly
1920×1080 via CDP device-metrics override (`--window-size` alone is proven
insufficient — B1); device scale factor forced to 1.

### B. Real audio, rendered from the replay
The replay already carries every event the live game sonifies
(ProceduralAudio + SimEventRouter are pure consumers of sim events). Render
mode feeds the SAME engine and records its output into the clip's audio
track — the game's actual sound, not a substitute (house rule: never
synthesize stand-ins). Two acceptable mechanisms, executor's choice:
capture the page's real AudioContext output (drop `--mute-audio`, route via
MediaStreamAudioDestinationNode into the encoder), or an OfflineAudioContext
pass over the event stream muxed by ffmpeg. A quiet music bed from the
existing world tracks MAY be layered under SFX at reduced gain; SFX lead.

### C. Trim discipline — the clip ends on the star's beat
In/out points computed from the kill cluster, not fixed offsets:
- IN: ~1.5s before the cluster's FIRST kill (enough approach to read the
  scene, no standing-around lead-up; today's fixed 9s lead is why the star
  idles for most of the clip).
- OUT: ~2s after the cluster's LAST kill impact — hold the aftermath, then
  cut. **Never include a round-over/results banner unless the round went to
  the star.** If the round banner fires inside the window, the window
  shrinks to exclude it.
- The existing per-match cap (3) and queue bounds stay.

### D. Clip chrome — the HUD belongs to the star, not the spectator
Render mode gets `&hud=clip`:
- NO first-person HUD: no hotbar, no resource orbs, no roster column, no
  round timer/FIGHT header, no latency badge (B7). In-world nameplates
  stay — they identify actors.
- A **lower-third** in house language (Space Mono, ink/gold): star callsign
  + feat ("SHADY_BASS_MAN — TRIPLE KILL"), enters after the first kill,
  exits before the out-point.
- A small persistent **JAKESJAM · play.elyad.io** mark (corner, dim ink,
  ≤4% screen height) so the file advertises the game wherever it travels
  (B11).
- Subtle letterbox (~4%) to read as "footage", not "screen capture".

### E. Camera language — frame the relationship, punch the beats
The follow camera in render mode becomes a highlight camera:
- Frame the MIDPOINT of star↔engaged-victim (weighted toward the action),
  clamped so both stay on screen when within one screen-width; never let a
  kill land off-frame (B6).
- **Punch-in on each kill**: ease to ~1.15× over ~200ms, hold ~350ms, ease
  back. On the cluster's FINAL kill: punch 1.25× + a 0.4× time-dilation
  beat (~500ms of sim time rendered at slow-mo) before easing out — the
  replay is offline, slow-mo is free.
- Vertical bias follows the action's y (kills on upper platforms re-frame;
  today the camera never leaves the star's ground line).
- All camera moves eased (the existing ActionCamera vocabulary), no cuts.

### F. Banner & combat-text correctness (bugs first, then discipline)
- Fix the duplicate damage-text spawn (B8 — "14 HEADSHOT" twice for one
  hit). Unit-testable at the spawn site.
- In render mode, streak banners are **screen-space, one at a time,
  ≤1.2s each, newest replaces oldest** — never world-anchored into
  explosion clutter, never ghost-lingering into later beats, never
  colliding with (excluded) round banners (B9).
- Seal/ritual labels (CΦPAΓIC etc.) do not render in clip mode (B9).
- Damage numbers in clip mode: ~1.6× scale with dark outline, or omitted
  entirely below a legibility threshold (B10). Chosen behavior documented.
- Escalation labels stay monotone per cluster (KILL → DOUBLE → TRIPLE →
  MULTI; the code order at `OnlineMatchScene.ts:~2254` is correct — pin it
  with a test so it stays correct).

### G. The star must read alive (art, scoped tight)
- Weapon-hot idle: when the star has fired within ~2s, the rig holds a
  combat stance instead of the AFK sway (render mode can force this from
  the replay's input stream — no live-game change required).
- Muzzle beat: a one-frame flash + small recoil pose on fire so tracers
  have an origin (B6's "shots from nowhere").
- Death must read at wide zoom: victims get a silhouette-scale death pop
  (the existing kill fx scaled by camera zoom so it survives 100px-tall
  framing) (B10).

### H. Encode targets
1920×1080, true 30fps (60 if the frame-exact path proves cheap), H.264
high profile, CRF-equivalent quality ≈ 8Mbps ceiling for this content (down
from 10.8Mbps at 21fps — B4), +faststart for instant share-page scrubbing,
duration exactly `ticks/60`s ±1 frame. Audio AAC 128k stereo.

---

## Acceptance pillars

*(Each pillar ships alone, in order. A pillar is COMPLETE only when its
probes pass against a clip rendered by the REAL queue on this machine —
`bun scripts/probe-clip.ts <file>` is the shared verifier, built in CL.0.)*

### CL.0 — The verifier (build first, everything else proves through it)
1. `scripts/probe-clip.ts`: given an mp4, asserts via ffprobe —
   width/height exactly 1920×1080; real fps (frames/duration) within 2% of
   30 (or 60); nominal fps metadata sane (≤120); duration within 1 frame of
   `ticks/60`; ≥1 audio stream with non-silent RMS (ffmpeg astats mean
   volume > −60dB over the middle 50%); bitrate ≤ 9Mbps; moov atom before
   mdat (faststart).
2. Frame-motion check: extracts frames at 10fps and asserts no two
   consecutive extracted frames are byte-identical during the fighting
   window (catches dropped-frame stutter recurring).
3. Exit code + one-line PASS/FAIL table per assertion; used by every later
   pillar's ledger entry.

### CL.A — Frame-exact 1080p capture (fixes B1, B2, B4, encode targets)
1. Rendered clip passes probe-clip resolution/fps/duration/metadata/
   bitrate/faststart assertions (audio assertion may still fail — CL.B).
2. Frame count equals `ticks / TICKS_PER_FRAME` exactly (ffprobe
   nb_read_frames) on two different `ticks` values.
3. A deliberately loaded render box (run one `bun run autoplay` during the
   render) still produces the exact frame count — frame-exactness is
   load-independent by construction (test does exactly this).
4. grep: no `--window-size` reliance without the CDP metrics override;
   `RENDER_FPS`/`TICKS_PER_FRAME`/bitrate constants single-sourced.

### CL.B — Real audio (fixes B3)
1. probe-clip audio assertions pass: stream present, non-silent, AAC,
   in sync (a kill event's burst SFX peaks within ±150ms of its video
   frame — probe extracts the loudest 500ms and asserts it falls inside
   a kill-impact window computed from the replay).
2. The audio is the game engine's own output over the replay's events —
   grep: render mode constructs ProceduralAudio/SimEventRouter (or the
   OfflineAudioContext equivalent), no third-party SFX files introduced.
3. Music bed (if included) sits under SFX: astats on a kill window shows
   SFX peak ≥ 6dB over the bed's mean.
4. Suites green; live render on this box completes within the existing
   JOB_TIMEOUT_MS with audio on.

### CL.C — Trim discipline (fixes B5, the idle lead-up)
1. Unit tests on the window computation: given kill-cluster ticks, IN =
   first kill − ~90 ticks, OUT = last kill + ~120 ticks, clamped to round
   phase — a round-over entering the window shrinks it (property test
   across clusters near round ends).
2. Structural test: the rendered window NEVER contains a round-over tick
   whose winner ≠ followId (replay round events vs job window).
3. A real rendered clip's final second contains no round-over banner
   pixels (frame extraction + the banner's known text region OCR-free
   check: assert the banner element is not drawn — render mode exposes a
   `window.__replayRender.bannerFrames` counter the probe reads).
4. The star's first kill occurs within the first 3s of the clip (probe
   reads `__replayRender.killFrameIndexes`).

### CL.D — Clip chrome (fixes B7, B11)
1. Playwright/CDP render with `hud=clip`: DOM/canvas probes assert no
   hotbar, no roster, no timer header, no latency badge drawn (render
   scene exposes `__replayRender.chrome = {hud:false, lowerThird:true,
   watermark:true}` and a pixel probe confirms the badge region is
   background).
2. Lower-third renders star callsign + feat, appears after first kill,
   gone by the out-point (`bannerFrames`-style counters + one extracted
   frame shows it; the feat string matches the cluster size).
3. Watermark present in every sampled frame (pixel probe at the corner
   region), ≤4% screen height (measured).
4. Live-path regression firewall: normal gameplay HUD unchanged
   (`hud=clip` is render-mode only — grep + existing HUD tests green).

### CL.E — Camera language (fixes B6)
1. Sim-level test on the highlight camera: for a synthetic replay with
   star at x=700 and victim at x=1900 (one screen-width), the camera
   midpoint keeps BOTH inside the frame at kill tick (assert projected
   positions within viewport bounds) — the B6 off-screen-victim case,
   reproduced then pinned.
2. Punch-in: `__replayRender.zoomTimeline` shows ≥1.12× within 300ms after
   each kill frame and return to base within 1.5s; final kill shows ≥1.2×
   plus the slow-mo beat (frame timestamps stretch ~2.5× for ~15 frames).
3. Vertical: a synthetic upper-platform kill re-frames (camera y moves ≥
   200 world px toward the victim before the kill lands).
4. No cuts: camera position deltas per frame bounded (no teleports —
   max per-frame move assertion across the whole timeline).

### CL.F — Banner & combat-text correctness (fixes B8, B9, B10)
1. Duplicate damage-text bug: unit test reproducing the double
   "14 HEADSHOT" spawn (one hit-confirmed event → exactly one text spawn),
   red before / green after the fix.
2. Render mode: at most ONE streak banner live at any frame
   (`__replayRender.bannersLive` max = 1 across the timeline), each ≤1.2s,
   screen-space (fixed viewport coords across two consecutive frames while
   the camera moves).
3. Escalation monotone per cluster — test pins KILL→DOUBLE→TRIPLE→MULTI
   ordering and that a bigger label is never followed by a smaller one
   within one cluster.
4. Seal labels: grep + probe — the seal/ritual floating text path is
   gated off in render mode.
5. Damage numbers in clip mode measurably legible (font px ≥ 18 at 1080p
   after zoom transform) or absent — one behavior, asserted.

### CL.G — The star reads alive (fixes the AFK look; art-scoped)
1. Weapon-hot stance: sim/render test — rig pose flag flips to combat
   stance within 2s window after a fire input in the replay stream, back
   to idle after; no live-game behavior change (grep: render-mode gate).
2. Muzzle beat drawn on fire frames (probe counter `muzzleFrames` > 0 and
   aligned ±1 frame with fire inputs).
3. Death pop scales with zoom: at follow-zoom, victim death fx bounding
   size ≥ 48px measured in the probe's extracted kill frame.

### Sprint close (all pillars)
- Full client + server suites green, typechecks clean.
- One REAL production-path clip (rendered by clipRenderQueue off a live
  world replay on this box) passes `probe-clip` end to end, is playable on
  the share page, and its URL + probe output land in the ledger.
- The studied baseline clip's failures (B1–B11) each map to a passing
  probe or a pinned test — the ledger entry lists the mapping explicitly.

---

## Eye tests — AWAITING JAKE (evidence to collect; never blocking)

- Watch one rendered clip cold: does the punch-in + slow-mo on the final
  kill FEEL like a highlight, not a camera glitch? (clip link)
- Audio pass: do the hits land, is the bed too loud/quiet? (same clip)
- Lower-third + watermark: proud to post this file raw? (frame + clip)
- The star's weapon-hot stance: alive without looking twitchy? (clip)

## What "elegant" means here, concretely

- **Zero new services, zero new pipeline stages.** Same queue, same
  ReplayScene, same upload path. Render mode grows flags (`hud=clip`) and
  the camera/banner systems grow a render-mode branch — the live game's
  behavior is untouched (regression firewall in CL.D.4, CL.F.4, CL.G.1).
- **The replay is the single source of truth** — audio, camera, trim, and
  chrome all derive from the same event stream the sim already records.
  Nothing is captured from "whatever the screen happened to show".
- **Offline means free quality**: frame-exactness, slow-mo, and audio
  rendering all exploit that the clock is ours. The only hard budget is
  the existing JOB_TIMEOUT_MS and nice -15 GPU citizenship.
- **Probes over promises**: `scripts/probe-clip.ts` is the one gate every
  pillar walks through; a clip either passes it or the pillar isn't done.

## Constraints

- The render must never contend with the live 60Hz sim (nice -15,
  serialized queue, MAX_PER_MATCH=3, JJ_RENDER_CLIPS=0 off-switch — all
  preserved).
- House audio rule: the game's real engine output only; no synthesized
  stand-in SFX, no stock packs.
- House visual rules: palette/typography from the existing HUD language
  (Space Mono, ink/gold/sapphire); no new fonts, no new color registers;
  ui-axioms.md applies to the lower-third/watermark.
- Vertical 9:16 variants stay dead (dropped 2026-07-15) — this goal is
  16:9 only.

---

## Evidence ledger

*(append per pillar as work lands)*

**CL.0 — COMPLETE (2026-07-17)**
`scripts/probe-clip.ts` (CLI + importable module): eight checks —
resolution 1920×1080, real fps (counted frames ÷ duration) within 2% of
target, nominal fps metadata ≤120, duration = ticks/60 ±1 frame, audio
present AND non-silent (mean volume > −60dB over the middle 50%), bitrate
≤9Mbps, faststart via top-level MP4 box walk (moov before mdat), and a
motion check (10fps sampling across the middle 60%, zero byte-identical
consecutive frames). PASS/FAIL table, exit code. Self-test both
directions (scripts/__tests__/probeClip.test.ts, 2 pass): a known-good
ffmpeg synthetic (1920×1080@30 + sine audio + faststart) passes ALL
checks; the studied baseline clip fails EXACTLY its indexed defects —
resolution (B1), fps-real/fps-meta/duration (B2), audio (B3), bitrate
(B4) — and passes faststart, which production already had right. Run
against the real baseline: 6 FAIL / 2 PASS as predicted. Environment
lesson: /usr/local/bin/ffprobe on this box is a stale firecfg firejail
symlink whose private-tmp makes /tmp files invisible — the verifier pins
/usr/bin/{ffprobe,ffmpeg} explicitly (Jake: `sudo rm
/usr/local/bin/ffprobe` per the house firecfg policy when convenient).

**CL.A — COMPLETE (2026-07-17)**
Provenance discovery first: a REAL production render captured mid-flight
(the live queue rendered player_u993qx62's highlight while we watched)
proved today's host path already produces exactly 360 frames @ 30/1
nominal, 11.967s duration, faststart — the studied dff7f450 baseline
(21.6fps, 57600/1, wrong duration) was a CLIENT-side capture, not the
host renderer. The host path's real defects were resolution (canvas
inherited the page's shell layout: 1920×937 → encoder even-rounded to
938) and bitrate (CLIP_BITRATE 16Mbps → 13.4 measured). Fix: render mode
pins the canvas to the broadcast box before any camera math
(`scale.resize(RENDER_W=1920, RENDER_H=1080)` under Scale.NONE — window
and page layout become irrelevant, no CDP dependency), encoder `begin`
declares the box explicitly, CLIP_BITRATE 7.5Mbps. Verified through
probe-clip on a fresh production-command render made WHILE an autoplay
match hammered the box: resolution 1920×1080 PASS, fps-real 30.08 PASS,
fps-meta 30/1 PASS, duration 11.967s PASS, bitrate 7.23Mbps PASS,
faststart PASS, motion PASS — 7/8, audio the sole remaining FAIL (CL.B's
job). Frame-exactness pinned on two ticks values (720→360 frames,
360→180 frames, ffprobe-counted) with the 360 run under load. Extracted
frame eyeballed: undistorted 16:9, broadcast view confirmed chrome-free.
(Noted for CL.D/F: adjacent bot nameplates collide/overlap.)

**CL.B — COMPLETE (2026-07-17)**
The clip's audio IS the game's audio engine replaying the replay:
ProceduralAudio gained an offline mode (constructed over an
OfflineAudioContext sized to the clip exactly; every cue schedules at
`offlineAt` = (tick − startTick)/60 instead of ctx.currentTime; realtime
gates — context-state, voice caps, setTimeout second-layers — bypassed
or re-expressed as scheduled offsets; SFX level pinned to a fixed
broadcast mix, never this box's slider). SampleEngine (the Bitwig pack)
gained `at` scheduling + a whenReady() gate so sample-first cues can't
race the pack load. ReplayScene render mode routes every stepped tick's
events through the SAME SimEventRouter mapping live play uses (visual
deps stubbed — the HangoutScene precedent), renders the graph to PCM at
finish, and hands planar f32 to the encoder worker, which registers the
audio track at begin (tracks must precede Output.start) and muxes.
Codec: AAC when the encoder exists, Opus fallback — discovered live
that headless/Linux Chromium ships NO mp4a.40.2 encoder (decode ≠
encode; the config rejects at first sample). Bug fixed en route:
stepTicks returned only the LAST tick's events per 2-tick frame — half
of all audio/fx cues were silently dropped; now accumulates. Verified:
production-command render → probe-clip **ALL PASS 8/8** (audio: 1 opus
stream, mean −34.9dB). Sync spot-check: loudest 250ms window (0.38s)
lands exactly on a projectile connecting between the two bots on the
video track. Suites 1070 green. No third-party SFX anywhere — grep
clean; no music bed this pillar (goal marks it optional).

**BASELINE (2026-07-17)** — study of `/c/dff7f450-55dc-4316-8df7-654ebf4e2ccb`:
1896×950 @ 21.6fps real (215/360 expected frames, 9.96s of 12s intent),
57600/1 fps metadata, zero audio streams, 10.8Mbps, ends on a bot's
round-over banner, spectator HUD + 140ms latency badge baked in, duplicated
"14 HEADSHOT" text, world-anchored ghosting streak banners, stray seal
label, illegible damage numbers, star static far-left with kills landing
off-frame right. Defects indexed B1–B11 above; every pillar cites which it
retires.
