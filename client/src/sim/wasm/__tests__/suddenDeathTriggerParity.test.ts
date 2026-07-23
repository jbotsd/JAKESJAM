// Track Z0a (convergence-goal.md) — port of orphaned-branch commit 02b74f5's
// suddenDeathTriggerParity.test.ts, adapted to main's 624-byte PlayerEntity /
// 56-byte header layout. Verifies the sudden-death TRIGGER port in world.zig
// (isSuddenDeathRound): before this, step_world had NO sudden-death state at
// all on main — the header bit, the trigger, and the score/target_score
// patchers all arrive together in this port. This is the first time
// step_world independently reproduces World.ts round.ts's "every scored
// player is exactly one round from winning" check.
//
// Also fixed in the same port (not just documented): world_state_set_
// target_score was declared as an export but never actually called anywhere
// in production, AND packWorldState hardcodes target_score to 0 every single
// pack — so even a one-off call to the raw export got wiped by the very next
// tick, exactly the same bug class as player scores (see
// writeScoresIntoMemory). Both match-end detection and this sudden-death
// trigger were permanently inert in the full step_world path before this.
// Added setWorldTargetScore + writeTargetScoreIntoMemory, the same
// cached-and-reapplied-every-tick pattern setWorldArenaBounds already uses.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFull,
  setWorldTargetScore,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import {
  InputSeq,
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

// The wasm module (and the TS backend's module-level caches) are SHARED
// across every test file in one bun process — see wasmFullSessionEvidence's
// quarantine note and the 3f16fe3 cross-contamination finding. Pin every
// piece of module-level Zig state this test's outcome could read, so a
// statics/arena-bounds cache left behind by another file can't kill a player
// (or collide one) mid-assertion. killPlaneY=0 DISARMS the void-plane gate
// (g_kill_plane_y > 0) — nothing here should die in the single tick stepped.
setWorldStatics([], []);
setWorldArenaBounds(null, 0);
setWorldLaunchPads([]);
setWorldSlopes([]);

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
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

describe("sudden-death TRIGGER — world.zig isSuddenDeathRound (Track Z0a)", () => {
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
