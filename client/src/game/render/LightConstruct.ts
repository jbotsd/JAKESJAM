// Self-light construct spine — the reusable primitive behind the whole
// presentation-overhaul (docs/presentation-overhaul-goal.md P0). A fighter
// conjures their constructs from *self-light*, never a rigid model; one drawing
// primitive is refracted per class. This file implements the first refraction:
// the Syzygist "entanglement" — cool-white light-threads that BIND the priest
// to every fighter carrying their mark. The same tether shape later re-tints
// into the Drain leech thread and the Kindled rally link; blade/board/lance
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
import { GLOW_TEXTURE_SIZE } from "./glowTexture.js";
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

/** Kindled (paladin) — radiant gold-white. "Divine" = DENSITY OF LIGHT, never
 *  liturgy: the ward is a faceted crystalline dome (crystal/diamond grammar),
 *  NOT a halo/cross/eye/triangle-ring/hexagram (IDENT-GRAMMAR hard line). */
export const KINDLED_TINT: ConstructTint = {
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

/** Slash impact stamp — small blade symbol + particle burst at the point of
 * contact. Deliberately NOT a swept/morphed line: a small dagger doesn't need
 * to redraw its own geometry across frames to read as "a blade hit you" —
 * that read comes from timing and particles, not from animating the shape
 * (Jake, 2026-07-19: "we don't want big blades... the blade doesn't need to
 * contort... drawing the right symbol like shiv or blade on screen with the
 * right vfx impacting the enemy"). Reuses `drawDagger` — the SAME painter the
 * live weapon uses — so the symbol is unmistakably "this class's blade", not
 * an abstract shape. This is the class-specific hit punctuation that
 * `hit-confirmed`'s shared, class-agnostic blast doesn't carry; it has to be
 * bold enough to read alongside that blast, not lose to it. Short-lived by
 * design — punctuation for a hit that already landed, not the cut itself. */
export function spawnSlashMark(
  pool: ParticlePool,
  at: Vec2,
  angleRad: number,
  tint: ConstructTint,
  // 1 = first direction, 2 = the mirror, 3 = both together (the climax) —
  // cycles 1→2→3→1 with the SAME combo counter the swing itself already
  // uses (Jake, 2026-07-19: "no 1 cut per click... total 3 and they cycle
  // through" — a correction off pure per-hit randomness, toward a set of 3
  // authored reads in a fixed rotation, not noise).
  variant: 1 | 2 | 3 = 1,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  // Small and agile on purpose — sized to the held daggers (~20-26px), not
  // to the swing's own reach. A bigger blade here would read as a different,
  // heavier weapon, not a sharper hit from the same one.
  const BLADE_LEN = 17;
  const HALF_WIDTH = 3.6;
  const SPARK_COUNT = 8;
  // Variant 1: bite angled one way. Variant 2: the mirror (struck from the
  // other side). Variant 3: both directions' bite averaged out but a WIDER,
  // fuller cross (extra tear below) — the climax reads as MORE cut, not a
  // different angle.
  const stampAngle = variant === 2 ? angleRad - 0.24 : angleRad + 0.18;
  const crossOffset = variant === 2 ? -1.15 : 1.15;

  // Real volumetric bloom mass behind the vector flash — a soft textured glow
  // sprite (ParticlePool's proven acquireGlow, already used by ProjectileVfx/
  // ProjectileSystem for impact bloom) reads richer and rounder than any number
  // of stacked additive vector strokes can. "Juice this up to epic" (Jake,
  // 2026-07-19) — a hit needs to feel like it actually detonated.
  const glow = pool.acquireGlow();
  if (glow) {
    const startScale = (34 * 2) / GLOW_TEXTURE_SIZE;
    glow.setPosition(at.x, at.y);
    glow.setTint(tint.glow);
    glow.setAlpha(0.85);
    glow.setScale(startScale);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(14); // just above the swing/held layers so the flash reads on top
    transientVfx.spawn({
      factory: () => glow,
      lifetimeMs: 220,
      startAlpha: 0.85,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const img = obj as Phaser.GameObjects.Image;
        img.setScale(startScale * (1 + t * 1.8)); // blooms outward as it fades
      },
      release: () => pool.release(glow),
    });
  }

  const draw = (t: number): void => {
    g.clear();
    const fade = 1 - t;
    // Extra-hot for the first ~45%, then settles into the base fade — the
    // "flash then linger" shape is what sells impact vs. a flat decay.
    const flash = Math.max(0, 1 - t * 2.2);

    // The core punch — right at the contact point, before anything else.
    g.fillStyle(tint.glow, flash * 0.55);
    g.fillCircle(at.x, at.y, 11 + flash * 7);
    g.fillStyle(tint.core, flash * 0.95);
    g.fillCircle(at.x, at.y, 5 + flash * 4);

    // The symbol itself — the real dagger shape, stuck in, full brightness
    // from frame one, fading out with the flash rather than growing in.
    drawDagger(g, at, stampAngle, BLADE_LEN, HALF_WIDTH, tint, Math.min(1, fade * 1.3));

    // A bold cross-slash tear through the contact point — TWO thick, hot
    // strokes, not one thin line: dual-wield lands as two blades, and a
    // single stroke reads as "a mark", where a cross reads as "torn". Full
    // screen-width so it reads as the impact tearing THROUGH the point of
    // contact rather than a decal sitting on top of it.
    const TEAR_LEN = 46;
    const drawTear = (ang: number, width: number, alpha: number): void => {
      const tx = Math.cos(ang), ty = Math.sin(ang);
      const x0 = at.x - tx * TEAR_LEN * 0.5, y0 = at.y - ty * TEAR_LEN * 0.5;
      const x1 = at.x + tx * TEAR_LEN * 0.5, y1 = at.y + ty * TEAR_LEN * 0.5;
      g.lineStyle(width * 2.4, tint.glow, alpha * 0.4);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();
      g.lineStyle(width, tint.core, Math.min(1, alpha * 1.2));
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokePath();
    };
    drawTear(stampAngle, 3.2, fade);
    drawTear(stampAngle + crossOffset, 2.4, fade * 0.85); // the second blade's cross
    // Variant 3 — "both together," the combo's climax: a THIRD tear bisecting
    // the other two, reading as more cuts landed, not a different angle.
    if (variant === 3) {
      drawTear(stampAngle + crossOffset * 0.5, 2.8, fade * 0.95);
    }

    // A tight spark burst, biased FORWARD along the swing's own direction —
    // a symmetric radial burst reads as "something exploded here"; a
    // forward-weighted one reads as the swing's momentum carrying through
    // and continuing past the target (Jake, 2026-07-19).
    for (let i = 0; i < SPARK_COUNT; i++) {
      const spread = (i / (SPARK_COUNT - 1) - 0.5) * 1.6; // narrow forward cone
      const a = angleRad + spread;
      const speed = 11 + (i % 3) * 8;
      const r = speed * t * 3.4;
      const sx = at.x + Math.cos(a) * r;
      const sy = at.y + Math.sin(a) * r;
      const sparkLen = 6 * fade;
      g.lineStyle(1.6, tint.core, fade * 0.85);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - Math.cos(a) * sparkLen, sy - Math.sin(a) * sparkLen);
      g.strokePath();
    }
  };

  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 190,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

/** Which class-specific SHAPE an empowered-hit/cast-tell construct takes —
 *  not just a tint swap. Locked class doctrine (Jake, 2026-07-19): ninja
 *  reads as slash/stab, priest as oozing tendrils + aura, wizard as glass-
 *  cannon crystal shatter, paladin as warm heavy devotion (never templar
 *  iconography) — "everything should" carry this, not only the swing. */
export type ClassConstructStyle = "slash" | "ooze" | "shatter" | "seal";

/** Empowered-hit flourish — "the next hit looks like a spell took place"
 *  (Jake, 2026-07-19): every ability shaped as a window/mark that pays off on
 *  a LATER landed hit (Read Mark, Undercut, Second Wind, Unbroken Seal,
 *  Judgment Line, Facet Break, Focus Hex...) previously left that payoff hit
 *  looking identical to an ordinary one. `style` picks a genuinely different
 *  SHAPE per class (a follow-up correction, 2026-07-19: the first pass was
 *  one shard-burst re-tinted four ways — "it should be class specific too").
 *  Layered ON TOP of whatever the ordinary hit-confirmed/slash-hit read
 *  already draws — never a replacement for it. */
