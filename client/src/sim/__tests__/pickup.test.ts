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
import { EntityId, PlayerId, InputSeq, Tick } from "../types.js";
import type {
  PickupEntity,
  PickupKind,
  PlayerEntity,
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
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

function makePickup(id: number, kind: PickupKind, x: number, y: number, extras: Partial<PickupEntity> = {}): PickupEntity {
  return {
    id: EntityId(id),
    kind,
    x,
    y,
    radius: 16,
    amount: 25,
    active: true,
    respawnAtTick: Tick(0),
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
      [makePlayer(PlayerId("a"),100, 100, { health: 80 })],
    );
    const result = stepPickups({ pickups, players, tick: Tick(60), dtMs: DT_MS, rngState: 1 });
    expect(result.players[PlayerId("a")]!.health).toBe(100); // capped at 100 (80 + 30 → 100)
    expect(result.pickups[EntityId(1)]!.active).toBe(false);
    expect(result.events.some((e) => e.t === "pickup-taken" && e.entityId === 1)).toBe(true);
  });

  test("shield-cell tops up shieldCharge to 100 ceiling", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "shield-cell", 100, 100, { amount: 40 })],
      [makePlayer(PlayerId("a"),100, 100, { shieldCharge: 70 })],
    );
    const result = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 1 });
    expect(result.players[PlayerId("a")]!.shieldCharge).toBe(100);
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
      [makePlayer(PlayerId("a"),100, 100)],
    );
    const startTick = Tick(100);
    const result = stepPickups({ pickups, players, tick: startTick, dtMs: DT_MS, rngState: 1 });
    const expected = startTick + Math.ceil(defaultMs / DT_MS);
    expect(result.players[PlayerId("a")]![field]).toBe(expected);
  });
});

describe("stepPickups: trap-style pickups apply to OTHER players", () => {
  test("slow-trap slows everyone except picker, and emits player-slowed events", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "slow-trap", 100, 100, { durationMs: undefined })],
      [
        makePlayer(PlayerId("a"),100, 100), // picker
        makePlayer(PlayerId("b"),500, 100),
        makePlayer(PlayerId("c"),600, 100),
      ],
    );
    const tick = Tick(50);
    const result = stepPickups({ pickups, players, tick, dtMs: DT_MS, rngState: 1 });

    expect(result.players[PlayerId("a")]!.slowDebuffUntilTick).toBeUndefined();
    const expectedUntil = Tick(tick + Math.ceil(SLOW_DEBUFF_MS / DT_MS));
    expect(result.players[PlayerId("b")]!.slowDebuffUntilTick).toBe(expectedUntil);
    expect(result.players[PlayerId("c")]!.slowDebuffUntilTick).toBe(expectedUntil);
    expect(result.players[PlayerId("b")]!.slowMultiplier).toBe(SLOW_TRAP_MULTIPLIER);

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
        makePlayer(PlayerId("a"),100, 100, { shieldActive: true }),
        makePlayer(PlayerId("b"),800, 100, { shieldActive: true }),
      ],
    );
    const tick = Tick(0);
    const result = stepPickups({ pickups: vulnPickups, players: vulnPlayers, tick, dtMs: DT_MS, rngState: 1 });

    // a picks up vulnerability-trap → b gets vulnerable
    expect(result.players[PlayerId("b")]!.vulnerabilityUntilTick).toBe(Tick(tick + Math.ceil(VULNERABILITY_MS / DT_MS)));
    expect(result.players[PlayerId("a")]!.vulnerabilityUntilTick).toBeUndefined();

    // b picks up block-jammer → a gets jammed and shieldActive cleared
    expect(result.players[PlayerId("a")]!.blockJammerUntilTick).toBe(Tick(tick + Math.ceil(BLOCK_JAMMER_MS / DT_MS)));
    expect(result.players[PlayerId("a")]!.shieldActive).toBe(false);
    expect(result.players[PlayerId("b")]!.blockJammerUntilTick).toBeUndefined();
  });
});

