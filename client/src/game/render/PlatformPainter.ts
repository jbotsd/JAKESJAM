/**
 * PlatformPainter — paints two-tone + brush-streak platform visuals
 * directly into a single Graphics object per platform. Phaser 4 compatible
 * (the previous RenderTexture-saveTexture-destroy-recreate-Image flow was
 * Phaser 3 idiom and silently produced empty textures in Phaser 4.1.0
 * — confirmed via Playwright pixel probe showing 63 paintPlatform calls
 * with 0 platform-color pixels on screen).
 *
 * Layers (bottom → top):
 *   (a) Drop shadow: offset rect 4px down/right, shade color at alpha 0.55
 *   (b) Main fill: theme.hi
 *   (c) Top-edge rim highlight (2px white)
 *   (d) Brush streaks pass 1: 5 thin rotated rects, theme.wash, alpha 0.32
 *   (e) Brush streaks pass 2: 3 perpendicular cross-hatch streaks, alpha 0.12
 *
 * Per-platform deterministic seed so brushwork is stable across renders
 * (matters for test-determinism and for the player's mental map of the arena).
 */

import Phaser from "phaser";
import type { ArenaTheme } from "../ui/palette";
import { drawRimHighlight } from "./LightingLayer";

// Re-export so callers can import ArenaTheme from here as well.
export type { ArenaTheme };

/** Darken a 24-bit RGB color by the given factor (0–1, where 0 = black). */
function darkenColor(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Paint a platform directly into a Graphics object added to the scene.
 *
 * @param scene  Active Phaser.Scene
 * @param x      World-space centre X
 * @param y      World-space centre Y
 * @param w      Platform width  (pixels)
 * @param h      Platform height (pixels)
 * @param theme  ArenaTheme providing hi / wash / optional shade colours
 * @returns      Array containing the single Graphics that was added to the scene
 */
export function paintPlatform(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ArenaTheme,
): Phaser.GameObjects.GameObject[] {
  const shadeColor =
    "shade" in theme && typeof theme.shade === "number"
      ? theme.shade
      : darkenColor(theme.hi, 0.35);

  // Per-platform deterministic seed so brushwork is stable per location.
  const seed = ((x | 0) * 73) ^ ((y | 0) * 131);
  let rng = seed;
  const nextRng = (): number => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    return (rng >>> 0) / 0xffffffff;
  };

  const g = scene.add.graphics();
  // World-position the Graphics so all subsequent draws can be in
  // platform-local coordinates with origin at the platform top-left.
  const halfW = w / 2;
  const halfH = h / 2;
  g.setPosition(x - halfW, y - halfH);

  // (a) Drop shadow — 4px down/right.
  // Shadow draws OUTSIDE the platform rect by design; deliberately not
  // masked. Drawn on a separate (non-masked) Graphics instance.
  const shadowG = scene.add.graphics();
  shadowG.setPosition(x - halfW, y - halfH);
  shadowG.fillStyle(shadeColor, 0.55);
  shadowG.fillRect(4, 4, w, h);
  // Shadow goes BEHIND the main platform fill in render order.
  shadowG.setDepth(-0.1);

  // (b) Main fill.
  g.fillStyle(theme.hi, 1);
  g.fillRect(0, 0, w, h);

  // (c) Top-edge rim highlight (drawn at y = 0, offset to platform-local).
  drawRimHighlight(g, 0, 0, w, 0xf5f8f8, 0.22);

  // (d) Brush streaks pass 1 — 5 thin rotated rects, alpha 0.32.
  const streakCount = 5;
  const baseAngles: number[] = [];
  for (let i = 0; i < streakCount; i++) {
    const t = i / (streakCount - 1);
    const cx = w * (0.1 + t * 0.8);
    const cy = h * 0.5;
    const angleDeg = -45 + nextRng() * 120;
    const angle = Phaser.Math.DegToRad(angleDeg);
    baseAngles.push(angle);
    const streakW = w * (0.5 + (i % 2) * 0.25);
    const streakH = Math.max(2, h * 0.18);

    g.fillStyle(theme.wash, 0.32);
    g.save();
    g.translateCanvas(cx, cy);
    g.rotateCanvas(angle);
    g.fillRect(-streakW / 2, -streakH / 2, streakW, streakH);
    g.restore();
  }

  // (e) Brush streaks pass 2 — 3 cross-hatch streaks perpendicular to pass 1.
  const crossCount = 3;
  for (let i = 0; i < crossCount; i++) {
    const cx = w * (0.15 + (i / Math.max(1, crossCount - 1)) * 0.7);
    const cy = h * 0.5;
    const baseAngle = baseAngles[Math.floor(i * (streakCount / crossCount))] ?? 0;
    const angle = baseAngle + Math.PI / 2;
    const streakW = w * (0.4 + (i % 2) * 0.2);
    const streakH = Math.max(2, h * 0.14);

    g.fillStyle(theme.wash, 0.12);
    g.save();
    g.translateCanvas(cx, cy);
    g.rotateCanvas(angle);
    g.fillRect(-streakW / 2, -streakH / 2, streakW, streakH);
    g.restore();
  }

  // Clip streaks + rim to the platform rect — the previous RenderTexture
  // pattern clipped implicitly via texture bounds; the direct Graphics
  // rewrite needs an explicit GeometryMask to avoid streaks extending
  // diagonally across the whole arena.
  //
  // CRITICAL: maskShape is returned in the array so PlatformLayer.repaint
  // destroys it on the next repaint. Without this, every renderArena call
  // (each reconnect / map change) leaves an orphan undisplayed Graphics
  // backing a stale GeometryMask in scene memory — and worse, when the
  // mask source is destroyed implicitly (e.g. on scene shutdown) without
  // detaching from g, Phaser falls back to NOT applying the stencil pass
  // and the rotated brush streaks render unclipped, extending diagonally
  // across the whole arena. Source of the cyan-line accumulation bug seen
  // in world-fire artifacts.
  const maskShape = scene.make.graphics({ x: 0, y: 0 }, false);
  maskShape.fillStyle(0xffffff, 1);
  maskShape.fillRect(x - halfW, y - halfH, w, h);
  g.setMask(maskShape.createGeometryMask());

  return [g, shadowG, maskShape];
}

/**
 * Tracker that owns a set of platform Graphics and lets the scene
 * repaint them safely. Without this, both MatchScene and
 * OnlineMatchScene had to keep their own `platformGraphics: GameObject[]`
 * field and remember to clear-and-destroy at the top of every renderArena
 * pass — bug 0c430b2 was the regression that hit when a re-fired
 * onHello produced doubled platforms because someone forgot the destroy.
 *
 * Use:
 *   private readonly platforms = new PlatformLayer(this);
 *   ...
 *   this.platforms.repaint(map.platforms, theme);  // safe across resyncs
 *
 * destroy() runs automatically on scene shutdown via Phaser's event so
 * callers don't need to wire it explicitly.
 */
export class PlatformLayer {
  private graphics: Phaser.GameObjects.GameObject[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  repaint(
    platforms: ReadonlyArray<{ position: { x: number; y: number }; size: { x: number; y: number } }>,
    theme: ArenaTheme,
  ): void {
    for (const obj of this.graphics) obj.destroy();
    this.graphics = [];
    for (const p of platforms) {
      const objs = paintPlatform(this.scene, p.position.x, p.position.y, p.size.x, p.size.y, theme);
      for (const o of objs) this.graphics.push(o);
    }
  }

  destroy(): void {
    for (const obj of this.graphics) obj.destroy();
    this.graphics = [];
  }
}