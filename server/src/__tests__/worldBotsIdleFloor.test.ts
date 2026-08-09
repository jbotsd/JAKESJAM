// The bot idle floor — footage finding S1, and the standing rule it broke.
//
// docs/clip-sheets/study-2026-08-05-jul31-replay.md (HIGH): "BOT·PISTON
// stands at a wall in the SAME position at f500 and f730 (7.7 s apart,
// full-res identical pose/location)", plus 6.6 s and 6.8 s statue runs —
// about a third of the studied window was a motionless bot, and the
// spectator director was framing it.
//
// Two causes, both on the no-foe path in worldBots.ts:
//   1. the idle strafe direction was drawn from [-1, 0, 1], where 0 means
//      STAND STILL, and held for 900-2300 ms — consecutive zero rolls stack
//      into the multi-second statues that were filmed;
//   2. the unstick detector sits after that path's early return, so an idle
//      bot leaning on geometry never reached it.
//
// "Stationary > 1 s is a bug" is a standing project rule. These tests make
// it enforceable for the one code path that could break it without the bot
// actually being stuck.

import { describe, expect, test } from "bun:test";
import { InputBit } from "@net/protocol.ts";
import { WorldBots } from "../worldBots.ts";
import type { MatchHost } from "../matchHost.ts";
import type { WorldState } from "@sim/types.ts";

function stubHost(state: WorldState, captured: number[]): MatchHost {
  return {
    isRunning: () => true,
    getStateSnapshot: () => state,
    injectInput: (_id: unknown, input: { keys: number }) => captured.push(input.keys),
    injectCardPick: () => {},
  } as unknown as MatchHost;
}

/** A world containing ONLY the bot — no foe, which is the idle path. */
function loneBotState(botId: string, botX: number): WorldState {
  return {
    tick: 0,
    rngState: 0,
    players: {
      [botId]: {
        id: botId,
        characterId: "balanced",
        x: botX,
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
    },
    projectiles: {},
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
  } as unknown as WorldState;
}

const MOVE_KEYS = InputBit.Left | InputBit.Right;

describe("bot idle floor (footage S1)", () => {
  test("an idle bot never goes a full second without pressing a move key", () => {
    // The filmed bug, expressed as the rule it broke. 600 ticks ~ 10 s.
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;

    let x = 600;
    let longestStillTicks = 0;
    let stillTicks = 0;
    for (let i = 0; i < 600; i += 1) {
      const captured: number[] = [];
      // Let the bot actually travel, so this measures INTENT rather than
      // the stuck path.
      const host = stubHost(loneBotState(botId, x), captured);
      bots.think(host, 1000 + i * 16);
      const keys = captured[0] ?? 0;
      if ((keys & MOVE_KEYS) === 0) {
        stillTicks += 1;
        longestStillTicks = Math.max(longestStillTicks, stillTicks);
      } else {
        stillTicks = 0;
        x += (keys & InputBit.Right) !== 0 ? 6 : -6;
      }
    }
    // 60 ticks = 1 s at the sim's 60 Hz. Before the fix this reached the
    // 900-2300 ms hold, and stacked across consecutive zero rolls.
    expect(longestStillTicks).toBeLessThan(60);
  });

  test("an idle bot pinned against geometry turns around instead of leaning", () => {
    // x never changes — a wall. The engaged path had unstick logic; the idle
    // path returned before reaching it, so a bot with nothing to fight
    // pressed into the wall indefinitely (exactly the filmed pose).
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;

    let left = 0;
    let right = 0;
    let jumped = false;
    for (let i = 0; i < 240; i += 1) {
      const captured: number[] = [];
      const host = stubHost(loneBotState(botId, 60), captured);
      bots.think(host, 1000 + i * 16);
      const keys = captured[0] ?? 0;
      if ((keys & InputBit.Left) !== 0) left += 1;
      if ((keys & InputBit.Right) !== 0) right += 1;
      if ((keys & InputBit.Jump) !== 0) jumped = true;
    }
    // It must try BOTH directions rather than committing to the wall, and
    // hop while doing it.
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(jumped).toBe(true);
  });

  test("the idle direction is never zero", () => {
    // The direct cause. Sampling many fresh bots covers the RNG rather than
    // trusting one draw.
    const bots = new WorldBots();
    const ids = bots.spawnInfosFor(8).map((s) => s.playerId as unknown as string);
    let pressedNothing = 0;
    for (const botId of ids) {
      for (let i = 0; i < 30; i += 1) {
        const captured: number[] = [];
        // Fresh position each tick so the stuck path cannot be what supplies
        // the movement.
        const host = stubHost(loneBotState(botId, 600 + i * 7), captured);
        bots.think(host, 1000 + i * 16);
        if (((captured[0] ?? 0) & MOVE_KEYS) === 0) pressedNothing += 1;
      }
    }
    expect(pressedNothing).toBe(0);
  });
});
