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

Wave 2 closes the HangoutScene/venue-family items wave 1 filed or deferred:
the new venue-feed/duo-hint collision, the splash-CTA-below-the-fold
question, and C3/C4/C5/C6 from wave 1's own "Left for wave 2" list. Fresh
393×852 portrait-touch screenshots (same emulation method as every prior
sweep) live in this wave's own scratch capture directory (not committed —
same convention the whole doc has used since 2026-07-04/07-09/07-28).

### Confirmed fixed

- **HangoutScene venue-feed/duo-hint collision** (new finding, top
  priority) — `duoHintText` (`HangoutScene.ts` `updateVenueFeed()`) no
  longer hard-codes `y=44`. It's now anchored dynamically off
  `feedText.y + feedText.displayHeight` (plus a small gap), recomputed
  every frame straight from `feedText`'s own live position/font-size/line
  count — the same values `updateVenueFeed()` already derives for `feedText`
  itself a few lines above, not a second guessed constant. A fresh 393px
  touch capture shows the two-line "THE ARENA — FIGHTING · ROUND 1 ·
  0 FIGHTERS · 4 BOTS / NEXT BELL 0:35" feed and the
  "[T] DUO QUEUE: OFF" hint stacked cleanly with a visible gap, neither
  double-exposed nor clipped (`w2-venue-touch-full.png`,
  `w2-venue-touch-topleft-crop.png`). Because the anchor is computed from
  `feedText`'s real geometry every frame rather than a fixed number, this
  also self-corrects across the compact/non-compact (520px) boundary and
  survives any future change to the feed string's line count or font size —
  the exact failure mode that reopened this the first time (C1's compact-mode
  reposition moved `feedText` but nothing referenced its new position).
- **C4 — ActionBarSystem gated off on touch in HangoutScene.** The venue is
  walk-only on touch (`combatButtons: false` in `create()`, and the input
  assembly in `update()` never sets Fire/Shield/slot bits for a touch
  player — `keys = t.keys & (movement-only mask)` unconditionally replaces
  whatever the keyboard path set). With nothing a touch visitor can do to
  ever move the bar's vitals or trigger a cooldown, constructing
  `ActionBarSystem` for them was pure dead weight (construction + a
  per-frame vitals/chip derivation + a canvas draw with zero payoff).
  `this.actionBar = new ActionBarSystem(this)` in `create()` is now gated
  behind `!isTouchPrimary()`, touch-only and local to this one scene —
  `updateActionBar()`'s existing `!this.actionBar` guard already no-ops the
  rest for free. Verified with two same-state venue captures differing only
  in `?touch=1` vs `?touch=0`: touch shows an empty HUD strip at the bottom
  (`w2-venue-touch-bottom-crop.png`), the forced-desktop capture in the
  *same* venue session still shows the full HP/ability-diamond/shield bar
  exactly as Fix 1 shipped it (`w2-venue-desktop-full.png`,
  `w2-venue-desktop-bottom-crop.png`) — confirming desktop/keyboard venue
  visitors (the ones Fix 1 was actually for — testing abilities on the
  dummies) keep the bar unchanged, and OnlineMatchScene/MatchScene (real
  combat, both input types) were never touched.
- **C5 — splash ghost-row touch targets** (`style.css` `.shell-btn-quiet`).
  Was `min-height: 32px` / `padding: 4px 2px` — under the ~44px
  accessibility minimum on Settings/Clips/Forge/Showcase/Intro/Credits, the
  only way back into Settings or Clips for a touch player. Grown to a 44px
  tap target via `display:flex; align-items:center; justify-content:center`
  + `min-height:44px` (kept the same quiet visual weight — no border/fill/
  bigger font, only the invisible hit area changed). Measured live at
  393px: all six buttons now report a real DOM `boundingBox` height of
  exactly 44px, the 2-row/3-col layout unchanged
  (`w2-c5-splash-ghost-row.png`).
- **C6 — Private-Room CHAOS modifier list touch targets** (`style.css`
  `.chaos-box label`). Was `min-height: 26px` — same problem, on Low
  Grav/Slo Mo/Golden Gun/Slappers Only/Fire Hazard/Random Shapes/Max
  Recoil. Since each row is a native `<label>` wrapping its checkbox + text
  (label-click toggles the input), growing `min-height` to 44px grows the
  real tap target directly — `align-items:center` (already present)
  re-centers the 16px checkbox + text inside the taller row, no
  grid-column/layout change needed. Measured live at 393px: all seven rows
  report exactly 44px tall, still legible, no overflow
  (`w2-c6-chaos-modifiers.png`, `w2-c6-private-room-full.png`).

### Investigated, confirmed working-as-intended (no change forced)

