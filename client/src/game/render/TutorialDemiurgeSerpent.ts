// YELDABAOTH — the Demiurge's manifestation over the showcase finale: a
// crystalline LION-HEADED SERPENT, which is not an invention but the literal
// classical depiction (Apocryphon of John: the chief archon is a
// "lion-faced serpent"; also called Samael, "the blind god"). This is the
// second entry in the game's Big-Crazy-Visual-Deity vocabulary — the seal
// (un-captioned, higher) belongs to the player's side; the serpent is the
// adversary made legible.
//
// Palette discipline (docs/visual-language-gnostic-vessel.md): VIOLET body
// + COPPER/ROSE accents — the doc's explicit danger/void support family.
// Never gold (gold = house/self-generated) and never teal (teal = live
// combat spark). An enemy deity in the player's own colors would be
// symbolic noise.
//
// Pure render-layer: one Graphics object, ADD blend, world-space, depth just
// behind the rigs — a presence over the fight, not a combat entity. The
// actual fight stays the archon + shard waves; this is why the fight
// MATTERS. Classic follow-the-leader snake kinematics: the head wanders a
// slow lissajous around its anchor, a breadcrumb trail records its path,
// and body segments sit at fixed arc-length intervals along that trail so
// the body genuinely SLITHERS through where the head has been.

import Phaser from "phaser";

const VIOLET = 0x8b6cf0;
const VIOLET_DEEP = 0x5b3fae;
const COPPER = 0xd08a5a;
const ROSE_HOT = 0xffd0c0;

const SEGMENTS = 14;
const SEGMENT_SPACING = 34;
const TRAIL_CAP = 400;

export class TutorialDemiurgeSerpent {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly trail: { x: number; y: number }[] = [];
  private headX: number;
  private headY: number;
  private t = Math.random() * 100;
  private stage = 0;
  private alphaMult = 0;
  private banishing = false;
  private readonly anchorX: number;
  private readonly anchorY: number;