/** 1 = one direction, 2 = the mirror, 3 = both together + extra (the climax
 *  — more elements, not a different angle). The SAME fixed 3-cycle the swing
 *  combo already uses (Jake, 2026-07-19: "no 1 cut per click... total 3 and
 *  they cycle through" — a correction off pure per-hit randomness toward a
 *  small set of authored reads in a rotation). `base` is variant 1's angle
 *  set; variant 2 mirrors it; variant 3 is base + mirror + `climaxExtra`. */
function comboAngles(variant: 1 | 2 | 3, base: number[], climaxExtra: number[]): number[] {
  if (variant === 1) return base;
  const mirrored = base.map((a) => -a);
  if (variant === 2) return mirrored;
  return [...base, ...mirrored, ...climaxExtra];
}

export function spawnEmpoweredHitFlourish(
  pool: ParticlePool,
  at: Vec2,
  tint: ConstructTint,
  style: ClassConstructStyle,
  variant: 1 | 2 | 3 = 1,
): void {
  const glow = pool.acquireGlow();
  if (glow) {
    const startScale = (46 * 2) / GLOW_TEXTURE_SIZE;
    glow.setPosition(at.x, at.y);
    glow.setTint(tint.glow);
    glow.setAlpha(0.9);
    glow.setScale(startScale);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(15);
    transientVfx.spawn({
      factory: () => glow,
      lifetimeMs: style === "seal" ? 340 : 260, // paladin: heavier, slower to land
      startAlpha: 0.9,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        (obj as Phaser.GameObjects.Image).setScale(startScale * (1 + t * (style === "seal" ? 1.5 : 2.1)));
      },
      release: () => pool.release(glow),
    });
  }

  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const lifetimeMs = style === "seal" ? 340 : style === "ooze" ? 300 : 260;
  // Fixed 3-variant cycle, not per-frame randomness — these are computed once
  // per cast and stay stable across this burst's lifetime; a DIFFERENT LANDED
  // hit advances to the next of the 3 authored variants (ConstructVfxController
  // tracks the cycle position per attacker, the same counter the swing combo
  // itself already uses).
  const cutAngles = comboAngles(variant, [0.55, 1.35], [2.5]);
  const tendrilAngles = comboAngles(variant, [0.6, 1.7], [3.4]);
  const shardAngles = comboAngles(variant, [0.2, 0.9, 1.6], [2.8, 3.6, 4.5]);
  const shardLenBase = shardAngles.map((_, i) => 18 + (i % 3) * 6);
  const crackAngles = comboAngles(variant, [0.4, 1.3], [2.6, 4.0]);
  const sealChunkAngles = comboAngles(variant, [0.6, 1.7], [3.5]);

  const draw = (t: number): void => {
    g.clear();
    const fade = 1 - t;
    const burst = smoothstep(Math.min(1, t * 2.4));

    if (style === "slash") {
      // Ninja: a flurry of extra cut-strokes through the point — this hit bit
      // deeper/more times, not a magical detonation. Reuses the same
      // dagger-tear vocabulary as the ordinary slash-mark, but a RANDOMIZED
      // count/angle of crossing cuts each time (2026-07-19: "no one cut per
      // click but they vary per click" — a fixed pattern looked stamped),
      // so an EMPOWERED hit always reads as MORE cuts, never the same decal.
      g.fillStyle(tint.glow, fade * 0.5);
      g.fillCircle(at.x, at.y, 7 + burst * 8);
      for (const a of cutAngles) {
        const len = 26 * (0.4 + burst * 0.9);
        const dx = Math.cos(a), dy = Math.sin(a);
        g.lineStyle(3.2, tint.glow, fade * 0.45);
        g.beginPath();
        g.moveTo(at.x - dx * len * 0.5, at.y - dy * len * 0.5);
        g.lineTo(at.x + dx * len * 0.5, at.y + dy * len * 0.5);
        g.strokePath();
        g.lineStyle(1.4, tint.core, fade * 0.95);
        g.beginPath();
        g.moveTo(at.x - dx * len * 0.5, at.y - dy * len * 0.5);
        g.lineTo(at.x + dx * len * 0.5, at.y + dy * len * 0.5);
        g.strokePath();
      }
      g.fillStyle(tint.core, fade);
      g.fillCircle(at.x, at.y, 2.6);
    } else if (style === "ooze") {
      // Priest: curling tendrils lashing in and a soft radiant aura pulse —
      // NOT a hard-edged detonation (the class doctrine: oozing + aura,
      // never aim-and-shoot). A wide soft ring (aura), plus 3 wavy tendril
      // curls drawn as sampled quadratic wobbles, echoing the entanglement
      // tether's own curve technique.
      g.lineStyle(10, tint.glow, fade * 0.22);
      g.beginPath();
      g.arc(at.x, at.y, 14 + burst * 20, 0, TAU);
      g.strokePath();
      for (const a0 of tendrilAngles) {
        const reach = 24 * (0.5 + burst * 0.8);
        g.lineStyle(2.4, tint.glow, fade * 0.5);
        g.beginPath();
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          const wobble = Math.sin(u * Math.PI * 2.4 + a0 * 3) * 6 * u;
          const a = a0 + wobble * 0.05;
          const r = reach * u;
          const x = at.x + Math.cos(a) * r + Math.cos(a + Math.PI / 2) * wobble;
          const y = at.y + Math.sin(a) * r + Math.sin(a + Math.PI / 2) * wobble;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokePath();
      }
      g.fillStyle(tint.core, fade * 0.9);
      g.fillCircle(at.x, at.y, 3.5 + burst * 3);
    } else if (style === "shatter") {
      // Wizard, glass cannon: crack-lines flash an instant before the
      // shard-burst — tension then shatter, not a smooth bloom.
      if (t < 0.3) {
        const crackT = t / 0.3;
        g.lineStyle(1.2, tint.core, (1 - crackT) * 0.7);
        for (const a of crackAngles) {
          g.beginPath();
          g.moveTo(at.x, at.y);
          g.lineTo(at.x + Math.cos(a) * 14 * crackT, at.y + Math.sin(a) * 14 * crackT);
          g.strokePath();
        }
      }
      g.fillStyle(tint.glow, fade * 0.6);
      g.fillCircle(at.x, at.y, 8 + burst * 14);
      g.fillStyle(tint.core, fade * 0.98);
      g.fillCircle(at.x, at.y, 3 + burst * 5);
      for (let i = 0; i < shardAngles.length; i++) {
        const a = shardAngles[i]!;
        const len = shardLenBase[i]! * (0.5 + burst * 0.9);
        const dx = Math.cos(a), dy = Math.sin(a);
        const px = -dy, py = dx;
        const r0 = 3 + burst * 5;
        const r1 = r0 + len;
        const hw = 2.2 * fade;
        const tip = { x: at.x + dx * r1, y: at.y + dy * r1 };
        const b1 = { x: at.x + dx * r0 + px * hw, y: at.y + dy * r0 + py * hw };
        const b2 = { x: at.x + dx * r0 - px * hw, y: at.y + dy * r0 - py * hw };
        g.fillStyle(tint.glow, fade * 0.5);
        g.fillTriangle(b1.x, b1.y, b2.x, b2.y, tip.x, tip.y);
        g.lineStyle(1.2, tint.core, fade * 0.9);
        g.beginPath();
        g.moveTo(at.x + dx * r0, at.y + dy * r0);
        g.lineTo(tip.x, tip.y);
        g.strokePath();
      }
    } else {
      // Paladin (seal): heavy, dense, slow — a single chamfered gold plate
      // flashing into being and dissolving, the Ward's own faceted-slab
      // language at hit-scale, not a spray of debris. Fewer, bigger pieces.
      const hw = (10 + burst * 8) * (0.6 + fade * 0.4);
      const plate = [
        new Phaser.Math.Vector2(at.x - hw, at.y - hw * 0.7),
        new Phaser.Math.Vector2(at.x + hw, at.y - hw * 0.7),
        new Phaser.Math.Vector2(at.x + hw, at.y + hw * 0.5),
        new Phaser.Math.Vector2(at.x + hw * 0.4, at.y + hw * 0.9),
        new Phaser.Math.Vector2(at.x - hw, at.y + hw * 0.5),
      ];
      g.fillStyle(tint.glow, fade * 0.4);
      g.fillPoints(plate, true);
      g.lineStyle(3, tint.core, fade * 0.9);
      strokeClosed(g, plate);
      g.fillStyle(tint.core, fade * 0.85);
      g.fillCircle(at.x, at.y, 4 + burst * 6);
      // A few heavy chunks, not many thin shards.
      for (const a of sealChunkAngles) {
        const d = (14 + burst * 20) * fade;
        const cx = at.x + Math.cos(a) * d;
        const cy = at.y + Math.sin(a) * d;
        g.fillStyle(tint.mote, fade * 0.8);
        g.fillCircle(cx, cy, 2.6);
      }
    }
  };

  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

