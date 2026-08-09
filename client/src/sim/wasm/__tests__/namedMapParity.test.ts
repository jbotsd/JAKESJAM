// gospel N-MAP — the named maps in the core must be the SAME maps.
//
// `sim/src/data/maps_gen.zig` is generated from the TS map files, which
// stay the single source of truth. Generated is not the same as correct:
// the codegen converts centre+size to corner+size and re-derives the
// one-way flags, and either could be wrong in a way no Zig-side test would
// notice, because the Zig side has nothing to compare against.
//
// This is that comparison. For every named map, the geometry the core
// carries is checked against what `buildStaticCache` builds from the TS
// definition — the exact structure the TS sim collides against. If someone
// edits a platform and forgets `bun run gen:maps`, this fails.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { WORLD_STATE_TOTAL_SIZE } from "../worldStateBridge";
import { buildStaticCache } from "../../collision";
import type { MapDefinition } from "../../types";
import { boxworks } from "../../data/boxworks";
import { boxworksMini } from "../../data/boxworks-mini";
import { boxworksTower } from "../../data/boxworks-tower";
import { boxworksPractice } from "../../data/boxworks-practice";
import { vesselNexus } from "../../data/vessel-nexus";
import { skyseam } from "../../data/skyseam";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  named_map_geometry: (idPtr: number, idLen: number, out: number) => number;
  named_map_count: () => number;
};

// Scratch well past the world state, same arrangement as mapGenParity.
const idPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 256;
const scratch = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 1024;
const NEED = 64 * 1024;
if (ex.memory.buffer.byteLength < scratch + NEED) {
  ex.memory.grow(Math.ceil((scratch + NEED - ex.memory.buffer.byteLength) / 65536));
}

function zigMap(id: string) {
  const idBytes = new TextEncoder().encode(id);
  new Uint8Array(ex.memory.buffer, idPtr, idBytes.length).set(idBytes);
  const n = ex.named_map_geometry(idPtr, idBytes.length, scratch);
  if (n === 0) return null;
  const dv = new DataView(ex.memory.buffer, scratch, n * 8);
  let i = 0;
  const rd = (): number => dv.getFloat64((i++) * 8, true);

  const staticCount = rd();
  const statics: { x: number; y: number; w: number; h: number; oneWay: boolean }[] = [];
  for (let k = 0; k < staticCount; k++) {
    statics.push({ x: rd(), y: rd(), w: rd(), h: rd(), oneWay: rd() === 1 });
  }
  const spawnCount = rd();
  const spawns: { x: number; y: number }[] = [];
  for (let k = 0; k < spawnCount; k++) spawns.push({ x: rd(), y: rd() });
  return { statics, spawns, width: rd(), height: rd() };
}

const MAPS: MapDefinition[] = [
  boxworks as MapDefinition,
  boxworksMini,
  boxworksTower,
  boxworksPractice,
  vesselNexus,
  skyseam,
];

describe("N-MAP — named maps are byte-identical between TS and the core", () => {
  test("the core carries every named map the client knows", () => {
    // Vacuity guard: without this, deleting a map from the codegen would
    // simply reduce the number of per-map tests that run, and the suite
    // would still be green.
    expect(ex.named_map_count()).toBe(MAPS.length);
  });

  for (const m of MAPS) {
    test(`${m.id}: statics, one-way flags, spawns and size all match`, () => {
      const zig = zigMap(m.id);
      expect(zig, `core has no map "${m.id}" — did you run \`bun run gen:maps\`?`).not.toBeNull();

      // The TS side of the comparison is the cache the TS sim ACTUALLY
      // collides against, not a re-derivation written for this test.
      const cache = buildStaticCache(m.platforms, m.size.x, m.size.y, m.slopes ?? []);

      expect(zig!.statics.length).toBe(cache.aabbs.length);
      for (let i = 0; i < cache.aabbs.length; i++) {
        const a = cache.aabbs[i]!;
        const z = zig!.statics[i]!;
        expect({ x: z.x, y: z.y, w: z.w, h: z.h }).toEqual({ x: a.x, y: a.y, w: a.w, h: a.h });
        expect(z.oneWay).toBe(cache.oneWay[i]!);
      }

      expect(zig!.spawns).toEqual(m.spawns.map((s) => ({ x: s.x, y: s.y })));
      expect(zig!.width).toBe(m.size.x);
      expect(zig!.height).toBe(m.size.y);
    });
  }

  test("an unknown id returns nothing rather than a substituted map", () => {
    expect(zigMap("definitely-not-a-map")).toBeNull();
  });

  test("at least one map genuinely has one-way platforms", () => {
    // Guards the comparison above from passing trivially: if every flag on
    // both sides were false, the one-way half of this test would prove
    // nothing at all.
    const anyOneWay = MAPS.some((m) => (zigMap(m.id)?.statics ?? []).some((s) => s.oneWay));
    expect(anyOneWay).toBe(true);
  });
});
