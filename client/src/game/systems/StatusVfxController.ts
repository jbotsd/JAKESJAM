// Sim-authoritative status VFX driver. Reads burnUntilTick / freezeUntilTick
// / wardShellUntilTick from each player in the snapshot WorldState and spawns
// fire sparks / freeze shards / frost rings / ward rings via a shared
// ParticlePool. Lightning chain arcs come from `chain-hit` SimEvents; crimson
// leech threads from `emission-leech` (six-axes Drain — same arc language,
// re-tinted). Wall-clock cadence is per-player so tab focus changes don't all
// spawn together. Legibility law (six-axes-goal.md): every axis effect gets a
// world-space read at its site.

import Phaser from "phaser";
import { ParticlePool, STATUS_VFX } from "./ParticlePool";
import { transientVfx } from "../render/TransientVfx";
import type { PlayerId, SimEvent, Vec2, WorldState } from "../../sim";

const BURN_SPARK_INTERVAL_MS = 80;
const FREEZE_SHARD_INTERVAL_MS = 160;
const WARD_RING_INTERVAL_MS = 130;
const SLOW_RING_INTERVAL_MS = 220;

// Ward shell sapphire — the shield/EMIT resource family (matches the
// nameplate WARD chip in OnlineMatchScene's BUFF_DESCRIPTORS).
const WARD_COLOR = 0x38bdf8;
const SLOW_COLOR = 0x7dd3fc;
// Stride refund cyan — conjured-movement register (chassis color law: cyan =
// conjured combat), deliberately hotter than slow's pale drag-wake blue so
// the two feet-level reads never blur.
const STRIDE_COLOR = 0x67e8f9;
// Drain thread crimson — vampire register, deliberately NOT an element color.
const LEECH_COLOR = 0xdc2626;
const LEECH_GLOW = 0x7f1d1d;
const LEECH_THREAD_DURATION_MS = 260;

const SPARK_DURATION_MS = 420;
const SHARD_DURATION_MS = 520;
const RING_DURATION_MS = 320;
const BOLT_DURATION_MS = 130;

const SPARK_HOT_CHANCE = 0.35;

export class StatusVfxController {
  private readonly pool: ParticlePool;
  private readonly burnCadence: Map<string, number> = new Map();
  private readonly freezeCadence: Map<string, number> = new Map();
  private readonly wardCadence: Map<string, number> = new Map();
  private readonly slowCadence: Map<string, number> = new Map();

