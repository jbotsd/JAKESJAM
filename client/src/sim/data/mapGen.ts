// Deterministic arena generator — WALL-MOVEMENT structured, validator-gated.
//
// Rewritten for the Super Meat Boy / Warframe wall kit (docs/character-
// controller-overhaul.md): the jetpack is gone, so VERTICAL traversal is
// wall-jumping up shafts. Every arena is built from tall SOLID columns
// (a `platform` taller than the one-way cap of 24px is solid 4-way → a
// grabbable wall) arranged so that:
//   • columns sit within SHAFT_MAX of the outer wall or a sibling column,
//     forming climbable shafts,
//   • perches sit at shaft tops (reachable by wall-jumping the shaft),
//   • thin one-way ledges give lateral hop routes,
//   • ≥2 low ledges are a plain jump off the floor (routes up),
// checked by a route-graph validator that models BOTH jump edges AND
// shaft/wall-jump reachability BEFORE the map is allowed to exist.
//
// Deterministic: `gen:N` expands to byte-identical geometry on client and
// server. PURE MODULE: no Math.random, no Date, no Phaser, no DOM.
//
// "Diagonals & sky" vocabulary (docs/map-design.md, 2026-07-16 extension):
//   • DIAGONAL ASCENT CHAINS — runs of small one-way steps along a slope
//     line (each rise ≤ MAX_STEP_RISE, each edge gap within the jump-arc
//     model). They substitute for SOME T2/T3 shelves — a vocabulary mix.
//   • SKY ARCHIPELAGO — a level band of aerial islands in the upper third,
//     entered by 6-step floor-to-sky ramps, level-hop chained (≤ falling
//     gap law) so the sky is a traversable LAYER.
//   • PROFILES — genProfileForSeed(seed) picks "standard" | "sky-heavy"
//     ("sky-heavy" inverts density: thinner floor lips/floaters, more
//     chains + a wider archipelago), derived from a dedicated seed hash.
//
// "Wall-rich vertical" vocabulary (docs/map-design.md, 2026-07-17 extension —
// Jake: the wall-bounce/climb kit is the game's best verb; the shortage is
// GEOMETRY that invites it). Measured on a live sim harness 2026-07-14:
// wall-kick 173px rise / 427px carry; same-wall pogo climb ~200px/s
// sustained; jump apex 134px (analytic 139). Three additions:
//   • KICK-SHAFT PAIRS — parallel solid walls 200-400px apart rising
//     300-600px, capped with a perch ledge. The lone "chimney" concept
//     generalized and made common (vertical profile: 2-3 mandatory).
//   • SKY-BAND WALL FINS — short `wall`-kind slabs hung beside archipelago
//     islands so wall-bounce chains extend INTO the sky; each fin gates a
//     "fin perch" above the island band (jump-unreachable, kick-reachable).
//   • LONG DIAGONAL CHAINS — 7-10 step ramps spanning a large fraction of
//     the arena width ("large ramps" in the rectangle grammar).
// The reachability model gained matching wall-kick edges (single-wall pogo
// climb + kick), replacing the dead "jetpack-gated perch" exemption: the
// jetpack is DEAD CODE (player.ts sets jetpackActive=false unconditionally),
// so a perch is only lawful if a kickable wall sits within kick reach.
//
// RNG-STREAM DISCIPLINE (determinism across this change): the ORIGINAL
// generator draws all run on the untouched base stream in their original
// order/count; every NEW choice draws from a separate `deco` sub-stream
// (base seed + DECO_SALT). Same seed = same map, absolutely — and the base
// skeleton for a given (seed, attempt) is provably the same sequence of
// base-stream values as before this vocabulary landed. All 2026-07-17
// vertical-vocabulary draws sit AFTER every pre-existing deco draw.
//
// TUNING PASS (2026-07-17, Jake verbatim: "58% less horizonals 60% more
// well places verticale structures expand make 2x"):
//   1. HORIZONTAL BUDGET −58% — lips, T1/T2/T3 shelves, floaters and
//      chain-fallback shelves are COLLECTED (base-stream draws untouched)
//      and a deco cull pass keeps round(0.42·n) of them. Diagonal-chain
//      steps are ramp vocabulary, NOT horizontals — odds unchanged.
//   2. VERTICALS ×1.6 — kick-shaft + fin budgets raised ~1.6× in EVERY
//      profile; shafts rise 400-1000 (mid-band connectors) and a full-
//      height SKY SPIRE pair overhangs the island band (floor→sky route
//      by construction). Fins prefer placements whose perch is NOT
//      already inside an existing solid's kick envelope (new route-graph
//      edges over redundant ones). The chimney's base-stream odds cannot
//      move without perturbing the pinned skeleton — its 1.6× share is
//      carried by the shaft budget instead.
//   3. ARENA 3000×1100 → 3000×2200 (DOUBLE HEIGHT). Tier grammar is
//      unchanged at the floor; the sky band moves to the new upper third
//      (yBand 604-748); entry ramps grow to 12-13 steps; the openness
//      band is recalibrated for tall arenas (see DENSITY_*_TALL) and a
//      tall-only "upper-half reach" law forbids bottom-heavy candidates.
//   This pass reshapes the DECO stream wholesale (budget dials change
//   draw counts), so gen:<seed> maps are content-updated — the same
//   precedent as every vocabulary landing. The BASE stream is untouched
//   (pin test) and same-seed determinism holds absolutely from here on.

import type {
  LaunchPadDefinition,
  MapDefinition,
  PlatformDefinition,
  Vec2,
} from "../types.js";

// ── Arena AABB — Hot Lobby mega scale (≤16 vessels).
// ALWAYS a full solid floor (recoverable ground). Side walls keep you in.
// Open sky (partial ceiling). Elevated plates are hop-chained from ground.
const ARENA_W = 3000;
/** 2026-07-17 Jake dial 3 "expand make 2x" — DOUBLE HEIGHT (was 1100).
 *  Interpreted as vertical expansion (coherent with the −58% horizontal /
 *  +60% vertical dials); flag in review if he meant full 2x. */
const ARENA_H = 2200;
const WALL = 32;
const FLOOR_H = 36;
const PLAT_H = 18; // thin one-way ledge thickness (≤ 24 → pass-through)
/** Standing surface of the always-present ground floor.
 *  NOTE: 2164 ≡ 4 (mod 8) — mult-8 rise arithmetic must anchor its band
 *  constants at ≡4 offsets (see yBand) so exact-sum ramps stay exact. */
const FLOOR_TOP = ARENA_H - FLOOR_H; // 2164

// ── Movement-derived law constants (docs/map-design.md) ──────────────────
/** Max rise a standard jump may be asked to clear. Analytic apex is 139px;
 *  the MEASURED apex is 134px (2026-07-14 harness) — 129 keeps real margin. */
export const MAX_STEP_RISE = 129;
/** Max horizontal gap while RISING to a higher platform. */
export const MAX_GAP_RISING = 180;
/** Max horizontal gap when FALLING/level (full-speed arc). */
export const MAX_GAP_FALLING = 300;
/** Sightline cap on the ground band — cover pylons must break snipes.
 *  ~½ screen at 960p; scales for mega width as mid-range brawls. */
export const MAX_SIGHTLINE = 480;
/** Openness band: structure vs AABB — CLASSIC scale (< TALL_ARENA_H),
 *  i.e. the curated 1100-tall docks and sealed boxes. Full floor + cover
 *  sits mid-band. Curated maps keep evaluating against THIS band. */
export const DENSITY_MIN = 0.06;
export const DENSITY_MAX = 0.28;
/** Arenas at least this tall use the TALL openness band below. */
export const TALL_ARENA_H = 1600;
/** Openness band for TALL (2200) generated arenas — recalibrated for the
 *  2x-height AABB (2026-07-17). The full floor alone is ≈0.030 of the
 *  doubled AABB (it was ≈0.060 at 1100), so the classic 0.06 floor would
 *  reject EVERY healthy tall map — this is a conscious law change, not a
 *  silent widening. Measured across seeds 0-399 with all three dials +
 *  the island field live: density spans 0.067-0.160, median ≈0.113.
 *  Band = that spread with honest margin: min 0.05 (≈1.7× floor-alone —
 *  a skeleton candidate with no real structure quota stays illegal),
 *  max 0.17 (≈1.5× the healthy median; above that a 2200-tall arena
 *  reads as corridor mess — for calibration, 0.17 tall "fills" like
 *  0.34 would at 1100, well past the classic 0.28 cap, and the extra
 *  headroom is deliberately granted to WALL mass, not shelf clutter). */
export const DENSITY_MIN_TALL = 0.05;
export const DENSITY_MAX_TALL = 0.17;
/** Jake dial 1 (2026-07-17): horizontal shelf budget multiplier — the
 *  deco cull keeps round(0.42·n) of the collected budget horizontals. */
export const HORIZ_KEEP = 0.42;
/** Minimum spawn separation — open silhouettes pack 16 pads across
 *  islands + tiers; 280 keeps FFA honest without forcing a sealed box. */
export const MIN_SPAWN_DIST = 280;

// ── Wall-movement law constants (docs/character-controller-overhaul.md) ──
/** A `platform` taller than this is SOLID 4-way (grabbable). Mirrors
 *  ONE_WAY_MAX_HEIGHT_PX in collision.ts — the reason columns can be walls. */
export const GRAB_MIN_H = 25;
/** Max gap between two facing grab walls that can still be climbed as a
 *  shaft. MEASURED (2026-07-14 harness): a held wall-kick carries 427px
 *  wall-to-wall, so ≤400 guarantees the chain; was 230 (an unmeasured
 *  conservative guess from wall-jump vx alone). */
