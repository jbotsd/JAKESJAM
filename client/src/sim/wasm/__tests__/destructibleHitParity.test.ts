// H5 gate — destructible_resolve_projectile_hit returns the same
// outcome as the corresponding TS-side per-pair logic in
// `client/src/sim/destructible.ts` `stepDestructibles`.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { packWorldState, PLAYER_ENTITY_SIZE, MAX_PLAYERS } from "../worldStateBridge";
import {
  EntityId,
  PlayerId,
  Tick,
  type DestructibleEntity,
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
const sim = await loadSimFromBytes(ab);

type DestExports = {
  destructible_resolve_projectile_hit: (
    proj_ptr: number,
    dest_ptr: number,
  ) => number;
  destructible_explosion_radius: () => number;
  destructible_explosion_damage: () => number;
  destructible_fire_patch_default_lifetime_ms: () => number;
  destructible_fire_patch_default_radius: () => number;
  destructible_fire_patch_default_dps: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as DestExports;

// Offsets are computed inline in loadState via the explicit arithmetic
// chain so any mistake in this test fails loudly rather than silently.

function loadState(state: WorldState): {
  projPtr: number;
  destPtr: number;
} {
  const buf = packWorldState(state);
  const heap = new Uint8Array(ex.memory.buffer);
  heap.set(buf, sim.statePtr);
  // Compute precise offsets for projectile[0] and destructible[0].
  // Player-block size derived from the live constant (2026-07-18) — see
  // projectileLifecycleParity.test.ts's PROJECTILES_OFFSET comment.
  const projOff = 48 + 8 + MAX_PLAYERS * PLAYER_ENTITY_SIZE + 8;
  const destOff =
    48 + 8 + MAX_PLAYERS * PLAYER_ENTITY_SIZE + 8 + 256 * 216 + 8 + 32 * 96 + 8;
  return {
    projPtr: sim.statePtr + projOff,
    destPtr: sim.statePtr + destOff,
  };
}

function makeProj(o: Partial<ProjectileEntity> = {}): ProjectileEntity {
  return {
    id: EntityId(1),
    ownerId: null,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 18,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ...o,
  };
}

function makeDest(o: Partial<DestructibleEntity> = {}): DestructibleEntity {
  return {
    id: EntityId(101),
    kind: "barrel",
    x: 100,
    y: 100,
    width: 32,
    height: 32,
    health: 50,
    explosive: true,
    flammable: false,
    ...o,
  };
}

function withEntities(
  proj: ProjectileEntity,
  dest: DestructibleEntity,
): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: { [proj.id]: proj } as Record<EntityId, ProjectileEntity>,
    destructibles: { [dest.id]: dest } as Record<
      EntityId,
      DestructibleEntity
    >,
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

const DEST_HEALTH_OFFSET = 4 * 8; // 4 f64s before health

describe("destructible orchestration parity (Phase H5)", () => {
  test("constants match TS-side", () => {
    expect(ex.destructible_explosion_radius()).toBe(80);
    expect(ex.destructible_explosion_damage()).toBe(28);
    expect(ex.destructible_fire_patch_default_lifetime_ms()).toBe(1800);
    expect(ex.destructible_fire_patch_default_radius()).toBe(36);
    expect(ex.destructible_fire_patch_default_dps()).toBe(14);
  });

  test("no_overlap when projectile is far away", () => {
    const proj = makeProj({ x: 500, y: 500 });
    const dest = makeDest();
    const { projPtr, destPtr } = loadState(withEntities(proj, dest));
    expect(ex.destructible_resolve_projectile_hit(projPtr, destPtr)).toBe(0);
  });

  test("damaged when projectile overlaps + dest survives", () => {
    const proj = makeProj({ damage: 18 });
    const dest = makeDest({ health: 50 });
    const { projPtr, destPtr } = loadState(withEntities(proj, dest));
    expect(ex.destructible_resolve_projectile_hit(projPtr, destPtr)).toBe(1);
    const view = new DataView(ex.memory.buffer);
    expect(view.getFloat64(destPtr + DEST_HEALTH_OFFSET, true)).toBe(32);
  });

  test("broken when damage drops health to 0", () => {
    const proj = makeProj({ damage: 100 });
    const dest = makeDest({ health: 50 });
    const { projPtr, destPtr } = loadState(withEntities(proj, dest));
    expect(ex.destructible_resolve_projectile_hit(projPtr, destPtr)).toBe(2);
    const view = new DataView(ex.memory.buffer);
    expect(view.getFloat64(destPtr + DEST_HEALTH_OFFSET, true)).toBe(0);
  });

  test("no_overlap when destructible already at health <= 0", () => {
    const proj = makeProj({ damage: 5 });
    const dest = makeDest({ health: 0 });
    const { projPtr, destPtr } = loadState(withEntities(proj, dest));
    expect(ex.destructible_resolve_projectile_hit(projPtr, destPtr)).toBe(0);
  });
});
