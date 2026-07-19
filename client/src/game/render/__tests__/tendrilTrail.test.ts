// Pure chain math backing Priest/Syzygist's "oozing tendril" travel-phase
// body (tendrilTrail.ts). No Phaser dependency — proves the accumulate /
// taper-toward-head / no-cross-instance-leak contract the report promises,
// the same bar meleeStage.test.ts holds meleeTiming.ts to.

import { describe, expect, test } from "bun:test";
import {
  makeTendrilChain,
  stepTendrilChain,
  tendrilSegmentAlpha,
  tendrilSegmentWidthScale,
  TENDRIL_SEGMENT_COUNT,
  type TendrilSegment,
} from "../tendrilTrail";

function dist(a: TendrilSegment, b: TendrilSegment): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("makeTendrilChain", () => {
  test("every segment starts pinned to the spawn point", () => {
    const chain = makeTendrilChain(50, -20);
    expect(chain.length).toBe(TENDRIL_SEGMENT_COUNT);
    for (const seg of chain) {
      expect(seg.x).toBe(50);
      expect(seg.y).toBe(-20);
    }
  });

  test("respects a custom segment count", () => {
    expect(makeTendrilChain(0, 0, 3).length).toBe(3);
  });

  test("two chains from separate calls do not share array identity or object identity", () => {
    const a = makeTendrilChain(0, 0);
    const b = makeTendrilChain(0, 0);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe("stepTendrilChain — accumulation over frames", () => {
  test("head always snaps exactly to the live position, every frame", () => {
    let chain = makeTendrilChain(0, 0);
    chain = stepTendrilChain(chain, 10, 0, 1 / 60);
    expect(chain[0]).toEqual({ x: 10, y: 0 });
    chain = stepTendrilChain(chain, 10, 40, 1 / 60);
    expect(chain[0]).toEqual({ x: 10, y: 40 });
  });

  test("is pure — never mutates the input chain array or its segment objects", () => {
    const chain = makeTendrilChain(0, 0);
    const originalRefs = chain.map((s) => s);
    const originalPositions = chain.map((s) => ({ ...s }));
    stepTendrilChain(chain, 100, 100, 1 / 30);
    for (let i = 0; i < chain.length; i += 1) {
      expect(chain[i]).toBe(originalRefs[i]);
      expect(chain[i]).toEqual(originalPositions[i]);
    }
  });

  test("trailing segments lag behind the head immediately after it moves", () => {
    let chain = makeTendrilChain(0, 0);
    chain = stepTendrilChain(chain, 100, 0, 1 / 60);
    // Head jumped all the way; every trailing segment should have moved
    // LESS far than the head (a lag/taper, not an instant teleport-in-formation).
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i]!.x).toBeGreaterThan(0);
      expect(chain[i]!.x).toBeLessThan(100);
    }
    // Monotonically more lag further from the head.
    for (let i = 1; i < chain.length - 1; i += 1) {
      expect(chain[i]!.x).toBeGreaterThanOrEqual(chain[i + 1]!.x);
    }
  });

  test("under sustained constant-velocity motion, the chain settles into a stable trailing offset (steady state)", () => {
    let chain = makeTendrilChain(0, 0);
    const speed = 320; // SYZ_TENDRIL_SPEED order of magnitude
    let x = 0;
    const dt = 1 / 60;
    let prevGaps: number[] = [];
    let settledGaps: number[] = [];
    for (let frame = 0; frame < 400; frame += 1) {
      x += speed * dt;
      chain = stepTendrilChain(chain, x, 0, dt);
      const gaps = [];
      for (let i = 0; i < chain.length - 1; i += 1) gaps.push(dist(chain[i]!, chain[i + 1]!));
      if (frame === 150) prevGaps = gaps;
      if (frame === 399) settledGaps = gaps;
    }
    // Gaps should stop changing meaningfully once the chain reaches its
    // steady-state trailing shape under constant velocity.
    for (let i = 0; i < prevGaps.length; i += 1) {
      expect(Math.abs(settledGaps[i]! - prevGaps[i]!)).toBeLessThan(0.5);
    }
    // And it should be a real trailing shape, not everything collapsed
    // onto the head.
    expect(settledGaps.every((g) => g > 0.1)).toBe(true);
  });

  test("tracks the head plausibly: converges to the head when it stops moving", () => {
    let chain = makeTendrilChain(0, 0);
    // Whip it out to the side first so there's real lag to resolve.
    for (let i = 0; i < 5; i += 1) chain = stepTendrilChain(chain, 200, 60, 1 / 60);
    // Now hold the head still for a long time.
    for (let i = 0; i < 300; i += 1) chain = stepTendrilChain(chain, 200, 60, 1 / 60);
    for (const seg of chain) {
      expect(dist(seg, { x: 200, y: 60 })).toBeLessThan(0.5);
    }
  });

  test("curls around a sharp direction change instead of snapping straight in one frame", () => {
    let chain = makeTendrilChain(0, 0);
    // Fly straight right for a while so the chain trails out along +x.
    let x = 0;
    for (let i = 0; i < 30; i += 1) {
      x += 320 * (1 / 60);
      chain = stepTendrilChain(chain, x, 0, 1 / 60);
    }
    // Sudden 90-degree turn: head jumps straight up from here on.
    let y = 0;
    for (let i = 0; i < 3; i += 1) {
      y += 320 * (1 / 60);
      chain = stepTendrilChain(chain, x, y, 1 / 60);
    }
    // Immediately after the turn, the trailing segments should still sit
    // out along the OLD (+x) heading, not on the new vertical line the
    // head is now tracing — i.e. the body visibly bends around the corner
    // rather than the whole chain re-orienting instantly.
    const tail = chain[chain.length - 1]!;
    expect(tail.x).toBeGreaterThan(1); // still displaced toward the old path
    expect(tail.y).toBeLessThan(y); // hasn't caught up to the new heading yet
  });

  test("larger deltaSeconds catches the chain up faster (frame-rate aware, no overshoot/NaN)", () => {
    let slow = makeTendrilChain(0, 0);
    let fast = makeTendrilChain(0, 0);
    slow = stepTendrilChain(slow, 100, 0, 1 / 240);
    fast = stepTendrilChain(fast, 100, 0, 1 / 15);
    // The lower-fps step (bigger dt) should close more of the gap this frame.
    expect(fast[1]!.x).toBeGreaterThan(slow[1]!.x);
    for (const seg of fast) {
      expect(Number.isFinite(seg.x)).toBe(true);
      expect(Number.isFinite(seg.y)).toBe(true);
    }
  });

  test("degenerate zero/negative deltaSeconds does not move trailing segments or throw", () => {
    let chain = makeTendrilChain(0, 0);
    chain = stepTendrilChain(chain, 50, 50, 0);
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i]).toEqual({ x: 0, y: 0 });
    }
    expect(() => stepTendrilChain(chain, 50, 50, -1)).not.toThrow();
  });
});

