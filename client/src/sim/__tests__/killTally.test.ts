// Per-round kill tally (fast-respawn follow-up 2026-07-17) — full-pipeline
// coverage through stepWithRuntime: qualifying player-killed events fold
// into `state.round.roundKills` BEFORE the round machine steps, so the
// time-out resolution rewards the round's kills instead of the freshest
// health bar. Regression context: Jake went 0-for-7 rounds while landing
// kills, because ordinary rounds (which no longer resolve on last-alive)
// timed out to "most health among alive" — i.e. to whoever respawned last.
//
// Kill = player-killed with non-null killerId !== victimId. Void-plane
// deaths (and storm/unattributed burn) credit nobody.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { EMISSION_CHARGE_MAX, RESPAWN_DELAY_MS } from "../constants.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type SimEvent,
  type WorldState,
} from "../types.js";

const A = PlayerId("a");
const B = PlayerId("b");

const DT_MS = 1000 / 60;
const ABILITY_BIT = 1 << 7;
const RESPAWN_TICKS = Math.ceil(RESPAWN_DELAY_MS / DT_MS);

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    {
      id: "floor",
      kind: "floor",
      position: { x: 0, y: 500 },
      size: { x: 1280, y: 60 },
    },
  ],
};

function mkPlayer(id: PlayerId, x: number, y: number): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: y,
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
  };
}

function mkState(players: PlayerEntity[]): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  return {
    tick: Tick(0),
    rngState: 1234567 >>> 0,
    players: playerMap,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0,
      winnerPlayerId: null,
      suddenDeathActive: false,
    },
  };
}

function inputsWith(
  players: PlayerEntity[],
  overrides: Partial<Record<string, InputFrame>>,
): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = overrides[p.id as string] ?? null;
  return out;
}

const press = (seq: number): InputFrame => ({
  seq: InputSeq(seq),
  tick: Tick(0),
  keys: ABILITY_BIT,
  aimX: 0,
  aimY: 0,
  dtMs: DT_MS,
});

/** Kill B with A's full-charge Emission (B at 5hp, adjacent), then run
 *  `extraTicks` more. Same rig as respawnMidRound.test.ts. Collects the
 *  full event stream for attribution + determinism assertions. */
function killAndRun(extraTicks: number) {
  const attacker = mkPlayer(A, 400, 400);
  attacker.abilityCharge = EMISSION_CHARGE_MAX;
  const victim = mkPlayer(B, 480, 370);
  victim.health = 5;
  let state = mkState([attacker, victim]);
  const runtime = createRuntime(flatMap);
  const allEvents: SimEvent[] = [];
  let res = stepWithRuntime(
    state,
    runtime,
    inputsWith([attacker, victim], { [A as string]: press(1) }),
    DT_MS,
  );
  allEvents.push(...res.events);
  state = res.state;
  for (let t = 0; t < extraTicks; t++) {
    res = stepWithRuntime(state, runtime, inputsWith([attacker, victim], {}), DT_MS);
    allEvents.push(...res.events);
    state = res.state;
  }
  return { state, allEvents };
}

describe("per-round kill tally through stepWithRuntime", () => {
  test("a projectile kill increments the killer's tally the same tick", () => {
    const { state, allEvents } = killAndRun(20);
    const kill = allEvents.find(
      (e): e is Extract<SimEvent, { t: "player-killed" }> =>
        e.t === "player-killed",
    );
    expect(kill).toBeDefined();
    expect(kill!.victimId).toBe(B);
    expect(kill!.killerId).toBe(A);
    expect(state.round.roundKills).toEqual({ [A]: 1 });
  });

  test("timeout resolves to the killer even at lower health than the fresh respawn", () => {
    // Run past B's respawn: B is back at 100hp; A holds the round's only
    // kill. Wear A down to 40hp, then let the clock hit zero.
    const { state } = killAndRun(RESPAWN_TICKS + 30);
    expect(state.players[B]!.alive).toBe(true);
    expect(state.players[B]!.health).toBe(100);
    expect(state.round.roundKills).toEqual({ [A]: 1 });
    const atBuzzer: WorldState = {
      ...state,
      players: {
        ...state.players,
        [A]: { ...state.players[A]!, health: 40 },
      },
      round: { ...state.round, countdownRemainingMs: 1 },
    };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      atBuzzer,
      runtime,
      { [A]: null, [B]: null },
      DT_MS,
    );
    expect(res.state.round.phase).toBe("round-over");
    // THE bug this work fixes: pre-tally, B's fresh 100hp beat A here.
    expect(res.state.round.winnerPlayerId).toBe(A);
    expect(res.state.round.scores[A]).toBe(1);
    const end = res.events.find(
      (e): e is Extract<SimEvent, { t: "round-end" }> => e.t === "round-end",
    );
    expect(end?.winnerId).toBe(A);
  });

  test("a void-plane death credits nobody (tally unchanged)", () => {
    const a = mkPlayer(A, 400, 400);
    const b = mkPlayer(B, 600, 400);
    let state = mkState([a, b]);
    // Drop B past the kill plane (map.size.y + margin).
    state = {
      ...state,
      players: { ...state.players, [B]: { ...b, y: 2000 } },
    };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, { [A]: null, [B]: null }, DT_MS);
    const kill = res.events.find(
      (e): e is Extract<SimEvent, { t: "player-killed" }> =>
        e.t === "player-killed",
    );
    expect(kill).toBeDefined();
    expect(kill!.cause).toBe("void");
    expect(kill!.killerId).toBeNull();
    expect(res.state.players[B]!.alive).toBe(false);
    expect(res.state.round.roundKills).toBeUndefined();
  });

  test("determinism: two identical kill-then-timeout runs are byte-identical", () => {
    const run = () => {
      const { state, allEvents } = killAndRun(RESPAWN_TICKS + 30);
      return { state, allEvents };
    };
    const r1 = run();
    const r2 = run();
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(JSON.stringify(r1.allEvents)).toBe(JSON.stringify(r2.allEvents));
  });
});
