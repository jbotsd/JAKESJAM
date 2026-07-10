// Round state machine for Milestone 10 — Duel Flow Core.
// Pure transitions over RoundState. Called from World.step each tick.
// Emits SimEvents at phase boundaries (countdown end, round end, match end,
// draft offers, draft-resolved picks).
//
// Authority: server-side. Clients reflect whatever the server says — no client
// prediction of round transitions, no race-y client-side timers.

import { STEP_MS } from "./constants.js";
import { crystalRoundsCards } from "./data/cards.js";
import {
  classifyDraftRole,
  pickWeighted,
  weightForCard,
} from "./draftWeights.js";
import { PlayerId, Tick } from "./types.js";
import type {
  PlayerEntity,
  RoundState,
  SimEvent,
} from "./types.js";

export const COUNTDOWN_MS = 3000;
export const ROUND_TIME_LIMIT_MS = 90_000;
export const ROUND_OVER_HOLD_MS = 2500;
export const TARGET_SCORE_DEFAULT = 3;

/**
 * First-blood wager (design pillars doc): movement speed multiplier applied
 * for the rest of the round to whichever player lands the first hit. Applied
 * in World.ts's per-player movement step alongside the existing slow/freeze
 * multipliers.
 */
export const FIRST_BLOOD_SPEED_MULTIPLIER = 1.15;

/**
 * Sudden-death shrinking arena (design pillars doc): once triggered, the
 * safe-zone radius lerps from START to END (fraction of the arena's
 * half-diagonal) over the round's `ROUND_TIME_LIMIT_MS`. Enforced by
 * `suddenDeath.ts`'s storm-damage step in World.ts.
 */
export const SUDDEN_DEATH_SCALE_START = 1.0;
export const SUDDEN_DEATH_SCALE_END = 0.6;
/** Damage per second dealt to a player caught outside the safe zone. Tuned
 *  low-ish on purpose — pressure, not an instant kill; a player can still
 *  fight their way back in. */
export const SUDDEN_DEATH_STORM_DPS = 8;

/**
 * Soft endgame zone (balance audit): timeout used to reward passive play —
 * whoever had the most health when the clock ran out won, so corner-camping
 * was a viable strategy. A GENTLER version of the sudden-death shrink now
 * runs in the final ENDGAME_ZONE_TRIGGER_MS of every round (not just a 2-2
 * game-point tie), forcing engagement without being punishing: scale only
 * eases from full coverage to ENDGAME_ZONE_SCALE_END (vs sudden death's
 * harder 0.6), and it only spans the last 15s rather than the whole round.
 * True sudden death (`round.suddenDeathActive`) always takes precedence —
 * this never doubles up with it.
 */
export const ENDGAME_ZONE_TRIGGER_MS = 15_000;
export const ENDGAME_ZONE_SCALE_END = 0.75;

/**
 * True when every player with a recorded score this match is tied one round
 * away from winning — the condition design pillars calls "both players at
 * targetScore-1". Generalizes past 2 players: an FFA where everyone with a
 * score is tied at match point is exactly the tense decider the mechanic is
 * for. Needs at least 2 scored players — a single scorer can't have a
 * decider round with themselves.
 */
function isSuddenDeathRound(scores: Record<PlayerId, number>, targetScore: number): boolean {
  const scored = Object.values(scores);
  if (scored.length < 2) return false;
  return scored.every((s) => s === targetScore - 1);
}

/**
 * When every HUMAN player is dead but bots are still alive, don't make the
 * lobby sit through a minute-long bot-vs-bot shootout — clamp the round to end
 * within this window. Only applies when humans are actually in the match (a
 * pure-bot world still runs full rounds for ambiance). Bots are identified by
 * the shared "bot_" id prefix (same convention the renderer uses to draw amber
 * bot rigs). Round authority is server-side, so this needs no client parity.
 */
export const NO_HUMAN_SURVIVOR_END_MS = 6_000;
const BOT_ID_PREFIX = "bot_";

/**
 * How long the drafting phase stays open before auto-resolving any
 * unpicked offers. Generous on purpose — the rogue-lite picker is the
 * "moment of progression", we'd rather pause longer than rush the read.
 */
