import Phaser from "phaser";
import type { Vec2 } from "../types/game";

/**
 * Wizard Overlay - Cyberpunk sorcerer visual layer drawn on top of ProceduralPlayerRig.
 *
 * Transforms stick figures into techno-mages with:
 * - Hooded sci-fi visor (glowing eye-line slit)
 * - Upper-arm energy bands (pulse when firing)
 * - Palm-projector glow (replaces muzzle dot)
 * - Crystal shoulder/ankle hex stubs
 * - Spine energy filaments (health indicator)
 *
 * All parts are drawn in a single Graphics pass after the rig.
 * Performance budget: <0.16ms per player.
 */

// --- Colour helpers ---

/** Adjust luminance of an RGB hex by delta [-1, 1]. */
export function tintShade(baseHex: number, deltaLuminance: number): number {
  const r = (baseHex >> 16) & 0xff;
  const g = (baseHex >> 8) & 0xff;
  const b = baseHex & 0xff;
  const adjust = Math.round(deltaLuminance * 255);
  return (
    (Math.min(255, Math.max(0, r + adjust)) << 16) |
    (Math.min(255, Math.max(0, g + adjust)) << 8) |
    Math.min(255, Math.max(0, b + adjust))
  );
}

/** Blend a colour toward white by amount [0, 1]. */
function brighten(hex: number, amount: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (
    (Math.round(r + (255 - r) * amount) << 16) |
    (Math.round(g + (255 - g) * amount) << 8) |
    Math.round(b + (255 - b) * amount)
  );
}

// --- Accent colour (theme primary) ---
const DEFAULT_ACCENT = 0x8ff8ff; // Crystal Cyan

// --- Draw functions ---

export type WizardOverlayContext = {
  g: Phaser.GameObjects.Graphics;
  head: Vec2;
  chest: Vec2;
  pelvis: Vec2;
  shoulderLead: Vec2;
  handLead: Vec2;
  muzzle: Vec2;
  leftFoot: Vec2;
  rightFoot: Vec2;
  facing: number;
  scale: number;
  playerColor: number;
  accentColor?: number;
  healthRatio?: number;
  isFiring?: boolean;
  elapsedMs?: number;
};

/**
 * Draw the full wizard overlay in one pass.
 * Call this AFTER the base rig is drawn, BEFORE the nameplate.
 */
export function drawWizardOverlay(ctx: WizardOverlayContext): void {
  const { g, head, chest, pelvis, shoulderLead, handLead, muzzle, leftFoot, rightFoot, facing, scale: s, playerColor } = ctx;
  const accent = ctx.accentColor ?? DEFAULT_ACCENT;
  const healthRatio = ctx.healthRatio ?? 1;
  const elapsed = ctx.elapsedMs ?? 0;
  const isFiring = ctx.isFiring ?? false;

  // 1. Spine energy filaments
  drawSpineFilaments(g, pelvis, chest, s, accent, healthRatio);

  // 2. Crystal ankle stubs
  drawCrystalHex(g, { x: leftFoot.x, y: leftFoot.y - 3 * s }, s * 0.7, playerColor);
  drawCrystalHex(g, { x: rightFoot.x, y: rightFoot.y - 3 * s }, s * 0.7, playerColor);

  // 3. Crystal shoulder stub
  drawCrystalHex(g, shoulderLead, s * 0.8, playerColor);

  // 4. Upper-arm energy band (lead arm only for perf)
  const armMid = vec(
    (shoulderLead.x + handLead.x) * 0.5,
    (shoulderLead.y + handLead.y) * 0.5,
  );
  const pulseRate = isFiring ? 2 : 0.5;
  const pulseAlpha = 0.5 + 0.4 * Math.sin(elapsed * pulseRate * 0.006);
  drawArmBand(g, armMid, s, accent, pulseAlpha);

  // 5. Palm-projector glow (replaces muzzle dot)
  const firePulse = isFiring ? 1.4 : 1.0;
  drawPalmProjector(g, muzzle, s, accent, firePulse);

  // 6. Hooded visor (replaces face)
  drawHood(g, head, facing, s, playerColor);
  drawVisorSlit(g, head, facing, s, accent);
}

// --- Individual draw helpers ---

