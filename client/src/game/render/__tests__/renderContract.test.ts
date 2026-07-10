import { describe, expect, test } from "bun:test";
import { produceProjectiles, type ProjectileRenderModel } from "../renderContract";
import type { WorldState } from "../../../sim/types";

function stateWithProjectiles(projs: Record<string, Partial<Record<string, unknown>>>): WorldState {
  const out: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(projs)) {
    out[id] = {
      x: 0, y: 0, vx: 1, vy: 0, radius: 5, element: "neutral", shape: "circle",
      pathing: "linear", ownerId: null, damage: 10, ...p,
    };
  }
  return { projectiles: out } as unknown as WorldState;
}

describe("produceProjectiles (render contract)", () => {
  test("maps sim fields and derives angle", () => {
    const s = stateWithProjectiles({ 7: { x: 10, y: 20, vx: 0, vy: 5 } });
    const pool: ProjectileRenderModel[] = [];
    const n = produceProjectiles(s, pool);
    expect(n).toBe(1);
    expect(pool[0]!.id).toBe(7);
    expect(pool[0]!.angle).toBeCloseTo(Math.PI / 2, 5);
    expect(pool[0]!.bodyAlpha).toBe(1);
  });

  test("sticky fuse pulses bodyAlpha below 1", () => {
    const s = stateWithProjectiles({ 1: { stickyFuseMs: 250 } });
    const pool: ProjectileRenderModel[] = [];
    produceProjectiles(s, pool);
    expect(pool[0]!.bodyAlpha).toBeLessThanOrEqual(1);
    expect(pool[0]!.bodyAlpha).toBeGreaterThanOrEqual(0.55);
  });

  test("zero-alloc steady state: pool objects are reused across frames", () => {
    const s = stateWithProjectiles({ 1: {}, 2: {} });
    const pool: ProjectileRenderModel[] = [];
    produceProjectiles(s, pool);
    const first = pool[0]!;
    const n = produceProjectiles(s, pool);
    expect(n).toBe(2);
    expect(pool[0]).toBe(first); // same object, mutated in place
    expect(pool.length).toBe(2); // pool did not grow on the second frame
  });

  test("defaults impact fields when absent", () => {
    const s = stateWithProjectiles({ 1: {} });
    const pool: ProjectileRenderModel[] = [];
    produceProjectiles(s, pool);
    expect(pool[0]!.impact).toBe("none");
    expect(pool[0]!.impactRadiusPx).toBe(0);
  });
});

import {
  makeDestructibleFlashState,
  produceDestructibles,
  produceSatellites,
  type DestructibleRenderModel,
  type SatelliteRenderModel,
} from "../renderContract";

function stateWithDestructibles(objs: Record<string, { health: number }>): WorldState {
  const out: Record<string, unknown> = {};
  for (const [id, o] of Object.entries(objs)) {
    out[id] = {
      id: Number(id), kind: "crate", x: 0, y: 0, width: 20, height: 20,
      health: o.health, explosive: false, flammable: false,
    };
  }
  return { destructibles: out } as unknown as WorldState;
}

describe("produceDestructibles (render contract)", () => {
  test("health drop flashes for the flash window, then clears", () => {
    const st = makeDestructibleFlashState();
    const pool: DestructibleRenderModel[] = [];
    produceDestructibles(stateWithDestructibles({ 1: { health: 100 } }), 1000, st, pool);
    expect(pool[0]!.flashing).toBe(false);
    produceDestructibles(stateWithDestructibles({ 1: { health: 80 } }), 1016, st, pool);
    expect(pool[0]!.flashing).toBe(true);
    produceDestructibles(stateWithDestructibles({ 1: { health: 80 } }), 1016 + 200, st, pool);
    expect(pool[0]!.flashing).toBe(false);
  });

  test("despawned ids are pruned from bookkeeping", () => {
    const st = makeDestructibleFlashState();
    const pool: DestructibleRenderModel[] = [];
    produceDestructibles(stateWithDestructibles({ 1: { health: 100 }, 2: { health: 50 } }), 0, st, pool);
    expect(st.prevHealth.size).toBe(2);
    produceDestructibles(stateWithDestructibles({ 2: { health: 50 } }), 16, st, pool);
    expect(st.prevHealth.size).toBe(1);
  });
});

describe("produceSatellites (render contract)", () => {
  test("resolves orbit position from the owner; skips dead owners", () => {
    const s = {
      players: { p1: { x: 100, y: 200 } },
      satellites: {
        5: { ownerId: "p1", angle: 0, orbitRadius: 50 },
        6: { ownerId: "ghost", angle: 0, orbitRadius: 50 },
      },
    } as unknown as WorldState;
    const pool: SatelliteRenderModel[] = [];
    const n = produceSatellites(s, pool);
    expect(n).toBe(1);
    expect(pool[0]!.id).toBe(5);
    expect(pool[0]!.x).toBeCloseTo(150, 5);
    expect(pool[0]!.y).toBeCloseTo(200, 5);
  });
});
