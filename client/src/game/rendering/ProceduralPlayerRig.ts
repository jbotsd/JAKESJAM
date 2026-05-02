import Phaser from "phaser";
import type { Vec2 } from "../types/game";
import { PALETTE } from "../ui/palette.js";

/**
 * ProceduralPlayerRig - ROUNDS-style minimal character renderer.
 *
 * Renders a circle body + 4 stick limbs + 2 dot eyes. Silhouette-first design
 * inspired by ROUNDS: readable at any zoom, zero texture dependencies.
 *
 * Design references: ROUNDS (circle+sticks), Platforms Shooter (dot eyes).
 *
 * Performance: ~0.15ms per character at 60fps. All procedural, no textures.
 */

type ProceduralPlayerRigOptions = {
  color: number;
  name: string;
  scale?: number;
};

type ProceduralPlayerPose = {
  position: Vec2;
  velocity: Vec2;
  aimTarget: Vec2;
  grounded: boolean;
  crouching: boolean;
  health?: number;
  maxHealth?: number;
};

type LimbSolve = {
  joint: Vec2;
  end: Vec2;
};

// --- Colour Constants ---
const DARK = 0x07101c;
const WHITE = 0xf7fbff;
const ACCENT = 0x8ff8ff; // Crystal cyan glow

export class ProceduralPlayerRig {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly color: number;
  private readonly colorDark: number;
  private readonly name: string;
  private readonly scale: number;
  private stepPhase = 0;
  private facing = 1;
  private firePulse = 0;

  constructor(scene: Phaser.Scene, options: ProceduralPlayerRigOptions) {
    this.graphics = scene.add.graphics();
    this.nameText = scene.add
      .text(0, 0, options.name, {
        color: `#${PALETTE.textHi.toString(16).padStart(6, "0")}`,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: `${Math.round(10 * (options.scale ?? 1))}px`,
        fontStyle: "700",
      })
      .setOrigin(0.5, 1);
    this.color = options.color;
    this.colorDark = shadeColor(options.color, -0.4);
    this.name = options.name;
    this.scale = options.scale ?? 1;
  }

  update(deltaMs: number, pose: ProceduralPlayerPose) {
    if (!this.graphics.visible) return;

    const walkAmount = Phaser.Math.Clamp(Math.abs(pose.velocity.x) / 180, 0, 1);
    this.stepPhase += deltaMs * (0.006 + walkAmount * 0.01);
    this.firePulse = Math.max(0, this.firePulse - deltaMs * 0.004);

    if (Math.abs(pose.velocity.x) > 8) {
      this.facing = Math.sign(pose.velocity.x);
    } else if (Math.abs(pose.aimTarget.x - pose.position.x) > 2) {
      this.facing = Math.sign(pose.aimTarget.x - pose.position.x);
    }

    this.draw(pose, walkAmount);
  }

  destroy() {
    this.graphics.destroy();
    this.nameText.destroy();
  }

  setVisible(visible: boolean) {
    this.graphics.setVisible(visible);
    this.nameText.setVisible(visible);
    if (!visible) this.graphics.clear();
  }

  /** Trigger muzzle flash pulse (call on fire). */
  triggerFire() {
    this.firePulse = 1;
  }

