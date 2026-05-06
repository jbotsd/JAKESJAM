// Contract tests for the band-based RenderSmoother
// (commit 387e1aa). Locks in:
//   - snap on huge deltas (above snapThresholdPx)
//   - smooth on routine drift (below threshold)
//   - per-band τ behaviour (small/mid/large)
//   - per-frame max-correction clamp
//   - sub-pixel snap-to-zero
//   - stats reporting
//
// Reference: Fiedler — gafferongames.com/post/state_synchronization

import { describe, expect, test, beforeEach } from "bun:test";
import {
  DEFAULT_SMOOTHING,
  RenderSmoother,
} from "../renderSmoother";

describe("RenderSmoother — band-based exponential decay", () => {
  let s: RenderSmoother;

  beforeEach(() => {
    s = new RenderSmoother();
  });

  test("fresh smoother has zero offset and reports cleanly", () => {
    expect(s.hasOffset()).toBe(false);
    expect(s.offset()).toEqual({ x: 0, y: 0 });
    expect(s.stats().lastDeltaPx).toBe(0);
    expect(s.stats().lastSnapped).toBe(false);
  });

  test("applyReconcile: prevRendered === newPredicted leaves offset zero", () => {
    s.applyReconcile(100, 100, 100, 100);
    expect(s.offset()).toEqual({ x: 0, y: 0 });
    expect(s.stats().lastDeltaPx).toBe(0);
  });

  test("applyReconcile: small delta sets offset (no snap)", () => {
    s.applyReconcile(100, 100, 105, 100); // 5px right shift
    expect(s.offset()).toEqual({ x: -5, y: 0 });
    expect(s.stats().lastDeltaPx).toBeCloseTo(5, 5);
    expect(s.stats().lastSnapped).toBe(false);
  });

  test("applyReconcile: delta > snapThresholdPx → snaps to 0", () => {
    const beyondThreshold = DEFAULT_SMOOTHING.snapThresholdPx + 10;
    s.applyReconcile(100, 100, 100 + beyondThreshold, 100);
    expect(s.offset()).toEqual({ x: 0, y: 0 });
    expect(s.stats().lastSnapped).toBe(true);
  });

  test("applyReconcile: null prevRendered → resets offset clean", () => {
    s.applyReconcile(100, 100, 110, 100); // arms 10px offset
    expect(s.hasOffset()).toBe(true);
    s.applyReconcile(null, null, 200, 200); // reset
    expect(s.hasOffset()).toBe(false);
    expect(s.stats().lastDeltaPx).toBe(0);
  });

  test("advance: zero offset doesn't progress (early return)", () => {
    s.advance(0);
    s.advance(16);
    expect(s.offset()).toEqual({ x: 0, y: 0 });
  });

  test("advance: small offset (within smallBandPx) decays slowly", () => {
    // 4px offset → small band → tau=150ms.
    // First advance(t) anchors lastRenderAt; second advance moves time.
    // After 16ms, expect ~exp(-16/150) ≈ 0.898 retained.
    s.applyReconcile(100, 100, 104, 100); // -4 offset
    s.advance(100); // anchor lastRenderAt = 100
    s.advance(116); // elapsed = 16
    const x = Math.abs(s.offset().x);
    expect(x).toBeGreaterThan(3); // mostly preserved
    expect(x).toBeLessThan(4);
  });

  test("advance: large offset (above largeBandPx) decays fast", () => {
    // 50px offset → large band → tau=40ms.
    // After 16ms, expect ~exp(-16/40) ≈ 0.67 retained = ~33.5.
    s.applyReconcile(100, 100, 150, 100); // -50 offset
    s.advance(100);
    s.advance(116);
    const x = Math.abs(s.offset().x);
    // Initially 50px; decays toward 0. Should be ~33-34 after one frame.
    expect(x).toBeLessThan(50);
    expect(x).toBeGreaterThan(20);
  });

  test("advance: maxCorrectionPxPerFrame clamps single-step delta", () => {
    // Large 80px offset; large-band tau=40ms; 200ms frame elapsed
    // would normally remove most of it (~exp(-200/40) ≈ 0.0067 retained
    // = ~79.5px removed in one shot). max-correction clamps to 16px.
    // Note: 80 > snapThresholdPx default (90) is false; 80 < 90 so smooth.
    s.applyReconcile(100, 100, 180, 100); // -80 offset
    s.advance(100);
    s.advance(300); // 200ms elapsed
    const x = Math.abs(s.offset().x);
    // With 16px max-correction clamp: 80 - 16 = 64.
    expect(x).toBeGreaterThanOrEqual(63);
    expect(x).toBeLessThanOrEqual(65);
  });

  test("advance: sub-pixel offset snaps to exact zero", () => {
    s.applyReconcile(100, 100, 100.04, 100); // 0.04 offset (sub-pixel)
    s.advance(100); // anchor
    s.advance(116); // elapsed = 16
    // 0.04 * (1-exp(-16/150)) tiny step removed → still sub-pixel → snap.
    expect(s.offset()).toEqual({ x: 0, y: 0 });
  });

  test("advance: zero elapsed (same wall-clock) is a no-op", () => {
    s.applyReconcile(100, 100, 110, 100); // -10 offset
    s.advance(1000); // anchor at t=1000
    const before = s.offset();
    s.advance(1000); // same time
    expect(s.offset()).toEqual(before);
  });

  test("custom opts merge with defaults", () => {
    const sx = new RenderSmoother({ snapThresholdPx: 200 });
    sx.applyReconcile(100, 100, 250, 100); // 150px shift
    // Default would snap (snapThreshold=90). Custom 200 → no snap.
    expect(sx.offset().x).toBe(-150);
    expect(sx.stats().lastSnapped).toBe(false);
  });

  test("stats report current offset magnitude", () => {
    s.applyReconcile(100, 100, 130, 140); // dx=-30, dy=-40 → mag=50
    expect(s.stats().currentOffsetPx).toBeCloseTo(50, 5);
  });

  test("decay behaviour: many frames smoothly approaches zero", () => {
    s.applyReconcile(100, 100, 110, 100); // -10 offset (mid-band)
    s.advance(100); // anchor
    let prev = Math.abs(s.offset().x);
    for (let frame = 0; frame < 60; frame++) {
      s.advance(100 + (frame + 1) * 16);
      const cur = Math.abs(s.offset().x);
      // Strictly non-increasing across frames.
      expect(cur).toBeLessThanOrEqual(prev + 0.0001);
      prev = cur;
    }
    // After ~960ms with mid-band tau=80ms, should be effectively zero.
    expect(prev).toBe(0);
  });
});
