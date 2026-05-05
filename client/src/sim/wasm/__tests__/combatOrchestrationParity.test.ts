// H4 gate — wasm `combat_try_start_parry`,
// `combat_is_parry_active`, and `combat_tick_shield` produce the
// same field mutations on PlayerEntity as the TS combat
// orchestrator in `client/src/sim/combat.ts`.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { packWorldState } from "../worldStateBridge";
import { installLutTables } from "../../trig";
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

type CombatExports = {
  combat_try_start_parry: (
    player_ptr: number,
    curr_keys: number,
    prev_keys: number,
    tick: number,
    dt_ms: number,
    active_ms: number,
    cooldown_ms: number,
  ) => number;
  combat_is_parry_active: (
    player_ptr: number,
    tick: number,
  ) => number;
  combat_tick_shield: (
    player_ptr: number,
    curr_keys: number,
    dt_ms: number,
    max_override: number,
    drain_dps: number,
    recharge_dps: number,
  ) => void;
  combat_parry_active_ms: () => number;
  combat_parry_cooldown_ms_default: () => number;
  combat_shield_max_charge_default: () => number;
  combat_shield_drain_per_second: () => number;
  combat_shield_recharge_per_second: () => number;
  lut_sin_table_ptr: () => number;
  lut_atan_table_ptr: () => number;
  lut_table_size: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as CombatExports;

const tableSize = ex.lut_table_size();
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), tableSize),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), tableSize),
);

const PLAYERS_OFFSET = 40 + 8;
const FLAGS_OFFSET = 17 * 8 + 15 * 4; // 17 f64s + 15 u32s
const SHIELD_CHARGE_OFFSET = 11 * 8;
const PARRY_FACING_OFFSET = 13 * 8;
const PARRY_ACTIVE_TICK_OFFSET = 17 * 8 + 4 * 4;
const PARRY_COOLDOWN_TICK_OFFSET = 17 * 8 + 5 * 4;

function makePlayer(): PlayerEntity {
  return {
    id: PlayerId("p"),
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "scrap-rifle",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
  };
}

function loadIntoWasm(p: PlayerEntity): number {
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
  const heap = new Uint8Array(ex.memory.buffer);
  heap.set(buf, sim.statePtr);
  return sim.statePtr + PLAYERS_OFFSET;
}

const PARRY_ACTIVE_FLAG = 1 << 8;
const PARRY_COOLDOWN_FLAG = 1 << 9;
const PARRY_FACING_FLAG = 1 << 19;
const SHIELD_ACTIVE_FLAG = 1 << 1;

