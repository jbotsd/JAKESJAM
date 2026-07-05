// ClientLoop must predict with a persistent WorldRuntime — World.step() is a
// test helper that allocates fresh movement memory every tick, which breaks
// jump/coyote/edge-detect identically to the live hosted bug.

import { describe, test, expect } from "bun:test";
import { InputBit } from "../protocol.js";
import { World, createRuntime, stepWithRuntime } from "../../sim/World.js";
import { PlayerId, InputSeq, Tick, type InputFrame } from "../../sim/types.js";
import type { MapDefinition, PlayerSpawnInfo } from "../../sim/types.js";

const DT_MS = 1000 / 60;

const floorMap: MapDefinition = {
  id: "test-floor",
  name: "test",
  size: { x: 800, y: 600 },
  spawns: [{ x: 100, y: 400 }],
  platforms: [
    {
      id: "floor",
      kind: "floor",
      position: { x: 400, y: 500 },
      size: { x: 800, y: 40 },
    },
  ],
};

function jumpFrame(tick: number, keys: number): InputFrame {
  return {
    seq: InputSeq(tick),
    tick: Tick(tick),
    keys: keys as InputFrame["keys"],
    aimX: 100,
    aimY: 400,
    dtMs: DT_MS,
  };
}

describe("prediction runtime persistence", () => {
  test("persistent runtime registers a ground jump; World.step does not", () => {
    const pid = PlayerId("p1");
    const spawn: PlayerSpawnInfo = {
      playerId: pid,
      characterId: "balanced",
      name: "p1",
      color: "#ffffff",
      weaponId: "starter-pistol",
    };
    let state = World.create(floorMap, [spawn], 42, []);
    // Skip countdown → fighting.
    for (let i = 0; i < 200; i++) {
      state = World.step(state, { [pid]: null }, DT_MS).state;
      if (state.round.phase === "fighting") break;
    }
    expect(state.round.phase).toBe("fighting");

    // Stand on floor for a few ticks (no input).
    const persistentRuntime = createRuntime(floorMap);

    let persistentY = state.players[pid]!.y;
    let ephemeralY = state.players[pid]!.y;
    let persistentState = state;
    let ephemeralState = state;

    // Idle settle — grounded memory must latch.
    for (let t = 0; t < 30; t++) {
      const inputs = { [pid]: jumpFrame(t, 0) } as Record<typeof pid, InputFrame>;
      persistentState = stepWithRuntime(
        persistentState,
        persistentRuntime,
        inputs,
        DT_MS,
      ).state;
      ephemeralState = World.step(ephemeralState, inputs, DT_MS).state;
    }

    // Jump press + hold for several ticks.
    const jumpKeys = InputBit.Jump;
    for (let t = 30; t < 45; t++) {
      const inputs = { [pid]: jumpFrame(t, jumpKeys) } as Record<typeof pid, InputFrame>;
      persistentState = stepWithRuntime(
        persistentState,
        persistentRuntime,
        inputs,
        DT_MS,
      ).state;
      ephemeralState = World.step(ephemeralState, inputs, DT_MS).state;
      persistentY = persistentState.players[pid]!.y;
      ephemeralY = ephemeralState.players[pid]!.y;
    }

    const persistentJumped = persistentY < state.players[pid]!.y - 8;
    const ephemeralJumped = ephemeralY < state.players[pid]!.y - 8;
    expect(persistentJumped).toBe(true);
    expect(ephemeralJumped).toBe(false);
  });
});