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
import {
  starterWeapon,
  priestStarterWeapon,
  paladinStarterWeapon,
  baseWeaponForClass,
} from "../data/weapons.js";
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

  test("Ninja falls back cleanly on every authored Wizard card — never a Wizard-flavored effect", () => {
    // Paladin is asserted SEPARATELY below (docs/card-pool-v2.md § Paladin
    // exclusives / universal per-class lines, class-overhaul-workboard.md
    // chunk 2.6) — 6 of these 7 ids now carry a real, authored `paladin:`
    // expression (double-jump is the one deliberate exception, still
    // deferred — see its own card-level comment for why). Priest is
    // asserted separately below TOO (class-overhaul-workboard.md chunk
    // 3.4) — seeker-facets now carries a real `priest:` entry (the
    // low-aim design direction), so it's excluded from THIS "still falls
    // back" list; every other id here still has no Priest entry.
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
      const build = createWeaponBuild(starterWeapon, [card], "ninja");
      expect(build).toEqual(classBlind);
    }
  });

  test("Priest falls back cleanly on every authored Wizard card EXCEPT seeker-facets (chunk 3.4's one authored entry)", () => {
    const stillFallsBackIds = [
      "cluster-bomb",
      "molten-core",
      "frost-prism",
      "spring-heel",
      "double-jump",
      "crystal-plating",
    ];
    for (const id of stillFallsBackIds) {
      const card = findCard(id);
      const classBlind = createWeaponBuild(starterWeapon, [card]);
      const build = createWeaponBuild(starterWeapon, [card], "priest");
      expect(build).toEqual(classBlind);
    }
  });

  test("double-jump is the one deliberate Paladin fallback (Second Wind's stomp-jump ring needs substrate this session doesn't build)", () => {
    const card = findCard("double-jump");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladin).toEqual(classBlind);
  });
});

// ── Paladin / Kindled (class-overhaul-workboard.md chunk 2.6) — universal
//    card "Paladin:" classModifiers expressions, authored against
//    card-pool-v2.md's Paladin per-class lines on the SAME 6 cards Wizard's
//    own 7-card pass already proved the mechanism on (double-jump is the
//    documented 7th exception, asserted above). Every reading here changes
//    a field `resolveEmission` reads (chunk 2.5's verified wiring,
//    emissionClassAware.test.ts) and/or a field consumed live by movement
//    or Kindled Ward (shieldChargeMultiplier-adjacent fields), so — unlike
//    Wizard's own molten-core/frost-prism/double-jump entries, which are
//    "intentionally identical" per their own comments — every Paladin
//    entry here is a REAL, numerically different reading, not just
//    authored-but-inert content. ──────────────────────────────────────────
describe("authored Paladin cards (docs/card-pool-v2.md universal per-class lines)", () => {
  test("Grudge (seeker-facets): Paladin rejects homing entirely (\"arc forgiveness\" reframed) — the ultimate claims space, it doesn't seek", () => {
    const card = findCard("seeker-facets");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(classBlind.projectile.homingStrength).toBeGreaterThan(0);
    expect(paladin.projectile.homingStrength).toBe(0);
    expect(paladin.projectile.pathing).toBe("straight");
    // No damage tax, unlike Wizard's −10% — Paladin isn't gaining anything.
    expect(paladin.damage).toBe(classBlind.damage);
  });

  test("Splinterhead (cluster-bomb): Paladin's children are FEWER and BIGGER than Wizard's — heavier-tank read", () => {
    const card = findCard("cluster-bomb");
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladin.projectile.splitCount).toBeLessThan(wizard.projectile.splitCount);
    expect(paladin.projectile.sizeMultiplier).toBeGreaterThan(wizard.projectile.sizeMultiplier);
  });

  test("Cinder (molten-core): Paladin's brand carries a bigger impact radius than Wizard's textbook cast", () => {
    const card = findCard("molten-core");
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladin.projectile.element).toBe("fire");
    expect(paladin.projectile.impactRadiusPx).toBeGreaterThan(wizard.projectile.impactRadiusPx);
  });

  test("Hoarfrost (frost-prism): Paladin's frost brand is a STRONGER slow than Wizard's textbook cast", () => {
    const card = findCard("frost-prism");
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladin.projectile.element).toBe("ice");
    expect(paladin.projectile.slowMultiplier).toBeLessThan(wizard.projectile.slowMultiplier);
  });

  test("Plating (crystal-plating): Paladin's move-speed cost is LIGHTER than Wizard's, size reads bigger", () => {
    const card = findCard("crystal-plating");
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladin.maxHealthAdd).toBe(20);
    expect(paladin.moveSpeedMultiplier).toBeGreaterThan(wizard.moveSpeedMultiplier);
    expect(paladin.projectile.sizeMultiplier).toBeGreaterThan(wizard.projectile.sizeMultiplier);
  });

  test("Spring Heel: Paladin's split is LOWER jump, HIGHER wall-jump than Wizard's flat +10%/+10%", () => {
    const card = findCard("spring-heel");
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladin = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladin.jumpMultiplier).toBeLessThan(wizard.jumpMultiplier);
    expect(paladin.wallJumpMultiplier).toBeGreaterThan(wizard.wallJumpMultiplier);
  });

  test("resolvePlayerBuild wires Paladin classId LIVE from characterId (heavy archetype)", () => {
    const paladinPlayer = mkPlayer({ characterId: "heavy", cards: ["frost-prism"] });
    const build = resolvePlayerBuild(paladinPlayer);
    expect(build.projectile.slowMultiplier).toBeCloseTo(0.55, 5);
  });
});

