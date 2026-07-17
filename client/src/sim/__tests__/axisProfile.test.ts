// Six Axes membership derivation (docs/six-axes-goal.md Phase 0).
// deriveAxisProfile is the ONLY place axis membership is computed
// (doctrine #1) — so this suite pins it exhaustively: every card in the
// pool maps to exactly its expected axes, hands compose, penalty riders
// stay silent, and the resolved EmissionConfig picks up the working
// numbers only when an axis is charged. Pure-data tests, no world
// stepping.

import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../data/cards.js";
import { starterWeapon } from "../data/weapons.js";
import { createWeaponBuild, findCardsById } from "../data/weaponBuild.js";
import { resolvePlayerBuild } from "../weapon.js";
import {
  EMISSION_DRAIN_LEECH_FRACTION,
  EMISSION_EXECUTE_BELOW_FRAC,
  EMISSION_WARD_FIELD_MS,
  deriveAxisProfile,
  resolveEmission,
} from "../data/emission.js";
import {
  InputSeq,
  PlayerId,
  type CharacterArchetype,
  type PlayerEntity,
} from "../types.js";

const DERIVED_AXES = ["drain", "ward", "stride", "mystery", "technique"] as const;

/** The exhaustive membership map — hand-audited against cards.ts modifier
 *  fields (the goal doc's derivation table). A new card whose fields mark
 *  an axis MUST be added here or this test fails loudly — that's the
 *  point: axis membership changes are always deliberate. */
const AXIS_EXPECTED: Record<(typeof DERIVED_AXES)[number], readonly string[]> = {
  drain: ["crimson-tithe", "stolen-fangs"],
  ward: [
    "aim-barrier",
    "bulwark-core",
    "mirror-shield",
    "rapid-capacitor",
    "riot-mirror",
    "shelter-seal",
  ],
  stride: [
    "blink-dash",
    "double-jump",
    "lead-boots",
    "shadow-step",
    "spring-heel",
    "sprint-coils",
  ],
  mystery: ["veil-of-nought", "void-fracture"],
  technique: ["pierce-chain", "severing-answer", "voltaic-spark", "void-fracture"],
};

/** The PRODUCTION derivation path: resolvePlayerBuild (weapon.ts), which
 *  layers birthright kit (ground dash floors dashCharges at 1) and
 *  character innates (Shielded's directional shield) over the card
 *  resolution — the axis derivation must stay blind to all of it. */
function entityWith(
  ids: string[],
  characterId: CharacterArchetype = "balanced",
): PlayerEntity {
  return {
    id: PlayerId("axis-test"),
    characterId,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: ids,
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
  };
}

function handProfile(ids: string[], characterId: CharacterArchetype = "balanced") {
  return deriveAxisProfile(resolvePlayerBuild(entityWith(ids, characterId)));
}

