// Shared faceted-ring primitive — segmented/crystal-cut arcs, not a smooth
// stroke, per the vessel doctrine's "chamfer or crystal cut, not iOS
// sausage" rule and the HUD-chrome asset prompts' faceted timer-ring
// precedent (docs/asset-prompts/02-hud-chrome.md, "Round Timer Ring").
//
// One drawing recipe reused everywhere state depletes/fills: the nameplate
// health/shield ring (portraitBadge.ts) and the bottom-center action bar's
// resource orbs + ability cooldown rings (ActionBarSystem.ts) — "one
// manufactured system," not a different widget style per screen region.

import Phaser from "phaser";

// Segment count tuned for legibility at HUD scale — too many segments at
// small radii read as a fuzzy dashed line, not discrete crystal facets.
export const RING_SEGMENTS = 10;
export const RING_GAP_DEG = 2.2;

export function healthRingColor(ratio: number): number {
  return ratio > 0.55 ? 0xb8f05a : ratio > 0.28 ? 0xfde68a : 0xfb7185;
}

/** Draws one faceted ring as `RING_SEGMENTS` short arcs with hairline gaps
 *  between them, filled clockwise from 12 o'clock up to `ratio`. */
export function drawFacetedRing(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  ringRadius: number,
  thickness: number,
  ratio: number,
  filledColor: number,
  filledAlpha: number,
  emptyColor: number,
  emptyAlpha: number,
): void {
  const segAngle = 360 / RING_SEGMENTS;
  const filledCount = Math.round(Phaser.Math.Clamp(ratio, 0, 1) * RING_SEGMENTS);
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const isFilled = i < filledCount;
    // Skip fully-empty segments entirely once ratio is 0 (an uncharged/on-
    // cooldown state draws nothing rather than a full dim ghost ring).
    if (!isFilled && ratio <= 0) continue;
    const a0 = -90 + i * segAngle + RING_GAP_DEG / 2;
    const a1 = -90 + (i + 1) * segAngle - RING_GAP_DEG / 2;
    g.lineStyle(thickness, isFilled ? filledColor : emptyColor, isFilled ? filledAlpha : emptyAlpha);
    g.beginPath();
    g.arc(cx, cy, ringRadius, Phaser.Math.DegToRad(a0), Phaser.Math.DegToRad(a1), false);
    g.strokePath();
  }
}
