// Round state machine: countdown → fighting → round-over → countdown loop,
// plus the score-to-target match-complete signal. Pure inputs, deterministic.

import { describe, test, expect } from "bun:test";
import {
  stepRound,
  COUNTDOWN_MS,
  ROUND_TIME_LIMIT_MS,
  ROUND_OVER_HOLD_MS,
} from "../round.js";
import type { PlayerEntity, PlayerId, RoundState, SimEvent } from "../types.js";

function mkPlayer(id: PlayerId, overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: 0,
    ...overrides,
  };
}

function freshRound(playerIds: PlayerId[]): RoundState {
  const scores: Record<PlayerId, number> = {};
  for (const id of playerIds) scores[id] = 0;
  return {
    phase: "countdown",
    countdownRemainingMs: COUNTDOWN_MS,
    scores,
    roundIndex: 0,
    winnerPlayerId: null,
  };
}

describe("stepRound", () => {
  test("countdown ticks down then transitions to fighting at 0", () => {
    const players = { a: mkPlayer("a"), b: mkPlayer("b") };
    let state = freshRound(["a", "b"]);

    // 100ms tick — should still be in countdown.
    let result = stepRound({ state, players, dtMs: 100, targetScore: 3 });
    expect(result.state.phase).toBe("countdown");
    expect(result.state.countdownRemainingMs).toBe(COUNTDOWN_MS - 100);

    // Run enough ticks to drain the countdown.
    state = result.state;
    result = stepRound({ state, players, dtMs: COUNTDOWN_MS, targetScore: 3 });
    expect(result.state.phase).toBe("fighting");
    // Fighting phase is seeded with the round time limit.
    expect(result.state.countdownRemainingMs).toBe(ROUND_TIME_LIMIT_MS);
  });

  test("last-alive resolution: kill one of two → round-over, winner +1, round-end event", () => {
    const players = {
      a: mkPlayer("a", { alive: true, health: 100 }),
      b: mkPlayer("b", { alive: false, health: 0 }),
    };
    const state: RoundState = {
      phase: "fighting",
      countdownRemainingMs: ROUND_TIME_LIMIT_MS,
      scores: { a: 0, b: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
    };
    const result = stepRound({ state, players, dtMs: 16, targetScore: 3 });
    expect(result.state.phase).toBe("round-over");
    expect(result.state.winnerPlayerId).toBe("a");
    expect(result.state.scores.a).toBe(1);
    expect(result.state.scores.b).toBe(0);
    const endEvent = result.events.find((e): e is Extract<SimEvent, { t: "round-end" }> =>
      e.t === "round-end",
    );
    expect(endEvent).toBeDefined();
    expect(endEvent!.winnerId).toBe("a");
    expect(result.matchComplete).toBe(false);
  });

  test("mutual KO: winnerId is null and no scores change", () => {
    const players = {
      a: mkPlayer("a", { alive: false, health: 0 }),
      b: mkPlayer("b", { alive: false, health: 0 }),
    };
    const state: RoundState = {
      phase: "fighting",
      countdownRemainingMs: ROUND_TIME_LIMIT_MS,
      scores: { a: 0, b: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
    };
    const result = stepRound({ state, players, dtMs: 16, targetScore: 3 });
    expect(result.state.phase).toBe("round-over");
    expect(result.state.winnerPlayerId).toBeNull();
    expect(result.state.scores.a).toBe(0);
    expect(result.state.scores.b).toBe(0);
  });

  test("time-out resolution picks highest-health player (alphabetical tiebreak)", () => {
    // Equal health — tiebreak by alphabetical first id.
    const playersTie = {
      b: mkPlayer("b", { alive: true, health: 50 }),
      a: mkPlayer("a", { alive: true, health: 50 }),
    };
    const stateTimeout: RoundState = {
      phase: "fighting",
      countdownRemainingMs: 1, // will drop to 0 this tick → forceResolve
      scores: { a: 0, b: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
    };
    const tieResult = stepRound({
      state: stateTimeout,
      players: playersTie,
      dtMs: 16,
      targetScore: 3,
    });
    expect(tieResult.state.phase).toBe("round-over");
    expect(tieResult.state.winnerPlayerId).toBe("a");
    expect(tieResult.state.scores.a).toBe(1);

    // Different health — strictly higher health wins, even if id is alphabetically later.
    const playersHealth = {
      a: mkPlayer("a", { alive: true, health: 30 }),
      b: mkPlayer("b", { alive: true, health: 80 }),
    };
    const healthResult = stepRound({
      state: stateTimeout,
      players: playersHealth,
      dtMs: 16,
      targetScore: 3,
    });
    expect(healthResult.state.winnerPlayerId).toBe("b");
  });

  test("score-to-target → matchComplete:true is returned", () => {
    // 'a' is one win away from victory (target 3, currently 2). Last-alive tick.
    const players = {
      a: mkPlayer("a", { alive: true }),
      b: mkPlayer("b", { alive: false, health: 0 }),
    };
    const state: RoundState = {
      phase: "fighting",
      countdownRemainingMs: ROUND_TIME_LIMIT_MS,
      scores: { a: 2, b: 0 },
      roundIndex: 2,
      winnerPlayerId: null,
    };
    const result = stepRound({ state, players, dtMs: 16, targetScore: 3 });
    expect(result.state.scores.a).toBe(3);
    expect(result.matchComplete).toBe(true);
  });

  test("round-over → countdown rolls forward when match is not yet decided", () => {
    // Park in round-over with hold timer about to expire.
    const players = {
      a: mkPlayer("a", { alive: true }),
      b: mkPlayer("b", { alive: false }),
    };
    const state: RoundState = {
      phase: "round-over",
      countdownRemainingMs: 16, // less than dtMs → drains to 0 this tick
      scores: { a: 1, b: 0 },
      roundIndex: 0,
      winnerPlayerId: "a",
    };
    const result = stepRound({ state, players, dtMs: 32, targetScore: 3 });
    expect(result.state.phase).toBe("countdown");
    expect(result.state.countdownRemainingMs).toBe(COUNTDOWN_MS);
    expect(result.state.roundIndex).toBe(1);
    expect(result.state.winnerPlayerId).toBeNull();
    expect(result.matchComplete).toBe(false);
    // Sanity: the hold constant is the source of truth that we just consumed.
    expect(ROUND_OVER_HOLD_MS).toBeGreaterThan(0);
  });
});
