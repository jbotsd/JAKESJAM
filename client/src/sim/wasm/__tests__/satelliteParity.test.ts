// Cross-impl parity for the satellite tick kernel (Phase F1c).
// Drives multi-tick orbit + cooldown + fire-decision math through
// TS reference impl AND Zig wasm and asserts byte-identical state
// every tick. The trig the wasm side uses comes from the comptime
// LUT in trig.zig; the TS reference side uses lutCos/lutSin/lutAtan2
// from `@sim/trig.ts` which reads the IDENTICAL bytes from wasm
// memory at boot — so parity is correct by construction.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { lutAtan2, lutCos, lutSin, installLutTables } from "../../trig";
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

interface SatExports {
  satellite_tick(inPtr: number, outPtr: number): void;
  sizeof_satellite_tick_input(): number;
  sizeof_satellite_tick_output(): number;
  satellite_orbit_rad_per_sec(): number;
  satellite_fire_cooldown_ms(): number;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & SatExports;
const SIZEOF_INPUT = ex.sizeof_satellite_tick_input();
const SIZEOF_OUTPUT = ex.sizeof_satellite_tick_output();
expect(SIZEOF_INPUT).toBe(80);
expect(SIZEOF_OUTPUT).toBe(56);

// Prime the TS-side LUT cache from wasm memory so lutCos/Sin/Atan2
// sample the same bytes the Zig kernel uses.
const tableSize = ex.lut_table_size();
const sinView = new Float64Array(
  ex.memory.buffer,
  ex.lut_sin_table_ptr(),
  tableSize,
);
const atanView = new Float64Array(
  ex.memory.buffer,
  ex.lut_atan_table_ptr(),
  tableSize,
);
installLutTables(sinView, atanView);

const ORBIT_RAD_PER_SEC = ex.satellite_orbit_rad_per_sec();
const FIRE_COOLDOWN_MS = ex.satellite_fire_cooldown_ms();

const IN_OFF = 0;
const OUT_OFF = SIZEOF_INPUT + 8;

type TickInput = {
  angle: number;
  orbitRadius: number;
  fireCooldownMs: number;
  lifetimeMs: number;
  ownerX: number;
  ownerY: number;
  targetX: number;
  targetY: number;
  hasTarget: boolean;
  canFire: boolean;
  dtMs: number;
};

type TickOutput = {
  newAngle: number;
  newFireCooldownMs: number;
  newLifetimeMs: number;
  fireX: number;
  fireY: number;
  fireAimAngle: number;
  expired: boolean;
  wantsFire: boolean;
};

function packInput(absPtr: number, i: TickInput): void {
  const dv = new DataView(sim.exports.memory.buffer);
  dv.setFloat64(absPtr + 0, i.angle, true);
  dv.setFloat64(absPtr + 8, i.orbitRadius, true);
  dv.setFloat64(absPtr + 16, i.fireCooldownMs, true);
  dv.setFloat64(absPtr + 24, i.lifetimeMs, true);
  dv.setFloat64(absPtr + 32, i.ownerX, true);
  dv.setFloat64(absPtr + 40, i.ownerY, true);
  dv.setFloat64(absPtr + 48, i.targetX, true);
  dv.setFloat64(absPtr + 56, i.targetY, true);
  dv.setInt32(absPtr + 64, i.hasTarget ? 1 : 0, true);
  dv.setInt32(absPtr + 68, i.canFire ? 1 : 0, true);
  dv.setFloat64(absPtr + 72, i.dtMs, true);
}

function readOutput(absPtr: number): TickOutput {
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    newAngle: dv.getFloat64(absPtr + 0, true),
    newFireCooldownMs: dv.getFloat64(absPtr + 8, true),
    newLifetimeMs: dv.getFloat64(absPtr + 16, true),
    fireX: dv.getFloat64(absPtr + 24, true),
    fireY: dv.getFloat64(absPtr + 32, true),
    fireAimAngle: dv.getFloat64(absPtr + 40, true),
    expired: dv.getInt32(absPtr + 48, true) === 1,
    wantsFire: dv.getInt32(absPtr + 52, true) === 1,
  };
}

// TS reference impl — mirrors the Zig kernel exactly.
function tickRef(i: TickInput): TickOutput {
  const out: TickOutput = {
    newAngle: i.angle,
    newFireCooldownMs: i.fireCooldownMs,
    newLifetimeMs: i.lifetimeMs,
    fireX: 0,
    fireY: 0,
    fireAimAngle: 0,
    expired: false,
    wantsFire: false,
  };
  const remaining = i.lifetimeMs - i.dtMs;
  if (remaining <= 0) {
    out.expired = true;
    return out;
  }
  out.newLifetimeMs = remaining;
  const dtSec = i.dtMs / 1000;
  out.newAngle = i.angle + ORBIT_RAD_PER_SEC * dtSec;
  const cooldown = i.fireCooldownMs - i.dtMs;
  out.newFireCooldownMs = cooldown < 0 ? 0 : cooldown;
  if (out.newFireCooldownMs <= 0 && i.canFire && i.hasTarget) {
    const sx = i.ownerX + lutCos(out.newAngle) * i.orbitRadius;
    const sy = i.ownerY + lutSin(out.newAngle) * i.orbitRadius;
    out.fireX = sx;
    out.fireY = sy;
    out.fireAimAngle = lutAtan2(i.targetY - sy, i.targetX - sx);
    out.newFireCooldownMs = FIRE_COOLDOWN_MS;
    out.wantsFire = true;
  }
  return out;
}

