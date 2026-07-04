// Pure player movement extracted from client/src/game/systems/MovementSystem.ts.
// All constants mirror that file so the offline practice path stays identical
// after MatchScene wires the sim/ output into rendering.
//
// Now covers: run/jump/gravity/friction/coyote/buffer/cut/fastFall/crouch + jetpack.
// Parry, shield, and card stat modifiers come in a follow-up pass — they all
// read off PlayerEntity fields that don't exist yet, and we keep this file
// additive against Dev A's sim/types.ts contract.

import {
  resolveMoveCached,
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
  // M1 (docs/game-feel-tuning.md): asymmetric jump gravity — mirrors
  // sim/src/player.zig exactly (wasm parity).
  descentGravity: 2175,
  fastFallGravity: 2800,
  jumpVelocity: -635,
  jumpCutMultiplier: 0.48,
  coyoteMs: 110,
  jumpBufferMs: 110,
  maxFallSpeed: 900,
  crouchSpeedFactor: 0.42,
  bodyWidth: 26,
  bodyHeight: 56,
  crouchHeight: 38,
  // ── Wall movement (SMB / Warframe) — replaces the jetpack. ────────────
  // Grippy wall-slide: capped descent while pressing into a wall airborne.
  // Stickier (was 200) so a grip reads as a genuine catch, giving time to
  // line up the next wall-jump.
  wallSlideMaxFall: 175,
  // Wall-jump: a POWERFUL launch — vy ABOVE a floor jump (~179px apex, a full
  // shaft in ~3 kicks) with a strong horizontal shove off the wall. This is
  // the signature move; it should feel like a hard KICK, not a hop.
  wallJumpVy: -720,
  wallJumpVx: 470,
  // Wall-bang: rebound off a wall hit at speed when NOT gripping it.
  wallRestitution: 0.5,
  // Below this fall speed a fresh wall-touch "latches" (near-zero vy) for a
  // Warframe-style catch before the grippy slide takes over.
  wallLatchCatchVy: 90,
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
  /** Legacy field (jetpack removed). Kept for wasm struct ABI stability;
   *  always false now. */
  jetpackActive: boolean;
  /** Wall the player was in contact with LAST tick: -1 wall on the left,
   *  +1 wall on the right, 0 none. Read this tick to decide wall-jump / slide;
   *  recomputed from the collision resolve at the end of the tick. */
  touchingWallDir: number;
};

export function freshPlayerMovementMemory(): PlayerMovementMemory {
  return {
    coyoteMs: 0,
    jumpBufferMs: 0,
    jumpCutApplied: false,
    jumpReleasedSinceJump: true,
    groundedLastFrame: false,
    jetpackActive: false,
    touchingWallDir: 0,
  };
}

export type PlayerStepOptions = {
  speedMultiplier?: number;
  gravityMultiplier?: number;
  /** Pre-built collision cache. Required: the brute-force fallback was
   *  deleted (H2) because it didn't support one-way platforms and every
   *  production code path passes a cache anyway. createRuntime always
   *  builds a cache (even for empty stub maps). */
  collisionCache: StaticCollisionCache;
};

export type PlayerStepResult = {
  player: PlayerEntity;
  memory: PlayerMovementMemory;
  /** True when the player just left the ground via a jump on this tick. */
  jumpedThisFrame: boolean;
  /** Fuel remaining at the end of the tick, mirrored from `player.jetpackFuel`. */
  jetpackFuel: number;
};

export type StepPlayerFn = (
  player: PlayerEntity,
  prevKeys: InputBitfield,
  currKeys: InputBitfield,
  aimX: number,
  aimY: number,
  memory: PlayerMovementMemory,
  platforms: readonly PlatformDefinition[],
  dtMs: number,
  options: PlayerStepOptions,
) => PlayerStepResult;

let stepPlayerBackend: StepPlayerFn | null = null;

/**
 * Swap the stepPlayer impl. Host modules call this at boot when
 * `?wasm-player=1` is set. The backend MUST be byte-equivalent to
 * the native TS impl — `playerParity.test.ts` proves the wasm
 * impl meets that bar across a 90-tick scripted run.
 *
 * Pass `null` to revert.
 */
export function setStepPlayerBackend(fn: StepPlayerFn | null): void {
  stepPlayerBackend = fn;
}

export function stepPlayer(
  player: PlayerEntity,
  prevKeys: InputBitfield,
  currKeys: InputBitfield,
  aimX: number,
  aimY: number,
  memory: PlayerMovementMemory,
  platforms: readonly PlatformDefinition[],
  dtMs: number,
  options: PlayerStepOptions,
): PlayerStepResult {
  if (stepPlayerBackend !== null) {
    return stepPlayerBackend(
      player, prevKeys, currKeys, aimX, aimY, memory, platforms, dtMs, options,
    );
  }
  return stepPlayerNative(
    player, prevKeys, currKeys, aimX, aimY, memory, platforms, dtMs, options,
  );
}

