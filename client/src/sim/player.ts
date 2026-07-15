// Pure player movement: run/jump/gravity/friction/coyote/buffer/cut/
// fastFall/crouch/wall-slide/wall-jump/dash. Historically extracted from a
// legacy jetpack-era MovementSystem (since deleted, along with the jetpack —
// walls are the vertical-traversal toolkit now); this is the single physics
// implementation for both the online path (World.ts) and offline Practice
// (client/src/game/systems/LocalPlayerController.ts), mirrored bit-for-bit
// in sim/src/player.zig for wasm parity.

import {
  resolveMoveCached,
  type AABB,
  type StaticCollisionCache,
} from "./collision.js";
import type { PlayerEntity, PlatformDefinition, InputBitfield } from "./types.js";
import { MIN_PLATFORM_H_PX } from "./constants.js";

const M = {
  // 330 → 362 (2026-07-12): a ~10% global bump so full stride reads as a
  // genuine sprint on screen (user call after the run-cycle restyle: the
  // gait finally looked like sprinting but the ground speed undersold it).
  // MIRRORED in sim/src/player.zig MAX_GROUND_SPEED — keep in sync.
  maxGroundSpeed: 362,
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
  // Wall POWER-SLIDE: holding Down at the moment of a wall-jump trades
  // height for speed — a flat, fast diagonal launch (not a vertical climb).
  // Same trigger/precedence as the normal wall-jump, just a different
  // vy/vx pair, so the wall-jump-shaft reachability model (mapGen.ts) is
  // untouched — this is a strictly additional, faster-but-flatter option,
  // never required to clear a shaft.
  wallPowerSlideVy: -430,
  wallPowerSlideVx: 690,
  // Wall-bang: rebound off a wall hit at speed when NOT gripping it.
  wallRestitution: 0.5,
  // Below this fall speed a fresh wall-touch "latches" (near-zero vy) for a
  // Warframe-style catch before the grippy slide takes over.
  wallLatchCatchVy: 90,
} as const;

// Collision-box size, re-exported so external consumers (rendering/VFX
// proximity checks, the local-practice player controller) read the real
// physics box instead of hand-duplicating these numbers as magic constants
// (which is exactly what happened before this export existed).
export const PLAYER_BODY_WIDTH = M.bodyWidth;
export const PLAYER_BODY_HEIGHT = M.bodyHeight;
export const PLAYER_CROUCH_HEIGHT = M.crouchHeight;

/**
 * Fraction of the (crouch-aware) body height, measured from the top, that
 * counts as the head zone for headshot detection (projectile.ts). Generous
 * on purpose — this is an arcade arena brawler, not a tactical shooter;
 * "aim high and get rewarded" should feel achievable, not pixel-perfect.
 */
export const HEADSHOT_ZONE_FRAC = 0.32;
/** Slight boon, per design ask — a noticeable but not dominant reward
 *  (biggest existing card damageMultiplier in data/cards.ts is 1.16). */
export const HEADSHOT_DAMAGE_MULTIPLIER = 1.2;

/**
 * The player's REAL combat hitbox — same box movement collision already
 * uses (bodyWidth × crouch-aware bodyHeight, centred on player.x/y), not a
 * hand-rolled approximation. Jake, 2026-07-15: projectile.ts/fire.ts/
 * destructible.ts each independently hard-coded their own `PLAYER_RADIUS =
 * 18` square hitbox (36×36) — this is exactly the "hand-duplicating these
 * numbers as magic constants" anti-pattern the export above already exists
 * to prevent, and the SQUARE shape was badly wrong besides: the real body
 * is 26w × 56h (or 38h crouched). A 36-tall square hitbox is 20px SHORTER
 * than the standing body, meaning shots that visually land on the head or
 * feet — the outer ~36% of the character's real vertical profile — missed
 * outright. That's the "we miss often when we should" bug.
 */
export function playerHitboxAABB(player: Pick<PlayerEntity, "x" | "y" | "crouching">): AABB {
  const h = player.crouching ? M.crouchHeight : M.bodyHeight;
  return {
    x: player.x - M.bodyWidth / 2,
    y: player.y - h / 2,
    w: M.bodyWidth,
    h,
  };
}

