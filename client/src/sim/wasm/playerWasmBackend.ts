// Builds a wasm-backed `StepPlayerFn` that hosts (browser + Bun
// server) install via `setStepPlayerBackend`. Shared because the
// pack/unpack logic is identical across hosts — only the wasm
// loader differs. The `SimHandle` interface is the minimum surface
// needed: it's structurally satisfied by both the browser
// `loadSim()` result and the server `loadServerSim()` result.

import {
  JETPACK_MAX_FUEL,
  type PlayerMovementMemory,
  type StepPlayerFn,
} from "../player";
import type { StaticCollisionCache } from "../collision";
import type { PlayerEntity } from "../types";
import type { SimExports } from "./types";

/** Minimum surface needed to drive wasm calls from a host. */
export type SimHandle = {
  readonly statePtr: number;
  readonly stateLen: number;
  readonly exports: SimExports;
};

/**
 * Wraps a wasm sim instance into a `StepPlayerFn` that matches the
 * TS native signature. The wasm state buffer is partitioned into:
 *   [0, SIZEOF_PLAYER_STEP)              -> PlayerStep struct (in/out)
 *   [staticsOff, staticsOff + N*32)      -> packed AABB array
 *   [oneWayOff, oneWayOff + N)           -> packed one-way mask
 *
 * On every call we re-pack the cache (cheap; ~100 platforms) so the
 * backend works without state about prior calls.
 */
