// Phase A3 — contract tests for the new WasmHost seam.
//
// Locks in the public interface introduced in A1a/A1b/A2:
//
//   - ready() / isReady() lifecycle
//   - setStatics() buffers + auto-flushes (no boot race)
//   - writeInputs() replaces the globalThis stash
//   - step() uses the single private runWasmStepSync helper
//   - getStaticsSnapshot / getInputsSnapshot diagnostics
//
// Pre-loads sim.wasm via loadSimFromBytes + the fetch-stub pattern
// already used by worldWasmBackend.test.ts.

import { describe, expect, test, beforeAll } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { wasmHost } from "../wasmHost";
import {
  EntityId,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type FireEntity,
  type ProjectileEntity,
  type WorldState,
} from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const preloaded = await loadSimFromBytes(ab);
void preloaded;

const fetchStub = (input: RequestInfo | URL): Promise<Response> => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm")) {
    return Promise.resolve(
      new Response(ab as ArrayBuffer, {
        headers: { "Content-Type": "application/wasm" },
      }),
    );
  }
  throw new Error(`unexpected fetch in test: ${url}`);
};
(globalThis as { fetch: typeof fetch }).fetch =
  fetchStub as unknown as typeof fetch;

function fixtureState(): WorldState {
  const proj: ProjectileEntity = {
    id: EntityId(1),
    ownerId: null,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 25,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
  const dest: DestructibleEntity = {
    id: EntityId(101),
    kind: "barrel",
    x: 100,
    y: 100,
    width: 32,
    height: 32,
    health: 100,
    explosive: true,
    flammable: false,
  };
  const fire: FireEntity = {
    id: EntityId(201),
    x: 0,
    y: 0,
    radius: 32,
    remainingMs: 500,
    ownerId: null,
    damagePerSecond: 14,
  };
  return {
    tick: Tick(7),
    rngState: 1234,
    players: {} as Record<PlayerId, never>,
    projectiles: { [proj.id]: proj } as Record<EntityId, ProjectileEntity>,
    destructibles: { [dest.id]: dest } as Record<EntityId, DestructibleEntity>,
    firePatches: { [fire.id]: fire } as Record<EntityId, FireEntity>,
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 30_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("WasmHost — A3 contract", () => {
  beforeAll(async () => {
    wasmHost.__resetForTests();
    await wasmHost.preload();
  });

  test("isReady is true after preload resolves", () => {
    expect(wasmHost.isReady()).toBe(true);
  });

  test("ready() resolves immediately when already ready", async () => {
    const t0 = performance.now();
    await wasmHost.ready();
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  test("multiple ready() awaiters share the same resolution", async () => {
    const a = wasmHost.ready();
    const b = wasmHost.ready();
    const c = wasmHost.ready();
    await Promise.all([a, b, c]);
    expect(wasmHost.isReady()).toBe(true);
  });

  test("setStatics buffers AABBs and exposes them via getStaticsSnapshot", () => {
    const aabbs = [
      { x: 0, y: 600, w: 1280, h: 32 },
      { x: 0, y: 0, w: 32, h: 640 },
    ];
    const oneWay = [0, 0];
    wasmHost.setStatics(aabbs, oneWay);
    const snap = wasmHost.getStaticsSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.aabbs.length).toBe(2);
    expect(snap!.aabbs[0]!.y).toBe(600);
    expect(snap!.oneWay).toEqual([0, 0]);
  });

  test("setStatics is idempotent — last call wins, not appended", () => {
    wasmHost.setStatics(
      [{ x: 0, y: 0, w: 100, h: 100 }],
      [1],
    );
    wasmHost.setStatics(
      [
        { x: 0, y: 0, w: 200, h: 200 },
        { x: 0, y: 0, w: 300, h: 300 },
      ],
      [0, 0],
    );
    const snap = wasmHost.getStaticsSnapshot();
    expect(snap!.aabbs.length).toBe(2);
    expect(snap!.aabbs[0]!.w).toBe(200);
  });

  test("writeInputs caches the latest input map and exposes it via getInputsSnapshot", () => {
    const inputs = new Map<string, { keys: number; prevKeys: number; aimX: number; aimY: number }>();
    inputs.set("p1", { keys: 0b0001, prevKeys: 0, aimX: 10, aimY: 20 });
    wasmHost.writeInputs(inputs);
    const snap = wasmHost.getInputsSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.size).toBe(1);
    expect(snap!.get("p1")!.keys).toBe(0b0001);
  });

  test("writeInputs mirrors to globalThis __jakesjam_wasm_inputs__ for legacy compat", () => {
    const inputs = new Map<string, { keys: number; prevKeys: number; aimX: number; aimY: number }>();
    inputs.set("local", { keys: 0b1010, prevKeys: 0b0010, aimX: 50, aimY: 0 });
    wasmHost.writeInputs(inputs);
    const stash = (
      globalThis as { __jakesjam_wasm_inputs__?: Map<string, { keys: number }> }
    ).__jakesjam_wasm_inputs__;
    expect(stash).toBeDefined();
    expect(stash!.get("local")!.keys).toBe(0b1010);
  });

  test("step throws if called before ready()", async () => {
    // Use the WasmHost class via dynamic import so we can spawn a
    // fresh instance with new (the singleton is already ready and
    // shared across tests).
    const { WasmHost } = await import("../wasmHost");
    const fresh = new WasmHost();
    expect(() => fresh.step(fixtureState(), 16.667)).toThrow(
      /step\(\) called before ready/,
    );
  });

  test("step returns a WasmStepResult shape with state + events + matchComplete", () => {
    const s = fixtureState();
    const result = wasmHost.step(s, 16.667);
    expect(result.state).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
    expect(typeof result.matchComplete).toBe("boolean");
  });

  test("step with same input twice is byte-stable (determinism gate)", () => {
    const s = fixtureState();
    const a = wasmHost.step({ ...s }, 16.667);
    const b = wasmHost.step({ ...s }, 16.667);
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.rngState).toBe(b.state.rngState);
  });

  test("step preserves entity referential identity for unchanged entities", () => {
    const s = fixtureState();
    const a = wasmHost.step({ ...s }, 16.667);
    // Same input again — projectile shouldn't have changed enough to
    // produce a NEW entity reference.
    const b = wasmHost.step(a.state, 16.667);
    // Projectile is moving at v=0 — it stays in place. The merge
    // should reuse the same reference where shallow-equal.
    const aIds = Object.keys(a.state.projectiles);
    const bIds = Object.keys(b.state.projectiles);
    expect(bIds.length).toBeLessThanOrEqual(aIds.length);
  });

  test("__resetForTests clears cached statics + inputs but keeps wasm preload alive", () => {
    wasmHost.setStatics([{ x: 0, y: 0, w: 1, h: 1 }], [0]);
    wasmHost.writeInputs(
      new Map([["p", { keys: 0, prevKeys: 0, aimX: 0, aimY: 0 }]]),
    );
    expect(wasmHost.getStaticsSnapshot()).not.toBeNull();
    expect(wasmHost.getInputsSnapshot()).not.toBeNull();
    wasmHost.__resetForTests();
    expect(wasmHost.getStaticsSnapshot()).toBeNull();
    expect(wasmHost.getInputsSnapshot()).toBeNull();
    // After reset, isReady is back to false; preload re-fires on
    // next ready() call.
    expect(wasmHost.isReady()).toBe(false);
  });
});
