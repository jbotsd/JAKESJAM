// H2 gate — weapon_tick_fire decides fire/no-fire identically
// to the cooldown logic in client/src/sim/weapon.ts stepWeapon.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { packWorldState } from "../worldStateBridge";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type PlayerEntity,
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

type WeaponExports = {
  weapon_tick_fire: (
    player_ptr: number,
    fire_requested: number,
    dt_ms: number,
    cooldown_after_fire_ms: number,
    out_ptr: number,
  ) => void;
  weapon_tick_fire_with_keys: (
    player_ptr: number,
    keys: number,
    dt_ms: number,
    cooldown_after_fire_ms: number,
    out_ptr: number,
  ) => void;
  sizeof_fire_decision: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as WeaponExports;

const PLAYERS_OFFSET = 48 + 8;
const FIRE_COOLDOWN_OFFSET = 7 * 8; // 7 f64s before fire_cooldown_ms

function makePlayer(o: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p"),
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "scrap",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...o,
  };
}

function loadPlayer(p: PlayerEntity): { ptr: number; outPtr: number } {
  const state: WorldState = {
    tick: Tick(0),
    rngState: 1,
    players: { [p.id]: p } as Record<PlayerId, PlayerEntity>,
    projectiles: {} as Record<EntityId, never>,
    destructibles: {},
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
  const buf = packWorldState(state);
  new Uint8Array(ex.memory.buffer).set(buf, sim.statePtr);
  return {
    ptr: sim.statePtr + PLAYERS_OFFSET,
    outPtr: sim.statePtr + buf.byteLength + 16,
  };
}

describe("weapon fire decision parity (Phase H2)", () => {
  test("fired=0 + cooldown decremented when not requesting fire", () => {
    const { ptr, outPtr } = loadPlayer(makePlayer({ fireCooldownMs: 50 }));
    ex.weapon_tick_fire(ptr, 0, 16.667, 200, outPtr);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint8(outPtr)).toBe(0);
    expect(view.getFloat64(ptr + FIRE_COOLDOWN_OFFSET, true)).toBeCloseTo(50 - 16.667, 6);
  });

  test("fired=0 when cooldown still > 0 even if requesting fire", () => {
    const { ptr, outPtr } = loadPlayer(makePlayer({ fireCooldownMs: 100 }));
    ex.weapon_tick_fire(ptr, 1, 16.667, 200, outPtr);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint8(outPtr)).toBe(0);
  });

  test("fired=1 + cooldown reset when fire-rate window opens", () => {
    const { ptr, outPtr } = loadPlayer(makePlayer({ fireCooldownMs: 0 }));
    ex.weapon_tick_fire(ptr, 1, 16.667, 200, outPtr);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint8(outPtr)).toBe(1);
    expect(view.getFloat64(ptr + FIRE_COOLDOWN_OFFSET, true)).toBe(200);
  });

  test("dead player never fires even with key + cooldown=0", () => {
    const { ptr, outPtr } = loadPlayer(
      makePlayer({ fireCooldownMs: 0, alive: false }),
    );
    ex.weapon_tick_fire(ptr, 1, 16.667, 200, outPtr);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint8(outPtr)).toBe(0);
  });

  test("with_keys: InputBit.Fire (1<<6) triggers fire", () => {
    const { ptr, outPtr } = loadPlayer(makePlayer({ fireCooldownMs: 0 }));
    ex.weapon_tick_fire_with_keys(ptr, 1 << 6, 16.667, 200, outPtr);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint8(outPtr)).toBe(1);
  });

  test("with_keys: other bits set without Fire don't trigger", () => {
    const { ptr, outPtr } = loadPlayer(makePlayer({ fireCooldownMs: 0 }));
    ex.weapon_tick_fire_with_keys(ptr, (1 << 0) | (1 << 4), 16.667, 200, outPtr);
    const view = new DataView(ex.memory.buffer);
    expect(view.getUint8(outPtr)).toBe(0);
  });

  test("sizeof_fire_decision", () => {
    expect(ex.sizeof_fire_decision()).toBe(8);
  });
});
