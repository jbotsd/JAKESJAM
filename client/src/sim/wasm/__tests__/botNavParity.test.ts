// gospel N-BOT (first slice) — the ported arena nav must decide the SAME
// things as the TS brain.
//
// `sim/src/bot_nav.zig` is a port of `server/src/botArenaNav.ts`. A port is
// only worth having if it agrees, and "agrees" here is not approximate:
// nearestCoverFlank picks by a strict `<` on a float score, so a reordered
// expression or a dropped `|| 1` fallback changes which cover a bot runs
// to without changing anything a coarse test would notice.
//
// So this drives both implementations over the real named maps with a grid
// of positions and compares every answer.
//
// WHAT THIS GATE CATCHES, measured by mutation rather than assumed:
//   - inverting the flank side (stand on the foe's side instead of away)
//     fails 3 tests;
//   - a stale/incorrect nav build fails the count comparison;
//   - LOS, hop-ledge choice and megaScale are compared exactly.
// WHAT IT DOES NOT CATCH: scaling the cover-flank score by 1.0001 passes.
// That is a property of the DATA, not a hole worth patching — cover
// candidates on these maps never score within 0.05 of each other, so no
// sub-0.05 perturbation can flip a ranking. Recorded so nobody reads
// "mutation-tested" as "every mutation dies"; the ranking between
// near-equal candidates is only weakly covered here.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { WORLD_STATE_TOTAL_SIZE } from "../worldStateBridge";
import {
  buildArenaNav,
  hasLineOfSight,
  nearestCoverFlank,
  hopTargetToward,
  megaScale,
  dirTowardX,
} from "../../../../../server/src/botArenaNav.ts";
import type { MapDefinition } from "../../types";
import { boxworksMini } from "../../data/boxworks-mini";
import { boxworksTower } from "../../data/boxworks-tower";
import { vesselNexus } from "../../data/vessel-nexus";
import { skyseam } from "../../data/skyseam";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  bot_nav_build: (ptr: number, count: number, w: number, h: number) => number;
  bot_nav_floor_top: () => number;
  bot_nav_has_los: (ax: number, ay: number, bx: number, by: number) => number;
  bot_nav_cover_flank: (x: number, y: number, foeX: number, maxDist: number, out: number) => void;
  bot_nav_hop_target: (
    x: number, top: number, foeX: number, foeY: number, maxRise: number, maxGap: number, out: number,
  ) => void;
  bot_nav_mega_scale: () => number;
  bot_nav_dir_toward_x: (a: number, b: number, dz: number) => number;
};

const platPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 4096;
const outPtr = platPtr + 64 * 1024;
const NEED = outPtr + 4096;
if (ex.memory.buffer.byteLength < NEED) {
  ex.memory.grow(Math.ceil((NEED - ex.memory.buffer.byteLength) / 65536));
}

const KIND = { floor: 0, wall: 1, platform: 2 } as const;
const isFloorId = (id: string): boolean => id === "floor" || id.startsWith("floor-");

/** Push a map's platforms into wasm in the flat form bot_nav_build wants. */
function loadNav(map: MapDefinition): void {
  const dv = new DataView(ex.memory.buffer, platPtr, map.platforms.length * 5 * 8);
  map.platforms.forEach((p, i) => {
    const base = i * 5;
    dv.setFloat64((base + 0) * 8, p.position.x, true);
    dv.setFloat64((base + 1) * 8, p.position.y, true);
    dv.setFloat64((base + 2) * 8, p.size.x, true);
    dv.setFloat64((base + 3) * 8, p.size.y, true);
    // kind + 8 when the id marks it a floor — `isFloorId` is the one thing
    // the TS builder reads from the string id.
    dv.setFloat64((base + 4) * 8, KIND[p.kind] + (isFloorId(p.id) ? 8 : 0), true);
  });
  ex.bot_nav_build(platPtr, map.platforms.length, map.size.x, map.size.y);
}

const readOut = (n: number): number[] => {
  const dv = new DataView(ex.memory.buffer, outPtr, n * 8);
  return Array.from({ length: n }, (_, i) => dv.getFloat64(i * 8, true));
};

const MAPS: MapDefinition[] = [boxworksMini, boxworksTower, vesselNexus, skyseam];

// Vacuity counters live at SUITE level, not per map. Not every map has a
// cover within flank range of every probe position — boxworks-tower has
// none at all — so a per-map "we found at least one" guard fails on a
// perfectly correct map. What actually needs proving is that the suite as
// a whole exercised the non-null branch somewhere.
let coverFlanksFound = 0;
let hopTargetsFound = 0;
let losBlocked = 0;
let losClear = 0;