  constructor(_scene: Phaser.Scene, pool: ParticlePool) {
    // Scene is no longer held — transientVfx owns scene routing now.
    // Constructor signature preserved so callers don't need to
    // change. Remove the param + bump callers in a follow-up.
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
    const seenWard = new Set<string>();
    const seenSlow = new Set<string>();

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

      // Ward shell (six-axes Drain sibling — the Ward axis' post-cast damage
      // gate). Sapphire rings pulse around the vessel while the shell lives
      // so attackers can SEE why their damage halved.
      if (
        player.wardShellUntilTick !== undefined &&
        player.wardShellUntilTick > state.tick
      ) {
        seenWard.add(pidStr);
        const next = (this.wardCadence.get(pidStr) ?? 0) + deltaMs;
        if (next >= WARD_RING_INTERVAL_MS) {
          this.wardCadence.set(pidStr, 0);
          this.spawnWardRing(pos);
        } else {
          this.wardCadence.set(pidStr, next);
        }
      }

      // Slow is a movement-state change, so its world read hugs the feet.
      // Paired contracting rings form a non-colour-only "drag wake"; the HUD
      // chip and actual gait reduction supply the other feedback channels.
      if (player.slowedUntilTick !== undefined && player.slowedUntilTick > state.tick) {
        seenSlow.add(pidStr);
        const next = (this.slowCadence.get(pidStr) ?? SLOW_RING_INTERVAL_MS) + deltaMs;
        if (next >= SLOW_RING_INTERVAL_MS) {
          this.slowCadence.set(pidStr, 0);
          this.spawnSlowDragRing(pos, 0);
          this.spawnSlowDragRing(pos, Math.PI);
        } else {
          this.slowCadence.set(pidStr, next);
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
    for (const key of this.wardCadence.keys()) {
      if (!seenWard.has(key)) this.wardCadence.delete(key);
    }
    for (const key of this.slowCadence.keys()) {
      if (!seenSlow.has(key)) this.slowCadence.delete(key);
    }

    for (const ev of events) {
      if (ev.t === "chain-hit") {
        this.spawnLightningChainArc(
          { x: ev.fromX, y: ev.fromY },
          { x: ev.toX, y: ev.toY },
        );
      }
      if (ev.t === "emission-leech") {
        this.spawnLeechThread(
          { x: ev.fromX, y: ev.fromY },
          { x: ev.toX, y: ev.toY },
        );
      }
      if (ev.t === "stride-refunded") {
        this.spawnStrideRefundSweep({ x: ev.x, y: ev.y });
      }
    }
  }

  destroy(): void {
    this.burnCadence.clear();
    this.freezeCadence.clear();
    this.wardCadence.clear();
    this.slowCadence.clear();
  }

  /** Stride-refund site read (six-axes Layer 1, `stride-refunded`): spent
   *  air movement just came back, so the read is MOVEMENT-registered — an
   *  upward-sweeping pair of flattened rings rising from the feet up the
   *  body (the exact inversion of slow's inward-dragging foot wake), plus
   *  two rising tick sparks. One-shot pooled transients; deliberately not
   *  the generic emission-cast seal flash, which is axis-blind. */
  private spawnStrideRefundSweep(position: Vec2): void {
    const feetY = position.y + 13;
    for (let i = 0; i < 2; i++) {
      const ring = this.pool.acquireRing();
      if (!ring) break;
      // Second ring starts tighter and rises further — a double-beat sweep.
      const startScale = i === 0 ? 0.95 : 0.7;
      const riseTo = i === 0 ? 30 : 44;
      ring.setPosition(position.x, feetY);
      ring.setFillStyle(STRIDE_COLOR, 0);
      ring.setStrokeStyle(2, STRIDE_COLOR, 0.7);
      ring.setScale(startScale, 0.34);
      ring.setAlpha(1);
      transientVfx.spawn({
        factory: () => ring,
        lifetimeMs: RING_DURATION_MS + i * 70,
        startAlpha: 1,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const r = obj as Phaser.GameObjects.Arc;
          r.y = feetY - riseTo * t;
          // Hug the body as it rises — a sweep along the vessel, not a blast.
          r.setScale(startScale * (1 - 0.35 * t), 0.34 * (1 - 0.3 * t));
        },
        release: () => this.pool.release(ring),
      });
    }
    for (let i = 0; i < 2; i++) {
      const spark = this.pool.acquireSpark();
      if (!spark) break;
      const side = i === 0 ? -1 : 1;
      const startX = position.x + side * 10;
      spark.setPosition(startX, feetY);
      spark.setFillStyle(STRIDE_COLOR, 0.85);
      spark.setRotation(0); // upright tick — a rising line, not debris
      spark.setScale(1);
      spark.setAlpha(0.85);
      transientVfx.spawn({
        factory: () => spark,
        lifetimeMs: RING_DURATION_MS,
        startAlpha: 0.85,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const s = obj as Phaser.GameObjects.Rectangle;
          s.y = feetY - 36 * t;
          s.x = startX + side * 3 * t;
          s.setScale(1 - 0.4 * t, 1 + 0.5 * t);
        },
        release: () => this.pool.release(spark),
      });
    }
  }

