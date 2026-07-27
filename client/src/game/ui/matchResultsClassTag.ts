// Pure "what class tag does this results row show" helper for
// MatchResultsOverlay. Reuses the EXACT GEO/INT/KIN/SYZ abbreviations the
// in-match roster nameplate already established (HudSystem.updateScoreRows,
// classAccentColors.classShortLabel, 2026-07-20 "put what class everyone
// is... including self") so the match-end scoreboard and the live nameplate
// never drift into two different labeling schemes.
//
// Extracted into its own pure module (no DOM, no Phaser) for the same
// reason buildDescription.ts is its own file: MatchResultsOverlay.ts is DOM
// construction top to bottom and has no test file of its own, but the
// row-to-tag computation itself is pure data in / pure data out and is
// worth testing on its own.

import { classIdForArchetype } from "../../sim/data/cardTypes.js";
import { classAccentPalette, classShortLabel } from "./classAccentColors.js";
import type { CharacterArchetype } from "../../sim/types.js";

export type MatchResultsClassTag = {
  /** GEO / INT / KIN / SYZ — identical string classShortLabel returns. */
  label: string;
  /** CSS `#rrggbb` — the class's accent register (chassis-design-axioms
   *  CA2), converted the same way rarityColors.ts's rarityColorCss does. */
  colorCss: string;
};

/** Returns the class tag a results row should show, or undefined when the
 *  row carries no characterId. Some rows won't (e.g. a player record with
 *  no live PlayerEntity at match-end) — the overlay omits the tag rather
 *  than guessing a class or showing a placeholder. */
export function matchResultsClassTag(
  characterId: CharacterArchetype | undefined,
): MatchResultsClassTag | undefined {
  if (characterId === undefined) return undefined;
  const classId = classIdForArchetype(characterId);
  return {
    label: classShortLabel(classId),
    colorCss: `#${classAccentPalette(classId).accentColor.toString(16).padStart(6, "0")}`,
  };
}
