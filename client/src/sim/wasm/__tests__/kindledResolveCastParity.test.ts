// Track Z5 item 1 (finish-line-goal.md) — parity gate for the
// `kindled_resolve` ability CAST, closed this pass: world.zig's
// `.kindled_resolve` switch arm was a genuine no-op (`.kindled_resolve =>
// {}, // consumption shipped, cast genuinely blocked`) — the consumption
// side (damage amp + stagger resist) shipped in Phase 4a follow-up and had
// its own parity coverage (sim/test/smoke.zig, "Kindled Resolve" tests,
// which bypass the cast and set `kindled_resolve_until_tick` directly), but
// pressing the ability itself never opened that window under wasm
// authority. This test presses the REAL ability slot (matching
// loadoutBridge.test.ts's "C. cast" pattern) under `USE_WASM_STEP_WORLD`
// (`applyWasmWorldStepFullSync`) and proves it now spends Kindling and
// opens the window exactly like TS's own "kindled-resolve" case
// (World.ts:3944-3963), lockstepped against the TS orchestrator.

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
  id: "kindled-resolve-cast-arena",
  name: "Kindled Resolve Cast Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 400, y: 400 },
    { x: 1200, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

function makePlayer(id: string, x: number, extra: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "heavy", // Paladin — the only class this card's catalog entry targets.
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
    cards: ["kindled-resolve"],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
    ...extra,
  };
}

function makeState(kindling: number): WorldState {
  return {
    tick: Tick(0),
    rngState: 11,
    players: {
      [PlayerId("p0")]: makePlayer("p0", 400, { kindling }),
      [PlayerId("p1")]: makePlayer("p1", 1200),
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

function stashInputs(keysByPid: Record<string, number>, prevKeys: Record<string, number>): void {
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

describe("kindled_resolve ability cast (Track Z5 item 1)", () => {
  test("a Paladin with >=40 Kindling presses the slot: spends the Kindling and opens the window on BOTH engines, at the SAME tick", () => {
    const runtime = createRuntime(MAP);
    pinModuleState(runtime);
    let tsState = makeState(40);
    let zigState: WorldState = structuredClone(tsState);
    const prevKeys: Record<string, number> = { p0: 0, p1: 0 };

    const CAST_TICK = 5;
    for (let t = 0; t < 30; t++) {
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
      // Window + kindling + slot cooldown agree with the TS twin at EVERY
      // tick — proves the cast isn't a one-tick fluke that then diverges.
      expect({ t, until: b.kindledResolveUntilTick }, "window agrees").toEqual({
        t,
        until: a.kindledResolveUntilTick,
      });
      expect({ t, kindling: b.kindling }, "kindling agrees").toEqual({ t, kindling: a.kindling });
      expect({ t, cd: b.slot1CooldownUntilTick }, "cooldown agrees").toEqual({
        t,
        cd: a.slot1CooldownUntilTick,
      });

      if (t === CAST_TICK) {
        // THE bug this item closes: pre-fix, `kindledResolveUntilTick`
        // stayed undefined forever on the Zig side (the switch arm was a
        // literal no-op) — this is the direct, positive proof it now
        // actually fires.
        expect(b.kindledResolveUntilTick, "Zig: the cast actually opened the window").toBeDefined();
        expect(b.kindledResolveUntilTick!, "Zig: window expires in the future").toBeGreaterThan(t + 1);
        expect(b.kindling, "Zig: Kindling was spent (40 - 40 = 0)").toBe(0);
      }
    }
  });

  test("control: insufficient Kindling (< 40) is a dead press on BOTH engines — no spend, no window, no cooldown burn", () => {
    const runtime = createRuntime(MAP);
    pinModuleState(runtime);
    let tsState = makeState(10);
    let zigState: WorldState = structuredClone(tsState);
    const prevKeys: Record<string, number> = { p0: 0, p1: 0 };

    for (let t = 0; t < 5; t++) {
      const p0Keys = t === 2 ? SLOT1_BIT : 0;
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
    }

    const a = tsState.players[PlayerId("p0")]!;
    const b = zigState.players[PlayerId("p0")]!;
    expect(a.kindledResolveUntilTick, "TS: dead press, no window").toBeUndefined();
    expect(b.kindledResolveUntilTick, "Zig: dead press, no window").toBeUndefined();
    expect(a.kindling, "TS: Kindling untouched").toBe(10);
    expect(b.kindling, "Zig: Kindling untouched").toBe(10);
    expect(a.slot1CooldownUntilTick, "TS: no cooldown burn").toBeUndefined();
    expect(b.slot1CooldownUntilTick, "Zig: no cooldown burn").toBeUndefined();
  });
});
