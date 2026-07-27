// clip-goal STUDY 3, CL.C regression: ReplayScene's fast-forward-to-fromTick
// loop used a fixed-size stepTicks(60) batch, which could land up to 59
// ticks PAST the target depending on the remainder — this is the pure
// loop-control math extracted so the overshoot bug is pinned without a
// Phaser scene.

import { describe, test, expect } from "bun:test";
import { fastForwardBatches } from "../fastForwardPlan";

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

describe("fastForwardBatches", () => {
  test("lands exactly on target when the distance is an exact multiple of the batch size", () => {
    const batches = fastForwardBatches(0, 180, 60);
    expect(sum(batches)).toBe(180);
    expect(batches).toEqual([60, 60, 60]);
  });

  test("never overshoots when the distance is NOT a multiple of the batch size (the bug)", () => {
    // A real clip window: fromTick=1526 with the old fixed stepTicks(60)
    // loop would step 0→60→120→...→1560, overshooting by 34 ticks. The
    // fixed plan's last batch must be exactly 26 (1526 % 60).
    const batches = fastForwardBatches(0, 1526, 60);
    expect(sum(batches)).toBe(1526);
    expect(batches[batches.length - 1]).toBe(26);
    for (const b of batches) expect(b).toBeLessThanOrEqual(60);
  });

  test("80ea1663-style short target: a small fromTick still lands exactly, never skipping past a nearby kill", () => {
    // If fromTick sits inside what would otherwise be one 60-tick batch
    // (e.g. fromTick=40), the old loop's single stepTicks(60) call would
    // fast-forward all the way to tick 60 — 20 ticks past a target that's
    // supposed to be ~1.5s (90 ticks) before the credited kill, potentially
    // skipping the kill itself in a short/tight trade.
    const batches = fastForwardBatches(0, 40, 60);
    expect(sum(batches)).toBe(40);
    expect(batches).toEqual([40]);
  });

  test("resuming from a nonzero current tick still lands exactly", () => {
    const batches = fastForwardBatches(500, 733, 60);
    expect(sum(batches)).toBe(233);
    for (const b of batches) expect(b).toBeLessThanOrEqual(60);
  });

  test("current already at or past target: no batches", () => {
    expect(fastForwardBatches(100, 100, 60)).toEqual([]);
    expect(fastForwardBatches(150, 100, 60)).toEqual([]);
  });

  test("property sweep: for any (current, target) with current<=target, batches always sum exactly and never exceed batchSize", () => {
    const batchSize = 60;
    for (let current = 0; current < 200; current += 7) {
      for (let target = current; target < current + 400; target += 13) {
        const batches = fastForwardBatches(current, target, batchSize);
        expect(sum(batches)).toBe(target - current);
        for (const b of batches) {
          expect(b).toBeGreaterThan(0);
          expect(b).toBeLessThanOrEqual(batchSize);
        }
      }
    }
  });
});
