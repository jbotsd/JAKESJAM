// I18+I19 — confirms step_world emits SimEvents and unpack
// surfaces them via UnpackedWorldState.events.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
  SIM_EVENT_KIND,
} from "../worldStateBridge";
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
type Ex = {
  step_world: (ptr: number, dt: number) => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as Ex;

describe("step_world events emission (I18+I19)", () => {
  test("destructible-broken event emitted on projectile hit", () => {
    const proj: ProjectileEntity = {
      id: EntityId(1),
      ownerId: null,
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
      shape: "circle",
      radius: 6,
      damage: 200, // overkill
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
      health: 50,
      explosive: false,
      flammable: false,
    };
    const state: WorldState = {
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
        countdownRemainingMs: 1000,
        scores: {},
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };
    const buf = packWorldState(state);
    new Uint8Array(ex.memory.buffer).set(buf, sim.statePtr);
    ex.step_world(sim.statePtr, 16.667);
    const back = new Uint8Array(
      ex.memory.buffer,
      sim.statePtr,
      WORLD_STATE_TOTAL_SIZE,
    ).slice();
    const unpacked = unpackWorldState(back);
    expect(unpacked.events).toBeDefined();
    const broken = unpacked.events.find(
      (e) => e.kind === SIM_EVENT_KIND.destructibleBroken,
    );
    expect(broken).toBeDefined();
    expect(broken!.entityId).toBe(101);
    expect(broken!.x).toBe(100);
    expect(broken!.y).toBe(100);
  });

  test("event_count resets to 0 between ticks (no leak)", () => {
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
        phase: "fighting",
        countdownRemainingMs: 1000,
        scores: {},
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };
    const buf = packWorldState(state);
    new Uint8Array(ex.memory.buffer).set(buf, sim.statePtr);
    ex.step_world(sim.statePtr, 16.667);
    ex.step_world(sim.statePtr, 16.667);
    const back = new Uint8Array(
      ex.memory.buffer,
      sim.statePtr,
      WORLD_STATE_TOTAL_SIZE,
    ).slice();
    const unpacked = unpackWorldState(back);
    expect(unpacked.events.length).toBe(0);
  });
});
