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

## Quick checks before a PR

- `bun run --filter client typecheck` clean.
- No `Math.random()` outside `client/src/game/ui` and `client/src/game/rendering` (sim purity).
- No `setTimeout`/`setInterval` driving gameplay — use `scene.time.addEvent` for cosmetic timers, sim ticks for gameplay timers.

## References (KOLs / sources)

- [Phaser Dev Log 260 — Phaser 4 ECS internals](https://phaser.io/devlogs/260)
- [bitECS docs — data-oriented ECS using TypedArrays](https://github.com/NateTheGreatt/bitECS)
- [Phaser Performance Optimization — Object Pooling, Atlases (2025)](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide)
- [Phaser 4 + Vite + TS template](https://github.com/phaserjs/phaser-editor-template-vite-ts)
