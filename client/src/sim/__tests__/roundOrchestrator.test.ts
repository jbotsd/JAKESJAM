// Tests for RoundOrchestrator — validates that the orchestrator delegates to
// stepRound correctly, that commitDraftPick validates offers, and that
// syncFromWorld replaces the internal state.

import { describe, test, expect } from "bun:test";
import { STEP_MS } from "../constants.js";
import { COUNTDOWN_MS, ROUND_OVER_HOLD_MS } from "../round.js";
import { RoundOrchestrator } from "../RoundOrchestrator.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type PlayerEntity,
  type RoundState,
  type WorldState,
} from "../types.js";

const A = PlayerId("a");
const B = PlayerId("b");

function mkPlayer(idRaw: string, overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  const id = PlayerId(idRaw);
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
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

function freshRoundState(): RoundState {
  return {
    phase: "countdown",
    countdownRemainingMs: COUNTDOWN_MS,
    scores: { [A]: 0, [B]: 0 },
    roundIndex: 0,
    winnerPlayerId: null,
  };
}

const players: Record<PlayerId, PlayerEntity> = {
  [A]: mkPlayer("a"),
  [B]: mkPlayer("b"),
};

describe("RoundOrchestrator.step", () => {
  test("advances countdown toward zero", () => {
    const orch = new RoundOrchestrator(freshRoundState());
    const result = orch.step(players, Tick(1), 0, STEP_MS);
    expect(result.state.countdownRemainingMs).toBe(COUNTDOWN_MS - STEP_MS);
    expect(result.state.phase).toBe("countdown");
    expect(result.matchComplete).toBe(false);
  });

  test("transitions countdown → fighting at zero", () => {
    const orch = new RoundOrchestrator(freshRoundState());
    // Drain the countdown — need enough steps to reach 0.
    const stepsNeeded = Math.ceil(COUNTDOWN_MS / STEP_MS) + 1;
    let tick = 0;
    let result = orch.step(players, Tick(tick), 0, STEP_MS);
    for (let i = 1; i <= stepsNeeded; i += 1) {
      tick += 1;
      result = orch.step(players, Tick(tick), 0, STEP_MS);
    }
    expect(result.state.phase).toBe("fighting");
  });

  test("emits round-end when one player dies in a SUDDEN DEATH fighting phase", () => {
    // Fast-respawn ruling 2026-07-17: last-alive resolution is sudden-death
    // only; ordinary rounds respawn the fallen and run the clock.
    const fighting: RoundState = {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: { [A]: 0, [B]: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
      suddenDeathActive: true,
    };
    const orch = new RoundOrchestrator(fighting);
    const deadPlayers: Record<PlayerId, PlayerEntity> = {
      [A]: mkPlayer("a"),
      [B]: mkPlayer("b", { alive: false, health: 0 }),
    };
    const result = orch.step(deadPlayers, Tick(1), 0, STEP_MS);
    expect(result.state.phase).toBe("round-over");
    expect(result.events.some((e) => e.t === "round-end")).toBe(true);
    expect(result.state.scores[A]).toBe(1);
  });

  test("orchestrator state persists across successive calls", () => {
    const orch = new RoundOrchestrator(freshRoundState());
    // Step 10 times.
    for (let i = 0; i < 10; i += 1) {
      orch.step(players, Tick(i), 0, STEP_MS);
    }
    expect(orch.roundState.countdownRemainingMs).toBeCloseTo(
      Math.max(0, COUNTDOWN_MS - 10 * STEP_MS),
      5,
    );
  });
});

describe("RoundOrchestrator.commitDraftPick", () => {
  function draftingState(): RoundState {
    return {
      phase: "drafting",
      countdownRemainingMs: 15_000,
      scores: { [A]: 0, [B]: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
      draftingPicked: {},
      draftingOffers: {
        [A]: ["card-fire-shot", "card-ice-shot", "card-void-shot"],
        [B]: ["card-fire-shot", "card-ice-shot", "card-void-shot"],
      },
    };
  }

  test("accepts a valid pick", () => {
    const orch = new RoundOrchestrator(draftingState());
    const accepted = orch.commitDraftPick(A, 0, "card-fire-shot", players);
    expect(accepted).toBe(true);
    expect(orch.roundState.draftingPicked?.[A]).toBe("card-fire-shot");
  });

  test("rejects a pick not in the offer set", () => {
    const orch = new RoundOrchestrator(draftingState());
    const accepted = orch.commitDraftPick(A, 0, "card-not-offered", players);
    expect(accepted).toBe(false);
    expect(orch.roundState.draftingPicked?.[A]).toBeUndefined();
  });

  test("rejects a double pick", () => {
    const orch = new RoundOrchestrator(draftingState());
    orch.commitDraftPick(A, 0, "card-fire-shot", players);
    const second = orch.commitDraftPick(A, 0, "card-ice-shot", players);
    expect(second).toBe(false);
    // Original pick is preserved.
    expect(orch.roundState.draftingPicked?.[A]).toBe("card-fire-shot");
  });

  test("rejects a pick when not in drafting phase", () => {
    const orch = new RoundOrchestrator(freshRoundState());
    const accepted = orch.commitDraftPick(A, 0, "card-fire-shot", players);
    expect(accepted).toBe(false);
  });

  test("rejects a pick for the wrong round index", () => {
    const orch = new RoundOrchestrator(draftingState());
    const accepted = orch.commitDraftPick(A, 99, "card-fire-shot", players);
    expect(accepted).toBe(false);
  });
});

describe("RoundOrchestrator.syncFromWorld", () => {
  test("replaces internal state from the snapshot", () => {
    const orch = new RoundOrchestrator(freshRoundState());
    // Step a few ticks to advance the countdown.
    orch.step(players, Tick(1), 0, STEP_MS * 5);
    // Now sync from a world with a different round state.
    const remoteRound: RoundState = {
      phase: "fighting",
      countdownRemainingMs: 45_000,
      scores: { [A]: 1, [B]: 0 },
      roundIndex: 1,
      winnerPlayerId: null,
    };
    const remoteWorld = {
      round: remoteRound,
    } as unknown as WorldState;
    orch.syncFromWorld(remoteWorld);
    expect(orch.roundState.phase).toBe("fighting");
    expect(orch.roundState.roundIndex).toBe(1);
    expect(orch.roundState.scores[A]).toBe(1);
  });
});

describe("RoundOrchestrator integration: round-over hold → drafting", () => {
  test("transitions round-over → drafting after hold expires", () => {
    const roundOver: RoundState = {
      phase: "round-over",
      countdownRemainingMs: ROUND_OVER_HOLD_MS,
      scores: { [A]: 0, [B]: 0 },
      roundIndex: 0,
      winnerPlayerId: A,
    };
    const orch = new RoundOrchestrator(roundOver);
    // Step just past the hold duration.
    const stepsNeeded = Math.ceil(ROUND_OVER_HOLD_MS / STEP_MS) + 2;
    let result = orch.step(players, Tick(1), 1234, STEP_MS);
    for (let i = 2; i <= stepsNeeded; i += 1) {
      result = orch.step(players, Tick(i), 1234, STEP_MS);
    }
    // Should have entered drafting or countdown (depends on rngState being valid).
    expect(result.state.phase === "drafting" || result.state.phase === "countdown").toBe(true);
  });
});
