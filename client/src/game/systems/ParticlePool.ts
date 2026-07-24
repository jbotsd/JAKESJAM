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
  // spark 96→128, ring 24→32, blastCircle 24→32, shard 32→48 (Interstice
  // I5, 2026-07-24 live tape at :8090, boxworks-mini, 8 real kills/59 hits
  // over ~140s): K10's +50% Kindled-era bump was sized for Kindled's
  // slower ~683ms observed cadence; a live Interstice tape at the SAME
  // sustained-mash driving rhythm hit its true ~215ms sim FSM cycle far
  // harder, and the console sentinel caught ALL FIVE pools (bolt, spark,
  // blastCircle, ring, AND shard — shard is new, never exhausted on the
  // Kindled tape) exhausted mid-brawl in one run. Confirms the wave-2
  // brief's prediction: the same shared pools strain differently under a
  // faster class's real contact density. Another +33-50% pass; exhaustion
  // stays the legitimate quality dial via particleScale on weaker
  // profiles — this is headroom for the desktop-tier live game, not a
  // blank check.
  spark: 128,
  shard: 48,
  ring: 32,
  // 16 → 24 (Interstice I5): 20 spawn sites now share this pool (grew from
  // K10's 15 — ward raise/absorb/drop and other wave-3 additions since),
  // and the I5 live tape still caught "[ParticlePool] bolt pool exhausted"
  // under sustained Interstice melee despite K10's 4→16 bump. Idle pooled
  // Graphics cost nothing to hold; render cost accrues only when spawned.
  bolt: 24,
  blastCircle: 32,
  glow: 64,
} as const;

function scaled(base: number): number {
  return Math.max(2, Math.ceil(base * getQualityProfile().particleScale));
}

/** A kill-tier reserve as a PROPORTION of an already-scaled pool size (see
 *  blastCircleKillReserve/sparkKillReserve's docblock) — floored at 1 so
 *  even the smallest pool holds something back for kills. `fraction`
 *  differs per pool: blastCircle's ONLY ambient consumer is the
 *  low-frequency explosion blast itself (hit-confirmed/shield-pop/launch
 *  kicks), so it can afford to give kills the majority share (0.5); spark
 *  is ALSO the high-frequency ambient status-VFX pool (StatusVfxController's
 *  fire/ice/lightning DoT ticks fire constantly), so a smaller share (0.3)
 *  avoids meaningfully degrading that much busier ambient path. */
