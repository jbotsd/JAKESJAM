name: game-render-pipeline
description: >
  Render pipeline architecture, draw order optimization, depth layering,
  batching, texture atlases. Use when editing client/src/game/rendering/* or
  client/src/game/scenes/MatchScene.ts and optimizing render performance.
version: 1.0.0
---

# Render Pipeline & Depth Layering

## The Hard Line

**Fixed draw order = predictable visual depth.** JAKESJAM uses 7-8 depth layers,
not 100+. Fixed layers = no surprises, no "who's front?" bugs.

## Depth Layer Order

```
Depth 0:    Background grid (fixed, never moves)
Depth 100:  Scene geometry (enemies, obstacles, destructibles)
Depth 200:  Projectile entities (solid shapes)
Depth 300:  Status sprites (health bars, name tags, ammo)
Depth 400:  Particle effects (core, spark, debris)
Depth 500:  UI overlays (round banner, damage numbers, health flash)
Depth 900:  Light sprites (glow rings, subtle ambience)
Depth 1000: PlayerEntity rigs (main character draw)
Depth 1100: HUD (crosshair, mini-map, corner elements)
```

**Key:** Light sprites at **depth 900** (behind `PlayerEntity` at 1000) to
avoid covering players.

## Performance Budgets

| Layer | Draw Calls | ms |
|-------|--------|---|
| Background grid | 1 (cached) | 0.1 |
| Scene geometry | 10-20 | 1-2 |
| Projectiles | 5-10 (per bullet) | 1-3 |
| Particles | 20-40 (per burst) | 2-5 |
| UI overlays | 2-5 | 0.5 |
| Light sprites | 10-20 | 1-2 |
| **Total (60 FPS)** | 50-100 | 5-15 |

## Texture Atlases

**One atlas per logical group:**

```ts
// client/src/game/data/textures.ts
const TEXTURES = {
  player: ['head', 'body', 'arm_left', 'arm_right', 'leg_left', 'leg_right'],
  projectile_glow: ['core', 'ring', 'trail', 'flash'],
  particle_core: ['spark_inner_16x16.png'],
  particle_ring: ['glow_ring_circle.png'],
  particle_spark: ['spark_8x8.png'],
  particle_smoke: ['smoke_16x16.png'],
  light_circle: ['light_circle.png'], // Large 128x128 for light sprites
} as const;
```

**Load once, reuse thousands of times.**

## Draw Call Caching

```ts
class CachedLightSprite {
  private graphics: Phaser.GameObjects.Graphics;
  private glowRing: Phaser.GameObjects.Image;

  draw(scene: Phaser.Scene, x: number, y: number, size: number, alpha: number) {
    // Create once, update alpha
    if (!this.graphics) {
      this.graphics = scene.add.graphics(0, 0).setDepth(900);
      this.glowRing = scene.add.image(0, 0, 'light_circle').setDepth(900);
    }
    
    // Clear and redraw
    this.graphics.clear();
    this.graphics.lineStyle(4, 0x8ff8ff, alpha);
    this.graphics.strokeCircle(x, y, size);
    
    this.glowRing.scale.x = size;
    this.glowRing.scale.y = size;
    this.glowRing.alpha = alpha * 0.3;
  }
}
```

## Batching & Reuse

**Sprite reuse:** Don't create-destroy per frame.

```ts
// ✅ Correct: Pre-create array
const glows = scene.add.group({
  className: 'GlowRing',
  key: 'glow_ring_circle',
});

// Update: Only alpha + position
glows.getFirstDead(true)?.setActive(false).setVisible(false);

// ✅ Wrong: Create per frame
const glow = scene.add.image(x, y, 'glow_ring_circle').setAlpha(0.5); // 60 calls/sec overhead
```

## Depth Collision

**Problem:** What if a projectile passes through a light sprite?

**Solution:** Layer order + depth priority

| Entity | Draw Order |
|--------|-----------|
| `Projectile` | Depth 200 |
| `LightSprite` | Depth 900 |
| `PlayerRig` | Depth 1000 |

Result: Projectiles pass through lights, appear in front of players. Correct!