/**
 * True when a hit at world-space `hitY` landed in the victim's head zone
 * (top HEADSHOT_ZONE_FRAC of their real, crouch-aware hitbox — see
 * playerHitboxAABB). Pure Y-band check: a projectile that's already
 * confirmed to hit the body only needs the vertical placement to qualify,
 * not a second full AABB test.
 */
export function isHeadshot(
  hitY: number,
  victim: Pick<PlayerEntity, "y" | "crouching">,
): boolean {
  const h = victim.crouching ? M.crouchHeight : M.bodyHeight;
  const top = victim.y - h / 2;
  return hitY <= top + h * HEADSHOT_ZONE_FRAC;
}

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

// Jetpack constants — the jetpack itself is removed from gameplay (walls are
// the vertical-traversal toolkit now); these remain only for the wasm ABI
// struct layout / wire compatibility (PlayerEntity.jetpackFuel).
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
  Dash: 1 << 9,
} as const;

// Deep-movement augment constants (card-gated; 0/1 multipliers = inert).
/** Dash-bash power-slide burst velocity (px/s). Bumped 780→940: the shield-dash
 *  reads as a committed POWER SLIDE — fast and flat — not a floaty hop. */
const DASH_SPEED = 940;
/** Dash cooldown (ms) between uses. */
const DASH_COOLDOWN_MS = 3000;
/** How long the slide holds full speed before the normal clamp resumes.
 *  Bumped 150→210: a longer slide = a more committed, readable power-slide
 *  bash (you can see it coming and it carries you through the block window). */
const DASH_DURATION_MS = 210;
/** Recovery endlag after the burst: steering accel is reduced so a whiffed
 *  slide is genuinely punishable. This is the genre's canonical anti-spam
 *  lever (Smash air-dodge endlag, Rivals post-parry lockout, Brawlhalla dash
 *  lockout): the slide keeps its full power but costs a real commitment. */
export const DASH_RECOVERY_MS = 200;
/** Steering-acceleration multiplier while recovering (0.4 = sluggish, not
 *  frozen — you can still drift, you just can't juke). */
const DASH_RECOVERY_ACCEL_MULT = 0.4;
/** HARD floor on the dash cycle (cooldown), regardless of card stacking
 *  (Quick Parry: dashCooldownMultiplier). Risk of Rain's stacking lesson,
 *  applied: uptime-adjacent stats must never compound toward 100% — so the
 *  cooldown can never shrink below burst+recovery, which guarantees the
 *  punish window survives no matter how many Quick Parrys are stacked. */
const DASH_MIN_CYCLE_MS = DASH_DURATION_MS + DASH_RECOVERY_MS;
/** Mid-dash steering responsiveness: per-second lerp rate of the burst's
 *  velocity DIRECTION toward the live aim (magnitude untouched). ~9/s ≈
 *  the lunge visibly carves toward a moved cursor within the 210ms burst
 *  without ever reading as teleport-turning. MIRRORED in player.zig. */
const DASH_STEER_LERP_PER_SEC = 9;

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
  /** Mid-air jumps consumed since last grounded (double-jump card). */
  airJumpsUsed: number;
  /** Remaining dash cooldown (ms). */
  dashCooldownMs: number;
  /** Air dashes consumed since last grounded. */
  dashUsedInAir: number;
  /** Remaining dash burst window (ms) — while >0 the max-speed clamp is raised
   *  to DASH_SPEED and friction is suspended so the burst carries. */
  dashActiveMs: number;
  /** Remaining recovery endlag (ms) after a burst ends — steering accel is
   *  reduced (DASH_RECOVERY_ACCEL_MULT) so a whiffed slide can be punished. */
  dashRecoveryMs: number;
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
    airJumpsUsed: 0,
    dashCooldownMs: 0,
    dashUsedInAir: 0,
    dashActiveMs: 0,
    dashRecoveryMs: 0,
  };
}

