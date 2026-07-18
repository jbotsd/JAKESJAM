// Tests for team identity (class-overhaul-workboard.md chunk 1.1 — "Team
// identity threading into the sim"). Two layers:
//   1. `isAlly` itself — pure function, no sim machinery needed.
//   2. The two entity-construction sites (World.create, rosterOps.
//      applyMidMatchJoin) actually populate PlayerEntity.teamId from
//      PlayerSpawnInfo.teamId, and leave it undefined when absent — this
//      is the "byte-identical for solo FFA" acceptance bar the workboard
//      chunk brief calls out explicitly.
//
// All tests are pure — no Phaser, no network mocks, no Date.now(),
// no Math.random().

import { describe, test, expect } from "bun:test";
import { isAlly } from "../team.js";
import { World } from "../World.js";
import { applyMidMatchJoin } from "../rosterOps.js";
import type { MapDefinition, PlayerEntity, PlayerSpawnInfo } from "../types.js";
import { InputSeq, PlayerId } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers — construct minimal valid entities/fixtures.
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

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
    { x: 1000, y: 400 },
  ],
  platforms: [
    {
      id: "floor",
      kind: "floor",
      position: { x: 0, y: 500 },
      size: { x: 1280, y: 60 },
    },
  ],
};

function makeSpawn(overrides: Partial<PlayerSpawnInfo> = {}): PlayerSpawnInfo {
  return {
    playerId: PlayerId("p1"),
    characterId: "balanced",
    name: "P1",
    color: "#ffffff",
    weaponId: "starter-pistol",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isAlly — pure function
// ---------------------------------------------------------------------------

describe("isAlly", () => {
  test("two players with the same teamId are allies", () => {
    const a = makePlayer({ id: PlayerId("a"), teamId: "duo-1" });
    const b = makePlayer({ id: PlayerId("b"), teamId: "duo-1" });
    expect(isAlly(a, b)).toBe(true);
    expect(isAlly(b, a)).toBe(true);
  });

  test("two players with different teamIds are NOT allies", () => {
    const a = makePlayer({ id: PlayerId("a"), teamId: "duo-1" });
    const b = makePlayer({ id: PlayerId("b"), teamId: "duo-2" });
    expect(isAlly(a, b)).toBe(false);
    expect(isAlly(b, a)).toBe(false);
  });

  test("solo FFA: neither player has a teamId — NOT allies", () => {
    const a = makePlayer({ id: PlayerId("a") });
    const b = makePlayer({ id: PlayerId("b") });
    expect(a.teamId).toBeUndefined();
    expect(b.teamId).toBeUndefined();
    expect(isAlly(a, b)).toBe(false);
  });

  test("mixed: one player has a teamId, the other doesn't — NOT allies", () => {
    const a = makePlayer({ id: PlayerId("a"), teamId: "duo-1" });
    const b = makePlayer({ id: PlayerId("b") });
    expect(isAlly(a, b)).toBe(false);
    expect(isAlly(b, a)).toBe(false);
  });

  test("a player is their own ally when teamed, matching the equality definition", () => {
    const a = makePlayer({ id: PlayerId("a"), teamId: "duo-1" });
    expect(isAlly(a, a)).toBe(true);
  });

  test("a teamless player is NOT their own ally (undefined !== ally)", () => {
    const a = makePlayer({ id: PlayerId("a") });
    expect(isAlly(a, a)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entity construction — World.create (initial roster)
// ---------------------------------------------------------------------------

describe("World.create threads PlayerSpawnInfo.teamId onto PlayerEntity", () => {
  test("a duo-queue spawn carries its teamId onto the constructed entity", () => {
    const state = World.create(
      flatMap,
      [
        makeSpawn({ playerId: PlayerId("alice"), teamId: "duo-9" }),
        makeSpawn({ playerId: PlayerId("bob"), teamId: "duo-9" }),
      ],
      1234,
    );
    expect(state.players[PlayerId("alice")]!.teamId).toBe("duo-9");
    expect(state.players[PlayerId("bob")]!.teamId).toBe("duo-9");
    expect(isAlly(state.players[PlayerId("alice")]!, state.players[PlayerId("bob")]!)).toBe(
      true,
    );
  });

  test("opposing duo teams are threaded through and are NOT allies", () => {
    const state = World.create(
      flatMap,
      [
        makeSpawn({ playerId: PlayerId("alice"), teamId: "duo-9" }),
        makeSpawn({ playerId: PlayerId("carol"), teamId: "bot-duo-3" }),
      ],
      1234,
    );
    expect(
      isAlly(state.players[PlayerId("alice")]!, state.players[PlayerId("carol")]!),
    ).toBe(false);
  });

  test("solo FFA match: no spawn carries a teamId — every entity's teamId is undefined, byte-identical to pre-chunk-1.1 behavior", () => {
    const state = World.create(
      flatMap,
      [
        makeSpawn({ playerId: PlayerId("alice") }),
        makeSpawn({ playerId: PlayerId("bob") }),
        makeSpawn({ playerId: PlayerId("carol") }),
      ],
      1234,
    );
    for (const p of Object.values(state.players)) {
      expect(p.teamId).toBeUndefined();
    }
    // No pairing in an FFA match should ever read as allied.
    const [p1, p2, p3] = Object.values(state.players) as PlayerEntity[];
    expect(isAlly(p1!, p2!)).toBe(false);
    expect(isAlly(p2!, p3!)).toBe(false);
    expect(isAlly(p1!, p3!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entity construction — rosterOps.applyMidMatchJoin (mid-match joiner)
// ---------------------------------------------------------------------------

describe("rosterOps.applyMidMatchJoin threads PlayerSpawnInfo.teamId onto PlayerEntity", () => {
  test("a mid-match duo joiner carries its teamId onto the inserted entity", () => {
    const base = World.create(flatMap, [makeSpawn({ playerId: PlayerId("alice") })], 1234);
    const next = applyMidMatchJoin(
      base,
      flatMap,
      makeSpawn({ playerId: PlayerId("dave"), teamId: "duo-2" }),
    );
    expect(next.players[PlayerId("dave")]!.teamId).toBe("duo-2");
  });

  test("a mid-match FFA joiner (no teamId) inserts with teamId undefined", () => {
    const base = World.create(flatMap, [makeSpawn({ playerId: PlayerId("alice") })], 1234);
    const next = applyMidMatchJoin(base, flatMap, makeSpawn({ playerId: PlayerId("erin") }));
    expect(next.players[PlayerId("erin")]!.teamId).toBeUndefined();
  });
});
