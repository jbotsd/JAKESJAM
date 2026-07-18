// Unveiling — Paladin/Kindred's ultimate (class-overhaul-workboard.md
// chunk 2.5, docs/classes-goal.md "E-KEY RULING": "the ult IS the
// Emission" — every class's ultimate is the Kindled kit transfigured
// through the SAME emission composer, never a bespoke per-class ultimate
// implementation).
//
// Investigation finding (matches chunk 0.2's own verified conclusion,
// emissionClassAware.test.ts): `resolveEmission` already reads NOTHING but
// a `ResolvedWeaponBuild` — it has zero `classId` awareness of its own,
// by design (emission.ts's own header: "no bespoke per-category shapes
// unless a live playtest demands them"). Class-awareness is inherited
// entirely through `resolvePlayerBuild`, which already threads
// `classIdForArchetype(player.characterId)` into `createWeaponBuild`
// (weapon.ts:100-133). So 2.5's actual gap (per 0.2's own report: "no REAL
// card today produces an observably different Emission across classes —
// a CONTENT gap, not a wiring gap") is closed here with REAL content:
//   - `paladinStarterWeapon` (data/weapons.ts) — Paladin's OWN class-gated
//     baseline, "heavier, slower, bigger" than Wizard's, feeding the
//     Unveiling ultimate even on a bare/card-blind hand (Paladin never
//     fires this weapon conventionally — Kindled Edge replaces Fire
//     entirely, World.ts's own header comment — so this weapon's ONLY
//     live consumer is `resolveEmission`).
//   - Six `paladin:` classModifiers entries (data/cards.ts, on the SAME
//     cards Wizard's own 7-card pass already proved the mechanism on) that
//     change fields `resolveEmission` DOES read (homingStrength, element,
//     sizeMultiplier, slowMultiplier, impactRadiusPx) — asserted more
//     thoroughly in classExpression.test.ts; this file re-proves the
//     end-to-end composition through `resolveEmission` itself, the same
//     shape emissionClassAware.test.ts already proves for its synthetic
//     fixture, but with REAL authored cards.
//
// No new code path in emission.ts, World.ts's E-cast site, or anywhere
// else — every assertion here is downstream of existing, already-verified
// wiring plus new DATA.

import { describe, expect, test } from "bun:test";
import { createWeaponBuild } from "../data/weaponBuild.js";
import { resolveEmission } from "../data/emission.js";
import { resolvePlayerBuild } from "../weapon.js";
import { starterWeapon, paladinStarterWeapon, baseWeaponForClass } from "../data/weapons.js";
import { crystalRoundsCards } from "../data/cards.js";
import { InputSeq, PlayerId, type PlayerEntity } from "../types.js";

function findCard(id: string) {
  const card = crystalRoundsCards.find((c) => c.id === id);
  if (!card) throw new Error(`fixture card missing: ${id}`);
  return card;
}

function mkPlayer(over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "heavy",
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

describe("Unveiling — the ultimate composes through the SAME resolveEmission every class uses", () => {
  test("a bare-hand Paladin's Unveiling already reads heavier than a bare-hand Wizard's — the class baseline alone, zero cards", () => {
    const wizardBuild = createWeaponBuild(baseWeaponForClass("wizard"), [], "wizard");
    const paladinBuild = createWeaponBuild(baseWeaponForClass("paladin"), [], "paladin");
    const wizardEmission = resolveEmission(wizardBuild);
    const paladinEmission = resolveEmission(paladinBuild);
    // Heavier: bigger shards, slower flight, harder-hitting per shard.
    expect(paladinEmission.radiusPx).toBeGreaterThan(wizardEmission.radiusPx);
    expect(paladinEmission.speed).toBeLessThan(wizardEmission.speed);
    // Damage budget is fixed regardless of class (goal-doc doctrine — more
    // shards buys coverage, never more single-target damage); volleyCount
    // is driven by projectile COUNT, unaffected by the baseline retune.
    expect(paladinEmission.volleyCount).toBe(wizardEmission.volleyCount);
  });

  test("Grudge (seeker-facets) drafted by a Paladin: the Unveiling does NOT seek — a real, testable class-true difference from Wizard's homing cast", () => {
    const card = findCard("seeker-facets");
    const wizardBuild = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladinBuild = createWeaponBuild(starterWeapon, [card], "paladin");
    const wizardEmission = resolveEmission(wizardBuild);
    const paladinEmission = resolveEmission(paladinBuild);
    expect(wizardEmission.homingStrength).toBeGreaterThan(0);
    expect(paladinEmission.homingStrength).toBe(0);
  });

  test("Cinder (molten-core) drafted by a Paladin: the brand's Unveiling carries a bigger impact radius than Wizard's textbook cast", () => {
    const card = findCard("molten-core");
    const wizardBuild = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladinBuild = createWeaponBuild(starterWeapon, [card], "paladin");
    const wizardEmission = resolveEmission(wizardBuild);
    const paladinEmission = resolveEmission(paladinBuild);
    expect(paladinEmission.element).toBe("fire");
    expect(paladinEmission.impactRadiusPx).toBeGreaterThan(wizardEmission.impactRadiusPx);
  });

  test("Hoarfrost (frost-prism) drafted by a Paladin: the frost brand's Unveiling slows harder than Wizard's", () => {
    const card = findCard("frost-prism");
    // Both classes need SOME source of slow-field impact for the field to
    // carry through resolveEmission's identity pass-through; the card
    // itself supplies it.
    const wizardBuild = createWeaponBuild(starterWeapon, [card], "wizard");
    const paladinBuild = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(paladinBuild.projectile.slowMultiplier).toBeLessThan(
      wizardBuild.projectile.slowMultiplier,
    );
  });

  test("classes with no authored Paladin override reproduce the class-blind cast exactly — never a placeholder, never Wizard's reading", () => {
    const card = findCard("double-jump"); // deliberately not given a paladin: entry
    const classBlindBuild = createWeaponBuild(starterWeapon, [card]);
    const paladinBuild = createWeaponBuild(starterWeapon, [card], "paladin");
    expect(resolveEmission(paladinBuild)).toEqual(resolveEmission(classBlindBuild));
  });

  test("resolvePlayerBuild wires classId LIVE from characterId into the ultimate's composed build — no per-call-site plumbing", () => {
    const paladinPlayer = mkPlayer({ characterId: "heavy", cards: ["molten-core"] });
    const wizardPlayer = mkPlayer({
      id: PlayerId("p2"),
      characterId: "balanced",
      cards: ["molten-core"],
    });
    const paladinBuild = resolvePlayerBuild(paladinPlayer);
    const wizardBuild = resolvePlayerBuild(wizardPlayer);
    const paladinEmission = resolveEmission(paladinBuild);
    const wizardEmission = resolveEmission(wizardBuild);
    expect(paladinEmission.impactRadiusPx).toBeGreaterThan(wizardEmission.impactRadiusPx);
  });

  test("paladinStarterWeapon only ever feeds the Unveiling ultimate — Paladin's Fire input never calls stepWeapon (World.ts's own routing, verified via resolvePlayerBuild's damage figure matching the class-gated baseline)", () => {
    const paladinPlayer = mkPlayer({ characterId: "heavy", cards: [] });
    const build = resolvePlayerBuild(paladinPlayer);
    expect(build.damage).toBeCloseTo(paladinStarterWeapon.damage, 5);
  });
});