export const SHAFT_MAX = 400;
/** Min gap for a DESIGNED kick-shaft pair — narrower pinches the player. */
export const KICK_SHAFT_GAP_MIN = 200;
/** Conservative wall-kick envelope for the reachability model (measured
 *  173px rise / 427px carry — the model must never over-claim). */
export const KICK_RISE = 160;
export const KICK_CARRY = 380;
/** Max height a wall's BOTTOM edge may hang above a standing surface and
 *  still be latchable with a plain jump (measured apex 134px). */
export const WALL_LATCH_RISE = 120;
/** Extra reach ABOVE a shaft's climb-top for the final wall-jump hop. The true
 *  wall-jump apex is 720²/(2·1450) ≈ 178.8px (vy -720, rise gravity 1450); we
 *  sit a hair UNDER it so the reachability model never OVER-claims. */
export const WALL_JUMP_UP = 178;
/** Horizontal reach of a wall-jump onto a side ledge. */
export const GRAB_REACH_SIDE = 200;

// ── Jump-arc physics (mirrors player.ts M). The reachability model must not
//    over-approximate: rise and gap trade off along a REAL arc, so a platform
//    near the max rise admits far less horizontal gap than a level hop. Using
//    independent rise/gap budgets was a wrong-PASS risk (agent audit).
const JUMP_V0 = 635; // |jumpVelocity|
const JUMP_GRAV = 1450; // rise-phase gravity
const RUN_SPEED = 330; // maxGroundSpeed
/** Apex height of a plain jump (~139px). */
export const JUMP_APEX = (JUMP_V0 * JUMP_V0) / (2 * JUMP_GRAV);

/** Max horizontal gap a jump can cross while RISING to a platform `rise` px
 *  above: (time to reach that height) × run speed. Solves rise = v0·t − ½g·t²
 *  for the earliest t. Returns -1 when `rise` is above the apex. */
export function maxGapForRise(rise: number): number {
  if (rise <= 0) return MAX_GAP_FALLING;
  const disc = JUMP_V0 * JUMP_V0 - 2 * JUMP_GRAV * rise;
  if (disc < 0) return -1; // above apex — unreachable by a plain jump
  const t = (JUMP_V0 - Math.sqrt(disc)) / JUMP_GRAV;
  return RUN_SPEED * t;
}

// ── Seeded PRNG (mulberry32 — same family the bots use) ─────────────────
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const snap8 = (v: number) => Math.round(v / 8) * 8;

// ── Allocation profiles (docs/map-design.md "Diagonals & sky") ───────────

export type GenProfile = "standard" | "sky-heavy" | "vertical";

/** Salt for the decoration sub-stream (diagonal chains + sky archipelago).
 *  Keeps every NEW random choice off the base geometry stream. */
const DECO_SALT = 0x51ab7e0d;

/** Deterministic per-seed allocation profile. Derived from a DEDICATED hash
 *  stream of the seed (never the geometry streams), so profile choice cannot
 *  perturb any RNG draw order; stable across repair attempts.
 *  3-way split (2026-07-17): the sky-heavy band (r < 0.30) is UNCHANGED from
 *  the 2-way split — every previously sky-heavy seed still is. "vertical"
 *  (kick-shaft dense, ~23% of seeds) is carved out of the former standard
 *  range, so those standard seeds are reassigned — a content update, same
 *  precedent as the vocabulary changes themselves. */
export function genProfileForSeed(seed: number): GenProfile {
  const r = mulberry32((seed ^ 0x5eedbead) >>> 0)();
  if (r < 0.3) return "sky-heavy";
  if (r < 0.53) return "vertical";
  return "standard";
}

// ── Generation ───────────────────────────────────────────────────────────

/**
 * Generate one recoverable arena:
 *   • ALWAYS a full solid floor (fall → land → climb back)
 *   • side walls contain play; partial ceiling (open sky center)
 *   • cover pylons break floor-band snipes (≤ MAX_SIGHTLINE)
 *   • elevated plates hop-chained from ground (rise ≤ MAX_STEP_RISE)
 *   • diagonal ascent chains + sky archipelago (deco stream, see header)
 *
 * `rand` is the ORIGINAL base geometry stream (draw order preserved
 * verbatim); `deco` is the decoration sub-stream for all NEW vocabulary;
 * `profile` comes from genProfileForSeed.
 */
