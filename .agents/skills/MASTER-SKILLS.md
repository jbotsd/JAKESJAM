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
│ **Multi-layer burst (inner/middle/outer)** │ `layer.burstAt(x, y, ...).explode(count)` on 3 separate types │ Big impact kills/chaos swaps │ 3x particle budget │
│ **Multi-layer burst (per-particle velocity)** │ `speedY: -vel.length() * 0.5` (opposite direction of incoming) │ Same - with more realistic outward spread │ See Nijmans 3-Layer Pattern │
| **Stagger reveal** | `tweens.add` with `delay: i * 80` per element | Card draft, results overlay | The juice that sells "intentional design" — see existing recipe in this SKILL.md |
| **Banner pop** | `setScale(1.3)` + `tween` to `1.0` with `Back.easeOut` | Round start, level intro | Existing recipe in this SKILL.md |

**Anti-pattern from JAKESJAM history:** stacking shake calls. `cam.shake(60, 0.004)` issued every frame during a hit-streak compounds; intensity grows until the camera looks broken. Fix: `if (cam.shakeEffect?.isRunning) return;`. Apply same guard pattern to flash/fade/zoom.


## Multi-Layer Particle Burst API (Nijman's 3-Category Approach)

For big impacts, use 3-tier layering: **inner sparks** (fast, white-hot) → **middle smoke** (medium) → **outer debris** (slow).

### The `burstAt()` API

The current `ParticlePool.burstAt()` already works, but follow Nijman's layering pattern:

```ts
// Inner: Fast, white-hot sparks (0.3–0.5s lifetime)
const inner = this.particles.burstAt(x, y, {
  key: 'spark_inner_1x1',  // 16×16 PNG or atlas
  count: 16,
  speed: { min: 180, max: 360 },
  lifetime: 300,
  scale: { start: 0.8, end: 0.4 },
  tint: 0xffffff,
  blendMode: 'ADD',
  emitting: false,  // Explode will emit once
});
inner.explode(16, { speed: 200, spread: 270, maxDist: 60, quantity: 16 });

// Middle: Smoke/steam (optional, 0.8–1.2s)
if (impactSeverity > 1) {
  const middle = this.particles.burstAt(x, y, {
    key: 'smoke_particle',
    count: 24,
    speedY: 40,  // Upward drift
    lifetime: 800,
    fade: { start: 1, end: 0 },
    tint: 0xaaaaaa,
  });
  middle.explode(24, { speed: 40, spread: 270, maxDist: 100, quantity: 24 });
}

// All combined in one burst call (simpler):
this.particles.burstAt(x, y, {
  layers: ['inner', 'middle'],  // or ['inner', 'middle', 'outer'] for big hits
  elementColor: victim.weapon.element,
  rotation: true,
  velocityDamp: 0.7,
});
`


### The `burstAt()` API — per-particle velocity scatter (most realistic)

```ts
// Per-particle velocity scatter:
const incomingVel = projectile.velocity;
const incomingMag = incomingVel.length();

this.particles.burstAt(x, y, {
  key: 'debris',
  speedY: { min: -incomingMag * 0.3, max: incomingMag * 0.8 },
  speedX: { min: incomingMag * 0.1, max: incomingMag * 0.6 },
  speedYDirection: -1,  // Mostly upward on impact
  lifetime: 800,
  scale: { start: 0.4, end: 0.1 },
  blendMode: 'ADD',
  emitting: false,
}).explode(24, {
  speed: incomingMag * 0.4,
  spread: 270,
  maxDist: incomingMag * 1.5,
  quantity: 24,
});
```

**Key insight from Nijman:** Real debris "spreads opposite" to where the impact came from.
Use the incoming projectile's velocity to orient the burst's outward spread. This feels
much more physical than random position-only scatter.


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
---
name: game-sim-determinism
description: >
  Rules for the shared simulation in client/src/sim/ (imported as @sim/) that
  runs identically on the Bun server and the Phaser client. Use when editing
  any file under sim/ — World, World.step, collision, combat, projectile,
  player, weapon, fire, pickup, satellite, round, rng, types, constants,
  destructible — or anywhere "deterministic", "RNG", "seed", "rollback",
  "shared sim", "client/server parity", or "prediction divergence" comes up.
---

# Shared Simulation & Determinism

The `@sim/` package is the **only** code path allowed to mutate authoritative game state. Both the Bun server (`server/src/matchHost.ts`) and the Phaser client (`client/src/net/clientLoop.ts`) import the same `World` and call `World.step(input, dt)`. If they ever produce different output for the same inputs, **client prediction will visibly snap** every snapshot.

The bar here is **soft determinism**: same RNG seed + same input sequence + same starting state ⇒ same world state on both sides, within float epsilon. We're not doing cross-platform hard determinism (lockstep) — the server is authoritative and corrects drift on every snapshot.

## What "shared" means

- `client/src/sim/` is the source of truth. The server reaches it via the `@sim/` TS path alias (see `tsconfig.json`).
- **Sim files import nothing outside `@sim/` and `@msgpack/msgpack`** — no Phaser, no DOM, no `fetch`, no `convex`. If you need to import any of those, you're in the wrong layer.
- `@sim/types.ts` defines wire-relevant types (`WorldState`, `InputFrame`, `SimEvent`, `Tick`, `InputSeq`). Touching these is a wire-protocol change — bump `PROTOCOL_VERSION`.

## The determinism rules

1. **Seeded RNG only.** Use `@sim/rng.ts` (mulberry32 / xoshiro). **Never** `Math.random` inside `@sim/`. The server sends `rngSeed` in `ServerHello`; client seeds its predicted World with the same value.
2. **No wall clock.** Don't read `Date.now()`, `performance.now()`, or `new Date()` inside the sim. Time is `tick * STEP_MS`, full stop.
3. **Fixed step.** `World.step` takes `dt` for compat but should treat it as `STEP_MS`. Variable dt breaks parity. Clamp/quantise inputs at the loop boundary, not inside the sim.
4. **Stable iteration order.** `Map`/`Set` insertion order is deterministic in V8/Bun, but only as long as you don't delete then re-add. For player lists, sort by `playerId` before iterating any logic that depends on order (e.g. tie-breaking).
5. **No floating-point platform drift assumptions.** The same JS engine on client (V8) and server (JSC, via Bun) is **mostly** the same for IEEE-754 ops, but trig and `Math.pow` can vary. Avoid them in tight authoritative paths or reconcile via snapshot anyway. Server is authoritative — drift is acceptable, just keep it small enough that prediction looks smooth.
6. **No mutation outside `World`.** Sim entities are owned by `World`. A function in `combat.ts` doesn't return a new entity it created — it asks the World to spawn one. This keeps "what changed" auditable for snapshot/event generation.
7. **Events are explicit.** Side effects that the renderer cares about (hit flash, death, pickup) are pushed onto `SimEvent[]` and shipped in the snapshot. Don't infer "a hit happened" by diffing HP — race conditions and missed events are exactly what `events` exists to prevent.

## RNG patterns

```ts
// @sim/rng.ts exposes a stateful generator
const rng = createRng(seed);
const dmg = baseDamage + rng.range(0, 5);   // ✓ deterministic
const dmg = baseDamage + Math.random() * 5; // ✗ desync source
```

When forking RNG (e.g. one stream per round, or one per entity for independent randomness), seed each stream from a hash of `(parentSeed, streamId)`. Don't share one rng across rounds if you ever rewind a round.

## Tests

- `client/src/sim/__tests__/` runs with `bun test`. Sim tests should be **deterministic** by definition — the same inputs always produce the same outputs.
- Snapshot a `World` after N ticks of canned inputs and assert byte equality (msgpack-encoded `WorldState`) across runs. Any test flakiness here = a determinism bug, not a flaky test.
- A "parity" test that runs the same input log through two `World` instances (one created from a serialised snapshot, one from scratch) is gold for catching state-not-fully-captured bugs.

## When to break determinism (rarely)

Cosmetic-only randomness that the renderer owns is fine outside the sim — particle jitter, screen-shake offsets, idle-anim timing. These never feed back into gameplay state, so they don't need to match between peers.

## Anti-patterns (don't do these)

- ❌ `Math.random()` anywhere under `client/src/sim/`. CI should have a grep gate for this.
- ❌ `performance.now()` / `Date.now()` in sim. Use `tick`.
- ❌ Importing Phaser types into `@sim/`. The sim must be runnable by Bun with no DOM.
- ❌ Hidden async (`await`, microtasks) inside `World.step`. The sim is synchronous.
- ❌ Mutating `WorldState` from outside the World methods. Snapshot diffing depends on the World being the only mutator.
- ❌ Adding fields to `WorldState` without updating `protocol.ts` on both sides and bumping `PROTOCOL_VERSION`.

## Ref## References (KOLs / sources) - Lighting & Glows

- **Flat 2D Lighting** — Sprite-based glow, not postFX:
  [`game-lighting-flats/SKILL.md`](./game-lighting-flats/SKILL.md)
- **Multi-Layer Particle Bursts** — 4-layer (core, ring, spark, smoke):
  [`game-particle-systems/SKILL.md`](./game-particle-systems/SKILL.md)
- **Dynamic Power/Color Mapping** — 70% → 100% energy visualization:
  [`game-color-dynamics/SKILL.md`](./game-color-dynamics/SKILL.md)
- **Render Pipeline** — Depth 900 light sprites, 5-15ms total budget:
  [`game-render-pipeline/SKILL.md`](./game-render-pipeline/SKILL.md)

References (original KOLs for 2D glow):
- **Unity/Unreal 2D glow tutorials** — Sprite layer approach
- **Reference images:** `ref images/rounds/` (glow rings, energy trails, particle cores)

## The three pillars (don't break these)

1. **Server is authoritative.** It runs the only true `World`. Client predicts forward from the last acked snapshot using the same `@sim/` code, but server state always wins on reconciliation.
2. **Inputs go up, snapshots come down.** Client never tells the server "I'm at x,y" — it sends `{seq, tick, keys, aimX, aimY, dt}`. Server replies with `Snapshot{ tick, lastProcessedInputSeq, state, events }`.
3. **Fixed tick.** `STEP_MS` (≈16.67ms for 60Hz) is the same constant on both sides. Snapshots ship every `SNAPSHOT_INTERVAL_TICKS` (typically 2–3 ticks → 20–30Hz on the wire).

## Wire protocol

- msgpack-encoded with a **1-byte version prefix** (`PROTOCOL_VERSION`). Bump the version when message shapes change; both sides must reject mismatched versions in the hello handshake.
- `client/src/net/protocol.ts` and `server/src/protocol.ts` MUST stay byte-identical. If you change one, change the other in the same commit.
- Inputs are a **bitmask** (`keys: number`) — packing 8 buttons into a byte beats `{up, down, left, right, ...}` objects on both bandwidth and GC.
- Snapshots currently ship full `WorldState`. The codec is structured as a drop-in for delta encoding once the sim stabilises — keep the `baseline: Tick | null` field; senders set `null` for keyframes, receivers reject deltas whose baseline they no longer have.

## Client prediction & reconciliation

- Every input the client sends gets a monotonically increasing `seq`. Client also applies the input **immediately** to its local `World` and stores the input in a ring buffer keyed by `seq`.
- On every snapshot:
  1. Find `lastProcessedInputSeq[myPlayerId]`.
  2. Replay all inputs with `seq > lastProcessedInputSeq` against the snapshot's authoritative state.
  3. The result is the new predicted state. Any visible "snap" means prediction diverged — log it but don't paper over it; root-cause is almost always sim non-determinism (see `game-sim-determinism`).
- Discard inputs older than `lastProcessedInputSeq` from the buffer. The buffer's max size is your worst-case RTT in ticks; ~60 entries (1s @ 60Hz) is plenty.

## Snapshot interpolation (remote entities)

- **Local player is predicted, never interpolated.** Drawing the local player at `now - 100ms` feels like input lag.
- **Remote players are interpolated** ~100ms behind server time — render them between two known snapshots (`client/src/net/interpolationBuffer.ts`). This is the trade Fiedler describes: a fixed visual delay buys you smoothness despite jitter.
- If you only have one snapshot ahead, **extrapolate at most 1 tick** then freeze. Long extrapolation looks like teleporting.

## Lag compensation (hit detection)

- The server already does this in `server/src/matchHost.ts`: when processing a fire input from tick `T`, **rewind every other player's position to tick T** for the spawn frame, then resume.
- Hard-cap rewind at `LAG_COMP_MAX_MS = 250` (≈15 ticks). Anything more is suspect — clamp, don't trust.
- The shooter is **not** rewound. They fire from where they are now (matches their predicted client view).
- Maintain a per-player position ring buffer of `POSITION_HISTORY_CAPACITY = 32` (≈ cap + headroom for interpolation between adjacent samples).

## Bun WebSocket server specifics

- Use Bun's native `Bun.serve({ websocket: { ... } })` — not the `ws` npm package. Bun's binding is ~6× faster on raw throughput.
- **Disable `perMessageDeflate`** for the gameplay socket. msgpack frames are small and frequent; per-message deflate adds CPU and latency for negligible bandwidth savings.
- Topics for fan-out: `ws.subscribe(matchId)` on join, then `server.publish(matchId, encoded)` for the snapshot broadcast. One serialise, N sends.
- Watch `ws.send`'s return value: `-1` means backpressure — don't queue snapshots, drop the oldest pending and send the newest. Old snapshots are useless.
- One `MatchHost` per match per process is fine for prototype scale. Multiple processes need a Convex/Redis matchmaker hand-off (matchmaker writes which Fly machine owns the match; client reconnects there).

## Anti-patterns (don't do these)

- ❌ Sending player position from client to server. Inputs only.
- ❌ Running the sim from `requestAnimationFrame` on the client. Use a fixed-step accumulator (see `game-loop-perf`); rAF is for rendering.
- ❌ `JSON.stringify` on the wire. msgpack only. JSON allocates strings on every frame.
- ❌ `perMessageDeflate: true` for binary frames. Test with it off first.
- ❌ Treating Convex as a snapshot bus. Convex is **lobby/match metadata only** (see `AGENTS.md` "Multiplayer Boundary"). The 60Hz path is direct WS.
- ❌ Trusting client-reported tick or aim past sanity bounds. Server clamps `dt`, validates `tick` is in a recent window, ignores wildly old inputs.
- ❌ Letting `lastProcessedInputSeq` go backwards. It's monotonic per player; treat any regression as a bug or attack.

## Debug toggles to keep around

- A `?fakelag=120` URL param that delays outbound inputs by N ms — invaluable for catching prediction bugs.
- A `?dropPct=5` that drops 5% of outbound packets randomly.
- A server-side `--snapshot-fullstate` flag to disable delta encoding when chasing desync bugs.

## References (KOLs / sources)

