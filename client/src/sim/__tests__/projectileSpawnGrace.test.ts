// Regression gate for a live-reported bug: shots fired at a steep upward
// angle vanished with zero visible travel — reproduced via Playwright at
// 20ms polling against a real host (0/30 samples ever showed the shot),
// while level-aimed shots from the identical position worked fine.
//
// Root cause: the muzzle (chest + wand-tip reach, see weapon.ts
// playerMuzzlePosition) can legitimately place a freshly-spawned projectile
// overlapping nearby static geometry — most easily hit aiming straight up,
// where the reach carries it toward a low ceiling. The terrain-collision
// check expired the projectile on literally its first motion tick, before
// any snapshot or render could ever observe it existing.
//
// Fix (mirrored in BOTH the TS oracle here and sim/src/projectile.zig
// stepV2, so parity holds): a projectile does not expire from a terrain
// overlap on the very first step since it was spawned (ageMs === 0).
// Normal terrain collision resumes on every subsequent tick — a projectile
// still overlapping geometry on tick 2 SHOULD expire; this is a one-tick
// grace, not a general terrain-collision bypass.

import { describe, expect, test } from "bun:test";
import { spawnProjectile, stepProjectile } from "../projectile.js";
import { buildStaticCache } from "../collision.js";
import { EntityId, PlayerId, Tick } from "../types.js";
import type { PlatformDefinition } from "../types.js";

const CEILING: PlatformDefinition = {
  id: "ceiling",
  position: { x: 100, y: 100 },
  size: { x: 200, y: 20 },
  kind: "floor",
};

function baseCtx(dtMs: number, tick: number, rngState: number) {
  return {
    platforms: [CEILING],
    players: {},
    dtMs,
    tick: Tick(tick),
    rngState,
    collisionCache: buildStaticCache([CEILING], 2000, 2000),
  };
}

describe("projectile spawn-inside-geometry grace (cached path)", () => {
  test("a projectile spawned overlapping static geometry survives its first tick", () => {
    const proj = spawnProjectile(EntityId(1), {
      ownerId: PlayerId("shooter"),
      origin: { x: 150, y: 105 }, // inside CEILING's AABB
      aimAngle: 0,
      speed: 400,
      damage: 10,
      lifetimeMs: 2000,
    });
    const result = stepProjectile(proj, baseCtx(16.67, 0, 12345));
    expect(result.expired).toBe(false);
    expect(result.projectile).not.toBeNull();
  });

  test("the same overlap on tick 2 DOES expire it — grace is first-tick only, not a bypass", () => {
    const proj = spawnProjectile(EntityId(1), {
      ownerId: PlayerId("shooter"),
      origin: { x: 150, y: 105 },
      aimAngle: 0,
      speed: 0, // stays in the same overlapping spot
      damage: 10,
      lifetimeMs: 2000,
    });
    const first = stepProjectile(proj, baseCtx(16.67, 0, 12345));
    expect(first.expired).toBe(false);

    const second = stepProjectile(first.projectile!, baseCtx(16.67, 1, first.rngState));
    expect(second.expired).toBe(true);
  });

  test("a projectile spawned in clear space (never overlapping) is unaffected either tick", () => {
    const proj = spawnProjectile(EntityId(1), {
      ownerId: PlayerId("shooter"),
      origin: { x: 500, y: 500 }, // nowhere near CEILING
      aimAngle: 0,
      speed: 300,
      damage: 10,
      lifetimeMs: 2000,
    });
    const first = stepProjectile(proj, baseCtx(16.67, 0, 12345));
    expect(first.expired).toBe(false);
    const second = stepProjectile(first.projectile!, baseCtx(16.67, 1, first.rngState));
    expect(second.expired).toBe(false);
  });
});

describe("projectile spawn-inside-geometry grace (legacy brute-force path)", () => {
  function legacyCtx(dtMs: number, tick: number, rngState: number) {
    return { platforms: [CEILING], players: {}, dtMs, tick: Tick(tick), rngState }; // no collisionCache
  }

  test("survives its first tick even via the uncached fallback", () => {
    const proj = spawnProjectile(EntityId(1), {
      ownerId: PlayerId("shooter"),
      origin: { x: 150, y: 105 },
      aimAngle: 0,
      speed: 400,
      damage: 10,
      lifetimeMs: 2000,
    });
    const result = stepProjectile(proj, legacyCtx(16.67, 0, 12345));
    expect(result.expired).toBe(false);
  });

  test("still expires on tick 2 via the uncached fallback (grace is first-tick only)", () => {
    const proj = spawnProjectile(EntityId(1), {
      ownerId: PlayerId("shooter"),
      origin: { x: 150, y: 105 },
      aimAngle: 0,
      speed: 0,
      damage: 10,
      lifetimeMs: 2000,
    });
    const first = stepProjectile(proj, legacyCtx(16.67, 0, 12345));
    expect(first.expired).toBe(false);
    const second = stepProjectile(first.projectile!, legacyCtx(16.67, 1, first.rngState));
    expect(second.expired).toBe(true);
  });
});
