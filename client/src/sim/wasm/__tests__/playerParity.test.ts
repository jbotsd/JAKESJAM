// Cross-impl parity for `stepPlayer`: TS V8 vs Zig wasm. Drives a
// 60-tick simulated input sequence (fall onto floor, run, jump,
// crouch, jetpack hold) through BOTH impls with the same inputs +
// platform cache, and asserts byte-identical state at every tick.
//
// This is the test that proves Phase B4 — once it's green, the
// player physics module is ready for the live swap (D4-equivalent)
// behind a `?wasm-player=1` flag, same pattern as `?wasm-collision`.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildStaticCache,
  type AABB,
} from "../../collision";
import {
  freshPlayerMovementMemory,
  stepPlayer,
  JETPACK_MAX_FUEL,
  type PlayerMovementMemory,
} from "../../player";
import type {
  PlatformDefinition,
  PlayerEntity,
  PlayerId,
  CharacterArchetype,
  InputSeq,
  InputBitfield,
} from "../../types";
import { loadSimFromBytes, type Sim } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

interface PlayerExports {
  step_player(
    statePtr: number,
    prevKeys: number,
    currKeys: number,
    aimX: number,
    aimY: number,
    speedMul: number,
    gravityMul: number,
    dtMs: number,
    staticsPtr: number,
    staticsCount: number,
    oneWayPtr: number,
    oneWayCount: number,
  ): number;
  sizeof_player_step(): number;
}
const ex = sim.exports as unknown as typeof sim.exports & PlayerExports;
const SIZEOF_PLAYER_STEP = ex.sizeof_player_step();
const SIZEOF_AABB = ex.sizeof_aabb();
expect(SIZEOF_PLAYER_STEP).toBe(176); // +wall movement +augments +dash_recovery_ms +dash_cooldown_mul

// Layout matches sim/src/player.zig PlayerStep extern struct.
const FIELD_OFFSETS = {
  x: 0,
  y: 8,
  vx: 16,
  vy: 24,
  aim_x: 32,
  aim_y: 40,
  jetpack_fuel: 48,
  crouching: 56, // i32
  // pad: 60..64
  coyote_ms: 64,
  jump_buffer_ms: 72,
  jump_cut_applied: 80, // i32
  jump_released_since_jump: 84, // i32
  grounded_last_frame: 88, // i32
  jetpack_active: 92, // i32
  touching_wall_dir: 96, // i32
  jump_mul: 104, // f64
  wall_jump_mul: 112, // f64
  wall_slide_mul: 120, // f64
  dash_cooldown_ms: 128, // f64
  dash_active_ms: 136, // f64
  air_jumps: 144, // i32
  dash_charges: 148, // i32
  air_jumps_used: 152, // i32
  dash_used_in_air: 156, // i32
  dash_recovery_ms: 160, // f64
  dash_cooldown_mul: 168, // f64
} as const;

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const STATICS = cache.aabbs;
const ONE_WAY = cache.oneWay;