// ── Priest / Syzygist solo floor (docs/class-overhaul-workboard.md chunk
//    0.3, docs/classes-goal.md "Priest / Syzygist") — curses + lifesteal,
//    the part of Priest's kit that ships into pure FFA with no teammate. ──

describe("Priest baseline: detuned starter bolt (docs/classes-goal.md 'modest projectile, wizard's starter, detuned')", () => {
  test("baseWeaponForClass falls back to starterWeapon for Wizard/Ninja; Priest/Paladin have their own baseline", () => {
    expect(baseWeaponForClass(undefined)).toBe(starterWeapon);
    expect(baseWeaponForClass("wizard")).toBe(starterWeapon);
    expect(baseWeaponForClass("ninja")).toBe(starterWeapon);
    expect(baseWeaponForClass("paladin")).toBe(paladinStarterWeapon);
    expect(baseWeaponForClass("priest")).toBe(priestStarterWeapon);
  });

  test("priestStarterWeapon is a same-shape, lower-damage copy of starterWeapon", () => {
    expect(priestStarterWeapon.damage).toBeLessThan(starterWeapon.damage);
    expect(priestStarterWeapon.delivery).toBe(starterWeapon.delivery);
    expect(priestStarterWeapon.projectile.shape).toBe(starterWeapon.projectile.shape);
    expect(priestStarterWeapon.fireRate).toBe(starterWeapon.fireRate);
    expect(priestStarterWeapon.id).toBe(starterWeapon.id);
  });

  test("createWeaponBuild(baseWeaponForClass(classId), ...) with no cards: only Wizard/Ninja stay at the flat-pool baseline", () => {
    const wizard = createWeaponBuild(baseWeaponForClass("wizard"), [], "wizard");
    const ninja = createWeaponBuild(baseWeaponForClass("ninja"), [], "ninja");
    const paladin = createWeaponBuild(baseWeaponForClass("paladin"), [], "paladin");
    const priest = createWeaponBuild(baseWeaponForClass("priest"), [], "priest");
    expect(wizard.damage).toBe(starterWeapon.damage);
    expect(ninja.damage).toBe(starterWeapon.damage);
    expect(paladin.damage).toBeGreaterThan(starterWeapon.damage);
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
    // Priest's basic fire is now SYZ_TENDRIL_COUNT small homing shards per
    // shot rather than one bolt (constants.ts's SYZ_TENDRIL_* doc comment —
    // "oozing tendrils of fire", 2026-07-19) — `damage` is the PER-TENDRIL
    // figure, so the TTK-band check needs `× count` (the same "if every
    // tendril connects" total-damage accounting weaponBuild.ts's
    // effectiveTTKBuild uses) to compare like with like against a
    // single-shot weapon's plain damage×fireRate.
    const ttk = 100 / (priestBuild.damage * priestBuild.fireRate * priestBuild.projectile.count);
    expect(ttk).toBeGreaterThan(1.8);
    expect(ttk).toBeLessThan(3.5);
  });

  test("Ninja/Wizard resolvePlayerBuild damage is unaffected by the Priest/Paladin baseline changes", () => {
    const wizardPlayer = mkPlayer({ characterId: "balanced" });
    const ninjaPlayer = mkPlayer({ id: "p2" as PlayerId, characterId: "sprinter" });
    expect(resolvePlayerBuild(wizardPlayer).damage).toBe(starterWeapon.damage);
    expect(resolvePlayerBuild(ninjaPlayer).damage).toBe(starterWeapon.damage);
  });
});

