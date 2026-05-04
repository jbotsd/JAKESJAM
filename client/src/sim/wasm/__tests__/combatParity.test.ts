// Cross-impl parity for combat math primitives (Phase F1d).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { installLutTables, lutAtan2 } from "../../trig";
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

interface CombatExports {
  combat_wrap_angle(angle: number): number;
  combat_is_hit_in_parry_arc(
    px: number, py: number, facing: number,
    projx: number, projy: number, projvx: number, projvy: number,
  ): number;
  combat_shield_drain(dps: number, dtMs: number): number;
  combat_parry_arc_radians(): number;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & CombatExports;

const tableSize = ex.lut_table_size();
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), tableSize),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), tableSize),
);

const PARRY_ARC_RADIANS = ex.combat_parry_arc_radians();

// TS reference impls — mirror combat.ts exactly.
function refWrapAngle(angle: number): number {
  const TWO_PI = Math.PI * 2;
  let a = angle;
  while (a < -Math.PI) a += TWO_PI;
  while (a >= Math.PI) a -= TWO_PI;
  return a;
}

function refIsHitInParryArc(
  px: number, py: number, facing: number,
  projx: number, projy: number, projvx: number, projvy: number,
): boolean {
  const dx = projx - px;
  const dy = projy - py;
  const sourceAngle = dx === 0 && dy === 0
    ? lutAtan2(-projvy, -projvx)
    : lutAtan2(dy, dx);
  const delta = refWrapAngle(sourceAngle - facing);
  return Math.abs(delta) <= PARRY_ARC_RADIANS / 2;
}

describe("combat parity (TS V8 vs Zig wasm)", () => {
  test("PARRY_ARC_RADIANS = π/3", () => {
    expect(PARRY_ARC_RADIANS).toBe(Math.PI / 3);
  });

  test("wrap_angle matches across many inputs", () => {
    let mismatches = 0;
    for (let i = -20; i <= 20; i++) {
      const angle = i * 0.5;
      const ts = refWrapAngle(angle);
      const wa = ex.combat_wrap_angle(angle);
      if (ts !== wa) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  test("parry-arc check: 8-direction sweep around player matches TS", () => {
    const px = 200;
    const py = 200;
    const facing = 0; // facing right
    let mismatches = 0;
    let inArcCount = 0;
    for (let i = 0; i < 360; i += 5) {
      const angleRad = (i / 180) * Math.PI;
      const projx = px + Math.cos(angleRad) * 50;
      const projy = py + Math.sin(angleRad) * 50;
      const ts = refIsHitInParryArc(px, py, facing, projx, projy, 0, 0);
      const wa = ex.combat_is_hit_in_parry_arc(px, py, facing, projx, projy, 0, 0) === 1;
      if (ts !== wa) mismatches++;
      if (ts) inArcCount++;
    }
    expect(mismatches).toBe(0);
    // Arc is π/3 = 60°. Sweep is 360° at 5° steps = 72 samples.
    // ~12 samples should be in arc (60° / 5°). Allow ±2 for boundary.
    expect(inArcCount).toBeGreaterThanOrEqual(10);
    expect(inArcCount).toBeLessThanOrEqual(14);
  });

  test("degenerate (proj at player position) uses velocity fallback", () => {
    const ts = refIsHitInParryArc(100, 100, 0, 100, 100, -100, 0);
    const wa = ex.combat_is_hit_in_parry_arc(100, 100, 0, 100, 100, -100, 0) === 1;
    expect(wa).toBe(ts);
    // Velocity (-100, 0) → -vy=0, -vx=100 → atan2(0, 100) = 0 → in arc
    expect(wa).toBe(true);
  });

  test("shield drain matches dps × dt", () => {
    const cases: Array<[number, number]> = [
      [35, 16.66],
      [14, 33.33],
      [0, 16.66],
      [100, 5],
    ];
    for (const [dps, dt] of cases) {
      const ts = dps * (dt / 1000);
      expect(ex.combat_shield_drain(dps, dt)).toBe(ts);
    }
  });

  test("randomised parry-arc fixtures: 200 samples, 0 mismatches", () => {
    let s = 0xface_b00b >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      const px = range(0, 1000);
      const py = range(0, 1000);
      const facing = range(-Math.PI, Math.PI);
      const projx = range(px - 100, px + 100);
      const projy = range(py - 100, py + 100);
      const projvx = range(-500, 500);
      const projvy = range(-500, 500);
      const ts = refIsHitInParryArc(px, py, facing, projx, projy, projvx, projvy);
      const wa = ex.combat_is_hit_in_parry_arc(px, py, facing, projx, projy, projvx, projvy) === 1;
      if (ts !== wa) mismatches++;
      if (ts) hits++;
    }
    expect(mismatches).toBe(0);
    expect(hits).toBeGreaterThan(5);
  });
});