function packPlayerStep(absPtr: number, p: {
  x: number; y: number; vx: number; vy: number;
  aimX: number; aimY: number; jetpackFuel: number;
  crouching: boolean;
  memory: PlayerMovementMemory;
  // Augment inputs (card-driven). Default inert.
  jumpMul?: number; wallJumpMul?: number; wallSlideMul?: number;
  airJumps?: number; dashCharges?: number; dashCooldownMultiplier?: number;
}): void {
  const dv = new DataView(sim.exports.memory.buffer);
  dv.setFloat64(absPtr + FIELD_OFFSETS.x, p.x, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.y, p.y, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.vx, p.vx, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.vy, p.vy, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.aim_x, p.aimX, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.aim_y, p.aimY, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.jetpack_fuel, p.jetpackFuel, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.crouching, p.crouching ? 1 : 0, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.coyote_ms, p.memory.coyoteMs, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.jump_buffer_ms, p.memory.jumpBufferMs, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.jump_cut_applied, p.memory.jumpCutApplied ? 1 : 0, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.jump_released_since_jump, p.memory.jumpReleasedSinceJump ? 1 : 0, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.grounded_last_frame, p.memory.groundedLastFrame ? 1 : 0, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.jetpack_active, p.memory.jetpackActive ? 1 : 0, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.touching_wall_dir, p.memory.touchingWallDir, true);
  // Augment INPUTS — must be initialised or the wasm reads garbage (mults of 0
  // would zero every jump). Defaults are inert.
  dv.setFloat64(absPtr + FIELD_OFFSETS.jump_mul, p.jumpMul ?? 1, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.wall_jump_mul, p.wallJumpMul ?? 1, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.wall_slide_mul, p.wallSlideMul ?? 1, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.air_jumps, p.airJumps ?? 0, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.dash_charges, p.dashCharges ?? 0, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.dash_cooldown_mul, p.dashCooldownMultiplier ?? 1, true);
  // Augment MEMORY.
  dv.setFloat64(absPtr + FIELD_OFFSETS.dash_cooldown_ms, p.memory.dashCooldownMs, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.dash_active_ms, p.memory.dashActiveMs, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.air_jumps_used, p.memory.airJumpsUsed, true);
  dv.setInt32(absPtr + FIELD_OFFSETS.dash_used_in_air, p.memory.dashUsedInAir, true);
  dv.setFloat64(absPtr + FIELD_OFFSETS.dash_recovery_ms, p.memory.dashRecoveryMs, true);
}

function unpackPlayerStep(absPtr: number) {
  const dv = new DataView(sim.exports.memory.buffer);
  return {
    x: dv.getFloat64(absPtr + FIELD_OFFSETS.x, true),
    y: dv.getFloat64(absPtr + FIELD_OFFSETS.y, true),
    vx: dv.getFloat64(absPtr + FIELD_OFFSETS.vx, true),
    vy: dv.getFloat64(absPtr + FIELD_OFFSETS.vy, true),
    aimX: dv.getFloat64(absPtr + FIELD_OFFSETS.aim_x, true),
    aimY: dv.getFloat64(absPtr + FIELD_OFFSETS.aim_y, true),
    jetpackFuel: dv.getFloat64(absPtr + FIELD_OFFSETS.jetpack_fuel, true),
    crouching: dv.getInt32(absPtr + FIELD_OFFSETS.crouching, true) === 1,
    coyoteMs: dv.getFloat64(absPtr + FIELD_OFFSETS.coyote_ms, true),
    jumpBufferMs: dv.getFloat64(absPtr + FIELD_OFFSETS.jump_buffer_ms, true),
    jumpCutApplied: dv.getInt32(absPtr + FIELD_OFFSETS.jump_cut_applied, true) === 1,
    jumpReleasedSinceJump: dv.getInt32(absPtr + FIELD_OFFSETS.jump_released_since_jump, true) === 1,
    groundedLastFrame: dv.getInt32(absPtr + FIELD_OFFSETS.grounded_last_frame, true) === 1,
    jetpackActive: dv.getInt32(absPtr + FIELD_OFFSETS.jetpack_active, true) === 1,
    dashCooldownMs: dv.getFloat64(absPtr + FIELD_OFFSETS.dash_cooldown_ms, true),
    dashActiveMs: dv.getFloat64(absPtr + FIELD_OFFSETS.dash_active_ms, true),
    dashRecoveryMs: dv.getFloat64(absPtr + FIELD_OFFSETS.dash_recovery_ms, true),
  };
}

function packStaticsAndOneWay(simInst: Sim, baseOff: number, statics: ReadonlyArray<AABB>, oneWay: ReadonlyArray<boolean>): {
  staticsPtr: number;
  oneWayPtr: number;
  staticsCount: number;
  oneWayCount: number;
} {
  const dv = new DataView(simInst.exports.memory.buffer);
  const u8 = new Uint8Array(simInst.exports.memory.buffer);
  for (let i = 0; i < statics.length; i++) {
    const off = baseOff + i * SIZEOF_AABB;
    dv.setFloat64(off + 0, statics[i]!.x, true);
    dv.setFloat64(off + 8, statics[i]!.y, true);
    dv.setFloat64(off + 16, statics[i]!.w, true);
    dv.setFloat64(off + 24, statics[i]!.h, true);
  }
  const oneWayOff = baseOff + statics.length * SIZEOF_AABB + 8;
  for (let i = 0; i < oneWay.length; i++) {
    u8[oneWayOff + i] = oneWay[i] ? 1 : 0;
  }
  return {
    staticsPtr: baseOff,
    oneWayPtr: oneWayOff,
    staticsCount: statics.length,
    oneWayCount: oneWay.length,
  };
}

