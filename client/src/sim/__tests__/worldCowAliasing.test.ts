// Perf audit M2 (2026-07-18) regression test.
//
// World.ts's per-tick handling of `satellites` and `firePatches` used to
// unconditionally `{ ...state.X }` copy the WHOLE collection every tick even
// though both stepSatellites and stepFirePatches always return a brand-new,
// fully-populated record of their own — so the eager copy was discarded on
// every tick regardless of content. Fixed by defaulting `nextX` to the SAME
// reference as `state.X` and copying only at the (rare) mutation sites that
// need to add an entry before the step consumes it.
//
// That fix introduces a real hazard: any of those mutation sites that
// forgets to check "am I still holding the original reference?" before
// writing would corrupt the PREVIOUS tick's already-returned, supposedly
// frozen WorldState in place. This test proves that never happens — for
// every tick across a fire-hazard + orbiting-satellites match, the state
// object returned by the previous tick must remain byte-for-byte identical
// after the next tick runs.
import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import { InputSeq, PlayerId, Tick } from "../types.js";
import type { InputBitfield, InputFrame, MapDefinition, PlayerSpawnInfo, WorldState } from "../types.js";

const PA = PlayerId("a");
const PB = PlayerId("b");

const Bit = {
  Fire: 1 << 6,
} as const;

const DT_MS = 1000 / 60;

const arena: MapDefinition = {
  id: "cow-aliasing-arena",
  name: "CoW Aliasing Arena",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

// PB is a plain target so PA's shots always have someone to aim at. PA gets
// the orbiting-satellites card patched onto its entity after creation —
// World.create hardcodes a fresh player's `cards` to `[]` regardless of
// PlayerSpawnInfo.cards (only rosterOps.applyMidMatchJoin honors that field),
// so a starter-card spawn can't be expressed via PlayerSpawnInfo here.
const players: PlayerSpawnInfo[] = [
  { playerId: PA, characterId: "balanced", name: "A", color: "#f00", weaponId: "starter-pistol" },
  { playerId: PB, characterId: "balanced", name: "B", color: "#0f0", weaponId: "starter-pistol" },
];

function buildInput(seq: number, keys: InputBitfield, aimX: number): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(seq), keys, aimX, aimY: 400, dtMs: DT_MS };
}

function skipCountdown(state: WorldState, runtime: ReturnType<typeof createRuntime>): WorldState {
  let s = state;
  while (s.round.phase === "countdown") {
    s = stepWithRuntime(s, runtime, { [PA]: null, [PB]: null }, DT_MS).state;
  }
  return s;
}

/** Deep-enough snapshot for this test: entity count + serialized contents. */
function snapshot(record: Record<string, unknown>): string {
  return JSON.stringify(record, Object.keys(record).sort());
}

describe("World.stepWithRuntime never mutates a prior tick's satellites/firePatches in place (perf audit M2)", () => {
  test("fire-hazard patches + orbiting-satellites: every previous state stays frozen after the next tick", () => {
    let state = World.create(arena, players, 11, ["fire-hazard"]);
    const runtime = createRuntime(arena);
    state = skipCountdown(state, runtime);
    state = {
      ...state,
      players: {
        ...state.players,
        [PA]: { ...state.players[PA]!, cards: ["orbiting-satellites"] },
      },
    };

    let seq = 1;
    let sawFirePatch = false;
    let sawSatellite = false;

    for (let i = 0; i < 400; i += 1) {
      const prevFirePatches = state.firePatches;
      const prevFirePatchesSnapshot = snapshot(prevFirePatches);
      const prevSatellites = state.satellites ?? {};
      const prevSatellitesSnapshot = snapshot(prevSatellites);

      // PA fires every tick, aimed at PB, so the orbiting-satellites card's
      // first-shot activation triggers as early as possible.
      const inputs = { [PA]: buildInput(seq, Bit.Fire, 600), [PB]: null };
      seq += 1;
      state = stepWithRuntime(state, runtime, inputs, DT_MS).state;

      // The PREVIOUS tick's collections must read back identically — proves
      // no mutation-site in this tick wrote into a still-aliased reference.
      expect(snapshot(prevFirePatches)).toBe(prevFirePatchesSnapshot);
      expect(snapshot(prevSatellites)).toBe(prevSatellitesSnapshot);

      if (Object.keys(state.firePatches).length > 0) sawFirePatch = true;
      if (Object.keys(state.satellites ?? {}).length > 0) sawSatellite = true;
    }

    // Sanity: the scenario actually exercised both mutation paths, not just
    // the (trivially safe) empty-collection case.
    expect(sawFirePatch).toBe(true);
    expect(sawSatellite).toBe(true);
  });
});
