// Zig e2e cutover investigation, 2026-07-14 — proves (and later re-verifies
// the fix for) a structural tick-order divergence between the TS orchestrator
// (World.ts stepWithRuntime) and the Zig orchestrator (world.zig step_world).
//
// TS runs ONE per-player loop first each tick: move -> weapon-fire (spawns
// projectiles into the SAME tick's projectile record) -> parry -> shield.
// Projectile motion+impact (section 3) runs AFTER that loop, in the same
// tick, so a projectile fired this tick gets its first position integration
// this same tick.
//
// Zig (before the fix this test drives) runs projectile motion+impact
// (sections 3-4) BEFORE player physics + weapon fire (which live in the
// later "Player physics" / "Combat" sections). A projectile spawned by Zig's
// weapon-fire this tick therefore does NOT get its first motion integration
// until the FOLLOWING step_world call — a full tick (~16.67ms at 60Hz) of
// "invisible dead time" that TS-fired projectiles never have.
//
// This is a real, structural, and previously undocumented candidate root
// cause for the 2026-07-05/06 "green but unplayable" production incident
// (see git commit 2137c31 and server/src/matchHost.ts:62-77): narrow
// per-function parity tests (TS stepWeapon vs Zig weaponTickFire in
// isolation) cannot catch this because the divergence only exists in how
// the ORCHESTRATORS sequence otherwise-correct sub-systems within one tick.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFull,
} from "../worldWasmBackend";
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import { wasmHost } from "../wasmHost";
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

const PID = PlayerId("p0");
const DT_MS = 16.667;
const FireBit = 1 << 6;

// Empty arena, no platforms nearby — isolates this test to pure orchestrator
// sequencing, not terrain-collision behavior (same isolation strategy as
// wasmVsTsParity.test.ts's existing canaries).
const emptyMap: MapDefinition = {
  id: "tick-order-test-arena",
  name: "Tick Order Test Arena",
  size: { x: 4000, y: 4000 },
  spawns: [{ x: 400, y: 300 }],
  platforms: [],
};

function makePlayer(): PlayerEntity {
  return {
    id: PID,
    characterId: "balanced",
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    aimX: 500, // aim straight right — fired projectile should move +x only
    aimY: 300,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
}

function makeTsState(): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: { [PID]: makePlayer() } as Record<PlayerId, PlayerEntity>,
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

describe("tick-order parity — TS vs Zig orchestrator sequencing (2026-07-14 investigation)", () => {
  test("a projectile fired this tick: TS integrates its first motion step SAME tick", async () => {
    const runtime = createRuntime(emptyMap);
    const state = makeTsState();
    const inputs: Record<PlayerId, InputFrame | null> = {
      [PID]: {
        seq: InputSeq(1),
        tick: Tick(1),
        keys: FireBit,
        aimX: 500,
        aimY: 300,
        dtMs: DT_MS,
      },
    };

    const result = stepWithRuntime(state, runtime, inputs, DT_MS);
    const projIds = Object.keys(result.state.projectiles);
    expect(projIds.length).toBe(1);
    const proj = result.state.projectiles[projIds[0] as unknown as keyof typeof result.state.projectiles]!;

    // If TS gives the freshly-spawned projectile a real motion step this
    // tick, it must have moved off the exact muzzle position (400, 300) —
    // vx > 0 (aimed right) times dtMs of travel is on the order of hundreds
    // of px/s * 0.0167s, i.e. several px, definitely > 0.01px of float noise.
    const traveled = Math.hypot(proj.x - 400, proj.y - 300);
    console.log(
      `[tick-order-audit] TS same-tick fired-projectile travel: ${traveled.toFixed(4)}px, ageMs=${proj.ageMs}, vx=${proj.vx.toFixed(2)}, vy=${proj.vy.toFixed(2)}`,
    );
    expect(proj.ageMs).toBeGreaterThan(0);
    expect(traveled).toBeGreaterThan(0.5);
  });

  test("a projectile fired this tick: Zig step_world orchestrator behavior (documents current state)", async () => {
    __clearFireConfigCacheForTests();
    const state = makeTsState();
    writeFireConfigsForState(state);
    // runWasmStepSync re-packs `state` fresh into wasm memory THEN reads
    // per-tick input bits from this global stash (writePlayerInputsFromGlobal)
    // — writing directly into memory before the call gets clobbered by the
    // pack step. This is the actual production input-injection path.
    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [PID, { keys: FireBit, prevKeys: 0, aimX: 500, aimY: 300 }],
    ]);

    const { state: nextState } = await applyWasmWorldStepFull(state, DT_MS);
    const projIds = Object.keys(nextState.projectiles);
    expect(projIds.length).toBe(1);
    const proj = nextState.projectiles[projIds[0] as unknown as keyof typeof nextState.projectiles]!;
    const traveled = Math.hypot(proj.x - 400, proj.y - 300);

    console.log(
      `[tick-order-audit] Zig same-tick fired-projectile travel: ${traveled.toFixed(4)}px, ageMs=${proj.ageMs}, vx=${proj.vx.toFixed(2)}, vy=${proj.vy.toFixed(2)}`,
    );
    // 2026-07-14: FIXED. Before the world.zig orchestrator reorder (player
    // physics + weapon fire moved to run BEFORE projectile motion/impact,
    // matching World.ts's actual per-tick sequence), this was 0.4028px /
    // ageMs=0 — the projectile never got a real motion step on its spawn
    // tick. Now real motion + a correctly-ticked age, matching TS's shape
    // (though not byte-identical — a separate muzzle-offset investigation
    // is tracked separately, not blocking this regression gate).
    expect(proj.ageMs).toBeGreaterThan(0);
    expect(traveled).toBeGreaterThan(0.5);
  });
});
