// Tests for authority transfer: rewriting entity ownership when a player is
// evicted from the reconnect-grace window.

import { describe, test, expect } from "bun:test";
import { transferAuthority } from "@sim/authority.ts";
import { EntityId, InputSeq, PlayerId, Tick } from "@sim/types.ts";
import type {
  FireEntity,
  PlayerEntity,
  ProjectileEntity,
  SatelliteEntity,
  WorldState,
} from "@sim/types.ts";
import { stepProjectile } from "@sim/projectile.ts";

const A = PlayerId("player-a");
const B = PlayerId("player-b");

function mkPlayer(id: PlayerId, overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x: 200,
    y: 200,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

function mkProjectile(id: number, ownerId: PlayerId | null): ProjectileEntity {
  return {
    id: EntityId(id),
    ownerId,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 7,
    damage: 10,
    lifetimeMs: 5000,
    pathing: "straight",
    element: "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ageMs: 0,
    traveledPx: 0,
    originX: 100,
    originY: 100,
    returning: false,
  };
}

function mkFirePatch(id: number, ownerId: PlayerId | null): FireEntity {
  return {
    id: EntityId(id),
    ownerId,
    x: 100,
    y: 100,
    radius: 36,
    remainingMs: 1800,
    damagePerSecond: 14,
  };
}

function mkSatellite(id: number, ownerId: PlayerId | null): SatelliteEntity {
  return {
    id: EntityId(id),
    ownerId,
    angle: 0,
    orbitRadius: 80,
    fireCooldownMs: 600,
    lifetimeMs: Infinity,
  };
}

function mkState(
  projectiles: Record<number, ProjectileEntity> = {},
  firePatches: Record<number, FireEntity> = {},
  satellites: Record<number, SatelliteEntity> = {},
): WorldState {
  return {
    tick: Tick(1),
    rngState: 0,
    players: {
      [A]: mkPlayer(A),
      [B]: mkPlayer(B),
    },
    projectiles: projectiles as WorldState["projectiles"],
    destructibles: {} as WorldState["destructibles"],
    firePatches: firePatches as WorldState["firePatches"],
    pickups: {} as WorldState["pickups"],
    satellites: satellites as WorldState["satellites"],
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: { [A]: 0, [B]: 0 },
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

describe("transferAuthority", () => {
  test("1. projectile ownerId is rewritten to null", () => {
    const proj = mkProjectile(1, A);
    const state = mkState({ 1: proj });

    const next = transferAuthority(state, A, null);

    expect(next.projectiles[EntityId(1)]?.ownerId).toBeNull();
    // Original state is not mutated.
    expect(state.projectiles[EntityId(1)]?.ownerId).toBe(A);
  });

  test("2. satellite ownerId is rewritten to null", () => {
    const sat = mkSatellite(2, A);
    const state = mkState({}, {}, { 2: sat });

    const next = transferAuthority(state, A, null);

    expect(next.satellites[EntityId(2)]?.ownerId).toBeNull();
    expect(state.satellites[EntityId(2)]?.ownerId).toBe(A);
  });

  test("3. null-owned projectile hits its original owner (no exclusion)", () => {
    // Place player A at (200, 200). The projectile starts at (200, 193) heading
    // straight down — it will overlap A's hitbox on the first step.
    const proj: ProjectileEntity = {
      ...mkProjectile(1, null),
      x: 200,
      y: 193,
      vx: 0,
      vy: 300, // heading toward A
    };

    const players: Record<PlayerId, PlayerEntity> = {
      [A]: mkPlayer(A, { x: 200, y: 200 }),
    };

    const result = stepProjectile(proj, {
      platforms: [],
      players,
      dtMs: 16,
      tick: Tick(1),
      rngState: 0,
    });

    // Should register a hit — ownerId null means "no exclusion".
    const hitEvent = result.events.find(
      (e) => e.t === "hit-confirmed" && e.victimId === A,
    );
    expect(hitEvent).toBeDefined();
    expect(result.expired).toBe(true);
  });

  test("4. second call to transferAuthority with same oldOwner is a no-op", () => {
    const proj = mkProjectile(1, A);
    const state = mkState({ 1: proj });

    const first = transferAuthority(state, A, null);
    // ownerId is already null after first call.
    const second = transferAuthority(first, A, null);

    // No entities matched in the second pass — should return the same object
    // reference (the identity fast-path in transferAuthority).
    expect(second).toBe(first);
    // Content is unchanged.
    expect(second.projectiles[EntityId(1)]?.ownerId).toBeNull();
  });
});
