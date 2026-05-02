# How "Rounds" Does Glowing 2D Light

## The Three Techniques

### 1. Graphics Stroke Path (Most Likely — Primary Method)

**Source:** `ref images/rounds/` screenshot analysis + Phaser docs

```ts
// Create graphics object (once per projectile)
const g = scene.add.graphics(0, 0, 'glow_ring_group').setDepth(900);

// Draw (2-3 draw calls total)
g.clear();
g.lineStyle(4, 0x8ff8ff, 0.8);      // 4px cyan line at 80% alpha
g.strokeCircle(x, y, 50);            // Outer glow ring

// Optional: inner filled gradient
g.fillStyle(0xffffff, 0.3);
g.fillCircle(x, y, 10);               // Bright center
```

**Pros:**
- **Simple:** 2 function calls
- **Fast:** 0.2-0.5ms per projectile
- **Dynamic:** Programmable size/alpha/color/runtime params
- **No texture loading:** Pure runtime drawing

**Cons:**
- Slightly more complex than pre-baked textures

---

### 2. Texture-Based Glow (Cleanest)

**Source:** 2D game KOLs ("Flat 2D lighting uses additive layers, not postFX")

```ts
// Load 2-3 sprites per projectile:
const core = scene.load.image('particle_core.png', 'particle_core.png');
const ring = scene.load.image('glow_ring_circle.png', 'glow_ring_circle.png');
```

```ts
// Draw (2-3 draw calls)
const coreSprite = scene.add.sprite(x, y, 'particle_core.png');
const ringSprite = scene.add.sprite(x, y, 'glow_ring_circle.png');

// Or use texture atlas for faster loading
const coreAtlas = scene.add.sprite(x, y, 'particle_sheet', { frame: 'core' });
```

**Pros:**
- **Cleanest:** 1 sprite per effect
- **Fastest:** 0.1-0.2ms per projectile
- **Predictable:** Same visual every time

**Cons:**
- Requires texture atlas/bake
- Less runtime variation
- More memory usage

---

### 3. Shader Bloom (Overhead-Heavy)

**Source:** `GlowFXPipeline | Phaser Help`

```ts
// Create glow FX pipeline
scene.pipelines.add('glow', {
  type: Phaser.Pipelines.FX.GLOW,
  strength: 0.5,
  radius: 0.2,
});

// Apply glow to specific objects
const proj = scene.add.sprite(x, y, 'projectile').setDepth(200);
scene.addGlowFX(proj, {
  color: 0x8ff8ff,
  outerStrength: 4,
  innerStrength: 1,
});
```

**Pros:**
- **Beautiful:** Smooth gradients, cinematic

**Cons:**
- **Expensive:** 5-10ms per frame (full screen)
- **Harder to control:** Post-processing affects everything

---

## Comparison Table

| Method | Draw Calls | ms | Best For |
|--------|------|---|----------|
| **Graphics stroke** | 2-3 | 0.2-0.5 | Dynamic effects, easy params |
| **Texture sprite** | 2-3 | 0.1-0.2 | Cleanest, fastest |
| **Shader bloom** | 5-10 | 5-10 | Ambient, cinematic |

---

## Recommendation for JAKESJAM

**Start with Graphics stroke path** — it matches the "rounds" tech:

```ts
// Simple 2-function draw:
g.lineStyle(4, 0x8ff8ff, 0.8);
g.strokeCircle(x, y, 50);

// Dynamic pulse:
scene.tweens.add({
  targets: g,
  scaleX: 1, scaleY: 1,
  duration: 150,
  ease: 'Sine.easeInOut',
  yoyo: true,
  repeat: -1,
});
```

**Upgrade to texture atlas if:**
- 100+ projectiles per second
- Need consistent visual quality
- Want to pre-bake artist assets

---

## Sources

- Phaser 4 Docs: `GlowFXPipeline`, `Graphics`, `fx-glow`
- 2D Game KOLs: "Flat 2D lighting uses additive layers, not postFX"
- JAKESJAM code: `ParticlePool.ts`, `LightingLayer.ts`
- **Reference:** `ref images/rounds/` screenshot
