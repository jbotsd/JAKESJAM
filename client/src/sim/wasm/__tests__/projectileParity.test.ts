// Cross-impl parity for the projectile motion kernel — Phase C
// scope: straight + gravity pathing, position integration, lifetime,
// terrain collision. Runs a multi-tick projectile flight through TS
// `stepProjectile` and Zig wasm `step_projectile` and asserts byte-
// identical position/velocity/age/traveled/expired-flag.
//
// Constraints (so TS and wasm impls compare apples-to-apples):
//   - empty players[] (no player collision branch)
//   - impact = "none" (no sticky/explosive/etc.)
//   - splitCount = 0 (no spawn-on-expire)
//   - no homing/boomerang/etc. (those pathings still TS-only).
//
// Other pathings + impacts land in follow-on cuts.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildStaticCache } from "../../collision";
import { stepProjectile } from "../../projectile";
import type {
  EntityId,
  PlatformDefinition,
  PlayerId,
  ProjectileEntity,
  ProjectilePathing,
  Tick,
} from "../../types";
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

interface ProjectileExports {
  step_projectile(
    statePtr: number,
    dtMs: number,
    staticsPtr: number,
    staticsCount: number,
    outPtr: number,
  ): void;
  sizeof_projectile_kinematics(): number;
  sizeof_projectile_step_result(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & ProjectileExports;
const SIZEOF_AABB = ex.sizeof_aabb();
const SIZEOF_KIN = ex.sizeof_projectile_kinematics();
const SIZEOF_RESULT = ex.sizeof_projectile_step_result();
expect(SIZEOF_KIN).toBe(80);
expect(SIZEOF_RESULT).toBe(8);

// Layout matches sim/src/projectile.zig ProjectileKinematics extern struct.
const F = {
  x: 0,
  y: 8,
  vx: 16,
  vy: 24,
  age_ms: 32,
  lifetime_ms: 40,
  radius: 48,
  gravity_scale: 56,
  traveled_px: 64,
  pathing: 72, // u8
  // padding: 73..76 then 76..80 (i32 _pad3)
} as const;

const PATHING_TAG: Record<"straight" | "gravity", number> = {
  straight: 0,
  gravity: 1,
};

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
  { id: "wall-r", kind: "wall", position: { x: 1240, y: 480 }, size: { x: 32, y: 320 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const STATICS = cache.aabbs;

function packStatics(absPtr: number): void {
  const dv = new DataView(sim.exports.memory.buffer);
  for (let i = 0; i < STATICS.length; i++) {
    const off = absPtr + i * SIZEOF_AABB;
    dv.setFloat64(off + 0, STATICS[i]!.x, true);
    dv.setFloat64(off + 8, STATICS[i]!.y, true);
    dv.setFloat64(off + 16, STATICS[i]!.w, true);
    dv.setFloat64(off + 24, STATICS[i]!.h, true);
  }
}
const KIN_OFF = 0;
const RESULT_OFF = SIZEOF_KIN + 8;
const STATICS_OFF = RESULT_OFF + SIZEOF_RESULT + 8;
packStatics(sim.statePtr + STATICS_OFF);
const STATICS_PTR = sim.statePtr + STATICS_OFF;

function packKinematics(p: ProjectileEntity, pathing: number): void {
  const dv = new DataView(sim.exports.memory.buffer);
  const ptr = sim.statePtr + KIN_OFF;
  dv.setFloat64(ptr + F.x, p.x, true);
  dv.setFloat64(ptr + F.y, p.y, true);
  dv.setFloat64(ptr + F.vx, p.vx, true);
  dv.setFloat64(ptr + F.vy, p.vy, true);
  dv.setFloat64(ptr + F.age_ms, p.ageMs ?? 0, true);
  dv.setFloat64(ptr + F.lifetime_ms, p.lifetimeMs, true);
  dv.setFloat64(ptr + F.radius, p.radius, true);
  dv.setFloat64(ptr + F.gravity_scale, p.gravityScale ?? 0, true);
  dv.setFloat64(ptr + F.traveled_px, p.traveledPx ?? 0, true);
  dv.setUint8(ptr + F.pathing, pathing);
}

function unpackKinematics() {
  const dv = new DataView(sim.exports.memory.buffer);
  const ptr = sim.statePtr + KIN_OFF;
  return {
    x: dv.getFloat64(ptr + F.x, true),
    y: dv.getFloat64(ptr + F.y, true),
    vx: dv.getFloat64(ptr + F.vx, true),
    vy: dv.getFloat64(ptr + F.vy, true),
    ageMs: dv.getFloat64(ptr + F.age_ms, true),
    lifetimeMs: dv.getFloat64(ptr + F.lifetime_ms, true),
    radius: dv.getFloat64(ptr + F.radius, true),
    traveledPx: dv.getFloat64(ptr + F.traveled_px, true),
  };
}

function readResult() {
  const dv = new DataView(sim.exports.memory.buffer);
  const ptr = sim.statePtr + RESULT_OFF;
  return {
    expired: dv.getInt32(ptr + 0, true) === 1,
    terrainHitIndex: dv.getInt32(ptr + 4, true),
  };
}

function makeProjectile(
  pathing: ProjectilePathing,
  x: number, y: number,
  vx: number, vy: number,
  lifetimeMs = 5000,
  radius = 6,
): ProjectileEntity {
  return {
    id: 1 as EntityId,
    ownerId: "p0" as PlayerId,
    x, y,
    vx, vy,
    radius,
    lifetimeMs,
    damage: 10,
    pathing,
    impact: "none",
    shape: "circle",
    element: "none",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ageMs: 0,
    traveledPx: 0,
    originX: x,
    originY: y,
    rangePx: 1500,
    splitCount: 0,
  };
}

const DT_MS = 1000 / 60;

describe("projectile parity (TS V8 vs Zig wasm) — straight + gravity", () => {
  test("straight projectile: 30 ticks of horizontal flight, no terrain", () => {
    let tsP: ProjectileEntity | null = makeProjectile("straight", 100, 300, 800, 0);
    packKinematics(tsP, PATHING_TAG.straight);

    for (let tick = 0; tick < 30; tick++) {
      const tsResult = stepProjectile(tsP!, {
        platforms: PLATFORMS,
        players: {},
        dtMs: DT_MS,
        tick: tick as Tick,
        rngState: 1234,
        collisionCache: cache,
      });

      ex.step_projectile(
        sim.statePtr + KIN_OFF,
        DT_MS,
        STATICS_PTR, STATICS.length,
        sim.statePtr + RESULT_OFF,
      );
      const wa = unpackKinematics();
      const waResult = readResult();

      // TS may say expired due to TS-side reasons we don't model;
      // only check kinematics if both agree on "not expired".
      if (tsResult.expired || waResult.expired) {
        expect(waResult.expired).toBe(tsResult.expired);
        break;
      }
      expect(wa.x).toBe(tsResult.projectile!.x);
      expect(wa.y).toBe(tsResult.projectile!.y);
      expect(wa.vx).toBe(tsResult.projectile!.vx);
      expect(wa.vy).toBe(tsResult.projectile!.vy);
      expect(wa.ageMs).toBe(tsResult.projectile!.ageMs ?? 0);
      expect(wa.traveledPx).toBe(tsResult.projectile!.traveledPx ?? 0);

      tsP = tsResult.projectile;
    }
  });

  test("gravity projectile: arc trajectory matches across 60 ticks", () => {
    let tsP: ProjectileEntity | null = makeProjectile(
      "gravity", 100, 200, 400, -300, 5000, 6,
    );
    tsP.gravityScale = 1450;
    packKinematics(tsP, PATHING_TAG.gravity);

    for (let tick = 0; tick < 60; tick++) {
      if (!tsP) break;
      const tsResult = stepProjectile(tsP, {
        platforms: PLATFORMS,
        players: {},
        dtMs: DT_MS,
        tick: tick as Tick,
        rngState: 1234,
        collisionCache: cache,
      });

      ex.step_projectile(
        sim.statePtr + KIN_OFF,
        DT_MS,
        STATICS_PTR, STATICS.length,
        sim.statePtr + RESULT_OFF,
      );
      const wa = unpackKinematics();
      const waResult = readResult();

      if (tsResult.expired || waResult.expired) {
        expect(waResult.expired).toBe(tsResult.expired);
        break;
      }
      expect(wa.x).toBe(tsResult.projectile!.x);
      expect(wa.y).toBe(tsResult.projectile!.y);
      expect(wa.vx).toBe(tsResult.projectile!.vx);
      expect(wa.vy).toBe(tsResult.projectile!.vy);

      tsP = tsResult.projectile;
    }
  });

  test("terrain hit fires expired flag identically", () => {
    // Project a horizontal shot directly into the right wall.
    let tsP: ProjectileEntity | null = makeProjectile("straight", 1100, 540, 1500, 0);
    packKinematics(tsP, PATHING_TAG.straight);

    let tsExpired = false;
    let waExpired = false;
    for (let tick = 0; tick < 60 && !tsExpired && !waExpired; tick++) {
      const tsResult = stepProjectile(tsP!, {
        platforms: PLATFORMS,
        players: {},
        dtMs: DT_MS,
        tick: tick as Tick,
        rngState: 1234,
        collisionCache: cache,
      });
      tsExpired = tsResult.expired;

      ex.step_projectile(
        sim.statePtr + KIN_OFF,
        DT_MS,
        STATICS_PTR, STATICS.length,
        sim.statePtr + RESULT_OFF,
      );
      waExpired = readResult().expired;

      tsP = tsResult.projectile;
    }
    expect(tsExpired).toBe(true);
    expect(waExpired).toBe(true);
  });
});
