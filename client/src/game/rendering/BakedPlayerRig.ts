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
// Dash-bash shield + parry flash keep the BASE vector implementations — they
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
/** Crystal cyan — the game's gnostic signature glow. */
const ACCENT = 0x8ff8ff;

let bakeCounter = 0;

export class BakedPlayerRig extends ProceduralPlayerRig {
  private readonly bakedScene: Phaser.Scene;
  private readonly texKey: string;
  private readonly parts: Phaser.GameObjects.Image[] = [];
  private cursor = 0;
  private lastFrame = -1;
  private spin = 0;
  private motePhase = 0;
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
    const accent = css(ACCENT);

    // capsule (limb segment): dark outline, colored core, joint dots at
    // the ends (the live rig's glowing joints are half its articulated feel)
    ctx.fillStyle = dark;
    roundRect(ctx, 0, 0, 32, 10, 5);
    ctx.fill();
    ctx.fillStyle = main;
    roundRect(ctx, 2, 2, 28, 6, 3);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(5, 5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(27, 5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // torso: ROBE silhouette — broad chest (right edge) flowing into a
    // flared skirted hem at the pelvis end (left edge). Reads garment, not
    // chassis. (quadBetween lays long axis pelvis→chest.)
    ctx.fillStyle = dark;
    poly(ctx, [[32, 6], [40, 11], [56, 4], [58, 10], [58, 20], [56, 26], [40, 19], [32, 24], [34, 15]]);
    ctx.fillStyle = main;
    poly(ctx, [[34.5, 8.5], [41, 12.5], [55, 6.5], [56.5, 11], [56.5, 19], [55, 23.5], [41, 17.5], [34.5, 21.5], [36.5, 15]]);
    // chest sigil highlight (accent — the gnostic mark)
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    poly(ctx, [[50, 11], [54.5, 12.8], [50, 14.6], [47.5, 12.8]]);
    ctx.globalAlpha = 1;

    // head: gnostic COWL — peaked hood (wizard silhouette, not helmet),
    // deep skirt overlapping the chest, narrow crystal-cyan visor glow
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(70, 0);            // hood peak
    ctx.quadraticCurveTo(79, 3, 80, 12);
    ctx.lineTo(78, 20);
    ctx.lineTo(62, 20);
    ctx.lineTo(60, 12);
    ctx.quadraticCurveTo(61, 3, 70, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.moveTo(70, 2);
    ctx.quadraticCurveTo(77, 4.5, 78, 12);
    ctx.lineTo(76.2, 18.5);
    ctx.lineTo(63.8, 18.5);
    ctx.lineTo(62, 12);
    ctx.quadraticCurveTo(63, 4.5, 70, 2);
    ctx.closePath();
    ctx.fill();
    // cowl shadow (face recess) + glowing visor slit
    ctx.fillStyle = dark;
    ctx.fillRect(63.5, 9, 13, 6);
    ctx.fillStyle = accent;
    ctx.fillRect(64.5, 10.6, 11, 2.2);

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

    // drape (sash) — drawn pointing RIGHT: quadBetween stretches the
    // frame's long axis along pelvis→tip, so the apex must be at the
    // frame's right edge (was bottom — the sash jutted sideways).
    ctx.fillStyle = dark;
    poly(ctx, [[64, 34], [64, 52], [82, 43]]);
    ctx.fillStyle = main;
    ctx.globalAlpha = 0.8;
    poly(ctx, [[65.5, 36], [65.5, 50], [79.5, 43]]);
    ctx.globalAlpha = 1;

    // soft mote (radial glow) — ONE cheap quad of gnostic energy at the
    // chest (frame 0,32,16,16); the full 8-mote aura stays cut on this tier
    const grad = ctx.createRadialGradient(8, 40, 0.5, 8, 40, 8);
    grad.addColorStop(0, "rgba(143,248,255,0.85)");
    grad.addColorStop(0.5, "rgba(143,248,255,0.28)");
    grad.addColorStop(1, "rgba(143,248,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 32, 16, 16);

    // spine strip — crystal-cyan rune column
    ctx.fillStyle = accent;
    ctx.fillRect(88.8, 0, 4.4, 18);
    ctx.fillStyle = white;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(90, 2, 2, 3);
    ctx.fillRect(90, 8, 2, 3);
    ctx.fillRect(90, 14, 2, 3);
    ctx.globalAlpha = 1;

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
    // Frame is drawn pelvis-left → chest-right along the quad axis.
    this.quadBetween(pelvis, chest, 26 * s, 32, 0, 26, 30);
  }

  protected override drawHead(
    _g: Phaser.GameObjects.Graphics,
    head: Vec2,
    s: number,
    _healthRatio: number,
  ): void {
    const img = this.frame(60, 0, 20, 20);
    img.setPosition(head.x, head.y + 1.5 * s);
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
    img.setDisplaySize(11 * s, 11 * s);
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
    // the gnostic mote — one soft additive glow breathing at the chest
    this.motePhase += 0.06;
    const mote = this.frame(0, 32, 16, 16);
    mote.setPosition(chest.x, chest.y - 2 * s);
    const pulse = 0.85 + 0.15 * Math.sin(this.motePhase);
    mote.setDisplaySize(22 * s * pulse, 22 * s * pulse);
    mote.setRotation(0);
    mote.setBlendMode(Phaser.BlendModes.ADD);
    mote.setAlpha(0.5 * Math.max(0.3, healthRatio));
  }

  // Fill-rate eaters: deliberately nothing on the baked tiers.
  // (Hip drape also cut — Jake's call 2026-07-11: the optimised character
  // reads cleaner without the loincloth, and it's one fewer quad.)
  protected override drawHipDrape(): void {}
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