/** Cast tell for a drafted ability that has no OTHER dedicated world-space
 *  read — the minimum floor for "even a pure cooldown/window ability should
 *  show something" (Jake, 2026-07-19). `style` shapes the gather itself per
 *  class ("it should be class specific too," 2026-07-19), not just a tint:
 *  ninja gathers as flicking blade-glints, priest as curling ooze drawing
 *  inward, wizard as crystal facets snapping into place, paladin as a slow
 *  heavy gold mass converging. Casting a window is drawing on your own
 *  reserve — every style gathers IN, never bursts out. */
export function spawnAbilityCastTell(
  pool: ParticlePool,
  at: Vec2,
  tint: ConstructTint,
  style: ClassConstructStyle,
  variant: 1 | 2 | 3 = 1,
): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  // Same fixed 3-variant cycle as the empowered-hit flourish, not per-cast
  // randomness — a repeated press should read as one of 3 authored gathers
  // in rotation, not noise.
  const angles = comboAngles(
    variant,
    style === "seal" ? [0.5, 1.6] : [0.4, 1.3, 2.1],
    style === "seal" ? [3.3] : [3.4, 4.2],
  );
  const rOut = style === "seal" ? 30 : style === "ooze" ? 46 : 40;
  const lifetimeMs = style === "seal" ? 280 : 220;

  const draw = (t: number): void => {
    g.clear();
    const gather = smoothstep(t);

    if (style === "slash") {
      // Ninja: two blade-glints flicking in from either side (dual-wield).
      for (const sgn of [-1, 1]) {
        const a = sgn > 0 ? 0.3 : Math.PI - 0.3;
        const r = rOut - gather * (rOut - 8);
        const x = at.x + Math.cos(a) * r * sgn;
        const y = at.y - 10 + Math.sin(a) * r * 0.4;
        g.fillStyle(tint.core, (1 - t) * 0.9);
        g.fillCircle(x, y, 2.2);
        g.lineStyle(1.6, tint.glow, (1 - t) * 0.5);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + sgn * 6, y - 4);
        g.strokePath();
      }
      g.fillStyle(tint.core, gather * (1 - t) * 1.3);
      g.fillCircle(at.x, at.y - 10, 3 + gather * 5);
    } else if (style === "ooze") {
      // Priest: curling wisps drawing inward, not straight lines.
      for (let i = 0; i < angles.length; i++) {
        const a0 = angles[i]!;
        const r = rOut - gather * (rOut - 6);
        const wob = Math.sin(t * Math.PI * 3 + i) * 4 * (1 - gather);
        const x = at.x + Math.cos(a0) * r + Math.cos(a0 + Math.PI / 2) * wob;
        const y = at.y + Math.sin(a0) * r + Math.sin(a0 + Math.PI / 2) * wob;
        g.fillStyle(tint.mote, (1 - t) * 0.75);
        g.fillCircle(x, y, 2.4);
      }
      g.lineStyle(8, tint.glow, gather * (1 - t) * 0.3);
      g.beginPath();
      g.arc(at.x, at.y, 10 + gather * 6, 0, TAU);
      g.strokePath();
    } else if (style === "shatter") {
      // Wizard: facets snapping straight inward, sharp and quick.
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i]!;
        const r = rOut - gather * (rOut - 6);
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r;
        g.fillStyle(tint.mote, (1 - t) * 0.8);
        g.fillCircle(x, y, 2.6);
        const trailR = r + 8;
        g.lineStyle(1.5, tint.glow, (1 - t) * 0.4);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(at.x + Math.cos(a) * trailR, at.y + Math.sin(a) * trailR);
        g.strokePath();
      }
      g.fillStyle(tint.core, gather * (1 - t) * 1.6);
      g.fillCircle(at.x, at.y, 4 + gather * 8);
    } else {
      // Paladin: a slow, heavy gold mass converging — fewer points, denser.
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i]!;
        const r = rOut - gather * (rOut - 10);
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r;
        g.fillStyle(tint.glow, (1 - t) * 0.6);
        g.fillCircle(x, y, 3.6);
      }
      g.fillStyle(tint.core, gather * (1 - t) * 1.4);
      g.fillCircle(at.x, at.y, 5 + gather * 9);
    }
  };
  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs,
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

/** Radar-sweep cone — a gradient wedge scanning through the swing's LIVE
 * angle, sharp/bright at the leading edge and fading behind it. Replaces the
 * sampled tip-trail ribbon as the primary in-motion read (Jake's sketch,
 * 2026-07-19: character at the center, blade tip tracing the circle's edge,
 * an aimed cone progressively scanning that circle — "the circle that
 * intersects [the scan] is where the slash happens"). Reuses the EXACT same
 * `meleeBladeAngle` the swing and sim hit-gating already key off, so the
 * visible leading edge can never drift from the angle the sim is actually
 * checking — the sweep reaching a target's angle IS the same moment the
 * sim's radial intercept would land a hit, not a separately-timed effect.
 * Widest and brightest through the whip's peak-speed window, per the
 * research finding that weight sells in the back half, not the anticipation. */
function drawSweepCone(
  g: Phaser.GameObjects.Graphics,
  pivot: Vec2,
  leadAngle: number,
  dir: number,
  reach: number,
  tint: ConstructTint,
  env: number,
  sweepWidthRad: number,
): void {
  if (env <= 0.02 || sweepWidthRad <= 0.01) return;
  const SLICES = 28;
  const d = dir >= 0 ? 1 : -1;
  // A tapered CRESCENT, not a flat-edged pie-slice: thin at both the trailing
  // tail and the very tip, bellied out through the middle — the shape the
  // blade tip actually carves, and the read a clean "cut" reference calls
  // for (belly wide, points thin), not an even wedge fan.
  const rimOuter: Vec2[] = [];
  const rimBright: number[] = [];
  for (let i = 0; i < SLICES; i++) {
    const f0 = i / SLICES;
    const f1 = (i + 1) / SLICES;
    const a0 = leadAngle - d * sweepWidthRad * (1 - f0);
    const a1 = leadAngle - d * sweepWidthRad * (1 - f1);
    const belly0 = Math.sin(Math.min(1, f0) * Math.PI); // 0 at both ends, 1 mid-arc
    const belly1 = Math.sin(Math.min(1, f1) * Math.PI);
    // Brightness favors the leading tip AND the wide belly — a pure
    // tip-favoring curve made the widest part of the crescent also the
    // dimmest part, so the shape's own signature (wide middle, thin points)
    // washed out instead of reading clearly.
    const bright = (0.22 + 0.62 * Math.pow(f1, 1.3) + 0.35 * belly1) * env;
    const outer0 = reach * (0.62 + 0.4 * belly0);
    const outer1 = reach * (0.62 + 0.4 * belly1);
    const inner0 = reach * (0.58 - 0.34 * belly0);
    const inner1 = reach * (0.58 - 0.34 * belly1);
    const p0i = { x: pivot.x + Math.cos(a0) * inner0, y: pivot.y + Math.sin(a0) * inner0 };
    const p0o = { x: pivot.x + Math.cos(a0) * outer0, y: pivot.y + Math.sin(a0) * outer0 };
    const p1o = { x: pivot.x + Math.cos(a1) * outer1, y: pivot.y + Math.sin(a1) * outer1 };
    const p1i = { x: pivot.x + Math.cos(a1) * inner1, y: pivot.y + Math.sin(a1) * inner1 };
    if (i === 0) { rimOuter.push(p0o); rimBright.push(bright); }
    rimOuter.push(p1o);
    rimBright.push(bright);
    g.fillStyle(tint.glow, 0.46 * bright);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(p0i.x, p0i.y),
        new Phaser.Math.Vector2(p0o.x, p0o.y),
        new Phaser.Math.Vector2(p1o.x, p1o.y),
        new Phaser.Math.Vector2(p1i.x, p1i.y),
      ],
      true,
    );
    // A hot inner streak along the outer edge of the belly — the bright,
    // saturated core line a real crescent reference reads by, not just a
    // soft glow wash.
    if (belly1 > 0.35) {
      const coreOuter0 = reach * (0.5 + 0.3 * belly0);
      const coreOuter1 = reach * (0.5 + 0.3 * belly1);
      const cp0 = { x: pivot.x + Math.cos(a0) * coreOuter0, y: pivot.y + Math.sin(a0) * coreOuter0 };
      const cp1 = { x: pivot.x + Math.cos(a1) * coreOuter1, y: pivot.y + Math.sin(a1) * coreOuter1 };
      g.lineStyle(reach * 0.09 * belly1, tint.core, 0.55 * bright);
      g.beginPath(); g.moveTo(cp0.x, cp0.y); g.lineTo(cp1.x, cp1.y); g.strokePath();
    }
  }
  // A defined rim along the OUTER edge — without it the crescent's boundary
  // just fades into the background instead of reading as a cut shape with a
  // real edge, the thing a clean reference slash silhouette always has.
  for (let i = 1; i < rimOuter.length; i++) {
    const from = rimOuter[i - 1]!;
    const to = rimOuter[i]!;
    const b = rimBright[i]!;
    g.lineStyle(2.4, tint.core, Math.min(1, b * 0.9));
    g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.strokePath();
  }
  // The scan line itself — a hard, bright edge right at the live angle. This
  // is the "aimed cone" edge from the sketch: the thing actually sweeping,
  // and it needs to dominate — a soft ring-textured body alone reads as a
  // sonar ping, not a blade; this bright edge is what sells "sword", so it's
  // deliberately much bolder than the body fill around it.
  const innerR = reach * 0.22;
  const lx0 = pivot.x + Math.cos(leadAngle) * innerR;
  const ly0 = pivot.y + Math.sin(leadAngle) * innerR;
  const lx1 = pivot.x + Math.cos(leadAngle) * reach;
  const ly1 = pivot.y + Math.sin(leadAngle) * reach;
  g.lineStyle(9, tint.glow, 0.65 * env);
  g.beginPath(); g.moveTo(lx0, ly0); g.lineTo(lx1, ly1); g.strokePath();
  g.lineStyle(3.6, tint.core, env);
  g.beginPath(); g.moveTo(lx0, ly0); g.lineTo(lx1, ly1); g.strokePath();
  g.fillStyle(tint.core, env);
  g.fillCircle(lx1, ly1, 6);
  g.fillStyle(tint.glow, 0.6 * env);
  g.fillCircle(lx1, ly1, 8);
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
 *  over the last ~22% (follow-through settle). Exported so the controller can
 *  crossfade the held/resting weapon in at the exact complementary rate,
 *  instead of a hard cut that leaves both near-invisible for a beat. */
