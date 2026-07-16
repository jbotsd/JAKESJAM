// Dead-wait countdown — what the big number on the death overlay MEANS.
//
// The old implementation showed the raw round clock: die 5s into a round
// and it said "RESPAWNING ... 85", then silently re-meant draft-time and
// round-over-time as phases changed underneath it (venue-goal.md Pillar
// 0.2, audit seam #8). The number was never a respawn timer in any phase
// except countdown.
//
// The fix is not four labels for four clocks — it's ONE question answered
// honestly: "when do I fight again?" Respawn happens at countdown entry,
// i.e. when drafting ends (World.ts's countdown-entry respawn), so the
// time-to-next-bell from any phase is the remaining phase time plus the
// fixed phases still ahead of it:
//
//   fighting    remaining + ROUND_OVER_HOLD + DRAFT_WINDOW   (estimate)
//   round-over  remaining + DRAFT_WINDOW                     (estimate)
//   drafting    remaining                                     (exact)
//   countdown   remaining                                     (already respawned;
//                                                             defensive branch)
//
// Estimates are UPPER bounds: a round can end early (last survivor falls)
// and a draft can resolve early (everyone picked) — so the number only
// ever jumps DOWN, never up. `approx` marks the estimate phases so the
// UI can render "~41" instead of asserting false precision.

import { DRAFT_WINDOW_MS, ROUND_OVER_HOLD_MS } from "../../sim/round.js";

export type RoundPhase = "countdown" | "fighting" | "round-over" | "drafting";

export type DeathWaitCountdown = {
  /** Timer caption — venue vocabulary: the bell is the round boundary
   *  where fighters (re-)enter the arena. */
  label: string;
  /** Whole seconds until the player fights again (upper bound when approx). */
  seconds: number;
  /** True when later phases can shorten the wait (early round end / early
   *  draft resolve) — render with a "~" rather than false precision. */
  approx: boolean;
};

export function deathWaitCountdown(
  phase: RoundPhase,
  countdownRemainingMs: number,
): DeathWaitCountdown {
  const remaining = Math.max(0, countdownRemainingMs);
  switch (phase) {
    case "fighting":
      return {
        label: "NEXT BELL",
        seconds: toSec(remaining + ROUND_OVER_HOLD_MS + DRAFT_WINDOW_MS),
        approx: true,
      };
    case "round-over":
      return { label: "NEXT BELL", seconds: toSec(remaining + DRAFT_WINDOW_MS), approx: true };
    case "drafting":
      return { label: "NEXT BELL", seconds: toSec(remaining), approx: false };
    case "countdown":
      // Everyone respawns at countdown ENTRY, so a dead player should never
      // see this — kept honest anyway for defensive completeness.
      return { label: "RESPAWNING", seconds: toSec(remaining), approx: false };
  }
}

function toSec(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}
