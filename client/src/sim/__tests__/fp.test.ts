// Q16.16 fixed-point arithmetic + LUT trig tests.
//
// The full migration plan lives in
// /home/jimothy/.claude/plans/enchanted-juggling-cocke.md.
// This is PR 1 — toolkit only, no sim files converted yet.
//
// Determinism check: every assertion here MUST hold bit-exact across
// V8 and JSC. We don't compare to Math.* directly because that's the
// thing we're escaping; we compare to known truth values + algebraic
// identities.

import { describe, expect, test } from "bun:test";
import {
  FP_ONE, FP_ZERO, FP_TWO,
  fromInt, fromFloat, toFloat, toInt,
  add, sub, mul, div, neg, abs, min, max, clamp, sign,
  lt, le, gt, ge, eq, lerp,
} from "../fp.js";
import { sin, cos, atan2, sqrt, hypot, FP_PI, FP_HALF_PI } from "../fpTrig.js";
import type { Fp } from "../fp.js";

describe("fp — round trip", () => {
  test("fromInt → toFloat: integers exact", () => {
    expect(toFloat(fromInt(0))).toBe(0);
    expect(toFloat(fromInt(1))).toBe(1);
    expect(toFloat(fromInt(-1))).toBe(-1);
    expect(toFloat(fromInt(640))).toBe(640);
    expect(toFloat(fromInt(-640))).toBe(-640);
  });

  test("fromFloat → toFloat: round-trip within 1/65536", () => {
    for (const f of [0, 0.5, 1, -1, 1.5, 100.123, -640.7]) {
      const round = toFloat(fromFloat(f));
      expect(Math.abs(round - f)).toBeLessThan(1 / 65536);
    }
  });

  test("toInt truncates fractional", () => {
    expect(toInt(fromFloat(3.9))).toBe(3);
    expect(toInt(fromFloat(-3.9))).toBe(-4); // shift behaviour: floor
    expect(toInt(fromInt(0))).toBe(0);
  });
});

describe("fp — algebraic identities", () => {
  const a = fromFloat(7.5);
  const b = fromFloat(2.25);

  test("add then sub returns original", () => {
    expect(toFloat(sub(add(a, b), b))).toBeCloseTo(7.5, 4);
  });

  test("neg(neg) = identity", () => {
    expect(neg(neg(a))).toBe(a);
  });

  test("mul by FP_ONE is identity", () => {
    expect(mul(a, FP_ONE)).toBe(a);
  });

  test("mul by 0 is 0", () => {
    expect(mul(a, FP_ZERO)).toBe(FP_ZERO);
  });

  test("div by FP_ONE is identity", () => {
    expect(div(a, FP_ONE)).toBe(a);
  });

  test("div by self is FP_ONE (within 1 tick)", () => {
    expect(Math.abs(div(a, a) - FP_ONE)).toBeLessThanOrEqual(1);
  });

  test("mul of two ints", () => {
    const x = fromInt(7);
    const y = fromInt(3);
    expect(toFloat(mul(x, y))).toBeCloseTo(21, 4);
  });
});

describe("fp — comparisons + scalars", () => {
  test("abs", () => {
    expect(abs(fromInt(-5))).toBe(fromInt(5));
    expect(abs(fromInt(5))).toBe(fromInt(5));
    expect(abs(FP_ZERO)).toBe(FP_ZERO);
  });

  test("min / max", () => {
    expect(min(fromInt(3), fromInt(7))).toBe(fromInt(3));
    expect(max(fromInt(3), fromInt(7))).toBe(fromInt(7));
  });

  test("clamp", () => {
    expect(clamp(fromInt(10), fromInt(0), fromInt(5))).toBe(fromInt(5));
    expect(clamp(fromInt(-10), fromInt(0), fromInt(5))).toBe(fromInt(0));
    expect(clamp(fromInt(3), fromInt(0), fromInt(5))).toBe(fromInt(3));
  });

  test("sign", () => {
    expect(sign(fromInt(7))).toBe(1);
    expect(sign(fromInt(-7))).toBe(-1);
    expect(sign(FP_ZERO)).toBe(0);
  });

  test("comparisons", () => {
    const a = fromInt(3);
    const b = fromInt(7);
    expect(lt(a, b)).toBe(true);
    expect(le(a, a)).toBe(true);
    expect(gt(b, a)).toBe(true);
    expect(ge(b, b)).toBe(true);
    expect(eq(a, a)).toBe(true);
    expect(eq(a, b)).toBe(false);
  });

  test("lerp halfway", () => {
    const halfway = lerp(fromInt(0), fromInt(10), fromFloat(0.5));
    expect(toFloat(halfway)).toBeCloseTo(5, 2);
  });
});

describe("fp — host-determinism canary", () => {
  // Run the same sequence of ops twice; result must be exactly equal.
  // (Trivially true on a single host — but it documents the intent.
  // The cross-host claim is enforced by code review of the ops being
  // pure int arithmetic.)
  test("identical sequences produce identical results", () => {
    function chain(): Fp {
      let v = fromInt(1) as Fp;
      for (let i = 0; i < 100; i++) {
        v = add(v, fromFloat(0.7));
        v = mul(v, fromFloat(1.001));
        v = sub(v, FP_TWO);
      }
      return v;
    }
    expect(chain()).toBe(chain());
  });
});