export function generateCandidate(
  rand: () => number,
  deco: () => number,
  profile: GenProfile,
): MapDefinition {
  const platforms: PlatformDefinition[] = [];
  let idc = 0;
  const nid = (p: string) => `${p}-${idc++}`;
  const skyHeavy = profile === "sky-heavy";

  // Solid columns placed so far (covers + chimney walls + kick-shaft walls
  // + sky fins). Diagonal-chain steps must not sit their CENTER inside one —
  // a fully-embedded step would make the route-graph over-claim ("reachable"
  // but unusable). Partial edge overlap with a column is harmless (one-way
  // ledge beside a wall). `y1` = bottom edge for FLOATING solids (fins);
  // omitted = rooted at the floor.
  const solids: { x0: number; x1: number; top: number; y1?: number }[] = [];

  // Solid grab column from a baseY up to `top`.
  const addColumn = (cx: number, w: number, top: number, baseY = FLOOR_TOP) => {
    const h = Math.max(GRAB_MIN_H + 8, baseY - top);
    const px = snap8(cx);
    const py = snap8(top + h / 2);
    const sh = snap8(h);
    platforms.push({
      id: nid("col"),
      kind: "platform",
      position: { x: px, y: py },
      size: { x: w, y: sh },
    });
    solids.push({ x0: px - w / 2, x1: px + w / 2, top: py - sh / 2 });
  };
  const addLedge = (cx: number, w: number, top: number) => {
    platforms.push({
      id: nid("ledge"),
      kind: "platform",
      position: { x: snap8(cx), y: top + PLAT_H / 2 },
      size: { x: snap8(w), y: PLAT_H },
    });
  };
  // BUDGET HORIZONTALS (Jake dial 1, −58%): lips / T1-T3 shelves /
  // floaters / chain-fallback shelves are COLLECTED here — every base-
  // stream draw happens exactly where it always did — and a deco cull
  // pass (after the launch-pad rolls) emits round(HORIZ_KEEP·n) of them.
  // Nest, chimney ledges, shaft caps/sides/rests, sky islands and fin
  // perches are structural vocabulary, not budget horizontals.
  const pendH: { cx: number; w: number; top: number }[] = [];
  // Partial roof plate (not full-width → open sky, no ceiling clamp).
  const addRoofPlate = (cx: number, w: number, top: number) => {
    platforms.push({
      id: nid("roof"),
      kind: "wall",
      position: { x: snap8(cx), y: top + 14 },
      size: { x: snap8(w), y: 28 },
    });
  };

  // ── Diagonal-chain machinery (all randomness from `deco`) ──────────
  // Every dimension is an exact multiple of 8 (widths of 16 so half-widths
  // stay multiples of 8), which keeps step centres on the snap grid and
  // edge gaps EXACT against the jump-arc law — no snap drift.
  const drawRise = () => 96 + 8 * Math.floor(deco() * 5); // 96..128 ≤ MAX_STEP_RISE
  const drawStepW = () => 96 + 16 * Math.floor(deco() * 3); // 96|112|128
  const drawGap = () => 32 + 8 * Math.floor(deco() * 3); // 32..48 ≪ maxGapForRise(96)≈64
  const X_MIN = WALL + 48;
  const X_MAX = ARENA_W - WALL - 48;
  const stepEmbedded = (cx: number, top: number) =>
    solids.some(
      (s) => cx > s.x0 - 8 && cx < s.x1 + 8 && top + PLAT_H > s.top && top < (s.y1 ?? FLOOR_TOP),
    );
  const addChainStep = (chain: number, i: number, cx: number, w: number, top: number) => {
    platforms.push({
      id: `diag-${chain}-${i}`,
      kind: "platform",
      position: { x: cx, y: top + PLAT_H / 2 },
      size: { x: w, y: PLAT_H },
    });
  };
  let chainCount = 0;
  // Every successfully-laid chain records its BASE (first step + the
  // direction that actually fit + the base surface) so the launch-pad pass
  // at the END of generation (deco stream, after all other draws — see the
  // RNG-stream discipline header) can optionally seat a pad in front of it.
  // dir is ±1 (the direction layChain actually used — `-dir` widens the
  // literal type to number, hence not `1 | -1` here).
  type ChainBase = { firstCx: number; firstW: number; dir: number; baseTop: number };
  const chainBases: ChainBase[] = [];

  /** Lay a diagonal ascent chain: step i rises rises[i] above the previous
   *  (the first above `startBase`), advancing `dir` with exact edge gaps —
   *  a flowing slope line, reachable by construction (rise ≤ MAX_STEP_RISE,
   *  gap ≤ maxGapForRise). Tries `dir`, then the flip; null if neither fits
   *  inside the walls without embedding a step centre in a solid column. */
  const layChain = (
    anchorCx: number,
    rises: number[],
    dir: 1 | -1,
    startBase = FLOOR_TOP,
    gapDraw: () => number = drawGap,
  ): { cx: number; w: number; top: number } | null => {
    const ws = rises.map(() => drawStepW());
    const gaps = rises.map(() => gapDraw());
    for (const d of [dir, -dir] as const) {
      const steps: { cx: number; w: number; top: number }[] = [];
      let cx = anchorCx;
      let top = startBase;
      let ok = true;
      for (let i = 0; i < rises.length; i++) {
        if (i > 0) cx += d * (ws[i - 1]! / 2 + gaps[i]! + ws[i]! / 2);
        top -= rises[i]!;
        if (cx - ws[i]! / 2 < X_MIN || cx + ws[i]! / 2 > X_MAX || stepEmbedded(cx, top)) {
          ok = false;
          break;
        }
        steps.push({ cx, w: ws[i]!, top });
      }
      if (!ok) continue;
      const chain = chainCount++;
      for (let i = 0; i < steps.length; i++) {
        addChainStep(chain, i, steps[i]!.cx, steps[i]!.w, steps[i]!.top);
      }
      chainBases.push({
        firstCx: steps[0]!.cx,
        firstW: steps[0]!.w,
        dir: d,
        baseTop: startBase,
      });
      return steps[steps.length - 1]!;
    }
    return null;
  };
  // Chain substitutions for T2/T3 shelves are DEFERRED until after the
  // chimney exists (so `solids` is complete for embed checks).
  type ChainReq = { anchorCx: number; steps: number; dir: 1 | -1; fallbackW: number; fallbackTop: number };
  const chainReqs: ChainReq[] = [];

  const colW = snap8(36 + rand() * 12);
  const STEP = 108; // hop rise ≤ MAX_STEP_RISE

  // ── ALWAYS full ground floor + side walls (recoverable, contained) ─
  platforms.push({
    id: "floor",
    kind: "floor",
    position: { x: ARENA_W / 2, y: ARENA_H - FLOOR_H / 2 },
    size: { x: ARENA_W, y: FLOOR_H },
  });
  platforms.push({
    id: "wall-left",
    kind: "wall",
    position: { x: WALL / 2, y: ARENA_H / 2 },
    size: { x: WALL, y: ARENA_H },
  });
  platforms.push({
    id: "wall-right",
    kind: "wall",
    position: { x: ARENA_W - WALL / 2, y: ARENA_H / 2 },
    size: { x: WALL, y: ARENA_H },
  });
  // Partial ceiling shards (open sky center)
  addRoofPlate(snap8(380 + rand() * 80), snap8(600 + rand() * 120), 16);
  addRoofPlate(snap8(ARENA_W - 380 - rand() * 80), snap8(600 + rand() * 120), 16);

  // ── SIGHTLINE COVER on the ground band (~every 420–480px) ─────────
  const coverCount = 5 + Math.floor(rand() * 2);
  const coverSpan = ARENA_W - 2 * WALL - 200;
  for (let i = 0; i < coverCount; i++) {
    const cx = snap8(WALL + 120 + (coverSpan * (i + 0.5)) / coverCount + (rand() - 0.5) * 40);
    const h = snap8(80 + rand() * 50);
    addColumn(cx, snap8(40 + rand() * 20), FLOOR_TOP - h, FLOOR_TOP);
    // Low lip next to some covers (sky-heavy: thin them out — sparser floor)
    if (rand() < 0.55) {
      const lipX = snap8(cx + (rand() < 0.5 ? -70 : 70));
      const lipW = snap8(70 + rand() * 30);
      if (!skyHeavy || deco() < 0.45) pendH.push({ cx: lipX, w: lipW, top: FLOOR_TOP - 36 });
    }
  }

  // ── Elevated plates hop-chained from ground (recoverable) ──────────
  // T1 always present — launch pads across the floor.
  const t1Count = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < t1Count; i++) {
    const cx = snap8(WALL + 200 + ((ARENA_W - 2 * WALL - 400) * (i + 0.5)) / t1Count + (rand() - 0.5) * 60);
    pendH.push({ cx, w: snap8(200 + rand() * 100), top: FLOOR_TOP - STEP });
  }
  // T2 asymmetric — not every column. SOME slots trade the shelf for a
  // diagonal ascent chain (vocabulary mix — never all of them). Odds raised
  // 2026-07-17 (0.35/0.55 → 0.5/0.65) — Jake wants denser diagonal content.
  const chainOdds = skyHeavy ? 0.65 : 0.5;
  const t2Slots = [0.2, 0.5, 0.8].filter(() => rand() < 0.85);
  for (const t of t2Slots) {
    const cx = snap8(WALL + 180 + (ARENA_W - 2 * WALL - 360) * t + (rand() - 0.5) * 80);
    const w = snap8(160 + rand() * 90);
    if (deco() < chainOdds) {
      chainReqs.push({
        anchorCx: cx,
        steps: 3,
        dir: deco() < 0.5 ? -1 : 1,
        fallbackW: w,
        fallbackTop: FLOOR_TOP - 2 * STEP,
      });
    } else {
      pendH.push({ cx, w, top: FLOOR_TOP - 2 * STEP });
    }
  }
  // T3 sparse high — same shelf-or-chain mix, one step longer.
  const t3SlotOrChain = (cx: number, w: number) => {
    if (deco() < chainOdds) {
      chainReqs.push({
        anchorCx: cx,
        steps: 3 + (deco() < 0.5 ? 0 : 1),
        dir: deco() < 0.5 ? -1 : 1,
        fallbackW: w,
        fallbackTop: FLOOR_TOP - 3 * STEP,
      });
    } else {
      pendH.push({ cx, w, top: FLOOR_TOP - 3 * STEP });
    }
  };
  if (rand() < 0.9) t3SlotOrChain(snap8(ARENA_W * (0.25 + rand() * 0.15)), snap8(150 + rand() * 60));
  if (rand() < 0.9) t3SlotOrChain(snap8(ARENA_W * (0.6 + rand() * 0.2)), snap8(150 + rand() * 60));
  // Nest / perch (cx recorded for the vertical profile's tier stack — the
  // capture is RNG-neutral: same draws, same order).
  const nestCx = snap8(ARENA_W * 0.5 + (rand() - 0.5) * 120);
  addLedge(nestCx, snap8(160 + rand() * 50), FLOOR_TOP - 4 * STEP);

  // ONE optional chimney over center T1
  if (rand() < 0.75) {
    const chimMid = snap8(ARENA_W / 2 + (rand() - 0.5) * 100);
    const chimneyGap = snap8(170 + rand() * 35);
    const chimneyTop = FLOOR_TOP - 4 * STEP - 20;
    const half = chimneyGap / 2 + colW / 2;
    addColumn(chimMid - half, colW, chimneyTop, FLOOR_TOP - STEP);
    addColumn(chimMid + half, colW, chimneyTop, FLOOR_TOP - STEP);
    addLedge(chimMid - half - 70, 100, FLOOR_TOP - STEP - 6);
    addLedge(chimMid + half + 70, 100, FLOOR_TOP - STEP - 6);
    addLedge(chimMid, chimneyGap + 28, chimneyTop - 4);
    addLedge(chimMid - half - 70, 95, FLOOR_TOP - 2.5 * STEP);
  }

  // A few side floaters, always within hop of a T1/T2 plate
  // (sky-heavy: most are dropped — density moves into the sky instead)
  for (let f = 0; f < 3 + Math.floor(rand() * 3); f++) {
    const side = rand() < 0.5 ? 1 : -1;
    const cx = snap8(ARENA_W / 2 + side * (400 + rand() * 900));
    const tier = 1 + Math.floor(rand() * 2);
    const w = snap8(100 + rand() * 50);
    const top = FLOOR_TOP - tier * STEP - snap8(rand() * 30);
    if (!skyHeavy || deco() < 0.4) pendH.push({ cx, w, top });
  }

  // ── DIAGONAL ASCENT CHAINS (deferred T2/T3 substitutions) ──────────
  // Emitted now that all solid columns exist for the embed check. A chain
  // that fits in neither direction falls back to the original shelf.
  for (const req of chainReqs) {
    const rises = Array.from({ length: req.steps }, () => drawRise());
    const apex = layChain(req.anchorCx, rises, req.dir);
    if (!apex) pendH.push({ cx: req.anchorCx, w: req.fallbackW, top: req.fallbackTop });
  }

  // ── SKY ARCHIPELAGO — a traversable aerial LAYER in the upper third ─
  // Entry: floor-to-sky diagonal ramps (large flowing lines). At 2200
  // tall the band sits at yBand 604-748 (≡4 mod 8, matching FLOOR_TOP's
  // grid offset so ramp rise sums stay exact) and entry ramps grow to
  // 12-13 steps (~118px each ≤ MAX_STEP_RISE). The band itself is LEVEL
  // islands hop-chained with falling-law gaps, so every island is route-
  // reachable from a ramp apex (level hop = falling branch of the arc
  // law, gaps ≤ 256 < MAX_GAP_FALLING). Open-sky-center convention is
  // untouched: islands are thin one-way ledges, no ceiling.
  const yBand = 604 + 8 * Math.floor(deco() * 19); // 604..748 (≤ 0.36·ARENA_H)
  const riseUnits = (FLOOR_TOP - yBand) / 8; // exact — both ≡4 (mod 8)
  const rampRises = (steps: number): number[] => {
    const base = Math.floor(riseUnits / steps);
    const extra = riseUnits - base * steps;
    return Array.from({ length: steps }, (_, i) => 8 * (base + (i < extra ? 1 : 0)));
  };
  const rampSteps = Math.ceil((FLOOR_TOP - yBand) / 120); // 12..13
  const apexes: { cx: number; w: number; top: number }[] = [];
  if (skyHeavy) {
    // Two ramps rising inward — two routes into the sky layer. A 13-step
    // ramp can span ~2300px, so anchors hug the walls; one retry each,
    // pulled further out, if the first anchor snags a solid.
    for (const side of [1, -1] as const) {
      const f0 = side === 1 ? 0.18 : 0.82;
      let a = layChain(snap8(ARENA_W * f0), rampRises(rampSteps), side);
      if (!a) a = layChain(snap8(ARENA_W * (f0 - side * 0.07)), rampRises(rampSteps), side);
      if (a) apexes.push(a);
    }
  } else {
    for (let att = 0; att < 3 && apexes.length === 0; att++) {
      const fromLeft = deco() < 0.5;
      const anchor = snap8(ARENA_W * (fromLeft ? 0.08 + deco() * 0.1 : 0.82 + deco() * 0.1));
      const a = layChain(anchor, rampRises(rampSteps), fromLeft ? 1 : -1);
      if (a) apexes.push(a);
    }
  }
  const drawIslandW = () => 96 + 16 * Math.floor(deco() * 5); // 96..160
  const drawIslandGap = () => 176 + 8 * Math.floor(deco() * 11); // 176..256 ≤ MAX_GAP_FALLING
  // Non-sky-heavy targets raised (2026-07-17): islands are the anchoring
  // substrate for fins + sky spires — the ×1.6 vertical budget needs the
  // extra anchor points (vertical most of all: 3-4 fins want 6-8 islands).
  const islandTarget =
    profile === "sky-heavy"
      ? 9 + Math.floor(deco() * 4)
      : profile === "vertical"
        ? 6 + Math.floor(deco() * 3)
        : 4 + Math.floor(deco() * 3);
  let islandsPlaced = 0;
  // Placed-island record for the wall-fin pass below (RNG-neutral capture).
  const islandRecs: { cx: number; w: number }[] = [];
  for (const apex of apexes) {
    // Spread level islands BOTH ways from each apex.
    const perDir = Math.ceil(islandTarget / (apexes.length * 2));
    for (const d of [1, -1] as const) {
      let cx = apex.cx;
      let w = apex.w;
      for (let i = 0; i < perDir && islandsPlaced < islandTarget; i++) {
        const nw = drawIslandW();
        const gap = drawIslandGap();
        cx += d * (w / 2 + gap + nw / 2);
        w = nw;
        if (cx - nw / 2 < X_MIN || cx + nw / 2 > X_MAX) break;
        platforms.push({
          id: nid("sky"),
          kind: "platform",
          position: { x: cx, y: yBand + PLAT_H / 2 },
          size: { x: nw, y: PLAT_H },
        });
        islandRecs.push({ cx, w: nw });
        islandsPlaced++;
      }
    }
  }

  // ── LAUNCH PADS at diagonal-chain bases (map-design.md item 3) ─────
  // A pad on the floor in front of a chain's first step, firing up-slope:
  // running at the ramp converts approach speed into the ascent line
  // (sim/launchPad.ts — approach speed preserved, "hitting a ramp at
  // speed"). RNG-stream discipline: pad rolls draw from `deco` AFTER
  // every existing deco draw in this function (chains, archipelago), so
  // all prior draws — base AND deco — are byte-identical to the
  // pre-launch-pad generator. Static geometry: zero WorldState bytes.
  const launchPads: LaunchPadDefinition[] = [];
  const PAD_ODDS = skyHeavy ? 0.65 : 0.5;
  for (const cb of chainBases) {
    if (launchPads.length >= 4) break; // cap well under MAX_LAUNCH_PADS=16
    if (deco() >= PAD_ODDS) continue;
    const px = snap8(cb.firstCx - cb.dir * (cb.firstW / 2 + 56));
    if (px - 48 < X_MIN || px + 48 > X_MAX) continue;
    // Never seat a pad inside a solid column (cover pylons, chimney).
    if (solids.some((s) => px + 48 > s.x0 && px - 48 < s.x1)) continue;
    launchPads.push({
      id: `pad-${launchPads.length}`,
      position: { x: px, y: cb.baseTop - 6 },
      size: { x: 96, y: 12 },
      impulse: { x: cb.dir * 460, y: -700 },
    });
  }

  // ── HORIZONTAL BUDGET CULL (Jake dial 1: "58% less horizonals") ─────
  // Emit exactly round(HORIZ_KEEP·n) of the collected budget horizontals:
  // one deco draw per pending ledge, classic exact-count selection (keep
  // item i with probability need/remaining — unbiased, single pass,
  // deterministic). Runs BEFORE the wall-vocabulary passes so their
  // ledge-embed checks see the FINAL horizontal set.
  {
    let remaining = pendH.length;
    let need = Math.round(HORIZ_KEEP * pendH.length);
    for (const l of pendH) {
      if (deco() * remaining < need) {
        addLedge(l.cx, l.w, l.top);
        need--;
      }
      remaining--;
    }
  }

  // ══ WALL-RICH VERTICAL VOCABULARY (2026-07-17) ═════════════════════
  // Everything below draws from `deco` strictly AFTER every pre-existing
  // draw (base AND deco) — the RNG-stream discipline in the header holds.
  const vertical = profile === "vertical";

  // A NARROW one-way ledge whose center sits inside [x0,x1] with its top
  // inside [top,bot] would be (near-)fully swallowed by a new solid →
  // over-claiming route graph. WIDE ledges (≥160) keep plenty of standable
  // span when a wall crosses them — same "partial overlap is harmless" rule
  // the chimney side ledges already rely on.
  const ledgeInBody = (x0: number, x1: number, top: number, bot: number) =>
    platforms.some(
      (p) =>
        p.kind === "platform" &&
        p.size.y < GRAB_MIN_H &&
        p.size.x < 160 &&
        p.position.x > x0 - 8 &&
        p.position.x < x1 + 8 &&
        p.position.y - p.size.y / 2 >= top - 8 &&
        p.position.y - p.size.y / 2 <= bot + 8,
    );

  // ── KICK-SHAFT PAIRS — the signature climb structure ───────────────
  // Parallel solid walls, gap 200-400 (measured wall-kick carry 427 —
  // wall-to-wall chains guaranteed; 200 min so the player isn't pinched),
  // rising 300-600 off the floor. Cap perch on top (wall-gated payoff),
  // optional side ledges (tier stacking), vertical-profile rest ledge.
  const addShaftWall = (id: string, cx: number, w: number, top: number) => {
    const h = FLOOR_TOP - top;
    platforms.push({
      id,
      kind: "platform",
      position: { x: cx, y: top + h / 2 },
      size: { x: w, y: h },
    });
    solids.push({ x0: cx - w / 2, x1: cx + w / 2, top });
  };
  // Shared wall-site check for shaft/spire walls. Standoff (48px — no
  // merged silhouettes, no sub-player-width pinch slots; body is 26 wide)
  // applies to TALL solids only: SHORT floor furniture (covers, ≤160
  // tall) may be merged/overlapped outright — a pocket beside a cover is
  // ≤130 deep, under the 134px jump apex, so it can never trap — because
  // at 2200 tall the floor band is too crowded for every column to demand
  // 48px of moat. Launch-pad guard: never seat on a pad, nor within its
  // low launch arc — a wall there cancels the launch velocity and
  // re-opens the pad's stateless gate (refire chatter; authoring law).
  const wallSiteOk = (x0: number, x1: number, top: number) =>
    x0 >= X_MIN &&
    x1 <= X_MAX &&
    !solids.some(
      (s2) => (s2.y1 ?? FLOOR_TOP) - s2.top > 160 && x1 > s2.x0 - 48 && x0 < s2.x1 + 48,
    ) &&
    !ledgeInBody(x0, x1, top, FLOOR_TOP) &&
    !launchPads.some((lp) => {
      const inFootprint = x1 > lp.position.x - 72 && x0 < lp.position.x + 72;
      const upstream = lp.impulse.x > 0 ? x0 - lp.position.x : lp.position.x - x1;
      return inFootprint || (upstream >= 0 && upstream < 360);
    });
  let shaftsPlaced = 0;

  // ── SKY SPIRE — full-height kick-shaft pair overhanging the island
  // band: THE floor→sky connector (dial 2 "well-placed" made literal —
  // a spire adds floor→sky route-graph edges by construction: its cap
  // perch sits 28px above the band within a falling hop of its anchor
  // island). Placed FIRST (before the mid-band shafts crowd the floor),
  // island-adjacent, never overlapping the archipelago. Early attempts
  // anchor the OUTERMOST islands facing outward — beyond the entry ramp's
  // diagonal, where a 1450px column has room to exist.
  if (islandRecs.length > 0 && (vertical || deco() < 0.5)) {
    const top = yBand - 24;
    const h = FLOOR_TOP - top;
    const byCx = [...islandRecs].sort((p, q) => p.cx - q.cx);
    for (let a = 0; a < 20; a++) {
      let isl: { cx: number; w: number };
      let d: number;
      if (a < 8) {
        // Outermost island, outward-facing; alternate ends.
        isl = a % 2 === 0 ? byCx[byCx.length - 1]! : byCx[0]!;
        d = a % 2 === 0 ? 1 : -1;
      } else {
        isl = islandRecs[Math.floor(deco() * islandRecs.length)]!;
        d = deco() < 0.5 ? -1 : 1;
      }
      const gap = KICK_SHAFT_GAP_MIN + 8 * Math.floor(deco() * 26); // 200..400
      const wallW = 32 + 8 * Math.floor(deco() * 2); // 32|40
      const clear = 24 + 8 * Math.floor(deco() * 6); // island-edge clearance 24..64
      const mid = snap8(isl.cx + d * (isl.w / 2 + clear + wallW + gap / 2));
      const half = gap / 2 + wallW / 2;
      const fits = [mid - half, mid + half].every((cx) => {
        const x0 = cx - wallW / 2;
        const x1 = cx + wallW / 2;
        return (
          wallSiteOk(x0, x1, top) &&
          !islandRecs.some((o) => x1 > o.cx - o.w / 2 - 16 && x0 < o.cx + o.w / 2 + 16)
        );
      });
      if (!fits) continue;
      const n = shaftsPlaced++;
      addShaftWall(`ks-${n}-a`, mid - half, wallW, top);
      addShaftWall(`ks-${n}-b`, mid + half, wallW, top);
      addLedge(mid, gap + 28, top - 4); // cap perch — a falling hop from the band
      // Rest ledges at ⅓ and ⅔ of the ~1450px climb.
      for (let k = 1; k <= 2; k++) {
        const ry = snap8(top + (h * k) / 3);
        if (!stepEmbedded(mid, ry)) addLedge(mid, gap - 48, ry);
      }
      break;
    }
  }

  // ── KICK-SHAFT PAIRS (mid-band) — budgets ×1.6 (Jake dial 2) in every
  // profile; the chimney's share of the "chimney-style columns" dial
  // rides here too (its base-stream odds are pinned). With the spire the
  // expected pair counts land at:
  //   vertical  2.5 → 3-4 + spire  (E≈4.4, mandatory ≥3 in generateArena)
  //   standard  1.35 → 1-2 + spire@0.5 (E≈2.1)
  //   sky-heavy 0.5 → 0-1 + spire@0.5 (E≈0.85)
  const shaftCount = vertical
    ? 3 + (deco() < 0.5 ? 1 : 0)
    : skyHeavy
      ? (deco() < 0.4 ? 1 : 0)
      : 1 + (deco() < 0.6 ? 1 : 0);
  for (let s = 0; s < shaftCount; s++) {
    const gap = KICK_SHAFT_GAP_MIN + 8 * Math.floor(deco() * 26); // 200..400
    const wallW = 32 + 8 * Math.floor(deco() * 2); // 32|40
    // 400-1000 (was 304-600): at 2200 tall a shaft is a FLOOR→MID-BAND
    // connector — cap perches land at y 1164-1764, one wall-jump under
    // the long-chain tops. "Well-placed" = it feeds the tier stack, not
    // a stub in the void.
    const h = 400 + 8 * Math.floor(deco() * 76); // 400..1000
    const top = FLOOR_TOP - h;
    const half = gap / 2 + wallW / 2;
    for (let a = 0; a < 40; a++) {
      const mid = snap8(320 + deco() * (ARENA_W - 640));
      const fits = [mid - half, mid + half].every((cx) =>
        wallSiteOk(cx - wallW / 2, cx + wallW / 2, top),
      );
      if (!fits) continue;
      const n = shaftsPlaced++;
      addShaftWall(`ks-${n}-a`, mid - half, wallW, top);
      addShaftWall(`ks-${n}-b`, mid + half, wallW, top);
      addLedge(mid, gap + 28, top - 4); // cap perch — kick the shaft to earn it
      const sideL = mid - half - wallW / 2 - 56;
      const sideR = mid + half + wallW / 2 + 56;
      if (deco() < 0.7 && !stepEmbedded(sideL, top + 16)) addLedge(sideL, 96, top + 16);
      if (deco() < 0.7 && !stepEmbedded(sideR, top + 16)) addLedge(sideR, 96, top + 16);
      // Mid-climb rest ledge — tall shafts breathe (all profiles now that
      // heights reach 1000; reachable by falling from the cap perch).
      if (h >= 560 && !stepEmbedded(mid, snap8(top + h / 2))) {
        addLedge(mid, gap - 48, snap8(top + h / 2));
      }
      break;
    }
  }

  // ── SKY-BAND WALL FINS — wall-bounce chains extend INTO the sky ─────
  // A short solid slab (kind `wall` → grabbable, non-standable, zero
  // density/sightline footprint) hung beside an island: latch it from the
  // island (bottom hangs below island top), pogo to its top, kick onto the
  // paired FIN PERCH above the band — jump-unreachable (rise 184 > 129)
  // but comfortably inside the measured kick envelope (120 ≤ KICK_RISE).
  const FIN_W = 24;
  // Budgets ×1.6 (Jake dial 2): vertical 2 → 3.2, sky-heavy 2.5 → 4,
  // standard 1.4 → 2.25 expected.
  const finCount =
    islandRecs.length === 0
      ? 0
      : vertical
        ? 3 + (deco() < 0.2 ? 1 : 0)
        : skyHeavy
          ? 3 + Math.floor(deco() * 3)
          : 2 + (deco() < 0.25 ? 1 : 0);
  // Dial 2 "well-placed": a fin whose perch is ALREADY inside an existing
  // solid's kick envelope adds a redundant route-graph edge — early
  // placement attempts skip those and hunt for a NEW edge instead.
  const kickCoveredBySolid = (x0: number, x1: number, top: number) =>
    solids.some((s) => {
      const lat = Math.max(s.x0 - x1, x0 - s.x1, 0);
      return lat <= KICK_CARRY && top >= s.top - KICK_RISE;
    });
  // A fin site is an (island, side) pair — its geometry is deterministic,
  // so a failed site is CONSUMED rather than blindly re-rolled (the old
  // random re-pick burned attempts re-failing the same 48px standoff).
  const finSites: { cx: number; w: number; d: 1 | -1 }[] = [];
  for (const isl of islandRecs) {
    finSites.push({ cx: isl.cx, w: isl.w, d: -1 }, { cx: isl.cx, w: isl.w, d: 1 });
  }
  let finsPlaced = 0;
  for (let f = 0; f < finCount; f++) {
    let placed = false;
    for (let a = 0; a < 10 && finSites.length > 0 && !placed; a++) {
      const si = Math.floor(deco() * finSites.length);
      const site = finSites[si]!;
      const d = site.d;
      const fh = 104 + 8 * Math.floor(deco() * 13); // 104..200 tall
      const finTop = yBand - 64;
      const finCx = snap8(site.cx + d * (site.w / 2 + 60));
      const fx0 = finCx - FIN_W / 2;
      const fx1 = finCx + FIN_W / 2;
      const perchCx = snap8(finCx + d * 88);
      // Novelty is a PREFERENCE (first two attempts, site NOT consumed):
      // a spire beside the band kick-covers a ±550px swath — hard-skipping
      // for redundancy there would starve the fin budget.
      if (a < 2 && kickCoveredBySolid(perchCx - 48, perchCx + 48, finTop - 120)) continue;
      finSites.splice(si, 1); // consumed, fit or not
      if (fx0 < X_MIN || fx1 > X_MAX) continue;
      if (perchCx - 48 < X_MIN || perchCx + 48 > X_MAX) continue;
      // Never overlap an island span or another new solid; never swallow a
      // ledge (ramp apex steps live at this height); never embed the perch
      // in a solid (a sky spire can stand this high).
      if (islandRecs.some((o) => fx1 > o.cx - o.w / 2 - 16 && fx0 < o.cx + o.w / 2 + 16)) continue;
      if (solids.some((s2) => fx1 > s2.x0 - 48 && fx0 < s2.x1 + 48)) continue;
      if (ledgeInBody(fx0, fx1, finTop, finTop + fh)) continue;
      if (stepEmbedded(perchCx, finTop - 120)) continue;
      platforms.push({
        id: `fin-${finsPlaced}`,
        kind: "wall",
        position: { x: finCx, y: finTop + fh / 2 },
        size: { x: FIN_W, y: fh },
      });
      solids.push({ x0: fx0, x1: fx1, top: finTop, y1: finTop + fh }); // floating solid
      platforms.push({
        id: `finperch-${finsPlaced}`,
        kind: "platform",
        position: { x: perchCx, y: finTop - 120 + PLAT_H / 2 },
        size: { x: 96, y: PLAT_H },
      });
      finsPlaced++;
      placed = true;
    }
  }

  // ── LONG DIAGONAL CHAIN — the "large ramp" ─────────────────────────
  // 7-10 steps with gentler rises (72..88 ≤ MAX_STEP_RISE) and a TIGHTER
  // gap draw: the earliest-crossing arc model gives gentler rises LESS
  // rising gap, not more (maxGapForRise(72) ≈ 44) — so 32|40 here.
  // Spans a big fraction of the arena width in one flowing line.
  const longOdds = vertical ? 0.9 : skyHeavy ? 0.3 : 0.5;
  const drawGapLong = () => 32 + 8 * Math.floor(deco() * 2); // 32|40 < 44
  if (deco() < longOdds) {
    for (let a = 0; a < 3; a++) {
      const steps = 7 + Math.floor(deco() * 4); // 7..10
      const rises = Array.from({ length: steps }, () => 72 + 8 * Math.floor(deco() * 3));
      const fromLeft = deco() < 0.5;
      const anchor = snap8(ARENA_W * (fromLeft ? 0.13 + deco() * 0.1 : 0.77 + deco() * 0.1));
      if (layChain(anchor, rises, fromLeft ? 1 : -1, FLOOR_TOP, drawGapLong)) break;
    }
  }

  // ── VERTICAL PROFILE: taller tier stacking above the nest ──────────
  // Zigzag ladder (rise 104 ≤ 129, x-overlap → rising gap 0) pushing the
  // central spine 1-3 tiers above the classic nest line.
  if (vertical) {
    const stackN = 3 + (deco() < 0.5 ? 1 : 0); // 3-4 at 2200 tall (was 2-3)
    let sx = nestCx;
    let stop = FLOOR_TOP - 4 * STEP;
    for (let i = 0; i < stackN; i++) {
      sx = snap8(sx + (i % 2 === 0 ? 1 : -1) * 88);
      stop -= 104;
      if (stop < yBand + 16) break; // stay under the island band
      if (stepEmbedded(sx, stop)) break;
      addLedge(sx, 96, stop);
    }
  }

  // ── VERTICAL ISLAND FIELD (2026-07-17, Jake mid-task: "more verticle
  // islands") — the archipelago is not ONE shelf: stacked island columns
  // (`skycol-<col>-<i>`) descend from band islands through the airspace
  // toward the mid band, zigzagging within the hop grammar (rise 104-128
  // with guaranteed x-overlap → rising gap 0, always legal; downward is
  // a plain fall). Every stack chains to its band anchor, so the field
  // rides the band's route-graph reachability — a 3D island field you
  // climb THROUGH, not a shelf you arrive at. Sky-heavy and vertical are
  // dramatically island-rich; standard gets a lighter version.
  const stackCols =
    islandRecs.length === 0
      ? 0
      : skyHeavy
        ? 5 + Math.floor(deco() * 3) // 5-7 columns
        : vertical
          ? 4 + Math.floor(deco() * 3) // 4-6
          : 2 + Math.floor(deco() * 2); // 2-3
  const stackDepthMax = vertical || skyHeavy ? 4 : 3;
  const usedAnchors = new Set<number>();
  const STACK_FLOOR = FLOOR_TOP - 4 * STEP - 60; // stay above the tier stack
  const stackRecs: { col: number; cx: number; w: number; top: number }[] = [];
  let stackIslands = 0;
  for (let c = 0; c < stackCols && stackIslands < 24; c++) {
    // Pick an unused band anchor (3 tries, deterministic).
    let ai = -1;
    for (let t = 0; t < 3 && ai < 0; t++) {
      const cand = Math.floor(deco() * islandRecs.length);
      if (!usedAnchors.has(cand)) ai = cand;
    }
    if (ai < 0) continue;
    usedAnchors.add(ai);
    const anchor = islandRecs[ai]!;
    const depth = 2 + Math.floor(deco() * (stackDepthMax - 1)); // 2..max
    let cx = anchor.cx;
    let w = anchor.w;
    let top = yBand;
    for (let i = 0; i < depth && stackIslands < 24; i++) {
      const rise = 104 + 8 * Math.floor(deco() * 4); // 104..128 ≤ MAX_STEP_RISE
      const nw = drawIslandW();
      // Zigzag offset, capped so spans keep x-overlap (rising gap 0).
      const maxOff = (w + nw) / 2 - 8;
      const off = (i % 2 === 0 ? 1 : -1) * Math.min(40 + 8 * Math.floor(deco() * 7), maxOff);
      const ncx = snap8(cx + off);
      const ntop = top + rise;
      if (ntop > STACK_FLOOR) break;
      if (ncx - nw / 2 < X_MIN || ncx + nw / 2 > X_MAX) break;
      if (stepEmbedded(ncx, ntop)) break;
      // Don't cross-stack onto existing thin ledges at this height (ramp
      // steps, caps, other stacks) — the field reads as clean columns.
      const clash = platforms.some((p) => {
        if (p.kind !== "platform" || p.size.y >= 24) return false;
        const pt = p.position.y - p.size.y / 2;
        return (
          Math.abs(pt - ntop) < 48 &&
          ncx + nw / 2 > p.position.x - p.size.x / 2 - 16 &&
          ncx - nw / 2 < p.position.x + p.size.x / 2 + 16
        );
      });
      if (clash) break;
      platforms.push({
        id: `skycol-${c}-${i}`,
        kind: "platform",
        position: { x: ncx, y: ntop + PLAT_H / 2 },
        size: { x: nw, y: PLAT_H },
      });
      stackRecs.push({ col: c, cx: ncx, w: nw, top: ntop });
      stackIslands++;
      cx = ncx;
      w = nw;
      top = ntop;
    }
  }

  // ── STACK-ANCHORED FINS (second fin pass) — the island field grows its
  // own wall-bounce content: a fin beside the DEEPEST island of a stack
  // column, same construction as band fins but relative to the anchor's
  // own top. Extends kick-chains through the middle of the field.
  const deepAnchors: { cx: number; w: number; top: number }[] = [];
  {
    const byCol = new Map<number, { cx: number; w: number; top: number }>();
    for (const r of stackRecs) {
      const prev = byCol.get(r.col);
      if (!prev || r.top > prev.top) byCol.set(r.col, r);
    }
    deepAnchors.push(...byCol.values());
  }
  const fin2Count =
    deepAnchors.length === 0
      ? 0
      : vertical || skyHeavy
        ? 1 + (deco() < 0.5 ? 1 : 0)
        : deco() < 0.5
          ? 1
          : 0;
  // A thin one-way ledge intersecting the rect [x0..x1]×[y0..y1] (±16/±8
  // slack) — y-aware clash check (band fins could be purely x-based
  // because ALL their obstacles shared the band height; the field can't).
  const thinLedgeInRect = (x0: number, x1: number, y0: number, y1: number) =>
    platforms.some((p) => {
      if (p.kind !== "platform" || p.size.y >= 24) return false;
      const pt = p.position.y - p.size.y / 2;
      return (
        pt >= y0 - 8 &&
        pt <= y1 + 8 &&
        x1 > p.position.x - p.size.x / 2 - 16 &&
        x0 < p.position.x + p.size.x / 2 + 16
      );
    });
  const fin2Sites: { cx: number; w: number; top: number; d: 1 | -1 }[] = [];
  for (const a of deepAnchors) fin2Sites.push({ ...a, d: -1 }, { ...a, d: 1 });
  for (let f = 0; f < fin2Count; f++) {
    let placed = false;
    for (let a = 0; a < 8 && fin2Sites.length > 0 && !placed; a++) {
      const si = Math.floor(deco() * fin2Sites.length);
      const site = fin2Sites[si]!;
      fin2Sites.splice(si, 1); // consumed, fit or not
      const d = site.d;
      const fh = 104 + 8 * Math.floor(deco() * 13); // 104..200
      const finTop = site.top - 64;
      const finCx = snap8(site.cx + d * (site.w / 2 + 60));
      const fx0 = finCx - FIN_W / 2;
      const fx1 = finCx + FIN_W / 2;
      const perchCx = snap8(finCx + d * 88);
      if (fx0 < X_MIN || fx1 > X_MAX) continue;
      if (perchCx - 48 < X_MIN || perchCx + 48 > X_MAX) continue;
      if (solids.some((s2) => fx1 > s2.x0 - 48 && fx0 < s2.x1 + 48)) continue;
      if (thinLedgeInRect(fx0, fx1, finTop, finTop + fh)) continue;
      if (thinLedgeInRect(perchCx - 48, perchCx + 48, finTop - 152, finTop - 88)) continue;
      if (stepEmbedded(perchCx, finTop - 120)) continue;
      platforms.push({
        id: `fin-${finsPlaced}`,
        kind: "wall",
        position: { x: finCx, y: finTop + fh / 2 },
        size: { x: FIN_W, y: fh },
      });
      solids.push({ x0: fx0, x1: fx1, top: finTop, y1: finTop + fh });
      platforms.push({
        id: `finperch-${finsPlaced}`,
        kind: "platform",
        position: { x: perchCx, y: finTop - 120 + PLAT_H / 2 },
        size: { x: 96, y: PLAT_H },
      });
      finsPlaced++;
      placed = true;
    }
  }

  // ── Spawns: ground lattice first (recoverable), then elevated tops ─
  const SPAWN_TARGET = 16;
  const solidCols = platforms
    .filter(
      (p) =>
        p.id.startsWith("col") ||
        p.id.startsWith("fin-") || // sky fins are kind `wall` — still embed risks
        (p.kind === "platform" && p.size.y >= GRAB_MIN_H),
    )
    .map((p) => ({
      x0: p.position.x - p.size.x / 2 - 10,
      x1: p.position.x + p.size.x / 2 + 10,
      top: p.position.y - p.size.y / 2,
    }));
  const clearOfCols = (x: number, y: number) =>
    solidCols.every((c) => !(x > c.x0 && x < c.x1 && y > c.top));

  type Pad = Vec2 & { pri: number };
  const ordered: Pad[] = [];
  // Ground lattice across the full floor — always landable/recoverable.
  for (let x = WALL + 80; x <= ARENA_W - WALL - 80; x += 300) {
    const y = FLOOR_TOP - 68;
    if (clearOfCols(x, y)) ordered.push({ x: snap8(x), y: snap8(y), pri: 0 });
  }
  for (const p of platforms) {
    if (p.kind !== "platform") continue;
    if (p.size.y >= GRAB_MIN_H) continue; // solid columns
    if (p.id.startsWith("roof")) continue;
    const top = p.position.y - p.size.y / 2;
    const x0 = p.position.x - p.size.x / 2 + 28;
    const x1 = p.position.x + p.size.x / 2 - 28;
    if (x1 <= x0) continue;
    const xs =
      p.size.x > 180
        ? [x0 + 16, (x0 + x1) / 2, x1 - 16]
        : [(x0 + x1) / 2];
    const pri = top < FLOOR_TOP - 2 * STEP ? 1 : 2;
    for (const x of xs) {
      const y = top - 68;
      if (clearOfCols(x, y)) ordered.push({ x: snap8(x), y: snap8(y), pri });
    }
  }
  // Ground first, then high, then mid — left→right within band.
  ordered.sort((a, b) => a.pri - b.pri || a.y - b.y || a.x - b.x);

  const spawns: Vec2[] = [];
  for (const cand of ordered) {
    if (spawns.length >= SPAWN_TARGET) break;
    if (spawns.every((sp) => Math.hypot(sp.x - cand.x, sp.y - cand.y) >= MIN_SPAWN_DIST)) {
      spawns.push({ x: cand.x, y: cand.y });
    }
  }

  const themes = ["voidVessel", "crystalDock", "autogenesHull"] as const;
  return {
    id: "gen",
    name: "Generated Dock",
    arenaTheme: themes[Math.floor(rand() * themes.length)]!,
    size: { x: ARENA_W, y: ARENA_H },
    spawns,
    platforms,
    // Optional/additive — omitted entirely when no chain earned a pad, so
    // pad-less candidates stay shaped exactly like pre-launch-pad maps.
    ...(launchPads.length > 0 ? { launchPads } : {}),
  };
}

