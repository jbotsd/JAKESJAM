// WorldBots stuck-detection contract.
//
// Bug: bots have no terrain map and pushed a fixed horizontal direction
// toward/away from the foe, so they pinned themselves against walls/ledges
// forever (user report: "bots get stuck on terrain"). The unstick logic
// must notice "intended to move but didn't" and jump + reverse to escape.

import { describe, expect, test } from "bun:test";
import { InputBit } from "@net/protocol.ts";
import { WorldBots } from "../worldBots.ts";
import type { MatchHost } from "../matchHost.ts";
import type { WorldState } from "@sim/types.ts";

/** Minimal MatchHost stub that holds a fixed state and captures injected
 *  inputs. The bot's position never changes → it is "stuck". */
function stubHost(state: WorldState, captured: number[]): MatchHost {
  return {
    isRunning: () => true,
    getStateSnapshot: () => state,
    injectInput: (_id: unknown, input: { keys: number }) => captured.push(input.keys),
    injectCardPick: () => {},
  } as unknown as MatchHost;
}

function fightingState(botId: string, botX: number, foeX = 1200): WorldState {
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
      foe: {
        id: "foe",
        characterId: "balanced",
        x: foeX,
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

describe("WorldBots unstick", () => {
  test("a bot pinned FAR from its foe jumps AND keeps pressing toward it (no standoff)", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;

    // Pinned at the left wall (x constant), foe far to the right. The bot
    // must try to jump free AND keep heading toward the foe — never sustain
    // a retreat away from it (the standoff bug).
    const state = fightingState(botId, 60, 1200);
    const captured: number[] = [];
    const host = stubHost(state, captured);

    let jumped = false;
    let rightPresses = 0;
    let leftPresses = 0;
    for (let i = 0; i < 120; i += 1) {
      captured.length = 0;
      bots.think(host, 1000 + i * 16);
      const k = captured[0] ?? 0;
      if ((k & InputBit.Jump) !== 0) jumped = true;
      if ((k & InputBit.Right) !== 0) rightPresses += 1;
      if ((k & InputBit.Left) !== 0) leftPresses += 1;
    }
    expect(jumped).toBe(true); // tries to unstick
    // Overwhelmingly presses TOWARD the foe; only rare brief unwedge nudges
    // go the other way. The old standoff bug sustained long reversals.
    expect(rightPresses).toBeGreaterThan(leftPresses * 4);
    expect(rightPresses).toBeGreaterThan(90);
  });

  test("a bot advancing toward the foe moves right and rarely jumps", () => {
    const bots = new WorldBots();
    const botId = bots.spawnInfosFor(1)[0]!.playerId as unknown as string;

    let x = 60;
    let rightInputs = 0;
    let jumps = 0;
    for (let i = 0; i < 40; i += 1) {
      x += 6; // genuinely advancing toward the foe (x=1200)
      const captured: number[] = [];
      const host = stubHost(fightingState(botId, x), captured);
      bots.think(host, 1000 + i * 16);
      if (captured.some((k) => (k & InputBit.Right) !== 0)) rightInputs += 1;
      if (captured.some((k) => (k & InputBit.Jump) !== 0)) jumps += 1;
    }
    // Chases the foe to the right, and does NOT spam unstick jumps.
    expect(rightInputs).toBeGreaterThan(20);
    expect(jumps).toBeLessThan(8);
  });
});
