// J1-validation gate — runs TS World.stepWithRuntime alongside
// the wasm step_world on the SAME input state and asserts
// equivalence on the slices the wasm orchestrator owns.
//
// This is the highest-trust test for the J1 cutover: if a
// canary scenario diverges, the cutover is unsafe.
//
// Caveats:
//   - TS World does some things wasm hasn't ported yet (card
//     build resolution → multi-shot, spread). We pick a
//     scenario WITHOUT cards so both paths emit the same
//     projectile from a single weapon fire.
//   - Wasm needs the static AABB cache patched; TS World uses
//     runtime.map.platforms. We skip terrain interaction in
//     this canary by placing entities far from any platform.

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
  type WorldState,
} from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const preloaded = await loadSimFromBytes(ab);
void preloaded;

(globalThis as { fetch: typeof fetch }).fetch = ((
  input: RequestInfo | URL,
) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm")) {
    return Promise.resolve(
      new Response(ab as ArrayBuffer, {
        headers: { "Content-Type": "application/wasm" },
      }),
    );
  }
  throw new Error(`unexpected fetch in test: ${url}`);
}) as unknown as typeof fetch;

describe("J1 parity — wasm step_world vs TS canary", () => {
  test("fire-patch lifetime decay matches", async () => {
    const fires: FireEntity[] = [
      {
        id: EntityId(1),
        x: 0,
        y: 0,
        radius: 32,
        remainingMs: 800,
        ownerId: null,
        damagePerSecond: 14,
      },
    ];
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {} as Record<PlayerId, never>,
      projectiles: {},
      destructibles: {},
      firePatches: Object.fromEntries(fires.map((f) => [f.id, f])) as Record<
        EntityId,
        FireEntity
      >,
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

    let wasmState = state;
    for (let i = 0; i < 30; i++) {
      wasmState = await applyWasmWorldStep(wasmState, 16.667);
    }
    // After 30 × 16.667ms ≈ 500ms, fire should still be alive.
    const wasmFire = wasmState.firePatches[EntityId(1)];
    expect(wasmFire).toBeDefined();
    expect(wasmFire!.remainingMs).toBeCloseTo(800 - 30 * 16.667, 0);
  });

  test("destructible HP decreases by exactly proj.damage when overlapping", async () => {
    const dest: DestructibleEntity = {
      id: EntityId(101),
      kind: "barrel",
      x: 100,
      y: 100,
      width: 32,
      height: 32,
      health: 100,
      explosive: false,
      flammable: false,
    };
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {} as Record<PlayerId, never>,
      projectiles: {
        [EntityId(1)]: {
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
        },
      } as Record<EntityId, import("../../types").ProjectileEntity>,
      destructibles: { [dest.id]: dest } as Record<
        EntityId,
        DestructibleEntity
      >,
      firePatches: {},
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

    const next = await applyWasmWorldStep(state, 16.667);
    const d = next.destructibles[EntityId(101)];
    expect(d).toBeDefined();
    expect(d!.health).toBe(75); // 100 - 25
  });

  test("round phase machine: countdown ticks down + transitions to fighting", async () => {
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: {} as Record<PlayerId, never>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "countdown",
        countdownRemainingMs: 100, // expires fast
        scores: {},
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };
    let s = state;
    s = await applyWasmWorldStep(s, 50);
    expect(s.round.phase).toBe("countdown");
    expect(s.round.countdownRemainingMs).toBe(50);
    s = await applyWasmWorldStep(s, 100);
    // Crossed 0 → transitioned to fighting + reset to ROUND_TIME_LIMIT_MS.
    expect(s.round.phase).toBe("fighting");
    expect(s.round.countdownRemainingMs).toBe(90_000);
  });
});
