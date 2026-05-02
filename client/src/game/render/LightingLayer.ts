/**
 * LightingLayer — shared helpers for parametric light effects.
 *
 * Intentionally thin: no game state, no scene references kept after the call.
 * Import these helpers from PlatformPainter, ProceduralPlayerRig, MatchScene,
 * DraftScene, and HeroPresenter as needed.
 */

import Phaser from "phaser";

/**
 * Draw a triangle "light beam" polygon, apex at (x, y), fanning down
 * to width `w` over height `h`.  Returns the Polygon added to the scene.
 *
 * The returned object uses additive blend so it brightens whatever sits beneath.
 *
 * @param scene  Active Phaser scene
 * @param x      Apex centre X (usually near top of screen)
 * @param y      Apex Y (0 = very top)
 * @param w      Width of the beam at its widest point (bottom)
 * @param h      Height / length of the beam (usually full screen height)
 * @param color  Fill color (use PALETTE.lightBeamWarm)
 * @param alpha  Fill alpha (plan calls for 0.10)
 */
export function drawLightBeam(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
): Phaser.GameObjects.Polygon {
  // Triangle: apex at top-centre, two base corners at bottom.
  const halfW = w / 2;
  const points = [
    { x: 0, y: 0 },           // apex
    { x: -halfW, y: h },      // bottom-left
    { x: halfW, y: h },       // bottom-right
  ];

  const poly = scene.add.polygon(x, y, points, color, alpha);
  poly.setBlendMode(Phaser.BlendModes.ADD);
  return poly;
}

/**
 * Draw a thin horizontal rim-highlight line on an existing Graphics object.
 * Designed for platform top edges — call inside a RenderTexture draw pass.
 *
 * @param g          The Graphics object to draw on
 * @param x          Left edge X (relative to the graphics origin)
 * @param y          Y coordinate of the line (top of platform)
 * @param w          Width of the line
 * @param color      Line color (use 0xF5F8F8 or PALETTE.textHi)
 * @param alpha      Line alpha (plan calls for 0.22)
 * @param thickness  Line thickness in pixels (default 2)
 */
export function drawRimHighlight(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  color: number,
  alpha: number,
  thickness = 2,
): void {
  g.lineStyle(thickness, color, alpha);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.strokePath();
}