export function makeStepPlayerWasmBackend(sim: SimHandle): StepPlayerFn {
  const ex = sim.exports;
  const SIZEOF_AABB = ex.sizeof_aabb();
  const SIZEOF_PLAYER_STEP = ex.sizeof_player_step();
  const PLAYER_OFF = 0;
  const STATICS_OFF = SIZEOF_PLAYER_STEP + 8;

  // Field offsets must match sim/src/player.zig PlayerStep extern struct.
  const F = {
    x: 0,
    y: 8,
    vx: 16,
    vy: 24,
    aim_x: 32,
    aim_y: 40,
    jetpack_fuel: 48,
    crouching: 56,
    coyote_ms: 64,
    jump_buffer_ms: 72,
    jump_cut_applied: 80,
    jump_released_since_jump: 84,
    grounded_last_frame: 88,
    jetpack_active: 92,
    touching_wall_dir: 96,
    // ── augment inputs (f64) ──
    jump_mul: 104,
    wall_jump_mul: 112,
    wall_slide_mul: 120,
    // ── augment memory (f64) ──
    dash_cooldown_ms: 128,
    dash_active_ms: 136,
    // ── augment inputs (i32) ──
    air_jumps: 144,
    dash_charges: 148,
    // ── augment memory (i32) ──
    air_jumps_used: 152,
    dash_used_in_air: 156,
    // ── augment memory (f64, appended) ──
    dash_recovery_ms: 160,
    // ── augment input (f64, appended) ──
    dash_cooldown_mul: 168,
  } as const;

  return (
    player: PlayerEntity,
    prevKeys: number,
    currKeys: number,
    aimX: number,
    aimY: number,
    memory: PlayerMovementMemory,
    _platforms: readonly unknown[],
    dtMs: number,
    options: {
      collisionCache: StaticCollisionCache;
      speedMultiplier?: number;
      gravityMultiplier?: number;
      jumpMultiplier?: number;
      wallJumpMultiplier?: number;
      wallSlideMultiplier?: number;
      airJumps?: number;
      dashCharges?: number;
      dashCooldownMultiplier?: number;
    },
  ) => {
    const cache = options.collisionCache;
    const aabbs = cache.aabbs;
    const oneWay = cache.oneWay;
    const count = aabbs.length;
    const oneWayOff = STATICS_OFF + count * SIZEOF_AABB + 8;

    const memBuf = ex.memory.buffer;
    const dv = new DataView(memBuf, sim.statePtr, sim.stateLen);
    const u8 = new Uint8Array(memBuf, sim.statePtr, sim.stateLen);

    // Pack PlayerStep
    dv.setFloat64(PLAYER_OFF + F.x, player.x, true);
    dv.setFloat64(PLAYER_OFF + F.y, player.y, true);
    dv.setFloat64(PLAYER_OFF + F.vx, player.vx, true);
    dv.setFloat64(PLAYER_OFF + F.vy, player.vy, true);
    dv.setFloat64(PLAYER_OFF + F.aim_x, player.aimX, true);
    dv.setFloat64(PLAYER_OFF + F.aim_y, player.aimY, true);
    dv.setFloat64(PLAYER_OFF + F.jetpack_fuel, player.jetpackFuel ?? JETPACK_MAX_FUEL, true);
    dv.setInt32(PLAYER_OFF + F.crouching, player.crouching ? 1 : 0, true);
    dv.setFloat64(PLAYER_OFF + F.coyote_ms, memory.coyoteMs, true);
    dv.setFloat64(PLAYER_OFF + F.jump_buffer_ms, memory.jumpBufferMs, true);
    dv.setInt32(PLAYER_OFF + F.jump_cut_applied, memory.jumpCutApplied ? 1 : 0, true);
    dv.setInt32(PLAYER_OFF + F.jump_released_since_jump, memory.jumpReleasedSinceJump ? 1 : 0, true);
    dv.setInt32(PLAYER_OFF + F.grounded_last_frame, memory.groundedLastFrame ? 1 : 0, true);
    dv.setInt32(PLAYER_OFF + F.jetpack_active, memory.jetpackActive ? 1 : 0, true);
    dv.setInt32(PLAYER_OFF + F.touching_wall_dir, memory.touchingWallDir, true);
    // Augment inputs (from the resolved build; default inert).
    dv.setFloat64(PLAYER_OFF + F.jump_mul, options.jumpMultiplier ?? 1, true);
    dv.setFloat64(PLAYER_OFF + F.wall_jump_mul, options.wallJumpMultiplier ?? 1, true);
    dv.setFloat64(PLAYER_OFF + F.wall_slide_mul, options.wallSlideMultiplier ?? 1, true);
    dv.setInt32(PLAYER_OFF + F.air_jumps, options.airJumps ?? 0, true);
    dv.setInt32(PLAYER_OFF + F.dash_charges, options.dashCharges ?? 0, true);
    dv.setFloat64(PLAYER_OFF + F.dash_cooldown_mul, options.dashCooldownMultiplier ?? 1, true);
    // Augment memory (persisted across ticks).
    dv.setFloat64(PLAYER_OFF + F.dash_cooldown_ms, memory.dashCooldownMs, true);
    dv.setFloat64(PLAYER_OFF + F.dash_active_ms, memory.dashActiveMs, true);
    dv.setInt32(PLAYER_OFF + F.air_jumps_used, memory.airJumpsUsed, true);
    dv.setInt32(PLAYER_OFF + F.dash_used_in_air, memory.dashUsedInAir, true);
    dv.setFloat64(PLAYER_OFF + F.dash_recovery_ms, memory.dashRecoveryMs, true);

    // Pack statics + one-way mask
    for (let i = 0; i < count; i++) {
      const off = STATICS_OFF + i * SIZEOF_AABB;
      dv.setFloat64(off + 0, aabbs[i]!.x, true);
      dv.setFloat64(off + 8, aabbs[i]!.y, true);
      dv.setFloat64(off + 16, aabbs[i]!.w, true);
      dv.setFloat64(off + 24, aabbs[i]!.h, true);
    }
    for (let i = 0; i < oneWay.length; i++) {
      u8[oneWayOff + i] = oneWay[i] ? 1 : 0;
    }

    const jumped = ex.step_player(
      sim.statePtr + PLAYER_OFF,
      prevKeys, currKeys,
      aimX, aimY,
      options.speedMultiplier ?? 1,
      options.gravityMultiplier ?? 1,
      dtMs,
      sim.statePtr + STATICS_OFF, count,
      sim.statePtr + oneWayOff, oneWay.length,
    );

    // Unpack PlayerStep into next PlayerEntity + memory.
    const nextPlayer: PlayerEntity = {
      ...player,
      x: dv.getFloat64(PLAYER_OFF + F.x, true),
      y: dv.getFloat64(PLAYER_OFF + F.y, true),
      vx: dv.getFloat64(PLAYER_OFF + F.vx, true),
      vy: dv.getFloat64(PLAYER_OFF + F.vy, true),
      aimX: dv.getFloat64(PLAYER_OFF + F.aim_x, true),
      aimY: dv.getFloat64(PLAYER_OFF + F.aim_y, true),
      jetpackFuel: dv.getFloat64(PLAYER_OFF + F.jetpack_fuel, true),
      crouching: dv.getInt32(PLAYER_OFF + F.crouching, true) === 1,
    };

    const nextMemory: PlayerMovementMemory = {
      coyoteMs: dv.getFloat64(PLAYER_OFF + F.coyote_ms, true),
      jumpBufferMs: dv.getFloat64(PLAYER_OFF + F.jump_buffer_ms, true),
      jumpCutApplied: dv.getInt32(PLAYER_OFF + F.jump_cut_applied, true) === 1,
      jumpReleasedSinceJump: dv.getInt32(PLAYER_OFF + F.jump_released_since_jump, true) === 1,
      groundedLastFrame: dv.getInt32(PLAYER_OFF + F.grounded_last_frame, true) === 1,
      jetpackActive: dv.getInt32(PLAYER_OFF + F.jetpack_active, true) === 1,
      touchingWallDir: dv.getInt32(PLAYER_OFF + F.touching_wall_dir, true),
      airJumpsUsed: dv.getInt32(PLAYER_OFF + F.air_jumps_used, true),
      dashCooldownMs: dv.getFloat64(PLAYER_OFF + F.dash_cooldown_ms, true),
      dashUsedInAir: dv.getInt32(PLAYER_OFF + F.dash_used_in_air, true),
      dashActiveMs: dv.getFloat64(PLAYER_OFF + F.dash_active_ms, true),
      dashRecoveryMs: dv.getFloat64(PLAYER_OFF + F.dash_recovery_ms, true),
    };

    return {
      player: nextPlayer,
      memory: nextMemory,
      jumpedThisFrame: jumped === 1,
      jetpackFuel: nextPlayer.jetpackFuel ?? JETPACK_MAX_FUEL,
    };
  };
}
