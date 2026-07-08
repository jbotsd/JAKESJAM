// WorldBots aegis-slide contract (balance audit): bots that never dash
// offensively and never perceive an inbound dashing body as a threat make
// the slide invisible and uncounterable in the world players actually
// duel bots in. Tiered offense (0 = never, 1 = occasional, 2 = aggressive)
// + universal defensive reaction, reaction-delayed like a human.

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

/** Bot and foe close together — inside both dashBashRange (230) and
 *  bodyThreatRadius (260), both grounded, foe to the bot's right. */
function bashRangeState(
  botId: string,
  opts: { foeDashing?: boolean; foeVx?: number } = {},
): WorldState {
  return {
    tick: 0,
    rngState: 0,
    players: {
      [botId]: {
        id: botId,
        characterId: "balanced",
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
      },
      foe: {
        id: "foe",
        characterId: "balanced",
        x: 650, // 150px away
        y: 500,
        vx: opts.foeVx ?? 0,
        vy: 0,
        aimX: 0,
        aimY: 0,
        health: 100,
        alive: true,
        grounded: true,
        dashing: opts.foeDashing ?? false,
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

describe("WorldBots aegis-slide offense (tiered)", () => {
  test("slideTier 0 (first spawned bot) NEVER presses Dash offensively at close range", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    const host = hostCapturing(bashRangeState(botId), botId, keys);
    for (let i = 0; i < 500; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & InputBit.Dash) !== 0)).toBe(false);
  });

  test("slideTier 2 (third spawned bot) presses Dash offensively at close, closing range", () => {
    const bots = new WorldBots();
    const spawned = bots.spawnInfosFor(3); // tiers 0, 1, 2 in spawn order
    const botId = spawned[2]!.playerId as unknown as string;
    const keys: number[] = [];
    const host = hostCapturing(bashRangeState(botId), botId, keys);
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    const dashCount = keys.filter((k) => (k & InputBit.Dash) !== 0).length;
    // 0.22/tick, gated further by moveDir===towardFoe (strafe jitter cuts
    // in sometimes) — 300 ticks should clear a handful comfortably.
    expect(dashCount).toBeGreaterThan(5);
  });

  test("slideTier 1 dashes less often than slideTier 2 over the same window", () => {
    const bots = new WorldBots();
    const spawned = bots.spawnInfosFor(3); // tiers 0, 1, 2
    const tier1Id = spawned[1]!.playerId as unknown as string;
    const tier2Id = spawned[2]!.playerId as unknown as string;
    const keys1: number[] = [];
    const keys2: number[] = [];
    const host1 = hostCapturing(bashRangeState(tier1Id), tier1Id, keys1);
    const host2 = hostCapturing(bashRangeState(tier2Id), tier2Id, keys2);
    for (let i = 0; i < 400; i += 1) {
      bots.think(host1, 1000 + i * 16);
      bots.think(host2, 1000 + i * 16);
    }
    const c1 = keys1.filter((k) => (k & InputBit.Dash) !== 0).length;
    const c2 = keys2.filter((k) => (k & InputBit.Dash) !== 0).length;
    expect(c2).toBeGreaterThan(c1);
  });
});

describe("WorldBots body-threat defense (all tiers)", () => {
  test("an inbound dashing foe eventually triggers a defensive reaction (dash-away, shield, or hop)", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string; // tier 0 — defense is universal
    const keys: number[] = [];
    const host = hostCapturing(
      bashRangeState(botId, { foeDashing: true, foeVx: -900 }), // sliding toward the bot
      botId,
      keys,
    );
    for (let i = 0; i < 60; i += 1) bots.think(host, 1000 + i * 16); // well past the 250ms delay
    const reacted = keys.some(
      (k) => (k & InputBit.Dash) !== 0 || (k & InputBit.Shield) !== 0 || (k & InputBit.Jump) !== 0,
    );
    expect(reacted).toBe(true);
  });

  test("no dash-away on the very first tick a threat appears — the ~250ms reaction delay holds", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    const keys: number[] = [];
    const host = hostCapturing(
      bashRangeState(botId, { foeDashing: true, foeVx: -900 }),
      botId,
      keys,
    );
    bots.think(host, 1000); // single tick: threat just noticed, elapsed = 0ms
    expect((keys[0]! & InputBit.Dash) !== 0).toBe(false);
  });

  test("a foe that is NOT dashing never triggers the body-threat defense's dash-away", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string; // tier 0
    const keys: number[] = [];
    const host = hostCapturing(
      bashRangeState(botId, { foeDashing: false, foeVx: -900 }), // fast but NOT dashing
      botId,
      keys,
    );
    for (let i = 0; i < 60; i += 1) bots.think(host, 1000 + i * 16);
    // Tier 0 never presses Dash offensively either, so ANY Dash press here
    // would have to be the body-threat branch misfiring on a non-dashing foe.
    expect(keys.some((k) => (k & InputBit.Dash) !== 0)).toBe(false);
  });
});
