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
 * Tracker that owns a set of beam Polygons + their idle yoyo tweens, and
 * lets the scene re-spawn them safely. Mirrors PlatformLayer's role for
 * the platform Graphics — without it, both MatchScene and OnlineMatchScene
 * had to remember to destroy + cancel-tween the prior beams before
 * re-running renderArena (the same bug class as the platform-doubling
 * regression in commit 0c430b2).
 *
 * Use:
 *   private readonly lightBeams = new LightBeamLayer(this);
 *   ...
 *   if (theme.hasLightBeams) {
 *     this.lightBeams.spawn(beamDefs, height, color, 0.10);
 *   }
 *
 * Auto-cleans on scene SHUTDOWN/DESTROY.
 */
export class LightBeamLayer {
  private beams: Phaser.GameObjects.Polygon[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  /**
   * Re-spawn beams from definitions. Each def is { x, w } — apex centre
   * X and beam width at the bottom. Height + color + alpha are uniform.
   * Each beam gets the standard slow ±2° yoyo rotation tween.
   */
  spawn(
    defs: ReadonlyArray<{ x: number; w: number }>,
    height: number,
    color: number,
    alpha: number,
  ): void {
    this.destroy();
    for (const def of defs) {
      const beam = drawLightBeam(this.scene, def.x, 0, def.w, height, color, alpha);
      beam.setDepth(0.7); // behind vignette (depth 1) — vignette frames the beam edges
      this.scene.tweens.add({
        targets: beam,
        angle: 2,
        duration: 8000,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
      this.beams.push(beam);
    }
  }

  destroy(): void {
    for (const beam of this.beams) {
      this.scene.tweens.killTweensOf(beam);
      beam.destroy();
    }
    this.beams = [];
  }
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
