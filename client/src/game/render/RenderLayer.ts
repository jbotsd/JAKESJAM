// `import type` keeps the Phaser bundle out of Node-side test runs that
// don't have a `window` (Bun's default test env). The runtime constant
// previously read from `Phaser.BlendModes.ADD` is inlined as
// `BLEND_MODE_ADD` below — frozen value from Phaser's enum, hasn't
// changed across 3.x → 4.x.
import type Phaser from "phaser";
import type { DestructibleKind, ElementType, Vec2 } from "../types/game";
import { destructibleColor } from "../systems/DestructibleRenderer";
import type { ParticlePool } from "../systems/ParticlePool";
import { PALETTE } from "../ui/palette";

/** Phaser.BlendModes.ADD — inlined to avoid runtime Phaser import in tests. */
const BLEND_MODE_ADD = 1;

/**
 * RenderLayer — owns the cluster of one-shot ephemeral VFX bursts that
 * MatchScene used to spawn inline. Each method allocates a few Phaser
 * GameObjects, attaches a tween, and self-destroys on tween complete.
 *
 * No game-logic side effects — every method is "given a position, paint
 * a thing." Callers stay in charge of when and why these fire.
 *
 * Why not use ParticlePool? These are low-frequency events (death, kill,
 * pickup pickup, destructible break) where the cost of allocate/destroy
 * is negligible and the variety of shapes/text styles makes pooling
 * awkward. Pooling stays for the high-frequency status-VFX path.
 * Exception: spawnExplosionBlast uses the blastCircle pool for stacked-
 * additive bloom to match the ROUNDS ref visual.
 */
export class RenderLayer {
  private readonly scene: Phaser.Scene;
  private readonly pool: ParticlePool | null;

  constructor(scene: Phaser.Scene, pool: ParticlePool | null = null) {
    this.scene = scene;
    this.pool = pool;
  }

  /** Big radial blast + 18 colorful shards. Used when a remote player dies.
   *  Automatically fires the big spike overlay — death is the loudest moment. */
  spawnPlayerDeathExplosion(position: Vec2): void {
    // Auto-invoke the big spike overlay first (plays behind the shards).
    this.spawnExplosionBlastBig(position, 118, 0xfb7185);

    const blast = this.scene.add.circle(position.x, position.y, 10, 0xf7fbff, 0.52);
    blast.setStrokeStyle(4, 0xfb7185, 0.95);
    this.scene.tweens.add({
      targets: blast,
      radius: 118,
      alpha: 0,
      duration: 520,
      ease: "Sine.easeOut",
      onComplete: () => blast.destroy(),
    });

    for (let index = 0; index < 18; index += 1) {
      const angle = (Math.PI * 2 * index) / 18;
      const shard = this.scene.add.rectangle(
        position.x,
        position.y,
        5,
        14,
        index % 2 === 0 ? 0x50e3c2 : 0xf0abfc,
        0.92,
      );
      shard.rotation = angle;
      this.scene.tweens.add({
        targets: shard,
        x: position.x + Math.cos(angle) * 82,
        y: position.y + Math.sin(angle) * 82,
        alpha: 0,
        duration: 500,
        ease: "Sine.easeOut",
        onComplete: () => shard.destroy(),
      });
    }

    // Camera shake — stronger than a regular blast, never suppress.
    const cam = this.scene.cameras?.main;
    if (cam) {
      cam.shake(260, 0.016);
    }
  }

