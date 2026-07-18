// Self-light construct spine — the reusable primitive behind the whole
// presentation-overhaul (docs/presentation-overhaul-goal.md P0). A fighter
// conjures their constructs from *self-light*, never a rigid model; one drawing
// primitive is refracted per class. This file implements the first refraction:
// the Syzygist "entanglement" — cool-white light-threads that BIND the priest
// to every fighter carrying their mark. The same tether shape later re-tints
// into the Drain leech thread and the Kindred rally link; blade/board/lance
// presets slot in beside it.
//
// The four reads of an entanglement tether (Syzygist sacred verb = entangle):
//   bind — a burst where the mark catches            (spawnBindBurst, inward)
//   hold — a breathing, knotted thread tracking both  (spawnTether)
//   feed — devotion motes crawl victim -> priest       (spawnTetherMote)
//   snap — a burst where the thread lets go           (spawnBindBurst, outward)
//
// Everything rides ParticlePool + transientVfx (like StatusVfxController) so it
// stays inside the particle budget for the Pi/phone bake (END_PRODUCT_GOAL §3),
// and reads as ADD-blended self-light. Cool-white is deliberately NOT an
// element color — binding light, distinct from fire/ice/lightning, and kept
// thin/low-alpha so the fighters stay the loudest thing on screen (A18).

import Phaser from "phaser";
import { ParticlePool } from "../systems/ParticlePool";
import { transientVfx } from "./TransientVfx";
import type { Vec2 } from "../../sim";

const TAU = Math.PI * 2;

/** The three self-light registers of one construct: a thin bright inner stroke,
 *  a wide soft ADD glow, and the traveling mote that gives the thread life. */
export type ConstructTint = {
  core: number;
  glow: number;
  mote: number;
};

/** Syzygist entanglement — cold blue-white. Reads as *binding*, never an
 *  element; sits under the warm fighters so they stay loudest (A18). */
export const SYZYGIST_TINT: ConstructTint = {
  core: 0xeaf2ff,
  glow: 0x5aa0ff, // saturated cold blue so the tint carries through the bloom
  mote: 0xbfe0ff,
};

/** Interstice — pale steel-white with a cyan edge. The dual-blade "flick":
 *  snappy, bright leading edge, no drag (the ninja weight contract, A17). */
export const INTERSTICE_TINT: ConstructTint = {
  core: 0xf2fbff,
  glow: 0x35d6ff, // saturated cyan
  mote: 0xbdf0ff,
};

/** Geometrician — crystalline white with a violet refraction. The projected
 *  lance/prism: a focused, faceted self-light spike (the "project" verb). */
export const GEOMETRICIAN_TINT: ConstructTint = {
  core: 0xeafcff,
  glow: 0x35d6ff, // cyan — the CONJURED/expended combat register (chassis-axioms
  mote: 0xbdf0ff, // CA2). Shares Interstice's hue; the lance SHAPE (not a blade)
};                //  is what keeps the two distinct, per canon.

/** Kindred (paladin) — radiant gold-white. "Divine" = DENSITY OF LIGHT, never
 *  liturgy: the ward is a faceted crystalline dome (crystal/diamond grammar),
 *  NOT a halo/cross/eye/triangle-ring/hexagram (IDENT-GRAMMAR hard line). */
export const KINDRED_TINT: ConstructTint = {
  core: 0xfff3d0,
  glow: 0xffc24d,
  mote: 0xffe0a0,
};

/** The felt behaviour of a tether: a drawn thread (sag), alive (breathe), and
 *  bound (knots) rather than a taut inert wire. */
export type TetherShape = {
  /** Base perpendicular bow, px — a drawn thread, not a straight wire. */
  sag: number;
  /** ± px the sag oscillates, so the thread breathes instead of sitting dead. */
  breatheAmp: number;
  /** Breaths per second. */
  breatheHz: number;
  /** Small binding ticks along the thread — reads as *bound*, not just linked. */
  knots: number;
};

export const ENTANGLE_SHAPE: TetherShape = {
  sag: 10,
  breatheAmp: 5,
  breatheHz: 0.9,
  knots: 2,
};

const TETHER_SAMPLES = 12; // curve resolution — smooth breathing, cheap
const MOTE_SPEED_PX_PER_MS = 0.9;
const MOTE_MIN_MS = 200;
const MOTE_MAX_MS = 460;

// ── curve helpers ──────────────────────────────────────────────────────────

