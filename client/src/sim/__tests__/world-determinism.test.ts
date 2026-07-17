// Full-pipeline determinism: drive World.step for 10 sim seconds with scripted
// inputs and verify that two runs with the same (seed, inputs) produce the
// exact same player positions. Also verifies the seed is plumbed through
// World.create so a different seed yields a different WorldState.

import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerSpawnInfo,
  type WorldState,
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
    playerId: PlayerId("a"),
    characterId: "balanced",
    name: "Alpha",
    color: "#ff0000",
    weaponId: "starter-pistol",
  },
  {
    playerId: PlayerId("b"),
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
    seq: InputSeq(tick),
    tick: Tick(tick),
    keys,
    aimX: pid === PlayerId("a") ? 800 : 0,
    aimY: 400,
    dtMs: DT_MS,
  };
}

function runScripted(seed: number): WorldState {
  let state = World.create(oneFloorMap, players, seed);
  const runtime = createRuntime(oneFloorMap);
  for (let i = 0; i < TICKS; i += 1) {
    const inputs: Record<PlayerId, InputFrame | null> = {
      [PlayerId("a")]: buildInputs(PlayerId("a"), i, inputForA(i)),
      [PlayerId("b")]: buildInputs(PlayerId("b"), i, inputForB(i)),
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

    expect(stateA.tick).toBe(Tick(TICKS));
    expect(stateB.tick).toBe(Tick(TICKS));

    const a1 = stateA.players[PlayerId("a")]!;
    const a2 = stateB.players[PlayerId("a")]!;
    const b1 = stateA.players[PlayerId("b")]!;
    const b2 = stateB.players[PlayerId("b")]!;
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

// ── Launch pads (sim/launchPad.ts, World.ts §4a) ──────────────────────────
// Pads are STATIC map data stepped inside stepWithRuntime — the same
// function the client prediction loop (client/src/net/clientLoop.ts, which
// builds its runtime via createRuntime(resolveMap(mapId))) and the server
// authority (server/src/matchHost.ts) both run. Determinism of the pad path
// through the full pipeline therefore IS the prediction-parity guarantee.

const padMap: MapDefinition = {
  ...oneFloorMap,
  id: "test-arena-pads",
  // Directly in player A's run-right path along the floor (floor top 470,
  // standing center y = 442; pad top 458 overlaps the body's lower half).
  launchPads: [
    {
      id: "pad-0",
      position: { x: 520, y: 464 },
      size: { x: 96, y: 12 },
      impulse: { x: 300, y: -700 },
    },
  ],
};

function runAcrossPads(map: MapDefinition, ticks: number) {
  let state = World.create(map, players, 7);
  const runtime = createRuntime(map);
  const padEvents: Array<{ tick: number; entityId: number; playerId: string }> = [];
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ticks; i += 1) {
    const inputs: Record<PlayerId, InputFrame | null> = {
      // A holds right the whole time — repeatedly crossing the pad zone.
      [PlayerId("a")]: buildInputs(PlayerId("a"), i, Bit.Right),
      [PlayerId("b")]: buildInputs(PlayerId("b"), i, 0),
    };
    const result = stepWithRuntime(state, runtime, inputs, DT_MS);
    state = result.state;
    for (const ev of result.events) {
      if (ev.t === "launch-pad-fired") {
        padEvents.push({ tick: state.tick, entityId: ev.entityId, playerId: ev.playerId });
      }
    }
    minY = Math.min(minY, state.players[PlayerId("a")]!.y);
  }
  return { state, padEvents, minY };
}

describe("World determinism — launch pads", () => {
  test("pad-crossing run is byte-identical across two executions", () => {
    const r1 = runAcrossPads(padMap, 600);
    const r2 = runAcrossPads(padMap, 600);
    const a1 = r1.state.players[PlayerId("a")]!;
    const a2 = r2.state.players[PlayerId("a")]!;
    expect(a1.x).toBe(a2.x);
    expect(a1.y).toBe(a2.y);
    expect(a1.vx).toBe(a2.vx);
    expect(a1.vy).toBe(a2.vy);
    // Event stream identical too (tick, pad index, player).
    expect(r1.padEvents).toEqual(r2.padEvents);
    // And the pad actually fired for the runner.
    expect(r1.padEvents.length).toBeGreaterThan(0);
    expect(r1.padEvents[0]!.entityId).toBe(0);
    expect(r1.padEvents[0]!.playerId).toBe("a");
  });

  test("the pad genuinely changes the trajectory vs the pad-less map", () => {
    const withPads = runAcrossPads(padMap, 600);
    const without = runAcrossPads(oneFloorMap, 600);
    expect(without.padEvents.length).toBe(0);
    // Launched runner reaches far higher than the grounded runner ever does
    // (y-down coords: smaller = higher). Impulse vy −700 ⇒ apex ≈ 169px
    // above standing height; assert a conservative 80px.
    expect(withPads.minY).toBeLessThan(without.minY - 80);
  });

  test("no retrigger spam: fires are separated by real airtime, not per-tick", () => {
    const { padEvents } = runAcrossPads(padMap, 600);
    for (let i = 1; i < padEvents.length; i++) {
      expect(padEvents[i]!.tick - padEvents[i - 1]!.tick).toBeGreaterThan(5);
    }
  });
});
