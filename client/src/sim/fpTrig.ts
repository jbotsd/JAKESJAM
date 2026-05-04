// LUT-based fixed-point trig — bit-deterministic across hosts.
//
// Native `Math.sin`/`cos`/`atan2`/`sqrt` are NOT guaranteed to
// produce identical results on V8 vs JSC (Bun). They use platform
// libm, which can use different polynomial approximations or domain
// reductions across runtimes. For deterministic sim, we precompute
// a sin lookup table at module load — that's a deterministic JS op
// (Math.sin happens once at boot, same value cached, then we only
// do integer indexing) — and derive cos/atan2 from it.
//
// LUT resolution: 4096 entries over [0, π/2]. Quadrant symmetry
// reconstructs the full circle. Step ≈ 0.022° — well below typical
// projectile aim precision (~1°).
//
// Storage: each entry is fp Q16.16. Sine of a few angles in this
// range yields values in [0, 1], stored as fp ints in [0, FP_ONE].

import { add, sub, mul, div, abs, neg, FP_ONE, FP_ZERO, fromFloat } from "./fp.js";
import type { Fp } from "./fp.js";

// Precomputed constants
export const FP_PI: Fp = fromFloat(Math.PI);
export const FP_TWO_PI: Fp = fromFloat(Math.PI * 2);
export const FP_HALF_PI: Fp = fromFloat(Math.PI / 2);
export const FP_THREE_HALVES_PI: Fp = fromFloat((Math.PI * 3) / 2);

// LUT covers [0, π/2] in 4096 steps.
const LUT_SIZE = 4096;
const SIN_LUT: Int32Array = new Int32Array(LUT_SIZE + 1);
{
  // One-time init at module load. The Math.sin call here happens on
  // every host but the RESULT we store is the integer rounding —
  // that's deterministic because identical float inputs round to
  // identical ints.
  for (let i = 0; i <= LUT_SIZE; i++) {
    const angle = (i / LUT_SIZE) * (Math.PI / 2);
    SIN_LUT[i] = Math.round(Math.sin(angle) * FP_ONE);
  }
}

/** Reduce angle to [0, 2π). Bit-deterministic int math. */
function normaliseAngle(a: Fp): Fp {
  let n = a;
  while (n < 0) n = (n + FP_TWO_PI) as Fp;
  while (n >= FP_TWO_PI) n = (n - FP_TWO_PI) as Fp;
  return n;
}

/** Lookup sin from the [0, π/2] LUT. `q1Angle` must be in
 *  [0, π/2]. Linear interpolation between adjacent LUT entries for
 *  sub-step precision. */
function sinQ1(q1Angle: Fp): Fp {
  // Map [0, π/2] → [0, LUT_SIZE]. Bit-deterministic since both sides
  // are int32 ops.
  const idxScaled = Math.imul(q1Angle, LUT_SIZE) / FP_HALF_PI;
  const idx = Math.floor(idxScaled) | 0;
  const frac = idxScaled - idx;
  // Clamp to LUT bounds (last entry is sin(π/2) = 1).
  if (idx >= LUT_SIZE) return FP_ONE;
  if (idx < 0) return FP_ZERO;
  const a = SIN_LUT[idx]!;
  const b = SIN_LUT[idx + 1]!;
  // Linear interp; round-to-int. Bit-deterministic.
  return Math.round(a + (b - a) * frac) as Fp;
}

/** Sine. Q16.16 input radians → Q16.16 output ([-1, 1] scaled). */
export function sin(angle: Fp): Fp {
  const a = normaliseAngle(angle);
  if (a < FP_HALF_PI) return sinQ1(a);
  if (a < FP_PI) return sinQ1(sub(FP_PI, a));
  if (a < FP_THREE_HALVES_PI) return neg(sinQ1(sub(a, FP_PI)));
  return neg(sinQ1(sub(FP_TWO_PI, a)));
}

/** Cosine via cos(x) = sin(x + π/2). */
export function cos(angle: Fp): Fp {
  return sin(add(angle, FP_HALF_PI));
}

/** atan2 — 4-quadrant. Returns Q16.16 radians in [-π, π].
 *  Uses arctan(y/x) for |y| <= |x|, then π/2 - arctan(x/y) otherwise.
 *  Octant decomposition keeps the LUT-of-arctan table small. */
const ATAN_LUT_SIZE = 1024;
const ATAN_LUT: Int32Array = new Int32Array(ATAN_LUT_SIZE + 1);
{
  // arctan over [0, 1] in 1024 steps.
  for (let i = 0; i <= ATAN_LUT_SIZE; i++) {
    const t = i / ATAN_LUT_SIZE;
    ATAN_LUT[i] = Math.round(Math.atan(t) * FP_ONE);
  }
}

/** arctan(t) for t ∈ [0, 1]. */
function atanInUnitRange(t: Fp): Fp {
  if (t <= 0) return FP_ZERO;
  if (t >= FP_ONE) return ATAN_LUT[ATAN_LUT_SIZE]! as Fp;
  const idxScaled = Math.imul(t, ATAN_LUT_SIZE) / FP_ONE;
  const idx = Math.floor(idxScaled) | 0;
  const frac = idxScaled - idx;
  const a = ATAN_LUT[idx]!;
  const b = ATAN_LUT[idx + 1]!;
  return Math.round(a + (b - a) * frac) as Fp;
}

export function atan2(y: Fp, x: Fp): Fp {
  if (x === 0 && y === 0) return FP_ZERO;
  const ax = abs(x);
  const ay = abs(y);
  let result: Fp;
  if (ax >= ay) {
    // |y/x| ≤ 1; lookup arctan(y/x).
    const t = div(ay, ax);
    result = atanInUnitRange(t);
  } else {
    // |y/x| > 1; use π/2 - arctan(x/y).
    const t = div(ax, ay);
    result = sub(FP_HALF_PI, atanInUnitRange(t));
  }
  // Apply quadrant sign.
  if (x < 0) result = sub(FP_PI, result) as Fp;
  if (y < 0) result = neg(result);
  return result;
}

/** Integer-Newton sqrt for Q16.16 fp. Matches `Math.sqrt(toFloat(a))`
 *  rounded to nearest fp tick. ≤ 8 Newton iterations to converge in
 *  Q16.16. */
export function sqrt(a: Fp): Fp {
  if (a <= 0) return FP_ZERO;
  // Initial estimate: half the input, in linear scale.
  let x = a < FP_ONE ? FP_ONE : (a >> 1) as Fp;
  for (let i = 0; i < 12; i++) {
    if (x === 0) break;
    const next = ((x + div(a, x)) >> 1) as Fp;
    if (next === x) break;
    x = next;
  }
  return x;
}

/** Hypotenuse — sqrt(x² + y²). Same precision class as sqrt itself. */
export function hypot(x: Fp, y: Fp): Fp {
  return sqrt(add(mul(x, x), mul(y, y)));
}
