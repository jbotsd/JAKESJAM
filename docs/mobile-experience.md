# Mobile & desktop experience

Goal (2026-07-04): "a flawless, well-researched mobile experience as well as
desktop." This documents the input, scaling, and layout decisions and where
they live.

## Principle — one build, two first-class inputs

The same client serves phone and desktop. Input source is chosen at runtime
by `isTouchPrimary()` (`game/input/mobile.ts`): touch points present AND a
coarse primary pointer (finger, not mouse), with a `?touch=1` / `?touch=0`
override for testing. Desktop is untouched — when touch isn't primary, the
keyboard/mouse path runs exactly as before (the touch overlay is never
created).

## Touch controls — twin-thumb, floating (research-backed)

`game/input/TouchControls.ts` renders a DOM overlay over the pixel-art canvas
(crisp, notch-safe, doesn't fight the WebGL layer). Layout for a landscape
platform-brawler:

- **Left thumb → floating MOVE stick.** Horizontal = walk. Up-tilt past the
  threshold = Jump (hold to sustain the jetpack — "push up to fly", the genre
  convention). Down-tilt = crouch / fast-fall.
- **Right thumb → floating AIM+FIRE stick.** Drag sets aim direction and
  auto-fires while held (twin-stick — the smoothest mobile aim; you almost
  always want to shoot where you aim). Aim = player position + stick direction
  × reach, and the last direction is held when the thumb lifts so shots keep
  heading.
- **SHIELD (hold) + DASH (hold)** thumb buttons, bottom-centre, reachable by
  lifting either thumb inward. DASH sends `InputBit.Dash` — the aegis
  power-slide toward the current aim, the same action as desktop
  right-click/C. (It replaced the original PARRY button when the timed parry
  became human-unreachable; a PARRY button that sent `InputBit.Ability` was
  dead weight.)

Floating (base spawns where the thumb lands) beats fixed pads — no need to
look down, forgiving of thumb drift. Multi-touch is tracked by `pointerId` so
both sticks + a button work at once. The overlay only captures touches on its
own control elements (`pointer-events: none` on the root).

Wired into **both** match scenes: the live world (`OnlineMatchScene`, the main
flow) and offline Practice (`MatchScene`), so no entry point is a dead end on
a phone.

## Viewport, scaling, safe areas

- Phaser runs `Scale.RESIZE` at 100% — the canvas always fills the viewport.
- `index.html` viewport: `maximum-scale=1, user-scalable=no, viewport-fit=cover`
  (game handles its own scaling; extend under notches).
- `body`: `overscroll-behavior: none` (no pull-to-refresh / rubber-band),
  `-webkit-tap-highlight-color: transparent`, `user-select: none`.
- Controls pad away from notches via `env(safe-area-inset-*)`.

## Responsive UI + orientation

- Splash/lobby get a short-landscape media query (`max-height: 560px`): 3-col
  button grid, tighter rhythm, scrollable lobby, copy hidden.
- A touch device held sideways shows the rotate-to-portrait nudge overlay
  (`.orientation-hint`, toggled in `main.ts` on resize/orientationchange).
  It is tap-to-dismiss for the session ("tap to play sideways anyway") —
  the overlay is opaque, so without the dismiss it hard-blocked landscape.
- The in-match FTUE legend swaps to touch wording ("LEFT STICK move / PUSH UP
  jump / RIGHT STICK aim & fire / SHIELD·DASH buttons") when touch is active,
  and starts lower (y=112) so it clears the compact phone HUD.

## Portrait-first redesign (2026-07-04)

Landscape on a phone was cramped and the controls overlaid the action
("dog ugly"). Mobile is now **portrait-first**:

- **Orientation**: portrait is the target; a nudge asks players holding
  the phone sideways to rotate upright (`main.ts` + `.orientation-hint`).
- **Fullscreen**: first tap on a touch device calls the Fullscreen API +
  portrait orientation lock (`enterFullscreenPortrait`), hiding the mobile
  browser URL bar ("massive banner"). iOS Safari has no Fullscreen API —
  there the apple-mobile-web-app meta tags give a chrome-less PWA via
  Add to Home Screen.
- **Camera**: the arena is 2:1 wide but a phone is ~1:2 tall. Rather than
  zoom (Phaser scales scroll-fixed HUD objects with camera zoom, breaking
  the HUD, and a UI camera is too invasive for this scene), the camera
  stays at zoom 1.0 and frames via an upward player bias
  (`PORTRAIT_CAM_Y_BIAS`) plus extended bottom camera bounds — the player
  rides in the upper third with the ground below, HUD untouched.
- **Controls**: a dedicated bottom band (`@media (orientation: portrait)`)
  — joystick zones confined to the band so tapping the play field never
  spawns a stick, SHIELD/PARRY buttons on the band's top edge, a gradient
  separating controls from the game.

Verified on a 400x860 portrait emulation: HUD at top, player framed high,
controls in the band, VFX reading well.

## Phone-width HUD + overlays (2026-07-09 QA sweep)

A 393x852 (Pixel-class) sweep drove a batch of fixes, all client-side:

- `HudSystem` compact mode below 520 CSS px: narrower HP/shield bars,
  smaller timer/score type, score tags drop the "BOT · " prefix and the
  score gets its own row. The vestigial jetpack bar (jetpack removed) and
  the never-fed ability-charge dot row no longer render anywhere.
- Portrait camera: bottom bound pad is 0.5×viewport in BOTH match scenes
  (Practice previously had no portrait handling at all and pinned the
  player under the thumbs).
- Card draft: cards compact on touch so all offers are scannable; card
  copy rewrites "(press C)" → "(DASH button)" at render time.
- Clip-share toast sits above the portrait control band, not on the aim
  stick zone.
- Match results stage no longer forces a 520px min-width on a 393px phone.

## Verification

- Unit: `touchControls.test.ts` locks the mapping (move/jump/crouch, aim +
  auto-fire, shield/parry, deadzones, release clears aim).
- Live emulation (iPhone landscape, hasTouch): overlay + 2 zones + buttons
  present; dragging the move stick moved the player 540→1056px; portrait shows
  the orientation hint, landscape hides it; the landscape menu lays out
  cleanly.
- Desktop unaffected: touch overlay gated off; full client suite (563) green.

## QA sweep (2026-07-28, wave 1)

The 2026-07-28 mobile QA deep-iteration pass (22 findings across HUD/action-bar,
kill-feel/construct-VFX, venue, and card-draft clusters) landed a fix commit
(`3293315`) covering all 5 CRITICAL and 6 of the MAJOR findings. This wave
closes the loop on that fix pass: a **fresh** round of 393×852 portrait-touch
screenshots against the rebuilt client (same emulation method this doc has
used since 2026-07-04/07-09), confirming what actually holds, plus a couple
of spot-checks on surfaces the fix pass didn't touch. Screenshots referenced
below live in the fix pass's own scratch capture directory (not committed —
same convention as every prior sweep in this doc).

### Confirmed holding (surfaces touched this wave)

- **ActionBarSystem safe-area + touch-zone clearance** (clusterA-01/02) — a
  fresh arena entry (no pre-existing identity, real touch-drag input, not
  keyboard) shows the HP/shield/ability bar sitting clear of both the OS
  safe-area inset and the floating move-stick's drag zone
  (`clusterA01-02-actionbar-hud-steadystate.png`).
- **RoundBanner clears the touch FTUE legend** (clusterA-04) — a genuinely
  first-ever match (fresh pilot id, `jakesjam-ftue-controls-shown` unset)
  shows the "ROUND N" banner painting well below the staged
  "LEFT STICK move / RIGHT STICK aim & fire" legend for the legend's whole
  ~9s life, never overlapping (`clusterA04-banner-legend-t0..t5.png`).
- **MainMenuScene decorative rig cluster** (C2) — with the DOM splash panel
  hidden (`[data-splash]`), the rig + "vessel"/SIGNATURE cluster renders
  fully on-screen at 393px, matching the fix's own before/after evidence
  (`c2-mainmenu-rig-cluster.png`).
- **Card draft timer bar** (D1) — the green countdown track measures a
  non-zero height (4px track, not the pre-fix 0px collapse) in every
  viewport tried: 393×852 portrait-touch, 810×1080 tablet, 1280×720
  desktop (`d1-d2-portrait-fresh-offer.png`).
- **Card draft fits without vertical overflow on portrait touch** (D2) —
  measured directly: stage `scrollHeight === clientHeight` (782 === 782) at
  393×852, the offer riding the horizontal scroll-snap row exactly as
  designed (`d1-d2-portrait-fresh-offer.png`).
- **Off-screen pick scrolls into view before the reveal** (D3) — scrolled
  the row so the 3rd card (Contagion) started off-screen, picked it, and
  measured its plate fully inside the viewport bounds immediately after
  (`left:54, right:354` inside a 393px viewport) — the reveal beat plays
  on-screen, not wherever the row happened to be scrolled
  (`d3-portrait-after-pick-card3-reveal-onscreen.png`).
- **Distinct seals for six-axes/catalog ability cards** (D4) — Crimson
  Tithe / Borrowed Time / Contagion (the exact trio the original bug
  report named) now render LEECH · sōk / MARK · tōš / MULTITUDE · mēš
  respectively — three different seals, not three copies of "LIGHT · phōs"
  (`d1-d2-portrait-fresh-offer.png` shows Crimson Tithe's corrected seal).

### Regression spot-checks (surfaces NOT touched this wave)

- **Offline Practice (MatchScene)** — shares `ActionBarSystem` +
  `mobile.ts`'s `safeAreaInsetBottomPx()`/zone-clearance logic with the
  online path but wasn't itself edited. Touch controls present (left/right
  zones both found), nameplate renders correctly, no visible regression
  (`r1-practice-hud-portrait.png`).
- **Cold-boot splash / email gate** — unchanged this wave, still the
  expected first-visit flow (`r2-splash-portrait.png`).
- **CardDraftOverlay at non-portrait-touch viewports** — 810×1080 tablet
  and 1280×720 short-desktop both still resolve `hasHorizScroll: false`
  and the portrait-only compaction path (`CARDS_CONTAINER_STYLE_PORTRAIT_TOUCH`)
  correctly does NOT engage outside portrait-touch.

### New finding this wave (not from the original 22 — filed for wave 2)

- **HangoutScene: venue feed collides with the duo-queue hint on narrow
  widths.** C1's own fix moved `feedText` down to `y=46` in compact mode
  (< 520px) specifically to clear the top-right MENU/CLIPS pill — but
  `duoHintText` ("`[T] DUO QUEUE: ON/OFF`") is still hard-coded to a fixed
  `y=44` regardless of width. The two now sit almost exactly on top of each
  other in the venue at 393px: both fully opaque, producing illegible
  double-exposed text at the top-left the entire time a player is in the
  venue (confirmed persistent across a 6.5s window, not a transient
  crossfade — `c1-venue-feed-portrait.png`,
  `c1-venue-feed-portrait-t2.png`, `c1-venue-feed-portrait-t3.png`). C1's
  original bug (clipping off both screen edges) IS fixed — this is a new
  collision the repositioning itself introduced. Real fix needs
  `duoHintText` to also drop in compact mode, ideally anchored beneath
  `feedText`'s actual (now two-line) measured height rather than another
  fixed constant.
- **Minor, lower-confidence:** `[data-splash-cta]` ("Play"/Lobby) measured
  with a bounding-box `y≈897` against an 852px-tall portrait viewport — i.e.
  below the fold, requiring a scroll before the primary CTA is reachable.
  Not verified against the documented short-landscape scrollable-lobby
  behavior from the 2026-07-04 sweep — may be expected/pre-existing rather
  than a regression, flagging for wave 2 to confirm either way.

### Left for wave 2

Everything the fix pass itself deliberately deferred is still open:
clusterA-03 (dual touch-UI naming), clusterA-05/06 (name overflow /
nameplate clip), B1 (camera-kick clamp ordering), B3-B5, C3 (loadout
station touch abilities), C4/C5/C6/C7 (venue ActionBar/touch targets/gate
ordering), D5 (generic ability glyphs) — see the fix pass's own report for
the reasoning on each. Add to that list from this sweep: the
venue-feed/duo-hint collision above, and the splash-CTA-below-the-fold
question.

### Verification method

Two capture paths, both against the real rebuilt client (`bun run build`
re-run clean before this sweep; server serves `client/dist` and needs no
restart for these client-only fixes):

- **Direct-import overlay checks** (`CardDraftOverlay` D1-D4): same
  convention the fix pass itself used (`checkTimerBar.ts`/
  `checkHorizScroll.ts`) — import the real class + real card data against
  the vite dev server, `showWithTimer()` a real 3-card offer, measure/
  screenshot.
- **Live product-journey checks** (ActionBar/RoundBanner/MainMenuScene/
  HangoutScene/Practice): a real touch-emulated Playwright context against
  the shared `:8088` world server, walking the actual venue → bell → queue
  → arena flow. Notable gotcha hit and worked around: under a
  touch-emulated context (`hasTouch:true, isMobile:true`), `isTouchPrimary()`
  reads true and **keyboard input for movement is a dead no-op** (confirmed
  directly: holding a WASD key for 5s moved the player 0px) — the earlier
  fix-pass capture script's keyboard-based walk (`scripts/captureClusterA.ts`)
  would not actually have driven movement under this harness either. Real
  touch-drag (CDP `Input.dispatchTouchEvent`) was needed instead, with two
  further quirks worked around: a single continuous touch stops being read
  by the game after ~2s in this headless setup (cycle fresh touchStart/End
  every <2s), and a pure-horizontal drag stalls dead at a real platform gap
  partway to the bell (drag diagonally up-left so up-tilt/jetpack clears
  it). Also hit and worked around: a genuinely fresh identity's first
  "Play" tap opens the Vessel Signature cosmetics creator before joining
  the venue (real onboarding gate, unrelated to any of this wave's fixes) —
  accept the defaults and re-tap to proceed.

## QA sweep (2026-07-29, wave 2)

Closes two of wave 1's own deferred findings: clusterA-05 (MatchResultsOverlay
long-name/class-tag overflow) and clusterA-06 (world-space nameplate
hard-clip). Both fixed, both proven with a unit/measurement test plus a
fresh 393×852 portrait-touch screenshot against the real rebuilt client.
Screenshots referenced below live in the fix's own scratch capture
directory (not committed — same convention every prior sweep in this doc
has used).

### clusterA-05 — MatchResultsOverlay long-name/class-tag overflow (FIXED)

Root cause confirmed exactly as filed: `ROW_NAME_STYLE`/`ROW_NAME_ROW_STYLE`
had no shrink/truncate story at all — a flex item's *automatic* minimum
size defaults to its content's full width unless `minWidth: 0` overrides it,
so the name column refused to shrink below the raw callsign's width no
matter how little room the row actually had. The class-tag chip (bd6b51f)
made this land in practice by eating into that same fixed-width row.

Fix (`client/src/game/ui/MatchResultsOverlay.ts`): `ROW_NAME_STYLE` gets
`minWidth: 0` + `overflow: hidden` + `whiteSpace: nowrap` +
`textOverflow: ellipsis`; `ROW_NAME_ROW_STYLE` gets `flex: 1 1 auto` so it's
the thing that actually shrinks; `ROW_SCORE_STYLE` gets `flexShrink: 0` so
the score never gives up room instead. The existing chip-omit-when-no-
characterId behavior (`matchResultsClassTag` returning `undefined`) is
untouched — chip presence/absence logic wasn't touched, only the name
column's own sizing. Added `data-match-results-row/header/name-row/name/
score` attributes (same convention as `CardDraftOverlay`'s `data-card-*`
hooks) purely so this is queryable by tests.

- **Test**: `tests/e2e/matchResultsOverflow.spec.ts` — a real-browser
  Playwright measurement test (bun:test has no layout engine, see
  `playerStats.test.ts`'s "happy-dom-less environment" comment — real
  `getBoundingClientRect` numbers need an actual browser). Boots its own
  throwaway local vite dev server, mounts the REAL `MatchResultsOverlay`
  class via a committed harness fixture
  (`client/src/game/ui/__tests__/matchResultsOverflowHarness.html`) with a
  deliberately long single-token callsign + a `characterId` (forces the
  chip), at a 393×852 viewport. Asserts: nothing in the row/header/name-row/
  name right edge exceeds the viewport width, the name never overlaps the
  score, and — the "is this test actually exercising truncation" check —
  the name's `scrollWidth` exceeds its `clientWidth` (proves the long name
  really is being clipped by CSS, not just coincidentally fitting) with
  `textOverflow: ellipsis` / `whiteSpace: nowrap` / `overflow: hidden`
  confirmed on the computed style. Verified both directions: reverted the
  `ROW_NAME_STYLE` fix locally and re-ran — failed with the name's right
  edge at 468px against a 393px viewport (measured, not hypothetical);
  restored the fix — passes again.
- **Screenshot**: `clusterA-05-long-callsign-393x852.png` — the callsign
  `xXx_ShadowInfernoReaperOfEternalDoom_xXx` truncates to
  `xXx_ShadowInfernoReap…` with the GEO chip and score `3` both fully
  visible, row border intact, nothing spilling past 393px.
- **Known adjacent, NOT fixed (out of scope for this finding)**: the big
  centered winner TITLE (`titleEl`, `winnerRow.name.toUpperCase()`) has no
  overflow handling of its own and visibly spills past both edges of a
  393px viewport for the same long callsign (confirmed in the same
  screenshot — "ERNOREAPEROFET" bleeds off both sides). This is a
  pre-existing gap bd6b51f never touched (the chip only ever landed on
  rows) — filing it here rather than silently leaving it undiscovered, but
  not fixing it since the reported regression was specifically the
  row/chip interaction.

### clusterA-06 — world-space nameplate hard-clip (FIXED)

Root cause, confirmed by direct investigation (no separate wave-1 report
file exists for this one — it was never written down beyond the doc's own
"Left for wave 2" line, so this was traced from scratch): the in-world
floating nameplate (`ProceduralPlayerRig.drawNameplate`, called from
`update()`) is drawn at a FIXED world-space offset above the player's head
(`head.y - 24*s - nameplateLift`) with ZERO awareness of the camera.
Separately, `OnlineMatchScene`/`MatchScene`/`HangoutScene` all share the
exact same `PORTRAIT_CAM_Y_BIAS = 150` trick on portrait mobile — the
camera's visible window is shifted DOWN 150 world px so the player rides in
the upper third of the tall screen, clear of the bottom touch-control band
(each scene's own comment: "camera centres BELOW the player"). That
trade-off eats directly into the headroom ABOVE the player, which is
exactly where the plate lives — a high platform, a jump, or (demonstrated
below) a tighter camera zoom (the same knob a real AI-lock super-zoom/
kill-cam punch drives up) can push the plate's own top edge above the
camera's visible top edge, hard-clipping it mid-glyph rather than sliding
off-screen as a whole unit.

Fix: a new pure, camera-agnostic helper — `clampNameplateAnchorY(rawAnchorY,
scale, cameraTopWorldY)` in `client/src/game/render/nameplateLayout.ts`
(same file/convention as the existing `resolveNameplateLifts`, CL.A's
adjacent-nameplate-collision fix) — floors the nameplate's anchor so its
own top edge (`drawNameplate`'s `plateTop = y - 17*s`) never crosses
`camera.worldView.y` (every caller already reads this for off-screen rig
culling), plus a 28-world-px `FRAME_TOP_CLEARANCE` gutter sized to also
roughly clear a single `HudSystem` roster row across the zooms this game
actually ships (0.8 portrait / 1.0 touch-landscape / 1.4 desktop → ~22-39
screen px). `undefined` (no camera reference) is a no-op — additive/
optional exactly like the existing `nameplateLift` field, so any caller
that omits it sees zero behavior change. Wired into `ProceduralPlayerRig`'s
new `ProceduralPlayerPose.cameraTopWorldY` field and set from
`camera.worldView.y` in the three scenes that render rigs with the
portrait-bias camera: `OnlineMatchScene.updatePlayerRig`,
`MatchScene.syncPlayerVisuals`, `HangoutScene.updatePlayerRig` (all three
already compute `worldView` for off-screen culling, so this is a one-line
addition at each site). `ReplayScene`/`TutorialScene` weren't touched (they
don't share the portrait-bias camera pattern; the field defaults to a
no-op for them).

Honest caveat: the 28px gutter is *not* guaranteed to clear a tall multi-row
roster panel in an 8-player match — that would need the clamp to read the
roster panel's actual live screen height, a materially bigger cross-system
change than this fix. It closes the literal frame-edge clip outright (the
more severe of the two named scenarios, and the only one this session could
reproduce concretely) and the common small-roster HUD-row overlap too.

- **Test**: `client/src/game/render/__tests__/nameplateLayout.test.ts`, new
  `describe("clampNameplateAnchorY", ...)` block — pure, DOM-free bun:test
  (no Phaser/browser needed): no-camera-reference is a no-op (matches
  pre-fix behavior byte-for-byte), an anchor comfortably inside the frame is
  left untouched, an anchor that would push the plate above the frame gets
  floored to the exact safe line (asserted against the literal computed
  number, not just "some positive value"), the floor scales with the rig's
  own `scale` factor, the clamped plate's top edge is proven to never land
  above the camera's edge, and the threshold boundary is inclusive.
- **Screenshot** (live product-journey check, not direct-import — this bug
  is inherently about camera/world-position interaction, so a real running
  scene was needed): Practice mode (`MatchScene`, no server/login
  dependency), local player teleported near the map's ceiling via
  `localPlayer.reset(x, y)` (the real respawn/checkpoint hook —
  `.position`/`.velocity` are getters that derive a fresh object from the
  real `entity.{x,y}` fields each call, so assigning through them does
  nothing; `reset()` is the actual mutation point) pinned every 8ms against
  gravity, camera zoom forced up via `actionCamera.setBaseZoom(2.6)` (the
  practice map is only 900 world-px tall — at its normal zoom the ENTIRE
  map fits one phone screen at once, so a tighter zoom was needed to
  genuinely run out of headroom the way a bigger real arena + portrait
  yBias does in live play). `clusterA-06-nameplate-UNFIXED-393x852.png`
  (fix reverted): the nameplate — badge, callsign, gold health-rule — is
  completely absent, hard-clipped off the top of frame; only the rig's legs
  are visible, zero name/health information anywhere near the player.
  `clusterA-06-nameplate-fixed-393x852.png` (fix restored, same teleport):
  the full nameplate ("Player_fb75 / Geometri...", badge, gold rule) renders
  intact just below the frame edge, fully legible, even though the rig's
  own sprite still pokes above frame (expected — only the nameplate's
  clipping was in scope).

### Verification method

Same two-track split as wave 1: `clampNameplateAnchorY`'s unit tests are
pure/DOM-free bun:test (no browser needed for the logic itself), while both
screenshots and the `MatchResultsOverlay` measurement test needed a real
browser — `getBoundingClientRect`/CSS layout doesn't exist under plain
bun:test (confirmed: no jsdom/happy-dom dependency in this repo; DOM-touching
tests here shim only `localStorage`, per `playerStats.test.ts`). Both used a
throwaway local `vite` dev server (never the shared `:8088` world server,
never a live service restart) via Playwright, `?gate=off` to skip the email
funnel gate and a click on `[data-boot-gate]` to clear the audio-unlock
overlay — two dev-only mechanics not documented elsewhere in this file, worth
recording for whoever next needs a from-scratch local capture.

### Left for wave 3 (unchanged from wave 1's own list, minus the two above)

clusterA-03 (dual touch-UI naming), B1 (camera-kick clamp ordering), B3-B5,
C3 (loadout station touch abilities), C4/C5/C6/C7 (venue ActionBar/touch
targets/gate ordering), D5 (generic ability glyphs), the venue-feed/duo-hint
collision, and the splash-CTA-below-the-fold question — see wave 1's own
"Left for wave 2" section above for the reasoning on each (none of it was
touched this wave). New from this wave: clusterA-05's winner-title overflow
(see above, filed but not fixed).

## Not yet / future

- Haptics (`navigator.vibrate`) on hit/kill for Android (iOS ignores it).
- A dedicated jump button as an alternative to up-tilt, if playtests show
  up-tilt is unintuitive for some players.
