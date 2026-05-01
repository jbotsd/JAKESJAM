// Round state machine for Milestone 10 — Duel Flow Core.
// Pure transitions over RoundState. Called from World.step each tick.
// Emits SimEvents at phase boundaries (countdown end, round end, match end,
// draft offers, draft-resolved picks).
//
// Authority: server-side. Clients reflect whatever the server says — no client
// prediction of round transitions, no race-y client-side timers.

import { STEP_MS } from "./constants.js";
import { crystalRoundsCards } from "./data/cards.js";
import { pickOne } from "./rng.js";
import type {
  PlayerEntity,
  PlayerId,
  RoundState,
  SimEvent,
  Tick,
} from "./types.js";

export const COUNTDOWN_MS = 3000;
export const ROUND_TIME_LIMIT_MS = 90_000;
export const ROUND_OVER_HOLD_MS = 2500;
export const TARGET_SCORE_DEFAULT = 3;

/**
 * How long the drafting phase stays open before auto-resolving any
 * unpicked offers. Generous on purpose — the rogue-lite picker is the
 * "moment of progression", we'd rather pause longer than rush the read.
 */
export const DRAFT_WINDOW_MS = 8000;

/**
 * Cards offered to each alive player when the round transitions into
 * drafting. Bumping this requires UI tweaks on the picker side.
 */
export const DRAFT_OFFER_COUNT = 3;

export type RoundStepInput = {
  state: RoundState;
  players: Record<PlayerId, PlayerEntity>;
  dtMs: number;
  /** First-to-this-many-rounds wins the match. */
  targetScore: number;
  /**
   * Optional: current world tick. Required to enter the drafting phase
   * (we need it to compute `draftingExpiresAtTick`). When omitted, the
   * round-over → countdown path skips drafting entirely (legacy behavior),
   * which keeps pure unit tests free of the new wiring.
   */
  tick?: Tick;
  /**
   * Optional: the current RNG cursor. Required to roll deterministic draft
   * offers. When omitted, drafting is skipped (same fallback as above).
   */
  rngState?: number;
};

export type RoundStepResult = {
  state: RoundState;
  events: SimEvent[];
  /** True when the match has been decided this tick. */
  matchComplete: boolean;
  /**
   * Optional: updated RNG cursor after drafting rolls. Present only when
   * the input supplied `rngState`. Callers should thread this back into
   * `WorldState.rngState` so the next tick continues from where we left off.
   */
  rngState?: number;
  /**
   * Optional: per-player patches the orchestrator should fold into
   * `WorldState.players` before returning the next snapshot. Used today
   * only for auto-picked draft cards on draft-window expiry — server-
   * driven `applyCardPick` writes player.cards directly, so this is the
   * fallback path. Each value is the post-patch `cards` array.
   */
  playerPatches?: Record<PlayerId, { cards: string[] }>;
};

/**
 * Advance the round state machine by one sim tick. Pure function: returns the
 * next state and any boundary events to broadcast.
 *
 * Phase transitions:
 *   countdown  → fighting    (when countdownRemainingMs hits 0)
 *   fighting   → round-over  (last alive player or time limit reached)
 *   round-over → drafting    (after ROUND_OVER_HOLD_MS, when tick+rngState
 *                             are supplied; rolls DRAFT_OFFER_COUNT cards
 *                             per alive player)
 *   round-over → countdown   (legacy fallback when no tick/rngState — used
 *                             by pure unit tests that don't exercise the
 *                             draft phase)
 *   drafting   → countdown   (when all alive players are in `draftingPicked`
 *                             OR `tick >= draftingExpiresAtTick`; emits a
 *                             `draft-resolved` event per pick, including
 *                             auto-picked leftmost offers on expiry)
 *   round-over → (terminal)  (when scores[winner] >= targetScore)
 */
