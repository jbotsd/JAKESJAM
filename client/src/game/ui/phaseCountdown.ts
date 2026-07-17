// Dead-wait countdown — what the big number on the death overlay MEANS.
//
// The old implementation showed the raw round clock: die 5s into a round
// and it said "RESPAWNING ... 85", then silently re-meant draft-time and
// round-over-time as phases changed underneath it (venue-goal.md Pillar
// 0.2, audit seam #8). The number was never a respawn timer in any phase
// except countdown.
//
// The fix is not four labels for four clocks — it's ONE question answered
// honestly: "when do I fight again?" Under the fast-respawn ruling
// (2026-07-17) an ordinary-round death re-forms after RESPAWN_DELAY_MS —
// the caller passes that as respawnSeconds and the label is RESPAWNING,
// exact. With no respawn coming (sudden death), the answer is the bell:
// everyone respawns at countdown entry, so the time-to-next-bell from any
// phase is the remaining phase time plus the fixed phases ahead of it:
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

import { DRAFT_WINDOW_MS, msUntilNextBell } from "../../sim/round.js";

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
  /** Seconds until this player's mid-round respawn (fast-respawn ruling,
   *  2026-07-17: ordinary-round deaths re-form after RESPAWN_DELAY_MS).
   *  null/undefined = no respawn coming this round (sudden death) — fall
   *  back to the next-bell math. */
  respawnSeconds?: number | null,
): DeathWaitCountdown {
  if (phase === "fighting" && respawnSeconds != null) {
    return { label: "RESPAWNING", seconds: Math.max(0, respawnSeconds), approx: false };
  }
  if (phase === "countdown") {
    // Everyone respawns at countdown ENTRY, so a dead player should never
    // see this — kept honest anyway for defensive completeness.
    return { label: "RESPAWNING", seconds: toSec(Math.max(0, countdownRemainingMs)), approx: false };
  }
  // Shared phase-sum math with the server's venue summary (@sim/round.ts).
  return {
    label: "NEXT BELL",
    seconds: toSec(msUntilNextBell(phase, countdownRemainingMs)),
    approx: phase !== "drafting",
  };
}

function toSec(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * How long to arm the draft overlay's timer bar for (venue-goal Pillar
 * 0.3): the server-authoritative remaining draft time, never zero. Offers
 * can arrive a beat after drafting began (snapshot timing) — clamp into
 * (0, DRAFT_WINDOW_MS] — or on the edge before the phase flips, where the
 * full window is the honest arm. The old call path passed a literal 0,
 * which left the bar at width 0 forever while the hint text promised
 * "auto-selects when the timer expires".
 */
export function draftTimerArmMs(
  phase: RoundPhase,
  countdownRemainingMs: number,
): number {
  if (phase !== "drafting") return DRAFT_WINDOW_MS;
  return Math.min(DRAFT_WINDOW_MS, Math.max(0, countdownRemainingMs)) || DRAFT_WINDOW_MS;
}