- [Glenn Fiedler — Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- [Glenn Fiedler — Deterministic Lockstep (why we don't use it)](https://gafferongames.com/post/deterministic_lockstep/)
- [Glenn Fiedler — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [Game Networking Resources (curated by Fiedler)](https://github.com/gafferongames/GameNetworkingResources)
- [Bun WebSockets — official docs](https://bun.sh/docs/api/websockets)
- [SnapNet — Snapshot Interpolation walkthrough](https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/)
---
name: game-loop-perf
description: >
  Frame-budget and GC discipline for JAKESJAM's hot paths. Use when working
  on the game loop, sim step, render sync, particle systems, or anywhere
  perf matters: requestAnimationFrame, setInterval, fixed timestep,
  accumulator, allocation, garbage collection, jank, jitter, stutter, FPS,
  frame time, object pool, ring buffer, TypedArray, SoA/AoS, hot loop, V8
  hidden classes, profiling, DevTools Performance panel. Trigger on words
  like "slow", "drops frames", "stutter", "GC pause", "memory growing".
---

# Game Loop & Hot-Path Performance

60 FPS = **16.67 ms** total frame budget. Realistic split for JAKESJAM:

- Sim step (client prediction): ≤ 4 ms
- Render sync (Phaser GameObject updates): ≤ 4 ms
- Phaser internal render: ≤ 6 ms
- Headroom for GC, network, audio: ≤ 2 ms

A single 5 ms GC pause at 60 Hz drops a frame. The whole goal is to **never allocate during a tick**.

## Fixed timestep (Fiedler's "Fix Your Timestep")

Render at the display's refresh rate; step the sim at a fixed rate independent of it. The accumulator pattern:

```ts
let acc = 0;
const STEP_MS = 1000 / 60;

function frame(now: number) {
  const dt = Math.min(now - last, 250); // clamp the spiral of death
  last = now;
  acc += dt;
  while (acc >= STEP_MS) {
    world.step(STEP_MS);
    acc -= STEP_MS;
  }
  const alpha = acc / STEP_MS;        // for visual interpolation
  render(world.state, alpha);
  requestAnimationFrame(frame);
}
```

Why this matters here: server uses the same `STEP_MS`. Client prediction is only consistent with the server if both step the same size. If you ever pass a variable `dt` to `world.step`, **prediction will drift**.

Clamp the dt input (250 ms above) so a hidden tab waking up doesn't try to simulate a minute of game time.

## Allocation discipline (the real win)

What allocates per frame and how to kill it:

| Pattern | Why bad | Fix |
|---|---|---|
| `const v = { x, y }` in update | object allocation | scratch object or `Float32Array` slot |
| `arr.map(...)` / `arr.filter(...)` | new array + closures | classic `for (let i = 0; i < n; i++)` |
| `arr.forEach(cb)` | closure allocation per call site over hot data | `for` loop |
| `[...arr]` / `arr.slice()` | copy | iterate in place; use a fixed scratch array |
| `JSON.parse/stringify` on net frames | strings everywhere | msgpack with reused buffer |
| `new Vector2()` for math | allocation | reuse a module-scoped `_scratch` Vector2 |
| `Map<id, …>` keyed by entity in a tight loop | hash overhead | dense array indexed by entity id (SoA) |
| `setInterval` for sim | drift + can't sync to render | accumulator above |

## Object pools (the right way)

Required for: projectiles, particles, hit results, damage numbers, spawn flashes, anything that fires more than once per frame.

```ts
class Pool<T> {
  private free: T[] = [];
  constructor(private make: () => T, private reset: (t: T) => void, prealloc = 64) {
    for (let i = 0; i < prealloc; i++) this.free.push(make());
  }
  acquire(): T { return this.free.pop() ?? this.make(); }
  release(t: T): void { this.reset(t); this.free.push(t); }
}
```

Rules:
- **`reset` must zero everything.** The pool's whole point is preventing stale state across acquires.
- **Pre-allocate to peak.** `prealloc` should be your worst-case in-flight count. Pool growth is fine, pool shrink isn't worth it.
- Don't pool tiny things (numbers, single sprites) — overhead exceeds benefit.

## Structure-of-arrays for entity-heavy systems

For systems with hundreds of entities (projectiles, particles, debris):

```ts
const N = 4096;
const posX = new Float32Array(N);
const posY = new Float32Array(N);
const velX = new Float32Array(N);
const velY = new Float32Array(N);
const alive = new Uint8Array(N);
```

CPU cache loads contiguous floats per system. Iteration is `for (let i = 0; i < N; i++)` over `posX[i] += velX[i] * dt`. This is exactly how bitECS (and Phaser 4 internally) lays things out.

For player/sim entities (count < ~50) the AoS object form is fine — readability wins over the marginal cache benefit.

## Profiling — what to actually do

- **Chrome DevTools → Performance → Record** for ~5 seconds of gameplay. Look for:
  - **Yellow GC bars in the timeline** — every one is a hitch. Click into the call tree to find the allocator.
  - **Long Task warnings** (>50 ms) — usually first frame after asset load or scene transition.
  - **Scripting time vs Rendering time** ratio. Scripting > 8 ms per frame → look at sim or render-sync.
- **`performance.measure`** around `world.step` and around the snapshot-render sync. Log p50/p95 every 5 s. Numbers beat vibes.
- **Don't trust Lighthouse** for game perf — it measures load, not steady-state frames. The Performance panel is the truth.
- Run with `--enable-precise-memory-info` and watch `performance.memory.usedJSHeapSize`. Steady-state should be flat. Sawtooth = you're allocating per frame; the slope is the rate.

## Anti-patterns (don't do these)

- ❌ `requestAnimationFrame` driving `world.step` directly with a variable dt. Drifts vs. server.
- ❌ Closures inside `update`/`step` (e.g. `players.forEach(p => …)` referencing locals). The closure allocates.
- ❌ Polling `performance.now()` repeatedly inside a frame. Sample once at the top.
- ❌ Spawning a new `Phaser.GameObjects.Sprite` per projectile. Pool them.
- ❌ Treating GC as "the runtime's problem". On 60 Hz games it is your problem.
- ❌ Optimising before measuring. Take a profile first; the bottleneck is rarely where you guess.

## References (KOLs / sources)

- [Glenn Fiedler — Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/)
- [Robert Nystrom — Game Loop pattern](https://gameprogrammingpatterns.com/game-loop.html)
- [web.dev — Static Memory JavaScript with Object Pools (V8 team)](https://web.dev/speed-static-mem-pools/)
- [Aleksandr Hovhannisyan — Performant Game Loops in JavaScript](https://www.aleksandrhovhannisyan.com/blog/javascript-game-loop/)
- [Phaser Performance Optimization Guide](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide)
---
name: combat-balance-ttk
description: >
  Time-to-kill, weapon archetype matrix, dodge windows, parry timing,
  damage curves. Use when editing client/src/sim/data/weapons.ts,
  weaponBuild.ts, sim/combat.ts, or sim/constants.ts. Also use when
  reviewing chaos modifiers that change damage, RPS, or hitboxes —
  they must keep TTK inside the band.
version: 1.0.0
---

# Combat Balance & TTK

## Why this skill exists

JAKESJAM is a 1v1-first arena shooter pivoting to N-player. Every
new card, weapon, or chaos modifier shifts the time-to-kill (TTK)
curve. Without a stated TTK target, balance becomes "whoever shipped
the last weapon gets to feel powerful". Halo, Quake, and the FGC
have already settled this argument: pick a TTK band, defend it,
and *every* weapon must justify itself against the band.

## The hard line

**1v1 TTK target band: 1.8s – 3.5s at neutral range. Any weapon or
card that pushes the median TTK outside this band is broken until
proven otherwise. No "instakill" weapons. No "tickle" weapons. No
exceptions for "fun" — fun is what TTK enables.**

## What the KOL says

**Jaime Griesemer, "30 seconds of fun"** — Halo lead designer,
Bungie. The phrase came out of the GDC 2002 talk *The Illusion of
Intelligence: AI and Level Design in Halo* (with Chris Butcher) and
got canonised in the Halo 2 behind-the-scenes documentary:

> "In Halo 1, there was maybe 30 seconds of fun that happened over
> and over and over again, so if you can get 30 seconds of fun, you
> can pretty much stretch that out to be an entire game."
> — Jaime Griesemer

Two implications JAKESJAM must honour:
1. The 30-second loop is *engagement → flank → reposition → engage*.
   If the TTK is too short the loop collapses to "die first, lose".
   If too long, the loop stretches past 30s and players disengage.
2. Every weapon must be evaluable inside *one* engagement. Weapons
   whose value is "useful in the next fight" (e.g. status DoT that
   only matters in 8s) are second-class.

**David Sirlin, "Playing to Win"** — Street Fighter HD Remix designer.
Sirlin's chapter "Balance Theory" introduces the *paper-rock-scissors
test*: every viable strategy must have at least one strategy that
beats it. Single-strategy dominance ("scrub strategies") destroys
competitive depth.

> "If a strategy has no counter, the metagame collapses to that
> strategy. Add the counter, or remove the strategy."
> — Sirlin, Playing to Win, ch. "Balance Theory"

## How JAKESJAM applies it

Concrete files:

- `client/src/sim/data/weapons.ts` — base weapon defs (DPS, RPS,
  spread, projectile speed). Constrained by the TTK band.
- `client/src/sim/data/weaponBuild.ts` — applies cards. The unit
  test boundary for "this combo breaks TTK".
- `client/src/sim/combat.ts` — damage application, parry/shield
  resolution. Defines the dodge window via projectile speed +
  player accel.
- `client/src/sim/constants.ts` — `PLAYER_BASE_HP`,
  `PARRY_WINDOW_MS`, `SHIELD_DURATION_MS`. These are the levers.
- `client/src/sim/data/chaosModifiers.ts` — modifiers like
  `golden-gun` (1-shot kill) violate the band by design. They are
  *temporal* (one round) and clearly signposted; not the default
  experience.

`PLAYER_BASE_HP = 100` is the anchor. A weapon doing 30 dmg/shot at
3 RPS = 1.1s TTK ⇒ too fast. Same weapon at 2 RPS = 1.7s ⇒ at the
edge. 25 dmg/shot at 3 RPS = 1.3s ⇒ still too fast. 25 at 2 RPS =
2.0s ⇒ in band.

## Recipes

### 1. Compute TTK as a derived constant in the data file

```ts
// client/src/sim/data/weapons.ts
import { PLAYER_BASE_HP } from '../constants';

export type WeaponDef = {
  id: WeaponId;
  damagePerShot: number;
  shotsPerSecond: number;
  // ... pathing, shape, etc.
};

export function neutralTTK(w: WeaponDef): number {
  return PLAYER_BASE_HP / (w.damagePerShot * w.shotsPerSecond);
}

// Asserted in tests:
//   for (const w of WEAPONS) {
//     expect(neutralTTK(w)).toBeGreaterThanOrEqual(1.8);
//     expect(neutralTTK(w)).toBeLessThanOrEqual(3.5);
//   }
```

Add the assertion in `client/src/sim/__tests__/weaponBuild.test.ts`.
Any new weapon outside the band fails CI.

### 2. The archetype matrix (Sirlin's RPS test)

The MVP has 4 weapon paths (`AGENTS.md`). Lock them as a
deliberate paper-rock-scissors:

| Archetype | Strong vs   | Weak vs      | TTK target |
| --------- | ----------- | ------------ | ---------- |
| Rapid     | Heavy       | Burst        | 2.0s       |
| Heavy     | Burst       | Rapid (kite) | 2.4s       |
| Burst     | Rapid       | Heavy (miss) | 1.9s       |
| Control   | All (zone)  | Direct DPS   | 3.2s       |

Every card must declare which archetype it pushes the build toward
(`tag` in `cards.ts`). The matrix is the single source of truth in
`docs/jakesjam-design-pillars.md` — update both files together.

### 3. Dodge window must exceed reaction time

Human reaction to a visual stimulus floors at ~200ms (the literature
hovers 200–250ms for trained shooter players). Projectiles in
JAKESJAM must give the target ≥ 250ms between *visible spawn* and
*impact* at neutral range (16 tiles). Below that, the game stops
being a duel and becomes hitscan roulette.

```ts
// client/src/sim/__tests__/weapon.test.ts
test('every projectile is dodgeable at neutral range', () => {
  for (const w of WEAPONS) {
    const distance = NEUTRAL_RANGE_TILES * TILE_SIZE;
    const timeToImpact = distance / w.projectileSpeed;
    expect(timeToImpact).toBeGreaterThanOrEqual(0.25);
  }
});
```

### 4. Parry/shield as a deliberate counter, not an escape

`PARRY_WINDOW_MS` should sit in the 120–180ms range. Below 120ms it's
muscle-memory only (no skill ceiling for newcomers). Above 180ms it
becomes the dominant strategy and the game devolves to "hold parry".

```ts
// client/src/sim/constants.ts
export const PARRY_WINDOW_MS = 150;        // Sirlin: "make the optimal play hard but learnable"
export const PARRY_COOLDOWN_MS = 1200;     // Hard cooldown. No spamming.
export const SHIELD_DURATION_MS = 600;     // Shorter than TTK by half — never a get-out-of-jail card
```

### 5. Per-card TTK regression test

Every card mutation goes through `createWeaponBuild`. Test the worst-
case (best-case for the picker) combo:

```ts
// client/src/sim/__tests__/weaponBuild.test.ts
test('no card combo lets a weapon breach 1.5s TTK', () => {
  for (const w of WEAPONS) {
    for (const c1 of CARDS) for (const c2 of CARDS) for (const c3 of CARDS) {
      if (c1 === c2 || c2 === c3 || c1 === c3) continue;
      const build = createWeaponBuild(w, [c1, c2, c3]);
      expect(neutralTTKBuild(build)).toBeGreaterThanOrEqual(1.5);
    }
  }
});
```

The hard floor is 1.5s (not 1.8s) because card stacking is the
*reward* for winning the draft; allow a 0.3s squeeze, not a free
instakill.

### 6. Chaos modifiers signposted as out-of-band

```ts
// client/src/sim/data/chaosModifiers.ts
export type ChaosModifier = {
  id: ChaosModifierId;
  ttkBandViolation: boolean;   // explicit declaration
  // ...
};

// In the round banner:
if (modifier.ttkBandViolation) {
  banner.show(`CHAOS: ${modifier.label} (extreme TTK)`, 0xff3333);
}
```

Players need to *know* the round is wild. Quiet rule changes are the
#1 perceived-unfairness driver in arena PvP.

## Anti-patterns

- **Adding a "+50% damage" card.** It always picks. Always
  dominates. It violates the matrix. Do not ship.
- **A weapon whose dodge window is < 250ms at neutral range.**
  Hitscan roulette. Players blame the netcode. Netcode isn't the
  problem.
- **Parry window > 200ms.** Optimal play becomes "hold parry,
  punish on whiff". The game becomes a parry-fishing simulator.
- **Adding a 5th archetype "for variety" before the 4 are tuned.**
  Sirlin: tighten the matrix before widening it.
- **Treating chaos modifiers as the default tuning lever.** They
  are exceptions. The base game must sing without any modifier on.
- **Per-weapon balance in isolation.** Balance the *matrix*, not
  the cell. A buff to Rapid implies a re-look at Heavy and Burst.
- **Letting `WeaponSystem.ts` (render layer) compute damage.**
  Damage lives in `sim/combat.ts`. Render shows the number, never
  decides it.

## Pre-flight checklist

- [ ] `neutralTTK(w)` test passes for every weapon in the band.
- [ ] Every card's worst-case stack tested against the 1.5s floor.
- [ ] Every projectile has ≥250ms dodge window at neutral range.
- [ ] `PARRY_WINDOW_MS` is between 120 and 180.
- [ ] `SHIELD_DURATION_MS < neutralTTK(slowestWeapon) * 1000 / 2`.
- [ ] The 4 archetypes still fit the RPS matrix after the change.
- [ ] Chaos modifiers that violate TTK are flagged and the banner
      warns the player.
- [ ] No new card grants flat unconditional damage with no
      counterplay.
- [ ] `docs/jakesjam-design-pillars.md` updated if the matrix
      shifted.

## Source

- Jaime Griesemer / Chris Butcher, "The Illusion of Intelligence:
  AI and Level Design in Halo" — GDC 2002. Catalog entry referenced
  in: https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- Half-Minute Halo interview (Engadget, 2011, the canonical source
  for the "30 seconds of fun" quote):
  https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- David Sirlin, "Playing to Win: Becoming the Champion" — full text
  https://www.sirlin.net/ptw — chapter "Balance Theory" especially.
---
name: game-feel-juice
description: >
  Hit-stop, screen shake, knockback, particle bursts, kickback, camera lerp,
  depth vignette, elasto-kinetic bounce, RGB split, motion trails, tempoal bloom,
  variable burst count, multi-layer particles (inner/middle/outer), speed lines,
  combo pop, impact plop, hit rotation, frequency ducking, audio tail, per-particle
  velocity scatter. Use when editing client/src/game/systems/ParticlePool.ts,
  StatusVfxController.ts, WeaponSystem.ts, or any time a JAKESJAM weapon
  "feels weak", a death feels mushy, or a card pick has no payoff. Render-layer
  only — never touches the deterministic sim.
version: 1.0.1
---

# Game Feel & Juice

## Why this skill exists

JAKESJAM's projectiles, deaths, and card-draft pops all currently fire
through the same generic particle pool. Without a deliberate juice
budget the game reads as "deterministic numbers moving on a screen".
The sim is locked (it must stay deterministic — see
`game-sim-determinism`), so 100% of feel work happens in
`client/src/game/` render+VFX code. This skill encodes Vlambeer's and
Swink's rules so that every hit, kill, draft, and chaos-modifier swap
has a layered, repeatable juice signature.

## The hard line

**Every meaningful event gets at least three of: hit-stop, screen
shake, particle burst, knockback, sound, color flash, scale punch.
One channel alone is never enough. None of it lives in `client/src/sim/`.**

## What the KOL says

**Jan Willem Nijman, "The Art of Screenshake"** (Vlambeer, INDIGO Classes
2013, ~30 min). Nijman's live demo of *Super Crate Box* turns a
flat-feeling shooter into Nuclear-Throne-grade juice by adding 30+
layered effects one at a time. The recurring pattern:

> "Every action needs reaction. Bigger reactions for bigger actions."
> — Nijman, Art of Screenshake (timestamp ~12:00)

His demo's checklist (verbatim ordering from the talk):
permanence → bigger explosions → impact effects → screen shake →
muzzle flashes → screen freezing (hit-stop) → camera lerp → camera
kick → recoil → enemy hit-flashes → permanent corpses → sleep frames
on kill → knockback → speed lines → tweened spawning → random
pitch on SFX.

**Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
Sensation"** (Morgan Kaufmann, 2008). Chapter 9 ("The Feel of Polish")
calls these layered cues "polish stack" and argues you cannot evaluate
any one of them in isolation — only the stack matters.

## How JAKESJAM applies it

Concrete files:

- `client/src/game/systems/ParticlePool.ts` — owns particle burst
  budgets. Every weapon impact passes through here.
- `client/src/game/systems/StatusVfxController.ts` — owns flashes,
  scale punches, color tints on `PlayerEntity` rigs.
- `client/src/game/systems/WeaponSystem.ts` — owns kickback (visual
  only — the sim's weapon spread/recoil already runs in
  `sim/weapon.ts`).
- `client/src/game/systems/AudioSystem.ts` — owns pitch jitter,
  layered SFX.
- `client/src/game/scenes/MatchScene.ts` / `OnlineMatchScene.ts` —
  owns camera shake via `this.cameras.main.shake(...)`.
- `client/src/game/ui/CardDraftOverlay.ts` — drafting picks need
  juice too. A card click without a screen kick is a wasted moment.

The boundary is hard: `StepResult` from the sim emits *events*
(`projectileImpacted`, `playerKilled`, `cardSelected`, `chaosRolled`).
The render layer reads those events and runs the juice stack. The sim
never knows shake or hit-stop happened.

## Recipes

### 1. The "kill stack" — every player death

```ts
// client/src/game/systems/StatusVfxController.ts
onPlayerKilled(victimId: PlayerId, killerId: PlayerId | null) {
  // 1. Hit-stop (visual freeze of render only — sim keeps ticking)
  this.scene.tweens.timeScale = 0;
  this.scene.time.delayedCall(80, () => { this.scene.tweens.timeScale = 1; });

  // 2. Screen shake — bigger for kills than impacts
  this.scene.cameras.main.shake(180, 0.012);

  // 3. Particle burst — chunky, color-matched to victim element
  this.particles.burstAt(victim.x, victim.y, {
    count: 24, speedRange: [180, 360], lifetime: 600,
    tint: elementColors[victim.weapon.element],
  });

  // 4. Color flash on victim rig (1 frame white, then fade)
  this.flashRig(victimId, 0xffffff, 60);

  // 5. Audio: layered low boom + high "tink", random pitch ±10%
  this.audio.play('kill_boom', { rate: 0.95 + Math.random() * 0.1 });
  this.audio.play('kill_tink', { rate: 0.95 + Math.random() * 0.1 });

  // 6. Knockback on the killer's camera (subtle — they did the kill)
  if (killerId === this.localPlayerId) {
    this.cameraKick(0, -8, 120);
  }
}
```

### 2. Hit-stop on projectile impact (render-only)

Hit-stop in JAKESJAM CANNOT pause the sim — the sim is authoritative
and shared. Pause only the *render* tween clock and post-processing
shaders. The sim keeps ticking; players keep moving; only the impact
visual freezes.

```ts
// On `projectileImpacted` event:
const stopMs = projectile.damage > 30 ? 50 : 25;
this.tweens.timeScale = 0;
this.scene.time.delayedCall(stopMs, () => { this.tweens.timeScale = 1; });
```

### 3. Camera shake budget

Per the talk, shake gets noisy fast. Use one bus and clamp:

```ts
// client/src/game/systems/CameraShakeBus.ts (create if missing)
shake(intensity: number, durationMs: number) {
  const cam = this.scene.cameras.main;
  // Don't restart shake — extend amplitude only if larger.
  const current = cam._shakeAmplitude ?? 0;
  if (intensity <= current) return;
  cam.shake(durationMs, intensity);
}
```

Buckets: `0.004` (footstep), `0.008` (impact), `0.012` (kill),
`0.020` (chaos modifier swap), `0.030` (round end). Anything above
`0.030` makes the player nauseous.

### 4. Card-draft punch

`CardDraftOverlay` currently fades cards in. Add Nijman's "tweened
spawning" + a kickback on confirm:

```ts
// client/src/game/ui/CardDraftOverlay.ts
spawnCard(card: CardDef, slotIndex: number) {
  const sprite = this.add.image(...).setScale(0.6).setAlpha(0);
  this.scene.tweens.add({
    targets: sprite,
    scale: 1, alpha: 1,
    delay: slotIndex * 60,             // staggered, not simultaneous
    duration: 180,
    ease: 'Back.easeOut',              // overshoot — Nijman pattern
  });
}

onConfirmCard(card: CardDef) {
  this.scene.cameras.main.shake(120, 0.010);
  this.scene.cameras.main.flash(80, 255, 255, 200, false);
  this.audio.play('card_pick', { rate: 0.9 + Math.random() * 0.2 });
}
```

### 5. Knockback on hit (visual only)

Sim knockback exists in `sim/combat.ts` (positions are authoritative).
Render layer adds a *visual-only* spring on the rig — the visual
overshoots the authoritative position, then snaps back inside 100ms.

```ts
// client/src/game/systems/RemotePlayerManager.ts
applyHitVisual(playerId: PlayerId, dirX: number, dirY: number) {
  const rig = this.rigs.get(playerId);
  const offsetX = dirX * 6, offsetY = dirY * 6;
  rig.visualOffsetX = offsetX; rig.visualOffsetY = offsetY;
  this.scene.tweens.add({
    targets: rig,
    visualOffsetX: 0, visualOffsetY: 0,
    duration: 90, ease: 'Cubic.easeOut',
  });
}
```

### 6. Random pitch on every SFX (Nijman's #16)

`AudioSystem.play` must default to `rate: 0.92 + Math.random() * 0.16`.
Only opt out for music and UI tones. Without this, repeated fire on
the Scrap Rifle sounds like a sewing machine.



## Missing Effects to Add (from More Mountains \& Nijman's "30+ Layered Effects")

### 7. Z-Depth Fog (depth perception)

When a big impact happens, push fog or depth haze *behind* the impact point. Makes the foreground feel closer.

```ts
// On big impact (kills, explosions):
this.depthVignetteFlash();  // Creates a temporary depth flash behind impact
```

### 8. Multi-Layer Particles (Nijman's explicit 3-layer approach)

Nijman's demo uses 3+ particle types per impact:

- **Inner**: Sparks (fast, white-hot, short-lived 0.3-0.5s)
- **Middle**: Smoke/steam (slower, medium-lived 0.8-1.2s)  
- **Outer**: Debris/death trail (slowest, 1.5-2s)

```ts
// Multi-layer particle burst at impact
this.multiLayerBurstAt(x, y, {
  elementColor: enemy.elementColor,
  layers: ['inner', 'middle'],  // or ['inner', 'middle', 'outer'] for big hits
  depthMode: 'fog',  // 'fog', 'bloom', 'vignette', or 'none'
  rotation: true,    // enable visual rotation on impact
  velocityDamp: 0.7, // 0-1, how much momentum remains after impact
});
```

### 9. Screen Vignette Flash (deep impact focus)

Not just a color flash, but a temporary **vignette** overlay on impact. Simulates the visual "focus" of a big reaction.

```ts
// Quick vignette on hard hits
this.scene.cameras.main.flash(80, 255, 255, 200);  // already in current skill

// But also vignette depth flash (different from color flash)
this.depthVignetteFlash();  // Adds radial fade behind impact, not overlay
```

### 10. RGB Split / Chromatic Aberration (super impact effect)

Temporary **RGB color shift** on critical / super hits. Common in 2D fighting games.

```ts
// On super / critical hit:
const redOffset = Phaser.Display.Math.randomInt(1, 4);
const blueOffset = Phaser.Display.Math.randomInt(-3, 0);
const cam = this.scene.cameras.main;
// cam.renderTarget?.setTextureOffset(redOffset, 0, -blueOffset, 0);
// (Or use a sprite overlay for the split effect)
```

### 11. Impact "Plop" (Nijman's \#30 - tiny positional jump)

A very fast, tiny (**2-5px**) linear push on **both** camera and impact object, not just camera shake. Nijman's talk shows this as critical for 2D physics games.

```ts
// Tiny plop jump on EVERY impact, not just kills:
const plopOffset = Phaser.Display.Math.randomInt(1, 4);
const plopX = Phaser.Display.Math.randomInt(-2, 2);
const plopY = Phaser.Display.Math.randomInt(-2, 2);

// Camera
this.scene.cameras.main.position.x += plopX;
this.scene.cameras.main.position.y += plopY;

// Impact object (if any)
if (this.impactSprite) {
  this.impactSprite.x += plopX;
  this.impactSprite.y += plopY;
}

// Quick lerp back
this.scene.tweens.add({
  targets: this.scene.cameras.main,
  x: 0, y: 0,
  duration: 30,  // Very fast, subtle
  ease: 'Back.easeOut',
});
```

### 12. Camera Lerp After Shake (Nijman's \#7)

After a big shake ends, the camera should **ease back** with a slightly over-corrected lerp. Creates a "heavy" camera feel.

```ts
// After kill shake (in the 80ms delayed callback):
this.scene.time.delayedCall(80, () => {
  // Instead of just:
  this.scene.tweens.timeScale = 1;
  
  // Add camera lerp with overcorrection
  const targetX = this.scene.cameras.main.x;
  const targetY = this.scene.cameras.main.y;
  this.scene.tweens.add({
    targets: this.scene.cameras.main,
    x: targetX, y: targetY,
    duration: 140,
    ease: 'Back.easeOut',  // Overcorrect
  });
});
```

### 13. Depth Vignette (not color flash)

**Vignette** vs **Color Flash**: Color flash is an overlay at depth 900+ (like normal Phaser graphics). Vignette is a *full-screen rectangle* that darkens the edges (like a flashlight effect).

```ts
// Create a depth 900 vignette sprite for impact:
this.impactVignette = this.add.rectangle(
  this.scene.cameras.main.width / 2,
  this.scene.cameras.main.height / 2,
  this.scene.cameras.main.width,
  this.scene.cameras.main.height,
  0x000000,
  0.08,  // Darker vignette for big hits
).setDepth(900);  // Behind main sprites

// Animate it fade out:
this.scene.tweens.add({
  targets: this.impactVignette,
  alpha: 0,
  duration: 400,
  ease: 'Power2.easeOut',
});
```

### 14. Motion Trail on Fast Projectiles

When a **fast projectile** (>=300 px/sec) creates an impact, leave a visible **1-2 frame trail**. Gives the feeling of momentum.

### 15. Speed Lines on Hard Camera Shake

When camera shake is hard (**>=0.012** intensity), add temporary **speed line overlays**. Classic anime effect.

### 16. Combo Counter Pop

If JAKESJAM tracks combos, when a hit confirms: create two quick scale pulses.

### 17. Temporal Bloom

After **3 quick consecutive hits** (within 700ms), bloom **builds up slightly** on the impact area before dissipating. Creates a "combo heat" effect.

### 18. Per-Particle Velocity Scatter

Not just random positions, but random **velocities** - simulates particles "spreading outward" from the impact like real debris.

### 19. Variable Burst Count

Natural feel: don't fire **exactly** 24 particles, fire **18-30** with slight +-/4 variance.

### 20. "Sleep Frames" on Kill (Nijman's \#11)

After a kill, the victim sprite stays in its death pose for **1 extra frame** before dissappearing. A tiny "permanence" effect.

### 21. Elasto-Kinetic Bounce (visual spring)

When a hit connects, the target **physically bounces** a few pixels back (visual only, sim still runs).

### 22. Multi-Directional Impact "Plop"

Not just camera plop, but a **multi-axis** plop.

### 23. Proportional Shake per Mass

Bigger impacts = heavier objects = different shake behavior. Use mass/size-based shake scaling.

### 24. Hit "Pop" (subtle object rotation)

The hit object **rotates slightly** on impact, then dampens back.

### 25. Variable "Feel Level" per Event

Not all events need equal juice. Use a **level budget**:

```ts
// Event-based feel levels:
const feelLevels = {
  'kill': 'heavy',  // Full juice stack
  'impact': 'medium',  // Medium stack
  'projectileSpawn': 'light',  // Light stack
  'cardPick': 'medium',
  'chaosRoll': 'light',
};

function applyFeelStack(event: string) {
  const level = feelLevels[event] || 'medium';
  switch(level) {
    case 'heavy':
      // Hit-stop + shake + burst + flash + 2SFX + kick + plop
      break;
    case 'medium':
      // Shake + burst + flash + SFX
      break;
    case 'light':
      // Burst + SFX (maybe no shake)
      break;
  }
}
```

### 26. Audio Tail Decay

Sounds don't just "stop" - they **decay** with a tail. Add 5-10% extra tail for "bigger" feel.

### 27. Frequency Ducking on Big Impact

Temporarily **duck other sounds** after a big hit to emphasize the impact.


---

## Complete Feel Effect Checklist (Nijman's 30+)

| \# | Effect | In Current | Missing | Implementation |
|---|---|---|---|---|
| 1 | **Permanence** | Partial | \u2705 | `sleepFrames` on kill |
| 2 | **Bigger Explosions** | Partial | \u2705 | `multiLayerParticles` |
| 3 | **Impact Effects** | Partial | \u2705 | `elastoKineticBounce` \+ `rotation` |
| 4 | **Screen Shake** | \u2705 | | Already done |
| 5 | **Muzzle Flash** | Partial | \u2705 | `depthVignetteFlash` |
| 6 | **Screen Freezing** | \u2705 | | Already done (`timeScale`) |
| 7 | **Camera Lerp** | Partial | \u2705 | `cameraLerp()` helper |
| 8 | **Camera Kick** | \u2705 | | Already done (`cameraKick()`) |
| 9 | **Recoil** | Partial | \u2705 | `elastoKineticBounce` |
| 10 | **Enemy Hit-Flashes** | \u2705 | | Already done (`flashRig()`) |
| 11 | **Permanent Corpses** | Partial | \u2705 | `sleepFrames` |
| 12 | **Sleep Frames** | Partial | \u2705 | `sleepFrames` implementation |
| 13 | **Knockback** | \u2705 | | Already done |
| 14 | **Speed Lines** | Partial | \u2705 | `speedLines` overlay |
| 15 | **Tweened Spawning** | \u2705 | | Already done |
| 16 | **Random Pitch** | \u2705 | | Already done |
| 17 | **Multi-Layer Particles** | Partial | \u2705 | **NEW: 3-layer approach** |
| 18 | **RGB Split** | \u274c | \u2705 | **NEW** |
| 19 | **Motion Trails** | Partial | \u2705 | **NEW** |
| 20 | **Z-Depth Fog** | \u274c | \u2705 | **NEW** |
| 21 | **Depth Vignette** | Partial | \u2705 | **NEW** |
| 22 | **Temporal Bloom** | \u274c | \u2705 | **NEW** |
| 23 | **Combo Pop** | \u274c | \u2705 | **NEW** |
| 24 | **Audio Tail** | Partial | \u2705 | **NEW** |
| 25 | **Freq Ducking** | \u274c | \u2705 | **NEW** |
| ...| ... | ... | ... | ... |

The **core missing pieces** are:
- Multi-layer particle bursts (Nijman's explicit 3 types)
- Per-particle velocity-based scatter
- RGB chromatic aberration on critical hits
- Temporal bloom "heat" buildup
- Z-depth fog/vignette
- Elasto-kinetic bounces
- More natural variable burst counts

### High Priority for JAKESJAM

Given JAKESJAM's aesthetic (dark \+ cyan, 1v1 shooter), prioritize:

1. **Multi-layer particles** - Critical for the "explosive" feel
2. **Elasto-kinetic bounce** - Adds weight, easy to implement  
3. **Camera lerp after shake** - Heavy camera feel, simple
4. **RGB split on super hits** - Stylistic, matches cyberpunk theme
5. **Motion trails on fast projectiles** - Adds speed feel
6. **Z-depth vignette** - Adds depth perception
7. **Variable burst count** - Naturalizes particle systems
8. **Temporal bloom** - Combo feel
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
│ **Multi-layer burst (inner/middle/outer)** │ `layer.burstAt(x, y, ...).explode(count)` on 3 separate types │ Big impact kills/chaos swaps │ 3x particle budget │
│ **Multi-layer burst (per-particle velocity)** │ `speedY: -vel.length() * 0.5` (opposite direction of incoming) │ Same - with more realistic outward spread │ See Nijmans 3-Layer Pattern │
| **Stagger reveal** | `tweens.add` with `delay: i * 80` per element | Card draft, results overlay | The juice that sells "intentional design" — see existing recipe in this SKILL.md |
| **Banner pop** | `setScale(1.3)` + `tween` to `1.0` with `Back.easeOut` | Round start, level intro | Existing recipe in this SKILL.md |

**Anti-pattern from JAKESJAM history:** stacking shake calls. `cam.shake(60, 0.004)` issued every frame during a hit-streak compounds; intensity grows until the camera looks broken. Fix: `if (cam.shakeEffect?.isRunning) return;`. Apply same guard pattern to flash/fade/zoom.


## Multi-Layer Particle Burst API (Nijman's 3-Category Approach)

For big impacts, use 3-tier layering: **inner sparks** (fast, white-hot) → **middle smoke** (medium) → **outer debris** (slow).

### The `burstAt()` API

The current `ParticlePool.burstAt()` already works, but follow Nijman's layering pattern:

```ts
// Inner: Fast, white-hot sparks (0.3–0.5s lifetime)
const inner = this.particles.burstAt(x, y, {
  key: 'spark_inner_1x1',  // 16×16 PNG or atlas
  count: 16,
  speed: { min: 180, max: 360 },
  lifetime: 300,
  scale: { start: 0.8, end: 0.4 },
  tint: 0xffffff,
  blendMode: 'ADD',
  emitting: false,  // Explode will emit once
});
inner.explode(16, { speed: 200, spread: 270, maxDist: 60, quantity: 16 });

// Middle: Smoke/steam (optional, 0.8–1.2s)
if (impactSeverity > 1) {
  const middle = this.particles.burstAt(x, y, {
    key: 'smoke_particle',
    count: 24,
    speedY: 40,  // Upward drift
    lifetime: 800,
    fade: { start: 1, end: 0 },
    tint: 0xaaaaaa,
  });
  middle.explode(24, { speed: 40, spread: 270, maxDist: 100, quantity: 24 });
}

// All combined in one burst call (simpler):
this.particles.burstAt(x, y, {
  layers: ['inner', 'middle'],  // or ['inner', 'middle', 'outer'] for big hits
  elementColor: victim.weapon.element,
  rotation: true,
  velocityDamp: 0.7,
});
`


### The `burstAt()` API — per-particle velocity scatter (most realistic)

```ts
// Per-particle velocity scatter:
const incomingVel = projectile.velocity;
const incomingMag = incomingVel.length();

this.particles.burstAt(x, y, {
  key: 'debris',
  speedY: { min: -incomingMag * 0.3, max: incomingMag * 0.8 },
  speedX: { min: incomingMag * 0.1, max: incomingMag * 0.6 },
  speedYDirection: -1,  // Mostly upward on impact
  lifetime: 800,
  scale: { start: 0.4, end: 0.1 },
  blendMode: 'ADD',
  emitting: false,
}).explode(24, {
  speed: incomingMag * 0.4,
  spread: 270,
  maxDist: incomingMag * 1.5,
  quantity: 24,
});
```

**Key insight from Nijman:** Real debris "spreads opposite" to where the impact came from.
Use the incoming projectile's velocity to orient the burst's outward spread. This feels
much more physical than random position-only scatter.


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
---
name: game-sim-determinism
description: >
  Rules for the shared simulation in client/src/sim/ (imported as @sim/) that
  runs identically on the Bun server and the Phaser client. Use when editing
  any file under sim/ — World, World.step, collision, combat, projectile,
  player, weapon, fire, pickup, satellite, round, rng, types, constants,
  destructible — or anywhere "deterministic", "RNG", "seed", "rollback",
  "shared sim", "client/server parity", or "prediction divergence" comes up.
---

# Shared Simulation & Determinism

The `@sim/` package is the **only** code path allowed to mutate authoritative game state. Both the Bun server (`server/src/matchHost.ts`) and the Phaser client (`client/src/net/clientLoop.ts`) import the same `World` and call `World.step(input, dt)`. If they ever produce different output for the same inputs, **client prediction will visibly snap** every snapshot.

The bar here is **soft determinism**: same RNG seed + same input sequence + same starting state ⇒ same world state on both sides, within float epsilon. We're not doing cross-platform hard determinism (lockstep) — the server is authoritative and corrects drift on every snapshot.

## What "shared" means

- `client/src/sim/` is the source of truth. The server reaches it via the `@sim/` TS path alias (see `tsconfig.json`).
- **Sim files import nothing outside `@sim/` and `@msgpack/msgpack`** — no Phaser, no DOM, no `fetch`, no `convex`. If you need to import any of those, you're in the wrong layer.
- `@sim/types.ts` defines wire-relevant types (`WorldState`, `InputFrame`, `SimEvent`, `Tick`, `InputSeq`). Touching these is a wire-protocol change — bump `PROTOCOL_VERSION`.

## The determinism rules

1. **Seeded RNG only.** Use `@sim/rng.ts` (mulberry32 / xoshiro). **Never** `Math.random` inside `@sim/`. The server sends `rngSeed` in `ServerHello`; client seeds its predicted World with the same value.
2. **No wall clock.** Don't read `Date.now()`, `performance.now()`, or `new Date()` inside the sim. Time is `tick * STEP_MS`, full stop.
3. **Fixed step.** `World.step` takes `dt` for compat but should treat it as `STEP_MS`. Variable dt breaks parity. Clamp/quantise inputs at the loop boundary, not inside the sim.
4. **Stable iteration order.** `Map`/`Set` insertion order is deterministic in V8/Bun, but only as long as you don't delete then re-add. For player lists, sort by `playerId` before iterating any logic that depends on order (e.g. tie-breaking).
5. **No floating-point platform drift assumptions.** The same JS engine on client (V8) and server (JSC, via Bun) is **mostly** the same for IEEE-754 ops, but trig and `Math.pow` can vary. Avoid them in tight authoritative paths or reconcile via snapshot anyway. Server is authoritative — drift is acceptable, just keep it small enough that prediction looks smooth.
6. **No mutation outside `World`.** Sim entities are owned by `World`. A function in `combat.ts` doesn't return a new entity it created — it asks the World to spawn one. This keeps "what changed" auditable for snapshot/event generation.
7. **Events are explicit.** Side effects that the renderer cares about (hit flash, death, pickup) are pushed onto `SimEvent[]` and shipped in the snapshot. Don't infer "a hit happened" by diffing HP — race conditions and missed events are exactly what `events` exists to prevent.

## RNG patterns

```ts
// @sim/rng.ts exposes a stateful generator
const rng = createRng(seed);
const dmg = baseDamage + rng.range(0, 5);   // ✓ deterministic
const dmg = baseDamage + Math.random() * 5; // ✗ desync source
```

When forking RNG (e.g. one stream per round, or one per entity for independent randomness), seed each stream from a hash of `(parentSeed, streamId)`. Don't share one rng across rounds if you ever rewind a round.

## Tests

- `client/src/sim/__tests__/` runs with `bun test`. Sim tests should be **deterministic** by definition — the same inputs always produce the same outputs.
- Snapshot a `World` after N ticks of canned inputs and assert byte equality (msgpack-encoded `WorldState`) across runs. Any test flakiness here = a determinism bug, not a flaky test.
- A "parity" test that runs the same input log through two `World` instances (one created from a serialised snapshot, one from scratch) is gold for catching state-not-fully-captured bugs.

## When to break determinism (rarely)

Cosmetic-only randomness that the renderer owns is fine outside the sim — particle jitter, screen-shake offsets, idle-anim timing. These never feed back into gameplay state, so they don't need to match between peers.

## Anti-patterns (don't do these)

- ❌ `Math.random()` anywhere under `client/src/sim/`. CI should have a grep gate for this.
- ❌ `performance.now()` / `Date.now()` in sim. Use `tick`.
- ❌ Importing Phaser types into `@sim/`. The sim must be runnable by Bun with no DOM.
- ❌ Hidden async (`await`, microtasks) inside `World.step`. The sim is synchronous.
- ❌ Mutating `WorldState` from outside the World methods. Snapshot diffing depends on the World being the only mutator.
- ❌ Adding fields to `WorldState` without updating `protocol.ts` on both sides and bumping `PROTOCOL_VERSION`.

## Ref## References (KOLs / sources) - Lighting & Glows

- **Flat 2D Lighting** — Sprite-based glow, not postFX:
  [`game-lighting-flats/SKILL.md`](./game-lighting-flats/SKILL.md)
- **Multi-Layer Particle Bursts** — 4-layer (core, ring, spark, smoke):
  [`game-particle-systems/SKILL.md`](./game-particle-systems/SKILL.md)
- **Dynamic Power/Color Mapping** — 70% → 100% energy visualization:
  [`game-color-dynamics/SKILL.md`](./game-color-dynamics/SKILL.md)
- **Render Pipeline** — Depth 900 light sprites, 5-15ms total budget:
  [`game-render-pipeline/SKILL.md`](./game-render-pipeline/SKILL.md)

References (original KOLs for 2D glow):
- **Unity/Unreal 2D glow tutorials** — Sprite layer approach
- **Reference images:** `ref images/rounds/` (glow rings, energy trails, particle cores)

## The three pillars (don't break these)

1. **Server is authoritative.** It runs the only true `World`. Client predicts forward from the last acked snapshot using the same `@sim/` code, but server state always wins on reconciliation.
2. **Inputs go up, snapshots come down.** Client never tells the server "I'm at x,y" — it sends `{seq, tick, keys, aimX, aimY, dt}`. Server replies with `Snapshot{ tick, lastProcessedInputSeq, state, events }`.
3. **Fixed tick.** `STEP_MS` (≈16.67ms for 60Hz) is the same constant on both sides. Snapshots ship every `SNAPSHOT_INTERVAL_TICKS` (typically 2–3 ticks → 20–30Hz on the wire).

## Wire protocol

- msgpack-encoded with a **1-byte version prefix** (`PROTOCOL_VERSION`). Bump the version when message shapes change; both sides must reject mismatched versions in the hello handshake.
- `client/src/net/protocol.ts` and `server/src/protocol.ts` MUST stay byte-identical. If you change one, change the other in the same commit.
- Inputs are a **bitmask** (`keys: number`) — packing 8 buttons into a byte beats `{up, down, left, right, ...}` objects on both bandwidth and GC.
- Snapshots currently ship full `WorldState`. The codec is structured as a drop-in for delta encoding once the sim stabilises — keep the `baseline: Tick | null` field; senders set `null` for keyframes, receivers reject deltas whose baseline they no longer have.

## Client prediction & reconciliation

- Every input the client sends gets a monotonically increasing `seq`. Client also applies the input **immediately** to its local `World` and stores the input in a ring buffer keyed by `seq`.
- On every snapshot:
  1. Find `lastProcessedInputSeq[myPlayerId]`.
  2. Replay all inputs with `seq > lastProcessedInputSeq` against the snapshot's authoritative state.
  3. The result is the new predicted state. Any visible "snap" means prediction diverged — log it but don't paper over it; root-cause is almost always sim non-determinism (see `game-sim-determinism`).
- Discard inputs older than `lastProcessedInputSeq` from the buffer. The buffer's max size is your worst-case RTT in ticks; ~60 entries (1s @ 60Hz) is plenty.

## Snapshot interpolation (remote entities)

- **Local player is predicted, never interpolated.** Drawing the local player at `now - 100ms` feels like input lag.
- **Remote players are interpolated** ~100ms behind server time — render them between two known snapshots (`client/src/net/interpolationBuffer.ts`). This is the trade Fiedler describes: a fixed visual delay buys you smoothness despite jitter.
- If you only have one snapshot ahead, **extrapolate at most 1 tick** then freeze. Long extrapolation looks like teleporting.

## Lag compensation (hit detection)

- The server already does this in `server/src/matchHost.ts`: when processing a fire input from tick `T`, **rewind every other player's position to tick T** for the spawn frame, then resume.
- Hard-cap rewind at `LAG_COMP_MAX_MS = 250` (≈15 ticks). Anything more is suspect — clamp, don't trust.
- The shooter is **not** rewound. They fire from where they are now (matches their predicted client view).
- Maintain a per-player position ring buffer of `POSITION_HISTORY_CAPACITY = 32` (≈ cap + headroom for interpolation between adjacent samples).

## Bun WebSocket server specifics

- Use Bun's native `Bun.serve({ websocket: { ... } })` — not the `ws` npm package. Bun's binding is ~6× faster on raw throughput.
- **Disable `perMessageDeflate`** for the gameplay socket. msgpack frames are small and frequent; per-message deflate adds CPU and latency for negligible bandwidth savings.
- Topics for fan-out: `ws.subscribe(matchId)` on join, then `server.publish(matchId, encoded)` for the snapshot broadcast. One serialise, N sends.
- Watch `ws.send`'s return value: `-1` means backpressure — don't queue snapshots, drop the oldest pending and send the newest. Old snapshots are useless.
- One `MatchHost` per match per process is fine for prototype scale. Multiple processes need a Convex/Redis matchmaker hand-off (matchmaker writes which Fly machine owns the match; client reconnects there).

## Anti-patterns (don't do these)

- ❌ Sending player position from client to server. Inputs only.
- ❌ Running the sim from `requestAnimationFrame` on the client. Use a fixed-step accumulator (see `game-loop-perf`); rAF is for rendering.
- ❌ `JSON.stringify` on the wire. msgpack only. JSON allocates strings on every frame.
- ❌ `perMessageDeflate: true` for binary frames. Test with it off first.
- ❌ Treating Convex as a snapshot bus. Convex is **lobby/match metadata only** (see `AGENTS.md` "Multiplayer Boundary"). The 60Hz path is direct WS.
- ❌ Trusting client-reported tick or aim past sanity bounds. Server clamps `dt`, validates `tick` is in a recent window, ignores wildly old inputs.
- ❌ Letting `lastProcessedInputSeq` go backwards. It's monotonic per player; treat any regression as a bug or attack.

## Debug toggles to keep around

- A `?fakelag=120` URL param that delays outbound inputs by N ms — invaluable for catching prediction bugs.
- A `?dropPct=5` that drops 5% of outbound packets randomly.
- A server-side `--snapshot-fullstate` flag to disable delta encoding when chasing desync bugs.

## References (KOLs / sources)

- [Glenn Fiedler — Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- [Glenn Fiedler — Deterministic Lockstep (why we don't use it)](https://gafferongames.com/post/deterministic_lockstep/)
- [Glenn Fiedler — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [Game Networking Resources (curated by Fiedler)](https://github.com/gafferongames/GameNetworkingResources)
- [Bun WebSockets — official docs](https://bun.sh/docs/api/websockets)
- [SnapNet — Snapshot Interpolation walkthrough](https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/)
---
name: game-loop-perf
description: >
  Frame-budget and GC discipline for JAKESJAM's hot paths. Use when working
  on the game loop, sim step, render sync, particle systems, or anywhere
  perf matters: requestAnimationFrame, setInterval, fixed timestep,
  accumulator, allocation, garbage collection, jank, jitter, stutter, FPS,
  frame time, object pool, ring buffer, TypedArray, SoA/AoS, hot loop, V8
  hidden classes, profiling, DevTools Performance panel. Trigger on words
  like "slow", "drops frames", "stutter", "GC pause", "memory growing".
---

# Game Loop & Hot-Path Performance

60 FPS = **16.67 ms** total frame budget. Realistic split for JAKESJAM:

- Sim step (client prediction): ≤ 4 ms
- Render sync (Phaser GameObject updates): ≤ 4 ms
- Phaser internal render: ≤ 6 ms
- Headroom for GC, network, audio: ≤ 2 ms

A single 5 ms GC pause at 60 Hz drops a frame. The whole goal is to **never allocate during a tick**.

## Fixed timestep (Fiedler's "Fix Your Timestep")

Render at the display's refresh rate; step the sim at a fixed rate independent of it. The accumulator pattern:

```ts
let acc = 0;
const STEP_MS = 1000 / 60;

function frame(now: number) {
  const dt = Math.min(now - last, 250); // clamp the spiral of death
  last = now;
  acc += dt;
  while (acc >= STEP_MS) {
    world.step(STEP_MS);
    acc -= STEP_MS;
  }
  const alpha = acc / STEP_MS;        // for visual interpolation
  render(world.state, alpha);
  requestAnimationFrame(frame);
}
```

Why this matters here: server uses the same `STEP_MS`. Client prediction is only consistent with the server if both step the same size. If you ever pass a variable `dt` to `world.step`, **prediction will drift**.

Clamp the dt input (250 ms above) so a hidden tab waking up doesn't try to simulate a minute of game time.

## Allocation discipline (the real win)

What allocates per frame and how to kill it:

| Pattern | Why bad | Fix |
|---|---|---|
| `const v = { x, y }` in update | object allocation | scratch object or `Float32Array` slot |
| `arr.map(...)` / `arr.filter(...)` | new array + closures | classic `for (let i = 0; i < n; i++)` |
| `arr.forEach(cb)` | closure allocation per call site over hot data | `for` loop |
| `[...arr]` / `arr.slice()` | copy | iterate in place; use a fixed scratch array |
| `JSON.parse/stringify` on net frames | strings everywhere | msgpack with reused buffer |
| `new Vector2()` for math | allocation | reuse a module-scoped `_scratch` Vector2 |
| `Map<id, …>` keyed by entity in a tight loop | hash overhead | dense array indexed by entity id (SoA) |
| `setInterval` for sim | drift + can't sync to render | accumulator above |

## Object pools (the right way)

Required for: projectiles, particles, hit results, damage numbers, spawn flashes, anything that fires more than once per frame.

```ts
class Pool<T> {
  private free: T[] = [];
  constructor(private make: () => T, private reset: (t: T) => void, prealloc = 64) {
    for (let i = 0; i < prealloc; i++) this.free.push(make());
  }
  acquire(): T { return this.free.pop() ?? this.make(); }
  release(t: T): void { this.reset(t); this.free.push(t); }
}
```

Rules:
- **`reset` must zero everything.** The pool's whole point is preventing stale state across acquires.
- **Pre-allocate to peak.** `prealloc` should be your worst-case in-flight count. Pool growth is fine, pool shrink isn't worth it.
- Don't pool tiny things (numbers, single sprites) — overhead exceeds benefit.

## Structure-of-arrays for entity-heavy systems

For systems with hundreds of entities (projectiles, particles, debris):

```ts
const N = 4096;
const posX = new Float32Array(N);
const posY = new Float32Array(N);
const velX = new Float32Array(N);
const velY = new Float32Array(N);
const alive = new Uint8Array(N);
```

CPU cache loads contiguous floats per system. Iteration is `for (let i = 0; i < N; i++)` over `posX[i] += velX[i] * dt`. This is exactly how bitECS (and Phaser 4 internally) lays things out.

For player/sim entities (count < ~50) the AoS object form is fine — readability wins over the marginal cache benefit.

## Profiling — what to actually do

- **Chrome DevTools → Performance → Record** for ~5 seconds of gameplay. Look for:
  - **Yellow GC bars in the timeline** — every one is a hitch. Click into the call tree to find the allocator.
  - **Long Task warnings** (>50 ms) — usually first frame after asset load or scene transition.
  - **Scripting time vs Rendering time** ratio. Scripting > 8 ms per frame → look at sim or render-sync.
- **`performance.measure`** around `world.step` and around the snapshot-render sync. Log p50/p95 every 5 s. Numbers beat vibes.
- **Don't trust Lighthouse** for game perf — it measures load, not steady-state frames. The Performance panel is the truth.
- Run with `--enable-precise-memory-info` and watch `performance.memory.usedJSHeapSize`. Steady-state should be flat. Sawtooth = you're allocating per frame; the slope is the rate.

## Anti-patterns (don't do these)

- ❌ `requestAnimationFrame` driving `world.step` directly with a variable dt. Drifts vs. server.
- ❌ Closures inside `update`/`step` (e.g. `players.forEach(p => …)` referencing locals). The closure allocates.
- ❌ Polling `performance.now()` repeatedly inside a frame. Sample once at the top.
- ❌ Spawning a new `Phaser.GameObjects.Sprite` per projectile. Pool them.
- ❌ Treating GC as "the runtime's problem". On 60 Hz games it is your problem.
- ❌ Optimising before measuring. Take a profile first; the bottleneck is rarely where you guess.

## References (KOLs / sources)

- [Glenn Fiedler — Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/)
- [Robert Nystrom — Game Loop pattern](https://gameprogrammingpatterns.com/game-loop.html)
- [web.dev — Static Memory JavaScript with Object Pools (V8 team)](https://web.dev/speed-static-mem-pools/)
- [Aleksandr Hovhannisyan — Performant Game Loops in JavaScript](https://www.aleksandrhovhannisyan.com/blog/javascript-game-loop/)
- [Phaser Performance Optimization Guide](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide)
---
name: combat-balance-ttk
description: >
  Time-to-kill, weapon archetype matrix, dodge windows, parry timing,
  damage curves. Use when editing client/src/sim/data/weapons.ts,
  weaponBuild.ts, sim/combat.ts, or sim/constants.ts. Also use when
  reviewing chaos modifiers that change damage, RPS, or hitboxes —
  they must keep TTK inside the band.
version: 1.0.0
---

# Combat Balance & TTK

## Why this skill exists

JAKESJAM is a 1v1-first arena shooter pivoting to N-player. Every
new card, weapon, or chaos modifier shifts the time-to-kill (TTK)
curve. Without a stated TTK target, balance becomes "whoever shipped
the last weapon gets to feel powerful". Halo, Quake, and the FGC
have already settled this argument: pick a TTK band, defend it,
and *every* weapon must justify itself against the band.

## The hard line

**1v1 TTK target band: 1.8s – 3.5s at neutral range. Any weapon or
card that pushes the median TTK outside this band is broken until
proven otherwise. No "instakill" weapons. No "tickle" weapons. No
exceptions for "fun" — fun is what TTK enables.**

## What the KOL says

**Jaime Griesemer, "30 seconds of fun"** — Halo lead designer,
Bungie. The phrase came out of the GDC 2002 talk *The Illusion of
Intelligence: AI and Level Design in Halo* (with Chris Butcher) and
got canonised in the Halo 2 behind-the-scenes documentary:

> "In Halo 1, there was maybe 30 seconds of fun that happened over
> and over and over again, so if you can get 30 seconds of fun, you
> can pretty much stretch that out to be an entire game."
> — Jaime Griesemer

Two implications JAKESJAM must honour:
1. The 30-second loop is *engagement → flank → reposition → engage*.
   If the TTK is too short the loop collapses to "die first, lose".
   If too long, the loop stretches past 30s and players disengage.
2. Every weapon must be evaluable inside *one* engagement. Weapons
   whose value is "useful in the next fight" (e.g. status DoT that
   only matters in 8s) are second-class.

**David Sirlin, "Playing to Win"** — Street Fighter HD Remix designer.
Sirlin's chapter "Balance Theory" introduces the *paper-rock-scissors
test*: every viable strategy must have at least one strategy that
beats it. Single-strategy dominance ("scrub strategies") destroys
competitive depth.

> "If a strategy has no counter, the metagame collapses to that
> strategy. Add the counter, or remove the strategy."
> — Sirlin, Playing to Win, ch. "Balance Theory"

## How JAKESJAM applies it

Concrete files:

- `client/src/sim/data/weapons.ts` — base weapon defs (DPS, RPS,
  spread, projectile speed). Constrained by the TTK band.
- `client/src/sim/data/weaponBuild.ts` — applies cards. The unit
  test boundary for "this combo breaks TTK".
- `client/src/sim/combat.ts` — damage application, parry/shield
  resolution. Defines the dodge window via projectile speed +
  player accel.
- `client/src/sim/constants.ts` — `PLAYER_BASE_HP`,
  `PARRY_WINDOW_MS`, `SHIELD_DURATION_MS`. These are the levers.
- `client/src/sim/data/chaosModifiers.ts` — modifiers like
  `golden-gun` (1-shot kill) violate the band by design. They are
  *temporal* (one round) and clearly signposted; not the default
  experience.

`PLAYER_BASE_HP = 100` is the anchor. A weapon doing 30 dmg/shot at
3 RPS = 1.1s TTK ⇒ too fast. Same weapon at 2 RPS = 1.7s ⇒ at the
edge. 25 dmg/shot at 3 RPS = 1.3s ⇒ still too fast. 25 at 2 RPS =
2.0s ⇒ in band.

## Recipes

### 1. Compute TTK as a derived constant in the data file

```ts
// client/src/sim/data/weapons.ts
import { PLAYER_BASE_HP } from '../constants';

export type WeaponDef = {
  id: WeaponId;
  damagePerShot: number;
  shotsPerSecond: number;
  // ... pathing, shape, etc.
};

export function neutralTTK(w: WeaponDef): number {
  return PLAYER_BASE_HP / (w.damagePerShot * w.shotsPerSecond);
}

// Asserted in tests:
//   for (const w of WEAPONS) {
//     expect(neutralTTK(w)).toBeGreaterThanOrEqual(1.8);
//     expect(neutralTTK(w)).toBeLessThanOrEqual(3.5);
//   }
```

Add the assertion in `client/src/sim/__tests__/weaponBuild.test.ts`.
Any new weapon outside the band fails CI.

### 2. The archetype matrix (Sirlin's RPS test)

The MVP has 4 weapon paths (`AGENTS.md`). Lock them as a
deliberate paper-rock-scissors:

| Archetype | Strong vs   | Weak vs      | TTK target |
| --------- | ----------- | ------------ | ---------- |
| Rapid     | Heavy       | Burst        | 2.0s       |
| Heavy     | Burst       | Rapid (kite) | 2.4s       |
| Burst     | Rapid       | Heavy (miss) | 1.9s       |
| Control   | All (zone)  | Direct DPS   | 3.2s       |

Every card must declare which archetype it pushes the build toward
(`tag` in `cards.ts`). The matrix is the single source of truth in
`docs/jakesjam-design-pillars.md` — update both files together.

### 3. Dodge window must exceed reaction time

Human reaction to a visual stimulus floors at ~200ms (the literature
hovers 200–250ms for trained shooter players). Projectiles in
JAKESJAM must give the target ≥ 250ms between *visible spawn* and
*impact* at neutral range (16 tiles). Below that, the game stops
being a duel and becomes hitscan roulette.

```ts
// client/src/sim/__tests__/weapon.test.ts
test('every projectile is dodgeable at neutral range', () => {
  for (const w of WEAPONS) {
    const distance = NEUTRAL_RANGE_TILES * TILE_SIZE;
    const timeToImpact = distance / w.projectileSpeed;
    expect(timeToImpact).toBeGreaterThanOrEqual(0.25);
  }
});
```

### 4. Parry/shield as a deliberate counter, not an escape

`PARRY_WINDOW_MS` should sit in the 120–180ms range. Below 120ms it's
muscle-memory only (no skill ceiling for newcomers). Above 180ms it
becomes the dominant strategy and the game devolves to "hold parry".

```ts
// client/src/sim/constants.ts
export const PARRY_WINDOW_MS = 150;        // Sirlin: "make the optimal play hard but learnable"
export const PARRY_COOLDOWN_MS = 1200;     // Hard cooldown. No spamming.
export const SHIELD_DURATION_MS = 600;     // Shorter than TTK by half — never a get-out-of-jail card
```

### 5. Per-card TTK regression test

Every card mutation goes through `createWeaponBuild`. Test the worst-
case (best-case for the picker) combo:

```ts
// client/src/sim/__tests__/weaponBuild.test.ts
test('no card combo lets a weapon breach 1.5s TTK', () => {
  for (const w of WEAPONS) {
    for (const c1 of CARDS) for (const c2 of CARDS) for (const c3 of CARDS) {
      if (c1 === c2 || c2 === c3 || c1 === c3) continue;
      const build = createWeaponBuild(w, [c1, c2, c3]);
      expect(neutralTTKBuild(build)).toBeGreaterThanOrEqual(1.5);
    }
  }
});
```

The hard floor is 1.5s (not 1.8s) because card stacking is the
*reward* for winning the draft; allow a 0.3s squeeze, not a free
instakill.

### 6. Chaos modifiers signposted as out-of-band

```ts
// client/src/sim/data/chaosModifiers.ts
export type ChaosModifier = {
  id: ChaosModifierId;
  ttkBandViolation: boolean;   // explicit declaration
  // ...
};

// In the round banner:
if (modifier.ttkBandViolation) {
  banner.show(`CHAOS: ${modifier.label} (extreme TTK)`, 0xff3333);
}
```

Players need to *know* the round is wild. Quiet rule changes are the
#1 perceived-unfairness driver in arena PvP.

## Anti-patterns

- **Adding a "+50% damage" card.** It always picks. Always
  dominates. It violates the matrix. Do not ship.
- **A weapon whose dodge window is < 250ms at neutral range.**
  Hitscan roulette. Players blame the netcode. Netcode isn't the
  problem.
- **Parry window > 200ms.** Optimal play becomes "hold parry,
  punish on whiff". The game becomes a parry-fishing simulator.
- **Adding a 5th archetype "for variety" before the 4 are tuned.**
  Sirlin: tighten the matrix before widening it.
- **Treating chaos modifiers as the default tuning lever.** They
  are exceptions. The base game must sing without any modifier on.
- **Per-weapon balance in isolation.** Balance the *matrix*, not
  the cell. A buff to Rapid implies a re-look at Heavy and Burst.
- **Letting `WeaponSystem.ts` (render layer) compute damage.**
  Damage lives in `sim/combat.ts`. Render shows the number, never
  decides it.

## Pre-flight checklist

- [ ] `neutralTTK(w)` test passes for every weapon in the band.
- [ ] Every card's worst-case stack tested against the 1.5s floor.
- [ ] Every projectile has ≥250ms dodge window at neutral range.
- [ ] `PARRY_WINDOW_MS` is between 120 and 180.
- [ ] `SHIELD_DURATION_MS < neutralTTK(slowestWeapon) * 1000 / 2`.
- [ ] The 4 archetypes still fit the RPS matrix after the change.
- [ ] Chaos modifiers that violate TTK are flagged and the banner
      warns the player.
- [ ] No new card grants flat unconditional damage with no
      counterplay.
- [ ] `docs/jakesjam-design-pillars.md` updated if the matrix
      shifted.

## Source

- Jaime Griesemer / Chris Butcher, "The Illusion of Intelligence:
  AI and Level Design in Halo" — GDC 2002. Catalog entry referenced
  in: https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- Half-Minute Halo interview (Engadget, 2011, the canonical source
  for the "30 seconds of fun" quote):
  https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- David Sirlin, "Playing to Win: Becoming the Champion" — full text
  https://www.sirlin.net/ptw — chapter "Balance Theory" especially.
---
name: game-feel-juice
description: >
  Hit-stop, screen shake, knockback, particle bursts, kickback, camera lerp,
  depth vignette, elasto-kinetic bounce, RGB split, motion trails, tempoal bloom,
  variable burst count, multi-layer particles (inner/middle/outer), speed lines,
  combo pop, impact plop, hit rotation, frequency ducking, audio tail, per-particle
  velocity scatter. Use when editing client/src/game/systems/ParticlePool.ts,
  StatusVfxController.ts, WeaponSystem.ts, or any time a JAKESJAM weapon
  "feels weak", a death feels mushy, or a card pick has no payoff. Render-layer
  only — never touches the deterministic sim.
version: 1.0.1
---

# Game Feel & Juice

## Why this skill exists

JAKESJAM's projectiles, deaths, and card-draft pops all currently fire
through the same generic particle pool. Without a deliberate juice
budget the game reads as "deterministic numbers moving on a screen".
The sim is locked (it must stay deterministic — see
`game-sim-determinism`), so 100% of feel work happens in
`client/src/game/` render+VFX code. This skill encodes Vlambeer's and
Swink's rules so that every hit, kill, draft, and chaos-modifier swap
has a layered, repeatable juice signature.

## The hard line

**Every meaningful event gets at least three of: hit-stop, screen
shake, particle burst, knockback, sound, color flash, scale punch.
One channel alone is never enough. None of it lives in `client/src/sim/`.**

## What the KOL says

**Jan Willem Nijman, "The Art of Screenshake"** (Vlambeer, INDIGO Classes
2013, ~30 min). Nijman's live demo of *Super Crate Box* turns a
flat-feeling shooter into Nuclear-Throne-grade juice by adding 30+
layered effects one at a time. The recurring pattern:

> "Every action needs reaction. Bigger reactions for bigger actions."
> — Nijman, Art of Screenshake (timestamp ~12:00)

His demo's checklist (verbatim ordering from the talk):
permanence → bigger explosions → impact effects → screen shake →
muzzle flashes → screen freezing (hit-stop) → camera lerp → camera
kick → recoil → enemy hit-flashes → permanent corpses → sleep frames
on kill → knockback → speed lines → tweened spawning → random
pitch on SFX.

**Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
Sensation"** (Morgan Kaufmann, 2008). Chapter 9 ("The Feel of Polish")
calls these layered cues "polish stack" and argues you cannot evaluate
any one of them in isolation — only the stack matters.

## How JAKESJAM applies it

Concrete files:

- `client/src/game/systems/ParticlePool.ts` — owns particle burst
  budgets. Every weapon impact passes through here.
- `client/src/game/systems/StatusVfxController.ts` — owns flashes,
  scale punches, color tints on `PlayerEntity` rigs.
- `client/src/game/systems/WeaponSystem.ts` — owns kickback (visual
  only — the sim's weapon spread/recoil already runs in
  `sim/weapon.ts`).
- `client/src/game/systems/AudioSystem.ts` — owns pitch jitter,
  layered SFX.
- `client/src/game/scenes/MatchScene.ts` / `OnlineMatchScene.ts` —
  owns camera shake via `this.cameras.main.shake(...)`.
- `client/src/game/ui/CardDraftOverlay.ts` — drafting picks need
  juice too. A card click without a screen kick is a wasted moment.

The boundary is hard: `StepResult` from the sim emits *events*
(`projectileImpacted`, `playerKilled`, `cardSelected`, `chaosRolled`).
The render layer reads those events and runs the juice stack. The sim
never knows shake or hit-stop happened.

## Recipes

### 1. The "kill stack" — every player death

```ts
// client/src/game/systems/StatusVfxController.ts
onPlayerKilled(victimId: PlayerId, killerId: PlayerId | null) {
  // 1. Hit-stop (visual freeze of render only — sim keeps ticking)
  this.scene.tweens.timeScale = 0;
  this.scene.time.delayedCall(80, () => { this.scene.tweens.timeScale = 1; });

  // 2. Screen shake — bigger for kills than impacts
  this.scene.cameras.main.shake(180, 0.012);

  // 3. Particle burst — chunky, color-matched to victim element
  this.particles.burstAt(victim.x, victim.y, {
    count: 24, speedRange: [180, 360], lifetime: 600,
    tint: elementColors[victim.weapon.element],
  });

  // 4. Color flash on victim rig (1 frame white, then fade)
  this.flashRig(victimId, 0xffffff, 60);

  // 5. Audio: layered low boom + high "tink", random pitch ±10%
  this.audio.play('kill_boom', { rate: 0.95 + Math.random() * 0.1 });
  this.audio.play('kill_tink', { rate: 0.95 + Math.random() * 0.1 });

  // 6. Knockback on the killer's camera (subtle — they did the kill)
  if (killerId === this.localPlayerId) {
    this.cameraKick(0, -8, 120);
  }
}
```

### 2. Hit-stop on projectile impact (render-only)

Hit-stop in JAKESJAM CANNOT pause the sim — the sim is authoritative
and shared. Pause only the *render* tween clock and post-processing
shaders. The sim keeps ticking; players keep moving; only the impact
visual freezes.

```ts
// On `projectileImpacted` event:
const stopMs = projectile.damage > 30 ? 50 : 25;
this.tweens.timeScale = 0;
this.scene.time.delayedCall(stopMs, () => { this.tweens.timeScale = 1; });
```

### 3. Camera shake budget

Per the talk, shake gets noisy fast. Use one bus and clamp:

```ts
// client/src/game/systems/CameraShakeBus.ts (create if missing)
shake(intensity: number, durationMs: number) {
  const cam = this.scene.cameras.main;
  // Don't restart shake — extend amplitude only if larger.
  const current = cam._shakeAmplitude ?? 0;
  if (intensity <= current) return;
  cam.shake(durationMs, intensity);
}
```

Buckets: `0.004` (footstep), `0.008` (impact), `0.012` (kill),
`0.020` (chaos modifier swap), `0.030` (round end). Anything above
`0.030` makes the player nauseous.

### 4. Card-draft punch

`CardDraftOverlay` currently fades cards in. Add Nijman's "tweened
spawning" + a kickback on confirm:

```ts
// client/src/game/ui/CardDraftOverlay.ts
spawnCard(card: CardDef, slotIndex: number) {
  const sprite = this.add.image(...).setScale(0.6).setAlpha(0);
  this.scene.tweens.add({
    targets: sprite,
    scale: 1, alpha: 1,
    delay: slotIndex * 60,             // staggered, not simultaneous
    duration: 180,
    ease: 'Back.easeOut',              // overshoot — Nijman pattern
  });
}

onConfirmCard(card: CardDef) {
  this.scene.cameras.main.shake(120, 0.010);
  this.scene.cameras.main.flash(80, 255, 255, 200, false);
  this.audio.play('card_pick', { rate: 0.9 + Math.random() * 0.2 });
}
```

### 5. Knockback on hit (visual only)

Sim knockback exists in `sim/combat.ts` (positions are authoritative).
Render layer adds a *visual-only* spring on the rig — the visual
overshoots the authoritative position, then snaps back inside 100ms.

```ts
// client/src/game/systems/RemotePlayerManager.ts
applyHitVisual(playerId: PlayerId, dirX: number, dirY: number) {
  const rig = this.rigs.get(playerId);
  const offsetX = dirX * 6, offsetY = dirY * 6;
  rig.visualOffsetX = offsetX; rig.visualOffsetY = offsetY;
  this.scene.tweens.add({
    targets: rig,
    visualOffsetX: 0, visualOffsetY: 0,
    duration: 90, ease: 'Cubic.easeOut',
  });
}
```

### 6. Random pitch on every SFX (Nijman's #16)

`AudioSystem.play` must default to `rate: 0.92 + Math.random() * 0.16`.
Only opt out for music and UI tones. Without this, repeated fire on
the Scrap Rifle sounds like a sewing machine.



## Missing Effects to Add (from More Mountains \& Nijman's "30+ Layered Effects")

### 7. Z-Depth Fog (depth perception)

When a big impact happens, push fog or depth haze *behind* the impact point. Makes the foreground feel closer.

```ts
// On big impact (kills, explosions):
this.depthVignetteFlash();  // Creates a temporary depth flash behind impact
```

### 8. Multi-Layer Particles (Nijman's explicit 3-layer approach)

Nijman's demo uses 3+ particle types per impact:

- **Inner**: Sparks (fast, white-hot, short-lived 0.3-0.5s)
- **Middle**: Smoke/steam (slower, medium-lived 0.8-1.2s)  
- **Outer**: Debris/death trail (slowest, 1.5-2s)

```ts
// Multi-layer particle burst at impact
this.multiLayerBurstAt(x, y, {
  elementColor: enemy.elementColor,
  layers: ['inner', 'middle'],  // or ['inner', 'middle', 'outer'] for big hits
  depthMode: 'fog',  // 'fog', 'bloom', 'vignette', or 'none'
  rotation: true,    // enable visual rotation on impact
  velocityDamp: 0.7, // 0-1, how much momentum remains after impact
});
```

### 9. Screen Vignette Flash (deep impact focus)

Not just a color flash, but a temporary **vignette** overlay on impact. Simulates the visual "focus" of a big reaction.

```ts
// Quick vignette on hard hits
this.scene.cameras.main.flash(80, 255, 255, 200);  // already in current skill

// But also vignette depth flash (different from color flash)
this.depthVignetteFlash();  // Adds radial fade behind impact, not overlay
```

### 10. RGB Split / Chromatic Aberration (super impact effect)

Temporary **RGB color shift** on critical / super hits. Common in 2D fighting games.

```ts
// On super / critical hit:
const redOffset = Phaser.Display.Math.randomInt(1, 4);
const blueOffset = Phaser.Display.Math.randomInt(-3, 0);
const cam = this.scene.cameras.main;
// cam.renderTarget?.setTextureOffset(redOffset, 0, -blueOffset, 0);
// (Or use a sprite overlay for the split effect)
```

### 11. Impact "Plop" (Nijman's \#30 - tiny positional jump)

A very fast, tiny (**2-5px**) linear push on **both** camera and impact object, not just camera shake. Nijman's talk shows this as critical for 2D physics games.

```ts
// Tiny plop jump on EVERY impact, not just kills:
const plopOffset = Phaser.Display.Math.randomInt(1, 4);
const plopX = Phaser.Display.Math.randomInt(-2, 2);
const plopY = Phaser.Display.Math.randomInt(-2, 2);

// Camera
this.scene.cameras.main.position.x += plopX;
this.scene.cameras.main.position.y += plopY;

// Impact object (if any)
if (this.impactSprite) {
  this.impactSprite.x += plopX;
  this.impactSprite.y += plopY;
}

// Quick lerp back
this.scene.tweens.add({
  targets: this.scene.cameras.main,
  x: 0, y: 0,
  duration: 30,  // Very fast, subtle
  ease: 'Back.easeOut',
});
```

### 12. Camera Lerp After Shake (Nijman's \#7)

After a big shake ends, the camera should **ease back** with a slightly over-corrected lerp. Creates a "heavy" camera feel.

```ts
// After kill shake (in the 80ms delayed callback):
this.scene.time.delayedCall(80, () => {
  // Instead of just:
  this.scene.tweens.timeScale = 1;
  
  // Add camera lerp with overcorrection
  const targetX = this.scene.cameras.main.x;
  const targetY = this.scene.cameras.main.y;
  this.scene.tweens.add({
    targets: this.scene.cameras.main,
    x: targetX, y: targetY,
    duration: 140,
    ease: 'Back.easeOut',  // Overcorrect
  });
});
```

### 13. Depth Vignette (not color flash)

**Vignette** vs **Color Flash**: Color flash is an overlay at depth 900+ (like normal Phaser graphics). Vignette is a *full-screen rectangle* that darkens the edges (like a flashlight effect).

```ts
// Create a depth 900 vignette sprite for impact:
this.impactVignette = this.add.rectangle(
  this.scene.cameras.main.width / 2,
  this.scene.cameras.main.height / 2,
  this.scene.cameras.main.width,
  this.scene.cameras.main.height,
  0x000000,
  0.08,  // Darker vignette for big hits
).setDepth(900);  // Behind main sprites

// Animate it fade out:
this.scene.tweens.add({
  targets: this.impactVignette,
  alpha: 0,
  duration: 400,
  ease: 'Power2.easeOut',
});
```

### 14. Motion Trail on Fast Projectiles

When a **fast projectile** (>=300 px/sec) creates an impact, leave a visible **1-2 frame trail**. Gives the feeling of momentum.

### 15. Speed Lines on Hard Camera Shake

When camera shake is hard (**>=0.012** intensity), add temporary **speed line overlays**. Classic anime effect.

### 16. Combo Counter Pop

If JAKESJAM tracks combos, when a hit confirms: create two quick scale pulses.

### 17. Temporal Bloom

After **3 quick consecutive hits** (within 700ms), bloom **builds up slightly** on the impact area before dissipating. Creates a "combo heat" effect.

### 18. Per-Particle Velocity Scatter

Not just random positions, but random **velocities** - simulates particles "spreading outward" from the impact like real debris.

### 19. Variable Burst Count

Natural feel: don't fire **exactly** 24 particles, fire **18-30** with slight +-/4 variance.

### 20. "Sleep Frames" on Kill (Nijman's \#11)

After a kill, the victim sprite stays in its death pose for **1 extra frame** before dissappearing. A tiny "permanence" effect.

### 21. Elasto-Kinetic Bounce (visual spring)

When a hit connects, the target **physically bounces** a few pixels back (visual only, sim still runs).

### 22. Multi-Directional Impact "Plop"

Not just camera plop, but a **multi-axis** plop.

### 23. Proportional Shake per Mass

Bigger impacts = heavier objects = different shake behavior. Use mass/size-based shake scaling.

### 24. Hit "Pop" (subtle object rotation)

The hit object **rotates slightly** on impact, then dampens back.

### 25. Variable "Feel Level" per Event

Not all events need equal juice. Use a **level budget**:

```ts
// Event-based feel levels:
const feelLevels = {
  'kill': 'heavy',  // Full juice stack
  'impact': 'medium',  // Medium stack
  'projectileSpawn': 'light',  // Light stack
  'cardPick': 'medium',
  'chaosRoll': 'light',
};

function applyFeelStack(event: string) {
  const level = feelLevels[event] || 'medium';
  switch(level) {
    case 'heavy':
      // Hit-stop + shake + burst + flash + 2SFX + kick + plop
      break;
    case 'medium':
      // Shake + burst + flash + SFX
      break;
    case 'light':
      // Burst + SFX (maybe no shake)
      break;
  }
}
```

### 26. Audio Tail Decay

Sounds don't just "stop" - they **decay** with a tail. Add 5-10% extra tail for "bigger" feel.

### 27. Frequency Ducking on Big Impact

Temporarily **duck other sounds** after a big hit to emphasize the impact.


---

## Complete Feel Effect Checklist (Nijman's 30+)

| \# | Effect | In Current | Missing | Implementation |
|---|---|---|---|---|
| 1 | **Permanence** | Partial | \u2705 | `sleepFrames` on kill |
| 2 | **Bigger Explosions** | Partial | \u2705 | `multiLayerParticles` |
| 3 | **Impact Effects** | Partial | \u2705 | `elastoKineticBounce` \+ `rotation` |
| 4 | **Screen Shake** | \u2705 | | Already done |
| 5 | **Muzzle Flash** | Partial | \u2705 | `depthVignetteFlash` |
| 6 | **Screen Freezing** | \u2705 | | Already done (`timeScale`) |
| 7 | **Camera Lerp** | Partial | \u2705 | `cameraLerp()` helper |
| 8 | **Camera Kick** | \u2705 | | Already done (`cameraKick()`) |
| 9 | **Recoil** | Partial | \u2705 | `elastoKineticBounce` |
| 10 | **Enemy Hit-Flashes** | \u2705 | | Already done (`flashRig()`) |
| 11 | **Permanent Corpses** | Partial | \u2705 | `sleepFrames` |
| 12 | **Sleep Frames** | Partial | \u2705 | `sleepFrames` implementation |
| 13 | **Knockback** | \u2705 | | Already done |
| 14 | **Speed Lines** | Partial | \u2705 | `speedLines` overlay |
| 15 | **Tweened Spawning** | \u2705 | | Already done |
| 16 | **Random Pitch** | \u2705 | | Already done |
| 17 | **Multi-Layer Particles** | Partial | \u2705 | **NEW: 3-layer approach** |
| 18 | **RGB Split** | \u274c | \u2705 | **NEW** |
| 19 | **Motion Trails** | Partial | \u2705 | **NEW** |
| 20 | **Z-Depth Fog** | \u274c | \u2705 | **NEW** |
| 21 | **Depth Vignette** | Partial | \u2705 | **NEW** |
| 22 | **Temporal Bloom** | \u274c | \u2705 | **NEW** |
| 23 | **Combo Pop** | \u274c | \u2705 | **NEW** |
| 24 | **Audio Tail** | Partial | \u2705 | **NEW** |
| 25 | **Freq Ducking** | \u274c | \u2705 | **NEW** |
| ...| ... | ... | ... | ... |

The **core missing pieces** are:
- Multi-layer particle bursts (Nijman's explicit 3 types)
- Per-particle velocity-based scatter
- RGB chromatic aberration on critical hits
- Temporal bloom "heat" buildup
- Z-depth fog/vignette
- Elasto-kinetic bounces
- More natural variable burst counts

### High Priority for JAKESJAM

Given JAKESJAM's aesthetic (dark \+ cyan, 1v1 shooter), prioritize:

1. **Multi-layer particles** - Critical for the "explosive" feel
2. **Elasto-kinetic bounce** - Adds weight, easy to implement  
3. **Camera lerp after shake** - Heavy camera feel, simple
4. **RGB split on super hits** - Stylistic, matches cyberpunk theme
5. **Motion trails on fast projectiles** - Adds speed feel
6. **Z-depth vignette** - Adds depth perception
7. **Variable burst count** - Naturalizes particle systems
8. **Temporal bloom** - Combo feel

## See also
- [`game-lighting-flats/SKILL.md`](./game-lighting-flats/SKILL.md) — 2D light sprites, glow rings, power visualization
- [`game-particle-systems/SKILL.md`](./game-particle-systems/SKILL.md) — Multi-layer burst with 4 particle types
- [`game-render-pipeline/SKILL.md`](./game-render-pipeline/SKILL.md) — Depth 900 lighting, drawing order, batching

## Anti-patterns

- **Pausing the sim for hit-stop.** It will desync from the server.
  Render-tween freeze only.
- **One global "play impact" function with no parameters.** Nijman's
  rule: bigger actions need bigger reactions. A pistol pop ≠ a
  rocket impact ≠ a kill.
- **Calling `cameras.main.shake()` from inside `World.step()` or
  `sim/combat.ts`.** The sim is shared with the Bun server — Phaser
  does not exist there. Compile error if you're lucky, silent dead
  code if you're not.
- **Stacking shakes that override each other.** Last-write-wins in
  Phaser, so a tiny footstep can clobber a kill. Route through a
  bus with `if (intensity > current)`.
- **No pitch variance on SFX.** The `Scrap Rifle` at 5 RPS becomes
  unbearable inside 10 seconds.
- **Adding particles to `client/src/sim/projectile.ts`.** Particles
  are render. The sim emits *events*; render decides what to do
  about them.
- **Skipping juice on the draft phase because "it's a menu".** The
  draft IS the rogue-lite payoff loop. A flat draft kills retention.

## Pre-flight checklist

- [ ] Every event in `StepResult.events` has a render-layer handler
      with at least 3 channels firing.
- [ ] No call to `cameras`, `tweens`, `add.particles`, or
      `Math.random()` inside any file under `client/src/sim/`.
- [ ] Shake amplitudes use the named buckets (`0.004` … `0.030`).
- [ ] All `audio.play()` calls have `rate` jitter unless explicitly
      a music or UI tone.
- [ ] Hit-stop only freezes `tweens.timeScale`, never anything that
      affects sim tick rate or input feed.
- [ ] Card-draft confirm has a screen flash + camera kick + SFX.
- [ ] A kill produces hit-stop + shake + burst + flash + 2 SFX +
      camera kick (for the killer).
- [ ] Tested on `OnlineMatchScene` (not just `MatchScene`) — net
      events route through `RenderHost`, easy to forget one.

## Source

- Jan Willem Nijman, "The Art of Screenshake" — INDIGO Classes 2013.
  https://www.youtube.com/watch?v=AJdEqssNZ-U
- Mirror + slides: https://archive.org/details/the-art-of-screenshake
- Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
  Sensation", Morgan Kaufmann, 2008. Chapter 1 PDF:
  http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf
- Reference reimplementation of the demo:
  https://github.com/colinbellino/screenshake
---
name: ts-pocock;

// Camera
this.scene.cameras.main.position.x += plopX;
this.scene.cameras.main.position.y += plopY;

// Impact object (if any)
if (this.impactSprite) {
  this.impactSprite.x += plopX;
  this.impactSprite.y += plopY;
}

// Quick lerp back
this.scene.tweens.add({
  targets: this.scene.cameras.main,
  x: 0, y: 0,
  duration: 30,  // Very fast, subtle
  ease: 'Back.easeOut',
});
```

### 12. Camera Lerp After Shake (Nijman's \#7)

After a big shake ends, the camera should **ease back** with a slightly over-corrected lerp. Creates a "heavy" camera feel.

```ts
// After kill shake (in the 80ms delayed callback):
this.scene.time.delayedCall(80, () => {
  // Instead of just:
  this.scene.tweens.timeScale = 1;
  
  // Add camera lerp with overcorrection
  const targetX = this.scene.cameras.main.x;
  const targetY = this.scene.cameras.main.y;
  this.scene.tweens.add({
    targets: this.scene.cameras.main,
    x: targetX, y: targetY,
    duration: 140,
    ease: 'Back.easeOut',  // Overcorrect
  });
});
```

### 13. Depth Vignette (not color flash)

**Vignette** vs **Color Flash**: Color flash is an overlay at depth 900+ (like normal Phaser graphics). Vignette is a *full-screen rectangle* that darkens the edges (like a flashlight effect).

```ts
// Create a depth 900 vignette sprite for impact:
this.impactVignette = this.add.rectangle(
  this.scene.cameras.main.width / 2,
  this.scene.cameras.main.height / 2,
  this.scene.cameras.main.width,
  this.scene.cameras.main.height,
  0x000000,
  0.08,  // Darker vignette for big hits
).setDepth(900);  // Behind main sprites

// Animate it fade out:
this.scene.tweens.add({
  targets: this.impactVignette,
  alpha: 0,
  duration: 400,
  ease: 'Power2.easeOut',
});
```

### 14. Motion Trail on Fast Projectiles

When a **fast projectile** (>=300 px/sec) creates an impact, leave a visible **1-2 frame trail**. Gives the feeling of momentum.

### 15. Speed Lines on Hard Camera Shake

When camera shake is hard (**>=0.012** intensity), add temporary **speed line overlays**. Classic anime effect.

### 16. Combo Counter Pop

If JAKESJAM tracks combos, when a hit confirms: create two quick scale pulses.

### 17. Temporal Bloom

After **3 quick consecutive hits** (within 700ms), bloom **builds up slightly** on the impact area before dissipating. Creates a "combo heat" effect.

### 18. Per-Particle Velocity Scatter

Not just random positions, but random **velocities** - simulates particles "spreading outward" from the impact like real debris.

### 19. Variable Burst Count

Natural feel: don't fire **exactly** 24 particles, fire **18-30** with slight +-/4 variance.

### 20. "Sleep Frames" on Kill (Nijman's \#11)

After a kill, the victim sprite stays in its death pose for **1 extra frame** before dissappearing. A tiny "permanence" effect.

### 21. Elasto-Kinetic Bounce (visual spring)

When a hit connects, the target **physically bounces** a few pixels back (visual only, sim still runs).

### 22. Multi-Directional Impact "Plop"

Not just camera plop, but a **multi-axis** plop.

### 23. Proportional Shake per Mass

Bigger impacts = heavier objects = different shake behavior. Use mass/size-based shake scaling.

### 24. Hit "Pop" (subtle object rotation)

The hit object **rotates slightly** on impact, then dampens back.

### 25. Variable "Feel Level" per Event

Not all events need equal juice. Use a **level budget**:

```ts
// Event-based feel levels:
const feelLevels = {
  'kill': 'heavy',  // Full juice stack
  'impact': 'medium',  // Medium stack
  'projectileSpawn': 'light',  // Light stack
  'cardPick': 'medium',
  'chaosRoll': 'light',
};

function applyFeelStack(event: string) {
  const level = feelLevels[event] || 'medium';
  switch(level) {
    case 'heavy':
      // Hit-stop + shake + burst + flash + 2SFX + kick + plop
      break;
    case 'medium':
      // Shake + burst + flash + SFX
      break;
    case 'light':
      // Burst + SFX (maybe no shake)
      break;
  }
}
```

### 26. Audio Tail Decay

Sounds don't just "stop" - they **decay** with a tail. Add 5-10% extra tail for "bigger" feel.

### 27. Frequency Ducking on Big Impact

Temporarily **duck other sounds** after a big hit to emphasize the impact.


---

## Complete Feel Effect Checklist (Nijman's 30+)

| \# | Effect | In Current | Missing | Implementation |
|---|---|---|---|---|
| 1 | **Permanence** | Partial | \u2705 | `sleepFrames` on kill |
| 2 | **Bigger Explosions** | Partial | \u2705 | `multiLayerParticles` |
| 3 | **Impact Effects** | Partial | \u2705 | `elastoKineticBounce` \+ `rotation` |
| 4 | **Screen Shake** | \u2705 | | Already done |
| 5 | **Muzzle Flash** | Partial | \u2705 | `depthVignetteFlash` |
| 6 | **Screen Freezing** | \u2705 | | Already done (`timeScale`) |
| 7 | **Camera Lerp** | Partial | \u2705 | `cameraLerp()` helper |
| 8 | **Camera Kick** | \u2705 | | Already done (`cameraKick()`) |
| 9 | **Recoil** | Partial | \u2705 | `elastoKineticBounce` |
| 10 | **Enemy Hit-Flashes** | \u2705 | | Already done (`flashRig()`) |
| 11 | **Permanent Corpses** | Partial | \u2705 | `sleepFrames` |
| 12 | **Sleep Frames** | Partial | \u2705 | `sleepFrames` implementation |
| 13 | **Knockback** | \u2705 | | Already done |
| 14 | **Speed Lines** | Partial | \u2705 | `speedLines` overlay |
| 15 | **Tweened Spawning** | \u2705 | | Already done |
| 16 | **Random Pitch** | \u2705 | | Already done |
| 17 | **Multi-Layer Particles** | Partial | \u2705 | **NEW: 3-layer approach** |
| 18 | **RGB Split** | \u274c | \u2705 | **NEW** |
| 19 | **Motion Trails** | Partial | \u2705 | **NEW** |
| 20 | **Z-Depth Fog** | \u274c | \u2705 | **NEW** |
| 21 | **Depth Vignette** | Partial | \u2705 | **NEW** |
| 22 | **Temporal Bloom** | \u274c | \u2705 | **NEW** |
| 23 | **Combo Pop** | \u274c | \u2705 | **NEW** |
| 24 | **Audio Tail** | Partial | \u2705 | **NEW** |
| 25 | **Freq Ducking** | \u274c | \u2705 | **NEW** |
| ...| ... | ... | ... | ... |

The **core missing pieces** are:
- Multi-layer particle bursts (Nijman's explicit 3 types)
- Per-particle velocity-based scatter
- RGB chromatic aberration on critical hits
- Temporal bloom "heat" buildup
- Z-depth fog/vignette
- Elasto-kinetic bounces
- More natural variable burst counts

### High Priority for JAKESJAM

Given JAKESJAM's aesthetic (dark \+ cyan, 1v1 shooter), prioritize:

1. **Multi-layer particles** - Critical for the "explosive" feel
2. **Elasto-kinetic bounce** - Adds weight, easy to implement  
3. **Camera lerp after shake** - Heavy camera feel, simple
4. **RGB split on super hits** - Stylistic, matches cyberpunk theme
5. **Motion trails on fast projectiles** - Adds speed feel
6. **Z-depth vignette** - Adds depth perception
7. **Variable burst count** - Naturalizes particle systems
8. **Temporal bloom** - Combo feel
## Anti-patterns

- **Pausing the sim for hit-stop.** It will desync from the server.
  Render-tween freeze only.
- **One global "play impact" function with no parameters.** Nijman's
  rule: bigger actions need bigger reactions. A pistol pop ≠ a
  rocket impact ≠ a kill.
- **Calling `cameras.main.shake()` from inside `World.step()` or
  `sim/combat.ts`.** The sim is shared with the Bun server — Phaser
  does not exist there. Compile error if you're lucky, silent dead
  code if you're not.
- **Stacking shakes that override each other.** Last-write-wins in
  Phaser, so a tiny footstep can clobber a kill. Route through a
  bus with `if (intensity > current)`.
- **No pitch variance on SFX.** The `Scrap Rifle` at 5 RPS becomes
  unbearable inside 10 seconds.
- **Adding particles to `client/src/sim/projectile.ts`.** Particles
  are render. The sim emits *events*; render decides what to do
  about them.
- **Skipping juice on the draft phase because "it's a menu".** The
  draft IS the rogue-lite payoff loop. A flat draft kills retention.

## Pre-flight checklist

- [ ] Every event in `StepResult.events` has a render-layer handler
      with at least 3 channels firing.
- [ ] No call to `cameras`, `tweens`, `add.particles`, or
      `Math.random()` inside any file under `client/src/sim/`.
- [ ] Shake amplitudes use the named buckets (`0.004` … `0.030`).
- [ ] All `audio.play()` calls have `rate` jitter unless explicitly
      a music or UI tone.
- [ ] Hit-stop only freezes `tweens.timeScale`, never anything that
      affects sim tick rate or input feed.
- [ ] Card-draft confirm has a screen flash + camera kick + SFX.
- [ ] A kill produces hit-stop + shake + burst + flash + 2 SFX +
      camera kick (for the killer).
- [ ] Tested on `OnlineMatchScene` (not just `MatchScene`) — net
      events route through `RenderHost`, easy to forget one.

## Source

- Jan Willem Nijman, "The Art of Screenshake" — INDIGO Classes 2013.
  https://www.youtube.com/watch?v=AJdEqssNZ-U
- Mirror + slides: https://archive.org/details/the-art-of-screenshake
- Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
  Sensation", Morgan Kaufmann, 2008. Chapter 1 PDF:
  http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf
- Reference reimplementation of the demo:
  https://github.com/colinbellino/screenshake
---
name: ts-pocock
description: Matt Pocock-style TypeScript discipline applied to JAKESJAM. Triggers when editing client/src/sim/, client/src/net/, server/src/, convex/. Enforces branded IDs, satisfies-over-as, exhaustive discriminated unions, and zero `as any` / `as unknown as` escape hatches.
---

# TS Pocock — JAKESJAM TypeScript Playbook

When editing `client/src/sim/`, `client/src/net/`, `server/src/`, or `convex/`, follow these rules. The goal is fewer runtime surprises and tighter contracts at the netcode/sim boundary where parity matters most.

## 1. Branded IDs everywhere

`PlayerId`, `EntityId`, `Tick`, `InputSeq` are branded types. `client/src/sim/types.ts` already defines them. Never let a raw `string`/`number` flow into a slot expecting one.

```ts
// ❌
const id: PlayerId = playerInfo.id; // raw string
// ✅
const id = playerInfo.id as PlayerId; // only at the trust boundary
```

When iterating `Object.keys(players)` you get `string[]`. Use the helper:

```ts
// client/src/sim/types.ts (extend if missing)
export const playerIds = (s: WorldState): PlayerId[] =>
  Object.keys(s.players) as PlayerId[];
```

## 2. `satisfies` over `as` for config literals

```ts
// ❌
const PALETTE = { health: "#f00", shield: "#0af" } as Record<string, string>;
// ✅
const PALETTE = { health: "#f00", shield: "#0af" } satisfies Record<string, string>;
```

Why: `satisfies` validates the shape *and* preserves the literal type so `PALETTE.health` is `"#f00"`, not `string`. Use this for palette, sim constants, weapon profiles, chaos modifier registries.

## 3. Discriminated unions + exhaustive switch

Protocol messages in `client/src/net/protocol.ts` and `server/src/protocol.ts` are discriminated by `t`. Every consumer must `switch (msg.t)` with a `default: const _: never = msg; throw new Error(…)`. No `as ClientMessage`, no `if (msg.t === "in") (msg as InMessage)…`.

## 4. `as const` + derived types for string-literal sets

```ts
// ❌
const CHAOS_IDS = ["lightning", "fire", "ice"];
type ChaosModifierId = string; // way too wide

// ✅
export const CHAOS_IDS = ["lightning", "fire", "ice"] as const;
export type ChaosModifierId = typeof CHAOS_IDS[number];
export const isChaosId = (v: unknown): v is ChaosModifierId =>
  typeof v === "string" && (CHAOS_IDS as readonly string[]).includes(v);
```

Use `isChaosId` instead of `as ChaosModifierId[]` casts after `JSON.parse`.

## 5. Validate at trust boundaries; trust internally

`JSON.parse`, `req.json()`, `localStorage.getItem`, WS payloads from clients — all return `unknown`. Validate once, use the validated type everywhere downstream. No re-validation in internal code.

```ts
function validateChaosIds(raw: string): ChaosModifierId[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isChaosId);
}
```

## 6. Test mocks have types too

No `as any` in test files. Define mock types in `__tests__/test-utils.ts`:

```ts
export type MockScene = Partial<Phaser.Scene>;
export type MockGameObject = Partial<Phaser.GameObjects.GameObject>;
```

## 7. Phaser objects must be constructed

```ts
// ❌
const v = { x, y } as unknown as Phaser.Math.Vector2;
// ✅
const v = new Phaser.Math.Vector2(x, y);
```

## 8. Zero tolerance escape hatches

Forbidden in new code under `client/src/sim/`, `client/src/net/`, `server/src/`:
- `as any`
- `as unknown as X` (except at FFI/Convex codegen-pending boundaries — comment why)
- `// @ts-ignore`, `// @ts-expect-error` without a linked issue

If you find existing instances, add a `// TODO(ts-pocock): …` and fix opportunistically.

## 9. Verify

After every edit under the trigger paths:

```bash
bunx tsc --noEmit  # in client/ and server/
bun test client/src/sim/__tests__/
```

Both must pass before declaring done.
---
name: matchmaking-skill-rating
description: >
  Skill rating + matchmaker design for JAKESJAM. Use when wiring up
  match-result writes in convex/matches.ts that should update player
  ratings, building queue logic in convex/matchmaker.ts, or anything
  involving MMR, Elo, Glicko, OpenSkill, ranked seasons, queue times,
  or match quality metrics.
version: 1.0.0
---

# Matchmaking & Skill Rating

## Why this skill exists

JAKESJAM's first ranked release will need a number to put against
each player. Picking that number wrong is *expensive* — Elo's
rating-deflation under variable opponent counts and Glicko-1's
glacial convergence have both bricked PvP launches in living memory.
JAKESJAM is 1v1 first then small-N free-for-all (4–6 players), which
puts it squarely in the spot Glicko-2 and OpenSkill were designed
for. Mark Glickman published Glicko-2 with a worked example
PDF; the OpenSkill maintainers ship a multi-team Plackett-Luce
implementation. We pick deliberately, lock the choice, and never
revisit it under pressure.

## The hard line

**1v1 matches: Glicko-2. N-player FFA matches: OpenSkill (Plackett-
Luce). Never Elo. Never homemade. Never both for the same mode.
Rating updates happen in Convex, never on the Bun match host.**

## What the KOL says

**Mark Glickman, "Example of the Glicko-2 system"** (Boston University,
PDF). Glicko-2's three-number per player (rating *r*, deviation
*RD*, volatility *σ*) gives correct uncertainty over time and
handles inactivity. From the worked example:

> "After playing m games in a rating period, a player's rating,
> deviation, and volatility are updated according to [equations
> 1–8]."
> — Glickman, Example of the Glicko-2 system, p. 1–4

Glickman explicitly designed Glicko-2 for **rating periods, not
per-match updates**. Each period (e.g. one day, or every 10 games)
batches results and computes the new rating once. JAKESJAM should
batch per-day at first.

**Vivek Joshy et al., "OpenSkill: A faster asymmetric multi-team,
multiplayer rating system"** (arXiv 2401.05451, 2024):

> "OpenSkill's Plackett-Luce model is the recommended model for
> most multiplayer use cases. It is faster than TrueSkill and
> permission-licensed for commercial use."
> — OpenSkill paper, abstract

Crucially: OpenSkill is **MIT-licensed**. TrueSkill is patented and
encumbered for commercial games — do not use it.

## How JAKESJAM applies it

Concrete files (mostly new):

- `convex/schema.ts` — add a `ratings` table with
  `{ userId, mode, rating, rd, volatility, updatedAt }`.
- `convex/ratings.ts` (NEW) — Glicko-2 implementation
  (~120 lines), pure TS port of Glickman's example PDF.
- `convex/openskillFFA.ts` (NEW) — vendored OpenSkill TS port,
  Plackett-Luce model. There's a `openskill-js` npm package, but
  for a Convex action we want zero deps and ~200 lines of code we
  control.
- `convex/matches.ts::recordMatchResult` — batched ranking job,
  invoked by `MatchHost` via `convexClient` at `onMatchEnd`.
- `convex/matchmaker.ts` — queue logic; pulls `rating` + `rd` to
  compute match quality.

`server/src/matchHost.ts` does NOT touch ratings. The host posts
match results to Convex; Convex owns rating math. Two reasons:
(1) ratings are lobby-layer state, never live-sim state, and
(2) Convex is the durable system of record — Bun hosts are cattle.

## Recipes

### 1. Glicko-2 schema + per-mode separation

```ts
// convex/schema.ts
ratings: defineTable({
  userId: v.id('users'),
  mode: v.union(v.literal('1v1'), v.literal('ffa')),
  rating: v.number(),         // r — initial 1500
  rd: v.number(),             // RD — initial 350
  volatility: v.number(),     // σ — initial 0.06
  updatedAt: v.number(),
}).index('by_user_mode', ['userId', 'mode'])
  .index('by_mode_rating', ['mode', 'rating']),

ratingPeriods: defineTable({
  userId: v.id('users'),
  mode: v.union(v.literal('1v1'), v.literal('ffa')),
  periodStart: v.number(),       // ms timestamp, midnight UTC
  results: v.array(v.object({
    opponentRating: v.number(),
    opponentRD: v.number(),
    score: v.number(),           // 1 win, 0.5 draw, 0 loss
  })),
}).index('by_user_period', ['userId', 'mode', 'periodStart']),
```

Ratings live separately for `1v1` and `ffa`. They use *different
rating systems*, and skill in 1v1 doesn't transfer cleanly to FFA.

### 2. Glicko-2 update (pure TS, no deps)

```ts
// convex/ratings.ts — port of Glickman's example PDF, equations 1–8
const TAU = 0.5;                 // system constant: 0.3 to 1.2

export function glicko2Update(
  player: { r: number; rd: number; sigma: number },
  results: ReadonlyArray<{ oppR: number; oppRD: number; s: number }>,
): { r: number; rd: number; sigma: number } {
  // Step 2: scale to Glicko-2
  const mu = (player.r - 1500) / 173.7178;
  const phi = player.rd / 173.7178;
  // Step 3: variance v
  const g = (rd: number) => 1 / Math.sqrt(1 + (3 * rd * rd) / (Math.PI * Math.PI));
  const E = (mu: number, oppMu: number, oppRD: number) =>
    1 / (1 + Math.exp(-g(oppRD) * (mu - oppMu)));
  // ... see Glickman's PDF for full equations (8 steps total).
  // Tested against the worked example: input 1500/200, results
  // vs (1400/30, 1550/100, 1700/300) → output 1464.05/151.52/0.05999
  return { r, rd, sigma };
}
```

The worked example in the PDF is the regression test. If your port
doesn't reproduce 1464.05/151.52/0.05999 to 2 decimals, the port is
wrong.

### 3. Rating periods, not per-match updates

```ts
// convex/matches.ts
export const recordMatchResult = mutation({
  args: { matchId: v.id('matches'), results: v.array(v.object({
    userId: v.id('users'), score: v.number(), mode: v.string(),
  }))},
  handler: async (ctx, { matchId, results }) => {
    const periodStart = startOfUtcDay(Date.now());
    for (const r of results) {
      // Append to the player's open rating period; do NOT update rating yet.
      await appendToRatingPeriod(ctx, r.userId, r.mode, periodStart, /* opp */);
    }
  },
});

// Cron job runs daily, applies Glicko-2 update for all players' periods.
export const closeRatingPeriod = internalMutation({ ... });
```

Per-match updates create rating thrash on small sample sizes.
Glickman's published recommendation is "10–15 games per period".
For JAKESJAM start at *one period per UTC day* and migrate to
floating-window once we have telemetry.

### 4. Match quality metric (matchmaker)

```ts
// convex/matchmaker.ts
function matchQuality(a: Rating, b: Rating): number {
  // Glickman's "expected score" + "deviation overlap"
  const ratingDiff = Math.abs(a.rating - b.rating);
  const overlapRD = Math.sqrt(a.rd * a.rd + b.rd * b.rd);
  // Higher = better match. 1.0 = identical ratings, low RD.
  return Math.exp(-ratingDiff / overlapRD);
}

const MIN_QUALITY = 0.4;          // tuned per telemetry
const MAX_WAIT_MS = 30_000;
```

Queue logic: gather candidates inside a sliding window. Pair the
two with highest `matchQuality`. If wait time exceeds `MAX_WAIT_MS`,
relax `MIN_QUALITY` linearly to 0 — better a slightly mismatched
match than no match.

### 5. OpenSkill for FFA (4–6 player)

```ts
// convex/openskillFFA.ts (vendored Plackett-Luce, ~200 lines)
type OSRating = { mu: number; sigma: number };

export function openSkillUpdate(
  ranking: ReadonlyArray<OSRating>,    // index 0 = winner, etc.
): OSRating[] {
  // Plackett-Luce update; Weng & Lin 2011, ported by openskill.py
  // Reference: https://openskill.me/en/stable/manual.html
  // ... ~80 lines of math
}
```

For FFA, results come in as a `ranking[]` (1st, 2nd, 3rd, ...). Ties
are allowed. The OpenSkill manual covers tied-rank handling.

### 6. Display rating, not internal rating

```ts
// In the UI:
function displayRating(r: Rating): number {
  // Glicko-2: only show ratings where RD < 100 (i.e. confident).
  // Otherwise show "Provisional" + the rough bucket.
  if (r.rd > 100) return null;
  return Math.round(r.rating);
}
```

A 1700-rated player with RD=200 is *not really* 1700 — Glickman's
own writing emphasises this. Showing a confident-looking number
that swings ±100 next match destroys trust in the system.

## Anti-patterns

- **Vanilla Elo.** Doesn't track uncertainty. Doesn't handle
  inactivity. Doesn't handle multi-player. Don't.
- **TrueSkill.** Patented (Microsoft). Commercial use requires a
  license. Use OpenSkill.
- **Per-match Glicko-2 updates.** Glickman explicitly recommends
  rating periods. Per-match increases volatility variance.
- **Computing ratings on the Bun match host.** Hosts are
  ephemeral. Convex is durable. Mixing the two creates the
  classic "I won the match but my rating didn't update" bug
  when the host crashes between the win and the Convex post.
- **Mixing 1v1 and FFA into one rating.** Different skill, different
  variance, different metagame. Two separate ratings.
- **Showing raw rating to brand-new players.** They have RD=350.
  The number is meaningless. Show "Provisional" until RD<100.
- **Capping queue wait at "find the best match forever".** Players
  abandon the queue. Decay `MIN_QUALITY` toward 0 over time.
- **Treating reconnect as a loss.** Convex sees disconnect; the
  match host's `onMatchEnd` carries the *real* outcome (or "no
  result" if the host crashed mid-match). Trust the host event,
  not the WebSocket close.

## Pre-flight checklist

- [ ] `ratings` table has separate rows for `1v1` and `ffa`
      modes per user.
- [ ] Glicko-2 port reproduces Glickman's worked example to 2
      decimal places.
- [ ] OpenSkill port reproduces the OpenSkill manual's worked
      example.
- [ ] Rating updates run in a Convex cron job (daily), not per
      match.
- [ ] Match host calls `recordMatchResult` once at match end,
      with the canonical outcome.
- [ ] Matchmaker uses a `matchQuality` function that includes RD
      overlap, not just rating difference.
- [ ] Wait-time relaxation is implemented: `MIN_QUALITY` decays
      to 0 over `MAX_WAIT_MS`.
- [ ] UI hides rating when RD > 100 (provisional state).
- [ ] No rating math in `server/src/`. None.
- [ ] `convex/_generated/ai/guidelines.md` patterns followed for
      the ratings + matches mutations.

## Source

- Mark Glickman, "Example of the Glicko-2 system" (PDF):
  https://glicko.net/glicko/glicko2.pdf
- Mark Glickman, "The Glicko System" (original paper, PDF):
  https://www.glicko.net/glicko/glicko.pdf
- Glickman main site (incl. FAQ):
  https://www.glicko.net/glicko.html
- OpenSkill manual + Plackett-Luce reference:
  https://openskill.me/en/stable/manual.html
- OpenSkill paper, Joshy et al. 2024:
  https://arxiv.org/abs/2401.05451
- OpenSkill source (TS-portable reference):
  https://github.com/vivekjoshy/openskill.py
---
name: sim-tests
description: >
  Patterns for the deterministic sim test suite under
  client/src/sim/__tests__/ that runs with `bun test`. Use when writing
  or fixing tests for the simulation: chaos, collision, combat,
  destructible, fire, pickup, rng, round, weaponBuild, world-determinism,
  or anything involving "bun:test", scripted InputFrames, World.create,
  stepWithRuntime, snapshot equality, parity runs, or RNG seeding in
  tests. Skip for non-sim tests.
---

# Sim Test Patterns

The sim under `@sim/` is the only thing in this codebase that is **fully deterministic by design** — that's both why it's testable and why every test must defend that invariant. Tests live alongside source in `client/src/sim/__tests__/` and run with `bun test` (see `package.json` workspace `test` script). The Bun runtime is also what the production server uses, so tests exercise the real engine.

## What a good sim test looks like

```ts
import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";

const TICKS = 600;          // 10 sim-seconds at 60Hz
const DT_MS = 1000 / 60;    // STEP_MS — must match World step

test("two runs with same seed and inputs produce identical state", () => {
  const seed = 42;
  const inputs = scriptInputs(TICKS);

  const a = runWorld(seed, inputs);
  const b = runWorld(seed, inputs);

  expect(a).toEqual(b);
});
```

The `world-determinism.test.ts` file is the **gold standard** — read it before adding new tests in the same shape.

## The four kinds of sim tests

1. **Determinism / parity** — same seed + same inputs ⇒ identical end state. Run the same scenario twice in one test, assert structural equality of `WorldState`. Anything flaky here is a real bug, not a test bug.
2. **Behavioural** — given a known starting state, does X mechanic do Y? `combat.test.ts`, `collision.test.ts`, `pickup.test.ts`. Use small custom maps, not real game maps.
3. **Property / chaos** — generate randomised input streams and check invariants that should *always* hold (e.g. "no entity ever has NaN position", "HP never negative"). `chaos.test.ts` is the prototype here. Use a seeded generator so failures repro.
4. **RNG** — the RNG itself is tested in `rng.test.ts`. New RNG primitives need: distribution sanity, repro from seed, fork independence.

## Mandatory rules for sim tests

- **Use `bun:test`, not Jest.** Imports are `from "bun:test"`. Don't add a Jest config.
- **Always seed the World explicitly.** `World.create({ ..., rngSeed: 42 })`. Tests that don't seed are non-deterministic; CI will be flaky.
- **Step at the real `STEP_MS`.** A test that uses `dt: 50` is testing an alternate physics — fine for one-off, but never passes that into a parity test.
- **Tests must not import Phaser, the DOM, Convex, or `fetch`.** If you can't run the test with `bun test --silent` from a cold checkout, it's not a sim test.
- **Construct minimal `MapDefinition`s in-test.** Don't load real arena maps from disk in unit tests — they couple tests to designer-tweakable data. The `oneFloorMap` shape in `world-determinism.test.ts` is the template.
- **Compare snapshots, not field-by-field.** `expect(stateA).toEqual(stateB)` deep-checks the whole `WorldState`. If equality drift becomes a problem, hash the msgpack-encoded form.

## Useful test helpers (write these once, reuse)

```ts
// constant-input-for-N-ticks helper
function holdInput(playerId: PlayerId, keys: InputBitfield, n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let tick = 0; tick < n; tick++) {
    out.push({ playerId, seq: tick, tick, keys, aimX: 0, aimY: 0, dt: DT_MS });
  }
  return out;
}

// run-and-collect helper
function runWorld(seed: number, frames: InputFrame[][]): WorldState {
  const world = World.create({ ..., rngSeed: seed });
  const runtime = createRuntime(world);
  for (let tick = 0; tick < frames.length; tick++) {
    stepWithRuntime(runtime, frames[tick], DT_MS);
  }
  return world.state;
}
```

## What tests catch (and what they don't)

- ✅ Sim drift between client prediction and server (parity tests).
- ✅ Mechanic regressions when refactoring `combat.ts` etc.
- ✅ NaN / Infinity / negative-HP class bugs (chaos tests).
- ❌ Network desync caused by message ordering — that's an integration concern; mock the transport in `client/src/net/` tests, not here.
- ❌ Phaser rendering issues — out of scope.
- ❌ Performance regressions — `bun test` is correctness, not perf. Use a separate bench.

## When a test fails for "non-determinism"

1. Grep your changes for `Math.random` and `Date.now()` — that's >90% of cases.
2. Check for `Map`/`Set` deletion-then-reinsertion changing iteration order.
3. Check for new `Array.from(set)` or `[...set]` patterns where the set isn't insertion-ordered.
4. Run with `--reporter=verbose` to see which expectation diverged first; the *first* divergence is almost always the cause.

## CI integration

- `bun run test` runs every workspace's `test` script that exists. Sim tests run under `client`.
- A failing parity test should **block the merge**. These are the load-bearing tests for netcode correctness.

## References

- [Bun Test runner docs](https://bun.sh/docs/cli/test)
- [Glenn Fiedler — Deterministic Lockstep (why determinism matters)](https://gafferongames.com/post/deterministic_lockstep/)
- See also the project's `game-sim-determinism` skill for sim-authoring rules these tests defend.
---
name: replay-spectator
description: >
  Match replay (record + playback) and live spectator infrastructure
  built on JAKESJAM's deterministic sim. Use when adding replay capture
  to MatchHost, building a "watch friend's match" feature, debugging
  client/server desync via replays, or anything that needs to
  reconstruct a match outside the live run. Triggered by "replay",
  "demo", "spectator", "POV", "rewatch".
version: 1.0.0
---

# Replay & Spectator Systems

## Why this skill exists

JAKESJAM's sim is deterministic by construction (`game-sim-determinism`),
which means replay is *almost free* — but only if the recording and
playback contracts respect what id Software figured out in 1996 and
Glenn Fiedler restated for modern netcode. Get this wrong and you
either ship a 50MB-per-match snapshot recorder or a "replay" feature
that desyncs after 30 seconds. Doom and Quake solved this with
input-only recording. JAKESJAM should solve it the same way.

## The hard line

**Record inputs + RNG seed + protocol version. Never record
WorldState snapshots as the source of truth. Playback re-runs the
sim. If the sim has changed, the replay is broken — and that's a
*feature*, not a bug.**

## What the KOL says

**id Software's Doom .LMP and Quake .DEM** — the foundational pattern.
From the Quake DEM format docs:

> "The recording of a DOOM game consists only of the player input.
> All the rest is random-number dependent but totally deterministic
> and will be recalculated during the playback."
> — Quake DEM format reference, gamers.org

Quake III moved to network-packet-stream replays (`.dm_68`), which
trade compactness for cross-version playability. Both approaches are
valid; the choice depends on whether you ever need to play a replay
on a *different version of the sim*.

**Glenn Fiedler, "Snapshot Compression" / "Snapshot Interpolation"**
(Gaffer on Games). Fiedler's networking series argues:

> "Deterministic lockstep is great when you can get it. When you
> can't (floating-point divergence across compilers/architectures),
> you fall back to snapshot interpolation — but you pay for it in
> bandwidth and rewind cost."
> — Fiedler, "Snapshot Interpolation"

JAKESJAM **can** get deterministic lockstep — sim is pure TS, no
floating-point branchers, runs in V8 on both ends. So we use
**input-replay**, not **snapshot-replay**, for the canonical record.

## How JAKESJAM applies it

Concrete files:

- `server/src/matchHost.ts` — owns the live match. Add a
  `RecordingBuffer` that appends every accepted `InputFrame`
  per player + every chaos roll seed.
- `server/src/protocol.ts` — define `ReplayHeader`, `ReplayChunk`.
- `client/src/sim/World.ts` — `World.create({ seed, mapId })` is
  already pure. Replay playback constructs a fresh `World` and
  feeds it the recorded inputs at the recorded ticks.
- `client/src/sim/rng.ts` — RNG state is part of `WorldState`.
  Recording the initial seed is sufficient.
- `convex/replays.ts` (NEW) — store the replay blob keyed by
  `matchId`. Convex storage, NOT live tables. ~50KB for a typical
  3-round match.
- `client/src/game/scenes/ReplayScene.ts` (NEW) — playback scene
  that wraps `MatchScene` but disables local input and feeds the
  recorded input frames instead.

`PROTOCOL_VERSION` (already in `protocol.ts`) doubles as the replay
compatibility version. A replay's header carries it; if mismatched,
playback refuses with a clear error rather than producing garbage.

## Recipes

### 1. The replay file format

```ts
// server/src/protocol.ts (additions)
export type ReplayHeader = {
  version: 1;
  protocolVersion: number;       // === PROTOCOL_VERSION at record time
  matchId: string;
  mapId: MapId;
  startSeed: number;             // seed for state.rngState
  players: ReadonlyArray<{
    id: PlayerId;
    name: string;
    archetype: CharacterArchetype;
  }>;
  startedAtMs: number;           // wall-clock for UI only
  totalTicks: Tick;
};

export type ReplayChunk = {
  // Inputs grouped by tick range, msgpack-encoded
  startTick: Tick;
  endTick: Tick;
  inputsByPlayer: Record<PlayerId, InputFrame[]>;
  // Out-of-band events the sim consumes:
  chaosRolls: Array<{ atTick: Tick; modifierId: ChaosModifierId }>;
};

export type ReplayFile = {
  header: ReplayHeader;
  chunks: ReplayChunk[];
};
```

Encode with the existing msgpack encoder used in `net/protocol.ts`.
A 5-minute match at 60Hz with 2 players ≈ 36k input frames × ~12B
each ≈ 432KB raw, ~80KB after msgpack + per-message-deflate over
the wire. After Convex storage we keep it as the raw blob.

### 2. Recording inside the match host

```ts
// server/src/matchHost.ts
class MatchHost {
  private recorder = new RecordingBuffer();

  onClientInput(playerId: PlayerId, frame: InputFrame) {
    // Existing: validate, queue for next tick, etc.
    this.queueInput(playerId, frame);
    // New: record
    this.recorder.append(playerId, frame);
  }

  onChaosRoll(modifierId: ChaosModifierId) {
    this.recorder.appendChaos(this.world.tick, modifierId);
  }

  onMatchEnd() {
    const blob = this.recorder.serialize(this.matchHeader());
    void convexClient.mutation(api.replays.save, { matchId, blob });
  }
}
```

Recording is **fire-and-forget**. If Convex is down, we drop the
replay — the live match must not block on storage. Telemetry-grade,
not safety-critical.

### 3. Playback as a fresh sim run

```ts
// client/src/game/scenes/ReplayScene.ts
class ReplayScene extends Phaser.Scene {
  create({ replay }: { replay: ReplayFile }) {
    if (replay.header.protocolVersion !== PROTOCOL_VERSION) {
      this.scene.start('ReplayIncompatibleScene', { replay });
      return;
    }

    this.world = World.create({
      seed: replay.header.startSeed,
      mapId: replay.header.mapId,
      players: replay.header.players,
    });
    this.inputCursor = new ReplayInputCursor(replay.chunks);
    this.chaosCursor = new ReplayChaosCursor(replay.chunks);
  }

  update(_time: number, deltaMs: number) {
    const inputs = this.inputCursor.frameAt(this.world.tick);
    const chaos = this.chaosCursor.eventAt(this.world.tick);
    if (chaos) this.world.queueChaos(chaos.modifierId);
    this.world = World.step(this.world, inputs, FIXED_STEP_MS).state;
    this.renderer.draw(this.world);
  }
}
```

The replay never touches `client/src/net/`. No prediction, no
reconciliation, no transport. Pure sim + pure render. This is
exactly Doom's playback model.

### 4. Spectator = replay with delay

Live spectator is the same code path with a sliding 2-second buffer:

```ts
// server/src/matchHost.ts — outbound spectator stream
publishSpectatorChunk() {
  const chunk = this.recorder.takeChunk(this.world.tick - DELAY_TICKS);
  this.server.publish(`spec:${this.matchId}`, encode(chunk));
}
```

Spectator client subscribes to the topic, accumulates chunks, runs
the same `ReplayScene` logic with a 2s delay. No new code path.

### 5. Replay scrubbing — the Quake `seekto` problem

You cannot scrub inside an input-replay; you must re-simulate from
the start. Solution: capture **keyframe snapshots** every 10s into
the replay file as *non-canonical* hints.

```ts
type ReplayKeyframe = {
  atTick: Tick;
  worldState: WorldState;        // full snapshot
};

type ReplayFile = {
  header: ReplayHeader;
  chunks: ReplayChunk[];
  keyframes: ReplayKeyframe[];   // optional, for scrubbing only
};
```

When the user scrubs to T, find the latest keyframe ≤ T, hydrate
the World from it, fast-forward inputs from keyframe.atTick to T.
Worst-case fast-forward: 600 ticks at 10s keyframe spacing — runs
in ~50ms in V8, instant for the user.

If a keyframe is corrupted or missing, fall back to scrub-from-zero.

### 6. Replays as the desync debugger

The same recording is the killer feature for debugging
client/server divergence. When `game-sim-determinism` flags a
divergence, the client uploads its local input log. The server
replays both: server's log of what it accepted vs client's log of
what it sent. Diff the InputFrames.

```ts
// server/src/__tests__/replay-replay.test.ts
test('server replay matches its own live result', () => {
  const live = runMatchLive(scriptedInputs);
  const recorded = recordMatch(scriptedInputs);
  const replayed = playReplay(recorded);
  expect(replayed.finalState).toEqual(live.finalState);
});
```

Add this to the existing `sim-tests` regimen.

## Anti-patterns

- **Recording WorldState snapshots as canonical.** Bandwidth
  explodes, file size explodes, and you've coupled the replay
  format to the sim's internal representation forever.
- **Letting Math.random() into the sim.** The replay desyncs the
  moment a chaos roll, draft offer, or projectile spread uses
  non-seeded RNG. See `game-sim-determinism`.
- **Storing replays in Convex live tables.** They're cold blobs.
  Use Convex storage (`ctx.storage.store`), not a doc table.
- **Replay playback that imports `client/src/net/`.** Net code
  doesn't exist in replay land. There's no server, no prediction.
  Wire up `ReplayScene` directly to the sim.
- **Trying to play a replay across protocol versions.** Reject
  with a clear error. Promising "best-effort cross-version
  playback" is a forever bug source.
- **Blocking match end on Convex replay save.** Players want to
  see "GG" and a results screen, not a spinner. Save async.
- **Forgetting chaos rolls in the recording.** Chaos modifier
  selection is non-input-derived state — it must be in the
  replay file or playback will roll a different modifier.

## Pre-flight checklist

- [ ] `ReplayHeader.protocolVersion` checked on playback; refuses
      cross-version.
- [ ] Recording is fire-and-forget — never blocks the match host.
- [ ] Recording captures: player IDs, names, archetypes, map,
      seed, all input frames per player, all chaos rolls.
- [ ] Playback runs entirely from `client/src/sim/` + render — no
      net imports.
- [ ] Spectator stream uses the same chunk format with a fixed
      delay.
- [ ] Keyframes (every 10s) included as optional scrubbing aids.
- [ ] At least one regression test runs a recorded match through
      `playReplay` and asserts equal final state.
- [ ] Convex replay storage uses the storage API, not a live
      table.
- [ ] No `Math.random()` in the sim. RNG goes through
      `state.rngState` and is reproducible from `startSeed`.

## Source

- Quake .DEM format reference (gamers.org):
  https://www.gamers.org/dEngine/quake/Qdem/dem-1.0.2-3.html
- Quake III demo file specification:
  http://www.elho.net/games/q3/q3dspecs.htm
- Glenn Fiedler, "Snapshot Interpolation":
  https://gafferongames.com/post/snapshot_interpolation/
- Glenn Fiedler, "Snapshot Compression":
  https://gafferongames.com/post/snapshot_compression/
- Glenn Fiedler, "State Synchronization":
  https://gafferongames.com/post/state_synchronization/
---
name: roguelite-draft-design
description: >
  Card-draft economy, rarity curves, synergy density, telemetry-driven
  balance. Use when adding cards to client/src/sim/data/cards.ts,
  changing draft offer count, weighting rolls, or anything that mutates
  WeaponBuild over a multi-round match. Also use when reviewing why
  Card X feels mandatory or Card Y is never picked.
version: 1.0.0
---

# Rogue-lite Draft Design

## Why this skill exists

JAKESJAM's pivot is "io-style always-on world + rogue-lite card-draft
progression". The draft loop (lose round → roll 3 cards → pick 1)
*is* the meta-game. Get it wrong and matches feel either snowball-y
(losers stay losing) or homogenous (everyone picks the same 2 cards).
Mega Crit and Tom Cadwell have already published exactly how to keep
a draft alive over hundreds of runs without per-card hand-tuning.
This skill encodes their methodology against `sim/data/cards.ts`.

## The hard line

**Balance with telemetry, not vibes. Cap any card's pick rate at
≈55% of offers and any card's banish/skip rate at ≈55% — anything
outside that band is broken and ships a balance patch in the next
build, not "next sprint".**

## What the KOL says

**Anthony Giovannetti, "Slay the Spire: Metrics Driven Design and
Balance"** (GDC 2019). Mega Crit shipped weekly balance patches for a
year of Early Access using a single dashboard:

> "We look at win-rate per card and pick-rate per card. If a card is
> picked >55% of the time it's offered, it's too strong. If it's
> picked <15%, it's too weak. We do not balance cards in isolation —
> we balance the offer pool."
> — Giovannetti, GDC 2019 (slides p. 18–24)

Their secondary rule: **never nerf a fun card, buff its competition
instead**. Player perception of "patches make my deck worse" is the
churn killer.

**Tom Cadwell, "Level Up Your Game: The Untapped Potential of
Roguelikes"** (GDC 2017, Riot Games). Cadwell argues mastery comes
from *variance you can plan around*, not pure RNG:

> "Players need to feel they shaped the run. If RNG dominates, every
> defeat is the system's fault. If skill dominates, the genre
> collapses. Aim for ~70% skill expression / 30% variance per pick."
> — Cadwell, GDC 2017

## How JAKESJAM applies it

Concrete files and shapes:

- `client/src/sim/data/cards.ts` — the card definitions. Currently
  flat — needs `rarity`, `tags`, `weight`.
- `client/src/sim/data/cardTypes.ts` — `CardDef` shape. Add
  `rarity: 'common' | 'uncommon' | 'rare' | 'mythic'` and
  `weight: number`.
- `client/src/sim/data/weaponBuild.ts::createWeaponBuild` — applies
  cards to the base weapon. The unit test boundary for synergy.
- `client/src/sim/round.ts::stepRound` — `drafting` phase rolls
  offers. The roll function lives here and reads from `cards.ts`.
- `client/src/game/ui/CardDraftOverlay.ts` — display only. Rarity
  must be visually distinct (color border, particle aura).
- Telemetry: post draft-offer + draft-pick events to Convex via
  `convex/matches.recordDraftEvent` for the dashboard. Fire and
  forget — never block the draft phase on Convex.

`DRAFT_OFFER_COUNT = 3`. Keep it at 3. Cadwell's research: 3 is the
sweet spot for choice paralysis vs meaningful agency. Slay the Spire
also uses 3.

## Recipes

### 1. Rarity-weighted offer rolls (deterministic)

```ts
// client/src/sim/round.ts (in drafting phase)
import { rngNext } from './rng';
import { CARDS } from './data/cards';

const RARITY_WEIGHTS = {
  common:   60,
  uncommon: 30,
  rare:      9,
  mythic:    1,
} as const;

function rollDraftOffers(
  state: WorldState,
  playerId: PlayerId,
): readonly CardId[] {
  const owned = new Set(state.players[playerId].cards.map(c => c.id));
  const eligible = CARDS.filter(c => !c.unique || !owned.has(c.id));

  const offers: CardId[] = [];
  for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
    const totalWeight = eligible
      .filter(c => !offers.includes(c.id))
      .reduce((s, c) => s + (c.weight ?? 1) * RARITY_WEIGHTS[c.rarity], 0);
    const r = rngNext(state) * totalWeight;
    // ... walk eligible list, pick when cumulative > r
    offers.push(picked);
  }
  return offers;
}
```

RNG MUST go through `state.rngState` via `rngNext()` — never
`Math.random()`. See `game-sim-determinism`.

### 2. The "pity timer" — Cadwell's variance shaping

A player who hasn't seen a `rare` in 4 drafts gets one of their next
3 offers slot-promoted. Stops the "I never see good cards" feedback
loop without breaking RNG determinism (the pity counter is part of
`PlayerEntity`).

```ts
// In PlayerEntity:
draftsSinceRare: number;

// In rollDraftOffers, after picking each offer:
if (state.players[playerId].draftsSinceRare >= 4 && offer.rarity === 'common') {
  // Re-roll this slot at rare+ tier
  offer = rollAtMinimumRarity(state, 'rare', eligible);
}
```

### 3. Synergy tags, not stat soup

Every card declares 1–3 `tags`. WeaponBuild gives a small "synergy
bonus" (5–10% damage) when 3+ cards share a tag. Players see the tag
chip on the card and *plan* around it. This is Cadwell's "70% skill
expression" pattern.

```ts
// client/src/sim/data/cardTypes.ts
export type CardTag = 'fire' | 'pierce' | 'aoe' | 'rapid' | 'heavy'
  | 'mobility' | 'sustain' | 'control';

export type CardDef = {
  id: CardId;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
  weight: number;       // base sample weight inside its rarity bucket
  tags: readonly CardTag[];
  unique: boolean;
  // ... existing fields
};
```

### 4. Telemetry hook — pick rate per offer slot

```ts
// On draft commit, after the sim step:
void convexClient.mutation(api.draft.recordDraftEvent, {
  matchId, roundIndex, playerId,
  offers: offerIds,        // 3-tuple
  picked: pickedId,        // 1 of the 3
  ownedCardCount: state.players[playerId].cards.length,
});
```

Dashboard query: `pickRate(card) = picks / offerings`. Bucket by
`ownedCardCount` so you can see "Card X is picked 80% in opening
draft, 10% in late draft" — that's a knowledge problem, not a
balance problem, and the fix is signposting, not a nerf.

### 5. The "loser bonus" — anti-snowball without rubber-banding

Slay the Spire doesn't have it (single-player), but JAKESJAM is PvP.
Mega Crit's metric-driven mindset says: don't guess, measure. Track
`comebackRate` (rounds won by the player currently behind on score).
If it sits below 25%, the loser draft pool needs +1 offer. If above
45%, drop back to 3. No hand-tuning of individual cards.

```ts
// client/src/sim/round.ts
const offerCount = playerIsBehind(state, playerId)
  ? DRAFT_OFFER_COUNT_BEHIND   // start at 3, telemetry decides
  : DRAFT_OFFER_COUNT;
```

Keep both constants in `sim/constants.ts`. Adjust between matches
(via Convex feature flag) without redeploying the sim.

### 6. The 12-card opening pool

Per `AGENTS.md`: "first card pool should be small, around 12 cards."
Giovannetti's GDC slides confirm: a small, well-tuned pool beats a
big, untuned one. Lock the MVP at 12 commons with 4 tags (3 cards
per tag), no rarities yet. Add rarity tiers only after telemetry
shows clean pick-rate data.

## Anti-patterns

- **Adding a card with `+5% damage` and no tag.** It picks 99% of
  the time on every weapon — Slay the Spire's classic "Strength"
  trap. Either give it a downside or restrict by weapon archetype.
- **Nerfing a fun card.** Buff its competition. Players forgive
  power creep, they don't forgive "my favorite card got worse".
- **Letting a `unique: true` card roll twice in one draft.** Player
  loses an offer slot. Filter `owned` cards in the roll function.
- **Calling `Math.random()` anywhere in the draft logic.** Sim
  determinism dies, replays diverge.
- **Drafting from `OnlineMatchScene` directly.** Drafting is a sim
  phase. The scene reads `state.round.phase === 'drafting'` and
  shows `CardDraftOverlay`. The actual roll happens in the sim,
  same on server and client.
- **Auto-pick on disconnect/timeout that's silent.** Tell the
  player the game picked for them and *which* card it picked.
  Mega Crit's data: silent forced choices are the #1 rage-quit
  trigger.
- **>5 offers.** Choice paralysis kills the rhythm. Cadwell and
  Mega Crit both land on 3.

## Pre-flight checklist

- [ ] Every new card has `rarity`, `weight`, `tags`, `unique`
      explicitly set.
- [ ] Card pool fits the MVP cap (~12) until telemetry justifies
      expansion.
- [ ] Draft roll calls `rngNext(state)`, not `Math.random()`.
- [ ] `unique: true` cards filtered out of offers when already
      owned.
- [ ] Draft offer + pick telemetry posted to Convex (non-blocking).
- [ ] No card grants a flat unconditional buff with no opportunity
      cost.
- [ ] At least 2 cards in the pool actively *counter* the most
      common build (anti-rapid, anti-heavy, etc.).
- [ ] CardDraftOverlay surfaces the tag chips so synergy is
      legible to first-time players.
- [ ] Pity timer (`draftsSinceRare`) is part of `PlayerEntity` and
      survives serialization/snapshot delta.

## Source

- Anthony Giovannetti, "'Slay the Spire': Metrics Driven Design and
  Balance" — GDC 2019. Slides:
  https://media.gdcvault.com/gdc2019/presentations/Giovannetti_Anthony_SlayTheSpire.pdf
- Video: https://www.youtube.com/watch?v=7rqfbvnO_H0
- Tom Cadwell, "Level Up Your Game: The Untapped Potential of
  Roguelikes" — GDC 2017.
  https://www.gdcvault.com/play/1022119/Level-Up-Your-Game-The
---
name: onboarding-ftue
description: >
  First-time-user experience for the io-style always-on JAKESJAM lobby
  and first match. Use when editing client/src/game/scenes/MainMenuScene.ts,
  BootScene.ts, the lobby Convex flow, or anything a brand-new player
  sees before their first kill. Triggered by "tutorial", "onboarding",
  "FTUE", "first match", "new player".
version: 1.0.0
---

# Onboarding & First-Time-Player Experience

## Why this skill exists

JAKESJAM's planned io-style flow is "land on URL → name yourself → in
a match in <10 seconds". That's the *strength* of the genre, but it
puts the entire teaching burden on the first 60 seconds of gameplay.
There is no time for a 5-minute scripted tutorial, and forced
tutorials in PvP shooters churn 20–40% of new players (GMTK survey
data + Steam refund cohorts). Mark Brown has already published the
exact decision tree for "do I make a tutorial?" and "if so, what
shape?". This skill encodes it for JAKESJAM's specific shape.

## The hard line

**No modal tutorial. No "press WASD to move" overlay. Teach inside
the first match via designed encounters and progressive disclosure.
Every mechanic the player can do in round 1 must be discoverable in
round 1 — without text — by a player who has never read a games
journalism article in their life.**

## What the KOL says

**Mark Brown, Game Maker's Toolkit**, has 10+ years of tutorial-design
videos. The core rules across the series:

> "The best tutorials are levels. They aren't pop-ups. They aren't
> arrows. They're *spaces designed so that the only thing you can
> do is the thing you need to learn*."
> — Mark Brown, multiple GMTK videos on tutorial design

Brown's tutorial heuristics (paraphrased from the GMTK back catalogue
and his "10 Game Design Lessons from 10 Years of GMTK" recap):

1. **Teach mechanics in their context of use** — never on a blank
   plain.
2. **Use Mario 1-1 framing** — present the danger, present the
   tool, let the player connect them.
3. **One mechanic per encounter.** Don't teach "double jump while
   shooting while parrying".
4. **No text until the player has tried.** Reward discovery; only
   *confirm* with text after the fact.
5. **Cut anything you'd describe as 'optional reading'.** If they
   skip it, they skip it forever.

JAKESJAM cannot use Brown's preferred technique (single-player
designed encounters) because round 1 is PvP. So we adapt: **the
*lobby* is the tutorial, and the first match drops the player into
a deliberately easy bot warmup if it's their first session.**

## How JAKESJAM applies it

Concrete files:

- `client/src/game/scenes/MainMenuScene.ts` — first thing they see.
  Currently asks for a name + room code. Add the auto-spawn movement
  playground BEHIND the menu (visible while typing).
- `client/src/game/scenes/BootScene.ts` / `PreloadScene.ts` — the
  asset load. Cover it with a kinetic title that demonstrates a
  rocket arc and an explosion. The loading screen *is* the trailer.
- `convex/users.ts` — needs a `firstSessionAt` timestamp so the
  match-maker can detect "this player has never played". On detect,
  matchmaker queues them into a bot-only match for 90s before real
  matchmaking.
- `client/src/game/scenes/OnlineMatchScene.ts` — show the controls
  legend ONLY in round 1, ONLY for new players, ONLY in the first
  3 seconds of the round. Auto-fades.
- `client/src/game/ui/CardDraftOverlay.ts` — first draft ever shows
  one extra line: "Pick one. Stacks for the rest of the match."
  Then never shows it again.

## Recipes

### 1. The "playground in the menu"

```ts
// client/src/game/scenes/MainMenuScene.ts
create() {
  // The menu is layered ON TOP of a tiny live sim instance.
  this.playground = new MenuPlayground(this, {
    width: 640, height: 360,
    botCount: 2,
    map: 'boxworks-mini',
  });
  this.playground.start();   // bots fight bots in the background

  this.add.text(...);        // menu UI on top
}
```

The player picks up movement and shooting *visually* before they
ever click "Find Match". This is Brown's "show, don't tell" applied
at the front door.

### 2. First-session bot warmup

```ts
// convex/matchmaker.ts (Convex query/mutation — lobby only,
// no 60Hz path)
export const findMatch = mutation({
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user.firstSessionAt) {
      // Mark and route to a bot match
      await ctx.db.patch(userId, { firstSessionAt: Date.now() });
      return { kind: 'bot-warmup', durationSec: 90 };
    }
    return realMatchmaker(ctx, userId);
  },
});
```

The bot warmup runs on the same Bun host using the same `MatchHost`,
but with `BotPlayer` entities seeded by the sim. Same code path. No
forked "tutorial mode" to maintain.

### 3. Progressive disclosure for HUD

```ts
// client/src/game/ui/HudSystem.ts
showFor(playerId: PlayerId, isFirstMatch: boolean) {
  this.showHealth();
  this.showAmmo();
  if (isFirstMatch) {
    this.showControlsLegend();             // fades after 3s
    this.showLegend('shoot', 0);
    this.showLegend('jump', 800);
    this.showLegend('parry', 1600);
  }
}
```

After round 1 the legend never appears again, even if the player
loses. Mark Brown's rule: *don't keep teaching after they've shown
they can do it*.

### 4. The Mario 1-1 first map

`docs/visual-overhaul` and `data/boxworks.ts` already define
Boxworks. For first-match ONLY, use `boxworks-tutorial` (a small
variant of `boxworks-mini`):

- Single elevated platform (teaches platforming).
- One destructible barrel placed where a new player will try to
  shoot it (teaches destructibles → see `phaser4-game` skill on
  visual hierarchy).
- Two health pickups in clearly opposite corners (teaches "go get
  the pickup").
- One chaos modifier locked off (don't teach 3 things at once).

Add `boxworks-tutorial` to `client/src/sim/data/maps.ts` and
register in `MapPicker.ts`. Tutorial map is server-side selected
when `kind: 'bot-warmup'` is set.

### 5. Card draft tutorial — by example

The first-ever card pick shows 3 *deliberately good and obviously
different* cards: one rapid-fire, one heavy-damage, one mobility.
The "synergy tag" chips light up so the player sees them. After
they pick, the next round's draft shows another card with the same
tag chip pre-highlighted ("synergy: matches your last pick"). This
teaches the synergy system without text.

```ts
// client/src/sim/round.ts — drafting phase
const offers = isFirstDraftEver(state, playerId)
  ? FIRST_EVER_DRAFT   // hand-picked deterministic 3
  : rollDraftOffers(state, playerId);
```

`FIRST_EVER_DRAFT` lives in `sim/data/cards.ts` as a constant — it
doesn't break determinism (same input → same output).

### 6. Death screen as the teacher

Most learning in PvP happens on the death screen — they have
attention, they're frustrated, they want to know why. Use it.

```ts
// client/src/game/ui/DeathOverlay.ts
showCauseOfDeath({
  killer, weapon, distance, dodgeAvailable
}: DeathCause) {
  this.show(`Killed by ${killer.name} — ${weapon.name}`);
  if (dodgeAvailable && distance > NEUTRAL_RANGE_TILES) {
    this.show('You could have dodged this projectile.');
  } else if (weapon.kind === 'parry-vulnerable') {
    this.show('Hold SHIFT next time to parry.');
  }
  // ... never more than one tip per death.
}
```

One tip per death. Brown: "if you give them three, they read zero."

## Anti-patterns

- **A modal "Press WASD to move" overlay.** Players close it. They
  never read it. They wonder why the game feels slow.
- **A separate single-player tutorial scene.** Forks the codebase,
  rots, and the bot AI in it diverges from the real bot AI used
  in matches.
- **A "Skip Tutorial" button.** If you're offering it, the
  tutorial is wrong. Brown: "the only good tutorial is the one
  you can't tell is a tutorial."
- **Showing every keybinding at once.** Brown's "one mechanic per
  encounter" rule. Stagger them.
- **Re-showing the controls legend on round 2.** They learned it.
  Stop nagging.
- **Treating Convex `firstSessionAt` as authoritative for combat
  decisions.** It's a lobby flag — the match host trusts the
  matchmaker payload, doesn't re-query Convex inside the 60Hz loop.
- **Designing the tutorial map to be "balanced".** It should be
  *stacked toward the new player learning a thing*, not a fair
  duel.

## Pre-flight checklist

- [ ] No modal popup blocks the game on first launch.
- [ ] Menu shows live gameplay behind it (the playground).
- [ ] Convex matchmaker routes new users (no `firstSessionAt`) to
      a bot warmup.
- [ ] First match uses `boxworks-tutorial`, no chaos modifier.
- [ ] HUD legend appears only in round 1, fades after 3s.
- [ ] First-ever card draft offers a hand-picked, tag-diverse trio.
- [ ] Death overlay surfaces ONE specific tip — never three.
- [ ] No "Skip Tutorial" button anywhere.
- [ ] Playtest with a player who has never seen JAKESJAM. They
      get a kill in round 1 or 2.

## Source

- Game Maker's Toolkit channel (Mark Brown):
  https://www.youtube.com/channel/UCqJ-Xo29CKyLTjn6z2XwYAw
- "10 Game Design Lessons from 10 Years of GMTK" (the recap of
  Brown's recurring rules):
  https://www.youtube.com/watch?v=Cm2_drGLGbc
- "How To Think Like A Game Designer":
  https://www.youtube.com/watch?v=iIOIT3dCy5w
- Brown's site (back catalogue index):
  https://gamemakerstoolkit.com/
---
name: fly-game-deploy
description: >
  Fly.io deployment patterns for JAKESJAM's stateful Bun game server. Use
  when editing fly.toml, server/Dockerfile, the deploy:server:* npm scripts,
  health check handlers, or anything involving: flyctl, fly apps create,
  fly secrets, primary_region, auto_stop_machines, min_machines_running,
  multi-region game server topology, syd/sjc/fra app naming, GAME_SERVER_SECRET,
  or matchmaker → host URL routing. Skip for client (Vite) deploys and
  Convex deploys (use convex skills for those).
---

# Fly.io Deploy — Stateful Game Server

The game server is **stateful per match** — once a `MatchHost` is hosting players, you cannot move it to another machine. Fly's defaults (auto-stop on idle, autoscale based on CPU) actively fight that. Configure deliberately.

## Required fly.toml shape

```toml
app = "jakesjam-srv-syd"
primary_region = "syd"

[build]
  dockerfile = "server/Dockerfile"

[env]
  PORT = "8080"
  REGION = "syd"
  NODE_ENV = "production"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false        # ← stateful: NEVER let Fly stop us
  auto_start_machines = true        # ← but allow cold-start on first req
  min_machines_running = 1
  processes = ["app"]

[[http_service.checks]]
  grace_period = "10s"
  interval = "10s"
  method = "get"
  path = "/health"
  protocol = "http"
  timeout = "2s"

[[vm]]
  cpu_kind = "shared"               # bump to dedicated for >50 CCU per VM
  cpus = 1
  memory_mb = 512
```

The non-obvious bits:
- `auto_stop_machines = false` is mandatory. If Fly stops a VM mid-match, the match is dead — there's no migration story for in-flight WS connections.
- `min_machines_running = 1` keeps a warm host so first-match latency is OK. Bump per region as concurrent matches grow.
- The `/health` handler in `server/src/index.ts` should be **cheap**: respond `200` if the process is up. Don't gate on Convex reachability — health checks shouldn't fail because of an upstream blip.

## Multi-region pattern (one app per region)

We deploy **one Fly app per region**, not one app with `regions = [...]`. Reason: matchmaker routes a client to a specific region's app, and per-app secrets/scaling/observability stay clean.

```bash
flyctl deploy --config fly.toml --app jakesjam-srv-syd  --region syd
flyctl deploy --config fly.toml --app jakesjam-srv-sjc  --region sjc
flyctl deploy --config fly.toml --app jakesjam-srv-fra  --region fra
```

The `app` field in fly.toml is a default; `--app` overrides at deploy time. Naming convention: `jakesjam-srv-<3-letter-region>`.

## First-time region setup

```bash
flyctl apps create jakesjam-srv-<region>
flyctl secrets set --app jakesjam-srv-<region> \
  GAME_SERVER_SECRET=<from password manager> \
  CONVEX_URL=https://<deployment>.convex.cloud
flyctl deploy --config fly.toml --app jakesjam-srv-<region> --region <region>
```

`GAME_SERVER_SECRET` is the HMAC key the server uses to verify match tickets issued by Convex (`server/src/auth.ts`). It **must match** the secret stored in Convex env (`bunx convex env set GAME_SERVER_SECRET …`). If they drift, every WS upgrade 401s.

## Matchmaker → host URL flow

1. Client calls a Convex action (`createOrJoinMatch`) and receives `{ matchId, hostUrl, ticket }`.
2. `hostUrl` is `wss://jakesjam-srv-<region>.fly.dev/match` based on the player's geolocated region (or chosen by lobby).
3. Client opens a WS to `hostUrl` with the `ticket` in the protocol handshake. Server verifies the HMAC, attaches `{ matchId, playerId }` to `ws.data`, joins the topic.

The server **never** publishes its URL — Convex is the registry. To add a region, add an app + deploy + add the region to the matchmaker's region list.

## What to check before a production deploy

- `bun run typecheck` clean across client / server / convex.
- `bun run --filter server test` (if any server-only tests exist) clean.
- `flyctl status --app jakesjam-srv-<region>` shows the current machine healthy.
- `flyctl logs --app jakesjam-srv-<region>` for the last 1–2 mins shows no error spam.
- Active match count is 0 (or you have buy-in to interrupt). Check via Convex query, not by guessing.

## Rollback

`flyctl releases --app jakesjam-srv-<region>` lists prior images. `flyctl deploy --image <prior-image-ref> --app …` redeploys an old build instantly. Safer than re-building old code.

## Anti-patterns (don't do these)

- ❌ `auto_stop_machines = true` on the game server. Mid-match shutdown = dead match.
- ❌ Putting `regions = [a, b, c]` in fly.toml under one app. The matchmaker can't route to a specific region that way.
- ❌ Reading `GAME_SERVER_SECRET` from anywhere except Fly secrets in prod and `.env.local` in dev. Don't commit it; don't put it in `[env]`.
- ❌ Heavy `/health` handlers (DB ping, Convex query). Health checks must be cheap and local.
- ❌ Shipping a deploy mid-match without confirming. Auto mode is not a license here — confirm `match.activeCount` first.
- ❌ Using `flyctl deploy` without `--config` in this repo. Multiple region apps share `fly.toml`; ambiguity breaks deploys.

## References

- [Fly.io WebSockets docs](https://fly.io/docs/networking/websockets/)
- [Fly.io scaling — auto_stop / auto_start semantics](https://fly.io/docs/launch/autostop-autostart/)
- [Fly.io health checks](https://fly.io/docs/reference/configuration/#http_service-checks)
- See also: project `bun-ws-server` skill (server-side WS patterns) and `game-netcode` skill (matchmaker → host handshake).
---
name: improve-codebase-architecture
description: Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language gives names to good seams; ADRs record decisions the skill should not re-litigate.

## Process

### 1. Explore

Read the project's domain glossary and any ADRs in the area you're touching first.

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and also in how tests would improve

**Use CONTEXT.md vocabulary for the domain, and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly (e.g. _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md` — same discipline as `/grill-with-docs` (see [CONTEXT-FORMAT.md](../grill-with-docs/CONTEXT-FORMAT.md)). Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones. See [ADR-FORMAT.md](../grill-with-docs/ADR-FORMAT.md).
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).

===============================================================================
                    BOUNDARY SUMMARY
===============================================================================

client/src/sim/        → game-sim-determinism
client/src/net/        → game-netcode
client/src/game/       → phaser4-game
client/src/sim/data/   → combat-balance-ttk, roguelite-draft-design
server/src/            → game-netcode, fly-game-deploy
convex/                → convex-quickstart, convex-setup-auth, etc.
infrastructure         → improve-codebase-architecture

## Anti-patterns

- **Pausing the sim for hit-stop.** It will desync from the server.
  Render-tween freeze only.
- **One global "play impact" function with no parameters.** Nijman's
  rule: bigger actions need bigger reactions. A pistol pop ≠ a
  rocket impact ≠ a kill.
- **Calling `cameras.main.shake()` from inside `World.step()` or
  `sim/combat.ts`.** The sim is shared with the Bun server — Phaser
  does not exist there. Compile error if you're lucky, silent dead
  code if you're not.
- **Stacking shakes that override each other.** Last-write-wins in
  Phaser, so a tiny footstep can clobber a kill. Route through a
  bus with `if (intensity > current)`.
- **No pitch variance on SFX.** The `Scrap Rifle` at 5 RPS becomes
  unbearable inside 10 seconds.
- **Adding particles to `client/src/sim/projectile.ts`.** Particles
  are render. The sim emits *events*; render decides what to do
  about them.
- **Skipping juice on the draft phase because "it's a menu".** The
  draft IS the rogue-lite payoff loop. A flat draft kills retention.

## Pre-flight checklist

- [ ] Every event in `StepResult.events` has a render-layer handler
      with at least 3 channels firing.
- [ ] No call to `cameras`, `tweens`, `add.particles`, or
      `Math.random()` inside any file under `client/src/sim/`.
- [ ] Shake amplitudes use the named buckets (`0.004` … `0.030`).
- [ ] All `audio.play()` calls have `rate` jitter unless explicitly
      a music or UI tone.
- [ ] Hit-stop only freezes `tweens.timeScale`, never anything that
      affects sim tick rate or input feed.
- [ ] Card-draft confirm has a screen flash + camera kick + SFX.
- [ ] A kill produces hit-stop + shake + burst + flash + 2 SFX +
      camera kick (for the killer).
- [ ] Tested on `OnlineMatchScene` (not just `MatchScene`) — net
      events route through `RenderHost`, easy to forget one.

## Source

- Jan Willem Nijman, "The Art of Screenshake" — INDIGO Classes 2013.
  https://www.youtube.com/watch?v=AJdEqssNZ-U
- Mirror + slides: https://archive.org/details/the-art-of-screenshake
- Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
  Sensation", Morgan Kaufmann, 2008. Chapter 1 PDF:
  http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf
- Reference reimplementation of the demo:
  https://github.com/colinbellino/screenshake
---
name: ts-pocock;

// Camera
this.scene.cameras.main.position.x += plopX;
this.scene.cameras.main.position.y += plopY;

// Impact object (if any)
if (this.impactSprite) {
  this.impactSprite.x += plopX;
  this.impactSprite.y += plopY;
}

// Quick lerp back
this.scene.tweens.add({
  targets: this.scene.cameras.main,
  x: 0, y: 0,
  duration: 30,  // Very fast, subtle
  ease: 'Back.easeOut',
});
```

### 12. Camera Lerp After Shake (Nijman's \#7)

After a big shake ends, the camera should **ease back** with a slightly over-corrected lerp. Creates a "heavy" camera feel.

```ts
// After kill shake (in the 80ms delayed callback):
this.scene.time.delayedCall(80, () => {
  // Instead of just:
  this.scene.tweens.timeScale = 1;
  
  // Add camera lerp with overcorrection
  const targetX = this.scene.cameras.main.x;
  const targetY = this.scene.cameras.main.y;
  this.scene.tweens.add({
    targets: this.scene.cameras.main,
    x: targetX, y: targetY,
    duration: 140,
    ease: 'Back.easeOut',  // Overcorrect
  });
});
```

### 13. Depth Vignette (not color flash)

**Vignette** vs **Color Flash**: Color flash is an overlay at depth 900+ (like normal Phaser graphics). Vignette is a *full-screen rectangle* that darkens the edges (like a flashlight effect).

```ts
// Create a depth 900 vignette sprite for impact:
this.impactVignette = this.add.rectangle(
  this.scene.cameras.main.width / 2,
  this.scene.cameras.main.height / 2,
  this.scene.cameras.main.width,
  this.scene.cameras.main.height,
  0x000000,
  0.08,  // Darker vignette for big hits
).setDepth(900);  // Behind main sprites

// Animate it fade out:
this.scene.tweens.add({
  targets: this.impactVignette,
  alpha: 0,
  duration: 400,
  ease: 'Power2.easeOut',
});
```

### 14. Motion Trail on Fast Projectiles

When a **fast projectile** (>=300 px/sec) creates an impact, leave a visible **1-2 frame trail**. Gives the feeling of momentum.

### 15. Speed Lines on Hard Camera Shake

When camera shake is hard (**>=0.012** intensity), add temporary **speed line overlays**. Classic anime effect.

### 16. Combo Counter Pop

If JAKESJAM tracks combos, when a hit confirms: create two quick scale pulses.

### 17. Temporal Bloom

After **3 quick consecutive hits** (within 700ms), bloom **builds up slightly** on the impact area before dissipating. Creates a "combo heat" effect.

### 18. Per-Particle Velocity Scatter

Not just random positions, but random **velocities** - simulates particles "spreading outward" from the impact like real debris.

### 19. Variable Burst Count

Natural feel: don't fire **exactly** 24 particles, fire **18-30** with slight +-/4 variance.

### 20. "Sleep Frames" on Kill (Nijman's \#11)

After a kill, the victim sprite stays in its death pose for **1 extra frame** before dissappearing. A tiny "permanence" effect.

### 21. Elasto-Kinetic Bounce (visual spring)

When a hit connects, the target **physically bounces** a few pixels back (visual only, sim still runs).

### 22. Multi-Directional Impact "Plop"

Not just camera plop, but a **multi-axis** plop.

### 23. Proportional Shake per Mass

Bigger impacts = heavier objects = different shake behavior. Use mass/size-based shake scaling.

### 24. Hit "Pop" (subtle object rotation)

The hit object **rotates slightly** on impact, then dampens back.

### 25. Variable "Feel Level" per Event

Not all events need equal juice. Use a **level budget**:

```ts
// Event-based feel levels:
const feelLevels = {
  'kill': 'heavy',  // Full juice stack
  'impact': 'medium',  // Medium stack
  'projectileSpawn': 'light',  // Light stack
  'cardPick': 'medium',
  'chaosRoll': 'light',
};

function applyFeelStack(event: string) {
  const level = feelLevels[event] || 'medium';
  switch(level) {
    case 'heavy':
      // Hit-stop + shake + burst + flash + 2SFX + kick + plop
      break;
    case 'medium':
      // Shake + burst + flash + SFX
      break;
    case 'light':
      // Burst + SFX (maybe no shake)
      break;
  }
}
```

### 26. Audio Tail Decay

Sounds don't just "stop" - they **decay** with a tail. Add 5-10% extra tail for "bigger" feel.

### 27. Frequency Ducking on Big Impact

Temporarily **duck other sounds** after a big hit to emphasize the impact.


---

## Complete Feel Effect Checklist (Nijman's 30+)

| \# | Effect | In Current | Missing | Implementation |
|---|---|---|---|---|
| 1 | **Permanence** | Partial | \u2705 | `sleepFrames` on kill |
| 2 | **Bigger Explosions** | Partial | \u2705 | `multiLayerParticles` |
| 3 | **Impact Effects** | Partial | \u2705 | `elastoKineticBounce` \+ `rotation` |
| 4 | **Screen Shake** | \u2705 | | Already done |
| 5 | **Muzzle Flash** | Partial | \u2705 | `depthVignetteFlash` |
| 6 | **Screen Freezing** | \u2705 | | Already done (`timeScale`) |
| 7 | **Camera Lerp** | Partial | \u2705 | `cameraLerp()` helper |
| 8 | **Camera Kick** | \u2705 | | Already done (`cameraKick()`) |
| 9 | **Recoil** | Partial | \u2705 | `elastoKineticBounce` |
| 10 | **Enemy Hit-Flashes** | \u2705 | | Already done (`flashRig()`) |
| 11 | **Permanent Corpses** | Partial | \u2705 | `sleepFrames` |
| 12 | **Sleep Frames** | Partial | \u2705 | `sleepFrames` implementation |
| 13 | **Knockback** | \u2705 | | Already done |
| 14 | **Speed Lines** | Partial | \u2705 | `speedLines` overlay |
| 15 | **Tweened Spawning** | \u2705 | | Already done |
| 16 | **Random Pitch** | \u2705 | | Already done |
| 17 | **Multi-Layer Particles** | Partial | \u2705 | **NEW: 3-layer approach** |
| 18 | **RGB Split** | \u274c | \u2705 | **NEW** |
| 19 | **Motion Trails** | Partial | \u2705 | **NEW** |
| 20 | **Z-Depth Fog** | \u274c | \u2705 | **NEW** |
| 21 | **Depth Vignette** | Partial | \u2705 | **NEW** |
| 22 | **Temporal Bloom** | \u274c | \u2705 | **NEW** |
| 23 | **Combo Pop** | \u274c | \u2705 | **NEW** |
| 24 | **Audio Tail** | Partial | \u2705 | **NEW** |
| 25 | **Freq Ducking** | \u274c | \u2705 | **NEW** |
| ...| ... | ... | ... | ... |

The **core missing pieces** are:
- Multi-layer particle bursts (Nijman's explicit 3 types)
- Per-particle velocity-based scatter
- RGB chromatic aberration on critical hits
- Temporal bloom "heat" buildup
- Z-depth fog/vignette
- Elasto-kinetic bounces
- More natural variable burst counts

### High Priority for JAKESJAM

Given JAKESJAM's aesthetic (dark \+ cyan, 1v1 shooter), prioritize:

1. **Multi-layer particles** - Critical for the "explosive" feel
2. **Elasto-kinetic bounce** - Adds weight, easy to implement  
3. **Camera lerp after shake** - Heavy camera feel, simple
4. **RGB split on super hits** - Stylistic, matches cyberpunk theme
5. **Motion trails on fast projectiles** - Adds speed feel
6. **Z-depth vignette** - Adds depth perception
7. **Variable burst count** - Naturalizes particle systems
8. **Temporal bloom** - Combo feel
## Anti-patterns

- **Pausing the sim for hit-stop.** It will desync from the server.
  Render-tween freeze only.
- **One global "play impact" function with no parameters.** Nijman's
  rule: bigger actions need bigger reactions. A pistol pop ≠ a
  rocket impact ≠ a kill.
- **Calling `cameras.main.shake()` from inside `World.step()` or
  `sim/combat.ts`.** The sim is shared with the Bun server — Phaser
  does not exist there. Compile error if you're lucky, silent dead
  code if you're not.
- **Stacking shakes that override each other.** Last-write-wins in
  Phaser, so a tiny footstep can clobber a kill. Route through a
  bus with `if (intensity > current)`.
- **No pitch variance on SFX.** The `Scrap Rifle` at 5 RPS becomes
  unbearable inside 10 seconds.
- **Adding particles to `client/src/sim/projectile.ts`.** Particles
  are render. The sim emits *events*; render decides what to do
  about them.
- **Skipping juice on the draft phase because "it's a menu".** The
  draft IS the rogue-lite payoff loop. A flat draft kills retention.

## Pre-flight checklist

- [ ] Every event in `StepResult.events` has a render-layer handler
      with at least 3 channels firing.
- [ ] No call to `cameras`, `tweens`, `add.particles`, or
      `Math.random()` inside any file under `client/src/sim/`.
- [ ] Shake amplitudes use the named buckets (`0.004` … `0.030`).
- [ ] All `audio.play()` calls have `rate` jitter unless explicitly
      a music or UI tone.
- [ ] Hit-stop only freezes `tweens.timeScale`, never anything that
      affects sim tick rate or input feed.
- [ ] Card-draft confirm has a screen flash + camera kick + SFX.
- [ ] A kill produces hit-stop + shake + burst + flash + 2 SFX +
      camera kick (for the killer).
- [ ] Tested on `OnlineMatchScene` (not just `MatchScene`) — net
      events route through `RenderHost`, easy to forget one.

## Source

- Jan Willem Nijman, "The Art of Screenshake" — INDIGO Classes 2013.
  https://www.youtube.com/watch?v=AJdEqssNZ-U
- Mirror + slides: https://archive.org/details/the-art-of-screenshake
- Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
  Sensation", Morgan Kaufmann, 2008. Chapter 1 PDF:
  http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf
- Reference reimplementation of the demo:
  https://github.com/colinbellino/screenshake
---
name: ts-pocock
description: Matt Pocock-style TypeScript discipline applied to JAKESJAM. Triggers when editing client/src/sim/, client/src/net/, server/src/, convex/. Enforces branded IDs, satisfies-over-as, exhaustive discriminated unions, and zero `as any` / `as unknown as` escape hatches.
---

# TS Pocock — JAKESJAM TypeScript Playbook

When editing `client/src/sim/`, `client/src/net/`, `server/src/`, or `convex/`, follow these rules. The goal is fewer runtime surprises and tighter contracts at the netcode/sim boundary where parity matters most.

## 1. Branded IDs everywhere

`PlayerId`, `EntityId`, `Tick`, `InputSeq` are branded types. `client/src/sim/types.ts` already defines them. Never let a raw `string`/`number` flow into a slot expecting one.

```ts
// ❌
const id: PlayerId = playerInfo.id; // raw string
// ✅
const id = playerInfo.id as PlayerId; // only at the trust boundary
```

When iterating `Object.keys(players)` you get `string[]`. Use the helper:

```ts
// client/src/sim/types.ts (extend if missing)
export const playerIds = (s: WorldState): PlayerId[] =>
  Object.keys(s.players) as PlayerId[];
```

## 2. `satisfies` over `as` for config literals

```ts
// ❌
const PALETTE = { health: "#f00", shield: "#0af" } as Record<string, string>;
// ✅
const PALETTE = { health: "#f00", shield: "#0af" } satisfies Record<string, string>;
```

Why: `satisfies` validates the shape *and* preserves the literal type so `PALETTE.health` is `"#f00"`, not `string`. Use this for palette, sim constants, weapon profiles, chaos modifier registries.

## 3. Discriminated unions + exhaustive switch

Protocol messages in `client/src/net/protocol.ts` and `server/src/protocol.ts` are discriminated by `t`. Every consumer must `switch (msg.t)` with a `default: const _: never = msg; throw new Error(…)`. No `as ClientMessage`, no `if (msg.t === "in") (msg as InMessage)…`.

## 4. `as const` + derived types for string-literal sets

```ts
// ❌
const CHAOS_IDS = ["lightning", "fire", "ice"];
type ChaosModifierId = string; // way too wide

// ✅
export const CHAOS_IDS = ["lightning", "fire", "ice"] as const;
export type ChaosModifierId = typeof CHAOS_IDS[number];
export const isChaosId = (v: unknown): v is ChaosModifierId =>
  typeof v === "string" && (CHAOS_IDS as readonly string[]).includes(v);
```

Use `isChaosId` instead of `as ChaosModifierId[]` casts after `JSON.parse`.

## 5. Validate at trust boundaries; trust internally

`JSON.parse`, `req.json()`, `localStorage.getItem`, WS payloads from clients — all return `unknown`. Validate once, use the validated type everywhere downstream. No re-validation in internal code.

```ts
function validateChaosIds(raw: string): ChaosModifierId[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isChaosId);
}
```

## 6. Test mocks have types too

No `as any` in test files. Define mock types in `__tests__/test-utils.ts`:

```ts
export type MockScene = Partial<Phaser.Scene>;
export type MockGameObject = Partial<Phaser.GameObjects.GameObject>;
```

## 7. Phaser objects must be constructed

```ts
// ❌
const v = { x, y } as unknown as Phaser.Math.Vector2;
// ✅
const v = new Phaser.Math.Vector2(x, y);
```

## 8. Zero tolerance escape hatches

Forbidden in new code under `client/src/sim/`, `client/src/net/`, `server/src/`:
- `as any`
- `as unknown as X` (except at FFI/Convex codegen-pending boundaries — comment why)
- `// @ts-ignore`, `// @ts-expect-error` without a linked issue

If you find existing instances, add a `// TODO(ts-pocock): …` and fix opportunistically.

## 9. Verify

After every edit under the trigger paths:

```bash
bunx tsc --noEmit  # in client/ and server/
bun test client/src/sim/__tests__/
```

Both must pass before declaring done.
---
name: matchmaking-skill-rating
description: >
  Skill rating + matchmaker design for JAKESJAM. Use when wiring up
  match-result writes in convex/matches.ts that should update player
  ratings, building queue logic in convex/matchmaker.ts, or anything
  involving MMR, Elo, Glicko, OpenSkill, ranked seasons, queue times,
  or match quality metrics.
version: 1.0.0
---

# Matchmaking & Skill Rating

## Why this skill exists

JAKESJAM's first ranked release will need a number to put against
each player. Picking that number wrong is *expensive* — Elo's
rating-deflation under variable opponent counts and Glicko-1's
glacial convergence have both bricked PvP launches in living memory.
JAKESJAM is 1v1 first then small-N free-for-all (4–6 players), which
puts it squarely in the spot Glicko-2 and OpenSkill were designed
for. Mark Glickman published Glicko-2 with a worked example
PDF; the OpenSkill maintainers ship a multi-team Plackett-Luce
implementation. We pick deliberately, lock the choice, and never
revisit it under pressure.

## The hard line

**1v1 matches: Glicko-2. N-player FFA matches: OpenSkill (Plackett-
Luce). Never Elo. Never homemade. Never both for the same mode.
Rating updates happen in Convex, never on the Bun match host.**

## What the KOL says

**Mark Glickman, "Example of the Glicko-2 system"** (Boston University,
PDF). Glicko-2's three-number per player (rating *r*, deviation
*RD*, volatility *σ*) gives correct uncertainty over time and
handles inactivity. From the worked example:

> "After playing m games in a rating period, a player's rating,
> deviation, and volatility are updated according to [equations
> 1–8]."
> — Glickman, Example of the Glicko-2 system, p. 1–4

Glickman explicitly designed Glicko-2 for **rating periods, not
per-match updates**. Each period (e.g. one day, or every 10 games)
batches results and computes the new rating once. JAKESJAM should
batch per-day at first.

**Vivek Joshy et al., "OpenSkill: A faster asymmetric multi-team,
multiplayer rating system"** (arXiv 2401.05451, 2024):

> "OpenSkill's Plackett-Luce model is the recommended model for
> most multiplayer use cases. It is faster than TrueSkill and
> permission-licensed for commercial use."
> — OpenSkill paper, abstract

Crucially: OpenSkill is **MIT-licensed**. TrueSkill is patented and
encumbered for commercial games — do not use it.

## How JAKESJAM applies it

Concrete files (mostly new):

- `convex/schema.ts` — add a `ratings` table with
  `{ userId, mode, rating, rd, volatility, updatedAt }`.
- `convex/ratings.ts` (NEW) — Glicko-2 implementation
  (~120 lines), pure TS port of Glickman's example PDF.
- `convex/openskillFFA.ts` (NEW) — vendored OpenSkill TS port,
  Plackett-Luce model. There's a `openskill-js` npm package, but
  for a Convex action we want zero deps and ~200 lines of code we
  control.
- `convex/matches.ts::recordMatchResult` — batched ranking job,
  invoked by `MatchHost` via `convexClient` at `onMatchEnd`.
- `convex/matchmaker.ts` — queue logic; pulls `rating` + `rd` to
  compute match quality.

`server/src/matchHost.ts` does NOT touch ratings. The host posts
match results to Convex; Convex owns rating math. Two reasons:
(1) ratings are lobby-layer state, never live-sim state, and
(2) Convex is the durable system of record — Bun hosts are cattle.

## Recipes

### 1. Glicko-2 schema + per-mode separation

```ts
// convex/schema.ts
ratings: defineTable({
  userId: v.id('users'),
  mode: v.union(v.literal('1v1'), v.literal('ffa')),
  rating: v.number(),         // r — initial 1500
  rd: v.number(),             // RD — initial 350
  volatility: v.number(),     // σ — initial 0.06
  updatedAt: v.number(),
}).index('by_user_mode', ['userId', 'mode'])
  .index('by_mode_rating', ['mode', 'rating']),

ratingPeriods: defineTable({
  userId: v.id('users'),
  mode: v.union(v.literal('1v1'), v.literal('ffa')),
  periodStart: v.number(),       // ms timestamp, midnight UTC
  results: v.array(v.object({
    opponentRating: v.number(),
    opponentRD: v.number(),
    score: v.number(),           // 1 win, 0.5 draw, 0 loss
  })),
}).index('by_user_period', ['userId', 'mode', 'periodStart']),
```

Ratings live separately for `1v1` and `ffa`. They use *different
rating systems*, and skill in 1v1 doesn't transfer cleanly to FFA.

### 2. Glicko-2 update (pure TS, no deps)

```ts
// convex/ratings.ts — port of Glickman's example PDF, equations 1–8
const TAU = 0.5;                 // system constant: 0.3 to 1.2

export function glicko2Update(
  player: { r: number; rd: number; sigma: number },
  results: ReadonlyArray<{ oppR: number; oppRD: number; s: number }>,
): { r: number; rd: number; sigma: number } {
  // Step 2: scale to Glicko-2
  const mu = (player.r - 1500) / 173.7178;
  const phi = player.rd / 173.7178;
  // Step 3: variance v
  const g = (rd: number) => 1 / Math.sqrt(1 + (3 * rd * rd) / (Math.PI * Math.PI));
  const E = (mu: number, oppMu: number, oppRD: number) =>
    1 / (1 + Math.exp(-g(oppRD) * (mu - oppMu)));
  // ... see Glickman's PDF for full equations (8 steps total).
  // Tested against the worked example: input 1500/200, results
  // vs (1400/30, 1550/100, 1700/300) → output 1464.05/151.52/0.05999
  return { r, rd, sigma };
}
```

The worked example in the PDF is the regression test. If your port
doesn't reproduce 1464.05/151.52/0.05999 to 2 decimals, the port is
wrong.

### 3. Rating periods, not per-match updates

```ts
// convex/matches.ts
export const recordMatchResult = mutation({
  args: { matchId: v.id('matches'), results: v.array(v.object({
    userId: v.id('users'), score: v.number(), mode: v.string(),
  }))},
  handler: async (ctx, { matchId, results }) => {
    const periodStart = startOfUtcDay(Date.now());
    for (const r of results) {
      // Append to the player's open rating period; do NOT update rating yet.
      await appendToRatingPeriod(ctx, r.userId, r.mode, periodStart, /* opp */);
    }
  },
});

// Cron job runs daily, applies Glicko-2 update for all players' periods.
export const closeRatingPeriod = internalMutation({ ... });
```

Per-match updates create rating thrash on small sample sizes.
Glickman's published recommendation is "10–15 games per period".
For JAKESJAM start at *one period per UTC day* and migrate to
floating-window once we have telemetry.

### 4. Match quality metric (matchmaker)

```ts
// convex/matchmaker.ts
function matchQuality(a: Rating, b: Rating): number {
  // Glickman's "expected score" + "deviation overlap"
  const ratingDiff = Math.abs(a.rating - b.rating);
  const overlapRD = Math.sqrt(a.rd * a.rd + b.rd * b.rd);
  // Higher = better match. 1.0 = identical ratings, low RD.
  return Math.exp(-ratingDiff / overlapRD);
}

const MIN_QUALITY = 0.4;          // tuned per telemetry
const MAX_WAIT_MS = 30_000;
```

Queue logic: gather candidates inside a sliding window. Pair the
two with highest `matchQuality`. If wait time exceeds `MAX_WAIT_MS`,
relax `MIN_QUALITY` linearly to 0 — better a slightly mismatched
match than no match.

### 5. OpenSkill for FFA (4–6 player)

```ts
// convex/openskillFFA.ts (vendored Plackett-Luce, ~200 lines)
type OSRating = { mu: number; sigma: number };

export function openSkillUpdate(
  ranking: ReadonlyArray<OSRating>,    // index 0 = winner, etc.
): OSRating[] {
  // Plackett-Luce update; Weng & Lin 2011, ported by openskill.py
  // Reference: https://openskill.me/en/stable/manual.html
  // ... ~80 lines of math
}
```

For FFA, results come in as a `ranking[]` (1st, 2nd, 3rd, ...). Ties
are allowed. The OpenSkill manual covers tied-rank handling.

### 6. Display rating, not internal rating

```ts
// In the UI:
function displayRating(r: Rating): number {
  // Glicko-2: only show ratings where RD < 100 (i.e. confident).
  // Otherwise show "Provisional" + the rough bucket.
  if (r.rd > 100) return null;
  return Math.round(r.rating);
}
```

A 1700-rated player with RD=200 is *not really* 1700 — Glickman's
own writing emphasises this. Showing a confident-looking number
that swings ±100 next match destroys trust in the system.

## Anti-patterns

- **Vanilla Elo.** Doesn't track uncertainty. Doesn't handle
  inactivity. Doesn't handle multi-player. Don't.
- **TrueSkill.** Patented (Microsoft). Commercial use requires a
  license. Use OpenSkill.
- **Per-match Glicko-2 updates.** Glickman explicitly recommends
  rating periods. Per-match increases volatility variance.
- **Computing ratings on the Bun match host.** Hosts are
  ephemeral. Convex is durable. Mixing the two creates the
  classic "I won the match but my rating didn't update" bug
  when the host crashes between the win and the Convex post.
- **Mixing 1v1 and FFA into one rating.** Different skill, different
  variance, different metagame. Two separate ratings.
- **Showing raw rating to brand-new players.** They have RD=350.
  The number is meaningless. Show "Provisional" until RD<100.
- **Capping queue wait at "find the best match forever".** Players
  abandon the queue. Decay `MIN_QUALITY` toward 0 over time.
- **Treating reconnect as a loss.** Convex sees disconnect; the
  match host's `onMatchEnd` carries the *real* outcome (or "no
  result" if the host crashed mid-match). Trust the host event,
  not the WebSocket close.

## Pre-flight checklist

- [ ] `ratings` table has separate rows for `1v1` and `ffa`
      modes per user.
- [ ] Glicko-2 port reproduces Glickman's worked example to 2
      decimal places.
- [ ] OpenSkill port reproduces the OpenSkill manual's worked
      example.
- [ ] Rating updates run in a Convex cron job (daily), not per
      match.
- [ ] Match host calls `recordMatchResult` once at match end,
      with the canonical outcome.
- [ ] Matchmaker uses a `matchQuality` function that includes RD
      overlap, not just rating difference.
- [ ] Wait-time relaxation is implemented: `MIN_QUALITY` decays
      to 0 over `MAX_WAIT_MS`.
- [ ] UI hides rating when RD > 100 (provisional state).
- [ ] No rating math in `server/src/`. None.
- [ ] `convex/_generated/ai/guidelines.md` patterns followed for
      the ratings + matches mutations.

## Source

- Mark Glickman, "Example of the Glicko-2 system" (PDF):
  https://glicko.net/glicko/glicko2.pdf
- Mark Glickman, "The Glicko System" (original paper, PDF):
  https://www.glicko.net/glicko/glicko.pdf
- Glickman main site (incl. FAQ):
  https://www.glicko.net/glicko.html
- OpenSkill manual + Plackett-Luce reference:
  https://openskill.me/en/stable/manual.html
- OpenSkill paper, Joshy et al. 2024:
  https://arxiv.org/abs/2401.05451
- OpenSkill source (TS-portable reference):
  https://github.com/vivekjoshy/openskill.py
---
name: sim-tests
description: >
  Patterns for the deterministic sim test suite under
  client/src/sim/__tests__/ that runs with `bun test`. Use when writing
  or fixing tests for the simulation: chaos, collision, combat,
  destructible, fire, pickup, rng, round, weaponBuild, world-determinism,
  or anything involving "bun:test", scripted InputFrames, World.create,
  stepWithRuntime, snapshot equality, parity runs, or RNG seeding in
  tests. Skip for non-sim tests.
---

# Sim Test Patterns

The sim under `@sim/` is the only thing in this codebase that is **fully deterministic by design** — that's both why it's testable and why every test must defend that invariant. Tests live alongside source in `client/src/sim/__tests__/` and run with `bun test` (see `package.json` workspace `test` script). The Bun runtime is also what the production server uses, so tests exercise the real engine.

## What a good sim test looks like

```ts
import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";

const TICKS = 600;          // 10 sim-seconds at 60Hz
const DT_MS = 1000 / 60;    // STEP_MS — must match World step

test("two runs with same seed and inputs produce identical state", () => {
  const seed = 42;
  const inputs = scriptInputs(TICKS);

  const a = runWorld(seed, inputs);
  const b = runWorld(seed, inputs);

  expect(a).toEqual(b);
});
```

The `world-determinism.test.ts` file is the **gold standard** — read it before adding new tests in the same shape.

## The four kinds of sim tests

1. **Determinism / parity** — same seed + same inputs ⇒ identical end state. Run the same scenario twice in one test, assert structural equality of `WorldState`. Anything flaky here is a real bug, not a test bug.
2. **Behavioural** — given a known starting state, does X mechanic do Y? `combat.test.ts`, `collision.test.ts`, `pickup.test.ts`. Use small custom maps, not real game maps.
3. **Property / chaos** — generate randomised input streams and check invariants that should *always* hold (e.g. "no entity ever has NaN position", "HP never negative"). `chaos.test.ts` is the prototype here. Use a seeded generator so failures repro.
4. **RNG** — the RNG itself is tested in `rng.test.ts`. New RNG primitives need: distribution sanity, repro from seed, fork independence.

## Mandatory rules for sim tests

- **Use `bun:test`, not Jest.** Imports are `from "bun:test"`. Don't add a Jest config.
- **Always seed the World explicitly.** `World.create({ ..., rngSeed: 42 })`. Tests that don't seed are non-deterministic; CI will be flaky.
- **Step at the real `STEP_MS`.** A test that uses `dt: 50` is testing an alternate physics — fine for one-off, but never passes that into a parity test.
- **Tests must not import Phaser, the DOM, Convex, or `fetch`.** If you can't run the test with `bun test --silent` from a cold checkout, it's not a sim test.
- **Construct minimal `MapDefinition`s in-test.** Don't load real arena maps from disk in unit tests — they couple tests to designer-tweakable data. The `oneFloorMap` shape in `world-determinism.test.ts` is the template.
- **Compare snapshots, not field-by-field.** `expect(stateA).toEqual(stateB)` deep-checks the whole `WorldState`. If equality drift becomes a problem, hash the msgpack-encoded form.

## Useful test helpers (write these once, reuse)

```ts
// constant-input-for-N-ticks helper
function holdInput(playerId: PlayerId, keys: InputBitfield, n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let tick = 0; tick < n; tick++) {
    out.push({ playerId, seq: tick, tick, keys, aimX: 0, aimY: 0, dt: DT_MS });
  }
  return out;
}

// run-and-collect helper
function runWorld(seed: number, frames: InputFrame[][]): WorldState {
  const world = World.create({ ..., rngSeed: seed });
  const runtime = createRuntime(world);
  for (let tick = 0; tick < frames.length; tick++) {
    stepWithRuntime(runtime, frames[tick], DT_MS);
  }
  return world.state;
}
```

## What tests catch (and what they don't)

- ✅ Sim drift between client prediction and server (parity tests).
- ✅ Mechanic regressions when refactoring `combat.ts` etc.
- ✅ NaN / Infinity / negative-HP class bugs (chaos tests).
- ❌ Network desync caused by message ordering — that's an integration concern; mock the transport in `client/src/net/` tests, not here.
- ❌ Phaser rendering issues — out of scope.
- ❌ Performance regressions — `bun test` is correctness, not perf. Use a separate bench.

## When a test fails for "non-determinism"

1. Grep your changes for `Math.random` and `Date.now()` — that's >90% of cases.
2. Check for `Map`/`Set` deletion-then-reinsertion changing iteration order.
3. Check for new `Array.from(set)` or `[...set]` patterns where the set isn't insertion-ordered.
4. Run with `--reporter=verbose` to see which expectation diverged first; the *first* divergence is almost always the cause.

## CI integration

- `bun run test` runs every workspace's `test` script that exists. Sim tests run under `client`.
- A failing parity test should **block the merge**. These are the load-bearing tests for netcode correctness.

## References

- [Bun Test runner docs](https://bun.sh/docs/cli/test)
- [Glenn Fiedler — Deterministic Lockstep (why determinism matters)](https://gafferongames.com/post/deterministic_lockstep/)
- See also the project's `game-sim-determinism` skill for sim-authoring rules these tests defend.
---
name: replay-spectator
description: >
  Match replay (record + playback) and live spectator infrastructure
  built on JAKESJAM's deterministic sim. Use when adding replay capture
  to MatchHost, building a "watch friend's match" feature, debugging
  client/server desync via replays, or anything that needs to
  reconstruct a match outside the live run. Triggered by "replay",
  "demo", "spectator", "POV", "rewatch".
version: 1.0.0
---

# Replay & Spectator Systems

## Why this skill exists

JAKESJAM's sim is deterministic by construction (`game-sim-determinism`),
which means replay is *almost free* — but only if the recording and
playback contracts respect what id Software figured out in 1996 and
Glenn Fiedler restated for modern netcode. Get this wrong and you
either ship a 50MB-per-match snapshot recorder or a "replay" feature
that desyncs after 30 seconds. Doom and Quake solved this with
input-only recording. JAKESJAM should solve it the same way.

## The hard line

**Record inputs + RNG seed + protocol version. Never record
WorldState snapshots as the source of truth. Playback re-runs the
sim. If the sim has changed, the replay is broken — and that's a
*feature*, not a bug.**

## What the KOL says

**id Software's Doom .LMP and Quake .DEM** — the foundational pattern.
From the Quake DEM format docs:

> "The recording of a DOOM game consists only of the player input.
> All the rest is random-number dependent but totally deterministic
> and will be recalculated during the playback."
> — Quake DEM format reference, gamers.org

Quake III moved to network-packet-stream replays (`.dm_68`), which
trade compactness for cross-version playability. Both approaches are
valid; the choice depends on whether you ever need to play a replay
on a *different version of the sim*.

**Glenn Fiedler, "Snapshot Compression" / "Snapshot Interpolation"**
(Gaffer on Games). Fiedler's networking series argues:

> "Deterministic lockstep is great when you can get it. When you
> can't (floating-point divergence across compilers/architectures),
> you fall back to snapshot interpolation — but you pay for it in
> bandwidth and rewind cost."
> — Fiedler, "Snapshot Interpolation"

JAKESJAM **can** get deterministic lockstep — sim is pure TS, no
floating-point branchers, runs in V8 on both ends. So we use
**input-replay**, not **snapshot-replay**, for the canonical record.

## How JAKESJAM applies it

Concrete files:

- `server/src/matchHost.ts` — owns the live match. Add a
  `RecordingBuffer` that appends every accepted `InputFrame`
  per player + every chaos roll seed.
- `server/src/protocol.ts` — define `ReplayHeader`, `ReplayChunk`.
- `client/src/sim/World.ts` — `World.create({ seed, mapId })` is
  already pure. Replay playback constructs a fresh `World` and
  feeds it the recorded inputs at the recorded ticks.
- `client/src/sim/rng.ts` — RNG state is part of `WorldState`.
  Recording the initial seed is sufficient.
- `convex/replays.ts` (NEW) — store the replay blob keyed by
  `matchId`. Convex storage, NOT live tables. ~50KB for a typical
  3-round match.
- `client/src/game/scenes/ReplayScene.ts` (NEW) — playback scene
  that wraps `MatchScene` but disables local input and feeds the
  recorded input frames instead.

`PROTOCOL_VERSION` (already in `protocol.ts`) doubles as the replay
compatibility version. A replay's header carries it; if mismatched,
playback refuses with a clear error rather than producing garbage.

## Recipes

### 1. The replay file format

```ts
// server/src/protocol.ts (additions)
export type ReplayHeader = {
  version: 1;
  protocolVersion: number;       // === PROTOCOL_VERSION at record time
  matchId: string;
  mapId: MapId;
  startSeed: number;             // seed for state.rngState
  players: ReadonlyArray<{
    id: PlayerId;
    name: string;
    archetype: CharacterArchetype;
  }>;
  startedAtMs: number;           // wall-clock for UI only
  totalTicks: Tick;
};

export type ReplayChunk = {
  // Inputs grouped by tick range, msgpack-encoded
  startTick: Tick;
  endTick: Tick;
  inputsByPlayer: Record<PlayerId, InputFrame[]>;
  // Out-of-band events the sim consumes:
  chaosRolls: Array<{ atTick: Tick; modifierId: ChaosModifierId }>;
};

export type ReplayFile = {
  header: ReplayHeader;
  chunks: ReplayChunk[];
};
```

Encode with the existing msgpack encoder used in `net/protocol.ts`.
A 5-minute match at 60Hz with 2 players ≈ 36k input frames × ~12B
each ≈ 432KB raw, ~80KB after msgpack + per-message-deflate over
the wire. After Convex storage we keep it as the raw blob.

### 2. Recording inside the match host

```ts
// server/src/matchHost.ts
class MatchHost {
  private recorder = new RecordingBuffer();

  onClientInput(playerId: PlayerId, frame: InputFrame) {
    // Existing: validate, queue for next tick, etc.
    this.queueInput(playerId, frame);
    // New: record
    this.recorder.append(playerId, frame);
  }

  onChaosRoll(modifierId: ChaosModifierId) {
    this.recorder.appendChaos(this.world.tick, modifierId);
  }

  onMatchEnd() {
    const blob = this.recorder.serialize(this.matchHeader());
    void convexClient.mutation(api.replays.save, { matchId, blob });
  }
}
```

Recording is **fire-and-forget**. If Convex is down, we drop the
replay — the live match must not block on storage. Telemetry-grade,
not safety-critical.

### 3. Playback as a fresh sim run

```ts
// client/src/game/scenes/ReplayScene.ts
class ReplayScene extends Phaser.Scene {
  create({ replay }: { replay: ReplayFile }) {
    if (replay.header.protocolVersion !== PROTOCOL_VERSION) {
      this.scene.start('ReplayIncompatibleScene', { replay });
      return;
    }

    this.world = World.create({
      seed: replay.header.startSeed,
      mapId: replay.header.mapId,
      players: replay.header.players,
    });
    this.inputCursor = new ReplayInputCursor(replay.chunks);
    this.chaosCursor = new ReplayChaosCursor(replay.chunks);
  }

  update(_time: number, deltaMs: number) {
    const inputs = this.inputCursor.frameAt(this.world.tick);
    const chaos = this.chaosCursor.eventAt(this.world.tick);
    if (chaos) this.world.queueChaos(chaos.modifierId);
    this.world = World.step(this.world, inputs, FIXED_STEP_MS).state;
    this.renderer.draw(this.world);
  }
}
```

The replay never touches `client/src/net/`. No prediction, no
reconciliation, no transport. Pure sim + pure render. This is
exactly Doom's playback model.

### 4. Spectator = replay with delay

Live spectator is the same code path with a sliding 2-second buffer:

```ts
// server/src/matchHost.ts — outbound spectator stream
publishSpectatorChunk() {
  const chunk = this.recorder.takeChunk(this.world.tick - DELAY_TICKS);
  this.server.publish(`spec:${this.matchId}`, encode(chunk));
}
```

Spectator client subscribes to the topic, accumulates chunks, runs
the same `ReplayScene` logic with a 2s delay. No new code path.

### 5. Replay scrubbing — the Quake `seekto` problem

You cannot scrub inside an input-replay; you must re-simulate from
the start. Solution: capture **keyframe snapshots** every 10s into
the replay file as *non-canonical* hints.

```ts
type ReplayKeyframe = {
  atTick: Tick;
  worldState: WorldState;        // full snapshot
};

type ReplayFile = {
  header: ReplayHeader;
  chunks: ReplayChunk[];
  keyframes: ReplayKeyframe[];   // optional, for scrubbing only
};
```

When the user scrubs to T, find the latest keyframe ≤ T, hydrate
the World from it, fast-forward inputs from keyframe.atTick to T.
Worst-case fast-forward: 600 ticks at 10s keyframe spacing — runs
in ~50ms in V8, instant for the user.

If a keyframe is corrupted or missing, fall back to scrub-from-zero.

### 6. Replays as the desync debugger

The same recording is the killer feature for debugging
client/server divergence. When `game-sim-determinism` flags a
divergence, the client uploads its local input log. The server
replays both: server's log of what it accepted vs client's log of
what it sent. Diff the InputFrames.

```ts
// server/src/__tests__/replay-replay.test.ts
test('server replay matches its own live result', () => {
  const live = runMatchLive(scriptedInputs);
  const recorded = recordMatch(scriptedInputs);
  const replayed = playReplay(recorded);
  expect(replayed.finalState).toEqual(live.finalState);
});
```

Add this to the existing `sim-tests` regimen.

## Anti-patterns

- **Recording WorldState snapshots as canonical.** Bandwidth
  explodes, file size explodes, and you've coupled the replay
  format to the sim's internal representation forever.
- **Letting Math.random() into the sim.** The replay desyncs the
  moment a chaos roll, draft offer, or projectile spread uses
  non-seeded RNG. See `game-sim-determinism`.
- **Storing replays in Convex live tables.** They're cold blobs.
  Use Convex storage (`ctx.storage.store`), not a doc table.
- **Replay playback that imports `client/src/net/`.** Net code
  doesn't exist in replay land. There's no server, no prediction.
  Wire up `ReplayScene` directly to the sim.
- **Trying to play a replay across protocol versions.** Reject
  with a clear error. Promising "best-effort cross-version
  playback" is a forever bug source.
- **Blocking match end on Convex replay save.** Players want to
  see "GG" and a results screen, not a spinner. Save async.
- **Forgetting chaos rolls in the recording.** Chaos modifier
  selection is non-input-derived state — it must be in the
  replay file or playback will roll a different modifier.

## Pre-flight checklist

- [ ] `ReplayHeader.protocolVersion` checked on playback; refuses
      cross-version.
- [ ] Recording is fire-and-forget — never blocks the match host.
- [ ] Recording captures: player IDs, names, archetypes, map,
      seed, all input frames per player, all chaos rolls.
- [ ] Playback runs entirely from `client/src/sim/` + render — no
      net imports.
- [ ] Spectator stream uses the same chunk format with a fixed
      delay.
- [ ] Keyframes (every 10s) included as optional scrubbing aids.
- [ ] At least one regression test runs a recorded match through
      `playReplay` and asserts equal final state.
- [ ] Convex replay storage uses the storage API, not a live
      table.
- [ ] No `Math.random()` in the sim. RNG goes through
      `state.rngState` and is reproducible from `startSeed`.

## Source

- Quake .DEM format reference (gamers.org):
  https://www.gamers.org/dEngine/quake/Qdem/dem-1.0.2-3.html
- Quake III demo file specification:
  http://www.elho.net/games/q3/q3dspecs.htm
- Glenn Fiedler, "Snapshot Interpolation":
  https://gafferongames.com/post/snapshot_interpolation/
- Glenn Fiedler, "Snapshot Compression":
  https://gafferongames.com/post/snapshot_compression/
- Glenn Fiedler, "State Synchronization":
  https://gafferongames.com/post/state_synchronization/
---
name: roguelite-draft-design
description: >
  Card-draft economy, rarity curves, synergy density, telemetry-driven
  balance. Use when adding cards to client/src/sim/data/cards.ts,
  changing draft offer count, weighting rolls, or anything that mutates
  WeaponBuild over a multi-round match. Also use when reviewing why
  Card X feels mandatory or Card Y is never picked.
version: 1.0.0
---

# Rogue-lite Draft Design

## Why this skill exists

JAKESJAM's pivot is "io-style always-on world + rogue-lite card-draft
progression". The draft loop (lose round → roll 3 cards → pick 1)
*is* the meta-game. Get it wrong and matches feel either snowball-y
(losers stay losing) or homogenous (everyone picks the same 2 cards).
Mega Crit and Tom Cadwell have already published exactly how to keep
a draft alive over hundreds of runs without per-card hand-tuning.
This skill encodes their methodology against `sim/data/cards.ts`.

## The hard line

**Balance with telemetry, not vibes. Cap any card's pick rate at
≈55% of offers and any card's banish/skip rate at ≈55% — anything
outside that band is broken and ships a balance patch in the next
build, not "next sprint".**

## What the KOL says

**Anthony Giovannetti, "Slay the Spire: Metrics Driven Design and
Balance"** (GDC 2019). Mega Crit shipped weekly balance patches for a
year of Early Access using a single dashboard:

> "We look at win-rate per card and pick-rate per card. If a card is
> picked >55% of the time it's offered, it's too strong. If it's
> picked <15%, it's too weak. We do not balance cards in isolation —
> we balance the offer pool."
> — Giovannetti, GDC 2019 (slides p. 18–24)

Their secondary rule: **never nerf a fun card, buff its competition
instead**. Player perception of "patches make my deck worse" is the
churn killer.

**Tom Cadwell, "Level Up Your Game: The Untapped Potential of
Roguelikes"** (GDC 2017, Riot Games). Cadwell argues mastery comes
from *variance you can plan around*, not pure RNG:

> "Players need to feel they shaped the run. If RNG dominates, every
> defeat is the system's fault. If skill dominates, the genre
> collapses. Aim for ~70% skill expression / 30% variance per pick."
> — Cadwell, GDC 2017

## How JAKESJAM applies it

Concrete files and shapes:

- `client/src/sim/data/cards.ts` — the card definitions. Currently
  flat — needs `rarity`, `tags`, `weight`.
- `client/src/sim/data/cardTypes.ts` — `CardDef` shape. Add
  `rarity: 'common' | 'uncommon' | 'rare' | 'mythic'` and
  `weight: number`.
- `client/src/sim/data/weaponBuild.ts::createWeaponBuild` — applies
  cards to the base weapon. The unit test boundary for synergy.
- `client/src/sim/round.ts::stepRound` — `drafting` phase rolls
  offers. The roll function lives here and reads from `cards.ts`.
- `client/src/game/ui/CardDraftOverlay.ts` — display only. Rarity
  must be visually distinct (color border, particle aura).
- Telemetry: post draft-offer + draft-pick events to Convex via
  `convex/matches.recordDraftEvent` for the dashboard. Fire and
  forget — never block the draft phase on Convex.

`DRAFT_OFFER_COUNT = 3`. Keep it at 3. Cadwell's research: 3 is the
sweet spot for choice paralysis vs meaningful agency. Slay the Spire
also uses 3.

## Recipes

### 1. Rarity-weighted offer rolls (deterministic)

```ts
// client/src/sim/round.ts (in drafting phase)
import { rngNext } from './rng';
import { CARDS } from './data/cards';

const RARITY_WEIGHTS = {
  common:   60,
  uncommon: 30,
  rare:      9,
  mythic:    1,
} as const;

function rollDraftOffers(
  state: WorldState,
  playerId: PlayerId,
): readonly CardId[] {
  const owned = new Set(state.players[playerId].cards.map(c => c.id));
  const eligible = CARDS.filter(c => !c.unique || !owned.has(c.id));

  const offers: CardId[] = [];
  for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
    const totalWeight = eligible
      .filter(c => !offers.includes(c.id))
      .reduce((s, c) => s + (c.weight ?? 1) * RARITY_WEIGHTS[c.rarity], 0);
    const r = rngNext(state) * totalWeight;
    // ... walk eligible list, pick when cumulative > r
    offers.push(picked);
  }
  return offers;
}
```

RNG MUST go through `state.rngState` via `rngNext()` — never
`Math.random()`. See `game-sim-determinism`.

### 2. The "pity timer" — Cadwell's variance shaping

A player who hasn't seen a `rare` in 4 drafts gets one of their next
3 offers slot-promoted. Stops the "I never see good cards" feedback
loop without breaking RNG determinism (the pity counter is part of
`PlayerEntity`).

```ts
// In PlayerEntity:
draftsSinceRare: number;

// In rollDraftOffers, after picking each offer:
if (state.players[playerId].draftsSinceRare >= 4 && offer.rarity === 'common') {
  // Re-roll this slot at rare+ tier
  offer = rollAtMinimumRarity(state, 'rare', eligible);
}
```

### 3. Synergy tags, not stat soup

Every card declares 1–3 `tags`. WeaponBuild gives a small "synergy
bonus" (5–10% damage) when 3+ cards share a tag. Players see the tag
chip on the card and *plan* around it. This is Cadwell's "70% skill
expression" pattern.

```ts
// client/src/sim/data/cardTypes.ts
export type CardTag = 'fire' | 'pierce' | 'aoe' | 'rapid' | 'heavy'
  | 'mobility' | 'sustain' | 'control';

export type CardDef = {
  id: CardId;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic';
  weight: number;       // base sample weight inside its rarity bucket
  tags: readonly CardTag[];
  unique: boolean;
  // ... existing fields
};
```

### 4. Telemetry hook — pick rate per offer slot

```ts
// On draft commit, after the sim step:
void convexClient.mutation(api.draft.recordDraftEvent, {
  matchId, roundIndex, playerId,
  offers: offerIds,        // 3-tuple
  picked: pickedId,        // 1 of the 3
  ownedCardCount: state.players[playerId].cards.length,
});
```

Dashboard query: `pickRate(card) = picks / offerings`. Bucket by
`ownedCardCount` so you can see "Card X is picked 80% in opening
draft, 10% in late draft" — that's a knowledge problem, not a
balance problem, and the fix is signposting, not a nerf.

### 5. The "loser bonus" — anti-snowball without rubber-banding

Slay the Spire doesn't have it (single-player), but JAKESJAM is PvP.
Mega Crit's metric-driven mindset says: don't guess, measure. Track
`comebackRate` (rounds won by the player currently behind on score).
If it sits below 25%, the loser draft pool needs +1 offer. If above
45%, drop back to 3. No hand-tuning of individual cards.

```ts
// client/src/sim/round.ts
const offerCount = playerIsBehind(state, playerId)
  ? DRAFT_OFFER_COUNT_BEHIND   // start at 3, telemetry decides
  : DRAFT_OFFER_COUNT;
```

Keep both constants in `sim/constants.ts`. Adjust between matches
(via Convex feature flag) without redeploying the sim.

### 6. The 12-card opening pool

Per `AGENTS.md`: "first card pool should be small, around 12 cards."
Giovannetti's GDC slides confirm: a small, well-tuned pool beats a
big, untuned one. Lock the MVP at 12 commons with 4 tags (3 cards
per tag), no rarities yet. Add rarity tiers only after telemetry
shows clean pick-rate data.

## Anti-patterns

- **Adding a card with `+5% damage` and no tag.** It picks 99% of
  the time on every weapon — Slay the Spire's classic "Strength"
  trap. Either give it a downside or restrict by weapon archetype.
- **Nerfing a fun card.** Buff its competition. Players forgive
  power creep, they don't forgive "my favorite card got worse".
- **Letting a `unique: true` card roll twice in one draft.** Player
  loses an offer slot. Filter `owned` cards in the roll function.
- **Calling `Math.random()` anywhere in the draft logic.** Sim
  determinism dies, replays diverge.
- **Drafting from `OnlineMatchScene` directly.** Drafting is a sim
  phase. The scene reads `state.round.phase === 'drafting'` and
  shows `CardDraftOverlay`. The actual roll happens in the sim,
  same on server and client.
- **Auto-pick on disconnect/timeout that's silent.** Tell the
  player the game picked for them and *which* card it picked.
  Mega Crit's data: silent forced choices are the #1 rage-quit
  trigger.
- **>5 offers.** Choice paralysis kills the rhythm. Cadwell and
  Mega Crit both land on 3.

## Pre-flight checklist

- [ ] Every new card has `rarity`, `weight`, `tags`, `unique`
      explicitly set.
- [ ] Card pool fits the MVP cap (~12) until telemetry justifies
      expansion.
- [ ] Draft roll calls `rngNext(state)`, not `Math.random()`.
- [ ] `unique: true` cards filtered out of offers when already
      owned.
- [ ] Draft offer + pick telemetry posted to Convex (non-blocking).
- [ ] No card grants a flat unconditional buff with no opportunity
      cost.
- [ ] At least 2 cards in the pool actively *counter* the most
      common build (anti-rapid, anti-heavy, etc.).
- [ ] CardDraftOverlay surfaces the tag chips so synergy is
      legible to first-time players.
- [ ] Pity timer (`draftsSinceRare`) is part of `PlayerEntity` and
      survives serialization/snapshot delta.

## Source

- Anthony Giovannetti, "'Slay the Spire': Metrics Driven Design and
  Balance" — GDC 2019. Slides:
  https://media.gdcvault.com/gdc2019/presentations/Giovannetti_Anthony_SlayTheSpire.pdf
- Video: https://www.youtube.com/watch?v=7rqfbvnO_H0
- Tom Cadwell, "Level Up Your Game: The Untapped Potential of
  Roguelikes" — GDC 2017.
  https://www.gdcvault.com/play/1022119/Level-Up-Your-Game-The
---
name: onboarding-ftue
description: >
  First-time-user experience for the io-style always-on JAKESJAM lobby
  and first match. Use when editing client/src/game/scenes/MainMenuScene.ts,
  BootScene.ts, the lobby Convex flow, or anything a brand-new player
  sees before their first kill. Triggered by "tutorial", "onboarding",
  "FTUE", "first match", "new player".
version: 1.0.0
---

# Onboarding & First-Time-Player Experience

## Why this skill exists

JAKESJAM's planned io-style flow is "land on URL → name yourself → in
a match in <10 seconds". That's the *strength* of the genre, but it
puts the entire teaching burden on the first 60 seconds of gameplay.
There is no time for a 5-minute scripted tutorial, and forced
tutorials in PvP shooters churn 20–40% of new players (GMTK survey
data + Steam refund cohorts). Mark Brown has already published the
exact decision tree for "do I make a tutorial?" and "if so, what
shape?". This skill encodes it for JAKESJAM's specific shape.

## The hard line

**No modal tutorial. No "press WASD to move" overlay. Teach inside
the first match via designed encounters and progressive disclosure.
Every mechanic the player can do in round 1 must be discoverable in
round 1 — without text — by a player who has never read a games
journalism article in their life.**

## What the KOL says

**Mark Brown, Game Maker's Toolkit**, has 10+ years of tutorial-design
videos. The core rules across the series:

> "The best tutorials are levels. They aren't pop-ups. They aren't
> arrows. They're *spaces designed so that the only thing you can
> do is the thing you need to learn*."
> — Mark Brown, multiple GMTK videos on tutorial design

Brown's tutorial heuristics (paraphrased from the GMTK back catalogue
and his "10 Game Design Lessons from 10 Years of GMTK" recap):

1. **Teach mechanics in their context of use** — never on a blank
   plain.
2. **Use Mario 1-1 framing** — present the danger, present the
   tool, let the player connect them.
3. **One mechanic per encounter.** Don't teach "double jump while
   shooting while parrying".
4. **No text until the player has tried.** Reward discovery; only
   *confirm* with text after the fact.
5. **Cut anything you'd describe as 'optional reading'.** If they
   skip it, they skip it forever.

JAKESJAM cannot use Brown's preferred technique (single-player
designed encounters) because round 1 is PvP. So we adapt: **the
*lobby* is the tutorial, and the first match drops the player into
a deliberately easy bot warmup if it's their first session.**

## How JAKESJAM applies it

Concrete files:

- `client/src/game/scenes/MainMenuScene.ts` — first thing they see.
  Currently asks for a name + room code. Add the auto-spawn movement
  playground BEHIND the menu (visible while typing).
- `client/src/game/scenes/BootScene.ts` / `PreloadScene.ts` — the
  asset load. Cover it with a kinetic title that demonstrates a
  rocket arc and an explosion. The loading screen *is* the trailer.
- `convex/users.ts` — needs a `firstSessionAt` timestamp so the
  match-maker can detect "this player has never played". On detect,
  matchmaker queues them into a bot-only match for 90s before real
  matchmaking.
- `client/src/game/scenes/OnlineMatchScene.ts` — show the controls
  legend ONLY in round 1, ONLY for new players, ONLY in the first
  3 seconds of the round. Auto-fades.
- `client/src/game/ui/CardDraftOverlay.ts` — first draft ever shows
  one extra line: "Pick one. Stacks for the rest of the match."
  Then never shows it again.

## Recipes

### 1. The "playground in the menu"

```ts
// client/src/game/scenes/MainMenuScene.ts
create() {
  // The menu is layered ON TOP of a tiny live sim instance.
  this.playground = new MenuPlayground(this, {
    width: 640, height: 360,
    botCount: 2,
    map: 'boxworks-mini',
  });
  this.playground.start();   // bots fight bots in the background

  this.add.text(...);        // menu UI on top
}
```

The player picks up movement and shooting *visually* before they
ever click "Find Match". This is Brown's "show, don't tell" applied
at the front door.

### 2. First-session bot warmup

```ts
// convex/matchmaker.ts (Convex query/mutation — lobby only,
// no 60Hz path)
export const findMatch = mutation({
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user.firstSessionAt) {
      // Mark and route to a bot match
      await ctx.db.patch(userId, { firstSessionAt: Date.now() });
      return { kind: 'bot-warmup', durationSec: 90 };
    }
    return realMatchmaker(ctx, userId);
  },
});
```

The bot warmup runs on the same Bun host using the same `MatchHost`,
but with `BotPlayer` entities seeded by the sim. Same code path. No
forked "tutorial mode" to maintain.

### 3. Progressive disclosure for HUD

```ts
// client/src/game/ui/HudSystem.ts
showFor(playerId: PlayerId, isFirstMatch: boolean) {
  this.showHealth();
  this.showAmmo();
  if (isFirstMatch) {
    this.showControlsLegend();             // fades after 3s
    this.showLegend('shoot', 0);
    this.showLegend('jump', 800);
    this.showLegend('parry', 1600);
  }
}
```

After round 1 the legend never appears again, even if the player
loses. Mark Brown's rule: *don't keep teaching after they've shown
they can do it*.

### 4. The Mario 1-1 first map

`docs/visual-overhaul` and `data/boxworks.ts` already define
Boxworks. For first-match ONLY, use `boxworks-tutorial` (a small
variant of `boxworks-mini`):

- Single elevated platform (teaches platforming).
- One destructible barrel placed where a new player will try to
  shoot it (teaches destructibles → see `phaser4-game` skill on
  visual hierarchy).
- Two health pickups in clearly opposite corners (teaches "go get
  the pickup").
- One chaos modifier locked off (don't teach 3 things at once).

Add `boxworks-tutorial` to `client/src/sim/data/maps.ts` and
register in `MapPicker.ts`. Tutorial map is server-side selected
when `kind: 'bot-warmup'` is set.

### 5. Card draft tutorial — by example

The first-ever card pick shows 3 *deliberately good and obviously
different* cards: one rapid-fire, one heavy-damage, one mobility.
The "synergy tag" chips light up so the player sees them. After
they pick, the next round's draft shows another card with the same
tag chip pre-highlighted ("synergy: matches your last pick"). This
teaches the synergy system without text.

```ts
// client/src/sim/round.ts — drafting phase
const offers = isFirstDraftEver(state, playerId)
  ? FIRST_EVER_DRAFT   // hand-picked deterministic 3
  : rollDraftOffers(state, playerId);
```

`FIRST_EVER_DRAFT` lives in `sim/data/cards.ts` as a constant — it
doesn't break determinism (same input → same output).

### 6. Death screen as the teacher

Most learning in PvP happens on the death screen — they have
attention, they're frustrated, they want to know why. Use it.

```ts
// client/src/game/ui/DeathOverlay.ts
showCauseOfDeath({
  killer, weapon, distance, dodgeAvailable
}: DeathCause) {
  this.show(`Killed by ${killer.name} — ${weapon.name}`);
  if (dodgeAvailable && distance > NEUTRAL_RANGE_TILES) {
    this.show('You could have dodged this projectile.');
  } else if (weapon.kind === 'parry-vulnerable') {
    this.show('Hold SHIFT next time to parry.');
  }
  // ... never more than one tip per death.
}
```

One tip per death. Brown: "if you give them three, they read zero."

## Anti-patterns

- **A modal "Press WASD to move" overlay.** Players close it. They
  never read it. They wonder why the game feels slow.
- **A separate single-player tutorial scene.** Forks the codebase,
  rots, and the bot AI in it diverges from the real bot AI used
  in matches.
- **A "Skip Tutorial" button.** If you're offering it, the
  tutorial is wrong. Brown: "the only good tutorial is the one
  you can't tell is a tutorial."
- **Showing every keybinding at once.** Brown's "one mechanic per
  encounter" rule. Stagger them.
- **Re-showing the controls legend on round 2.** They learned it.
  Stop nagging.
- **Treating Convex `firstSessionAt` as authoritative for combat
  decisions.** It's a lobby flag — the match host trusts the
  matchmaker payload, doesn't re-query Convex inside the 60Hz loop.
- **Designing the tutorial map to be "balanced".** It should be
  *stacked toward the new player learning a thing*, not a fair
  duel.

## Pre-flight checklist

- [ ] No modal popup blocks the game on first launch.
- [ ] Menu shows live gameplay behind it (the playground).
- [ ] Convex matchmaker routes new users (no `firstSessionAt`) to
      a bot warmup.
- [ ] First match uses `boxworks-tutorial`, no chaos modifier.
- [ ] HUD legend appears only in round 1, fades after 3s.
- [ ] First-ever card draft offers a hand-picked, tag-diverse trio.
- [ ] Death overlay surfaces ONE specific tip — never three.
- [ ] No "Skip Tutorial" button anywhere.
- [ ] Playtest with a player who has never seen JAKESJAM. They
      get a kill in round 1 or 2.

## Source

- Game Maker's Toolkit channel (Mark Brown):
  https://www.youtube.com/channel/UCqJ-Xo29CKyLTjn6z2XwYAw
- "10 Game Design Lessons from 10 Years of GMTK" (the recap of
  Brown's recurring rules):
  https://www.youtube.com/watch?v=Cm2_drGLGbc
- "How To Think Like A Game Designer":
  https://www.youtube.com/watch?v=iIOIT3dCy5w
- Brown's site (back catalogue index):
  https://gamemakerstoolkit.com/
---
name: fly-game-deploy
description: >
  Fly.io deployment patterns for JAKESJAM's stateful Bun game server. Use
  when editing fly.toml, server/Dockerfile, the deploy:server:* npm scripts,
  health check handlers, or anything involving: flyctl, fly apps create,
  fly secrets, primary_region, auto_stop_machines, min_machines_running,
  multi-region game server topology, syd/sjc/fra app naming, GAME_SERVER_SECRET,
  or matchmaker → host URL routing. Skip for client (Vite) deploys and
  Convex deploys (use convex skills for those).
---

# Fly.io Deploy — Stateful Game Server

The game server is **stateful per match** — once a `MatchHost` is hosting players, you cannot move it to another machine. Fly's defaults (auto-stop on idle, autoscale based on CPU) actively fight that. Configure deliberately.

## Required fly.toml shape

```toml
app = "jakesjam-srv-syd"
primary_region = "syd"

[build]
  dockerfile = "server/Dockerfile"

[env]
  PORT = "8080"
  REGION = "syd"
  NODE_ENV = "production"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false        # ← stateful: NEVER let Fly stop us
  auto_start_machines = true        # ← but allow cold-start on first req
  min_machines_running = 1
  processes = ["app"]

[[http_service.checks]]
  grace_period = "10s"
  interval = "10s"
  method = "get"
  path = "/health"
  protocol = "http"
  timeout = "2s"

[[vm]]
  cpu_kind = "shared"               # bump to dedicated for >50 CCU per VM
  cpus = 1
  memory_mb = 512
```

The non-obvious bits:
- `auto_stop_machines = false` is mandatory. If Fly stops a VM mid-match, the match is dead — there's no migration story for in-flight WS connections.
- `min_machines_running = 1` keeps a warm host so first-match latency is OK. Bump per region as concurrent matches grow.
- The `/health` handler in `server/src/index.ts` should be **cheap**: respond `200` if the process is up. Don't gate on Convex reachability — health checks shouldn't fail because of an upstream blip.

## Multi-region pattern (one app per region)

We deploy **one Fly app per region**, not one app with `regions = [...]`. Reason: matchmaker routes a client to a specific region's app, and per-app secrets/scaling/observability stay clean.

```bash
flyctl deploy --config fly.toml --app jakesjam-srv-syd  --region syd
flyctl deploy --config fly.toml --app jakesjam-srv-sjc  --region sjc
flyctl deploy --config fly.toml --app jakesjam-srv-fra  --region fra
```

The `app` field in fly.toml is a default; `--app` overrides at deploy time. Naming convention: `jakesjam-srv-<3-letter-region>`.

## First-time region setup

```bash
flyctl apps create jakesjam-srv-<region>
flyctl secrets set --app jakesjam-srv-<region> \
  GAME_SERVER_SECRET=<from password manager> \
  CONVEX_URL=https://<deployment>.convex.cloud
flyctl deploy --config fly.toml --app jakesjam-srv-<region> --region <region>
```

`GAME_SERVER_SECRET` is the HMAC key the server uses to verify match tickets issued by Convex (`server/src/auth.ts`). It **must match** the secret stored in Convex env (`bunx convex env set GAME_SERVER_SECRET …`). If they drift, every WS upgrade 401s.

## Matchmaker → host URL flow

1. Client calls a Convex action (`createOrJoinMatch`) and receives `{ matchId, hostUrl, ticket }`.
2. `hostUrl` is `wss://jakesjam-srv-<region>.fly.dev/match` based on the player's geolocated region (or chosen by lobby).
3. Client opens a WS to `hostUrl` with the `ticket` in the protocol handshake. Server verifies the HMAC, attaches `{ matchId, playerId }` to `ws.data`, joins the topic.

The server **never** publishes its URL — Convex is the registry. To add a region, add an app + deploy + add the region to the matchmaker's region list.

## What to check before a production deploy

- `bun run typecheck` clean across client / server / convex.
- `bun run --filter server test` (if any server-only tests exist) clean.
- `flyctl status --app jakesjam-srv-<region>` shows the current machine healthy.
- `flyctl logs --app jakesjam-srv-<region>` for the last 1–2 mins shows no error spam.
- Active match count is 0 (or you have buy-in to interrupt). Check via Convex query, not by guessing.

## Rollback

`flyctl releases --app jakesjam-srv-<region>` lists prior images. `flyctl deploy --image <prior-image-ref> --app …` redeploys an old build instantly. Safer than re-building old code.

## Anti-patterns (don't do these)

- ❌ `auto_stop_machines = true` on the game server. Mid-match shutdown = dead match.
- ❌ Putting `regions = [a, b, c]` in fly.toml under one app. The matchmaker can't route to a specific region that way.
- ❌ Reading `GAME_SERVER_SECRET` from anywhere except Fly secrets in prod and `.env.local` in dev. Don't commit it; don't put it in `[env]`.
- ❌ Heavy `/health` handlers (DB ping, Convex query). Health checks must be cheap and local.
- ❌ Shipping a deploy mid-match without confirming. Auto mode is not a license here — confirm `match.activeCount` first.
- ❌ Using `flyctl deploy` without `--config` in this repo. Multiple region apps share `fly.toml`; ambiguity breaks deploys.

## References

- [Fly.io WebSockets docs](https://fly.io/docs/networking/websockets/)
- [Fly.io scaling — auto_stop / auto_start semantics](https://fly.io/docs/launch/autostop-autostart/)
- [Fly.io health checks](https://fly.io/docs/reference/configuration/#http_service-checks)
- See also: project `bun-ws-server` skill (server-side WS patterns) and `game-netcode` skill (matchmaker → host handshake).
---
name: improve-codebase-architecture
description: Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language gives names to good seams; ADRs record decisions the skill should not re-litigate.

## Process

### 1. Explore

Read the project's domain glossary and any ADRs in the area you're touching first.

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and also in how tests would improve

**Use CONTEXT.md vocabulary for the domain, and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly (e.g. _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md` — same discipline as `/grill-with-docs` (see [CONTEXT-FORMAT.md](../grill-with-docs/CONTEXT-FORMAT.md)). Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones. See [ADR-FORMAT.md](../grill-with-docs/ADR-FORMAT.md).
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).

===============================================================================
                    BOUNDARY SUMMARY
===============================================================================

client/src/sim/        → game-sim-determinism
client/src/net/        → game-netcode
client/src/game/       → phaser4-game
client/src/sim/data/   → combat-balance-ttk, roguelite-draft-design
server/src/            → game-netcode, fly-game-deploy
convex/                → convex-quickstart, convex-setup-auth, etc.
infrastructure         → improve-codebase-architecture

