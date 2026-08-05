// Track E1d (gospel-goal.md E1 — "hangout flag in `step_world`", lifting
// the hosts' TS-only pin): TS-vs-Zig LOCKSTEP over a HANGOUT world.
//
// The 2026-07-24 pin (matchHost simBackend comment, Track Z2 item 3)
// recorded three behaviours Zig lacked, with lift condition "a step_world
// hangout mode flag covering all three". world.zig's g_hangout_mode +
// world_state_set_hangout_mode now exist; this file drives the SAME
// scenario through both orchestrators tick-for-tick and asserts:
//   (1) PvP immunity — a landed-in-combat shot deals ZERO player damage
//       in hangout, on BOTH sides (with an in-file combat control proving
//       the scenario genuinely hits — vacuity guard);
//   (2) the round machine never steps — phase/countdown/roundIndex frozen
//       bit-identically on both sides;
//   (3) projectiles ghost THROUGH players (observed past the victim's far
//       edge) and hitscan resolves no player hit, both sides.
// Per-tick player kinematics + health are asserted EQUAL (toBe on the f64
// bits — movement routes through the same wasm stepPlayer on both sides
// via applyWasmPlayerFlag, the standing parity-harness discipline).

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
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { resolveModeConfig } from "../../data/modeConfig";
import { createRuntime, stepWithRuntime } from "../../World";
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
// Route TS movement through the same wasm stepPlayer + install the trig
// LUT — without this the two sides differ at the 1e-4 level on every
// lut-vs-libm call and bit-equality below is unreachable (the standing
// harness discipline, see tickOrderParity.test.ts).
await applyWasmPlayerFlag();

const SHOOTER = PlayerId("p0");
const VICTIM = PlayerId("v0"); // localeCompare-sorts AFTER p0 — pack slot 1
const DT_MS = 16.667;
const FireBit = 1 << 6;

// One long floor so everyone stands still (falling bodies would smuggle
// gravity into every kinematic assert and let the beam line miss).
// Floor top = 400 - 50 = 350; a grounded body centre sits at 350 - 28 = 322.
const GROUND_Y = 322;
const hangoutMap: MapDefinition = {
  id: "hangout-parity-arena",
  name: "Hangout Parity Arena",
  size: { x: 4000, y: 4000 },
  spawns: [{ x: 400, y: GROUND_Y }],
  platforms: [
    {
      id: "floor",
      position: { x: 2000, y: 400 },
      size: { x: 4000, y: 100 },
      kind: "floor",
    },
  ],
};

function makePlayer(id: PlayerId, x: number, cards: string[]): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    aimX: 700,
    aimY: GROUND_Y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards,
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function makeState(shooterCards: string[]): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {
      [SHOOTER]: makePlayer(SHOOTER, 400, shooterCards),
      [VICTIM]: makePlayer(VICTIM, 700, []),
    } as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 60_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

/** Pin the wasm module's per-match config to THIS file's arena (the wasm
 *  instance is shared across every test file in the bun process). */
