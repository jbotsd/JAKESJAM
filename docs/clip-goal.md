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

**CL.C — COMPLETE (2026-07-17)**
Trim discipline is a pure module (`server/src/clipWindow.ts`):
IN = first cluster kill − 90 ticks (1.5s approach, not 9s of standing),
OUT = last kill + 120 ticks (2s aftermath), 720-tick cap END-anchored
(long clusters shed lead-up, never the biggest beat), and THE LAW — a
window never contains a round-over edge whose winner isn't the star
(foreign banner shrinks the window; the star's own victory banner rides;
a window that would lose its final kill to clamping is dropped entirely
rather than rendering a kill-less "highlight"). MatchHost records
round-over/fighting edges at its existing phase-edge site
(`roundMarks`), passes them with the kill moments at replay persist;
clipRenderQueue routes through computeClipWindows and rides each
window's relative kill ticks on the render URL (`&kills=`); ReplayScene
publishes them as `killFrames` in every `__replayRender` status (the
probe surface CL.D/E also use). Tests: 12 (window law, END-anchored cap
with in-window killTicks filtering, foreign-banner property sweep across
700 positions, between-round lead-in clamp, drop-not-broken, MatchHost
mark recording via the real tick path). Fixed by the tests: the cap
could emit killTicks before the window start, and a fully-clamped
window could render without its kill. Live verification: a real kill
from Jake's own session (replay world-1784283166126, kill@1526)
rendered through the production command with the computed window —
probe-clip ALL PASS 8/8 (3.520s duration exact), and the extracted
frame at the declared kill offset (t=1.5s) shows the star firing with
the victim mid-death-burst. Server suites 219 green, deployed.