function pointOnQuad(from: Vec2, ctrl: Vec2, to: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return {
    x: a * from.x + b * ctrl.x + c * to.x,
    y: a * from.y + b * ctrl.y + c * to.y,
  };
}

function tangentOnQuad(from: Vec2, ctrl: Vec2, to: Vec2, t: number): Vec2 {
  // dP/dt of the quadratic bezier, normalized.
  const x = 2 * (1 - t) * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x);
  const y = 2 * (1 - t) * (ctrl.y - from.y) + 2 * t * (to.y - ctrl.y);
  const len = Math.max(1e-4, Math.hypot(x, y));
  return { x: x / len, y: y / len };
}

/** Perpendicular control point for the breathing bow between two ends. */
function breatheCtrl(
  from: Vec2,
  to: Vec2,
  shape: TetherShape,
  phaseSec: number,
): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len;
  const py = dx / len;
  const sag = shape.sag + Math.sin(phaseSec * shape.breatheHz * TAU) * shape.breatheAmp;
  return {
    x: (from.x + to.x) / 2 + px * sag,
    y: (from.y + to.y) / 2 + py * sag,
  };
}

function strokeQuad(
  g: Phaser.GameObjects.Graphics,
  from: Vec2,
  ctrl: Vec2,
  to: Vec2,
): void {
  g.beginPath();
  g.moveTo(from.x, from.y);
  for (let i = 1; i <= TETHER_SAMPLES; i++) {
    const p = pointOnQuad(from, ctrl, to, i / TETHER_SAMPLES);
    g.lineTo(p.x, p.y);
  }
  g.strokePath();
}

// ── constructs ───────────────────────────────────────────────────────────────

/** hold — draw one breathing, knotted self-light thread from `from` to `to`
 *  INTO a caller-owned Graphics (the caller clears it and owns its lifetime).
 *  A CONTINUOUS construct must NOT churn the shared bolt pool: the live-Phaser
 *  harness showed the tether alone exhausted the 4-bolt pool every frame and
 *  starved every other effect (lightning chains, leech threads, the bursts). So
 *  ConstructVfxController holds ONE dedicated off-pool Graphics and redraws it
 *  here each frame — which also makes the thread track both fighters perfectly
 *  and breathe smoothly (`phaseSec` climbs monotonically). */
export function drawTether(
  g: Phaser.GameObjects.Graphics,
  from: Vec2,
  to: Vec2,
  tint: ConstructTint,
  shape: TetherShape,
  phaseSec: number,
): void {
  const ctrl = breatheCtrl(from, to, shape, phaseSec);

  // Layered bloom — a wide soft halo, a mid glow, then the thin bright core, so
  // it reads as luminous binding LIGHT (not a hairline) and the cold glow tint
  // carries. (Alphas raised after the live-Phaser harness read.)
  g.lineStyle(14, tint.glow, 0.18);
  strokeQuad(g, from, ctrl, to);
  g.lineStyle(5, tint.glow, 0.5);
  strokeQuad(g, from, ctrl, to);
  g.lineStyle(2, tint.core, 0.95);
  strokeQuad(g, from, ctrl, to);

  // Binding cinches — a bright node + a cross-sliver at each knot, so it reads
  // BOUND rather than leashed.
  for (let k = 1; k <= shape.knots; k++) {
    const t = k / (shape.knots + 1);
    const p = pointOnQuad(from, ctrl, to, t);
    const tan = tangentOnQuad(from, ctrl, to, t);
    const nx = -tan.y;
    const ny = tan.x;
    g.lineStyle(2, tint.core, 0.7);
    g.beginPath();
    g.moveTo(p.x - nx * 5, p.y - ny * 5);
    g.lineTo(p.x + nx * 5, p.y + ny * 5);
    g.strokePath();
    g.fillStyle(tint.core, 0.9);
    g.fillCircle(p.x, p.y, 1.9);
  }

  // Snare cinch near the marked end — a small loop that says CAUGHT.
  const wt = pointOnQuad(from, ctrl, to, 0.9);
  const wtan = tangentOnQuad(from, ctrl, to, 0.9);
  const wa = Math.atan2(wtan.y, wtan.x);
  g.lineStyle(2, tint.glow, 0.5);
  g.beginPath();
  g.arc(wt.x, wt.y, 7, wa - 0.4, wa + Math.PI + 0.4);
  g.strokePath();
}

/** feed — a devotion mote travels the thread from `from` toward `to`,
 *  accelerating home (the bound vitality the priest is drawing off). Emit
 *  victim -> priest. */
