// Round state machine: countdown → fighting → round-over → drafting →
// countdown loop, plus the score-to-target match-complete signal. Pure
// inputs, deterministic.

import { describe, test, expect } from "bun:test";
import { STEP_MS } from "../constants.js";
import {
  stepRound,
  COUNTDOWN_MS,
  ROUND_TIME_LIMIT_MS,
  ROUND_OVER_HOLD_MS,
  DRAFT_OFFER_COUNT,
  DRAFT_WINDOW_MS,
} from "../round.js";
import { InputSeq, PlayerId, Tick, type PlayerEntity, type RoundState, type SimEvent } from "../types.js";

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

function freshRound(playerIdsRaw: string[]): RoundState {
  const playerIds = playerIdsRaw.map(PlayerId);
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
    const players = { [A]:mkPlayer("a"), [B]:mkPlayer("b") };
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
      scores: { [A]:0, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: null,
    };
    const result = stepRound({ state, players, dtMs: 16, targetScore: 3 });
    expect(result.state.phase).toBe("round-over");
    expect(result.state.winnerPlayerId).toBe(A);
    expect(result.state.scores[A]).toBe(1);
    expect(result.state.scores[B]).toBe(0);
    const endEvent = result.events.find((e): e is Extract<SimEvent, { t: "round-end" }> =>
      e.t === "round-end",
    );
    expect(endEvent).toBeDefined();
    expect(endEvent!.winnerId).toBe(A);
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
      scores: { [A]:0, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: null,
    };
    const result = stepRound({ state, players, dtMs: 16, targetScore: 3 });
    expect(result.state.phase).toBe("round-over");
    expect(result.state.winnerPlayerId).toBeNull();
    expect(result.state.scores[A]).toBe(0);
    expect(result.state.scores[B]).toBe(0);
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
      scores: { [A]:0, [B]:0 },
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
    expect(tieResult.state.winnerPlayerId).toBe(A);
    expect(tieResult.state.scores[A]).toBe(1);

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
    expect(healthResult.state.winnerPlayerId).toBe(B);
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
      scores: { [A]:2, [B]:0 },
      roundIndex: 2,
      winnerPlayerId: null,
    };
    const result = stepRound({ state, players, dtMs: 16, targetScore: 3 });
    expect(result.state.scores[A]).toBe(3);
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
      scores: { [A]:1, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: A,
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

  // ---- Drafting phase --------------------------------------------------
  // Threading `tick` + `rngState` into stepRound flips the round-over
  // exit from "→ countdown directly" to "→ drafting → countdown". The
  // drafting phase rolls 3 cards per alive player, holds for 8 seconds
  // unless everyone picks early, and auto-picks the leftmost offer for
  // anyone who didn't commit before the window expired.

  test("round-over → drafting rolls DRAFT_OFFER_COUNT offers per alive player", () => {
    const players = {
      a: mkPlayer("a", { alive: true }),
      b: mkPlayer("b", { alive: true }),
    };
    const state: RoundState = {
      phase: "round-over",
      countdownRemainingMs: 0, // hold timer already drained
      scores: { [A]:1, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: A,
    };
    const result = stepRound({
      state,
      players,
      dtMs: 32,
      targetScore: 3,
      tick: Tick(100),
      rngState: 0xdead_beef,
    });
    expect(result.state.phase).toBe("drafting");
    expect(result.state.draftingOffers).toBeDefined();
    expect(Object.keys(result.state.draftingOffers!).sort()).toEqual(["a", "b"]);
    expect(result.state.draftingOffers![A]!.length).toBe(DRAFT_OFFER_COUNT);
    expect(result.state.draftingOffers![B]!.length).toBe(DRAFT_OFFER_COUNT);
    expect(result.state.draftingPicked).toEqual({});
    // Expiry tick is window converted to ticks at the fixed STEP_MS rate.
    const expectedExpiry = Tick(100 + Math.ceil(DRAFT_WINDOW_MS / STEP_MS));
    expect(result.state.draftingExpiresAtTick).toBe(expectedExpiry);
    // Two card-offered events, one per alive player. Round-end is NOT
    // re-emitted at this boundary (already fired on fighting → round-over).
    const offerEvents = result.events.filter(
      (e): e is Extract<SimEvent, { t: "card-offered" }> => e.t === "card-offered",
    );
    expect(offerEvents).toHaveLength(2);
    const offered = new Map(offerEvents.map((e) => [e.playerId, e.cardIds]));
    expect(offered.get(A)).toEqual(result.state.draftingOffers![A]!);
    expect(offered.get(B)).toEqual(result.state.draftingOffers![B]!);
    // RNG cursor advanced because we drew offers.
    expect(result.rngState).toBeDefined();
    expect(result.rngState).not.toBe(0xdead_beef);
  });

  test("drafting offer rolls are deterministic for the same (rngState, players)", () => {
    const players = {
      a: mkPlayer("a", { alive: true }),
      b: mkPlayer("b", { alive: true }),
    };
    const state: RoundState = {
      phase: "round-over",
      countdownRemainingMs: 0,
      scores: { [A]:1, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: A,
    };
    const r1 = stepRound({ state, players, dtMs: 32, targetScore: 3, tick: Tick(50), rngState: 12345 });
    const r2 = stepRound({ state, players, dtMs: 32, targetScore: 3, tick: Tick(50), rngState: 12345 });
    expect(r1.state.draftingOffers).toEqual(r2.state.draftingOffers);
    expect(r1.rngState).toBe(r2.rngState);
  });

  test("drafting → countdown when all alive players have picked", () => {
    // Pre-set drafting state with both players having committed.
    const players = {
      a: mkPlayer("a", { alive: true }),
      b: mkPlayer("b", { alive: true }),
    };
    const startTick = 100;
    const state: RoundState = {
      phase: "drafting",
      countdownRemainingMs: DRAFT_WINDOW_MS,
      scores: { [A]:1, [B]:0 },
      roundIndex: 2,
      winnerPlayerId: A,
      draftingExpiresAtTick: Tick(startTick + Math.ceil(DRAFT_WINDOW_MS / STEP_MS)),
      draftingPicked: { [A]:"crystal-volley", [B]:"circle-rounds" },
      draftingOffers: {
        [A]: ["crystal-volley", "circle-rounds", "raycast-prism"],
        [B]: ["circle-rounds", "raycast-prism", "crystal-volley"],
      },
    };
    const result = stepRound({
      state,
      players,
      dtMs: 16,
      targetScore: 3,
      tick: Tick(startTick + 1), // well before expiry
      rngState: 99,
    });
    expect(result.state.phase).toBe("countdown");
    expect(result.state.countdownRemainingMs).toBe(COUNTDOWN_MS);
    expect(result.state.roundIndex).toBe(3);
    expect(result.state.winnerPlayerId).toBeNull();
    // Drafting bookkeeping is wiped on countdown entry.
    expect(result.state.draftingExpiresAtTick).toBeUndefined();
    expect(result.state.draftingPicked).toBeUndefined();
    expect(result.state.draftingOffers).toBeUndefined();
    // Two draft-resolved events, neither auto-picked.
    const resolved = result.events.filter(
      (e): e is Extract<SimEvent, { t: "draft-resolved" }> => e.t === "draft-resolved",
    );
    expect(resolved).toHaveLength(2);
    expect(resolved.every((e) => !e.autoPicked)).toBe(true);
    expect(resolved.find((e) => e.playerId === "a")?.cardId).toBe("crystal-volley");
    expect(resolved.find((e) => e.playerId === "b")?.cardId).toBe("circle-rounds");
  });

  test("drafting holds past the legacy expiry window — no auto-pick, no respawn until everyone commits", () => {
    const players = {
      a: mkPlayer("a", { alive: true, cards: [] }),
      b: mkPlayer("b", { alive: true, cards: ["raycast-prism"] }),
    };
    const expiresAt = 200;
    const state: RoundState = {
      phase: "drafting",
      countdownRemainingMs: 0,
      scores: { [A]:1, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: A,
      draftingExpiresAtTick: Tick(expiresAt),
      draftingPicked: { [A]:"circle-rounds" },
      draftingOffers: {
        [A]: ["circle-rounds", "raycast-prism", "crystal-volley"],
        [B]: ["crystal-volley", "raycast-prism", "circle-rounds"],
      },
    };
    const result = stepRound({
      state,
      players,
      dtMs: 16,
      targetScore: 3,
      tick: Tick(expiresAt + 1000), // well past the old expiry
      rngState: 7,
    });
    // Stays in drafting because 'b' hasn't committed.
    expect(result.state.phase).toBe("drafting");
    expect(result.playerPatches).toBeUndefined();
    const resolved = result.events.filter(
      (e): e is Extract<SimEvent, { t: "draft-resolved" }> => e.t === "draft-resolved",
    );
    // 'a' may still re-fire if its draft-resolved hasn't been marked yet,
    // but no auto-pick event for 'b' regardless.
    expect(resolved.find((e) => e.playerId === "b")).toBeUndefined();
  });

  test("drafting holds while no one has picked and the window has not expired", () => {
    const players = {
      a: mkPlayer("a", { alive: true }),
      b: mkPlayer("b", { alive: true }),
    };
    const startTick = 50;
    const state: RoundState = {
      phase: "drafting",
      countdownRemainingMs: DRAFT_WINDOW_MS,
      scores: { [A]:1, [B]:0 },
      roundIndex: 0,
      winnerPlayerId: A,
      draftingExpiresAtTick: Tick(startTick + Math.ceil(DRAFT_WINDOW_MS / STEP_MS)),
      draftingPicked: {},
      draftingOffers: {
        [A]: ["crystal-volley", "circle-rounds", "raycast-prism"],
        [B]: ["circle-rounds", "crystal-volley", "raycast-prism"],
      },
    };
    const result = stepRound({
      state,
      players,
      dtMs: 16,
      targetScore: 3,
      tick: Tick(startTick + 1),
      rngState: 1,
    });
    expect(result.state.phase).toBe("drafting");
    // Still holding — no draft-resolved events, offers preserved.
    const resolved = result.events.filter((e) => e.t === "draft-resolved");
    expect(resolved).toHaveLength(0);
    expect(result.state.draftingOffers).toEqual(state.draftingOffers);
  });
});
