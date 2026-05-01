// Pickup system: kind dispatch, respawn, traps applying to others, card-cache
// emits a deterministic offer event. We bypass the full World tick and call
// stepPickups directly so the assertions are tight and order-independent.

import { describe, expect, test } from "bun:test";
import {
  BLOCK_JAMMER_MS,
  BOSS_MODE_MS,
  DAMAGE_AMP_MS,
  MELEE_MODE_MS,
  OVERCHARGE_DURATION_MS,
  SLOW_DEBUFF_MS,
  SLOW_TRAP_MULTIPLIER,
  SPEED_BOOST_MS,
  VULNERABILITY_MS,
  clearExpiredBuffs,
  stepPickups,
} from "../pickup.js";
import type {
  EntityId,
  PickupEntity,
  PickupKind,
  PlayerEntity,
  PlayerId,
  WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;

function makePlayer(id: PlayerId, x: number, y: number, overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: y,
    health: 80,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: 0,
    ...overrides,
  };
}

function makePickup(id: number, kind: PickupKind, x: number, y: number, extras: Partial<PickupEntity> = {}): PickupEntity {
  return {
    id: id as EntityId,
    kind,
    x,
    y,
    radius: 16,
    amount: 25,
    active: true,
    respawnAtTick: 0,
    durationMs: 8000,
    respawnMs: 12000,
    ...extras,
  };
}

function buildState(
  pickups: PickupEntity[],
  players: PlayerEntity[],
): { pickups: WorldState["pickups"]; players: WorldState["players"] } {
  const pickupMap: WorldState["pickups"] = {};
  for (const p of pickups) pickupMap[p.id] = p;
  const playerMap: WorldState["players"] = {};
  for (const p of players) playerMap[p.id] = p;
  return { pickups: pickupMap, players: playerMap };
}

describe("stepPickups: instant pickups", () => {
  test("health-shard heals up to 100 cap", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100, { amount: 30, durationMs: undefined })],
      [makePlayer("a", 100, 100, { health: 80 })],
    );
    const result = stepPickups({ pickups, players, tick: 60, dtMs: DT_MS, rngState: 1 });
    expect(result.players.a!.health).toBe(100); // capped at 100 (80 + 30 → 100)
    expect(result.pickups[1]!.active).toBe(false);
    expect(result.events.some((e) => e.t === "pickup-taken" && e.entityId === 1)).toBe(true);
  });

  test("shield-cell tops up shieldCharge to 100 ceiling", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "shield-cell", 100, 100, { amount: 40 })],
      [makePlayer("a", 100, 100, { shieldCharge: 70 })],
    );
    const result = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 1 });
    expect(result.players.a!.shieldCharge).toBe(100);
  });
});

describe("stepPickups: buff timers", () => {
  test.each<[PickupKind, keyof PlayerEntity, number]>([
    ["overcharge-core", "overchargeUntilTick", OVERCHARGE_DURATION_MS],
    ["damage-amp", "damageAmpUntilTick", DAMAGE_AMP_MS],
    ["speed-boost", "speedBoostUntilTick", SPEED_BOOST_MS],
    ["melee-mode", "meleeModeUntilTick", MELEE_MODE_MS],
    ["boss-core", "bossModeUntilTick", BOSS_MODE_MS],
  ])("%s sets %s in the future by approx %s ms", (kind, field, defaultMs) => {
    const { pickups, players } = buildState(
      [makePickup(1, kind, 100, 100, { durationMs: undefined })],
      [makePlayer("a", 100, 100)],
    );
    const startTick = 100;
    const result = stepPickups({ pickups, players, tick: startTick, dtMs: DT_MS, rngState: 1 });
    const expected = startTick + Math.ceil(defaultMs / DT_MS);
    expect(result.players.a![field]).toBe(expected);
  });
});

