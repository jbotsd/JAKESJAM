// Determinism + range guarantees for the seeded mulberry32 RNG. The whole sim
// pipeline relies on this being repeatable and well-bounded.

import { describe, test, expect } from "bun:test";
import { nextU32, nextFloat, nextInt, pickOne } from "../rng.js";

describe("rng", () => {
  test("same seed produces the same sequence over 100 calls", () => {
    const seed = 1234567;
    let stateA = seed;
    let stateB = seed;
    const valuesA: number[] = [];
    const valuesB: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const [aNext, aVal] = nextFloat(stateA);
      const [bNext, bVal] = nextFloat(stateB);
      stateA = aNext;
      stateB = bNext;
      valuesA.push(aVal);
      valuesB.push(bVal);
    }
    expect(valuesA).toEqual(valuesB);
  });

  test("different seeds produce different sequences", () => {
    let stateA = 1;
    let stateB = 2;
    const valuesA: number[] = [];
    const valuesB: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const [aNext, aVal] = nextFloat(stateA);
      const [bNext, bVal] = nextFloat(stateB);
      stateA = aNext;
      stateB = bNext;
      valuesA.push(aVal);
      valuesB.push(bVal);
    }
    // At least one element must differ (and in practice, all do).
    expect(valuesA).not.toEqual(valuesB);
  });

  test("nextU32 returns a uint32-shaped integer", () => {
    let state = 42;
    for (let i = 0; i < 200; i += 1) {
      state = nextU32(state);
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test("nextFloat is always in [0, 1)", () => {
    let state = 99;
    for (let i = 0; i < 500; i += 1) {
      const [next, value] = nextFloat(state);
      state = next;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("nextInt(state, 0, 10) always lands in [0, 10) over many calls", () => {
    let state = 7;
    for (let i = 0; i < 500; i += 1) {
      const [next, value] = nextInt(state, 0, 10);
      state = next;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
  });

  test("pickOne always returns an element of the array", () => {
    const arr = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
    let state = 31337;
    for (let i = 0; i < 200; i += 1) {
      const [next, value] = pickOne(state, arr);
      state = next;
      expect(arr).toContain(value);
    }
  });
});
