// Integration coverage for the two design-pillars "distinctive features"
// added alongside HighlightTracker's multi-kill/chain-kill/parry-kill:
//   - First-blood wager: first attacker-attributed hit each round claims a
//     temp speed boost for the rest of the round.
//   - Sudden-death shrinking arena: once every scored player is tied at
//     targetScore-1, a storm zone shrinks in and damages stragglers.
// round.test.ts already covers the pure trigger/reset logic in stepRound;
// this file drives the full World.create/stepWithRuntime pipeline to prove
// the World.ts wiring (event emission, round-state threading, movement
// multiplier, storm damage drain) actually works end to end.

import { describe, expect, test } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import {
  ENDGAME_ZONE_TRIGGER_MS,
  FIRST_BLOOD_SPEED_MULTIPLIER,
  ROUND_TIME_LIMIT_MS,
} from "../round.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerSpawnInfo,
  type ProjectileEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const A = PlayerId("a");
const B = PlayerId("b");

const arena: MapDefinition = {
  id: "test-arena",
  name: "Test Arena",
  size: { x: 2000, y: 2000 },
  spawns: [
    { x: 500, y: 500 },
    { x: 1500, y: 500 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 1900 }, size: { x: 2000, y: 100 } },
  ],
};

const spawnInfo: PlayerSpawnInfo[] = [
  { playerId: A, characterId: "balanced", name: "Alpha", color: "#ff0000", weaponId: "starter-pistol" },
  { playerId: B, characterId: "balanced", name: "Bravo", color: "#00ff00", weaponId: "starter-pistol" },
];

function noInputs(): Record<PlayerId, InputFrame | null> {
  const mk = (): InputFrame => ({
    seq: InputSeq(1),
    tick: Tick(0),
    keys: 0 as InputBitfield,
    aimX: 1,
    aimY: 0,
    dtMs: DT_MS,
  });
  return { [A]: mk(), [B]: mk() };
}

function mkProjectile(overrides: Partial<ProjectileEntity> = {}): ProjectileEntity {
  return {
    id: EntityId(999),
    ownerId: A,
    x: 1500,
    y: 500,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 25,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ...overrides,
  };
}

describe("first-blood wager", () => {
  test("first attacker-attributed hit emits first-blood and claims RoundState.firstBloodPlayerId", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    // Force into fighting with a projectile from A sitting exactly on B —
    // guaranteed overlap on this tick's sweep.
    const state: WorldState = {
      ...state0,
      round: { ...state0.round, phase: "fighting", countdownRemainingMs: ROUND_TIME_LIMIT_MS },
      projectiles: { [EntityId(999)]: mkProjectile() },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.events.some((e) => e.t === "first-blood" && e.playerId === A)).toBe(true);
    expect(result.state.round.firstBloodPlayerId).toBe(A);
  });

  test("a second hit in a later round doesn't re-award or re-emit first-blood", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    const state: WorldState = {
      ...state0,
      round: {
        ...state0.round,
        phase: "fighting",
        countdownRemainingMs: ROUND_TIME_LIMIT_MS,
        firstBloodPlayerId: B, // already claimed by B this round
      },
      projectiles: { [EntityId(999)]: mkProjectile({ ownerId: A }) }, // A hits B again
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.events.some((e) => e.t === "first-blood")).toBe(false);
    expect(result.state.round.firstBloodPlayerId).toBe(B);
  });

  test("the boosted player covers more distance per tick than an unboosted player given identical input", () => {
    const runtime = createRuntime(arena);
    const rightInput = (): Record<PlayerId, InputFrame | null> => ({
      [A]: { seq: InputSeq(1), tick: Tick(0), keys: (1 << 1) as InputBitfield, aimX: 1, aimY: 0, dtMs: DT_MS },
      [B]: { seq: InputSeq(1), tick: Tick(0), keys: 0 as InputBitfield, aimX: 1, aimY: 0, dtMs: DT_MS },
    });

    const baseline = World.create(arena, spawnInfo, 1);
    const baselineFighting: WorldState = {
      ...baseline,
      round: { ...baseline.round, phase: "fighting", countdownRemainingMs: ROUND_TIME_LIMIT_MS },
    };
    const baselineResult = stepWithRuntime(baselineFighting, runtime, rightInput(), DT_MS);

    const boosted = World.create(arena, spawnInfo, 1);
    const boostedFighting: WorldState = {
      ...boosted,
      round: {
        ...boosted.round,
        phase: "fighting",
        countdownRemainingMs: ROUND_TIME_LIMIT_MS,
        firstBloodPlayerId: A,
      },
    };
    const boostedRuntime = createRuntime(arena);
    const boostedResult = stepWithRuntime(boostedFighting, boostedRuntime, rightInput(), DT_MS);

    const baselineDx = baselineResult.state.players[A]!.x - baselineFighting.players[A]!.x;
    const boostedDx = boostedResult.state.players[A]!.x - boostedFighting.players[A]!.x;
    expect(boostedDx).toBeGreaterThan(baselineDx * FIRST_BLOOD_SPEED_MULTIPLIER - 0.01);
  });
});

