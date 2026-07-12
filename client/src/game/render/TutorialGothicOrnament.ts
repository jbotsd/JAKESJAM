// A second, sparing decorative pass over the tutorial's own terrain —
// gothic architectural motifs (the pointed/ogive arch, rib-tracery fans,
// spire finials) rendered in the SAME crystal/gold-hairline vocabulary the
// rest of the showcase already speaks, not imported cathedral stonework.
// This is NOT a PlatformPainter rewrite (that file is shared game-wide —
// see task tracker note on why it's off-limits for a tutorial-only pass):
// everything here is a separate Graphics layer drawn ONCE, on top of the
// existing platform silhouettes and terrain edge-light, additive only.
//
// The design idea, concretely: this arena reads as "the inside of the
// seal" (TutorialVesselShader's own docblock) — a vessel built by the
// same Demiurge whose crystalline thrall race (TutorialShardThrall) is
// spawned FROM it. Giving the architecture pointed-arch niches and small
// thorn-finials at its high points is what makes that lineage legible:
// the enemies aren't just reskinned bots, they're literally fragments of
// this same built structure. Restrained on purpose — a FEW well-placed
// arches and finials read as "ancient, built, alive"; arches on every
// platform reads as wallpaper and drowns the terrain-readability work
// already done (the hot gold hairline edge-light pass this sits beside).
//
// Gothic silhouette, precursor-installation FUNCTION: an arch by itself
// is just a nice shape — what makes a place read as Orokin/Forerunner
// (a real built civilization, not a stage set) is that it visibly DID
// something. So every niche gets a conduit line running out of it toward
// the next structural point (this place routed power/data somewhere) and
// a couple of "control point" spots get a small inset instrument panel
// with one still-lit indicator (still faintly alive after however long).
// Niches also get PER-INSTANCE weathering (deterministic hash, not
// uniform) — some dimmer, some visibly cracked — because a place with
// real history doesn't age evenly.

import Phaser from "phaser";
import type { PlatformDefinition } from "../../sim/types.js";

const GOLD_HAIR = 0xffedb0;
const GOLD_DEEP = 0x8a7033;
const VIOLET = 0x8b6cf0;
const CRYSTAL_DARK = 0x241531;
const CONDUIT_TEAL = 0x6fe0d8;

/** Cheap deterministic per-index pseudo-random in [0,1) — same trick
 *  TutorialShardThrall uses to stagger its thorns, reused here so every
 *  niche/panel gets a stable, non-uniform "age" instead of re-rolling
 *  every scene load (this is architecture, not a particle effect — it
 *  should look the same every time you walk past it). */
function hash01(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** One pointed (ogive) arch niche — two arcs meeting at a point, the
 *  single most recognizable gothic silhouette — recessed into a surface.
 *  `w`/`h` are the niche's footprint; drawn with its base ON the given
 *  top edge, apex pointing UP into the platform's own mass (a blind
 *  niche carved into the stone, not a doorway you could walk through). */
function drawArchNiche(g: Phaser.GameObjects.Graphics, cx: number, topY: number, w: number, h: number, wear: number): void {
  const halfW = w / 2;
  const apex = { x: cx, y: topY - h };
  const springL = { x: cx - halfW, y: topY - h * 0.42 }; // where the arcs "spring" from the vertical sides
  const springR = { x: cx + halfW, y: topY - h * 0.42 };
  const baseL = { x: cx - halfW, y: topY };
  const baseR = { x: cx + halfW, y: topY };
  // Structural fill: a touch darker than the platform face so the niche
  // reads as a real recess, not a line drawing floating on top.
  g.fillStyle(CRYSTAL_DARK, 0.35);
  g.beginPath();
  g.moveTo(baseL.x, baseL.y);
  g.lineTo(springL.x, springL.y);
  // Two-arc ogive: each side curves from its spring point up to the
  // shared apex — approximated with a quadratic-ish bend via a control
  // point pulled toward the OPPOSITE side (the classic pointed-arch
  // construction: each arc's center is the far spring point).
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ctrl = { x: springR.x, y: springL.y - h * 0.05 };
    const x = (1 - t) * (1 - t) * springL.x + 2 * (1 - t) * t * ctrl.x + t * t * apex.x;
    const y = (1 - t) * (1 - t) * springL.y + 2 * (1 - t) * t * ctrl.y + t * t * apex.y;
    g.lineTo(x, y);
  }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ctrl = { x: springL.x, y: springR.y - h * 0.05 };
    const x = (1 - t) * (1 - t) * apex.x + 2 * (1 - t) * t * ctrl.x + t * t * springR.x;
    const y = (1 - t) * (1 - t) * apex.y + 2 * (1 - t) * t * ctrl.y + t * t * springR.y;
    g.lineTo(x, y);
  }
  g.lineTo(baseR.x, baseR.y);
  g.closePath();
  g.fillPath();
  // Outer hairline (bright) + one inner tracery rib (dim) — the same
  // two-weight line language the top-edge light already uses, so this
  // reads as the SAME building material, not a decal. `wear` (0=fresh,
  // 1=badly weathered) dims the whole niche AND, past a threshold, drops
  // the tracery rib entirely — a place with real history doesn't age
  // evenly, some niches just lost their detail to time.
  g.lineStyle(1.2, GOLD_HAIR, 0.8 * (1 - wear * 0.6));
  g.strokePath();
  if (wear < 0.7) {
    g.lineStyle(0.8, GOLD_DEEP, 0.5 * (1 - wear));
    g.lineBetween(cx, topY - 1, apex.x, apex.y + h * 0.08);
  }
}

