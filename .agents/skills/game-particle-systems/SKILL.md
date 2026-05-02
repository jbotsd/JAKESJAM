name: game-particle-systems
description: >
  Particle system architecture, burst lifecycle, pool management, multi-layer
  bursts (core, glow_ring, spark, smoke), lifetime curves. Use when editing
  client/src/game/systems/ParticlePool.ts, StatusVfxController.ts, or any time
  creating a new particle burst type. Render-layer only.
version: 1.0.1
---

# Particle System Architecture

## The Hard Line

**Arcade Rectangle/Arc/Graphics pools, 15-32 particles total.**
- Arcade `Rectangle` = 1 draw call per active object
- Arcade `Arc` (circle) = 1 draw call per active object
- Arcade `Graphics` = 1-2 draw calls per active object
- Pool reuse prevents GC = 0.1-0.3ms per burst.

**Multi-Layer Burst Structure:**

| Layer | Arcade Type | Draw Calls | Purpose |
|-------|----------|------|---------|
| **Spark** | `Rectangle` | 1 | Point spark, 16x7, 0.6α, 300ms |
| **Shard** | `Rectangle` | 1 | Angular shard, 4x9, 0.8α, 200ms |
| **Ring** | `Arc` | 1 | Circular ring, 18px, 0.7α, 0.5s |
| **Bolt** | `Graphics` | 2 | Lightning bolt, 4 stroke calls, 0.4α, 0.2s |
| **BlastCircle** | `Arc` | 1 | Additive flash, 16px, 1.0α, 0.1s |

Total: 15-32 particles per burst, **1-2ms runtime**.

## Real Pool Implementation

**JAKESJAM uses Arcade Rectangle/Arc/Graphics pools:**

```ts
export class ParticlePool {
  private sparkFree: Rectangle[] = [];
  private shardFree: Rectangle[] = [];
  private ringFree: Arc[] = [];
  private boltFree: Graphics[] = [];
  private blastCircleFree: Arc[] = [];
  private readonly origin: WeakMap<GameObject, PoolName> = new WeakMap();

  constructor(scene: Phaser.Scene) {
    // Pre-allocate 64 sparks, 32 shards, 16 rings, 4 bolts, 16 blastCircles
    for (let i = 0; i < POOL_SIZES.spark; i++) {
      const r = scene.add.rectangle(0, 0, 3, 7, 0xffffff, 1);
      r.setVisible(false);
      this.origin.set(r, "spark");
      this.sparkFree.push(r);
    }
    // ... same for shard, ring, bolt, blastCircle
  }

  acquireSpark(): Rectangle | null {
    const obj = this.sparkFree.pop();
    obj?.setVisible(true);
    return obj;
  }

  acquireRing(): Arc | null {
    const obj = this.ringFree.pop();
    obj?.drawCircle(x, y, radius, color, alpha);
    return obj;
  }

  acquireBolt(): Graphics | null {
    const obj = this.boltFree.pop();
    obj?.setVisible(true);
    return obj;
  }

  releaseAll(gfx: Graphics | Rectangle | Arc) {
    gfx.setVisible(false);
    this.origin.set(gfx);
  }
}
```

**Pool sizes:** 64 sparks, 32 shards, 16 rings, 4 bolts, 16 blastCircles.
**Type:** Arcade `Rectangle`/`Arc`/`Graphics` for easy pooling.

```ts
// Example burst:
const spark = this.particles.acquireSpark();
const ring = this.particles.acquireRing();

// Update (position, tween, alpha fade...)
spark.rotation += 0.2;
ring.x += 1.5, ring.y += 1.0;

// On complete (release back to pool)
scene.tweens.add({
  target: spark,
  duration: 300,
  onComplete: () => this.particles.releaseAll(spark),
});
```
