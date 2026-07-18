import type { CharacterDefinition } from "../types/game";

// Class era, P1 (docs/classes-goal.md): the four archetypes evolve into the
// class chassis — Balanced→WIZARD, Heavy→PALADIN, Sprinter→NINJA,
// Shielded→PRIEST. This is a RENAME/REFRAME only: every stat below is
// byte-identical to the pre-class archetypes (the stats ARE each class's
// proto-chassis body). The `id`s are sim/wire-visible (PlayerEntity
// .characterId, replays) and deliberately stay the old archetype words —
// see net/playerCharacter.ts for the id-vs-display rationale.
//
// Display names LOCKED 2026-07-17 (docs/classes-goal.md § Naming,
// docs/character-sheets-v1.md): sci-fi gnostic persona names, not the
// generic class words. `wizard`→Geometrician, `ninja`→Interstice,
// `paladin`→Kindred, `priest`→Syzygist. `classId` stays the dev-id English
// word (code/docs/sigil lookup only, zero sim meaning) — only `name`
// (the player-facing string) speaks the persona.
//
// kitSummary discipline: describe what is TRUE TODAY, never future verbs.
// `kitComing` marks a class whose kit hasn't shipped so selection surfaces
// can note it without over-promising.
//
// UPDATE 2026-07-18 (class-overhaul-workboard.md chunks 2.6/3.4): Kindred
// (10/10 Kindred catalog abilities wired, incl. the Retribution Edge/Shock
// Ring/Rally Light fast-follow) and Syzygist (10/10 Syzygist catalog
// abilities wired) both ship real kits now — `kitComing` removed for both,
// and their `kitSummary`s name real, live abilities. Interstice stays
// `kitComing: true`: 9/10 Interstice catalog abilities are wired (full
// melee/dash/energy chassis included), but the tenth — Paper Double — is
// deliberately deferred (needs a new decoy/summon entity type in
// WorldState, not just a case in the ability switch; see cardTypes.ts's
// AbilityKind header comment) and docs/character-sheets-v1.md calls Paper
// Double "basically their whole personality as a mechanic" — the class's
// identity-defining piece, not filler. Claiming "full kit" for Interstice
// while that's still missing would violate A2 (ship the missing feature,
// never claim the finished one), so the flag stays until it lands.
export const characters: CharacterDefinition[] = [
  {
    id: "balanced",
    name: "Geometrician",
    classId: "wizard",
    // Prism Wall / Vector Charge named 2026-07-18 (chassis-verb legibility
    // pass) — kitSummary discipline above still applies: only wizard has no
    // kitComing flag, so only wizard's ability verbs belong in this string
    // today. Deliberately NOT extended to Kindred/Interstice/Syzygist below.
    kitSummary: "100hp · the full crystal arsenal — every weapon, the parry, Prism Wall, Vector Charge",
    maxHealth: 100,
    moveSpeedMultiplier: 1,
    sizeScale: 1,
    recoilControlMultiplier: 1,
    abilityType: "shield",
    weakness: "No extreme stat advantage.",
  },
  {
    id: "heavy",
    name: "Kindred",
    classId: "paladin",
    // Kindred catalog v1 shipped 10/10 (class-overhaul-workboard.md chunk
    // 2.6 fast-follow, 2026-07-18) — Kindled Edge (melee), Kindled Ward
    // (shield), Kindled Charge (dash), team-peel, and the Unveiling
    // ultimate are all real; kitComing removed per the honesty rule above.
    kitSummary:
      "125hp · slower, larger, steadier recoil — Kindled Edge melee, Kindled Ward, Kindled Charge, the Unveiling ultimate",
    maxHealth: 125,
    moveSpeedMultiplier: 0.88,
    sizeScale: 1.18,
    recoilControlMultiplier: 1.25,
    abilityType: "brace",
    weakness: "Larger and slower.",
  },
  {
    id: "sprinter",
    name: "Interstice",
    classId: "ninja",
    // Interstice catalog v1 shipped 9/10 (class-overhaul-workboard.md ninja-
    // catalog chunk, 2026-07-18) — the melee/dash/energy chassis and 9
    // catalog abilities are real, but Paper Double (the class's namesake
    // decoy mechanic) is a recorded deferral, not a silent stub — see
    // cardTypes.ts's AbilityKind header comment. kitComing stays true until
    // it lands: don't claim "full kit" while the signature piece is absent.
    kitSummary: "85hp · fastest, smallest silhouette",
    kitComing: true,
    maxHealth: 85,
    moveSpeedMultiplier: 1.14,
    sizeScale: 0.92,
    recoilControlMultiplier: 0.9,
    abilityType: "blink",
    weakness: "Lower health.",
  },
  {
    id: "shielded",
    name: "Syzygist",
    classId: "priest",
    // Syzygist catalog v1 shipped 10/10 (class-overhaul-workboard.md chunk
    // 3.4, 2026-07-18) — Bleed Tithe, Borrowed Time, Devotion, and
    // Syzygist Ward (Open Hand) / Tethered Charge are all real; kitComing
    // removed per the honesty rule above.
    kitSummary:
      "100hp · measured pace, broad frame — Bleed Tithe, Borrowed Time, Open Hand, Tethered Charge",
    maxHealth: 100,
    moveSpeedMultiplier: 0.96,
    sizeScale: 1.05,
    recoilControlMultiplier: 1,
    abilityType: "shield",
    weakness: "Weaker pressure before cards.",
  },
];
