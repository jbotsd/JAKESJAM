// Full-pipeline determinism: drive World.step for 10 sim seconds with scripted
// inputs and verify that two runs with the same (seed, inputs) produce the
// exact same player positions. Also verifies the seed is plumbed through
// World.create so a different seed yields a different WorldState.

import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import type {
  InputBitfield,
  InputFrame,
  MapDefinition,
  PlayerId,
  PlayerSpawnInfo,
  WorldState,
} from "../types.js";

const Bit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Down: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
} as const;

const TICKS = 600;
const DT_MS = 1000 / 60;

const oneFloorMap: MapDefinition = {
  id: "test-arena",
  name: "Test Arena",
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

const players: PlayerSpawnInfo[] = [
  {
    playerId: "a",
    characterId: "balanced",
    name: "Alpha",
    color: "#ff0000",
    weaponId: "starter-pistol",
  },
  {
    playerId: "b",
    characterId: "balanced",
    name: "Bravo",
    color: "#00ff00",
    weaponId: "starter-pistol",
  },
];

/** Deterministic input scripts. No fire (avoids spawning projectiles whose ids
 * are allocated from a runtime counter — those stay deterministic too, but
 * positions alone are enough to demonstrate determinism). */
function inputForA(tick: number): InputBitfield {
  // Move right for first 200 fighting ticks, then jump, then idle.
  if (tick < 200) return Bit.Right;
  if (tick < 220) return Bit.Right | Bit.Jump;
  return 0;
}
function inputForB(tick: number): InputBitfield {
  // Move left for first 200 fighting ticks, then crouch.
  if (tick < 200) return Bit.Left;
  if (tick < 400) return Bit.Crouch | Bit.Down;
  return 0;
}

function buildInputs(
  pid: PlayerId,
  tick: number,
  keys: InputBitfield,
): InputFrame {
  return {
    seq: tick,
    tick,
    keys,
    aimX: pid === "a" ? 800 : 0,
    aimY: 400,
    dtMs: DT_MS,
  };
}

function runScripted(seed: number): WorldState {
  let state = World.create(oneFloorMap, players, seed);
  const runtime = createRuntime(oneFloorMap);
  for (let i = 0; i < TICKS; i += 1) {
    const inputs: Record<PlayerId, InputFrame | null> = {
      a: buildInputs("a", i, inputForA(i)),
      b: buildInputs("b", i, inputForB(i)),
    };
    const result = stepWithRuntime(state, runtime, inputs, DT_MS);
    state = result.state;
  }
  return state;
}

describe("World determinism", () => {
  test("same seed + same inputs → identical player positions after 600 ticks", () => {
    const stateA = runScripted(42);
    const stateB = runScripted(42);

    expect(stateA.tick).toBe(TICKS);
    expect(stateB.tick).toBe(TICKS);

    const a1 = stateA.players.a!;
    const a2 = stateB.players.a!;
    const b1 = stateA.players.b!;
    const b2 = stateB.players.b!;
    expect(a1.x).toBe(a2.x);
    expect(a1.y).toBe(a2.y);
    expect(b1.x).toBe(b2.x);
    expect(b1.y).toBe(b2.y);
    expect(a1.vx).toBe(a2.vx);
    expect(b1.vy).toBe(b2.vy);
    expect(stateA.round.phase).toBe(stateB.round.phase);
  });

  test("different seed → WorldState reflects the seed (rng plumbing works)", () => {
    // NOTE: at the time of writing, no sim/ code path actually consumes
    // `state.rngState` during World.step (movement is purely deterministic,
    // weapon spread is index-based, and projectile.ts has no rng calls). The
    // seed is, however, plumbed into WorldState.rngState on World.create. This
    // test verifies that plumbing — when rng-driven systems land (crit rolls,
    // spread cones, drop tables), they will diverge here automatically.
    const stateA = runScripted(1);
    const stateC = runScripted(999);
    expect(stateA.rngState).not.toBe(stateC.rngState);
  });
});
