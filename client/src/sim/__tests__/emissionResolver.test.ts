// Emission resolver contract (docs/emission-engine-goal.md P1).
// The cast is composed from the hand and budgeted below a kill — for EVERY
// card in the pool and for adversarial stacked hands, not just the starter
// build. Pure-data tests, no world stepping.

import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../data/cards.js";
import { starterWeapon } from "../data/weapons.js";
import { createWeaponBuild, findCardsById } from "../data/weaponBuild.js";
import {
  EMISSION_DAMAGE_BUDGET,
  EMISSION_VOLLEY_MAX,
  EMISSION_VOLLEY_MIN,
  resolveEmission,
} from "../data/emission.js";

describe("resolveEmission", () => {
  test("starter build (no cards) casts a real nova within budget", () => {
    const build = createWeaponBuild(starterWeapon, []);
    const e = resolveEmission(build);
    expect(e.volleyCount).toBeGreaterThanOrEqual(EMISSION_VOLLEY_MIN);
    expect(e.volleyCount).toBeLessThanOrEqual(EMISSION_VOLLEY_MAX);
    const maxSingleTarget = e.volleyCount * e.damagePerShard;
    expect(maxSingleTarget).toBeLessThanOrEqual(EMISSION_DAMAGE_BUDGET + 0.5);
    expect(maxSingleTarget).toBeLessThan(100); // never a full-health delete
  });

  test("EVERY single card in the pool keeps the cast within budget and bounds", () => {
    for (const card of crystalRoundsCards) {
      const build = createWeaponBuild(starterWeapon, [card]);
      const e = resolveEmission(build);
      const maxSingleTarget = e.volleyCount * e.damagePerShard;
      expect(maxSingleTarget).toBeLessThanOrEqual(EMISSION_DAMAGE_BUDGET + 0.5);
      expect(e.volleyCount).toBeGreaterThanOrEqual(EMISSION_VOLLEY_MIN);
      expect(e.volleyCount).toBeLessThanOrEqual(EMISSION_VOLLEY_MAX);
      expect(e.damagePerShard).toBeGreaterThan(0);
      expect(e.speed).toBeGreaterThan(0);
      expect(Number.isFinite(e.impactRadiusPx)).toBe(true);
    }
  });

  test("element and impact identity carry from the hand into the cast", () => {
    const fireCards = findCardsById(crystalRoundsCards, ["molten-core"]);
    const fireBuild = createWeaponBuild(starterWeapon, fireCards);
    expect(resolveEmission(fireBuild).element).toBe("fire");

    const bounceCards = findCardsById(crystalRoundsCards, ["bouncy-prism"]);
    const bounceBuild = createWeaponBuild(starterWeapon, bounceCards);
    expect(resolveEmission(bounceBuild).pathing).toBe("bounce");

    const explosiveCards = findCardsById(crystalRoundsCards, ["explosive-facet"]);
    const explosiveBuild = createWeaponBuild(starterWeapon, explosiveCards);
    expect(resolveEmission(explosiveBuild).impact).toBe("explosive");
  });

  test("multi-shot hands buy coverage, never more single-target damage", () => {
    const solo = resolveEmission(createWeaponBuild(starterWeapon, []));
    const sprayCards = findCardsById(crystalRoundsCards, [
      "five-shard-spray",
      "wide-barrage",
      "one-more-shard",
      "one-more-shard",
      "one-more-shard",
    ]);
    const spray = resolveEmission(createWeaponBuild(starterWeapon, sprayCards));
    expect(spray.volleyCount).toBeGreaterThan(solo.volleyCount);
    // Coverage went up; the single-target ceiling did not.
    expect(spray.volleyCount * spray.damagePerShard).toBeLessThanOrEqual(
      solo.volleyCount * solo.damagePerShard + 0.5,
    );
  });

  test("an adversarial max-stack hand cannot break the budget", () => {
    // Stack every damage/count/rate card the offer roll could legally allow
    // in one hand (unique cards once, stackables at maxStacks).
    const ids: string[] = [];
    for (const c of crystalRoundsCards) {
      const copies = c.unique ? 1 : Math.min(c.maxStacks ?? 1, 8);
      for (let i = 0; i < copies; i++) ids.push(c.id);
    }
    const build = createWeaponBuild(starterWeapon, findCardsById(crystalRoundsCards, ids));
    const e = resolveEmission(build);
    expect(e.volleyCount * e.damagePerShard).toBeLessThanOrEqual(
      EMISSION_DAMAGE_BUDGET + 0.5,
    );
    expect(e.volleyCount).toBeLessThanOrEqual(EMISSION_VOLLEY_MAX);
  });

  test("resolution is cached per build identity (same object back)", () => {
    const build = createWeaponBuild(starterWeapon, []);
    expect(resolveEmission(build)).toBe(resolveEmission(build));
  });

  // Axis sections are LIVE since six-axes-goal.md Phase 0 — this asserts
  // the doctrine #3 floor: a hand with NO axis fields stays fully inert.
  // Membership + charged values are pinned exhaustively in axisProfile.test.ts.
  test("axis sections are inert for a hand with no axis-marking fields", () => {
    const e = resolveEmission(createWeaponBuild(starterWeapon, []));
    expect(e.drain.leechFraction).toBe(0);
    expect(e.ward.storedReturnFraction).toBe(0);
    expect(e.stride.castAtDashEnd).toBe(false);
    expect(e.mystery.denyAscension).toBe(false);
    expect(e.technique.executeBelowFrac).toBe(0);
  });
});