- **`[data-splash-cta]` below-the-fold.** Measured live at a stock
  393×852 portrait viewport (`?ui=instant&gate=off`, the documented
  dev/screenshot hook — verified it only strips animation/opacity, not
  layout): `[data-splash-cta]` ("▶ ENTER THE ARENA · FIGHT NIGHT EVERY
  FRIDAY ◀") sits at y≈922–999, below the 852px fold — confirms wave 1's
  reading. But `data-splash-cta`'s own click handler
  (`main.ts:1229-1232`) does nothing but proxy a click onto
  `[data-menu-world]` ("Lobby") — it is a decorative "press start" flourish
  on the same action, not a second door. `[data-menu-world]` itself
  measures y≈456–498, comfortably **above** the fold. More importantly,
  the actual first thing a genuinely fresh visitor meets (before the
  splash is even reachable — z-index 60 over the splash's 50) is the
  email-capture gate (`shell/emailGate.ts`, skippable only via
  `?gate=off`/`?kiosk=1`/an email already on file); its own "Play now"
  submit button measures y≈493–535 — also comfortably above the fold
  (`w2-splash-fold-with-emailgate.png`, `w2-splash-fold-gateoff.png`).
  So every actual path to starting a match is reachable without a scroll;
  the one thing below the fold is a redundant decorative echo of a button
  that's already reachable. This matches the documented 2026-07-04 design
  principle (`.splash-screen { display:flex; overflow-y:auto }` +
  `.splash-stage { margin:auto }` — "centers when short and scrolls when
  tall," stated generally, not just for the short-landscape media query)
  — scrolling to see it is expected, not a usability blocker. No change
  forced.

### C3 — loadout-station touch test-fire: deferred again, concretely

Still not attempted, for the same reason wave 1 gave (no live human tester
this pass either) — but here is the specific scoped approach that WOULD be
safe to ship, for whoever picks this up with a live tester available:

1. A small HangoutScene-owned DOM button (same "DOM root appended to
   `document.body`" pattern as `CardDraftOverlay`/`VesselCreatorOverlay`),
   visible only while `this.mode === "venue" && isTouchPrimary() &&
   this.loadoutInZone` — all three conditions already tracked by existing
   fields, no new state needed.
2. Wire its pointer events to new HangoutScene-local booleans, ORed into
   `keys` in `update()`'s input assembly *after* the
   `keys = t.keys & (movement mask)` line — reusing the exact same
   `InputBit.Fire`/`1 << 10..12` bits the keyboard path above it already
   sends for venue-mode touch-irrelevant players. This touches zero shared
   files: not `TouchControls.ts` (no new combat buttons in the shared
   overlay), not `InputBit`'s definitions, not `OnlineMatchScene.ts`.
3. The part that makes this genuinely non-trivial, and why it's not safe
   to just do blind: touch's current aim fallback when no drag is active
   is `aimX = me.x; aimY = me.y` — aiming at your own feet. A "test fire"
   tap under that fallback would misfire into the ground, not read as
   "try it on the dummies," and would need its own default-aim heuristic
   (e.g. aim at the nearest practice dummy — the position data already
   exists via the entities `entityRender` reads) scoped strictly to the
   loadout station. A half-tuned default aim is a new, genuinely-broken-
   feeling control shipped to real players — worse than today's honest
   gap, where nothing visible promises an effect that then fizzles. That
   judgment call needs a live playtester's eyes, which this pass doesn't
   have, same constraint wave 1 hit. Deferring again, explicitly, with
   this writeup so wave 3 doesn't have to re-derive it from scratch.

### Left for wave 3

clusterA-03 (dual touch-UI naming), clusterA-05/06 (name overflow /
nameplate clip), B1 (camera-kick clamp ordering), B3-B5, C3 (loadout
station touch abilities — see above), C7 (gate ordering — not itemized in
either wave's scope), D5 (generic ability glyphs).

### Verification method

Same two capture paths as wave 1, against a **freshly built, separately
hosted** instance — this wave's worktree has its own `client/dist` and its
own game-server process on a non-default port (`SERVE_CLIENT_DIR` pointed
at this worktree's `client/dist`), deliberately NOT the shared `:8088`
process other concurrent worktrees/agents may be relying on, and never
restarted. Same touch-emulation gotchas confirmed again this wave
(keyboard is a dead no-op for movement under `hasTouch:true, isMobile:true`;
a fresh identity hits a DOM callsign prompt — "THE VENUE ASKS YOUR NAME",
`HangoutScene.ts` `promptForCallsign()` — before joining the venue, fill
+ submit and proceed). Two additions worth keeping for future sweeps:
`?touch=1`/`?touch=0` (`game/input/mobile.ts`'s own documented URL
override) forces `isTouchPrimary()` deterministically, which made the C4
touch-vs-desktop same-state comparison exact rather than hoping Playwright's
CDP touch emulation and the app's own coarse-pointer read agreed; and
`?ui=instant&gate=off` (a documented "dev/screenshot hook" in `main.ts`)
skips the ~28s first-visit boot/ident ceremony and the email gate outright
for layout-measurement passes where neither is the thing under test.

## Not yet / future

- Haptics (`navigator.vibrate`) on hit/kill for Android (iOS ignores it).
- A dedicated jump button as an alternative to up-tilt, if playtests show
  up-tilt is unintuitive for some players.
