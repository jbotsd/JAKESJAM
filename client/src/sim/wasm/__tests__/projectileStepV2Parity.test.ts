// Cross-impl parity for `step_projectile_v2` — full-pathing
// dispatch in a single wasm call. This is the natural completion
// of Phase F1a: every projectile pathing now runs entirely in Zig
// when the v2 step is invoked, with no TS-side switch.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildStaticCache,
  type AABB,
} from "../../collision";
import {
  installLutTables,
  lutSin,
  lutCos,
  lutAtan2,
} from "../../trig";
import type { PlatformDefinition } from "../../types";
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
  step_projectile_v2(
    statePtr: number, dtMs: number,
    staticsPtr: number, staticsCount: number,
    pxsPtr: number, pysPtr: number, paivePtr: number, nPlayers: number,
    ownerIdx: number, outPtr: number,
  ): void;
  sizeof_projectile_kinematics_v2(): number;
  sizeof_projectile_step_result_v2(): number;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
};

const SIZEOF_KIN = ex.sizeof_projectile_kinematics_v2();
const SIZEOF_RES = ex.sizeof_projectile_step_result_v2();
const SIZEOF_AABB = ex.sizeof_aabb();
expect(SIZEOF_KIN).toBe(136);
expect(SIZEOF_RES).toBe(16);

// LUT install.
const tableSize = ex.lut_table_size();
installLutTables(
  new Float64Array(ex.memory.buffer, ex.lut_sin_table_ptr(), tableSize),
  new Float64Array(ex.memory.buffer, ex.lut_atan_table_ptr(), tableSize),
);

// Pathing tags
const Pathing = {
  straight: 0, gravity: 1, float: 2, accelerate: 3,
  boomerang: 4, homing: 5, anti_homing: 6, bounce: 7,
} as const;