export const DRAFT_WINDOW_MS = 15000;

/**
 * Cards offered to every roster player when the round transitions into
 * drafting (winner included — Escalation Engine / universal draft).
 * Dead / mid-respawn players still draft. Bumping this requires UI tweaks
 * on the picker side.
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
    firstBloodPlayerId: state.firstBloodPlayerId,
    suddenDeathActive: state.suddenDeathActive,
  };

  switch (state.phase) {
    case "countdown": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      if (next.countdownRemainingMs <= 0) {
        next.phase = "fighting";
        next.countdownRemainingMs = ROUND_TIME_LIMIT_MS;
        // Fresh round: first-blood is unclaimed, and sudden death is
        // re-evaluated from the scores heading into it.
        next.firstBloodPlayerId = undefined;
        const suddenDeath = isSuddenDeathRound(state.scores, targetScore);
        next.suddenDeathActive = suddenDeath;
        if (suddenDeath) events.push({ t: "sudden-death-started" });
      }
      return finalize(next, events, false, rngState);
    }

    case "fighting": {
      next.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - dtMs);
      // Bot-shootout guard: if humans are in the match but EVERY human is dead,
      // force the round to resolve once it has run at least
      // NO_HUMAN_SURVIVOR_END_MS — so the lobby isn't stuck watching bots duel.
      // Computed FRESH each tick from the current alive-set (NOT a persistent
      // countdown clamp), so a human who joins the world mid-round flips
      // anyHumanAlive → true and instantly cancels the force-end, getting a full
      // round instead of being yanked in <6s.
      const ids = Object.keys(players) as PlayerId[];
      const humanIds = ids.filter((id) => !id.startsWith(BOT_ID_PREFIX));
      const anyHumanAlive = humanIds.some((id) => players[id]?.alive);
      const elapsedMs = ROUND_TIME_LIMIT_MS - next.countdownRemainingMs;
      const forceByBotShootout =
        humanIds.length > 0 && !anyHumanAlive && elapsedMs >= NO_HUMAN_SURVIVOR_END_MS;
      const winner = decideRoundWinner(
        players,
        next.countdownRemainingMs <= 0 || forceByBotShootout,
      );
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
      next.firstBloodPlayerId = undefined;
      next.suddenDeathActive = undefined;
      return finalize(next, events, false, rngState);
    }

    case "drafting": {
      // Resolution criteria (either):
      //   1. every player WHO HAS OFFERS has picked, or
      //   2. the draft window expired (tick >= draftingExpiresAtTick) —
      //      unpicked drafters get their first offer auto-picked.
      // The expiry path is what the CardDraftOverlay UI has always
      // promised ("Auto-selects when the timer expires") and what the
      // World.step playerPatches consumer was built for; without it a
      // single AFK/closed-tab player wedged the whole always-on world in
      // drafting forever (observed live 2026-07-03: world stuck, no
      // fighting phase for 5+ minutes).
      // Drafting includes dead players too (the round-end
      // loser is usually mid-respawn and must still get to pick).
      //
      // Critically: we key off `state.draftingOffers` keys, NOT
      // `state.players` keys. A player who joined the io world AFTER
      // drafting started has no offers (offers are rolled once at
      // drafting entry by `enterDrafting`). Including them in the
      // resolution gate would deadlock the world forever — they can't
      // pick what they were never offered. Late joiners just sit out
      // this drafting window and join the next round normally.
      const previousPicked = state.draftingPicked ?? {};
      const offers = state.draftingOffers ?? {};
      const draftingIds = Object.keys(offers).sort();

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
      for (const pid_ of Object.keys(previousPicked).sort()) {
        const pid = pid_ as PlayerId;
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

      // If everyone with offers has disconnected and been evicted (so
      // their entries were scrubbed by MatchHost.evictExpiredDisconnects)
      // there's nobody to wait for — exit drafting cleanly. Same shape
      // as the all-picked case below.
      const noDraftersLeft = draftingIds.length === 0;
      const allPicked = !noDraftersLeft &&
        draftingIds.every((id) => previousPicked[id as PlayerId] !== undefined);
      const expired =
        tick !== undefined &&
        state.draftingExpiresAtTick !== undefined &&
        (tick as number) >= (state.draftingExpiresAtTick as number);

      if (!noDraftersLeft && !allPicked && !expired) {
        // Stay in drafting. Persist the fired marker so subsequent ticks
        // don't re-emit `draft-resolved` for the same player.
        const carry: WithMarker = {
          ...next,
          [firedKey]: fired,
        };
        return finalize(carry, events, false, rngState);
      }

      // Window expired with picks outstanding: auto-pick the FIRST offer
      // for every unpicked drafter. Deterministic (offer order is the
      // rolled order), emits draft-resolved with autoPicked=true, and
      // grants the card via playerPatches — the World.step consumer that
      // has been waiting for exactly this.
      let playerPatches: Record<PlayerId, { cards: string[] }> | undefined;
      if (expired && !allPicked) {
        for (const pid_ of draftingIds) {
          const pid = pid_ as PlayerId;
          if (previousPicked[pid] !== undefined) continue;
          const cardId = offers[pid]?.[0];
          if (cardId === undefined) continue;
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
            playerPatches ??= {};
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
      next.firstBloodPlayerId = undefined;
      next.suddenDeathActive = undefined;
      return finalize(next, events, false, rngState, playerPatches);
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
 * Roll DRAFT_OFFER_COUNT card ids for every roster player using the seeded
 * RNG (Escalation Engine — universal round-end draft). Includes the round
 * winner and dead/mid-respawn players. Catch-up is additive: non-winners use
 * richer sampling weights (`draftWeights.ts`); winners still get full offers.
 * On a draw (`winnerPlayerId` null) everyone uses standard weights.
 *
 * Skips `unique: true` cards already in hand and cards already held at
 * maxStacks copies. Iteration order is sorted by id so the offer roll is
 * fully deterministic given (rngState, players, winner).
 */
