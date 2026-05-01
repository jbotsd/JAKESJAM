// Pure player movement extracted from client/src/game/systems/MovementSystem.ts.
// All constants mirror that file so the offline practice path stays identical
// after MatchScene wires the sim/ output into rendering.
//
// Now covers: run/jump/gravity/friction/coyote/buffer/cut/fastFall/crouch + jetpack.
// Parry, shield, and card stat modifiers come in a follow-up pass — they all
// read off PlayerEntity fields that don't exist yet, and we keep this file
// additive against Dev A's sim/types.ts contract.

import {
  resolveMove,
  resolveMoveCached,
  platformToAABB,
  type AABB,
  type StaticCollisionCache,
} from "./collision.js";
import type { PlayerEntity, PlatformDefinition, InputBitfield } from "./types.js";

const M = {
  maxGroundSpeed: 330,
  groundAcceleration: 2700,
  airAcceleration: 2050,
  groundFriction: 3600,
  gravity: 1450,
  fastFallGravity: 2150,
  jumpVelocity: -635,
  jumpCutMultiplier: 0.48,
  coyoteMs: 110,
  jumpBufferMs: 110,
  maxFallSpeed: 900,
  crouchSpeedFactor: 0.42,
  bodyWidth: 26,
  bodyHeight: 56,
  crouchHeight: 38,
} as const;

// Jetpack constants — mirror the offline reference in
// client/src/game/systems/MovementSystem.ts so behavior stays identical.
export const JETPACK_MAX_FUEL = 125;
export const JETPACK_THRUST = 1480;
export const JETPACK_FUEL_DRAIN_PER_SECOND = 32;
export const JETPACK_GROUND_RECHARGE_PER_SECOND = 64;
export const JETPACK_AIR_RECHARGE_PER_SECOND = 10;
export const JETPACK_MIN_UPWARD_VELOCITY = -640;

const Bit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Fire: 1 << 6,
  Ability: 1 << 7,
  Shield: 1 << 8,
} as const;

/** Per-player movement memory the entity itself doesn't carry. */
export type PlayerMovementMemory = {
  coyoteMs: number;
  jumpBufferMs: number;
  jumpCutApplied: boolean;
  jumpReleasedSinceJump: boolean;
  groundedLastFrame: boolean;
  /** True for the tick the jetpack actively applied thrust. */
  jetpackActive: boolean;
};

export function freshPlayerMovementMemory(): PlayerMovementMemory {
  return {
    coyoteMs: 0,
    jumpBufferMs: 0,
    jumpCutApplied: false,
    jumpReleasedSinceJump: true,
    groundedLastFrame: false,
    jetpackActive: false,
  };
}

export type PlayerStepOptions = {
  speedMultiplier?: number;
  gravityMultiplier?: number;
  /** Pre-built collision cache. When provided, uses spatial-grid-accelerated
   *  sweep + one-way platform support instead of brute-force iteration. */
  collisionCache?: StaticCollisionCache;
};

export type PlayerStepResult = {
  player: PlayerEntity;
  memory: PlayerMovementMemory;
  /** True when the player just left the ground via a jump on this tick. */
  jumpedThisFrame: boolean;
  /** Fuel remaining at the end of the tick, mirrored from `player.jetpackFuel`. */
  jetpackFuel: number;
};

