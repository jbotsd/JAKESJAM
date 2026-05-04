// Cross-impl parity for FNV1a-32 hash primitives — TS V8 vs Zig
// wasm. The hash drives the reconcile loop's per-entity skip
// decisions; if it ever differed across hosts, the netcode would
// silently route the wrong frames through the slow path.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

interface HashExports {
  hash_fnv1a_basis(): number;
  hash_fnv1a_mix(hash: number, byte: number): number;
  hash_mix_u32(hash: number, v: number): number;
  hash_quantise(value: number, grid: number): number;
}
const ex = sim.exports as unknown as typeof sim.exports & HashExports;

// TS reference impls (private inside hash.ts — duplicate exact
// algorithm here so the test is self-contained and verifiable).
const FNV1A_PRIME_32 = 0x01000193;
const FNV1A_BASIS_32 = 0x811c9dc5;

function tsFnv1aMix(hash: number, byte: number): number {
  return (Math.imul(hash ^ (byte & 0xff), FNV1A_PRIME_32) ^ (FNV1A_BASIS_32 >>> 16)) >>> 0;
}
function tsMixU32(hash: number, v: number): number {
  const n = v >>> 0;
  let h = hash;
  h = tsFnv1aMix(h, n & 0xff);
  h = tsFnv1aMix(h, (n >>> 8) & 0xff);
  h = tsFnv1aMix(h, (n >>> 16) & 0xff);
  h = tsFnv1aMix(h, (n >>> 24) & 0xff);
  return h;
}

describe("hash parity (TS V8 vs Zig wasm)", () => {
  test("FNV1A_BASIS_32 constant matches", () => {
    expect(ex.hash_fnv1a_basis() >>> 0).toBe(FNV1A_BASIS_32);
  });

  test("fnv1aMix bit-identical across 256 bytes from the basis", () => {
    for (let byte = 0; byte < 256; byte++) {
      const ts = tsFnv1aMix(FNV1A_BASIS_32, byte);
      const wa = ex.hash_fnv1a_mix(FNV1A_BASIS_32, byte) >>> 0;
      expect(wa).toBe(ts);
    }
  });

  test("mixU32 bit-identical across 1000 randomised inputs", () => {
    let s = 0xdecaf_001 >>> 0;
    const r32 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s;
    };
    let h = FNV1A_BASIS_32;
    for (let i = 0; i < 1000; i++) {
      const v = r32();
      const tsNext = tsMixU32(h, v);
      const waNext = ex.hash_mix_u32(h, v) >>> 0;
      expect(waNext).toBe(tsNext);
      h = tsNext;
    }
  });

  test("quantise matches TS Math.round-then-truncate", () => {
    const cases: Array<[number, number]> = [
      [123.456, 0.01],
      [-50.7, 0.1],
      [0, 1],
      [1234567.89, 1],
      [-0.001, 0.01],
      [1500.5, 16.666666666666668], // STEP_MS-like grid
    ];
    for (const [value, grid] of cases) {
      const ts = Math.round(value / grid) | 0;
      const wa = ex.hash_quantise(value, grid);
      expect(wa).toBe(ts);
    }
  });

  test("end-to-end: FNV1a chain over a 12-byte LE struct matches", () => {
    // Simulate hashing a small struct's fields.
    const fields: Array<[number, number]> = [
      [12345, 0],   // x quantised
      [67890, 0],   // y quantised
      [42, 0],      // health
    ];
    let tsH = FNV1A_BASIS_32;
    let waH = FNV1A_BASIS_32;
    for (const [f] of fields) {
      tsH = tsMixU32(tsH, f);
      waH = ex.hash_mix_u32(waH, f) >>> 0;
    }
    expect(waH).toBe(tsH);
  });
});
