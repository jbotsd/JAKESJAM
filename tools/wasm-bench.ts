// Wasm vs TS performance benchmark for the JAKESJAM sim hot paths.
//
// Run with: `bun run tools/wasm-bench.ts`
//
// NOT a unit test — perf varies by host and we don't want CI flakes.
// This script exists so any contributor can run it locally and see
// the relative cost of wasm vs TS for each kernel; useful when
// deciding whether to swap a particular call site to wasm.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { nextU32Native } from "../client/src/sim/rng";
import {
  resolveMoveCached,
  setResolveMoveCachedBackend,
  buildStaticCache,
  type AABB,
} from "../client/src/sim/collision";
import {
  stepPlayer,
  setStepPlayerBackend,
  freshPlayerMovementMemory,
  JETPACK_MAX_FUEL,
} from "../client/src/sim/player";
import {
  installLutTables,
  lutSin,
  lutCos,
  lutAtan2,
} from "../client/src/sim/trig";
import type {
  PlatformDefinition,
  PlayerEntity,
  PlayerId,
  CharacterArchetype,
  InputSeq,
  InputBitfield,
} from "../client/src/sim/types";
import { loadSimFromBytes } from "../client/src/sim/wasm/loader";
import { makeStepPlayerWasmBackend } from "../client/src/sim/wasm/playerWasmBackend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "client", "public", "wasm", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

// Install LUT for TS-side trig comparison.
const tableSize = sim.exports.lut_table_size();
installLutTables(
  new Float64Array(sim.exports.memory.buffer, sim.exports.lut_sin_table_ptr(), tableSize),
  new Float64Array(sim.exports.memory.buffer, sim.exports.lut_atan_table_ptr(), tableSize),
);

function bench(name: string, iterations: number, fn: () => void): void {
  // Warm-up
  for (let i = 0; i < Math.min(iterations / 10, 1000); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsedMs = performance.now() - start;

  const nsPerOp = (elapsedMs * 1_000_000) / iterations;
  const opsPerSec = (iterations / elapsedMs) * 1000;
  const opsPerSecFmt = opsPerSec >= 1_000_000
    ? `${(opsPerSec / 1_000_000).toFixed(1)}M ops/s`
    : `${(opsPerSec / 1000).toFixed(1)}k ops/s`;
  console.log(
    `  ${name.padEnd(48)} ${nsPerOp.toFixed(1).padStart(10)} ns/op  ${opsPerSecFmt}`,
  );
}

console.log(`\n=== JAKESJAM wasm-vs-TS performance bench ===`);
console.log(`Wasm size: ${bytes.length} bytes`);
console.log(`Bun: ${Bun.version}`);
console.log("");

// ── Trig ─────────────────────────────────────────────────────────────────
console.log("Trig (1M iterations each):");
{
  const N = 1_000_000;
  const x = 1.234567;
  let acc = 0;
  bench("Math.sin(x)              [libm]      ", N, () => { acc += Math.sin(x); });
  bench("lutSin(x)                [TS LUT]    ", N, () => { acc += lutSin(x); });
  bench("ex.lut_sin(x)            [wasm LUT]  ", N, () => { acc += sim.exports.lut_sin(x); });
  bench("Math.cos(x)              [libm]      ", N, () => { acc += Math.cos(x); });
  bench("lutCos(x)                [TS LUT]    ", N, () => { acc += lutCos(x); });
  bench("ex.lut_cos(x)            [wasm LUT]  ", N, () => { acc += sim.exports.lut_cos(x); });
  bench("Math.atan2(y, x)         [libm]      ", N, () => { acc += Math.atan2(2, 1); });
  bench("lutAtan2(y, x)           [TS LUT]    ", N, () => { acc += lutAtan2(2, 1); });
  bench("ex.lut_atan2(y, x)       [wasm LUT]  ", N, () => { acc += sim.exports.lut_atan2(2, 1); });
  // Don't optimise away
  if (Number.isNaN(acc)) console.log("acc is NaN");
}

// ── RNG ──────────────────────────────────────────────────────────────────
console.log("\nRNG (1M iterations each):");
{
  const N = 1_000_000;
  let s = 1234567;
  bench("nextU32Native(s)         [TS]        ", N, () => { s = nextU32Native(s); });
  bench("ex.rng_next_u32(s)       [wasm]      ", N, () => { s = sim.exports.rng_next_u32(s) >>> 0; });
}

// ── Collision: resolveMoveCached ─────────────────────────────────────────
console.log("\nresolveMoveCached (100k iterations each):");
{
  const PLATFORMS: PlatformDefinition[] = [
    { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
    { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
    { id: "cover", kind: "platform", position: { x: 800, y: 560 }, size: { x: 80, y: 80 } },
  ];
  const cache = buildStaticCache(PLATFORMS, 1280, 720);
  const N = 100_000;
  const mover: AABB = { x: 100, y: 0, w: 32, h: 56 };

  setResolveMoveCachedBackend(null);
  bench("resolveMoveCached(...)   [TS native] ", N, () => {
    resolveMoveCached(mover, 0, 800, 1 / 60, cache, true);
  });

  // Note: server-side wasm backend swap requires the server's makeBackend
  // factory; for the bench we just measure raw wasm boundary cost.
}

// ── Player: stepPlayer ───────────────────────────────────────────────────
console.log("\nstepPlayer (50k iterations each):");
{
  const PLATFORMS: PlatformDefinition[] = [
    { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  ];
  const cache = buildStaticCache(PLATFORMS, 1280, 720);
  const N = 50_000;
  const player: PlayerEntity = {
    id: "p0" as PlayerId,
    characterId: "starter" as CharacterArchetype,
    x: 100, y: 200, vx: 0, vy: 0,
    aimX: 0, aimY: 0,
    health: 100, shieldActive: false, crouching: false, alive: true,
    weaponId: "scrap-rifle", cards: [], fireCooldownMs: 0, ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as InputSeq,
    jetpackFuel: JETPACK_MAX_FUEL,
  };
  const mem = freshPlayerMovementMemory();
  const curr: InputBitfield = 1 << 1; // Right
  const prev: InputBitfield = 0;
  const opts = { collisionCache: cache };

  setStepPlayerBackend(null);
  bench("stepPlayer(...)          [TS native] ", N, () => {
    stepPlayer(player, prev, curr, 0, 0, mem, [], 1000 / 60, opts);
  });

  setStepPlayerBackend(makeStepPlayerWasmBackend(sim));
  bench("stepPlayer(...)          [wasm swap] ", N, () => {
    stepPlayer(player, prev, curr, 0, 0, mem, [], 1000 / 60, opts);
  });
  setStepPlayerBackend(null);
}

console.log("");