function stepPlayerNative(
  player: PlayerEntity,
  prevKeys: InputBitfield,
  currKeys: InputBitfield,
  aimX: number,
  aimY: number,
  memory: PlayerMovementMemory,
  // `_platforms` retained as a positional placeholder so downstream
  // call sites (World.ts, tests) don't shift on H2's signature change.
  // Real collision uses options.collisionCache; the array is unread.
  _platforms: readonly PlatformDefinition[],
  dtMs: number,
  options: PlayerStepOptions,
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

  // Jump: WALL-JUMP takes precedence when airborne against a wall; otherwise
  // the normal ground/coyote jump. (Jetpack removed — walls are the vertical
  // traversal toolkit now.)
  let jumpedThisFrame = false;
  const wallDir = mem.touchingWallDir;
  if (mem.jumpBufferMs > 0 && !mem.groundedLastFrame && wallDir !== 0) {
    // WALL-JUMP — up + a firm shove AWAY from the wall (SMB).
    next.vy = M.wallJumpVy;
    next.vx = -wallDir * M.wallJumpVx;
    mem.jumpBufferMs = 0;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = false;
    mem.touchingWallDir = 0; // left the wall
    jumpedThisFrame = true;
  } else if (mem.jumpBufferMs > 0 && mem.coyoteMs > 0) {
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
  const gravity =
    (next.vy > 0
      ? fastFall
        ? M.fastFallGravity
        : M.descentGravity
      : M.gravity) * gravityMul;
  next.vy = Math.min(M.maxFallSpeed, next.vy + gravity * dtSec);

  // Grippy wall-slide / latch (Warframe/SMB): pressing INTO a wall while
  // airborne + descending caps the fall speed — a controlled grip instead of
  // a free fall. Wall-jump reads the wall state from LAST tick (`wallDir`).
  const gripping = !mem.groundedLastFrame && wallDir !== 0 && direction === wallDir;
  if (gripping && next.vy > 0) {
    next.vy = Math.min(next.vy, M.wallSlideMaxFall);
  }

  // Jetpack removed. Pin the fuel field to max for wire/ABI stability so the
  // snapshot/protocol shape is unchanged; nothing drains it now.
  next.jetpackFuel = JETPACK_MAX_FUEL;
  mem.jetpackActive = false;

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
  // Use explicit sqrt(vx² + vy²) instead of Math.hypot — Math.hypot's
  // overflow-safe scaling produces ULP-different bits than the same
  // formula computed with naive multiply+add+sqrt, breaking parity
  // with the Zig wasm port. In our velocity domain (max ~1000 px/s)
  // there's no overflow risk, so the simpler form is fine. Both
  // sides now compute this identically. See ADR-0006.
  const totalDisp = Math.sqrt(next.vx * next.vx + next.vy * next.vy) * dtSec;
  const subSteps = Math.max(1, Math.ceil(totalDisp / maxStepDisp));
  const subDt = dtSec / subSteps;
  let groundedAcc = false;
  let wallContactThisTick = 0;
  for (let i = 0; i < subSteps; i++) {
    const preVx = next.vx;
    const resolved = resolveMoveCached(
      aabb, next.vx, next.vy, subDt, options.collisionCache, true,
    );
    aabb = { x: resolved.x, y: resolved.y, w: aabb.w, h: aabb.h };
    // A horizontal collision zeroes vx — that's a WALL. Direction = the way we
    // were moving into it.
    if (preVx !== 0 && resolved.vx === 0 && (preVx > 1 || preVx < -1)) {
      const hitDir = preVx > 0 ? 1 : -1;
      if (direction !== hitDir && (preVx > 120 || preVx < -120)) {
        // WALL-BANG — hit it at speed without gripping → rebound, no latch.
        next.vx = -preVx * M.wallRestitution;
      } else {
        // Stuck to the wall → eligible to slide / wall-jump next tick.
        next.vx = resolved.vx;
        wallContactThisTick = hitDir;
      }
    } else {
      next.vx = resolved.vx;
    }
    next.vy = resolved.vy;
    if (resolved.groundedThisFrame) groundedAcc = true;
  }
  next.x = aabb.x + M.bodyWidth / 2;
  next.y = aabb.y + bodyHeight / 2;
  mem.groundedLastFrame = groundedAcc;
  // Wall state carried to next tick — cleared on the ground (a floor is not a
  // wall) so you can't wall-jump off level ground.
  mem.touchingWallDir = groundedAcc ? 0 : wallContactThisTick;

  return { player: next, memory: mem, jumpedThisFrame, jetpackFuel: next.jetpackFuel };
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
