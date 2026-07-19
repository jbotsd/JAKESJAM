import { describe, expect, test } from "bun:test";
import {
  BLADE_SWING_MS,
  EDGE_SWING_MS,
  meleeBladeAngle,
  meleeContactT,
  meleeHandPose,
  meleeKineticChain,
  meleeStage,
} from "../meleeTiming.js";

describe("melee attack rhythm", () => {
  test("Interstice reserves readable wind-up and committed follow-through", () => {
    expect(meleeStage(0.18, "interstice").anticipation).toBeGreaterThan(0.5);
    expect(meleeStage(0.18, "interstice").cut).toBe(0);
    expect(meleeStage(0.7, "interstice").cut).toBe(1);
    expect(meleeStage(0.7, "interstice").followThrough).toBeGreaterThan(0);
    expect(meleeStage(0.7, "interstice").recovery).toBe(0);
  });

  test("Kindred commits longer than Interstice", () => {
    expect(EDGE_SWING_MS).toBeGreaterThan(BLADE_SWING_MS);
    expect(meleeStage(0.25, "kindred").cut).toBe(0);
    expect(meleeStage(0.86, "kindred").followThrough).toBeGreaterThan(0.8);
    expect(meleeStage(0.86, "kindred").recovery).toBe(0);
  });

  test("Interstice is a broad cut rather than a full windmill", () => {
    const start = meleeBladeAngle(0, 2.25, 1, 0.32, "interstice");
    const finish = meleeBladeAngle(0, 2.25, 1, 0.84, "interstice");
    const travel = finish - start;
    expect(travel).toBeGreaterThan(Math.PI);
    expect(travel).toBeLessThan(Math.PI * 1.15);
  });

  test("the elbow/hand chain is not welded collinear with the blade", () => {
    const t = 0.38;
    const blade = meleeBladeAngle(0, 2.25, 1, t, "interstice");
    const hand = meleeHandPose(0, 1, t, "interstice");
    expect(Math.abs(blade - hand.angle)).toBeGreaterThan(0.3);
  });

  test("the sword hand folds in during coil then extends beyond contact", () => {
    const coil = meleeHandPose(0, 1, 0.32, "interstice");
    const extension = meleeHandPose(0, 1, 0.52, "interstice");
    expect(extension.reach - coil.reach).toBeGreaterThan(20);
    expect(extension.angle).toBeGreaterThan(coil.angle);
  });

  test("the authored radial intercept crosses aim near peak tip speed", () => {
    for (const [style, duration] of [
      ["interstice", BLADE_SWING_MS],
      ["kindred", EDGE_SWING_MS],
    ] as const) {
      const contact = meleeContactT(style);
      const angle = meleeBladeAngle(0, 2.25, 1, contact, style);
      expect(Math.abs(angle)).toBeLessThan(0.08);

      const speedAt = (t: number) =>
        (meleeBladeAngle(0, 2.25, 1, t + 0.004, style) -
          meleeBladeAngle(0, 2.25, 1, t - 0.004, style)) /
        0.008;
      expect(speedAt(contact)).toBeGreaterThan(speedAt(contact - 0.06));
      expect(speedAt(contact)).toBeGreaterThan(speedAt(contact + 0.06));

      const expectedMs = style === "interstice" ? 164 : 300;
      expect(contact * duration).toBeCloseTo(expectedMs, 0);
    }
  });

  test("the cut releases hips, chest, then shoulders instead of one rigid block", () => {
    for (const style of ["interstice", "kindred"] as const) {
      const cutStart = style === "interstice" ? 0.32 : 0.38;
      const cutEnd = style === "interstice" ? 0.52 : 0.61;
      const earlyCut = cutStart + (cutEnd - cutStart) * 0.24;
      const early = meleeKineticChain(earlyCut, style);
      expect(early.pelvisDrive).toBeGreaterThan(early.chestDrive);
      expect(early.shoulderTwist).toBeLessThan(0);
      expect(early.frontBrace).toBe(1);

      const contact = meleeKineticChain(meleeContactT(style), style);
      expect(contact.pelvisDrive).toBeGreaterThan(0);
      expect(contact.chestDrive).toBeGreaterThan(0);
      expect(contact.headDrive).toBeLessThan(contact.chestDrive);
      const follow = meleeKineticChain(style === "interstice" ? 0.7 : 0.76, style);
      expect(follow.shoulderTwist).toBeGreaterThan(contact.shoulderTwist);
      expect(follow.chestDrive).toBeGreaterThan(follow.pelvisDrive);
    }
  });

  test("the distal blade overtakes the hands at the radial intercept", () => {
    for (const style of ["interstice", "kindred"] as const) {
      const contact = meleeContactT(style);
      const delta = 0.002;
      const bladeSpeed = Math.abs(
        meleeBladeAngle(0, 2.25, 1, contact + delta, style) -
        meleeBladeAngle(0, 2.25, 1, contact - delta, style)
      ) / (2 * delta);
      const handSpeed = Math.abs(
        meleeHandPose(0, 1, contact + delta, style).angle -
        meleeHandPose(0, 1, contact - delta, style).angle
      ) / (2 * delta);
      expect(bladeSpeed).toBeGreaterThan(handSpeed * 2);
    }
  });
});
