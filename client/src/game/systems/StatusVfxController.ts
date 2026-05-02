// Sim-authoritative status VFX driver. Reads burnUntilTick / freezeUntilTick
// from each player in the snapshot WorldState and spawns fire sparks / freeze
// shards / frost rings via a shared ParticlePool. Lightning chain arcs come
// from `chain-hit` SimEvents. Wall-clock cadence is per-player so tab focus
// changes don't all spawn together.

import Phaser from "phaser";
import { ParticlePool, STATUS_VFX } from "./ParticlePool";
import type { PlayerId, SimEvent, Vec2, WorldState } from "../../sim";

const BURN_SPARK_INTERVAL_MS = 80;
const FREEZE_SHARD_INTERVAL_MS = 160;

const SPARK_DURATION_MS = 420;
const SHARD_DURATION_MS = 520;
const RING_DURATION_MS = 320;
const BOLT_DURATION_MS = 130;

const SPARK_HOT_CHANCE = 0.35;

export class StatusVfxController {
  private readonly scene: Phaser.Scene;
  private readonly pool: ParticlePool;
  private readonly burnCadence: Map<string, number> = new Map();
  private readonly freezeCadence: Map<string, number> = new Map();

  constructor(scene: Phaser.Scene, pool: ParticlePool) {
    this.scene = scene;
    this.pool = pool;
  }

  update(
    state: WorldState,
    events: readonly SimEvent[],
    deltaMs: number,
    getPosition: (id: PlayerId) => Vec2 | undefined,
  ): void {
    const seenBurn = new Set<string>();
    const seenFreeze = new Set<string>();

    for (const [pidStr, player] of Object.entries(state.players)) {
      if (!player.alive) continue;
      const pid = pidStr as PlayerId;
      const pos = getPosition(pid);
      if (!pos) continue;

      if (player.burnUntilTick !== undefined && player.burnUntilTick > state.tick) {
        seenBurn.add(pidStr);
        const next = (this.burnCadence.get(pidStr) ?? 0) + deltaMs;
        if (next >= BURN_SPARK_INTERVAL_MS) {
          this.burnCadence.set(pidStr, 0);
          this.spawnBurnSpark(pos);
        } else {
          this.burnCadence.set(pidStr, next);
        }
      }

      if (player.freezeUntilTick !== undefined && player.freezeUntilTick > state.tick) {
        seenFreeze.add(pidStr);
        const next = (this.freezeCadence.get(pidStr) ?? 0) + deltaMs;
        if (next >= FREEZE_SHARD_INTERVAL_MS) {
          this.freezeCadence.set(pidStr, 0);
          this.spawnFreezeShard(pos);
          this.spawnFreezeShard(pos);
          this.spawnFrostRing(pos);
        } else {
          this.freezeCadence.set(pidStr, next);
        }
      }
    }

    // Drop cadence entries for players that no longer have an active status.
    for (const key of this.burnCadence.keys()) {
      if (!seenBurn.has(key)) this.burnCadence.delete(key);
    }
    for (const key of this.freezeCadence.keys()) {
      if (!seenFreeze.has(key)) this.freezeCadence.delete(key);
    }

    for (const ev of events) {
      if (ev.t === "chain-hit") {
        this.spawnLightningChainArc(
          { x: ev.fromX, y: ev.fromY },
          { x: ev.toX, y: ev.toY },
        );
      }
    }
  }

  destroy(): void {
    this.burnCadence.clear();
    this.freezeCadence.clear();
  }

  private spawnBurnSpark(position: Vec2): void {
    const spark = this.pool.acquireSpark();
    if (!spark) return;
    const hot = Math.random() < SPARK_HOT_CHANCE;
    const color = hot ? STATUS_VFX.fire.hotColor : STATUS_VFX.fire.color;
    const ox = (Math.random() - 0.5) * 28;
    spark.setPosition(position.x + ox, position.y - 10);
    spark.setFillStyle(color, 0.9);
    spark.setRotation((Math.random() - 0.5) * 0.7);
    spark.setScale(1);
    spark.setAlpha(0.9);
    this.scene.tweens.add({
      targets: spark,
      y: spark.y - 26 - Math.random() * 20,
      x: spark.x + (Math.random() - 0.5) * 14,
      alpha: 0,
      scaleX: 0.4,
      scaleY: 0.4,
      duration: SPARK_DURATION_MS + Math.random() * 200,
      ease: "Sine.easeOut",
      onComplete: () => this.pool.release(spark),
    });
  }

  private spawnFreezeShard(position: Vec2): void {
    const shard = this.pool.acquireShard();
    if (!shard) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 18;
    shard.setPosition(
      position.x + Math.cos(angle) * dist,
      position.y + Math.sin(angle) * dist,
    );
    shard.setFillStyle(STATUS_VFX.ice.color, 0.72);
    shard.setRotation(angle + Math.PI / 2);
    shard.setScale(1);
    shard.setAlpha(0.72);
    this.scene.tweens.add({
      targets: shard,
      x: shard.x + Math.cos(angle) * 12,
      y: shard.y + Math.sin(angle) * 12,
      alpha: 0,
      duration: SHARD_DURATION_MS,
      ease: "Sine.easeOut",
      onComplete: () => this.pool.release(shard),
    });
  }

  private spawnFrostRing(position: Vec2): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    ring.setPosition(position.x, position.y);
    ring.setFillStyle(STATUS_VFX.ice.color, 0.0);
    ring.setStrokeStyle(2, STATUS_VFX.ice.color, 0.52);
    ring.setScale(1);
    ring.setAlpha(1);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 32 / 18,
      scaleY: 32 / 18,
      alpha: 0,
      duration: RING_DURATION_MS,
      ease: "Sine.easeOut",
      onComplete: () => this.pool.release(ring),
    });
  }

  private spawnLightningChainArc(from: Vec2, to: Vec2): void {
    const graphics = this.pool.acquireBolt();
    if (!graphics) return;
    graphics.setPosition(0, 0);
    graphics.setAlpha(1);
    graphics.setScale(1);
    graphics.setRotation(0);
    graphics.setBlendMode(Phaser.BlendModes.ADD);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / len;
    const py = dx / len;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;

    const offsets = [
      (Math.random() - 0.5) * len * 0.22,
      (Math.random() - 0.5) * len * 0.18,
      (Math.random() - 0.5) * len * 0.22,
    ];
    const pts: Vec2[] = [
      from,
      { x: from.x + dx * 0.25 + px * offsets[0]!, y: from.y + dy * 0.25 + py * offsets[0]! },
      { x: mx + px * offsets[1]!, y: my + py * offsets[1]! },
      { x: from.x + dx * 0.75 + px * offsets[2]!, y: from.y + dy * 0.75 + py * offsets[2]! },
      to,
    ];

    graphics.lineStyle(5, STATUS_VFX.lightning.glow, 0.3);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    graphics.lineStyle(2, STATUS_VFX.lightning.color, 0.92);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    this.scene.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: BOLT_DURATION_MS,
      ease: "Sine.easeIn",
      onComplete: () => this.pool.release(graphics),
    });
  }
}
