import { describe, expect, test } from "bun:test";
import {
  ENVELOPE_MARGIN_FRAC,
  fightPairFocus,
  fitEnvelope,
  smoothZoomGoal,
  stickyEnvelopeSubjects,
  weightedCentroid,
  zoomToFit,
} from "../actionCameraMath.js";

describe("actionCameraMath — smooth envelope", () => {
  test("soft centroid alone leaves a far enemy off-screen at zoom 1.4 view", () => {
    const halfW = 1280 / 2 / 1.4;
    const self = { x: 0, y: 0 };
    const enemy = { x: 800, y: 0 };
    const soft = weightedCentroid(self, [enemy]);
    expect(Math.abs(enemy.x - soft.x)).toBeGreaterThan(halfW * (1 - ENVELOPE_MARGIN_FRAC));
  });

  test("fitEnvelope soft-pulls so both stay inside a wide-enough view", () => {
    const halfW = 520;
    const halfH = 400;
    const self = { x: 0, y: 0 };
    const enemy = { x: 800, y: 0 };
    const soft = weightedCentroid(self, [enemy]);
    expect(Math.abs(enemy.x - soft.x)).toBeGreaterThan(halfW * (1 - ENVELOPE_MARGIN_FRAC));
    const env = fitEnvelope(soft, self, [enemy], halfW, halfH);
    expect(env.subjectCount).toBe(1);
    const fit = halfW * (1 - ENVELOPE_MARGIN_FRAC);
    expect(Math.abs(self.x - env.x)).toBeLessThanOrEqual(fit + 1);
    expect(Math.abs(enemy.x - env.x)).toBeLessThanOrEqual(fit + 1);
  });

  test("span wider than view → eases toward midpoint + reports neededHalfW", () => {
    const halfW = 400;
    const halfH = 300;
    const self = { x: 0, y: 0 };
    const enemy = { x: 900, y: 0 };
    const env = fitEnvelope({ x: 0, y: 0 }, self, [enemy], halfW, halfH);
    expect(env.subjectCount).toBe(1);
    // Soft pull + overflow blend → centre moves well toward mid (450), not stuck at 0.
    expect(env.x).toBeGreaterThan(200);
    expect(env.x).toBeLessThan(700);
    expect(env.neededHalfW).toBeGreaterThan(halfW);
  });

  test("zoomToFit pulls out, never past base, floors at min zoom", () => {
    const z = zoomToFit(1280, 720, 600, 0, 1.4);
    expect(z).toBeLessThan(1.4);
    expect(z).toBeCloseTo(1280 / (2 * 600), 3);
    expect(zoomToFit(1280, 720, 0, 0, 1.4)).toBe(1.4);
    expect(zoomToFit(1280, 720, 2000, 0, 1.4)).toBe(1.02);
  });

  test("smoothZoomGoal deadbands small flips", () => {
    expect(smoothZoomGoal(1.2, 1.21, 1.4)).toBe(1.2); // inside band
    expect(smoothZoomGoal(1.2, 1.0, 1.4)).toBe(1.02); // zoom out clamped to min
  });

  test("sticky subjects keep previous foe when distances swap slightly", () => {
    const self = { x: 0, y: 0 };
    const a = { x: 400, y: 0 };
    const b = { x: 410, y: 0 };
    const first = stickyEnvelopeSubjects(self, [a, b], []);
    expect(first[0]!.x).toBe(400);
    // Next frame b is slightly closer — stickiness keeps a if still tracked.
    const bCloser = { x: 390, y: 0 };
    const aStill = { x: 405, y: 0 };
    const second = stickyEnvelopeSubjects(self, [aStill, bCloser], first);
    // Previous subject a matches aStill (within 80px); keep it.
    expect(second.some((p) => Math.abs(p.x - 405) < 1)).toBe(true);
  });

  test("fightPairFocus midpoints self + nearest enemy", () => {
    const f = fightPairFocus({ x: 100, y: 200 }, [
      { x: 600, y: 200 }, // within ENVELOPE_RANGE (750)
      { x: 5000, y: 200 },
    ]);
    expect(f.x).toBe(350);
    expect(f.y).toBe(200);
  });
});
