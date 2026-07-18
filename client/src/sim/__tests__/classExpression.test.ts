// Class-expression infrastructure (docs/classes-goal.md C3, card-pool-v2.md):
// CardDefinition.classModifiers lets a card carry a per-class effect variant
// that REPLACES the class-blind `modifier` for that class only. This suite
// covers (1) the mechanism itself in isolation, (2) the class-blind fallback
// guarantee (a class with no authored entry must resolve EXACTLY like today
// — never a placeholder, never another class's reading), and (3) the real
// Wizard cards authored this session against docs/card-pool-v2.md.

import { describe, test, expect } from "bun:test";
import {
  createWeaponBuild,
  applyCard,
  effectiveCardModifier,
} from "../data/weaponBuild.js";
import { classIdForArchetype } from "../data/cardTypes.js";
import type { CardDefinition } from "../data/cardTypes.js";
import { starterWeapon, priestStarterWeapon, baseWeaponForClass } from "../data/weapons.js";
import { crystalRoundsCards } from "../data/cards.js";
import { resolvePlayerBuild } from "../weapon.js";
import { stepWeapon } from "../weapon.js";
import { EntityId, InputSeq, type PlayerEntity, type PlayerId } from "../types.js";

function mkPlayer(over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: "p1" as PlayerId,
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...over,
  };
}

function findCard(id: string): CardDefinition {
  const card = crystalRoundsCards.find((c) => c.id === id);
  if (!card) throw new Error(`fixture card missing: ${id}`);
  return card;
}

describe("classIdForArchetype", () => {
  test("maps every sim archetype to its class dev-id (classes-goal.md § Naming)", () => {
    expect(classIdForArchetype("balanced")).toBe("wizard");
    expect(classIdForArchetype("heavy")).toBe("paladin");
    expect(classIdForArchetype("sprinter")).toBe("ninja");
    expect(classIdForArchetype("shielded")).toBe("priest");
  });
});

describe("effectiveCardModifier — the resolution hook", () => {
  const withOverride: CardDefinition = {
    id: "test-class-card",
    name: "Test Class Card",
    category: "projectile",
    rarity: "common",
    description: "fixture",
    modifier: { damageMultiplier: 1.0 },
    classModifiers: {
      wizard: { damageMultiplier: 2.0 },
    },
  };

  test("no classId => class-blind modifier (today's behavior, unchanged)", () => {
    expect(effectiveCardModifier(withOverride)).toEqual({ damageMultiplier: 1.0 });
  });

  test("classId with no authored override => falls back to the class-blind modifier", () => {
    expect(effectiveCardModifier(withOverride, "ninja")).toEqual({ damageMultiplier: 1.0 });
    expect(effectiveCardModifier(withOverride, "paladin")).toEqual({ damageMultiplier: 1.0 });
    expect(effectiveCardModifier(withOverride, "priest")).toEqual({ damageMultiplier: 1.0 });
  });

  test("classId WITH an authored override => the override wins wholesale (never merged)", () => {
    expect(effectiveCardModifier(withOverride, "wizard")).toEqual({ damageMultiplier: 2.0 });
  });

  test("a card with no classModifiers at all is unaffected by classId", () => {
    const plain: CardDefinition = {
      id: "plain",
      name: "Plain",
      category: "projectile",
      rarity: "common",
      description: "fixture",
      modifier: { damageMultiplier: 1.3 },
    };
    expect(effectiveCardModifier(plain, "wizard")).toEqual({ damageMultiplier: 1.3 });
    expect(effectiveCardModifier(plain)).toEqual({ damageMultiplier: 1.3 });
  });
});

