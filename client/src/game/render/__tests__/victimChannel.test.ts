// Victim-channel planner (R1 rows 3-8) — the pure, Phaser-free surface
// the rig applies. Numbers are the ledger's R1 table verbatim; the shape
// contracts (instant-on flash, ease-out flinch, spring-back squash,
// decaying vibration, capped never-stacking holds) are what the tape
// critiques verify frame-by-frame.

import { describe, expect, test } from "bun:test";
import {
  cameraKickParams,
  flashMix,
  flinchOffset,
  impactChannelParams,
  pairHoldMs,
  squashScale,
  vibrationOffset,
} from "../victimChannel.js";

describe("chassis parameterization (rows 3-8, both columns)", () => {
  test("Kindled column matches R1 verbatim", () => {
    const k = impactChannelParams("kindled");
    expect(k.pairStopHitMs).toBe(100);
    expect(k.pairStopKillMs).toBe(150);
    expect(k.victimKillHoldMul).toBe(1.5);
    expect(k.holdCapMs).toBe(250);
    expect(k.vibrationPx).toBe(2.5);
    expect(k.flashInMs).toBe(50);
    expect(k.flashOutMs).toBe(50);
    expect(k.flinchPx).toBe(7);
    expect(k.squashX).toBe(1.35);
    expect(k.squashY).toBe(0.7);
  });

  test("Interstice column matches R1 verbatim (shared module, not a fork)", () => {
    const i = impactChannelParams("interstice");
    expect(i.pairStopHitMs).toBe(50);
    expect(i.pairStopKillMs).toBe(117);
    expect(i.vibrationPx).toBe(1.5);
    expect(i.flashInMs).toBe(33);
    expect(i.flinchPx).toBe(4);
    expect(i.squashX).toBe(1.25);
    expect(i.squashY).toBe(0.8);
  });
});

describe("flash — instant on, full white, then decay (row 6)", () => {
  const k = impactChannelParams("kindled");
  test("frame 0 is already full white (SNK/SFA3 first-frame discipline)", () => {
    expect(flashMix(0, k)).toBe(1);
    expect(flashMix(k.flashInMs, k)).toBe(1);
  });
  test("decays to 0 by in+out and stays 0", () => {
    expect(flashMix(k.flashInMs + k.flashOutMs, k)).toBe(0);
    expect(flashMix(1000, k)).toBe(0);
  });
  test("kill flash holds white longer (67ms)", () => {
    expect(flashMix(60, k, true)).toBe(1);
    expect(flashMix(60, k, false)).toBeLessThan(1);
  });
});

describe("squash — hold then spring back through 1 (row 8)", () => {
  const k = impactChannelParams("kindled");
  test("full squash through the hold window", () => {
    expect(squashScale(0, k)).toEqual({ x: 1.35, y: 0.7 });
    expect(squashScale(k.squashHoldMs, k)).toEqual({ x: 1.35, y: 0.7 });
  });
  test("springs back to exactly 1 at the end and overshoots past 1 on the way", () => {
    const end = squashScale(k.squashHoldMs + k.squashSpringMs, k);
    expect(end.x).toBe(1);
    expect(end.y).toBe(1);
    // Somewhere mid-spring the cosine passes the rest pose (the rebound).
    let overshot = false;
    for (let ms = k.squashHoldMs + 1; ms < k.squashHoldMs + k.squashSpringMs; ms += 2) {
      if (squashScale(ms, k).y > 1) overshot = true;
    }
    expect(overshot).toBe(true);
  });
});

describe("flinch — instant full offset along the hit vector, ease-out (row 7)", () => {
  const k = impactChannelParams("kindled");
  test("frame 0 is the full 7px along the (normalized) vector, zero cross-fade", () => {
    const f = flinchOffset(0, k, 3, 4); // 3-4-5 triangle
    expect(f.x).toBeCloseTo(7 * 0.6, 5);
    expect(f.y).toBeCloseTo(7 * 0.8, 5);
  });
  test("monotonically eases out to nothing by flinchMs", () => {
    const a = Math.hypot(flinchOffset(40, k, 1, 0).x, 0);
    const b = Math.hypot(flinchOffset(120, k, 1, 0).x, 0);
    expect(a).toBeGreaterThan(b);
    expect(flinchOffset(k.flinchMs, k, 1, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("vibration — decaying oscillation inside the hold (row 5)", () => {
  test("oscillates within ±amplitude, decays toward 0, silent outside the hold", () => {
    const total = 100;
    let sawPositive = false;
    let sawNegative = false;
    for (let ms = 0; ms < total; ms += 4) {
      const v = vibrationOffset(ms, total, 2.5);
      expect(Math.abs(v)).toBeLessThanOrEqual(2.5);
      if (v > 0.5) sawPositive = true;
      if (v < -0.5) sawNegative = true;
    }
    expect(sawPositive).toBe(true);
    expect(sawNegative).toBe(true);
    expect(Math.abs(vibrationOffset(96, total, 2.5))).toBeLessThan(0.5);
    expect(vibrationOffset(total, total, 2.5)).toBe(0);
  });
});

describe("pair holds — kill tier, victim 1.5x, hard cap (rows 3-4)", () => {
  test("Kindled: 100 hit both roles; kill 150 attacker / 225 victim; cap 250", () => {
    const k = impactChannelParams("kindled");
    expect(pairHoldMs(k, "attacker", false)).toBe(100);
    expect(pairHoldMs(k, "victim", false)).toBe(100);
    expect(pairHoldMs(k, "attacker", true)).toBe(150);
    expect(pairHoldMs(k, "victim", true)).toBe(225);
    expect(pairHoldMs({ ...k, pairStopKillMs: 200 }, "victim", true)).toBe(250); // capped
  });
  test("Interstice: 50 hit; kill 117 / 175.5-capped-to-cap", () => {
    const i = impactChannelParams("interstice");
    expect(pairHoldMs(i, "victim", false)).toBe(50);
    expect(pairHoldMs(i, "attacker", true)).toBe(117);
    expect(pairHoldMs(i, "victim", true)).toBeCloseTo(175.5, 5);
  });
});

describe("directional camera kick params (row 9 — no roll, per Jake's camera direction)", () => {
  test("hit: 8px/4px/120ms (K), 4px/2px/80ms (I); kill: 12px/6px/180ms both", () => {
    expect(cameraKickParams("kindled", false)).toEqual({ kickPx: 8, noisePx: 4, durMs: 120 });
    expect(cameraKickParams("interstice", false)).toEqual({ kickPx: 4, noisePx: 2, durMs: 80 });
    expect(cameraKickParams("kindled", true)).toEqual({ kickPx: 12, noisePx: 6, durMs: 180 });
    expect(cameraKickParams("interstice", true)).toEqual({ kickPx: 12, noisePx: 6, durMs: 180 });
  });
});