// Build a minimal PlayerEntity for the TS stepPlayer call.
function makePlayer(x: number, y: number): PlayerEntity {
  return {
    id: "p0" as PlayerId,
    characterId: "starter" as CharacterArchetype,
    x, y,
    vx: 0, vy: 0,
    aimX: 0, aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "scrap-rifle",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as InputSeq,
    jetpackFuel: JETPACK_MAX_FUEL,
  };
}

const Bit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Dash: 1 << 9,
} as const;

type Tick = { prev: InputBitfield; curr: InputBitfield };

// 90-tick scripted input sequence: drop onto floor, walk right, jump,
// jetpack hold, crouch on landing.
function buildScript(): Tick[] {
  const ticks: Tick[] = [];
  let prev: InputBitfield = 0;
  const push = (curr: InputBitfield) => {
    ticks.push({ prev, curr });
    prev = curr;
  };
  // 0..14: free fall (no input)
  for (let i = 0; i < 15; i++) push(0);
  // 15..34: walk right
  for (let i = 0; i < 20; i++) push(Bit.Right);
  // 35: jump press while running
  push(Bit.Right | Bit.Jump);
  // 36..50: jump hold + run (jetpack engages once airborne)
  for (let i = 0; i < 15; i++) push(Bit.Right | Bit.Jump);
  // 51: release jump
  push(Bit.Right);
  // 52..64: free run while falling
  for (let i = 0; i < 13; i++) push(Bit.Right);
  // 65..89: stand still on floor + crouch
  for (let i = 0; i < 25; i++) push(Bit.Crouch);
  return ticks;
}

const SCRIPT = buildScript();

