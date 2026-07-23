// cohesion-goal.md P1.5 — the display layer READS the sim's chassis table.
// characters.ts no longer declares any numeric chassis stat of its own, and
// the human-written kitSummary strings can't silently drift from the
// enforced numbers (the exact failure mode of the 2026-07-22 100/125 bug:
// display said 125, sim said 100, nobody noticed).

import { describe, expect, test } from "bun:test";
import { characters } from "../characters.js";
import { chassisStatsForArchetype } from "../../../sim/data/cardTypes.js";

describe("characters.ts reads the sim chassis table", () => {
  test("every numeric stat equals the sim table (no second copy of the numbers)", () => {
    for (const c of characters) {
      const chassis = chassisStatsForArchetype(c.id);
      expect(c.maxHealth).toBe(chassis.maxHealth);
      expect(c.moveSpeedMultiplier).toBe(chassis.moveSpeedMultiplier);
      expect(c.sizeScale).toBe(chassis.sizeScale);
      expect(c.recoilControlMultiplier).toBe(chassis.recoilControlMultiplier);
    }
  });

  test("kitSummary's leading hp figure matches the enforced max health", () => {
    for (const c of characters) {
      const hp = c.kitSummary.match(/^(\d+)hp/);
      expect(hp).not.toBeNull();
      expect(Number(hp![1])).toBe(chassisStatsForArchetype(c.id).maxHealth);
    }
  });
});
