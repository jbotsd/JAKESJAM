import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../../../sim/data/cards.js";
import type { AbilityKind, ClassId } from "../../../sim/data/cardTypes.js";
import {
  ABILITY_ANIMATIONS,
  abilityAnimationPhase,
} from "../abilityAnimation.js";

describe("ability animation contracts", () => {
  const activeCards = crystalRoundsCards.filter((card) => card.active);

  test("every shipped active has an authored animation sentence", () => {
    expect(activeCards.length).toBeGreaterThan(40);
    for (const card of activeCards) {
      const kind = card.active!.kind as AbilityKind;
      const animation = ABILITY_ANIMATIONS[kind];
      expect(animation, `${card.id} animation`).toBeDefined();
      expect(animation.durationMs, `${card.id} duration`).toBeGreaterThanOrEqual(300);
      expect(animation.anticipationEnd, `${card.id} anticipation`).toBeGreaterThan(0.15);
      expect(animation.actionEnd, `${card.id} action`).toBeGreaterThan(animation.anticipationEnd);
      expect(abilityAnimationPhase(kind, 0)).toBe("anticipation");
      expect(abilityAnimationPhase(kind, 0.9)).toBe("recovery");
    }
  });

  test("class-exclusive actives animate through their own class weight", () => {
    for (const card of activeCards) {
      if (!card.classId) continue;
      const kind = card.active!.kind as AbilityKind;
      expect(ABILITY_ANIMATIONS[kind].classId, `${card.id} class`).toBe(card.classId as ClassId);
    }
  });

  test("the four chassis retain distinct cadence bands", () => {
    const average = (classId: ClassId): number => {
      const rows = Object.values(ABILITY_ANIMATIONS).filter((a) => a.classId === classId);
      return rows.reduce((sum, a) => sum + a.durationMs, 0) / rows.length;
    };
    expect(average("ninja")).toBeLessThan(average("wizard"));
    expect(average("wizard")).toBeLessThan(average("paladin"));
    expect(average("priest")).toBeGreaterThan(average("ninja"));
  });
});
