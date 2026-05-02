// Draws 4 L-shaped corner brackets for the ROUNDS-style card frame.
// No asset files — all shapes drawn via Phaser.GameObjects.Graphics.
//
// Usage:
//   const g = drawCardBracket(scene, 0, 0, 220, 300, PALETTE.cardBracket);
//   container.add(g);

import Phaser from "phaser";

export interface CardBracketOpts {
  legLen?: number;
  thickness?: number;
  alpha?: number;
}

/**
 * Draws 4 L-shaped corner brackets centered on (x, y) with the given width
 * and height. Returns a single Graphics object the caller can place in a
 * Container or directly on the scene.
 *
 * @param scene     The Phaser.Scene to create the Graphics in.
 * @param x         Center X of the card (local to the parent container, or world).
 * @param y         Center Y of the card.
 * @param w         Total card width.
 * @param h         Total card height.
 * @param color     Hex color number for the brackets (e.g. PALETTE.cardBracket).
 * @param opts      Optional overrides: legLen (px), thickness (px), alpha.
 */
export function drawCardBracket(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  opts?: CardBracketOpts,
): Phaser.GameObjects.Graphics {
  const legLen = opts?.legLen ?? 14;
  const thickness = opts?.thickness ?? 3;
  const alpha = opts?.alpha ?? 1;

  const g = scene.add.graphics();
  g.setPosition(x, y);
  g.lineStyle(thickness, color, alpha);

  const hw = w / 2;
  const hh = h / 2;

  // Top-left corner: horizontal leg right, vertical leg down
  g.beginPath();
  g.moveTo(-hw + legLen, -hh);
  g.lineTo(-hw, -hh);
  g.lineTo(-hw, -hh + legLen);
  g.strokePath();

  // Top-right corner: horizontal leg left, vertical leg down
  g.beginPath();
  g.moveTo(hw - legLen, -hh);
  g.lineTo(hw, -hh);
  g.lineTo(hw, -hh + legLen);
  g.strokePath();

  // Bottom-left corner: horizontal leg right, vertical leg up
  g.beginPath();
  g.moveTo(-hw + legLen, hh);
  g.lineTo(-hw, hh);
  g.lineTo(-hw, hh - legLen);
  g.strokePath();

  // Bottom-right corner: horizontal leg left, vertical leg up
  g.beginPath();
  g.moveTo(hw - legLen, hh);
  g.lineTo(hw, hh);
  g.lineTo(hw, hh - legLen);
  g.strokePath();

  return g;
}