export function spawnTetherMote(
  pool: ParticlePool,
  from: Vec2,
  to: Vec2,
  tint: ConstructTint,
  shape: TetherShape,
): void {
  const spark = pool.acquireSpark();
  if (!spark) return;
  const ctrl = breatheCtrl(from, to, shape, 0);
  spark.setPosition(from.x, from.y);
  spark.setFillStyle(tint.mote, 0.95);
  spark.setRotation(0);
  spark.setScale(1.8); // larger so the feed mote actually registers in-engine
  spark.setAlpha(0.95);
  spark.setBlendMode(Phaser.BlendModes.ADD);

  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const life = Math.min(MOTE_MAX_MS, Math.max(MOTE_MIN_MS, dist / MOTE_SPEED_PX_PER_MS));

  transientVfx.spawn({
    factory: () => spark,
    lifetimeMs: life,
    startAlpha: 0.95,
    ease: "Sine.easeIn",
    onTick: (obj, t) => {
      const s = obj as Phaser.GameObjects.Rectangle;
      const eased = t * t; // accelerate toward the priest
      const p = pointOnQuad(from, ctrl, to, eased);
      s.x = p.x;
      s.y = p.y;
      const sc = 1.8 - 0.9 * t;
      s.setScale(sc, sc);
    },
    release: () => pool.release(spark),
  });
}

/** bind / snap — a burst at a point. `outward` false = the mark catching
 *  (ring contracts, shards converge); true = the thread letting go (ring
 *  expands, shards scatter). */
