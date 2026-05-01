// Static + swept AABB collision behavior. Covers the slab-method math and the
// resolveMove slide path that the player and projectile movement layers both
// rely on. If these go wrong, every entity goes through walls.

import { describe, test, expect } from "bun:test";
import {
  aabbOverlap,
  pointInAABB,
  circleOverlapsAABB,
  sweepAABB,
  resolveMove,
  type AABB,
} from "../collision.js";

const box = (x: number, y: number, w: number, h: number): AABB => ({ x, y, w, h });

describe("aabbOverlap", () => {
  test("clearly overlapping boxes overlap", () => {
    expect(aabbOverlap(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
  });

  test("clearly separated boxes do not overlap", () => {
    expect(aabbOverlap(box(0, 0, 10, 10), box(20, 20, 10, 10))).toBe(false);
  });

  test("edge-touching boxes do NOT count as overlap (strict inequalities)", () => {
    // a's right edge (x=10) meets b's left edge (x=10).
    expect(aabbOverlap(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
  });
});

describe("pointInAABB", () => {
  test("point inside box is inside", () => {
    expect(pointInAABB(5, 5, box(0, 0, 10, 10))).toBe(true);
  });

  test("point outside box is outside", () => {
    expect(pointInAABB(15, 5, box(0, 0, 10, 10))).toBe(false);
  });
});

describe("circleOverlapsAABB", () => {
  test("circle fully inside box overlaps", () => {
    expect(circleOverlapsAABB(5, 5, 1, box(0, 0, 10, 10))).toBe(true);
  });

  test("circle far outside does not overlap", () => {
    expect(circleOverlapsAABB(100, 100, 5, box(0, 0, 10, 10))).toBe(false);
  });

  test("circle near a corner overlaps once radius reaches the expanded box", () => {
    // Box at [0,10] in x and y. Circle center at (12, 12), radius 3 → expanded
    // box covers [-3, 13] in both axes, so the point (12,12) is inside.
    expect(circleOverlapsAABB(12, 12, 3, box(0, 0, 10, 10))).toBe(true);
    // Same circle, smaller radius → no longer overlaps.
    expect(circleOverlapsAABB(12, 12, 1, box(0, 0, 10, 10))).toBe(false);
  });
});

describe("sweepAABB", () => {
  test("returns null when there is no contact this step", () => {
    // Mover at origin moving up; target sits to the right out of path.
    const mover = box(0, 0, 10, 10);
    const target = box(50, 0, 10, 10);
    const hit = sweepAABB(mover, 0, -100, 1, [target]);
    expect(hit).toBeNull();
  });

  test("head-on horizontal collision returns t in [0,1] with normal pointing back at mover", () => {
    // Mover at (0,0) 10x10 moving right at vx=100, dt=1 → travels 100 px.
    // Target at (20,0) 10x10. Mover's right edge is at x=10. Contact at
    // mover.x = 10 → t = 10/100 = 0.1, normal nx = -1, ny = 0.
    const mover = box(0, 0, 10, 10);
    const target = box(20, 0, 10, 10);
    const hit = sweepAABB(mover, 100, 0, 1, [target]);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThanOrEqual(0);
    expect(hit!.t).toBeLessThanOrEqual(1);
    expect(hit!.t).toBeCloseTo(0.1, 5);
    expect(hit!.nx).toBe(-1);
    expect(hit!.ny).toBe(0);
    expect(hit!.index).toBe(0);
  });
});

describe("resolveMove", () => {
  test("slides along a wall — no penetration, parallel velocity preserved", () => {
    // 10x10 mover at (0,0) tries to move (100, 50) over dt=1 into a wall on the
    // right (target spans x=15..25, y=-100..100). Should stop at the wall in x
    // but keep moving in y.
    const mover = box(0, 0, 10, 10);
    const wall = box(15, -100, 10, 200);
    const result = resolveMove(mover, 100, 50, 1, [wall]);

    // No penetration: mover's right edge must be ≤ wall's left edge.
    expect(result.x + 10).toBeLessThanOrEqual(15);
    // Parallel velocity (y) is preserved; perpendicular is zeroed.
    expect(result.vx).toBe(0);
    expect(result.vy).toBe(50);
    // Y movement happened (got to ~50 over the remaining time after the x stop).
    expect(result.y).toBeGreaterThan(0);
    expect(result.groundedThisFrame).toBe(false);
  });

  test("reports groundedThisFrame=true when landing on a floor from above", () => {
    // 10x10 mover at (0,0) moving straight down into a floor at y=20.
    const mover = box(0, 0, 10, 10);
    const floor = box(-100, 20, 200, 10);
    const result = resolveMove(mover, 0, 200, 1, [floor]);

    expect(result.groundedThisFrame).toBe(true);
    expect(result.vy).toBe(0);
    // Mover's bottom edge must not cross into the floor.
    expect(result.y + 10).toBeLessThanOrEqual(20 + 1e-3);
  });
});
