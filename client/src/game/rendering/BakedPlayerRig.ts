// BakedPlayerRig — the potato/phone-tier twin of the procedural rig
// (RENDER_OVERHAUL_PLAN Phase 2).
//
// MOTION-IDENTICAL BY CONSTRUCTION: this subclass overrides ONLY the leaf
// painters. Every line of the base class's pose pipeline — springs, IK,
// facing ease, squash, walk phase — executes untouched; the solved joints
// arrive here through the same painter arguments the vector painters get.
// There is no ported math to drift.
//
// PAINT: instead of tessellating ~50-100 Graphics path ops per frame, each
// part is a tiny texture baked ONCE at construction (plain 2D canvas — no
// Phaser RenderTexture, which broke under 4.1) and drawn as a positioned/
// rotated/stretched Image — a handful of batched quads per player. Aura,
// trail and dash streaks are deliberately NO-OPs: additive fill is exactly
// the cost the weak tiers can't pay (the tier ladder's whole point).
// Aegis shield + parry flash keep the BASE vector implementations — they
// are rare, brief, and gameplay-legibility-critical.
//
// Image pooling: painters run in a fixed order inside the base draw(); a
// per-frame cursor hands out pooled Images in call order and hides any
// leftovers, so pool identity is stable frame to frame with zero churn.

import Phaser from "phaser";
import type { Vec2 } from "../types/game";
import {
  ProceduralPlayerRig,
  type LimbSolve,
} from "./ProceduralPlayerRig";

type RigOptions = ConstructorParameters<typeof ProceduralPlayerRig>[1];

const DARK = 0x07101c;
const WHITE = 0xf7fbff;

let bakeCounter = 0;

export class BakedPlayerRig extends ProceduralPlayerRig {
  private readonly bakedScene: Phaser.Scene;
  private readonly texKey: string;
  private readonly parts: Phaser.GameObjects.Image[] = [];
  private cursor = 0;
  private lastFrame = -1;
  private spin = 0;
  private bakedVisible = true;

  constructor(scene: Phaser.Scene, options: RigOptions) {
    super(scene, options);
    this.bakedScene = scene;
    bakeCounter += 1;
    this.texKey = `baked-rig-${bakeCounter}`;
    this.bakeParts(options.color);
  }

  // ── Part atlas (one tiny canvas per rig, baked once) ────────────────────
  //
  // Frames (x, y, w, h) on a 96x64 canvas:
  //   capsule 0,0,32,10 · torso 32,0,26,30 · head 60,0,20,20
  //   boot 0,16,12,8 · pauldron 16,16,10,10 · disc 32,32,10,10
  //   star 48,32,14,14 · drape 64,32,18,22 · spine 88,0,6,18

