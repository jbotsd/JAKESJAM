// Cross-impl parity: TS rng (V8) vs Zig rng (wasm) must produce
// byte-identical sequences for the same seed. This is the
// foundational test of the Zig→WASM substrate thesis (ADR-0006):
// the same bytecode running on V8 (browser predict) and JSC (Bun
// auth server) cannot drift, because the wasm spec mandates IEEE
// 754 reproducibility.
//
// If this test ever goes red, the substrate has stopped working
// or the TS impl has drifted; either way, the netcode reconcile
// loop is broken until it's fixed.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { nextU32, nextFloat, nextInt } from "../../rng";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

interface RngExports {
  rng_next_u32(state: number): number;
  rng_next_int(state: number, min: number, maxExclusive: number): bigint;
}

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const mod = await WebAssembly.compile(ab);
const inst = await WebAssembly.instantiate(mod, {});
const wasmRng = inst.exports as unknown as RngExports;

const SEEDS: ReadonlyArray<number> = [
  0,
  1,
  42,
  1234567,
  0x80000000 >>> 0, // high bit set
  0xffffffff,
  0xdeadbeef,
];

describe("rng parity (TS V8 vs Zig wasm)", () => {
  test("nextU32: 1000-step sequence matches bit-exact for many seeds", () => {
    for (const seed of SEEDS) {
      let tsState = seed;
      let wasmState = seed;
      for (let i = 0; i < 1000; i++) {
        tsState = nextU32(tsState);
        // Wasm returns i32 view of the u32 result; coerce to unsigned.
        wasmState = wasmRng.rng_next_u32(wasmState) >>> 0;
        if (tsState !== wasmState) {
          throw new Error(
            `Mismatch at seed=${seed} step=${i}: ts=${tsState} wasm=${wasmState}`,
          );
        }
      }
      expect(tsState).toBe(wasmState);
    }
  });

  test("nextInt: range and value match TS for canned seeds", () => {
    for (const seed of [42, 1234, 99999]) {
      let tsState = seed;
      let wasmState = seed;
      for (let i = 0; i < 200; i++) {
        const [tsNext, tsVal] = nextInt(tsState, 0, 100);
        const packed = wasmRng.rng_next_int(wasmState, 0, 100);
        // Layout: hi 32 = new state, lo 32 = value (sign-extended).
        const wasmNext = Number((packed >> 32n) & 0xffffffffn);
        const lo = Number(packed & 0xffffffffn);
        const wasmVal = lo > 0x7fffffff ? lo - 0x100000000 : lo;
        expect(wasmNext).toBe(tsNext);
        expect(wasmVal).toBe(tsVal);
        tsState = tsNext;
        wasmState = wasmNext;
      }
    }
  });

  test("derived nextFloat values match within IEEE 754 exact equality", () => {
    // f = newState / 2^32 — this is IEEE 754 division, deterministic on
    // both sides per the wasm spec. We don't need an epsilon.
    let tsState = 31337;
    let wasmState = 31337;
    for (let i = 0; i < 500; i++) {
      const [tsNext, tsVal] = nextFloat(tsState);
      const wasmNext = wasmRng.rng_next_u32(wasmState) >>> 0;
      const wasmVal = wasmNext / 0x100000000;
      expect(wasmVal).toBe(tsVal);
      tsState = tsNext;
      wasmState = wasmNext;
    }
  });
});
