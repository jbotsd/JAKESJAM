// ── THE GEOMETRICIAN RULING (Jake, 2026-07-24 — supersedes 2026-07-22) ──
// Geometrician (classId "wizard") is ALWAYS raycast/hitscan delivery.
// Never projectile. Nothing may flip it — no card, no fallback.
//
// History this suite exists to make un-repeatable: Jake's 2026-07-22
// live-playtest message ("ton of abilities change the hitscan to a
// projectile — change that") meant the cards/abilities FLIPPING his hitscan
// into projectiles were the bug. It was misread as "make the base gun a
// projectile", weapons.ts grew a `wizardStarterWeapon` with delivery
// "projectile" (commit dbec211's weapons half), and on 2026-07-24 he
// clarified. Both halves of the fix are locked here:
//   1. the base weapon: wizard falls back to `starterWeapon` (raycast),
//      the same shared object Ninja uses (weapons.ts), and
//   2. the flip mechanism: createWeaponBuild forces a wizard build's final
//      delivery back to "raycast" after the card loop, before
//      applyDeliveryFeel, no matter what any card's `delivery:
//      "projectile"` modifier (top-level OR classModifiers) tried to do.
//
// JUDGMENT CALL, pinned by this suite: continuous-beam stays legal for
// wizard — a beam is instant-feel pressure, not a dodgeable traveling
// projectile — so ONLY the travel-time paths die ("projectile", and the
// pool-unreachable "area-pulse"). Travel-time card MODIFIERS stay applied:
// homing/bounce/gravity/accelerate fields ride the resolved build for every
// consumer that spawns REAL projectiles regardless of the basic gun's
// delivery — split children at the ray terminal (hitscanCardPool.test.ts's
// "Hitscan split" test drives that path end-to-end with this same
// wizard-classed "balanced" archetype), orbiting satellites, and the
// Emission volley (asserted below) — so travel-time cards are never dead
// picks for wizard.
//
// The Zig side of this rule (weapon_build.zig's resolveMods) is parity-
// locked in wasm/__tests__/weaponBuildParity.test.ts's wizard walk.

import { describe, expect, test } from "bun:test";
import { createWeaponBuild } from "../data/weaponBuild.js";
import { baseWeaponForClass, starterWeapon } from "../data/weapons.js";
import { resolveEmission } from "../data/emission.js";
import { crystalRoundsCards } from "../data/cards.js";
import type { CardDefinition } from "../data/cardTypes.js";

const find = (id: string): CardDefinition => {
  const c = crystalRoundsCards.find((c) => c.id === id);
  if (!c) throw new Error(`missing card: ${id}`);
  return c;
};

const wizardBuild = (cards: CardDefinition[]) =>
  createWeaponBuild(baseWeaponForClass("wizard"), cards, "wizard");

/** Every card in the pool that carries a `delivery: "projectile"` pull-back
 *  (the Category-A travel-time fallback plus the explicit weapon-replacement
 *  cards) — the exact flip mechanism the ruling kills for wizard. */
const TRAVEL_TIME_CARD_IDS = [
  "arc-shards",
  "deadfall-mortar",
  "micro-seekers",
  "homing-cluster",
  "bouncy-prism",
  "extra-bounce",
  "triple-fan",
  "boomerang-return",
  "i-rounds",
  "falling-star",
  "zero-g-floaters",
  "seeker-facets",
  "crystal-volley",
  "shard-bloom",
  "circle-rounds",
  "triangle-rounds",
] as const;

describe("THE GEOMETRICIAN RULING: a resolved wizard build is never delivery 'projectile'", () => {
  test("every card in crystalRoundsCards, singly", () => {
    for (const card of crystalRoundsCards) {
      const b = wizardBuild([card]);
      expect(b.delivery, `card ${card.id}`).not.toBe("projectile");
      // Precise expectation: the beam card keeps its beam identity (the
      // pinned carve-out); everything else resolves to raycast.
      if (card.id === "continuous-refractor") {
        expect(b.delivery, `card ${card.id}`).toBe("continuous-beam");
      } else {
        expect(b.delivery, `card ${card.id}`).toBe("raycast");
      }
    }
  });

  test("every pair of travel-time cards (the strongest flip pressure) still resolves raycast", () => {
    for (let i = 0; i < TRAVEL_TIME_CARD_IDS.length; i++) {
      for (let j = i + 1; j < TRAVEL_TIME_CARD_IDS.length; j++) {
        const a = TRAVEL_TIME_CARD_IDS[i]!;
        const b = TRAVEL_TIME_CARD_IDS[j]!;
        const build = wizardBuild([find(a), find(b)]);
        expect(build.delivery, `${a}+${b}`).toBe("raycast");
      }
    }
  });

  test("stacked triples including each travel-time card resolve raycast", () => {
    for (let i = 0; i < TRAVEL_TIME_CARD_IDS.length; i++) {
      const a = TRAVEL_TIME_CARD_IDS[i]!;
      const b = TRAVEL_TIME_CARD_IDS[(i + 1) % TRAVEL_TIME_CARD_IDS.length]!;
      const c = TRAVEL_TIME_CARD_IDS[(i + 2) % TRAVEL_TIME_CARD_IDS.length]!;
      const build = wizardBuild([find(a), find(b), find(c)]);
      expect(build.delivery, `${a}+${b}+${c}`).toBe("raycast");
    }
  });

  test("the whole travel-time set stacked at once resolves raycast", () => {
    const build = wizardBuild(TRAVEL_TIME_CARD_IDS.map(find));
    expect(build.delivery).toBe("raycast");
  });

  test("raycast feel floors apply to the forced delivery (enforcement runs BEFORE applyDeliveryFeel)", () => {
    // arc-shards' 0.86 speed multiplier would otherwise leave the resolved
    // shard slower than the base — the raycast feel floor must win.
    const build = wizardBuild([find("arc-shards")]);
    expect(build.projectile.speedMultiplier).toBeGreaterThanOrEqual(3.2);
    expect(build.projectile.rangePx).toBeGreaterThanOrEqual(880);
    expect(build.projectile.lifetimeMultiplier).toBeLessThanOrEqual(0.35);
  });

  test("JUDGMENT CALL pinned: continuous-beam stays legal for wizard, in either draft order", () => {
    const beam = find("continuous-refractor");
    const travel = find("arc-shards");
    expect(wizardBuild([beam, travel]).delivery).toBe("continuous-beam");
    expect(wizardBuild([travel, beam]).delivery).toBe("continuous-beam");
  });
});