export function spawnBindBurst(
  pool: ParticlePool,
  at: Vec2,
  tint: ConstructTint,
  outward: boolean,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  // bind (inward) = a catch cinching shut; snap (outward) = a release flashing
  // open — deliberately different reads (they looked near-identical before).
  const ringFrom = outward ? 1.4 : 1.7;
  const ringTo = outward ? 2.1 : 0.65;
  const sliverCount = outward ? 8 : 6;
  const sliverLen = outward ? 14 : 10;

  // The burst animates (ring travels, slivers move, flash focuses), so redraw
  // the pooled Graphics each frame from progress t; transientVfx fades alpha.
  const draw = (t: number): void => {
    g.clear();
    const rs = 18 * (ringFrom + (ringTo - ringFrom) * t);
    g.lineStyle(6, tint.glow, 0.35);
    g.beginPath();
    g.arc(at.x, at.y, rs, 0, TAU);
    g.strokePath();
    g.lineStyle(2.2, tint.core, outward ? 0.7 : 0.55);
    g.beginPath();
    g.arc(at.x, at.y, rs, 0, TAU);
    g.strokePath();

    // central flash — bind pops then focuses in; snap blooms out.
    const flashR = outward ? (t * 22 + 4) * 0.4 : (1 - t) * 13 + 3;
    g.fillStyle(tint.core, outward ? 0.6 : 0.7);
    g.fillCircle(at.x, at.y, flashR);

    // elongated light-slivers (not debris squares): converge (bind) / scatter (snap).
    for (let i = 0; i < sliverCount; i++) {
      const a = (i / sliverCount) * TAU + (outward ? 0.5 : 0.3);
      const r0 = outward ? 8 : 30;
      const r1 = outward ? 30 + sliverLen : 8;
      const r = r0 + (r1 - r0) * t;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x0 = at.x + ca * (r - sliverLen);
      const y0 = at.y + sa * (r - sliverLen);
      const x1 = at.x + ca * r;
      const y1 = at.y + sa * r;
      g.lineStyle(5, tint.glow, 0.3);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.strokePath();
      g.lineStyle(2, tint.core, 0.9);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.strokePath();
    }

    // snap only — two thread stubs recoiling away from where it let go.
    if (outward) {
      for (const sgn of [-1, 1]) {
        const end = { x: at.x + sgn * (10 + t * 26), y: at.y - sgn * (6 + t * 14) };
        const ctrl = { x: at.x + sgn * 10, y: at.y - sgn * 2 };
        g.lineStyle(2, tint.core, 0.8);
        g.beginPath();
        g.moveTo(at.x, at.y);
        for (let s2 = 1; s2 <= 6; s2++) {
          const p = pointOnQuad(at, ctrl, end, s2 / 6);
          g.lineTo(p.x, p.y);
        }
        g.strokePath();
      }
    }
  };

  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: outward ? 300 : 240,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

// ── weapon-construct silhouettes (P0 "a rough silhouette per chassis verb") ──
// Pure, hook-agnostic self-light shapes: the caller supplies origin + aim, so
// they don't depend on the ability/weapon event layer that's mid-rewrite. Each
// is a *construct*, not a rigid model — light the fighter generates. Rough by
// intent; the harness pass dials weight/intensity (presentation-completion).

/** Interstice — a swept dual-blade crescent: two self-light arcs pivoting off
 *  the fighter along `aimRad`, bright leading edge, short life (a flick, no
 *  drag). `reach` px is the blade length; `sweepRad` the arc it cuts. */
export function spawnBladeArc(
  pool: ParticlePool,
  origin: Vec2,
  aimRad: number,
  reach: number,
  tint: ConstructTint,
  sweepRad = 1.4, // curvier scimitar arc (interstice-v2.jpg)
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const a0 = aimRad - sweepRad / 2;
  const a1 = aimRad + sweepRad / 2;
  const N = 12;

  // A blade has BODY: a filled crescent between an outer and inner radius, with
  // a bright leading edge — not a thin line. (Verified in constructPreview.)
  const crescent = (ea0: number, ea1: number, rOut: number, rIn: number): Phaser.Math.Vector2[] => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= N; i++) {
      const a = ea0 + (ea1 - ea0) * (i / N);
      pts.push(new Phaser.Math.Vector2(origin.x + Math.cos(a) * rOut, origin.y + Math.sin(a) * rOut));
    }
    for (let i = N; i >= 0; i--) {
      const a = ea0 + (ea1 - ea0) * (i / N);
      pts.push(new Phaser.Math.Vector2(origin.x + Math.cos(a) * rIn, origin.y + Math.sin(a) * rIn));
    }
    return pts;
  };
  const edge = (rOut: number, ea0: number, ea1: number): void => {
    g.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = ea0 + (ea1 - ea0) * (i / 10);
      const x = origin.x + Math.cos(a) * rOut;
      const y = origin.y + Math.sin(a) * rOut;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  };
  const blade = (rOut: number, rIn: number, ea0: number, ea1: number): void => {
    g.fillStyle(tint.glow, 0.28);
    g.fillPoints(crescent(ea0, ea1, rOut, rIn), true);
    // A wide glow edge under the bright edge — the live-Phaser harness showed
    // the thin edge alone read near-invisible against the dark arena.
    g.lineStyle(6, tint.glow, 0.32);
    edge(rOut, ea0, ea1);
    g.lineStyle(2.5, tint.core, 1);
    edge(rOut, ea0, ea1);
  };

  // Faint motion smear (the flick), then the two blades (dual read).
  g.fillStyle(tint.glow, 0.07);
  g.fillPoints(crescent(a0 - 0.25, a1 - 0.25, reach, reach * 0.8), true);
  blade(reach, reach * 0.82, a0, a1);
  blade(reach * 0.7, reach * 0.56, a0 + 0.12, a1 - 0.05);

  // Bright tip glint at the leading edge — where the cut lands.
  const tip = { x: origin.x + Math.cos(a1) * reach, y: origin.y + Math.sin(a1) * reach };
  g.fillStyle(tint.glow, 0.4);
  g.fillCircle(tip.x, tip.y, 6);
  g.fillStyle(tint.core, 0.95);
  g.fillCircle(tip.x, tip.y, 3);

  // Cyan crystal-shard debris flung off the edge (interstice-v2.jpg scatters
  // shards along the blades).
  const ddx = Math.cos(a1);
  const ddy = Math.sin(a1);
  const dpx = -ddy;
  const dpy = ddx;
  for (let i = 0; i < 3; i++) {
    const along = 8 + i * 10;
    const side = (i - 1) * 10;
    const cx = tip.x + ddx * along + dpx * side;
    const cy = tip.y + ddy * along + dpy * side;
    const dl = 5;
    const dw = 2.5;
    const pts = [
      new Phaser.Math.Vector2(cx + ddx * dl, cy + ddy * dl),
      new Phaser.Math.Vector2(cx + dpx * dw, cy + dpy * dw),
      new Phaser.Math.Vector2(cx - ddx * dl, cy - ddy * dl),
      new Phaser.Math.Vector2(cx - dpx * dw, cy - dpy * dw),
    ];
    g.fillStyle(tint.glow, 0.42);
    g.fillPoints(pts, true);
    g.lineStyle(1.2, tint.core, 0.85);
    strokeClosed(g, pts);
  }

  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 190, // snap, minimal drag — but long enough to actually read
    ease: "Sine.easeIn",
    release: () => pool.release(g),
  });
}

