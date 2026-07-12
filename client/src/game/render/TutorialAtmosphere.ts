// Environmental depth pass — addresses three items from the AAA-quality
// audit at once: (1) NO atmospheric depth — the scene was two flat layers
// (rings behind, platforms in front) with nothing living in between; (2)
// lighting that doesn't touch anything — the bright "sun" backdrop cast no
// light shafts, no shadows, nothing; (3) no contact shadows anywhere, which
// is the single fastest tell of "flat game" vs "a place things stand in."
//
// Three systems, one Graphics layer, cheap:
//   - Parallax dust motes: slow-drifting points at a depth between the
//     ring backdrop and the platforms, giving the empty space something
//     to actually contain instead of reading as dead space.
//   - Light shafts: a few soft wedges radiating from the "sun" position
//     (the bright ring-core, upper-left in the tutorial's camera framing)
//     — cheap, just alpha-gradient triangles, but it's the difference
//     between a light source that's decorative and one that's PHYSICAL.
//   - Contact shadows: a soft dark ellipse under any grounded entity,
//     called per-frame by whoever owns that entity's position.

import Phaser from "phaser";

const SUN_WORLD_X = 900; // roughly under the boot-ident seal's own core, see TutorialVesselShader
const SUN_WORLD_Y = 250;

type DustMote = { x: number; y: number; z: number; phase: number };

export class TutorialAtmosphere {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly shadowG: Phaser.GameObjects.Graphics;
  private readonly motes: DustMote[];
  private t = 0;

  constructor(scene: Phaser.Scene, worldW: number, worldH: number) {
    this.g = scene.add.graphics();
    this.g.setDepth(-50); // above the vessel shader (-500) and Graphics motif, below platforms/rigs
    this.shadowG = scene.add.graphics();
    this.shadowG.setDepth(9); // just below rigs (12) and thralls (12) — shadows sit ON the ground, under feet

    const n = 90;
    this.motes = Array.from({ length: n }, () => ({
      x: Math.random() * worldW,
      y: Math.random() * worldH * 0.85,
      z: 0.3 + Math.random() * 0.7, // parallax depth — lower drifts slower, dimmer (further back)
      phase: Math.random() * Math.PI * 2,
    }));
  }

  update(deltaMs: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    this.t += deltaMs / 1000;
    const g = this.g;
    g.clear();

    // Light shafts from the sun — soft wedges, barely-there, ADD blend so
    // they only brighten, never muddy the dark backdrop.
    g.setBlendMode(Phaser.BlendModes.ADD);
    const shaftN = 3;
    for (let i = 0; i < shaftN; i++) {
      const ang = -1.15 + i * 0.42 + Math.sin(this.t * 0.05 + i) * 0.03;
      const len = 2200;
      const width = 0.09 + i * 0.02;
      const a0 = ang - width;
      const a1 = ang + width;
      const x0 = SUN_WORLD_X + Math.cos(a0) * len;
      const y0 = SUN_WORLD_Y + Math.sin(a0) * len;
      const x1 = SUN_WORLD_X + Math.cos(a1) * len;
      const y1 = SUN_WORLD_Y + Math.sin(a1) * len;
      g.fillStyle(0xfff2d0, 0.025);
      g.beginPath();
      g.moveTo(SUN_WORLD_X, SUN_WORLD_Y);
      g.lineTo(x0, y0);
      g.lineTo(x1, y1);
      g.closePath();
      g.fillPath();
    }

    // Parallax dust — only draw motes near the visible camera window
    // (world is 8000px wide; no point drawing 90 points across all of it
    // every frame when ~15 are ever on screen).
    const viewL = cam.scrollX - 200;
    const viewR = cam.scrollX + cam.width + 200;
    for (const m of this.motes) {
      const drift = Math.sin(this.t * 0.15 * m.z + m.phase) * 40 * m.z;
      const mx = m.x + drift;
      if (mx < viewL || mx > viewR) continue;
      const bob = Math.sin(this.t * 0.3 + m.phase) * 14 * m.z;
      const my = m.y + bob;
      const size = 0.8 + m.z * 1.6;
      g.fillStyle(0xbfe8ff, 0.10 + m.z * 0.14);
      g.fillCircle(mx, my, size);
    }
  }

  /** Soft contact shadow under a grounded entity — the single fastest way
   *  a silhouette reads as standing IN a scene instead of floating over a
   *  flat backdrop. `groundY` is the surface Y; `scale` widens/narrows
   *  with how "grounded" the entity currently is (0 while airborne). */
  drawContactShadow(x: number, groundY: number, halfWidth: number, alpha = 0.4): void {
    this.shadowG.fillStyle(0x000000, alpha);
    this.shadowG.fillEllipse(x, groundY + 2, halfWidth, halfWidth * 0.32);
  }

  beginShadowFrame(): void {
    this.shadowG.clear();
  }

  destroy(): void {
    this.g.destroy();
    this.shadowG.destroy();
  }
}
