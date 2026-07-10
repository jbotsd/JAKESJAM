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
 *  bodyThreatRadius (260), both grounded, foe to the bot's right.
 *  DEFAULT foe id is a BOT ("bot_foe") so it's never inside the FTUE
 *  fresh-human grace window — the offense/defense tests measure the
 *  un-handicapped behavior. FTUE tests override foeId with a human id. */
function bashRangeState(
  botId: string,
  opts: { foeDashing?: boolean; foeVx?: number; foeId?: string } = {},
): WorldState {
  const foeId = opts.foeId ?? "bot_foe";
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
      [foeId]: {
        id: foeId,
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

describe("WorldBots FTUE grace (fresh-human warmup)", () => {
  test("a fresh human is never dash-bashed, even by a tier-2 bot at point-blank", () => {
    const bots = new WorldBots();
    const spawned = bots.spawnInfosFor(3);
    const botId = spawned[2]!.playerId as unknown as string; // tier 2 — most aggressive
    const keys: number[] = [];
    // Human foe id (no bot_ prefix) → tracked as a fresh human from the
    // first think() tick.
    const host = hostCapturing(bashRangeState(botId, { foeId: "freshie" }), botId, keys);
    // 300 ticks at 16ms = ~4.8s — well inside the 60s grace window.
    for (let i = 0; i < 300; i += 1) bots.think(host, 1000 + i * 16);
    expect(keys.some((k) => (k & InputBit.Dash) !== 0)).toBe(false);
  });

  test("after the grace window expires the same bot dash-bashes again", () => {
    const bots = new WorldBots();
    const spawned = bots.spawnInfosFor(3);
    const botId = spawned[2]!.playerId as unknown as string; // tier 2
    const keys: number[] = [];
    const host = hostCapturing(bashRangeState(botId, { foeId: "freshie" }), botId, keys);
    // First tick at t=1000 stamps the foe's arrival; then jump wall-clock
    // past the 90s FTUE grace window and run the same close-range scenario.
    bots.think(host, 1000);
    keys.length = 0;
    for (let i = 0; i < 400; i += 1) bots.think(host, 1000 + 95_000 + i * 16);
    const dashCount = keys.filter((k) => (k & InputBit.Dash) !== 0).length;
    // Tier 2 dash rate is intentionally low now (~0.07/tick when lined up).
    expect(dashCount).toBeGreaterThan(2);
  });

  test("bots prefer a seasoned target over a fresh human when both are in reach", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;
    // Two foes: "fresh" (a human just arrived, CLOSER) and another BOT
    // (never fresh, slightly farther). The bot should aim at the bot, not
    // the fresh human — check via the injected aim traveling toward the
    // seasoned target's side.
    const state = bashRangeState(botId) as unknown as {
      players: Record<string, Record<string, unknown>>;
    };
    // Default foe is already a bot (seasoned) — push it farther LEFT, and
    // add a CLOSER fresh human on the right.
    state.players["bot_foe"]!.x = 350; // 150px LEFT of the bot
    state.players["freshie"] = {
      ...state.players["bot_foe"]!,
      id: "freshie",
      x: 560, // 60px RIGHT of the bot — closer than the rival
      dashing: false,
    };
    const aims: number[] = [];
    const host = {
      isRunning: () => true,
      getStateSnapshot: () => state,
      injectInput: (id: unknown, input: { keys: number; aimX: number }) => {
        if (id === botId) aims.push(input.aimX);
      },
      injectCardPick: () => {},
    } as unknown as MatchHost;
    for (let i = 0; i < 120; i += 1) bots.think(host, 1000 + i * 16);
    // The bot sits at x=500. Seasoned rival is at 350 (left), fresh human at
    // 560 (right). Aim EMA should settle toward the rival's side.
    const settled = aims.slice(-30);
    const avgAim = settled.reduce((a, b) => a + b, 0) / settled.length;
    expect(avgAim).toBeLessThan(500);
  });
});
