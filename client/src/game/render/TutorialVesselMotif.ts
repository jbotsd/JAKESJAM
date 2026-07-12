// The Pretennoia tutorial's cosmic backdrop — a MUCH larger, richer version
// of the game's own seal geometry (see client/src/shell/identShader.ts:
// monad + Hebdomad rings + inscribed triangle) than CosmicArenaLayer's
// combat-tuned, deliberately-restrained backdrop. This is a solo scene with
// no shared-GPU-budget concerns and an explicit ask to go loud on it — heavy
// layered Graphics overdraw with ADD blend, continuous rotation/breathing,
// and a structural "openness" arc that expands/contracts across the song's
// own zones (tight and dim in Silence, fully unfurled at The Vessel
// Answers) ON TOP of live music-reactive pulsing — the vessel visibly
// opening and closing to the track, not a static painted backdrop.
//
// World-space anchored at the arena's center (not screen-space) so it reads
// as one vast structure the player travels around and through, the same way
// CosmicArenaLayer anchors to the map center — just far bigger and busier.

import Phaser from "phaser";

const GOLD = 0xc9a84c;
const GOLD_HOT = 0xffedb0;
const TEAL = 0x50e3c2;
const TEAL_HOT = 0xd8fff6;

const RING_COUNT = 9;
const SPOKE_COUNT = 16;

export class TutorialVesselMotif {
  private readonly ringsG: Phaser.GameObjects.Graphics;
  private readonly spokesG: Phaser.GameObjects.Graphics;
  private readonly triangleG: Phaser.GameObjects.Graphics;
  private readonly haloG: Phaser.GameObjects.Graphics;
  private cx = 0;
  private cy = 0;
  private baseRadius = 3200;
  private t = 0;
  /** Structural open/close arc — 0 = collapsed/dim (Silence), 1 = fully
   *  unfurled (The Vessel Answers). Driven by SongDirector zone cues, NOT
   *  live audio — this is the slow narrative breath across the whole song,
   *  distinct from the fast per-beat pulse below. */
  private openness = 0.08;
  private targetOpenness = 0.08;