  private spawnSlowDragRing(position: Vec2, phase: number): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    const startX = position.x + Math.cos(phase) * 9;
    const startY = position.y + 13 + Math.sin(phase) * 3;
    ring.setPosition(startX, startY);
    ring.setFillStyle(SLOW_COLOR, 0);
    ring.setStrokeStyle(2, SLOW_COLOR, 0.62);
    ring.setScale(0.9, 0.34);
    ring.setAlpha(1);
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        r.x = startX - Math.cos(phase) * 12 * t;
        r.setScale(0.9 + 0.45 * t, 0.34 + 0.08 * t);
      },
      release: () => this.pool.release(ring),
    });
  }

  private spawnBurnSpark(position: Vec2): void {
    const spark = this.pool.acquireSpark();
    if (!spark) return;
    const hot = Math.random() < SPARK_HOT_CHANCE;
    const color = hot ? STATUS_VFX.fire.hotColor : STATUS_VFX.fire.color;
    const ox = (Math.random() - 0.5) * 28;
    const startX = position.x + ox;
    const startY = position.y - 10;
    spark.setPosition(startX, startY);
    spark.setFillStyle(color, 0.9);
    spark.setRotation((Math.random() - 0.5) * 0.7);
    spark.setScale(1);
    spark.setAlpha(0.9);
    const targetX = startX + (Math.random() - 0.5) * 14;
    const targetY = startY - 26 - Math.random() * 20;
    transientVfx.spawn({
      factory: () => spark,
      lifetimeMs: SPARK_DURATION_MS + Math.random() * 200,
      startAlpha: 0.9,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const s = obj as Phaser.GameObjects.Rectangle;
        s.x = startX + (targetX - startX) * t;
        s.y = startY + (targetY - startY) * t;
        const sc = 1 - 0.6 * t;
        s.setScale(sc, sc);
      },
      release: () => this.pool.release(spark),
    });
  }

  private spawnFreezeShard(position: Vec2): void {
    const shard = this.pool.acquireShard();
    if (!shard) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 18;
    const startX = position.x + Math.cos(angle) * dist;
    const startY = position.y + Math.sin(angle) * dist;
    shard.setPosition(startX, startY);
    shard.setFillStyle(STATUS_VFX.ice.color, 0.72);
    shard.setRotation(angle + Math.PI / 2);
    shard.setScale(1);
    shard.setAlpha(0.72);
    const targetX = startX + Math.cos(angle) * 12;
    const targetY = startY + Math.sin(angle) * 12;
    transientVfx.spawn({
      factory: () => shard,
      lifetimeMs: SHARD_DURATION_MS,
      startAlpha: 0.72,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const s = obj as Phaser.GameObjects.Rectangle;
        s.x = startX + (targetX - startX) * t;
        s.y = startY + (targetY - startY) * t;
      },
      release: () => this.pool.release(shard),
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
    const finalScale = 32 / 18;
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = 1 + (finalScale - 1) * t;
        r.setScale(s, s);
      },
      release: () => this.pool.release(ring),
    });
  }

  private spawnWardRing(position: Vec2): void {
    const ring = this.pool.acquireRing();
    if (!ring) return;
    ring.setPosition(position.x, position.y - 6);
    ring.setFillStyle(WARD_COLOR, 0.0);
    ring.setStrokeStyle(2, WARD_COLOR, 0.45);
    ring.setScale(1.4);
    ring.setAlpha(1);
    // Contract inward — a shell holding, not a blast leaving (the frost
    // ring expands; inverting the motion keeps the two reads distinct).
    const finalScale = 0.9;
    transientVfx.spawn({
      factory: () => ring,
      lifetimeMs: RING_DURATION_MS,
      startAlpha: 1,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const r = obj as Phaser.GameObjects.Arc;
        const s = 1.4 + (finalScale - 1.4) * t;
        r.setScale(s, s);
      },
      release: () => this.pool.release(ring),
    });
  }

  /** Drain-axis read: the victim's stolen vitality travels to the caster as
   *  a crimson thread — the chain-arc geometry re-tinted, slower and softer
   *  (a siphon, not a strike). */
  private spawnLeechThread(from: Vec2, to: Vec2): void {
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
    // One smooth sag (a drawn thread), not lightning jitter.
    const sag = len * 0.12;
    const pts: Vec2[] = [
      from,
      { x: from.x + dx * 0.5 + px * sag, y: from.y + dy * 0.5 + py * sag },
      to,
    ];

    graphics.lineStyle(4, LEECH_GLOW, 0.35);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    graphics.lineStyle(1.5, LEECH_COLOR, 0.9);
    graphics.beginPath();
    graphics.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i]!.x, pts[i]!.y);
    graphics.strokePath();

    transientVfx.spawn({
      factory: () => graphics,
      lifetimeMs: LEECH_THREAD_DURATION_MS,
      ease: "Sine.easeOut",
      release: () => this.pool.release(graphics),
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

    transientVfx.spawn({
      factory: () => graphics,
      lifetimeMs: BOLT_DURATION_MS,
      ease: "Sine.easeIn",
      release: () => this.pool.release(graphics),
    });
  }
}
