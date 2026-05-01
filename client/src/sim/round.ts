// Round state machine for Milestone 10 — Duel Flow Core.
// Pure transitions over RoundState. Called from World.step each tick.
// Emits SimEvents at phase boundaries (countdown end, round end, match end).
//
// Authority: server-side. Clients reflect whatever the server says — no client
// prediction of round transitions, no race-y client-side timers.

import type { PlayerEntity, PlayerId, RoundState, SimEvent } from "./types.js";

export const COUNTDOWN_MS = 3000;
export const ROUND_TIME_LIMIT_MS = 90_000;
export const ROUND_OVER_HOLD_MS = 2500;
export const TARGET_SCORE_DEFAULT = 3;

export type RoundStepInput = {
  state: RoundState;
  players: Record<PlayerId, PlayerEntity>;
  dtMs: number;
  /** First-to-this-many-rounds wins the match. */
  targetScore: number;
};

export type RoundStepResult = {
  state: RoundState;
  events: SimEvent[];
  /** True when the match has been decided this tick. */
  matchComplete: boolean;
};

/**
 * Advance the round state machine by one sim tick. Pure function: returns the
 * next state and any boundary events to broadcast.
 *
 * Phase transitions:
 *   countdown → fighting    (when countdownRemainingMs hits 0)
 *   fighting  → round-over  (last alive player or time limit reached)
 *   round-over → countdown  (after ROUND_OVER_HOLD_MS, until match target)
 *   round-over → (terminal) (when scores[winner] >= targetScore)
 */
export function stepRound(input: RoundStepInput): RoundStepResult {
  const { state, players, dtMs, targetScore } = input;
  const events: SimEvent[] = [];
  const next: RoundState = {
    phase: state.phase,
    countdownRemainingMs: state.countdownRemainingMs,
    scores: { ...state.scores },
    roundIndex: state.roundIndex,
    winnerPlayerId: state.winnerPlayerId,
  };

  switch (state.phase) {
    case "countdown": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      if (next.countdownRemainingMs <= 0) {
        next.phase = "fighting";
        next.countdownRemainingMs = ROUND_TIME_LIMIT_MS;
      }
      return { state: next, events, matchComplete: false };
    }

    case "fighting": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      const winner = decideRoundWinner(players, next.countdownRemainingMs <= 0);
      if (winner === undefined) {
        return { state: next, events, matchComplete: false };
      }
      next.phase = "round-over";
      next.winnerPlayerId = winner;
      next.countdownRemainingMs = ROUND_OVER_HOLD_MS;
      if (winner !== null) {
        next.scores[winner] = (next.scores[winner] ?? 0) + 1;
      }
      events.push({ t: "round-end", winnerId: winner });
      const matchWinner = checkMatchWinner(next.scores, targetScore);
      return { state: next, events, matchComplete: matchWinner !== null };
    }

    case "round-over": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      if (next.countdownRemainingMs > 0) {
        return { state: next, events, matchComplete: false };
      }
      const matchWinner = checkMatchWinner(next.scores, targetScore);
      if (matchWinner !== null) {
        // Match over — stay parked in round-over for results UI to show.
        return { state: next, events, matchComplete: true };
      }
      // Roll into the next round.
      next.phase = "countdown";
      next.roundIndex = state.roundIndex + 1;
      next.countdownRemainingMs = COUNTDOWN_MS;
      next.winnerPlayerId = null;
      return { state: next, events, matchComplete: false };
    }
  }
}

/**
 * Returns the winning player id, or null on a draw, or undefined if the round
 * is still in progress.
 *
 * Last-alive rules: as soon as ≤1 alive player remains the round resolves.
 * Time-out rules: when forceResolve is true, the player with most kills (or
 * any tiebreaker — for now, alphabetical first id) wins; null on full draw.
 */
function decideRoundWinner(
  players: Record<PlayerId, PlayerEntity>,
  forceResolve: boolean,
): PlayerId | null | undefined {
  const playerIds = Object.keys(players).sort();
  if (playerIds.length === 0) return undefined;

  const alive = playerIds.filter((id) => players[id]!.alive);

  if (alive.length === 0) {
    // Mutual KO this tick.
    return null;
  }
  if (alive.length === 1 && playerIds.length > 1) {
    return alive[0]!;
  }
  if (forceResolve) {
    // Time-out resolution: most-health-remaining among alive wins; tiebreak by id.
    const best = alive.reduce((best, id) => {
      if (best === null) return id;
      const a = players[best]!;
      const b = players[id]!;
      if (b.health > a.health) return id;
      if (b.health === a.health && id < best) return id;
      return best;
    }, null as PlayerId | null);
    return best;
  }
  return undefined;
}

function checkMatchWinner(
  scores: Record<PlayerId, number>,
  targetScore: number,
): PlayerId | null {
  let winner: PlayerId | null = null;
  for (const [id, score] of Object.entries(scores)) {
    if (score >= targetScore) {
      if (winner === null) {
        winner = id;
      } else {
        // Two players reached target the same tick — leave it to caller.
        return null;
      }
    }
  }
  return winner;
}
