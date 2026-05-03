// Validating branded-ID constructors.
//
// The constructors live in client/src/sim/types.ts and are the front door
// for any number/string that becomes an EntityId / PlayerId / Tick / InputSeq.
// Each rejects garbage at the trust boundary; downstream code can then
// trust the brand without re-validating.

import { describe, expect, test } from "bun:test";
import { EntityId, InputSeq, PlayerId, Tick } from "../types.js";

describe("branded ID constructors", () => {
  test("EntityId accepts non-negative integers", () => {
    expect(EntityId(0)).toBe(0 as EntityId);
    expect(EntityId(42)).toBe(42 as EntityId);
  });
  test("EntityId rejects NaN, negative, fractional, Infinity", () => {
    expect(() => EntityId(NaN)).toThrow();
    expect(() => EntityId(-1)).toThrow();
    expect(() => EntityId(1.5)).toThrow();
    expect(() => EntityId(Infinity)).toThrow();
  });

  test("Tick accepts non-negative integers, rejects negatives", () => {
    expect(Tick(0)).toBe(0 as Tick);
    expect(Tick(120)).toBe(120 as Tick);
    expect(() => Tick(-1)).toThrow();
    expect(() => Tick(NaN)).toThrow();
  });

  test("InputSeq accepts non-negative integers", () => {
    expect(InputSeq(0)).toBe(0 as InputSeq);
    expect(() => InputSeq(-5)).toThrow();
    expect(() => InputSeq(0.5)).toThrow();
  });

  test("PlayerId accepts non-empty short strings", () => {
    expect(PlayerId("a1b2")).toBe("a1b2" as PlayerId);
    expect(() => PlayerId("")).toThrow();
    expect(() => PlayerId("x".repeat(65))).toThrow();
  });
});