export function stepRound(input: RoundStepInput): RoundStepResult {
  const { state, players, dtMs, targetScore, tick, rngState } = input;
  const events: SimEvent[] = [];
  const next: RoundState = {
    phase: state.phase,
    countdownRemainingMs: state.countdownRemainingMs,
    scores: { ...state.scores },
    roundIndex: state.roundIndex,
    winnerPlayerId: state.winnerPlayerId,
    // Carry forward optional drafting bookkeeping so non-drafting phases
    // don't accidentally drop it mid-flight (matters when stepRound is
    // called twice in the same tick by tests; in practice the drafting
    // fields only live during the `drafting` phase).
    draftingExpiresAtTick: state.draftingExpiresAtTick,
    draftingPicked: state.draftingPicked,
    draftingOffers: state.draftingOffers,
  };

  switch (state.phase) {
    case "countdown": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      if (next.countdownRemainingMs <= 0) {
        next.phase = "fighting";
        next.countdownRemainingMs = ROUND_TIME_LIMIT_MS;
      }
      return finalize(next, events, false, rngState);
    }

    case "fighting": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      const winner = decideRoundWinner(players, next.countdownRemainingMs <= 0);
      if (winner === undefined) {
        return finalize(next, events, false, rngState);
      }
      next.phase = "round-over";
      next.winnerPlayerId = winner;
      next.countdownRemainingMs = ROUND_OVER_HOLD_MS;
      if (winner !== null) {
        next.scores[winner] = (next.scores[winner] ?? 0) + 1;
      }
      events.push({ t: "round-end", winnerId: winner });
      const matchWinner = checkMatchWinner(next.scores, targetScore);
      return finalize(next, events, matchWinner !== null, rngState);
    }

    case "round-over": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      if (next.countdownRemainingMs > 0) {
        return finalize(next, events, false, rngState);
      }
      const matchWinner = checkMatchWinner(next.scores, targetScore);
      if (matchWinner !== null) {
        // Match over — stay parked in round-over for results UI to show.
        return finalize(next, events, true, rngState);
      }
      // Roll into drafting if we have the bits we need (a sim tick + RNG
      // cursor). The pure-test callers that omit them fall straight into
      // countdown like the pre-draft-phase implementation.
      if (tick !== undefined && rngState !== undefined) {
        const draft = enterDrafting(next, players, tick, rngState);
        return {
          state: draft.state,
          events: [...events, ...draft.events],
          matchComplete: false,
          rngState: draft.rngState,
        };
      }
      // Legacy fallback: round-over → countdown directly.
      next.phase = "countdown";
      next.roundIndex = state.roundIndex + 1;
      next.countdownRemainingMs = COUNTDOWN_MS;
      next.winnerPlayerId = null;
      next.draftingExpiresAtTick = undefined;
      next.draftingPicked = undefined;
      next.draftingOffers = undefined;
      return finalize(next, events, false, rngState);
    }

    case "drafting": {
      // Resolution criterion: "all alive players have picked" OR
      // "tick >= draftingExpiresAtTick". The countdown timer is not
      // consulted in this phase.
      const offers = state.draftingOffers ?? {};
      const previousPicked = state.draftingPicked ?? {};
      const aliveIds = Object.keys(players)
        .filter((id) => players[id]!.alive)
        .sort();

      // We need a per-pick "have we already announced this draft-resolved?"
      // marker so picks landing across multiple ticks don't re-emit. Pure-
      // function constraint forbids module-level state, so we stash the
      // marker on the round state itself under an underscore-prefixed key.
      // Type-cast keeps the public RoundState shape clean.
      const firedKey = "__draftResolvedFired";
      type WithMarker = RoundState & {
        [k in typeof firedKey]?: Record<PlayerId, true>;
      };
      const fired: Record<PlayerId, true> = {
        ...((state as WithMarker)[firedKey] ?? {}),
      };
      for (const pid of Object.keys(previousPicked).sort()) {
        if (!fired[pid]) {
          events.push({
            t: "draft-resolved",
            playerId: pid,
            cardId: previousPicked[pid]!,
            autoPicked: false,
          });
          fired[pid] = true;
        }
      }

      const expired = tick !== undefined &&
        state.draftingExpiresAtTick !== undefined &&
        tick >= state.draftingExpiresAtTick;
      const allPicked = aliveIds.length > 0 &&
        aliveIds.every((id) => previousPicked[id] !== undefined);

      if (!expired && !allPicked) {
        // Stay in drafting. Persist the fired marker so subsequent ticks
        // don't re-emit `draft-resolved` for the same player.
        const carry: WithMarker = {
          ...next,
          [firedKey]: fired,
        };
        return finalize(carry, events, false, rngState);
      }

      // Resolve: auto-pick leftmost offer for any alive player who hasn't
      // committed before the window expired. Emit `draft-resolved` with
      // autoPicked=true for those, and surface a `playerPatches` entry so
      // the orchestrator (World.ts) folds the new card id into the
      // canonical `player.cards` array. Server-applied picks (the normal
      // path) already wrote into `player.cards` via `applyCardPick`; this
      // patch is the fallback for the auto-pick case only.
      const playerPatches: Record<PlayerId, { cards: string[] }> = {};
      if (expired) {
        for (const pid of aliveIds) {
          if (previousPicked[pid] !== undefined) continue;
          const playerOffers = offers[pid];
          if (!playerOffers || playerOffers.length === 0) continue;
          const cardId = playerOffers[0]!;
          if (!fired[pid]) {
            events.push({
              t: "draft-resolved",
              playerId: pid,
              cardId,
              autoPicked: true,
            });
            fired[pid] = true;
          }
          const player = players[pid];
          if (player) {
            playerPatches[pid] = { cards: [...player.cards, cardId] };
          }
        }
      }

      // Drafting → countdown. Wipe drafting bookkeeping so the next round
      // starts clean.
      next.phase = "countdown";
      next.roundIndex = state.roundIndex + 1;
      next.countdownRemainingMs = COUNTDOWN_MS;
      next.winnerPlayerId = null;
      next.draftingExpiresAtTick = undefined;
      next.draftingPicked = undefined;
      next.draftingOffers = undefined;
      const patches = Object.keys(playerPatches).length > 0 ? playerPatches : undefined;
      return finalize(next, events, false, rngState, patches);
    }
  }
}

