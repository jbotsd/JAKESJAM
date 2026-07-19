import type { AbilityKind } from "../../sim/data/cardTypes.js";
import type { ClassId } from "../types/game.js";

export type AbilityGesture =
  | "thrust"
  | "fan"
  | "plant"
  | "guard"
  | "gather"
  | "mark"
  | "pulse"
  | "step"
  | "weave"
  | "cut";

export type AbilityAnimationContract = {
  classId: ClassId;
  gesture: AbilityGesture;
  durationMs: number;
  /** Normalized end of anticipation and action. The remainder is follow/recovery. */
  anticipationEnd: number;
  actionEnd: number;
  reach: number;
  bodyCommit: number;
  handedness: -1 | 0 | 1;
};

const c = (
  classId: ClassId,
  gesture: AbilityGesture,
  durationMs: number,
  anticipationEnd: number,
  actionEnd: number,
  reach: number,
  bodyCommit: number,
  handedness: -1 | 0 | 1 = 0,
): AbilityAnimationContract => ({
  classId, gesture, durationMs, anticipationEnd, actionEnd, reach, bodyCommit, handedness,
});

/**
 * Exhaustive animation ownership for every activatable AbilityKind. Entries
 * deliberately share a small physical vocabulary, but not one generic pose:
 * timing, reach, commitment, handedness, and gesture are owned per ability.
 */
export const ABILITY_ANIMATIONS = {
  "crimson-tithe": c("priest", "weave", 520, .28, .66, 27, 2, -1),
  "shelter-seal": c("paladin", "guard", 560, .32, .69, 23, 1),
  "shadow-step": c("ninja", "step", 300, .18, .58, 28, 7, 1),
  "veil-of-nought": c("priest", "gather", 500, .30, .64, 22, 1),
  "severing-answer": c("wizard", "cut", 390, .24, .61, 31, 4, 1),

  sunlance: c("wizard", "thrust", 470, .31, .65, 34, 4, 1),
  "facet-break": c("wizard", "mark", 430, .28, .62, 31, 3, 1),
  "prism-fan": c("wizard", "fan", 520, .30, .68, 30, 2),
  lattice: c("wizard", "plant", 610, .35, .70, 25, 3),
  "return-glass": c("wizard", "guard", 540, .32, .68, 23, 1),
  "hard-aperture": c("wizard", "guard", 620, .38, .72, 26, 2),
  overclock: c("wizard", "gather", 450, .26, .63, 22, 2),
  measure: c("wizard", "mark", 480, .31, .65, 29, 1, -1),
  "slip-node": c("wizard", "step", 360, .22, .60, 27, 6, 1),
  "recoil-step": c("wizard", "step", 320, .19, .57, 30, -6, -1),

  "unbroken-seal": c("paladin", "thrust", 620, .37, .70, 32, 6, 1),
  sunspike: c("paladin", "thrust", 570, .34, .67, 34, 6, 1),
  "judgment-line": c("paladin", "cut", 650, .38, .71, 33, 7, 1),
  "bastion-pulse": c("paladin", "pulse", 620, .36, .68, 27, 2),
  "aegis-share": c("paladin", "guard", 580, .34, .67, 25, 2, -1),
  "plant-charge": c("paladin", "step", 500, .31, .66, 31, 8, 1),
  "shock-ring": c("paladin", "pulse", 660, .39, .71, 29, 3),
  "rally-light": c("paladin", "gather", 680, .40, .72, 27, 1),
  "kindled-resolve": c("paladin", "gather", 640, .37, .70, 24, 2),
  "bulwark-step": c("paladin", "step", 520, .32, .67, 29, 7, 1),
  // (crater's entry — a "plant" gesture — lived here; cut 2026-07-19
  // alongside its sibling exclusives retort/bastion, see cards.ts's cut
  // note. "crater" is no longer an AbilityKind, so this map has no key for
  // it at all now.)

  "bleed-tithe": c("priest", "weave", 560, .31, .68, 29, 2, -1),
  severance: c("priest", "cut", 500, .29, .65, 31, 3, 1),
  "borrowed-time": c("priest", "mark", 600, .36, .70, 27, 1, -1),
  "focus-hex": c("priest", "mark", 520, .31, .67, 30, 2, 1),
  contagion: c("priest", "weave", 680, .39, .72, 28, 2),
  "flock-pulse": c("priest", "pulse", 610, .35, .69, 27, 2),
  "self-lattice": c("priest", "guard", 570, .34, .68, 22, 1),
  "glass-ward": c("priest", "weave", 650, .38, .71, 26, 1, -1),
  "haste-gift": c("priest", "weave", 540, .31, .66, 28, 2, 1),
  "drift-step": c("priest", "step", 420, .25, .62, 27, 5, 1),

  undercut: c("ninja", "cut", 330, .20, .58, 32, 5, -1),
  "edge-storm": c("ninja", "fan", 400, .22, .64, 32, 4),
  needle: c("ninja", "thrust", 310, .18, .57, 35, 5, 1),
  "read-mark": c("ninja", "mark", 350, .21, .60, 31, 2, -1),
  "shard-ring": c("ninja", "pulse", 390, .23, .63, 29, 2),
  "wall-bloom": c("ninja", "plant", 430, .25, .65, 28, 3),
  "ghost-guard": c("ninja", "guard", 320, .18, .58, 25, -2),
  "second-wind": c("ninja", "gather", 360, .20, .61, 24, 1),
  "razor-route": c("ninja", "step", 300, .17, .56, 31, 7, 1),
  // Paper Double: a low-commit plant-and-release (the caster stays put —
  // the decoy is what runs), not a "step" gesture like Razor Route's own
  // dash-empowering cast. Minimal placeholder timing/reach, matching this
  // ability's own scope (sim correctness, not a full tactile VFX pass —
  // see paperDouble.ts's header / types.ts's PaperDoubleEntity comment).
  "paper-double": c("ninja", "plant", 340, .20, .58, 22, 2),
} as const satisfies Record<AbilityKind, AbilityAnimationContract>;

export type AbilityAnimationPhase = "anticipation" | "action" | "follow-through" | "recovery";

export function abilityAnimationPhase(kind: AbilityKind, normalizedTime: number): AbilityAnimationPhase {
  const a = ABILITY_ANIMATIONS[kind];
  const t = Math.max(0, Math.min(1, normalizedTime));
  if (t < a.anticipationEnd) return "anticipation";
  if (t < a.actionEnd) return "action";
  if (t < .86) return "follow-through";
  return "recovery";
}

export function isAbilityKind(kind: string): kind is AbilityKind {
  return Object.prototype.hasOwnProperty.call(ABILITY_ANIMATIONS, kind);
}