/** A thin power/data channel running along a platform's top edge — the
 *  "it was USED for something" tell. Periodic junction studs (small
 *  bright dots) break it into segments, like an old conduit run with
 *  inspection nodes, rather than one unbroken decorative stripe. */
function drawConduit(g: Phaser.GameObjects.Graphics, x0: number, y: number, x1: number, seedBase: number): void {
  g.lineStyle(1, CONDUIT_TEAL, 0.3);
  g.lineBetween(x0, y - 3, x1, y - 3);
  const len = x1 - x0;
  const nodeSpacing = 90;
  const nodeCount = Math.max(0, Math.floor(len / nodeSpacing));
  for (let i = 0; i <= nodeCount; i++) {
    const nx = x0 + (nodeCount === 0 ? len * 0.5 : (i / nodeCount) * len);
    const lit = hash01(seedBase + i * 3.1) > 0.35; // most nodes still lit — a FEW dead ones read as history, not decay
    g.fillStyle(CONDUIT_TEAL, lit ? 0.65 : 0.15);
    g.fillCircle(nx, y - 3, lit ? 1.6 : 1.1);
  }
}

/** A small inset instrument panel — a "this place had a function" beat.
 *  A recessed rectangle, a few thin cross-hatch lines suggesting old
 *  readouts, and ONE indicator light — still faintly alive, the single
 *  detail that makes a ruin read as dormant rather than dead. */
function drawInstrumentPanel(g: Phaser.GameObjects.Graphics, cx: number, topY: number): void {
  const w = 26;
  const h = 16;
  const x0 = cx - w / 2;
  const y0 = topY - h - 3;
  g.fillStyle(CRYSTAL_DARK, 0.55);
  g.fillRect(x0, y0, w, h);
  g.lineStyle(1, GOLD_DEEP, 0.6);
  g.strokeRect(x0, y0, w, h);
  g.lineStyle(0.7, GOLD_HAIR, 0.35);
  for (let i = 1; i < 4; i++) {
    const lx = x0 + (w * i) / 4;
    g.lineBetween(lx, y0 + 2, lx, y0 + h - 2);
  }
  // The one still-lit indicator — deliberately off-center, like the rest
  // of the panel really did fail and this is just what's left running.
  g.fillStyle(CONDUIT_TEAL, 0.85);
  g.fillCircle(x0 + w * 0.72, y0 + h * 0.32, 1.8);
}

/** A small rib-tracery fan — 4 thin lines radiating from one point, like
 *  the ribs of a vault seen edge-on. Cheap, and reads as "carved detail"
 *  at a glance without needing a full rose-window render. */
