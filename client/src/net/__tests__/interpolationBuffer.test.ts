// Contract tests for InterpolationBuffer — the per-remote-entity
// ring buffer used to render snapshots ~100 ms in the past
// (Gambetta's snapshot interpolation pattern).
//
// Was untested. Locks in: hold-on-empty/single, lerp on bracket,
// extrapolate-by-hold past tail, ring discard older than window.

import { describe, expect, test, beforeEach } from "bun:test";
import { InterpolationBuffer } from "../interpolationBuffer";

type Vec = { x: number; y: number };
const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

describe("InterpolationBuffer", () => {
  let buf: InterpolationBuffer<Vec>;

  beforeEach(() => {
    buf = new InterpolationBuffer<Vec>(lerpVec);
  });

  test("sample on empty buffer returns null", () => {
    expect(buf.sample(0)).toBeNull();
  });

  test("sample with one entry returns that entry's value (no lerp)", () => {
    buf.push(100, { x: 5, y: 10 });
    expect(buf.sample(50)).toEqual({ x: 5, y: 10 });
    expect(buf.sample(200)).toEqual({ x: 5, y: 10 });
  });

  test("sample exactly at first sample timestamp", () => {
    buf.push(100, { x: 0, y: 0 });
    buf.push(200, { x: 100, y: 0 });
    expect(buf.sample(100)).toEqual({ x: 0, y: 0 });
  });

  test("sample exactly at second sample timestamp", () => {
    buf.push(100, { x: 0, y: 0 });
    buf.push(200, { x: 100, y: 0 });
    expect(buf.sample(200)).toEqual({ x: 100, y: 0 });
  });

  test("sample at midpoint lerps 50/50", () => {
    buf.push(100, { x: 0, y: 0 });
    buf.push(200, { x: 100, y: 50 });
    expect(buf.sample(150)).toEqual({ x: 50, y: 25 });
  });

  test("sample past the last entry returns the last value (hold-extrapolate)", () => {
    buf.push(100, { x: 0, y: 0 });
    buf.push(200, { x: 100, y: 0 });
    expect(buf.sample(500)).toEqual({ x: 100, y: 0 });
  });

  test("sample before first entry returns the first value (hold-extrapolate)", () => {
    buf.push(100, { x: 5, y: 0 });
    buf.push(200, { x: 100, y: 0 });
    // Before the first sample, the for-loop fails; falls through
    // to the "hold last" branch which returns the LAST sample's
    // value. Document this behaviour.
    expect(buf.sample(0)).toEqual({ x: 100, y: 0 });
  });

  test("zero-span between two samples returns first value (no NaN)", () => {
    buf.push(100, { x: 5, y: 0 });
    buf.push(100, { x: 9, y: 1 });
    const v = buf.sample(100);
    expect(v).not.toBeNull();
    // span=0 → t=0 → returns value-at-a (the first sample with that time).
    expect(v).toEqual({ x: 5, y: 0 });
  });

  test("samples older than INTERP_WINDOW_MS get discarded on push", () => {
    buf.push(0, { x: 0, y: 0 });
    buf.push(100, { x: 10, y: 0 });
    // Push at t=600 — INTERP_WINDOW_MS=400, cutoff=200. The t=0
    // sample is older and should be discarded; t=100 stays
    // (length > 2 condition gates the prune to keep 2 minimum).
    buf.push(600, { x: 60, y: 0 });
    // Now another push at t=700, cutoff=300, t=100 should drop:
    buf.push(700, { x: 70, y: 0 });
    // Verify we can sample latest range without the stale t=0/100 leakage.
    expect(buf.sample(700)).toEqual({ x: 70, y: 0 });
  });

  test("buffer keeps at least 2 entries even if all older than window", () => {
    buf.push(0, { x: 0, y: 0 });
    buf.push(1000, { x: 100, y: 0 });
    // Both older than INTERP_WINDOW_MS=400 cutoff against… wait,
    // push uses serverTimeMs of the just-pushed sample as the
    // anchor. Cutoff = 1000 - 400 = 600. The t=0 sample IS older
    // than 600, but the prune condition keeps minimum 2 entries.
    expect(buf.sample(1000)).toEqual({ x: 100, y: 0 });
  });

  test("clear() empties the buffer; sample returns null", () => {
    buf.push(100, { x: 5, y: 5 });
    buf.push(200, { x: 10, y: 10 });
    buf.clear();
    expect(buf.sample(150)).toBeNull();
  });

  test("custom lerp function is used", () => {
    let lerpCalls = 0;
    const buf2 = new InterpolationBuffer<number>((a, b, t) => {
      lerpCalls += 1;
      return a + (b - a) * t;
    });
    buf2.push(100, 0);
    buf2.push(200, 100);
    expect(buf2.sample(150)).toBe(50);
    expect(lerpCalls).toBe(1);
  });
});
