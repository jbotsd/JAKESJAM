// High-fidelity projectile VFX for the LIVE world path (docs/vfx-spec.md).
//
// The netcode scene previously drew every projectile as a flat circle while
// the pooled particle/glow toolkit sat unused. This module closes the
// visual layer of the muzzle → travel → impact lifecycle (juice-it: reactive,
// tiered, three-layer), reading only from the sim snapshot — it never
// touches sim state, so prediction/authority are unaffected.
//
// Rendering strategy (pixel-art safe, pool-budget safe):
//   - Bodies + trails: immediate-mode into two shared ADDITIVE Graphics,
//     cleared and redrawn each frame. Zero per-frame allocation (trail
//     samples live in a preallocated ring buffer per projectile).
//   - Travel halo: ONE pooled additive glow Image per live projectile
//     (released on despawn) — the "rounds" hot-core → wash look.
//   - Muzzle flash + impact burst: pooled sparks/rings/glow, tweened out
//     and released on complete. Pool exhaustion is non-fatal (skip).

import type Phaser from "phaser";
import type { ElementType, PlayerId, ProjectileShape, WorldState } from "../../sim/types";
import type { ParticlePool } from "../systems/ParticlePool";
import { produceProjectiles, type ProjectileRenderModel } from "./renderContract";
import { GLOW_TEXTURE_SIZE } from "./glowTexture";
import {
  makeTendrilChain,
  stepTendrilChain,
  tendrilSegmentAlpha,
  tendrilSegmentWidthScale,
  type TendrilSegment,
} from "./tendrilTrail";

const TRAIL_SAMPLES = 6;
const BODY_DEPTH = 6;
const TRAIL_DEPTH = 5;
const HALO_DEPTH = 4;

/** Interstice cyan / Kindled gold registers — literal copies of
 *  `LightConstruct.ts`'s own `INTERSTICE_TINT`/`KINDLED_TINT`
 *  `.glow`/`.core`, NOT an import: `LightConstruct.ts` does a real
 *  (non-type-only) `import Phaser from "phaser"`, which throws under
 *  `bun test`'s no-DOM environment (this codebase's established rule —
 *  see chassisSilhouette.ts's own header comment) the moment anything
 *  transitively pulls it in, and `projectileVfx.test.ts`/
 *  `entityRenderCoordinator.test.ts` both import this module directly.
 *  Keep these hex values in sync with `LightConstruct.ts`'s own tint
 *  constants by hand if those ever change — a real cross-module import
 *  isn't safe here regardless of which direction it goes. */
const NINJA_BLADE_SHARD_GLOW = 0x35d6ff;
const NINJA_BLADE_SHARD_CORE = 0xf2fbff;
const KINDLED_THRUST_GLOW = 0xffc24d;
const KINDLED_THRUST_CORE = 0xfff3d0;
/** Drain/tithe crimson — StatusVfxController's LEECH_COLOR, hand-copied for
 *  the same no-cross-import reason as the tint literals above. In-flight
 *  accent for leech-stamped shots (Track L: a tithe volley must read as
 *  vampiric BEFORE it lands; the leech thread stays the payoff read). */
const LEECH_ACCENT_COLOR = 0xdc2626;

/**
 * Per-element visual character. `glowScale` multiplies the body radius for
 * the halo; `trailWidth` scales the streak; `hot` is the bright core tint
 * (defaults to the resolved element color when 0). Total over ElementType so
 * a new element can never silently fall back to "flat circle".
 */
type ElementVfx = { glowScale: number; trailWidth: number; core: number };

const ELEMENT_VFX: Record<ElementType, ElementVfx> = {
  fire: { glowScale: 3.4, trailWidth: 1.3, core: 0xffe08a },
  ice: { glowScale: 2.6, trailWidth: 1.0, core: 0xe8ffff },
  lightning: { glowScale: 3.0, trailWidth: 0.8, core: 0xfff7c0 },
  void: { glowScale: 3.2, trailWidth: 1.1, core: 0xd9c8ff },
  radiant: { glowScale: 3.8, trailWidth: 1.4, core: 0xffffff },
  sticky: { glowScale: 2.4, trailWidth: 1.5, core: 0xffd9a8 },
  explosive: { glowScale: 3.2, trailWidth: 1.4, core: 0xffd0d6 },
  // Was the weakest glow/trail in this whole table (2.8/1.0) despite crystal
  // being the wizard's SIGNATURE element — a genuine "fluffy, not tactile"
  // contributor (Jake, 2026-07-20). Bumped to lead the table, not trail it:
  // glass-cannon reads as bright and sharp, never soft. Core brightened
  // toward near-white-cyan so the hot spine on the new "shard" shape
  // actually pops against the cyan body.
  crystal: { glowScale: 3.7, trailWidth: 1.5, core: 0xeafcff },
  neutral: { glowScale: 2.6, trailWidth: 1.0, core: 0xffffff },
};

function elementVfx(element: string): ElementVfx {
  return ELEMENT_VFX[element as ElementType] ?? ELEMENT_VFX.neutral;
}

/** Fixed-capacity position ring buffer — alloc-free after construction. */
class Trail {
  private readonly xs = new Float32Array(TRAIL_SAMPLES);
  private readonly ys = new Float32Array(TRAIL_SAMPLES);
  private count = 0;
  private head = 0;
  push(x: number, y: number): void {
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.head = (this.head + 1) % TRAIL_SAMPLES;
    if (this.count < TRAIL_SAMPLES) this.count += 1;
  }
  /** Visit samples newest→oldest. `i` 0 = most recent. */
  forEach(fn: (x: number, y: number, i: number, total: number) => void): void {
    for (let i = 0; i < this.count; i += 1) {
      const idx = (this.head - 1 - i + TRAIL_SAMPLES * 2) % TRAIL_SAMPLES;
      fn(this.xs[idx]!, this.ys[idx]!, i, this.count);
    }
  }
}

