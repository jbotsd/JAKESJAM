import type { CharacterDefinition } from "../types/game";

export const characters: CharacterDefinition[] = [
  {
    id: "balanced",
    name: "Balanced",
    maxHealth: 100,
    moveSpeedMultiplier: 1,
    sizeScale: 1,
    recoilControlMultiplier: 1,
    abilityType: "shield",
    weakness: "No extreme stat advantage.",
  },
  {
    id: "heavy",
    name: "Heavy",
    maxHealth: 125,
    moveSpeedMultiplier: 0.88,
    sizeScale: 1.18,
    recoilControlMultiplier: 1.25,
    abilityType: "brace",
    weakness: "Larger and slower.",
  },
  {
    id: "sprinter",
    name: "Sprinter",
    maxHealth: 85,
    moveSpeedMultiplier: 1.14,
    sizeScale: 0.92,
    recoilControlMultiplier: 0.9,
    abilityType: "blink",
    weakness: "Lower health.",
  },
  {
    id: "shielded",
    name: "Shielded",
    maxHealth: 100,
    moveSpeedMultiplier: 0.96,
    sizeScale: 1.05,
    recoilControlMultiplier: 1,
    abilityType: "shield",
    weakness: "Weaker pressure before cards.",
  },
];
