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
