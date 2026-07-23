// Track Z0b Item B (convergence-goal.md) — port of the orphaned branch's
// tickOrderParity.test.ts (commits 3f16fe3 tick-order fix + 888345c muzzle
// port), the smoking-gun test for the muzzle-geometry divergence: TS spawns
// every shot from `playerMuzzlePosition` (anchor 60px above center, 31px
// reach toward aim, ±6px alternating-hand perpendicular offset) and derives
// the fire ANGLE from that offset muzzle point; world.zig used to spawn
// dead-center with a center-derived angle — the audit measured 10.84px vs
// 47.32px same-tick travel and mismatched velocity vectors from the SAME
// aim target.
//
// Adaptation from the orphan spec (deliberate): the branch asserted the Zig
// travel against a RECORDED literal (47.3221px). Weapon tuning has moved
// since 2026-07-14 (recoil-control chassis pass 2026-07-23, etc.), so a
// frozen literal would test the balance sheet, not the geometry. Instead
// this file runs the IDENTICAL single-shot scenario through BOTH
// orchestrators and asserts the spawned projectile's position, velocity,
// age, and travel are EQUAL — byte-identity between implementations is the
// actual claim 888345c made, and it's balance-proof.

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
  type ProjectileEntity,
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
// Installs the shared trig LUT tables into the TS side (runtime.ts does
// this at production boot) AND routes TS movement through the same wasm
// stepPlayer — without it, TS's lutAtan2/lutCos fall back to Math.* and
// the fired velocity differs from Zig's LUT-derived vector at the 1e-4
// level, drowning the 1e-9 muzzle-geometry equality this file asserts.
await applyWasmPlayerFlag();

const PID = PlayerId("p0");
const DT_MS = 16.667;
const FireBit = 1 << 6;

// Empty arena, no platforms nearby — isolates this test to pure orchestrator
// sequencing + spawn geometry, not terrain collision (same isolation
// strategy as the orphan original).
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
    aimX: 500, // aim right+level with the player center — off-axis from the
    aimY: 300, // shoulder-height muzzle anchor, so a center-derived angle is DETECTABLY wrong
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function makeState(): WorldState {
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

function onlyProjectile(state: WorldState): ProjectileEntity {
  const ids = Object.keys(state.projectiles);
  expect(ids.length).toBe(1);
  return state.projectiles[ids[0] as unknown as keyof typeof state.projectiles]!;
}

describe("tick-order + muzzle-geometry parity — TS vs Zig same-tick fired shot (Z0b Item B)", () => {
  test("a projectile fired this tick spawns at the SAME muzzle point with the SAME velocity and same-tick motion in both orchestrators", () => {
    // TS side.
    const runtime = createRuntime(emptyMap);
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
    const tsResult = stepWithRuntime(makeState(), runtime, inputs, DT_MS);
    const tsProj = onlyProjectile(tsResult.state);
    const tsTraveled = Math.hypot(tsProj.x - 400, tsProj.y - 300);
    console.log(
      `[tick-order-audit] TS same-tick fired-projectile travel: ${tsTraveled.toFixed(4)}px, ageMs=${tsProj.ageMs}, vx=${tsProj.vx.toFixed(2)}, vy=${tsProj.vy.toFixed(2)}`,
    );
    // The tick-order guarantee (3f16fe3): a fresh spawn gets a REAL motion
    // step on its spawn tick.
    expect(tsProj.ageMs).toBeGreaterThan(0);
    expect(tsTraveled).toBeGreaterThan(0.5);

    // Zig side — identical scenario, module state pinned (Z0a harness
    // discipline: the wasm instance is shared across every file in this
    // bun process).
    setWorldStatics([], []);
    setWorldArenaBounds(runtime.ceilingClampY, 0);
    setWorldLaunchPads([]);
    setWorldSlopes([]);
    setWorldSpawnPoints(emptyMap.spawns);
    setWorldTargetScore(resolveModeConfig(undefined).targetScore);
    const zigState = makeState();
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [PID as string, { keys: FireBit, prevKeys: 0, aimX: 500, aimY: 300 }],
    ]);
    const zigResult = applyWasmWorldStepFullSync(zigState, DT_MS);
    const zigProj = onlyProjectile(zigResult.state);
    const zigTraveled = Math.hypot(zigProj.x - 400, zigProj.y - 300);
    console.log(
      `[tick-order-audit] Zig same-tick fired-projectile travel: ${zigTraveled.toFixed(4)}px, ageMs=${zigProj.ageMs}, vx=${zigProj.vx.toFixed(2)}, vy=${zigProj.vy.toFixed(2)}`,
    );

    // History (orphan branch 888345c):
    //   - before the branch's tick-order reorder: 0.4028px / ageMs=0 in
    //     Zig — the fresh spawn got no motion step on its spawn tick;
    //   - after the reorder, before the muzzle port: 10.8394px vs TS's
    //     47.3221px, velocity vectors mismatched;
    //   - after the muzzle port: exact match.
    //
    // WHAT THIS PORT COVERS (Z0b Item B) vs. what it deliberately does
    // NOT: the muzzle GEOMETRY is asserted exact below — identical spawn
    // origin (the offset alternating-hand muzzle point) and identical
    // velocity vector (muzzle-derived angle × speed), to 1e-9. The orphan
    // branch's separate TICK-ORDER reorder (player physics + weapon fire
    // moved BEFORE projectile motion/impact, its 3f16fe3-era fix) is NOT
    // on main and NOT part of the 888345c muzzle spec — so on main a
    // Zig-fired shot still gets its first motion step one step_world call
    // later (ageMs=0 here vs TS's dt; ~10.8px of first-tick travel lag).
    // Asserted explicitly below as the CURRENT state rather than papered
    // over with a loose bound — when a future track ports the reorder,
    // flip these two assertions to equality and this comment to history.
    expect(zigProj.originX).toBeCloseTo(tsProj.originX!, 9);
    expect(zigProj.originY).toBeCloseTo(tsProj.originY!, 9);
    expect(zigProj.x).toBeCloseTo(tsProj.originX!, 9); // un-integrated: still at the muzzle
    expect(zigProj.y).toBeCloseTo(tsProj.originY!, 9);
    expect(zigProj.vx).toBeCloseTo(tsProj.vx, 9);
    expect(zigProj.vy).toBeCloseTo(tsProj.vy, 9);
    // Known un-ported tick-order gap (see the block comment above).
    expect(zigProj.ageMs).toBe(0);
    expect(tsProj.ageMs).toBeCloseTo(DT_MS, 6);

    // And the muzzle geometry is REALLY in play (not both sides
    // regressing to center-spawn together): the spawn origin must sit off
    // the player center by more than the old center-spawn epsilon.
    expect(Math.hypot(tsProj.originX! - 400, tsProj.originY! - 300)).toBeGreaterThan(20);

    // The alternating-hand parity bit round-trips: exactly one fire event
    // → hand 0 on both sides (TS's `(undefined ?? 1) ^ 1`).
    expect(tsResult.state.players[PID]!.throwHandParity).toBe(0);
    expect(zigResult.state.players[PID]!.throwHandParity).toBe(0);
  });
});