export function swingEnv(t: number): number {
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
  // 1st hit reads one direction, 2nd the mirror, 3rd combines both as the
  // combo's climax — a plain repeat of hit 1/2's read on the finishing blow
  // undersells it (Jake, 2026-07-19: "first slash should look one way,
  // second another direction, then both together on the third").
  comboCount = 1,
): void {
  const pivot = dir > 0 ? leadPivot : backPivot;
  const offPivot = dir > 0 ? backPivot : leadPivot;
  const env = swingEnv(t);

  const stage = meleeStage(t, "interstice");
  const speedN = t >= 0.15 && t <= 0.48 ? Math.sin(stage.cut * Math.PI) : 0;
  const lead = meleeBladeAngle(aimRad, sweepRad, dir, t, "interstice");
  const rO = reach * (1 + 0.14 * speedN); // slight smear-elongation at peak speed
  // The cone is ANCHORED at the cut's start angle and grows to the CURRENT
  // live angle — not a fixed-width window sliding along. A trailing window
  // relocates between samples; an anchored, growing wedge shows MORE of the
  // same shape each frame, which reads as continuous travel even under
  // sparse sampling (a slow capture, a frame hitch) instead of a teleport
  // between two unrelated-looking states (Jake, 2026-07-19: "there is
  // nothing on screen that travels between the frames" / the sketch's
  // "progressive scan... one edge to the other").
  const cutStartAngle = meleeBladeAngle(aimRad, sweepRad, dir, 0.15, "interstice");
  const naturalGrown = Math.abs(lead - cutStartAngle);
  // An instant head-start, not a build-from-zero: the player's input already
  // happened by the time this renders, so the cone should already read as
  // underway on the very first frame — not visibly catching up to their
  // press. Same principle Owlboy's Nemo and Hollow Knight's swing-object
  // decoupling both use: compress/skip the part of the anticipation the
  // player would otherwise perceive as lag, and spend the frame budget on
  // the payoff instead (Jake, 2026-07-19: "mid way the slash the second the
  // button is down").
  const INSTANT_FLOOR = sweepRad * 0.3;
  const grown = Math.min(sweepRad * 0.95, INSTANT_FLOOR + naturalGrown);
  drawSweepCone(g, pivot, lead, dir, rO, tint, env, grown);
  // The combo's 3rd hit combines BOTH directions — the mirrored cone from
  // the opposite hand, at reduced opacity so the CURRENT swing still leads,
  // reading as "both blades converging" rather than a plain repeat of hits
  // 1/2's single-direction read.
  if (comboCount >= 3) {
    const mirrorDir = -dir;
    const mirrorLead = meleeBladeAngle(aimRad, sweepRad, mirrorDir, t, "interstice");
    const mirrorCutStart = meleeBladeAngle(aimRad, sweepRad, mirrorDir, 0.15, "interstice");
    const mirrorGrown = Math.min(sweepRad * 0.95, INSTANT_FLOOR + Math.abs(mirrorLead - mirrorCutStart));
    drawSweepCone(g, offPivot, mirrorLead, mirrorDir, rO * 0.85, tint, env * 0.7, mirrorGrown);
  }
  // A second, smaller echo band at reduced opacity — one clean crescent read
  // as a single thin line; overlapping bands at different radii is what
  // gives a real cut-effect reference its fuller "swirl" body (Jake,
  // 2026-07-19: several overlapping streaks, not one arc).
  drawSweepCone(g, pivot, lead, dir, rO * 0.72, tint, env * 0.6, grown * 0.85);
  // The other hand counterbalances across the body instead of duplicating a
  // blade at the same wrist. Time-offset from the dominant blade rather than
  // fighting for the same visual beat: present (small) during anticipation,
  // then recedes while the dominant blade owns the cut and its overshoot —
  // trying to keep it visible with an angle-based fade still let it cross the
  // dominant blade's silhouette during the wide follow-through sweep and read
  // as scissors. It returns to a clear guard read only once the dominant
  // blade has finished its dramatic travel, in recovery.
  const offAngle = meleeOffhandBladeAngle(aimRad, dir, t);
  const offFade =
    t < 0.15 ? 0.15 + (0.4 - 0.15) * smoothstep(stage.anticipation)
    : t < 0.42 ? 0.4 + (0.08 - 0.4) * smoothstep(stage.cut)
    : t < 0.80 ? 0.08
    : 0.08 + (0.55 - 0.08) * smoothstep(stage.recovery);
  drawDagger(g, offPivot, offAngle, reach * 0.6, 3.6, tint, offFade * env);
  // Small and agile, on purpose — the cone above is the primary "this swung
  // through the air" read now; the blade itself is a small accent at the
  // leading edge, not a competing full-opacity shape (Jake, 2026-07-19: "we
  // don't want big blades, we want small agile blades").
  const main = drawDagger(g, pivot, lead, rO * 0.7, 4.2, tint, env * 0.85);
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

/** Geometrician wind-up — the wizard's basic-fire ramping channel made
 *  visible (Jake, 2026-07-20: "think about the wind up mechanic too" —
 *  holding Fire ramps fire rate over GEO_CHANNEL_RAMP_MS, but the mechanic
 *  had ZERO visual before this; it just quietly got faster). Draw INTO a
 *  caller-owned persistent layer every frame while charging (same reliable
 *  pattern as the Ward), never a transient. Glass-cannon language: tension
 *  visibly building — a tightening ring + progressively appearing crack-lines
 *  + motes drawing inward — never a smooth "filling meter." `frac` is
 *  0 (just started holding) to 1 (fully ramped); intensity and crack count
 *  scale with it so the LAST instant before a shot reads as the tensest. */
export function drawChannelCharge(
  g: Phaser.GameObjects.Graphics,
  at: Vec2,
  tint: ConstructTint,
  frac: number,
  phaseSec: number,
): void {
  if (frac <= 0.01) return;
  const pulse = 0.85 + Math.sin(phaseSec * (4 + frac * 6)) * 0.15; // hums faster as it charges
  const ringR = 16 - frac * 4; // tightens inward as tension builds
  g.lineStyle(6, tint.glow, 0.12 * frac * pulse);
  g.beginPath();
  g.arc(at.x, at.y, ringR + 4, 0, TAU);
  g.strokePath();
  g.lineStyle(2, tint.core, 0.35 * frac * pulse);
  g.beginPath();
  g.arc(at.x, at.y, ringR, 0, TAU);
  g.strokePath();

  // Crack-lines appear progressively — more of them, and longer, the closer
  // to full charge (the glass-cannon "tension" read this class already uses
  // for its empowered-hit shatter).
  const crackCount = 1 + Math.floor(frac * 5);
  for (let i = 0; i < crackCount; i++) {
    const a = (i / 6) * TAU + phaseSec * 0.3;
    const len = ringR * (0.5 + frac * 0.7);
    g.lineStyle(1.1, tint.core, 0.5 * frac);
    g.beginPath();
    g.moveTo(at.x + Math.cos(a) * ringR * 0.3, at.y + Math.sin(a) * ringR * 0.3);
    g.lineTo(at.x + Math.cos(a) * len, at.y + Math.sin(a) * len);
    g.strokePath();
  }

  // A few motes drawing inward, faster/brighter near full charge.
  for (let i = 0; i < 3; i++) {
    const a = phaseSec * (1.5 + i * 0.4) + i * 2.1;
    const r = ringR + 10 - frac * 6;
    g.fillStyle(tint.mote, 0.5 * frac);
    g.fillCircle(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, 1.6);
  }

  g.fillStyle(tint.core, 0.25 * frac * pulse);
  g.fillCircle(at.x, at.y, 3 + frac * 4);
}

// ── Kindled Ward — the HELD circuit-board slab shield ────────────────────────
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

/** Kindled's carried shield — the SAME faceted circuit-board silhouette as
 *  the active Ward slab (drawWardSlab/slabVerts), at a small resting scale
 *  and without the animated rune-screen detail (kept cheap: this redraws
 *  every frame, held or braced through a swing, not cast once). One sword +
 *  one shield (Jake, 2026-07-20: "we should really not have two weapons on
 *  kindled... we need one sword on shield" — corrected the earlier
 *  double-blade read). Same self-light material as the sword and the full
 *  Ward, so "fights and defends with the same divine light" still holds. */
function drawHeldShield(
  g: Phaser.GameObjects.Graphics,
  center: Vec2,
  tint: ConstructTint,
  alpha = 1,
  scale = 0.5,
): void {
  if (alpha <= 0.01) return;
  const verts = slabVerts(center, scale);
  g.fillStyle(tint.glow, 0.16 * alpha);
  g.fillPoints(verts, true);
  g.lineStyle(5, tint.glow, 0.35 * alpha);
  strokeClosed(g, verts);
  g.lineStyle(2, tint.core, 0.9 * alpha);
  strokeClosed(g, verts);
  g.fillStyle(tint.core, 0.85 * alpha);
  g.fillCircle(center.x, center.y, 2.4 * scale + 1);
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

/** Kindled weapon — the Kindled Edge: a HELD faceted gold crystal greatsword
 *  in the lead hand, one carried shield braced in the off hand through the
 *  swing. Heavier and slower than the Interstice twin-flick (the paladin
 *  commits): thicker body, longer follow, a heavy bright edge + a gold
 *  swoosh trail. 2026-07-20: briefly became a second blade instead of the
 *  shield (fixing an unrelated ghost-blade duplicate-render bug at the same
 *  time — see ProceduralPlayerRig.ts's removed duplicate draw path, still
 *  fixed) — reverted; "we should really not have two weapons on kindled...
 *  we need one sword on shield" (Jake). The shield's own draw
 *  (drawHeldShield) reuses the SAME brace-through-the-hit/open-on-recovery
 *  position math the second blade briefly used, just braced in place rather
 *  than swinging — the sword does the cutting, the shield holds. PURE
 *  per-frame paint at progress `t` into the caller's persistent layer (same
 *  reliable path as the tether). */
export function drawKindledSwing(
  g: Phaser.GameObjects.Graphics,
  pivot: Vec2,
  offPivot: Vec2,
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
  const stage = meleeStage(t, "kindled");
  const lead = meleeBladeAngle(aimRad, sweepRad, dir, t, "kindled");
  const dx = Math.cos(lead);
  const dy = Math.sin(lead);
  const px = -dy;
  const py = dx;
  const P = (r: number, w: number): Phaser.Math.Vector2 =>
    new Phaser.Math.Vector2(pivot.x + dx * r + px * w, pivot.y + dy * r + py * w);
  drawWorldTipTrail(g, tipHistory, tint, env, 28);
  drawTipBladeGhosts(g, tipHistory, reach, dir, tint, env, 9);

  // Off hand — the SAME carried shield the resting pose holds (drawHeldEdges
  // → drawHeldShield), braced through the swing rather than a second blade
  // (Jake, 2026-07-20: "we should really not have two weapons on kindled...
  // we need one sword on shield" — this used to mirror the lead blade
  // one-for-one; the brace-through-the-hit/open-on-recovery position math
  // is unchanged, only what's DRAWN there changed). The shield stays put
  // (braced) while the sword does the swinging.
  const brace = 1 - smoothstep(stage.recovery);
  const offX = offPivot.x - px * dir * 9 + Math.cos(aimRad) * 3 * brace;
  const offY = offPivot.y - py * dir * 9 + Math.sin(aimRad) * 3 * brace;
  const offEnv = env * (0.55 + 0.45 * brace);
  drawHeldShield(g, { x: offX, y: offY }, tint, offEnv, 0.5);

  // Lead blade — the faceted crystal blade at the leading angle.
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

/** The honest slash arc: a single tapered, gradient-faded ribbon traced from
 * recent world-space blade-tip positions (includes hand translation and full-
 * body drive, unlike a decorative wrist-centred circle). Deliberately ONE
 * coherent swept shape, not stacked duplicate blades: because the hand pivot
 * barely translates on screen while the blade angle sweeps ~186 degrees,
 * stamping three full dagger replicas at their historical angles fanned open
 * like a hand of cards instead of reading as one blade's motion blur. */
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
  const start = Math.max(0, points.length - 10);
  const sample = points.slice(start);
  if (sample.length < 3) return;

  const innerReach = reach * 0.22;
  const outer: Phaser.Math.Vector2[] = [];
  const inner: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < sample.length; i++) {
    const prev = sample[Math.max(0, i - 1)]!;
    const next = sample[Math.min(sample.length - 1, i + 1)]!;
    const tangent = Math.atan2(next.y - prev.y, next.x - prev.x);
    // For a rotating blade, tangent = blade angle + dir*PI/2. Recover the
    // historical blade axis so the inner edge stays parallel to the blade,
    // not a circle around the pivot.
    const angle = tangent - (dir >= 0 ? 1 : -1) * Math.PI * 0.5;
    const tip = sample[i]!;
    outer.push(new Phaser.Math.Vector2(tip.x, tip.y));
    inner.push(new Phaser.Math.Vector2(tip.x - Math.cos(angle) * innerReach, tip.y - Math.sin(angle) * innerReach));
  }

  // One filled wedge: outer edge (the real tip path) forward through time,
  // inner edge back — a genuine swept ribbon, width proxying for the blade,
  // instead of N stamped duplicate weapons.
  const poly = [...outer, ...inner.slice().reverse()];
  g.fillStyle(tint.glow, 0.32 * env);
  g.fillPoints(poly, true);

  // Brighter, narrower core over just the newest half of the sweep, so the
  // ribbon still reads leading-edge-bright / tail-fading, like a real cut.
  const half = Math.max(2, Math.floor(sample.length / 2));
  const coreOuter = outer.slice(half);
  const coreInner = inner.slice(half).slice().reverse();
  if (coreOuter.length >= 2) {
    g.fillStyle(tint.core, 0.5 * env);
    g.fillPoints([...coreOuter, ...coreInner], true);
  }
  void width; // kept in signature: callers still pass a nominal ghost width
}

function drawWorldTipTrail(
  g: Phaser.GameObjects.Graphics,
  points: readonly Vec2[],
  tint: ConstructTint,
  env: number,
  maxWidth: number,
): void {
  if (points.length < 2) return;
  // Tuned for ACTUAL gameplay camera distance, not a close-up harness crop.
  // At a ~30-40px-tall fighter, the old peak width (12px) and near-hairline
  // core (2.6px) were both well under what reads at a glance from normal
  // camera zoom — the blade itself stays small and agile, but the streak it
  // leaves has to be bold enough to prove it traveled (Jake, 2026-07-19: "no
  // slash that depicts the actual travel of the weapon through the air").
  const start = Math.max(1, points.length - 12);
  for (let i = start; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const age = (i - start + 1) / (points.length - start + 1);
    g.lineStyle(maxWidth * age, tint.glow, (0.16 + age * 0.42) * env);
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.strokePath();
    g.lineStyle(Math.max(2.5, maxWidth * age * 0.42), tint.core, Math.min(1, (0.25 + age * 0.75) * env));
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
  alpha = 1,
): void {
  if (alpha <= 0.01) return;
  // Held ready toward aim, splayed a touch so the two read as separate blades.
  drawDagger(g, lead, aimRad - 0.14, 26, 4.2, tint, 0.95 * alpha);
  drawDagger(g, back, aimRad + 0.16, 23, 3.8, tint, 0.82 * alpha);
  // A small palm-glow where each blade is conjured (self-light source).
  g.fillStyle(tint.glow, 0.4 * alpha);
  g.fillCircle(lead.x, lead.y, 3.2);
  g.fillCircle(back.x, back.y, 2.6);
}

/** HELD Kindled sword + shield — the paladin's RESTING crystal longsword in
 *  the lead hand, one carried shield in the off hand (Jake, 2026-07-20: "we
 *  should really not have two weapons on kindled... we need one sword on
 *  shield" — corrected the earlier double-blade read, which mirrored
 *  drawHeldDaggers's two-blade pattern one-for-one). Same self-light
 *  material as the ward + the swing (goal: "fight and defend with the same
 *  divine light" still holds — it's one sword now, not two). */
export function drawHeldEdges(
  g: Phaser.GameObjects.Graphics,
  lead: Vec2,
  back: Vec2,
  aimRad: number,
  tint: ConstructTint,
  alpha = 1,
): void {
  if (alpha <= 0.01) return;
  // ONE longsword in the lead (weapon) hand — heavier/longer than
  // Interstice's dagger pair, Kindled reads as square/disciplined, not
  // agile — held ready toward aim, same as before.
  drawDagger(g, lead, aimRad, 42, 5.8, tint, 0.95 * alpha);
  g.fillStyle(tint.glow, 0.42 * alpha);
  g.fillCircle(lead.x, lead.y, 3.6);
  // ONE carried shield in the off hand — see drawHeldShield's own doc comment.
  drawHeldShield(g, back, tint, alpha, 0.5);
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

// ── Instant nova/radius burst (Phase 3 shared primitive) ────────────────────
// The floor for every "detonate at a point, hit everyone in range" ability
// (Shard Ring, Wall Bloom, Flock Pulse, Consecrated Field's burst moment,
// Crater, Shock Ring, Prism Fan's own omnidirectional cousins). One spine,
// four lenses (docs/design-axioms.md A17) — `radius` scales the whole read to
// the ability's REAL AOE size (so the flash matches the actual hitbox, never
// a fixed decorative size) and `style` reuses the exact class-shape
// vocabulary spawnEmpoweredHitFlourish/spawnAbilityCastTell already
// established: a nova is a BIGGER, radial version of that same class
// identity, never a generic explosion re-tinted four ways (the "it should be
// class specific too" correction, 2026-07-19, applied at AOE scale).
// Deliberately never a smooth closed ring for any style (chassis-design-
// axioms.md CA6's halo test) — every style breaks the circle into discrete
// segments/shards/plates so nothing here can misread as a halo.

/** Instant nova/radius burst at `at`, sized to `radius` (the ability's real
 *  AOE), shaped by `style`. See file header above for the full rationale. */
export function spawnNovaBurst(
  pool: ParticlePool,
  at: Vec2,
  radius: number,
  tint: ConstructTint,
  style: ClassConstructStyle,
): void {
  const glow = pool.acquireGlow();
  if (glow) {
    const startScale = (radius * 2 * 0.85) / GLOW_TEXTURE_SIZE;
    glow.setPosition(at.x, at.y);
    glow.setTint(tint.glow);
    glow.setAlpha(0.95);
    glow.setScale(startScale);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(15);
    transientVfx.spawn({
      factory: () => glow,
      lifetimeMs: style === "seal" ? 420 : 320,
      startAlpha: 0.95,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        (obj as Phaser.GameObjects.Image).setScale(startScale * (1 + t * 1.6));
      },
      release: () => pool.release(glow),
    });
  }

  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const lifetimeMs = style === "seal" ? 420 : style === "ooze" ? 360 : 320;
  const N = style === "seal" ? 6 : style === "shatter" ? 10 : 8;

  const draw = (t: number): void => {
    g.clear();
    const fade = 1 - t;
    const expand = smoothstep(t);
    // Front-loaded growth (t^0.4, not the slow-starting `expand` used
    // elsewhere in this function) — the ring needs to already read as a
    // real shockwave within the first ~100ms, not just by the time it's
    // fully faded (confirmed via harness screenshot: sampling at the same
    // 90ms delay geo-shards.png reads clearly at, this ring was still
    // barely a quarter grown under the old smoothstep-only curve).
    const ringExpand = Math.pow(Math.max(0, t), 0.4);
    const ringR = radius * (0.35 + ringExpand * 0.65);

    if (style === "slash") {
      // Ninja: a fast jagged shockwave — broken arcs, not a solid ring (a
      // shattered edge reads as a cut wave, never a halo), plus cross-slash
      // streaks fanning the full circle.
      const seg = 10;
      for (let i = 0; i < seg; i++) {
        if (i % 3 === 2) continue; // gap every third segment — broken ring
        const a0 = (i / seg) * TAU;
        const a1 = ((i + 0.8) / seg) * TAU;
        g.lineStyle(5, tint.glow, fade * 0.65);
        g.beginPath();
        g.arc(at.x, at.y, ringR, a0, a1);
        g.strokePath();
        g.lineStyle(2, tint.core, fade * 0.95);
        g.beginPath();
        g.arc(at.x, at.y, ringR, a0, a1);
        g.strokePath();
      }
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + 0.3;
        const r0 = ringR - 8;
        const r1 = ringR + 10;
        g.lineStyle(2.6, tint.core, fade * 0.9);
        g.beginPath();
        g.moveTo(at.x + Math.cos(a) * r0, at.y + Math.sin(a) * r0);
        g.lineTo(at.x + Math.cos(a) * r1, at.y + Math.sin(a) * r1);
        g.strokePath();
      }
    } else if (style === "ooze") {
      // Priest: a soft radiant pulse with curling tendrils lashing outward —
      // never a hard-edged blast (the class doctrine: oozing + aura).
      g.lineStyle(14, tint.glow, fade * 0.32);
      g.beginPath();
      g.arc(at.x, at.y, ringR, 0, TAU);
      g.strokePath();
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * TAU;
        g.lineStyle(3, tint.glow, fade * 0.68);
        g.beginPath();
        for (let s = 0; s <= 8; s++) {
          const u = s / 8;
          const wob = Math.sin(u * Math.PI * 2.6 + a0 * 3) * 8 * u;
          const a = a0 + wob * 0.04;
          const r = ringR * u;
          const x = at.x + Math.cos(a) * r + Math.cos(a + Math.PI / 2) * wob;
          const y = at.y + Math.sin(a) * r + Math.sin(a + Math.PI / 2) * wob;
          if (s === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokePath();
      }
    } else if (style === "shatter") {
      // Wizard: a full radial crystal-shard nova — Prism Fan's own cone,
      // opened out to 360°, with crack-lines flashing an instant before.
      if (t < 0.25) {
        const crackT = t / 0.25;
        g.lineStyle(1.6, tint.core, (1 - crackT) * 0.85);
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU;
          g.beginPath();
          g.moveTo(at.x, at.y);
          g.lineTo(
            at.x + Math.cos(a) * ringR * 0.6 * crackT,
            at.y + Math.sin(a) * ringR * 0.6 * crackT,
          );
          g.strokePath();
        }
      }
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU;
        const dx = Math.cos(a), dy = Math.sin(a);
        const px = -dy, py = dx;
        const len = radius * 0.24 * (0.5 + expand * 0.8);
        const hw = 6 * fade;
        const tip = { x: at.x + dx * ringR, y: at.y + dy * ringR };
        const b1 = {
          x: at.x + dx * (ringR - len) + px * hw,
          y: at.y + dy * (ringR - len) + py * hw,
        };
        const b2 = {
          x: at.x + dx * (ringR - len) - px * hw,
          y: at.y + dy * (ringR - len) - py * hw,
        };
        g.fillStyle(tint.glow, fade * 0.7);
        g.fillTriangle(b1.x, b1.y, b2.x, b2.y, tip.x, tip.y);
        g.lineStyle(1.6, tint.core, fade * 0.95);
        strokeClosed(g, [
          new Phaser.Math.Vector2(b1.x, b1.y),
          new Phaser.Math.Vector2(tip.x, tip.y),
          new Phaser.Math.Vector2(b2.x, b2.y),
        ]);
      }
    } else {
      // Paladin (seal): a slow, heavy expanding ring of chamfered gold
      // PLATES (the Ward's own faceted-slab language at nova scale) —
      // chunky fragments tracing the blast, never a smooth halo disc.
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + 0.4;
        const cx = at.x + Math.cos(a) * ringR;
        const cy = at.y + Math.sin(a) * ringR;
        const hw = 9 * (0.6 + fade * 0.4);
        const plate = [
          new Phaser.Math.Vector2(cx - hw, cy - hw * 0.7),
          new Phaser.Math.Vector2(cx + hw, cy - hw * 0.5),
          new Phaser.Math.Vector2(cx + hw * 0.6, cy + hw * 0.8),
          new Phaser.Math.Vector2(cx - hw * 0.6, cy + hw * 0.8),
        ];
        g.fillStyle(tint.glow, fade * 0.55);
        g.fillPoints(plate, true);
        g.lineStyle(2.6, tint.core, fade * 0.95);
        strokeClosed(g, plate);
      }
    }

    // Shared core flash at the epicenter for every style — the ignition point.
    g.fillStyle(tint.core, fade * 0.95);
    g.fillCircle(at.x, at.y, (1 - ringExpand) * radius * 0.18 + 5);
  };

  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}