function callWasm(i: TickInput): TickOutput {
  packInput(sim.statePtr + IN_OFF, i);
  ex.satellite_tick(sim.statePtr + IN_OFF, sim.statePtr + OUT_OFF);
  return readOutput(sim.statePtr + OUT_OFF);
}

const DT_MS = 1000 / 60;

describe("satellite parity (TS V8 vs Zig wasm)", () => {
  test("sizes + constants match", () => {
    expect(ORBIT_RAD_PER_SEC).toBe(Math.PI / 1.5);
    expect(FIRE_COOLDOWN_MS).toBe(600);
  });

  test("lifetime expiry: 1500ms patch dies in ~90 ticks", () => {
    let lifetime = 1500;
    let ticks = 0;
    while (lifetime > 0 && ticks < 200) {
      const i: TickInput = {
        angle: 0,
        orbitRadius: 80,
        fireCooldownMs: 0,
        lifetimeMs: lifetime,
        ownerX: 100,
        ownerY: 100,
        targetX: 200,
        targetY: 100,
        hasTarget: false,
        canFire: false,
        dtMs: DT_MS,
      };
      const ts = tickRef(i);
      const wa = callWasm(i);
      expect(wa.expired).toBe(ts.expired);
      expect(wa.newLifetimeMs).toBe(ts.newLifetimeMs);
      lifetime = ts.expired ? 0 : ts.newLifetimeMs;
      ticks++;
    }
    expect(ticks).toBeGreaterThan(85);
    expect(ticks).toBeLessThan(95);
  });

  test("60-tick orbit advance + fire decisions match byte-identically", () => {
    let angle = 0;
    let fireCooldown = 0;
    let lifetime = 5000;
    const ownerX = 640;
    const ownerY = 360;

    let tsAngle = angle;
    let waAngle = angle;
    let tsCooldown = fireCooldown;
    let waCooldown = fireCooldown;
    let tsLifetime = lifetime;
    let waLifetime = lifetime;

    let totalFires = 0;
    for (let tick = 0; tick < 60; tick++) {
      // Target drifts horizontally so atan2 changes each tick.
      const targetX = 100 + tick * 8;
      const targetY = 360;

      const tsIn: TickInput = {
        angle: tsAngle,
        orbitRadius: 80,
        fireCooldownMs: tsCooldown,
        lifetimeMs: tsLifetime,
        ownerX,
        ownerY,
        targetX,
        targetY,
        hasTarget: true,
        canFire: true,
        dtMs: DT_MS,
      };
      const waIn = { ...tsIn, angle: waAngle, fireCooldownMs: waCooldown, lifetimeMs: waLifetime };

      const ts = tickRef(tsIn);
      const wa = callWasm(waIn);

      if (
        wa.newAngle !== ts.newAngle ||
        wa.newFireCooldownMs !== ts.newFireCooldownMs ||
        wa.newLifetimeMs !== ts.newLifetimeMs ||
        wa.fireX !== ts.fireX ||
        wa.fireY !== ts.fireY ||
        wa.fireAimAngle !== ts.fireAimAngle ||
        wa.wantsFire !== ts.wantsFire ||
        wa.expired !== ts.expired
      ) {
        throw new Error(
          `tick ${tick} divergence:\n  ts: ${JSON.stringify(ts)}\n  wa: ${JSON.stringify(wa)}`,
        );
      }

      if (ts.wantsFire) totalFires++;
      tsAngle = ts.newAngle;
      waAngle = wa.newAngle;
      tsCooldown = ts.newFireCooldownMs;
      waCooldown = wa.newFireCooldownMs;
      tsLifetime = ts.newLifetimeMs;
      waLifetime = wa.newLifetimeMs;
    }

    // 60 ticks @ DT_MS = 1000ms, fire cooldown 600ms — expect ~1-2 fires
    expect(totalFires).toBeGreaterThan(0);
  });

  test("randomised inputs across 200 fixtures byte-identical", () => {
    let s = 0xc0de_face >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    for (let i = 0; i < 200; i++) {
      const input: TickInput = {
        angle: range(-10, 10),
        orbitRadius: range(20, 200),
        fireCooldownMs: range(0, 1000),
        lifetimeMs: range(100, 10_000),
        ownerX: range(0, 1280),
        ownerY: range(0, 720),
        targetX: range(0, 1280),
        targetY: range(0, 720),
        hasTarget: r01() > 0.3,
        canFire: r01() > 0.2,
        dtMs: DT_MS,
      };
      const ts = tickRef(input);
      const wa = callWasm(input);
      if (
        wa.newAngle !== ts.newAngle ||
        wa.newFireCooldownMs !== ts.newFireCooldownMs ||
        wa.fireX !== ts.fireX ||
        wa.fireY !== ts.fireY ||
        wa.fireAimAngle !== ts.fireAimAngle ||
        wa.wantsFire !== ts.wantsFire
      ) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });
});