/** Geometrician — a projected lance/prism: a tapered self-light spike from
 *  `origin` along `aimRad`, with faceted glints near the tip (crystal, not
 *  fire). `length` px reaches from body to point. */
export function spawnLance(
  pool: ParticlePool,
  origin: Vec2,
  aimRad: number,
  length: number,
  tint: ConstructTint,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const dx = Math.cos(aimRad);
  const dy = Math.sin(aimRad);
  const tip = { x: origin.x + dx * length, y: origin.y + dy * length };
  const px = -dy;
  const py = dx;
  const base = 6;

  // Faceted crystal BODY — a tapered triangle (wide base -> point), soft glow
  // then a brighter inner core, so it reads as a projected prism, not a wire.
  const tri = (hb: number, color: number, alpha: number): void => {
    g.fillStyle(color, alpha);
    g.fillTriangle(
      origin.x + px * hb,
      origin.y + py * hb,
      origin.x - px * hb,
      origin.y - py * hb,
      tip.x,
      tip.y,
    );
  };
  tri(base, tint.glow, 0.42);
  tri(base * 0.5, tint.core, 0.6);

  // Bloom spine + bright core (raised after the live-Phaser harness showed the
  // lance read near-invisible, then still the weakest construct, at the offline
  // preview's alphas — Phaser's additive fills/strokes read weaker than canvas).
  g.lineStyle(8, tint.glow, 0.5);
  g.beginPath();
  g.moveTo(origin.x, origin.y);
  g.lineTo(tip.x, tip.y);
  g.strokePath();
  g.lineStyle(3, tint.core, 1);
  g.beginPath();
  g.moveTo(origin.x, origin.y);
  g.lineTo(tip.x, tip.y);
  g.strokePath();

  // Facet chevrons pointing forward (crystalline, not perpendicular tick-marks).
  g.lineStyle(1.4, tint.core, 0.75);
  for (const at of [0.45, 0.66, 0.85]) {
    const cx = origin.x + dx * length * at;
    const cy = origin.y + dy * length * at;
    const hb = base * (1 - at) * 1.1;
    const fwd = length * 0.08;
    g.beginPath();
    g.moveTo(cx + px * hb, cy + py * hb);
    g.lineTo(cx + dx * fwd, cy + dy * fwd);
    g.lineTo(cx - px * hb, cy - py * hb);
    g.strokePath();
  }
  g.fillStyle(tint.glow, 0.4);
  g.fillCircle(tip.x, tip.y, 7);
  g.fillStyle(tint.core, 0.95);
  g.fillCircle(tip.x, tip.y, 3);

  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 240,
    ease: "Sine.easeOut",
    release: () => pool.release(g),
  });
}

// ── Kindred Ward — the HELD circuit-board slab shield ────────────────────────
// Grounded in the locked concept art (docs/class-inspiration/kindled-v2.jpg +
// chassis-design-axioms.md CA2): the Kindled Ward is NOT a floating dome/halo
// (that's Syzygist's instrument-ring register). It is a HELD rectangular
// circuit-board slab — gold circuit traces on a black face with a glowing
// rune-screen center — the paladin's self-sourced gold ("grown, in the body")
// made into a wielded object. Four reads: raise / hold / absorb / drop. HOLD is
// continuous → drawn every frame into a dedicated off-pool Graphics (never the
// shared pool). raise / absorb / drop are pooled one-shots. IDENT-GRAMMAR-legal:
// a tech slab, no halo/cross/eye/triangle-ring.

const WARD_HW = 36; // slab half-width (base; scaled by `scale`)
const WARD_HH = 26; // slab half-height

function slabVerts(center: Vec2, scale: number): Phaser.Math.Vector2[] {
  const hw = WARD_HW * scale;
  const hh = WARD_HH * scale;
  const cut = 10 * scale; // chamfered bottom-right corner (the tech silhouette)
  return [
    new Phaser.Math.Vector2(center.x - hw, center.y - hh),
    new Phaser.Math.Vector2(center.x + hw, center.y - hh),
    new Phaser.Math.Vector2(center.x + hw, center.y + hh - cut),
    new Phaser.Math.Vector2(center.x + hw - cut, center.y + hh),
    new Phaser.Math.Vector2(center.x - hw, center.y + hh),
  ];
}

