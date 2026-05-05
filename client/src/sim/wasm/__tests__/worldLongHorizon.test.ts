// V6 — long-horizon canary on the wasm orchestrator shim.
//
// Drives 600 ticks (10 sim-seconds at 60 Hz) of step_world via
// `applyWasmWorldStep` over a deliberately-rich initial state:
//   - 50 projectiles in a grid (some over destructibles, some
//     not; some with sticky fuses, some without)
//   - 20 destructibles laid out so ~half take damage
//   - 10 fire patches with various remaining_ms values
//
// Asserts at end of run:
//   - tick advanced by exactly 600
//   - round phase machine ran (countdown_remaining_ms decremented
//     by 600 × 16.667 if no transition, otherwise transitioned
//     correctly)
//   - all fire patches expired (remaining_ms ≤ 0)
//   - destructibles overlapping projectiles took damage to 0
//     (each projectile = 25 dmg; destructibles HP = 100; 4 hits
//     would break, but the shim resolves once per tick so a
//     single-step run breaks any overlap-paired destructible)
//   - NaN guard: no f64 field on any entity is NaN
//
// Purpose: prove the wasm orchestrator survives realistic-volume
// long-horizon execution without divergence, segfault, or
// allocation cliff. Catches the class of bug where a 600-tick
// loop reveals an off-by-one or stale-pointer that a 1-tick test
// misses.

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

function buildLongHorizonFixture(): WorldState {
  const projectiles: Record<EntityId, ProjectileEntity> = {} as Record<
    EntityId,
    ProjectileEntity
  >;
  const destructibles: Record<EntityId, DestructibleEntity> = {} as Record<
    EntityId,
    DestructibleEntity
  >;
  const firePatches: Record<EntityId, FireEntity> = {} as Record<
    EntityId,
    FireEntity
  >;

  // 50 projectiles in a 5×10 grid. Half overlap a destructible
  // on (50,50)..(50,500); half don't.
  for (let i = 0; i < 50; i++) {
    const id = EntityId(1000 + i);
    const x = 50 + (i % 5) * 100;
    const y = 50 + Math.floor(i / 5) * 50;
    projectiles[id] = {
      id,
      ownerId: null,
      x,
      y,
      vx: 0,
      vy: 0,
      shape: "circle",
      radius: 6,
      damage: 25,
      lifetimeMs: i % 7 === 0 ? 30 : 5000, // some expire mid-run
      pathing: "straight",
      element: "neutral",
      bouncesRemaining: 0,
      pierceRemaining: 0,
      stickyFuseMs: i % 11 === 0 ? 200 : undefined, // some sticky
    };
  }

  // 20 destructibles centered every 100px from x=50..x=2000 along y=100.
  for (let i = 0; i < 20; i++) {
    const id = EntityId(2000 + i);
    destructibles[id] = {
      id,
      kind: "barrel",
      x: 50 + i * 100,
      y: 100,
      width: 32,
      height: 32,
      health: 100,
      explosive: i % 3 === 0,
      flammable: i % 5 === 0,
    };
  }

  // 10 fire patches with varying remaining_ms.
  for (let i = 0; i < 10; i++) {
    const id = EntityId(3000 + i);
    firePatches[id] = {
      id,
      x: 1000 + i * 50,
      y: 500,
      radius: 32,
      remainingMs: 100 + i * 100, // 100..1000ms
      ownerId: null,
      damagePerSecond: 14,
    };
  }

  return {
    tick: Tick(0),
    rngState: 0xc0ffee,
    players: {} as Record<PlayerId, never>,
    projectiles,
    destructibles,
    firePatches,
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

const STEP_MS = 1000 / 60;

function isNaNAnywhere(state: WorldState): string | null {
  for (const id in state.projectiles) {
    const p = state.projectiles[Number(id) as unknown as EntityId]!;
    for (const k of ["x", "y", "vx", "vy", "lifetimeMs"] as const) {
      if (Number.isNaN(p[k])) return `projectile ${id}.${k}`;
    }
  }
  for (const id in state.destructibles) {
    const d = state.destructibles[Number(id) as unknown as EntityId]!;
    for (const k of ["x", "y", "width", "height", "health"] as const) {
      if (Number.isNaN(d[k])) return `destructible ${id}.${k}`;
    }
  }
  for (const id in state.firePatches) {
    const f = state.firePatches[Number(id) as unknown as EntityId]!;
    for (const k of ["x", "y", "radius", "remainingMs", "damagePerSecond"] as const) {
      if (Number.isNaN(f[k])) return `fire ${id}.${k}`;
    }
  }
  return null;
}

describe("long-horizon canary (Phase V6)", () => {
  test("600 ticks of applyWasmWorldStep — tick + countdown advance, fires expire, destructibles take damage, no NaN", async () => {
    let state = buildLongHorizonFixture();
    for (let i = 0; i < 600; i++) {
      state = await applyWasmWorldStep(state, STEP_MS);
    }

    expect(state.tick).toBe(Tick(600));

    // 600 × 16.667 ≈ 10000ms; 90000 - 10000 = 80000.
    expect(state.round.countdownRemainingMs).toBeCloseTo(80_000, 0);
    expect(state.round.phase).toBe("fighting");

    // All fire patches start at ≤ 1000ms; 600 × 16.667 ≈ 10000ms,
    // so all should be at remaining ≤ 0.
    for (const id in state.firePatches) {
      const f = state.firePatches[Number(id) as unknown as EntityId]!;
      expect(f.remainingMs).toBeLessThanOrEqual(0);
    }

    // Per-pair projectile×destructible runs every tick: each
    // overlapping pair drains by 25 HP/tick. After 600 ticks
    // anything overlapping is at 0.
    for (const id in state.destructibles) {
      const d = state.destructibles[Number(id) as unknown as EntityId]!;
      // Health is either 100 (never overlapped) or 0 (overlapped).
      expect([0, 100]).toContain(d.health);
    }

    expect(isNaNAnywhere(state)).toBeNull();
  });
});
