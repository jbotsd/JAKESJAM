// Mode config — the canonical registry for match "mode" axes: chaos
// modifiers (see chaosModifiers.ts, which this file wraps rather than
// rewrites) plus win-condition/round-pacing knobs, unified into one
// data-driven place to add a new axis (mirrors the maps.ts registry
// pattern: add-an-entry, not edit-scattered-code).
//
// DELIBERATE TRADE-OFF: axis ids ride the SAME `chaosModifierIds: string[]`
// wire field that's already synced end-to-end (room settings, URL params,
// localStorage) — no protocol/schema change, no field rename. This works
// because chaosModifiers.ts's getChaosProfile()/getChaosModifiers() already
// silently ignore any id they don't recognize (chaosModifiers.ts:161-168),
// so a select-axis id like "target-score-5" passes straight through the
// chaos reducer as a no-op and is only meaningful to resolveModeConfig()
// below. Keep it that way — a rename would touch privateLobby.ts,
// matchHost.ts, convexClient.ts, ReplayRecorder.ts, matchRegistry.ts for
// zero functional gain.

import { TARGET_SCORE_DEFAULT } from "../round.js";

export type TargetScoreOptionId = "target-score-3" | "target-score-5" | "target-score-7";

const TARGET_SCORE_BY_OPTION_ID: Record<TargetScoreOptionId, number> = {
  "target-score-3": 3,
  "target-score-5": 5,
  "target-score-7": 7,
};

const TARGET_SCORE_OPTION_IDS = Object.keys(
  TARGET_SCORE_BY_OPTION_ID,
) as TargetScoreOptionId[];

function isTargetScoreOptionId(value: unknown): value is TargetScoreOptionId {
  return typeof value === "string" && TARGET_SCORE_OPTION_IDS.includes(value as TargetScoreOptionId);
}

export type ResolvedModeConfig = {
  targetScore: number;
};

/** Pulls the mode-relevant values back out of a `chaosModifierIds`-shaped id
 *  list. Anything not recognized (a real chaos modifier id, or garbage) is
 *  ignored — this only cares about the mode-config axes it knows about. */
export function resolveModeConfig(ids: readonly string[] | undefined): ResolvedModeConfig {
  const targetScoreId = ids?.find(isTargetScoreOptionId);
  return {
    targetScore: targetScoreId ? TARGET_SCORE_BY_OPTION_ID[targetScoreId] : TARGET_SCORE_DEFAULT,
  };
}
