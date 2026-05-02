/**
 * PlatformPainter — bakes two-tone + brush-streak platform visuals into a
 * RenderTexture once per unique (w × h × theme.hi) combination, then returns
 * an Image placed at (x, y) in world space.
 *
 * Layers (bottom → top):
 *   (a) Drop shadow: offset rect 4px down/right, shade color at alpha 0.55
 *   (b) Main fill: theme.hi
 *   (c) Brush streaks: 4–6 thin rotated rects, theme.wash color, alpha 0.18
 *
 * No stroke. Identical platforms share one RenderTexture (keyed by size+hi).
 */

import Phaser from "phaser";
import type { ArenaTheme } from "../ui/palette";

// Re-export so callers can import ArenaTheme from here as well.
export type { ArenaTheme };

/** Cache: texture key → already registered in this game instance */
const _bakedKeys = new Set<string>();

/** Darken a 24-bit RGB color by the given factor (0–1, where 0 = black). */
function darkenColor(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Paint a platform and return the Image game objects added to the scene.
 *
 * @param scene  Active Phaser.Scene
 * @param x      World-space centre X  (same convention as Phaser.GameObjects.Rectangle)
 * @param y      World-space centre Y
 * @param w      Platform width  (pixels)
 * @param h      Platform height (pixels)
 * @param theme  ArenaTheme providing hi / wash / optional shade colours
 * @returns      Array containing the single Image that was added to the scene
 */
export function paintPlatform(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ArenaTheme,
): Phaser.GameObjects.GameObject[] {
  const shadowPad = 6; // extra texture space for the drop-shadow bleed
  const texW = w + shadowPad;
  const texH = h + shadowPad;

  const shadeColor =
    "shade" in theme && typeof theme.shade === "number"
      ? theme.shade
      : darkenColor(theme.hi, 0.35);

  const textureKey = `platform_${w}x${h}_${theme.hi}`;

  if (!_bakedKeys.has(textureKey)) {
    // Mark as baked before we actually draw so re-entrant calls don't double-bake.
    _bakedKeys.add(textureKey);

    const rt = scene.add.renderTexture(0, 0, texW, texH);

    const g = scene.add.graphics();

    // (a) Drop shadow — offset 4px right / 4px down from origin (0,0)
    g.fillStyle(shadeColor, 0.55);
    g.fillRect(4, 4, w, h);
    rt.draw(g, 0, 0);

    // (b) Main fill
    g.clear();
    g.fillStyle(theme.hi, 1);
    g.fillRect(0, 0, w, h);
    rt.draw(g, 0, 0);

    // (c) Brush streaks — 4–6 thin rotated rects at low alpha
    const streakCount = 5;
    for (let i = 0; i < streakCount; i++) {
      const t = i / (streakCount - 1); // 0 → 1
      // Spread streaks evenly across the platform width, randomised angle
      const cx = w * (0.1 + t * 0.8);
      const cy = h * 0.5;
      const angle = Phaser.Math.DegToRad(-15 + i * 7.5); // −15° … +15°
      const streakW = w * (0.5 + (i % 2) * 0.25); // vary length
      const streakH = Math.max(2, h * 0.18);

      g.clear();
      g.fillStyle(theme.wash, 0.18);
      // Draw the streak as a rotated rectangle by painting into a temp graphics
      // object using a transformation matrix.
      g.save();
      g.translateCanvas(cx, cy);
      g.rotateCanvas(angle);
      g.fillRect(-streakW / 2, -streakH / 2, streakW, streakH);
      g.restore();
      rt.draw(g, 0, 0);
    }

    g.destroy();

    // Save to texture manager so we can create Images from it without
    // keeping the RenderTexture alive in the scene.
    rt.saveTexture(textureKey);
    rt.destroy();
  }

  // The texture top-left is at (x - w/2, y - h/2) in world space.
  // Phaser Images are positioned by their centre; offset by half the shadow pad.
  const img = scene.add.image(
    x + shadowPad / 2,
    y + shadowPad / 2,
    textureKey,
  );
  img.setOrigin(0.5, 0.5);

  return [img];
}
