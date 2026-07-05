// Parity gate for mothballing mapGen.ts: the Zig map generator (map_gen.zig)
// must produce byte-identical arenas (platform geometry + spawns) to the TS
// generateArena for the same seed. Only once this holds can the host switch
// map authority to Zig and delete the TS generator. (Caught + fixed a real
// RNG-stream divergence: the Zig randFloat01 had used rng.nextU32 instead of
// the mulberry32 cursor TS uses.)

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { WORLD_STATE_TOTAL_SIZE } from "../worldStateBridge";
import { generateArena } from "../../data/mapGen";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  gen_arena_geometry: (seed: number, out: number) => number;
};
const scratch = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 512;
if (ex.memory.buffer.byteLength < scratch + 4096) {
  ex.memory.grow(Math.ceil((scratch + 4096 - ex.memory.buffer.byteLength) / 65536));
}

function zigGeom(seed: number) {
  const n = ex.gen_arena_geometry(seed, scratch);
  const dv = new DataView(ex.memory.buffer, scratch, n * 8);
  let i = 0;
  const rd = () => {
    const v = dv.getFloat64(i * 8, true);
    i++;
    return v;
  };
  const pc = rd();
  const plats: number[][] = [];
  for (let k = 0; k < pc; k++) { plats.push([rd(), rd(), rd(), rd()]); rd(); /* skip kind */ }
  const sc = rd();
  const spawns: number[][] = [];
  for (let k = 0; k < sc; k++) spawns.push([rd(), rd()]);
  const key = (a: number[][]) => a.slice().sort((x, y) => (x[0]! - y[0]!) || (x[1]! - y[1]!));
  return { plats: key(plats), spawns: key(spawns) };
}
function tsGeom(seed: number) {
  const m = generateArena(seed);
  const key = (a: number[][]) => a.slice().sort((x, y) => (x[0]! - y[0]!) || (x[1]! - y[1]!));
  return {
    plats: key(m.platforms.map((p) => [p.position.x, p.position.y, p.size.x, p.size.y])),
    spawns: key(m.spawns.map((s) => [s.x, s.y])),
  };
}

describe("Zig map_gen ≡ TS generateArena (geometry + spawns)", () => {
  test("50 seeds produce identical arenas", () => {
    for (let seed = 0; seed < 50; seed++) {
      const z = zigGeom(seed);
      const t = tsGeom(seed);
      expect(z.plats, `platforms seed ${seed}`).toEqual(t.plats);
      expect(z.spawns, `spawns seed ${seed}`).toEqual(t.spawns);
    }
  });
  test("large/edge seeds match", () => {
    for (const seed of [999, 12345, 54321, 0xfffffff, 1 << 20]) {
      expect(zigGeom(seed).plats, `seed ${seed}`).toEqual(tsGeom(seed).plats);
    }
  });
});