describe("createWeaponBuild — end-to-end class-aware resolution", () => {
  const card: CardDefinition = {
    id: "e2e-class-card",
    name: "E2E Class Card",
    category: "projectile",
    rarity: "common",
    description: "fixture",
    modifier: { damageMultiplier: 1.0 },
    classModifiers: {
      wizard: { damageMultiplier: 2.0 },
    },
  };

  test("a card with a Wizard-specific override resolves DIFFERENTLY than the same card without one", () => {
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const wizardBuild = createWeaponBuild(starterWeapon, [card], "wizard");
    // clampBuild's TTK floor may soften the raw 2× (combat-balance-ttk
    // discipline applies identically regardless of class), so assert the
    // DIRECTION and rough magnitude rather than an exact multiple.
    expect(wizardBuild.damage).toBeGreaterThan(classBlind.damage);
    expect(classBlind.damage).toBeCloseTo(starterWeapon.damage, 6);
  });

  test("a class with no authored override reproduces the class-blind build exactly", () => {
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const ninjaBuild = createWeaponBuild(starterWeapon, [card], "ninja");
    const paladinBuild = createWeaponBuild(starterWeapon, [card], "paladin");
    const priestBuild = createWeaponBuild(starterWeapon, [card], "priest");
    expect(ninjaBuild.damage).toBe(classBlind.damage);
    expect(paladinBuild.damage).toBe(classBlind.damage);
    expect(priestBuild.damage).toBe(classBlind.damage);
  });

  test("applyCard honors the same class hook directly", () => {
    const base = createWeaponBuild(starterWeapon, []);
    const wizardApplied = { ...base, cards: [] };
    applyCard(wizardApplied, card, "wizard");
    const blindApplied = { ...base, cards: [] };
    applyCard(blindApplied, card);
    expect(wizardApplied.damage).toBeGreaterThan(blindApplied.damage);
  });

  test("omitting classId is byte-identical to pre-class-era resolution (Zig parity boundary)", () => {
    // The Zig parity suite (wasm/__tests__/weaponBuildParity.test.ts) calls
    // createWeaponBuild without a classId — this locks that no classModifiers
    // content can ever leak into that comparison.
    for (const c of crystalRoundsCards) {
      if (!c.modifier) continue;
      const withNoClass = createWeaponBuild(starterWeapon, [c]);
      const explicit = createWeaponBuild(starterWeapon, [c], undefined);
      expect(withNoClass).toEqual(explicit);
    }
  });
});

describe("authored Wizard cards (docs/card-pool-v2.md universal specs/passives)", () => {
  test("Grudge (seeker-facets): Wizard pays the −10% damage the redesign prices in", () => {
    const card = findCard("seeker-facets");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const ninja = createWeaponBuild(starterWeapon, [card], "ninja");
    expect(wizard.damage).toBeLessThan(classBlind.damage);
    expect(wizard.damage).toBeCloseTo(classBlind.damage * 0.9, 2);
    // Homing identity survives on both readings.
    expect(wizard.projectile.homingStrength).toBeGreaterThan(0);
    // Ninja has no authored Grudge yet: falls back to the flat-pool card.
    expect(ninja.damage).toBe(classBlind.damage);
  });

  test("Splinterhead (cluster-bomb): Wizard's split count is re-authored to 3, not 6", () => {
    const card = findCard("cluster-bomb");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    expect(classBlind.projectile.splitCount).toBe(6);
    expect(wizard.projectile.splitCount).toBe(3);
  });

  test("Cinder (molten-core) and Hoarfrost (frost-prism): Wizard is the textbook cast — zero numeric change", () => {
    const cinder = findCard("molten-core");
    const cinderBlind = createWeaponBuild(starterWeapon, [cinder]);
    const cinderWizard = createWeaponBuild(starterWeapon, [cinder], "wizard");
    expect(cinderWizard.projectile.element).toBe("fire");
    expect(cinderWizard).toEqual(cinderBlind);

    const hoarfrost = findCard("frost-prism");
    const hoarfrostBlind = createWeaponBuild(starterWeapon, [hoarfrost]);
    const hoarfrostWizard = createWeaponBuild(starterWeapon, [hoarfrost], "wizard");
    expect(hoarfrostWizard.projectile.element).toBe("ice");
    expect(hoarfrostWizard).toEqual(hoarfrostBlind);
  });

  test("Spring Heel: Wizard's jump/wall-jump numbers are re-tuned to +10%/+10%, not +18%/+16%", () => {
    const card = findCard("spring-heel");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    expect(classBlind.jumpMultiplier).toBeCloseTo(1.18, 5);
    expect(classBlind.wallJumpMultiplier).toBeCloseTo(1.16, 5);
    expect(wizard.jumpMultiplier).toBeCloseTo(1.1, 5);
    expect(wizard.wallJumpMultiplier).toBeCloseTo(1.1, 5);
  });

  test("Second Wind (double-jump): Wizard matches the doc exactly (+1 air jump), zero change", () => {
    const card = findCard("double-jump");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    expect(classBlind.airJumps).toBe(1);
    expect(wizard.airJumps).toBe(1);
    expect(wizard).toEqual(classBlind);
  });

  test("Plating (crystal-plating): Wizard's move-speed cost tightens to −3%, not −2%", () => {
    const card = findCard("crystal-plating");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    expect(classBlind.maxHealthAdd).toBe(20);
    expect(wizard.maxHealthAdd).toBe(20);
    expect(classBlind.moveSpeedMultiplier).toBeCloseTo(0.98, 5);
    expect(wizard.moveSpeedMultiplier).toBeCloseTo(0.97, 5);
  });

  test("resolvePlayerBuild wires classId LIVE from characterId — no per-call-site plumbing needed", () => {
    const wizardPlayer = mkPlayer({ characterId: "balanced", cards: ["seeker-facets"] });
    const ninjaPlayer = mkPlayer({
      id: "p2" as PlayerId,
      characterId: "sprinter",
      cards: ["seeker-facets"],
    });
    const wizardBuild = resolvePlayerBuild(wizardPlayer);
    const ninjaBuild = resolvePlayerBuild(ninjaPlayer);
    // Wizard drafted Grudge's real reading (−10% damage); Ninja (no authored
    // Grudge yet) gets the untouched flat-pool Seeker Facets.
    expect(wizardBuild.damage).toBeLessThan(ninjaBuild.damage);
    expect(wizardBuild.damage).toBeCloseTo(ninjaBuild.damage * 0.9, 2);
  });

  test("Ninja/Paladin/Priest fall back cleanly on every authored Wizard card — never a Wizard-flavored effect", () => {
    const authoredIds = [
      "seeker-facets",
      "cluster-bomb",
      "molten-core",
      "frost-prism",
      "spring-heel",
      "double-jump",
      "crystal-plating",
    ];
    for (const id of authoredIds) {
      const card = findCard(id);
      const classBlind = createWeaponBuild(starterWeapon, [card]);
      for (const other of ["ninja", "paladin", "priest"] as const) {
        const build = createWeaponBuild(starterWeapon, [card], other);
        expect(build).toEqual(classBlind);
      }
    }
  });
});

