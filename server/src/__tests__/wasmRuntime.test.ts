// Server-side parity test for the Zig→WASM substrate (Phase D2,
// ADR-0006). Proves:
//
//   1. The server can load `client/public/wasm/sim.wasm` via Bun's
//      native WebAssembly support.
//   2. After `applyServerWasmCollision()`, the shared sim's
//      `resolveMoveCached` calls execute in Zig wasm.
//   3. Output is byte-identical to the TS native impl across
//      realistic platform scenarios — meaning the server's
//      authoritative collision now matches the client's predicted
//      collision bit-for-bit (when both sides have the flag set).
//
// This is the test that proves D2 is safe to flip in production.

import { afterEach, describe, expect, test } from "bun:test";
import {
  buildStaticCache,
  resolveMoveCached,
  setResolveMoveCachedBackend,
  type AABB,
} from "@sim/collision.ts";
import type { PlatformDefinition } from "@sim/types.ts";
import {
  applyServerWasmCollision,
  loadServerSim,
} from "../wasmRuntime.ts";

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
  { id: "cover", kind: "platform", position: { x: 800, y: 560 }, size: { x: 80, y: 80 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const PLAYER_W = 32;
const PLAYER_H = 56;
const STEP_SEC = 1 / 60;

afterEach(() => {
  setResolveMoveCachedBackend(null);
});

describe("server wasmRuntime (Phase D2)", () => {
  test("loadServerSim loads the .wasm artifact and instantiates", async () => {
    const got = await loadServerSim();
    expect(got).not.toBeNull();
    expect(got!.stateLen).toBeGreaterThan(0);
    expect(got!.statePtr).toBeGreaterThanOrEqual(0);
    expect(typeof got!.ex.resolve_move_cached).toBe("function");
  });

  test("after applyServerWasmCollision: resolveMoveCached runs in wasm and matches TS", async () => {
    setResolveMoveCachedBackend(null); // ensure TS path
    const tsResult = resolveMoveCached(
      { x: 100, y: 0, w: PLAYER_W, h: PLAYER_H },
      0, 800, STEP_SEC, cache, true,
    );

    await applyServerWasmCollision();

    const wasmResult = resolveMoveCached(
      { x: 100, y: 0, w: PLAYER_W, h: PLAYER_H },
      0, 800, STEP_SEC, cache, true,
    );

    expect(wasmResult.x).toBe(tsResult.x);
    expect(wasmResult.y).toBe(tsResult.y);
    expect(wasmResult.vx).toBe(tsResult.vx);
    expect(wasmResult.vy).toBe(tsResult.vy);
    expect(wasmResult.groundedThisFrame).toBe(tsResult.groundedThisFrame);
  });

  test("server-side wasm produces same output as a 60-tick TS-driven sim", async () => {
    const GRAVITY = 1450;
    const VY_CAP = 900;

    // Run TS native first.
    setResolveMoveCachedBackend(null);
    let tsX = 100, tsY = 0, tsVx = 0, tsVy = 0;
    for (let tick = 0; tick < 60; tick++) {
      tsVy = Math.min(VY_CAP, tsVy + GRAVITY * STEP_SEC);
      const r = resolveMoveCached(
        { x: tsX, y: tsY, w: PLAYER_W, h: PLAYER_H },
        tsVx, tsVy, STEP_SEC, cache, true,
      );
      tsX = r.x; tsY = r.y; tsVx = r.vx; tsVy = r.vy;
    }

    // Now run wasm-backed.
    await applyServerWasmCollision();
    let waX = 100, waY = 0, waVx = 0, waVy = 0;
    for (let tick = 0; tick < 60; tick++) {
      waVy = Math.min(VY_CAP, waVy + GRAVITY * STEP_SEC);
      const r = resolveMoveCached(
        { x: waX, y: waY, w: PLAYER_W, h: PLAYER_H },
        waVx, waVy, STEP_SEC, cache, true,
      );
      waX = r.x; waY = r.y; waVx = r.vx; waVy = r.vy;
    }

    expect(waX).toBe(tsX);
    expect(waY).toBe(tsY);
    expect(waVy).toBe(tsVy);
    // Sanity: both ended grounded on or near the floor.
    expect(tsY + PLAYER_H).toBeLessThanOrEqual(620);
  });

  test("drift-snap scenario: server wasm matches client wasm matches TS", async () => {
    // The exact bug scenario: foot 1.5 px past floor top, no velocity.
    const mover: AABB = {
      x: 100, y: 600 - PLAYER_H + 1.5, w: PLAYER_W, h: PLAYER_H,
    };

    setResolveMoveCachedBackend(null);
    const ts = resolveMoveCached(mover, 0, 0, STEP_SEC, cache, true);

    await applyServerWasmCollision();
    const wasm = resolveMoveCached(mover, 0, 0, STEP_SEC, cache, true);

    expect(ts.groundedThisFrame).toBe(true);
    expect(wasm.groundedThisFrame).toBe(true);
    // Both must snap the foot to platform-top exactly.
    expect(wasm.y).toBe(ts.y);
    expect(wasm.y).toBe(600 - PLAYER_H);
  });
});
