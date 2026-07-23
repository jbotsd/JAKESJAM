// Track Z0e (convergence-goal.md) — regression gate for the bridged
// player_movement parallel array.
//
// THE BUG THIS PINS DOWN (recorded by Z0d's probe, header of
// multiSeedDivergence.test.ts): packWorldState never wrote the
// player_movement region, and BOTH full-sync hosts (client
// runWasmStepSync, server serverWasmHost.step) overwrite the ENTIRE
// wasm-side WorldState buffer with the packed image before every
// step_world call. Result: Zig's stepPlayer ran EVERY tick with
// grounded_last_frame=false and blank coyote/jump-buffer/air-jump/dash
// memory —
//   (1) grounded players accelerated with AIR_ACCELERATION instead of
//       GROUND_ACCELERATION (player.zig:312),
//   (2) ground friction NEVER applied (player.zig:314) — an idle
//       post-shot player kept vx≈-92.9 forever while TS decayed it
//       60/tick (the Z0d probe shape),
//   (3) ground jumps were IMPOSSIBLE (every jump branch gates on
//       grounded/coyote/air-jump memory that read permanently blank).
// This was NOT harness-only: matchHost's USE_WASM_STEP_WORLD path and
// the client's ?wasm-world=2 path both pack every tick, so the live
// wasm mode carried all three symptoms whenever it was enabled.
//
// THE FIX (Z0e): the bridge packs AND unpacks the region
// (worldStateBridge.ts), the hosts carry it on the state object
// (`WorldState.movementMemory`, keyed by player id), so the memory
// survives every repack of the same continuing world — the exact
// respawn_at_tick "bridge it or the repack wipes it" pattern.
//
// Three gates:
//   A. LAYOUT — the bridge's computed PLAYER_MOVEMENT_OFFSET equals
//      wasm's own @offsetOf-derived offset_player_movement(), and the
//      48-byte stride matches @sizeOf.
//   B. CODEC — pack→unpack round-trips every field; a state WITHOUT
//      movementMemory packs the freshPlayerMovementMemory() equivalent
//      (jumpReleasedSinceJump=true, everything else zero/false), not
//      raw zeros.
//   C. BEHAVIOR (the Z0d probe, now as a lockstep assertion) — a
//      full-sync-stepped Zig world repacked EVERY tick must keep
//      ground physics: a sliding idle player's vx decays to 0 in
//      lockstep with TS (ground friction survives the repack), and a
//      Jump press while standing leaves the ground on BOTH sides
//      (ground jumps work). Before Z0e, Zig's vx never decayed and the
//      jump never fired — this test fails loudly on the old code.

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
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
import {
  packWorldState,
  unpackWorldState,
  PLAYER_MOVEMENT_OFFSET,
  PLAYER_MOVEMENT_MEMORY_SIZE,
} from "../worldStateBridge";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type PlayerMovementMemory,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
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
await applyWasmPlayerFlag(); // TS movement runs the SAME wasm stepPlayer kernel