**CL.D — COMPLETE (2026-07-17)**
Broadcast chrome, owned by the clip and rendered on the house HUD-camera
split (installHudCamera — the follow camera's 2.4× zoom scales
scroll-fixed objects off-screen otherwise; replay world layers use
scrollFactors 0.65–1 so the partition captures exactly the chrome): 4%
letterbox bars, "JAKESJAM · play.elyad.io" watermark living inside the
bottom bar (≤4% height by construction, instrument-ink quiet, every
frame), and a lower-third — star callsign + feat (THE KILL / DOUBLE /
TRIPLE / MULTI KILL from the window's killTicks) entering on the first
kill with a 300ms render-clock fade and exiting 0.6s before the
out-point. `__replayRender.chrome` publishes
{hud, letterbox, watermark, lowerThird} per status. The renderer was
already HUD-free (CL.A discovery) — no roster, no hotbar, no timer, no
latency badge; the goal's strip-the-HUD criteria were satisfied by
provenance, the ADD-the-identity criteria by this pillar. Two real bugs
eaten en route: (1) container children created via this.add fire
ADDED_TO_SCENE and HudCamera's partition camera-filtered them away from
the HUD cam even after reparenting (cameraFilter=2 on the texts — fixed
by make.text add:false, unparented construction); (2) discovered the
EMAIL GATE DOM overlay sits over the render page in headless — harmless
(VideoFrame captures the canvas only) but documented for future
page-level captures. Verified on production-command renders: mid-frame
shows SHADY_BASS_MAN — THE KILL + full chrome, final frame shows chrome
without the lower-third, probe ALL PASS 8/8 throughout. Live game
untouched (every change gated in ReplayScene render mode).

**CL.E — COMPLETE (2026-07-17)**
Highlight camera as pure math (`render/highlightCamera.ts`) + ReplayScene
integration (render mode only): star↔victim anchor (35% victim weight)
with BOTH-on-screen clamping; **zoom-to-fit** — a separated duel widens
the camera down to a 1.25 floor instead of letting the victim leave the
frame (the tests reproduced B6 exactly and forced this design: a fixed
2.2 zoom can only show 872 world px); kill punch-ins (+15%, final kill
+25%) driven by a per-frame beat envelope (ease-in 200ms/hold 350ms/
ease-out 400ms) keyed off killTicks mapped to VIDEO frames; 2× slow-mo
across 30 sim ticks leading the final kill (1 tick/frame → exactly +15
encoded frames — deterministic, so the duration gate stays EXACT via
probe-clip's new `--slowmo N`); victim-hold keeps a fresh corpse framed
~0.6s; audio now schedules on the VIDEO clock (frameIndex/fps) so the
stretch can never desync later cues; exponential chase on position and
zoom — no cuts by construction. Tests: 7 (B6 pinned, star-wins on
impossible separation, vertical re-frame ≥100px, punch ≥1.12×/≥1.2× and
release, bounded per-frame deltas across a worst-case target teleport,
slow-mo schedule = exactly +15 frames clamped to the window). Suites
1088 client green; live production-command render probes **ALL PASS**
with `--ticks 210 --slowmo 15` (119 frames, 4.020s exact); extracted
post-kill frame shows the widened two-actor composition holding the
death-soul in frame. Realtime playback and the rig-showcase follow-cam
untouched.

**CL.F — COMPLETE (2026-07-17)**
B8 investigated to ground truth: the event pipeline has NO duplicate
path — the server flushes each SimEvent exactly once per snapshot window
(pendingEvents → one broadcast), the client dispatches once, and the
router's hit-confirmed case is the single damage-text spawn site. The
"stacked 14 HEADSHOT" still is two SEQUENTIAL headshots at rising float
offsets (fire cadence ≈ text lifetime). Pinned rather than guessed:
SimEventRouter unit tests — one hit-confirmed → exactly one spawn
(headshot flag intact), N hits → exactly N (found and documented that
dispatch() no-ops entirely on null audio). Escalation ladder extracted
to `ui/killstreakLabels.ts` (single source, OnlineMatchScene consumes)
with monotone + order-pinned tests; the footage's TRIPLE→MULTI sequence
was CORRECT escalation misread against a countdown timer. Render-mode
banner/seal/damage-text discipline is satisfied by construction — the
broadcast view draws none of them (grep: ReplayScene's only
spawnDamageNumber reference is the audio-router stub; no
spawnKillCallout, no seal-chip imports) — B9's clutter/ghost/seal
defects were client-capture artifacts, retired with the provenance
finding. Suites 1092 client green, built.

**CL.G — COMPLETE + SPRINT CLOSED (2026-07-17)**
The rig already owned the liveliness vocabulary — triggerFire() = muzzle
whip + a 1.6s weapon-hot combat-stance hold decaying back to idle
(inside the goal's 2s window), triggerHit() = knockback — but
ReplayScene's event router passed a STUB rigs map, so rendered clips
never fired any of it: the AFK-sway-while-shooting look was one missing
wire. Fixed (router now drives the real rigs; render-gated by
construction since the router only exists in render mode) + a wiring
test (shot-fired → rig.triggerFire with the sim's hand). Death pop at
follow zoom: the shared death-fx painter at 2.2× renders the gold
soul-burst at ~150px — evidence frames from CL.C/E dwarf the 48px bar.
Final production-command render: probe-clip **ALL PASS 8/8**
(`/c/01de8b0f-0510-4568-ac75-9bc69070022a` — playable on the share
page); the extracted firing frame shows the star mid-throw in combat
stance with both duelists framed. Suites at close: client 1093, server
221, probe self-tests 2 — all green; typechecks clean; deployed.

**Baseline→retirement map:** B1 resolution → CL.A (probe PASS)。B2
fps/duration/metadata → CL.A (30/1, frame-exact, load-independent).
B3 audio → CL.B (engine audio, opus, sync-checked). B4 bitrate → CL.A
(7.4Mbps). B5 foreign-banner ending → CL.C (window law + property
sweep). B6 static camera/off-frame kills → CL.E (zoom-to-fit pinned) +
CL.G (stance/muzzle). B7 spectator chrome/latency badge → provenance
(host renders were always chrome-free; identity ADDED in CL.D). B8 dup
damage text → CL.F (single-spawn pinned; sequential-hits explanation).
B9 banner clutter/ghosts/seal labels → CL.F (absent in render mode by
construction; provenance). B10 illegible damage numbers/unreadable
deaths → CL.F (absent in clips) + CL.G (zoom-scaled death pop). B11 no
identity → CL.D (lower-third + watermark). Note for the next organic
match: production queue jobs now carry `&kills=` and the probe gains
`--slowmo 15` when killTicks are present.

**STUDY 2 (2026-07-17, post-sprint)** — footage-study loop on
`/c/01de8b0f` (the sprint-close clip): B1–B11 all hold retired (probe
ALL PASS; chrome, trim, camera, stance verified in-frame). One NEW
defect indexed and fixed same-loop: **C1 — opening rig-streak**: rig
limb springs initialize unconverged, so every clip's first ~15 frames
opened on vertical noodle-rigs and colliding nameplate boxes (the first
thing every viewer saw). Fix: 20 un-captured warm-up render passes
before the first encoded frame (springs settle onto the real pose;
frame budget untouched). Re-taped: frame 0 now opens on both duelists
fully formed mid-fight; probe ALL PASS 8/8. RETIRED: C1. REGRESSED:
none. NEW: none outstanding.

**STUDY 3 (2026-07-27)** — batch footage-study of ALL 12 clips rendered
2026-07-27 (`server/.clips/{e2314eee,181fee23,909e0a8a,8c92b0b0,4245f13a,
d97dcb8c,e8bd644d,41971b84,0e21238e,80ea1663,5652baba,3e6a056c}*.mp4`), each
probed/2fps-read/burst-verified independently. Counts: **0 clean** (every
clip carries at least one indexed defect), **REGRESSED across 8 of 9
pillars** (CL.A/B/C/D/E/F/G + the never-closed CL.A nameplate-collision
note), **4 NEW cross-clip defects indexed (D1–D4, plus D5–D8 minor/
one-off)**, **1 still-open item finally reproduced on tape** (nameplate
collision), **B1/faststart/C1 hold RETIRED**. One clip (`41971b84`) shipped
with an empty per-clip report (probe/leadSentence/defects all placeholder)
— back-filled here via direct ffprobe since the file exists on disk; flagged
as a DATA-GAP for the study process, not a footage defect.

**THE STRUCTURAL FINDING — this batch is two different clip populations,
only one of which the CL.0–CL.G sprint ever touched.** Five of the twelve
files (`181fee23`, `d97dcb8c`, `5652baba`, `3e6a056c`, `41971b84`) carry a
`<id>.dims.json` sidecar next to the mp4. `server/src/clipStore.ts:318-329`
writes that sidecar ONLY when the upload's multipart form includes
`width`/`height` fields — and the only call site that appends those fields
is `client/src/game/highlights/ClipRecorder.ts:495-498`, the **opt-in,
client-side, consent-gated "record my own gameplay" recorder**
(`clipConsent.ts`), a genuinely different feature from
`matchHost → clipRenderQueue.ts → ReplayScene` offline render that every
CL.0–CL.G pillar was built and verified against (`ReplayScene.ts:826`
uploads with no width/height fields — no sidecar, ever). ClipRecorder.ts
was never in scope of this goal doc, was never touched by any CL pillar,
and captures the live spectator canvas (full HUD, whatever fps Chromium's
software H.264 sustains, `--mute-audio` inherited from its own older
capture assumptions). That is why these 5 files individually reproduce
nearly the ENTIRE original B1–B11 signature at once — not because CL.A–G
regressed, but because this population was never fixed in the first place
and nobody had separated the two clip sources until this study cross-
referenced `.dims.json` presence against the code. **Action needed in the
next /goal: either extend CL.0–CL.G's pillars to cover ClipRecorder.ts
explicitly, or mark it formally out-of-scope in this doc's Constraints
section** — right now a stranger who lands on a share page has no way to
know which of the two experiences they're about to get, and 5/12 of
today's output is the bad one.

RETIRED (holds, confirmed on the other 7 clips — `e2314eee`, `909e0a8a`,
`8c92b0b0`, `4245f13a`, `e8bd644d`, `0e21238e`, `80ea1663` — all produced
via the real clipRenderQueue/ReplayScene path, no `.dims.json`): **B1**
(1920×1080 exact on all 7); **faststart** (moov-before-mdat on all 12,
including the 5 ClipRecorder.ts files — the one thing that never broke
anywhere); **C1** (no opening noodle-rig/rig-streak on any of the 7 render-
path clips).

REGRESSED, in the 5 ClipRecorder.ts-path clips only (functionally the exact
pre-sprint experience, though the fixed pipeline itself is untouched):
- **B1** resolution — `41971b84` alone: 1824×1026 (ffprobe this session:
  `width=1824,height=1026`), matching the original shrunken-viewport
  failure mode exactly.
- **B2** fps/duration/metadata — all 5: `181fee23` 194f/9.9775s=19.44fps
  (nominal 57600/1); `d97dcb8c` 222f/9.987s≈22.2fps (57600/1); `5652baba`
  247f/11.638s=21.22fps (57600/1); `3e6a056c` 194f/10.008s≈19.39fps
  (57600/1); `41971b84` 197f/9.926s≈19.84fps (nominal 161/6, this session's
  ffprobe) — every one worse than or matching the original 21.6fps.
- **B3** zero audio streams — all 5, confirmed via ffprobe `-select_streams
  a` returning empty (`41971b84` confirmed this session).
- **B4** bitrate over the 9Mbps CL.0 ceiling — `181fee23` 9.35Mbps,
  `5652baba` 9.10Mbps (probe-clip.ts FAIL), `3e6a056c` ≈9.75Mbps,
  `41971b84` 9.92Mbps (this session); `d97dcb8c` 8.47Mbps is the one PASS.
- **B6** static camera, no punch-in, kills off-frame/edge-clipped —
  `181fee23` (burstA-25/35 vs burstB-16/24, identical zoom across two
  kills), `d97dcb8c` (burst-open vs burst-hs1 vs burst-end, star drifts to
  the far-right wall, never reframed), `5652baba` (burst-open/b-01 vs
  burst-kill/b-10 vs burst-roster/b-15, ~9s unchanged framing),
  `3e6a056c` (burst-open/b-01..b-40, no zoom/scale change across the kill
  moment, action pushed toward the clipped right edge).
- **B7** full spectator chrome (roster, hotbar, round timer, dev latency
  badge) baked into every frame — `181fee23` (f-01..f-20, crop-roster-f14),
  `d97dcb8c` (f-01..f-20, badge 146ms→164ms), `5652baba` (f-01..f-23,
  badge 141ms→231ms), `3e6a056c` (f-01/f-19-20, badge 231ms→156ms).
- **B8/B9** duplicate/ghosting banners and damage text — `181fee23`
  (MULTI KILL fires twice ~1s apart, burstA-20/30 vs burstB-24, each
  instance also drifting/fading/right-edge-clipped); `d97dcb8c` and
  `5652baba` both show a translucent DOUBLE-KILL ghost bleeding through
  under a fresh TRIPLE-KILL/MULTI-KILL banner (both at burst-open/b-10 and
  b-15); `3e6a056c` shows ≥4 stacked "14 HEADSHOT"/"3 HEADSHOT" copies
  smeared together from frame 0 (burst-frame0/b-01, burst-open/b-01..
  b-06) — a worse recurrence than the original single duplicate pair.
- **B10** illegible damage numbers — `d97dcb8c` (burst-hs1/b-32, b-36),
  `5652baba` (burst-open/b-01, burst-kill/b-01).
- **B11** no watermark/lower-third — `181fee23`, `d97dcb8c`, `3e6a056c`
  all confirmed absent across every sampled frame.
- **B5-sibling (no resolution beat at all, worse than the original "wrong
  banner" ending)** — all 4 non-placeholder ClipRecorder.ts clips end on
  raw mid-fight dead air with zero banner/fade/hold: `181fee23`
  (f-23/burst-end/b-01, FIGHT 0:40, no conclusion), `d97dcb8c`
  (burst-end/b-21, fresh hit mid-flight, no kill), `5652baba`
  (f-23/burst-end/b-01, ordinary mid-fight pose), `3e6a056c`
  (burst-end/b-19, HP 17/100, mid-hit, hard cut in the red).

REGRESSED, found this session in the OTHER 7 (real render-path) clips —
these are genuine CL.C/D/E/G gaps the sprint's own tests didn't catch,
not ClipRecorder.ts noise:
- **CL.E** (camera relationship-framing/punch-in/slow-mo) fails to fire in
  6 of the 7 render-path clips: `e2314eee` (f-01..f-08, zero camera
  reaction across the whole 4.02s), `4245f13a` (openburst-01 through
  endburst-18, pixel-static scale/position start to end), `e8bd644d`
  (even-07 vs even-20 identical composition + diffviz.png pixel-diff
  showing only codec noise), `8c92b0b0` (burst-25/30/35 — the camera
  actively ZOOMS OUT to isolate the star alone at the exact kill moment,
  the opposite of the shipped punch-in doctrine), `0e21238e` (f-05/f-14/
  f-20/f-24 — identical zoom/composition throughout). `909e0a8a`'s follow-
  cam itself still moves smoothly (burstA-01..40) but has nothing valid to
  key off (see D1) so the punch-in system never triggers.
- **CL.C** (trim/window law: IN ~1.5s before first cluster kill, OUT ~2s
  after last, never a foreign-banner ending) violated in its "misses the
  kill" direction: `80ea1663`'s entire render window sits AFTER the
  credited double-kill already happened — audio is total digital silence
  for seconds 0-3 exactly where the kill should be (per-second astats:
  sec0-1/1-2/2-3 = -91.0dB mean&max) and the clip is pure aftermath;
  `0e21238e`'s lower-third doesn't appear until ~t=6.8s of a 12.52s clip
  with no interim escalation state, i.e. the window's approach lead-in is
  ~6.8s instead of the ~1.5s the law specifies (burst1/b-026 vs b-031).
- **CL.D** lower-third exit-before-out-point violated: `909e0a8a`'s
  "SHADY_BASS_MAN — DOUBLE KILL" is still full-opacity on the literal last
  video frame per ffprobe pts (burstB-24.png, pts_time=4.1667s of
  4.2200s duration) — explicit regression against CL.D.2's stated fade-
  before-outpoint behavior; `80ea1663`'s "VVOC / DOUBLE KILL" rides all
  the way to the hard cut with no exit cue at all (burst-end-40).
- **CL.G** (weapon-hot stance / muzzle beat, fixes the AFK look) fails to
  hold across the credited action in 4 of 7: `e2314eee` (one frozen
  crouch pose the entire 4s, startburst-01 vs endburst-21), `909e0a8a`
  (plain walk-cycle throughout, never enters combat stance — f-01/f-04/
  f-08/burstA-13/burstB-11), `8c92b0b0` ("reads AFK for most of the
  runtime" — f-11..f-16, idle for ~9 of 12.5s including the nominal
  double-kill window), `e8bd644d` (idle landing-recovery hold the whole
  clip, even-14..even-24, never weapon-hot).
- **CL.B (kill-audio sync sub-check, CL.B.1)** — separate from the B3
  zero-stream regression above: `0e21238e`'s track is present and non-
  silent throughout but shows NO loudness spike anywhere near the banner's
  ~t=6.8s entrance (flat -34.8..-35.3dB across three ~4s thirds) — no
  audible kill SFX at all, failing the ±150ms-of-kill-frame sync
  requirement CL.B.1 pinned.
- **STILL-OPEN, not actually retired despite CL.A/CL.D/CL.F all closing**:
  the adjacent-bot-nameplate-collision defect CL.A's ledger entry noted
  in passing ("Noted for CL.D/F: adjacent bot nameplates collide/
  overlap") 2026-07-17 but no pillar ever assigned it a test — it
  reproduces on tape for the first time this session: `0e21238e`
  (burst-open/o-001.png, t≈0.03s, VVOC/BOT·PISTON nameplates garbled
  together). Recommend a real CL-numbered pillar next /goal instead of a
  parenthetical.

NEW (this session, indexed D1–D8, continuing the B→C→D per-study letter
convention):

- **D1 — the credited kill has no visual corroboration ("invisible kill"),
  100% of the 7 render-path clips.** The lower-third/banner announces a
  kill, double-kill, or multi-kill and the footage shows no shot, no
  death-pop, no damage number, and often no victim in frame at all: proof
  is one clip per line below —
  `e2314eee` (openburst-01/burst-21/endburst-18 — victim off-frame or
  half-cropped the entire runtime, zero VFX);
  `909e0a8a` (f-01..f-08 — only bystander VVOC on screen, never engages);
  `8c92b0b0` (burst-35..burst-50 — camera isolates the star alone at the
  claimed kill moment);
  `4245f13a` (openburst-01 vs endburst-18 — both actors alive/full-HP at
  both bookends of "THE KILL");
  `e8bd644d` (even-07/even-20/even-24 — two actors standing side by side,
  no exchange, ever);
  `0e21238e` (f-14 vs f-15 — banner appears mid-idle-traversal with no
  kill event visible before or after);
  `80ea1663` (burst-open through burst-kill — zero combat in the entire
  visible window; kill happened pre-IN, see CL.C above).
  This is the single most damaging finding of the batch — it fails the
  goal's own North Star ("a stranger... understands what happened") in
  every clip that isn't ClipRecorder.ts noise. Plausible shared root
  cause: CL.C's window computation and/or CL.E's victim-anchor resolve
  against a kill/follow entity that doesn't match what's actually
  rendered as the followed "star" — see D3, likely the same underlying
  followId/kill-credit mismatch.
- **D2 — HARD RULE FLAG: hexagram-in-ring renders on in-world spawn/
  landing markers, 2 of 12 clips, explicit prohibited pattern.**
  `4245f13a` (ring-crop-1.png, ring-crop-2.png — gold ring with an
  inscribed six-pointed hexagram, near-constant frame t=0 through end) and
  `e8bd644d` (ringzoom-left.png, ringzoom-right.png — same asset under
  BOTH characters, on screen ~t=0.3s to past t=3.9s of a 4.02s clip) both
  show the exact two-overlapping-triangles pattern the standing house rule
  prohibits in any Jake visual ("no triangle-in-rings/eye-at-center/
  hexagram reads... tender subject"). Two more clips show the same gold-
  ring FAMILY asset without the hexagram inscribed (`e2314eee` — plain
  ring under the platform; `80ea1663` — plain ring under the star's feet,
  screen/character-anchored) — worth checking whether the asset is
  randomized/version-drifted, since ring-alone and ring+hexagram both
  shipped in the same 12-clip batch. **This needs an asset audit ahead of
  its normal art-nits queue position per the standing rule — not a
  synthesis-pass afterthought.**
- **D3 — in-world nameplate ≠ lower-third identity for the same player,
  code-confirmed, 4 of 12 clips.** `client/src/game/scenes/
  ReplayScene.ts:428` — `renderState()`'s rig-name assignment reads
  `name: isBotId(pid) ? botLabel(pid) : pid.slice(-4)`: bots get their
  real label, but humans get a raw 4-character player-ID fragment (e.g.
  "VVOC") instead of their callsign, while the lower-third correctly
  resolves the SAME player's real name via `players.find(p => p.playerId
  === this.followId)?.name` (confirmed present in the codebase this
  session, unchanged since 2026-07-10, `82b13c73`/`5d1947fa` — i.e. this
  bug predates and was never touched by the entire CL.0-G sprint).
  Reproduces in `e2314eee` (f-04..f-08, VVOC nameplate + SHADY_BASS_MAN
  lower-third same frame), `909e0a8a` (f-01..f-08), `8c92b0b0` (f-17/f-24,
  code-cited), `0e21238e` (f-16/f-20, code-cited again). One-line fix:
  resolve the human's real name the same way the lower-third does.
- **D4 — see "THE STRUCTURAL FINDING" above** (dual clip-origin
  population via ClipRecorder.ts, 5 of 12 clips).
- **D5 — attention-misdirecting reticle on an inert bystander**,
  `80ea1663` only: a targeting reticle draws around BOT·PISTON (f-14
  through f-18) mid-clip even though that bot never moves, fires, or dies
  — a "look here" cue pointing at a dead end.
- **D6 — world geometry bleeds through always-on-top HUD**, `181fee23`
  only: a scrolling wood-plank platform texture renders directly over the
  "GEO BOT · BOLT" roster row for ~t=5.0-5.8s (crop-roster-A30/A35 vs the
  clean f-01 baseline) — a HUD/world layering or camera-partition bug,
  distinct from (and in addition to) B7's baked-in-chrome regression on
  the same clip.
- **D7 — probe-clip.ts motion-check methodology gap**: `e8bd644d`'s
  motion check (0 byte-identical consecutive sampled frames) PASSES even
  though the visible action is perceptually static for 3+ of 4.02s — a
  direct pixel-diff (even-14.png vs even-24.png, diffviz.png) confirms the
  only variance is sub-visible H.264 quantization noise. The dropped-frame
  check and the "nothing is actually happening" check are different
  failure modes and CL.0 only covers the first; flag for the verifier's
  own next hardening pass rather than filing as a footage defect.
- **D8 — tentative, unconfirmed** — `5652baba`'s frame 0 shows two thin
  vertical antenna-like limb lines on BOT·PISTON (burst-frame0/b-01),
  visually similar to the pre-C1 noodle-rig opening artifact. Likely NOT
  an actual C1 regression: `5652baba` is a ClipRecorder.ts-path clip (D4)
  and C1's fix (20 uncaptured warm-up render passes) was applied only
  inside ReplayScene's render-mode path, which this clip never runs
  through — more likely this is either an unrelated charge/telegraph VFX
  or evidence ClipRecorder.ts has its own, never-fixed version of the same
  spring-convergence issue. Needs direct pixel confirmation before
  indexing further.

**Baseline/pillar map for this study:** B1 → RETIRED (7/7 render-path) /
REGRESSED (1/5 ClipRecorder.ts). B2/B4/faststart → RETIRED (render-path) /
REGRESSED (ClipRecorder.ts, all 5). B3 → REGRESSED both populations (zero-
stream in ClipRecorder.ts; silent-despite-present-stream in `e2314eee`;
sync-miss in `0e21238e`). B5 → sibling regression (no-resolution ending,
ClipRecorder.ts) + CL.C window-miss regression (`80ea1663`, `0e21238e`,
render-path). B6 → REGRESSED (ClipRecorder.ts) folding into the CL.E
regression (render-path, worse: opposite-direction zoom-out in
`8c92b0b0`). B7/B11 → REGRESSED, ClipRecorder.ts only. B8/B9/B10 →
REGRESSED, ClipRecorder.ts only (render-path shows zero-feedback instead,
filed under D1). C1 → RETIRED (render-path); D8 flags an unconfirmed
ClipRecorder.ts-side lookalike. Nameplate-collision → STILL-OPEN,
reproduced (`0e21238e`). NEW: D1 (7/12, top priority), D2 (HARD RULE,
2/12 explicit + 2/12 adjacent), D3 (4/12, code-cited one-line fix), D4
(5/12, structural/process), D5-D7 (1/12 each, minor), D8 (unconfirmed).

**D6 fix (2026-07-27, `client/src/game/systems/HudCamera.ts`)** — the roster
HUD/world split (`installHudCamera`) is architecturally a two-camera
compositor (`main` renders world first, `hud` renders HUD-classified objects
second into the same framebuffer — confirmed against Phaser 4.2.1's own
`CameraManager.render`/`WebGLRenderer.render`, which walk `this.cameras` in
array order into one shared `DrawingContext`; nothing in this codebase ever
reorders or removes a camera, so `hud` painting after `main` is guaranteed).
That rules out a camera-order bug. What the partition DOESN'T guard against:
it classifies every object exactly ONCE (initial scan, or the
ADDED_TO_SCENE→POST_UPDATE pair) and never again, and the HUD camera's own
scroll/zoom/rotation are set once at creation with nothing re-asserting them
— both are one-shot, both silently stay broken for however long it takes
something else to re-trigger a partition pass (which, mid-match, could be
never). Either gap — a `main`-classified object's `scrollFactorX` drifting
to 0 sometime after classification, or anything nudging the HUD camera's own
transform (the exact class of bug this file's neighbors already flag as live
and unresolved: OnlineMatchScene's `[diag:camera]`/renderResolution's
`[diag:governor]` "camera-skew investigation" comments) — silently exposes
whatever `main` painted underneath wherever HUD used to (or should) land.
Fixed both: `hud`'s scroll/zoom/rotation are re-pinned to identity every
POST_UPDATE (cheap, unconditional), and a throttled backward-iterating
resync (every 30 frames, ~0.5s) re-classifies any top-level scene object
whose `scrollFactorX` has drifted to 0 since its last classification,
bounding the exposure window instead of leaving it open-ended. Tests: 3 new
in `HudCamera.test.ts` (camera transform re-pinned after an external nudge;
a drifted world→HUD object migrates within the resync window; a
never-drifting object is never spuriously migrated across 90 frames) — all
pass, plus the 3 pre-existing tests in the same file still green. Full
suites green (client 1845 pass/3 skip, server 296 pass), both typechecks
clean. Honest scope note: clip `181fee23`'s own artifact no longer exists on
disk (this study's per-clip crops/frames were scratch files from the prior
session), and per the structural finding above that clip is a
ClipRecorder.ts-path capture — a verbatim `drawImage` of whatever the live
OnlineMatchScene canvas actually composited, so the bug is genuinely in the
shared live-rendering path this fix touches, not a capture artifact. A fresh
live re-capture was attempted (Playwright against a local Vite dev server,
Practice mode) but Practice lands in the venue lobby (walk-to-bell → queue →
admitted, per `scripts/autoplay.ts`'s own documented flow) rather than
directly in the combat HUD; reaching a real `OnlineMatchScene` roster frame
needs the full autoplay pilot, which is out of scope for this fix. The unit
tests above are the tool-verifiable proof; a human eye-test against a fresh
production clip is AWAITING JAKE.

**D4 FOLLOW-UP (2026-07-27) — ClipRecorder.ts partially closed, NOT merged
into the CL.0-G render pipeline.** Investigated full reuse first (route
ClipRecorder's trigger into `clipRenderQueue`/`ReplayScene` the way
matchHost already does automatically for every human kill): rejected as
architecturally unclean, not attempted — `clipRenderQueue` is server-side,
headless-Chromium-driven, and async (up to `JOB_TIMEOUT_MS`=6min); more
fundamentally, ClipRecorder shares `this.game.canvas` — the SAME backing
store the live player is looking at — so anything that strips a HUD element
from what gets ENCODED strips it from what the PLAYER sees too, for the
whole match, not just the captured window. That constraint blocks true
reuse of CL.D's HUD-camera partition (`installHudCamera` ignores HUD
objects per-camera, but both cameras still composite onto one canvas) and
is the reason B7/B8/B9/B10 remain open below — closing them for real needs
either a second render target (a world-only camera rendering to its own
offscreen texture, which ClipRecorder would read instead of the live
canvas) or retiring ClipRecorder.ts in favor of the render queue, which
already exists and already fires automatically for every human player's
kills (`matchHost.humanKillMoments` → `enqueueMatchHighlights`, unrelated to
clip-consent opt-in). Neither is a call a single pass should make
unilaterally; flagged for a real decision next `/goal`.

Given that, fixes landed by PORTING the specific already-shipped remedies
(or genuinely new ones bounded by the single-canvas constraint) rather than
re-deriving all eight:
- **B4 (bitrate)** — RETIRED. `VIDEO_BITS_PER_SECOND` 16Mbps → 7.5Mbps,
  matching CL.A's own choice (probe-clip's 9Mbps ceiling was measured
  8.5-9.9Mbps against the old constant on 3 of 5 studied clips).
- **B1 (resolution)** — RETIRED for ClipRecorder's own output (can't touch
  the live game's actual window, so this is a compositing fix, not a
  capture-size fix): every frame from EITHER capture path (WebCodecs worker
  or MediaRecorder fallback) now composites onto a fixed 1920×1080 canvas
  first (`composeBroadcastFrame`) via a pure "object-fit: cover" crop
  (`computeCoverRect`, unit-tested) — never distorted, never letterboxed,
  always exactly the probed resolution regardless of the live browser
  window's actual shape (the studied 1824×1026/1920×937 failure mode).
- **B11 (no watermark/identity)** — RETIRED (watermark half only; no
  lower-third — see open items). The same composite stamps a persistent
  "JAKESJAM · play.elyad.io" mark (pre-rendered once, corner, dim ink,
  Space Mono, ≤4% tall) into every encoded frame of either path.
- **B5-sibling (ends on raw mid-fight dead air, worse than the original
  wrong-banner ending)** — RETIRED. Root-caused: the old rotation formula
  was `max(naturalEndAt, pendingFinishAtMs)`, so a trigger firing EARLY in a
  10s segment still rode the full 10s natural boundary instead of ending
  ~3s after its own lookahead (`computeSegmentEndAtMs`, unit-tested, red
  before/green after against the exact early-trigger case). On top of that,
  the last 500ms before a triggered segment's end now eases to black
  (`computeClosingFadeAlpha`, unit-tested truth table) instead of hard-
  cutting mid-action — every uploaded clip now closes on a deliberate beat.
- **B3 (silent/zero-stream audio)** — RETIRED, but this session had to
  FINISH it: the in-progress diff this task inherited wired
  `ProceduralAudio`'s evidence-tap (`shouldTapEvidenceAudio`, already
  unit-tested) and a `MediaStreamTrackProcessor` pump posting `audioFrame`
  messages to the encoder worker, but `clipEncoderWorker.ts`'s message
  switch had NO `case "audioFrame"` — every posted AudioData frame fell
  through unhandled (silently leaked, never muxed; the worker path would
  have shipped functionally silent regardless of the tap). Added
  `handleAudioFrame` (constructs an `AudioSample` from the live `AudioData`,
  rebases each segment's first frame to t=0 against the video clock, mirrors
  `handleFrame`'s close-on-error discipline) and wired the case. The
  MediaRecorder fallback path's native multi-track muxing (no per-frame
  bookkeeping needed) was already complete. House audio rule holds: the
  game's own mixed master-bus output, no synthesized substitute.
- Full client (1859 pass/3 skip) + server (339 pass) suites green, both
  typechecks clean; 19 new unit tests across `ClipRecorder.test.ts`
  (`computeSegmentEndAtMs`, `computeCoverRect`, `computeClosingFadeAlpha`)
  covering every pure function this pass touched.

**Explicitly NOT closed this pass** (see the architectural note above for
why each needs either a second render target or a product decision to
retire ClipRecorder.ts, not more client-side patching):
- **B7 (spectator chrome incl. the dev latency badge)** — OPEN. The
  roster/hotbar/round-timer/latency-badge are live, scrollFactor(0) HUD
  objects the PLAYER legitimately needs for the whole match; hiding them
  from the shared canvas hides them from the player too. No safe fix found
  that doesn't either break live UX or require a genuinely separate
  render target.
- **B8/B9 (duplicate/ghosting banners+damage text)** — OPEN, same root
  cause as B7 (this is the live scene's NORMAL chrome, faithfully
  captured). Per CL.F's own finding, the "duplicate" case is usually two
  real sequential events, not a bug — likely applies here too, unconfirmed
  without a live capture to inspect.
- **B10 (illegible damage numbers)** — OPEN, same root cause as B7.
- **B2 (real fps well under the 30 target, nominal fps metadata
  implausible)** — OPEN, and NOT attempted via timestamp quantization: a
  fixed-grid timestamp scheme was considered and rejected — snapping video
  timestamps to an even 1/30s grid when the real capture can't sustain 30fps
  would shorten the ENCODED duration below real elapsed wall-clock time,
  speeding up motion and breaking the A/V sync B3 just fixed. This is
  inherent to real-time software encoding on this box (documented already
  in this file's own history — OpenH264/WebCodecs software encode has never
  hit its target fps under load) and isn't safely fixable without either
  more encode headroom or accepting honest-but-lower real fps. Root cause of
  the specific "57600/1"-style nominal metadata was NOT confirmed (would
  need a live capture + ffprobe to diagnose further, not attempted here) —
  flagged, not guessed at with an unverified fix.
- **B11's lower-third half** (star callsign + feat label, vs. the
  watermark alone which IS done) — OPEN. `highlightRules.ts`'s `Highlight`
  already carries `label`/`kind`, and `OnlineMatchScene.ts`'s trigger call
  site discards it (`this.clipRecorder.trigger()`, no args) — plumbing it
  through to a timed overlay in `composeBroadcastFrame` is a bounded,
  tractable follow-up, just not completed this session (budget).
- A pre-existing (not introduced this session) latent edge case noted in
  passing: `scheduleRotation`'s `shouldUpload` check
  (`endedAtMs >= this.pendingFinishAtMs`) can go false-negative when
  `MAX_SEGMENT_MS` clamps `cappedEndAt` below a very-late-firing trigger's
  own `pendingFinishAtMs` — an extreme multi-trigger-in-one-segment case,
  unrelated to D4, not fixed here (scope).

---

**STUDY 4 (2026-07-27)** — footage-study close-the-loop pass on the merged
`fix/hud-layering` + `fix/probe-tool-motion-gap` + `fix/cliprecorder-pillars`
+ `fix/core-replay-pipeline` batch (merge commit `79945fe`), per the
merge-coordinator's request for FRESH real footage rather than re-reading
the 12 STUDY 3 clips. Acquisition note (methodologically equivalent, not
literally the public URL): the production `jakesjam-host.service` had no
clips rendered after its 15:10:23 redeploy at study time, so fresh footage
was produced from a clean worktree checkout of the exact same merged commit
(`79945fe`) running as an isolated local server (`PORT=8099`,
`PRESENTATION_EVIDENCE_FORCE_JOIN=1` to let `scripts/autoplay.ts
--direct-arena` skip the venue walk) — identical code path
(`matchHost → clipRenderQueue.ts → ReplayScene`), same binary. Two autoplay
pilot sessions fought real bots until the world's cumulative target-score-5
match completed; `matchHost`'s existing automatic highlight pipeline fired
on its own (no manual trigger), rendering **3 real production-path clips**
from one persisted replay (`world-1785138576434.jjr`, all three
`follow=autopilot_fhr57r_auto`):
- **Clip A** `29d24f2d-022a-4a66-9060-c5cc604be8e8.mp4` — single kill,
  `victims=bot_spark`, `ticks=210`, melee range.
- **Clip B** `351b4e01-138e-4ed5-bd59-fe1126569619.mp4` — two-kill cluster,
  `victims=bot_ratchet,bot_ratchet`, `ticks=544`, both kills at long range.
- **Clip C** `24113dfa-3666-40d1-b352-c57f11282b12.mp4` — single kill,
  `victims=bot_ratchet`, `ticks=210`, melee range, upper-platform victim.

`scripts/probe-clip.ts` (with `--slowmo 15`, matching the automatic slow-mo
param the queue now attaches whenever `killTicks` are present): **ALL PASS
8/8 on all 3 clips**, including the STUDY 3-added static-span check — 1920×
1080, ~29.85–29.96fps real, 30/1 nominal, exact duration, opus audio
present and non-silent (−31.5 to −38.9dB mean), 7.4–7.6Mbps, faststart,
zero identical consecutive frames, static-span 0.00–0.30s (well under the
3s ceiling). 2fps + dense-burst frame-by-frame read of all 3 (every 2fps
frame, plus frame-number-exact `select` bursts around every declared kill
tick — timestamp-based `-ss` seeking was cross-checked against this and
found imprecise near kill moments, so the frame-accurate method is what the
findings below are based on).

**D1 (invisible/uncorroborated kill) — CONFIRMED FIXED for proximate
(melee-range) kills, 2 of 3 clips; PARTIALLY REPRODUCES for long-range
kills within a multi-kill cluster, 1 of 3 clips (both its kills).** This is
the headline finding the merge-coordinator asked to close the loop on:

- Clip A: frame f-03 (t=1.0s) shows AUTOPILOT and BOT · SPARK already
  adjacent (melee range); f-04 (t=1.5s, the credited kill tick) shows a
  gold/white death-burst exactly at the victim's position, immediately
  followed by "AUTOPILOT — THE KILL" fading in (burst frames b-15 through
  b-30 show a slash-arc VFX, then the death-pop, then rising soul-fragment
  particles — a real, legible, correctly-attributed kill). RETIRED for
  this case.
- Clip C: burst frame b-25 (~t=1.83s) shows the same pattern one platform
  up — BOT · RATCHET dying directly above AUTOPILOT, camera vertical bias
  correctly re-framing upward (CL.E.3's spec, confirmed live), lower-third
  reads "AUTOPILOT — THE KILL". RETIRED for this case.
- **Clip B, kill 1** (rel tick 90, `victims[0]=bot_ratchet`): frame-exact
  extraction at video frame 45 (the credited tick) shows AUTOPILOT alone,
  camera having zoomed OUT to its widest (frame 39, pre-kill, confirms the
  zoom-to-fit system IS trying), yet BOT · RATCHET is only a sliver at the
  extreme right edge (nameplate cut off mid-word) — the separation at the
  moment of credit exceeds what CL.E's 1.25× zoom floor can contain. By
  frame 64 (~0.6s later, lower-third at full opacity reading "AUTOPILOT —
  DOUBLE KILL") the camera has instead zoomed BACK IN on AUTOPILOT alone;
  the victim never appears, no death-pop ever renders anywhere in the
  visible frame.
- **Clip B, kill 2** (rel tick 424, `victims[1]=bot_ratchet`, the cluster's
  FINAL kill — the one CL.E's slow-mo beat is specifically for): frame-
  exact extraction across the credited tick's mapped video frame (≈227,
  accounting for the +15-frame slow-mo insert) through the last frame of
  the clip (287) shows BOT · RATCHET alive at full HP the entire time,
  still exchanging fire with AUTOPILOT at range (visible tracer in an
  intermediate frame) — no slow-mo dilation is visible in the motion
  between sampled frames, no death-pop, no HP-bar drop, right up to the
  hard end of the window. The window's own math (`OUT = last kill + 120
  ticks` = exactly this clip's end) means this final ~2s IS meant to be the
  kill's aftermath hold; instead it's ordinary ongoing combat with the
  "credited" victim never dying on screen.

Read together: the STUDY 3 root cause (wrong `victimId` — the camera
engaging a proximity-guessed bystander instead of the real credited victim)
is genuinely fixed; `resolveEngagedVictimId` demonstrably resolves the
correct entity now (confirmed by exclusion — in clip B the camera is
clearly trying to reach `bot_ratchet` specifically, not locking onto a nearer
bystander). What survives is a **narrower, adjacent condition**: when the
real separation between star and credited victim at kill-time exceeds
what the zoom-to-fit's practical floor can frame, the result is
visually indistinguishable from the original bug (no visual kill proof) even
though the underlying identity resolution is correct. This reproduced on
both kills of the one cluster in this batch that happened to be long-range;
the two melee-range single kills were flawless. Recommend as the next fix:
either lower the zoom-to-fit floor further for extreme separations, or add
an explicit off-screen-victim assist (arrow/ping/hard cut) for the case
zoom genuinely cannot solve — a camera can't out-zoom a fight that's
Just Too Far Apart.

**CL.E (camera language) — RETIRED for the proximate case, same caveat as
D1 above.** Punch-in confirmed live in clips A and C (visibly tighter
framing at the kill frame vs. one second prior), vertical bias confirmed
live in clip C (camera follows the victim onto the platform above), no
teleport/cut anywhere in any of the 3 clips (every sampled frame shows
smooth continuous camera motion), release-after-hold confirmed (clip A's
last frame is back near base zoom). Zoom-to-fit's wide-separation floor is
the same gap D1 cites — not re-filed twice.

**CL.D (lower-third + watermark + chrome) — RETIRED, all 3 clips.**
Lower-third enters after the window's first kill and is fully gone by each
clip's final frame (clip A f-08, clip B f-19, clip C f-08 all confirmed
absent) — no recurrence of STUDY 3's `909e0a8a`/`80ea1663` "rides to the
hard cut" regression. Feat text is correct and monotone-per-window ("THE
KILL" for the two single-kill clips, "DOUBLE KILL" for the two-kill
cluster from its first kill onward — this matches the goal's own spec,
"feat... from the window's killTicks" computed once for the whole window,
not a live-updating counter, so this is NOT filed as a defect). Watermark
present bottom-right, ≤4% tall, every sampled frame across all 3 clips.
Letterbox bars present. Zero spectator chrome (no roster, hotbar, timer,
latency badge) in any frame — B7 stays retired by construction.

**CL.A nameplate collision — RETIRED, reproduced-then-confirmed-fixed.**
Clip A frame f-03 has AUTOPILOT's and BOT · SPARK's nameplates directly
adjacent (near-touching, melee range) and they resolve cleanly side by
side with no overlap/garbling — the exact STUDY 3 `0e21238e` scenario,
now clean.

**D3 (nameplate ≠ lower-third identity) — RETIRED.** AUTOPILOT's own
nameplate reads "AUTOPILOT" (the real callsign) in every frame across all
3 clips, matching the lower-third — no raw player-ID-fragment nameplate
anywhere on the star.

**C1 (opening rig-streak) — RETIRED, holds.** Frame 0 of all 3 clips opens
on fully-converged rigs (no noodle-limb artifact).

**Spot-checked, not independently reconfirmed this session (budget/no
applicable footage):**
- **CL.B.1 (kill-SFX-to-frame sync)** — audio presence/level is probe-
  confirmed non-silent and reasonable on all 3 (−31.5 to −38.9dB mean), but
  a fine-grained loudest-window check attempted this session was
  inconclusive: `volumedetect` over 0.2s buckets across clip A shows a
  near-constant −13.0/−13.3dB max ceiling from t≈0.2s onward (a
  limiter/bed-dominated signal), which can't isolate a transient kill SFX
  peak the way the original CL.B ledger entry's method did. Not re-derived
  under this session's budget — flag for a proper spot-check next pass,
  not claimed as either regressed or confirmed.
- **D5 (homing-shot reticle on a bystander)** — no homing weapon fired in
  any of the 3 clips (starter-shot loadout only); can't confirm or refute
  on this tape.
- **D6 (HUD/world layering bleed-through)** — unchanged from the fix's own
  ledger note: this defect lives in the LIVE `OnlineMatchScene` roster HUD,
  which doesn't exist in render-mode output by construction, so render-path
  footage structurally cannot confirm or refute it. Still AWAITING JAKE
  (real live-multiplayer capture needed, same blocker as before).
- **B2 (real fps under load)** — all 3 clips hit 29.85–29.96fps real
  against a 30fps target (well within tolerance); this is the render-path,
  which was already good pre-session — the STUDY 3 B2 note was specifically
  about the separate ClipRecorder.ts path, untouched by this check.

**Bottom line for whoever reads this next:** the fix batch's headline
claim — D1 fixed — holds for the common case (2 of 3 fresh clips, both
melee-range single kills, are genuinely excellent: correct camera, correct
victim, correct death VFX, correct identity, correct lower-third, clean
exit). It does NOT yet hold unconditionally: a real fresh clip with a
long-range multi-kill cluster reproduced the "credited kill, zero visual
proof" symptom on BOTH of its kills, via a different and narrower
mechanism (zoom-floor insufficient for the actual separation) than the
original bug (wrong victim identity). This is real footage, not a
constructed edge case — recommend it go back into the fix queue as a
scoped follow-up (D9) rather than being considered closed.

- **D9 (NEW, this session) — zoom-to-fit's separation floor is
  insufficient for long-range kills, reproducing D1's symptom via a new
  mechanism.** 1 of 3 fresh clips (`351b4e01`, both its kills). See the D1
  writeup above for full frame citations (video frames 39/45/64 for kill 1;
  frames ~227–287 for kill 2). Root cause is DIFFERENT from original D1
  (camera correctly targets the right victim now — it just can't zoom out
  far enough to reach them), so indexed separately rather than reopening
  D1 wholesale.

**Baseline/pillar map for this study:** D1 → PARTIALLY RETIRED (2/3 clips
fully fixed; 1/3 reproduces via D9's narrower mechanism). CL.E → RETIRED
for the proximate case, same D9 caveat. CL.D, CL.A nameplate collision, D3,
C1, B7, B11 → RETIRED, confirmed clean on all 3 fresh clips. CL.B.1, D5,
D6, B2 → not independently reconfirmed this session (see above; not
regressed, just not tractable with this footage/budget). D9 → NEW.

---

**BASELINE (2026-07-17)** — study of `/c/dff7f450-55dc-4316-8df7-654ebf4e2ccb`:
1896×950 @ 21.6fps real (215/360 expected frames, 9.96s of 12s intent),
57600/1 fps metadata, zero audio streams, 10.8Mbps, ends on a bot's
round-over banner, spectator HUD + 140ms latency badge baked in, duplicated
"14 HEADSHOT" text, world-anchored ghosting streak banners, stray seal
label, illegible damage numbers, star static far-left with kills landing
off-frame right. Defects indexed B1–B11 above; every pillar cites which it
retires.