function strokeClosed(g: Phaser.GameObjects.Graphics, verts: Phaser.Math.Vector2[]): void {
  g.beginPath();
  g.moveTo(verts[0]!.x, verts[0]!.y);
  for (let i = 1; i < verts.length; i++) g.lineTo(verts[i]!.x, verts[i]!.y);
  g.closePath();
  g.strokePath();
}

/** hold — the held circuit-board slab, its rune-screen alive. Draw INTO a
 *  caller-owned off-pool Graphics each frame (like drawTether). ADD-blend, so
 *  the "black face" is the dark bg showing through the gold light elements.
 *  `intensity` 0..1 fades it in on raise / out on drop; `scale` for assembly. */
export function drawWardSlab(
  g: Phaser.GameObjects.Graphics,
  center: Vec2,
  tint: ConstructTint,
  phaseSec: number,
  intensity = 1,
  scale = 1,
): void {
  const hw = WARD_HW * scale;
  const hh = WARD_HH * scale;
  const verts = slabVerts(center, scale);

  // Faint body + the gold edge (glow then bright core).
  g.fillStyle(tint.glow, 0.05 * intensity);
  g.fillPoints(verts, true);
  g.lineStyle(6, tint.glow, 0.2 * intensity);
  strokeClosed(g, verts);
  g.lineStyle(2, tint.core, 0.85 * intensity);
  strokeClosed(g, verts);

  // Circuit traces — angular gold paths with right-angle turns + vias.
  g.lineStyle(1.4, tint.glow, 0.55 * intensity);
  const trace = (p: number[][]): void => {
    g.beginPath();
    p.forEach(([fx, fy], i) => {
      const x = center.x + fx! * hw;
      const y = center.y + fy! * hh;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokePath();
  };
  trace([[-0.9, -0.55], [-0.35, -0.55], [-0.35, -0.85]]);
  trace([[-0.9, 0.2], [-0.55, 0.2], [-0.55, 0.7], [-0.2, 0.7]]);
  trace([[0.9, -0.2], [0.62, -0.2], [0.62, -0.7]]);
  trace([[0.9, 0.45], [0.55, 0.45]]);
  g.fillStyle(tint.core, 0.75 * intensity);
  for (const [fx, fy] of [[-0.35, -0.85], [-0.2, 0.7], [0.62, -0.7], [0.55, 0.45]]) {
    g.fillCircle(center.x + fx! * hw, center.y + fy! * hh, 1.5 * scale);
  }

  // Rune-screen — a central window with animated oscilloscope traces (the
  // "readable screen" the concept art calls for).
  const sw = hw * 0.5;
  const sh = hh * 0.45;
  g.fillStyle(tint.glow, 0.14 * intensity);
  g.fillRect(center.x - sw, center.y - sh, sw * 2, sh * 2);
  g.lineStyle(1.5, tint.glow, 0.6 * intensity);
  g.strokeRect(center.x - sw, center.y - sh, sw * 2, sh * 2);
  g.lineStyle(1.5, tint.core, 0.9 * intensity);
  for (const off of [-sh * 0.35, sh * 0.35]) {
    g.beginPath();
    for (let i = 0; i <= 12; i++) {
      const x = center.x - sw + 2 * sw * (i / 12);
      const y = center.y + off + Math.sin(phaseSec * 3 + i * 0.9 + off) * sh * 0.3;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }
}

/** raise — gold motes converge on the hand and the slab assembles into being. */
export function spawnWardRaise(pool: ParticlePool, center: Vec2, tint: ConstructTint): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const N = 8;
  const draw = (t: number): void => {
    g.clear();
    // Gold motes rushing in to assemble the slab.
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const rOut = 64;
      const r = rOut + (10 - rOut) * t;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.lineStyle(3, tint.glow, (1 - t) * 0.35);
      g.beginPath();
      g.moveTo(center.x + ca * (r + 14), center.y + sa * (r + 14));
      g.lineTo(center.x + ca * r, center.y + sa * r);
      g.strokePath();
      g.lineStyle(1.5, tint.core, (1 - t) * 0.9);
      g.beginPath();
      g.moveTo(center.x + ca * (r + 14), center.y + sa * (r + 14));
      g.lineTo(center.x + ca * r, center.y + sa * r);
      g.strokePath();
    }
    // Assembly flash where the slab coalesces (the slab itself ramps in via the
    // persistent hold layer, so raise stays a clean build-up, not a double-draw).
    g.fillStyle(tint.core, t * (1 - t) * 2.4);
    g.fillCircle(center.x, center.y, 6 + t * 10);
  };
  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 280,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

/** absorb — an impact bloom on the shell that ripples, then feeds shards back
 *  to the body (the Kindling gain — the paladin turns damage into fuel). */
export function spawnWardAbsorb(
  pool: ParticlePool,
  center: Vec2,
  hit: Vec2,
  tint: ConstructTint,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const draw = (t: number): void => {
    g.clear();
    // Bright impact flash at the hit (the shell taking the blow).
    g.fillStyle(tint.glow, (1 - t) * 0.5);
    g.fillCircle(hit.x, hit.y, (1 - t) * 26 + 6);
    g.fillStyle(tint.core, (1 - t) * 0.95);
    g.fillCircle(hit.x, hit.y, (1 - t) * 16 + 4);
    // Ripple ring expanding from the hit.
    g.lineStyle(3, tint.core, (1 - t) * 0.7);
    g.beginPath();
    g.arc(hit.x, hit.y, 6 + t * 28, 0, TAU);
    g.strokePath();
    // Feed shards: hit -> body (the Kindling gain), accelerating, with trails.
    const e = t * t;
    for (let i = 0; i < 5; i++) {
      const off = (i - 2) * 6;
      const nx = -(center.y - hit.y);
      const ny = center.x - hit.x;
      const nl = Math.max(1, Math.hypot(nx, ny));
      const sx = hit.x + (nx / nl) * off;
      const sy = hit.y + (ny / nl) * off;
      for (let k = 0; k < 2; k++) {
        const tt = Math.max(0, e - k * 0.12);
        const px = sx + (center.x - sx) * tt;
        const py = sy + (center.y - sy) * tt;
        g.fillStyle(k === 0 ? tint.core : tint.mote, (1 - t) * (k === 0 ? 1 : 0.5));
        g.fillCircle(px, py, 3 - k);
      }
    }
  };
  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 300,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

/** drop — the slab powers down and dissolves into shards flung outward. */
export function spawnWardDrop(pool: ParticlePool, center: Vec2, tint: ConstructTint): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const draw = (t: number): void => {
    g.clear();
    // Power-down flash (the slab itself fades out via the persistent hold ramp).
    g.fillStyle(tint.glow, (1 - t) * 0.4);
    g.fillCircle(center.x, center.y, 10 + t * 8);
    // Shards flung outward as it dissolves.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const r = 24 + t * 30;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.lineStyle(2, tint.core, (1 - t) * 0.85);
      g.beginPath();
      g.moveTo(center.x + ca * (r - 10), center.y + sa * (r - 10));
      g.lineTo(center.x + ca * r, center.y + sa * r);
      g.strokePath();
    }
  };
  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 260,
    ease: "Sine.easeIn",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

/** Kindred weapon — the Kindled Edge: a DENSE overhead sweep. Heavier than the
 *  Interstice flick (the paladin commits): thicker body, longer follow, a heavy
 *  bright edge. Reuses the crescent body idiom at higher weight. */
export function spawnKindledEdge(
  pool: ParticlePool,
  origin: Vec2,
  aimRad: number,
  reach: number,
  tint: ConstructTint,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const sweep = 1.5; // committed overhead arc
  const a0 = aimRad - sweep / 2;
  const a1 = aimRad + sweep / 2; // leading edge — the blade points HERE this frame
  const N = 12;

  // Motion trail — the faint arc the blade has swept through (the weight/follow).
  const trail: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * (i / N);
    trail.push(new Phaser.Math.Vector2(origin.x + Math.cos(a) * reach, origin.y + Math.sin(a) * reach));
  }
  for (let i = N; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / N);
    trail.push(new Phaser.Math.Vector2(origin.x + Math.cos(a) * reach * 0.5, origin.y + Math.sin(a) * reach * 0.5));
  }
  g.fillStyle(tint.glow, 0.12);
  g.fillPoints(trail, true);

  // The Kindled Edge itself — a FACETED GOLD CRYSTAL BLADE along the leading
  // angle (kindled-v2.jpg: a crystalline sword, not a bare motion arc).
  const dx = Math.cos(a1);
  const dy = Math.sin(a1);
  const px = -dy;
  const py = dx;
  const hiltR = 10;
  const midR = reach * 0.5;
  const hw = 8.5; // widest half-width, near mid — a leaf/crystal blade
  const P = (r: number, w: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(origin.x + dx * r + px * w, origin.y + dy * r + py * w);

  const blade = [P(hiltR, 3.5), P(midR, hw), P(reach, 0), P(midR, -hw), P(hiltR, -3.5)];
  g.fillStyle(tint.glow, 0.58);
  g.fillPoints(blade, true);
  g.fillStyle(tint.core, 0.28);
  g.fillPoints([P(hiltR, 1.5), P(midR, hw * 0.5), P(reach, 0), P(midR, -hw * 0.5), P(hiltR, -1.5)], true);
  // Bright faceted outline.
  g.lineStyle(6, tint.glow, 0.32);
  strokeClosed(g, blade);
  g.lineStyle(2.5, tint.core, 1);
  strokeClosed(g, blade);
  // Crystalline spine + facet chevrons pointing to the tip.
  g.lineStyle(1.5, tint.core, 0.9);
  g.beginPath();
  g.moveTo(origin.x + dx * hiltR, origin.y + dy * hiltR);
  g.lineTo(origin.x + dx * reach, origin.y + dy * reach);
  g.strokePath();
  for (const fr of [0.36, 0.6, 0.82]) {
    const r = hiltR + (reach - hiltR) * fr;
    const w = hw * (1 - fr);
    const apex = hiltR + (reach - hiltR) * (fr + 0.08);
    g.beginPath();
    g.moveTo(P(r, w).x, P(r, w).y);
    g.lineTo(origin.x + dx * apex, origin.y + dy * apex);
    g.lineTo(P(r, -w).x, P(r, -w).y);
    g.strokePath();
  }
  // Hilt glow at the hand + a bright tip glint.
  g.fillStyle(tint.glow, 0.5);
  g.fillCircle(origin.x + dx * hiltR, origin.y + dy * hiltR, 5);
  const tip = P(reach, 0);
  g.fillStyle(tint.glow, 0.5);
  g.fillCircle(tip.x, tip.y, 7);
  g.fillStyle(tint.core, 0.95);
  g.fillCircle(tip.x, tip.y, 3);

  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 240, // longer follow-through — commits, no snap-back
    ease: "Sine.easeOut",
    release: () => pool.release(g),
  });
}