// ── Paladin / Kindled baseline (class-overhaul-workboard.md chunk 2.5,
//    docs/classes-goal.md "E-KEY RULING") — Kindled Edge replaces this
//    weapon for Paladin's actual Fire input (World.ts), so its ONLY live
//    consumer is the Unveiling ultimate's composed Emission
//    (resolveEmission). Re-tuned "heavier, slower, bigger" per the task
//    brief's explicit ask, not detuned like Priest's. ────────────────────
describe("Paladin baseline: heavier starter bolt feeding the Unveiling ultimate only", () => {
  test("paladinStarterWeapon is a same-shape, heavier/slower/bigger copy of starterWeapon", () => {
    expect(paladinStarterWeapon.damage).toBeGreaterThan(starterWeapon.damage);
    expect(paladinStarterWeapon.fireRate).toBeLessThan(starterWeapon.fireRate);
    expect(paladinStarterWeapon.projectileSpeed).toBeLessThan(starterWeapon.projectileSpeed);
    expect(paladinStarterWeapon.projectile.sizeMultiplier).toBeGreaterThan(
      starterWeapon.projectile.sizeMultiplier,
    );
    expect(paladinStarterWeapon.delivery).toBe(starterWeapon.delivery);
    expect(paladinStarterWeapon.id).toBe(starterWeapon.id);
  });

  test("still inside the combat-balance-ttk band even though Paladin never actually fires it conventionally", () => {
    const ttk = 100 / (paladinStarterWeapon.damage * paladinStarterWeapon.fireRate);
    expect(ttk).toBeGreaterThan(1.8);
    expect(ttk).toBeLessThan(3.5);
  });

  test("resolvePlayerBuild: a bare Heavy (paladin) player's build.damage is heavier than a bare Balanced (wizard) player's", () => {
    const wizardPlayer = mkPlayer({ characterId: "balanced", cards: [] });
    const paladinPlayer = mkPlayer({
      id: "p2" as PlayerId,
      characterId: "heavy",
      cards: [],
    });
    const wizardBuild = resolvePlayerBuild(wizardPlayer);
    const paladinBuild = resolvePlayerBuild(paladinPlayer);
    expect(paladinBuild.damage).toBeGreaterThan(wizardBuild.damage);
    expect(paladinBuild.projectileSpeed).toBeLessThan(wizardBuild.projectileSpeed);
  });
});

// ── Priest / Syzygist universal card expression (class-overhaul-workboard.md
//    chunk 3.4) — the ONE universal-card `priest:` classModifiers sibling
//    added this chunk (seeker-facets), embodying Jake's live low-aim design
//    direction ("tendrils that ooze out and self guide... less about
//    aiming with the priest") rather than Wizard's aim-first "assists,
//    never auto-wins" pricing. ──────────────────────────────────────────
describe("Grudge (seeker-facets): Priest keeps full homing WITHOUT Wizard's damage/speed tax", () => {
  test("Priest pays neither the −10% damage tax NOR the 0.82 speed cut Wizard pays for the same homing", () => {
    const card = findCard("seeker-facets");
    const wizard = createWeaponBuild(starterWeapon, [card], "wizard");
    const priest = createWeaponBuild(starterWeapon, [card], "priest");
    expect(priest.damage).toBeGreaterThan(wizard.damage);
    expect(priest.projectileSpeed).toBeGreaterThan(wizard.projectileSpeed);
    // Both still genuinely home (the low-aim identity survives on Priest,
    // same as Wizard) — homingStrength itself clamps identically for both
    // (weaponBuild.ts's own 2.5 ceiling), so speed/damage are the real,
    // observable differentiators, not the raw homing number.
    expect(priest.projectile.homingStrength).toBeGreaterThan(0);
    expect(wizard.projectile.homingStrength).toBeGreaterThan(0);
  });

  test("Priest's reading differs from the class-blind default too (a real authored entry, not a silent no-op)", () => {
    const card = findCard("seeker-facets");
    const classBlind = createWeaponBuild(starterWeapon, [card]);
    const priest = createWeaponBuild(starterWeapon, [card], "priest");
    expect(priest.projectileSpeed).toBeGreaterThan(classBlind.projectileSpeed);
    expect(priest).not.toEqual(classBlind);
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
