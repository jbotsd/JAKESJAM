---
name: phaser4-game
description: >
  Phaser 4 + TypeScript + Vite client patterns for JAKESJAM. Use when editing
  files under client/src/game/ (scenes, systems, rendering, ui), wiring assets,
  configuring the Phaser Game/Scale, hooking input, or anything involving:
  Scene, GameObject, Sprite, Group, Texture, Atlas, Tilemap, Phaser.Loader,
  Phaser.Input, Phaser.Sound, Phaser.Cameras, Phaser.Tweens, Phaser.Game,
  Phaser.Scale, Phaser.Renderer, bitECS in a Phaser context, or "the canvas".
  Skip for pure-sim code (client/src/sim/), netcode (client/src/net/), and
  Convex code — those have their own skills.
---

# Phaser 4 Game Client (JAKESJAM)

Stack: Phaser 4 + Vite 8 + TypeScript 6, served from `client/`. The renderer is Phaser; **the simulation lives in `@sim/`** and runs headless on both client and server. The client's job is to render snapshots, capture input, and play juice (particles, screen shake, audio). Don't put gameplay rules in scenes.

## Architectural rules

- **Scenes render. `@sim/` simulates.** A Phaser `Scene` should never own gameplay state that the server cares about. It reads from the predicted client `World` and draws.
- **One Game, multiple Scenes**, in this order: `Boot` (loaders + scale config) → `Preload` (atlas/audio) → `MainMenu` → `Match` (gameplay) → `HUD` (parallel overlay scene). Run HUD with `scene.launch('HUD')` so it doesn't pause when Match pauses.
- **No game logic in `update()`.** `Scene.update(time, dt)` should call `world.applyInputAndStep(localInput, dt)`, then sync sprite transforms from `world.state`. That's it.
- **No `new` in hot paths.** Pre-create sprites in `create()`, recycle via `Group.getFirstDead(true)` or a hand-rolled pool. The Phaser team explicitly recommends preallocating sprites to avoid GC stutter.

## Phaser 4 specifics worth knowing

- Phaser 4 internally uses **bitECS** (TypedArray SoA storage). Opt into bitECS for **your** systems only when you have hundreds-to-thousands of entities (projectiles, particles, debris). For player/UI, idiomatic `Phaser.GameObjects.Sprite` is fine.
- `Phaser.Scale.FIT` with a fixed logical resolution (e.g. 1920×1080) keeps gameplay coordinates predictable. Set `roundPixels: true` on the camera for crisp pixel art.
- Renderer: prefer **WebGL**. Canvas fallback works but particle/blend modes degrade. Set `type: Phaser.AUTO` and don't ship Canvas-only effects.
- `Phaser.Loader` runs once per Scene by default — preload once in `Preload`, then `scene.start('Match')`. Don't reload assets per round.

## Asset pipeline

- **Sprites: one atlas per logical group** (player.json, projectiles.json, vfx.json). Use TexturePacker or free-tex-packer; load via `this.load.atlas(key, png, json)`. One draw call per atlas vs. one per loose image.
- **Audio: a single audio sprite** (`this.load.audioSprite`) for SFX. WebAudio cost is per-source, not per-clip.
- **Vite integration**: put raw assets under `client/public/assets/` so Vite serves them verbatim with stable URLs (`/assets/atlas/player.png`). Don't `import` binary assets through Vite's pipeline — Phaser's loader expects URLs, not modules.
- **Hot reload**: Vite HMR will reload the page on `.ts` change. Don't try to swap scenes in place; full reload is cheaper than the bugs.

## Input

- Cache `this.cursors = this.input.keyboard.createCursorKeys()` in `create()`, not `update()`.
- Build a `KeyBitmask` once per frame from cursor state and pass it to the sim. The wire protocol (`server/src/protocol.ts`) expects `keys: number` (a bitmask) — match it client-side so prediction and authoritative inputs are byte-identical.
- Pointer aim: read `this.input.activePointer.worldX/Y` after `cameras.main.getWorldPoint()` — pointer coordinates are screen-space by default.

## Rendering snapshots

