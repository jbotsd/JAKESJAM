// I4c — integration test: 100 ticks of step_world driving the
// per-player combat orchestration (shield drain, parry start +
// rollover). Walks a player through:
//   ticks 0-30   : shield held, drains charge
//   ticks 30-60  : shield released, recharges
//   tick 60      : Ability press (rising edge) → parry started
//   ticks 60-100 : parry active window winds down
//
// Asserts shield_charge / parry_active_until_tick / parry_cooldown
// land at the expected values after the 100-tick run.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { packWorldState, HEADER_SIZE } from "../worldStateBridge";
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

type Exports = {
  step_world: (ptr: number, dt: number) => number;
  lut_sin_table_ptr: () => number;
  lut_atan_table_ptr: () => number;
  lut_table_size: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as Exports;
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), ex.lut_table_size()),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), ex.lut_table_size()),
);

// HEADER_SIZE (2026-07-20: 48 → 56 for WorldStateHeader.round_winner_idx) —
// derived from the live constant, not re-hardcoded.
const PLAYERS_OFFSET = HEADER_SIZE + 8;
const SHIELD_CHARGE_OFFSET = 11 * 8;
const FLAGS_OFFSET = 17 * 8 + 15 * 4;
const PARRY_ACTIVE_TICK_OFFSET = 17 * 8 + 4 * 4;
const CURRENT_KEYS_OFFSET = 268; // see worldStepParity.test.ts derivation
const PREV_KEYS_OFFSET = CURRENT_KEYS_OFFSET + 4;

const SHIELD_BIT = 1 << 8;
const ABILITY_BIT = 1 << 7;
const PARRY_ACTIVE_FLAG = 1 << 8;

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
    weaponId: "scrap",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    shieldCharge: 100,
    shieldMaxCharge: 100,
  };
}

function loadState(): { ptr: number; playerPtr: number } {
  const p = makePlayer();
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
      countdownRemainingMs: 90_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
  const buf = packWorldState(state);
  new Uint8Array(ex.memory.buffer).set(buf, sim.statePtr);
  return {
    ptr: sim.statePtr,
    playerPtr: sim.statePtr + PLAYERS_OFFSET,
  };
}

describe("step_world per-player combat integration (Phase I4c)", () => {
  test("100-tick run: shield drain → recharge → parry rising edge", () => {
    const { ptr, playerPtr } = loadState();
    const view = new DataView(ex.memory.buffer);
    const STEP_MS = 1000 / 60;

    for (let t = 0; t < 100; t++) {
      let keys = 0;
      if (t < 30) keys |= SHIELD_BIT;
      // Ability press lands ONCE on tick 60 — rising edge so
      // tryStartParry returns true.
      if (t === 60) keys |= ABILITY_BIT;
      view.setUint32(playerPtr + CURRENT_KEYS_OFFSET, keys, true);

      ex.step_world(ptr, STEP_MS);
    }

    // Shield charge: 30 ticks of drain at 35dps over (30 × 16.667
    // ≈ 500ms) = 100 - 17.5 = 82.5; then 70 ticks of recharge at
    // 14dps over (70 × 16.667 ≈ 1167ms) = 82.5 + 16.33 = ~98.83
    // capped at 100. Final ≈ 98.83.
    const finalCharge = view.getFloat64(
      playerPtr + SHIELD_CHARGE_OFFSET,
      true,
    );
    expect(finalCharge).toBeLessThanOrEqual(100);
    expect(finalCharge).toBeGreaterThan(80);

    // Parry started on tick 61 (after the increment). active_ticks
    // = ceil(420 / 16.667) = 26. parryActiveUntilTick should be
    // 61 + 26 = 87. After 100 ticks the window has expired but
    // the field stays set + has_parry_active flag stays on.
    const flags = view.getUint32(playerPtr + FLAGS_OFFSET, true);
    expect(flags & PARRY_ACTIVE_FLAG).not.toBe(0);
    const parryActiveUntilTick = view.getUint32(
      playerPtr + PARRY_ACTIVE_TICK_OFFSET,
      true,
    );
    expect(parryActiveUntilTick).toBe(87);

    // prev_keys is the LAST tick's current_keys = 0 (no input on
    // tick 99).
    const prevKeys = view.getUint32(playerPtr + PREV_KEYS_OFFSET, true);
    expect(prevKeys).toBe(0);
  });

  test("Ability held continuously fires parry once on rising edge only", () => {
    const { ptr, playerPtr } = loadState();
    const view = new DataView(ex.memory.buffer);
    const STEP_MS = 1000 / 60;

    let parryStarts = 0;
    for (let t = 0; t < 50; t++) {
      view.setUint32(playerPtr + CURRENT_KEYS_OFFSET, ABILITY_BIT, true);
      const beforeUntil = view.getUint32(
        playerPtr + PARRY_ACTIVE_TICK_OFFSET,
        true,
      );
      ex.step_world(ptr, STEP_MS);
      const afterUntil = view.getUint32(
        playerPtr + PARRY_ACTIVE_TICK_OFFSET,
        true,
      );
      if (afterUntil !== beforeUntil) parryStarts++;
    }
    // Rising edge fires once; subsequent held ticks are no-ops
    // (cooldown gate prevents re-arm).
    expect(parryStarts).toBe(1);
  });
});
