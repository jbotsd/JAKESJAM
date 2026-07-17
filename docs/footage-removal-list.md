# Footage subtraction + smoothness list (OBS review 2026-07-17)

Source: `~/Videos/JAKESJAM/2026-07-17 17-26-09.mkv` (28s, 1896×1030, Jake +
Shady_Bass_Man + 3 bots), reviewed frame-by-frame per the showcase law
(re-watch latest footage, list everything, fix everything). Two lists:
REMOVE (subtraction pass — scarce light, ui-axioms §0) and SMOOTHNESS
(Jake: "animation unsmoothness, popping, juttering"). Work top-down;
tick items here as they land.

## A. Remove / reduce (in priority order)

- [ ] A1 **Background line density.** The arena backdrop (concentric rings,
  nested triangles, radial grids) is visually LOUDER than platforms and
  rigs — in wide shots the fighters are the third-most-visible thing on
  screen. ui-axioms: VFX/decor never competes with hitboxes. Cut density
  ~60% and/or drop backdrop line alpha hard; platforms and bodies must win
  every frame. (PlatformPainter/background renderer — coordinate with the
  active map-gen session.)
- [x] A2 (2026-07-17: dead-victim guard — numbers are for the living, the death FX owns the kill read) **Stray damage number** — red "12" floating alone mid-air, far from
  any body (t≈5s frame). Damage popups are anchoring to stale positions or
  outliving their event. Find and fix the anchor/lifetime.
- [x] A3 (2026-07-17: banner score row removed; roster owns the numbers) **Round-banner score line duplicates the roster column.** "TO YOU"
  + full scores renders mid-screen for the entire round-over hold while
  the left roster shows the same scores live. Remove the banner's score
  row (or the roster during banner) — one source of truth on screen.
- [x] A4 (2026-07-17: bar now GROWS with the hand — row width derives from visible slots, no placeholders) **Reserved "-" action-bar diamonds.** Two dim placeholder slots +
  "-" labels sit on the bar all match. Hide unclaimed slots entirely; the
  bar should grow as the hand earns keys (scarce light; also kills the
  "why is there an empty button" read).
- [x] A5 RECLASSIFIED (2026-07-17): the chip is the ONLY in-match clips/consent access (world auto-join skips HOME — comment in main.ts) and its label already carries state (off/on/·N). Stays. **CLIPS • 0 chip.** Dead chrome when the count is zero — show the
  chip only when ≥1 clip exists (or when recording consent is off, not at
  all).
- [x] A6 (2026-07-17: crosshair on the game canvas) **OS arrow cursor over the arena.** The desktop pointer floats over
  combat in every frame. Replace with a crosshair cursor (CSS cursor on
  the canvas) — aim is the mouse's only job in-arena.
- [x] A7 RECLASSIFIED (2026-07-17): the near-black plates are the POST-PICK winner spotlight (intentional celebration); pre-pick plates read fine on tape. No change. **Draft overlay over-dim.** Focusing one plate drops the other two
  to near-black (unreadable at 720p+). Keep unfocused plates readable
  (~0.55 alpha, not ~0.15) — comparing plates IS the draft.
- [x] A8 (2026-07-17: banner anchor lifted 0.32 → 0.22 of viewport height) **Countdown numeral overlaps rigs.** "ROUND 2 / 1" renders directly
  on top of a player standing at mid-screen. Offset the numeral above the
  spawn line or fade rigs behind it.
- [ ] A9 **Idle spawn-seal ring lingers** under stationary players well into
  the round. If it's spawn-protection, cap its visual to the protection
  window; if decorative, remove after ~1s.
- [ ] A10 *(capture hygiene, not code)* Jake's OBS scene recorded the whole
  desktop early/late in the clip (OBS UI + browser chrome + fullscreen
  toast on tape). Use the stream-kit game-feed/kiosk source (memory:
  never show browser tabs; crop rules) for review recordings.