  constructor(scene: Phaser.Scene, anchorX: number, anchorY: number) {
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.headX = anchorX;
    this.headY = anchorY;
    this.g = scene.add.graphics();
    this.g.setBlendMode(Phaser.BlendModes.ADD);
    this.g.setDepth(11); // behind the rigs (12), above the backdrop
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  /** Escalation stage 0-3 — 0 is a faint, distant first sighting (a shape
   *  in the far background, unnamed); 1-3 track the finale's seal-collapse
   *  beats as the extraction gets desperate and the manifestation grows
   *  undeniable. */
  setStage(stage: 0 | 1 | 2 | 3): void {
    this.stage = stage;
  }

  /** The burst-out: the manifestation unravels. Fades and stops. */
  banish(): void {
    this.banishing = true;
  }

  update(deltaMs: number, bass: number, scream: number): void {
    const dt = deltaMs / 1000;
    this.t += dt;
    // Fade in on manifest, out on banish. Stage 0 is deliberately faint — a
    // shape glimpsed, not yet a fact.
    const targetAlpha = this.banishing ? 0 : 0.22 + this.stage * 0.16;
    this.alphaMult += (targetAlpha - this.alphaMult) * Math.min(1, dt * (this.banishing ? 2.2 : 0.8));

    // Head wanders a slow compound lissajous around the anchor — never a
    // repeating circle (two incommensurate frequencies per axis).
    const wanderScale = 0.8 + this.stage * 0.25;
    const tx =
      this.anchorX + (Math.cos(this.t * 0.31) * 300 + Math.cos(this.t * 0.127) * 120) * wanderScale;
    const ty =
      this.anchorY + (Math.sin(this.t * 0.23) * 160 + Math.sin(this.t * 0.409) * 60) * wanderScale;
    const ease = Math.min(1, dt * 1.6);
    this.headX += (tx - this.headX) * ease;
    this.headY += (ty - this.headY) * ease;

    // Breadcrumb trail (only when it actually moved — keeps arc-length math sane).
    const lastP = this.trail[0];
    if (!lastP || Math.hypot(this.headX - lastP.x, this.headY - lastP.y) > 3) {
      this.trail.unshift({ x: this.headX, y: this.headY });
      if (this.trail.length > TRAIL_CAP) this.trail.pop();
    }

    this.draw(bass, scream);
  }

  private draw(bass: number, scream: number): void {
    const g = this.g;
    g.clear();
    if (this.alphaMult <= 0.01) return;
    const a = this.alphaMult;
    const stageF = this.stage / 3;

    // Body segments at fixed arc-length spacing along the trail.
    let dist = 0;
    let seg = 1;
    let prev = { x: this.headX, y: this.headY };
    const segPos: { x: number; y: number }[] = [{ x: this.headX, y: this.headY }];
    for (const p of this.trail) {
      dist += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      if (dist >= seg * SEGMENT_SPACING) {
        segPos.push({ x: p.x, y: p.y });
        seg++;
        if (seg > SEGMENTS) break;
      }
    }

    // Draw tail → head so the head overlaps the body.
    for (let i = segPos.length - 1; i >= 1; i--) {
      const p = segPos[i]!;
      const f = 1 - i / SEGMENTS; // 1 at head, 0 at tail
      const size = (10 + f * 22) * (0.8 + stageF * 0.35) * (1 + bass * 0.15);
      const rot = this.t * 0.7 + i * 0.5;
      this.facetedDiamond(g, p.x, p.y, size, rot, VIOLET, VIOLET_DEEP, a * (0.35 + f * 0.4));
    }

    // Lion head: central diamond + radiating mane of crystal shards.
    const head = segPos[0]!;
    const headSize = 30 * (0.85 + stageF * 0.4) * (1 + bass * 0.12);
    const maneN = 10;
    for (let i = 0; i < maneN; i++) {
      const ang = (i / maneN) * Math.PI * 2 + this.t * 0.25;
      const flare = 1 + bass * 0.5 + scream * scream * 0.8;
      const inner = headSize * 1.05;
      const outer = headSize * (1.7 + 0.35 * Math.sin(this.t * 1.3 + i * 2.1)) * flare;
      const w = 0.16; // shard half-width (radians)
      g.fillStyle(COPPER, a * 0.5);
      g.beginPath();
      g.moveTo(head.x + Math.cos(ang - w) * inner, head.y + Math.sin(ang - w) * inner);
      g.lineTo(head.x + Math.cos(ang) * outer, head.y + Math.sin(ang) * outer);
      g.lineTo(head.x + Math.cos(ang + w) * inner, head.y + Math.sin(ang + w) * inner);
      g.closePath();
      g.fillPath();
    }
    this.facetedDiamond(g, head.x, head.y, headSize, this.t * 0.3, COPPER, VIOLET_DEEP, a * 0.85);

    // Eyes — two hot rose points, tracking loosely ahead of travel.
    const look = this.trail.length > 4 ? this.trail[4]! : head;
    const la = Math.atan2(head.y - look.y, head.x - look.x);
    const eyeSep = headSize * 0.34;
    const ex = head.x + Math.cos(la) * headSize * 0.3;
    const ey = head.y + Math.sin(la) * headSize * 0.3;
    g.fillStyle(ROSE_HOT, Math.min(1, a * 1.4));
    g.fillCircle(ex + Math.cos(la + Math.PI / 2) * eyeSep, ey + Math.sin(la + Math.PI / 2) * eyeSep, 4 + stageF * 2);
    g.fillCircle(ex + Math.cos(la - Math.PI / 2) * eyeSep, ey + Math.sin(la - Math.PI / 2) * eyeSep, 4 + stageF * 2);
  }

  /** A rotated faceted diamond — crystal segment: filled core + brighter
   *  outline + a small inner facet line so it reads cut, not blobbed. */
  private facetedDiamond(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    rot: number,
    edge: number,
    fill: number,
    alpha: number,
  ): void {
    const pts: [number, number][] = [0, 1, 2, 3].map((k) => {
      const angDiamond = rot + (k / 4) * Math.PI * 2;
      const r = k % 2 === 0 ? size : size * 0.72;
      return [x + Math.cos(angDiamond) * r, y + Math.sin(angDiamond) * r];
    }) as [number, number][];
    g.fillStyle(fill, alpha * 0.55);
    g.beginPath();
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let k = 1; k < 4; k++) g.lineTo(pts[k]![0], pts[k]![1]);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, edge, alpha);
    g.strokePath();
    g.lineStyle(1, edge, alpha * 0.6);
    g.lineBetween(pts[0]![0], pts[0]![1], pts[2]![0], pts[2]![1]);
  }

  destroy(): void {
    this.g.destroy();
  }
}