// ── Validation (the laws) ────────────────────────────────────────────────

type Top = { x0: number; x1: number; top: number; id: string; kind: string };
type Solid = { x0: number; x1: number; top: number; y1: number; cx: number };

/** True for full-width legacy floor or segmented open-silhouette decks. */
function isFloorId(id: string): boolean {
  return id === "floor" || id.startsWith("floor-");
}

/** Platform TOPS you can stand on: floors + ledges + short cover pads.
 *  Tall tunnel/chimney walls (h ≥ 120 or vt-/col-/tun- ids) are climb
 *  substrate only — not required stand targets. */
function tops(map: MapDefinition): Top[] {
  return map.platforms
    .filter((p) => {
      if (p.id.startsWith("roof") || p.id === "ceiling") return false;
      if (p.id.startsWith("col") || p.id.startsWith("vt-") || p.id.startsWith("tun-"))
        return false;
      if (p.kind === "floor" || isFloorId(p.id)) return true;
      if (p.kind !== "platform") return false;
      // One-way ledges always; short cover pillars (boxworks-mini) yes;
      // full-height chimney walls no.
      return p.size.y < 120;
    })
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
    }));
}

/** Deck tops (ground seeds for reachability BFS). */
function floorTops(map: MapDefinition): Top[] {
  return tops(map).filter((t) => t.kind === "floor" || isFloorId(t.id));
}

