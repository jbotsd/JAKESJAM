import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
// Convert Buffer to a fresh ArrayBuffer view so WebAssembly.instantiate
// gets a clean BufferSource.
const buf = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);

describe("sim.wasm ping-pong (Phase A)", () => {
  test("loads, allocates state, and exposes a non-zero state buffer", async () => {
    const sim = await loadSimFromBytes(buf);
    expect(sim.stateLen).toBeGreaterThan(0);
    expect(sim.statePtr).toBeGreaterThanOrEqual(0);
    expect(sim.currentTick()).toBe(0);
  });

  test("step() advances current_tick deterministically", async () => {
    const sim = await loadSimFromBytes(buf);
    sim.reset();
    sim.step(0, 0, 16);
    sim.step(0, 0, 16);
    sim.step(0, 0, 16);
    expect(sim.currentTick()).toBe(3);
  });

  test("step() mutates the first u32 of state buffer", async () => {
    const sim = await loadSimFromBytes(buf);
    sim.reset();
    for (let i = 0; i < 7; i++) sim.step(0, 0, 16);
    const view = sim.stateView();
    const counter = new DataView(
      view.buffer,
      view.byteOffset,
      4,
    ).getUint32(0, true);
    expect(counter).toBe(7);
  });

  test("reset() zeroes both the tick and the state counter", async () => {
    const sim = await loadSimFromBytes(buf);
    sim.step(0, 0, 16);
    sim.reset();
    expect(sim.currentTick()).toBe(0);
    const view = sim.stateView();
    const counter = new DataView(
      view.buffer,
      view.byteOffset,
      4,
    ).getUint32(0, true);
    expect(counter).toBe(0);
  });
});
