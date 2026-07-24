// Track Z1b (convergence-goal.md) — regression gate for the bridged
// [384, 620) PlayerEntity ability-window tail.
//
// THE BUG THIS PINS DOWN (recorded as finding (a) in multiSeedDivergence's
// Z1a header): packPlayer skipped the whole Zig-only tail span with
// `off += 236`, leaving it zero-filled in every packed buffer — and BOTH
// full-sync hosts (client runWasmStepSync, server serverWasmHost.step)
// overwrite the ENTIRE wasm-side WorldState buffer with that packed image
// before every step_world call. Result: EVERY Phase-4 ability window
// (sunlance/overclock/measure, facet/focus/judgment/read marks, kindled
// resolve, ghost guard, razor route, seal, second wind, edge storm, wall
// bloom, shock ring, ward shell, per-slot cooldowns, the wizard fire
// channel) was ONE-TICK-ONLY under live wasm authority — cast this tick,
// wiped by the next tick's repack. Same wipe-on-repack bug class as Z0e
// (movement memory) and Z1a item 1 (melee swing).
//
// THE FIX (Z1b): field-level pack/unpack from the TS PlayerEntity mirrors
// (every field in the span has an identically-named optional TS field),
// chosen over an opaque off-wire carrier because it keeps ONE source of
// truth and works for windows opened on EITHER side — the
// respawn_at_tick/recoil_step/ally-tail precedent, now covering the whole
// span. Offsets pinned by comptime @offsetOf asserts in world_state.zig.
//
// Three gates:
//   A. CODEC — pack→unpack round-trips every tail field (ticks, charge
//      counters, mark target ids); an unset field stays absent.
//   B. SURVIVAL — a window set mid-fight survives an explicit re-pack AND
//      a full wasm step (verified-failing on the old skip path: the
//      windows vanished after one applyWasmWorldStepFullSync).
//   C. LOCKSTEP — TS and Zig stepped side by side agree on the window
//      fields at every tick (same expiry tick, same clears).

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
import { createRuntime, stepWithRuntime } from "../../World";
import { packWorldState, unpackWorldState } from "../worldStateBridge";
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
await applyWasmPlayerFlag();

