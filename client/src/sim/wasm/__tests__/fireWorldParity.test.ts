// H6 gate — fire_patch_tick_world + fire_patch_hits_player_world
// operate on world_state.FireEntity directly so the orchestrator
// doesn't need to repack into the standalone FirePatch struct.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  packWorldState,
  HEADER_SIZE,
  PLAYER_ENTITY_SIZE,
  PROJECTILE_ENTITY_SIZE,
  SATELLITE_ENTITY_SIZE,
  DESTRUCTIBLE_ENTITY_SIZE,
  ARRAY_PREAMBLE,
  MAX_PLAYERS,
  MAX_PROJECTILES,
  MAX_SATELLITES,
  MAX_DESTRUCTIBLES,
} from "../worldStateBridge";
import {
  EntityId,
  PlayerId,
  Tick,
  type FireEntity,
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

type FireExports = {
  fire_patch_tick_world: (fire_ptr: number, dt_ms: number) => number;
  fire_patch_hits_player_world: (
    fire_ptr: number,
    px: number,
    py: number,
    pw: number,
    ph: number,
  ) => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as FireExports;

// Derived from the shared layout constants (2026-07-14) rather than
// hand-copied numbers — the native-drafting PlayerEntity/header growth
// silently broke this test's hardcoded formula the first time.
const FIRES_OFFSET =
  HEADER_SIZE +
  ARRAY_PREAMBLE +
  MAX_PLAYERS * PLAYER_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_PROJECTILES * PROJECTILE_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_SATELLITES * SATELLITE_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_DESTRUCTIBLES * DESTRUCTIBLE_ENTITY_SIZE +
  ARRAY_PREAMBLE;

function loadFireOnly(f: FireEntity): number {
  const state: WorldState = {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: {},
    destructibles: {},
    firePatches: { [f.id]: f } as Record<EntityId, FireEntity>,
    pickups: {},
    satellites: {},
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
  return sim.statePtr + FIRES_OFFSET;
}

const REMAINING_MS_OFFSET = 3 * 8;

describe("fire orchestration parity (Phase H6)", () => {
  test("tick decrements remaining_ms in place", () => {
    const f: FireEntity = {
      id: EntityId(1),
      x: 100,
      y: 100,
      radius: 32,
      remainingMs: 500,
      ownerId: null,
      damagePerSecond: 14,
    };
    const ptr = loadFireOnly(f);
    const alive = ex.fire_patch_tick_world(ptr, 100);
    expect(alive).toBe(1);
    const view = new DataView(ex.memory.buffer);
    expect(view.getFloat64(ptr + REMAINING_MS_OFFSET, true)).toBe(400);
  });

  test("tick reports expired when remaining ≤ 0", () => {
    const f: FireEntity = {
      id: EntityId(1),
      x: 100,
      y: 100,
      radius: 32,
      remainingMs: 50,
      ownerId: null,
      damagePerSecond: 14,
    };
    const ptr = loadFireOnly(f);
    const alive = ex.fire_patch_tick_world(ptr, 100);
    expect(alive).toBe(0);
  });

  test("hits_player when player AABB overlaps fire bbox", () => {
    const f: FireEntity = {
      id: EntityId(1),
      x: 100,
      y: 100,
      radius: 32,
      remainingMs: 1000,
      ownerId: null,
      damagePerSecond: 14,
    };
    const ptr = loadFireOnly(f);
    expect(ex.fire_patch_hits_player_world(ptr, 90, 90, 30, 50)).toBe(1);
    expect(ex.fire_patch_hits_player_world(ptr, 500, 500, 30, 50)).toBe(0);
  });
});
