// Zig e2e cutover investigation, 2026-07-14 — verifies the fire-hazard
// chaos-modifier rewrite in world.zig against three bugs found by direct
// comparison with World.ts's equivalent section:
//   1. No is_fighting gate (hazards could spawn during countdown/drafting).
//   2. Position used a hardcoded -800..800/-400..400 box via an ad-hoc
//      xorshift, not the real map size — an admittedly-incomplete stub
//      ("rough range... caller can clamp later" in the old comment).
//   3. radius/damage/lifetime constants didn't match TS at all (36 vs
//      36-62 randomized, 14 vs 13 dps, 1800ms vs 3000ms).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFull,
  setWorldMapSize,
  setWorldStatics,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import {
  PlayerId,
  Tick,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await loadSimFromBytes(ab);
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

const PID = PlayerId("p0");
const MAP_W = 1600;
const MAP_H = 900;

function makePlayer(): PlayerEntity {
  return {
    id: PID,
    characterId: "balanced",
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    aimX: 500,
    aimY: 300,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
}

function makeState(phase: "fighting" | "drafting", fireHazardTimerMs = 2400): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: { [PID]: makePlayer() } as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    chaosModifierIds: ["fire-hazard"],
    fireHazardTimerMs,
    round: {
      phase,
      countdownRemainingMs: 60_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("fire-hazard chaos modifier — world.zig rewrite (2026-07-14)", () => {
  test("does NOT spawn during drafting phase (is_fighting gate)", async () => {
    setWorldStatics([], []);
    setWorldMapSize(MAP_W, MAP_H);
    __clearFireConfigCacheForTests();
    const state = makeState("drafting");
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);
    expect(Object.keys(next.firePatches).length).toBe(0);
  });

  test("spawns within REAL map bounds (not the old hardcoded -800..800 box) when fighting", async () => {
    setWorldStatics([], []);
    setWorldMapSize(MAP_W, MAP_H);
    __clearFireConfigCacheForTests();
    const state = makeState("fighting");
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);
    const ids = Object.keys(next.firePatches);
    expect(ids.length).toBe(1);
    const patch = next.firePatches[ids[0] as unknown as keyof typeof next.firePatches]!;

    // TS formula: x = 80 + fx*max(1, mapSize.x-160) -> [80, mapSize.x-80]
    //             y = 160 + fy*max(1, mapSize.y-250) -> [160, mapSize.y-90]
    expect(patch.x).toBeGreaterThanOrEqual(80);
    expect(patch.x).toBeLessThanOrEqual(MAP_W - 80);
    expect(patch.y).toBeGreaterThanOrEqual(160);
    expect(patch.y).toBeLessThanOrEqual(MAP_H - 90);

    // TS formula: radius = 36 + fr*26 -> [36, 62], NOT the old hardcoded 36.
    expect(patch.radius).toBeGreaterThanOrEqual(36);
    expect(patch.radius).toBeLessThanOrEqual(62);

    // TS constants, not the old Zig-only values (14 dps / 1800ms).
    expect(patch.damagePerSecond).toBe(13);
    expect(patch.remainingMs).toBe(3000);
  });

  test("does NOT spawn when map size was never set (fail-closed, not fail-open-with-wrong-box)", async () => {
    // Fresh preload-independent check: clear the cached map size by setting
    // it to 0 (the Zig-side gate is g_map_width > 0 and g_map_height > 0).
    setWorldStatics([], []);
    setWorldMapSize(0, 0);
    __clearFireConfigCacheForTests();
    const state = makeState("fighting");
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);
    expect(Object.keys(next.firePatches).length).toBe(0);
    // Restore for any tests that run after this file in the same process.
    setWorldStatics([], []);
    setWorldMapSize(MAP_W, MAP_H);
  });
});