// Constants from Zig (must match)
const GRAVITY_DEFAULT = 1450;
const FLOAT_OSC_LATERAL = 22;
const FLOAT_OSC_FORWARD = 11;
const FLOAT_OSC_LATERAL_HZ = 9;
const FLOAT_OSC_FORWARD_HZ = 5;
const BOOMERANG_RANGE_FRACTION = 0.55;
const BOOMERANG_TURN_RATE = 8.4;
const HOMING_TURN_RATE_DEFAULT = 4;

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "wall-r", kind: "wall", position: { x: 1240, y: 480 }, size: { x: 32, y: 320 } },
  { id: "wall-l", kind: "wall", position: { x: 40, y: 480 }, size: { x: 32, y: 320 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const STATICS = cache.aabbs;

// Memory layout
const STATE_OFF = 0;
const RES_OFF = STATE_OFF + SIZEOF_KIN + 8;
const STATICS_OFF = RES_OFF + SIZEOF_RES + 8;
const PLAYERS_OFF = STATICS_OFF + STATICS.length * SIZEOF_AABB + 8;

function packStatics(): void {
  const dv = new DataView(sim.exports.memory.buffer);
  for (let i = 0; i < STATICS.length; i++) {
    const o = sim.statePtr + STATICS_OFF + i * SIZEOF_AABB;
    dv.setFloat64(o + 0, STATICS[i]!.x, true);
    dv.setFloat64(o + 8, STATICS[i]!.y, true);
    dv.setFloat64(o + 16, STATICS[i]!.w, true);
    dv.setFloat64(o + 24, STATICS[i]!.h, true);
  }
}
packStatics();

type State = {
  x: number; y: number; vx: number; vy: number;
  ageMs: number; lifetimeMs: number;
  radius: number;
  gravityScale: number; traveledPx: number;
  originX: number; originY: number;
  rangePx: number;
  accelMul: number;
  homingStrength: number;
  id: number;
  pathing: number;
  returning: number;
  bouncesRemaining: number;
};

function packState(s: State): void {
  const dv = new DataView(sim.exports.memory.buffer);
  const p = sim.statePtr + STATE_OFF;
  dv.setFloat64(p + 0, s.x, true);
  dv.setFloat64(p + 8, s.y, true);
  dv.setFloat64(p + 16, s.vx, true);
  dv.setFloat64(p + 24, s.vy, true);
  dv.setFloat64(p + 32, s.ageMs, true);
  dv.setFloat64(p + 40, s.lifetimeMs, true);
  dv.setFloat64(p + 48, s.radius, true);
  dv.setFloat64(p + 56, s.gravityScale, true);
  dv.setFloat64(p + 64, s.traveledPx, true);
  dv.setFloat64(p + 72, s.originX, true);
  dv.setFloat64(p + 80, s.originY, true);
  dv.setFloat64(p + 88, s.rangePx, true);
  dv.setFloat64(p + 96, s.accelMul, true);
  dv.setFloat64(p + 104, s.homingStrength, true);
  dv.setFloat64(p + 112, s.id, true);
  dv.setInt32(p + 120, s.pathing, true);
  dv.setInt32(p + 124, s.returning, true);
  dv.setInt32(p + 128, s.bouncesRemaining, true);
}

function unpackState(): State {
  const dv = new DataView(sim.exports.memory.buffer);
  const p = sim.statePtr + STATE_OFF;
  return {
    x: dv.getFloat64(p + 0, true),
    y: dv.getFloat64(p + 8, true),
    vx: dv.getFloat64(p + 16, true),
    vy: dv.getFloat64(p + 24, true),
    ageMs: dv.getFloat64(p + 32, true),
    lifetimeMs: dv.getFloat64(p + 40, true),
    radius: dv.getFloat64(p + 48, true),
    gravityScale: dv.getFloat64(p + 56, true),
    traveledPx: dv.getFloat64(p + 64, true),
    originX: dv.getFloat64(p + 72, true),
    originY: dv.getFloat64(p + 80, true),
    rangePx: dv.getFloat64(p + 88, true),
    accelMul: dv.getFloat64(p + 96, true),
    homingStrength: dv.getFloat64(p + 104, true),
    id: dv.getFloat64(p + 112, true),
    pathing: dv.getInt32(p + 120, true),
    returning: dv.getInt32(p + 124, true),
    bouncesRemaining: dv.getInt32(p + 128, true),
  };
}

type Result = { expired: boolean; terrainHitIndex: number; bounced: boolean };
function readResult(): Result {
  const dv = new DataView(sim.exports.memory.buffer);
  const p = sim.statePtr + RES_OFF;
  return {
    expired: dv.getInt32(p + 0, true) === 1,
    terrainHitIndex: dv.getInt32(p + 4, true),
    bounced: dv.getInt32(p + 8, true) === 1,
  };
}

function packPlayers(xs: number[], ys: number[], alive: boolean[]): {
  xsPtr: number; ysPtr: number; alivePtr: number;
} {
  const dv = new DataView(sim.exports.memory.buffer);
  const u8 = new Uint8Array(sim.exports.memory.buffer);
  for (let i = 0; i < xs.length; i++) {
    dv.setFloat64(sim.statePtr + PLAYERS_OFF + i * 8, xs[i]!, true);
    dv.setFloat64(sim.statePtr + PLAYERS_OFF + 256 + i * 8, ys[i]!, true);
    u8[sim.statePtr + PLAYERS_OFF + 512 + i] = alive[i] ? 1 : 0;
  }
  return {
    xsPtr: sim.statePtr + PLAYERS_OFF,
    ysPtr: sim.statePtr + PLAYERS_OFF + 256,
    alivePtr: sim.statePtr + PLAYERS_OFF + 512,
  };
}

function callStepV2(
  s: State, dtMs: number, owner: number,
  playerXs: number[], playerYs: number[], playerAlive: boolean[],
): { state: State; result: Result } {
  packState(s);
  const ptrs = packPlayers(playerXs, playerYs, playerAlive);
  ex.step_projectile_v2(
    sim.statePtr + STATE_OFF,
    dtMs,
    sim.statePtr + STATICS_OFF, STATICS.length,
    ptrs.xsPtr, ptrs.ysPtr, ptrs.alivePtr, playerXs.length,
    owner,
    sim.statePtr + RES_OFF,
  );
  return { state: unpackState(), result: readResult() };
}

// TS reference impl — mirrors Zig stepV2 byte-for-byte.
function refStepV2(
  s: State, dtMs: number, owner: number,
  playerXs: number[], playerYs: number[], playerAlive: boolean[],
): { state: State; result: Result } {
  const dtSec = dtMs / 1000;
  const out: State = { ...s };
  const result: Result = { expired: false, terrainHitIndex: -1, bounced: false };

  const remaining = out.lifetimeMs - dtMs;
  if (remaining <= 0) {
    return { state: out, result: { expired: true, terrainHitIndex: -1, bounced: false } };
  }

  switch (out.pathing) {
    case Pathing.straight:
      break;
    case Pathing.gravity: {
      const g = out.gravityScale > 0 ? out.gravityScale : GRAVITY_DEFAULT;
      out.vy += g * dtSec;
      break;
    }
    case Pathing.float: {
      const nextAgeMs = out.ageMs + dtMs;
      const ageSec = nextAgeMs / 1000;
      out.vy += lutSin(ageSec * FLOAT_OSC_LATERAL_HZ + out.id) * FLOAT_OSC_LATERAL * dtSec;
      out.vx += lutCos(ageSec * FLOAT_OSC_FORWARD_HZ + out.id) * FLOAT_OSC_FORWARD * dtSec;
      break;
    }
    case Pathing.accelerate: {
      const factor = 1 + out.accelMul * dtSec;
      out.vx *= factor;
      out.vy *= factor;
      break;
    }
    case Pathing.boomerang: {
      const shouldReturn = out.returning === 0 && out.rangePx > 0 &&
        out.traveledPx > out.rangePx * BOOMERANG_RANGE_FRACTION;
      if (shouldReturn) out.returning = 1;
      if (out.returning !== 0) {
        const speed = Math.sqrt(out.vx * out.vx + out.vy * out.vy);
        if (speed > 0) {
          const current = lutAtan2(out.vy, out.vx);
          const desired = lutAtan2(out.originY - out.y, out.originX - out.x);
          const turnRate = BOOMERANG_TURN_RATE;
          const maxStep = turnRate * dtSec;
          let diff = desired - current;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          while (diff >= Math.PI) diff -= 2 * Math.PI;
          let next: number;
          if (Math.abs(diff) <= maxStep) next = desired;
          else next = current + (diff > 0 ? 1 : diff < 0 ? -1 : 0) * maxStep;
          out.vx = lutCos(next) * speed;
          out.vy = lutSin(next) * speed;
        }
      }
      break;
    }
    case Pathing.homing:
    case Pathing.anti_homing: {
      let bestIdx = -1;
      let bestSq = Infinity;
      for (let i = 0; i < playerXs.length; i++) {
        if (owner >= 0 && i === owner) continue;
        if (!playerAlive[i]) continue;
        const dx = playerXs[i]! - out.x;
        const dy = playerYs[i]! - out.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestSq) { bestIdx = i; bestSq = d2; }
      }
      if (bestIdx >= 0) {
        let tx = playerXs[bestIdx]!;
        let ty = playerYs[bestIdx]!;
        if (out.pathing === Pathing.anti_homing) {
          tx = out.x * 2 - tx;
          ty = out.y * 2 - ty;
        }
        const turnRate = out.homingStrength > 0 ? out.homingStrength : HOMING_TURN_RATE_DEFAULT;
        const speed = Math.sqrt(out.vx * out.vx + out.vy * out.vy);
        if (speed > 0) {
          const current = lutAtan2(out.vy, out.vx);
          const desired = lutAtan2(ty - out.y, tx - out.x);
          const maxStep = turnRate * dtSec;
          let diff = desired - current;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          while (diff >= Math.PI) diff -= 2 * Math.PI;
          let next: number;
          if (Math.abs(diff) <= maxStep) next = desired;
          else next = current + (diff > 0 ? 1 : diff < 0 ? -1 : 0) * maxStep;
          out.vx = lutCos(next) * speed;
          out.vy = lutSin(next) * speed;
        }
      }
      break;
    }
    case Pathing.bounce:
      break; // handled post-integration
  }

  // Position integration + traveled
  const prevX = out.x;
  const prevY = out.y;
  out.x = prevX + out.vx * dtSec;
  out.y = prevY + out.vy * dtSec;
  const dx = out.x - prevX;
  const dy = out.y - prevY;
  out.traveledPx += Math.sqrt(dx * dx + dy * dy);
  out.ageMs += dtMs;
  out.lifetimeMs = remaining;

  // Terrain
  function circleOverlapsAABB(cx: number, cy: number, r: number, a: AABB): boolean {
    const closestX = Math.max(a.x, Math.min(cx, a.x + a.w));
    const closestY = Math.max(a.y, Math.min(cy, a.y + a.h));
    const ddx = cx - closestX;
    const ddy = cy - closestY;
    return ddx * ddx + ddy * ddy <= r * r;
  }

  if (out.pathing === Pathing.bounce && out.bouncesRemaining > 0) {
    let hit: { idx: number; reflectX: boolean; reflectY: boolean } | null = null;
    for (let i = 0; i < STATICS.length; i++) {
      const a = STATICS[i]!;
      if (!circleOverlapsAABB(out.x, out.y, out.radius, a)) continue;
      const left = a.x - out.radius;
      const right = a.x + a.w + out.radius;
      const top = a.y - out.radius;
      const bottom = a.y + a.h + out.radius;
      let reflectX = false;
      let reflectY = false;
      if (prevX <= left || prevX >= right) reflectX = true;
      else if (prevY <= top || prevY >= bottom) reflectY = true;
      else {
        const dxEdge = Math.min(Math.abs(out.x - left), Math.abs(out.x - right));
        const dyEdge = Math.min(Math.abs(out.y - top), Math.abs(out.y - bottom));
        if (dxEdge < dyEdge) reflectX = true; else reflectY = true;
      }
      hit = { idx: i, reflectX, reflectY };
      break;
    }
    if (hit) {
      let bvx = out.vx;
      let bvy = out.vy;
      if (hit.reflectX) bvx = -out.vx;
      if (hit.reflectY) bvy = -out.vy;
      const lenRaw = Math.sqrt(bvx * bvx + bvy * bvy);
      const len = lenRaw === 0 ? 1 : lenRaw;
      const nudge = Math.max(1, out.radius * 0.5);
      out.vx = bvx;
      out.vy = bvy;
      out.x = prevX + (bvx / len) * nudge;
      out.y = prevY + (bvy / len) * nudge;
      out.bouncesRemaining--;
      result.bounced = true;
      result.terrainHitIndex = hit.idx;
      return { state: out, result };
    }
  }

  // Non-bounce: any terrain overlap = expire
  for (let i = 0; i < STATICS.length; i++) {
    if (circleOverlapsAABB(out.x, out.y, out.radius, STATICS[i]!)) {
      result.expired = true;
      result.terrainHitIndex = i;
      return { state: out, result };
    }
  }

  return { state: out, result };
}

const DT_MS = 1000 / 60;

function freshState(pathing: number, overrides: Partial<State> = {}): State {
  return {
    x: 100, y: 200, vx: 300, vy: -200,
    ageMs: 0, lifetimeMs: 5000, radius: 6,
    gravityScale: 0, traveledPx: 0,
    originX: 100, originY: 200, rangePx: 0,
    accelMul: 0, homingStrength: 0, id: 1,
    pathing, returning: 0, bouncesRemaining: 0,
    ...overrides,
  };
}

describe("step_projectile_v2 parity (TS V8 vs Zig wasm)", () => {
  test("straight: 30-tick byte-identical", () => {
    let ts = freshState(Pathing.straight);
    let wa = freshState(Pathing.straight);
    for (let i = 0; i < 30; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, [], [], []);
      const waR = callStepV2(wa, DT_MS, -1, [], [], []);
      expect(waR.state).toEqual(tsR.state);
      expect(waR.result).toEqual(tsR.result);
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
  });

  test("gravity: 60-tick arc byte-identical", () => {
    let ts = freshState(Pathing.gravity, { gravityScale: 1450 });
    let wa = { ...ts };
    for (let i = 0; i < 60; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, [], [], []);
      const waR = callStepV2(wa, DT_MS, -1, [], [], []);
      expect(waR.state).toEqual(tsR.state);
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
  });

  test("float: 60-tick oscillation byte-identical", () => {
    let ts = freshState(Pathing.float, { id: 7 });
    let wa = { ...ts };
    for (let i = 0; i < 60; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, [], [], []);
      const waR = callStepV2(wa, DT_MS, -1, [], [], []);
      expect(waR.state).toEqual(tsR.state);
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
  });

  test("accelerate: 30-tick velocity scaling byte-identical", () => {
    let ts = freshState(Pathing.accelerate, { accelMul: 1.5 });
    let wa = { ...ts };
    for (let i = 0; i < 30; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, [], [], []);
      const waR = callStepV2(wa, DT_MS, -1, [], [], []);
      expect(waR.state).toEqual(tsR.state);
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
  });

  test("boomerang: returns to origin, byte-identical", () => {
    let ts = freshState(Pathing.boomerang, {
      vx: 400, vy: 0, originX: 100, originY: 200, rangePx: 200,
    });
    let wa = { ...ts };
    let mismatches = 0;
    for (let i = 0; i < 80; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, [], [], []);
      const waR = callStepV2(wa, DT_MS, -1, [], [], []);
      if (
        waR.state.x !== tsR.state.x ||
        waR.state.y !== tsR.state.y ||
        waR.state.vx !== tsR.state.vx ||
        waR.state.vy !== tsR.state.vy ||
        waR.state.returning !== tsR.state.returning ||
        waR.state.traveledPx !== tsR.state.traveledPx
      ) mismatches++;
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
    expect(mismatches).toBe(0);
  });

  test("homing: 30-tick pursuit byte-identical", () => {
    const xs = [600];
    const ys = [400];
    const alive = [true];
    let ts = freshState(Pathing.homing, { vx: 300, vy: 0 });
    let wa = { ...ts };
    let mismatches = 0;
    for (let i = 0; i < 30; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, xs, ys, alive);
      const waR = callStepV2(wa, DT_MS, -1, xs, ys, alive);
      if (
        waR.state.vx !== tsR.state.vx ||
        waR.state.vy !== tsR.state.vy
      ) mismatches++;
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
    expect(mismatches).toBe(0);
  });

  test("anti-homing: rotation away from target byte-identical", () => {
    const xs = [600];
    const ys = [400];
    const alive = [true];
    let ts = freshState(Pathing.anti_homing, { vx: 300, vy: 0 });
    let wa = { ...ts };
    let mismatches = 0;
    for (let i = 0; i < 30; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, xs, ys, alive);
      const waR = callStepV2(wa, DT_MS, -1, xs, ys, alive);
      if (
        waR.state.vx !== tsR.state.vx ||
        waR.state.vy !== tsR.state.vy
      ) mismatches++;
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
    expect(mismatches).toBe(0);
  });

  test("bounce: vertical ricochet off floor byte-identical", () => {
    let ts = freshState(Pathing.bounce, {
      x: 200, y: 580, vx: 0, vy: 800, radius: 6, bouncesRemaining: 3,
    });
    let wa = { ...ts };
    let bounceCount = 0;
    let mismatches = 0;
    for (let i = 0; i < 60; i++) {
      const tsR = refStepV2(ts, DT_MS, -1, [], [], []);
      const waR = callStepV2(wa, DT_MS, -1, [], [], []);
      if (
        waR.state.x !== tsR.state.x ||
        waR.state.y !== tsR.state.y ||
        waR.state.vx !== tsR.state.vx ||
        waR.state.vy !== tsR.state.vy ||
        waR.state.bouncesRemaining !== tsR.state.bouncesRemaining ||
        waR.result.bounced !== tsR.result.bounced
      ) mismatches++;
      if (tsR.result.bounced) bounceCount++;
      if (tsR.result.expired) break;
      ts = tsR.state;
      wa = waR.state;
    }
    expect(mismatches).toBe(0);
  });
});