/** SOLID grab walls: flank stubs + tall columns (wall-jump substrate).
 *  Lateral duct ceilings (thin horizontal wall plates) are NOT grab walls. */
function grabWalls(map: MapDefinition): Solid[] {
  const out: Solid[] = [];
  for (const p of map.platforms) {
    if (isFloorId(p.id) || p.id === "ceiling" || p.id.startsWith("roof")) continue;
    // Duct ceilings: kind wall, short height, wide — exclude from shaft/embed.
    if (p.id.startsWith("lceil") || p.id.includes("-ceil") || p.id.startsWith("lt-")) {
      if (p.kind === "wall" && p.size.y <= 40) continue;
    }
    if (p.kind === "wall" && p.size.y <= 40 && p.size.x > 80) continue; // any thin wide ceil
    const isOuterWall = p.kind === "wall";
    const isColumn = p.kind === "platform" && p.size.y >= GRAB_MIN_H;
    if (!isOuterWall && !isColumn) continue;
    out.push({
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
      y1: p.position.y + p.size.y / 2,
      cx: p.position.x,
    });
  }
  return out;
}

/** Lateral gap between a top's span and a wall's span (0 when overlapping). */
function lateralGap(t: { x0: number; x1: number }, w: { x0: number; x1: number }): number {
  return Math.max(w.x0 - t.x1, t.x0 - w.x1, 0);
}