describe("travel-time card modifiers stay APPLIED — never dead picks for wizard", () => {
  test("seeker-facets: homing pathing + strength ride the raycast build", () => {
    const b = wizardBuild([find("seeker-facets")]);
    expect(b.delivery).toBe("raycast");
    expect(b.projectile.pathing).toBe("homing");
    expect(b.projectile.homingStrength).toBeGreaterThan(0);
  });

  test("arc-shards: gravity pathing + gravityScale ride the raycast build", () => {
    const b = wizardBuild([find("arc-shards")]);
    expect(b.delivery).toBe("raycast");
    expect(b.projectile.pathing).toBe("gravity");
    expect(b.projectile.gravityScale).toBeGreaterThan(0);
  });

  test("bouncy-prism: bounces ride the raycast build", () => {
    const b = wizardBuild([find("bouncy-prism")]);
    expect(b.delivery).toBe("raycast");
    expect(b.projectile.pathing).toBe("bounce");
    expect(b.projectile.bounces).toBeGreaterThan(0);
  });

  test("i-rounds: accelerate pathing + a real ramp ride the raycast build", () => {
    const b = wizardBuild([find("i-rounds")]);
    expect(b.delivery).toBe("raycast");
    expect(b.projectile.pathing).toBe("accelerate");
    expect(b.projectile.accelerationMultiplier).not.toBe(0);
  });

  test("cluster-bomb: splitCount rides the raycast build (split children spawn at the ray terminal — hitscanCardPool.test.ts drives the World-level path)", () => {
    const b = wizardBuild([find("cluster-bomb")]);
    expect(b.delivery).toBe("raycast");
    expect(b.projectile.splitCount).toBeGreaterThan(0);
  });

  test("consumer proof: the Emission volley carries the hand's homing/bounce identity from a raycast wizard build", () => {
    // resolveEmission spawns REAL projectiles from the resolved build no
    // matter what the basic gun's delivery is — the exact reason the
    // travel-time modifiers must keep folding into the build.
    const b = wizardBuild([find("seeker-facets"), find("bouncy-prism")]);
    expect(b.delivery).toBe("raycast");
    const emission = resolveEmission(b);
    expect(emission.pathing).toBe("homing");
    expect(emission.homingStrength).toBeGreaterThan(0);
    expect(emission.bounces).toBeGreaterThan(0);
  });
});

describe("Priest/Paladin untouched — their explicit projectile overrides survive the ruling", () => {
  test("priest baseline: homing tendrils still need and keep real travel time", () => {
    const b = createWeaponBuild(baseWeaponForClass("priest"), [], "priest");
    expect(b.delivery).toBe("projectile");
    expect(b.projectile.pathing).toBe("homing");
    expect(b.projectile.homingStrength).toBeGreaterThan(0);
  });

  test("paladin baseline: heavier traveling bolt keeps its projectile delivery", () => {
    const b = createWeaponBuild(baseWeaponForClass("paladin"), [], "paladin");
    expect(b.delivery).toBe("projectile");
  });

  test("priest + seeker-facets: the classModifiers projectile pull-back still applies for priest", () => {
    const b = createWeaponBuild(baseWeaponForClass("priest"), [find("seeker-facets")], "priest");
    expect(b.delivery).toBe("projectile");
  });

  test("class-blind resolution (no classId) is untouched: travel-time cards still fall back to projectile", () => {
    // The pre-class-era contract weaponBuild.test.ts's own Category-A suite
    // pins — the ruling is wizard-scoped, not a global delivery rewrite.
    const b = createWeaponBuild(starterWeapon, [find("arc-shards")]);
    expect(b.delivery).toBe("projectile");
  });
});
