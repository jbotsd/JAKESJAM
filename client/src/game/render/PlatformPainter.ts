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

  // (b) Main fill — hull plate.
  g.fillStyle(theme.hi, 1);
  g.fillRect(0, 0, w, h);

  // (c) Top-edge rim — gold instrument rule when vesselChrome, else soft white.
  const rimColor =
    theme.vesselChrome && typeof theme.gold === "number" ? theme.gold : 0xf5f8f8;
  drawRimHighlight(g, 0, 0, w, rimColor, theme.vesselChrome ? 0.55 : 0.22);

  // Vessel seal: thin gold under-rim + cyan conduit ticks (sci-fi gnostic).
  if (theme.vesselChrome && w >= 28 && h >= 10) {
    const gold = typeof theme.gold === "number" ? theme.gold : 0xc9a84c;
    g.fillStyle(gold, 0.28);
    g.fillRect(1, Math.max(1, h - 2), w - 2, 1.5);
    // Conduit filament ticks along the plate.
    const tickN = Math.max(2, Math.min(12, Math.floor(w / 48)));
    for (let i = 0; i < tickN; i++) {
      const tx = (w * (i + 0.5)) / tickN;
      const th = Math.max(3, h * 0.45);
      g.fillStyle(theme.wash, 0.22 + nextRng() * 0.18);
      g.fillRect(tx - 0.75, h * 0.2, 1.5, th);
    }
    // Corner brackets (instrument panel language).
    const br = Math.min(6, w * 0.08, h * 0.35);
    g.fillStyle(gold, 0.4);
    g.fillRect(0, 0, br, 1.5);
    g.fillRect(0, 0, 1.5, br);
    g.fillRect(w - br, 0, br, 1.5);
    g.fillRect(w - 1.5, 0, 1.5, br);
  }

  // (d, e) Hull streaks — axis-aligned only (Phaser 4 GeometryMask quirk).
  const streakCount = theme.vesselChrome ? 11 : 9;
  for (let i = 0; i < streakCount; i++) {
    const t = i / Math.max(1, streakCount - 1);
    const sx = w * 0.04 + t * w * 0.6 + (nextRng() - 0.5) * w * 0.08;
    const sw = Math.max(3, Math.min(w * 0.32, w - sx - w * 0.04));
    const sh = Math.max(1.5, h * (0.05 + nextRng() * 0.12));
    const sy = nextRng() * (h - sh);
    const alpha = 0.14 + nextRng() * 0.22;
    g.fillStyle(theme.wash, alpha);
    g.fillRect(
      Math.max(0, sx),
      Math.max(0, Math.min(h - sh, sy)),
      sw,
      sh,
    );
  }
  const dabCount = theme.vesselChrome ? 7 : 5;
  for (let i = 0; i < dabCount; i++) {
    const sx = w * (0.1 + nextRng() * 0.8);
    const sw = Math.max(2, w * (0.04 + nextRng() * 0.06));
    const sh = Math.max(1.5, h * (0.04 + nextRng() * 0.08));
    const sy = nextRng() * (h - sh);
    g.fillStyle(theme.wash, 0.08 + nextRng() * 0.12);
    g.fillRect(
      Math.max(0, Math.min(w - sw, sx)),
      Math.max(0, Math.min(h - sh, sy)),
      sw,
      sh,
    );
  }

  return [g, shadowG];
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