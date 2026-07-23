// Track Z0b Item C (convergence-goal.md) — port of the orphaned branch's
// suddenDeathParity.test.ts (commit 9aeabaa): verifies the shrink-zone
// storm port in world.zig against client/src/sim/suddenDeath.ts. This was
// the ONE sim concern with zero Zig code at all before the port (confirmed
// by grep across sim/src — no file, no inline logic, nothing).
//
// Two mutually-exclusive zones: the soft "endgame" zone (every round,
// final 15s, eases coverage down to 0.75) and true "sudden death" (a
// game-point tie, shrinks the WHOLE round down to 0.6, harder). Both
// damage any alive player standing outside a circle centered on the map,
// scaled by round progress. The trigger decision for true sudden death
// (WHEN to set suddenDeathActive) lives in the round machine (Z0a ported
// the Zig side of that; suddenDeathTriggerParity.test.ts covers it) —
// this file verifies the DAMAGE application, which Z0b Item C moved INTO
// Zig for the wasm path after confirming that path previously skipped
// storm damage entirely (TS's World.ts §3d block never runs when
// step_world replaces stepWithRuntime, and serverWasmHost's mergeUnpacked
// only passes the flag through — see world.zig §2z's ownership note).
//
// Adaptations from the branch spec (deliberate):
//   - `setWorldMapSize` never existed on main — the port consumes the
//     Phase-4c `world_state_set_arena_size` export (unwired until this
//     cut) via setWorldArenaSize;
//   - Z0a harness discipline: ALL module-level wasm state is pinned per
//     test (statics/bounds/pads/slopes/spawn-points/target-score) — the
//     wasm instance is shared across every test file in this bun process;
//   - applyWasmWorldStepFullSync (the sync step the other Z0 tests use).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldArenaSize,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { resolveModeConfig } from "../../data/modeConfig";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import {
  InputSeq,
  PlayerId,
  Tick,
  type PlayerEntity,
  type RoundState,
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
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function makeState(player: PlayerEntity, round: RoundState): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: { [player.id]: player } as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round,
  };
}

function stepOnce(state: WorldState) {
  // Pin ALL module-level wasm state (Z0a harness discipline).
  setWorldStatics([], []);
  setWorldArenaBounds(null, 0); // no ceiling, kill-plane disabled
  setWorldArenaSize(MAP_W, MAP_H);
  setWorldLaunchPads([]);
  setWorldSlopes([]);
  setWorldSpawnPoints([{ x: CENTER_X, y: CENTER_Y }]);
  setWorldTargetScore(resolveModeConfig(undefined).targetScore);
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(state);
  return applyWasmWorldStepFullSync(state, DT_MS);
}

describe("shrink-zone storm — world.zig port (Z0b Item C, spec 9aeabaa)", () => {
  test("true sudden death: player OUTSIDE the shrunk zone takes exact TS-formula damage", () => {
    // suddenDeathActive scale walks SUDDEN_DEATH_SCALE_START(1.0) ->
    // SCALE_END(0.6) over ROUND_TIME_LIMIT_MS(90000) as countdownRemainingMs
    // counts down from it. At countdownRemainingMs=0 (elapsed=full 90s),
    // frac=1, scale=0.6 exactly — deterministic, no interpolation ambiguity.
    // (world.zig reads the PRE-step round snapshot, same as TS reads
    // `state.round` at tick entry — see §0b — so countdown 0 entering the
    // tick still storms at full scale even as the round transitions.)
    const outsideX = CENTER_X + BASE_RADIUS * 0.6 + 50; // safely outside a 0.6-scale zone
    const state = makeState(makePlayer("out", outsideX, CENTER_Y), {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
      suddenDeathActive: true,
    });
    const { state: next } = stepOnce(state);
    const p = next.players[PlayerId("out")]!;
    // TS formula: SUDDEN_DEATH_STORM_DPS(8) * (dtMs/1000).
    const expectedDamage = 8 * (DT_MS / 1000);
    expect(100 - p.health).toBeCloseTo(expectedDamage, 5);
  });

  test("true sudden death: player INSIDE the shrunk zone takes zero damage", () => {
    const state = makeState(makePlayer("in", CENTER_X, CENTER_Y), {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
      suddenDeathActive: true,
    });
    const { state: next } = stepOnce(state);
    const p = next.players[PlayerId("in")]!;
    expect(p.health).toBe(100);
  });

  test("soft endgame zone: applies EVERY round (no suddenDeathActive needed) in the final 15s", () => {
    // ENDGAME_ZONE_TRIGGER_MS=15000, ENDGAME_ZONE_SCALE_END=0.75. At
    // countdownRemainingMs=0 (localElapsed=full 15s), frac=1, scale=0.75.
    const outsideX = CENTER_X + BASE_RADIUS * 0.75 + 50;
    const state = makeState(makePlayer("late", outsideX, CENTER_Y), {
      phase: "fighting",
      countdownRemainingMs: 0, // final instant of the round, no sudden death
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    });
    const { state: next } = stepOnce(state);
    const p = next.players[PlayerId("late")]!;
    expect(100 - p.health).toBeCloseTo(8 * (DT_MS / 1000), 5);
  });

  test("no zone active mid-round (not sudden death, not in the final 15s) — no damage anywhere", () => {
    const farX = CENTER_X + BASE_RADIUS * 3; // absurdly far, would take damage under ANY active zone
    const state = makeState(makePlayer("mid", farX, CENTER_Y), {
      phase: "fighting",
      countdownRemainingMs: 60_000, // mid-round, well outside the endgame window
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    });
    const { state: next } = stepOnce(state);
    const p = next.players[PlayerId("mid")]!;
    expect(p.health).toBe(100);
  });

  test("is_fighting gate: no storm damage during drafting even if suddenDeathActive is (stale-)true", () => {
    const outsideX = CENTER_X + BASE_RADIUS * 0.6 + 50;
    const state = makeState(makePlayer("draft", outsideX, CENTER_Y), {
      phase: "drafting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
      suddenDeathActive: true,
    });
    const { state: next } = stepOnce(state);
    const p = next.players[PlayerId("draft")]!;
    expect(p.health).toBe(100);
  });

  test("fail-closed map-size gate: arena size never set → the storm is inert even in full sudden death", () => {
    // Not in the branch spec (its setter was mandatory in the harness) —
    // added here because main's arena-size export spent months unwired and
    // Zig-only tests never call it: the gate is what makes that safe.
    const outsideX = CENTER_X + BASE_RADIUS * 0.6 + 50;
    const state = makeState(makePlayer("nogate", outsideX, CENTER_Y), {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
      suddenDeathActive: true,
    });
    // Same pins as stepOnce EXCEPT the arena size, cleared to 0×0.
    setWorldStatics([], []);
    setWorldArenaBounds(null, 0);
    setWorldArenaSize(0, 0);
    setWorldLaunchPads([]);
    setWorldSlopes([]);
    setWorldSpawnPoints([{ x: CENTER_X, y: CENTER_Y }]);
    setWorldTargetScore(resolveModeConfig(undefined).targetScore);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: next } = applyWasmWorldStepFullSync(state, DT_MS);
    const p = next.players[PlayerId("nogate")]!;
    expect(p.health).toBe(100);
  });
});
