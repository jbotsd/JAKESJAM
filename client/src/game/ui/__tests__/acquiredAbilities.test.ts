// Acquired-ability derivation contract (acquiredAbilities.ts): the action
// bar's slots are a pure read over the resolved build — hand order is
// acquisition order, stacks update counts in place without reshuffling,
// and the derivation is identity-cached for the per-frame HUD call.

import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../../../sim/data/cards.js";
import { starterWeapon } from "../../../sim/data/weapons.js";
import { createWeaponBuild, findCardsById } from "../../../sim/data/weaponBuild.js";
import { acquiredAbilities } from "../acquiredAbilities.js";

function buildOf(ids: string[]) {
  return createWeaponBuild(starterWeapon, findCardsById(crystalRoundsCards, ids));
}

describe("acquiredAbilities", () => {
  test("empty hand acquires nothing", () => {
    expect(acquiredAbilities(buildOf([]))).toEqual([]);
  });

  test("stat-only cards acquire nothing (no false slots)", () => {
    expect(acquiredAbilities(buildOf(["triangle-rounds", "rapid-refraction"]))).toEqual([]);
  });

  test("capability cards appear in hand (acquisition) order", () => {
    const abilities = acquiredAbilities(
      buildOf(["stolen-fangs", "double-jump", "orbiting-satellites"]),
    );
    expect(abilities.map((a) => a.kind)).toEqual([
      "stolen-fangs",
      "air-jumps",
      "satellites",
    ]);
  });

  test("stacking updates the count in place — the slot never moves", () => {
    const abilities = acquiredAbilities(
      buildOf(["double-jump", "orbiting-satellites", "double-jump"]),
    );
    expect(abilities.map((a) => a.kind)).toEqual(["air-jumps", "satellites"]);
    const airJumps = abilities.find((a) => a.kind === "air-jumps")!;
    expect(airJumps.count).toBe(buildOf(["double-jump", "double-jump"]).airJumps);
    expect(airJumps.count).toBeGreaterThan(1);
  });

  test("mirror shield and aim shield derive from their cards", () => {
    const kinds = acquiredAbilities(buildOf(["mirror-shield", "aim-barrier"])).map(
      (a) => a.kind,
    );
    expect(kinds).toContain("mirror-shield");
    expect(kinds).toContain("aim-shield");
  });

  test("derivation is cached per build identity", () => {
    const build = buildOf(["double-jump"]);
    expect(acquiredAbilities(build)).toBe(acquiredAbilities(build));
  });
});
