// Tick-base parity gate for the `rally_light` and `aegis_share` ability
// CASTS (same bug class as kindledResolveCastParity.test.ts, closed the
// same day): world.zig's `.rally_light`/`.aegis_share` arms wrote
// `state.header.tick + 1 + dur_ticks`, copying rally_light's own
// uncritically-carried `+1` before either had a real cross-engine lockstep
// test. `stepAbilityDispatch` runs AFTER `state.header.tick += 1` already
// ran for the step, so `state.header.tick` is ALREADY numerically equal to
// TS's `state.tick + 1` — the stale extra `+1` double-counted and landed
// both windows one tick late vs TS on every cast. Only smoke.zig's native
// hardcoded-number checks existed for these two (which can't catch a
// cross-engine tick-base drift, same gap kindled_resolve had). This test
// presses the REAL ability slot under `USE_WASM_STEP_WORLD`
// (`applyWasmWorldStepFullSync`) for both abilities and proves the window
// agrees with the TS orchestrator at EVERY tick, not just once.

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
  id: "aegis-share-rally-light-cast-arena",
  name: "Aegis Share / Rally Light Cast Arena",
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
    characterId: "heavy", // Paladin — the only class this catalog entry targets.
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
    ...extra,
  };
}

function makeState(cardId: string): WorldState {
  return {
    tick: Tick(0),
    rngState: 11,
    players: {
      [PlayerId("p0")]: makePlayer("p0", 400, { cards: [cardId] }),
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

// Shared drive loop: presses slot1 on p0 at CAST_TICK, steps both engines
// in lockstep for STEPS ticks, and asserts the buff-window field named
// `field` agrees between TS and Zig at every single tick — not just once —
// so a one-tick-late (or early) Zig window can't hide behind a coincidental
// match on the tick the assertion happens to run.
function runCastParity(
  cardId: string,
  field: "rallyLightUntilTick" | "aegisShareUntilTick",
  steps: number,
): { ts: PlayerEntity; zig: PlayerEntity } {
  const runtime = createRuntime(MAP);
  pinModuleState(runtime);
  let tsState = makeState(cardId);
  let zigState: WorldState = structuredClone(tsState);
  const prevKeys: Record<string, number> = { p0: 0, p1: 0 };

  const CAST_TICK = 5;
  for (let t = 0; t < steps; t++) {
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
    // The exact bug this file closes: pre-fix, Zig's window field was ONE
    // TICK LATE vs TS on every tick from CAST_TICK onward (both the cast
    // tick's initial value AND every subsequent tick's decision of
    // "still live?" at the boundary) — so this must hold at every t, not
    // just once.
    expect({ t, until: b[field] }, `${field} agrees at t=${t}`).toEqual({
      t,
      until: a[field],
    });

    if (t === CAST_TICK) {
      expect(b[field], `Zig: ${field} opened on cast`).toBeDefined();
      expect(a[field], `TS: ${field} opened on cast`).toBeDefined();
    }
  }

  return { ts: tsState.players[PlayerId("p0")]!, zig: zigState.players[PlayerId("p0")]! };
}

describe("rally_light / aegis_share ability casts — tick-base parity", () => {
  test("Rally Light: the source window opens at the SAME tick and expires at the SAME tick on both engines", () => {
    const { ts, zig } = runCastParity("rally-light", "rallyLightUntilTick", 40);
    expect(zig.rallyLightUntilTick, "Zig: window is in the future").toBeGreaterThan(6);
    expect(zig.rallyLightUntilTick, "final agreement").toEqual(ts.rallyLightUntilTick);
  });

  test("Aegis Share: the widened-peel window opens at the SAME tick and expires at the SAME tick on both engines", () => {
    const { ts, zig } = runCastParity("aegis-share", "aegisShareUntilTick", 40);
    expect(zig.aegisShareUntilTick, "Zig: window is in the future").toBeGreaterThan(6);
    expect(zig.aegisShareUntilTick, "final agreement").toEqual(ts.aegisShareUntilTick);
  });
});
