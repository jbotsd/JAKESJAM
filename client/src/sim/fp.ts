// Q16.16 fixed-point arithmetic — bit-exact deterministic substitute
// for `number` in the sim hot path.
//
// Why: per the deferred plan at /home/jimothy/.claude/plans/...,
// IEEE 754 float math is not bit-deterministic across V8 vs JSC (Bun
// uses JSC). Two hosts running the same sim diverge by ~1e-7 per op,
// and the per-entity reconcile in `clientLoop.ts:687-728` rebuilds
// every tick to chase the drift — exactly the "barely detects
// standing" jitter symptom. Q16.16 ints are bit-exact across hosts
// because integer ops in JS are deterministic (`a + b`, `a - b`, and
// `Math.imul(a, b)` all produce the same int32 result on every
// runtime).
//
// Layout: 32 bits per value, 16 bits integer, 16 bits fractional.
//   range:      [-32768, +32767] integer; 1/65536 ≈ 1.5e-5 fractional
//   resolution: 1.5e-5 px (single-pixel motion encodes as 65536)
//   storage:    JS `number` holds 53-bit ints losslessly, so int32
//               math fits without BigInt overhead
//
// Multiplication uses `Math.imul` and a shift: full Q16.16 × Q16.16
// would overflow int32, so we shift each operand right by 8 first
// (Q24.8 × Q24.8 → Q16.16, which fits int32 cleanly). Some precision
// loss in the bottom 8 fractional bits — acceptable for sim coords
// where 1/256 ≈ 0.004 px is well below visible.
//
// Division is the precision-sensitive op. We promote to native
// number for the divide then truncate back. Division is rare in the
// sim (~25 sites total, mostly the swept-AABB slab method).

export type Fp = number & { readonly __brand: "Fp" };

export const FP_BITS = 16;
export const FP_ONE: Fp = (1 << FP_BITS) as Fp;
export const FP_HALF: Fp = (FP_ONE >> 1) as Fp;
export const FP_ZERO: Fp = 0 as Fp;

// Conversions ────────────────────────────────────────────────────────────

/** Promote an integer (e.g. tile count) to fixed-point. Lossless. */
export const fromInt = (n: number): Fp => ((n | 0) << FP_BITS) as Fp;

/** Convert a float to fp. Used at trust boundaries (map literals,
 *  user input). NEVER call inside the tick loop — the whole point is
 *  to avoid float math. Rounds-half-away-from-zero so identical
 *  floats produce identical fp values across hosts. */
export const fromFloat = (n: number): Fp => Math.round(n * FP_ONE) as Fp;

/** Read fp as float. Used at the render seam only (Phaser scene
 *  needs floats for setPosition). Not in the sim tick loop. */
export const toFloat = (a: Fp): number => a / FP_ONE;

/** Read fp as int (truncates fractional). Used for grid keying and
 *  iteration counts. */
export const toInt = (a: Fp): number => a >> FP_BITS;

// Arithmetic ──────────────────────────────────────────────────────────────

export const add = (a: Fp, b: Fp): Fp => (a + b) as Fp;
export const sub = (a: Fp, b: Fp): Fp => (a - b) as Fp;
export const neg = (a: Fp): Fp => -a as Fp;

/** Q16.16 × Q16.16 → Q16.16 via shift-then-imul. Loses bottom 8 bits
 *  of fractional precision (1/256 px) which is well below visible.
 *  Bit-deterministic: Math.imul produces identical int32 across
 *  hosts. */
export const mul = (a: Fp, b: Fp): Fp =>
  (Math.imul(a >> 8, b >> 8)) as Fp;

/** a / b. Uses native float division then truncates — the result is
 *  deterministic when a and b are int32 (IEEE 754 division of two
 *  exact-int operands rounds the same on every host). */
export const div = (a: Fp, b: Fp): Fp =>
  (Math.trunc((a * FP_ONE) / b)) as Fp;

// Common scalar helpers ───────────────────────────────────────────────────

export const abs = (a: Fp): Fp => (a < 0 ? -a : a) as Fp;
export const min = (a: Fp, b: Fp): Fp => (a < b ? a : b) as Fp;
export const max = (a: Fp, b: Fp): Fp => (a > b ? a : b) as Fp;
export const clamp = (a: Fp, lo: Fp, hi: Fp): Fp =>
  (a < lo ? lo : a > hi ? hi : a) as Fp;
export const sign = (a: Fp): -1 | 0 | 1 => (a > 0 ? 1 : a < 0 ? -1 : 0);

// Comparison (just JS comparison, but typed) ──────────────────────────────

export const lt = (a: Fp, b: Fp): boolean => a < b;
export const le = (a: Fp, b: Fp): boolean => a <= b;
export const gt = (a: Fp, b: Fp): boolean => a > b;
export const ge = (a: Fp, b: Fp): boolean => a >= b;
export const eq = (a: Fp, b: Fp): boolean => a === b;

// Lerp / blend ────────────────────────────────────────────────────────────

/** Linear interpolation in fp space. t is fp in [0, FP_ONE]. */
export const lerp = (a: Fp, b: Fp, t: Fp): Fp =>
  add(a, mul(sub(b, a), t));

// Common literals — pre-computed at module load to avoid per-call
// `fromFloat` allocations in hot paths.
export const FP_TWO: Fp = fromInt(2);
export const FP_HALF_LIT: Fp = fromFloat(0.5);
export const FP_QUARTER: Fp = fromFloat(0.25);
export const FP_TENTH: Fp = fromFloat(0.1);
