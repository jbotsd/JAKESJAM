// Workboard chunk 0.2 — "E-key ultimate = Emission, verify/complete"
// (docs/class-overhaul-workboard.md §0.2, docs/classes-goal.md "E-KEY
// RULING"). Confirms the actual gap-closing question: does `resolveEmission`
// automatically pick up class-flavored builds with ZERO new branching inside
// emission.ts itself?
//
// Investigation finding (see this session's report): `emission.ts` never
// reads `classId` — by design. It is a pure function of `ResolvedWeaponBuild`
// (`resolveEmission(build)`), and BOTH real call sites (World.ts's Ability-
// edge cast, renderContract.ts's ascension-denial FX) already feed it the
// SAME class-aware build that `resolvePlayerBuild` produces via
// `classIdForArchetype(player.characterId)` (weapon.ts:100-133, wired this
// session's classModifiers infra). So class-awareness is inherited for free
// through the build object, exactly the "no per-class branching inside the
// resolver" doctrine emission.ts's own header locks.
//
// Today's authored classModifiers content (cards.ts) happens to differ from
// its class-blind reading only on fields resolveEmission does NOT read
// (damageMultiplier, projectileSplitAdd, jump/wallJump, moveSpeedMultiplier —
// see classExpression.test.ts) or is "intentionally identical" per its own
// comments (molten-core/frost-prism/double-jump). That means no REAL card
// today produces an observably different Emission across classes yet — a
// content gap, not a wiring gap. This suite proves the wiring with a
// synthetic classModifiers fixture on a field resolveEmission DOES read
// (projectile count → volleyCount), the same fixture-card technique
// classExpression.test.ts itself uses to isolate the mechanism from content.

import { describe, expect, test } from "bun:test";
import { createWeaponBuild } from "../data/weaponBuild.js";
import { resolveEmission } from "../data/emission.js";
import { starterWeapon } from "../data/weapons.js";
import type { CardDefinition } from "../data/cardTypes.js";

describe("resolveEmission is class-aware purely through the build it's handed", () => {
  const countFixture: CardDefinition = {
    id: "test-emission-class-fixture",
    name: "Test Emission Class Fixture",
    category: "projectile",
    rarity: "common",
    description: "fixture — not a real card, test-only",
    modifier: { projectileCountAdd: 0 },
    classModifiers: {
      wizard: { projectileCountAdd: 3 },
    },
  };

  test("a classModifiers override on an emission-consumed field (projectile count) changes the cast — with ZERO classId knowledge inside emission.ts", () => {
    const classBlindBuild = createWeaponBuild(starterWeapon, [countFixture]);
    const wizardBuild = createWeaponBuild(starterWeapon, [countFixture], "wizard");
    // The override lands on the build first (this session's classModifiers
    // infra, not emission.ts's concern) ...
    expect(wizardBuild.projectile.count).toBeGreaterThan(classBlindBuild.projectile.count);
    // ... and resolveEmission, given nothing but the two builds, reads the
    // difference straight through: volleyCount = clamp(count × 4, 6, 16).
    const classBlindEmission = resolveEmission(classBlindBuild);
    const wizardEmission = resolveEmission(wizardBuild);
    expect(wizardEmission.volleyCount).toBeGreaterThan(classBlindEmission.volleyCount);
    // Damage budget stays fixed regardless of class — more shards buys
    // coverage, never more single-target damage (goal-doc doctrine, still
    // true per-class).
    const blindTotal = classBlindEmission.volleyCount * classBlindEmission.damagePerShard;
    const wizardTotal = wizardEmission.volleyCount * wizardEmission.damagePerShard;
    expect(blindTotal).toBeCloseTo(wizardTotal, 0);
  });

  test("classes with no authored override reproduce the class-blind cast exactly — never a placeholder, never another class's reading", () => {
    const classBlindBuild = createWeaponBuild(starterWeapon, [countFixture]);
    const classBlindEmission = resolveEmission(classBlindBuild);
    for (const other of ["ninja", "paladin", "priest"] as const) {
      const build = createWeaponBuild(starterWeapon, [countFixture], other);
      const emission = resolveEmission(build);
      expect(emission).toEqual(classBlindEmission);
    }
  });

  test("omitting classId is byte-identical to today's resolution (Zig parity boundary untouched)", () => {
    const withNoClass = createWeaponBuild(starterWeapon, [countFixture]);
    const explicit = createWeaponBuild(starterWeapon, [countFixture], undefined);
    expect(resolveEmission(withNoClass)).toEqual(resolveEmission(explicit));
  });

  test("element identity — another emission-consumed field — is equally class-blind-by-default", () => {
    const elementFixture: CardDefinition = {
      id: "test-emission-element-fixture",
      name: "Test Emission Element Fixture",
      category: "projectile",
      rarity: "common",
      description: "fixture — not a real card, test-only",
      modifier: { projectile: { element: "fire" } },
      classModifiers: {
        wizard: { projectile: { element: "ice" } },
      },
    };
    const classBlind = resolveEmission(createWeaponBuild(starterWeapon, [elementFixture]));
    const wizard = resolveEmission(createWeaponBuild(starterWeapon, [elementFixture], "wizard"));
    const ninja = resolveEmission(
      createWeaponBuild(starterWeapon, [elementFixture], "ninja"),
    );
    expect(classBlind.element).toBe("fire");
    expect(wizard.element).toBe("ice");
    expect(ninja.element).toBe("fire"); // no authored ninja override → falls back
  });
});
