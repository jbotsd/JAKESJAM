// ReplayRecorder regression tests.
//
// Two contracts under test:
//   1. The recorder captures inputs in stable order with the right header.
//   2. `playReplay` round-trips: given the recorded inputs + initial state,
//      re-running the sim through the same step function yields the same
//      final state. This is the determinism guarantee per replay-spectator
//      SKILL.md ("input-replay, not snapshot-replay").

import { describe, test, expect } from "bun:test";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime } from "@sim/World.ts";
import { resolveMap } from "@sim/data/maps.ts";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type PlayerSpawnInfo,
} from "@sim/types.ts";
import {
  ReplayRecorder,
  REPLAY_FORMAT_VERSION,
  playReplay,
  type ReplayHeader,
} from "../ReplayRecorder.ts";
import { PROTOCOL_VERSION } from "../protocol.ts";

const A = PlayerId("alice");
const B = PlayerId("bob");

const SPAWNS: PlayerSpawnInfo[] = [
  {
    playerId: A,
    characterId: "balanced",
    name: "Alice",
    color: "#88ccff",
    weaponId: "starter-pistol",
  },
  {
    playerId: B,
    characterId: "balanced",
    name: "Bob",
    color: "#ff88aa",
    weaponId: "starter-pistol",
  },
];

function mkInput(seq: number, tick: number, keys = 0, aimX = 0, aimY = 0): InputFrame {
  return {
    seq: InputSeq(seq),
    tick: Tick(tick),
    keys,
    aimX,
    aimY,
    dtMs: STEP_MS,
  };
}

describe("ReplayRecorder", () => {
  test("header carries protocol + format version + lobby snapshot", () => {
    const rec = new ReplayRecorder({
      matchId: "m1",
      mapId: "boxworks",
      rngSeed: 0xdeadbeef,
      players: SPAWNS,
      chaosModifierIds: ["low-gravity"],
      startedAtMs: 1_700_000_000_000,
    });
    const snap = rec.snapshot();
    expect(snap.header.formatVersion).toBe(REPLAY_FORMAT_VERSION);
    expect(snap.header.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(snap.header.matchId).toBe("m1");
    expect(snap.header.mapId).toBe("boxworks");
    expect(snap.header.rngSeed).toBe(0xdeadbeef);
    expect(snap.header.players.length).toBe(2);
    expect(snap.header.players[0]!.playerId).toBe(A);
    expect(snap.header.chaosModifierIds).toEqual(["low-gravity"]);
  });

  test("records inputs in append order; size + hasContent reflect state", () => {
    const rec = new ReplayRecorder({
      matchId: "m1",
      mapId: "boxworks",
      rngSeed: 1,
      players: SPAWNS,
    });
    expect(rec.hasContent()).toBe(false);
    rec.record(Tick(1), A, mkInput(1, 1));
    rec.record(Tick(2), A, mkInput(2, 2));
    rec.record(Tick(2), B, mkInput(1, 2));
    expect(rec.size()).toBe(3);
    expect(rec.hasContent()).toBe(true);
    const snap = rec.snapshot();
    expect(snap.inputs.length).toBe(3);
    expect(snap.inputs[0]!.atTick).toBe(1);
    expect(snap.inputs[2]!.playerId).toBe(B);
  });

  test("serialize() msgpack-decodes back to header + inputs and finalises", () => {
    const rec = new ReplayRecorder({
      matchId: "m1",
      mapId: "boxworks",
      rngSeed: 7,
      players: SPAWNS,
    });
    rec.record(Tick(5), A, mkInput(1, 5));
    rec.record(Tick(10), B, mkInput(1, 10));
    const blob = rec.serialize();
    const decoded = msgpackDecode(blob) as {
      header: ReplayHeader;
      inputs: Array<{ atTick: number; playerId: string }>;
    };
    expect(decoded.header.totalTicks).toBe(10);
    expect(decoded.inputs.length).toBe(2);
    // Post-finalize: subsequent record() calls are silently dropped.
    rec.record(Tick(20), A, mkInput(2, 20));
    expect(rec.size()).toBe(2);
  });

  test(
    "playReplay deterministically reproduces a live run's final state",
    () => {
      const map = resolveMap("boxworks");
      const seed = 12345;
      const initial = World.create(map, SPAWNS, seed, []);
      const runtimeLive = createRuntime(map);
      const runtimeReplay = createRuntime(map);

      const rec = new ReplayRecorder({
        matchId: "round-trip",
        mapId: map.id,
        rngSeed: seed,
        players: SPAWNS,
      });

      // Drive 30 ticks of canned inputs through the LIVE sim, recording each
      // accepted frame to the recorder (mirrors what matchHost.tick does).
      let live = initial;
      for (let t = 0; t < 30; t += 1) {
        const inA = mkInput(t + 1, live.tick, t % 2 === 0 ? 1 : 2); // alternate left/right
        const inB = mkInput(t + 1, live.tick, 0);
        rec.record(live.tick, A, inA);
        rec.record(live.tick, B, inB);
        const result = stepWithRuntime(live, runtimeLive, { [A]: inA, [B]: inB }, STEP_MS);
        live = result.state;
      }

      // Now replay through a fresh state + runtime. Same inputs, same RNG
      // seed → same final state.
      const replayed = playReplay(rec.snapshot(), {
        initialState: World.create(map, SPAWNS, seed, []),
        step: (state, inputs) =>
          stepWithRuntime(state, runtimeReplay, inputs as Record<PlayerId, InputFrame | null>, STEP_MS).state,
      });

      // Compare the things that matter: tick count, RNG state, player positions.
      expect(replayed.tick).toBe(live.tick);
      expect(replayed.rngState).toBe(live.rngState);
      expect(replayed.players[A]!.x).toBeCloseTo(live.players[A]!.x, 5);
      expect(replayed.players[A]!.y).toBeCloseTo(live.players[A]!.y, 5);
      expect(replayed.players[B]!.x).toBeCloseTo(live.players[B]!.x, 5);
      expect(replayed.players[B]!.y).toBeCloseTo(live.players[B]!.y, 5);
    },
  );
});