function drawTraceryFan(g: Phaser.GameObjects.Graphics, x: number, y: number, len: number, spreadRad: number, baseAngle: number): void {
  const rays = 4;
  for (let i = 0; i < rays; i++) {
    const t = i / (rays - 1);
    const a = baseAngle - spreadRad / 2 + spreadRad * t;
    g.lineStyle(1, GOLD_HAIR, 0.35 - Math.abs(t - 0.5) * 0.2);
    g.lineBetween(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
}

/** A single crystal finial — the same asymmetric barbed-spike silhouette
 *  TutorialShardThrall's thorns use, planted at a structural high point.
 *  Ties the architecture to the crystalline thrall race visually: they
 *  read as grown FROM this, not painted onto an unrelated set. */
function drawFinial(g: Phaser.GameObjects.Graphics, x: number, topY: number, size: number): void {
  const len = size * 3.4;
  const baseW = size * 0.55;
  const tip = { x, y: topY - len };
  const b1 = { x: x - baseW, y: topY };
  const b2 = { x: x + baseW * 0.6, y: topY };
  g.fillStyle(CRYSTAL_DARK, 0.9);
  g.beginPath();
  g.moveTo(tip.x + baseW * 0.15, tip.y);
  g.lineTo(b1.x, b1.y);
  g.lineTo(x, topY + size * 0.2);
  g.lineTo(b2.x, b2.y);
  g.closePath();
  g.fillPath();
  g.lineStyle(1.1, VIOLET, 0.75);
  g.strokePath();
  // A short hot hairline up the spine — the same "it's alive, not just
  // stone" vein treatment the thrall cores use, at architecture scale.
  g.lineStyle(0.8, GOLD_HAIR, 0.6);
  g.lineBetween(x, topY - size * 0.3, tip.x, tip.y + size * 0.3);
}

/** Draws the whole ornament pass once into a fresh Graphics object at the
 *  given depth (same layer as the terrain edge-light, just above the
 *  platform fill). Deliberately selective, not exhaustive — see file
 *  header on why "a few, well-placed" beats "everywhere." */
export function drawGothicOrnament(scene: Phaser.Scene, platforms: readonly PlatformDefinition[]): void {
  const g = scene.add.graphics();
  g.setDepth(11); // above PlatformLayer + the edge-light pass (10), below rigs (12)

  let platformIndex = 0;
  for (const p of platforms) {
    platformIndex++;
    const x0 = p.position.x - p.size.x / 2;
    const topY = p.position.y - p.size.y / 2;
    const isTallNarrow = p.size.y > p.size.x * 2.2;
    const isWideSurface = p.kind !== "wall" && p.size.x >= 300 && !isTallNarrow;

    if (isTallNarrow && p.kind !== "wall") {
      // Shaft columns and cover pylons read as spires — one finial each,
      // planted at the very top.
      drawFinial(g, p.position.x, topY, Math.min(16, p.size.x * 0.9));
    }

    if (isWideSurface) {
      // Sparse niches along the top face — spaced generously (~320px) and
      // capped low so even the longest floors (the 6678px "floor-2") only
      // ever show a handful, never a repeating wallpaper strip.
      const nicheW = Math.min(72, p.size.x * 0.16);
      const nicheH = Math.min(20, p.size.y * 0.9);
      const spacing = 320;
      const count = Math.min(4, Math.max(1, Math.floor(p.size.x / spacing) - 1));
      let firstX = x0;
      let lastX = x0 + p.size.x;
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : (i + 0.5) / count;
        const cx = x0 + p.size.x * t;
        const wear = hash01(platformIndex * 17 + i * 5.3) * 0.85; // never fully unreadable, just aged
        drawArchNiche(g, cx, topY, nicheW, nicheH, wear);
        if (i === 0) firstX = cx;
        lastX = cx;
      }
      // Conduit run linking this platform's niches — only where there's
      // actually more than one to connect (a lone niche has nothing to
      // route power TO, so it stays a plain carving).
      if (count > 1) drawConduit(g, firstX, topY, lastX, platformIndex * 7);
    }
  }

  // A handful of tracery fans + instrument panels at the two big combat-
  // arena thresholds (fixed world coordinates, not per-platform — these
  // mark ARRIVAL into "The Voice Speaks" and "The Vessel Answers," a beat
  // worth a flourish the generic per-platform loop above shouldn't try to
  // infer on its own). Kept to two locations on purpose — these are the
  // installation's actual CONTROL POINTS, not decoration repeated
  // everywhere; that scarcity is what makes them read as functional.
  drawTraceryFan(g, 1290, 968, 90, Math.PI * 0.55, -Math.PI / 2);
  drawInstrumentPanel(g, 1290, 968);
  drawTraceryFan(g, 6100, 968, 110, Math.PI * 0.6, -Math.PI / 2);
  drawInstrumentPanel(g, 6100, 968);
}