export type ColorResolver = (element: ElementType, ownerId: PlayerId | null) => number;

export class ProjectileVfx {
  private readonly scene: Phaser.Scene;
  private readonly pool: ParticlePool | null;
  private readonly bodyGfx: Phaser.GameObjects.Graphics;
  private readonly trailGfx: Phaser.GameObjects.Graphics;
  private readonly trails = new Map<number, Trail>();
  /** Priest-tendril-only chase-chain state (tendrilTrail.ts), keyed by
   *  projectile id — a completely separate representation from `trails`'
   *  ring buffer so every other class's shots are byte-for-byte unaffected. */
  private readonly tendrilChains = new Map<number, TendrilSegment[]>();
  private readonly halos = new Map<number, Phaser.GameObjects.Image>();
  private readonly lastPos = new Map<
    number,
    {
      x: number;
      y: number;
      vx: number;
      vy: number;
      element: string;
      radius: number;
      impact: string;
      impactRadiusPx: number;
      pathing: string;
    }
  >();
  /** Per-frame scratch — the render loop must not allocate (the old
   *  `new Set()` + `Object.entries()` + spread trio churned every frame). */
  private readonly seenScratch = new Set<number>();
  /** Accumulated wall-clock — drives the homing seeker reticle's slow
   *  rotation (Track L; drawn into the per-frame body gfx, zero pool churn). */
  private clockMs = 0;
  /** Contract model pool — grows once to peak projectile count. */
  private readonly modelPool: ProjectileRenderModel[] = [];
  private readonly staleScratch: number[] = [];

  constructor(scene: Phaser.Scene, pool: ParticlePool | null) {
    this.scene = scene;
    this.pool = pool;
    this.trailGfx = scene.add.graphics();
    this.trailGfx.setDepth(TRAIL_DEPTH);
    this.trailGfx.setBlendMode(1); // ADD
    this.bodyGfx = scene.add.graphics();
    this.bodyGfx.setDepth(BODY_DEPTH);
    this.bodyGfx.setBlendMode(1); // ADD
  }