/**
 * Mirrors the host-only `PlayerMovementMemory` fields the render layer needs
 * onto the entity itself: `grounded`/`touchingWallDir`/`dashing`/
 * `dashReadyFrac`. Sim correctness code always reads movement memory
 * directly — these entity copies exist only so the wire codec (snapshotDelta
 * P_HI bits) and the procedural rig (`ProceduralPlayerPose`) have something
 * to read.
 *
 * Called from the SAME call site regardless of which `stepPlayer` backend
 * ran (TS native or wasm — see `stepPlayer`/`setStepPlayerBackend`), which
 * is why dashReadyFrac is computed HERE rather than inside
 * `stepPlayerNative`: that function only runs for the TS backend, and
 * player physics defaults to wasm-on for live matches (Phase F3), so a
 * wasm-only cosmetic field would silently never appear for anyone.
 *
 * `dashCharges`/`dashCooldownMultiplier` come from the caller's already-
 * resolved card build (World.ts's `resolvePlayerBuild`), not from `memory`
 * — the effective cooldown window depends on the equipped build, not
 * anything the sim step tracks per-tick.
 */
export function mirrorMovementMemoryOntoEntity(
  entity: PlayerEntity,
  memory: PlayerMovementMemory,
  dashCharges = 0,
  dashCooldownMultiplier = 1,
): PlayerEntity {
  const dashCooldownWindowMs = Math.max(
    DASH_MIN_CYCLE_MS,
    DASH_COOLDOWN_MS * dashCooldownMultiplier,
  );
  return {
    ...entity,
    grounded: memory.groundedLastFrame,
    touchingWallDir: memory.touchingWallDir,
    dashing: memory.dashActiveMs > 0,
    // Undefined (hides the HUD meter) until a card actually grants a dash
    // charge — dashCharges===0 means the ability isn't reachable at all,
    // not "on cooldown".
    dashReadyFrac:
      dashCharges > 0
        ? 1 - Math.min(1, Math.max(0, memory.dashCooldownMs / dashCooldownWindowMs))
        : undefined,
  };
}

