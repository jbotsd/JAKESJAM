// Tests for LagCompensator — validates position-history recording,
// tick interpolation, rewind plan construction, and post-step unshift.

import { describe, test, expect, beforeEach } from "bun:test";
import { STEP_MS } from "@sim/index.ts";
import { LagCompensator, LAG_COMP_MAX_TICKS } from "../LagCompensator.ts";
import { InputSeq, PlayerId, Tick } from "@sim/types.ts";
import type { PlayerEntity, WorldState } from "@sim/types.ts";

const A = PlayerId("a");
const B = PlayerId("b");

function mkPlayer(id: PlayerId, x: number, y: number, overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y,
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

function mkState(tick: number, players: Record<PlayerId, PlayerEntity>): WorldState {
  return {
    tick: Tick(tick),
    players,
    projectiles: [],
    destructibles: [],
    pickups: [],
    firePatches: [],
    rngState: 0,
    chaosModifierIds: [],
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: { [A]: 0, [B]: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
    },
  } as unknown as WorldState;
}

// FIRE_BIT = 1 << 6 = 64
const FIRE_BIT = 64;

describe("LagCompensator.recordTick + history lookback", () => {
  test("returns null for a player with no history", () => {
    const comp = new LagCompensator();
    // We can't call getPlayerAtTick directly (it's private), but we can test
    // via buildRewindPlan returning null when no history exists.
    const state = mkState(10, { [A]: mkPlayer(A, 100, 200), [B]: mkPlayer(B, 300, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(5), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    // No history recorded yet — should return null even though A is firing with lookback.
    const plan = comp.buildRewindPlan(state, inputs);
    expect(plan).toBeNull();
  });

  test("records samples for all players each tick", () => {
    const comp = new LagCompensator();
    const state1 = mkState(1, { [A]: mkPlayer(A, 100, 200), [B]: mkPlayer(B, 300, 200) });
    comp.recordTick(state1);
    const state2 = mkState(2, { [A]: mkPlayer(A, 110, 200), [B]: mkPlayer(B, 310, 200) });
    comp.recordTick(state2);
    // Two ticks of history; buildRewindPlan should now produce a plan.
    const state3 = mkState(4, { [A]: mkPlayer(A, 130, 200), [B]: mkPlayer(B, 330, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(2), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    const plan = comp.buildRewindPlan(state3, inputs);
    // Lookback = 4 - 2 = 2 ticks; B should be shifted.
    expect(plan).not.toBeNull();
    expect(plan!.shooter).toBe(A);
    expect(plan!.lookbackTicks).toBe(2);
  });
});

describe("LagCompensator.buildRewindPlan", () => {
  let comp: LagCompensator;
  beforeEach(() => {
    comp = new LagCompensator();
    // Prime 20 ticks of history for both players.
    for (let t = 1; t <= 20; t += 1) {
      comp.recordTick(mkState(t, {
        [A]: mkPlayer(A, t * 10, 200),
        [B]: mkPlayer(B, 1000 - t * 10, 200),
      }));
    }
  });

  test("returns null when no player is firing", () => {
    const state = mkState(21, { [A]: mkPlayer(A, 210, 200), [B]: mkPlayer(B, 790, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(21), keys: 0, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    expect(comp.buildRewindPlan(state, inputs)).toBeNull();
  });

  test("returns null when lookback is zero (no latency)", () => {
    const state = mkState(21, { [A]: mkPlayer(A, 210, 200), [B]: mkPlayer(B, 790, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(21), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    expect(comp.buildRewindPlan(state, inputs)).toBeNull();
  });

  test("produces a plan for a firing player with lookback > 0", () => {
    const serverTick = 21;
    const clientTick = 16; // 5-tick lookback
    const state = mkState(serverTick, { [A]: mkPlayer(A, 210, 200), [B]: mkPlayer(B, 790, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(clientTick), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    const plan = comp.buildRewindPlan(state, inputs);
    expect(plan).not.toBeNull();
    expect(plan!.shooter).toBe(A);
    expect(plan!.lookbackTicks).toBe(5);
    // B's position in stateForStep should differ from the current 790.
    expect(plan!.stateForStep.players[B]!.x).not.toBe(790);
  });

  test("clamps lookback to LAG_COMP_MAX_TICKS for a very stale input", () => {
    const serverTick = 100;
    // Refill history so we have data near tick 100.
    for (let t = 21; t <= 100; t += 1) {
      comp.recordTick(mkState(t, {
        [A]: mkPlayer(A, t * 5, 200),
        [B]: mkPlayer(B, 5000 - t * 5, 200),
      }));
    }
    const state = mkState(serverTick, { [A]: mkPlayer(A, 500, 200), [B]: mkPlayer(B, 4500, 200) });
    // Client tick 1 — wildly stale.
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(1), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    const plan = comp.buildRewindPlan(state, inputs);
    expect(plan).not.toBeNull();
    expect(plan!.lookbackTicks).toBeLessThanOrEqual(LAG_COMP_MAX_TICKS);
  });

  test("shooter's own position is not shifted", () => {
    const serverTick = 21;
    const currentAx = 210;
    const state = mkState(serverTick, { [A]: mkPlayer(A, currentAx, 200), [B]: mkPlayer(B, 790, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(16), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    const plan = comp.buildRewindPlan(state, inputs);
    expect(plan).not.toBeNull();
    // A is the shooter — their position must not be rewound.
    expect(plan!.stateForStep.players[A]!.x).toBe(currentAx);
  });
});

describe("LagCompensator.unshiftAfterStep", () => {
  test("subtracts the shift vector from opponents after the step", () => {
    const comp = new LagCompensator();
    // Prime history.
    for (let t = 1; t <= 10; t += 1) {
      comp.recordTick(mkState(t, {
        [A]: mkPlayer(A, t * 10, 200),
        [B]: mkPlayer(B, 500 - t * 10, 200),
      }));
    }
    const serverTick = 11;
    const state = mkState(serverTick, { [A]: mkPlayer(A, 110, 200), [B]: mkPlayer(B, 390, 200) });
    const inputs = {
      [A]: { seq: InputSeq(1), tick: Tick(6), keys: FIRE_BIT, aimX: 0, aimY: 0, dtMs: STEP_MS },
    } as Parameters<LagCompensator["buildRewindPlan"]>[1];
    const plan = comp.buildRewindPlan(state, inputs);
    expect(plan).not.toBeNull();

    // Simulate the step producing a post-step state where B moved +20 from rewound.
    const rewoundBx = plan!.stateForStep.players[B]!.x;
    const postStepState: WorldState = {
      ...plan!.stateForStep,
      players: {
        [A]: { ...plan!.stateForStep.players[A]! },
        [B]: { ...plan!.stateForStep.players[B]!, x: rewoundBx + 20 },
      },
    } as unknown as WorldState;

    const unshifted = comp.unshiftAfterStep(postStepState, plan!);
    const shift = plan!.shifts.get(B)!;
    // Expected: (rewoundBx + 20) - shift.dx
    expect(unshifted.players[B]!.x).toBeCloseTo(rewoundBx + 20 - shift.dx, 5);
    // A is not in the shifts map, so their position should be unchanged.
    expect(unshifted.players[A]!.x).toBe(postStepState.players[A]!.x);
  });
});
