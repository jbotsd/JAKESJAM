// Object pool for status-VFX particles (sparks, shards, frost rings, lightning
// bolts). Pre-allocates at scene create() time so the per-frame VFX path stays
// allocation-free and we avoid GC pauses during combat. Free-list per type;
// callers `acquire*()` to draw and `release(gfx)` (typically from a tween's
// onComplete) to return the object to the pool.
//
// Pool exhaustion is non-fatal — `acquire*` returns null and emits a one-time
// warning per pool name. Callers must check for null and skip the spawn.

import type Phaser from "phaser";
import { GLOW_TEXTURE_KEY, ensureGlowTexture } from "../render/glowTexture";
import { getQualityProfile } from "../render/qualityProfile.js";

export const STATUS_VFX = {
  fire: { color: 0xff7a18, hotColor: 0xfde68a },
  ice: { color: 0x93c5fd },
  lightning: { color: 0xfef08a, glow: 0xfbbf24 },
} as const satisfies Record<string, Readonly<Record<string, number>>>;

// Base budgets — scaled by the QualityProfile's particleScale at create()
// (potato 0.25 / phone 0.6 / desktop 1). Pool exhaustion is non-fatal by
// design (acquireX returns null, effect skipped), so a smaller pool IS the
// particle-count dial: weak devices simply skip the overflow effects.
const POOL_SIZES = {
  // spark 64→96, ring 16→24, blastCircle 16→24 (K10): the same live-tape
  // console sentinel that exposed the bolt starvation below also caught
  // these three exhausted mid-brawl — melee-era effect density (contact
  // chords + debris + kill bursts stacking) outgrew the pre-melee
  // budgets. +50%, not a blank check: exhaustion stays the legitimate
  // quality dial via particleScale on weaker profiles.
  spark: 96,
  shard: 32,
  ring: 24,
  // 4 → 16 (K10, 2026-07-24): sized when lightning arcs were the only
  // Graphics consumer, but the melee overhaul made bolts the workhorse —
  // 15 spawn sites now share this pool (slash marks, ground dust, melee
  // debris, kill shock ring, ward raise/absorb/drop, nova bursts, cast
  // tells, lances, blink streaks...) at 300-500ms lifetimes each. In a
  // live melee brawl 4 was permanently exhausted, so later spawns were
  // silently skipped — the K10 live tape's console sentinel caught
  // "[ParticlePool] bolt pool exhausted" mid-brawl, and the R1 row-17
  // kill shock ring had never once rendered in a real match while
  // isolated harness strips (empty pool) showed it fine. Idle pooled
  // Graphics cost nothing to hold; render cost accrues only when spawned.
  bolt: 16,
  blastCircle: 24,
  glow: 64,
} as const;

function scaled(base: number): number {
  return Math.max(2, Math.ceil(base * getQualityProfile().particleScale));
}

const SPARK_W = 3;
const SPARK_H = 7;
const SHARD_W = 4;
const SHARD_H = 9;
const RING_RADIUS = 18;

type PoolName = "spark" | "shard" | "ring" | "bolt" | "blastCircle" | "glow";

export class ParticlePool {
  /** Bolts an ambient acquire may never touch — held for kill-tier spawns
   *  (see acquireBolt's docblock). 2 covers the kill moment's own bolt
   *  needs (shock ring now; a future kill-debris upgrade has headroom)
   *  and stays below every particleScale's floor (scaled() min is 2 —
   *  a potato profile simply reserves its whole bolt pool for kills). */
  private static readonly BOLT_KILL_RESERVE = 2;
  private readonly sparkFree: Phaser.GameObjects.Rectangle[] = [];
  private readonly sparkActive: Set<Phaser.GameObjects.Rectangle> = new Set();

  private readonly shardFree: Phaser.GameObjects.Rectangle[] = [];
  private readonly shardActive: Set<Phaser.GameObjects.Rectangle> = new Set();

