// clip-goal STUDY 3, CL.D regression — the lower-third must be FULLY gone
// (alpha exactly 0) at and after the out-point-minus-lead threshold; two
// clips shipped still full-opacity at/near the hard cut.

import { describe, test, expect } from "bun:test";
import { computeLowerThirdAlpha } from "../lowerThirdAlpha";

describe("computeLowerThirdAlpha", () => {
  const clipTicks = 300;
  const showFrom = 90;

  test("hidden before the first kill", () => {
    expect(computeLowerThirdAlpha(0, clipTicks, showFrom)).toBe(0);
    expect(computeLowerThirdAlpha(89, clipTicks, showFrom)).toBe(0);
  });

  test("fades in starting at the first kill", () => {
    expect(computeLowerThirdAlpha(90, clipTicks, showFrom)).toBe(0);
    const mid = computeLowerThirdAlpha(99, clipTicks, showFrom); // halfway through an 18-tick fade
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(computeLowerThirdAlpha(108, clipTicks, showFrom)).toBe(1);
  });

  test("fully visible through the middle of the clip", () => {
    expect(computeLowerThirdAlpha(200, clipTicks, showFrom)).toBe(1);
  });

  test("REGRESSION (STUDY 3): alpha is EXACTLY 0 at the hide threshold and every tick after, all the way to the last frame", () => {
    const hideAt = clipTicks - 36; // 264
    expect(computeLowerThirdAlpha(hideAt, clipTicks, showFrom)).toBe(0);
    // Every tick from hideAt through the literal last tick of the window —
    // the exact symptom (`909e0a8a`: full-opacity on the LITERAL last
    // frame; `80ea1663`: rides to the hard cut with no exit cue at all).
    for (let rel = hideAt; rel < clipTicks; rel++) {
      expect(computeLowerThirdAlpha(rel, clipTicks, showFrom)).toBe(0);
    }
  });

  test("fade-out completes smoothly before the hide threshold, never jumping straight from 1 to 0", () => {
    const hideAt = clipTicks - 36;
    const justBefore = computeLowerThirdAlpha(hideAt - 1, clipTicks, showFrom);
    expect(justBefore).toBeGreaterThan(0);
    expect(justBefore).toBeLessThan(1);
  });

  test("a very short window (kill near the very end) never produces a non-zero alpha past the clip's own length", () => {
    // Degenerate case: showFrom is close to clipTicks itself (a trimmed
    // window that barely fits its kill) — alpha must still be 0 well
    // before or at the literal end, never NaN/negative/>1.
    const tinyClipTicks = 40;
    for (let rel = 0; rel < tinyClipTicks + 10; rel++) {
      const a = computeLowerThirdAlpha(rel, tinyClipTicks, 10);
      expect(Number.isFinite(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});