- Keep a `Map<EntityId, Sprite>` per entity kind. Each frame:
  1. For every entity in `world.state`, `getOrCreate` its sprite.
  2. Set `sprite.x/y/rotation` from world state.
  3. For entities present last frame but absent now, return their sprite to the pool (`sprite.setActive(false).setVisible(false)`).
- **Interpolate remote entities ~100ms behind** server time using `client/src/net/interpolationBuffer.ts`. Local player is predicted, not interpolated.

## Anti-patterns (don't do these)

- ❌ `this.add.sprite(...)` inside `update()` — leaks until scene shutdown.
- ❌ `scene.scene.restart()` for round resets — call `world.reset(seed)` instead, keep the scene.
- ❌ `Phaser.Math.Between` in sim code — use the seeded RNG from `@sim/rng.ts` so client prediction matches the server.
- ❌ Putting hit detection in Phaser physics — collisions live in `@sim/collision.ts` and are authoritative server-side.
- ❌ Tweening gameplay-relevant state (HP, ammo). Tween only cosmetic state (camera shake, UI flashes).

## Sim-loop ↔ Phaser-tick seam (CRITICAL for multiplayer)

JAKESJAM's render uses Phaser's RAF-driven `update()`. The simulation/prediction loop in `client/src/net/clientLoop.ts` runs on `setInterval(STEP_MS)`. These are TWO independent loops; they must coexist on these rules:

1. **Input capture is RAF-paced.** `OnlineMatchScene.update()` reads `this.keys.*.isDown` and the pointer, builds a `LocalInput`, calls `loop.setLocalInput(input)`. The sim loop reads it at its own cadence.
2. **Sim ticks on its own timer.** The `setInterval` accumulator drains `STEP_MS` chunks from elapsed wall-clock and calls `World.step` each chunk. Independent of frame rate.
3. **Render reads `getRenderState()` once per RAF.** Never call `World.step` from a Phaser scene — the sim loop owns stepping.
4. **Tab-blur is the failure mode.** Browsers throttle `setInterval` to 1 Hz when the tab is hidden but freeze RAF entirely. On return, sim has advanced ~N seconds; render hasn't. The reconcile path catches up via `prevRenderedX/Y` smoothing, but for the local player the "smooth window" is 100 ms — much shorter than typical away-time. **Decision:** pause the sim loop on `Phaser.Core.Events.BLUR` (cleaner, but server may time out the connection), or accept divergence and rely on reconcile (current JAKESJAM choice).

```typescript
// In OnlineMatchScene.create() — pause/resume sim loop on tab focus changes
this.game.events.on(Phaser.Core.Events.BLUR, () => this.loop?.stop());
this.game.events.on(Phaser.Core.Events.FOCUS, () => this.loop?.start());
```

5. **`Math.random()` is forbidden in the sim** but free in scenes. Visual jitter (damage-number spread, particle fan-out angles, blast spike length variance) is render-only and should use `Math.random` directly. Sim-side randomness must use `@sim/rng.ts` so prediction matches authority.

## Procedural rig render contract

`ProceduralPlayerRig` is JAKESJAM's IK-driven character (chest/arm/aim-target). The render contract:

- **Scene owns instantiation.** `new ProceduralPlayerRig(scene, { color, name, scale })` in `create()` or on first sighting of an entity (`OnlineMatchScene.ts` ~line 803).
- **Per-frame update receives `deltaMs` + a typed pose payload** — position (sim foot-position, NOT body center; the rig wants foot Y), velocity, aim target, grounded flag, crouching flag, health, maxHealth.
- **Sim body height vs rig body height differ** — sim uses `bodyHeight=56`, `crouchHeight=38`, but stores `(x,y)` as body center. The rig wants foot position. Constants `SIM_BODY_HALF_HEIGHT = 28` / `SIM_CROUCH_HALF_HEIGHT = 19` translate. Document this offset whenever the rig is used; it's the #1 source of "rig is floating above platform" bugs.
- **Disposal:** `rig.destroy()` is mandatory before `playerRigs.delete(pid)`. Phaser's scene cleanup eventually GCs the inner GameObjects, but the rig holds tween references that need explicit cancellation.

## Pool drain on round-end

Round transitions are the highest-risk pool moment in JAKESJAM:

