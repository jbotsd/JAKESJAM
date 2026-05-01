// Fire patches: lifetime decay, DoT applied to alive non-owner overlappers,
// owner-self-damage exclusion. Pure inputs, deterministic.

import { describe, test, expect } from "bun:test";
import { stepFirePatches } from "../fire.js";
import type { EntityId, FireEntity, PlayerEntity, PlayerId } from "../types.js";

function mkPlayer(id: PlayerId, x: number, y: number, alive = true): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: 0,
  };
}

function mkPatch(id: EntityId, overrides: Partial<FireEntity> = {}): FireEntity {
  return {
    id,
    ownerId: "a",
    x: 100,
    y: 100,
    radius: 36,
    remainingMs: 1000,
    damagePerSecond: 14,
    ...overrides,
  };
}

describe("stepFirePatches", () => {
  test("decrements remainingMs each tick", () => {
    const patches = { 1: mkPatch(1, { remainingMs: 100 }) };
    const result = stepFirePatches(patches, {}, 16.667);
    expect(result.firePatches[1]?.remainingMs).toBeCloseTo(83.333, 2);
  });

  test("despawns when remaining hits 0", () => {
    const patches = { 1: mkPatch(1, { remainingMs: 10 }) };
    const result = stepFirePatches(patches, {}, 16.667);
    expect(result.firePatches[1]).toBeUndefined();
  });

  test("DoT damages alive non-owner overlappers", () => {
    const patches = {
      1: mkPatch(1, {
        x: 100,
        y: 100,
        radius: 36,
        ownerId: "a",
        damagePerSecond: 14,
        remainingMs: 2000,
      }),
    };
    const players = {
      a: mkPlayer("a", 100, 100), // owner, excluded
      b: mkPlayer("b", 110, 100), // overlapping
      c: mkPlayer("c", 500, 500), // far away
      d: mkPlayer("d", 110, 100, false), // dead, excluded
    };
    const result = stepFirePatches(patches, players, 1000);
    const hits = result.events.filter((e) => e.t === "hit-confirmed");
    expect(hits.length).toBe(1);
    if (hits[0]?.t === "hit-confirmed") {
      expect(hits[0].victimId).toBe("b");
      expect(hits[0].damage).toBeCloseTo(14, 4);
      expect(hits[0].sourceProjectileId).toBeNull();
    }
  });

  test("no overlap → no damage event", () => {
    const patches = { 1: mkPatch(1, { x: 0, y: 0, radius: 10 }) };
    const players = { b: mkPlayer("b", 1000, 1000) };
    const result = stepFirePatches(patches, players, 16.667);
    expect(result.events).toEqual([]);
  });
});
