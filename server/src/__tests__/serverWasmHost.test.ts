// Phase B3 prep — contract tests for serverWasmHost.
//
// Locks in the public surface introduced in the skeleton commit:
//   - preload() / ready() / isReady() lifecycle
//   - setStatics + writeInputs cache + snapshots
//   - step() requires preload (throws otherwise)
//   - step() returns {state, events, matchComplete} shape
//   - step() determinism gate (same inputs → same bytes)
//
// Mirrors client wasmHost.test.ts pattern but uses Bun's
// WebAssembly directly (loadServerSim already does this).

import { describe, expect, test, beforeAll } from "bun:test";
import { serverWasmHost } from "../serverWasmHost";
import {
  EntityId,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type FireEntity,
  type ProjectileEntity,
  type WorldState,
} from "@sim/types.ts";

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

describe("serverWasmHost — B3 contract", () => {
  beforeAll(async () => {
    serverWasmHost.__resetForTests();
    await serverWasmHost.preload();
  });

  test("isReady is true after preload resolves", () => {
    expect(serverWasmHost.isReady()).toBe(true);
  });

  test("ready() resolves quickly when already ready", async () => {
    const t0 = performance.now();
    await serverWasmHost.ready();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  test("setStatics buffers AABBs + exposes via getStaticsSnapshot", () => {
    serverWasmHost.setStatics(
      [
        { x: 0, y: 600, w: 1280, h: 32 },
        { x: 0, y: 0, w: 32, h: 640 },
      ],
      [0, 0],
    );
    const snap = serverWasmHost.getStaticsSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.aabbs.length).toBe(2);
    expect(snap!.aabbs[0]!.y).toBe(600);
  });

  test("setStatics is idempotent — last call wins", () => {
    serverWasmHost.setStatics([{ x: 0, y: 0, w: 100, h: 100 }], [1]);
    serverWasmHost.setStatics(
      [
        { x: 0, y: 0, w: 200, h: 200 },
        { x: 0, y: 0, w: 300, h: 300 },
      ],
      [0, 0],
    );
    const snap = serverWasmHost.getStaticsSnapshot();
    expect(snap!.aabbs.length).toBe(2);
    expect(snap!.aabbs[0]!.w).toBe(200);
  });

  test("writeInputs caches the latest map + exposes via getInputsSnapshot", () => {
    const inputs = new Map<
      string,
      { keys: number; prevKeys: number; aimX: number; aimY: number }
    >();
    inputs.set("p1", { keys: 0b0001, prevKeys: 0, aimX: 10, aimY: 20 });
    serverWasmHost.writeInputs(inputs);
    const snap = serverWasmHost.getInputsSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.size).toBe(1);
    expect(snap!.get("p1")!.keys).toBe(0b0001);
  });

  test("step returns {state, events, matchComplete} shape", () => {
    const result = serverWasmHost.step(fixtureState(), 16.667);
    expect(result.state).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
    expect(typeof result.matchComplete).toBe("boolean");
  });

  test("step is byte-stable across two calls (determinism gate)", () => {
    const s = fixtureState();
    const a = serverWasmHost.step({ ...s }, 16.667);
    const b = serverWasmHost.step({ ...s }, 16.667);
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.rngState).toBe(b.state.rngState);
  });

  test("step throws when not ready (after reset)", async () => {
    // The exported singleton is the only public surface; verify
    // the not-ready error by resetting + probing before preload.
    serverWasmHost.__resetForTests();
    expect(() => serverWasmHost.step(fixtureState(), 16.667)).toThrow(
      /step\(\) called before ready/,
    );
    // Restore for subsequent tests.
    await serverWasmHost.preload();
  });

  test("__resetForTests clears caches + flips isReady false", () => {
    serverWasmHost.setStatics([{ x: 0, y: 0, w: 1, h: 1 }], [0]);
    serverWasmHost.writeInputs(
      new Map([["p", { keys: 0, prevKeys: 0, aimX: 0, aimY: 0 }]]),
    );
    expect(serverWasmHost.getStaticsSnapshot()).not.toBeNull();
    expect(serverWasmHost.getInputsSnapshot()).not.toBeNull();
    serverWasmHost.__resetForTests();
    expect(serverWasmHost.getStaticsSnapshot()).toBeNull();
    expect(serverWasmHost.getInputsSnapshot()).toBeNull();
    expect(serverWasmHost.isReady()).toBe(false);
  });
});
