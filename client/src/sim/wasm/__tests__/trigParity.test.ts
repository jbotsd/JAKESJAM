// Cross-impl parity for the comptime trig LUTs (Phase F2a).
// Both TS and wasm sample the SAME precomputed tables loaded from
// wasm memory at boot, so bit-equality is the design contract.
//
// If this test ever differs, the LUT install step has broken or
// the lookup math has drifted between sides.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  installLutTables,
  lutSin,
  lutCos,
  lutAtan2,
  lutTablesInstalled,
} from "../../trig";
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
  lut_sin(x: number): number;
  lut_cos(x: number): number;
  lut_atan2(y: number, x: number): number;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
};

const tableSize = ex.lut_table_size();
const sinPtr = ex.lut_sin_table_ptr();
const atanPtr = ex.lut_atan_table_ptr();
const sinView = new Float64Array(ex.memory.buffer, sinPtr, tableSize);
const atanView = new Float64Array(ex.memory.buffer, atanPtr, tableSize);
installLutTables(sinView, atanView);

describe("trig LUT parity (TS V8 vs Zig wasm)", () => {
  test("install actually populates the TS-side tables", () => {
    expect(lutTablesInstalled()).toBe(true);
    expect(tableSize).toBe(1024);
  });

  test("sin LUT matches across 4000 angles spanning many periods", () => {
    let mismatches = 0;
    for (let i = 0; i < 4000; i++) {
      // Sweep from -8π to +8π so we exercise quadrant + reduction.
      const x = -8 * Math.PI + (i / 4000) * 16 * Math.PI;
      const ts = lutSin(x);
      const wa = ex.lut_sin(x);
      if (ts !== wa) {
        mismatches++;
        if (mismatches < 3) {
          console.error(`sin mismatch at x=${x}: ts=${ts} wa=${wa}`);
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  test("cos LUT matches across same sweep", () => {
    let mismatches = 0;
    for (let i = 0; i < 4000; i++) {
      const x = -8 * Math.PI + (i / 4000) * 16 * Math.PI;
      const ts = lutCos(x);
      const wa = ex.lut_cos(x);
      if (ts !== wa) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  test("atan2 LUT matches across all 4 quadrants + edge cases", () => {
    let mismatches = 0;
    // Grid sweep covering positive/negative y/x and zero edges.
    const tested: number[][] = [];
    for (let yi = -10; yi <= 10; yi++) {
      for (let xi = -10; xi <= 10; xi++) {
        tested.push([yi * 0.7, xi * 0.7]);
      }
    }
    // Plus 1000 randomised
    let s = 0xc0ffee_99 >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();
    for (let i = 0; i < 1000; i++) {
      tested.push([range(-100, 100), range(-100, 100)]);
    }

    for (const [y, x] of tested) {
      const ts = lutAtan2(y!, x!);
      const wa = ex.lut_atan2(y!, x!);
      if (ts !== wa) {
        mismatches++;
        if (mismatches < 3) {
          console.error(`atan2 mismatch at y=${y} x=${x}: ts=${ts} wa=${wa}`);
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  test("LUT precision is within tolerance of Math.sin / Math.cos", () => {
    // Sanity: even though LUT is approximate, it should be close to
    // libm. Tolerance: 2× LUT step in absolute value.
    const tol = 0.01;
    for (const x of [0, 0.5, 1.0, Math.PI / 4, Math.PI / 2, Math.PI, 5.0, -3.0]) {
      expect(Math.abs(lutSin(x) - Math.sin(x))).toBeLessThan(tol);
      expect(Math.abs(lutCos(x) - Math.cos(x))).toBeLessThan(tol);
    }
  });
});
