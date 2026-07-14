// Shared "who is this" portrait badge — a disc in the player's own identity
// color with a procedural head+shoulders glyph, so it reads as THEIR actual
// equipped color/silhouette rather than a generic avatar. One drawing
// recipe, three call sites: ProceduralPlayerRig's in-world nameplate,
// HudSystem's screen-anchored vitals badge, and HudSystem's per-row
// scoreboard (party-frame layout, Jake 2026-07-14). Extracted here instead
// of copy-pasted three times so a future tweak (e.g. a real Warframe-style
// portrait render) only needs one edit.

export function shadeColor(hex: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + Math.round(amount * 255)));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 0xff) + Math.round(amount * 255)));
  const b = Math.min(255, Math.max(0, (hex & 0xff) + Math.round(amount * 255)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Draws a portrait badge centered at (cx, cy): dark ring, identity-color
 * disc, accent stroke, and a small procedural head+shoulders glyph.
 * `accentColor` defaults to a darkened shade of `color` when omitted (the
 * in-world nameplate's own convention) — pass a real accent (e.g. the
 * player's visorColor) for a livelier ring on HUD-scale badges where it
 * reads clearly.
 */
export function drawPortraitBadge(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  radius: number,
  color: number,
  colorDark?: number,
  accentColor?: number,
): void {
  const dark = colorDark ?? shadeColor(color, -0.4);
  const accent = accentColor ?? shadeColor(color, -0.4);

  g.fillStyle(dark, 1);
  g.fillCircle(cx, cy, radius + radius * 0.13);
  g.fillStyle(color, 1);
  g.fillCircle(cx, cy, radius);
  g.lineStyle(Math.max(1, radius * 0.11), accent, 0.85);
  g.strokeCircle(cx, cy, radius);

  // Glyph — a simplified head+shoulders silhouette in a darkened shade of
  // the badge's own color, cheap enough to redraw every time the badge
  // changes (a handful of primitives, no texture/atlas).
  const glyphColor = shadeColor(color, -0.55);
  g.fillStyle(glyphColor, 0.9);
  g.fillCircle(cx, cy - radius * 0.32, radius * 0.34);
  g.beginPath();
  g.arc(cx, cy + radius * 0.62, radius * 0.62, Math.PI, Math.PI * 2, false);
  g.fillPath();
}