  /**
   * Per-frame render of all live projectiles. Draws bodies + trails, keeps a
   * pooled halo per projectile, and fires an impact burst for any projectile
   * that vanished since last frame.
   *
   * Consumes RENDER MODELS from the contract (renderContract.ts), not raw
   * sim entities — the same models any other painter (baked tier, headless
   * replay renderer) will consume.
   */
  render(state: WorldState, resolveColor: ColorResolver, deltaMs: number = 1000 / 60): void {
    const body = this.bodyGfx;
    const trail = this.trailGfx;
    body.clear();
    trail.clear();
    const deltaSeconds = Math.max(0, deltaMs) / 1000;
    this.clockMs += Math.max(0, deltaMs);

    const count = produceProjectiles(state, this.modelPool);
    const seen = this.seenScratch;
    seen.clear();
    for (let mi = 0; mi < count; mi++) {
      const proj = this.modelPool[mi]!;
      const id = proj.id;
      seen.add(id);
      // Interstice's blade-shards (Edge Storm's wave, Needle) and Kindled's
      // Sunspike thrust (renderContract.ts's `ninjaBladeShard`/
      // `kindledThrust` flags): override the resolved element color with
      // each class's own register everywhere `color` is used below (trail,
      // halo, body) — element itself is left untouched (damage/impact
      // unaffected), but the shot no longer reads as "borrowed wizard
      // stuff" or "a generic copy of your basic shot."
      const isNinjaBladeShard = proj.ninjaBladeShard === true;
      const isKindledThrust = proj.kindledThrust === true;
      const color = isNinjaBladeShard
        ? NINJA_BLADE_SHARD_GLOW
        : isKindledThrust
          ? KINDLED_THRUST_GLOW
          : resolveColor(proj.element as ElementType, proj.ownerId);
      const lang = elementVfx(proj.element);
      // Visual-only shrink (never touches proj.radius, the real hit
      // detection) — "smaller" per each ability's own read: a wave/needle
      // is the AFTERMATH/tip of a strike, not a second full-size shot.
      // Sunspike keeps its own build-resolved size — a solid thrust reads
      // right at full size, unlike the ninja's small precision shards.
      const radius = isNinjaBladeShard ? proj.radius * 0.72 : proj.radius;
      const angle = proj.angle;
      // Priest/Syzygist's "oozing tendril" basic fire (renderContract.ts's
      // `tendril` flag: element === "fire" && enemyOnly === true — the one
      // collision-free "this is specifically a Priest tendril" signal, not
      // just any fire-element or fire+homing shot). Gets a bespoke
      // writhing-ribbon body instead of the shape-based renderer below;
      // every other class/shape/element is completely untouched.
      const isTendril = proj.tendril;

      // First sight of an id = the shot's muzzle frame: the spawn point IS
      // the muzzle and we have element/velocity/damage right here, so fire
      // the muzzle flash without any separate event plumbing. Shared by
      // both trail representations (tendril chain vs. ring-buffer trail).
      const firstSight = !this.trails.has(id) && !this.tendrilChains.has(id);
      if (firstSight) {
        this.muzzle(proj.x, proj.y, angle, proj.element, proj.damage);
      }

      let tendrilChain: TendrilSegment[] | null = null;
      if (isTendril) {
        // Chase-chain trail — see tendrilTrail.ts. A completely separate
        // representation from the ring-buffer `Trail` below; this branch
        // never touches `this.trails`.
        const existing = this.tendrilChains.get(id) ?? makeTendrilChain(proj.x, proj.y);
        tendrilChain = stepTendrilChain(existing, proj.x, proj.y, deltaSeconds);
        this.tendrilChains.set(id, tendrilChain);
      } else {
        // Trail — record position, draw newest→oldest as fading additive segs.
        let t = this.trails.get(id);
        if (!t) {
          t = new Trail();
          this.trails.set(id, t);
        }
        t.push(proj.x, proj.y);
        let px = proj.x;
        let py = proj.y;
        t.forEach((x, y, i, total) => {
          if (i === 0) {
            px = x;
            py = y;
            return;
          }
          // Discontinuity guard: a wrap-flagged shard (six-axes Mystery)
          // teleports across the map rect between frames — connecting those
          // samples would smear a screen-wide streak that reads as a hitscan
          // laser. Any segment far longer than one frame of flight is a
          // teleport, not motion: break the trail there.
          const segX = x - px;
          const segY = y - py;
          if (segX * segX + segY * segY > 200 * 200) {
            // Positive seam read (Track L, six-axes Mystery): for a
            // wrap-FLAGGED shard, the newest segment (i === 1 — current
            // sample back to the pre-wrap sample) IS the teleport moment,
            // exactly once per wrap (next frame the jump sits deeper in
            // the ring buffer). Exit flash where the shard left the map
            // edge (x/y = pre-wrap sample), entry flash where it re-made
            // (px/py = current). Unflagged shards keep the silent break —
            // the guard alone stays the safety net for any other teleport.
            if (proj.wrapShots && i === 1) {
              this.wrapSeamFlash(x, y, px, py, angle, color);
            }
            px = x;
            py = y;
            return;
          }
          const a = (1 - i / total) * 0.5;
          trail.lineStyle(Math.max(1, radius * lang.trailWidth * (1 - i / total)), color, a);
          trail.lineBetween(px, py, x, y);
          px = x;
          py = y;
        });
      }

      // P2 — bounce tell: a 'bounce'-pathing shard reflecting off a wall
      // flips a velocity axis sharply between frames. Spark-tick at the
      // contact so it reads as a skillful ricochet, not a glitch.
      const prev = this.lastPos.get(id);
      if (
        prev &&
        proj.pathing === "bounce" &&
        (Math.sign(proj.vx) !== Math.sign(prev.vx) || Math.sign(proj.vy) !== Math.sign(prev.vy))
      ) {
        this.bounceTick(proj.x, proj.y, color);
      }

      // Halo — one pooled additive glow following the body.
      this.updateHalo(id, proj.x, proj.y, radius * lang.glowScale, color);

      // Seeker read (Track L): a homing-pathing shot wears a thin rotating
      // lock-reticle — two opposed partial arcs precessing around the body
      // — so a Stolen-Fangs spend (or any homing card) is visibly SEEKING
      // in flight instead of rendering identically to a straight shot.
      // Immediate-mode into the per-frame body gfx: zero pool churn.
      if (proj.pathing === "homing") {
        const phase = this.clockMs * 0.008;
        const rr = radius + 5;
        body.lineStyle(1, color, 0.55 * proj.bodyAlpha);
        body.beginPath();
        body.arc(proj.x, proj.y, rr, phase, phase + Math.PI * 0.6);
        body.strokePath();
        body.beginPath();
        body.arc(proj.x, proj.y, rr, phase + Math.PI, phase + Math.PI * 1.6);
        body.strokePath();
      }

      // Drain read (Track L): leech-stamped shots (Crimson Tithe's window
      // stamp, Bleed Tithe's homing curse) carry a thin crimson accent
      // ring in flight — the vampire register, worn BEFORE the hit so the
      // victim can read what is coming (the leech thread is the payoff).
      if (proj.leech) {
        body.lineStyle(1.2, LEECH_ACCENT_COLOR, 0.6 * proj.bodyAlpha);
        body.strokeCircle(proj.x, proj.y, radius + 2.5);
      }

      // Sticky fuse blink comes precomputed from the contract model.
      const bodyAlpha = proj.bodyAlpha;

      if (tendrilChain) {
        // Oozing-tendril body: segmented curling ribbon (warm shell) with a
        // bright ember head — replaces the shape-based body/trail entirely
        // for this shot only.
        this.drawTendrilBody(body, trail, tendrilChain, color, lang.core, radius, bodyAlpha);
      } else if (isNinjaBladeShard) {
        // Edge Storm's wave-off-swing / Needle — a small blade-sliver, not
        // the Geometrician's crystal dart. Checked BEFORE the `element ===
        // "crystal"` branch below since both shots still carry that
        // element (damage/impact untouched); only the identity flag routes
        // it here. `NINJA_BLADE_SHARD_CORE` overrides `lang.core` too, so
        // the hot center reads cyan-white, not crystal's own core tint.
        this.drawBladeSliverBody(body, proj.x, proj.y, radius, angle, color, NINJA_BLADE_SHARD_CORE, bodyAlpha);
      } else if (isKindledThrust) {
        // Kindled's Sunspike — a solid, symmetric gold spike, not "a
        // faster copy of your basic shot." Checked before the generic
        // element/shape dispatch below for the same reason as the ninja
        // branch above.
        this.drawSpikeBody(body, proj.x, proj.y, radius, angle, color, KINDLED_THRUST_CORE, bodyAlpha);
      } else if (proj.element === "crystal") {
        // The wizard's elongated dart — an element override, not a `shape`
        // value (see drawShardBody's own doc comment for why).
        this.drawShardBody(body, proj.x, proj.y, radius, angle, color, lang.core, bodyAlpha);
      } else {
        // Body — element core over a resolved-color shell, shape-correct.
        this.drawBody(body, proj.shape, proj.x, proj.y, radius, angle, color, lang.core, bodyAlpha);
      }

      // Mutate the existing record — a fresh object per projectile per
      // frame was one of the render loop's biggest allocation sources.
      let last = this.lastPos.get(id);
      if (!last) {
        last = {
          x: 0, y: 0, vx: 0, vy: 0, element: "neutral",
          radius: 0, impact: "none", impactRadiusPx: 0, pathing: "linear",
        };
        this.lastPos.set(id, last);
      }
      last.x = proj.x;
      last.y = proj.y;
      last.vx = proj.vx;
      last.vy = proj.vy;
      last.element = proj.element;
      last.radius = radius;
      last.impact = proj.impact;
      last.impactRadiusPx = proj.impactRadiusPx;
      last.pathing = proj.pathing;
    }

    // Despawn diff → element impact/fizzle, release halo + trail state.
    // `lastPos` is written for every live projectile above (tendril or not),
    // so it's the single source of truth for "ids we're tracking" — a
    // tendril's state otherwise lives only in `tendrilChains`, never `trails`.
    const stale = this.staleScratch;
    stale.length = 0;
    for (const id of this.lastPos.keys()) {
      if (!seen.has(id)) stale.push(id);
    }
    for (const id of stale) {
      const last = this.lastPos.get(id);
      if (last) {
        this.impact(last.x, last.y, last.element, last.radius, last.impact, last.impactRadiusPx);
      }
      this.releaseHalo(id);
      this.trails.delete(id);
      this.tendrilChains.delete(id);
      this.lastPos.delete(id);
    }
  }