export type PlayerStepOptions = {
  speedMultiplier?: number;
  gravityMultiplier?: number;
  /** Card augments (default inert): jump/wall-jump/slide scalars, extra air
   *  jumps, dash charges. Threaded through to the wasm step via PlayerStep. */
  jumpMultiplier?: number;
  wallJumpMultiplier?: number;
  wallSlideMultiplier?: number;
  airJumps?: number;
  dashCharges?: number;
  /** Scales the dash-bash slide's cooldown (<1 = sooner — Quick Parry,
   *  repurposed). Floor-clamped against burst+recovery so stacking can
   *  never squeeze out the punish window (see DASH_MIN_CYCLE_MS). */
  dashCooldownMultiplier?: number;
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
  const jumpMul = options.jumpMultiplier ?? 1;
  const wallJumpMul = options.wallJumpMultiplier ?? 1;
  const wallSlideMul = options.wallSlideMultiplier ?? 1;
  const airJumps = options.airJumps ?? 0;
  const dashCharges = options.dashCharges ?? 0;
  const dashCooldownMs = Math.max(
    DASH_MIN_CYCLE_MS,
    DASH_COOLDOWN_MS * (options.dashCooldownMultiplier ?? 1),
  );

  const left = (currKeys & Bit.Left) !== 0;
  const right = (currKeys & Bit.Right) !== 0;
  const jumpHeld = (currKeys & Bit.Jump) !== 0;
  const jumpPressed = jumpHeld && (prevKeys & Bit.Jump) === 0;
  const jumpReleased = !jumpHeld && (prevKeys & Bit.Jump) !== 0;
  const wantsCrouch = (currKeys & Bit.Crouch) !== 0;
  const fastFall = (currKeys & Bit.Down) !== 0;
  const dashPressed = (currKeys & Bit.Dash) !== 0 && (prevKeys & Bit.Dash) === 0;

  const next: PlayerEntity = { ...player, aimX, aimY };
  const mem: PlayerMovementMemory = { ...memory };

  // Timers tick down every frame; grounded resets air-jump / air-dash budgets.
  const wasDashActive = memory.dashActiveMs > 0;
  mem.dashCooldownMs = Math.max(0, mem.dashCooldownMs - dtMs);
  mem.dashActiveMs = Math.max(0, mem.dashActiveMs - dtMs);
  // Burst just ended this tick → open the recovery endlag window.
  if (wasDashActive && mem.dashActiveMs <= 0) {
    mem.dashRecoveryMs = DASH_RECOVERY_MS;
  } else {
    mem.dashRecoveryMs = Math.max(0, mem.dashRecoveryMs - dtMs);
  }
  if (mem.groundedLastFrame) {
    mem.airJumpsUsed = 0;
    mem.dashUsedInAir = 0;
  }

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

  // Horizontal acceleration / friction. During a dash burst friction is
  // suspended and the clamp is raised so the burst carries.
  const dashActive = mem.dashActiveMs > 0;
  // Recovery endlag: steering is sluggish right after a burst — the
  // whiff-punish window that keeps slide-spam honest.
  const dashRecovering = !dashActive && mem.dashRecoveryMs > 0;
  const direction = (right ? 1 : 0) - (left ? 1 : 0);
  if (direction !== 0) {
    const accel =
      (mem.groundedLastFrame ? M.groundAcceleration : M.airAcceleration) *
      speedMul *
      (dashRecovering ? DASH_RECOVERY_ACCEL_MULT : 1);
    next.vx = next.vx + direction * accel * dtSec;
  } else if (mem.groundedLastFrame && !dashActive) {
    next.vx = approach(next.vx, 0, M.groundFriction * dtSec);
  }
  const maxSpeed = dashActive
    ? DASH_SPEED
    : M.maxGroundSpeed * speedMul * (next.crouching ? M.crouchSpeedFactor : 1);
  next.vx = clamp(next.vx, -maxSpeed, maxSpeed);

  // Jump: WALL-JUMP takes precedence when airborne against a wall; otherwise
  // the normal ground/coyote jump. (Jetpack removed — walls are the vertical
  // traversal toolkit now.)
  let jumpedThisFrame = false;
  const wallDir = mem.touchingWallDir;
  // Wall-jump takes the jump when touching a wall — UNLESS you're pressing AWAY
  // from it AND actually have a double-jump charge, in which case the push-off
  // becomes the double-jump. Without the card, wall-jump still fires in every
  // direction (no regression for card-less players).
  const divertToDoubleJump = direction === -wallDir && mem.airJumpsUsed < airJumps;
  if (mem.jumpBufferMs > 0 && !mem.groundedLastFrame && wallDir !== 0 && !divertToDoubleJump) {
    // WALL-JUMP — up + a firm shove AWAY from the wall (SMB), OR — holding
    // Down at the trigger instant — the POWER-SLIDE variant: a flatter,
    // faster launch that trades height for horizontal speed. Same
    // trigger/precedence either way, ×wallJumpMul applies to both.
    if (wantsCrouch) {
      next.vy = M.wallPowerSlideVy * wallJumpMul;
      next.vx = -wallDir * M.wallPowerSlideVx;
      // INTEGRATION: the wall power-slide IS an dash-bash slide. Marking it
      // dash-active gives it — for free, via the same `dashing` gate — the
      // shield reflect (combat.tryDeflectDamage), the bash (World.ts), the
      // deployed shield arc (rig), and the flat gravity-suspended carry. One
      // "dash-bash slide" concept, two triggers: right-click, or crouch-off-wall.
      // No dash charge consumed — it's the wall move, not the dash.
      mem.dashActiveMs = DASH_DURATION_MS;
    } else {
      next.vy = M.wallJumpVy * wallJumpMul;
      next.vx = -wallDir * M.wallJumpVx;
    }
    mem.jumpBufferMs = 0;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = false;
    mem.touchingWallDir = 0; // left the wall
    jumpedThisFrame = true;
  } else if (mem.jumpBufferMs > 0 && mem.coyoteMs > 0) {
    next.vy = M.jumpVelocity * jumpMul;
    mem.coyoteMs = 0;
    mem.jumpBufferMs = 0;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = false;
    jumpedThisFrame = true;
  } else if (mem.jumpBufferMs > 0 && !mem.groundedLastFrame && mem.airJumpsUsed < airJumps) {
    // DOUBLE-JUMP (card): a mid-air jump when off the ground, not on a wall,
    // and coyote is spent. Consumes one air-jump charge (reset on landing).
    next.vy = M.jumpVelocity * jumpMul;
    mem.jumpBufferMs = 0;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = false;
    mem.airJumpsUsed += 1;
    jumpedThisFrame = true;
  }

  // Variable jump height: cut upward velocity once player releases jump.
  if (mem.jumpReleasedSinceJump && !mem.jumpCutApplied && next.vy < 0) {
    next.vy *= M.jumpCutMultiplier;
    mem.jumpReleasedSinceJump = false;
    mem.jumpCutApplied = true;
  }

  // Gravity — SUSPENDED during a dash burst so the aim-directional lunge
  // travels straight in the aimed direction (a floaty, crisp dash) instead
  // of sagging. `dashActive` reflects a dash started on a PRIOR tick; the
  // trigger tick itself runs gravity here then overwrites vy in the dash
  // block below, which is fine.
  const gravity =
    (next.vy > 0
      ? fastFall
        ? M.fastFallGravity
        : M.descentGravity
      : M.gravity) * gravityMul;
  if (!dashActive) {
    next.vy = Math.min(M.maxFallSpeed, next.vy + gravity * dtSec);
  } else {
    // MID-DASH STEERING: while the burst is live, the lunge CURVES toward
    // the current aim — move the mouse mid-dash and the trajectory follows.
    // Formulated trig-free (unit-vector lerp + renormalize: only +-*/ and
    // sqrt, all IEEE-exact) so the Zig wasm mirror is bit-identical without
    // touching the trig LUT. MIRRORED in sim/src/player.zig — keep in sync.
    // NOTE: sqrt(x*x+y*y), NOT Math.hypot — hypot's overflow-safe rounding
    // is not bit-identical to Zig's @sqrt, and this block must stay in
    // exact parity (same reason the dash trigger below uses Math.sqrt).
    const dashSpeed = Math.sqrt(next.vx * next.vx + next.vy * next.vy);
    const adx = aimX - next.x;
    const ady = aimY - next.y;
    const aimLen = Math.sqrt(adx * adx + ady * ady);
    if (dashSpeed > 1 && aimLen > 1e-3) {
      const ux = next.vx / dashSpeed;
      const uy = next.vy / dashSpeed;
      const tx = adx / aimLen;
      const ty = ady / aimLen;
      const k = Math.min(1, DASH_STEER_LERP_PER_SEC * dtSec);
      const nx = ux + (tx - ux) * k;
      const ny = uy + (ty - uy) * k;
      const nl = Math.sqrt(nx * nx + ny * ny);
      if (nl > 1e-6) {
        next.vx = (nx / nl) * dashSpeed;
        next.vy = (ny / nl) * dashSpeed;
      }
    }
  }

  // Grippy wall-slide / latch (Warframe/SMB): pressing INTO a wall while
  // airborne + descending caps the fall speed — a controlled grip instead of
  // a free fall. Wall-jump reads the wall state from LAST tick (`wallDir`).
  const gripping = !mem.groundedLastFrame && wallDir !== 0 && direction === wallDir;
  if (gripping && next.vy > 0) {
    next.vy = Math.min(next.vy, M.wallSlideMaxFall * wallSlideMul);
  }

  // DASH BASH (card): an aim-directional shielded lunge on the Dash input.
  // Ground dash is always available on cooldown; air dashes are limited to
  // `dashCharges` before landing. Direction = the AIM vector, fully analog
  // (any angle — mouse-to-character on desktop, dash mini-stick on touch) —
  // aim is the only directional intent the control scheme carries
  // (A/D-only movement has no vertical axis). The
  // shield is deployed in the travel direction for the burst window; the
  // block lives in combat.tryDeflectDamage, keyed on `dashing` + velocity.
  if (dashPressed && dashCharges > 0 && mem.dashCooldownMs <= 0) {
    const canAir = !mem.groundedLastFrame && mem.dashUsedInAir < dashCharges;
    if (mem.groundedLastFrame || canAir) {
      let dx = aimX - next.x;
      let dy = aimY - next.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-3) {
        // Degenerate aim (cursor on the player): fall back to facing, flat.
        dx = direction !== 0 ? direction : 1;
        dy = 0;
      }
      const invLen = 1 / (len < 1e-3 ? 1 : len);
      next.vx = dx * invLen * DASH_SPEED;
      next.vy = dy * invLen * DASH_SPEED;
      if (!mem.groundedLastFrame) {
        mem.dashUsedInAir += 1;
      }
      mem.dashCooldownMs = dashCooldownMs;
      mem.dashActiveMs = DASH_DURATION_MS;
      // The lunge's upward component is NOT a jump — mark jump-cut consumed
      // so the variable-jump-height logic doesn't halve an up/diagonal dash
      // (it fires on any vy<0). A later real jump resets this.
      mem.jumpCutApplied = true;
    }
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