const DT_MS = 1000 / 60;
const MAP: MapDefinition = {
  id: "ability-window-arena",
  name: "Ability Window Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 400, y: 400 },
    { x: 1200, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

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
    rngState: 7,
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

/** Every bridged tail field, with distinct values so a transposed offset
 *  can't accidentally pass. channelHoldMs deliberately included HERE (the
 *  pure codec gate) but not in the stepped gates below — step_world
 *  actively recomputes the wizard fire channel every tick, so only the
 *  codec owns its round-trip guarantee. */
const TAIL_FIELDS: Partial<PlayerEntity> = {
  channelHoldMs: 123.5,
  slot1CooldownUntilTick: Tick(301),
  slot2CooldownUntilTick: Tick(302),
  slot3CooldownUntilTick: Tick(303),
  undercutUntilTick: Tick(311),
  edgeStormUntilTick: Tick(312),
  edgeStormChargesRemaining: 2,
  sealUntilTick: Tick(313),
  secondWindUntilTick: Tick(314),
  judgmentMarkUntilTick: Tick(315),
  judgmentTargetId: PlayerId("p1"),
  readMarkUntilTick: Tick(316),
  readTargetId: PlayerId("p1"),
  wallBloomUntilTick: Tick(317),
  shockRingArmedUntilTick: Tick(318),
  wardShellUntilTick: Tick(319),
  sunlanceUntilTick: Tick(320),
  overclockUntilTick: Tick(321),
  measureUntilTick: Tick(322),
  facetMarkUntilTick: Tick(323),
  facetTargetId: PlayerId("p1"),
  focusHexMarkUntilTick: Tick(324),
  focusHexTargetId: PlayerId("p1"),
  kindledResolveUntilTick: Tick(325),
  ghostGuardChargeUntilTick: Tick(326),
  razorRouteUntilTick: Tick(327),
};

const TAIL_KEYS = Object.keys(TAIL_FIELDS) as (keyof PlayerEntity)[];

describe("ability-window tail bridge (Track Z1b)", () => {
  test("A. codec — pack→unpack round-trips every tail field; unset stays absent", () => {
    const state = makeState(["p0", "p1"]);
    state.players[PlayerId("p0")] = {
      ...state.players[PlayerId("p0")]!,
      ...TAIL_FIELDS,
    };
    const unpacked = unpackWorldState(packWorldState(state));
    const p0 = unpacked.players[PlayerId("p0")]!;
    for (const k of TAIL_KEYS) {
      expect({ key: k, value: p0[k] }).toEqual({
        key: k,
        value: TAIL_FIELDS[k],
      });
    }
    // p1 set nothing — every tail field decodes back to absent, not 0.
    const p1 = unpacked.players[PlayerId("p1")]!;
    for (const k of TAIL_KEYS) {
      expect({ key: k, value: p1[k] }).toEqual({ key: k, value: undefined });
    }
  });

  test("B+C. survival + lockstep — windows set mid-fight survive re-pack and step; TS and Zig agree every tick", () => {
    const playerIds = ["p0", "p1"];
    const runtime = createRuntime(MAP);
    let tsState = makeState(playerIds);

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

    // The stepped subset: windows step_world READS but never recomputes
    // for an idle, non-casting player. channelHoldMs excluded (see
    // TAIL_FIELDS doc comment); shockRingArmedUntilTick excluded too —
    // its consumption hook is the landing edge, and the players DO land
    // early in this run (spawn y=400, floor at 700), which would clear it
    // on both sides at once; keeping it out makes the survival assertion
    // strictly about "nothing but the codec touches these".
    const STEPPED: Partial<PlayerEntity> = { ...TAIL_FIELDS };
    delete (STEPPED as Record<string, unknown>).channelHoldMs;
    delete (STEPPED as Record<string, unknown>).shockRingArmedUntilTick;
    delete (STEPPED as Record<string, unknown>).wallBloomUntilTick;
    const STEPPED_KEYS = Object.keys(STEPPED) as (keyof PlayerEntity)[];

    const inject = (s: WorldState): WorldState => ({
      ...s,
      players: {
        ...s.players,
        [PlayerId("p0")]: { ...s.players[PlayerId("p0")]!, ...STEPPED },
      },
    });

    const prevKeys: Record<string, number> = {};
    for (const id of playerIds) prevKeys[id] = 0;

    for (let t = 0; t < 90; t++) {
      // Mid-fight injection at tick 10 — the window opens on BOTH sides
      // the same way a TS-authoritative cast would.
      if (t === 10) {
        tsState = inject(tsState);
        zigState = inject(zigState);
        // Explicit re-pack of the just-injected state: the old skip path
        // zeroed all of these right here.
        const rt = unpackWorldState(packWorldState(zigState));
        const p0 = rt.players[PlayerId("p0")]!;
        for (const k of STEPPED_KEYS) {
          expect({ key: k, value: p0[k] }).toEqual({
            key: k,
            value: STEPPED[k],
          });
        }
      }

      const tsInputs: Record<PlayerId, InputFrame | null> = {};
      for (const id of playerIds) {
        tsInputs[PlayerId(id)] = {
          seq: InputSeq(t + 1),
          tick: Tick(t + 1),
          keys: 0,
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
          { keys: 0, prevKeys: prevKeys[id]!, aimX: 800, aimY: 400 },
        ]),
      );
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

      // Lockstep window agreement every tick — same value or same
      // absence on both sides (both sides agree on the expiry tick
      // because the VALUE is the expiry tick).
      if (t >= 10) {
        const a = tsState.players[PlayerId("p0")]!;
        const b = zigState.players[PlayerId("p0")]!;
        for (const k of STEPPED_KEYS) {
          expect({ tick: t, key: k, value: b[k] }).toEqual({
            tick: t,
            key: k,
            value: a[k],
          });
        }
      }
    }

    // After 90 ticks (80 post-injection packs), the windows are still
    // exactly the injected values on the wasm side — the repack no longer
    // wipes them. (Every value above was chosen > the final tick so none
    // legitimately expired-and-cleared during the run.)
    const zp0 = zigState.players[PlayerId("p0")]!;
    for (const k of STEPPED_KEYS) {
      expect({ key: k, value: zp0[k] }).toEqual({
        key: k,
        value: STEPPED[k],
      });
    }
  });
});