- **Active particles must drain before round-start.** A burning player at round-end has 5–10 in-flight burn-spark tweens. If the round restart spawns new players in those particles' tween targets… don't.
- **Pattern:** on `round-end` SimEvent, force-release all active pool entries:
  ```typescript
  drainActive(scene: Phaser.Scene): void {
    scene.tweens.killTweensOf([
      ...this.sparkActive, ...this.shardActive, ...this.ringActive,
      ...this.boltActive, ...this.blastCircleActive,
    ]);
    for (const o of this.sparkActive) this.release(o);
    // etc.
  }
  ```
- **Hook from the scene:** `this.particlePool.drainActive(this)` in the `case "round-end":` arm of `handleSimEvents`.

Without this, sporadic crashes on round restart from "tween completed on freed object" — exactly the class of bug the existing `ParticlePool.destroyed` flag mitigates at scene-shutdown but doesn't cover round-restart.

## Visual juice taxonomy (Phaser 4 API surface)

The `phaser-ui` skill's "VISUAL DESIGN QUALITY" section gives taste rules; this is the API cheatsheet for the specific Phaser 4 calls.

| Effect | Phaser 4 API | When to use | Cost |
|---|---|---|---|
| **Screen shake** | `cam.shake(durationMs, intensity)` — `intensity` is a 0–1 pixel-fraction (0.004 ≈ 4 px on a 1000px canvas) | Hit confirmation, big explosions | Cheap, but stacks — guard with `cam.shakeEffect.isRunning` |
| **Hit-stop / time freeze** | `scene.time.timeScale = 0` then `delayedCall(35, () => scene.time.timeScale = 1)` | Big hit, kill confirm | Affects ALL of scene's tweens + timers — single-player only (multiplayer: only the local client freezes; remote players keep moving) |
| **Slow-mo** | `scene.time.timeScale = 0.4` for a window | Combo finishers, special abilities | Same caveat — single-player only |
| **Camera flash** | `cam.flash(durationMs, r, g, b)` | Critical hit, level-up | Cheap, doesn't stack with shake |
| **Camera fade** | `cam.fadeOut(ms, r, g, b, callback)` | Scene transition, death | Owned by camera — cancel on shutdown if mid-fade |
| **Camera zoom** | `cam.zoomTo(scale, ms, ease)` | Boss reveal, kill cam | Affects HUD if HUD is in same scene — anchor HUD via `setScrollFactor(0)` |
| **Bloom** | `cam.postFX.addBloom(color, offsetX, offsetY, blurStrength)` | Magic, neon vibes | WebGL-only; per-camera cost |
| **Vignette** | Full-screen `Rectangle` at depth 900 with radial alpha mask, OR `cam.postFX.addVignette()` | Low-HP, dramatic moment | Cheap (single rect) or moderate (postFX) |
| **Hit-flash on sprite** | `sprite.setTint(0xffffff); time.delayedCall(60, () => sprite.clearTint())` | Damage taken | Free; clears on next anims frame though — restore tint after |
| **Damage numbers** | `add.text` + tween upward + alpha to 0 + destroy on complete | Every hit | One Text object per number — pool if >5/sec |
| **Particle burst** | `add.particles(x, y, key, { …, emitting: false }).explode(count)` | Pickup, explosion | One-shot; cleans up after lifespan |
| **Stagger reveal** | `tweens.add` with `delay: i * 80` per element | Card draft, results overlay | The juice that sells "intentional design" — see existing recipe in this SKILL.md |
| **Banner pop** | `setScale(1.3)` + `tween` to `1.0` with `Back.easeOut` | Round start, level intro | Existing recipe in this SKILL.md |

**Anti-pattern from JAKESJAM history:** stacking shake calls. `cam.shake(60, 0.004)` issued every frame during a hit-streak compounds; intensity grows until the camera looks broken. Fix: `if (cam.shakeEffect?.isRunning) return;`. Apply same guard pattern to flash/fade/zoom.

## Scene init data is a typed contract

`OnlineMatchSceneInit` (`client/src/game/scenes/OnlineMatchScene.ts`) is the right shape. Mirror this for every scene that takes init data:

