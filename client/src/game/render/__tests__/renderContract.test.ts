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