/** Can a player standing on `t` jump-latch wall `w` NEAR ITS TOP? The wall
 *  face must be within a sideways jump (GRAB_REACH_SIDE), its bottom no more
 *  than WALL_LATCH_RISE above the feet (measured jump apex 134), and its TOP
 *  inside the window [t.top - KICK_RISE, t.top - 24]: enough face above the
 *  feet to kick from, but close enough that ONE latch reaches it. Sustained
 *  pogo climbs (~200px/s, real) are deliberately NOT modeled — a top gated
 *  behind a long climb stays "unreachable" and must justify itself as a
 *  wall-gated perch (perchViolations); the model never over-claims. */
function wallLatchableFrom(t: Top, w: Solid): boolean {
  return (
    lateralGap(t, w) <= GRAB_REACH_SIDE &&
    t.top - w.y1 <= WALL_LATCH_RISE &&
    w.top <= t.top - 24 &&
    w.top >= t.top - KICK_RISE
  );
}

/** Tops landable by pogo-climbing wall `w` to its top (measured ~200px/s
 *  sustained same-wall climb) and kicking off: conservative envelope of the
 *  measured wall-kick (173px rise / 427px carry → KICK_RISE/KICK_CARRY). */
function wallKickReaches(w: Solid, t: Top): boolean {
  return lateralGap(t, w) <= KICK_CARRY && t.top >= w.top - KICK_RISE;
}

