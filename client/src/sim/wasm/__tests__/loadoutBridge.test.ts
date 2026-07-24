// Track Z1b (convergence-goal.md) — regression gate for the loadout
// delivery pipeline (findings (b) + (c) of multiSeedDivergence's Z1a
// header).
//
// THE BUGS THIS PINS DOWN (all four were live on the client wasm path):
//   (c) ORDERING — wasmStepStrategy/World.ts wrote fire configs BEFORE
//       calling the step, and the step's own pack (`heap.set` of the full
//       packed image) zero-filled the loadout parallel arrays — so
//       step_world never saw the configs. All-starter-pistol harnesses
//       masked it (valid=0 falls back to the starter pistol).
//   (b) EQUIPMENT — the EquippedActives rack had NO delivery mechanism at
//       all on the full-sync path (zero-filled by every pack, nothing
//       rewrote it), so `stepAbilityDispatch` read ABILITY_KIND_NONE in
//       every slot every tick: no ability castable, ever, under live wasm
//       authority.
//   (index map) — fireConfigShared's CARD_INDEX filtered to
//       cards-with-modifiers, a pre-Phase-2-codegen leftover: every pure-
//       ability card was silently absent from the hand Zig saw.
//   (hand destruction) — mergeUnpacked replaced each stepped player's
//       `cards` with unpackPlayer's count-only placeholders (`["", ...]`),
//       so ONE wasm step destroyed the real card ids and the next tick's
//       build resolution saw an empty hand.
//
// THE FIX: loadout delivery (fire config + card hand + EquippedActives)
// moved INSIDE runWasmStepSync, AFTER the pack (writeLoadoutsIntoMemory →
// resolveFireConfigsViaZig → Zig's new `resolve_player_loadout` superset
// export); CARD_INDEX unfiltered; mergeUnpacked re-seats the host-owned
// card ids (preservePlayerCards) before the identity merge.
//
// Three gates:
//   A. PRESENCE — after a step, the fire config bytes in wasm memory read
//      valid=1 with the card-modified damage: the config was present at
//      step time, post-pack (verified-failing on the old pre-step order).
//   B. HAND — real card ids survive the wasm step on the merged state.
//   C. CAST — after 20 repacks, a slot-1 press CASTS (sunlance window
//      opens), the window + slot cooldown agree with a TS lockstep twin
//      every tick, and the window survives every subsequent repack.

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
  __getCachedSim,
  __getCachedEx,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
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
await applyWasmPlayerFlag();