- Export a `XxxSceneInit` type from the scene module.
- The scene's `init(data: XxxSceneInit)` signature uses that type — no `Record<string, unknown>`, no `any`.
- The launcher (whether `main.ts`, lobby controller, or another scene) imports the type and constructs typed payloads.
- For boot ordering: the **launcher must validate the payload before** `scene.start` — Phaser throws into an `init` failure that's hard to trace. Validate at the boundary instead.

```typescript
// In the launcher (client/src/main.ts or LobbyController.ts):
window.addEventListener('jakesjam:start-match', (ev: CustomEvent) => {
  const detail = ev.detail as Partial<OnlineMatchSceneInit>;
  if (!detail.localPlayerId) { console.error('start-match missing localPlayerId'); return; }
  const init: OnlineMatchSceneInit = {
    localPlayerId: detail.localPlayerId,
    matchId: detail.matchId,
    convexUrl: detail.convexUrl,
    mode: detail.mode ?? 'room',
  };
  game.scene.start('OnlineMatchScene', init);
});
```

## Quick checks before a PR

- `bun run --filter client typecheck` clean.
- No `Math.random()` outside `client/src/game/ui` and `client/src/game/rendering` (sim purity).
- No `setTimeout`/`setInterval` driving gameplay — use `scene.time.addEvent` for cosmetic timers, sim ticks for gameplay timers.

## References (KOLs / sources)

