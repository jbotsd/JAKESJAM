// Destructible step: projectile vs box overlap, AOE on explosive break,
// fire-patch seed on flammable + fire-element shard. Pure inputs, deterministic.

import { describe, test, expect } from "bun:test";
import {
  EXPLOSION_DAMAGE,
  EXPLOSION_RADIUS,
  FIRE_PATCH_DEFAULT_DPS,
  FIRE_PATCH_DEFAULT_LIFETIME_MS,
  FIRE_PATCH_DEFAULT_RADIUS,
  stepDestructibles,
} from "../destructible.js";
import { EntityId, InputSeq, PlayerId, Tick } from "../types.js";
import type {
  DestructibleEntity,
  PlayerEntity,
  ProjectileEntity,
} from "../types.js";

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
    lastProcessedInputSeq: InputSeq(0),
  };
}

function mkProj(
  id: EntityId,
  ownerId: PlayerId,
  x: number,
  y: number,
  overrides: Partial<ProjectileEntity> = {},
): ProjectileEntity {
  return {
    id,
    ownerId,
    x,
    y,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 20,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ...overrides,
  };
}

function mkDestructible(
  id: EntityId,
  overrides: Partial<DestructibleEntity> = {},
): DestructibleEntity {
  return {
    id,
    kind: "box",
    x: 100,
    y: 100,
    width: 40,
    height: 40,
    health: 30,
    explosive: false,
    flammable: false,
    ...overrides,
  };
}

describe("stepDestructibles", () => {
  test("projectile that overlaps a destructible damages it and despawns", () => {
    const dests: Record<EntityId, DestructibleEntity> = {
      [EntityId(1)]: mkDestructible(EntityId(1), { health: 50 }),
    };
    const projs: Record<EntityId, ProjectileEntity> = {
      [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 100, 100, { damage: 20 }),
    };
    const players: Record<PlayerId, PlayerEntity> = {
      [PlayerId("a")]: mkPlayer(PlayerId("a"), 0, 0),
    };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    expect(result.destructibles[EntityId(1)]?.health).toBe(30);
    expect(result.projectiles[EntityId(10)]).toBeUndefined();
    expect(result.events).toEqual([]);
    expect(result.spawnedFire).toEqual([]);
  });

  test("projectile that breaks a non-explosive box emits destructible-broken only", () => {
    const dests = { [EntityId(1)]: mkDestructible(EntityId(1), { health: 10 }) };
    const projs = { [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 100, 100, { damage: 20 }) };
    const players = { [PlayerId("a")]: mkPlayer(PlayerId("a"), 0, 0), [PlayerId("b")]: mkPlayer(PlayerId("b"), 110, 110) };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    expect(result.destructibles[EntityId(1)]).toBeUndefined();
    expect(result.events.length).toBe(1);
    expect(result.events[0]).toMatchObject({
      t: "destructible-broken",
      entityId: EntityId(1),
      x: 100,
      y: 100,
    });
    expect(result.spawnedFire).toEqual([]);
  });

  test("breaking an explosive barrel deals AOE to alive non-owner players in range", () => {
    const dests = {
      [EntityId(1)]: mkDestructible(EntityId(1), { kind: "barrel", explosive: true, health: 10 }),
    };
    const projs = { [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 100, 100, { damage: 50 }) };
    const players = {
      [PlayerId("a")]: mkPlayer(PlayerId("a"), 100, 100), // owner — excluded from AOE
      [PlayerId("b")]: mkPlayer(PlayerId("b"), 130, 100), // close, in range
      [PlayerId("c")]: mkPlayer(PlayerId("c"), 100 + EXPLOSION_RADIUS + 50, 100), // far, out of range
      [PlayerId("d")]: mkPlayer(PlayerId("d"), 110, 100, false), // dead, excluded
    };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    const hitEvents = result.events.filter((e) => e.t === "hit-confirmed");
    expect(hitEvents.length).toBe(1);
    expect(hitEvents[0]).toMatchObject({
      t: "hit-confirmed",
      victimId: PlayerId("b"),
      damage: EXPLOSION_DAMAGE,
      sourceProjectileId: null,
    });
  });

  test("breaking a flammable destructible with a fire-element shard spawns a fire patch", () => {
    const dests = {
      [EntityId(1)]: mkDestructible(EntityId(1), { flammable: true, health: 10, x: 200, y: 150 }),
    };
    const projs = {
      [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 200, 150, { damage: 50, element: "fire" }),
    };
    const players = { [PlayerId("a")]: mkPlayer(PlayerId("a"), 0, 0) };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    expect(result.spawnedFire.length).toBe(1);
    expect(result.spawnedFire[0]).toMatchObject({
      ownerId: PlayerId("a"),
      x: 200,
      y: 150,
      radius: FIRE_PATCH_DEFAULT_RADIUS,
      lifetimeMs: FIRE_PATCH_DEFAULT_LIFETIME_MS,
      damagePerSecond: FIRE_PATCH_DEFAULT_DPS,
    });
  });

  test("flammable but non-fire shard does not spawn a fire patch", () => {
    const dests = { [EntityId(1)]: mkDestructible(EntityId(1), { flammable: true, health: 10 }) };
    const projs = {
      [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 100, 100, { damage: 50, element: "crystal" }),
    };
    const players = { [PlayerId("a")]: mkPlayer(PlayerId("a"), 0, 0) };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    expect(result.spawnedFire).toEqual([]);
  });

  test("projectile not overlapping any destructible passes through untouched", () => {
    const dests = { [EntityId(1)]: mkDestructible(EntityId(1), { x: 100, y: 100 }) };
    const projs = { [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 500, 500) };
    const players = { [PlayerId("a")]: mkPlayer(PlayerId("a"), 0, 0) };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    expect(result.destructibles[EntityId(1)]?.health).toBe(30);
    expect(result.projectiles[EntityId(10)]).toBeDefined();
  });

  test("one projectile only damages one destructible per tick", () => {
    const dests = {
      [EntityId(1)]: mkDestructible(EntityId(1), { x: 100, y: 100 }),
      [EntityId(2)]: mkDestructible(EntityId(2), { x: 110, y: 100 }),
    };
    const projs = { [EntityId(10)]: mkProj(EntityId(10), PlayerId("a"), 105, 100, { damage: 20 }) };
    const players = { [PlayerId("a")]: mkPlayer(PlayerId("a"), 0, 0) };
    const result = stepDestructibles(dests, projs, players, 16.667, Tick(1));
    const damaged = Object.values(result.destructibles).filter((d) => d.health < 30);
    expect(damaged.length).toBe(1);
  });
});