// ── Continuous buff-aura pulse (Phase 3 shared primitive) ───────────────────
// The shared read for every self-targeted WINDOW buff with no other
// dedicated visual (Overclock, Rally Light, Aegis Share, Kindled Resolve,
// Haste Gift, Self-Lattice...). Redrawn every frame from the live *UntilTick
// field into a caller-owned persistent Graphics — the SAME technique the
// Ward slab and the wizard's channel-charge already proved reliable (this
// file's header: a short-lived tween transient did not paint at all
// in-engine; a persistent per-frame redraw is the path that renders). NEVER a
// closed ring for any class (chassis-design-axioms.md CA6's halo test, and
// the Ward's own "no halo/cross/eye/triangle-ring" doc line) — every style
// orbits or pulses DISCRETE elements instead.

/** Continuous buff-aura pulse, drawn INTO a caller-owned persistent Graphics
 *  every frame (like drawWardSlab/drawChannelCharge). `radius` is the
 *  orbit/pulse distance from `at`; `intensity` 0..1 fades the whole aura in
 *  on rise and out on fall (the caller frame-diffs the *UntilTick field the
 *  same way `wardWasHeld` already does for the Ward). */
export function drawBuffAura(
  g: Phaser.GameObjects.Graphics,
  at: Vec2,
  tint: ConstructTint,
  style: ClassConstructStyle,
  phaseSec: number,
  radius = 24,
  intensity = 1,
): void {
  if (intensity <= 0.01) return;

  if (style === "slash") {
    // Ninja: 3 fast comet-motes racing around the body, a cyan streak
    // trailing each — restless kept-up energy, never a static ring.
    for (let i = 0; i < 3; i++) {
      const a = phaseSec * 5.5 + (i / 3) * TAU;
      const x = at.x + Math.cos(a) * radius;
      const y = at.y + Math.sin(a) * radius * 0.55;
      const ta = a - 0.5;
      const tx = at.x + Math.cos(ta) * radius;
      const ty = at.y + Math.sin(ta) * radius * 0.55;
      g.lineStyle(3, tint.glow, 0.6 * intensity);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(x, y);
      g.strokePath();
      g.fillStyle(tint.core, 0.95 * intensity);
      g.fillCircle(x, y, 3.2);
    }
  } else if (style === "ooze") {
    // Priest: 2 slow curling tendril-wisps waving near the body, drawing in
    // and out — the SAME oozing vocabulary as the empowered-hit/cast-tell.
    for (let i = 0; i < 2; i++) {
      const a0 = phaseSec * 0.9 + i * Math.PI;
      g.lineStyle(2.6, tint.glow, 0.62 * intensity);
      g.beginPath();
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        const wob = Math.sin(phaseSec * 2.2 + u * Math.PI * 2 + i * 2) * radius * 0.35;
        const a = a0 + u * 1.6;
        const r = radius * (0.4 + u * 0.6);
        const x = at.x + Math.cos(a) * r + Math.cos(a + Math.PI / 2) * wob * 0.3;
        const y = at.y + Math.sin(a) * r * 0.6 + Math.sin(a + Math.PI / 2) * wob * 0.2;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    g.fillStyle(tint.mote, 0.55 * intensity);
    g.fillCircle(at.x, at.y - radius * 0.3, 4);
  } else if (style === "shatter") {
    // Wizard: 4 small faceted crystal shards slowly orbiting, catching the
    // light — a facet motif, not a continuous disc.
    for (let i = 0; i < 4; i++) {
      const a = phaseSec * 1.6 + (i / 4) * TAU;
      const x = at.x + Math.cos(a) * radius;
      const y = at.y + Math.sin(a) * radius * 0.5 - 4;
      const s = 4.6;
      g.fillStyle(tint.glow, 0.6 * intensity);
      g.fillTriangle(x, y - s, x + s * 0.7, y + s * 0.5, x - s * 0.7, y + s * 0.5);
      g.lineStyle(1.4, tint.core, 0.9 * intensity);
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x + s * 0.7, y + s * 0.5);
      g.lineTo(x - s * 0.7, y + s * 0.5);
      g.closePath();
      g.strokePath();
    }
  } else {
    // Paladin (seal): a gold circuit-vein pulse hugging the body — IN the
    // body per chassis-design-axioms.md CA2 ("gold is grown, self-sourced"),
    // never a detached ring/halo. A soft breathing glow at the torso plus
    // short vein-lines radiating a short distance out.
    const pulse = 0.7 + Math.sin(phaseSec * 2.4) * 0.3;
    g.fillStyle(tint.glow, 0.22 * intensity * pulse);
    g.fillCircle(at.x, at.y, radius * 0.6);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      const r0 = radius * 0.25;
      const r1 = radius * 0.55 * pulse;
      g.lineStyle(2.2, tint.core, 0.8 * intensity);
      g.beginPath();
      g.moveTo(at.x + Math.cos(a) * r0, at.y + Math.sin(a) * r0 * 0.6);
      g.lineTo(at.x + Math.cos(a) * r1, at.y + Math.sin(a) * r1 * 0.6);
      g.strokePath();
    }
  }
}

