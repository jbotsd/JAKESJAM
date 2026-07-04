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
- **SHIELD (hold) + PARRY (tap)** thumb buttons, bottom-centre, reachable by
  lifting either thumb inward.

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
- Portrait on a touch device shows a "rotate to landscape" nudge overlay
  (`.orientation-hint`, toggled in `main.ts` on resize/orientationchange). It's
  a hint only — the game still runs.
- The in-match FTUE legend swaps to touch wording ("LEFT STICK move / PUSH UP
  jump / RIGHT STICK aim & fire / SHIELD·PARRY buttons") when touch is active.

## Verification

- Unit: `touchControls.test.ts` locks the mapping (move/jump/crouch, aim +
  auto-fire, shield/parry, deadzones, release clears aim).
- Live emulation (iPhone landscape, hasTouch): overlay + 2 zones + buttons
  present; dragging the move stick moved the player 540→1056px; portrait shows
  the orientation hint, landscape hides it; the landscape menu lays out
  cleanly.
- Desktop unaffected: touch overlay gated off; full client suite (563) green.

## Not yet / future

- Haptics (`navigator.vibrate`) on hit/kill for Android (iOS ignores it).
- A dedicated jump button as an alternative to up-tilt, if playtests show
  up-tilt is unintuitive for some players.