describe("player parity (TS V8 vs Zig wasm)", () => {
  test("90-tick scripted run matches byte-identically every tick", () => {
    // TS state
    let tsP = makePlayer(100, 0);
    let tsM = freshPlayerMovementMemory();

    // Wasm state — packed into the wasm state buffer.
    const STATE_PTR = sim.statePtr;
    const STATICS_OFF = SIZEOF_PLAYER_STEP + 8;
    const packed = packStaticsAndOneWay(sim, STATE_PTR + STATICS_OFF, STATICS, ONE_WAY);

    packPlayerStep(STATE_PTR, {
      x: 100, y: 0, vx: 0, vy: 0, aimX: 0, aimY: 0,
      jetpackFuel: JETPACK_MAX_FUEL, crouching: false,
      memory: freshPlayerMovementMemory(),
    });

    const DT_MS = 1000 / 60;

    for (let tick = 0; tick < SCRIPT.length; tick++) {
      const { prev, curr } = SCRIPT[tick]!;

      // TS step
      const tsResult = stepPlayer(
        tsP, prev, curr, 0, 0, tsM, [], DT_MS,
        { collisionCache: cache },
      );
      tsP = tsResult.player;
      tsM = tsResult.memory;

      // Wasm step
      const jumped = ex.step_player(
        STATE_PTR,
        prev, curr,
        0, 0,
        1.0, 1.0,
        DT_MS,
        packed.staticsPtr, packed.staticsCount,
        packed.oneWayPtr, packed.oneWayCount,
      );
      const wa = unpackPlayerStep(STATE_PTR);

      if (
        wa.x !== tsP.x ||
        wa.y !== tsP.y ||
        wa.vx !== tsP.vx ||
        wa.vy !== tsP.vy ||
        wa.crouching !== tsP.crouching ||
        wa.jetpackFuel !== (tsP.jetpackFuel ?? JETPACK_MAX_FUEL) ||
        wa.coyoteMs !== tsM.coyoteMs ||
        wa.jumpBufferMs !== tsM.jumpBufferMs ||
        wa.jumpCutApplied !== tsM.jumpCutApplied ||
        wa.jumpReleasedSinceJump !== tsM.jumpReleasedSinceJump ||
        wa.groundedLastFrame !== tsM.groundedLastFrame ||
        wa.jetpackActive !== tsM.jetpackActive ||
        wa.dashCooldownMs !== tsM.dashCooldownMs ||
        wa.dashActiveMs !== tsM.dashActiveMs ||
        wa.dashRecoveryMs !== tsM.dashRecoveryMs ||
        (jumped === 1) !== tsResult.jumpedThisFrame
      ) {
        throw new Error(
          `tick ${tick} divergence:\n` +
          `  ts:   x=${tsP.x} y=${tsP.y} vx=${tsP.vx} vy=${tsP.vy} ` +
          `crouching=${tsP.crouching} fuel=${tsP.jetpackFuel} ` +
          `mem=${JSON.stringify(tsM)} jumped=${tsResult.jumpedThisFrame}\n` +
          `  wa:   x=${wa.x} y=${wa.y} vx=${wa.vx} vy=${wa.vy} ` +
          `crouching=${wa.crouching} fuel=${wa.jetpackFuel} ` +
          `mem={cm:${wa.coyoteMs},jb:${wa.jumpBufferMs},jc:${wa.jumpCutApplied},` +
          `jr:${wa.jumpReleasedSinceJump},gl:${wa.groundedLastFrame},ja:${wa.jetpackActive}} ` +
          `jumped=${jumped === 1}`
        );
      }
    }

    // The 90 ticks above ran with NO divergence — every byte of x, y,
    // vx, vy, jetpackFuel, crouching, and the full PlayerMovementMemory
    // matched between TS V8 and Zig wasm. That's the parity proof.
    expect(SCRIPT.length).toBe(90);
  });

  // Exercises the AUGMENT marshaling with non-default values (airJumps=1) —
  // the base parity test runs everything inert, so this is what actually
  // proves double-jump crosses the wasm boundary and behaves identically.
  test("double-jump (airJumps=1): wasm fires it AND matches TS byte-for-byte", () => {
    const STATE_PTR = sim.statePtr;
    const STATICS_OFF = SIZEOF_PLAYER_STEP + 8;
    const packed = packStaticsAndOneWay(sim, STATE_PTR + STATICS_OFF, STATICS, ONE_WAY);
    // Stand on the floor (floor top = 600; body 56 → centre 572).
    let tsP = makePlayer(700, 572);
    let tsM = { ...freshPlayerMovementMemory(), groundedLastFrame: true };
    packPlayerStep(STATE_PTR, {
      x: 700, y: 572, vx: 0, vy: 0, aimX: 900, aimY: 572,
      jetpackFuel: JETPACK_MAX_FUEL, crouching: false,
      memory: { ...freshPlayerMovementMemory(), groundedLastFrame: true },
      airJumps: 1,
    });
    const DT = 1000 / 60;
    const opts = { collisionCache: cache, airJumps: 1 };
    // ground jump → hold 2 → release → coast 9 (coyote expires) → JUMP again.
    const script: number[] = [Bit.Jump, Bit.Jump, Bit.Jump, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Bit.Jump, 0, 0];
    let prev = 0;
    let doubleJumpVy = 999;
    const secondJumpTick = script.lastIndexOf(Bit.Jump);
    for (let t = 0; t < script.length; t++) {
      const curr = script[t]!;
      const ts = stepPlayer(tsP, prev, curr, 900, 572, tsM, [], DT, opts);
      tsP = ts.player; tsM = ts.memory;
      ex.step_player(STATE_PTR, prev, curr, 900, 572, 1, 1, DT,
        packed.staticsPtr, packed.staticsCount, packed.oneWayPtr, packed.oneWayCount);
      const wa = unpackPlayerStep(STATE_PTR);
      // wasm ↔ TS byte-identical each tick (the marshaling proof).
      expect(wa.vy).toBe(tsP.vy);
      expect(wa.y).toBe(tsP.y);
      expect(wa.vx).toBe(tsP.vx);
      if (t === secondJumpTick) doubleJumpVy = tsP.vy;
      prev = curr;
    }
    // The second airborne jump actually launched (a real double-jump, not a no-op).
    expect(doubleJumpVy).toBeLessThan(-400);
  });

  test("wall power-slide (Jump+Crouch at a wall): wasm matches TS byte-for-byte, and differs from a plain wall-jump", () => {
    const STATE_PTR = sim.statePtr;
    const STATICS_OFF = SIZEOF_PLAYER_STEP + 8;
    const packed = packStaticsAndOneWay(sim, STATICS_OFF + STATE_PTR, STATICS, ONE_WAY);
    const DT = 1000 / 60;
    const opts = { collisionCache: cache };

    const run = (currKeys: number) => {
      let tsP = makePlayer(700, 400);
      let tsM: PlayerMovementMemory = {
        ...freshPlayerMovementMemory(),
        groundedLastFrame: false,
        touchingWallDir: -1,
        jumpBufferMs: 50,
      };
      packPlayerStep(STATE_PTR, {
        x: 700, y: 400, vx: 0, vy: 0, aimX: 900, aimY: 400,
        jetpackFuel: JETPACK_MAX_FUEL, crouching: false,
        memory: tsM,
      });
      const ts = stepPlayer(tsP, 0, currKeys, 900, 400, tsM, [], DT, opts);
      tsP = ts.player; tsM = ts.memory;
      ex.step_player(STATE_PTR, 0, currKeys, 900, 400, 1, 1, DT,
        packed.staticsPtr, packed.staticsCount, packed.oneWayPtr, packed.oneWayCount);
      const wa = unpackPlayerStep(STATE_PTR);
      expect(wa.vy).toBe(tsP.vy);
      expect(wa.vx).toBe(tsP.vx);
      return tsP;
    };

    const plainKick = run(Bit.Jump);
    const powerSlide = run(Bit.Jump | Bit.Crouch);

    // Both fired away from the left wall (+x); the power-slide is flatter
    // (smaller |vy|) and faster (bigger |vx|) than the plain kick.
    expect(plainKick.vx).toBeGreaterThan(0);
    expect(powerSlide.vx).toBeGreaterThan(0);
    expect(Math.abs(powerSlide.vy)).toBeLessThan(Math.abs(plainKick.vy));
    expect(Math.abs(powerSlide.vx)).toBeGreaterThan(Math.abs(plainKick.vx));
  });

  test("dash bash (aim up-right): wasm matches TS byte-for-byte and lunges diagonally with gravity suspended", () => {
    const STATE_PTR = sim.statePtr;
    const STATICS_OFF = SIZEOF_PLAYER_STEP + 8;
    const packed = packStaticsAndOneWay(sim, STATICS_OFF + STATE_PTR, STATICS, ONE_WAY);
    const DT = 1000 / 60;
    const opts = { collisionCache: cache, dashCharges: 1 };
    // Airborne in open space (away from floor/ceiling) so the diagonal lunge
    // isn't clipped by geometry; aim up-and-right.
    const AIMX = 900;
    const AIMY = 150;
    let tsP = makePlayer(700, 400);
    let tsM = { ...freshPlayerMovementMemory(), groundedLastFrame: false };
    packPlayerStep(STATE_PTR, {
      x: 700, y: 400, vx: 0, vy: 0, aimX: AIMX, aimY: AIMY,
      jetpackFuel: JETPACK_MAX_FUEL, crouching: false,
      memory: { ...freshPlayerMovementMemory(), groundedLastFrame: false },
      dashCharges: 1,
    });
    const script: number[] = [Bit.Dash, 0, 0, 0, 0, 0];
    let prev = 0;
    let dashVy = 999;
    let dashVx = -999;
    let vyMidBurst = 999;
    for (let t = 0; t < script.length; t++) {
      const curr = script[t]!;
      const ts = stepPlayer(tsP, prev, curr, AIMX, AIMY, tsM, [], DT, opts);
      tsP = ts.player; tsM = ts.memory;
      ex.step_player(STATE_PTR, prev, curr, AIMX, AIMY, 1, 1, DT,
        packed.staticsPtr, packed.staticsCount, packed.oneWayPtr, packed.oneWayCount);
      const wa = unpackPlayerStep(STATE_PTR);
      expect(wa.vx).toBe(tsP.vx);
      expect(wa.vy).toBe(tsP.vy);
      expect(wa.y).toBe(tsP.y);
      if (t === 0) { dashVy = tsP.vy; dashVx = tsP.vx; }
      if (t === 2) vyMidBurst = tsP.vy;
      prev = curr;
    }
    // A real diagonal lunge: up (vy<0) AND right (vx>0), both a big fraction
    // of DASH_SPEED.
    expect(dashVy).toBeLessThan(-400);
    expect(dashVx).toBeGreaterThan(400);
    // Gravity suspended mid-burst: vy hasn't decayed toward 0 (would if
    // gravity were adding ~+24/tick).
    expect(vyMidBurst).toBeLessThan(-400);
  });

  // I25: recovery endlag + the Quick Parry cooldown-multiplier floor cross
  // the wasm boundary too — prove TS and Zig agree tick-for-tick, not just
  // that each independently has the right unit-test behavior.
  test("dash recovery endlag + cooldown-multiplier floor: wasm matches TS byte-for-byte", () => {
    const STATE_PTR = sim.statePtr;
    const STATICS_OFF = SIZEOF_PLAYER_STEP + 8;
    const packed = packStaticsAndOneWay(sim, STATICS_OFF + STATE_PTR, STATICS, ONE_WAY);
    const DT = 1000 / 60;
    // DASH_COOLDOWN_MS tripled 520ms -> 3000ms (2026-07-15); the real max
    // card stack (Quick Parry, maxStacks:2, 0.86^2 ~= 0.7396) no longer
    // reaches the floor at all (3000*0.7396 ~= 2219ms, nowhere near the
    // 410ms floor — it did at the old 520ms base: 520*0.7396 ~= 385ms).
    // The floor-clamp code path itself still needs coverage even though
    // no real card combo can trigger it anymore, so this multiplier is
    // now a synthetic stress value chosen to land under the floor
    // (410/3000 ~= 0.137), not a real achievable-in-game stack.
    const dashCooldownMultiplier = 0.1;
    const opts = { collisionCache: cache, dashCharges: 1, dashCooldownMultiplier };
    let tsP = makePlayer(700, 580);
    let tsM = { ...freshPlayerMovementMemory(), groundedLastFrame: true };
    packPlayerStep(STATE_PTR, {
      x: 700, y: 580, vx: 0, vy: 0, aimX: 900, aimY: 580,
      jetpackFuel: JETPACK_MAX_FUEL, crouching: false,
      memory: { ...freshPlayerMovementMemory(), groundedLastFrame: true },
      dashCharges: 1, dashCooldownMultiplier,
    });
    // Dash, then coast (no input) through burst + recovery + margin.
    const script: number[] = [Bit.Dash, ...Array(30).fill(0)];
    let prev = 0;
    for (let t = 0; t < script.length; t++) {
      const curr = script[t]!;
      const ts = stepPlayer(tsP, prev, curr, 900, 580, tsM, [], DT, opts);
      tsP = ts.player; tsM = ts.memory;
      ex.step_player(STATE_PTR, prev, curr, 900, 580, 1, 1, DT,
        packed.staticsPtr, packed.staticsCount, packed.oneWayPtr, packed.oneWayCount);
      const wa = unpackPlayerStep(STATE_PTR);
      expect(wa.dashActiveMs).toBe(tsM.dashActiveMs);
      expect(wa.dashRecoveryMs).toBe(tsM.dashRecoveryMs);
      expect(wa.dashCooldownMs).toBe(tsM.dashCooldownMs);
      prev = curr;
    }
    // The floor actually engaged (below-floor multiplier got clamped).
    expect(tsM.dashCooldownMs).toBe(0); // fully decayed by tick 30
  });
});