  /** Soft expanding ring used when a player respawns. */
  spawnRespawnBurst(position: Vec2): void {
    const ring = this.scene.add.circle(position.x, position.y, 8, 0x50e3c2, 0.18);
    ring.setStrokeStyle(3, 0x50e3c2, 0.82);
    this.scene.tweens.add({
      targets: ring,
      radius: 54,
      alpha: 0,
      duration: 360,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  /** 8 directional shards used when a destructible breaks. */
  destructibleBurst(position: Vec2, kind: DestructibleKind, element: ElementType): void {
    const color = element === "fire" ? 0xff7a18 : destructibleColor(kind);
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      const shard = this.scene.add.rectangle(position.x, position.y, 4, 9, color, 0.86);
      shard.rotation = angle;
      this.scene.tweens.add({
        targets: shard,
        x: position.x + Math.cos(angle) * 38,
        y: position.y + Math.sin(angle) * 28,
        alpha: 0,
        duration: 260,
        ease: "Sine.easeOut",
        onComplete: () => shard.destroy(),
      });
    }
  }

  /** Floating damage number above a destructible. */
  flashDestructibleText(
    position: Vec2,
    sizeY: number,
    amount: number,
    element: ElementType,
  ): void {
    const color = element === "fire" ? "#ffb86b" : "#f7fbff";
    const text = this.scene.add
      .text(position.x, position.y - sizeY / 2 - 10, Math.round(amount).toString(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "11px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 22,
      alpha: 0,
      duration: 280,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /** Floating damage number above the practice target (different size/color). */
  flashTargetText(position: Vec2, amount: number, element: ElementType): void {
    const color =
      element === "fire"
        ? "#ffb86b"
        : element === "ice"
          ? "#bfdbfe"
          : element === "radiant"
            ? "#fff7d6"
            : "#50e3c2";
    const text = this.scene.add
      .text(position.x, position.y - 24, Math.round(amount).toString(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "13px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.scene.tweens.add({
      targets: text,
      y: position.y - 52,
      alpha: 0,
      duration: 380,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /** Expanding ring used when the practice target dies. */
  killTargetBurst(position: Vec2, impactRadius: number): void {
    const burst = this.scene.add.circle(position.x, position.y, 8, 0xf7fbff, 0.5);
    burst.setStrokeStyle(3, 0x50e3c2, 0.9);
    this.scene.tweens.add({
      targets: burst,
      radius: Math.max(90, impactRadius),
      alpha: 0,
      duration: 420,
      ease: "Sine.easeOut",
      onComplete: () => burst.destroy(),
    });
  }

  /** Floating damage number above a remote player. */
  floatRemoteDamageText(position: Vec2, amount: number, element: ElementType): void {
    const color = element === "fire" ? "#ffb86b" : "#f0abfc";
    const text = this.scene.add
      .text(position.x, position.y - 34, Math.round(amount).toString(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "13px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 28,
      alpha: 0,
      duration: 360,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /** Generic floating damage number (local hit / remote hit on the local player). */
  spawnDamageNumber(position: Vec2, amount: number, isLocal: boolean): void {
    if (amount < 1) return;
    const spread = (Math.random() - 0.5) * 22;
    const text = this.scene.add
      .text(position.x + spread, position.y - 32, Math.round(amount).toString(), {
        color: isLocal ? "#fb7185" : "#fff7d6",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: amount >= 30 ? "18px" : "14px",
        fontStyle: "900",
        stroke: "#05080f",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(800);
    this.scene.tweens.add({
      targets: text,
      y: text.y - 28,
      alpha: 0,
      duration: 560,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /** Floating "PICKUP NAME" label drifting upward. */
  floatPickupText(position: Vec2, label: string, color: string): void {
    const text = this.scene.add
      .text(position.x, position.y - 22, label.toUpperCase(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "11px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 30,
      alpha: 0,
      duration: 520,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  /** Generic explosion blast — stacked-additive bloom circles from ParticlePool.
   *  Falls back to a simple single circle when the pool is unavailable (e.g. tests).
   *
   *  @param damage  Optional hit damage. When > 25, automatically also fires the
   *                 big spike-overlay variant and uses heavier camera shake. */
  spawnExplosionBlast(position: Vec2, radius: number, damage?: number): void {
    const isBig = damage !== undefined && damage > 25;

    if (!this.pool) {
      // Fallback: original single-circle behaviour (keeps test assertions stable).
      const blast = this.scene.add.circle(position.x, position.y, 6, 0xffd166, 0.36);
      blast.setStrokeStyle(3, 0xfb7185, 0.95);
      this.scene.tweens.add({
        targets: blast,
        radius,
        alpha: 0,
        duration: 260,
        ease: "Sine.easeOut",
        onComplete: () => blast.destroy(),
      });
      this.applyBlastShake(isBig);
      return;
    }
    this.spawnBloomLayers(position, radius, this.pool);
    this.spawnBlastSparks(position, this.pool);
    if (isBig) {
      this.spawnExplosionBlastBig(position, radius);
    }
    this.applyBlastShake(isBig);
  }

  /** Apply camera shake for a blast. Never stacks — skipped if a shake is
   *  already running. Guards against test environments where cameras is absent. */
  private applyBlastShake(big: boolean): void {
    const cam = this.scene.cameras?.main;
    if (!cam) return;
    // shakeEffect.isRunning is the Phaser 4 RC API for checking in-flight shake.
    if (cam.shakeEffect?.isRunning) return;
    if (big) {
      cam.shake(180, 0.012);
    } else {
      cam.shake(60, 0.004);
    }
  }

  /** Big explosion blast — same bloom + a 16-spike radial star overlay.
   *  Use for boss kills, ults, or killing blows. */
  spawnExplosionBlastBig(
    position: Vec2,
    radius: number,
    baseColor: number = PALETTE.blastMid,
  ): void {
    if (this.pool) {
      this.spawnBloomLayers(position, radius, this.pool);
      this.spawnBlastSparks(position, this.pool);
    } else {
      const blast = this.scene.add.circle(position.x, position.y, 6, baseColor, 0.5);
      this.scene.tweens.add({
        targets: blast,
        radius,
        alpha: 0,
        duration: 300,
        ease: "Sine.easeOut",
        onComplete: () => blast.destroy(),
      });
    }
    // Radial spike overlay — 16 thin rectangles fanned around center.
    const spikeCount = 16;
    for (let i = 0; i < spikeCount; i++) {
      const angle = (Math.PI * 2 * i) / spikeCount;
      const spikeLength = radius * (0.8 + Math.random() * 0.6); // 0.8–1.4 × radius
      const spike = this.scene.add.rectangle(
        position.x + Math.cos(angle) * spikeLength * 0.5,
        position.y + Math.sin(angle) * spikeLength * 0.5,
        3,
        spikeLength,
        baseColor,
        0.85,
      );
      spike.setStrokeStyle(1, PALETTE.cardFrameInk, 1);
      spike.rotation = angle + Math.PI / 2;
      this.scene.tweens.add({
        targets: spike,
        alpha: 0,
        duration: 200,
        ease: "Sine.easeOut",
        onComplete: () => spike.destroy(),
      });
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private spawnBloomLayers(position: Vec2, radius: number, pool: ParticlePool): void {
    const scales = [0.4, 0.7, 1.0, 1.2, 1.5] as const;
    const colors = [
      PALETTE.blastCore,
      PALETTE.blastCore,
      PALETTE.blastMid,
      PALETTE.blastMid,
      PALETTE.blastHalo,
    ] as const;
    const alphas = [1.0, 0.9, 0.7, 0.5, 0.3] as const;
    const durations = [180, 200, 240, 280, 320] as const;

    for (let i = 0; i < scales.length; i++) {
      const arc = pool.acquireBlastCircle();
      if (!arc) continue; // pool exhausted — silent skip

      const scale = scales[i]!;
      const color = colors[i]!;
      const alpha = alphas[i]!;
      const duration = durations[i]!;
      const layerRadius = radius * scale;
      arc.setRadius(layerRadius);
      arc.setFillStyle(color, alpha);
      arc.setPosition(position.x, position.y);
      arc.setScale(1);
      arc.setAlpha(alpha);
      arc.setBlendMode(BLEND_MODE_ADD);

      const targetScale = scale * 1.2; // +20%
      this.scene.tweens.add({
        targets: arc,
        scaleX: targetScale / scale,
        scaleY: targetScale / scale,
        alpha: 0,
        duration,
        ease: "Sine.easeOut",
        onComplete: () => pool.release(arc),
      });
    }
  }

  private spawnBlastSparks(position: Vec2, pool: ParticlePool): void {
    const count = 10 + Math.floor(Math.random() * 5); // 10–14
    for (let i = 0; i < count; i++) {
      const spark = pool.acquireSpark();
      if (!spark) break; // pool exhausted — silent skip

      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 18;
      // Alternate between emberGold and blastHalo for visual variety.
      const sparkColor = i % 2 === 0 ? PALETTE.emberGold : PALETTE.blastHalo;
      spark.setFillStyle(sparkColor, 0.9);
      spark.setPosition(position.x, position.y);
      spark.setAlpha(0.9);
      this.scene.tweens.add({
        targets: spark,
        x: position.x + Math.cos(angle) * dist,
        y: position.y - (20 + Math.random() * 30), // drift upward
        alpha: 0,
        duration: 600,
        ease: "Sine.easeOut",
        onComplete: () => pool.release(spark),
      });
    }
  }
}