## B. Smoothness (measured, not vibes)

- [ ] B1 **Remote-player pose/position POP + world micro-freezes.** Burst
  analysis at t=21 (4 consecutive 60fps frames): Shady_Bass_Man renders
  mid-dash, then SNAPS upright ~30px away in one frame, then the world
  holds pixel-identical for 3 frames (~50ms). mpdecimate: ~55% of the
  clip's frames are near-duplicates (effective sub-30fps motion during
  fights). Consistent with interpolation-buffer starvation on remote
  entities (snapshots arriving late/jittery → hold-then-snap), NOT GPU
  load. Levers: interp buffer depth vs snapshot cadence (renderSmoother /
  interpolationBuffer, TickSlewController), and dash-end reconciliation
  snapping remote rig POSE without blending. Measure first: log smoother
  starvation events + snapshot inter-arrival jitter on a live session.
- [ ] B2 **Dash-end pose discontinuity** (may fall out of B1): the rig goes
  from full dash lean to neutral stand in ONE frame. Pose transitions need
  ~80-120ms blend even when state snaps.
- [ ] B3 Verify after B1: re-record the same 1v1+bots scenario, rerun the
  mpdecimate duplicate count + a t≈fight burst; duplicates should drop
  toward the static-overlay floor (~25%) and no single-frame pose snaps.

## Verdict from this tape (what already reads well)

Draft plates, kill feed, nameplates, action-bar key labels, and the
E-meter crescent all read clean at 1080p. The two systemic problems are
A1 (backdrop louder than the fight) and B1 (remote motion pops) — fixing
those two changes the footage more than the other eleven combined.

## Fix specs (exhaustive — tick items above as these land)

- **A1**: single-lever first: backdrop line alpha constant in PlatformPainter /
  background pass × 0.4; if no single constant exists, add BACKDROP_ALPHA_MULT
  and thread it through every decorative stroke (rings/triangles/grids ONLY —
  never platforms). Density cut (skip alternate rings) is pass 2 if alpha
  alone doesn't put rigs first. OWNER NOTE: map-gen session is live in this
  file — coordinate, don't collide.
- **A2**: guard in OnlineMatchScene damage-popup spawn: `if (!victim.alive)
  return;` (dead victims' reads belong to the death FX; with fast respawn the
  render-state lookup can be a fresh spawn-seal position → orphan numbers).
- **A3**: RoundBanner: delete the score-line row from the round-over banner
  render (roster column is the one source of truth). Keep "ROUND N / TO X".
- **A4**: ActionBarSystem.update(): compute `visibleSlots = LIVE_SLOTS.length
  + 1 + actives.length + acquired.length` (min 3), lay the row out from that
  instead of SLOT_COUNT, stop rendering reserved diamonds + "—" labels
  entirely. Bar grows as the hand earns keys.
- **A5**: find the "CLIPS · 0" chip owner (not index.html; label likely built
  dynamically — grep for `CLIPS` case-insensitively across scenes/ui, then
  hide when count === 0).
- **A7**: CardDraftOverlay: unfocused plate alpha floor 0.55 (currently
  ~0.15 — unreadable). Comparing plates IS the draft.
- **A8**: countdown numeral: render at 38% viewport height (above the spawn
  line) instead of dead centre.
- **A9**: find the idle gold seal ellipse under rigs; if spawn-protection,
  clamp visual to the protection window; else fade by 1s.
- **B1**: (1) instrument renderSmoother: count buffer-starved frames + log
  snapshot inter-arrival p95 to the stats overlay; (2) raise interp delay
  one notch (e.g. +40ms) and re-measure; (3) blend remote POSE transitions
  over 100ms even when position snaps (rig-side lerp on pose keys, B2).
- **B3**: re-record the same scenario; mpdecimate dupes should fall toward
  the static floor; no single-frame pose snaps in any 8-frame burst.

