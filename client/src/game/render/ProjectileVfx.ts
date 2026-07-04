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
import { GLOW_TEXTURE_SIZE } from "./glowTexture";

const TRAIL_SAMPLES = 6;
const BODY_DEPTH = 6;
const TRAIL_DEPTH = 5;
const HALO_DEPTH = 4;

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
  electric: { glowScale: 3.0, trailWidth: 0.8, core: 0xfff7c0 },
  void: { glowScale: 3.2, trailWidth: 1.1, core: 0xd9c8ff },
  radiant: { glowScale: 3.8, trailWidth: 1.4, core: 0xffffff },
  toxic: { glowScale: 2.4, trailWidth: 1.1, core: 0xd6ffd6 },
  sticky: { glowScale: 2.4, trailWidth: 1.5, core: 0xffd9a8 },
  explosive: { glowScale: 3.2, trailWidth: 1.4, core: 0xffd0d6 },
  crystal: { glowScale: 2.8, trailWidth: 1.0, core: 0xffe0ff },
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
  private readonly halos = new Map<number, Phaser.GameObjects.Image>();
  private readonly lastPos = new Map<number, { x: number; y: number; element: string; radius: number }>();

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
   */
  render(state: WorldState, resolveColor: ColorResolver): void {
    const body = this.bodyGfx;
    const trail = this.trailGfx;
    body.clear();
    trail.clear();

    const seen = new Set<number>();
    for (const [idStr, proj] of Object.entries(state.projectiles)) {
      const id = Number(idStr);
      seen.add(id);
      const color = resolveColor(proj.element as ElementType, proj.ownerId);
      const lang = elementVfx(proj.element);
      const radius = proj.radius || 5;
      const angle = Math.atan2(proj.vy, proj.vx);

      // Trail — record position, draw newest→oldest as fading additive segs.
      // First sight of an id = the shot's muzzle frame: the spawn point IS
      // the muzzle and we have element/velocity/damage right here, so fire
      // the muzzle flash without any separate event plumbing.
      let t = this.trails.get(id);
      if (!t) {
        t = new Trail();
        this.trails.set(id, t);
        this.muzzle(proj.x, proj.y, angle, proj.element, proj.damage);
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
        const a = (1 - i / total) * 0.5;
        trail.lineStyle(Math.max(1, radius * lang.trailWidth * (1 - i / total)), color, a);
        trail.lineBetween(px, py, x, y);
        px = x;
        py = y;
      });

      // Halo — one pooled additive glow following the body.
      this.updateHalo(id, proj.x, proj.y, radius * lang.glowScale, color);

      // Body — element core over a resolved-color shell, shape-correct.
      this.drawBody(body, proj.shape, proj.x, proj.y, radius, angle, color, lang.core);

      this.lastPos.set(id, { x: proj.x, y: proj.y, element: proj.element, radius });
    }

    // Despawn diff → impact/fizzle, release halo + trail.
    for (const id of [...this.trails.keys()]) {
      if (seen.has(id)) continue;
      const last = this.lastPos.get(id);
      if (last) this.impact(last.x, last.y, last.element, last.radius);
      this.releaseHalo(id);
      this.trails.delete(id);
      this.lastPos.delete(id);
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

  /** Impact / fizzle on despawn — element spark fan + ring. */
  private impact(x: number, y: number, element: string, radius: number): void {
    const pool = this.pool;
    if (!pool) return;
    const color = elementVfx(element).core;
    const ring = pool.acquireRing();
    if (ring) {
      ring.setPosition(x, y).setScale(0.2).setAlpha(0.8).setDepth(HALO_DEPTH);
      (ring as unknown as { setStrokeStyle?: (w: number, c: number) => void }).setStrokeStyle?.(2, color);
      this.tweenRelease(ring, { scaleX: 1.4, scaleY: 1.4, alpha: 0 }, 220);
    }
    const fan = Math.min(6, 3 + Math.round(radius / 4));
    for (let i = 0; i < fan; i += 1) {
      const s = pool.acquireSpark();
      if (!s) break;
      const a = (i / fan) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 10 + Math.random() * 14;
      s.setPosition(x, y).setFillStyle(color, 1).setDepth(HALO_DEPTH).setRotation(a);
      this.tweenRelease(s, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0 }, 200);
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
  ): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rot = (dx: number, dy: number): [number, number] => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    g.fillStyle(color, 0.95);
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
        g.lineStyle(Math.max(2, r * 0.6), color, 0.95);
        for (const base of [angle + Math.PI / 4, angle - Math.PI / 4]) {
          g.lineBetween(x - Math.cos(base) * arm, y - Math.sin(base) * arm, x + Math.cos(base) * arm, y + Math.sin(base) * arm);
        }
        break;
      }
      case "bar": {
        // Capsule stretched along velocity.
        const half = r * 2.2;
        g.lineStyle(Math.max(2, r * 1.2), color, 0.95);
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
    g.fillStyle(core, 1);
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
    this.lastPos.clear();
  }
}