// ── Blink/teleport streak (Phase 3 shared primitive) ────────────────────────
// The shared read for a mobility ability that relocates the caster (Slip
// Node, Drift Step, and — style-gated — any other class's dash/step).
// chassis-design-axioms.md CA5 is explicit: the ghost-double afterimage
// trail is Interstice's (and Syzygist's) canon alone — Geometrician and
// Kindled must NEVER get a tether/echo treatment. So only `style === "slash"`
// (ninja) or `"ooze"` (priest — Syzygist already owns tether-vocabulary too)
// draw the connecting trail body; every other style resolves to a departure
// + arrival burst with NO connecting trail (a commit, not a flourish — A17).

/** Blink/teleport streak from `from` to `to`. See file header above for the
 *  CA5 style-gating rationale — `style` decides whether a trail body draws
 *  at all, not just its color. */
export function spawnBlinkStreak(
  pool: ParticlePool,
  from: Vec2,
  to: Vec2,
  tint: ConstructTint,
  style: ClassConstructStyle,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const hasTrail = (style === "slash" || style === "ooze") && dist > 1;

  if (hasTrail) {
    const g = pool.acquireBolt();
    if (g) {
      g.setPosition(0, 0);
      g.setAlpha(1);
      g.setScale(1);
      g.setRotation(0);
      g.setBlendMode(Phaser.BlendModes.ADD);
      const px = -dy / dist;
      const py = dx / dist;
      const SEGMENTS = 7;
      const draw = (t: number): void => {
        g.clear();
        const fade = 1 - t;
        // Afterimage body — a tapered ribbon from origin to destination,
        // widest near the departure point (the ghost still dissolving),
        // narrowing toward the arrival (already re-solidified there), plus a
        // bright core spine down the middle so it reads as a real streak,
        // not just a soft haze (harness screenshot check: the fill alone
        // was nearly invisible against the dark bg).
        g.lineStyle(3, tint.core, fade * 0.85);
        g.beginPath();
        g.moveTo(from.x, from.y);
        g.lineTo(to.x, to.y);
        g.strokePath();
        for (let i = 0; i < SEGMENTS; i++) {
          const u0 = i / SEGMENTS;
          const u1 = (i + 1) / SEGMENTS;
          const w0 = (1 - u0) * 10 * fade;
          const w1 = (1 - u1) * 10 * fade;
          const x0 = from.x + dx * u0, y0 = from.y + dy * u0;
          const x1 = from.x + dx * u1, y1 = from.y + dy * u1;
          const a = fade * (1 - u0 * 0.5);
          g.fillStyle(tint.glow, a * 0.55);
          g.fillPoints(
            [
              new Phaser.Math.Vector2(x0 + px * w0, y0 + py * w0),
              new Phaser.Math.Vector2(x1 + px * w1, y1 + py * w1),
              new Phaser.Math.Vector2(x1 - px * w1, y1 - py * w1),
              new Phaser.Math.Vector2(x0 - px * w0, y0 - py * w0),
            ],
            true,
          );
        }
      };
      draw(0);
      transientVfx.spawn({
        factory: () => g,
        lifetimeMs: 260,
        ease: "Sine.easeOut",
        onTick: (_obj, t) => draw(t),
        release: () => pool.release(g),
      });
    }
  }

  // Departure — every style gets a conjuring/dispersal flash where the
  // fighter WAS (reuses the cast-tell gather-in read; a blink is drawing on
  // the same reserve as any other cast).
  spawnAbilityCastTell(pool, from, tint, style, 1);

  // Arrival — every style gets a bloom at the destination; heavier for the
  // classes with no trail body (it's carrying the full weight of the read).
  const glow = pool.acquireGlow();
  if (glow) {
    const startScale = ((hasTrail ? 26 : 40) * 2) / GLOW_TEXTURE_SIZE;
    glow.setPosition(to.x, to.y);
    glow.setTint(tint.glow);
    glow.setAlpha(0.85);
    glow.setScale(startScale);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(15);
    transientVfx.spawn({
      factory: () => glow,
      lifetimeMs: 240,
      startAlpha: 0.85,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        (obj as Phaser.GameObjects.Image).setScale(startScale * (1 + t * 1.7));
      },
      release: () => pool.release(glow),
    });
  }
}

