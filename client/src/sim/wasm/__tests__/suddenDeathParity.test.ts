// Zig e2e cutover investigation, 2026-07-14 — verifies the shrink-zone
// storm port in world.zig against client/src/sim/suddenDeath.ts. This was
// the ONE sim concern with zero Zig code at all before this port (confirmed
// by grep across sim/src — no file, no inline logic, nothing).
//
// Two mutually-exclusive zones: the soft "endgame" zone (every round,
// final 15s, eases coverage down to 0.75) and true "sudden death" (a 2-2
// tie, shrinks the WHOLE round down to 0.6, harder). Both damage any
// alive player standing outside a circle centered on the map, scaled by
// round progress. The trigger decision for true sudden death (WHEN to set
// suddenDeathActive) still lives in TS — this only verifies the DAMAGE
// application once the flag/timing already says a zone should be active,
// same "pass-through" scope as the drafting overlay.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFull,
  setWorldMapSize,
  setWorldStatics,
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

const MAP_W = 1600;
const MAP_H = 900;
const DT_MS = 16.667;
// Half-diagonal of the map — the SAME base radius formula both TS and
// this test independently compute, so the "outside" player position
// below is derived, not guessed.
const BASE_RADIUS = Math.hypot(MAP_W, MAP_H) / 2;
const CENTER_X = MAP_W / 2;
const CENTER_Y = MAP_H / 2;

function makePlayer(id: string, x: number, y: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 9999, // never fires — isolates this test to storm damage
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
}

async function stepOnce(state: WorldState) {
  setWorldStatics([], []);
  setWorldMapSize(MAP_W, MAP_H);
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(state);
  return applyWasmWorldStepFull(state, DT_MS);
}

describe("shrink-zone storm — world.zig port (2026-07-14, zero prior Zig code)", () => {
  test("true sudden death: player OUTSIDE the shrunk zone takes exact TS-formula damage", async () => {
    // suddenDeathActive scale walks SUDDEN_DEATH_SCALE_START(1.0) ->
    // SCALE_END(0.6) over ROUND_TIME_LIMIT_MS(90000) as countdownRemainingMs
    // counts down from it. At countdownRemainingMs=0 (elapsed=full 90s),
    // frac=1, scale=0.6 exactly — deterministic, no interpolation ambiguity.
    const outsideX = CENTER_X + BASE_RADIUS * 0.6 + 50; // safely outside a 0.6-scale zone
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {
        [PlayerId("out")]: makePlayer("out", outsideX, CENTER_Y),
      } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 0,
        scores: {},
        roundIndex: 1,
        winnerPlayerId: null,
        suddenDeathActive: true,
      },
    };
    const { state: next } = await stepOnce(state);
    const p = next.players[PlayerId("out")]!;
    // TS formula: SUDDEN_DEATH_STORM_DPS(8) * (dtMs/1000).
    const expectedDamage = 8 * (DT_MS / 1000);
    expect(100 - p.health).toBeCloseTo(expectedDamage, 5);
  });

  test("true sudden death: player INSIDE the shrunk zone takes zero damage", async () => {
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {
        [PlayerId("in")]: makePlayer("in", CENTER_X, CENTER_Y), // dead center, always safe
      } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 0,
        scores: {},
        roundIndex: 1,
        winnerPlayerId: null,
        suddenDeathActive: true,
      },
    };
    const { state: next } = await stepOnce(state);
    const p = next.players[PlayerId("in")]!;
    expect(p.health).toBe(100);
  });

  test("soft endgame zone: applies EVERY round (no suddenDeathActive needed) in the final 15s", async () => {
    // ENDGAME_ZONE_TRIGGER_MS=15000, ENDGAME_ZONE_SCALE_END=0.75. At
    // countdownRemainingMs=0 (localElapsed=full 15s), frac=1, scale=0.75.
    const outsideX = CENTER_X + BASE_RADIUS * 0.75 + 50;
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {
        [PlayerId("late")]: makePlayer("late", outsideX, CENTER_Y),
      } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 0, // final instant of the round, no sudden death
        scores: {},
        roundIndex: 1,
        winnerPlayerId: null,
      },
    };
    const { state: next } = await stepOnce(state);
    const p = next.players[PlayerId("late")]!;
    expect(100 - p.health).toBeCloseTo(8 * (DT_MS / 1000), 5);
  });

  test("no zone active mid-round (not sudden death, not in the final 15s) — no damage anywhere", async () => {
    const farX = CENTER_X + BASE_RADIUS * 3; // absurdly far, would take damage under ANY active zone
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {
        [PlayerId("mid")]: makePlayer("mid", farX, CENTER_Y),
      } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 60_000, // mid-round, well outside the endgame window
        scores: {},
        roundIndex: 1,
        winnerPlayerId: null,
      },
    };
    const { state: next } = await stepOnce(state);
    const p = next.players[PlayerId("mid")]!;
    expect(p.health).toBe(100);
  });

  test("is_fighting gate: no storm damage during drafting even if suddenDeathActive is (stale-)true", async () => {
    const outsideX = CENTER_X + BASE_RADIUS * 0.6 + 50;
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {
        [PlayerId("draft")]: makePlayer("draft", outsideX, CENTER_Y),
      } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "drafting",
        countdownRemainingMs: 0,
        scores: {},
        roundIndex: 1,
        winnerPlayerId: null,
        suddenDeathActive: true,
      },
    };
    const { state: next } = await stepOnce(state);
    const p = next.players[PlayerId("draft")]!;
    expect(p.health).toBe(100);
  });
});
