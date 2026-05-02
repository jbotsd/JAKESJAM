import Phaser from "phaser";
import type { Vec2 } from "../types/game";
import { PALETTE } from "../ui/palette.js";

/**
 * ProceduralPlayerRig - AAA-quality procedural character renderer.
 *
 * Renders a chunky cyberpunk sorcerer using filled polygons, not wireframe lines.
 * The character has real visual mass: armored torso, thick limbs, heavy boots,
 * a hooded helmet with glowing visor, shoulder armor, and a crystal arm cannon.
 *
 * Design references: Nuclear Throne (chunky proportions), Hyper Light Drifter
 * (crystal-tech glow), SUPERHOT (geometric reduction).
 *
 * Performance: ~0.3ms per character at 60fps. All procedural, no textures.
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
const DARK2 = 0x0f1a2e;
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
  private readonly trailPositions: { x: number; y: number; t: number }[] = [];
  private lastTrailSampleMs = 0;

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

    // Trail sampling — wall-clock, purely visual feedback
    const now = Date.now();
    if (now - this.lastTrailSampleMs >= 40) {
      this.trailPositions.push({ x: pose.position.x, y: pose.position.y, t: now });
      if (this.trailPositions.length > 6) {
        this.trailPositions.shift();
      }
      this.lastTrailSampleMs = now;
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

    // Key positions
    const pelvisY = ground - Phaser.Math.Linear(52, 32, cr) * s - bob;
    const chestY = ground - Phaser.Math.Linear(78, 56, cr) * s - bob;
    const headY = ground - Phaser.Math.Linear(100, 76, cr) * s - bob;
    const cx = pose.position.x;

    const pelvis = vec(cx, pelvisY);
    const chest = vec(cx, chestY);
    const head = vec(cx + this.facing * 2 * s, headY);

    // Aim
    const aimAngle = Math.atan2(pose.aimTarget.y - chest.y, pose.aimTarget.x - chest.x);
    const aim = vec(Math.cos(aimAngle), Math.sin(aimAngle));
    const perp = vec(-aim.y, aim.x);

    // Joints
    const hipL = vec(pelvis.x - 7 * s, pelvis.y);
    const hipR = vec(pelvis.x + 7 * s, pelvis.y);
    const shoulderLead = vec(chest.x + perp.x * 7 * s, chest.y + perp.y * 7 * s);
    const shoulderBack = vec(chest.x - perp.x * 7 * s, chest.y - perp.y * 7 * s);
    const handLead = vec(chest.x + aim.x * 34 * s, chest.y + aim.y * 34 * s);
    const handBack = vec(
      chest.x + aim.x * 18 * s - perp.x * 8 * s,
      chest.y + aim.y * 18 * s - perp.y * 8 * s,
    );
    const muzzle = vec(chest.x + aim.x * 48 * s, chest.y + aim.y * 48 * s);

    // Feet
    const footL = this.footPos(cx, -1, ground, walkAmount, pose.crouching);
    const footR = this.footPos(cx, 1, ground, walkAmount, pose.crouching);

    // IK
    const legLen1 = Phaser.Math.Linear(28, 22, cr) * s;
    const legLen2 = Phaser.Math.Linear(28, 22, cr) * s;
    const legL = solveTwoBone(hipL, footL, legLen1, legLen2, -this.facing);
    const legR = solveTwoBone(hipR, footR, legLen1, legLen2, -this.facing);
    const armLead = solveTwoBone(shoulderLead, handLead, 18 * s, 17 * s, -this.facing);
    const armBack = solveTwoBone(shoulderBack, handBack, 17 * s, 16 * s, this.facing);

    const healthRatio = (pose.health ?? 100) / Math.max(1, pose.maxHealth ?? 100);

    g.clear();

    // --- TRAIL (drawn before body so it sits behind everything) ---
    this.drawTrail(g, pose.position, pose.velocity, s);

    // --- DRAW ORDER (back to front) ---

    // 1. Nameplate + health bar (topmost layer visually but drawn first for z)
    this.drawNameplate(g, head.x, head.y - 24 * s, s, pose.health ?? 100, pose.maxHealth ?? 100);

    // 2. Back leg
    this.drawThickLimb(g, hipR, legR, 7 * s, 5 * s);
    this.drawBoot(g, footR, s);

    // 3. Back arm
    this.drawThickLimb(g, shoulderBack, armBack, 6 * s, 4 * s);

    // 4. Torso (filled polygon - the character's MASS)
    this.drawTorso(g, pelvis, chest, s);

    // 5. Spine energy lines
    this.drawSpineGlow(g, pelvis, chest, s, healthRatio);

    // 6. Front leg
    this.drawThickLimb(g, hipL, legL, 8 * s, 6 * s);
    this.drawBoot(g, footL, s);

    // 7. Arm cannon / weapon
    this.drawArmCannon(g, handLead, muzzle, aim, s);

    // 8. Front arm
    this.drawThickLimb(g, shoulderLead, armLead, 7 * s, 5 * s);

    // 9. Shoulder armor
    this.drawShoulderArmor(g, shoulderLead, s);

    // 10. Head + hood + visor
    this.drawHead(g, head, s, healthRatio);
  }

  // --- TRAIL: Fading body-color dots at past positions ---
  private drawTrail(
    g: Phaser.GameObjects.Graphics,
    currentPos: Vec2,
    velocity: Vec2,
    s: number,
  ): void {
    if (this.trailPositions.length < 2) return;

    // Velocity gate: compute speed from last 2 buffer entries
    const last = this.trailPositions[this.trailPositions.length - 1];
    const prev = this.trailPositions[this.trailPositions.length - 2];
    if (!last || !prev) return;

    const dt = Math.max(1, last.t - prev.t);
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const speed = Math.hypot(dx, dy) / (dt / 1000);

    // Also check live velocity as a fallback (covers the very first few frames)
    const liveSpeed = Math.hypot(velocity.x, velocity.y);
    if (Math.max(speed, liveSpeed) <= 60) return;

    const len = this.trailPositions.length;
    for (let i = 0; i < len; i++) {
      const entry = this.trailPositions[i];
      if (!entry) continue;

      // Skip dots too close to current position (avoids smear when near-stationary)
      const distToCurrent = Math.hypot(entry.x - currentPos.x, entry.y - currentPos.y);
      if (distToCurrent < 4) continue;

      // Older entries have lower index → lower alpha
      const alpha = ((i + 1) / len) * 0.4;
      g.fillStyle(this.color, alpha);
      g.fillCircle(entry.x, entry.y, 3 * s);
    }
  }

  // --- TORSO: Filled armored body ---
  private drawTorso(g: Phaser.GameObjects.Graphics, pelvis: Vec2, chest: Vec2, s: number) {
    const w1 = 14 * s; // chest width
    const w2 = 10 * s; // pelvis width

    // Dark outline
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(chest.x - w1 / 2 - 1, chest.y - 2 * s);
    g.lineTo(chest.x + w1 / 2 + 1, chest.y - 2 * s);
    g.lineTo(pelvis.x + w2 / 2 + 1, pelvis.y + 2 * s);
    g.lineTo(pelvis.x - w2 / 2 - 1, pelvis.y + 2 * s);
    g.closePath();
    g.fillPath();

    // Main body fill
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(chest.x - w1 / 2, chest.y);
    g.lineTo(chest.x + w1 / 2, chest.y);
    g.lineTo(pelvis.x + w2 / 2, pelvis.y);
    g.lineTo(pelvis.x - w2 / 2, pelvis.y);
    g.closePath();
    g.fillPath();

    // Chest plate highlight
    g.fillStyle(this.color, 0.8);
    g.beginPath();
    g.moveTo(chest.x - w1 * 0.35, chest.y + 2 * s);
    g.lineTo(chest.x + w1 * 0.35, chest.y + 2 * s);
    g.lineTo(pelvis.x + w2 * 0.25, pelvis.y - 4 * s);
    g.lineTo(pelvis.x - w2 * 0.25, pelvis.y - 4 * s);
    g.closePath();
    g.fillPath();

    // Belt line
    g.fillStyle(DARK, 0.9);
    g.fillRect(pelvis.x - w2 / 2 + 1, pelvis.y - 3 * s, w2 - 2, 4 * s);

    // Upper-hemisphere rim arc — simulates directional light from above.
    // 200° → 340° (top arc), 2px, light warm color at alpha 0.20.
    g.lineStyle(2 * s, PALETTE.lightBeamWarm, 0.20);
    g.beginPath();
    g.arc(
      chest.x,
      chest.y,
      w1 / 2 + 1,
      Phaser.Math.DegToRad(200),
      Phaser.Math.DegToRad(340),
      false,
    );
    g.strokePath();
  }

  // --- SPINE GLOW: Energy filaments showing health ---
  private drawSpineGlow(
    g: Phaser.GameObjects.Graphics,
    pelvis: Vec2,
    chest: Vec2,
    s: number,
    healthRatio: number,
  ) {
    const alpha = 0.3 + 0.6 * healthRatio;
    const color = healthRatio < 0.25 ? 0xfb7185 : ACCENT;

    g.lineStyle(2 * s, color, alpha);
    g.beginPath();
    g.moveTo(pelvis.x, pelvis.y - 2 * s);
    g.lineTo(chest.x, chest.y + 2 * s);
    g.strokePath();

    // Centre glow dot
    const midY = (pelvis.y + chest.y) / 2;
    g.fillStyle(color, alpha * 0.6);
    g.fillCircle(pelvis.x, midY, 3 * s);
  }

  // --- HEAD: Hood + helmet + visor ---
  private drawHead(g: Phaser.GameObjects.Graphics, head: Vec2, s: number, healthRatio: number) {
    const f = this.facing;

    // Hood shadow (larger dark shape behind head)
    g.fillStyle(DARK, 1);
    g.beginPath();
    g.moveTo(head.x - 11 * s, head.y + 6 * s);
    g.lineTo(head.x + f * 2 * s - 9 * s, head.y - 14 * s);
    g.lineTo(head.x + f * 2 * s + 9 * s, head.y - 14 * s);
    g.lineTo(head.x + 11 * s, head.y + 6 * s);
    g.closePath();
    g.fillPath();

    // Hood main (player colored)
    g.fillStyle(this.colorDark, 1);
    g.beginPath();
    g.moveTo(head.x - 9 * s, head.y + 4 * s);
    g.lineTo(head.x + f * 2 * s - 7 * s, head.y - 12 * s);
    g.lineTo(head.x + f * 2 * s + 7 * s, head.y - 12 * s);
    g.lineTo(head.x + 9 * s, head.y + 4 * s);
    g.closePath();
    g.fillPath();

    // Face plate (darker inset)
    g.fillStyle(DARK2, 0.9);
    g.fillRoundedRect(head.x + f * 2 * s - 6 * s, head.y - 6 * s, 12 * s, 9 * s, 2 * s);

    // VISOR SLIT - the signature glowing eye line
    const visorColor = healthRatio < 0.25 ? 0xfb7185 : ACCENT;
    const visorAlpha = 0.7 + 0.3 * Math.sin(this.stepPhase * 2);

    // Outer glow
    g.fillStyle(visorColor, visorAlpha * 0.35);
    g.fillRoundedRect(head.x + f * 3 * s - 7 * s, head.y - 3 * s, 14 * s, 4 * s, 2 * s);

    // Core slit
    g.fillStyle(visorColor, visorAlpha);
    g.fillRect(head.x + f * 3 * s - 5.5 * s, head.y - 2 * s, 11 * s, 2.5 * s);

    // Inner bright spot (represents eye direction)
    g.fillStyle(WHITE, visorAlpha * 0.8);
    g.fillRect(head.x + f * 5 * s - 2 * s, head.y - 1.5 * s, 4 * s, 1.5 * s);
  }

  // --- SHOULDER ARMOR ---
  private drawShoulderArmor(g: Phaser.GameObjects.Graphics, shoulder: Vec2, s: number) {
    // Armored pauldron
    g.fillStyle(DARK, 1);
    g.fillCircle(shoulder.x, shoulder.y, 6 * s);
    g.fillStyle(this.color, 0.9);
    g.fillCircle(shoulder.x, shoulder.y, 4.5 * s);

    // Crystal accent on shoulder
    g.fillStyle(ACCENT, 0.7);
    g.fillCircle(shoulder.x, shoulder.y, 2 * s);
  }

  // --- ARM CANNON: Crystal-tech weapon ---
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

  // --- THICK LIMB: Filled polygon instead of line ---
  private drawThickLimb(
    g: Phaser.GameObjects.Graphics,
    root: Vec2,
    solve: LimbSolve,
    outerW: number,
    innerW: number,
  ) {
    // Dark outline limb
    g.lineStyle(outerW + 2, DARK, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.lineTo(solve.end.x, solve.end.y);
    g.strokePath();

    // Colored limb fill
    g.lineStyle(outerW, this.colorDark, 1);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.lineTo(solve.end.x, solve.end.y);
    g.strokePath();

    // Inner highlight
    g.lineStyle(innerW * 0.5, this.color, 0.5);
    g.beginPath();
    g.moveTo(root.x, root.y);
    g.lineTo(solve.joint.x, solve.joint.y);
    g.strokePath();

    // Joint circle
    g.fillStyle(DARK, 1);
    g.fillCircle(solve.joint.x, solve.joint.y, outerW * 0.45);
    g.fillStyle(this.colorDark, 0.9);
    g.fillCircle(solve.joint.x, solve.joint.y, outerW * 0.3);
  }

  // --- BOOT: Heavy armored feet ---
  private drawBoot(g: Phaser.GameObjects.Graphics, foot: Vec2, s: number) {
    const f = this.facing;
    const bw = 10 * s;
    const bh = 6 * s;

    // Boot sole (dark)
    g.fillStyle(DARK, 1);
    g.fillRoundedRect(foot.x - bw * 0.4 + f * 2 * s, foot.y - bh * 0.3, bw, bh, 2 * s);

    // Boot upper
    g.fillStyle(this.colorDark, 1);
    g.fillRoundedRect(foot.x - bw * 0.35 + f * 2 * s, foot.y - bh, bw * 0.85, bh * 0.8, 2 * s);

    // Boot accent stripe
    g.fillStyle(this.color, 0.6);
    g.fillRect(foot.x - bw * 0.2 + f * 2 * s, foot.y - bh * 0.6, bw * 0.5, 2 * s);
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