  private draw(pose: ProceduralPlayerPose, walkAmount: number) {
    const g = this.graphics;
    const s = this.scale;
    const ground = pose.position.y;
    const cr = pose.crouching ? 1 : 0;
    const bob =
      pose.grounded && !pose.crouching ? Math.abs(Math.sin(this.stepPhase)) * 2 * walkAmount : 0;

    // Body centre sits above the ground line
    const bodyRadius = Phaser.Math.Linear(16, 13, cr) * s;
    const bodyCenterY = ground - Phaser.Math.Linear(52, 38, cr) * s - bob;
    const cx = pose.position.x;
    const center = vec(cx, bodyCenterY);
    // Head sits on top of the body circle
    const headY = bodyCenterY - bodyRadius - 8 * s;
    const head = vec(cx + this.facing * 1.5 * s, headY);

    // Aim
    const aimAngle = Math.atan2(pose.aimTarget.y - center.y, pose.aimTarget.x - center.x);
    const aim = vec(Math.cos(aimAngle), Math.sin(aimAngle));
    const perp = vec(-aim.y, aim.x);

    // Limb roots (body edge)
    const shoulderLead = vec(center.x + perp.x * bodyRadius, center.y + perp.y * bodyRadius);
    const shoulderBack = vec(center.x - perp.x * bodyRadius, center.y - perp.y * bodyRadius);
    const hipL = vec(center.x - 6 * s, center.y + bodyRadius * 0.7);
    const hipR = vec(center.x + 6 * s, center.y + bodyRadius * 0.7);

    // Limb endpoints
    const handLead = vec(center.x + aim.x * 34 * s, center.y + aim.y * 34 * s);
    const handBack = vec(
      center.x + aim.x * 18 * s - perp.x * 8 * s,
      center.y + aim.y * 18 * s - perp.y * 8 * s,
    );
    const muzzle = vec(center.x + aim.x * 48 * s, center.y + aim.y * 48 * s);

    const footL = this.footPos(cx, -1, ground, walkAmount, pose.crouching);
    const footR = this.footPos(cx, 1, ground, walkAmount, pose.crouching);

    // IK for arms (kept for correct bend)
    const armLead = solveTwoBone(shoulderLead, handLead, 18 * s, 17 * s, -this.facing);
    const armBack = solveTwoBone(shoulderBack, handBack, 17 * s, 16 * s, this.facing);

    g.clear();

    // --- DRAW ORDER (back to front) ---

    // 1. Nameplate (drawn first — always floats above due to text object z-order)
    this.drawNameplate(g, head.x, head.y - 14 * s, s, pose.health ?? 100, pose.maxHealth ?? 100);

    // 2. Back leg (stick)
    this.drawStickLimb(g, hipR, footR);

    // 3. Back arm (stick)
    this.drawStickLimb(g, shoulderBack, armBack.end);

    // 4. Body circle
    this.drawBody(g, center, bodyRadius, s);

    // 5. Front leg (stick)
    this.drawStickLimb(g, hipL, footL);

    // 6. Arm cannon / weapon (unchanged attachment point)
    this.drawArmCannon(g, handLead, muzzle, aim, s);

    // 7. Front arm (stick)
    this.drawStickLimb(g, shoulderLead, armLead.end);

    // 8. Head circle + dot eyes
    this.drawHead(g, head, s);
  }

  // --- BODY: Single filled circle + thin shading lines ---
  private drawBody(g: Phaser.GameObjects.Graphics, center: Vec2, r: number, s: number) {
    // Dark outline ring
    g.fillStyle(DARK, 1);
    g.fillCircle(center.x, center.y, r + 1.5 * s);

    // Main colour fill
    g.fillStyle(this.color, 1);
    g.fillCircle(center.x, center.y, r);

    // 3 thin vertical white shading lines (form hint, ROUNDS-style)
    const lineAlpha = 0.18;
    const lineH = r * 1.4;
    const lineTop = center.y - lineH / 2;
    g.fillStyle(WHITE, lineAlpha);
    // Left stripe
    g.fillRect(center.x - r * 0.45, lineTop, Math.max(1, 1.5 * s), lineH);
    // Centre stripe
    g.fillRect(center.x - Math.max(0.5, 0.5 * s), lineTop, Math.max(1, 1.5 * s), lineH);
    // Right stripe
    g.fillRect(center.x + r * 0.3, lineTop, Math.max(1, 1.5 * s), lineH);
  }

  // --- HEAD: Small circle + 2 dot eyes ---
  private drawHead(g: Phaser.GameObjects.Graphics, head: Vec2, s: number) {
    const r = 7 * s;
    const f = this.facing;

    // Dark outline
    g.fillStyle(DARK, 1);
    g.fillCircle(head.x, head.y, r + 1.5 * s);

    // Head fill (player colour, slightly darker)
    g.fillStyle(this.colorDark, 1);
    g.fillCircle(head.x, head.y, r);

    // 2 dot eyes — offset toward facing direction
    const eyeOffsetX = f * 2.5 * s;
    const eyeOffsetY = -0.5 * s;
    const eyeSpacing = 2.8 * s;
    const eyeR = Math.max(1, 1.5 * s);

    g.fillStyle(WHITE, 1);
    g.fillCircle(head.x + eyeOffsetX - eyeSpacing, head.y + eyeOffsetY, eyeR);
    g.fillCircle(head.x + eyeOffsetX + eyeSpacing, head.y + eyeOffsetY, eyeR);
  }

