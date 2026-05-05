// I1 gate — step_world orchestrator runs the H1-H7 helpers in
// deterministic order over a WorldState laid out by the G2
// bridge. The skeleton (I1) ticks projectiles' lifecycle + fire
// patches' lifetime + per-pair projectile×destructible HP. I2-I4
// expand the surface.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { packWorldState } from "../worldStateBridge";
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
const sim = await loadSimFromBytes(ab);

type WorldExports = {
  step_world: (state_ptr: number, dt_ms: number) => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as WorldExports;

const FIRES_OFFSET =
  40 + 8 + 16 * 288 + 8 + 256 * 216 + 8 + 32 * 96 + 8 + 64 * 64 + 8;
const DESTRUCTIBLES_OFFSET =
  40 + 8 + 16 * 288 + 8 + 256 * 216 + 8 + 32 * 96 + 8;
const TICK_OFFSET = 0;
const FIRE_REMAINING_OFFSET = 3 * 8;
const DEST_HEALTH_OFFSET = 4 * 8;

function buildState(o: {
  projectiles?: ProjectileEntity[];
  destructibles?: DestructibleEntity[];
  fires?: FireEntity[];
} = {}): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: Object.fromEntries(
      (o.projectiles ?? []).map((p) => [p.id, p]),
    ) as Record<EntityId, ProjectileEntity>,
    destructibles: Object.fromEntries(
      (o.destructibles ?? []).map((d) => [d.id, d]),
    ) as Record<EntityId, DestructibleEntity>,
    firePatches: Object.fromEntries(
      (o.fires ?? []).map((f) => [f.id, f]),
    ) as Record<EntityId, FireEntity>,
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

function load(state: WorldState): number {
  const buf = packWorldState(state);
  new Uint8Array(ex.memory.buffer).set(buf, sim.statePtr);
  return sim.statePtr;
}

describe("step_world orchestrator parity (Phase I1)", () => {
  test("step_world increments header.tick", () => {
    const ptr = load(buildState());
    const ret = ex.step_world(ptr, 16.667);
    expect(ret).toBe(0);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint32(ptr + TICK_OFFSET, true)).toBe(1);
    ex.step_world(ptr, 16.667);
    expect(view.getUint32(ptr + TICK_OFFSET, true)).toBe(2);
  });

  test("step_world ticks fire patch remaining_ms in place", () => {
    const fires: FireEntity[] = [
      {
        id: EntityId(101),
        x: 0,
        y: 0,
        radius: 32,
        remainingMs: 500,
        ownerId: null,
        damagePerSecond: 14,
      },
    ];
    const ptr = load(buildState({ fires }));
    ex.step_world(ptr, 100);
    const view = new DataView(ex.memory.buffer);
    expect(
      view.getFloat64(ptr + FIRES_OFFSET + FIRE_REMAINING_OFFSET, true),
    ).toBeCloseTo(400, 6);
  });

  test("step_world resolves projectile×destructible HP application", () => {
    const projectiles: ProjectileEntity[] = [
      {
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
    ];
    const destructibles: DestructibleEntity[] = [
      {
        id: EntityId(101),
        kind: "barrel",
        x: 100,
        y: 100,
        width: 32,
        height: 32,
        health: 100,
        explosive: true,
        flammable: false,
      },
    ];
    const ptr = load(buildState({ projectiles, destructibles }));
    ex.step_world(ptr, 16.667);
    const view = new DataView(ex.memory.buffer);
    // Destructible health drained by projectile damage (25).
    const health = view.getFloat64(
      ptr + DESTRUCTIBLES_OFFSET + DEST_HEALTH_OFFSET,
      true,
    );
    expect(health).toBe(75);
  });

  test("step_world iterates players + ticks combat shield (I4)", () => {
    // Manually pack a player with shield held (Shield bit = 1<<8)
    // and observe shield_charge drain after one tick.
    const players = [
      {
        id: "p_shield",
        x: 0,
        y: 0,
        shieldCharge: 100,
        shieldMaxCharge: 100,
        currentKeys: 1 << 8,
      },
    ];
    // Cheap: just use the standard fixture builder + then patch
    // current_keys + shield_charge in wasm memory before stepping.
    const baseState = buildState();
    const PlayerId_module = require("../../types") as {
      PlayerId: (s: string) => string;
    };
    const pid = PlayerId_module.PlayerId(players[0]!.id);
    const ptr = load({
      ...baseState,
      players: {
        [pid]: {
          id: pid,
          characterId: "balanced",
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          aimX: 0,
          aimY: 0,
          health: 100,
          shieldActive: true,
          crouching: false,
          alive: true,
          weaponId: "scrap",
          cards: [],
          fireCooldownMs: 0,
          ammo: 0,
          abilityCharge: 0,
          lastProcessedInputSeq: 0 as never,
          shieldCharge: 100,
          shieldMaxCharge: 100,
        },
      } as unknown as typeof baseState.players,
    });
    // Patch current_keys at the player's offset:
    // 17×8 (f64s) + 15×4 (u32s) + 4 (flags u32) + 1 (character)
    // + 1 (card_count) + 2 (pad) + 8 (id_len + weapon_id_len + 6
    // pad) + 32 (id_bytes) + 24 (weapon_id_bytes) = 268.
    // current_keys is at +268.
    const PLAYERS_OFFSET = 40 + 8;
    const view = new DataView(ex.memory.buffer);
    view.setUint32(ptr + PLAYERS_OFFSET + 268, 1 << 8, true);
    ex.step_world(ptr, 1000); // 1 sec tick
    // shield_charge offset: 11×8 = 88
    const charge = view.getFloat64(ptr + PLAYERS_OFFSET + 88, true);
    expect(charge).toBe(65); // 100 - 35*1
  });

  test("step_world projectile lifecycle: lifetime decrements toward expire", () => {
    const projectiles: ProjectileEntity[] = [
      {
        id: EntityId(1),
        ownerId: null,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        shape: "circle",
        radius: 6,
        damage: 5,
        lifetimeMs: 50, // expires next tick
        pathing: "straight",
        element: "neutral",
        bouncesRemaining: 0,
        pierceRemaining: 0,
      },
    ];
    const ptr = load(buildState({ projectiles }));
    // Single tick of dt=100 should report lifetime_expired internally.
    // We can't directly observe the enum result from step_world (it
    // doesn't return events yet), but the test confirms step_world
    // doesn't crash when a projectile expires this tick.
    expect(ex.step_world(ptr, 100)).toBe(0);
  });
});