  /**
   * Oozing-tendril travel-phase body: a segmented, tapering curl (the
   * chase-chain from tendrilTrail.ts) drawn as fading/thinning additive
   * line segments on the trail graphics, with a bright hot-ember head drawn
   * on the body graphics — same "hot core over resolved-color shell"
   * grammar `drawBody` uses for every other shape, just traced along a
   * writhing path instead of stamped at one point.
   */
  private drawTendrilBody(
    bodyGfx: Phaser.GameObjects.Graphics,
    trailGfx: Phaser.GameObjects.Graphics,
    chain: readonly TendrilSegment[],
    color: number,
    core: number,
    radius: number,
    bodyAlpha: number,
  ): void {
    const count = chain.length;
    for (let i = 0; i < count - 1; i += 1) {
      const a = chain[i]!;
      const b = chain[i + 1]!;
      const segAlpha = tendrilSegmentAlpha(i, count) * bodyAlpha;
      const segWidth = Math.max(1, radius * 1.8 * tendrilSegmentWidthScale(i, count));
      trailGfx.lineStyle(segWidth, color, segAlpha * 0.85);
      trailGfx.lineBetween(a.x, a.y, b.x, b.y);
    }
    const head = chain[0]!;
    bodyGfx.fillStyle(color, 0.95 * bodyAlpha);
    bodyGfx.fillCircle(head.x, head.y, radius * 1.05);
    bodyGfx.fillStyle(core, bodyAlpha);
    bodyGfx.fillCircle(head.x, head.y, Math.max(1, radius * 0.55));
  }

  /** Track L (six-axes Mystery wrap): positive exit/entry seam read for a
   *  map-rect teleport. Exit = two ticks collapsing into the departure
   *  point (the shard un-making at the edge); entry = a glow pop + two
   *  ticks fanning FORWARD along the travel direction (re-made, still
   *  flying). Same pooled-transient budget class as bounceTick. */
  private wrapSeamFlash(
    exitX: number,
    exitY: number,
    entryX: number,
    entryY: number,
    angle: number,
    color: number,
  ): void {
    const pool = this.pool;
    if (!pool) return;
    for (let i = 0; i < 2; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const a = angle + Math.PI / 2 + (i === 0 ? 0 : Math.PI); // perpendicular pair
      const dist = 9;
      s.setPosition(exitX + Math.cos(a) * dist, exitY + Math.sin(a) * dist)
        .setFillStyle(color, 0.9)
        .setDepth(HALO_DEPTH)
        .setRotation(a);
      // Collapse INTO the exit point — leaving, not exploding.
      this.tweenRelease(s, { x: exitX, y: exitY, alpha: 0 }, 140);
    }
    const glow = pool.acquireGlow();
    if (glow) {
      const scale = (9 / GLOW_TEXTURE_SIZE) * 2;
      glow.setPosition(entryX, entryY).setTint(color).setAlpha(0.8).setScale(scale).setDepth(HALO_DEPTH);
      this.tweenRelease(glow, { alpha: 0, scaleX: scale * 1.7, scaleY: scale * 1.7 }, 150);
    }
    for (let i = 0; i < 2; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const spread = i === 0 ? -0.35 : 0.35;
      const a = angle + spread;
      const dist = 12;
      s.setPosition(entryX, entryY).setFillStyle(color, 0.9).setDepth(HALO_DEPTH).setRotation(a);
      // Fan FORWARD — re-made and still traveling.
      this.tweenRelease(s, { x: entryX + Math.cos(a) * dist, y: entryY + Math.sin(a) * dist, alpha: 0 }, 150);
    }
  }