function finalize(
  state: RoundState,
  events: SimEvent[],
  matchComplete: boolean,
  rngState?: number,
  playerPatches?: Record<PlayerId, { cards: string[] }>,
): RoundStepResult {
  const result: RoundStepResult = { state, events, matchComplete };
  if (rngState !== undefined) result.rngState = rngState;
  if (playerPatches !== undefined) result.playerPatches = playerPatches;
  return result;
}

/**
 * Roll DRAFT_OFFER_COUNT card ids per alive player using the seeded RNG.
 * Skips cards already in the player's hand when the source card declares
 * itself `unique: true` (so the same-rarity weapon never gets re-offered).
 *
 * Iteration order over alive players is sorted by id so the offer roll is
 * fully deterministic given (rngState, players).
 */
function enterDrafting(
  next: RoundState,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
  rngState: number,
): { state: RoundState; events: SimEvent[]; rngState: number } {
  const events: SimEvent[] = [];
  let cursor = rngState;
  const aliveIds = Object.keys(players)
    .filter((id) => players[id]!.alive)
    .sort();

  const draftingOffers: Record<PlayerId, string[]> = {};

  for (const pid of aliveIds) {
    const player = players[pid]!;
    const owned = new Set(player.cards);
    const candidatePool = crystalRoundsCards.filter((c) => {
      // `unique: true` cards must not appear twice in a hand. Non-unique
      // cards can stack so we leave them in the pool regardless.
      if (c.unique && owned.has(c.id)) return false;
      return true;
    });
    const offered: string[] = [];
    if (candidatePool.length > 0) {
      const seen = new Set<string>();
      const target = Math.min(DRAFT_OFFER_COUNT, candidatePool.length);
      // Bounded loop: each iteration advances rng deterministically. The
      // 8x cap keeps a pathologically small pool (e.g. only one eligible
      // card) from spinning forever.
      let attempts = 0;
      while (offered.length < target && attempts < target * 8) {
        const [nextCursor, picked] = pickOne(cursor, candidatePool);
        cursor = nextCursor;
        if (!seen.has(picked.id)) {
          seen.add(picked.id);
          offered.push(picked.id);
        }
        attempts += 1;
      }
    }
    draftingOffers[pid] = offered;
    events.push({ t: "card-offered", playerId: pid, cardIds: offered });
  }

  const drafting: RoundState = {
    ...next,
    phase: "drafting",
    countdownRemainingMs: DRAFT_WINDOW_MS,
    winnerPlayerId: next.winnerPlayerId,
    draftingExpiresAtTick: tick + Math.ceil(DRAFT_WINDOW_MS / STEP_MS),
    draftingPicked: {},
    draftingOffers,
  };

  return { state: drafting, events, rngState: cursor };
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
