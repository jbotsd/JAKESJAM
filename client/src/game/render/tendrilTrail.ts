// Pure, Phaser-free math for Priest/Syzygist's "oozing tendril" travel-phase
// body. Consumed by ProjectileVfx.ts's bespoke draw path for a Priest
// tendril shot (renderContract.ts's `ProjectileRenderModel.tendril`, derived
// from `ProjectileEntity.element === "fire" && enemyOnly === true` — see
// sim/constants.ts's SYZ_TENDRIL_* doc comment for the mechanic this
// reskins, and weapon.ts's `isPriestTendril` for why `enemyOnly` is the
// clean, collision-free "this is specifically a Priest tendril" signal
// rather than element or homingStrength alone). Jake, 2026-07-19 (live
// playtest): "and not a projecile a tenril that feels fun" — the underlying
// homing/damage/lifetime sim math is completely unchanged; this file is
// ONLY the travel-phase silhouette.
//
// Technique: a lerp-chain (follow-the-leader) of segments, each one chasing
// the segment ahead of it every frame, rather than recording a raw position
// history the way ProjectileVfx's existing `Trail` ring buffer does for
// every other shape. meleeTiming.ts's `appendBladeTip` already proves out
// the "live per-frame accumulator, pure + testable, capped state" shape in
// this codebase; this borrows that discipline but not that data structure —
// a fixed-length position-history ring buffer fades a STRAIGHT recent path
// (correct for a bolt), whereas a chase-chain visibly LAGS AROUND CORNERS as
// the head's homing steer changes direction, which is what makes the body
// read as writhing/curling instead of a dot dragging a straight streak.
//
// Kept engine-free per this codebase's established convention
// (chassisSilhouette.ts's header comment: `import Phaser from "phaser"`
// throws under `bun test`) so the chain math is unit-testable without a
// live Graphics context.

export type TendrilSegment = { x: number; y: number };

/** Segment count including the head (index 0). 6 gives a visibly writhing
 *  body without adding real per-frame draw-call weight to the always-
 *  additive ProjectileVfx body/trail graphics (5 line segments per tendril,
 *  same order of magnitude as the existing TRAIL_SAMPLES=6 ring buffer). */
export const TENDRIL_SEGMENT_COUNT = 6;

/** Per-second chase rate for each trailing segment closing the gap on the
 *  segment ahead of it. Consumed as `1 - exp(-rate * dt)` so the visible lag
 *  reads the same at 30fps and 240fps instead of the chain snapping tighter
 *  or looser with frame rate. Tuned low enough that a sharp homing turn
 *  visibly bends the body over several frames instead of the whole chain
 *  re-straightening in one frame. */
export const TENDRIL_CHASE_RATE_PER_SEC = 16;

/**
 * Fresh chain, every segment pinned to the spawn point. The caller keys one
 * of these per projectile id (a `Map<id, TendrilSegment[]>`, mirroring
 * ProjectileVfx's existing `trails`/`halos`/`lastPos` maps) and must create
 * a NEW one for a new id rather than resetting an old array in place — that
 * per-id keying is what guarantees no writhe state leaks from a despawned
 * tendril into a new one that happens to render on the same frame.
 */
export function makeTendrilChain(
  x: number,
  y: number,
  count: number = TENDRIL_SEGMENT_COUNT,
): TendrilSegment[] {
  const chain: TendrilSegment[] = [];
  for (let i = 0; i < count; i += 1) chain.push({ x, y });
  return chain;
}

/**
 * Advance one frame. Segment 0 snaps exactly to the live head position — the
 * body's tip IS the sim-authoritative projectile position, so it never
 * drifts from the actual hit-detection point. Every trailing segment then
 * chases the freshly-updated segment ahead of it. Pure/immutable: returns a
 * new array and never mutates `chain`, the same discipline as
 * meleeTiming.ts's `appendBladeTip`.
 */
export function stepTendrilChain(
  chain: readonly TendrilSegment[],
  headX: number,
  headY: number,
  deltaSeconds: number,
  chaseRatePerSec: number = TENDRIL_CHASE_RATE_PER_SEC,
): TendrilSegment[] {
  const next: TendrilSegment[] = new Array(chain.length);
  next[0] = { x: headX, y: headY };
  const t = 1 - Math.exp(-chaseRatePerSec * Math.max(0, deltaSeconds));
  for (let i = 1; i < chain.length; i += 1) {
    const target = next[i - 1]!;
    const prev = chain[i] ?? target;
    next[i] = {
      x: prev.x + (target.x - prev.x) * t,
      y: prev.y + (target.y - prev.y) * t,
    };
  }
  return next;
}

/**
 * Per-segment alpha, head (index 0) brightest, tail fading toward
 * near-transparent — the "bright glowing head, softer transparent tail"
 * the oozing-tendril brief asks for. Never fully zero so the tail-most
 * segment still contributes a faint ooze rather than a hard cutoff.
 */
export function tendrilSegmentAlpha(index: number, count: number): number {
  if (count <= 1) return 1;
  const t = index / (count - 1);
  return Math.max(0.06, 1 - t * 0.94);
}

/**
 * Per-segment width scale (multiplies the projectile's body radius),
 * tapering the tail thinner than the head — a curling ribbon, not a
 * uniform-width line.
 */
export function tendrilSegmentWidthScale(index: number, count: number): number {
  if (count <= 1) return 1;
  const t = index / (count - 1);
  return Math.max(0.22, 1 - t * 0.78);
}
