// Track Z0b Item A (convergence-goal.md) — fast-respawn round semantics
// parity: TS ruled 2026-07-17 (Jake: option "A") that ordinary-round deaths
// re-form after RESPAWN_DELAY_MS at a spawn seal and a wiped field does NOT
// end the round — last-one-standing resolution belongs to SUDDEN DEATH
// only. world.zig's round machine used to end EVERY round on last-alive KO
// (the multiSeedDivergence sweep's dominant divergence source: Zig cycled
// whole rounds — respawn-all + score — while TS kept fighting, producing
// the oscillating ~1000-1500px spikes + alive-flag mismatches + 100-health
// deltas the Z0a baseline recorded).
//
// This file drives BOTH orchestrators in lockstep (same inputs, same tick
// cadence — the multiSeedDivergence harness discipline: statics/bounds/
// pads/slopes/spawn-points/target-score pinned per run, true prevKeys fed
// to Zig, fire configs written every tick) through a deterministic
// kill-plane death and asserts the ROUND SEMANTICS agree:
//   1. ordinary round: death does not end the round; the fallen player
//      re-forms on BOTH sides at the SAME tick, at the SAME
//      assignSpawnPoints seal, at full health;
//   2. sudden death: no respawn — the last player standing resolves the
//      round on both sides (one-tick skew allowed: TS steps its round
//      machine AFTER the tick's deaths, Zig's runs at the START of the
//      next tick — a known structural ordering difference, asserted
//      explicitly rather than papered over).
//
// The kill mechanism is the void kill-plane (player spawned past the floor
// edge, no inputs) — zero combat involved, so the death tick itself is
// covered by existing kill-plane parity and this file measures ONLY the
// round/respawn machinery Item A ported.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import { RESPAWN_DELAY_MS } from "../../constants";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime, assignSpawnPoints } from "../../World";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
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
await applyWasmPlayerFlag(); // same wasm stepPlayer on both sides — isolates round semantics

