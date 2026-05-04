// Cross-impl parity for circle-vs-AABB primitives. These power the
// projectile collision path (`stepProjectile` calls
// `circleHitsAnyCached` and `circleBounceCached`). Once Phase C
// projectile.zig lands, projectile motion can call these wasm
// primitives directly — but for now we just lock the math.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  circleOverlapsAABB,
  circleHitsAnyCached,
  circleBounceCached,
  buildStaticCache,
  type AABB,
} from "../../collision";
import type { PlatformDefinition } from "../../types";
import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

interface CircleExports {
  circle_overlaps_aabb(
    cx: number, cy: number, radius: number,
    bx: number, by: number, bw: number, bh: number,
  ): number;
  circle_hits_any(
    cx: number, cy: number, radius: number,
    staticsPtr: number, staticsCount: number,
  ): number;
  circle_bounce(
    cx: number, cy: number, prevX: number, prevY: number, radius: number,
    staticsPtr: number, staticsCount: number,
    outPtr: number,
  ): number;
  sizeof_circle_bounce(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & CircleExports;
const SIZEOF_AABB = ex.sizeof_aabb();
const SIZEOF_BOUNCE = ex.sizeof_circle_bounce();
expect(SIZEOF_BOUNCE).toBe(16);

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
  { id: "cover", kind: "platform", position: { x: 800, y: 560 }, size: { x: 80, y: 80 } },
  { id: "wall", kind: "wall", position: { x: 1240, y: 480 }, size: { x: 32, y: 320 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const STATICS = cache.aabbs;

function packStatics(absPtr: number): void {
  const dv = new DataView(sim.exports.memory.buffer);
  for (let i = 0; i < STATICS.length; i++) {
    const off = absPtr + i * SIZEOF_AABB;
    dv.setFloat64(off + 0, STATICS[i]!.x, true);
    dv.setFloat64(off + 8, STATICS[i]!.y, true);
    dv.setFloat64(off + 16, STATICS[i]!.w, true);
    dv.setFloat64(off + 24, STATICS[i]!.h, true);
  }
}
const STATICS_OFF = 64;
packStatics(sim.statePtr + STATICS_OFF);
const STATICS_PTR = sim.statePtr + STATICS_OFF;

function readBounce(absOff: number) {
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    index: dv.getInt32(absOff + 0, true),
    reflectX: dv.getInt32(absOff + 4, true) === 1,
    reflectY: dv.getInt32(absOff + 8, true) === 1,
  };
}

describe("circle primitive parity (TS V8 vs Zig wasm)", () => {
  test("circleOverlapsAABB matches across 1000 randomised fixtures", () => {
    let s = 0xdeadbeef >>> 0;
    const r01 = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      const cx = range(-100, 1400);
      const cy = range(-100, 800);
      const radius = range(2, 32);
      const target: AABB = {
        x: range(0, 1280),
        y: range(0, 720),
        w: range(8, 200),
        h: range(8, 200),
      };
      const ts = circleOverlapsAABB(cx, cy, radius, target);
      const wa = ex.circle_overlaps_aabb(cx, cy, radius, target.x, target.y, target.w, target.h) === 1;
      if (ts !== wa) mismatches++;
      if (ts) hits++;
    }
    expect(mismatches).toBe(0);
    // Sanity: at least some random fixtures must produce a hit.
    expect(hits).toBeGreaterThanOrEqual(10);
  });

  test("circleHitsAny matches `circleHitsAnyCached` for many circles", () => {
    let s = 0xc0ffee_42 >>> 0;
    const r01 = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      const cx = range(0, 1280);
      const cy = range(0, 720);
      const radius = range(4, 24);
      const ts = circleHitsAnyCached(cx, cy, radius, cache);
      const wa = ex.circle_hits_any(cx, cy, radius, STATICS_PTR, STATICS.length);
      if (ts !== wa) {
        mismatches++;
        if (mismatches < 3) {
          console.error(`mismatch cx=${cx} cy=${cy} r=${radius} ts=${ts} wa=${wa}`);
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  test("circleBounce returns identical reflection axis", () => {
    type Fix = { cx: number; cy: number; px: number; py: number; r: number };
    // Realistic ricochet scenarios: shot crossing the floor, top of
    // platform, side of cover, side of wall.
    const FIXTURES: Fix[] = [
      // Shot from below, hits floor underside
      { cx: 200, cy: 615, px: 200, py: 580, r: 6 },
      // Shot from above, hits floor topside
      { cx: 200, cy: 605, px: 200, py: 595, r: 6 },
      // Shot crossing top of p1
      { cx: 400, cy: 478, px: 400, py: 460, r: 6 },
      // Shot hitting side of cover
      { cx: 765, cy: 580, px: 720, py: 580, r: 6 },
      // Shot hitting wall side
      { cx: 1230, cy: 540, px: 1180, py: 540, r: 6 },
      // Corner clipping (diagonal entry)
      { cx: 800, cy: 524, px: 760, py: 500, r: 6 },
    ];

    const outOff = STATICS_OFF + STATICS.length * SIZEOF_AABB + 8;
    for (const fx of FIXTURES) {
      const ts = circleBounceCached(fx.cx, fx.cy, fx.px, fx.py, fx.r, 0, 0, cache);
      const got = ex.circle_bounce(
        fx.cx, fx.cy, fx.px, fx.py, fx.r,
        STATICS_PTR, STATICS.length,
        sim.statePtr + outOff,
      );
      if (ts === null) {
        expect(got).toBe(0);
      } else {
        expect(got).toBe(1);
        const wa = readBounce(sim.statePtr + outOff);
        expect(wa.index).toBe(ts.index);
        expect(wa.reflectX).toBe(ts.reflectX);
        expect(wa.reflectY).toBe(ts.reflectY);
      }
    }
  });
});
