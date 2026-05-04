// Verifies the runtime swap of the RNG backend works correctly:
// after `setRngBackend(wasmFn)`, every `nextU32` call indirects
// through wasm and produces byte-identical results to the native
// TS impl. This is the test that proves `?wasm-rng=1` is safe to
// flip in production.

import { describe, expect, test, afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  nextU32,
  nextU32Native,
  setRngBackend,
} from "../../rng";
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

afterEach(() => {
  setRngBackend(nextU32Native);
});

describe("rng backend swap (?wasm-rng=1)", () => {
  test("default backend is the TS native impl", () => {
    const seed = 1234567;
    const direct = nextU32Native(seed);
    const indirect = nextU32(seed);
    expect(indirect).toBe(direct);
  });

  test("after swap, nextU32 delegates to wasm and produces identical output", () => {
    setRngBackend((s) => sim.exports.rng_next_u32(s) >>> 0);
    for (const seed of [0, 1, 42, 1234567, 0xdeadbeef, 0xffffffff]) {
      let tsState = seed;
      let swappedState = seed;
      for (let i = 0; i < 1000; i++) {
        tsState = nextU32Native(tsState);
        swappedState = nextU32(swappedState);
        expect(swappedState).toBe(tsState);
      }
    }
  });

  test("swap is reversible — restoring native backend recovers behaviour", () => {
    setRngBackend((s) => sim.exports.rng_next_u32(s) >>> 0);
    const wasmRoute = nextU32(42);
    setRngBackend(nextU32Native);
    const tsRoute = nextU32(42);
    expect(wasmRoute).toBe(tsRoute);
  });

  test("backend can be replaced multiple times without state pollution", () => {
    let calls = 0;
    setRngBackend((s) => {
      calls++;
      return nextU32Native(s);
    });
    nextU32(1);
    nextU32(2);
    nextU32(3);
    setRngBackend(nextU32Native);
    nextU32(4); // should NOT increment calls
    expect(calls).toBe(3);
  });
});
