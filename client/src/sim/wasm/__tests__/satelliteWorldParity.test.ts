// H3 gate — satellite_tick_world produces the same TickOutput
// as the pre-existing satellite_tick (with stand-alone TickInput),
// proving the WorldState-aware wrapper preserves bit-exact
// behaviour while mutating SatelliteEntity in place.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { packWorldState } from "../worldStateBridge";
import { installLutTables } from "../../trig";
import {
  EntityId,
  PlayerId,
  Tick,
  type SatelliteEntity,
  type WorldState,
} from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

type SatExports = {
  satellite_tick: (in_ptr: number, out_ptr: number) => void;
  satellite_tick_world: (
    sat_ptr: number,
    owner_x: number,
    owner_y: number,
    target_x: number,
    target_y: number,
    has_target: number,
    can_fire: number,
    dt_ms: number,
    out_ptr: number,
  ) => void;
  sizeof_satellite_tick_input: () => number;
  sizeof_satellite_tick_output: () => number;
  lut_sin_table_ptr: () => number;
  lut_atan_table_ptr: () => number;
  lut_table_size: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as SatExports;

const tableSize = ex.lut_table_size();
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), tableSize),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), tableSize),
);

const SAT_OFFSET =
  48 + 8 + 16 * 288 + 8 + 256 * 216 + 8;
const ANGLE_OFFSET = 0;
const COOLDOWN_OFFSET = 2 * 8;
const LIFETIME_OFFSET = 3 * 8;

function loadSat(s: SatelliteEntity): {
  satPtr: number;
  inPtr: number;
  outPtr: number;
  outPtr2: number;
} {
  const state: WorldState = {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: { [s.id]: s } as Record<EntityId, SatelliteEntity>,
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
  const buf = packWorldState(state);
  new Uint8Array(ex.memory.buffer).set(buf, sim.statePtr);
  return {
    satPtr: sim.statePtr + SAT_OFFSET,
    inPtr: sim.statePtr + buf.byteLength,
    outPtr: sim.statePtr + buf.byteLength + 200,
    outPtr2: sim.statePtr + buf.byteLength + 400,
  };
}

describe("satellite world parity (Phase H3)", () => {
  test("tick_world mutates angle/cooldown/lifetime in place", () => {
    const s: SatelliteEntity = {
      id: EntityId(1),
      ownerId: PlayerId("owner"),
      angle: 0.5,
      orbitRadius: 80,
      fireCooldownMs: 100,
      lifetimeMs: 5000,
    };
    const { satPtr, outPtr } = loadSat(s);
    ex.satellite_tick_world(satPtr, 0, 0, 100, 0, 0, 1, 16.667, outPtr);
    const view = new DataView(ex.memory.buffer);
    // angle += π/1.5 * 16.667/1000
    const expectedAngle = 0.5 + (Math.PI / 1.5) * 0.016667;
    expect(view.getFloat64(satPtr + ANGLE_OFFSET, true)).toBeCloseTo(expectedAngle, 6);
    // cooldown decremented
    expect(view.getFloat64(satPtr + COOLDOWN_OFFSET, true)).toBeCloseTo(100 - 16.667, 6);
    // lifetime decremented
    expect(view.getFloat64(satPtr + LIFETIME_OFFSET, true)).toBeCloseTo(5000 - 16.667, 6);
  });

  test("tick_world fires when cooldown=0 + has_target + can_fire", () => {
    const s: SatelliteEntity = {
      id: EntityId(1),
      ownerId: PlayerId("owner"),
      angle: 0,
      orbitRadius: 80,
      fireCooldownMs: 0,
      lifetimeMs: 5000,
    };
    const { satPtr, outPtr } = loadSat(s);
    ex.satellite_tick_world(satPtr, 0, 0, 200, 0, 1, 1, 16.667, outPtr);
    const view = new DataView(ex.memory.buffer);
    // wants_fire is i32 at offset 52 (after 6×f64 + i32 expired).
    const wantsFire = view.getInt32(outPtr + 52, true);
    expect(wantsFire).toBe(1);
    // cooldown reset
    expect(view.getFloat64(satPtr + COOLDOWN_OFFSET, true)).toBe(600);
  });

  test("tick_world reports expired when lifetime hits 0", () => {
    const s: SatelliteEntity = {
      id: EntityId(1),
      ownerId: PlayerId("owner"),
      angle: 0,
      orbitRadius: 80,
      fireCooldownMs: 100,
      lifetimeMs: 10,
    };
    const { satPtr, outPtr } = loadSat(s);
    ex.satellite_tick_world(satPtr, 0, 0, 0, 0, 0, 1, 16.667, outPtr);
    const view = new DataView(ex.memory.buffer);
    // expired is i32 at offset 48 (after 6×f64).
    const expired = view.getInt32(outPtr + 48, true);
    expect(expired).toBe(1);
  });
});