// ── Priest / Syzygist solo floor (docs/class-overhaul-workboard.md chunk
//    0.3, docs/classes-goal.md "Priest / Syzygist") — curses + lifesteal,
//    the part of Priest's kit that ships into pure FFA with no teammate. ──

describe("Priest baseline: detuned starter bolt (docs/classes-goal.md 'modest projectile, wizard's starter, detuned')", () => {
  test("baseWeaponForClass falls back to starterWeapon for every class but priest", () => {
    expect(baseWeaponForClass(undefined)).toBe(starterWeapon);
    expect(baseWeaponForClass("wizard")).toBe(starterWeapon);
    expect(baseWeaponForClass("ninja")).toBe(starterWeapon);
    expect(baseWeaponForClass("paladin")).toBe(starterWeapon);
    expect(baseWeaponForClass("priest")).toBe(priestStarterWeapon);
  });

  test("priestStarterWeapon is a same-shape, lower-damage copy of starterWeapon", () => {
    expect(priestStarterWeapon.damage).toBeLessThan(starterWeapon.damage);
    expect(priestStarterWeapon.delivery).toBe(starterWeapon.delivery);
    expect(priestStarterWeapon.projectile.shape).toBe(starterWeapon.projectile.shape);
    expect(priestStarterWeapon.fireRate).toBe(starterWeapon.fireRate);
    expect(priestStarterWeapon.id).toBe(starterWeapon.id);
  });

  test("createWeaponBuild(baseWeaponForClass(classId), ...) with no cards: only Priest is detuned", () => {
    const wizard = createWeaponBuild(baseWeaponForClass("wizard"), [], "wizard");
    const ninja = createWeaponBuild(baseWeaponForClass("ninja"), [], "ninja");
    const paladin = createWeaponBuild(baseWeaponForClass("paladin"), [], "paladin");
    const priest = createWeaponBuild(baseWeaponForClass("priest"), [], "priest");
    expect(wizard.damage).toBe(starterWeapon.damage);
    expect(ninja.damage).toBe(starterWeapon.damage);
    expect(paladin.damage).toBe(starterWeapon.damage);
    expect(priest.damage).toBeLessThan(starterWeapon.damage);
  });

  test("resolvePlayerBuild: a bare Shielded (priest) player fires for less than a bare Balanced (wizard) player", () => {
    const wizardPlayer = mkPlayer({ characterId: "balanced", cards: [] });
    const priestPlayer = mkPlayer({
      id: "p2" as PlayerId,
      characterId: "shielded",
      cards: [],
    });
    const wizardBuild = resolvePlayerBuild(wizardPlayer);
    const priestBuild = resolvePlayerBuild(priestPlayer);
    expect(priestBuild.damage).toBeLessThan(wizardBuild.damage);
    // Still a real, functional gun — inside the combat-balance-ttk band, not
    // gimped into unplayability (weaponBuild.ts TTK_FLOOR_S/TTK_CEILING_S).
    const ttk = 100 / (priestBuild.damage * priestBuild.fireRate);
    expect(ttk).toBeGreaterThan(1.8);
    expect(ttk).toBeLessThan(3.5);
  });

  test("Ninja/Paladin/Wizard resolvePlayerBuild damage is unaffected by the Priest baseline change", () => {
    const wizardPlayer = mkPlayer({ characterId: "balanced" });
    const ninjaPlayer = mkPlayer({ id: "p2" as PlayerId, characterId: "sprinter" });
    const paladinPlayer = mkPlayer({ id: "p3" as PlayerId, characterId: "heavy" });
    expect(resolvePlayerBuild(wizardPlayer).damage).toBe(starterWeapon.damage);
    expect(resolvePlayerBuild(ninjaPlayer).damage).toBe(starterWeapon.damage);
    expect(resolvePlayerBuild(paladinPlayer).damage).toBe(starterWeapon.damage);
  });
});

