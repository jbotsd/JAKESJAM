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
import { MIN_PLATFORM_H_PX } from "./constants.js";

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

/**
 * Distance below the map's bottom edge (`map.size.y`) at which a player is
 * considered "in the void" and force-killed. Prevents the
 * "fall-through-the-floor → stuck forever" bug when a map has a hole, an
 * authoring error in the floor row, or a momentum exploit pushes a body past
 * the wall.
 *
 * 200px is generous — a player has to clearly fall well past the visible
 * arena before the kill plane fires; tweak with care since shrinking it
 * risks killing players still legitimately mid-air at the bottom edge.
 */
export const KILL_PLANE_MARGIN_PX = 200;

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
  let aabb: AABB = {
    x: next.x - M.bodyWidth / 2,
    y: next.y - bodyHeight / 2,
    w: M.bodyWidth,
    h: bodyHeight,
  };

  // Sub-stepping guard: if the displacement this tick would exceed
  // 0.6 × MIN_PLATFORM_H_PX, split the integration into N equal sub-steps
  // so the swept sweep never has to span a thin platform in one shot.
  // resolveMoveCached's slide loop is already bounded to 3 passes; sub-
  // stepping at the player layer is the right place to add headroom.
  // Cheap because the branch only fires under fast-fall / chaos-modifier
  // gravity spikes; normal runs use a single sub-step.
  const maxStepDisp = MIN_PLATFORM_H_PX * 0.6;
  const totalDisp = Math.hypot(next.vx, next.vy) * dtSec;
  const subSteps = Math.max(1, Math.ceil(totalDisp / maxStepDisp));
  const subDt = dtSec / subSteps;
  let groundedAcc = false;
  for (let i = 0; i < subSteps; i++) {
    const resolved = options.collisionCache
      ? resolveMoveCached(aabb, next.vx, next.vy, subDt, options.collisionCache, true)
      : resolveMove(aabb, next.vx, next.vy, subDt, platforms.map(platformToAABB));
    aabb = { x: resolved.x, y: resolved.y, w: aabb.w, h: aabb.h };
    next.vx = resolved.vx;
    next.vy = resolved.vy;
    if (resolved.groundedThisFrame) groundedAcc = true;
  }
  next.x = aabb.x + M.bodyWidth / 2;
  next.y = aabb.y + bodyHeight / 2;
  mem.groundedLastFrame = groundedAcc;

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
