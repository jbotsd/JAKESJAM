// Cross-impl parity for weapon math primitives (Phase F1b).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { installLutTables, lutCos, lutSin } from "../../trig";
import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

interface WeaponExports {
  weapon_muzzle_position(
    px: number, py: number, ax: number, ay: number, reach: number, outPtr: number,
  ): void;
  weapon_recoil(baseAngle: number, recoil: number, outPtr: number): void;
  weapon_tick_cooldown(cooldownMs: number, dtMs: number): number;
  weapon_spread_offset(count: number, idx: number, totalSpread: number): number;
  weapon_cooldown_from_fire_rate(fireRate: number, minRate: number): number;
  sizeof_muzzle_position(): number;
  sizeof_recoil_impulse(): number;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & WeaponExports;
const SIZEOF_MUZZLE = ex.sizeof_muzzle_position();
const SIZEOF_RECOIL = ex.sizeof_recoil_impulse();
expect(SIZEOF_MUZZLE).toBe(16);
expect(SIZEOF_RECOIL).toBe(16);

const tableSize = ex.lut_table_size();
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), tableSize),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), tableSize),
);

const OUT_OFF = 0;
function readMuzzle() {
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    x: dv.getFloat64(sim.statePtr + OUT_OFF + 0, true),
    y: dv.getFloat64(sim.statePtr + OUT_OFF + 8, true),
  };
}
function readRecoil() {
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    dvx: dv.getFloat64(sim.statePtr + OUT_OFF + 0, true),
    dvy: dv.getFloat64(sim.statePtr + OUT_OFF + 8, true),
  };
}

const REACH = 22;
const MIN_FIRE_RATE = 0.35;

// TS reference impls — mirror Zig kernels exactly.
function refMuzzle(px: number, py: number, ax: number, ay: number, reach: number) {
  const dx = ax - px;
  const dy = ay - py;
  const lenRaw = Math.sqrt(dx * dx + dy * dy);
  const len = lenRaw === 0 ? 1 : lenRaw;
  return { x: px + (dx / len) * reach, y: py + (dy / len) * reach };
}
function refRecoil(baseAngle: number, recoil: number) {
  return {
    dvx: -(lutCos(baseAngle) * recoil),
    dvy: -(lutSin(baseAngle) * recoil * 0.45),
  };
}
function refTickCooldown(cd: number, dt: number) {
  const next = cd - dt;
  return next < 0 ? 0 : next;
}
function refSpreadOffset(n: number, i: number, total: number) {
  if (n <= 1) return 0;
  return -total / 2 + (total * i) / (n - 1);
}
function refCooldownFromFireRate(rate: number, min: number) {
  return 1000 / Math.max(min, rate);
}

describe("weapon parity (TS V8 vs Zig wasm)", () => {
  test("muzzle position matches across many angles + distances", () => {
    let s = 0xb00b_face >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      const px = range(0, 1280);
      const py = range(0, 720);
      const ax = range(0, 1280);
      const ay = range(0, 720);
      const ts = refMuzzle(px, py, ax, ay, REACH);
      ex.weapon_muzzle_position(px, py, ax, ay, REACH, sim.statePtr + OUT_OFF);
      const wa = readMuzzle();
      if (wa.x !== ts.x || wa.y !== ts.y) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  test("zero-distance muzzle: aim == player position returns player position", () => {
    ex.weapon_muzzle_position(100, 200, 100, 200, REACH, sim.statePtr + OUT_OFF);
    const wa = readMuzzle();
    expect(wa.x).toBe(100);
    expect(wa.y).toBe(200);
  });

  test("recoil impulse matches across many angles", () => {
    let mismatches = 0;
    for (let i = 0; i < 500; i++) {
      const angle = -Math.PI + (i / 500) * 2 * Math.PI;
      const recoil = 50 + (i % 7) * 10;
      const ts = refRecoil(angle, recoil);
      ex.weapon_recoil(angle, recoil, sim.statePtr + OUT_OFF);
      const wa = readRecoil();
      if (wa.dvx !== ts.dvx || wa.dvy !== ts.dvy) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  test("tick cooldown clamps at 0 and matches Math.max", () => {
    const cases: Array<[number, number]> = [
      [200, 16.66],
      [16.66, 16.66],
      [10, 16.66], // overshoots → 0
      [0, 16.66],
      [1000, 50],
    ];
    for (const [cd, dt] of cases) {
      expect(ex.weapon_tick_cooldown(cd, dt)).toBe(refTickCooldown(cd, dt));
    }
  });

  test("spread offset across N=1..8 fans byte-identical", () => {
    for (let n = 1; n <= 8; n++) {
      for (let i = 0; i < n; i++) {
        const ts = refSpreadOffset(n, i, 0.4);
        const wa = ex.weapon_spread_offset(n, i, 0.4);
        expect(wa).toBe(ts);
      }
    }
  });

  test("cooldown from fire rate clamps to floor", () => {
    expect(ex.weapon_cooldown_from_fire_rate(2.0, MIN_FIRE_RATE))
      .toBe(refCooldownFromFireRate(2.0, MIN_FIRE_RATE));
    expect(ex.weapon_cooldown_from_fire_rate(0.1, MIN_FIRE_RATE))
      .toBe(refCooldownFromFireRate(0.1, MIN_FIRE_RATE));
    expect(ex.weapon_cooldown_from_fire_rate(0.0, MIN_FIRE_RATE))
      .toBe(refCooldownFromFireRate(0.0, MIN_FIRE_RATE));
  });
});
