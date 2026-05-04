// Cross-impl parity for destructible math primitives (Phase F1e).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { centerToAABB } from "../../collision";
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

interface DestExports {
  destructible_apply_damage(hp: number, damage: number): number;
  destructible_player_in_blast(
    cx: number, cy: number, blastRadius: number,
    px: number, py: number, playerRadius: number,
  ): number;
  destructible_center_to_aabb(
    cx: number, cy: number, w: number, h: number, outPtr: number,
  ): void;
  sizeof_aabb(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & DestExports;

const PLAYER_RADIUS = 18;
const EXPLOSION_RADIUS = 80;

const OUT_OFF = 0;
function readAABB() {
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    x: dv.getFloat64(sim.statePtr + OUT_OFF + 0, true),
    y: dv.getFloat64(sim.statePtr + OUT_OFF + 8, true),
    w: dv.getFloat64(sim.statePtr + OUT_OFF + 16, true),
    h: dv.getFloat64(sim.statePtr + OUT_OFF + 24, true),
  };
}

describe("destructible parity (TS V8 vs Zig wasm)", () => {
  test("HP damage application clamps at 0", () => {
    const cases: Array<[number, number]> = [
      [100, 20],
      [50, 50],
      [10, 30], // overshoots → 0
      [0, 5],
      [200, 0], // no damage
      [100, 99.5],
    ];
    for (const [hp, damage] of cases) {
      const ts = Math.max(0, hp - damage);
      expect(ex.destructible_apply_damage(hp, damage)).toBe(ts);
    }
  });

  test("blast-radius squared-distance check", () => {
    // Player at center → always in blast
    expect(ex.destructible_player_in_blast(100, 100, EXPLOSION_RADIUS, 100, 100, PLAYER_RADIUS)).toBe(1);
    // Player far outside → never in blast
    expect(ex.destructible_player_in_blast(100, 100, EXPLOSION_RADIUS, 500, 500, PLAYER_RADIUS)).toBe(0);
    // Player exactly at boundary (treat <= as in)
    const boundary = EXPLOSION_RADIUS + PLAYER_RADIUS; // 98
    expect(ex.destructible_player_in_blast(0, 0, EXPLOSION_RADIUS, boundary, 0, PLAYER_RADIUS)).toBe(1);
    // 1px outside boundary
    expect(ex.destructible_player_in_blast(0, 0, EXPLOSION_RADIUS, boundary + 1, 0, PLAYER_RADIUS)).toBe(0);
  });

  test("blast 200 random fixtures match TS reference", () => {
    let s = 0xb1a57_cab >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const cx = range(0, 1000);
      const cy = range(0, 1000);
      const px = range(cx - 150, cx + 150);
      const py = range(cy - 150, cy + 150);
      const dx = px - cx;
      const dy = py - cy;
      const total = EXPLOSION_RADIUS + PLAYER_RADIUS;
      const ts = dx * dx + dy * dy <= total * total;
      const wa = ex.destructible_player_in_blast(cx, cy, EXPLOSION_RADIUS, px, py, PLAYER_RADIUS) === 1;
      if (ts !== wa) mismatches++;
      if (ts) hits++;
    }
    expect(mismatches).toBe(0);
    expect(hits).toBeGreaterThan(20);
  });

  test("center→AABB matches collision.centerToAABB", () => {
    const cases: Array<[number, number, number, number]> = [
      [100, 200, 64, 64],
      [0, 0, 32, 80],
      [500.5, 300.7, 18, 18],
    ];
    for (const [cx, cy, w, h] of cases) {
      const ts = centerToAABB(cx, cy, w, h);
      ex.destructible_center_to_aabb(cx, cy, w, h, sim.statePtr + OUT_OFF);
      const wa = readAABB();
      expect(wa.x).toBe(ts.x);
      expect(wa.y).toBe(ts.y);
      expect(wa.w).toBe(ts.w);
      expect(wa.h).toBe(ts.h);
    }
  });
});
