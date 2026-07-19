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
import {
  meleeBladeAngle,
  meleeOffhandBladeAngle,
  meleeStage,
} from "./meleeTiming.js";
export { BLADE_SWING_MS, EDGE_SWING_MS } from "./meleeTiming.js";

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

function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** One SOLID tapered dagger/knife blade drawn from `pivot` pointing along angle
 *  `a`, `len` px long, `hw` half-width. Reads as a real blade — a bright wedge
 *  body, a brighter inner core, a lit cutting edge, a stubby crossguard, and a
 *  tip glint — NOT a glow smear. Returns the tip so the caller can flash impact
 *  there. Alpha `al` fades ghosts/off-hand copies. */
function drawDagger(
  g: Phaser.GameObjects.Graphics,
  pivot: Vec2,
  a: number,
  len: number,
  hw: number,
  tint: ConstructTint,
  al: number,
): { tipX: number; tipY: number } {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const hilt = 5; // blade starts a touch out from the fist
  const P = (r: number, w: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(pivot.x + dx * r + px * w, pivot.y + dy * r + py * w);
  // Soft outer glow mass (wide, low-alpha wedge) so the blade has WEIGHT/bloom,
  // not a thin wire. Drawn first, under the solid body.
  g.fillStyle(tint.glow, 0.22 * al);
  g.fillPoints(
    [P(hilt, hw * 0.6 + 2), P(len * 0.55, hw * 1.5), P(len + 3, 0.5), P(len * 0.55, -hw * 1.1), P(hilt, -hw * 0.6 - 2)],
    true,
  );
  // Asymmetric SOLID wedge body: straight spine, curved belly → a knife.
  const body = [P(hilt, 2.6), P(len * 0.55, hw), P(len, 0.5), P(len * 0.55, -hw * 0.5), P(hilt, -2.4)];
  g.fillStyle(tint.glow, 0.75 * al);
  g.fillPoints(body, true);
  // Bright inner core wedge — the metal catching the light.
  g.fillStyle(tint.core, 0.98 * al);
  g.fillPoints(
    [P(hilt, 1.4), P(len * 0.55, hw * 0.62), P(len, 0.35), P(len * 0.55, -hw * 0.32), P(hilt, -1.3)],
    true,
  );
  // Lit cutting edge along the belly, into the point.
  g.lineStyle(2.6, tint.core, al);
  g.beginPath();
  g.moveTo(pivot.x + dx * hilt + px * hw * 0.6, pivot.y + dy * hilt + py * hw * 0.6);
  g.lineTo(pivot.x + dx * len, pivot.y + dy * len);
  g.strokePath();
  // Crossguard nub at the hilt (a short perpendicular bar).
  g.lineStyle(3.4, tint.glow, 0.7 * al);
  g.beginPath();
  g.moveTo(pivot.x + dx * hilt + px * 5, pivot.y + dy * hilt + py * 5);
  g.lineTo(pivot.x + dx * hilt - px * 5, pivot.y + dy * hilt - py * 5);
  g.strokePath();
  return { tipX: pivot.x + dx * len, tipY: pivot.y + dy * len };
}

/** How long one ninja twin-slash / paladin edge takes to sweep (ms). Progress
 *  t ∈ [0,1] is elapsed/duration; the controller advances it each frame. */

/** Fade envelope so the swing doesn't pop out — full through the whip, fading
 *  over the last ~22% (follow-through settle). */
function swingEnv(t: number): number {
  return t < 0.78 ? 1 : Math.max(0, (1 - t) / 0.22);
}

/** Interstice — TWIN daggers that SLASH through the arc (animated), pivoting
 *  from the HAND: a coil-back, a fast whip with a swoosh trail + trailing
 *  after-images, an overshoot, and a contact spark burst. PURE per-frame paint:
 *  draws ONE frame at progress `t` into the caller's persistent layer (the
 *  controller owns the Graphics + clears it once per frame, like the tether).
 *  This is the render path that renders reliably; a short-lived tween transient
 *  did NOT paint at all in-engine. `pivot` is the hand; `reach` the blade len;
 *  `dir` flips it for combos. */
export function drawBladeSwing(
  g: Phaser.GameObjects.Graphics,
  leadPivot: Vec2,
  backPivot: Vec2,
  aimRad: number,
  reach: number,
  tint: ConstructTint,
  sweepRad: number,
  dir: number, // combo direction: +1 / -1 alternates the sweep for rapid slashes
  t: number,
  tipHistory: readonly Vec2[] = [],
): void {
  const pivot = dir > 0 ? leadPivot : backPivot;
  const offPivot = dir > 0 ? backPivot : leadPivot;
  const env = swingEnv(t);

  const stage = meleeStage(t, "interstice");
  const speedN = t >= 0.32 && t <= 0.58 ? Math.sin(stage.cut * Math.PI) : 0;
  const lead = meleeBladeAngle(aimRad, sweepRad, dir, t, "interstice");
  const rO = reach * (1 + 0.14 * speedN); // slight smear-elongation at peak speed
  drawWorldTipTrail(g, tipHistory, tint, env, 12);
  // Blade ghosts are reconstructed from the sampled WORLD tip path, not a
  // decorative circle around today's wrist. Hand translation/torso drive now
  // bend the smear into the actual compound cut.
  drawTipBladeGhosts(g, tipHistory, reach, dir, tint, env, 4.4);
  // The other hand counterbalances across the body instead of duplicating a
  // blade at the same wrist. It guards, joins late, then settles opposite.
  const offAngle = meleeOffhandBladeAngle(aimRad, dir, t);
  drawDagger(g, offPivot, offAngle, reach * 0.84, 4.8, tint, 0.88 * env);
  const main = drawDagger(g, pivot, lead, rO, 6.4, tint, env);
  // Leading tip glint.
  g.fillStyle(tint.glow, 0.6 * env);
  g.fillCircle(main.tipX, main.tipY, 6.5);
  g.fillStyle(tint.core, env);
  g.fillCircle(main.tipX, main.tipY, 2.8);
  // No fake contact burst here: slash-hit/hit-confirmed owns impact-site
  // punctuation. A whiff still gets blade motion and trail, never a lie.
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

/** Kindred weapon — the Kindled Edge: a HELD faceted gold crystal greatsword
 *  that swings THROUGH the arc, pivoting from the hand. Heavier and slower than
 *  the Interstice twin-flick (the paladin commits): thicker body, longer follow,
 *  a heavy bright edge + a gold swoosh trail. PURE per-frame paint at progress
 *  `t` into the caller's persistent layer (same reliable path as the tether). */
export function drawKindledSwing(
  g: Phaser.GameObjects.Graphics,
  pivot: Vec2,
  shieldPivot: Vec2,
  aimRad: number,
  reach: number,
  tint: ConstructTint,
  sweepRad: number,
  dir: number,
  t: number,
  tipHistory: readonly Vec2[] = [],
): void {
  const hiltR = 10;
  const midR = reach * 0.5;
  const hw = 9;
  const env = swingEnv(t);

  // Anticipation → heavy whip → overshoot → settle (the paladin commits).
  const stage = meleeStage(t, "kindred");
  const lead = meleeBladeAngle(aimRad, sweepRad, dir, t, "kindred");
  const dx = Math.cos(lead);
  const dy = Math.sin(lead);
  const px = -dy;
  const py = dx;
  const P = (r: number, w: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(pivot.x + dx * r + px * w, pivot.y + dy * r + py * w);
  // Shield arm braces across the chest through the hit, then opens only on
  // recovery. The sword-and-board silhouette remains one committed action.
  const brace = 1 - smoothstep(stage.recovery);
  const boardX = shieldPivot.x - px * dir * 9 + Math.cos(aimRad) * 3 * brace;
  const boardY = shieldPivot.y - py * dir * 9 + Math.sin(aimRad) * 3 * brace;
  const board = [
    new Phaser.Math.Vector2(boardX, boardY - 16),
    new Phaser.Math.Vector2(boardX + 13, boardY - 6),
    new Phaser.Math.Vector2(boardX + 10, boardY + 13),
    new Phaser.Math.Vector2(boardX, boardY + 19),
    new Phaser.Math.Vector2(boardX - 10, boardY + 13),
    new Phaser.Math.Vector2(boardX - 13, boardY - 6),
  ];
  g.fillStyle(tint.glow, 0.22 * env * brace);
  g.fillPoints(board, true);
  g.lineStyle(3, tint.core, 0.82 * env * brace);
  strokeClosed(g, board);
  drawWorldTipTrail(g, tipHistory, tint, env, 16);
  drawTipBladeGhosts(g, tipHistory, reach, dir, tint, env, 6.5);
  // the faceted crystal blade at the leading angle
  const blade = [P(hiltR, 3.5), P(midR, hw), P(reach, 0), P(midR, -hw), P(hiltR, -3.5)];
  g.fillStyle(tint.glow, 0.55 * env);
  g.fillPoints(blade, true);
  g.fillStyle(tint.core, 0.3 * env);
  g.fillPoints([P(hiltR, 1.5), P(midR, hw * 0.5), P(reach, 0), P(midR, -hw * 0.5), P(hiltR, -1.5)], true);
  g.lineStyle(6, tint.glow, 0.34 * env);
  strokeClosed(g, blade);
  g.lineStyle(3, tint.core, env);
  strokeClosed(g, blade);
  // spine
  g.lineStyle(1.5, tint.core, 0.9 * env);
  g.beginPath();
  g.moveTo(pivot.x + dx * hiltR, pivot.y + dy * hiltR);
  g.lineTo(pivot.x + dx * reach, pivot.y + dy * reach);
  g.strokePath();
  // hilt glow + heavy tip
  g.fillStyle(tint.glow, 0.5 * env);
  g.fillCircle(pivot.x + dx * hiltR, pivot.y + dy * hiltR, 5);
  const tipX = pivot.x + dx * reach;
  const tipY = pivot.y + dy * reach;
  g.fillStyle(tint.glow, 0.55 * env);
  g.fillCircle(tipX, tipY, 9);
  g.fillStyle(tint.core, env);
  g.fillCircle(tipX, tipY, 4);
  // Confirmed slash-hit/hit-confirmed events own contact sparks and freeze.
}

/** The honest slash arc: recent blade-tip positions sampled in world space.
 * This includes hand translation and full-body drive, unlike a decorative
 * wrist-centred circle. Older segments taper and dim toward the real tip. */
function drawTipBladeGhosts(
  g: Phaser.GameObjects.Graphics,
  points: readonly Vec2[],
  reach: number,
  dir: number,
  tint: ConstructTint,
  env: number,
  width: number,
): void {
  if (points.length < 5) return;
  for (let ghost = 1; ghost <= 3; ghost++) {
    const i = points.length - 1 - ghost * 3;
    if (i <= 0) continue;
    const prev = points[Math.max(0, i - 1)]!;
    const tip = points[i]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const tangent = Math.atan2(next.y - prev.y, next.x - prev.x);
    // For a rotating blade, tangent = blade angle + dir*PI/2. Recover the
    // historical blade axis, then derive its historical hilt from the tip.
    const angle = tangent - (dir >= 0 ? 1 : -1) * Math.PI * 0.5;
    const hilt = {
      x: tip.x - Math.cos(angle) * reach,
      y: tip.y - Math.sin(angle) * reach,
    };
    drawDagger(g, hilt, angle, reach, width, tint, (0.22 - ghost * 0.045) * env);
  }
}

function drawWorldTipTrail(
  g: Phaser.GameObjects.Graphics,
  points: readonly Vec2[],
  tint: ConstructTint,
  env: number,
  maxWidth: number,
): void {
  if (points.length < 2) return;
  const start = Math.max(1, points.length - 12);
  for (let i = start; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const age = (i - start + 1) / (points.length - start + 1);
    g.lineStyle(maxWidth * age, tint.glow, 0.08 + age * 0.25 * env);
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.strokePath();
    g.lineStyle(Math.max(1.5, maxWidth * age * 0.22), tint.core, age * 0.72 * env);
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.strokePath();
  }
}

/** HELD twin daggers — the Interstice ninja's RESTING weapon (present between
 *  swings so the fighter reads as a dual-wielder, per the goal's "a construct
 *  present during the animation, or it reads as broken"). Two short blades held
 *  ready in the two hands, angled toward aim with a slight combat splay. Pure
 *  per-frame paint into the caller's persistent held layer (same reliable path
 *  as the tether). Jake: "there is a physical two swords in his hands right?" */
export function drawHeldDaggers(
  g: Phaser.GameObjects.Graphics,
  lead: Vec2,
  back: Vec2,
  aimRad: number,
  tint: ConstructTint,
): void {
  // Held ready toward aim, splayed a touch so the two read as separate blades.
  drawDagger(g, lead, aimRad - 0.14, 26, 4.2, tint, 0.95);
  drawDagger(g, back, aimRad + 0.16, 23, 3.8, tint, 0.82);
  // A small palm-glow where each blade is conjured (self-light source).
  g.fillStyle(tint.glow, 0.4);
  g.fillCircle(lead.x, lead.y, 3.2);
  g.fillCircle(back.x, back.y, 2.6);
}

/** HELD Kindled Edge — the Kindred paladin's RESTING crystal sword in the lead
 *  hand (heavier + longer than a dagger; the ward board is a separate ability).
 *  Same self-light material as the ward + the swing (goal: "fight and defend
 *  with the same divine light"). */
export function drawHeldEdge(
  g: Phaser.GameObjects.Graphics,
  lead: Vec2,
  aimRad: number,
  tint: ConstructTint,
): void {
  drawDagger(g, lead, aimRad, 40, 5.6, tint, 0.95);
  g.fillStyle(tint.glow, 0.42);
  g.fillCircle(lead.x, lead.y, 3.6);
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
