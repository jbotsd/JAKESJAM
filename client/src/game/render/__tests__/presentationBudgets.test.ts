import { describe, expect, test } from "bun:test";
import {
  PRESENTATION_BUDGETS,
  transientAllowance,
} from "../presentationBudgets.js";

describe("presentation intensity budgets", () => {
  test("stakes never receive less priority or camera ceiling", () => {
    const order = ["micro", "action", "hit", "heavy", "cast", "kill", "round"] as const;
    for (let i = 1; i < order.length; i += 1) {
      const previous = PRESENTATION_BUDGETS[order[i - 1]!];
      const current = PRESENTATION_BUDGETS[order[i]!];
      expect(current.priority).toBeGreaterThanOrEqual(previous.priority);
      expect(current.shakeDurationMs).toBeGreaterThanOrEqual(previous.shakeDurationMs);
      expect(current.shakeIntensity).toBeGreaterThanOrEqual(previous.shakeIntensity);
      expect(current.hitStopMs).toBeGreaterThanOrEqual(previous.hitStopMs);
    }
  });

  test("phone and potato reduce richness without deleting it", () => {
    expect(transientAllowance("action", "potato")).toBeGreaterThan(0);
    expect(transientAllowance("heavy", "phone")).toBeGreaterThan(
      transientAllowance("action", "phone"),
    );
    expect(transientAllowance("kill", "phone")).toBeLessThan(
      transientAllowance("kill", "standard"),
    );
  });
});
