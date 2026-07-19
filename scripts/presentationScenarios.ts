import type { PresentationScenario } from "./presentationEvidence.js";
import { crystalRoundsCards } from "../client/src/sim/data/cards.js";
import type { ClassId } from "../client/src/sim/data/cardTypes.js";

/** Wave-by-wave scenario registry. `forced-hook-required` is deliberately a
 * visible failure state: catalog coverage cannot be claimed from random play. */
const CORE_PRESENTATION_SCENARIOS = {
  "core-starter-shot": {
    id: "core-starter-shot",
    packageId: "core/starter-shot",
    description: "Starter throw through projectile launch, contact, and recovery",
    qualityTiers: ["potato", "phone", "standard"],
    requiredBeats: ["shot-fired", "hit-confirmed"],
    minimumProjectileFlightTicks: 4,
    framePlan: {
      anticipation: { beat: "shot-fired", offsetMs: -90 },
      action: { beat: "shot-fired", offsetMs: 18 },
      impact: { beat: "hit-confirmed", offsetMs: 0, count: 8, stepMs: 16 },
      recovery: { beat: "hit-confirmed", offsetMs: 190 },
    },
    driver: "natural-match",
    characterId: "balanced",
  },
  "core-aegis-bash": {
    id: "core-aegis-bash",
    packageId: "core/aegis-dash-bash",
    description: "Aegis commit, body cross/parry, and recovery",
    qualityTiers: ["potato", "phone", "standard"],
    requiredBeats: ["aegis-start", "parry-or-dash-through"],
    driver: "natural-match",
    characterId: "balanced",
  },
  "status-slow": {
    id: "status-slow",
    packageId: "status/player-slowed",
    description: "Slow application, persistent drag read, and expiry",
    qualityTiers: ["potato", "phone", "standard"],
    requiredBeats: ["flock-pulse", "player-slowed"],
    driver: "loadout-scripted",
    characterId: "shielded",
    requiredCardIds: ["flock-pulse"],
  },
  "syzygist-ward": {
    id: "syzygist-ward",
    packageId: "syzygist/ward-absorb",
    description: "Ally ward source, protected impact, depletion, and settle",
    qualityTiers: ["potato", "phone", "standard"],
    requiredBeats: ["ward-cast", "syz-ward-absorbed", "ward-broke"],
    driver: "loadout-scripted",
    characterId: "shielded",
    requiredCardIds: ["self-lattice"],
  },
} as const satisfies Record<string, PresentationScenario>;

const CHARACTER_FOR_CLASS: Record<ClassId, PresentationScenario["characterId"]> = {
  wizard: "balanced",
  paladin: "heavy",
  ninja: "sprinter",
  priest: "shielded",
};

/** One independently forceable evidence package per shipped active. Class
 * catalog entries can be equipped deterministically at the loadout station;
 * class-blind draft actives remain honestly marked as requiring a force hook. */
export const ABILITY_PRESENTATION_SCENARIOS = Object.fromEntries(
  crystalRoundsCards
    .filter((card) => card.active !== undefined)
    .map((card) => {
      const kind = card.active!.kind;
      const classId = card.classId;
      const scenario: PresentationScenario = {
        id: `ability-${kind}`,
        packageId: `ability/${kind}`,
        description: `${card.name}: anticipation, authored gesture, effect-site change, and recovery`,
        qualityTiers: ["potato", "phone", "standard"],
        requiredBeats: [`ability:${kind}`],
        driver: classId ? "loadout-scripted" : "forced-hook-required",
        characterId: classId ? CHARACTER_FOR_CLASS[classId] : "balanced",
        ...(classId ? { requiredCardIds: [card.id] } : {}),
      };
      return [scenario.id, scenario];
    }),
) as Record<`ability-${string}`, PresentationScenario>;

export const PRESENTATION_SCENARIOS: typeof CORE_PRESENTATION_SCENARIOS &
  Record<`ability-${string}`, PresentationScenario> = {
  ...CORE_PRESENTATION_SCENARIOS,
  ...ABILITY_PRESENTATION_SCENARIOS,
};

export type PresentationScenarioId = keyof typeof PRESENTATION_SCENARIOS;

export function presentationScenario(id: string): PresentationScenario | undefined {
  return PRESENTATION_SCENARIOS[id as PresentationScenarioId];
}