  constructor(scene: Phaser.Scene, worldCenterX: number, worldCenterY: number) {
    this.cx = worldCenterX;
    this.cy = worldCenterY;
    this.haloG = scene.add.graphics();
    this.ringsG = scene.add.graphics();
    this.triangleG = scene.add.graphics();
    this.spokesG = scene.add.graphics();
    for (const g of [this.haloG, this.ringsG, this.spokesG, this.triangleG]) {
      g.setBlendMode(Phaser.BlendModes.ADD);
      g.setDepth(12); // behind terrain/platforms, well behind rigs
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  /** Structural arc target — call from SongDirector zone cues. Eases toward
   *  this over several seconds rather than snapping, so the "opening" reads
   *  as a real unfurl, not a cut. */
  setOpenness(target: number): void {
    this.targetOpenness = Phaser.Math.Clamp(target, 0, 1);
  }

  /** Per-frame: deltaMs for animation, live bass/lead/scream bands (0-1,
   *  same shape as the boot-ident's SonicField reads) for the fast pulse
   *  layered on top of the slow structural openness. */
  update(deltaMs: number, bass: number, lead: number, scream: number): void {
    const dt = deltaMs / 1000;
    this.t += dt;
    this.openness += (this.targetOpenness - this.openness) * Math.min(1, dt * 0.6);

    const pulse = bass * 0.28 + lead * 0.12;
    const radius = this.baseRadius * (0.35 + this.openness * 0.75) * (1 + pulse * 0.06);
    // Halved from the first pass: the real GLSL shader (TutorialVesselShader)
    // now carries most of the "wow" and this Graphics layer double-stacked
    // on top of it, washing the actual seal geometry into an undifferentiated
    // blown-out fog — "GREAT but too much to see." This layer's job now is
    // texture/depth UNDER the shader, not a second full-strength copy.
    const alphaBase = 0.08 + this.openness * 0.24 + scream * scream * 0.14;

    // Slow rotation, direction/speed shift a little with lead energy so it
    // never reads as a fixed-speed loop.
    const rot = this.t * (0.02 + lead * 0.015);

    this.haloG.clear();
    this.ringsG.clear();
    this.spokesG.clear();
    this.triangleG.clear();

    // Outer halo wash — the "vast" read at a glance even from far away.
    this.haloG.fillStyle(GOLD, 0.02 + this.openness * 0.025 + bass * 0.01);
    this.haloG.fillCircle(this.cx, this.cy, radius * 1.35);
    this.haloG.fillStyle(TEAL, 0.01 + this.openness * 0.015);
    this.haloG.fillCircle(this.cx, this.cy, radius * 0.9);

    // Hebdomad rings — 9 concentric rings, each with its own slight radius
    // breathing offset and a molten highlight arc riding the lead band, so
    // no two rings pulse in lockstep (turbulence reads as alive, not looped).
    for (let i = 0; i < RING_COUNT; i++) {
      const f = i / (RING_COUNT - 1);
      const r = radius * (0.16 + f * 0.84) * (1 + Math.sin(this.t * (0.6 + i * 0.09) + i) * 0.015 * (1 + pulse));
      const width = 3 + this.openness * 5 + (i === RING_COUNT - 1 ? 6 : 0) + scream * 4;
      const a = alphaBase * (0.55 + 0.45 * Math.sin(this.t * 0.3 + i * 1.7) * 0.5 + 0.5);
      this.ringsG.lineStyle(width, i % 3 === 0 ? TEAL : GOLD, Math.min(0.9, a));
      this.ringsG.strokeCircle(this.cx, this.cy, r);
      // Molten highlight: a bright arc segment orbiting this ring.
      const hiAngle = this.t * (0.4 + i * 0.11) + i * 2.1;
      const hx = this.cx + Math.cos(hiAngle) * r;
      const hy = this.cy + Math.sin(hiAngle) * r;
      this.ringsG.fillStyle(i % 3 === 0 ? TEAL_HOT : GOLD_HOT, Math.min(1, a * 1.6));
      this.ringsG.fillCircle(hx, hy, width * 1.8 + lead * 10);
    }

    // Radiating spokes — a starburst of struts from the monad outward,
    // count/brightness scaling with openness so the fully-unfurled vessel
    // reads as a genuine burst, not just bigger circles.
    const activeSpokes = Math.round(4 + this.openness * (SPOKE_COUNT - 4));
    for (let i = 0; i < activeSpokes; i++) {
      const angle = (i / activeSpokes) * Math.PI * 2 + rot;
      const innerR = radius * 0.14;
      const outerR = radius * (0.55 + this.openness * 0.5) * (1 + pulse * 0.1);
      const x0 = this.cx + Math.cos(angle) * innerR;
      const y0 = this.cy + Math.sin(angle) * innerR;
      const x1 = this.cx + Math.cos(angle) * outerR;
      const y1 = this.cy + Math.sin(angle) * outerR;
      this.spokesG.lineStyle(2 + this.openness * 2, GOLD, alphaBase * 0.5);
      this.spokesG.lineBetween(x0, y0, x1, y1);
    }

    // The great inscribed triangle — rotates slowly opposite the rings,
    // scales with openness, teal to distinguish it from the gold ring
    // family exactly like the boot-ident's own Barbelo triangle.
    const triR = radius * (0.62 + this.openness * 0.3);
    const triRot = -this.t * 0.045;
    const verts: [number, number][] = [0, 1, 2].map((k) => {
      const a = triRot + (k / 3) * Math.PI * 2 - Math.PI / 2;
      return [this.cx + Math.cos(a) * triR, this.cy + Math.sin(a) * triR];
    }) as [number, number][];
    this.triangleG.lineStyle(4 + this.openness * 6 + scream * 6, TEAL, Math.min(0.95, alphaBase * 1.3));
    this.triangleG.beginPath();
    this.triangleG.moveTo(verts[0]![0], verts[0]![1]);
    this.triangleG.lineTo(verts[1]![0], verts[1]![1]);
    this.triangleG.lineTo(verts[2]![0], verts[2]![1]);
    this.triangleG.closePath();
    this.triangleG.strokePath();
    // Bright vertex nodes — the "compass points" of the construction.
    for (const [vx, vy] of verts) {
      this.triangleG.fillStyle(TEAL_HOT, Math.min(1, alphaBase * 1.5));
      this.triangleG.fillCircle(vx, vy, 6 + this.openness * 8 + scream * 10);
    }

    // Monad core — hot white-gold center, breathing hardest with bass (the
    // kick), always present regardless of openness (the seed never leaves).
    const coreR = 22 + this.openness * 30 + bass * 26;
    this.haloG.fillStyle(GOLD_HOT, Math.min(1, 0.5 + bass * 0.5));
    this.haloG.fillCircle(this.cx, this.cy, coreR);
    this.haloG.fillStyle(GOLD_HOT, 0.25 + bass * 0.2);
    this.haloG.fillCircle(this.cx, this.cy, coreR * 2.4);
  }

  destroy(): void {
    this.haloG.destroy();
    this.ringsG.destroy();
    this.triangleG.destroy();
    this.spokesG.destroy();
  }
}