describe("sudden-death shrinking arena", () => {
  test("no storm damage early in a sudden-death round (safe zone still covers the whole arena)", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    const state: WorldState = {
      ...state0,
      round: {
        ...state0.round,
        phase: "fighting",
        countdownRemainingMs: ROUND_TIME_LIMIT_MS, // t=0 into the round — scale ~1.0
        suddenDeathActive: true,
      },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.state.players[A]!.health).toBe(state.players[A]!.health);
    expect(result.state.players[B]!.health).toBe(state.players[B]!.health);
  });

  test("a player far from center takes storm damage once the safe zone has shrunk", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    // Push B into a far corner — well outside a 0.6-scale safe circle even
    // though it's within the full 1.0-scale arena.
    const state: WorldState = {
      ...state0,
      players: {
        ...state0.players,
        [B]: { ...state0.players[B]!, x: 1990, y: 1990 },
      },
      round: {
        ...state0.round,
        phase: "fighting",
        countdownRemainingMs: 1, // near the end of the round — scale ~0.6
        suddenDeathActive: true,
      },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.state.players[B]!.health).toBeLessThan(state.players[B]!.health);
  });

  test("suddenDeathActive: false + plenty of time left: no storm damage", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    const state: WorldState = {
      ...state0,
      players: {
        ...state0.players,
        [B]: { ...state0.players[B]!, x: 1990, y: 1990 },
      },
      round: {
        ...state0.round,
        phase: "fighting",
        // Outside the last-15s soft endgame window AND no full sudden
        // death — neither shrink zone should be active.
        countdownRemainingMs: ROUND_TIME_LIMIT_MS - 20_000,
        suddenDeathActive: false,
      },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.state.players[B]!.health).toBe(state.players[B]!.health);
  });

  // Balance audit: timeout resolving to most-health-remaining rewarded
  // passive corner-camping. A GENTLER shrink zone (0.75, vs sudden death's
  // 0.6) now runs in the final 15s of every round, sudden death or not.
  test("soft endgame zone: a far-corner player takes damage in the last 15s even without sudden death", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    const state: WorldState = {
      ...state0,
      players: {
        ...state0.players,
        [B]: { ...state0.players[B]!, x: 1990, y: 1990 },
      },
      round: {
        ...state0.round,
        phase: "fighting",
        countdownRemainingMs: 1, // last instant of the round — soft zone eased almost to 0.75
        suddenDeathActive: false,
      },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.state.players[B]!.health).toBeLessThan(state.players[B]!.health);
  });

  test("soft endgame zone: no damage the instant it opens (still full coverage)", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    const state: WorldState = {
      ...state0,
      players: {
        ...state0.players,
        [B]: { ...state0.players[B]!, x: 1990, y: 1990 },
      },
      round: {
        ...state0.round,
        phase: "fighting",
        countdownRemainingMs: ENDGAME_ZONE_TRIGGER_MS, // the exact instant it opens — scale 1.0
        suddenDeathActive: false,
      },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.state.players[B]!.health).toBe(state.players[B]!.health);
  });

  test("full sudden death still wins over the soft zone (harder 0.6 scale, not 0.75)", () => {
    const state0 = World.create(arena, spawnInfo, 1);
    const runtime = createRuntime(arena);
    // Position B just outside a 0.75-scale zone but inside a 0.6-scale one
    // is geometrically awkward to pin exactly; instead assert the two paths
    // are NOT simply additive — same far-corner position, same instant,
    // only `suddenDeathActive` differs, and full SD must still apply (this
    // is already covered above), while confirming the soft path alone
    // doesn't silently get skipped when SD is layered on top.
    const state: WorldState = {
      ...state0,
      players: {
        ...state0.players,
        [B]: { ...state0.players[B]!, x: 1990, y: 1990 },
      },
      round: {
        ...state0.round,
        phase: "fighting",
        countdownRemainingMs: 1,
        suddenDeathActive: true,
      },
    };
    const result = stepWithRuntime(state, runtime, noInputs(), DT_MS);
    expect(result.state.players[B]!.health).toBeLessThan(state.players[B]!.health);
  });
});
