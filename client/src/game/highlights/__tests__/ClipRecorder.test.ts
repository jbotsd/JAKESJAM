import { describe, expect, test } from "bun:test";
import { computeClosingFadeAlpha, computeCoverRect, computeSegmentEndAtMs } from "../ClipRecorder.js";

// clip-goal D4/B5-sibling: the old formula was
// `max(naturalEndAt, pendingFinishAtMs)`, which let an EARLY trigger ride
// all the way to the arbitrary natural-rotation boundary instead of ending
// shortly after its own lookahead — the "ends on raw mid-fight dead air"
// regression (worse than the studied baseline's wrong-banner ending).
describe("computeSegmentEndAtMs", () => {
  test("no pending trigger — ends at the natural segment boundary", () => {
    expect(computeSegmentEndAtMs(0, null)).toBe(10_000);
  });

  test("a trigger firing EARLY in the segment ends shortly after its own lookahead, not the natural boundary", () => {
    // Trigger at t=1000ms, finishing at ~t=4000ms (LOOKAHEAD_MS=3000) — must
    // NOT ride to the 10s natural boundary.
    expect(computeSegmentEndAtMs(0, 4_000)).toBe(4_000);
  });

  test("a trigger firing LATE still extends past the natural boundary, capped at MAX_SEGMENT_MS", () => {
    // pendingFinishAtMs beyond MAX_SEGMENT_MS (20s from segment start) is
    // clamped, not honored outright — repeated late triggers can't extend a
    // single segment forever.
    expect(computeSegmentEndAtMs(0, 25_000)).toBe(20_000);
  });

  test("a trigger comfortably within MAX_SEGMENT_MS but past the natural boundary is honored exactly", () => {
    expect(computeSegmentEndAtMs(0, 15_000)).toBe(15_000);
  });

  test("segment start offset shifts every boundary by the same amount", () => {
    expect(computeSegmentEndAtMs(5_000, null)).toBe(15_000);
    expect(computeSegmentEndAtMs(5_000, 9_000)).toBe(9_000);
  });
});

// clip-goal D4/B1: the studied ClipRecorder.ts clips reproduced the ORIGINAL
// baseline's exact failure mode (never quite 16:9, never exactly
// 1920×1080) because the old mezzanine canvas just scaled proportionally
// FROM whatever the live window happened to be. computeCoverRect is the
// crop math that fixes it — pinned here the same way CL.A pinned
// frame-exactness for the offline render path.
describe("computeCoverRect", () => {
  test("equal aspect ratio — full source rect, no crop", () => {
    expect(computeCoverRect(1920, 1080, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    expect(computeCoverRect(960, 540, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 960, sh: 540 });
  });

  test("source WIDER than destination (e.g. an ultrawide window) — crops left/right, keeps full height", () => {
    const rect = computeCoverRect(2560, 1080, 1920, 1080);
    expect(rect.sy).toBe(0);
    expect(rect.sh).toBe(1080);
    expect(rect.sw).toBeCloseTo((1920 / 1080) * 1080, 5);
    expect(rect.sx).toBeCloseTo((2560 - rect.sw) / 2, 5);
  });

  test("source TALLER than destination (the studied 1824x1026 regression's sibling case) — crops top/bottom, keeps full width", () => {
    // A tall/narrow window, e.g. a portrait-ish browser at 1200x1000.
    const rect = computeCoverRect(1200, 1000, 1920, 1080);
    expect(rect.sx).toBe(0);
    expect(rect.sw).toBe(1200);
    expect(rect.sh).toBeCloseTo(1200 / (1920 / 1080), 5);
    expect(rect.sy).toBeCloseTo((1000 - rect.sh) / 2, 5);
  });

  test("the cropped rect always matches the destination aspect ratio exactly", () => {
    const cases: Array<[number, number]> = [
      [1824, 1026],
      [1920, 937],
      [1280, 720],
      [3440, 1440],
    ];
    for (const [srcW, srcH] of cases) {
      const rect = computeCoverRect(srcW, srcH, 1920, 1080);
      expect(rect.sw / rect.sh).toBeCloseTo(1920 / 1080, 5);
      // Crop never exceeds the source bounds.
      expect(rect.sx).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.sy).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.sx + rect.sw).toBeLessThanOrEqual(srcW + 1e-9);
      expect(rect.sy + rect.sh).toBeLessThanOrEqual(srcH + 1e-9);
    }
  });

  test("degenerate zero-sized input never throws and returns a usable positive rect", () => {
    expect(() => computeCoverRect(0, 0, 1920, 1080)).not.toThrow();
    const rect = computeCoverRect(0, 0, 1920, 1080);
    expect(rect.sw).toBeGreaterThan(0);
    expect(rect.sh).toBeGreaterThan(0);
  });
});

// clip-goal D4/B5-sibling: "ends on raw mid-fight dead air with zero
// banner/fade/hold" — every trigger-covered segment now closes on a
// deliberate fade instead of a hard cut. Pinned as a truth table over the
// signed ms-remaining input (see computeClosingFadeAlpha's own comment for
// why negative values are a real, expected case).
describe("computeClosingFadeAlpha", () => {
  test("fully transparent well before the deadline", () => {
    expect(computeClosingFadeAlpha(10_000)).toBe(0);
    expect(computeClosingFadeAlpha(501)).toBe(0);
  });

  test("exactly at the fade window's start is still transparent", () => {
    expect(computeClosingFadeAlpha(500)).toBe(0);
  });

  test("ramps linearly across the fade window", () => {
    expect(computeClosingFadeAlpha(250)).toBeCloseTo(0.46, 5);
    expect(computeClosingFadeAlpha(0)).toBeCloseTo(0.92, 5);
  });

  test("clamps at the max alpha past the deadline (never fully opaque, never overshoots)", () => {
    expect(computeClosingFadeAlpha(-1_000)).toBeCloseTo(0.92, 5);
    expect(computeClosingFadeAlpha(-1_000)).toBeLessThanOrEqual(1);
  });
});