export function enterDrafting(
  next: RoundState,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
  rngState: number,
): { state: RoundState; events: SimEvent[]; rngState: number } {
  const events: SimEvent[] = [];
  let cursor = rngState;
  const roundWinner = next.winnerPlayerId ?? null;
  // UNIVERSAL DRAFT: every roster seat is a drafting seat. Sorted ids keep
  // RNG consumption deterministic. Winner inclusion changes the historical
  // loser-only stream (documented in changelog / goal).
  const draftingIds = Object.keys(players).sort();

  const draftingOffers: Record<PlayerId, string[]> = {};

  for (const pid_ of draftingIds) {
    const pid = pid_ as PlayerId;
    const player = players[pid]!;
    const role = classifyDraftRole(pid, roundWinner);
    const owned = new Set(player.cards);
    // Copies held per card id — `player.cards` keeps one entry per stack.
    const copies = new Map<string, number>();
    for (const id of player.cards) copies.set(id, (copies.get(id) ?? 0) + 1);
    const candidatePool = crystalRoundsCards.filter((c) => {
      // `unique: true` cards must not appear twice in a hand.
      if (c.unique && owned.has(c.id)) return false;
      // maxStacks is a REAL cap, enforced here at the offer roll (it used to
      // be advisory-only — unbounded fire-rate/count stacking blew straight
      // through the 1.5s-TTK guardrail, e.g. 5× Rapid Refraction = 2.7× rate).
      if (c.maxStacks !== undefined && (copies.get(c.id) ?? 0) >= c.maxStacks) {
        return false;
      }
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
        const remaining = candidatePool.filter((c) => !seen.has(c.id));
        if (remaining.length === 0) break;
        const [nextCursor, picked] = pickWeighted(cursor, remaining, (c) =>
          weightForCard(c, role),
        );
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
    draftingExpiresAtTick: Tick(tick + Math.ceil(DRAFT_WINDOW_MS / STEP_MS)),
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
  const playerIds = (Object.keys(players) as PlayerId[]).sort();
  // Empty match: keep the round in-progress on a normal tick, but on a forced
  // resolve (time-out or bot-shootout guard) resolve to a draw so the phase
  // can't hang forever with zero players.
  if (playerIds.length === 0) return forceResolve ? null : undefined;

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
  for (const [id_, score] of Object.entries(scores)) {
    const id = id_ as PlayerId;
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