describe("N-BOT — arena nav parity, Zig vs the TS brain", () => {
  for (const map of MAPS) {
    describe(map.id, () => {
      const tsNav = buildArenaNav(map);

      // loadNav() must run INSIDE each test, not in the describe body:
      // describe bodies all execute during collection, so the shared
      // platform buffer would hold whichever map was registered LAST by the
      // time any test actually ran. First version of this file did that and
      // reported vessel-nexus as having skyseam's cover count.
      test("compiles the same nav (cover/ledge counts, floor top)", () => {
        loadNav(map);
        const packed = ex.bot_nav_build(platPtr, map.platforms.length, map.size.x, map.size.y);
        expect(Math.floor(packed / 1000)).toBe(tsNav.covers.length);
        expect(packed % 1000).toBe(tsNav.ledges.length);
        expect(ex.bot_nav_floor_top()).toBe(tsNav.floorTop);
      });

      test("line of sight agrees across a position grid", () => {
        loadNav(map);
        let blocked = 0;
        let clear = 0;
        for (let ax = 60; ax < map.size.x; ax += 137) {
          for (let bx = 90; bx < map.size.x; bx += 211) {
            for (const y of [map.size.y - 60, map.size.y - 240]) {
              const wantClear = hasLineOfSight(tsNav, ax, y, bx, y);
              expect(ex.bot_nav_has_los(ax, y, bx, y) === 1).toBe(wantClear);
              if (wantClear) {
                clear += 1;
                losClear += 1;
              } else {
                blocked += 1;
                losBlocked += 1;
              }
            }
          }
        }
        // Per-map, an all-clear grid is a legitimate result — boxworks-tower
        // has no cover columns at all, so nothing there can block a sightline.
        // The "did we ever see a block" guard is suite-level, below.
        expect(clear + blocked).toBeGreaterThan(0);
      });

      test("cover flank picks the same cover", () => {
        loadNav(map);
        let found = 0;
        for (let meX = 80; meX < map.size.x; meX += 173) {
          for (const foeX of [meX + 400, meX - 400]) {
            const meY = map.size.y - 60;
            const want = nearestCoverFlank(tsNav, meX, meY, foeX, 420);
            ex.bot_nav_cover_flank(meX, meY, foeX, 420, outPtr);
            const got = readOut(4);
            if (want === null) {
              expect(got[0]).toBe(0);
            } else {
              found += 1;
              coverFlanksFound += 1;
              // coverCx is the decision; x/y are derived from it.
              expect({ x: got[1], y: got[2], cx: got[3] }).toEqual({
                x: want.x,
                y: want.y,
                cx: want.coverCx,
              });
            }
          }
        }
        // Agreement on "no cover here" is a real result; the suite-level
        // guard below proves the other branch ran too.
        expect(found).toBeGreaterThanOrEqual(0);
      });

      test("hop target picks the same ledge", () => {
        loadNav(map);
        let found = 0;
        for (let meX = 100; meX < map.size.x; meX += 191) {
          const meTop = map.size.y - 60;
          for (const foeY of [meTop - 120, meTop - 300]) {
            const want = hopTargetToward(tsNav, meX, meTop, meX + 200, foeY, 129, 220);
            ex.bot_nav_hop_target(meX, meTop, meX + 200, foeY, 129, 220, outPtr);
            const got = readOut(5);
            if (want === null) {
              expect(got[0]).toBe(0);
            } else {
              found += 1;
              hopTargetsFound += 1;
              expect({ cx: got[1], top: got[2], x0: got[3], x1: got[4] }).toEqual({
                cx: want.cx,
                top: want.top,
                x0: want.x0,
                x1: want.x1,
              });
            }
          }
        }
        // Not every map has hoppable ledges under a foe; assert only that
        // the suite as a whole exercised the found path (checked below).
        expect(found).toBeGreaterThanOrEqual(0);
      });

      test("megaScale matches", () => {
        loadNav(map);
        expect(ex.bot_nav_mega_scale()).toBe(megaScale(tsNav));
      });
    });
  }

  test("dirTowardX matches, including the deadzone edges", () => {
    for (const [from, to, dz] of [
      [0, 0, 18], [0, 18, 18], [0, 19, 18], [0, -18, 18], [0, -19, 18], [500, 100, 18],
    ] as const) {
      expect(ex.bot_nav_dir_toward_x(from, to, dz)).toBe(dirTowardX(from, to, dz));
    }
  });

  // Runs last: both comparisons above are null-heavy, and a suite where
  // every probe returned null would agree perfectly while testing nothing.
  test("the non-null branches were actually exercised somewhere", () => {
    expect(coverFlanksFound).toBeGreaterThan(0);
    expect(hopTargetsFound).toBeGreaterThan(0);
    // Both LOS outcomes must occur across the suite, or the agreement above
    // is agreement on a constant.
    expect(losBlocked).toBeGreaterThan(0);
    expect(losClear).toBeGreaterThan(0);
  });
});