describe("stepPickups: respawn + inactive handling", () => {
  test("inactive pickup with matured respawn becomes active again", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100, { active: false, respawnAtTick: Tick(30) })],
      [makePlayer(PlayerId("a"),9999, 9999)], // far away
    );
    const result = stepPickups({ pickups, players, tick: Tick(30), dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[EntityId(1)]!.active).toBe(true);
    expect(result.pickups[EntityId(1)]!.respawnAtTick).toBe(Tick(0));
  });

  test("collected pickup has respawnAtTick = tick + ceil(respawnMs/dt)", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100, { respawnMs: 20000, durationMs: undefined })],
      [makePlayer(PlayerId("a"),100, 100)],
    );
    const tick = Tick(7);
    const result = stepPickups({ pickups, players, tick, dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[EntityId(1)]!.active).toBe(false);
    expect(result.pickups[EntityId(1)]!.respawnAtTick).toBe(Tick(tick + Math.ceil(20000 / DT_MS)));
  });

  test("non-overlapping player does not collect", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100)],
      [makePlayer(PlayerId("a"),800, 800)], // far away
    );
    const result = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[EntityId(1)]!.active).toBe(true);
    expect(result.events).toHaveLength(0);
  });
});

describe("stepPickups: card-cache offer", () => {
  test("emits card-offered with deterministic id list", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "card-cache", 100, 100, { durationMs: undefined })],
      [makePlayer(PlayerId("a"),100, 100)],
    );
    const r1 = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 12345 });
    const r2 = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 12345 });

    const offer1 = r1.events.find((e) => e.t === "card-offered");
    const offer2 = r2.events.find((e) => e.t === "card-offered");
    expect(offer1).toBeDefined();
    expect(offer2).toBeDefined();
    if (offer1?.t === "card-offered" && offer2?.t === "card-offered") {
      expect(offer1.cardIds.length).toBeGreaterThan(0);
      expect(offer1.cardIds).toEqual(offer2.cardIds);
      expect(offer1.playerId).toBe(PlayerId("a"));
      // Same rng → same advanced cursor.
      expect(r1.rngState).toBe(r2.rngState);
    }
  });

  test("different rng seeds → different offers (most of the time)", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "card-cache", 100, 100, { durationMs: undefined })],
      [makePlayer(PlayerId("a"),100, 100)],
    );
    const r1 = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 1 });
    const r2 = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 2 });
    expect(r1.rngState).not.toBe(r2.rngState);
  });
});

describe("clearExpiredBuffs", () => {
  test("clears expired tick fields, preserves still-active ones", () => {
    const players: WorldState["players"] = {
      [PlayerId("a")]: makePlayer(PlayerId("a"), 0, 0, {
        overchargeUntilTick: Tick(50), // expired
        damageAmpUntilTick: Tick(200), // active
        speedBoostUntilTick: Tick(100), // == tick → expired (boundary: <= tick)
      }),
    };
    const cleaned = clearExpiredBuffs(players, Tick(100));
    expect(cleaned[PlayerId("a")]!.overchargeUntilTick).toBeUndefined();
    expect(cleaned[PlayerId("a")]!.damageAmpUntilTick).toBe(Tick(200));
    expect(cleaned[PlayerId("a")]!.speedBoostUntilTick).toBeUndefined();
  });
});

describe("stepPickups: dead players don't collect", () => {
  test("dead player on top of pickup leaves it active", () => {
    const { pickups, players } = buildState(
      [makePickup(1, "health-shard", 100, 100)],
      [makePlayer(PlayerId("a"),100, 100, { alive: false, health: 0 })],
    );
    const result = stepPickups({ pickups, players, tick: Tick(0), dtMs: DT_MS, rngState: 1 });
    expect(result.pickups[EntityId(1)]!.active).toBe(true);
  });
});