describe("deriveAxisProfile", () => {
  test("EXHAUSTIVE: every card in the pool lights exactly its expected axes (production path)", () => {
    for (const card of crystalRoundsCards) {
      const profile = handProfile([card.id]);
      for (const axis of DERIVED_AXES) {
        const expected = AXIS_EXPECTED[axis].includes(card.id);
        // String equality so a failure names the card AND the axis.
        expect(`${card.id} ${axis}=${profile[axis]}`).toBe(
          `${card.id} ${axis}=${expected}`,
        );
      }
      expect(profile.sorcery).toBe(true); // every gun projects
    }
  });

  test("empty hand lights no derived axis — for EVERY character archetype", () => {
    // Birthright/innate kit must never light an axis: the universal ground
    // dash (dashCharges floored at 1) and the Shielded character's innate
    // directional shield are NOT picks. Axes are earned in the draft.
    const archetypes: CharacterArchetype[] = [
      "balanced",
      "heavy",
      "sprinter",
      "shielded",
    ];
    for (const characterId of archetypes) {
      const profile = handProfile([], characterId);
      for (const axis of DERIVED_AXES) {
        expect(`${characterId} ${axis}=${profile[axis]}`).toBe(
          `${characterId} ${axis}=false`,
        );
      }
      expect(profile.sorcery).toBe(true);
    }
  });

  test("card-only resolution (createWeaponBuild) derives identically", () => {
    // The derivation is pure over the hand — both resolution paths agree.
    const viaCards = deriveAxisProfile(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, ["stolen-fangs", "double-jump"]),
      ),
    );
    const viaPlayer = handProfile(["stolen-fangs", "double-jump"]);
    expect(viaCards).toEqual(viaPlayer);
  });

  test("axes compose across a hand — fangs + double-jump + bounce = Drain + Stride only", () => {
    const profile = handProfile(["stolen-fangs", "double-jump", "bouncy-prism"]);
    expect(profile.drain).toBe(true);
    expect(profile.stride).toBe(true);
    expect(profile.ward).toBe(false);
    expect(profile.mystery).toBe(false);
    expect(profile.technique).toBe(false);
  });

  test("void-fracture lights two axes through two different fields (void→Mystery, pierce→Technique)", () => {
    const profile = handProfile(["void-fracture"]);
    expect(profile.mystery).toBe(true);
    expect(profile.technique).toBe(true);
  });

  test("penalty riders never mark an axis (crystal-plating's 0.98 move speed is not Stride)", () => {
    const profile = handProfile(["crystal-plating"]);
    expect(profile.stride).toBe(false);
  });

  test("profile is cached per build identity (same object back)", () => {
    const build = createWeaponBuild(starterWeapon, []);
    expect(deriveAxisProfile(build)).toBe(deriveAxisProfile(build));
  });
});

describe("resolveEmission axis sections (Layer 1 values)", () => {
  test("a Drain hand's cast leeches at the working fraction", () => {
    const e = resolveEmission(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, ["stolen-fangs"]),
      ),
    );
    expect(e.drain.leechFraction).toBe(EMISSION_DRAIN_LEECH_FRACTION);
  });

  test("a Ward hand's cast leaves a shell; storedReturnFraction stays reserved", () => {
    const e = resolveEmission(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, ["riot-mirror"]),
      ),
    );
    expect(e.ward.fieldMs).toBe(EMISSION_WARD_FIELD_MS);
    expect(e.ward.storedReturnFraction).toBe(0);
  });

  test("a Stride hand's cast refunds movement; castAtDashEnd stays reserved", () => {
    const e = resolveEmission(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, ["blink-dash"]),
      ),
    );
    expect(e.stride.dashReset).toBe(true);
    expect(e.stride.castAtDashEnd).toBe(false);
  });

  test("a Mystery hand's cast wraps and denies; markMs stays reserved", () => {
    const e = resolveEmission(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, ["void-fracture"]),
      ),
    );
    expect(e.mystery.denyAscension).toBe(true);
    expect(e.mystery.wrapShots).toBe(true);
    expect(e.mystery.markMs).toBe(0);
  });

  test("a Technique hand's cast executes at the working threshold; counter stays reserved", () => {
    const e = resolveEmission(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, ["pierce-chain"]),
      ),
    );
    expect(e.technique.executeBelowFrac).toBe(EMISSION_EXECUTE_BELOW_FRAC);
    expect(e.technique.counterWindowMs).toBe(0);
  });

  test("DOCTRINE #3: a pure-Sorcery hand's axis sections are exactly the inert defaults", () => {
    const e = resolveEmission(
      createWeaponBuild(
        starterWeapon,
        findCardsById(crystalRoundsCards, [
          "molten-core",
          "bouncy-prism",
          "five-shard-spray",
        ]),
      ),
    );
    expect(e.drain).toEqual({ leechFraction: 0 });
    expect(e.ward).toEqual({ storedReturnFraction: 0, fieldMs: 0 });
    expect(e.stride).toEqual({ castAtDashEnd: false, dashReset: false });
    expect(e.mystery).toEqual({
      denyAscension: false,
      wrapShots: false,
      markMs: 0,
    });
    expect(e.technique).toEqual({ executeBelowFrac: 0, counterWindowMs: 0 });
  });
});