const DT_MS = 1000 / 60;
const MAP: MapDefinition = {
  id: "respawn-parity-arena",
  name: "Respawn Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 300, y: 400 },
    { x: 550, y: 400 },
    { x: 800, y: 400 },
    { x: 1050, y: 400 },
  ],
  platforms: [
    // Center-origin (platformToAABB convention): floor spans x 0..1600,
    // top at y=700 — the doomed player is spawned PAST x=1600 so it falls
    // clean into the void with zero inputs.
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

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
    fireCooldownMs: 9999, // never fires — no combat noise in this measurement
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

type RunResult = {
  tsDeathTick: number | null;
  zigDeathTick: number | null;
  tsRespawnTick: number | null;
  zigRespawnTick: number | null;
  tsRespawnPos: { x: number; y: number } | null;
  zigRespawnPos: { x: number; y: number } | null;
  tsRespawnHealth: number | null;
  zigRespawnHealth: number | null;
  tsFightingLeftTick: number | null;
  zigFightingLeftTick: number | null;
  tsFinal: WorldState;
  zigFinal: WorldState;
};

/** Drive both orchestrators in lockstep with zero inputs. `p1` starts past
 *  the floor edge and falls into the kill plane; everything after that is
 *  the round/respawn machinery under test. */
function runLockstep(opts: {
  ticks: number;
  suddenDeath: boolean;
  scores: Record<string, number>;
}): RunResult {
  const playerIds = ["p0", "p1"];
  const runtime = createRuntime(MAP);
  const baseRound = {
    phase: "fighting" as const,
    countdownRemainingMs: 90_000,
    scores: Object.fromEntries(
      Object.entries(opts.scores).map(([k, v]) => [PlayerId(k), v]),
    ),
    roundIndex: 1,
    winnerPlayerId: null,
    ...(opts.suddenDeath ? { suddenDeathActive: true } : {}),
  };
  let tsState: WorldState = {
    tick: Tick(0),
    rngState: 7,
    players: {
      [PlayerId("p0")]: makePlayer("p0", 300, 400),
      // Past the floor's right edge (x>1600) — falls into the void.
      [PlayerId("p1")]: makePlayer("p1", 1700, 400),
    } as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: baseRound,
  };

  // Pin ALL module-level wasm state per run (multiSeedDivergence harness
  // discipline — the wasm instance + backend caches are shared across every
  // test file in this bun process).
  setWorldStatics(
    MAP.platforms.map(platformToAABB),
    MAP.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  setWorldArenaBounds(
    runtime.ceilingClampY,
    MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
  setWorldLaunchPads([]);
  setWorldSlopes([]);
  setWorldSpawnPoints(MAP.spawns);
  setWorldTargetScore(resolveModeConfig(undefined).targetScore);
  let zigState: WorldState = structuredClone(tsState);

  const out: RunResult = {
    tsDeathTick: null,
    zigDeathTick: null,
    tsRespawnTick: null,
    zigRespawnTick: null,
    tsRespawnPos: null,
    zigRespawnPos: null,
    tsRespawnHealth: null,
    zigRespawnHealth: null,
    tsFightingLeftTick: null,
    zigFightingLeftTick: null,
    tsFinal: tsState,
    zigFinal: zigState,
  };

  for (let t = 0; t < opts.ticks; t++) {
    const tsInputs: Record<PlayerId, InputFrame | null> = {};
    for (const id of playerIds) {
      tsInputs[PlayerId(id)] = {
        seq: InputSeq(t + 1),
        tick: Tick(t + 1),
        keys: 0,
        aimX: 400,
        aimY: 400,
        dtMs: DT_MS,
      };
    }
    tsState = stepWithRuntime(tsState, runtime, tsInputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map(
      playerIds.map((id) => [id, { keys: 0, prevKeys: 0, aimX: 400, aimY: 400 }]),
    );
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

    const tsP1 = tsState.players[PlayerId("p1")];
    const zigP1 = zigState.players[PlayerId("p1")];
    if (out.tsDeathTick === null && tsP1 && !tsP1.alive) out.tsDeathTick = t;
    if (out.zigDeathTick === null && zigP1 && !zigP1.alive) out.zigDeathTick = t;
    if (out.tsDeathTick !== null && out.tsRespawnTick === null && tsP1?.alive) {
      out.tsRespawnTick = t;
      out.tsRespawnPos = { x: tsP1.x, y: tsP1.y };
      out.tsRespawnHealth = tsP1.health;
    }
    if (out.zigDeathTick !== null && out.zigRespawnTick === null && zigP1?.alive) {
      out.zigRespawnTick = t;
      out.zigRespawnPos = { x: zigP1.x, y: zigP1.y };
      out.zigRespawnHealth = zigP1.health;
    }
    if (out.tsFightingLeftTick === null && tsState.round.phase !== "fighting")
      out.tsFightingLeftTick = t;
    if (out.zigFightingLeftTick === null && zigState.round.phase !== "fighting")
      out.zigFightingLeftTick = t;
  }

  out.tsFinal = tsState;
  out.zigFinal = zigState;
  return out;
}

describe("fast-respawn round semantics — TS vs Zig (Track Z0b Item A)", () => {
  test("ordinary round: a death does NOT end the round; the fallen re-form at the same tick, seal, and health on both sides", () => {
    // 3s delay at 60Hz + fall time (~2.6s from y=400 to the kill plane) —
    // 600 ticks (10s) covers death + respawn with margin.
    const r = runLockstep({ ticks: 600, suddenDeath: false, scores: {} });

    // Death happens, at the same tick, on both sides (kill-plane parity).
    expect(r.tsDeathTick).not.toBeNull();
    expect(r.zigDeathTick).toBe(r.tsDeathTick);

    // A wiped-to-one field does NOT end an ordinary round (fast-respawn
    // ruling): both sides stay in `fighting` for the whole run and no
    // score is credited.
    expect(r.tsFightingLeftTick).toBeNull();
    expect(r.zigFightingLeftTick).toBeNull();
    expect(r.tsFinal.round.scores[PlayerId("p0")] ?? 0).toBe(0);
    expect(r.zigFinal.round.scores[PlayerId("p0")] ?? 0).toBe(0);

    // The respawn comes due after RESPAWN_DELAY_MS on BOTH sides, at the
    // exact same tick (both stamp deathTick + ceil(3000/dt) and re-form on
    // the tick the stamp comes due).
    const delayTicks = Math.ceil(RESPAWN_DELAY_MS / DT_MS);
    expect(r.tsRespawnTick).toBe(r.tsDeathTick! + delayTicks);
    expect(r.zigRespawnTick).toBe(r.tsRespawnTick);

    // Same spawn seal — the exact assignSpawnPoints seat for `p1` in the
    // sorted 2-player roster (derived, not hardcoded, so a map edit can't
    // silently turn this into a stale-constant test).
    const expectedSeat = assignSpawnPoints(
      MAP,
      ["p0", "p1"],
    ).get("p1")!;
    expect(r.tsRespawnPos).toEqual({ x: expectedSeat.x, y: expectedSeat.y });
    expect(r.zigRespawnPos).toEqual(r.tsRespawnPos);

    // Full health on re-form (maxHealthForPlayer — balanced chassis 100).
    expect(r.tsRespawnHealth).toBe(100);
    expect(r.zigRespawnHealth).toBe(100);
  });

  test("sudden death: last-one-standing resolves the round on both sides; the fallen never re-form", () => {
    const target = resolveModeConfig(undefined).targetScore;
    const r = runLockstep({
      ticks: 600,
      suddenDeath: true,
      // Game-point tie — the state that makes suddenDeathActive true in
      // the first place (isSuddenDeathRound: every scorer at target-1).
      scores: { p0: target - 1, p1: target - 1 },
    });

    expect(r.tsDeathTick).not.toBeNull();
    expect(r.zigDeathTick).toBe(r.tsDeathTick);

    // The round RESOLVES on the last-alive rule — both sides leave
    // `fighting`. One-tick skew allowed and asserted exactly: TS steps its
    // round machine AFTER the tick's deaths (same tick), Zig's runs at the
    // START of the following tick — a structural ordering difference, not
    // a semantics gap.
    expect(r.tsFightingLeftTick).toBe(r.tsDeathTick);
    expect(r.zigFightingLeftTick).not.toBeNull();
    expect(r.zigFightingLeftTick! - r.tsFightingLeftTick!).toBeLessThanOrEqual(1);
    expect(r.zigFightingLeftTick!).toBeGreaterThanOrEqual(r.tsFightingLeftTick!);

    // The survivor is credited on both sides (game point → match point).
    expect(r.tsFinal.round.scores[PlayerId("p0")] ?? 0).toBe(target);
    expect(r.zigFinal.round.scores[PlayerId("p0")] ?? 0).toBe(target);

    // No re-forming in sudden death — the fallen stay benched.
    expect(r.tsRespawnTick).toBeNull();
    expect(r.zigRespawnTick).toBeNull();
  });
});