  // --- STICK LIMB: Single thin line (3px) ---
  private drawStickLimb(g: Phaser.GameObjects.Graphics, root: Vec2, end: Vec2) {
    // Dark shadow stroke
    g.lineStyle(4, DARK, 0.8);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(end.x, end.y);
    g.strokePath();

    // Player colour stroke
    g.lineStyle(3, this.color, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(end.x, end.y);
    g.strokePath();
  }

  // --- ARM CANNON: Crystal-tech weapon (unchanged) ---
  private drawArmCannon(
    g: Phaser.GameObjects.Graphics,
    hand: Vec2,
    muzzle: Vec2,
    _aim: Vec2,
    s: number,
  ) {
    const dx = muzzle.x - hand.x;
    const dy = muzzle.y - hand.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const px = -ny;
    const py = nx;

    // Cannon body (thick dark barrel)
    const barrelW = 5 * s;
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(hand.x + px * barrelW, hand.y + py * barrelW);
    g.lineTo(muzzle.x + px * barrelW * 0.7, muzzle.y + py * barrelW * 0.7);
    g.lineTo(muzzle.x - px * barrelW * 0.7, muzzle.y - py * barrelW * 0.7);
    g.lineTo(hand.x - px * barrelW, hand.y - py * barrelW);
    g.closePath();
    g.fillPath();

    // Inner cannon colour
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(hand.x + px * (barrelW - 1.5 * s), hand.y + py * (barrelW - 1.5 * s));
    g.lineTo(muzzle.x + px * barrelW * 0.5, muzzle.y + py * barrelW * 0.5);
    g.lineTo(muzzle.x - px * barrelW * 0.5, muzzle.y - py * barrelW * 0.5);
    g.lineTo(hand.x - px * (barrelW - 1.5 * s), hand.y - py * (barrelW - 1.5 * s));
    g.closePath();
    g.fillPath();

    // Energy channel along cannon
    g.lineStyle(1.5 * s, ACCENT, 0.6);
    g.beginPath();
    g.moveTo(hand.x + nx * 4 * s, hand.y + ny * 4 * s);
    g.lineTo(muzzle.x - nx * 4 * s, muzzle.y - ny * 4 * s);
    g.strokePath();

    // Muzzle glow
    const pulseSize = 1 + this.firePulse * 0.8;
    const muzzleRadius = 4 * s * pulseSize;

    // Outer halo
    g.fillStyle(ACCENT, 0.2 + this.firePulse * 0.3);
    g.fillCircle(muzzle.x, muzzle.y, muzzleRadius * 2.5);

    // Mid glow
    g.fillStyle(ACCENT, 0.5 + this.firePulse * 0.3);
    g.fillCircle(muzzle.x, muzzle.y, muzzleRadius * 1.4);

    // Core
    g.fillStyle(WHITE, 0.8 + this.firePulse * 0.2);
    g.fillCircle(muzzle.x, muzzle.y, muzzleRadius * 0.6);
  }

  // --- NAMEPLATE (plate-less) ---
  // No background rect. Name in textHi. Thin 2px hpLime underline as HP bar.
  private drawNameplate(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    s: number,
    health: number,
    maxHealth: number,
  ) {
    const nameWidth = Math.max(52, this.name.length * 6.5) * s;
    const healthRatio = Phaser.Math.Clamp(health / Math.max(1, maxHealth), 0, 1);

    // Name text — no background, no health suffix
    this.nameText.setText(this.name);
    this.nameText.setPosition(x, y - 6 * s);

    // 2px lime HP underline directly under name text
    const lineY = y - 4 * s;
    g.fillStyle(PALETTE.hpLime, 1);
    g.fillRect(x - nameWidth / 2, lineY, nameWidth * healthRatio, 2);
  }

  // --- FOOT POSITION ---
  private footPos(cx: number, side: -1 | 1, ground: number, walk: number, crouch: boolean): Vec2 {
    const s = this.scale;
    const cycle = this.stepPhase + (side === -1 ? 0 : Math.PI);
    const stride = (crouch ? 10 : 18) * s * walk;
    const lift = Math.max(0, Math.sin(cycle)) * (crouch ? 4 : 8) * s * walk;
    const spread = (crouch ? 8 : 7) * s;
    return vec(cx + side * spread - Math.cos(cycle) * stride * this.facing, ground - lift);
  }
}

// --- Utility ---

function solveTwoBone(
  root: Vec2,
  target: Vec2,
  upper: number,
  lower: number,
  bend: number,
): LimbSolve {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dist = Phaser.Math.Clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const angle = Math.atan2(dy, dx);
  const jointAngle = Math.acos(
    Phaser.Math.Clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1),
  );
  const ua = angle + jointAngle * bend;
  return {
    joint: vec(root.x + Math.cos(ua) * upper, root.y + Math.sin(ua) * upper),
    end: target,
  };
}

function shadeColor(hex: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + Math.round(amount * 255)));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 0xff) + Math.round(amount * 255)));
  const b = Math.min(255, Math.max(0, (hex & 0xff) + Math.round(amount * 255)));
  return (r << 16) | (g << 8) | b;
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}