describe("stepPickups: trap-style pickups apply to OTHER players", () => {
  test("slow-trap slows everyone except picker, and emits player-slowed events", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "slow-trap", 100, 100, { durationMs: undefined })],
      [
        makePlayer("a", 100, 100), // picker
        makePlayer("b", 500, 100),
        makePlayer("c", 600, 100),
      ],
    );
    const tick = 50;
    const result = stepPickups({ pickups, players, tick, dtMs: DT_MS, rngState: 1 });

    expect(result.players.a!.slowDebuffUntilTick).toBeUndefined();
    const expectedUntil = tick + Math.ceil(SLOW_DEBUFF_MS / DT_MS);
    expect(result.players.b!.slowDebuffUntilTick).toBe(expectedUntil);
    expect(result.players.c!.slowDebuffUntilTick).toBe(expectedUntil);
    expect(result.players.b!.slowMultiplier).toBe(SLOW_TRAP_MULTIPLIER);

    const slowEvents = result.events.filter((e) => e.t === "player-slowed");
    expect(slowEvents).toHaveLength(2);
  });

  test("vulnerability-trap and block-jammer set fields on others, not picker", () => {
    const { pickups: vulnPickups, players: vulnPlayers } = buildState(
      [
        makePickup(1, "vulnerability-trap", 100, 100, { durationMs: undefined }),
        makePickup(2, "block-jammer", 800, 100, { durationMs: undefined }),
      ],
      [
        makePlayer("a", 100, 100, { shieldActive: true }),
        makePlayer("b", 800, 100, { shieldActive: true }),
      ],
    );
    const tick = 0;
    const result = stepPickups({ pickups: vulnPickups, players: vulnPlayers, tick, dtMs: DT_MS, rngState: 1 });

    // a picks up vulnerability-trap → b gets vulnerable
    expect(result.players.b!.vulnerabilityUntilTick).toBe(tick + Math.ceil(VULNERABILITY_MS / DT_MS));
    expect(result.players.a!.vulnerabilityUntilTick).toBeUndefined();

    // b picks up block-jammer → a gets jammed and shieldActive cleared
    expect(result.players.a!.blockJammerUntilTick).toBe(tick + Math.ceil(BLOCK_JAMMER_MS / DT_MS));
    expect(result.players.a!.shieldActive).toBe(false);
    expect(result.players.b!.blockJammerUntilTick).toBeUndefined();
  });
});

describe("stepPickups: respawn + inactive handling", () => {
  test("inactive pickup with matured respawn becomes active again", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100, { active: false, respawnAtTick: 30 })],
      [makePlayer("a", 9999, 9999)], // far away
    );
    const result = stepPickups({ pickups, players, tick: 30, dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[1]!.active).toBe(true);
    expect(result.pickups[1]!.respawnAtTick).toBe(0);
  });

  test("collected pickup has respawnAtTick = tick + ceil(respawnMs/dt)", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100, { respawnMs: 20000, durationMs: undefined })],
      [makePlayer("a", 100, 100)],
    );
    const tick = 7;
    const result = stepPickups({ pickups, players, tick, dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[1]!.active).toBe(false);
    expect(result.pickups[1]!.respawnAtTick).toBe(tick + Math.ceil(20000 / DT_MS));
  });

  test("non-overlapping player does not collect", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100)],
      [makePlayer("a", 800, 800)], // far away
    );
    const result = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[1]!.active).toBe(true);
    expect(result.events).toHaveLength(0);
  });
});

describe("stepPickups: card-cache offer", () => {
  test("emits card-offered with deterministic id list", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "card-cache", 100, 100, { durationMs: undefined })],
      [makePlayer("a", 100, 100)],
    );
    const r1 = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 12345 });
    const r2 = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 12345 });

    const offer1 = r1.events.find((e) => e.t === "card-offered");
    const offer2 = r2.events.find((e) => e.t === "card-offered");
    expect(offer1).toBeDefined();
    expect(offer2).toBeDefined();
    if (offer1?.t === "card-offered" && offer2?.t === "card-offered") {
      expect(offer1.cardIds.length).toBeGreaterThan(0);
      expect(offer1.cardIds).toEqual(offer2.cardIds);
      expect(offer1.playerId).toBe("a");
      // Same rng → same advanced cursor.
      expect(r1.rngState).toBe(r2.rngState);
    }
  });

  test("different rng seeds → different offers (most of the time)", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "card-cache", 100, 100, { durationMs: undefined })],
      [makePlayer("a", 100, 100)],
    );
    const r1 = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 1 });
    const r2 = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 2 });
    expect(r1.rngState).not.toBe(r2.rngState);
  });
});

describe("clearExpiredBuffs", () => {
  test("clears expired tick fields, preserves still-active ones", () => {
    const players: WorldState["players"] = {
      a: makePlayer("a", 0, 0, {
        overchargeUntilTick: 50, // expired
        damageAmpUntilTick: 200, // active
        speedBoostUntilTick: 100, // == tick → expired (boundary: <= tick)
      }),
    };
    const cleaned = clearExpiredBuffs(players, 100);
    expect(cleaned.a!.overchargeUntilTick).toBeUndefined();
    expect(cleaned.a!.damageAmpUntilTick).toBe(200);
    expect(cleaned.a!.speedBoostUntilTick).toBeUndefined();
  });
});

describe("stepPickups: dead players don't collect", () => {
  test("dead player on top of pickup leaves it active", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100)],
      [makePlayer("a", 100, 100, { alive: false, health: 0 })],
    );
    const result = stepPickups({ pickups, players, tick: 0, dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[1]!.active).toBe(true);
  });
});
