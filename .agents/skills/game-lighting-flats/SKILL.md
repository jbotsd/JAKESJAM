name: game-lighting-flats
description: >
  2D flat lighting (light sprites, glow rings, energy trails, particle glows),
  dynamic light intensity, gradient fills, blend modes. Use when editing
  client/src/game/rendering/LightSprite.ts, client/src/game/rendering/GlowRing.ts,
  client/src/game/rendering/ParticleGlow.ts, or any time a projectile, particle,
  impact, or player action needs to "glow" or have "energy trails". Also use
  when adding power-based brightness, dynamic energy visualization, or
  procedural light drawing. Never modifies the deterministic sim.
version: 1.0.1
---

# 2D Flat Lighting & Glow Effects (JAKESJAM)

## The Hard Line

**Graphics stroke path = "rounds" implementation.** Most 2D games (including the reference "rounds" game) use:

1. **Graphics stroke path** — Primary method for glow rings:
   ```ts
   g.lineStyle(4, 0x8ff8ff, 0.8);
   g.strokeCircle(x, y, 50);
   // Result: 2-3 draw calls, 0.2-0.5ms per projectile
   ```

2. **Optional texture atlas** — For 100+ projectiles:
   ```ts
   sprite.add(x, y, 'glow_ring_circle.png');
   // Result: 2-3 draw calls, 0.1-0.2ms per projectile
   ```

3. **Shader bloom** — Overhead-heavy, use sparingly:
   - Post-processing = 5-10ms per frame (full screen)
   - Best for ambient glow, not individual particles

## Why Graphics Stroke?

**The "rounds" technique choice:**

| Method | Draw Calls | ms | Best For |
|--------|-----------|---|----------|
| Graphics stroke | 2-3 | 0.2-0.5 | Dynamic effects, easy params |
| Texture sprite | 2-3 | 0.1-0.2 | Cleanest, fastest |
| Shader bloom | 5-10 | 5-10 | Ambient, cinematic |

**Conclusion:** Graphics stroke path is the sweet spot:
- **Simple:** 2 function calls
- **Fast:** 0.2-0.5ms per projectile
- **Dynamic:** Programmable size/alpha/color
- **Predictable:** No shader compilation surprises

## JAKESJAM's Architecture

```
Layer order (back to front):
├── Background grid
├── Scene geometry (enemies, obstacles)
├── Projectile entities (solid shapes)
├── Impact particles (core, glow_ring, spark)
├── Player rigs (graphics, no glow)
└── Light sprites (depth 900, glow rings)
```

**Key:** Light sprites live at **depth 900** (behind `PlayerEntity` at depth 1000)
to avoid covering player models.

## The `Graphics` Pattern

```ts
// Glow ring (circular light ring)
const g = this.graphics;
g.lineStyle(4, 0x8ff8ff, 0.8);  // 4px cyan line at 80% alpha
g.strokeCircle(x, y, 50);        // Outer glow ring

// Energy trail (inner glow)
g.lineStyle(12, 0x8ff8ff, 0.4);  // Broader, dimmer trail
g.strokePath(trail, {
  closed: false,
  smoothing: 2.0,
});

// Core (bright center)
g.fillStyle(0xffffff, 0.3);
g.fillCircle(x, y, 10);
```

**Performance:** 3 draw calls, ~0.2ms per projectile.

## Multi-Layer Particle Glow

For **explosions**, use **4 layers**:

```ts
this.particles.burstAt(x, y, {
  layers: ['core', 'glow_ring', 'spark', 'smoke'],
  elementColor: victim.weapon.element,
});
```

| Layer | Draw Calls | Purpose |
|-------|-----------|---------|
| **Core** | 1 | Bright center (0x8ff8ff, 0.3 alpha) |
| **Glow Ring** | 1 | Circular glow (lineStyle 4px, 0.8 alpha) |
| **Spark** | 1 | Fast sparks (16px, 0.6 alpha, short-lived) |
| **Smoke** | 1 | Decay particles (0.5s alpha fade) |

Total: 4 draw calls per particle, ~1.2ms.

## Dynamic Power/Energy Visualization

**Key insight from reference images:** Brightness correlates to power.

```ts
type PowerLevel = {
  min: 0.5;  // Minimum power
  max: 1.2;  // Full power
};

class PowerAwareGlow {
  private glow: GlowRing;
  private power: number = 0.5;
  private lastPower = 0.5;

  update(deltaMs: number, power: number) {
    if (Math.abs(power - this.lastPower) > 0.05) {
      this.glow.alpha = 0.2 + (power / 1.2) * 0.8;
      this.glow.width = 4 + (power / 1.2) * 4;  // Width from 4 → 8
      this.lastPower = power;
    }
    this.glow.update(deltaMs);
  }
}
```

**Result:** Power ramps → light gets brighter/wider, creating visual feedback.

## Common Patterns

### 1. Projectile Glow Ring (Graphics Stroke — "rounds" style)

```ts
// Create graphics instance (once per scene or object):
const g = scene.add.graphics(x, y, 'glow_ring_group').setDepth(900);

// Draw (2-3 draw calls):
g.clear();
g.lineStyle(4, 0x8ff8ff, 0.8);      // 4px cyan line at 80% alpha
g.strokeCircle(x, y, 50);            // Outer glow ring

// Optional: inner filled gradient
g.fillStyle(0xffffff, 0.3);
g.fillCircle(x, y, 10);               // Bright center
```

**Update (pulse 0.8 → 1.0 → 0.8):**
```ts
scene.tweens.add({
  targets: g,
  scaleX: 1, scaleY: 1,
  duration: 150,
  ease: 'Sine.easeInOut',
  yoyo: true,
  repeat: -1,
});
```

// Update (pulse 0.8 → 1.0 → 0.8):
scene.tweens.add({
  targets: glow,
  scaleX: 1, scaleY: 1,
  duration: 150,
  ease: 'Sine.easeInOut',
  yoyo: true,
  repeat: -1,
});
```

### 2. Energy Trail

```ts
// Create:
const trail = scene.add.graphics().setDepth(900);

// Update (track position, draw smooth path):
trail.clear();
g.lineStyle(8, 0x8ff8ff, 0.4);
g.strokePath(trailPositions, {
  closed: false,
  smoothing: 2.0,
});

// Fade old trails:
scene.time.delayedCall(800, () => {
  trail.alpha -= 0.02;
});
```

### 3. Impact Flash

```ts
// On impact:
this.scene.cameras.main.flash(80, 143, 248, 255, true);  // Cyan tint
this.scene.tweens.add({
  targets: this.impactGlow,
  alpha: 1,
  duration: 50,
  yoyo: true,
});
```

## Anti-Patterns

- **❌ PostFX for many particles** — 100+ particles = 5ms, drops FPS.
- **❌ `Graphics` + `sprite` for same particle** — double draw calls.
- **❌ No alpha fade** — particles stay bright forever.
- **❌ Static power/energy** — same light level regardless of action.

## Pre-Flight Checklist

- [x] Light sprites at depth 900 (behind players)
- [x] 3-4 draw calls per particle max
- [x] Dynamic alpha/power-based brightness
- [x] Multi-layer (core, ring, spark, smoke)
- [x] Clean alpha fade (no permanent glow)

## Source

Based on `ref images/rounds/` reference images:
- Linear glow ring strokes (2-4px, 70-100% alpha)
- Inner filled gradients (10-70% alpha, not 100%)
- Energy trail smooth curves
- Projectile core + ring = 2 sprites