function reserveFraction(scaledPoolSize: number, fraction: number): number {
  return Math.max(1, Math.round(scaledPoolSize * fraction));
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
  /** blastCircle/spark reserves (Interstice wave 3, 2026-07-24 — extended-
   *  session pool-stress item): `spawnExplosionBlast`'s "big" path (every
   *  player-killed event, BOTH classes, via RenderLayer.spawnBloomLayers +
   *  spawnBlastSparks called TWICE — once directly, once again inside
   *  spawnExplosionBlastBig) is the ONE universal "a player died here" read
   *  every kill in the game depends on, and until this fix it drew from
   *  these two pools with ZERO reserve — the exact "ambient starves a
   *  kill-tier read" failure class K10 already fixed for bolt.
   *
   *  UNLIKE bolt's small fixed "2", these can't be flat unscaled constants:
   *  a single kill's worst case draws 10 blastCircle (5 layers × 2 calls)
   *  and up to 28 spark (10-14 × 2 calls) — spawn COUNTS are fixed
   *  regardless of quality tier, but pool SIZES shrink with particleScale
   *  (potato = 0.25×), and blastCircle's base 32 scales to just 8 at
   *  potato. A flat reserve of 10 would exceed the ENTIRE potato pool,
   *  permanently starving ambient blasts on weak hardware instead of only
   *  under real pressure (caught on this wave's own extended-session
   *  tape: headless Playwright's SwiftShader renderer auto-detects as
   *  "potato" per qualityProfile.ts's detectTier(), so the tape WAS
   *  exercising this floor). A flat SMALL reserve (tried: 4/12) fixed
   *  that but under-covers a genuinely busy always-on world: the SAME
   *  tape (long-lived :8090 server, several consecutive sessions of
   *  bot-vs-bot combat already in flight) showed the tiny reserve itself
   *  getting exhausted by back-to-back REAL kills competing for it — a
   *  narrower, different failure than ambient starvation (multiple
   *  legitimate kill-tier reads sharing one small reserve), but still
   *  worth reducing.
   *
   *  FIX: reserve a PROPORTION of the scaled pool (computed once in the
   *  constructor via `reserveFraction()`, mirroring how `scaled()` itself
   *  already scales pool SIZE), not a flat count — this keeps the reserve
   *  safely under the pool at every tier by construction while giving
   *  MORE absolute headroom for concurrent kills on the higher tiers
   *  where busier matches are visually plausible anyway. The two pools
   *  get DIFFERENT fractions (see reserveFraction's own docblock):
   *  blastCircle's only ambient consumer is the low-frequency explosion
   *  blast itself, so it reserves the MAJORITY (50%: standard/ultra 16,
   *  potato 4); spark is also StatusVfxController's high-frequency
   *  ambient DoT-tick pool, so it reserves less (30%: standard/ultra 38,
   *  potato 10) to avoid meaningfully degrading that much busier ambient
   *  path. Small absolute potato numbers are the same "a potato profile
   *  mostly reserves itself for kills" tradeoff BOLT_KILL_RESERVE's own
   *  docblock already accepts — a dimmer kill flash on weak hardware is
   *  the accepted quality-dial cost; a TOTALLY invisible one is not.
   *  RESIDUAL (found via this wave's own live tape, even after this fix):
   *  multiple REAL kills landing close together (a busy small arena, or
   *  simultaneous AOE deaths) can still exceed even this reserve — this
   *  is fundamentally a "how many kills can overlap within one blast's
   *  ~300ms tween lifetime" capacity question, not something an ever-
   *  larger reserve solves without hollowing out the ambient budget; it's
   *  the same bounded, accepted class of limitation as BOLT_KILL_RESERVE's
   *  own "a future kill-debris upgrade has headroom" caveat, not chased
   *  further here (I5's own precedent: past a certain point, sizing is
   *  the quality dial, not a bug to keep re-tuning). The load-bearing,
   *  now-PERMANENT guarantee this fix delivers is structural, not
   *  statistical: an AMBIENT spawn can never be the one that starves a
   *  kill (unit-proven in ParticlePool.test.ts), regardless of how the
   *  numbers get tuned. */
  private readonly blastCircleKillReserve: number;
  private readonly sparkKillReserve: number;
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

  /** Keyed `${name}:${tier}` (see warnExhausted's docblock) so an ambient
   *  exhaustion warning can never suppress a later kill-tier one. */
  private readonly warned: Set<string> = new Set();
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
    // 30% of the SCALED pool (see the reserve fields' own docblock) —
    // computed here, once, against the actual constructed size, not the
    // unscaled POOL_SIZES base.
    this.blastCircleKillReserve = reserveFraction(this.blastCircleFree.length, 0.5);
    this.sparkKillReserve = reserveFraction(this.sparkFree.length, 0.3);

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

  /** `tier: "kill"` may dip into the reserve (see sparkKillReserve's
   *  docblock); ordinary/ambient spawns leave it untouched. */
  acquireSpark(tier: "ambient" | "kill" = "ambient"): Phaser.GameObjects.Rectangle | null {
    if (this.destroyed) return null;
    if (tier !== "kill" && this.sparkFree.length <= this.sparkKillReserve) {
      this.warnExhausted("spark", tier);
      return null;
    }
    const obj = this.sparkFree.pop();
    if (!obj) {
      this.warnExhausted("spark", tier);
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
      this.warnExhausted("bolt", tier);
      return null;
    }
    const obj = this.boltFree.pop();
    if (!obj) {
      this.warnExhausted("bolt", tier);
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

  /** `tier: "kill"` may dip into the reserve (see blastCircleKillReserve's
   *  docblock); ordinary/ambient spawns leave it untouched. */
  acquireBlastCircle(tier: "ambient" | "kill" = "ambient"): Phaser.GameObjects.Arc | null {
    if (this.destroyed) return null;
    if (tier !== "kill" && this.blastCircleFree.length <= this.blastCircleKillReserve) {
      this.warnExhausted("blastCircle", tier);
      return null;
    }
    const obj = this.blastCircleFree.pop();
    if (!obj) {
      this.warnExhausted("blastCircle", tier);
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
    // HIDE on release (Track L 2026-07-24 bug fix; was setVisible(true)):
    // a freed object is parked at the world origin with alpha 1 and its
    // last fill/stroke style, so leaving it visible painted the free
    // list as a styled junk pile at (0,0) whenever the camera showed the
    // map corner (caught by scripts/statusReadShots.ts, whose harness
    // camera always frames the origin). blastCircle/glow always re-hid
    // explicitly after this call, masking the bug for those two pools;
    // spark/shard/ring relied on resetCommon alone. Every acquire* sets
    // visible(true), so hiding here is strictly correct for all five.
    gfx.setVisible(false);
    gfx.setAlpha(1);
    gfx.setScale(1);
    gfx.setRotation(0);
    gfx.setPosition(0, 0);
  }

  /** `tier` (Interstice wave 3, pool-stress item) is logged and keyed
   *  SEPARATELY from the ambient warning — an ambient exhaustion is the
   *  accepted quality dial (I5's own conclusion: "a smaller pool IS the
   *  particle-count dial") and fires constantly under sustained multi-
   *  class combat, but it must never SILENCE the one warning that actually
   *  matters: a "kill" tier acquire failing means the reserve itself is
   *  empty — a real starved kill-tier read, not routine ambient pressure.
   *  Before this, one `Set<PoolName>` warned-once-ever meant the (near-
   *  certain, and near-immediate) ambient warning always fired FIRST and
   *  permanently suppressed any later kill-tier alarm for that pool. */
  private warnExhausted(name: PoolName, tier: "ambient" | "kill" = "ambient"): void {
    const key = `${name}:${tier}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    // eslint-disable-next-line no-console
    console.warn(
      tier === "kill"
        ? `[ParticlePool] ${name} pool exhausted on a KILL-TIER acquire — the reserve itself is empty, a real read was starved`
        : `[ParticlePool] ${name} pool exhausted; skipping spawn`,
    );
  }
}