const DT_MS = 1000 / 60;
const MAP: MapDefinition = {
  id: "movement-memory-arena",
  name: "Movement Memory Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 400, y: 400 },
    { x: 1200, y: 400 },
  ],
  platforms: [
    // Center-origin (platformToAABB convention): full-width floor, top at
    // y=700 — same floor the divergence sweep uses.
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

const RightBit = 1 << 1;
const JumpBit = 1 << 4;

function makePlayer(id: string, x: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: 400,
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

function makeState(playerIds: string[]): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: Object.fromEntries(
      playerIds.map((id, i) => [PlayerId(id), makePlayer(id, 400 + i * 800)]),
    ) as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("movement-memory bridge (Track Z0e)", () => {
  test("A. layout — TS offset/stride match wasm's @offsetOf/@sizeOf", () => {
    const ex = sim.exports as unknown as {
      offset_player_movement?: () => number;
      sizeof_player_movement_memory: () => number;
    };
    expect(typeof ex.offset_player_movement).toBe("function");
    expect(ex.offset_player_movement!()).toBe(PLAYER_MOVEMENT_OFFSET);
    expect(ex.sizeof_player_movement_memory()).toBe(
      PLAYER_MOVEMENT_MEMORY_SIZE,
    );
  });

  test("B. codec — round-trip preserves every field; absent memory packs fresh defaults", () => {
    const state = makeState(["alpha", "beta"]);
    const alphaMem: PlayerMovementMemory = {
      coyoteMs: 41.5,
      jumpBufferMs: 12.25,
      jumpCutApplied: true,
      jumpReleasedSinceJump: false,
      groundedLastFrame: true,
      jetpackActive: false,
      touchingWallDir: -1,
      airJumpsUsed: 2,
      dashCooldownMs: 987.5,
      dashUsedInAir: 1,
      dashActiveMs: 130.75,
      dashRecoveryMs: 66.5,
    };
    state.movementMemory = { [PlayerId("alpha")]: alphaMem };
    const unpacked = unpackWorldState(packWorldState(state));
    // alpha: every field survives the byte round-trip.
    expect(unpacked.movementMemory[PlayerId("alpha")]).toEqual(alphaMem);
    // beta had NO entry → packed as the freshPlayerMovementMemory()
    // equivalent (NOT raw zeros): jumpReleasedSinceJump is true, the
    // same default the TS runtime lazily seeds for an unseen player.
    expect(unpacked.movementMemory[PlayerId("beta")]).toEqual({
      coyoteMs: 0,
      jumpBufferMs: 0,
      jumpCutApplied: false,
      jumpReleasedSinceJump: true,
      groundedLastFrame: false,
      jetpackActive: false,
      touchingWallDir: 0,
      airJumpsUsed: 0,
      dashCooldownMs: 0,
      dashUsedInAir: 0,
      dashActiveMs: 0,
      dashRecoveryMs: 0,
    });
  });

  test("C. behavior — ground friction + ground jumps survive the every-tick repack (Z0d probe shape)", () => {
    const playerIds = ["p0", "p1"];

    // TS side.
    const runtime = createRuntime(MAP);
    let tsState = makeState(playerIds);

    // Zig side — identical initial state; pin ALL module-level wasm state
    // (same discipline as multiSeedDivergence.test.ts, which shares this
    // module cache within the bun process).
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

    // Script (no Fire anywhere — pure movement, zero combat noise):
    //   ticks   0..29 : hold Right (build up ground speed)
    //   ticks  30..89 : idle       (ground friction decays vx to 0)
    //   tick   90     : press Jump (ground jump)
    //   ticks  91..119: idle       (flight + landing)
    const keysForTick = (t: number): number => {
      if (t < 30) return RightBit;
      if (t === 90) return JumpBit;
      return 0;
    };

    const prevKeys: Record<string, number> = {};
    for (const id of playerIds) prevKeys[id] = 0;

    let zigVxAtIdleStart = 0;
    let zigJumped = false;

    for (let t = 0; t < 120; t++) {
      const keys = keysForTick(t);

      const tsInputs: Record<PlayerId, InputFrame | null> = {};
      for (const id of playerIds) {
        tsInputs[PlayerId(id)] = {
          seq: InputSeq(t + 1),
          tick: Tick(t + 1),
          keys,
          aimX: 800,
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
        playerIds.map((id) => [
          id,
          { keys, prevKeys: prevKeys[id]!, aimX: 800, aimY: 400 },
        ]),
      );
      __clearFireConfigCacheForTests();
      writeFireConfigsForState(zigState);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
      for (const id of playerIds) prevKeys[id] = keys;

      if (t === 30) zigVxAtIdleStart = zigState.players[PlayerId("p0")]!.vx;
      if (t >= 90 && zigState.players[PlayerId("p0")]!.vy < 0) {
        zigJumped = true;
      }

      // Lockstep equality every tick — both sides run the identical wasm
      // stepPlayer kernel, so with movement memory surviving the repack
      // there is no legitimate source of drift in a pure-movement world.
      for (const id of playerIds) {
        const a = tsState.players[PlayerId(id)]!;
        const b = zigState.players[PlayerId(id)]!;
        expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
        expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6);
        expect(Math.abs(a.vx - b.vx)).toBeLessThan(1e-6);
        expect(Math.abs(a.vy - b.vy)).toBeLessThan(1e-6);
      }

      // Mid-flight EXPLICIT re-pack at tick 60 (on top of the implicit
      // one every applyWasmWorldStepFullSync already does): a bridge
      // round-trip of the continuing world must be state-identity for
      // movement — same continuing world, same memory.
      if (t === 60) {
        const roundTripped = unpackWorldState(packWorldState(zigState));
        expect(roundTripped.movementMemory).toEqual(zigState.movementMemory!);
      }
    }

    // The player actually got moving on the Zig side (Right held 30 ticks
    // on the ground → real ground acceleration).
    expect(zigVxAtIdleStart).toBeGreaterThan(50);
    // Ground friction survives the repack: idle vx decays to EXACTLY 0
    // well before the jump (pre-Z0e: vx froze at zigVxAtIdleStart
    // forever because grounded_last_frame read false every tick).
    expect(zigState.players[PlayerId("p0")]!.vx).toBe(0);
    // Ground jump is possible again (pre-Z0e: every jump branch gated on
    // blank grounded/coyote memory → the press was silently swallowed).
    expect(zigJumped).toBe(true);
    // And the memory itself is visible + sane on the carried state:
    // standing players report groundedLastFrame after landing.
    const mem = zigState.players && zigState.movementMemory?.[PlayerId("p1")];
    expect(mem).toBeDefined();
    expect(mem!.groundedLastFrame).toBe(true);
  });
});
