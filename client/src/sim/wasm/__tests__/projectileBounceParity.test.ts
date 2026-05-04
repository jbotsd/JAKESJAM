// Cross-impl parity for the bounce-resolve + anti-homing helpers
// (Phase F1a finish). Validates the bounce-vs-static reflection
// math (vx/vy reflection + nudge-back) and the anti-homing target
// mirror computation.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildStaticCache } from "../../collision";
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
const ex = sim.exports as unknown as typeof sim.exports & {
  projectile_bounce_resolve(
    cx: number, cy: number, prevX: number, prevY: number,
    vx: number, vy: number, radius: number, bouncesRemaining: number,
    staticsPtr: number, staticsCount: number, outPtr: number,
  ): void;
  projectile_anti_homing_target(
    x: number, y: number, tx: number, ty: number,
    outTxPtr: number, outTyPtr: number,
  ): void;
  sizeof_bounce_resolve(): number;
};
const SIZEOF_BR = ex.sizeof_bounce_resolve();
const SIZEOF_AABB = ex.sizeof_aabb();
expect(SIZEOF_BR).toBe(48);

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "wall-r", kind: "wall", position: { x: 1240, y: 480 }, size: { x: 32, y: 320 } },
  { id: "wall-l", kind: "wall", position: { x: 40, y: 480 }, size: { x: 32, y: 320 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const STATICS = cache.aabbs;

const STATICS_OFF = 0;
const BR_OUT_OFF = STATICS.length * SIZEOF_AABB + 8;
const ANTI_OUT_OFF = BR_OUT_OFF + SIZEOF_BR + 8;

function packStatics(): void {
  const dv = new DataView(sim.exports.memory.buffer);
  for (let i = 0; i < STATICS.length; i++) {
    const o = sim.statePtr + STATICS_OFF + i * SIZEOF_AABB;
    dv.setFloat64(o + 0, STATICS[i]!.x, true);
    dv.setFloat64(o + 8, STATICS[i]!.y, true);
    dv.setFloat64(o + 16, STATICS[i]!.w, true);
    dv.setFloat64(o + 24, STATICS[i]!.h, true);
  }
}
packStatics();

function readBR() {
  const dv = new DataView(sim.exports.memory.buffer);
  const o = sim.statePtr + BR_OUT_OFF;
  return {
    bounced: dv.getInt32(o + 0, true) === 1,
    hitIndex: dv.getInt32(o + 4, true),
    newVx: dv.getFloat64(o + 8, true),
    newVy: dv.getFloat64(o + 16, true),
    newX: dv.getFloat64(o + 24, true),
    newY: dv.getFloat64(o + 32, true),
    newBouncesRemaining: dv.getInt32(o + 40, true),
  };
}

function callBounceResolve(
  cx: number, cy: number, px: number, py: number,
  vx: number, vy: number, radius: number, bounces: number,
) {
  ex.projectile_bounce_resolve(
    cx, cy, px, py, vx, vy, radius, bounces,
    sim.statePtr + STATICS_OFF, STATICS.length,
    sim.statePtr + BR_OUT_OFF,
  );
  return readBR();
}

// TS reference — mirrors the Zig kernel exactly.
function refBounceResolve(
  cx: number, cy: number, px: number, py: number,
  vx: number, vy: number, radius: number, bounces: number,
) {
  if (bounces <= 0) {
    return {
      bounced: false, hitIndex: -1,
      newVx: vx, newVy: vy, newX: cx, newY: cy,
      newBouncesRemaining: bounces,
    };
  }
  // Find first overlapping AABB; reuse circleBounceCached behaviour.
  let hit: { index: number; reflectX: boolean; reflectY: boolean } | null = null;
  for (let i = 0; i < STATICS.length; i++) {
    const a = STATICS[i]!;
    const closestX = Math.max(a.x, Math.min(cx, a.x + a.w));
    const closestY = Math.max(a.y, Math.min(cy, a.y + a.h));
    const dx = cx - closestX;
    const dy = cy - closestY;
    if (dx * dx + dy * dy > radius * radius) continue;
    const left = a.x - radius;
    const right = a.x + a.w + radius;
    const top = a.y - radius;
    const bottom = a.y + a.h + radius;
    let reflectX = false;
    let reflectY = false;
    if (px <= left || px >= right) reflectX = true;
    else if (py <= top || py >= bottom) reflectY = true;
    else {
      const dxEdge = Math.min(Math.abs(cx - left), Math.abs(cx - right));
      const dyEdge = Math.min(Math.abs(cy - top), Math.abs(cy - bottom));
      if (dxEdge < dyEdge) reflectX = true; else reflectY = true;
    }
    hit = { index: i, reflectX, reflectY };
    break;
  }
  if (!hit) {
    return {
      bounced: false, hitIndex: -1,
      newVx: vx, newVy: vy, newX: cx, newY: cy,
      newBouncesRemaining: bounces,
    };
  }
  let bvx = vx;
  let bvy = vy;
  if (hit.reflectX) bvx = -vx;
  if (hit.reflectY) bvy = -vy;
  const lenRaw = Math.sqrt(bvx * bvx + bvy * bvy);
  const len = lenRaw === 0 ? 1 : lenRaw;
  const nudge = Math.max(1, radius * 0.5);
  return {
    bounced: true,
    hitIndex: hit.index,
    newVx: bvx, newVy: bvy,
    newX: px + (bvx / len) * nudge,
    newY: py + (bvy / len) * nudge,
    newBouncesRemaining: bounces - 1,
  };
}

describe("projectile bounce-resolve + anti-homing parity (TS V8 vs Zig wasm)", () => {
  test("bounces=0 returns input unchanged", () => {
    const ts = refBounceResolve(100, 605, 100, 580, 0, 200, 6, 0);
    const wa = callBounceResolve(100, 605, 100, 580, 0, 200, 6, 0);
    expect(wa).toEqual(ts);
  });

  test("downward shot into floor reflects vy", () => {
    // Project hitting top of floor (y=600 to y=640).
    const ts = refBounceResolve(100, 605, 100, 580, 0, 200, 6, 3);
    const wa = callBounceResolve(100, 605, 100, 580, 0, 200, 6, 3);
    expect(wa.bounced).toBe(true);
    expect(wa).toEqual(ts);
    // Reflection should flip vy
    expect(wa.newVy).toBe(-200);
  });

  test("horizontal shot into right wall reflects vx", () => {
    const ts = refBounceResolve(1235, 540, 1180, 540, 800, 0, 6, 2);
    const wa = callBounceResolve(1235, 540, 1180, 540, 800, 0, 6, 2);
    expect(wa.bounced).toBe(true);
    expect(wa).toEqual(ts);
    expect(wa.newVx).toBe(-800);
  });

  test("100 randomised fixtures: bounce results match", () => {
    let s = 0xfeed_beef >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    let bounceCount = 0;
    for (let i = 0; i < 100; i++) {
      const cx = range(0, 1280);
      const cy = range(0, 720);
      const px = cx - range(-30, 30);
      const py = cy - range(-30, 30);
      const vx = range(-500, 500);
      const vy = range(-500, 500);
      const radius = range(2, 12);
      const bounces = Math.floor(range(0, 5));
      const ts = refBounceResolve(cx, cy, px, py, vx, vy, radius, bounces);
      const wa = callBounceResolve(cx, cy, px, py, vx, vy, radius, bounces);
      if (
        wa.bounced !== ts.bounced ||
        wa.hitIndex !== ts.hitIndex ||
        wa.newVx !== ts.newVx ||
        wa.newVy !== ts.newVy ||
        wa.newX !== ts.newX ||
        wa.newY !== ts.newY ||
        wa.newBouncesRemaining !== ts.newBouncesRemaining
      ) mismatches++;
      if (ts.bounced) bounceCount++;
    }
    expect(mismatches).toBe(0);
  });

  test("anti-homing target mirrors correctly: (2x-tx, 2y-ty)", () => {
    const dv = new DataView(sim.exports.memory.buffer);
    const txPtr = sim.statePtr + ANTI_OUT_OFF;
    const tyPtr = txPtr + 8;

    ex.projectile_anti_homing_target(100, 200, 150, 300, txPtr, tyPtr);
    expect(dv.getFloat64(txPtr, true)).toBe(50); // 2*100 - 150
    expect(dv.getFloat64(tyPtr, true)).toBe(100); // 2*200 - 300

    // Edge: x == target → mirror lands at x (target moves away).
    ex.projectile_anti_homing_target(0, 0, 10, 10, txPtr, tyPtr);
    expect(dv.getFloat64(txPtr, true)).toBe(-10);
    expect(dv.getFloat64(tyPtr, true)).toBe(-10);
  });
});
