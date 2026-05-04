// Cross-impl parity for fire patch tick math (Phase F1e).
// fire.ts contains pure arithmetic so the only question is whether
// the wasm exports match the TS reference impl byte-for-byte.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { aabbOverlap, type AABB } from "../../collision";
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

interface FireExports {
  fire_patch_tick(remainingMs: number, dtMs: number, outPtr: number): void;
  fire_patch_damage(damagePerSecond: number, dtMs: number): number;
  fire_patch_hits_player(
    patchX: number, patchY: number, patchRadius: number,
    playerX: number, playerY: number, playerW: number, playerH: number,
  ): number;
  sizeof_fire_patch_tick_result(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & FireExports;
const SIZEOF_TICK_RESULT = ex.sizeof_fire_patch_tick_result();
expect(SIZEOF_TICK_RESULT).toBe(16);

const TICK_RESULT_OFF = 0;
function readTickResult() {
  const dv = new DataView(sim.exports.memory.buffer);
  const ptr = sim.statePtr + TICK_RESULT_OFF;
  return {
    newRemainingMs: dv.getFloat64(ptr + 0, true),
    alive: dv.getInt32(ptr + 8, true) === 1,
  };
}

const DT_MS = 1000 / 60;

describe("fire parity (TS V8 vs Zig wasm)", () => {
  test("tick lifetime decay matches TS arithmetic exactly", () => {
    // Drive a patch from 1800ms down to expiry, tick by tick.
    let tsRemaining = 1800;
    let waRemaining = 1800;
    let tick = 0;
    while (tsRemaining > 0 || waRemaining > 0) {
      // TS reference: patch.remainingMs - dtMs
      const tsNext = tsRemaining - DT_MS;
      const tsAlive = tsNext > 0;

      // Wasm
      ex.fire_patch_tick(waRemaining, DT_MS, sim.statePtr + TICK_RESULT_OFF);
      const wa = readTickResult();

      expect(wa.newRemainingMs).toBe(tsNext);
      expect(wa.alive).toBe(tsAlive);

      tsRemaining = tsAlive ? tsNext : -1;
      waRemaining = wa.alive ? wa.newRemainingMs : -1;
      tick++;
      if (tick > 200) break; // safety
    }
    // 1800 / 16.66... ≈ 108 ticks
    expect(tick).toBeGreaterThan(100);
    expect(tick).toBeLessThan(120);
  });

  test("damage per tick matches dps * dt arithmetic", () => {
    const cases: Array<[number, number]> = [
      [14, DT_MS],
      [28.5, DT_MS],
      [0, DT_MS],
      [100, 33.33],
      [14, 5],
    ];
    for (const [dps, dt] of cases) {
      const ts = dps * (dt / 1000);
      const wa = ex.fire_patch_damage(dps, dt);
      expect(wa).toBe(ts);
    }
  });

  test("AABB overlap matches `aabbOverlap` reference for 500 random fixtures", () => {
    let s = 0xfeed_face >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    let hits = 0;
    for (let i = 0; i < 500; i++) {
      const px = range(0, 1280);
      const py = range(0, 720);
      const pr = range(8, 64);
      const pX = range(0, 1280);
      const pY = range(0, 720);
      const pW = range(16, 64);
      const pH = range(40, 80);

      const patchAABB: AABB = {
        x: px - pr, y: py - pr, w: pr * 2, h: pr * 2,
      };
      const playerAABB: AABB = { x: pX, y: pY, w: pW, h: pH };
      const ts = aabbOverlap(patchAABB, playerAABB);

      const wa = ex.fire_patch_hits_player(px, py, pr, pX, pY, pW, pH) === 1;
      if (ts !== wa) mismatches++;
      if (ts) hits++;
    }
    expect(mismatches).toBe(0);
    expect(hits).toBeGreaterThanOrEqual(3);
  });
});