// ── Ground field (Phase 3 shared primitive) ─────────────────────────────────
// A sustained AOE zone construct (Lattice today; any future ground-field
// ability slots in beside it). Deliberately NOT read off `state.firePatches`
// — that entity type carries no source tag (types.ts's `FireEntity`) and the
// existing generic renderer (`drawFirePatch`) is hard-coded flame-colored
// regardless of source, so a wizard's crystal-lattice zone would otherwise
// read as plain fire. The caller tracks its own zone list from the cast
// event instead (see ConstructVfxController's `latticeZones`) — zero
// coupling to the color-blind generic fire render, zero sim edit.

/** Sustained ground-field zone, redrawn every frame into a caller-owned
 *  persistent Graphics (same technique as the Ward/channel-charge).
 *  `lifeFrac` 1=fresh..0=about to expire (caller derives this from its own
 *  elapsed/duration tracking). Only `"shatter"` (wizard/Lattice) has a
 *  bespoke read today; every other style falls back to a plain tinted
 *  disc so a future ground-field ability on another class still gets
 *  something reasonable without a design pass blocking it. */
export function drawGroundField(
  g: Phaser.GameObjects.Graphics,
  at: Vec2,
  radius: number,
  tint: ConstructTint,
  style: ClassConstructStyle,
  lifeFrac: number,
  phaseSec: number,
): void {
  const alpha = Math.min(1, lifeFrac * 3); // quick fade-in; caller shrinks lifeFrac near expiry for fade-out

  if (style === "shatter") {
    // Wizard (Lattice): a crystal-facet ground plane — glowing seam
    // triangulation within the radius, a broken (never smooth-halo)
    // boundary ring, slow upward-drifting crystal dust.
    g.fillStyle(tint.glow, 0.08 * alpha);
    g.fillCircle(at.x, at.y, radius);

    const seg = 14;
    for (let i = 0; i < seg; i++) {
      if (i % 4 === 3) continue; // gap every 4th segment — broken, not a halo
      const a0 = (i / seg) * TAU;
      const a1 = ((i + 0.75) / seg) * TAU;
      g.lineStyle(2, tint.core, 0.45 * alpha);
      g.beginPath();
      g.arc(at.x, at.y, radius, a0, a1);
      g.strokePath();
    }

    const rings = 3;
    for (let r = 1; r <= rings; r++) {
      const rr = (radius * r) / rings;
      const facets = 6 + r * 2;
      for (let i = 0; i < facets; i++) {
        const a = (i / facets) * TAU + (r % 2) * 0.2 + phaseSec * 0.05;
        const x0 = at.x + Math.cos(a) * rr * 0.5;
        const y0 = at.y + Math.sin(a) * rr * 0.5 * 0.4;
        const x1 = at.x + Math.cos(a) * rr;
        const y1 = at.y + Math.sin(a) * rr * 0.4;
        g.lineStyle(1, tint.glow, 0.3 * alpha);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.strokePath();
      }
    }

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const rr = radius * (0.3 + (i % 3) * 0.2);
      const bob = (phaseSec * 20 + i * 37) % 40;
      g.fillStyle(tint.mote, 0.4 * alpha * (1 - bob / 40));
      g.fillCircle(at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr * 0.4 - bob, 1.6);
    }
  } else {
    // Generic fallback — a soft radiant disc in the class's own tint, no
    // facet grid (a bespoke read is a design decision for whenever that
    // class actually gets a ground-field ability, not something to guess
    // at here).
    g.fillStyle(tint.glow, 0.1 * alpha);
    g.fillCircle(at.x, at.y, radius);
    g.lineStyle(2, tint.core, 0.4 * alpha);
    g.strokeCircle(at.x, at.y, radius);
  }
}

