// J0 gate — applyWasmWorldStep takes a TS WorldState, runs one
// wasm step_world tick on it, and returns a merged TS WorldState.
// Tests confirm the wasm-owned pieces are advanced + the rest is
// preserved.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { applyWasmWorldStep } from "../worldWasmBackend";
import {
  EntityId,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type FireEntity,
  type ProjectileEntity,
  type WorldState,
} from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

// The shim calls loadSim() which fetches "/wasm/sim.wasm" — that
// fails under bun test. We pre-warm the cache via loadSimFromBytes
// + a tiny module-level shim so subsequent loadSim() calls return
// our preloaded sim.
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const preloaded = await loadSimFromBytes(ab);

// Loader caches `cached` lazily on first loadSim() — but
// loadSimFromBytes doesn't populate it. We monkey-patch via the
// cached export. Since the test imports loader.ts directly, the
// cleanest path: import { __setCachedSim } if exposed; otherwise
// the shim's first call triggers a network fetch which we
// intercept by ensuring loadSim never runs in this test. The
// shim's ensureSim() reads from `await loadSim()` — and loadSim
// will fetch `/wasm/sim.wasm`. Bun test runs in node-ish env; the
// fetch will fail.
//
// Workaround: force-poison globalThis.fetch with a stub that
// returns the wasm bytes for the expected URL. This is the
// pattern used elsewhere in the wasm tests.

const fetchStub = (input: RequestInfo | URL): Promise<Response> => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm")) {
    return Promise.resolve(
      new Response(ab as ArrayBuffer, {
        headers: { "Content-Type": "application/wasm" },
      }),
    );
  }
  throw new Error(`unexpected fetch in test: ${url}`);
};
(globalThis as { fetch: typeof fetch }).fetch =
  fetchStub as unknown as typeof fetch;

// Avoid an unused warning while keeping the preload available.
void preloaded;

function makeFixture(): WorldState {
  const proj: ProjectileEntity = {
    id: EntityId(1),
    ownerId: null,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 25,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
  const dest: DestructibleEntity = {
    id: EntityId(101),
    kind: "barrel",
    x: 100,
    y: 100,
    width: 32,
    height: 32,
    health: 100,
    explosive: true,
    flammable: false,
  };
  const fire: FireEntity = {
    id: EntityId(201),
    x: 0,
    y: 0,
    radius: 32,
    remainingMs: 500,
    ownerId: null,
    damagePerSecond: 14,
  };
  return {
    tick: Tick(7),
    rngState: 1234,
    players: {} as Record<PlayerId, never>,
    projectiles: { [proj.id]: proj } as Record<EntityId, ProjectileEntity>,
    destructibles: { [dest.id]: dest } as Record<EntityId, DestructibleEntity>,
    firePatches: { [fire.id]: fire } as Record<EntityId, FireEntity>,
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 30_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("worldWasmBackend.applyWasmWorldStepSync (Phase J0b)", () => {
  test("after preload, sync variant produces same result as async", async () => {
    const { preloadWasmWorldSim, applyWasmWorldStepSync, isWasmWorldReady } =
      await import("../worldWasmBackend");
    const ok = await preloadWasmWorldSim();
    expect(ok).toBe(true);
    expect(isWasmWorldReady()).toBe(true);

    const stateAsync = makeFixture();
    const stateSync = makeFixture();
    const nextSync = applyWasmWorldStepSync(stateSync, 16.667);
    const { applyWasmWorldStep } = await import("../worldWasmBackend");
    const nextAsync = await applyWasmWorldStep(stateAsync, 16.667);

    expect(nextSync.tick).toBe(nextAsync.tick);
    const dSync = nextSync.destructibles[EntityId(101)]!;
    const dAsync = nextAsync.destructibles[EntityId(101)]!;
    expect(dSync.health).toBe(dAsync.health);
  });
});

describe("worldWasmBackend.applyWasmWorldStep (Phase J0)", () => {
  test("round-trips a state through step_world; tick advances", async () => {
    const state = makeFixture();
    const next = await applyWasmWorldStep(state, 16.667);
    expect(next.tick).toBe(Tick(8));
  });

  test("destructible HP drops via projectile×destructible resolution", async () => {
    const state = makeFixture();
    const next = await applyWasmWorldStep(state, 16.667);
    const d = next.destructibles[EntityId(101)]!;
    expect(d.health).toBe(75); // 100 - 25
  });

  test("fire patch remaining_ms decremented by dt", async () => {
    const state = makeFixture();
    const next = await applyWasmWorldStep(state, 100);
    const f = next.firePatches[EntityId(201)]!;
    expect(f.remainingMs).toBe(400);
  });

  test("round.countdownRemainingMs ticked by phase machine", async () => {
    const state = makeFixture();
    const next = await applyWasmWorldStep(state, 16.667);
    expect(next.round.countdownRemainingMs).toBeCloseTo(30_000 - 16.667, 6);
    expect(next.round.phase).toBe("fighting");
    expect(next.round.roundIndex).toBe(1);
  });

  test("merged state preserves non-wasm-owned slices like chaosModifierIds + scores", async () => {
    const state = makeFixture();
    state.chaosModifierIds = ["low-gravity"];
    const next = await applyWasmWorldStep(state, 16.667);
    // chaosModifierIds round-trips via the chaos_mask bitfield.
    expect(next.chaosModifierIds).toContain("low-gravity");
    // round.scores stays TS-side until the J shim bridges it.
    expect(next.round.scores).toBe(state.round.scores);
  });
});
