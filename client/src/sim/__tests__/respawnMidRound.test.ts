// Mid-round fast respawn (Jake ruled "A", 2026-07-17): a death in ordinary
// fighting re-forms the player at a spawn seal after RESPAWN_DELAY_MS;
// sudden death keeps last-one-standing (no respawn, last-alive resolves the
// round); ordinary rounds NO LONGER end on last-alive. Arena admission
// stays boundary-only — this file covers the fallen, venue tests cover
// joiners.

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

function mkState(players: PlayerEntity[], suddenDeath = false): WorldState {
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
      suddenDeathActive: suddenDeath,
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
 *  `extraTicks` more. Returns the final state + all events. */
function killAndRun(extraTicks: number, suddenDeath = false) {
  const attacker = mkPlayer(A, 400, 400);
  attacker.abilityCharge = EMISSION_CHARGE_MAX;
  const victim = mkPlayer(B, 480, 370);
  victim.health = 5;
  let state = mkState([attacker, victim], suddenDeath);
  const runtime = createRuntime(flatMap);
  let res = stepWithRuntime(
    state,
    runtime,
    inputsWith([attacker, victim], { [A as string]: press(1) }),
    DT_MS,
  );
  state = res.state;
  let deathTick: number | null = null;
  for (let t = 0; t < extraTicks; t++) {
    res = stepWithRuntime(state, runtime, inputsWith([attacker, victim], {}), DT_MS);
    state = res.state;
    if (deathTick === null && !state.players[B]!.alive) deathTick = state.tick;
  }
  return { state, deathTick };
}

describe("mid-round fast respawn", () => {
  test("a death in ordinary fighting re-forms after the delay, full health, timer cleared", () => {
    const { state, deathTick } = killAndRun(RESPAWN_TICKS + 30);
    expect(deathTick).not.toBeNull();
    const b = state.players[B]!;
    expect(b.alive).toBe(true);
    expect(b.health).toBe(100);
    expect(b.respawnAtTick).toBeUndefined();
    // Re-formed at a spawn seal, not where they fell.
    expect(flatMap.spawns.some((s) => Math.abs(s.x - b.x) < 200)).toBe(true);
  });

  test("the round does NOT end when one player remains alive (ordinary rounds run the clock)", () => {
    const { state } = killAndRun(20);
    expect(state.players[B]!.alive).toBe(false); // still mid-respawn window
    expect(state.round.phase).toBe("fighting"); // no last-alive early end
  });

  test("sudden death: no respawn, and last-alive resolves the round", () => {
    const { state, deathTick } = killAndRun(RESPAWN_TICKS + 60, true);
    expect(deathTick).not.toBeNull();
    expect(state.players[B]!.alive).toBe(false); // benched — the money moment
    // The kill resolved the round to A (round-over / drafting follow).
    expect(state.round.phase).not.toBe("fighting");
    expect(state.round.scores[A] ?? 0).toBeGreaterThanOrEqual(1);
  });
});
