// Tests for FNV1a-32 per-entity hash functions.
// All tests are pure — no Phaser, no network mocks, no Date.now(), no Math.random().

import { describe, test, expect } from "bun:test";
import {
  hashPlayerEntity,
  hashProjectileEntity,
  hashWorldStateLite,
} from "../hash.js";
import { nextU32 } from "../rng.js";
import type { PlayerEntity, ProjectileEntity, WorldState } from "../types.js";
import { EntityId, InputSeq, PlayerId, Tick } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers — construct minimal valid entities.
// ---------------------------------------------------------------------------

function makePlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "balanced",
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    aimX: 1,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "default",
    cards: [],
    fireCooldownMs: 0,
    ammo: 10,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

function makeProjectile(overrides: Partial<ProjectileEntity> = {}): ProjectileEntity {
  return {
    id: EntityId(1),
    ownerId: PlayerId("p1"),
    x: 50,
    y: 80,
    vx: 300,
    vy: -100,
    shape: "circle",
    radius: 6,
    damage: 15,
    lifetimeMs: 2000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ageMs: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — Identical entities produce identical hashes.
// ---------------------------------------------------------------------------

describe("hashPlayerEntity", () => {
  test("identical entities → identical hashes", () => {
    const a = makePlayer();
    const b = makePlayer();
    expect(hashPlayerEntity(a)).toBe(hashPlayerEntity(b));
  });

  // -------------------------------------------------------------------------
  // Test 2 — Sub-grid drift (< 0.01) is below detection threshold.
  // -------------------------------------------------------------------------

  test("position drift below 0.01 grid → same hash", () => {
    // Grid is 0.01 px; rounding threshold is ±0.005. A drift of 0.004 stays
    // in the same quantisation bucket (100.004 / 0.01 = 10000.4 → rounds to 10000).
    const base = makePlayer({ x: 100.000 });
    const drifted = makePlayer({ x: 100.004 }); // 0.004 < 0.005 threshold
    expect(hashPlayerEntity(base)).toBe(hashPlayerEntity(drifted));
  });

  // -------------------------------------------------------------------------
  // Test 3 — Super-grid drift (>= 0.01) is detectable.
  // -------------------------------------------------------------------------

  test("position drift above 0.01 grid → different hash", () => {
    const base = makePlayer({ x: 100.00 });
    const drifted = makePlayer({ x: 100.05 }); // 0.05 >= 0.01 grid
    expect(hashPlayerEntity(base)).not.toBe(hashPlayerEntity(drifted));
  });

  // -------------------------------------------------------------------------
  // Test 5 — Determinism: same entity, same hash on repeated calls.
  // -------------------------------------------------------------------------

  test("determinism across repeated calls", () => {
    const p = makePlayer({ x: 123.456, y: 789.012, vx: -3.14, health: 87 });
    const first = hashPlayerEntity(p);
    const second = hashPlayerEntity(p);
    expect(first).toBe(second);
  });

  // -------------------------------------------------------------------------
  // Test 6 — `grounded` flag flip changes hash. Without this in the hash,
  // the per-entity reconcile in clientLoop wouldn't see a remote player's
  // grounded transitions and the rig would stay frozen on stale state.
  // -------------------------------------------------------------------------
  test("grounded flag toggle → different hash", () => {
    const a = makePlayer({});
    const b = makePlayer({});
    a.grounded = true;
    b.grounded = false;
    expect(hashPlayerEntity(a)).not.toBe(hashPlayerEntity(b));
  });
});

describe("hashProjectileEntity", () => {
  test("identical projectiles → identical hashes", () => {
    const a = makeProjectile();
    const b = makeProjectile();
    expect(hashProjectileEntity(a)).toBe(hashProjectileEntity(b));
  });

  test("determinism across repeated calls", () => {
    const p = makeProjectile({ x: 55.5, y: 120.1, vx: -200, vy: 0, ageMs: 480 });
    expect(hashProjectileEntity(p)).toBe(hashProjectileEntity(p));
  });

  test("velocity change → different hash", () => {
    const a = makeProjectile({ vx: 300 });
    const b = makeProjectile({ vx: 350 });
    expect(hashProjectileEntity(a)).not.toBe(hashProjectileEntity(b));
  });
});

// ---------------------------------------------------------------------------
// Test 4 — 100 deterministically-varied entities: < 5% collisions.
// ---------------------------------------------------------------------------

describe("hashPlayerEntity collision rate", () => {
  test("100 varied entities → > 95 unique hashes", () => {
    let rngState = 0xdeadbeef;

    function nextFloat(): number {
      rngState = nextU32(rngState);
      return rngState / 0x100000000;
    }

    const hashes = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const p = makePlayer({
        id: PlayerId(`p${i}`),
        x: nextFloat() * 1200,
        y: nextFloat() * 800,
        vx: (nextFloat() - 0.5) * 600,
        vy: (nextFloat() - 0.5) * 600,
        health: nextFloat() * 100,
        alive: nextFloat() > 0.1,
        fireCooldownMs: nextFloat() * 500,
        abilityCharge: nextFloat() * 100,
        cards: i % 3 === 0 ? ["card-a"] : i % 3 === 1 ? ["card-a", "card-b"] : [],
      });
      hashes.add(hashPlayerEntity(p));
    }

    // Require > 95 distinct hashes out of 100 entities (< 5% collision rate).
    expect(hashes.size).toBeGreaterThan(95);
  });
});

// ---------------------------------------------------------------------------
// hashWorldStateLite smoke test.
// ---------------------------------------------------------------------------

describe("hashWorldStateLite", () => {
  test("returns correct player and projectile keys", () => {
    const pid = PlayerId("player-xyz");
    const eid = EntityId(42);

    const state: WorldState = {
      tick: Tick(10),
      rngState: 0,
      players: { [pid]: makePlayer({ id: pid }) },
      projectiles: { [eid]: makeProjectile({ id: eid }) },
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 0,
        scores: {},
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };

    const lite = hashWorldStateLite(state);

    expect(typeof lite.players[pid]).toBe("number");
    expect(typeof lite.projectiles[eid]).toBe("number");

    // Determinism: same state → same hashes.
    const lite2 = hashWorldStateLite(state);
    expect(lite.players[pid]).toBe(lite2.players[pid]);
    expect(lite.projectiles[eid]).toBe(lite2.projectiles[eid]);
  });
});
