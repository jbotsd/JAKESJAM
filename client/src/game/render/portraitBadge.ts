// Shared "who is this" portrait badge.
//
// Was a generic head+shoulders silhouette recolored per player — Jake,
// 2026-07-14: "so low budget", then research-grounded follow-up
// (JAKESJAM_HUD_Research_20260714/hud_research_report.md): every shipped
// competitive HUD researched avoids color-alone-on-a-shared-template for
// identity, because that's structurally identical to a Discord/Gravatar
// placeholder-avatar fallback. Replaced with a deterministic per-player
// SIGIL — a rotated core polygon (3-6 sides), 1-3 radiating spokes from
// seeded vertices, and one accent notch on the ring — generated from a
// hash of the player's own id/name, same shape-grammar discipline Destiny
// 2's ability-icon system uses (small fixed vocabulary, consistent across
// every identity, state shown via animation not shape-swapping) and the
// same principle GitHub/DiceBear identicons use to avoid the grey-man
// fallback (deterministic generated geometry, not a stock shape recolored).
// The bezel is a notched instrument-dial ring (tick marks around the
// circle) instead of a plain stroke, matching the sigil-circle language
// already established in the boot cinematic / audio-gate screen.
//
// One drawing recipe, three call sites: ProceduralPlayerRig's in-world
// nameplate, HudSystem's screen-anchored vitals badge, and HudSystem's
// per-row scoreboard.

import Phaser from "phaser";
import { drawFacetedRing, healthRingColor } from "./facetedRing.js";

export function shadeColor(hex: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + Math.round(amount * 255)));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 0xff) + Math.round(amount * 255)));
  const b = Math.min(255, Math.max(0, (hex & 0xff) + Math.round(amount * 255)));
  return (r << 16) | (g << 8) | b;
}

/** Tiny FNV-1a — deterministic, no crypto needed. Same identity seed always
 *  produces the same sigil, every render, every session. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Draws a portrait badge centered at (cx, cy): dark ring, identity-color
 * disc, notched instrument-dial bezel, and a deterministic per-player
 * sigil glyph (see file header). `accentColor` defaults to a darkened
 * shade of `color` when omitted (the in-world nameplate's own convention)
 * — pass a real accent (e.g. the player's visorColor) for a livelier ring
 * on HUD-scale badges where it reads clearly. `seed` is the player's own
 * id (falls back to their display name at call sites where id isn't
 * threaded through) — every player with a distinct seed gets a visually
 * distinct sigil, not just a distinct color.
 */
export function drawPortraitBadge(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  color: number,
  seed: string,
  colorDark?: number,
  accentColor?: number,
): void {
  const dark = colorDark ?? shadeColor(color, -0.4);
  const accent = accentColor ?? shadeColor(color, -0.4);

  g.fillStyle(dark, 1);
  g.fillCircle(cx, cy, radius + radius * 0.13);
  g.fillStyle(color, 1);
  g.fillCircle(cx, cy, radius);

  // Notched instrument-dial bezel — small tick marks around the ring
  // instead of a plain stroke, same "sigil circle" language as the
  // audio-gate seal / boot cinematic.
  const tickCount = 12;
  g.lineStyle(Math.max(1, radius * 0.05), accent, 0.55);
  for (let i = 0; i < tickCount; i++) {
    const a = (i / tickCount) * Math.PI * 2;
    const inner = radius * 0.88;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    g.strokePath();
  }
  g.lineStyle(Math.max(1, radius * 0.09), accent, 0.9);
  g.strokeCircle(cx, cy, radius * 0.9);

  drawPlayerSigil(g, cx, cy, radius, seed, dark);
}

/** The sigil itself — see file header for the design rationale. Stroke-only
 *  (not filled), so it reads as an etched rune, not a solid icon. */
function drawPlayerSigil(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  seed: string,
  color: number,
): void {
  const hash = hashSeed(seed);
  const sides = 3 + (hash % 4); // triangle .. hexagon
  const rotation = ((hash >>> 6) % 360) * (Math.PI / 180);
  const coreR = radius * 0.48;

  const vertex = (i: number): { x: number; y: number } => {
    const a = rotation + (i / sides) * Math.PI * 2;
    return { x: cx + Math.cos(a) * coreR, y: cy + Math.sin(a) * coreR };
  };

  // Core polygon — the "self" shape, rotated per seed.
  g.lineStyle(Math.max(1, radius * 0.1), color, 0.95);
  g.beginPath();
  const v0 = vertex(0);
  g.moveTo(v0.x, v0.y);
  for (let i = 1; i <= sides; i++) {
    const v = vertex(i % sides);
    g.lineTo(v.x, v.y);
  }
  g.strokePath();

  // Radiating spokes from 1-3 seeded vertices out toward the bezel.
  const rayCount = 1 + ((hash >>> 10) % 3);
  g.lineStyle(Math.max(1, radius * 0.08), color, 0.85);
  for (let i = 0; i < rayCount; i++) {
    const idx = (hash >>> (14 + i * 5)) % sides;
    const a = rotation + (idx / sides) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * coreR * 1.05, cy + Math.sin(a) * coreR * 1.05);
    g.lineTo(cx + Math.cos(a) * radius * 0.82, cy + Math.sin(a) * radius * 0.82);
    g.strokePath();
  }

  // One accent notch on the ring — the single "not from the same family"
  // marker, per the shape-grammar discipline (small fixed vocabulary,
  // not novelty per icon).
  const notchAngle = rotation + ((hash >>> 24) % 360) * (Math.PI / 180);
  const notchR = radius * 0.72;
  g.fillStyle(color, 1);
  g.fillCircle(cx + Math.cos(notchAngle) * notchR, cy + Math.sin(notchAngle) * notchR, radius * 0.09);

  // Center point — the "unity/self" anchor (Destiny's circle-as-core
  // convention), anchors the sigil visually so it doesn't read as loose
  // scattered lines.
  g.fillCircle(cx, cy, radius * 0.1);
}