- [Phaser Dev Log 260 — Phaser 4 ECS internals](https://phaser.io/devlogs/260)
- [bitECS docs — data-oriented ECS using TypedArrays](https://github.com/NateTheGreatt/bitECS)
- [Phaser Performance Optimization — Object Pooling, Atlases (2025)](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide)
- [Phaser 4 + Vite + TS template](https://github.com/phaserjs/phaser-editor-template-vite-ts)

---

# Visual design + UX polish (mandatory for any user-visible surface)

> Distilled from Anthropic's `frontend-design` plugin and adapted to
> JAKESJAM's mixed DOM-overlay + Phaser-canvas reality. **Apply on every
> UI touch.** A grey button with no hint is a shipped bug.

JAKESJAM has TWO visual surfaces that share ONE taste:

1. **DOM overlays** — splash, lobby, card draft, results, death state,
   status badges. HTML + CSS in `client/src/game/ui/*.ts` and
   `client/src/style.css`.
2. **Phaser canvas** — in-game HUD, round banner, particles, scene
   geometry. Drawn with `Graphics`, `Text`, tweens.

**Don't let DOM be tasteful and Phaser look like a debug build, or
vice versa.** Every visual decision must serve the chosen aesthetic
direction documented in `docs/art-direction.md`: **futuristic
crystal-tech wizards** — geometric-minimal world, cartoon-meaty hits,
cyberpunk-sorcerer palette (Crystal Cyan default, Gruvbox Tech +
Monokai Drift swappable per `docs/themes.md`).

## The one rule

> **Commit to a bold aesthetic direction and execute it with
> precision.** Bold maximalism and refined minimalism both work — the
> failure mode is the cautious, evenly-distributed, AI-default middle.

## The seven anti-patterns (avoid AI slop)

If you catch yourself doing any of these, stop.

1. **Generic system fonts** — `Inter`, `Arial`, `Roboto`, `system-ui`.
   Body type loads Inter as a pragmatic concession; for *display*
   type (titles, kickers, banners > 18px) reach for character. See
   "Typography."
2. **Purple-gradient-on-white** + cousins (teal-pink-pastel, indigo
   CTAs). The whole crypto-SaaS aesthetic. JAKESJAM is dark + cyan
   + sharp accent — own that.
3. **Predictable card grids** — three identical cards, identical
   spacing, identical shadows. If you have N cards, vary at least one
   of: scale (recommended ≈ 1.05×), tilt, glow, depth.
4. **Solid-color backgrounds** — `background: #0b0e14` is a starting
   point, not a finished surface. Layer noise, gradient meshes, scan
   lines, vignette, drop-shadow halos. See "Backgrounds."
5. **Centered everything** — splash centred, body centred, buttons
   centred row, footer centred. Asymmetry beats symmetry 9/10.
6. **Disabled states with no explanation** — a grey button with no
   hint is the #1 lobby blocker (we hit this exact bug, fixed in
   `b837083`). Always pair `disabled` with a hint line ("Waiting on:
   Player 1f39") via the status-slot pattern.
7. **State-as-action button labels** — `<button>Unready</button>` →
   "click to unready me?" Use clear state visuals (filled vs
   outlined, ✓ prefix, `aria-pressed`) and label the **state**, not
   the action. Same fix path: `b837083`.

## Typography

### Display (titles, banners, splash > 18px)
Pick ONE display family per project — variation is a smell.

- **PP Neue Machina** (geometric, characterful — fits crystal-tech)
- **PP Editorial New** (serif moment, contrast)
- **Söhne Mono** / **Berkeley Mono** (mono display, retro-futuristic)
- **GT America Mono** (techy, Linear's house mono)
- **Migra** (display serif, art-deco edge)
- **Pangram Sans Rounded** (rounded-geometric)
- **Geist** (Vercel's neutral-but-distinctive)

Avoid by default: Inter, Roboto, Arial, system-ui, Helvetica,
**Space Grotesk** (over-used in AI gens), Poppins.

### Body (copy, status lines)
- **Inter** acceptable here — pair with a distinctive display.
- Or: **Söhne**, **Untitled Sans**, **Aktiv Grotesk**.

### In-game Phaser text
- **Bitmap fonts** beat `Text` for HUD readouts that mutate every
  frame. Pre-bake one bitmap font in the display family. See
  `phaser-ui` SKILL.md loader pattern.
- For static labels (round banner, score), font-family fallback
  prioritises the display family:
  `fontFamily: '"PP Neue Machina", "Inter", sans-serif'`.

### Hierarchy stack
Use this trio on every section header — cheapest way to feel
intentional:
- `kicker` — 10–12px, ALL CAPS, 0.18em letter-spacing, accent colour
- `title` — 24–72px, display family, 900 weight, tight line-height
- `subtitle` — 14–18px, body family, regular, muted

Mono variant for codes, ids, scores: 11–14px, mono family,
`fontVariantNumeric: tabular-nums`.

## Colour

### Rule
**Dominant + sharp accent** > evenly-distributed pastel. Pick ONE
accent that takes ~5–10% of the visible surface — it carries the
mood. JAKESJAM = `#8ff8ff` (Crystal Cyan).

### CSS variable layer
All colours in `client/src/style.css` as `--accent`, `--accent-bright`,
`--bg-deep`, `--bg-mid`, `--bg-elevated`, `--text-primary`,
`--text-muted`, `--border`, `--border-bright`, `--good`, `--warn`,
`--crit`. Reference `docs/themes.md` for the three shipped palettes.

### Phaser ↔ CSS sync
CSS `#8ff8ff` ↔ Phaser `0x8ff8ff`. Centralise in a single constant
module — don't scatter colour ints through Graphics calls.
```ts
// client/src/game/ui/palette.ts
export const PALETTE = {
  accent: 0x8ff8ff,
  accentBright: 0xcaffea,
  bgDeep: 0x05080f,
  hpGood: 0xb8f05a,
  hpWarn: 0xfde68a,
  hpCrit: 0xfb7185,
} as const;
```
Theme switching = swap CSS vars + re-emit `PALETTE` constants on a
`theme-change` event. HudSystem and renderers listen.

### State / health colours
- `hp-good` `#b8f05a` (lime, NOT pure green — pure green reads
  "form validation")
- `hp-warn` `#fde68a` (warm yellow)
- `hp-crit` `#fb7185` (coral, NOT pure red)
- `shield` `#93c5fd` (cool blue)
- `jet` `#67e8f9` (icy cyan, distinct from accent)
- `void` / debuff `#a78bfa` (violet)

### Rarity (cards) — DO NOT SWAP
- `common` `#94a3b8` (slate)
- `uncommon` `#86efac` (mint green)
- `rare` `#93c5fd` (sky blue)
- `legendary` `#fb923c` (orange) ← NOT pink, NOT purple
- `unique` `#fde047` (amber)

User explicitly corrected past bug: "uncommons are not meant to be
orange, orange means legendary." Don't re-swap.

## Motion

### Where it pays
- **High-impact moments** — page load, scene transition, card
  reveal, victory pop. ONE orchestrated stagger > ten micro-fades.
- **State change** — ready toggled, card drafted, pickup grabbed.
- **Surprise** — hover unfurl, scroll-triggered reveal, mid-air
  bounce on idle CTA.

### Where it doesn't
- Constant ambient animation (reads as 2016 webpage).
- Animations on every list item.
- Loading spinners spinning forever — show progress or meaningful
  state, not just rotation.

### Recipes

**Splash entry stagger** (DOM):
```css
.splash-stage > * {
  opacity: 0;
  transform: translateY(8px);
  animation: rise 600ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.splash-stage > *:nth-child(1) { animation-delay: 0ms; }
.splash-stage > *:nth-child(2) { animation-delay: 80ms; }
.splash-stage > *:nth-child(3) { animation-delay: 160ms; }
@keyframes rise { to { opacity: 1; transform: none; } }
```

**Spring CTA hover** (DOM):
```css
button.primary {
  transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 220ms ease;
}
button.primary:hover { transform: translateY(-2px) scale(1.02); }
button.primary:active { transform: translateY(0) scale(0.98); }
```

**Round banner pop** (Phaser):
```ts
banner.setScale(1.3);
scene.tweens.add({
  targets: banner,
  scaleX: 1, scaleY: 1,
  duration: 260,
  ease: "Back.easeOut",
});
```

**Damage hit-stop** (Phaser):
```ts
scene.time.timeScale = 0;
scene.time.delayedCall(35, () => { scene.time.timeScale = 1; });
```

### Easings — taste cheatsheet
- `cubic-bezier(0.34, 1.56, 0.64, 1)` — bouncy spring (CTAs, cards)
- `cubic-bezier(0.16, 1, 0.3, 1)` — soft ease-out (page load)
- `Back.easeOut` (Phaser) — canvas equivalent of the spring
- `Sine.easeInOut` (Phaser) — looped pulses (low-health vignette)
- Avoid plain `ease`, `ease-in-out`, `linear` — browser-default tell.

## Spatial composition

- **Asymmetry** — splash title flush-left, CTAs cluster bottom-right.
  Lobby panel offset from centre. Cards in 2+1 stagger, not 3-equal.
- **Overlap** — let one element bleed past another's edge. Card
  hovers escape grid by 8–12px on `:hover`.
- **Negative space** — 60/40 split where the heavier side does the
  work, lighter side breathes. Cramped lobbies feel debug.
- **Diagonal flow** — eye travels splash kicker → title → copy → CTA
  on a diagonal, not a column.
- **Grid-breaking** — one element per screen breaks the grid. The
  Live World status badge bleeds slightly outside the splash-stage
  box; it's the visual anchor.

### In-game spatial rule
Phaser HUD: **anchor to corners, not edges**. Top-left vitals,
top-centre score, bottom-left chips, bottom-right minimap. The
middle 60% of the screen is gameplay; HUD lives in the gutters.

## Backgrounds — atmosphere over flat fill

Solid colour is the AI tell. Layer up:

### DOM atmosphere
```css
/* Triple-radial backdrop — kills banding, adds depth */
background:
  radial-gradient(ellipse at 20% 30%, rgba(143,248,255,0.08), transparent 50%),
  radial-gradient(ellipse at 80% 70%, rgba(167,139,250,0.06), transparent 50%),
  #05080f;
```
Plus optional layers:
- **Noise** — 1–2% opacity SVG noise top layer. Kills banding.
- **Scan lines** — 1px horizontal lines, 4% alpha, every 3px. Maps
  cyberpunk-sorcerer brief.
- **Grain** — 5–8px noise at 1% alpha for film feel.

### Phaser atmosphere
- **Vignette** — full-screen rectangle, alpha-pulsed via tween,
  depth 900. JAKESJAM uses red vignette under 30% HP (HudSystem).
  Add a *cool* vignette for normal play (cyan, alpha 0.04, no pulse).
- **Particle ambient** — 3–6 slow-drifting cyan motes per scene.
  `setBlendMode(ADD)`, lifetime 4–6s, wraparound.
- **Background grid** — 80px grid lines at alpha 0.03. Sells
  "geometric-minimal world."
- **Scene gradient** — subtle cyan→deep-blue vertical gradient via
  one `Graphics.fillGradientStyle` call.

## Component patterns

### Buttons
- **Primary CTA** = filled + glow. ONE per section.
- **Secondary** = outlined + accent border, `:hover` fills 8% accent.
- **Tertiary** = ghost (text only, accent colour, underline on hover).
- **Disabled** = 40% opacity + cursor-not-allowed + paired hint line.

NEVER mix multiple primary CTAs in one view. Ask "which one action
do I want them to take?"

### Cards (draft, map picker)
- **Resting** — subtle gradient bg, 1px translucent accent border,
  drop shadow 8–12px blur.
- **Hover** — lift 2–4px (`translateY`), accent border bumps to
  full, shadow grows to 18px.
- **Selected** — solid accent ring + inner glow, slightly desaturated
  bg so the ring pops.
- **Rarity** — 0–4px outer ring colour, NOT bg.

### Status badges
- Pill shape, 16–18px height, accent border.
- Status dot LEFT of label (color-coded).
- Right-aligned actions with secondary styling.
- Canonical: `client/src/game/ui/MatchStatusBadge.ts`.

### Overlays (CardDraftOverlay, MatchResults, Death)
- Backdrop `rgba(5,8,15,0.82)` + `backdropFilter: blur(8px)`.
- Stage `linear-gradient(160deg, ...)` 2-stop, 1px accent border at
  18% alpha, 18px border-radius.
- Stage shadow:
  `0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(143,248,255,0.07)`.
- Always include a kicker (e.g. "BETWEEN ROUNDS") above the title.
- Always include the entry stagger animation.

## JAKESJAM canonical templates

Before building a new overlay, READ these as templates — pattern
language stays uniform:

- `client/src/game/ui/CardDraftOverlay.ts` — overlay shell + cards
- `client/src/game/ui/MatchResultsOverlay.ts` — winner-reveal
- `client/src/game/ui/MatchStatusBadge.ts` — pill widget
- `client/src/game/ui/MapPicker.ts` — host/non-host toggle
- `client/src/game/ui/HudSystem.ts` — Phaser HUD bars + chips
- `client/src/game/ui/RoundBanner.ts` — banner pop pattern
- `client/src/style.css` — splash, button, room-share

Re-use the per-file STYLE constants (`STAGE_STYLE`, `CARD_STYLE`)
when starting a new overlay.

## Phaser canvas vs DOM split

- **DOM** — lobby, splash, options, overlays that don't share the
  rendering with the world (no projectiles passing under).
- **Phaser** — HUD, round banner, damage numbers, particle juice,
  reticle, anything anchored to a world position.
- **Bridge** — DOM overlay opens → pause sim input → DOM closes →
  resume. See `CardDraftOverlay`'s `onPick` callback for the pattern.

## Audio is part of visual quality

- Every CTA needs a click sound (UI tick).
- Every state change (ready toggle, card pick, victory) needs a cue.
- See `client/src/game/systems/AudioSystem.ts` — already wired.

## Pre-flight checklist

Before declaring a UI surface shipped:

1. ☐ Commits to ONE bold aesthetic direction?
2. ☐ Typography distinctive (display family ≠ Inter)?
3. ☐ ONE primary CTA per view, not three?
4. ☐ Every disabled state has a hint line?
5. ☐ Button labels describe STATE, not action?
6. ☐ At least one bg layer beyond solid colour?
7. ☐ One orchestrated entry animation, not scattered fades?
8. ☐ Hover/active states feel springy
   (`Back.easeOut` / spring cubic-bezier)?
9. ☐ Asymmetry preferred to centred-everything?
10. ☐ Matches `docs/art-direction.md` (crystal-tech wizards)?
11. ☐ Phaser layer: corner-anchored HUD positions?
12. ☐ Audio cue wired (CTAs click, state changes ping)?

Any "no" → not done.

## Source

This section distills Anthropic's `frontend-design` plugin (cached
at `~/.claude/plugins/cache/claude-plugins-official/frontend-design/`).
Read that for the React-flavoured original.

## More references

- `docs/art-direction.md` — chosen direction + mood pointers
- `docs/themes.md` — three shipped palettes
- `docs/asset-prompts/*.md` — AI prompt packs for character, HUD,
  card art, particles. Use when commissioning new visuals.