/** Tops reachable by climbing a SHAFT (two grab walls facing within
 *  SHAFT_MAX) and wall-jumping off the top. yClimb = the shorter wall's top
 *  (where both walls still exist); a final hop reaches WALL_JUMP_UP above it
 *  and GRAB_REACH_SIDE to the side. */
function shaftReachable(ts: Top[], walls: Solid[]): Set<string> {
  const reached = new Set<string>();
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i]!;
      const b = walls[j]!;
      const gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0;
      if (gap <= 0 || gap > SHAFT_MAX) continue; // overlapping or too wide
      const yClimb = Math.max(a.top, b.top); // shorter wall's top (higher y)
      const reachTop = yClimb - WALL_JUMP_UP;
      const xLo = Math.min(a.x0, b.x0) - GRAB_REACH_SIDE;
      const xHi = Math.max(a.x1, b.x1) + GRAB_REACH_SIDE;
      for (const t of ts) {
        if (isFloorId(t.id)) continue;
        const cx = (t.x0 + t.x1) / 2;
        // Open maps: allow shaft reach to any ledge above the climb, not only
        // a fixed FLOOR_TOP constant from the generator's default deck.
        // Ledges from hop-top down to just below the shorter wall's top.
        if (cx >= xLo && cx <= xHi && t.top >= reachTop && t.top <= yClimb + 24) {
          reached.add(t.id);
        }
      }
    }
  }
  return reached;
}

/**
 * Route-graph reachability: seed with ALL floor islands + shaft-reachable
 * tops, then BFS over jump-sized edges AND wall-kick edges (2026-07-17: the
 * jetpack is dead code — vertical reach beyond a jump is the wall kit, so
 * the model jump-latches grab walls NEAR THEIR TOP and kicks off within the
 * measured-conservative envelope; sustained pogo climbs are deliberately
 * unmodeled — see wallLatchableFrom). Open silhouettes have many decks.
 */
export function unreachablePlatforms(map: MapDefinition): string[] {
  const realTs = tops(map);
  const decks = floorTops(map);
  if (decks.length === 0) return ["<no-floor>"];
  const walls = grabWalls(map);
  // True slopes (2026-07-17, minimal walk-edge model): each slope
  // contributes two VIRTUAL nodes — a short standable segment at its base
  // corner and one at its crest — connected mutually (you walk the
  // surface both ways). The normal jump/gap relaxation links real
  // platforms to these segments, so "slope crest flush with a deck" reads
  // as an edge. Virtual nodes are excluded from the returned report (they
  // are not platforms); slope-less maps take the identical old path.
  type SlopeNodePair = { baseId: string; topId: string };
  const slopeNodes: Top[] = [];
  const slopePairs: SlopeNodePair[] = [];
  for (const s of map.slopes ?? []) {
    if (!(s.run > 0)) continue;
    const rise = s.run * (s.grade === "2:1" ? 0.5 : 1);
    const baseX = s.base.x;
    const topX = s.base.x + s.dir * s.run;
    const seg = 24; // standable sliver either side of each corner
    const baseId = `slope:${s.id}@base`;
    const topId = `slope:${s.id}@top`;
    slopeNodes.push({
      id: baseId, kind: "platform",
      x0: Math.min(baseX, baseX + s.dir * seg),
      x1: Math.max(baseX, baseX + s.dir * seg),
      top: s.base.y,
    });
    slopeNodes.push({
      id: topId, kind: "platform",
      x0: Math.min(topX, topX - s.dir * seg),
      x1: Math.max(topX, topX - s.dir * seg),
      top: s.base.y - rise,
    });
    slopePairs.push({ baseId, topId });
  }
  const ts = slopeNodes.length > 0 ? [...realTs, ...slopeNodes] : realTs;
  const reached = shaftReachable(ts, walls);
  for (const d of decks) reached.add(d.id);
  const climbed = new Set<number>();
  let grew = true;
  while (grew) {
    grew = false;
    // Slope walk edges: base ↔ top are mutually reachable on-surface.
    for (const pair of slopePairs) {
      const hasBase = reached.has(pair.baseId);
      const hasTop = reached.has(pair.topId);
      if (hasBase !== hasTop) {
        reached.add(pair.baseId);
        reached.add(pair.topId);
        grew = true;
      }
    }
    for (const from of ts) {
      if (!reached.has(from.id)) continue;
      for (const to of ts) {
        if (reached.has(to.id)) continue;
        const rise = from.top - to.top; // positive = going UP
        const gap =
          to.x0 > from.x1 ? to.x0 - from.x1 : from.x0 > to.x1 ? from.x0 - to.x1 : 0;
        const ok =
          rise > 0
            ? rise <= MAX_STEP_RISE && gap <= maxGapForRise(rise)
            : gap <= MAX_GAP_FALLING;
        if (ok) {
          reached.add(to.id);
          grew = true;
        }
      }
    }
    // Wall-kick edges: engage a grab wall from any reached top, pogo-climb
    // to its top, kick onto tops inside the conservative kick envelope.
    for (let i = 0; i < walls.length; i++) {
      if (climbed.has(i)) continue;
      const w = walls[i]!;
      if (!ts.some((t) => reached.has(t.id) && wallLatchableFrom(t, w))) continue;
      climbed.add(i);
      grew = true;
      for (const t of ts) {
        if (!reached.has(t.id) && wallKickReaches(w, t)) reached.add(t.id);
      }
    }
  }
  // Report REAL platforms only — the slope nodes are model scaffolding.
  return realTs.filter((t) => !reached.has(t.id)).map((t) => t.id);
}

/**
 * Wall-gated PERCH audit (law 1, 2026-07-17). The old exemption — "perches
 * are jetpack-gated" — refers to a mechanic that no longer exists
 * (player.ts: jetpackActive = false unconditionally). A platform left
 * unreachable by the route graph is only a LAWFUL perch if a kickable wall
 * surface (kind `wall`, or a solid platform ≥ GRAB_MIN_H) sits within the
 * conservative wall-kick envelope of it (≤ KICK_RISE above a wall top,
 * ≤ KICK_CARRY laterally). Everything else returned here is a map bug.
 */