// ── Ghost Guard near-miss (Phase 3 read) ────────────────────────────────────
// Ghost Guard's banked-dodge charge is consumed SILENTLY (combat.ts's
// tryDeflectDamage: "victim phased through, nothing to apply or announce" —
// no SimEvent at all). Deliberately NOT the empowered-hit-flourish shape:
// nothing landed, so there's no impact core-flash and no damage read. A
// quick double-silhouette flicker reads as "you hit the afterimage, not
// me" — Interstice's own tether/echo register (chassis-design-axioms.md
// CA5), at hit-reaction scale rather than mobility scale.

/** Ghost Guard's near-miss read at the defender's own position. */
export function spawnGhostGuardDodge(pool: ParticlePool, at: Vec2, tint: ConstructTint): void {
  const g = pool.acquireBolt();
  if (!g) return;
  g.setPosition(0, 0);
  g.setAlpha(1);
  g.setScale(1);
  g.setRotation(0);
  g.setBlendMode(Phaser.BlendModes.ADD);

  const draw = (t: number): void => {
    g.clear();
    const fade = 1 - t;
    // Two silhouette rings — one holds, one splits away and dissolves — the
    // "which one was real" flicker. Restrained relative to an actual landed
    // hit (no core-flash punch — nothing landed), but still has to actually
    // register against a busy battlefield background (harness screenshot
    // check: the original 0.35/0.5 alphas read as effectively invisible,
    // not just "subtle").
    for (const sgn of [-1, 1]) {
      const off = sgn * t * 14;
      g.lineStyle(2.2, tint.glow, fade * 0.55);
      g.beginPath();
      g.arc(at.x + off, at.y, 15, 0, TAU);
      g.strokePath();
    }
    // A thin outward ripple — the near-miss passing THROUGH, not landing.
    const rippleR = 10 + t * 30;
    g.lineStyle(2, tint.core, fade * 0.75);
    g.beginPath();
    g.arc(at.x, at.y, rippleR, 0, TAU);
    g.strokePath();
    // A brief bright pinpoint at the origin — just enough to anchor the eye
    // to WHERE the near-miss happened without reading as an impact.
    g.fillStyle(tint.core, fade * 0.6);
    g.fillCircle(at.x, at.y, 3);
  };
  draw(0);
  transientVfx.spawn({
    factory: () => g,
    lifetimeMs: 220,
    ease: "Sine.easeOut",
    onTick: (_obj, t) => draw(t),
    release: () => pool.release(g),
  });
}