function drawHood(
  g: Phaser.GameObjects.Graphics,
  head: Vec2,
  facing: number,
  scale: number,
  playerColor: number,
): void {
  const s = scale;
  const hoodColor = tintShade(playerColor, -90);
  const hoodStroke = tintShade(playerColor, -140);

  // Trapezoid hood shape
  const topW = 8 * s;
  const botW = 14 * s;
  const height = 14 * s;
  const offsetX = facing * 2 * s;
  const topY = head.y - 10 * s;

  g.fillStyle(hoodColor, 0.85);
  g.beginPath();
  g.moveTo(head.x + offsetX - topW / 2, topY);
  g.lineTo(head.x + offsetX + topW / 2, topY);
  g.lineTo(head.x + offsetX + botW / 2, topY + height);
  g.lineTo(head.x + offsetX - botW / 2, topY + height);
  g.closePath();
  g.fillPath();

  g.lineStyle(1 * s, hoodStroke, 0.6);
  g.beginPath();
  g.moveTo(head.x + offsetX - topW / 2, topY);
  g.lineTo(head.x + offsetX + topW / 2, topY);
  g.lineTo(head.x + offsetX + botW / 2, topY + height);
  g.lineTo(head.x + offsetX - botW / 2, topY + height);
  g.closePath();
  g.strokePath();
}

function drawVisorSlit(
  g: Phaser.GameObjects.Graphics,
  head: Vec2,
  facing: number,
  scale: number,
  accent: number,
): void {
  const s = scale;
  const slitW = 9 * s;
  const slitH = 2 * s;
  const slitX = head.x + facing * 2 * s - slitW / 2;
  const slitY = head.y - 2 * s;

  // Glow halo (additive feel)
  g.fillStyle(accent, 0.3);
  g.fillRect(slitX - 2 * s, slitY - 1 * s, slitW + 4 * s, slitH + 2 * s);

  // Slit core
  g.fillStyle(accent, 0.95);
  g.fillRect(slitX, slitY, slitW, slitH);
}

function drawArmBand(
  g: Phaser.GameObjects.Graphics,
  midpoint: Vec2,
  scale: number,
  accent: number,
  pulseAlpha: number,
): void {
  const s = scale;
  g.lineStyle(2 * s, accent, pulseAlpha);
  g.strokeCircle(midpoint.x, midpoint.y, 4 * s);
}

function drawPalmProjector(
  g: Phaser.GameObjects.Graphics,
  muzzle: Vec2,
  scale: number,
  accent: number,
  firePulse: number,
): void {
  const s = scale;
  const radius = 4 * s * firePulse;

  // Outer halo
  g.fillStyle(accent, 0.25);
  g.fillCircle(muzzle.x, muzzle.y, radius * 2);

  // Core disc
  g.fillStyle(accent, 0.9);
  g.fillCircle(muzzle.x, muzzle.y, radius);

  // Bright centre
  g.fillStyle(brighten(accent, 0.5), 0.7);
  g.fillCircle(muzzle.x, muzzle.y, radius * 0.4);
}

function drawCrystalHex(
  g: Phaser.GameObjects.Graphics,
  center: Vec2,
  scale: number,
  baseColor: number,
): void {
  const s = scale;
  const r = 3.5 * s;
  const color = brighten(baseColor, 0.15);

  // Draw hexagon
  g.fillStyle(color, 0.7);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = center.x + Math.cos(angle) * r;
    const y = center.y + Math.sin(angle) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillPath();

  // Upper highlight
  g.lineStyle(1, 0xffffff, 0.4);
  g.beginPath();
  const a0 = -Math.PI / 2;
  const a1 = -Math.PI / 2 + Math.PI / 3;
  g.moveTo(center.x + Math.cos(a0) * r, center.y + Math.sin(a0) * r);
  g.lineTo(center.x + Math.cos(a1) * r, center.y + Math.sin(a1) * r);
  g.strokePath();

  // Lower shadow
  g.lineStyle(1, 0x000000, 0.4);
  g.beginPath();
  const a3 = -Math.PI / 2 + Math.PI;
  const a4 = -Math.PI / 2 + Math.PI + Math.PI / 3;
  g.moveTo(center.x + Math.cos(a3) * r, center.y + Math.sin(a3) * r);
  g.lineTo(center.x + Math.cos(a4) * r, center.y + Math.sin(a4) * r);
  g.strokePath();
}

function drawSpineFilaments(
  g: Phaser.GameObjects.Graphics,
  pelvis: Vec2,
  chest: Vec2,
  scale: number,
  accent: number,
  healthRatio: number,
): void {
  const s = scale;
  const alpha = 0.3 + 0.5 * healthRatio;
  const color = healthRatio < 0.25 ? 0xfb7185 : accent; // Red when critical

  // Perpendicular offset to spine
  const dx = chest.x - pelvis.x;
  const dy = chest.y - pelvis.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 1.5 * s;
  const py = (dx / len) * 1.5 * s;

  g.lineStyle(1, color, alpha);
  // Left filament
  g.beginPath();
  g.moveTo(pelvis.x + px, pelvis.y + py);
  g.lineTo(chest.x + px, chest.y + py);
  g.strokePath();
  // Right filament
  g.beginPath();
  g.moveTo(pelvis.x - px, pelvis.y - py);
  g.lineTo(chest.x - px, chest.y - py);
  g.strokePath();
}

// --- Utility ---

function vec(x: number, y: number): Vec2 {
  return { x, y };
}
