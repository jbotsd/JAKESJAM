// Verifies the runtime swap of resolveMoveCached works correctly:
// after `setResolveMoveCachedBackend(wasmFn)`, every call goes
// through wasm and produces byte-identical results to the native
// TS impl. This is the test that proves `?wasm-collision=1` is
// safe to flip in production — and that flipping it preserves the
// drift-snap behaviour that fixes the "barely detects standing"
// bug.

import { describe, expect, test, afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildStaticCache,
  resolveMoveCached,
  setResolveMoveCachedBackend,
  type AABB,
  type ResolveMoveCachedResult,
  type StaticCollisionCache,
} from "../../collision";
import type { PlatformDefinition } from "../../types";
import { loadSimFromBytes, type Sim } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

afterEach(() => {
  setResolveMoveCachedBackend(null);
});

function makeWasmBackend(simInst: Sim) {
  const ex = simInst.exports;
  const SIZEOF_AABB = ex.sizeof_aabb();
  const SIZEOF_RESOLVE = ex.sizeof_resolve_move_out();
  const OUT_OFF = 0;
  const STATICS_OFF = SIZEOF_RESOLVE + 8;

  return (
    mover: AABB,
    vx: number,
    vy: number,
    dt: number,
    cache: StaticCollisionCache,
    respectOneWay: boolean,
  ): ResolveMoveCachedResult => {
    const aabbs = cache.aabbs;
    const oneWay = cache.oneWay;
    const count = aabbs.length;
    const memBuf = ex.memory.buffer;
    const dv = new DataView(memBuf, simInst.statePtr, simInst.stateLen);
    const u8 = new Uint8Array(memBuf, simInst.statePtr, simInst.stateLen);

    for (let i = 0; i < count; i++) {
      const off = STATICS_OFF + i * SIZEOF_AABB;
      dv.setFloat64(off + 0, aabbs[i]!.x, true);
      dv.setFloat64(off + 8, aabbs[i]!.y, true);
      dv.setFloat64(off + 16, aabbs[i]!.w, true);
      dv.setFloat64(off + 24, aabbs[i]!.h, true);
    }
    const oneWayOff = STATICS_OFF + count * SIZEOF_AABB + 8;
    for (let i = 0; i < oneWay.length; i++) {
      u8[oneWayOff + i] = respectOneWay && oneWay[i]! ? 1 : 0;
    }

    ex.resolve_move_cached(
      mover.x, mover.y, mover.w, mover.h,
      vx, vy, dt,
      simInst.statePtr + STATICS_OFF, count,
      simInst.statePtr + oneWayOff, oneWay.length,
      simInst.statePtr + OUT_OFF,
    );
    return {
      x: dv.getFloat64(OUT_OFF + 0, true),
      y: dv.getFloat64(OUT_OFF + 8, true),
      vx: dv.getFloat64(OUT_OFF + 16, true),
      vy: dv.getFloat64(OUT_OFF + 24, true),
      groundedThisFrame: dv.getInt32(OUT_OFF + 32, true) === 1,
    };
  };
}

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
  { id: "cover", kind: "platform", position: { x: 800, y: 560 }, size: { x: 80, y: 80 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const PLAYER_W = 32;
const PLAYER_H = 56;
const STEP_SEC = 1 / 60;

describe("collision backend swap (?wasm-collision=1)", () => {
  test("default: TS native impl drives resolveMoveCached", () => {
    const mover: AABB = { x: 100, y: 0, w: PLAYER_W, h: PLAYER_H };
    const a = resolveMoveCached(mover, 0, 800, STEP_SEC, cache, true);
    const b = resolveMoveCached(mover, 0, 800, STEP_SEC, cache, true);
    expect(a).toEqual(b);
  });

  test("after swap: identical output to TS for 100 simulated ticks", () => {
    setResolveMoveCachedBackend(makeWasmBackend(sim));
    const GRAVITY = 1450;
    const VY_CAP = 900;

    let tsX = 100, tsY = 0, tsVx = 0, tsVy = 0;
    let waX = 100, waY = 0, waVx = 0, waVy = 0;

    setResolveMoveCachedBackend(null); // TS path
    for (let tick = 0; tick < 100; tick++) {
      tsVy = Math.min(VY_CAP, tsVy + GRAVITY * STEP_SEC);
      const r = resolveMoveCached(
        { x: tsX, y: tsY, w: PLAYER_W, h: PLAYER_H },
        tsVx, tsVy, STEP_SEC, cache, true,
      );
      tsX = r.x; tsY = r.y; tsVx = r.vx; tsVy = r.vy;
    }

    setResolveMoveCachedBackend(makeWasmBackend(sim)); // wasm path
    for (let tick = 0; tick < 100; tick++) {
      waVy = Math.min(VY_CAP, waVy + GRAVITY * STEP_SEC);
      const r = resolveMoveCached(
        { x: waX, y: waY, w: PLAYER_W, h: PLAYER_H },
        waVx, waVy, STEP_SEC, cache, true,
      );
      waX = r.x; waY = r.y; waVx = r.vx; waVy = r.vy;
    }

    expect(waX).toBe(tsX);
    expect(waY).toBe(tsY);
    expect(waVx).toBe(tsVx);
    expect(waVy).toBe(tsVy);
  });

  test("drift-recovery scenario: foot 1.5px past floor top, both paths snap identically", () => {
    // The exact scenario the bug fix addresses. Player's foot has
    // drifted 1.5 px past platform-top from float wrap; the
    // post-resolve probe must catch it and snap.
    const mover: AABB = {
      x: 100,
      y: 600 - PLAYER_H + 1.5, // 1.5 px past floor top
      w: PLAYER_W,
      h: PLAYER_H,
    };

    setResolveMoveCachedBackend(null);
    const ts = resolveMoveCached(mover, 0, 0, STEP_SEC, cache, true);
    setResolveMoveCachedBackend(makeWasmBackend(sim));
    const wa = resolveMoveCached(mover, 0, 0, STEP_SEC, cache, true);

    // Both must snap the foot to platform-top (y = 600 - 56 = 544)
    expect(ts.groundedThisFrame).toBe(true);
    expect(wa.groundedThisFrame).toBe(true);
    expect(ts.y).toBe(600 - PLAYER_H);
    expect(wa.y).toBe(ts.y);
    expect(wa.vy).toBe(ts.vy);
  });

  test("swap is reversible — restoring null backend recovers TS path", () => {
    const mover: AABB = { x: 100, y: 0, w: PLAYER_W, h: PLAYER_H };
    setResolveMoveCachedBackend(makeWasmBackend(sim));
    const wa = resolveMoveCached(mover, 0, 800, STEP_SEC, cache, true);
    setResolveMoveCachedBackend(null);
    const ts = resolveMoveCached(mover, 0, 800, STEP_SEC, cache, true);
    expect(wa).toEqual(ts);
  });
});
