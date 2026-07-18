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
// kitSummary discipline: describe what is TRUE TODAY (hp/speed/size), never
// future verbs. Kindred is "125hp, slower, larger" — not "sword and board" —
// until P3 actually ships the kit. `kitComing` marks the three future
// chassis so selection surfaces can note it without over-promising.
export const characters: CharacterDefinition[] = [
  {
    id: "balanced",
    name: "Geometrician",
    classId: "wizard",
    kitSummary: "100hp · the full crystal arsenal — every weapon, the parry",
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
    kitSummary: "125hp · slower, larger · steadier recoil",
    kitComing: true,
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
    kitSummary: "100hp · measured pace, broad frame",
    kitComing: true,
    maxHealth: 100,
    moveSpeedMultiplier: 0.96,
    sizeScale: 1.05,
    recoilControlMultiplier: 1,
    abilityType: "shield",
    weakness: "Weaker pressure before cards.",
  },
];