  private bakeParts(color: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
    const dark = css(DARK);
    const main = css(color);
    const white = css(WHITE);

    // capsule (limb segment): dark outline, colored core
    ctx.fillStyle = dark;
    roundRect(ctx, 0, 0, 32, 10, 5);
    ctx.fill();
    ctx.fillStyle = main;
    roundRect(ctx, 2, 2, 28, 6, 3);
    ctx.fill();

    // torso plate: hex-ish mass
    ctx.fillStyle = dark;
    poly(ctx, [[45, 0], [58, 6], [58, 24], [45, 30], [32, 24], [32, 6]]);
    ctx.fillStyle = main;
    poly(ctx, [[45, 3], [55, 8], [55, 22], [45, 27], [35, 22], [35, 8]]);
    ctx.fillStyle = white;
    ctx.globalAlpha = 0.35;
    poly(ctx, [[45, 5], [52, 9], [45, 13], [38, 9]]);
    ctx.globalAlpha = 1;

    // head: hooded silhouette + visor slit
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(70, 10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.arc(70, 10, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = white;
    ctx.fillRect(66, 8, 9, 2.5);

    // boot
    ctx.fillStyle = dark;
    roundRect(ctx, 0, 16, 12, 8, 3);
    ctx.fill();
    ctx.fillStyle = main;
    roundRect(ctx, 1.5, 17.5, 9, 5, 2);
    ctx.fill();

    // pauldron
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(21, 21, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.arc(21, 21, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // palm disc
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(37, 37, 5, 0, Math.PI * 2);
    ctx.fill();

    // shuriken star
    ctx.fillStyle = white;
    star(ctx, 55, 39, 4, 7, 3);

    // drape (sash triangle)
    ctx.fillStyle = dark;
    poly(ctx, [[64, 32], [82, 32], [73, 54]]);
    ctx.fillStyle = main;
    ctx.globalAlpha = 0.8;
    poly(ctx, [[66, 33], [80, 33], [73, 51]]);
    ctx.globalAlpha = 1;

    // spine strip (accent)
    ctx.fillStyle = white;
    ctx.fillRect(88, 0, 6, 18);

    this.bakedScene.textures.addCanvas(this.texKey, canvas);
  }

  private frame(
    fx: number,
    fy: number,
    fw: number,
    fh: number,
  ): Phaser.GameObjects.Image {
    // New frame each call this frame — cursor resets when the game frame
    // number changes (draw() calls painters exactly once per update).
    const now = this.bakedScene.game.loop.frame;
    if (now !== this.lastFrame) {
      // hide anything unused last frame
      for (let i = this.cursor; i < this.parts.length; i++) this.parts[i]!.setVisible(false);
      this.cursor = 0;
      this.lastFrame = now;
    }
    let img = this.parts[this.cursor];
    if (!img) {
      img = this.bakedScene.add.image(0, 0, this.texKey);
      img.setDepth(10);
      this.parts.push(img);
    }
    this.cursor += 1;
    const frameKey = `${this.texKey}-${fx}-${fy}`;
    const tex = this.bakedScene.textures.get(this.texKey);
    if (!tex.has(frameKey)) tex.add(frameKey, 0, fx, fy, fw, fh);
    img.setTexture(this.texKey, frameKey);
    img.setVisible(this.bakedVisible);
    img.setAlpha(1);
    return img;
  }

  /** Stretch a part between two points (limb/torso/drape quads). */
  private quadBetween(
    a: Vec2,
    b: Vec2,
    width: number,
    fx: number,
    fy: number,
    fw: number,
    fh: number,
  ): Phaser.GameObjects.Image {
    const img = this.frame(fx, fy, fw, fh);
    const len = Math.max(2, Math.hypot(b.x - a.x, b.y - a.y));
    img.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2);
    img.setRotation(Math.atan2(b.y - a.y, b.x - a.x));
    img.setDisplaySize(len + width * 0.6, width);
    return img;
  }

  // ── Painter overrides (same signatures; joints from the SAME solve) ─────

  protected override drawThickLimb(
    _g: Phaser.GameObjects.Graphics,
    root: Vec2,
    solve: LimbSolve,
    outerW: number,
    _innerW: number,
  ): void {
    this.quadBetween(root, solve.joint, outerW, 0, 0, 32, 10);
    this.quadBetween(solve.joint, solve.end, outerW * 0.9, 0, 0, 32, 10);
  }

  protected override drawTorso(
    _g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    s: number,
  ): void {
    const img = this.quadBetween(pelvis, chest, 24 * s, 32, 0, 26, 30);
    // torso quad runs along the spine — rotate frame 90° so the plate's
    // vertical axis follows pelvis→chest.
    img.setRotation(img.rotation + Math.PI / 2);
  }

  protected override drawHead(
    _g: Phaser.GameObjects.Graphics,
    head: Vec2,
    s: number,
    _healthRatio: number,
  ): void {
    const img = this.frame(60, 0, 20, 20);
    img.setPosition(head.x, head.y);
    img.setDisplaySize(19 * s, 19 * s);
    img.setRotation(0);
  }

  protected override drawBoot(_g: Phaser.GameObjects.Graphics, foot: Vec2, s: number): void {
    const img = this.frame(0, 16, 12, 8);
    img.setPosition(foot.x, foot.y - 2 * s);
    img.setDisplaySize(12 * s, 8 * s);
    img.setRotation(0);
  }

  protected override drawShoulderArmor(
    _g: Phaser.GameObjects.Graphics,
    shoulder: Vec2,
    s: number,
  ): void {
    const img = this.frame(16, 16, 10, 10);
    img.setPosition(shoulder.x, shoulder.y);
    img.setDisplaySize(9 * s, 9 * s);
    img.setRotation(0);
  }

  protected override drawHandGlow(
    _g: Phaser.GameObjects.Graphics,
    hand: Vec2,
    s: number,
    pulse: number,
  ): void {
    const img = this.frame(32, 32, 10, 10);
    img.setPosition(hand.x, hand.y);
    img.setDisplaySize((5 + pulse * 3) * s, (5 + pulse * 3) * s);
    img.setRotation(0);
  }

  protected override drawShuriken(
    _g: Phaser.GameObjects.Graphics,
    hand: Vec2,
    _aim: Vec2,
    s: number,
    throwAmount: number,
  ): void {
    this.spin += 0.15 + throwAmount * 0.4;
    const img = this.frame(48, 32, 14, 14);
    img.setPosition(hand.x, hand.y);
    img.setDisplaySize(10 * s, 10 * s);
    img.setRotation(this.spin);
    img.setAlpha(0.7 + throwAmount * 0.3);
  }

  protected override drawHipDrape(
    _g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    tip: Vec2,
    s: number,
  ): void {
    this.quadBetween(pelvis, tip, 14 * s, 64, 32, 18, 22);
  }

  protected override drawSpineGlow(
    _g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    s: number,
    healthRatio: number,
    gripping: boolean,
  ): void {
    const img = this.quadBetween(pelvis, chest, 3.5 * s, 88, 0, 6, 18);
    img.setAlpha((gripping ? 0.25 : 0.55) * Math.max(0.25, healthRatio));
  }

  // Fill-rate eaters: deliberately nothing on the baked tiers.
  protected override drawAura(): void {}
  protected override drawTrail(): void {}
  protected override drawDashStreaks(): void {}
  protected override drawHeadCrest(): void {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  override setVisible(visible: boolean): void {
    super.setVisible(visible);
    this.bakedVisible = visible;
    for (const p of this.parts) p.setVisible(visible);
  }

  override destroy(): void {
    super.destroy();
    for (const p of this.parts) p.destroy();
    this.parts.length = 0;
    this.bakedScene.textures.remove(this.texKey);
  }
}

// ── tiny 2D canvas helpers ──────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function poly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.closePath();
  ctx.fill();
}

function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  points: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