// ─── Fused health/shield ring ───────────────────────────────────────────────
//
// Jake, 2026-07-14: "make our health shield and nameplate the whole thing" —
// the badge was identity-only; health/shield lived as separate flat bars
// elsewhere on screen. HUD-research finding #5 (Hades' pulse-on-low-health,
// Destiny 2's fill-state-on-glyph): resource state should animate the SAME
// object as identity, not a disconnected bar. This wraps the sigil badge in
// a depleting ring instead — segmented/faceted (crystal-cut), not a smooth
// arc, per the vessel doctrine's "chamfer or crystal cut, not iOS sausage"
// rule and the HUD-chrome asset prompts' faceted timer-ring precedent.
//
// Doctrine constraint (docs/visual-language-gnostic-vessel.md): combat HUD
// stays cyan/HP-lime, "gold almost never in combat HUD" — this ring never
// reaches for the house-gold palette, only the existing HP good/warn/crit
// hues plus the existing shield blue.

// Set clear of the badge's own notched dial bezel (~radius*0.9) so the two
// read as distinct instrument layers instead of one mushy double-ring.
const RING_R_FACTOR = 1.55;
const SHIELD_R_GAP_FACTOR = 0.26;

export type NameplateVitals = {
  /** 0-1 fraction of max health. */
  healthRatio: number;
  /** 0-1 fraction of max shield charge; undefined = no shield ring (character has none). */
  shieldRatio?: number;
  isDead?: boolean;
  /** 0-1 — caller-driven pulse (e.g. a Sine tween) applied only when critical. 1 = no dimming. */
  pulseAlpha?: number;
};

export { healthRingColor };

/**
 * Draws the fused health (+ optional shield) ring around a badge already
 * drawn by `drawPortraitBadge` at the same (cx, cy, radius). Call this
 * AFTER drawPortraitBadge so the ring sits outside the sigil/bezel.
 */
export function drawNameplateRing(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  badgeRadius: number,
  vitals: NameplateVitals,
): void {
  // Bolder + set well clear of the badge's own notched dial bezel (which
  // sits at ~radius*0.9) — the two were nearly touching at the old 1.38
  // factor and mushed into one blurry double-ring; a real gap reads as two
  // distinct instrument layers (identity dial inside, vitals ring outside).
  const thickness = Math.max(2, badgeRadius * 0.24);
  if (vitals.isDead) {
    // Extinguished vessel — one dim grey ring, no facets, no shield.
    g.lineStyle(thickness, 0x2a3550, 0.5);
    g.strokeCircle(cx, cy, badgeRadius * RING_R_FACTOR);
    return;
  }

  const ringR = badgeRadius * RING_R_FACTOR;
  const critical = vitals.healthRatio <= 0.28;
  const pulse = critical ? 0.65 + 0.35 * Phaser.Math.Clamp(vitals.pulseAlpha ?? 1, 0, 1) : 1;
  const color = healthRingColor(vitals.healthRatio);

  drawFacetedRing(g, cx, cy, ringR, thickness, vitals.healthRatio, color, 0.95 * pulse, 0x1f2937, 0.4);

  if (vitals.shieldRatio !== undefined && vitals.shieldRatio > 0) {
    const shieldR = ringR + badgeRadius * SHIELD_R_GAP_FACTOR;
    const shieldThickness = Math.max(1.5, badgeRadius * 0.14);
    drawFacetedRing(g, cx, cy, shieldR, shieldThickness, vitals.shieldRatio, 0x93c5fd, 0.85, 0x1f2937, 0);
  }
}

/** Outer edge of the fused ring (health, or shield when present) — callers
 *  laying out multiple badges use this to size row spacing so rings never
 *  clip into the next row. */
export function nameplateOuterRadius(badgeRadius: number, hasShield: boolean): number {
  const ringR = badgeRadius * RING_R_FACTOR;
  const outer = hasShield ? ringR + badgeRadius * SHIELD_R_GAP_FACTOR : ringR;
  return outer + badgeRadius * 0.14; // half the thickest stroke, as padding
}
