import { describe, expect, test } from "bun:test";
import { CameraHype } from "../CameraHype.js";

describe("CameraHype", () => {
  test("does not reach peak from a single short burst", () => {
    const h = new CameraHype();
    for (let i = 0; i < 60; i++) h.update(16, 1); // ~1s of sustained drive
    expect(h.get()).toBeLessThan(0.1);
    expect(h.isPeak()).toBe(false);
  });

  test("reaches peak only after ~20s of sustained drive", () => {
    const h = new CameraHype();
    const dt = 100;
    for (let i = 0; i < 199; i++) h.update(dt, 1); // 19.9s
    expect(h.isPeak()).toBe(false);
    for (let i = 0; i < 5; i++) h.update(dt, 1); // past 20s
    expect(h.get()).toBe(1);
    expect(h.isPeak()).toBe(true);
  });

  test("drive below the sustain gate decays hype instead of building it", () => {
    const h = new CameraHype();
    for (let i = 0; i < 100; i++) h.update(100, 1); // 10s toward peak
    const midValue = h.get();
    expect(midValue).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) h.update(100, 0.1); // well below the gate
    expect(h.get()).toBeLessThan(midValue);
  });

  test("releases faster than it builds (stopping feels like stopping)", () => {
    const h = new CameraHype();
    for (let i = 0; i < 200; i++) h.update(100, 1); // fully peaked (20s)
    expect(h.get()).toBe(1);
    for (let i = 0; i < 10; i++) h.update(100, 0); // 1s of nothing
    // Release is ~6.7x faster than build (3s vs 20s) — 1s of release should
    // have dropped it noticeably more than 1s of build would have raised it.
    expect(h.get()).toBeLessThan(1 - 1 / 20);
  });

  test("peak flag has hysteresis — doesn't flicker right at the edge", () => {
    const h = new CameraHype();
    for (let i = 0; i < 200; i++) h.update(100, 1); // peaked
    expect(h.isPeak()).toBe(true);
    // Drop drive briefly — value dips slightly but should stay above the
    // (lower) exit threshold and peak should still hold.
    for (let i = 0; i < 3; i++) h.update(100, 0);
    expect(h.isPeak()).toBe(true);
  });

  test("exits peak once hype drops below the exit threshold", () => {
    const h = new CameraHype();
    for (let i = 0; i < 200; i++) h.update(100, 1); // peaked
    for (let i = 0; i < 20; i++) h.update(100, 0); // 2s of nothing — well past exit
    expect(h.isPeak()).toBe(false);
    expect(h.get()).toBeLessThan(0.55);
  });

  test("reset clears both value and peak state", () => {
    const h = new CameraHype();
    for (let i = 0; i < 200; i++) h.update(100, 1);
    expect(h.isPeak()).toBe(true);
    h.reset();
    expect(h.get()).toBe(0);
    expect(h.isPeak()).toBe(false);
  });

  test("value never goes negative or above 1 regardless of drive extremes", () => {
    const h = new CameraHype();
    for (let i = 0; i < 50; i++) h.update(1000, 0);
    expect(h.get()).toBe(0);
    const h2 = new CameraHype();
    for (let i = 0; i < 500; i++) h2.update(1000, 1);
    expect(h2.get()).toBe(1);
  });
});
