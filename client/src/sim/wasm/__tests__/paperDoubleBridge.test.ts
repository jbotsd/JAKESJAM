// Track E1c (gospel-goal.md, Engine E1 — "Paper Doubles through
// worldStateBridge pack/unpack") — regression gate for the bridged
// paper-double entity section + the header spawn-id cursor, the entity
// edition of Z0e's movementMemoryBridge.test.ts / Z1a's
// meleeSwingMemoryBridge.test.ts.
//
// THE BUG THIS PINS DOWN (recorded by wave 1; the reason
// splitSpawnWorldParity.test.ts's header disclaims entity-id comparison
// and the split-spawn lane had to drive stepWorld natively in tests):
// packWorldState never wrote the paper-double section (count stayed 0)
// and BOTH full-sync hosts (client runWasmStepSync, server
// serverWasmHost.step) overwrite the ENTIRE wasm-side WorldState buffer
// with the packed image before every step_world call. Result: every live
// decoy — TS-spawned (World.ts's "paper-double" case) or Zig-spawned
// (world.zig's `.paper_double` cast arm) — was WIPED one tick after it
// appeared. Same wipe-on-repack bug class as Z0e (movement memory), Z1a
// (melee swing FSM) and Z2 (draft state), felt as "the decoy flickers
// for one frame then vanishes" under live wasm authority.
//
// ITS SIBLING (same cut): header.next_entity_id was packed as a
// placeholder 0, resetting the spawn-id cursor world.zig's spawn sites
// read+increment on EVERY repack — wasm-assigned entity ids restarted
// from 0 each tick and could collide with live entity ids. Packed real
// now (carrier-or-derived-floor, see nextEntityIdForPack) and read back
// out so the hosts can round-trip Zig's own post-step cursor.
//
// Four gates (same shape as meleeSwingMemoryBridge.test.ts):
//   A. LAYOUT — the bridge's computed section offset equals wasm's own
//      @offsetOf-derived offset_paper_doubles(), and the 96-byte stride
//      matches @sizeOf.
//   B. CODEC — pack→unpack round-trips every PaperDoubleEntity field;
//      an absent `state.paperDoubles` round-trips to an empty record.
//   C. BEHAVIOR — a live decoy mid-flight survives the every-tick
//      full-sync repack in TS lockstep: positions/lifetime bit-identical
//      TS-vs-wasm every tick, an EXPLICIT mid-flight re-pack is identity
//      for the decoy, and both orchestrators expire it on the SAME tick.
//      Before E1c the Zig-side decoy evaporated on the first repack —
//      this gate fails loudly on the old pack path (verified during the
//      cut by re-running it with the pack-side section write disabled:
//      "decoy alive @t1" fails exactly as the old path did).
//   D. CURSOR — the header word carries max(carrier, max-live-id+1) and
//      round-trips back out of unpackWorldState.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
import {
  packWorldState,
  unpackWorldState,
  PAPER_DOUBLE_OFFSET,
  PAPER_DOUBLE_ENTITY_SIZE,
  MAX_PAPER_DOUBLES,
} from "../worldStateBridge";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PaperDoubleEntity,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm"))
    return Promise.resolve(
      new Response(ab as ArrayBuffer, { headers: { "Content-Type": "application/wasm" } }),
    );
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;
await preloadWasmWorldSim();
await wasmHost.preload();
await applyWasmPlayerFlag();

const DT_MS = 1000 / 60;

// Same "u32 count + 4-byte pad" preamble every entity section uses
// (world_state.zig pins the shape with a comptime assert).
const ARRAY_PREAMBLE = 8;
// header byte offset of next_entity_id — pinned Zig-side by the
// @offsetOf(WorldStateHeader, "next_entity_id") == 12 comptime assert.
const NEXT_ENTITY_ID_HEADER_OFFSET = 12;

const MAP: MapDefinition = {
  id: "paper-double-bridge-arena",
  name: "Paper Double Bridge Arena",
  size: { x: 1600, y: 1300 },
  spawns: [{ x: 1400, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 1200 }, size: { x: 1600, y: 60 } },
  ],
};

const P1 = PlayerId("idle-one");
const P2 = PlayerId("idle-two");

// Decoy flight path (x 300 → ~780 over its 1s life) stays far from both
// idle players (x 1300/1500, y 1140) so neither the decoy body nor its
// expiry burst (radius ~a hundred px) can touch a player on either
// engine — this gate is about the BRIDGE, not burst semantics.
const DECOY_ID = EntityId(500);
const SEED_DECOY: PaperDoubleEntity = {
  id: DECOY_ID,
  ownerId: P1,
  x: 300,
  y: 600,
  vx: 480,
  vy: 0,
  health: 20,
  remainingMs: 1000,
};

