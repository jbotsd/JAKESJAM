// H1 gate — wasm `projectile_pre_step` and
// `projectile_split_velocities` produce bit-exact results matching
// the TS orchestrator in `client/src/sim/projectile.ts`.
//
// Pre-step covers the sticky-fuse / lifetime-expire decision before
// motion. Split-velocities covers the fan computation for
// split-on-expire / split-on-impact children.
//
// Constants come straight from wasm exports — that pins the
// contract on both ends.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  packWorldState,
  WORLD_STATE_TOTAL_SIZE,
  HEADER_SIZE,
  PLAYER_ENTITY_SIZE,
  ARRAY_PREAMBLE,
  MAX_PLAYERS,
} from "../worldStateBridge";
import { installLutTables, lutAtan2, lutCos, lutSin } from "../../trig";
import { nextU32 } from "../../rng";
import {
  EntityId,
  PlayerId,
  Tick,
  type ProjectileEntity,
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

type LifecycleExports = {
  projectile_pre_step: (proj_ptr: number, dt_ms: number) => number;
  projectile_split_velocities: (
    parent_ptr: number,
    rng_in: number,
    out_ptr: number,
    out_cap: number,
  ) => bigint;
  projectile_sticky_fuse_default_ms: () => number;
  projectile_split_max: () => number;
  sizeof_split_velocity: () => number;
  sizeof_projectile_entity: () => number;
  sizeof_world_state: () => number;
  lut_sin_table_ptr: () => number;
  lut_atan_table_ptr: () => number;
  lut_table_size: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as LifecycleExports;

// Install the LUT into the TS-side trig module so this test's
// expected-value computation uses the SAME tables the wasm side
// reads from. Otherwise TS lutAtan2 falls back to libm and we
// get last-ULP divergence.
const tableSize = ex.lut_table_size();
const sinPtr = ex.lut_sin_table_ptr();
const atanPtr = ex.lut_atan_table_ptr();
const sinView = new Float64Array(ex.memory.buffer, sinPtr, tableSize);
const atanView = new Float64Array(ex.memory.buffer, atanPtr, tableSize);
installLutTables(sinView, atanView);

const STICKY_FUSE_MS = ex.projectile_sticky_fuse_default_ms();
const SPLIT_MAX = ex.projectile_split_max();
const SPLIT_SPREAD = Math.PI * 0.95;
const SPLIT_SPEED_MIN = 180;
const SPLIT_SPEED_SCALE = 0.82;
const SIZEOF_SPLIT_VEL = ex.sizeof_split_velocity();

// Layout in the WorldState packed buffer: header + player preamble +
// player bytes + projectile preamble + projectile array start. Derived
// from the shared layout constants (2026-07-14) rather than hand-copied
// numbers — the native-drafting PlayerEntity/header growth silently
// broke this test's hardcoded formula the first time.
const PROJECTILES_OFFSET =
  HEADER_SIZE + ARRAY_PREAMBLE + MAX_PLAYERS * PLAYER_ENTITY_SIZE + ARRAY_PREAMBLE;

function makeBaseProjectile(): ProjectileEntity {
  return {
    id: EntityId(7),
    ownerId: null,
    x: 100,
    y: 50,
    vx: 220,
    vy: 60,
    shape: "circle",
    radius: 6,
    damage: 18,
    lifetimeMs: 2000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
}

function packIntoWasm(state: WorldState): {
  buf: Uint8Array;
  projPtr: number;
} {
  const buf = packWorldState(state);
  const ptr = sim.statePtr;
  // Reuse the existing static state buffer in wasm memory — it's
  // sized 64 KB which is comfortably > WORLD_STATE_TOTAL_SIZE.
  const heap = new Uint8Array(ex.memory.buffer);
  heap.set(buf, ptr);
  return {
    buf,
    projPtr: ptr + PROJECTILES_OFFSET,
  };
}

function singleProjectileState(p: ProjectileEntity): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: { [p.id]: p } as Record<EntityId, ProjectileEntity>,
    destructibles: {},
    firePatches: {},
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
}

describe("projectile lifecycle parity (Phase H1)", () => {
  test("constants match TS-side STICKY_FUSE_MS / SPLIT_MAX", () => {
    expect(STICKY_FUSE_MS).toBe(720);
    expect(SPLIT_MAX).toBe(8);
    expect(SIZEOF_SPLIT_VEL).toBe(24);
  });

  test("pre_step: advance when no sticky and lifetime > dt", () => {
    const p = makeBaseProjectile();
    p.lifetimeMs = 1000;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const result = ex.projectile_pre_step(projPtr, 16.667);
    expect(result).toBe(0); // advance
  });

  test("pre_step: lifetime_expired when remaining ≤ 0", () => {
    const p = makeBaseProjectile();
    p.lifetimeMs = 10;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const result = ex.projectile_pre_step(projPtr, 16.667);
    expect(result).toBe(3); // lifetime_expired
  });

  test("pre_step: sticky_linger decrements fuse + age", () => {
    const p = makeBaseProjectile();
    p.stickyFuseMs = 200;
    p.ageMs = 100;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const result = ex.projectile_pre_step(projPtr, 16.667);
    expect(result).toBe(1); // sticky_linger
    // Read back the mutated fuse + age from wasm memory.
    const view = new DataView(ex.memory.buffer);
    const fuseAfter = view.getFloat64(
      projPtr + 16 * 8, // 16 f64 fields before sticky_fuse_ms
      true,
    );
    const ageAfter = view.getFloat64(projPtr + 7 * 8, true);
    expect(fuseAfter).toBeCloseTo(200 - 16.667, 6);
    expect(ageAfter).toBeCloseTo(100 + 16.667, 6);
  });

  test("pre_step: sticky_expired when fuse runs out this tick", () => {
    const p = makeBaseProjectile();
    p.stickyFuseMs = 5;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const result = ex.projectile_pre_step(projPtr, 16.667);
    expect(result).toBe(2); // sticky_expired
  });

  test("split_velocities: zero count when splitCount unset", () => {
    const p = makeBaseProjectile();
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const outPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE;
    const packed = ex.projectile_split_velocities(projPtr, 12345, outPtr, 8);
    const count = Number(packed & 0xffffffffn);
    const newRng = Number((packed >> 32n) & 0xffffffffn);
    expect(count).toBe(0);
    expect(newRng).toBe(12345); // unchanged
  });

  test("split_velocities: 4-shard fan matches TS impl bit-exact", () => {
    const p = makeBaseProjectile();
    p.splitCount = 4;
    p.vx = 300;
    p.vy = 100;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const outPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE;
    const rngIn = 0x12345678;
    const packed = ex.projectile_split_velocities(projPtr, rngIn, outPtr, 8);
    const count = Number(packed & 0xffffffffn);
    const newRng = Number((packed >> 32n) & 0xffffffffn) >>> 0;
    expect(count).toBe(4);

    // Replicate the TS impl exactly to compare bit-exact.
    const speed = Math.sqrt(300 * 300 + 100 * 100);
    const baseAngle = lutAtan2(100, 300);
    let r = rngIn;
    const view = new DataView(ex.memory.buffer);
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      r = nextU32(r);
      const jitter = r / 0x100000000;
      const angle =
        baseAngle - SPLIT_SPREAD / 2 + SPLIT_SPREAD * t + (jitter - 0.5) * 0.06;
      const childSpeed = Math.max(SPLIT_SPEED_MIN, speed * SPLIT_SPEED_SCALE);
      const expectedVx = lutCos(angle) * childSpeed;
      const expectedVy = lutSin(angle) * childSpeed;
      const actualVx = view.getFloat64(outPtr + i * SIZEOF_SPLIT_VEL, true);
      const actualVy = view.getFloat64(
        outPtr + i * SIZEOF_SPLIT_VEL + 8,
        true,
      );
      const actualAngle = view.getFloat64(
        outPtr + i * SIZEOF_SPLIT_VEL + 16,
        true,
      );
      expect(actualVx).toBe(expectedVx);
      expect(actualVy).toBe(expectedVy);
      expect(actualAngle).toBe(angle);
    }
    expect(newRng).toBe(r >>> 0);
  });

  test("split_velocities: caps at SPLIT_MAX (8) when input exceeds", () => {
    const p = makeBaseProjectile();
    p.splitCount = 99; // wildly excessive
    p.vx = 100;
    p.vy = 0;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const outPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE;
    const packed = ex.projectile_split_velocities(projPtr, 1, outPtr, 16);
    const count = Number(packed & 0xffffffffn);
    expect(count).toBe(SPLIT_MAX);
  });

  test("split_velocities: respects out_cap when smaller than splitCount", () => {
    const p = makeBaseProjectile();
    p.splitCount = 6;
    const state = singleProjectileState(p);
    const { projPtr } = packIntoWasm(state);
    const outPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE;
    const packed = ex.projectile_split_velocities(projPtr, 1, outPtr, 3);
    const count = Number(packed & 0xffffffffn);
    expect(count).toBe(3);
  });
});
