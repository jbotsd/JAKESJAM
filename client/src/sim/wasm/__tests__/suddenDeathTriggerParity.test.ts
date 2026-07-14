// Zig e2e cutover investigation, 2026-07-14 — verifies the sudden-death
// TRIGGER port in world.zig (isSuddenDeathRound), separate from the storm
// DAMAGE port (suddenDeathParity.test.ts) added earlier this session.
// Before this, step_world only CONSUMED header.sudden_death_active if some
// external caller set it — it never decided the trigger itself. This is
// the first time step_world independently reproduces World.ts round.ts's
// "every scored player is exactly one round from winning" check.
//
// Also fixed in the same pass (not just documented): world_state_set_
// target_score was declared as an export but never actually called
// anywhere in production, AND packWorldState hardcodes target_score to 0
// every single pack — so even a one-off call to the raw export got wiped
// by the very next tick, exactly the same bug class as player scores (see
// writeScoresIntoMemory). Both match-end detection and this sudden-death
// trigger were permanently inert in the full step_world path before this.
// Added setWorldTargetScore + writeTargetScoreIntoMemory, the same
// cached-and-reapplied-every-tick pattern setWorldArenaBounds/
// setWorldMapSize already use.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFull,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import {
  PlayerId,
  Tick,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await loadSimFromBytes(ab);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm"))
    return Promise.resolve(
      new Response(ab as ArrayBuffer, { headers: { "Content-Type": "application/wasm" } }),
    );
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;
await preloadWasmWorldSim();
await wasmHost.preload();

function makePlayer(id: string): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    aimX: 500,
    aimY: 300,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 9999,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
}

describe("sudden-death TRIGGER — world.zig isSuddenDeathRound (2026-07-14)", () => {
  test("countdown->fighting with 2 players both at targetScore-1 sets suddenDeathActive", async () => {
    setWorldTargetScore(3);
    const p1 = makePlayer("p1"); // score set below, in round.scores — targetScore(3) - 1
    const p2 = makePlayer("p2");
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: { [PlayerId("p1")]: p1, [PlayerId("p2")]: p2 } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "countdown",
        countdownRemainingMs: 1, // about to transition to fighting THIS tick
        scores: { [PlayerId("p1")]: 2, [PlayerId("p2")]: 2 } as Record<string, number>,
        roundIndex: 1,
        winnerPlayerId: null,
      },
    };
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);

    expect(next.round.phase).toBe("fighting");
    expect(next.round.suddenDeathActive).toBe(true);
  });

  test("countdown->fighting with scores NOT tied at targetScore-1 leaves suddenDeathActive unset", async () => {
    setWorldTargetScore(3);
    const p1 = makePlayer("p1"); // score 1 — NOT targetScore(3)-1
    const p2 = makePlayer("p2"); // score 2
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: { [PlayerId("p1")]: p1, [PlayerId("p2")]: p2 } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "countdown",
        countdownRemainingMs: 1,
        scores: { [PlayerId("p1")]: 1, [PlayerId("p2")]: 2 } as Record<string, number>,
        roundIndex: 1,
        winnerPlayerId: null,
      },
    };
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);

    expect(next.round.phase).toBe("fighting");
    expect(next.round.suddenDeathActive).toBeUndefined();
  });

  test("only 1 scored player never triggers, even if at targetScore-1", async () => {
    setWorldTargetScore(3);
    const p1 = makePlayer("p1"); // score 2 == targetScore-1
    const p2 = makePlayer("p2"); // never scored — TS sparse map excludes them
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: { [PlayerId("p1")]: p1, [PlayerId("p2")]: p2 } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "countdown",
        countdownRemainingMs: 1,
        scores: { [PlayerId("p1")]: 2 } as Record<string, number>,
        roundIndex: 1,
        winnerPlayerId: null,
      },
    };
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);

    expect(next.round.phase).toBe("fighting");
    expect(next.round.suddenDeathActive).toBeUndefined();
  });
});
