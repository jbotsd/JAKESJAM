// Cross-impl parity for the float/accelerate pathings + the
// rotateVelocityToward helper (Phase F1a partial).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { installLutTables, lutAtan2, lutCos, lutSin } from "../../trig";
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
const ex = sim.exports as unknown as typeof sim.exports & {
  projectile_apply_float(
    vx: number, vy: number, ageMs: number, id: number, dtMs: number,
    outVx: number, outVy: number,
  ): void;
  projectile_apply_accelerate(
    vx: number, vy: number, kFactor: number, dtMs: number,
    outVx: number, outVy: number,
  ): void;
  projectile_rotate_velocity_toward(
    vx: number, vy: number, px: number, py: number,
    targetX: number, targetY: number, turnRate: number, dtSec: number,
    outVx: number, outVy: number,
  ): void;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
};

const tableSize = ex.lut_table_size();
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), tableSize),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), tableSize),
);

const FLOAT_OSC_LATERAL = 22;
const FLOAT_OSC_FORWARD = 11;
const FLOAT_OSC_LATERAL_HZ = 9;
const FLOAT_OSC_FORWARD_HZ = 5;

const OFF_VX = 0;
const OFF_VY = 8;

function callApplyFloat(vx: number, vy: number, ageMs: number, id: number, dtMs: number) {
  ex.projectile_apply_float(vx, vy, ageMs, id, dtMs, sim.statePtr + OFF_VX, sim.statePtr + OFF_VY);
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    vx: dv.getFloat64(sim.statePtr + OFF_VX, true),
    vy: dv.getFloat64(sim.statePtr + OFF_VY, true),
  };
}

function refApplyFloat(vx: number, vy: number, ageMs: number, id: number, dtMs: number) {
  const ageSec = ageMs / 1000;
  const dtSec = dtMs / 1000;
  return {
    vx: vx + lutCos(ageSec * FLOAT_OSC_FORWARD_HZ + id) * FLOAT_OSC_FORWARD * dtSec,
    vy: vy + lutSin(ageSec * FLOAT_OSC_LATERAL_HZ + id) * FLOAT_OSC_LATERAL * dtSec,
  };
}

function callApplyAccelerate(vx: number, vy: number, k: number, dtMs: number) {
  ex.projectile_apply_accelerate(vx, vy, k, dtMs, sim.statePtr + OFF_VX, sim.statePtr + OFF_VY);
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    vx: dv.getFloat64(sim.statePtr + OFF_VX, true),
    vy: dv.getFloat64(sim.statePtr + OFF_VY, true),
  };
}

function refApplyAccelerate(vx: number, vy: number, k: number, dtMs: number) {
  const factor = 1 + k * (dtMs / 1000);
  return { vx: vx * factor, vy: vy * factor };
}

function callRotate(
  vx: number, vy: number, px: number, py: number,
  tx: number, ty: number, turnRate: number, dtSec: number,
) {
  ex.projectile_rotate_velocity_toward(vx, vy, px, py, tx, ty, turnRate, dtSec, sim.statePtr + OFF_VX, sim.statePtr + OFF_VY);
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    vx: dv.getFloat64(sim.statePtr + OFF_VX, true),
    vy: dv.getFloat64(sim.statePtr + OFF_VY, true),
  };
}

function refRotate(
  vx: number, vy: number, px: number, py: number,
  tx: number, ty: number, turnRate: number, dtSec: number,
) {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed <= 0) return { vx, vy };
  const current = lutAtan2(vy, vx);
  const desired = lutAtan2(ty - py, tx - px);
  const next = refRotateAngleToward(current, desired, turnRate * dtSec);
  return { vx: lutCos(next) * speed, vy: lutSin(next) * speed };
}

function refWrapAngle(angle: number) {
  const TWO_PI = Math.PI * 2;
  let a = angle;
  while (a < -Math.PI) a += TWO_PI;
  while (a >= Math.PI) a -= TWO_PI;
  return a;
}
function refRotateAngleToward(current: number, target: number, maxStep: number) {
  const diff = refWrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  return current + sign * maxStep;
}

const DT_MS = 1000 / 60;

describe("projectile pathing helpers parity (TS V8 vs Zig wasm)", () => {
  test("float pathing: 60-tick oscillation byte-identical", () => {
    let mismatches = 0;
    let ageMs = 0;
    let vx = 200;
    let vy = -100;
    const id = 7;
    for (let tick = 0; tick < 60; tick++) {
      const ts = refApplyFloat(vx, vy, ageMs, id, DT_MS);
      const wa = callApplyFloat(vx, vy, ageMs, id, DT_MS);
      if (ts.vx !== wa.vx || ts.vy !== wa.vy) mismatches++;
      vx = ts.vx;
      vy = ts.vy;
      ageMs += DT_MS;
    }
    expect(mismatches).toBe(0);
  });

  test("accelerate pathing: 30-tick scaling byte-identical", () => {
    let vx = 100;
    let vy = 50;
    const k = 1.5;
    let mismatches = 0;
    for (let tick = 0; tick < 30; tick++) {
      const ts = refApplyAccelerate(vx, vy, k, DT_MS);
      const wa = callApplyAccelerate(vx, vy, k, DT_MS);
      if (ts.vx !== wa.vx || ts.vy !== wa.vy) mismatches++;
      vx = ts.vx;
      vy = ts.vy;
    }
    expect(mismatches).toBe(0);
    // Sanity: velocity grew
    expect(Math.sqrt(vx * vx + vy * vy)).toBeGreaterThan(100);
  });

  test("rotateVelocityToward: 30-tick homing chase byte-identical", () => {
    let mismatches = 0;
    let px = 100;
    let py = 100;
    let vx = 300;
    let vy = 0;
    const tx = 500;
    const ty = 500;
    const turnRate = 4;
    const dtSec = DT_MS / 1000;
    for (let tick = 0; tick < 30; tick++) {
      const ts = refRotate(vx, vy, px, py, tx, ty, turnRate, dtSec);
      const wa = callRotate(vx, vy, px, py, tx, ty, turnRate, dtSec);
      if (ts.vx !== wa.vx || ts.vy !== wa.vy) mismatches++;
      vx = ts.vx;
      vy = ts.vy;
      // Integrate position so the homing target relationship changes each tick.
      px += vx * dtSec;
      py += vy * dtSec;
    }
    expect(mismatches).toBe(0);
  });

  test("rotateVelocityToward: zero-speed returns input unchanged", () => {
    const wa = callRotate(0, 0, 100, 100, 200, 200, 4, DT_MS / 1000);
    expect(wa.vx).toBe(0);
    expect(wa.vy).toBe(0);
  });

  test("randomised float + accelerate fixtures: 200 each, 0 mismatches", () => {
    let s = 0xfffe_b00b >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let floatMm = 0;
    let accelMm = 0;
    for (let i = 0; i < 200; i++) {
      const vx = range(-500, 500);
      const vy = range(-500, 500);
      const age = range(0, 5000);
      const id = Math.floor(range(1, 100));
      const k = range(-1, 5);

      const tsF = refApplyFloat(vx, vy, age, id, DT_MS);
      const waF = callApplyFloat(vx, vy, age, id, DT_MS);
      if (tsF.vx !== waF.vx || tsF.vy !== waF.vy) floatMm++;

      const tsA = refApplyAccelerate(vx, vy, k, DT_MS);
      const waA = callApplyAccelerate(vx, vy, k, DT_MS);
      if (tsA.vx !== waA.vx || tsA.vy !== waA.vy) accelMm++;
    }
    expect(floatMm).toBe(0);
    expect(accelMm).toBe(0);
  });
});