describe("fpTrig — sin / cos", () => {
  test("sin(0) = 0", () => {
    expect(sin(FP_ZERO)).toBe(FP_ZERO);
  });

  test("sin(π/2) ≈ 1", () => {
    expect(toFloat(sin(FP_HALF_PI))).toBeCloseTo(1, 3);
  });

  test("sin(π) ≈ 0", () => {
    expect(Math.abs(toFloat(sin(FP_PI)))).toBeLessThan(0.001);
  });

  test("sin(3π/2) ≈ -1", () => {
    expect(toFloat(sin(fromFloat(Math.PI * 1.5)))).toBeCloseTo(-1, 3);
  });

  test("cos(0) ≈ 1", () => {
    expect(toFloat(cos(FP_ZERO))).toBeCloseTo(1, 3);
  });

  test("cos(π/2) ≈ 0", () => {
    expect(Math.abs(toFloat(cos(FP_HALF_PI)))).toBeLessThan(0.001);
  });

  test("sin(π/4) ≈ 0.707", () => {
    expect(toFloat(sin(fromFloat(Math.PI / 4)))).toBeCloseTo(Math.sin(Math.PI / 4), 2);
  });

  test("sin² + cos² ≈ 1 across quadrants", () => {
    for (const angleFloat of [0, 0.3, 0.7, 1.0, 1.5, 2.5, 3.0, 4.5, 5.5]) {
      const a = fromFloat(angleFloat);
      const s = toFloat(sin(a));
      const c = toFloat(cos(a));
      expect(s * s + c * c).toBeCloseTo(1, 2);
    }
  });

  test("sin is normalised across multiple revolutions", () => {
    // 5π should reduce to π → sin = 0.
    expect(Math.abs(toFloat(sin(fromFloat(Math.PI * 5))))).toBeLessThan(0.005);
  });
});

describe("fpTrig — atan2", () => {
  test("atan2(0, 1) = 0", () => {
    expect(toFloat(atan2(FP_ZERO, FP_ONE))).toBeCloseTo(0, 2);
  });

  test("atan2(1, 0) ≈ π/2", () => {
    expect(toFloat(atan2(FP_ONE, FP_ZERO))).toBeCloseTo(Math.PI / 2, 2);
  });

  test("atan2(0, -1) ≈ π", () => {
    expect(Math.abs(toFloat(atan2(FP_ZERO, neg(FP_ONE))))).toBeCloseTo(Math.PI, 2);
  });

  test("atan2(-1, 0) ≈ -π/2", () => {
    expect(toFloat(atan2(neg(FP_ONE), FP_ZERO))).toBeCloseTo(-Math.PI / 2, 2);
  });

  test("atan2(1, 1) ≈ π/4", () => {
    expect(toFloat(atan2(FP_ONE, FP_ONE))).toBeCloseTo(Math.PI / 4, 2);
  });

  test("atan2(-1, -1) ≈ -3π/4", () => {
    expect(toFloat(atan2(neg(FP_ONE), neg(FP_ONE)))).toBeCloseTo(-3 * Math.PI / 4, 2);
  });

  test("atan2 in 4 quadrants matches Math.atan2 within 1°", () => {
    const tol = (Math.PI / 180); // 1 degree
    const cases: ReadonlyArray<readonly [number, number]> = [
      [1, 1], [1, -1], [-1, -1], [-1, 1],
      [3, 4], [-3, 4], [-3, -4], [3, -4],
    ];
    for (const [y, x] of cases) {
      const got = toFloat(atan2(fromFloat(y), fromFloat(x)));
      const truth = Math.atan2(y, x);
      expect(Math.abs(got - truth)).toBeLessThan(tol);
    }
  });
});

describe("fpTrig — sqrt + hypot", () => {
  test("sqrt(0) = 0", () => {
    expect(sqrt(FP_ZERO)).toBe(FP_ZERO);
  });

  test("sqrt(1) = 1", () => {
    expect(toFloat(sqrt(FP_ONE))).toBeCloseTo(1, 3);
  });

  test("sqrt(4) ≈ 2", () => {
    expect(toFloat(sqrt(fromInt(4)))).toBeCloseTo(2, 2);
  });

  test("sqrt(2) ≈ 1.414", () => {
    expect(toFloat(sqrt(fromInt(2)))).toBeCloseTo(Math.sqrt(2), 2);
  });

  test("sqrt(100) ≈ 10", () => {
    expect(toFloat(sqrt(fromInt(100)))).toBeCloseTo(10, 1);
  });

  test("hypot(3, 4) ≈ 5", () => {
    expect(toFloat(hypot(fromInt(3), fromInt(4)))).toBeCloseTo(5, 1);
  });

  test("hypot(0, 0) = 0", () => {
    expect(hypot(FP_ZERO, FP_ZERO)).toBe(FP_ZERO);
  });
});