const DT_MS = 1000 / 60;
const SLOT1_BIT = 1 << 10; // World.ts:3239 `1 << (10 + slot)`; world.zig SLOT_BIT_BASE=10
const MAP: MapDefinition = {
  id: "loadout-arena",
  name: "Loadout Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 400, y: 400 },
    { x: 1200, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

function makePlayer(id: string, x: number, cards: string[]): PlayerEntity {
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
    cards,
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function makeState(cards: string[]): WorldState {
  return {
    tick: Tick(0),
    rngState: 11,
    players: {
      [PlayerId("p0")]: makePlayer("p0", 400, cards),
      [PlayerId("p1")]: makePlayer("p1", 1200, []),
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

function pinModuleState(runtime: ReturnType<typeof createRuntime>): void {
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
}

function stashInputs(
  keysByPid: Record<string, number>,
  prevKeys: Record<string, number>,
): void {
  (globalThis as {
    __jakesjam_wasm_inputs__?: ReadonlyMap<
      string,
      { keys: number; prevKeys: number; aimX: number; aimY: number }
    >;
  }).__jakesjam_wasm_inputs__ = new Map(
    Object.keys(keysByPid).map((id) => [
      id,
      { keys: keysByPid[id]!, prevKeys: prevKeys[id]!, aimX: 800, aimY: 400 },
    ]),
  );
}

describe("loadout bridge (Track Z1b findings b+c)", () => {
  test("A. presence — post-pack fire config is live at step time (valid=1, card damage)", () => {
    const runtime = createRuntime(MAP);
    pinModuleState(runtime);
    // crystal-volley: modifier card, damageMultiplier 1.06 over the
    // starter pistol's base 12 → resolved damage 12.72 (round2).
    let zigState = makeState(["crystal-volley"]);
    const prevKeys: Record<string, number> = { p0: 0, p1: 0 };
    stashInputs({ p0: 0, p1: 0 }, prevKeys);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

    // Read the config bytes the step actually consumed — they persist in
    // linear memory until the NEXT pack, so post-step inspection shows
    // exactly what step_world saw. On the old pre-step call order this
    // region read all-zero (valid=0) here. NOTE: must probe the BACKEND's
    // cached wasm instance — the module-level `sim` from loadSimFromBytes
    // is a separate instance with its own linear memory (only its
    // instance-independent offset exports are safe to share).
    const backendSim = __getCachedSim()!;
    const ex = __getCachedEx()! as unknown as {
      offset_player_fire_config: () => number;
      memory: WebAssembly.Memory;
    };
    const base = backendSim.statePtr + ex.offset_player_fire_config();
    const view = new DataView(ex.memory.buffer);
    // p0 sorts first → slot 0. damage f64 at +0, valid u8 at +132.
    expect(view.getUint8(base + 132)).toBe(1);
    expect(view.getFloat64(base + 0, true)).toBeCloseTo(12.72, 10);
  });

  test("B. hand — real card ids survive the wasm step on the merged state", () => {
    const runtime = createRuntime(MAP);
    pinModuleState(runtime);
    let zigState = makeState(["crystal-volley", "sunlance"]);
    const prevKeys: Record<string, number> = { p0: 0, p1: 0 };
    for (let t = 0; t < 5; t++) {
      stashInputs({ p0: 0, p1: 0 }, prevKeys);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
    }
    // Pre-fix: one step turned this into ["", ""] (count-only unpack
    // placeholders replacing the host-owned ids).
    expect(zigState.players[PlayerId("p0")]!.cards).toEqual([
      "crystal-volley",
      "sunlance",
    ]);
  });

  test("C. cast — after 20 repacks a slot-1 press casts sunlance; window + cooldown lockstep with TS and survive every subsequent repack", () => {
    const runtime = createRuntime(MAP);
    pinModuleState(runtime);
    let tsState = makeState(["sunlance"]);
    let zigState: WorldState = structuredClone(tsState);
    const prevKeys: Record<string, number> = { p0: 0, p1: 0 };

    const CAST_TICK = 20;
    let zigWindowAtCast: number | undefined;

    for (let t = 0; t < 60; t++) {
      const p0Keys = t === CAST_TICK ? SLOT1_BIT : 0;

      const tsInputs: Record<PlayerId, InputFrame | null> = {};
      for (const id of ["p0", "p1"]) {
        tsInputs[PlayerId(id)] = {
          seq: InputSeq(t + 1),
          tick: Tick(t + 1),
          keys: id === "p0" ? p0Keys : 0,
          aimX: 800,
          aimY: 400,
          dtMs: DT_MS,
        };
      }
      tsState = stepWithRuntime(tsState, runtime, tsInputs, DT_MS).state;

      stashInputs({ p0: p0Keys, p1: 0 }, prevKeys);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
      prevKeys.p0 = p0Keys;

      const a = tsState.players[PlayerId("p0")]!;
      const b = zigState.players[PlayerId("p0")]!;
      // Window + slot cooldown agree with the TS twin at every tick —
      // same cast tick, same expiry tick, surviving every repack.
      expect({ t, sunlance: b.sunlanceUntilTick }).toEqual({
        t,
        sunlance: a.sunlanceUntilTick,
      });
      expect({ t, cd: b.slot1CooldownUntilTick }).toEqual({
        t,
        cd: a.slot1CooldownUntilTick,
      });
      if (t === CAST_TICK) {
        zigWindowAtCast = b.sunlanceUntilTick as number | undefined;
        // The cast actually happened on the wasm side (pre-fix: the rack
        // read empty, the press was silently inert).
        expect(zigWindowAtCast).toBeDefined();
        expect(zigWindowAtCast!).toBeGreaterThan(t);
      }
      // The window value never drifts while live (a repack that wiped and
      // re-derived it wrongly would show here).
      if (
        zigWindowAtCast !== undefined &&
        t > CAST_TICK &&
        (b.sunlanceUntilTick as number | undefined) !== undefined
      ) {
        expect(b.sunlanceUntilTick).toBe(zigWindowAtCast as never);
      }
    }
  });
});