  private readonly ringFree: Phaser.GameObjects.Arc[] = [];
  private readonly ringActive: Set<Phaser.GameObjects.Arc> = new Set();

  private readonly boltFree: Phaser.GameObjects.Graphics[] = [];
  private readonly boltActive: Set<Phaser.GameObjects.Graphics> = new Set();

  private readonly blastCircleFree: Phaser.GameObjects.Arc[] = [];
  private readonly blastCircleActive: Set<Phaser.GameObjects.Arc> = new Set();

  // Additive radial-gradient glows (the "rounds"-style soft halo). Tinted at
  // acquire time; depth set by caller.
  private readonly glowFree: Phaser.GameObjects.Image[] = [];
  private readonly glowActive: Set<Phaser.GameObjects.Image> = new Set();

  private readonly warned: Set<PoolName> = new Set();
  // Tracks which pool each acquired object belongs to so `release` can return
  // it correctly without relying on Phaser-class `instanceof` (which fails in
  // headless bun:test environments).
  private readonly origin: WeakMap<Phaser.GameObjects.GameObject, PoolName> =
    new WeakMap();
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < scaled(POOL_SIZES.spark); i++) {
      const r = scene.add.rectangle(0, 0, SPARK_W, SPARK_H, 0xffffff, 1);
      r.setVisible(false);
      this.origin.set(r, "spark");
      this.sparkFree.push(r);
    }
    for (let i = 0; i < scaled(POOL_SIZES.shard); i++) {
      const r = scene.add.rectangle(0, 0, SHARD_W, SHARD_H, 0xffffff, 1);
      r.setVisible(false);
      this.origin.set(r, "shard");
      this.shardFree.push(r);
    }
    for (let i = 0; i < scaled(POOL_SIZES.ring); i++) {
      const a = scene.add.circle(0, 0, RING_RADIUS, 0xffffff, 0);
      a.setVisible(false);
      this.origin.set(a, "ring");
      this.ringFree.push(a);
    }
    for (let i = 0; i < scaled(POOL_SIZES.bolt); i++) {
      const g = scene.add.graphics();
      g.setVisible(false);
      this.origin.set(g, "bolt");
      this.boltFree.push(g);
    }
    for (let i = 0; i < scaled(POOL_SIZES.blastCircle); i++) {
      // Radius 1 placeholder — caller sets radius + colour at acquire time.
      const a = scene.add.circle(0, 0, 1, 0xffffff, 1);
      a.setVisible(false);
      a.setBlendMode(1); // Phaser.BlendModes.ADD = 1; using literal to avoid importing Phaser runtime in headless tests
      this.origin.set(a, "blastCircle");
      this.blastCircleFree.push(a);
    }

    // Glow pool — additive radial Images. Skipped silently if the texture
    // can't be created (headless tests with no canvas) or if `scene.add.image`
    // isn't available, so legacy callers still work.
    const sceneAdd = scene.add as { image?: (x: number, y: number, key: string) => Phaser.GameObjects.Image };
    if (typeof sceneAdd.image === "function" && ensureGlowTexture(scene)) {
      for (let i = 0; i < scaled(POOL_SIZES.glow); i++) {
        const img = sceneAdd.image(0, 0, GLOW_TEXTURE_KEY);
        img.setVisible(false);
        img.setBlendMode(1); // ADD
        this.origin.set(img, "glow");
        this.glowFree.push(img);
      }
    }
  }

  acquireSpark(): Phaser.GameObjects.Rectangle | null {
    if (this.destroyed) return null;
    const obj = this.sparkFree.pop();
    if (!obj) {
      this.warnExhausted("spark");
      return null;
    }
    obj.setVisible(true);
    this.sparkActive.add(obj);
    return obj;
  }

  acquireShard(): Phaser.GameObjects.Rectangle | null {
    if (this.destroyed) return null;
    const obj = this.shardFree.pop();
    if (!obj) {
      this.warnExhausted("shard");
      return null;
    }
    obj.setVisible(true);
    this.shardActive.add(obj);
    return obj;
  }

  acquireRing(): Phaser.GameObjects.Arc | null {
    if (this.destroyed) return null;
    const obj = this.ringFree.pop();
    if (!obj) {
      this.warnExhausted("ring");
      return null;
    }
    obj.setVisible(true);
    this.ringActive.add(obj);
    return obj;
  }

  /**
   * `tier: "kill"` may drain the pool to empty; ordinary spawns leave the
   * last BOLT_KILL_RESERVE bolts untouched. Kill-tier presentation is a
   * permanence commitment (R1 row 17 "debris persists") — the one moment
   * that must never lose the pool lottery to ambient dust/ward chatter.
   * Found on the K10 live tape: at a real melee kill the pool is at peak
   * pressure (swing trail + dust + debris + burst all in flight), so the
   * shock ring — spawned LAST in the event pass — was the spawn that
   * silently starved, every single time.
   */
  acquireBolt(tier: "ambient" | "kill" = "ambient"): Phaser.GameObjects.Graphics | null {
    if (this.destroyed) return null;
    if (tier !== "kill" && this.boltFree.length <= ParticlePool.BOLT_KILL_RESERVE) {
      this.warnExhausted("bolt");
      return null;
    }
    const obj = this.boltFree.pop();
    if (!obj) {
      this.warnExhausted("bolt");
      return null;
    }
    // Unreal-style: pool owns the clean state, not the call site. If a
    // prior tween was killed externally (drainActive killTweensOf bypasses
    // the alpha-fade onComplete that would otherwise call release()), the
    // Graphics may still hold previously-drawn geometry. Phaser Graphics
    // is cumulative — every lineStyle/moveTo/strokePath ADDS, never
    // replaces — so without a defensive clear() here, every acquired bolt
    // carries the geometric debt of every prior bolt forever, and
    // setAlpha(1) reveals the lot. Was the source of the cyan-line
    // accumulation seen in world-fire screenshots after round 25.
    obj.clear();
    obj.setPosition(0, 0);
    obj.setRotation(0);
    obj.setScale(1);
    obj.setAlpha(1);
    // Reset blend mode to NORMAL (0). spawnLightningChainArc sets ADD;
    // a future caller using a different blend would inherit that without
    // this reset.
    obj.setBlendMode(0);
    obj.setVisible(true);
    this.boltActive.add(obj);
    return obj;
  }

  acquireGlow(): Phaser.GameObjects.Image | null {
    if (this.destroyed) return null;
    const obj = this.glowFree.pop();
    if (!obj) {
      this.warnExhausted("glow");
      return null;
    }
    obj.setVisible(true);
    this.glowActive.add(obj);
    return obj;
  }

  acquireBlastCircle(): Phaser.GameObjects.Arc | null {
    if (this.destroyed) return null;
    const obj = this.blastCircleFree.pop();
    if (!obj) {
      this.warnExhausted("blastCircle");
      return null;
    }
    obj.setVisible(true);
    this.blastCircleActive.add(obj);
    return obj;
  }

  release(gfx: Phaser.GameObjects.GameObject): void {
    if (this.destroyed) return;
    const kind = this.origin.get(gfx);
    if (!kind) return;
    switch (kind) {
      case "spark": {
        const r = gfx as Phaser.GameObjects.Rectangle;
        if (!this.sparkActive.delete(r)) return;
        this.resetCommon(r);
        this.sparkFree.push(r);
        return;
      }
      case "shard": {
        const r = gfx as Phaser.GameObjects.Rectangle;
        if (!this.shardActive.delete(r)) return;
        this.resetCommon(r);
        this.shardFree.push(r);
        return;
      }
      case "ring": {
        const a = gfx as Phaser.GameObjects.Arc;
        if (!this.ringActive.delete(a)) return;
        this.resetCommon(a);
        this.ringFree.push(a);
        return;
      }
      case "bolt": {
        const g = gfx as Phaser.GameObjects.Graphics;
        if (!this.boltActive.delete(g)) return;
        g.clear();
        this.resetCommon(g);
        this.boltFree.push(g);
        return;
      }
      case "blastCircle": {
        const a = gfx as Phaser.GameObjects.Arc;
        if (!this.blastCircleActive.delete(a)) return;
        this.resetCommon(a);
        a.setVisible(false);
        this.blastCircleFree.push(a);
        return;
      }
      case "glow": {
        const img = gfx as Phaser.GameObjects.Image;
        if (!this.glowActive.delete(img)) return;
        this.resetCommon(img);
        img.setTint(0xffffff);
        img.setVisible(false);
        this.glowFree.push(img);
        return;
      }
    }
  }

  /**
   * Force-release all in-flight pool objects and kill their tweens.
   * Call from the `case "round-end":` arm of `handleSimEvents` to prevent
   * "tween completed on freed object" crashes on round-restart.
   * Per `.claude/skills/phaser4-game/SKILL.md` — "Pool drain on round-end".
   */
  drainActive(scene: Phaser.Scene): void {
    if (this.destroyed) return;
    scene.tweens.killTweensOf([
      ...this.sparkActive,
      ...this.shardActive,
      ...this.ringActive,
      ...this.boltActive,
      ...this.blastCircleActive,
      ...this.glowActive,
    ]);
    function releaseAll<T extends Phaser.GameObjects.GameObject>(
      active: Set<T>,
      free: T[],
    ): void {
      for (const o of active) {
        // Graphics objects need .clear() to scrub accumulated geometry —
        // setVisible(false) hides but doesn't drop the line/path data,
        // and the next acquire's setVisible(true) brings it all back.
        const obj = o as unknown as {
          clear?: () => void;
          setVisible(v: boolean): void;
          setAlpha(a: number): void;
        };
        if (obj.clear) obj.clear();
        obj.setVisible(false);
        obj.setAlpha(1);
        free.push(o);
      }
      active.clear();
    }
    releaseAll(this.sparkActive, this.sparkFree);
    releaseAll(this.shardActive, this.shardFree);
    releaseAll(this.ringActive, this.ringFree);
    releaseAll(this.boltActive, this.boltFree);
    releaseAll(this.blastCircleActive, this.blastCircleFree);
    releaseAll(this.glowActive, this.glowFree);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const drain = (
      free: Phaser.GameObjects.GameObject[],
      active: Set<Phaser.GameObjects.GameObject>,
    ) => {
      for (const o of free) o.destroy();
      for (const o of active) o.destroy();
      free.length = 0;
      active.clear();
    };
    drain(this.sparkFree, this.sparkActive as Set<Phaser.GameObjects.GameObject>);
    drain(this.shardFree, this.shardActive as Set<Phaser.GameObjects.GameObject>);
    drain(this.ringFree, this.ringActive as Set<Phaser.GameObjects.GameObject>);
    drain(this.boltFree, this.boltActive as Set<Phaser.GameObjects.GameObject>);
    drain(
      this.blastCircleFree,
      this.blastCircleActive as Set<Phaser.GameObjects.GameObject>,
    );
    drain(
      this.glowFree as unknown as Phaser.GameObjects.GameObject[],
      this.glowActive as unknown as Set<Phaser.GameObjects.GameObject>,
    );
  }

  private resetCommon(
    gfx:
      | Phaser.GameObjects.Rectangle
      | Phaser.GameObjects.Arc
      | Phaser.GameObjects.Graphics
      | Phaser.GameObjects.Image,
  ): void {
    gfx.setVisible(true);
    gfx.setAlpha(1);
    gfx.setScale(1);
    gfx.setRotation(0);
    gfx.setPosition(0, 0);
  }

  private warnExhausted(name: PoolName): void {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    // eslint-disable-next-line no-console
    console.warn(`[ParticlePool] ${name} pool exhausted; skipping spawn`);
  }
}