describe("combat orchestration parity (Phase H4)", () => {
  test("constants match TS combat.ts pinned values", () => {
    expect(ex.combat_parry_active_ms()).toBe(420);
    expect(ex.combat_parry_cooldown_ms_default()).toBe(1800);
    expect(ex.combat_shield_max_charge_default()).toBe(100);
    expect(ex.combat_shield_drain_per_second()).toBe(35);
    expect(ex.combat_shield_recharge_per_second()).toBe(14);
  });

  test("try_start_parry: starts on rising edge of Ability key", () => {
    const p = makePlayer();
    p.aimX = 100;
    p.aimY = 50;
    const ptr = loadIntoWasm(p);
    const ABILITY = 1 << 7;
    const result = ex.combat_try_start_parry(
      ptr,
      ABILITY, // curr — pressed
      0,       // prev — not pressed
      100,     // tick
      16.667,  // dt_ms
      420,     // active_ms
      1800,    // cooldown_ms
    );
    expect(result).toBe(1);
    const view = new DataView(ex.memory.buffer);
    const flags = view.getUint32(ptr + FLAGS_OFFSET, true);
    expect(flags & PARRY_ACTIVE_FLAG).not.toBe(0);
    expect(flags & PARRY_COOLDOWN_FLAG).not.toBe(0);
    expect(flags & PARRY_FACING_FLAG).not.toBe(0);
    // active_ticks = ceil(420 / 16.667) = 26 → tick + 26
    expect(view.getUint32(ptr + PARRY_ACTIVE_TICK_OFFSET, true)).toBe(126);
    // cooldown_ticks = ceil(1800 / 16.667) = 108 → tick + 108
    expect(view.getUint32(ptr + PARRY_COOLDOWN_TICK_OFFSET, true)).toBe(208);
    // facing = atan2(50, 100)
    const facing = view.getFloat64(ptr + PARRY_FACING_OFFSET, true);
    expect(facing).toBeCloseTo(Math.atan2(50, 100), 8);
  });

  test("try_start_parry: rejects when key was already pressed", () => {
    const p = makePlayer();
    const ptr = loadIntoWasm(p);
    const ABILITY = 1 << 7;
    const result = ex.combat_try_start_parry(ptr, ABILITY, ABILITY, 0, 16.667, 420, 1800);
    expect(result).toBe(0);
  });

  test("try_start_parry: rejects when in cooldown", () => {
    const p = makePlayer();
    p.parryCooldownUntilTick = Tick(50);
    const ptr = loadIntoWasm(p);
    const ABILITY = 1 << 7;
    const result = ex.combat_try_start_parry(ptr, ABILITY, 0, 30, 16.667, 420, 1800);
    expect(result).toBe(0);
  });

  test("is_parry_active: true while window covers tick", () => {
    const p = makePlayer();
    p.parryActiveUntilTick = Tick(150);
    const ptr = loadIntoWasm(p);
    expect(ex.combat_is_parry_active(ptr, 100)).toBe(1);
    expect(ex.combat_is_parry_active(ptr, 150)).toBe(0);
    expect(ex.combat_is_parry_active(ptr, 200)).toBe(0);
  });

  test("tick_shield: drain when held + charge available", () => {
    const p = makePlayer();
    p.shieldCharge = 100;
    p.shieldMaxCharge = 100;
    const ptr = loadIntoWasm(p);
    const SHIELD = 1 << 8;
    ex.combat_tick_shield(ptr, SHIELD, 1000, 0, 35, 14);
    const view = new DataView(ex.memory.buffer);
    const charge = view.getFloat64(ptr + SHIELD_CHARGE_OFFSET, true);
    expect(charge).toBe(65); // 100 - 35*1
    const flags = view.getUint32(ptr + FLAGS_OFFSET, true);
    expect(flags & SHIELD_ACTIVE_FLAG).not.toBe(0);
  });

  test("tick_shield: recharge when not held", () => {
    const p = makePlayer();
    p.shieldCharge = 50;
    p.shieldMaxCharge = 100;
    const ptr = loadIntoWasm(p);
    ex.combat_tick_shield(ptr, 0, 1000, 0, 35, 14);
    const view = new DataView(ex.memory.buffer);
    expect(view.getFloat64(ptr + SHIELD_CHARGE_OFFSET, true)).toBe(64); // 50+14
    const flags = view.getUint32(ptr + FLAGS_OFFSET, true);
    expect(flags & SHIELD_ACTIVE_FLAG).toBe(0);
  });

  test("tick_shield: caps recharge at max_charge", () => {
    const p = makePlayer();
    p.shieldCharge = 95;
    p.shieldMaxCharge = 100;
    const ptr = loadIntoWasm(p);
    ex.combat_tick_shield(ptr, 0, 1000, 0, 35, 14);
    const view = new DataView(ex.memory.buffer);
    expect(view.getFloat64(ptr + SHIELD_CHARGE_OFFSET, true)).toBe(100);
  });

  test("tick_shield: dead player keeps shield_active=false", () => {
    const p = makePlayer();
    p.alive = false;
    p.shieldActive = true;
    p.shieldCharge = 50;
    p.shieldMaxCharge = 100;
    const ptr = loadIntoWasm(p);
    const SHIELD = 1 << 8;
    ex.combat_tick_shield(ptr, SHIELD, 16.667, 0, 35, 14);
    const view = new DataView(ex.memory.buffer);
    const flags = view.getUint32(ptr + FLAGS_OFFSET, true);
    expect(flags & SHIELD_ACTIVE_FLAG).toBe(0);
  });
});