export function stepPlayer(
  player: PlayerEntity,
  prevKeys: InputBitfield,
  currKeys: InputBitfield,
  aimX: number,
  aimY: number,
  memory: PlayerMovementMemory,
  platforms: readonly PlatformDefinition[],
  dtMs: number,
  options: PlayerStepOptions = {},
): PlayerStepResult {
  const dtSec = dtMs / 1000;
  const speedMul = options.speedMultiplier ?? 1;
  const gravityMul = options.gravityMultiplier ?? 1;

  const left = (currKeys & Bit.Left) !== 0;
  const right = (currKeys & Bit.Right) !== 0;
  const jumpHeld = (currKeys & Bit.Jump) !== 0;
  const jumpPressed = jumpHeld && (prevKeys & Bit.Jump) === 0;
  const jumpReleased = !jumpHeld && (prevKeys & Bit.Jump) !== 0;
  const wantsCrouch = (currKeys & Bit.Crouch) !== 0;
  const fastFall = (currKeys & Bit.Down) !== 0;

  const next: PlayerEntity = { ...player, aimX, aimY };
  const mem: PlayerMovementMemory = { ...memory };

  if (mem.groundedLastFrame) {
    mem.coyoteMs = M.coyoteMs;
  } else {
    mem.coyoteMs = Math.max(0, mem.coyoteMs - dtMs);
  }
  if (jumpPressed) {
    mem.jumpBufferMs = M.jumpBufferMs;
  } else {
    mem.jumpBufferMs = Math.max(0, mem.jumpBufferMs - dtMs);
  }
  if (jumpReleased) {
    mem.jumpReleasedSinceJump = true;
  }

  next.crouching = wantsCrouch && mem.groundedLastFrame;

  // Horizontal acceleration / friction.
  const direction = (right ? 1 : 0) - (left ? 1 : 0);
  if (direction !== 0) {
    const accel =
      (mem.groundedLastFrame ? M.groundAcceleration : M.airAcceleration) * speedMul;
    next.vx = next.vx + direction * accel * dtSec;
  } else if (mem.groundedLastFrame) {
    next.vx = approach(next.vx, 0, M.groundFriction * dtSec);
  }
  const maxSpeed = M.maxGroundSpeed * speedMul * (next.crouching ? M.crouchSpeedFactor : 1);
  next.vx = clamp(next.vx, -maxSpeed, maxSpeed);

  // Jump (with coyote + buffer).
  let jumpedThisFrame = false;
  if (mem.jumpBufferMs > 0 && mem.coyoteMs > 0) {
    next.vy = M.jumpVelocity;
    mem.coyoteMs = 0;
    mem.jumpBufferMs = 0;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = false;
    jumpedThisFrame = true;
  }

  // Variable jump height: cut upward velocity once player releases jump.
  if (mem.jumpReleasedSinceJump && !mem.jumpCutApplied && next.vy < 0) {
    next.vy *= M.jumpCutMultiplier;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = true;
  }

  // Gravity.
  const gravity = (fastFall && next.vy > 0 ? M.fastFallGravity : M.gravity) * gravityMul;
  next.vy = Math.min(M.maxFallSpeed, next.vy + gravity * dtSec);

  // Jetpack: hold-jump-while-airborne triggers thrust until fuel is empty.
  // Mirrors MovementSystem.update — drain while active, recharge otherwise
  // (faster on the ground). On the same tick the player jumps off the ground
  // we ignore the jetpack — `groundedLastFrame` was true at top of tick — so
  // the player must release jump and re-press, or hold and wait one tick, to
  // start thrusting. That matches the offline behavior.
  const fuelStart = player.jetpackFuel ?? JETPACK_MAX_FUEL;
  const jetpackHeld = jumpHeld && !mem.groundedLastFrame;
  const jetpackActive = jetpackHeld && fuelStart > 0 && !mem.groundedLastFrame;
  let nextFuel = fuelStart;
  if (jetpackActive) {
    next.vy -= JETPACK_THRUST * dtSec;
    next.vy = Math.max(JETPACK_MIN_UPWARD_VELOCITY, next.vy);
    nextFuel = fuelStart - JETPACK_FUEL_DRAIN_PER_SECOND * dtSec;
  } else {
    const rechargeRate = mem.groundedLastFrame
      ? JETPACK_GROUND_RECHARGE_PER_SECOND
      : JETPACK_AIR_RECHARGE_PER_SECOND;
    nextFuel = fuelStart + rechargeRate * dtSec;
  }
  nextFuel = clamp(nextFuel, 0, JETPACK_MAX_FUEL);
  next.jetpackFuel = nextFuel;
  mem.jetpackActive = jetpackActive;

  // Movement resolution against platforms using swept AABB.
  const bodyHeight = next.crouching ? M.crouchHeight : M.bodyHeight;
  const aabb: AABB = {
    x: next.x - M.bodyWidth / 2,
    y: next.y - bodyHeight / 2,
    w: M.bodyWidth,
    h: bodyHeight,
  };

  // Use spatial-grid-accelerated resolution when cache is available,
  // with one-way platform support (player can jump through platforms from below).
  // Falls back to brute-force for backward compatibility.
  const resolved = options.collisionCache
    ? resolveMoveCached(aabb, next.vx, next.vy, dtSec, options.collisionCache, true)
    : resolveMove(aabb, next.vx, next.vy, dtSec, platforms.map(platformToAABB));
  next.x = resolved.x + M.bodyWidth / 2;
  next.y = resolved.y + bodyHeight / 2;
  next.vx = resolved.vx;
  next.vy = resolved.vy;
  mem.groundedLastFrame = resolved.groundedThisFrame;

  return { player: next, memory: mem, jumpedThisFrame, jetpackFuel: nextFuel };
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
