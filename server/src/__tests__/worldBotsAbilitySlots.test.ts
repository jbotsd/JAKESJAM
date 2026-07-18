// Bot loadout tables (class-overhaul-workboard.md chunk 0.4): bots must
// know how to press equipped ability cards through the SAME resolution
// (ResolvedWeaponBuild.actives) and the SAME input bits (1 << (10 + slot))
// a human's action bar uses (client/src/game/scenes/OnlineMatchScene.ts
// keys.slot1/2/3 → keys |= 1 << 10/11/12; World.ts's ability-activation
// loop reads the identical bits). This is class-agnostic infrastructure —
// only the Geometrician (wizard) catalog exists today, so every fixture
// below equips a "balanced" (wizard) character with real catalog cards
// from client/src/sim/data/cards.ts.
//
// Role-aware target gate under test: reading World.ts's ability switch,
// only the "single" role (Facet Break — marks the nearest foe in the aim
// cone) requires a live target nearby to do anything meaningful; every
// other role (aoe/defense/buff/movement/offense here) is self-centered and
// fires unconditionally once off cooldown. worldBots.ts's per-slot loop
// therefore only range-gates "single"-role actives.

import { describe, expect, test } from "bun:test";
import { InputBit } from "@net/protocol.ts";
import { WorldBots } from "../worldBots.ts";
import type { MatchHost } from "../matchHost.ts";
import type { WorldState } from "@sim/types.ts";

function hostCapturing(state: WorldState, botId: string, sink: number[]): MatchHost {
  return {
    isRunning: () => true,
    getStateSnapshot: () => state,
    injectInput: (id: unknown, input: { keys: number }) => {
      if (id === botId) sink.push(input.keys);
    },
    injectCardPick: () => {},
  } as unknown as MatchHost;
}

/** Bot + one foe, both grounded, no projectiles/threats — isolates the
 *  ability-slot press logic from parry/dash/fire noise as much as this
 *  shared `decide()` brain allows. `cards` equips catalog ability cards
 *  (order = slot order, six-axes Layer 2 / class-ability-catalogs-v1). */
function abilityState(
  botId: string,
  opts: { cards: string[]; foeDist: number; slot1CooldownUntilTick?: number },
): WorldState {
  const foeId = "bot_foe";
  return {
    tick: 0,
    rngState: 0,
    players: {
      [botId]: {
        id: botId,
        characterId: "balanced",
        weaponId: "starter-pistol",
        cards: opts.cards,
        x: 500,
        y: 500,
        vx: 0,
        vy: 0,
        aimX: 0,
        aimY: 0,
        health: 100,
        alive: true,
        grounded: true,
        shieldCharge: 100,
        abilityCharge: 0,
        ...(opts.slot1CooldownUntilTick !== undefined
          ? { slot1CooldownUntilTick: opts.slot1CooldownUntilTick }
          : {}),
      },
      [foeId]: {
        id: foeId,
        characterId: "balanced",
        weaponId: "starter-pistol",
        cards: [],
        x: 500 + opts.foeDist,
        y: 500,
        vx: 0,
        vy: 0,
        aimX: 0,
        aimY: 0,
        health: 100,
        alive: true,
        grounded: true,
      },
    },
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: { phase: "fighting", countdownRemainingMs: 0, scores: {}, roundIndex: 0, winnerPlayerId: null },
  } as unknown as WorldState;
}

/** Slot-1 press bit — matches OnlineMatchScene's `keys |= 1 << 10` for key "1". */
const SLOT1_BIT = 1 << 10;

describe("WorldBots ability-slot presses (chunk 0.4 bot loadout tables)", () => {
  test("single-target ability (Facet Break) off cooldown + foe in range → presses slot 1", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    const host = hostCapturing(
      abilityState(botId, { cards: ["facet-break"], foeDist: 150 }),
      botId,
      keys,
    );
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & SLOT1_BIT) !== 0)).toBe(true);
  });

  test("single-target ability (Facet Break) on cooldown never presses, even with foe in range", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    // Cooldown far in the future relative to tick 0.
    const host = hostCapturing(
      abilityState(botId, { cards: ["facet-break"], foeDist: 150, slot1CooldownUntilTick: 999_999 }),
      botId,
      keys,
    );
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & SLOT1_BIT) !== 0)).toBe(false);
  });

  test("single-target ability (Facet Break) with foe OUT of range never presses", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    // 800px away — beyond worldBots.ts's 520px target-range heuristic.
    const host = hostCapturing(
      abilityState(botId, { cards: ["facet-break"], foeDist: 800 }),
      botId,
      keys,
    );
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & SLOT1_BIT) !== 0)).toBe(false);
  });

  test("aoe/self ability (Prism Fan) presses even with the foe far out of the 520px target range", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    // 800px away — would fail the "single" role's range gate, but Prism
    // Fan (role: "aoe") is a self-aimed cone burst that World.ts fires
    // unconditionally once off cooldown, so worldBots.ts must not range-gate it.
    const host = hostCapturing(
      abilityState(botId, { cards: ["prism-fan"], foeDist: 800 }),
      botId,
      keys,
    );
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & SLOT1_BIT) !== 0)).toBe(true);
  });

  test("buff/self ability (Overclock) on cooldown never presses, even far from any foe", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    const host = hostCapturing(
      abilityState(botId, { cards: ["overclock"], foeDist: 800, slot1CooldownUntilTick: 999_999 }),
      botId,
      keys,
    );
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & SLOT1_BIT) !== 0)).toBe(false);
  });

  test("multi-slot rack: single-target in slot 1 gates on range independently of aoe in slot 2", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    // Facet Break (single, slot 1) should stay silent at 800px; Prism Fan
    // (aoe, slot 2) should still fire from the same far distance.
    const host = hostCapturing(
      abilityState(botId, { cards: ["facet-break", "prism-fan"], foeDist: 800 }),
      botId,
      keys,
    );
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    const SLOT2_BIT = 1 << 11;
    expect(keys.some((k) => (k & SLOT1_BIT) !== 0)).toBe(false);
    expect(keys.some((k) => (k & SLOT2_BIT) !== 0)).toBe(true);
  });

  test("bots never press an ability slot input bit when no ability cards are equipped", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    const host = hostCapturing(abilityState(botId, { cards: [], foeDist: 150 }), botId, keys);
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    const anySlotBit = (1 << 10) | (1 << 11) | (1 << 12);
    expect(keys.some((k) => (k & anySlotBit) !== 0)).toBe(false);
  });

  test("bot without a cards array (minimal fixture) never crashes and never presses a slot bit", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    const state = abilityState(botId, { cards: [], foeDist: 150 }) as unknown as {
      players: Record<string, Record<string, unknown>>;
    };
    delete state.players[botId]!.cards;
    const host = hostCapturing(state as unknown as WorldState, botId, keys);
    expect(() => {
      for (let i = 0; i < 60; i += 1) bots.think(host, 1000 + i * 16);
    }).not.toThrow();
    const anySlotBit = (1 << 10) | (1 << 11) | (1 << 12);
    expect(keys.some((k) => (k & anySlotBit) !== 0)).toBe(false);
  });
});