/** Geometrician — a volley of faceted cyan crystal shards conjured from an open
 *  palm and flung outward. The CONJURED/expended combat register (CA2): not a
 *  single lance but an ARSENAL of shards, matching geometrician-v2.jpg's
 *  open-palm crystal eruption. */
export function spawnCrystalShards(
  pool: ParticlePool,
  origin: Vec2,
  aimRad: number,
  tint: ConstructTint,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const N = 7;
  const spread = 0.9;
  const draw = (t: number): void => {
    g.clear();
    // Palm flash where the shards are conjured, fading fast.
    g.fillStyle(tint.core, (1 - t) * 0.8);
    g.fillCircle(origin.x, origin.y, (1 - t) * 10 + 2);
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const a = aimRad + (f - 0.5) * spread;
      const speed = 60 + (i % 3) * 22;
      const dist = 8 + (i % 4) * 5 + t * speed;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const px = -dy;
      const py = dx;
      const cx = origin.x + dx * dist;
      const cy = origin.y + dy * dist;
      const len = 9 + (i % 3) * 3; // shard half-length
      const wid = 4.5 + (i % 2) * 1.5; // shard half-width
      // A faceted crystal diamond, oriented along flight.
      const pts = [
        new Phaser.Math.Vector2(cx + dx * len, cy + dy * len),
        new Phaser.Math.Vector2(cx + px * wid, cy + py * wid),
        new Phaser.Math.Vector2(cx - dx * len, cy - dy * len),
        new Phaser.Math.Vector2(cx - px * wid, cy - py * wid),
      ];
      const alpha = 1 - t;
      g.fillStyle(tint.glow, 0.62 * alpha);
      g.fillPoints(pts, true);
      g.lineStyle(4, tint.glow, 0.34 * alpha); // glow edge — reads as bright light
      strokeClosed(g, pts);
      g.lineStyle(1.5, tint.core, 1 * alpha);
      strokeClosed(g, pts);
      g.lineStyle(1, tint.core, 0.6 * alpha); // facet spine
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      g.lineTo(pts[2]!.x, pts[2]!.y);
      g.strokePath();
    }
  };
  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 320,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}