describe("stepTendrilChain — no state leaks across instances", () => {
  test("a fresh chain for a new projectile id starts clean even after another chain has accumulated a lot of lag", () => {
    let veteran = makeTendrilChain(0, 0);
    for (let i = 0; i < 50; i += 1) veteran = stepTendrilChain(veteran, i * 20, Math.sin(i) * 40, 1 / 60);
    // A brand-new tendril spawning this same frame must not inherit any of
    // that — it's a completely independent `makeTendrilChain` call, as the
    // ProjectileVfx caller does per-id via its Map.
    const rookie = makeTendrilChain(500, 500);
    for (const seg of rookie) {
      expect(seg).toEqual({ x: 500, y: 500 });
    }
    // Sanity: the veteran chain is NOT collapsed at the origin (proves the
    // "lots of lag accumulated" premise actually holds, so this test would
    // fail loudly if leakage were possible).
    expect(dist(veteran[veteran.length - 1]!, { x: 0, y: 0 })).toBeGreaterThan(1);
  });
});

describe("tendrilSegmentAlpha / tendrilSegmentWidthScale", () => {
  test("head is brightest and full-width, tail fades but never hits zero", () => {
    const count = TENDRIL_SEGMENT_COUNT;
    expect(tendrilSegmentAlpha(0, count)).toBe(1);
    expect(tendrilSegmentWidthScale(0, count)).toBe(1);
    const tailAlpha = tendrilSegmentAlpha(count - 1, count);
    const tailWidth = tendrilSegmentWidthScale(count - 1, count);
    expect(tailAlpha).toBeGreaterThan(0);
    expect(tailAlpha).toBeLessThan(1);
    expect(tailWidth).toBeGreaterThan(0);
    expect(tailWidth).toBeLessThan(1);
  });

  test("both are monotonically non-increasing from head to tail", () => {
    const count = TENDRIL_SEGMENT_COUNT;
    let prevAlpha = Infinity;
    let prevWidth = Infinity;
    for (let i = 0; i < count; i += 1) {
      const a = tendrilSegmentAlpha(i, count);
      const w = tendrilSegmentWidthScale(i, count);
      expect(a).toBeLessThanOrEqual(prevAlpha);
      expect(w).toBeLessThanOrEqual(prevWidth);
      prevAlpha = a;
      prevWidth = w;
    }
  });

  test("single-segment chain does not divide by zero", () => {
    expect(tendrilSegmentAlpha(0, 1)).toBe(1);
    expect(tendrilSegmentWidthScale(0, 1)).toBe(1);
  });
});