export function perchViolations(map: MapDefinition): string[] {
  const walls = grabWalls(map);
  return unreachablePlatforms(map).filter((id) => {
    const p = map.platforms.find((q) => q.id === id);
    if (!p) return true; // "<no-floor>" sentinel — always a violation
    const t = {
      id,
      kind: p.kind,
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
    };
    return !walls.some((w) => wallKickReaches(w, t));
  });
}

/** Distinct routes UP from any deck: plain jump onto a ledge, OR a shaft. */
function routesUp(map: MapDefinition): number {
  const ts = tops(map);
  const decks = floorTops(map);
  if (decks.length === 0) return 0;
  const jumpRoutes = ts.filter((t) => {
    if (isFloorId(t.id)) return false;
    return decks.some((floor) => {
      const rise = floor.top - t.top;
      return rise > 0 && rise <= MAX_STEP_RISE;
    });
  }).length;
  const shafts = grabWalls(map);
  let shaftRoutes = 0;
  for (let i = 0; i < shafts.length; i++) {
    for (let j = i + 1; j < shafts.length; j++) {
      const a = shafts[i]!;
      const b = shafts[j]!;
      const gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0;
      if (gap > 0 && gap <= SHAFT_MAX) shaftRoutes++;
    }
  }
  return jumpRoutes + shaftRoutes;
}

/** Longest unbroken sightline across floor islands at shoulder height.
 *  Void fissures between islands break sightlines naturally. */
function worstSightline(map: MapDefinition): number {
  const decks = floorTops(map);
  if (decks.length === 0) return map.size.x;
  // Per-island band: measure open runs on each deck, take global max.
  let worst = 0;
  for (const deck of decks) {
    const bandY = deck.top - 28;
    const blockers = map.platforms
      .filter((p) => p.kind === "platform" || (p.kind === "wall" && !isFloorId(p.id)))
      .filter((p) => {
        const y0 = p.position.y - p.size.y / 2;
        const y1 = p.position.y + p.size.y / 2;
        return bandY >= y0 && bandY <= y1;
      })
      .map((p) => ({ x0: p.position.x - p.size.x / 2, x1: p.position.x + p.size.x / 2 }))
      .filter((b) => b.x1 > deck.x0 && b.x0 < deck.x1)
      .sort((a, b) => a.x0 - b.x0);
    let cursor = deck.x0;
    for (const b of blockers) {
      worst = Math.max(worst, Math.min(b.x0, deck.x1) - cursor);
      cursor = Math.max(cursor, b.x1);
    }
    worst = Math.max(worst, deck.x1 - cursor);
  }
  return worst;
}

function density(map: MapDefinition): number {
  // Structure = platforms + floor islands (open maps have less wall mass).
  const area = map.platforms
    .filter((p) => p.kind === "platform" || p.kind === "floor")
    .reduce((a, p) => a + p.size.x * p.size.y, 0);
  // Denominator = AABB playable region (void is intentional open space).
  const playable = Math.max(1, map.size.x * map.size.y * 0.55);
  return area / playable;
}

/** Half the player body (26w × 56h) + a small margin — a spawn this close to a
 *  solid column embeds the body and the resolver ejects it out of the map. */
const SPAWN_HALF_W = 13 + 6;
const SPAWN_HALF_H = 28 + 6;

function spawnsValid(map: MapDefinition): boolean {
  const ts = tops(map);
  const solids = grabWalls(map).filter((w) => {
    // Tall grab COLUMNS only; flank stubs at x≈0 / x≈map.w are not embed risks.
    return w.cx > 80 && w.cx < map.size.x - 80;
  });
  // Lowest deck top (largest y) — used only as an upper bound for embed checks.
  const decks = floorTops(map);
  const lowestDeckTop =
    decks.length > 0 ? Math.max(...decks.map((d) => d.top)) : map.size.y;
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i]!;
    // Standing pad: platform top within 40..120px below spawn y (y-down).
    const under = ts.some(
      (t) => s.x >= t.x0 - 8 && s.x <= t.x1 + 8 && t.top > s.y && t.top - s.y < 120,
    );
    if (!under) return false;
    // No spawn embedded in a solid column.
    for (const c of solids) {
      const overlapsX = s.x + SPAWN_HALF_W > c.x0 && s.x - SPAWN_HALF_W < c.x1;
      const overlapsY = s.y > c.top && s.y - 2 * SPAWN_HALF_H < lowestDeckTop + 40;
      if (overlapsX && overlapsY) return false;
    }
    for (let j = i + 1; j < map.spawns.length; j++) {
      const o = map.spawns[j]!;
      if (Math.hypot(s.x - o.x, s.y - o.y) < MIN_SPAWN_DIST) return false;
    }
  }
  // Mega Hot Lobby law: ≥12 well-separated pads (16 target; 12 still FFA-honest).
  const minSpawns = map.size.x >= 2000 ? 12 : 4;
  return map.spawns.length >= minSpawns;
}

export type MapValidation = {
  ok: boolean;
  unreachable: string[];
  routesUp: number;
  sightline: number;
  density: number;
  spawnsOk: boolean;
  /** Tall-arena law (size.y ≥ TALL_ARENA_H): at least one non-floor
   *  standable top in the upper HALF — a 2200-tall arena whose play all
   *  hugs the bottom is a failed candidate, not an "open" one. Always
   *  true for classic-scale maps (the law doesn't apply). */
  upperReach: boolean;
};

/** Size-aware openness bounds: curated 1100 docks and sealed boxes keep
 *  the classic band; 2200-tall generated arenas use the recalibrated
 *  tall band (see DENSITY_MIN_TALL rationale). */
function densityBounds(map: MapDefinition): { min: number; max: number } {
  return map.size.y >= TALL_ARENA_H
    ? { min: DENSITY_MIN_TALL, max: DENSITY_MAX_TALL }
    : { min: DENSITY_MIN, max: DENSITY_MAX };
}

export function validateMap(map: MapDefinition): MapValidation {
  const unreachable = unreachablePlatforms(map);
  const routes = routesUp(map);
  const sight = worstSightline(map);
  const dens = density(map);
  const spawnsOk = spawnsValid(map);
  const { min, max } = densityBounds(map);
  const upperReach =
    map.size.y < TALL_ARENA_H ||
    tops(map).some((t) => !isFloorId(t.id) && t.top <= map.size.y * 0.5);
  return {
    ok:
      unreachable.length === 0 &&
      routes >= 2 &&
      sight <= MAX_SIGHTLINE &&
      dens >= min &&
      dens <= max &&
      spawnsOk &&
      upperReach,
    unreachable,
    routesUp: routes,
    sightline: sight,
    density: dens,
    spawnsOk,
    upperReach,
  };
}

// ── Public entry ─────────────────────────────────────────────────────────

export const GEN_MAP_PREFIX = "gen:";
const MAX_ATTEMPTS = 60;

/**
 * Deterministically produce a VALID arena for a seed. Invalid candidates
 * advance the attempt counter (seeded), so (seed → map) is a pure function.
 */
export function generateArena(seed: number): MapDefinition {
  const profile = genProfileForSeed(seed);
  const name =
    profile === "sky-heavy"
      ? `Sky Dock #${seed}`
      : profile === "vertical"
        ? `Shaft Dock #${seed}`
        : `Dock #${seed}`;
  let lastFail: MapValidation | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const base = (seed ^ (attempt * 0x9e3779b9)) >>> 0;
    const rand = mulberry32(base);
    const deco = mulberry32((base + DECO_SALT) >>> 0);
    const candidate = generateCandidate(rand, deco, profile);
    const v = validateMap(candidate);
    // Vertical profile CONTRACT: ≥3 kick-shaft pairs are mandatory (raised
    // from 2 with the 2026-07-17 ×1.6 vertical budget). A crowded candidate
    // that seats fewer rerolls like any law failure (same deterministic
    // repair-or-reroll machinery).
    const ksPairs = candidate.platforms.filter((p) => /^ks-\d+-a$/.test(p.id)).length;
    // Sky-heavy CONTRACT: the archipelago is the profile's identity — a
    // candidate whose ramps failed into a thin sky (< 8 islands) rerolls.
    const skyIslands = candidate.platforms.filter((p) => p.id.startsWith("sky-")).length;
    if (
      v.ok &&
      (profile !== "vertical" || ksPairs >= 3) &&
      (profile !== "sky-heavy" || skyIslands >= 8)
    ) {
      return { ...candidate, id: `${GEN_MAP_PREFIX}${seed}`, name };
    }
    lastFail = v;
  }
  // Surface last failure in the throw path below via void ref (debug aid).
  void lastFail;
  // Statistically unreachable (every real seed validates well within
  // MAX_ATTEMPTS). But NEVER ship an UNVALIDATED map — a future constant change
  // could make the old hardcoded fallback invalid and silently ship a broken
  // arena. Scan fixed fallback seeds and return the first that VALIDATES; the
  // scan is deterministic so (seed → map) stays pure.
  for (let f = 0; f < 256; f++) {
    const fb = (0xfa11bacc + f * 0x9e3779b9) >>> 0;
    // Fallback stays the most conservative profile — its only job is validity.
    const cand = generateCandidate(mulberry32(fb), mulberry32((fb + DECO_SALT) >>> 0), "standard");
    if (validateMap(cand).ok) {
      return { ...cand, id: `${GEN_MAP_PREFIX}${seed}`, name };
    }
  }
  // Truly unreachable — if even 256 fallback seeds fail, the laws are
  // self-contradictory (a build bug). Surface it loudly rather than ship junk.
  throw new Error("mapGen: no valid arena found — validator laws are unsatisfiable");
}

export function isGenMapId(id: string | undefined): boolean {
  return !!id && id.startsWith(GEN_MAP_PREFIX);
}

export function parseGenSeed(id: string): number | null {
  if (!isGenMapId(id)) return null;
  const n = Number(id.slice(GEN_MAP_PREFIX.length));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