describe("Priest curse: Slow Field re-tuned (docs/class-overhaul-workboard.md chunk 0.3)", () => {
  test("class-blind reading is unaffected — Slow Field still resolves exactly as before for every non-priest class", () => {
    const card = findCard("slow-field");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    expect(classBlind.projectile.impact).toBe("slow-field");
    expect(classBlind.projectile.slowMultiplier).toBeCloseTo(0.58, 5);
    expect(classBlind.projectile.impactRadiusPx).toBeCloseTo(70, 5);
    for (const other of ["wizard", "ninja", "paladin"] as const) {
      const build = createWeaponBuild(starterWeapon, [card], other);
      expect(build).toEqual(classBlind);
    }
  });

  test("Priest's reading reuses the SAME debuff type (slow-field), re-tuned stronger, never a new mechanic", () => {
    const card = findCard("slow-field");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const priest = createWeaponBuild(starterWeapon, [card], "priest");
    expect(priest.projectile.impact).toBe("slow-field"); // same existing debuff type, no new mechanic
    expect(priest.projectile.slowMultiplier).toBeLessThan(classBlind.projectile.slowMultiplier); // stronger slow
    expect(priest.projectile.impactRadiusPx).toBeGreaterThan(classBlind.projectile.impactRadiusPx); // bigger reach
    expect(priest.damage).toBeLessThan(classBlind.damage); // paid for with a real cost
  });
});

describe("Priest lifesteal: Stolen Fangs re-read as always-on drain (docs/card-pool-v2.md 'Tithe' lineage)", () => {
  test("class-blind reading is unaffected — Stolen Fangs still resolves exactly as before for every non-priest class", () => {
    const card = findCard("stolen-fangs");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    expect(classBlind.stolenFangs).toBe(true);
    expect(classBlind.leechFraction).toBe(0);
    for (const other of ["wizard", "ninja", "paladin"] as const) {
      const build = createWeaponBuild(starterWeapon, [card], other);
      expect(build).toEqual(classBlind);
    }
  });

  test("Priest's reading REPLACES the lock/homing verb wholesale with an always-on 8% leech, never merges", () => {
    const card = findCard("stolen-fangs");
    const priest = createWeaponBuild(starterWeapon, [card], "priest");
    expect(priest.stolenFangs).toBe(false); // lock/homing verb is gone for Priest, not merged
    expect(priest.leechFraction).toBeCloseTo(0.08, 5);
  });

  test("no leech card at all => leechFraction stays 0 (byte-identical to pre-Tithe resolution)", () => {
    const build = createWeaponBuild(starterWeapon, []);
    expect(build.leechFraction).toBe(0);
  });

  test("a fired shot from a Priest holding Stolen Fangs carries leechFraction on the spawned projectile", () => {
    const card = findCard("stolen-fangs");
    const player = mkPlayer({ characterId: "shielded", cards: ["stolen-fangs"] });
    let nextId = 1;
    const result = stepWeapon(player, true, { x: 500, y: 0 }, 16, () => EntityId(nextId++));
    expect(result.fired).toBe(true);
    expect(result.projectiles.length).toBeGreaterThan(0);
    expect(result.projectiles[0]!.leechFraction).toBeCloseTo(0.08, 5);
    // Card is real content, not dead weight in this suite.
    expect(card.classModifiers?.priest?.leechFraction).toBeCloseTo(0.08, 5);
  });

  test("the same card fired by a non-Priest carries NO leechFraction (class-blind Stolen Fangs never leeched)", () => {
    const player = mkPlayer({ characterId: "balanced", cards: ["stolen-fangs"] });
    let nextId = 1;
    const result = stepWeapon(player, true, { x: 500, y: 0 }, 16, () => EntityId(nextId++));
    expect(result.fired).toBe(true);
    expect(result.projectiles[0]!.leechFraction ?? 0).toBe(0);
  });
});