function makeIdlePlayer(id: PlayerId, x: number): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y: 1140, // standing on the floor (top edge 1170, body half-height 28)
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: 1140,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function makeState(): WorldState {
  return {
    tick: Tick(0),
    rngState: 424242,
    players: {
      [P1]: makeIdlePlayer(P1, 1300),
      [P2]: makeIdlePlayer(P2, 1500),
    },
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    paperDoubles: { [DECOY_ID]: { ...SEED_DECOY } },
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("paper-double bridge (Track E1c)", () => {
  test("A. layout — TS section offset/stride/cap match wasm's @offsetOf/@sizeOf", () => {
    const ex = sim.exports as unknown as {
      offset_paper_doubles?: () => number;
      sizeof_paper_double_entity?: () => number;
      world_state_max_paper_doubles?: () => number;
    };
    expect(typeof ex.offset_paper_doubles).toBe("function");
    expect(ex.offset_paper_doubles!()).toBe(PAPER_DOUBLE_OFFSET + ARRAY_PREAMBLE);
    expect(typeof ex.sizeof_paper_double_entity).toBe("function");
    expect(ex.sizeof_paper_double_entity!()).toBe(PAPER_DOUBLE_ENTITY_SIZE);
    expect(typeof ex.world_state_max_paper_doubles).toBe("function");
    expect(ex.world_state_max_paper_doubles!()).toBe(MAX_PAPER_DOUBLES);
  });

  test("B. codec — round-trip preserves every field; absent collection round-trips empty", () => {
    const state = makeState();
    const second: PaperDoubleEntity = {
      id: EntityId(7),
      ownerId: P2,
      x: -12.5,
      y: 1033.25,
      vx: -480,
      vy: 62.125,
      health: 3.5,
      remainingMs: 41.75,
    };
    // Deliberately inserted higher-id-first — pack sorts by id, unpack
    // keys by id, so insertion order must not matter.
    state.paperDoubles = { [DECOY_ID]: { ...SEED_DECOY }, [second.id]: second };
    const unpacked = unpackWorldState(packWorldState(state));
    expect(Object.keys(unpacked.paperDoubles).length).toBe(2);
    expect(unpacked.paperDoubles[DECOY_ID]).toEqual(SEED_DECOY);
    expect(unpacked.paperDoubles[second.id]).toEqual(second);

    const bare = makeState();
    delete bare.paperDoubles;
    expect(unpackWorldState(packWorldState(bare)).paperDoubles).toEqual({});
  });

  test("C. behavior — a live decoy mid-flight survives the every-tick repack in TS lockstep, and expires the same tick on both engines", () => {
    const runtime = createRuntime(MAP);
    let tsState = makeState();

    setWorldStatics(
      MAP.platforms.map(platformToAABB),
      MAP.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
    );
    setWorldArenaBounds(
      runtime.ceilingClampY,
      MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0,
    );
    setWorldLaunchPads([]);
    setWorldSlopes([]);
    setWorldSpawnPoints(MAP.spawns);
    setWorldTargetScore(resolveModeConfig(undefined).targetScore);
    let zigState: WorldState = structuredClone(tsState);

    // remainingMs 1000 at 60Hz: the decoy survives ticks 1..59 and both
    // engines drop it on tick 60 (TS: pre-move expiry check; Zig: same-
    // tick section-9 compaction — see the codec's byte-layout comment).
    let tsExpiryTick: number | null = null;
    let zigExpiryTick: number | null = null;

    for (let t = 1; t <= 70; t++) {
      const inputs: Record<PlayerId, InputFrame | null> = {};
      const wasmInputs = new Map<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >();
      for (const pid of [P1, P2]) {
        const p = tsState.players[pid]!;
        inputs[pid] = {
          seq: InputSeq(t),
          tick: Tick(t),
          keys: 0,
          aimX: p.aimX,
          aimY: p.aimY,
          dtMs: DT_MS,
        };
        wasmInputs.set(String(pid), { keys: 0, prevKeys: 0, aimX: p.aimX, aimY: p.aimY });
      }
      tsState = stepWithRuntime(tsState, runtime, inputs, DT_MS).state;

      (globalThis as {
        __jakesjam_wasm_inputs__?: ReadonlyMap<
          string,
          { keys: number; prevKeys: number; aimX: number; aimY: number }
        >;
      }).__jakesjam_wasm_inputs__ = wasmInputs;
      __clearFireConfigCacheForTests();
      writeFireConfigsForState(zigState);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

      const tsPd = tsState.paperDoubles?.[DECOY_ID];
      const zigPd = zigState.paperDoubles?.[DECOY_ID];
      if (tsPd === undefined && tsExpiryTick === null) tsExpiryTick = t;
      if (zigPd === undefined && zigExpiryTick === null) zigExpiryTick = t;

      // Lockstep: presence must agree every tick — THE E1c claim. On the
      // old pack path the Zig-side decoy is already gone at t=1 (the
      // repack wiped it before its first step).
      expect(zigPd !== undefined, `decoy alive @t${t}`).toBe(tsPd !== undefined);
      if (tsPd !== undefined && zigPd !== undefined) {
        // Bit-exact kinematics/lifetime — both engines advance
        // x += vx * (dt/1000) and remaining -= dt in the same f64 math.
        expect(zigPd.x, `t${t} x`).toBe(tsPd.x);
        expect(zigPd.y, `t${t} y`).toBe(tsPd.y);
        expect(zigPd.vx, `t${t} vx`).toBe(tsPd.vx);
        expect(zigPd.vy, `t${t} vy`).toBe(tsPd.vy);
        expect(zigPd.health, `t${t} health`).toBe(tsPd.health);
        expect(zigPd.remainingMs, `t${t} remainingMs`).toBe(tsPd.remainingMs);
        expect(zigPd.ownerId, `t${t} ownerId`).toBe(tsPd.ownerId);
      }

      // Mid-flight EXPLICIT re-pack (on top of the implicit one every
      // applyWasmWorldStepFullSync already does): a bridge round-trip of
      // the continuing world must be identity for the decoy — pre-E1c
      // this came back as an empty record and the decoy evaporated.
      if (t === 10) {
        expect(zigPd).toBeDefined();
        expect(zigPd!.remainingMs).toBeLessThan(SEED_DECOY.remainingMs); // genuinely mid-flight
        expect(zigPd!.x).toBeGreaterThan(SEED_DECOY.x);
        const roundTripped = unpackWorldState(packWorldState(zigState));
        expect(roundTripped.paperDoubles).toEqual(
          zigState.paperDoubles as Record<EntityId, PaperDoubleEntity>,
        );
      }

      // Idle players stay in lockstep throughout (the decoy and its
      // expiry burst never reach them on either engine).
      expect(zigState.players[P1]!.health).toBe(tsState.players[P1]!.health);
      expect(zigState.players[P2]!.health).toBe(tsState.players[P2]!.health);
    }

    // Both engines expired the decoy, on the SAME tick.
    expect(tsExpiryTick).not.toBeNull();
    expect(zigExpiryTick).toBe(tsExpiryTick);
    // And nothing resurrected it.
    expect(tsState.paperDoubles ?? {}).toEqual({});
    expect(zigState.paperDoubles ?? {}).toEqual({});
  });

  test("D. cursor — header.next_entity_id packs real (carrier-or-derived) and round-trips", () => {
    // Derived floor: max live entity id + 1 (mirrors World.ts's
    // nextEntityIdSeed; the hand-seeded decoy id 500 is the max here).
    const state = makeState();
    const packed = packWorldState(state);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    expect(view.getUint32(NEXT_ENTITY_ID_HEADER_OFFSET, true)).toBe(501);

    // Carrier wins when AHEAD of the floor (Zig's post-step cursor is
    // monotonic; the hosts seat it on state.nextEntityId every tick).
    state.nextEntityId = 700;
    const packed2 = packWorldState(state);
    const view2 = new DataView(packed2.buffer, packed2.byteOffset, packed2.byteLength);
    expect(view2.getUint32(NEXT_ENTITY_ID_HEADER_OFFSET, true)).toBe(700);
    // ...and round-trips back out for the hosts to carry.
    expect(unpackWorldState(packed2).nextEntityId).toBe(700);

    // A stale/regressed carrier can NOT drag the cursor below the derived
    // floor (id collisions with live entities would follow).
    state.nextEntityId = 3;
    const packed3 = packWorldState(state);
    const view3 = new DataView(packed3.buffer, packed3.byteOffset, packed3.byteLength);
    expect(view3.getUint32(NEXT_ENTITY_ID_HEADER_OFFSET, true)).toBe(501);
  });
});
