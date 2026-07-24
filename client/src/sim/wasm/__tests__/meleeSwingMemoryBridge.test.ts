// Track Z1a (convergence-goal.md) — regression gate for the bridged
// melee_swing parallel array, the EXACT sibling of Z0e's
// movementMemoryBridge.test.ts.
//
// THE BUG THIS PINS DOWN (recorded as Z0e's sibling finding, header of
// multiSeedDivergence.test.ts + the goal doc): packWorldState never wrote
// the melee_swing region, and BOTH full-sync hosts (client
// runWasmStepSync, server serverWasmHost.step) overwrite the ENTIRE
// wasm-side WorldState buffer with the packed image before every
// step_world call. Result: Zig's swing FSM (world.zig stepMeleeSwing —
// idle → windup → active → recovery, shared by Ninja Slash and Paladin
// Kindled Edge) was reset to IDLE before every single step. A Fire press
// still entered windup that tick, but the very next pack wiped it — the
// windup could never mature into an active window, so ninja/paladin
// melee could never land a hit under live wasm authority. Same bug class
// Z0e fixed for movement (grounded/coyote/dash amnesia), felt as "melee
// does nothing" instead of "movement feels wrong".
//
// THE FIX (Z1a): the bridge packs AND unpacks the region
// (worldStateBridge.ts packMeleeSwingMemory/unpackMeleeSwingMemory), the
// hosts carry it on the state object (`WorldState.meleeSwingMemory`,
// keyed by player id), so the FSM survives every repack of the same
// continuing world — the identical WorldState.movementMemory pattern.
//
// Three gates (same shape as movementMemoryBridge.test.ts):
//   A. LAYOUT — the bridge's computed MELEE_SWING_OFFSET equals wasm's
//      own @offsetOf-derived offset_melee_swing(), and the 32-byte
//      stride matches @sizeOf.
//   B. CODEC — pack→unpack round-trips every field; a state WITHOUT
//      meleeSwingMemory packs the fresh idle FSM (aimX=1 — the Zig
//      field default, NOT raw zeros).
//   C. BEHAVIOR — a full-sync-stepped Zig world repacked EVERY tick must
//      keep the swing FSM: a ninja's Fire press winds up, survives an
//      explicit mid-windup re-pack, matures into the active window, and
//      the arc hit resolves on the SAME tick as the TS orchestrator's
//      (same victim, same damage). A second swing after the recovery
//      endlag resolves same-tick too (the full FSM cycle round-trips).
//      Before Z1a, the Zig-side victim never took damage at all — this
//      test fails loudly on the old pack path.

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
  MELEE_SWING_OFFSET,
  MELEE_SWING_MEMORY_SIZE,
} from "../worldStateBridge";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type MeleeSwingMemory,
  type PlayerEntity,
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
  id: "melee-swing-memory-arena",
  name: "Melee Swing Memory Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 400, y: 400 },
    { x: 1200, y: 400 },
  ],
  platforms: [
    // Center-origin (platformToAABB convention): full-width floor, top at
    // y=700 — same floor the movement-memory gate uses.
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

const FireBit = 1 << 6;

const NINJA = PlayerId("n0");
const VICTIM = PlayerId("v1");
// Victim stands 60px right of the attacker — inside SLASH_RANGE (78)
// with margin, dead-center of the ±50° arc when the swing aims
// horizontally right.
const NINJA_X = 400;
const VICTIM_X = 460;
// Far-right aim at standing height: the normalized swing direction is
// horizontal to within ~0.3° regardless of the players' exact grounded
// center y, so the arc check is nowhere near a cone-boundary case.
const AIM_X = 2000;
const AIM_Y = 672;

function makePlayer(id: string, x: number, characterId: string): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: characterId as PlayerEntity["characterId"],
    x,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: AIM_X,
    aimY: AIM_Y,
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
    players: {
      [NINJA]: makePlayer("n0", NINJA_X, "sprinter"),
      [VICTIM]: makePlayer("v1", VICTIM_X, "balanced"),
    } as Record<PlayerId, PlayerEntity>,
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

describe("melee-swing-memory bridge (Track Z1a)", () => {
  test("A. layout — TS offset/stride match wasm's @offsetOf/@sizeOf", () => {
    const ex = sim.exports as unknown as {
      offset_melee_swing?: () => number;
      sizeof_melee_swing_memory?: () => number;
    };
    expect(typeof ex.offset_melee_swing).toBe("function");
    expect(ex.offset_melee_swing!()).toBe(MELEE_SWING_OFFSET);
    expect(typeof ex.sizeof_melee_swing_memory).toBe("function");
    expect(ex.sizeof_melee_swing_memory!()).toBe(MELEE_SWING_MEMORY_SIZE);
  });

  test("B. codec — round-trip preserves every field; absent memory packs the fresh idle FSM", () => {
    const state = makeState();
    const midSwing: MeleeSwingMemory = {
      phaseMs: 31.25,
      aimX: 0.6,
      aimY: -0.8,
      bufferedMs: 66.5,
      bufferedAimX: 812.25,
      bufferedAimY: -140.5,
      hitThisSwingMask: 0b1010,
      phase: 2,
      chainIndex: 2,
      dashThroughTaggedMask: 0b0100,
      wasDashing: true,
      razorRouteActiveDash: true,
      chainGapMs: 123.75,
    };
    state.meleeSwingMemory = { [NINJA]: midSwing };
    const unpacked = unpackWorldState(packWorldState(state));
    // n0: every field survives the byte round-trip.
    expect(unpacked.meleeSwingMemory[NINJA]).toEqual(midSwing);
    // v1 had NO entry → packed as world_state.zig's own field defaults
    // (NOT raw zeros): aimX is 1, the idle FSM's unit aim vector.
    expect(unpacked.meleeSwingMemory[VICTIM]).toEqual({
      phaseMs: 0,
      aimX: 1,
      aimY: 0,
      bufferedMs: 0,
      bufferedAimX: 0,
      bufferedAimY: 0,
      hitThisSwingMask: 0,
      phase: 0,
      chainIndex: 0,
      dashThroughTaggedMask: 0,
      wasDashing: false,
      razorRouteActiveDash: false,
      chainGapMs: 0,
    });
  });

  test("C. behavior — the swing FSM survives the every-tick repack; melee resolves on the same tick both sides", () => {
    const playerIds = [String(NINJA), String(VICTIM)];

    // TS side.
    const runtime = createRuntime(MAP);
    let tsState = makeState();

    // Zig side — identical initial state; pin ALL module-level wasm state
    // (same discipline as movementMemoryBridge.test.ts).
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

    // Script (attacker only — the victim never presses anything):
    //   ticks   0..59 : idle (fall from spawn, land, settle)
    //   tick   60     : press Fire  → swing 1 (windup 60ms → active 45ms
    //                   with 22ms contact gate → recovery 110ms)
    //   ticks  61..99 : idle (swing 1 completes its whole cycle, ~215ms)
    //   tick  100     : press Fire  → swing 2 (FSM back at idle — proves
    //                   recovery → idle round-trips through the repack too)
    //   ticks 101..149: idle
    const ninjaKeysForTick = (t: number): number =>
      t === 60 || t === 100 ? FireBit : 0;

    const prevKeys: Record<string, number> = {};
    for (const id of playerIds) prevKeys[id] = 0;

    let tsFirstDamageTick: number | null = null;
    let zigFirstDamageTick: number | null = null;
    let tsSecondDamageTick: number | null = null;
    let zigSecondDamageTick: number | null = null;
    let tsPrevVictimHealth = 100;
    let zigPrevVictimHealth = 100;

    for (let t = 0; t < 150; t++) {
      const tsInputs: Record<PlayerId, InputFrame | null> = {};
      for (const id of playerIds) {
        tsInputs[PlayerId(id)] = {
          seq: InputSeq(t + 1),
          tick: Tick(t + 1),
          keys: id === String(NINJA) ? ninjaKeysForTick(t) : 0,
          aimX: AIM_X,
          aimY: AIM_Y,
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
        playerIds.map((id) => {
          const keys = id === String(NINJA) ? ninjaKeysForTick(t) : 0;
          return [id, { keys, prevKeys: prevKeys[id]!, aimX: AIM_X, aimY: AIM_Y }];
        }),
      );
      __clearFireConfigCacheForTests();
      writeFireConfigsForState(zigState);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
      for (const id of playerIds)
        prevKeys[id] = id === String(NINJA) ? ninjaKeysForTick(t) : 0;

      // Damage-tick bookkeeping (health drops are the swing's wire-visible
      // consequence — the FSM itself is off-wire).
      const tsVictimHealth = tsState.players[VICTIM]!.health;
      const zigVictimHealth = zigState.players[VICTIM]!.health;
      if (tsVictimHealth < tsPrevVictimHealth) {
        if (tsFirstDamageTick === null) tsFirstDamageTick = t;
        else if (tsSecondDamageTick === null) tsSecondDamageTick = t;
      }
      if (zigVictimHealth < zigPrevVictimHealth) {
        if (zigFirstDamageTick === null) zigFirstDamageTick = t;
        else if (zigSecondDamageTick === null) zigSecondDamageTick = t;
      }
      tsPrevVictimHealth = tsVictimHealth;
      zigPrevVictimHealth = zigVictimHealth;

      // Lockstep health equality every tick — same swing constants, same
      // contact-delay gate, so the two orchestrators must agree not just
      // "eventually" but on the exact damage tick.
      expect(zigVictimHealth).toBe(tsVictimHealth);

      // The attacker never gets touched — position lockstep must hold at
      // kernel precision (both sides run the same wasm stepPlayer, and
      // Z0e's movement bridge keeps its memory across the repack).
      const a = tsState.players[NINJA]!;
      const b = zigState.players[NINJA]!;
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
      expect(Math.abs(a.y - b.y)).toBeLessThan(1e-6);

      // Mid-WINDUP explicit re-pack (on top of the implicit one every
      // applyWasmWorldStepFullSync already does): tick 60 pressed Fire, so
      // tick 61 is inside the 60ms windup. THE Z1a claim: a bridge
      // round-trip of the continuing world must be identity for the swing
      // FSM — pre-Z1a this came back phase=0/phaseMs=0 (idle) and the
      // swing evaporated.
      if (t === 61) {
        const mem = zigState.meleeSwingMemory?.[NINJA];
        expect(mem).toBeDefined();
        expect(mem!.phase).toBe(1); // windup, mid-flight
        expect(mem!.phaseMs).toBeGreaterThan(0);
        const roundTripped = unpackWorldState(packWorldState(zigState));
        expect(roundTripped.meleeSwingMemory).toEqual(
          zigState.meleeSwingMemory!,
        );
      }
    }

    // Swing 1 landed, same tick both sides.
    expect(tsFirstDamageTick).not.toBeNull();
    expect(zigFirstDamageTick).toBe(tsFirstDamageTick);
    // Swing 2 landed too (recovery → idle → re-trigger round-tripped
    // through the repack), same tick both sides.
    expect(tsSecondDamageTick).not.toBeNull();
    expect(zigSecondDamageTick).toBe(tsSecondDamageTick);
    // Two SLASH_DAMAGE (11) hits, no more no less — the per-swing victim
    // debounce (hitThisSwingMask) survived the repack as well; a wiped
    // mask would re-hit every contact-gated tick of the active window.
    expect(zigState.players[VICTIM]!.health).toBe(78);
    // And the carried memory itself reads sane post-run: swing 2 finished
    // its whole cycle → idle, with the horizontal capture aim intact.
    const finalMem = zigState.meleeSwingMemory?.[NINJA];
    expect(finalMem).toBeDefined();
    expect(finalMem!.phase).toBe(0);
    expect(finalMem!.aimX).toBeGreaterThan(0.99);
  });

  test("D. bash-chain parity — Kindled's swing·swing·BASH cadence resolves lockstep on both sides", () => {
    // SHIELD BASH (2026-07-24, slash-feel-ledger design-decision block):
    // every third Edge swing is the slab bash — low damage (14), biggest
    // knockback, brief stagger — with chain state in the bridged
    // MeleeSwingMemory (chain_index/chain_gap_ms). This gate proves the
    // TS orchestrator and the every-tick-repacked Zig world agree on the
    // WHOLE cadence: per-tick damage sequences must be identical, and the
    // damage pattern itself must read 32·32·14 repeating.
    //
    // Harness note: the victim is PINNED back to its spot (and healed to
    // full) after every step — applied identically to both states — so
    // the game's biggest knockback can't carry it out of arc range and
    // decouple the two runs from the cadence being proven.
    const PAL = PlayerId("p0");
    const TARGET = PlayerId("v2");
    const TARGET_X = 460;
    const TARGET_Y = 672; // grounded standing height on the 700-top floor
    const playerIds = [String(PAL), String(TARGET)];

    const mkBashState = (): WorldState => ({
      tick: Tick(0),
      rngState: 1,
      players: {
        [PAL]: makePlayer("p0", NINJA_X, "heavy"),
        [TARGET]: makePlayer("v2", TARGET_X, "balanced"),
      } as Record<PlayerId, PlayerEntity>,
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
    });

    const runtime = createRuntime(MAP);
    let tsState = mkBashState();

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
    let zigState: WorldState = mkBashState();

    // Mash script: settle 0..59, then a Fire press every 8 ticks — each
    // press either lands in the 100ms buffer window or re-triggers from a
    // sub-350ms idle gap, so the chain never cools mid-run.
    const palKeysForTick = (t: number): number =>
      t >= 60 && (t - 60) % 8 === 0 ? FireBit : 0;

    const prevKeys: Record<string, number> = {};
    for (const id of playerIds) prevKeys[id] = 0;

    const pinVictim = (state: WorldState): WorldState => ({
      ...state,
      players: {
        ...state.players,
        [TARGET]: {
          ...state.players[TARGET]!,
          x: TARGET_X,
          y: TARGET_Y,
          vx: 0,
          vy: 0,
          health: 100,
          alive: true,
        },
      },
    });

    const tsDamages: number[] = [];
    const zigDamages: number[] = [];
    for (let t = 0; t < 420; t++) {
      const tsInputs: Record<PlayerId, InputFrame | null> = {};
      for (const id of playerIds) {
        tsInputs[PlayerId(id)] = {
          seq: InputSeq(t + 1),
          tick: Tick(t + 1),
          keys: id === String(PAL) ? palKeysForTick(t) : 0,
          aimX: AIM_X,
          aimY: AIM_Y,
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
        playerIds.map((id) => {
          const keys = id === String(PAL) ? palKeysForTick(t) : 0;
          return [id, { keys, prevKeys: prevKeys[id]!, aimX: AIM_X, aimY: AIM_Y }];
        }),
      );
      __clearFireConfigCacheForTests();
      writeFireConfigsForState(zigState);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
      for (const id of playerIds)
        prevKeys[id] = id === String(PAL) ? palKeysForTick(t) : 0;

      tsDamages.push(100 - tsState.players[TARGET]!.health);
      zigDamages.push(100 - zigState.players[TARGET]!.health);

      tsState = pinVictim(tsState);
      zigState = pinVictim(zigState);
    }

    // Lockstep: the two orchestrators agree on WHICH tick every hit
    // lands and HOW HARD, across the whole mash.
    expect(zigDamages).toEqual(tsDamages);

    // The cadence itself: blades hit for 32, the chain's every third
    // swing bashes for 14 — at least two full cycles landed in-run.
    const landed = tsDamages.filter((d) => d > 0);
    expect(landed.length).toBeGreaterThanOrEqual(6);
    expect(landed.slice(0, 6)).toEqual([32, 32, 14, 32, 32, 14]);

    // And the bridged chain state agrees with the TS orchestrator's own
    // off-wire memory at the end of the run.
    const tsChain = runtime.paladinMelee.get(PAL)!;
    const zigMem = zigState.meleeSwingMemory?.[PAL];
    expect(zigMem).toBeDefined();
    expect(zigMem!.chainIndex).toBe(tsChain.chainIndex);
  });
});