function pinWasmWorldConfig(runtime: ReturnType<typeof createRuntime>): void {
  setWorldStatics(
    hangoutMap.platforms.map((p) => ({
      x: p.position.x - p.size.x / 2,
      y: p.position.y - p.size.y / 2,
      w: p.size.x,
      h: p.size.y,
    })),
    hangoutMap.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  setWorldArenaBounds(runtime.ceilingClampY, 0);
  setWorldLaunchPads([]);
  setWorldSlopes([]);
  setWorldSpawnPoints(hangoutMap.spawns);
  setWorldTargetScore(resolveModeConfig(undefined).targetScore);
}

type StepPair = {
  ts: WorldState;
  zig: WorldState;
};

/** Drive BOTH orchestrators over the same input tape. `hangout` selects
 *  runtime mode (TS) and the step_world flag (Zig) together — the exact
 *  pairing the hosts now wire (matchHost / WasmStepStrategy). Asserts
 *  per-tick lockstep equality on the shared-simulated surface and returns
 *  the final states plus per-tick projectile observations. */
function runLockstep(
  shooterCards: string[],
  hangout: boolean,
  ticks: number,
  fireTicks: number,
): StepPair & { maxProjectileX: number; sawProjectile: boolean } {
  const tsRuntime = createRuntime(hangoutMap, hangout ? "hangout" : "combat");
  let tsState = makeState(shooterCards);

  pinWasmWorldConfig(tsRuntime);
  let zigState = makeState(shooterCards);
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(zigState);

  let prevKeys = 0;
  let maxProjectileX = -Infinity;
  let sawProjectile = false;

  for (let t = 1; t <= ticks; t++) {
    const keys = t <= fireTicks ? FireBit : 0;
    const inputs: Record<PlayerId, InputFrame | null> = {
      [SHOOTER]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys,
        aimX: 700,
        aimY: GROUND_Y,
        dtMs: DT_MS,
      },
      [VICTIM]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: 0,
        aimX: 0,
        aimY: GROUND_Y,
        dtMs: DT_MS,
      },
    };
    tsState = stepWithRuntime(tsState, tsRuntime, inputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [SHOOTER as string, { keys, prevKeys, aimX: 700, aimY: GROUND_Y }],
      [VICTIM as string, { keys: 0, prevKeys: 0, aimX: 0, aimY: GROUND_Y }],
    ]);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS, {
      hangoutMode: hangout,
    }).state;
    prevKeys = keys;

    // ── Per-tick lockstep equality on the shared-simulated surface ──
    expect(zigState.tick).toBe(tsState.tick);
    expect(zigState.round.phase).toBe(tsState.round.phase);
    expect(zigState.round.countdownRemainingMs).toBe(
      tsState.round.countdownRemainingMs,
    );
    expect(zigState.round.roundIndex).toBe(tsState.round.roundIndex);
    for (const pid of [SHOOTER, VICTIM]) {
      const tp = tsState.players[pid]!;
      const zp = zigState.players[pid]!;
      expect(zp.x).toBe(tp.x);
      expect(zp.y).toBe(tp.y);
      expect(zp.vx).toBe(tp.vx);
      expect(zp.vy).toBe(tp.vy);
      expect(zp.health).toBe(tp.health);
      expect(zp.alive).toBe(tp.alive);
    }
    expect(Object.keys(zigState.projectiles).length).toBe(
      Object.keys(tsState.projectiles).length,
    );
    for (const proj of Object.values(zigState.projectiles)) {
      sawProjectile = true;
      if (proj.x > maxProjectileX) maxProjectileX = proj.x;
    }
  }
  return { ts: tsState, zig: zigState, maxProjectileX, sawProjectile };
}

// Victim body: centre x=700, base half-width 15 (class-scaled ~1 for
// wizard) — far edge ~715. A shard observed past 730 has flown THROUGH.
const VICTIM_FAR_EDGE_X = 730;

describe("hangout flag — TS-vs-Zig lockstep over a hangout world (Track E1d, the pin's three behaviours)", () => {
  test("combat control (vacuity guard): the same beam scenario genuinely lands — victim damaged identically on both sides", () => {
    const run = runLockstep(["continuous-refractor"], false, 40, 3);
    expect(run.sawProjectile).toBe(true);
    expect(run.ts.players[VICTIM]!.health).toBeLessThan(100);
    expect(run.zig.players[VICTIM]!.health).toBe(run.ts.players[VICTIM]!.health);
    // Combat round clock genuinely ticks (the hangout test's freeze
    // assert below is meaningful).
    expect(run.ts.round.countdownRemainingMs).toBeLessThan(60_000);
  });

  test("hangout: PvP immune + projectiles ghost through players + round machine frozen — bit-identical lockstep for 40 ticks", () => {
    const run = runLockstep(["continuous-refractor"], true, 40, 3);
    // (1) PvP immunity — the beam that lands in combat deals nothing here.
    expect(run.sawProjectile).toBe(true);
    expect(run.ts.players[VICTIM]!.health).toBe(100);
    expect(run.zig.players[VICTIM]!.health).toBe(100);
    // (3) ...because the shard GHOSTS through the body, it keeps flying
    // past the victim's far edge instead of consuming on it.
    expect(run.maxProjectileX).toBeGreaterThan(VICTIM_FAR_EDGE_X);
    // (2) round machine frozen — clock/phase/index untouched after 40
    // ticks on BOTH sides (per-tick equality already asserted inside).
    expect(run.ts.round.phase).toBe("fighting");
    expect(run.zig.round.phase).toBe("fighting");
    expect(run.ts.round.countdownRemainingMs).toBe(60_000);
    expect(run.zig.round.countdownRemainingMs).toBe(60_000);
    expect(run.zig.round.roundIndex).toBe(1);
  });

  test("hangout: hitscan ghosts players too — the bare wizard's same-tick ray (Geometrician ALWAYS raycast) resolves no player hit on either side; combat control lands it", () => {
    // Combat control first (vacuity guard): the bare-wizard ray hits.
    const combat = runLockstep([], false, 3, 3);
    expect(combat.ts.players[VICTIM]!.health).toBeLessThan(100);
    expect(combat.zig.players[VICTIM]!.health).toBe(
      combat.ts.players[VICTIM]!.health,
    );

    // Hangout: identical ray, empty player candidate pool on both sides.
    const run = runLockstep([], true, 3, 3);
    expect(run.ts.players[VICTIM]!.health).toBe(100);
    expect(run.zig.players[VICTIM]!.health).toBe(100);
  });
});