  /** P2 — small ricochet spark + glow tick at a wall bounce. */
  private bounceTick(x: number, y: number, color: number): void {
    const pool = this.pool;
    if (!pool) return;
    const glow = pool.acquireGlow();
    if (glow) {
      const scale = (8 / GLOW_TEXTURE_SIZE) * 2;
      glow.setPosition(x, y).setTint(color).setAlpha(0.7).setScale(scale).setDepth(HALO_DEPTH);
      this.tweenRelease(glow, { alpha: 0, scaleX: scale * 1.6, scaleY: scale * 1.6 }, 130);
    }
    for (let i = 0; i < 2; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const a = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 8;
      s.setPosition(x, y).setFillStyle(color, 1).setDepth(HALO_DEPTH).setRotation(a);
      this.tweenRelease(s, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0 }, 150);
    }
  }

  /** Muzzle flash — additive pop + spark cone along `angle`. Tier by damage. */
  muzzle(x: number, y: number, angle: number, element: string, damage: number): void {
    const pool = this.pool;
    const color = elementVfx(element).core;
    const tier = damage >= 25 ? 1.5 : 1;
    if (pool) {
      const glow = pool.acquireGlow();
      if (glow) {
        const scale = ((12 * tier) / GLOW_TEXTURE_SIZE) * 2;
        glow.setPosition(x, y).setTint(color).setAlpha(0.9).setScale(scale).setDepth(HALO_DEPTH);
        this.tweenRelease(glow, { alpha: 0, scaleX: scale * 1.8, scaleY: scale * 1.8 }, 90);
      }
      const sparks = Math.round(3 * tier);
      for (let i = 0; i < sparks; i += 1) {
        const s = pool.acquireSpark();
        if (!s) break;
        const spread = (Math.random() - 0.5) * 0.6;
        const a = angle + spread;
        const dist = 14 + Math.random() * 12 * tier;
        s.setPosition(x, y).setFillStyle(color, 1).setDepth(HALO_DEPTH).setRotation(a);
        this.tweenRelease(s, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0 }, 120);
      }
    }
  }

  /**
   * P2 — element-flavored impact/fizzle on despawn. Explosive impact behavior
   * (from the card build) upgrades any element to a blast circle scaled to
   * `impactRadiusPx`. Each element then adds its signature burst.
   */
  private impact(
    x: number,
    y: number,
    element: string,
    radius: number,
    impactBehavior = "none",
    impactRadiusPx = 0,
  ): void {
    const pool = this.pool;
    if (!pool) return;
    const color = elementVfx(element).core;

    if (impactBehavior === "explosive" && impactRadiusPx > 0) {
      this.blast(x, y, impactRadiusPx, color);
    }

    switch (element) {
      case "lightning":
      case "electric":
        this.forkBolt(x, y, color);
        this.sparkFan(x, y, color, 4, 16, 180);
        break;
      case "void":
        this.implosion(x, y, color);
        break;
      case "fire":
        this.embers(x, y, color);
        this.ring(x, y, color, 1.3, 200);
        break;
      case "ice":
        this.ring(x, y, 0xe8ffff, 1.5, 160); // crisp fast shatter ring
        this.shatter(x, y, color);
        break;
      case "radiant":
        this.flashGlow(x, y, color, 20, 260);
        this.ring(x, y, color, 1.6, 260);
        break;
      case "toxic":
        this.lingerCloud(x, y, color);
        break;
      case "sticky":
        this.splat(x, y, color);
        break;
      case "explosive":
        // The blast above already fired if configured; add a punchy fan.
        this.sparkFan(x, y, color, 6, 20, 220);
        this.ring(x, y, color, 1.5, 200);
        break;
      case "crystal":
        this.prismFan(x, y);
        this.ring(x, y, color, 1.3, 220);
        break;
      default:
        this.ring(x, y, color, 1.4, 220);
        this.sparkFan(x, y, color, Math.min(6, 3 + Math.round(radius / 4)), 14, 200);
        break;
    }
  }

  // ── Impact primitives ────────────────────────────────────────────────

  private ring(x: number, y: number, color: number, toScale: number, ms: number): void {
    const ring = this.pool?.acquireRing();
    if (!ring) return;
    ring.setPosition(x, y).setScale(0.2).setAlpha(0.8).setDepth(HALO_DEPTH);
    (ring as unknown as { setStrokeStyle?: (w: number, c: number) => void }).setStrokeStyle?.(2, color);
    this.tweenRelease(ring, { scaleX: toScale, scaleY: toScale, alpha: 0 }, ms);
  }

  private sparkFan(x: number, y: number, color: number, count: number, reach: number, ms: number): void {
    const pool = this.pool;
    if (!pool) return;
    for (let i = 0; i < count; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = reach * 0.7 + Math.random() * reach;
      s.setPosition(x, y).setFillStyle(color, 1).setDepth(HALO_DEPTH).setRotation(a);
      this.tweenRelease(s, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0 }, ms);
    }
  }

  private flashGlow(x: number, y: number, color: number, px: number, ms: number): void {
    const glow = this.pool?.acquireGlow();
    if (!glow) return;
    const scale = (px / GLOW_TEXTURE_SIZE) * 2;
    glow.setPosition(x, y).setTint(color).setAlpha(0.95).setScale(scale * 0.6).setDepth(HALO_DEPTH);
    this.tweenRelease(glow, { alpha: 0, scaleX: scale * 1.6, scaleY: scale * 1.6 }, ms);
  }

  /** Explosive: additive blast circle scaled to the AoE radius + core flash. */
  private blast(x: number, y: number, radiusPx: number, color: number): void {
    const pool = this.pool;
    if (!pool) return;
    const circle = pool.acquireBlastCircle();
    if (circle) {
      circle.setPosition(x, y).setDepth(HALO_DEPTH).setAlpha(0.5);
      (circle as unknown as { setRadius?: (r: number) => void }).setRadius?.(radiusPx * 0.4);
      (circle as unknown as { setFillStyle?: (c: number, a: number) => void }).setFillStyle?.(color, 0.5);
      this.tweenRelease(circle, { scaleX: 2.4, scaleY: 2.4, alpha: 0 }, 260);
    }
    this.flashGlow(x, y, color, radiusPx * 0.7, 200);
    this.sparkFan(x, y, color, 8, radiusPx * 0.6, 260);
  }

  /** Lightning: a few jagged forks from the impact point. */
  private forkBolt(x: number, y: number, color: number): void {
    const bolt = this.pool?.acquireBolt();
    if (!bolt) return;
    const g = bolt as unknown as {
      clear: () => void;
      lineStyle: (w: number, c: number, a?: number) => void;
      beginPath: () => void;
      moveTo: (x: number, y: number) => void;
      lineTo: (x: number, y: number) => void;
      strokePath: () => void;
      setDepth: (d: number) => void;
      setBlendMode: (m: number) => void;
    };
    g.clear();
    g.setBlendMode(1);
    g.setDepth(HALO_DEPTH);
    g.lineStyle(2, color, 0.9);
    const forks = 3;
    for (let f = 0; f < forks; f += 1) {
      const dir = (f / forks) * Math.PI * 2 + Math.random();
      g.beginPath();
      g.moveTo(x, y);
      let cx = x;
      let cy = y;
      for (let seg = 0; seg < 3; seg += 1) {
        const len = 8 + Math.random() * 10;
        cx += Math.cos(dir) * len + (Math.random() - 0.5) * 8;
        cy += Math.sin(dir) * len + (Math.random() - 0.5) * 8;
        g.lineTo(cx, cy);
      }
      g.strokePath();
    }
    this.tweenRelease(bolt, { alpha: 0 }, 150);
  }

  /** Void: a ring that collapses INWARD + sparks pulled toward the center. */
  private implosion(x: number, y: number, color: number): void {
    const pool = this.pool;
    if (!pool) return;
    const ring = pool.acquireRing();
    if (ring) {
      ring.setPosition(x, y).setScale(1.6).setAlpha(0.9).setDepth(HALO_DEPTH);
      (ring as unknown as { setStrokeStyle?: (w: number, c: number) => void }).setStrokeStyle?.(2, color);
      this.tweenRelease(ring, { scaleX: 0.1, scaleY: 0.1, alpha: 0 }, 260);
    }
    for (let i = 0; i < 5; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const a = (i / 5) * Math.PI * 2;
      const dist = 20 + Math.random() * 10;
      s.setPosition(x + Math.cos(a) * dist, y + Math.sin(a) * dist)
        .setFillStyle(color, 1)
        .setDepth(HALO_DEPTH)
        .setRotation(a);
      this.tweenRelease(s, { x, y, alpha: 0 }, 220); // drawn INWARD
    }
  }

  /** Fire: embers that drift outward-up, warm fade. */
  private embers(x: number, y: number, color: number): void {
    const pool = this.pool;
    if (!pool) return;
    for (let i = 0; i < 6; i += 1) {
      const s = pool.acquireShard() ?? pool.acquireSpark();
      if (!s) break;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const dist = 10 + Math.random() * 18;
      s.setPosition(x, y).setFillStyle(color, 1).setDepth(HALO_DEPTH).setRotation(Math.random() * Math.PI);
      this.tweenRelease(
        s,
        { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist - 8, alpha: 0 },
        280 + Math.random() * 120,
      );
    }
  }

  /** Ice: sharp shards flung fast + outward. */
  private shatter(x: number, y: number, color: number): void {
    const pool = this.pool;
    if (!pool) return;
    for (let i = 0; i < 6; i += 1) {
      const s = pool.acquireShard() ?? pool.acquireSpark();
      if (!s) break;
      const a = (i / 6) * Math.PI * 2;
      const dist = 16 + Math.random() * 12;
      s.setPosition(x, y).setFillStyle(color, 1).setDepth(HALO_DEPTH).setRotation(a);
      this.tweenRelease(s, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0 }, 140);
    }
  }

  /** Toxic: a dim green glow that lingers, then fades. */
  private lingerCloud(x: number, y: number, color: number): void {
    const glow = this.pool?.acquireGlow();
    if (!glow) return;
    const scale = (18 / GLOW_TEXTURE_SIZE) * 2;
    glow.setPosition(x, y).setTint(color).setAlpha(0.5).setScale(scale).setDepth(HALO_DEPTH);
    this.tweenRelease(glow, { alpha: 0, scaleX: scale * 1.3, scaleY: scale * 1.3 }, 600);
  }

  /** Sticky: a short glob splat + a couple of dribbles. */
  private splat(x: number, y: number, color: number): void {
    this.flashGlow(x, y, color, 12, 180);
    this.sparkFan(x, y, color, 3, 8, 160);
  }

  /** Crystal: prismatic fan — sparks tinted across a small hue set. */
  private prismFan(x: number, y: number): void {
    const pool = this.pool;
    if (!pool) return;
    const hues = [0xff88ff, 0x88ffff, 0xffff88, 0xff99cc];
    for (let i = 0; i < 6; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 12 + Math.random() * 12;
      s.setPosition(x, y).setFillStyle(hues[i % hues.length]!, 1).setDepth(HALO_DEPTH).setRotation(a);
      this.tweenRelease(s, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0 }, 220);
    }
  }

  private updateHalo(id: number, x: number, y: number, haloRadius: number, color: number): void {
    const pool = this.pool;
    let img = this.halos.get(id);
    if (!img && pool) {
      const g = pool.acquireGlow();
      if (g) {
        g.setDepth(HALO_DEPTH);
        img = g;
        this.halos.set(id, g);
      }
    }
    if (!img) return;
    const scale = (haloRadius * 2) / GLOW_TEXTURE_SIZE;
    img.setPosition(x, y).setTint(color).setAlpha(0.85).setScale(scale);
  }

  private releaseHalo(id: number): void {
    const img = this.halos.get(id);
    if (img) {
      this.pool?.release(img);
      this.halos.delete(id);
    }
  }

  /**
   * Draw the projectile body: an element-core dot over a resolved-color
   * shell, shape-correct and velocity-oriented. Total over ProjectileShape.
   */
  private drawBody(
    g: Phaser.GameObjects.Graphics,
    shape: ProjectileShape,
    x: number,
    y: number,
    r: number,
    angle: number,
    color: number,
    core: number,
    bodyAlpha = 1,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rot = (dx: number, dy: number): [number, number] => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    g.fillStyle(color, 0.95 * bodyAlpha);
    switch (shape) {
      case "triangle": {
        const p0 = rot(r * 1.6, 0);
        const p1 = rot(-r, r);
        const p2 = rot(-r, -r);
        g.fillTriangle(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
        break;
      }
      case "square": {
        const c0 = rot(-r, -r);
        const c1 = rot(r, -r);
        const c2 = rot(r, r);
        const c3 = rot(-r, r);
        g.beginPath();
        g.moveTo(c0[0], c0[1]);
        g.lineTo(c1[0], c1[1]);
        g.lineTo(c2[0], c2[1]);
        g.lineTo(c3[0], c3[1]);
        g.closePath();
        g.fillPath();
        break;
      }
      case "hexagon": {
        g.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = angle + (i / 6) * Math.PI * 2;
          const hx = x + Math.cos(a) * r;
          const hy = y + Math.sin(a) * r;
          if (i === 0) g.moveTo(hx, hy);
          else g.lineTo(hx, hy);
        }
        g.closePath();
        g.fillPath();
        break;
      }
      case "x": {
        const arm = r * 1.4;
        g.lineStyle(Math.max(2, r * 0.6), color, 0.95 * bodyAlpha);
        for (const base of [angle + Math.PI / 4, angle - Math.PI / 4]) {
          g.lineBetween(x - Math.cos(base) * arm, y - Math.sin(base) * arm, x + Math.cos(base) * arm, y + Math.sin(base) * arm);
        }
        break;
      }
      case "bar": {
        // Capsule stretched along velocity.
        const half = r * 2.2;
        g.lineStyle(Math.max(2, r * 1.2), color, 0.95 * bodyAlpha);
        g.lineBetween(x - cos * half, y - sin * half, x + cos * half, y + sin * half);
        break;
      }
      case "orb":
      case "circle":
      default:
        g.fillCircle(x, y, r);
        break;
    }
    // Hot core — a small bright dot reads as energy regardless of shape.
    g.fillStyle(core, bodyAlpha);
    g.fillCircle(x, y, Math.max(1, r * 0.45));
  }

  /** Elongated faceted crystal dart — an ELEMENT-driven override (checked at
   *  the call site, `element === "crystal"`), not a `ProjectileShape` value:
   *  `shape` is packed byte-for-byte into the shared Zig/TS WASM ABI
   *  (weaponBuildParity.test.ts), so adding a shape variant there breaks
   *  parity without a matching Zig-side change. This stays purely a client
   *  render override — same nominal shape ("hexagon"), different silhouette
   *  for this one element. The wizard's "wiz-like bullet" (Jake, 2026-07-20:
   *  "not tactile enough... not enough wiz like bullets" — a symmetric
   *  rotating hexagon didn't cut through the air the way a directional
   *  dart does). Tip forward, sharp asymmetric wedge belly, a brighter core
   *  facet down the spine so it reads as CUTTING through the air. */
  private drawShardBody(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    r: number,
    angle: number,
    color: number,
    core: number,
    bodyAlpha: number,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rot = (dx: number, dy: number): [number, number] => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    const nose = rot(r * 2.4, 0);
    const tail = rot(-r * 1.4, 0);
    const wingF = rot(r * 0.3, r * 1.1);
    const wingB = rot(r * 0.3, -r * 1.1);
    g.fillStyle(color, 0.95 * bodyAlpha);
    g.fillTriangle(nose[0], nose[1], wingF[0], wingF[1], wingB[0], wingB[1]);
    g.fillTriangle(wingF[0], wingF[1], tail[0], tail[1], wingB[0], wingB[1]);
    // Bright spine facet — the "cutting edge" catching the light.
    g.lineStyle(Math.max(1, r * 0.35), core, bodyAlpha);
    g.lineBetween(tail[0], tail[1], nose[0], nose[1]);
    // Hot core — matches drawBody's own convention regardless of shape.
    g.fillStyle(core, bodyAlpha);
    g.fillCircle(x, y, Math.max(1, r * 0.45));
  }

  /** Interstice's small precision shots — Edge Storm's wave-off-swing AND
   *  Needle's shard (2026-07-20, `ninjaBladeShard` identity flag — see
   *  types.ts's field comment; Needle joined a day after the wave got this
   *  treatment, same bug, same fix). Was riding `drawShardBody` purely via
   *  `element === "crystal"`, which read as "the wizard's stuff" borrowed
   *  wholesale on a class whose whole identity is dual-blade insidious-
   *  precise. A distinct silhouette, not just a recolor: a SINGLE-edged
   *  blade fragment (asymmetric shoulder — wide on one side, narrow on the
   *  other, like a snapped-off kunai sliver), shorter and slimmer than the
   *  dart's own symmetric double-wing wedge (tip 1.8r vs 2.4r, tail -0.9r
   *  vs -1.4r, one shoulder 0.42r vs both wings 1.1r) — reads as "small and
   *  precise" rather than "a second full-size shot." One shared shape for
   *  both abilities is deliberate — see `ninjaBladeShard`'s own field
   *  comment for why. */
  private drawBladeSliverBody(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    r: number,
    angle: number,
    color: number,
    core: number,
    bodyAlpha: number,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rot = (dx: number, dy: number): [number, number] => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    const tip = rot(r * 1.8, 0);
    const tail = rot(-r * 0.9, -r * 0.08);
    // Asymmetric shoulder — the single cutting edge — sits closer to the
    // tail than the tip, echoing a real blade's belly, and is deliberately
    // NOT mirrored (shoulderNear ≠ -shoulderFar) so it reads as one edge,
    // not a symmetric leaf.
    const shoulderNear = rot(r * 0.35, r * 0.42);
    const shoulderFar = rot(r * 0.5, -r * 0.2);
    g.fillStyle(color, 0.95 * bodyAlpha);
    g.fillTriangle(tip[0], tip[1], shoulderNear[0], shoulderNear[1], shoulderFar[0], shoulderFar[1]);
    g.fillTriangle(shoulderNear[0], shoulderNear[1], tail[0], tail[1], shoulderFar[0], shoulderFar[1]);
    // Bright spine — the cutting edge catching the light, same convention
    // as drawShardBody's own spine but thinner (this is a sliver, not a
    // full dart).
    g.lineStyle(Math.max(1, r * 0.28), core, bodyAlpha);
    g.lineBetween(tail[0], tail[1], tip[0], tip[1]);
    // Hot core — smaller than drawShardBody's, matching the overall
    // "smaller" silhouette.
    g.fillStyle(core, bodyAlpha);
    g.fillCircle(x, y, Math.max(1, r * 0.35));
  }

  /** Kindled's Sunspike (2026-07-20, `kindledThrust` identity flag — see
   *  types.ts's field comment). Deliberately NOT a recolor of
   *  `drawBladeSliverBody`: where the ninja's shard is a small, ASYMMETRIC
   *  single-edge fragment (insidious, precise), Sunspike is a solid,
   *  SYMMETRIC spike — the "committed, not flicked" heaven-tank weight
   *  (chassis-design-axioms.md) made literal in the silhouette itself, not
   *  just the color. Full-size (no shrink, unlike the ninja shards) — this
   *  is "aimed thrust; high single damage," not an aftermath. */
  private drawSpikeBody(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    r: number,
    angle: number,
    color: number,
    core: number,
    bodyAlpha: number,
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rot = (dx: number, dy: number): [number, number] => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    const tip = rot(r * 2.0, 0);
    const tail = rot(-r * 1.2, 0);
    // Symmetric wings — same offset mirrored, unlike the ninja sliver's
    // deliberately mismatched shoulders. A single honest line, not an edge.
    const wingF = rot(r * 0.1, r * 0.55);
    const wingB = rot(r * 0.1, -r * 0.55);
    g.fillStyle(color, 0.95 * bodyAlpha);
    g.fillTriangle(tip[0], tip[1], wingF[0], wingF[1], wingB[0], wingB[1]);
    g.fillTriangle(wingF[0], wingF[1], tail[0], tail[1], wingB[0], wingB[1]);
    // Bright spine — a solid gold core line, thicker than the ninja
    // sliver's to read as heavier/more committed.
    g.lineStyle(Math.max(1, r * 0.4), core, bodyAlpha);
    g.lineBetween(tail[0], tail[1], tip[0], tip[1]);
    // Hot core — matches drawShardBody's own convention.
    g.fillStyle(core, bodyAlpha);
    g.fillCircle(x, y, Math.max(1, r * 0.45));
  }

  private tweenRelease(
    obj: Phaser.GameObjects.GameObject & { setVisible?: (v: boolean) => unknown },
    props: Record<string, number>,
    durationMs: number,
  ): void {
    this.scene.tweens.add({
      targets: obj,
      ...props,
      duration: durationMs,
      ease: "Quad.easeOut",
      onComplete: () => this.pool?.release(obj),
    });
  }

  destroy(): void {
    this.bodyGfx.destroy();
    this.trailGfx.destroy();
    for (const id of [...this.halos.keys()]) this.releaseHalo(id);
    this.trails.clear();
    this.tendrilChains.clear();
    this.lastPos.clear();
  }
}
