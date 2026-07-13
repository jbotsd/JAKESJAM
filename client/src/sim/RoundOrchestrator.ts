// RoundOrchestrator — module that owns the running RoundState and routes
// it through the pure stepRound function.
//
// Depth: the round-step call, rngState threading, playerPatches application,
// and draft-pick validation sit behind three small methods. World.stepWithRuntime
// and server MatchHost both delegate here; callers no longer inline this logic.
//
// The pure `stepRound` in sim/round.ts is unchanged and still importable for
// unit tests — the orchestrator is an additional adapter, not a replacement.
//
// Interface:
//   step(world, dtMs) → { state, events, matchComplete, rngState? }
//   commitDraftPick(playerId, cardId): void  — server-side pick application
//   get roundState(): RoundState            — read-only current state

import { stepRound, TARGET_SCORE_DEFAULT } from "./round.js";
import type {
  PlayerId,
  PlayerEntity,
  RoundState,
  SimEvent,
  Tick,
  WorldState,
} from "./types.js";

export type OrchestratorStepResult = {
  state: RoundState;
  events: SimEvent[];
  matchComplete: boolean;
  /**
   * Updated RNG cursor, present when the draft phase advanced this tick and
   * consumed entropy. Callers must thread it back into WorldState.rngState.
   */
  rngState?: number;
  /**
   * Per-player card patches from auto-pick / draft resolution. Callers fold
   * these into `WorldState.players` before returning the next snapshot.
   */
  playerPatches?: Record<PlayerId, { cards: string[] }>;
};

export class RoundOrchestrator {
  private _roundState: RoundState;

  constructor(initialRound: RoundState) {
    this._roundState = initialRound;
  }

  get roundState(): RoundState {
    return this._roundState;
  }

  /**
   * Advance the round state machine by one sim tick.
   *
   * Accepts the world-level `players` and `rngState` needed by `stepRound`
   * for draft-offer rolling. Threads the resulting rng advance and player
   * card patches back to the caller via the return value.
   *
   * Mutates `this._roundState` to the result so successive calls always
   * start from the latest state.
   */
  step(
    players: Record<PlayerId, PlayerEntity>,
    tick: Tick,
    rngState: number,
    dtMs: number,
    targetScore: number = TARGET_SCORE_DEFAULT,
  ): OrchestratorStepResult {
    const result = stepRound({
      state: this._roundState,
      players,
      dtMs,
      targetScore,
      tick,
      rngState,
    });

    this._roundState = result.state;

    return {
      state: result.state,
      events: result.events,
      matchComplete: result.matchComplete,
      rngState: result.rngState,
      playerPatches: result.playerPatches,
    };
  }

  /**
   * Apply a draft-phase card pick. Validates:
   *   - round is in `drafting` and on the expected roundIndex;
   *   - player exists;
   *   - cardId is in the player's offer set;
   *   - player hasn't already picked this round.
   *
   * On success patches `draftingPicked` on the internal round state.
   * Returns true if the pick was accepted, false if it was rejected.
   *
   * Note: this only patches `draftingPicked`. The caller is responsible for
   * patching `player.cards` directly (since the orchestrator does not own
   * `WorldState.players`). The server MatchHost does this in its applyCardPick
   * path; the client prediction path doesn't call commitDraftPick (picks arrive
   * via authoritative snapshots).
   */
  commitDraftPick(
    playerId: PlayerId,
    roundIndex: number,
    cardId: string,
    players: Record<PlayerId, PlayerEntity>,
  ): boolean {
    const round = this._roundState;
    if (round.phase !== "drafting") return false;
    if (round.roundIndex !== roundIndex) return false;
    if (!players[playerId]) return false;

    const offers = round.draftingOffers?.[playerId];
    if (!offers || !offers.includes(cardId)) return false;

    const alreadyPicked = round.draftingPicked?.[playerId];
    if (alreadyPicked !== undefined) return false;

    this._roundState = {
      ...round,
      draftingPicked: {
        ...(round.draftingPicked ?? {}),
        [playerId]: cardId,
      },
    };
    return true;
  }

  /**
   * Replace the internal round state wholesale. Used when the server receives
   * an authoritative snapshot that may have advanced the round (e.g. reconnect
   * or first snapshot). This is the only mutation path other than step().
   */
  syncFromWorld(world: WorldState): void {
    this._roundState = world.round;
  }
}
