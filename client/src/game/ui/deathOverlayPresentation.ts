// Doors 1.4 (open-doors-goal.md): a never-spawned player is never told
// they died.
//
// A pending entrant — admitted at the venue gate but parked spectating
// until the countdown-entry drain inserts them (worldHost S2.D
// `pendingEntrants`) — is ABSENT from `state.players`, which the death
// overlay's `isDead` derivation can't tell apart from a corpse. Before
// this module the scene reached the eliminated path and told a player who
// had never fought "ELIMINATED", complete with the eliminated /
// soul-reclaimed announcer rite.
//
// This is the ONE decision point for that surface, extracted pure so the
// copy branch is unit-testable without Phaser:
//
//   never spawned      → "pending-entrant": NEXT BELL framing + spectate
//                        context; no death rite, no announcer keys.
//   spawned, then dead → "eliminated": the classic treatment, wait math
//                        unchanged (phaseCountdown.deathWaitCountdown).
//
// `everSpawned` is derived CLIENT-side — "seen self alive at least once"
// in any received state — no server protocol involved (the server lane
// owns the hosts; the client can already observe everything it needs).

import {
  deathWaitCountdown,
  type DeathWaitCountdown,
  type RoundPhase,
} from "./phaseCountdown.js";
import { msUntilNextBell } from "../../sim/round.js";
import { BELL_LABEL } from "../../venueNames.ts";

/** Overlay copy for the parked entrant. Venue vocabulary ("the bell" =
 *  the round boundary where fighters enter, docs/venue-design.md §3);
 *  optimistic framing — they're admitted, nothing bad happened to them. */
export const PENDING_ENTRANT_TITLE = "YOU'RE IN";
export const PENDING_ENTRANT_SUBTITLE =
  "Bout in progress — watch the fight, you drop in at the next bell";

export type DeathOverlayPresentation =
  | {
      /** Real death: ELIMINATED copy; the announcer rite (eliminated →
       *  soul-reclaimed) belongs to this variant EXCLUSIVELY. */
      variant: "eliminated";
      wait: DeathWaitCountdown;
    }
  | {
      /** Admitted but never spawned: spectate framing, never death copy,
       *  never the eliminated/soul-reclaimed announcer keys. */
      variant: "pending-entrant";
      title: string;
      subtitle: string;
      wait: DeathWaitCountdown;
    };

export function deathOverlayPresentation(
  everSpawned: boolean,
  phase: RoundPhase,
  countdownRemainingMs: number,
  respawnSeconds?: number | null,
): DeathOverlayPresentation {
  if (everSpawned) {
    return {
      variant: "eliminated",
      wait: deathWaitCountdown(phase, countdownRemainingMs, respawnSeconds),
    };
  }
  return {
    variant: "pending-entrant",
    title: PENDING_ENTRANT_TITLE,
    subtitle: PENDING_ENTRANT_SUBTITLE,
    wait: nextBellCountdown(phase, countdownRemainingMs),
  };
}

/** Time-to-next-bell for someone who hasn't fought yet. Differs from
 *  deathWaitCountdown in exactly one phase: "countdown". A dead player
 *  there has already respawned (label RESPAWNING, defensive branch), but
 *  a still-parked entrant is watching the pre-fight count for the bell
 *  they were admitted to — insertion lands at countdown ENTRY (worldHost
 *  S2.D drain), so the honest label stays NEXT BELL and the number is the
 *  remaining count. (msUntilNextBell returns 0 for "countdown" — its
 *  "joinable moment" semantics — hence the special case here.) */
export function nextBellCountdown(
  phase: RoundPhase,
  countdownRemainingMs: number,
): DeathWaitCountdown {
  if (phase === "countdown") {
    return {
      label: BELL_LABEL,
      seconds: ceilSec(Math.max(0, countdownRemainingMs)),
      approx: false,
    };
  }
  return {
    label: BELL_LABEL,
    seconds: ceilSec(msUntilNextBell(phase, countdownRemainingMs)),
    // Same honesty rule as deathWaitCountdown: estimates are upper bounds
    // (a round or draft can resolve early) — only drafting is exact.
    approx: phase !== "drafting",
  };
}

function ceilSec(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}
