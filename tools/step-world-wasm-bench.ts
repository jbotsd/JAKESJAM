// step_world wasm-boundary benchmark. 2026-07-14.
//
// Run with: `bun run tools/step-world-wasm-bench.ts`
//
// Answers the ACTUAL production question — not "is Zig fast natively"
// (sim/bench/step_world_bench.zig answers that), but "is calling step_world
// through the JS<->wasm boundary, the way the real client/server hosts
// actually do it, faster than the TS-native stepWithRuntime path it would
// replace." Same 8-player load as client/bench/simTick.bench.ts so the two
// numbers are honestly comparable, not apples-to-oranges.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../client/src/sim/wasm/loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldMapSize,
  setWorldStatics,
} from "../client/src/sim/wasm/worldWasmBackend";
import { wasmHost } from "../client/src/sim/wasm/wasmHost";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../client/src/sim/wasm/writeFireConfigs";
import {
  PlayerId,
  Tick,
  type PlayerEntity,
  type WorldState,
} from "../client/src/sim/types";

const WASM_PATH = resolve(
  import.meta.dir,
  "..",
  "client/src/sim/wasm/sim.wasm",
);
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
await loadSimFromBytes(ab);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm")) {
    return Promise.resolve(
      new Response(ab as ArrayBuffer, {
        headers: { "Content-Type": "application/wasm" },
      }),
    );
  }
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;
await preloadWasmWorldSim();
await wasmHost.preload();

const PLAYERS = 8;
const DT_MS = 1000 / 60;
const WARMUP_TICKS = 600;
const MEASURE_TICKS = 3000;
const MAP_W = 1600;
const MAP_H = 900;

function makePlayer(i: number): PlayerEntity {
  const angle = (i / PLAYERS) * Math.PI * 2;
  return {
    id: PlayerId(`p${i}`),
    characterId: "balanced",
    x: 800 + Math.cos(angle) * 500,
    y: 450 + Math.sin(angle) * 300,
    vx: 0,
    vy: 0,
    aimX: 800,
    aimY: 450,
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

let state: WorldState = {
  tick: Tick(0),
  rngState: 1,
  players: Object.fromEntries(
    Array.from({ length: PLAYERS }, (_, i) => [PlayerId(`p${i}`), makePlayer(i)]),
  ) as Record<PlayerId, PlayerEntity>,
  projectiles: {},
  destructibles: {},
  firePatches: {},
  pickups: {},
  satellites: {},
  round: {
    phase: "fighting",
    countdownRemainingMs: 90_000,
    scores: {},
    roundIndex: 1,
    winnerPlayerId: null,
  },
};

setWorldStatics([], []);
setWorldMapSize(MAP_W, MAP_H);
const FireBit = 1 << 6;
const inputs = new Map(
  Array.from({ length: PLAYERS }, (_, i) => [
    `p${i}`,
    { keys: i % 2 === 0 ? FireBit : 0, prevKeys: 0, aimX: 800, aimY: 450 },
  ]),
);
(globalThis as {
  __jakesjam_wasm_inputs__?: ReadonlyMap<
    string,
    { keys: number; prevKeys: number; aimX: number; aimY: number }
  >;
}).__jakesjam_wasm_inputs__ = inputs;

for (let t = 0; t < WARMUP_TICKS; t++) {
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(state);
  state = applyWasmWorldStepFullSync(state, DT_MS).state;
}

const samples: number[] = [];
let heapBefore = 0;
if (typeof Bun !== "undefined") heapBefore = process.memoryUsage().heapUsed;
for (let t = 0; t < MEASURE_TICKS; t++) {
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(state);
  const start = Bun.nanoseconds();
  state = applyWasmWorldStepFullSync(state, DT_MS).state;
  samples.push(Bun.nanoseconds() - start);
}
const heapAfter = process.memoryUsage().heapUsed;

samples.sort((a, b) => a - b);
const avgNs = samples.reduce((a, b) => a + b, 0) / samples.length;
const p50Ns = samples[Math.floor(samples.length * 0.5)]!;
const p99Ns = samples[Math.floor(samples.length * 0.99)]!;
const maxNs = samples[samples.length - 1]!;
const projCount = Object.keys(state.projectiles).length;

console.log(
  `step_world VIA WASM (JS boundary, includes pack/unpack + fire-config resolve) — players=${PLAYERS} ticks=${MEASURE_TICKS} steady-state projectiles=${projCount}`,
);
console.log(
  `ms/tick avg=${(avgNs / 1e6).toFixed(3)} p50=${(p50Ns / 1e6).toFixed(3)} p99=${(p99Ns / 1e6).toFixed(3)} max=${(maxNs / 1e6).toFixed(3)}`,
);
console.log(
  `heap growth ≈ ${((heapAfter - heapBefore) / 1e6).toFixed(1)} MB over ${MEASURE_TICKS} ticks (pre-GC churn indicator — TS-side pack/unpack still allocates per tick even though Zig's own state doesn't)`,
);
