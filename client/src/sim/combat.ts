// Parry + shield combat helpers, ported from MatchScene's offline path so the
// new netcode runs the same gameplay. All functions are pure — they take in a
// PlayerEntity (and current/previous input bits, projectile data, dt, tick),
// and return new state. No DOM, no Date.now(), no Math.random().
//
// Mirrors the rules from client/src/game/scenes/MatchScene.ts:
//   - Parry: rising-edge trigger on InputBit.Ability, gated by cooldown.
//     Active for PARRY_ACTIVE_MS, then a PARRY_COOLDOWN_MS_DEFAULT lockout.
//     Hits whose source direction sits within ±arc/2 of the captured facing
//     are deflected (zero damage, projectile destroyed by the caller).
//   - Shield: held InputBit.Shield drains shieldCharge while a charge is
//     available. When inactive, the charge slowly recharges. A successful
//     block costs `damage * 1.8` charge and reduces the incoming damage to 0
//     until the charge runs out.
//
// MatchScene reference symbols: shieldActive, shieldCharge, temporaryShieldMs,
// parryActiveMs, parryCooldownMs, getParryArcRadians, isParryCovering,
// damagePlayer, clearTemporaryCombatEffects.

import { Tick } from "./types.js";
import { lutAtan2 } from "./trig.js";
import type {
  EntityId,
  InputBitfield,
  PlayerEntity,
  ProjectileEntity,
} from "./types.js";

// ----- Constants -------------------------------------------------------------

/** Length of the parry "active" window once triggered. */
export const PARRY_ACTIVE_MS = 420;
/**
 * Default lockout (ms) before a fresh parry can be triggered. MatchScene's
 * offline path uses 4300ms scaled by per-build multipliers; the sim ships a
 * tighter default until card-driven multipliers are wired through here.
 */
export const PARRY_COOLDOWN_MS_DEFAULT = 1800;
/** Half-cone width is half of this — i.e. ±30° around `parryFacing`. */
export const PARRY_ARC_RADIANS = Math.PI / 3;
/** Aim-shield block arc — a broad 120° frontal cone (wider than the 60° parry
 *  since a held shield is a wall, not a flick). */
export const SHIELD_AIM_ARC_RADIANS = (2 * Math.PI) / 3;
/** Default starting / max shield charge. */
export const SHIELD_MAX_CHARGE_DEFAULT = 100;
/** Charge drained per second while shieldActive is true and not blocking a hit. */
export const SHIELD_DRAIN_PER_SECOND = 35;
/** Charge recharged per second while the shield is idle. */
export const SHIELD_RECHARGE_PER_SECOND = 14;
/** Charge cost = damage * this multiplier when a hit is shield-blocked. */
export const SHIELD_HIT_DRAIN_MULTIPLIER = 1.8;

// Bit constants — duplicated from net/protocol.ts to keep sim/ self-contained
// (sim must not depend on net/). InputBitfield layout is locked in types.ts.
const Bit = {
  Ability: 1 << 7,
  Shield: 1 << 8,
} as const;

// ----- Parry -----------------------------------------------------------------

export type TryStartParryOptions = {
  /** Override the default cooldown (e.g. card-driven). Defaults to PARRY_COOLDOWN_MS_DEFAULT. */
  cooldownMs?: number;
  /** Override the active window. Defaults to PARRY_ACTIVE_MS. */
  activeMs?: number;
  /** Tick length in ms; needed to convert ms → ticks. */
  dtMs: number;
};

export type TryStartParryResult = {
  player: PlayerEntity;
  started: boolean;
};

/**
 * Rising-edge trigger on InputBit.Ability. If the player is alive and the
 * cooldown has expired, sets `parryActiveUntilTick` and `parryCooldownUntilTick`
 * and snapshots the aim angle into `parryFacing`. Otherwise returns the player
 * unchanged.
 */
export function tryStartParry(
  player: PlayerEntity,
  currKeys: InputBitfield,
  prevKeys: InputBitfield,
  tick: Tick,
  options: TryStartParryOptions,
): TryStartParryResult {
  if (!player.alive) {
    return { player, started: false };
  }
  const pressed = (currKeys & Bit.Ability) !== 0;
  const wasPressed = (prevKeys & Bit.Ability) !== 0;
  if (!pressed || wasPressed) {
    return { player, started: false };
  }
  const cooldownUntil = player.parryCooldownUntilTick ?? 0;
  if (cooldownUntil > tick) {
    return { player, started: false };
  }
  const activeMs = options.activeMs ?? PARRY_ACTIVE_MS;
  const cooldownMs = options.cooldownMs ?? PARRY_COOLDOWN_MS_DEFAULT;
  const dt = options.dtMs > 0 ? options.dtMs : 1;
  const activeTicks = Math.max(1, Math.ceil(activeMs / dt));
  const cooldownTicks = Math.max(1, Math.ceil(cooldownMs / dt));

  // Capture the aim direction (radians) at trigger time so a moving aim
  // doesn't change which side is covered mid-parry.
  const dx = player.aimX - player.x;
  const dy = player.aimY - player.y;
  const facing = dx === 0 && dy === 0 ? 0 : lutAtan2(dy, dx);

  return {
    player: {
      ...player,
      parryActiveUntilTick: Tick(tick + activeTicks),
      parryCooldownUntilTick: Tick(tick + cooldownTicks),
      parryFacing: facing,
    },
    started: true,
  };
}

/** True if the player has an active parry window covering this tick. */
export function isParryActive(player: PlayerEntity, tick: Tick): boolean {
  return (
    player.parryActiveUntilTick !== undefined &&
    player.parryActiveUntilTick > tick
  );
}

// ----- Shield ----------------------------------------------------------------

export type TickShieldOptions = {
  dtMs: number;
  /** Override max charge (e.g. shielded archetype). Defaults to SHIELD_MAX_CHARGE_DEFAULT. */
  maxCharge?: number;
  /** Override drain per second. Defaults to SHIELD_DRAIN_PER_SECOND. */
  drainPerSecond?: number;
  /** Override recharge per second. Defaults to SHIELD_RECHARGE_PER_SECOND. */
  rechargePerSecond?: number;
};

/**
 * Held-shield update. Mirrors MatchScene.updateShield: while the shield key is
 * held and charge remains, set shieldActive=true and drain charge; otherwise
 * deactivate and recharge.
 */
export function tickShield(
  player: PlayerEntity,
  currKeys: InputBitfield,
  options: TickShieldOptions,
): PlayerEntity {
  if (!player.alive) {
    return player.shieldActive
      ? { ...player, shieldActive: false }
      : player;
  }
  const dtSec = options.dtMs / 1000;
  const maxCharge = options.maxCharge ?? player.shieldMaxCharge ?? SHIELD_MAX_CHARGE_DEFAULT;
  const drainRate = options.drainPerSecond ?? SHIELD_DRAIN_PER_SECOND;
  const rechargeRate = options.rechargePerSecond ?? SHIELD_RECHARGE_PER_SECOND;

  // Default to a full bar when the field is missing entirely. New players
  // start with a full shield available.
  const currentCharge = player.shieldCharge ?? maxCharge;

  const wantsShield = (currKeys & Bit.Shield) !== 0;
  if (wantsShield && currentCharge > 0) {
    const drained = Math.max(0, currentCharge - drainRate * dtSec);
    return {
      ...player,
      shieldActive: drained > 0,
      shieldCharge: drained,
      shieldMaxCharge: maxCharge,
    };
  }

  // Not shielding (or out of charge): deactivate and recharge toward max.
  const recharged = Math.min(maxCharge, currentCharge + rechargeRate * dtSec);
  return {
    ...player,
    shieldActive: false,
    shieldCharge: recharged,
    shieldMaxCharge: maxCharge,
  };
}

// ----- Damage mitigation -----------------------------------------------------

export type DeflectResult = {
  /** Updated player (e.g. shield charge drained). */
  player: PlayerEntity;
  /** Final damage to apply (may be 0 if mitigated). */
  damage: number;
  /** True if the parry deflected the projectile (caller should destroy/bounce it). */
  deflected: boolean;
  /** True if the shield absorbed (some of) the damage. */
  shielded: boolean;
  /** True if the shield charge ran out as a result of this hit. */
  shieldPopped: boolean;
  /** True if a MIRROR shield absorbed the hit AND should bounce the shard back
   *  at the attacker (caller reflects it, like a parry). */
  shieldReflected: boolean;
};

export type DeflectOptions = {
  /** Blocked shield hits reflect the projectile back at the attacker. */
  mirrorShield?: boolean;
  /** Aim shield: the shield only blocks hits within the AIM arc. */
  directionalShield?: boolean;
  /** Widens the PARRY arc (Wide Parry card). 1 = default 60°. */
  parryCoverMultiplier?: number;
};

/**
 * Mitigation chain — call BEFORE subtracting health on a hit-confirmed event.
 *
 * Order:
 *   1. Active parry covering the projectile's incoming direction → deflect.
 *      Zero damage, returns `deflected: true`. Caller should destroy or bounce
 *      the projectile and emit a `parry-deflected` event.
 *   2. Active shield with positive charge → absorb the hit. Charge drains by
 *      `damage * SHIELD_HIT_DRAIN_MULTIPLIER`. Damage clamped to 0. If the
 *      drain takes the charge to 0, `shieldPopped` is true.
 *   3. Otherwise the damage passes through unchanged.
 */
export function tryDeflectDamage(
  player: PlayerEntity,
  projectile: Pick<ProjectileEntity, "id" | "x" | "y" | "vx" | "vy" | "damage"> | null,
  damage: number,
  tick: Tick,
  options: DeflectOptions = {},
): DeflectResult {
  if (damage <= 0 || !player.alive) {
    return {
      player,
      damage,
      deflected: false,
      shielded: false,
      shieldPopped: false,
      shieldReflected: false,
    };
  }

  // 1. Parry — only if the source direction is within ±arc/2 of the captured
  //    facing. We approximate the source direction from the projectile's
  //    velocity vector (it's flying *into* the player), or from its position
  //    relative to the player when velocity is unavailable.
  if (isParryActive(player, tick) && projectile !== null) {
    const facing = player.parryFacing ?? 0;
    const parryArc = PARRY_ARC_RADIANS * (options.parryCoverMultiplier ?? 1);
    if (isHitInParryArc(player, facing, projectile, parryArc)) {
      return {
        player,
        damage: 0,
        deflected: true,
        shielded: false,
        shieldPopped: false,
        shieldReflected: false,
      };
    }
  }

  // 1.5. AEGIS POWER-SLIDE (the right-click move) — a directional launch that
  //      PARRIES on the way in: a shot arriving within the frontal arc of the
  //      slide is DEFLECTED (0 damage AND the shard is reflected back at the
  //      attacker, exactly like the timed parry) — the parry, kept, but bolted
  //      onto the launch. At no shield-charge cost (the dash's own 520ms
  //      cooldown + air-charge gating bound it). Directional, NOT full invuln —
  //      a hit from the flank/back still lands. Guard direction is the slide's
  //      travel velocity (friction+gravity are suspended during the burst, so
  //      velocity == the aim-directional launch vector). Reuses the shield's
  //      120° frontal cone, widened by Wide Parry (parryCoverMultiplier) —
  //      Wide Parry lost its original target (the timed parry is now
  //      human-unreachable, subsumed by this slide) so it was repurposed
  //      onto the slide's arc instead of left dead. Clamped so a maxed-out
  //      stack can never reach a full 360° block.
  if (player.dashing === true && projectile !== null) {
    const facing =
      player.vx === 0 && player.vy === 0 ? 0 : lutAtan2(player.vy, player.vx);
    const slideArc = Math.min(
      2 * Math.PI - 0.01,
      SHIELD_AIM_ARC_RADIANS * (options.parryCoverMultiplier ?? 1),
    );
    if (isHitInParryArc(player, facing, projectile, slideArc)) {
      return {
        player,
        damage: 0,
        deflected: true, // parry-style: World.ts reflects the shard at the attacker
        shielded: false,
        shieldPopped: false,
        shieldReflected: false,
      };
    }
  }

  // 2. Shield — drain charge by damage * multiplier and zero the damage.
  if (player.shieldActive) {
    const currentCharge = player.shieldCharge ?? 0;
    if (currentCharge > 0) {
      // Aim shield: only blocks hits arriving within the AIM arc. A shot from
      // the flank/back gets through, so the player must face the threat.
      if (options.directionalShield && projectile !== null) {
        const dx = player.aimX - player.x;
        const dy = player.aimY - player.y;
        const facing = dx === 0 && dy === 0 ? 0 : lutAtan2(dy, dx);
        if (!isHitInParryArc(player, facing, projectile, SHIELD_AIM_ARC_RADIANS)) {
          return {
            player,
            damage,
            deflected: false,
            shielded: false,
            shieldPopped: false,
            shieldReflected: false,
          };
        }
      }
      const drained = Math.max(0, currentCharge - damage * SHIELD_HIT_DRAIN_MULTIPLIER);
      const popped = drained <= 0;
      return {
        player: {
          ...player,
          shieldCharge: drained,
          shieldActive: !popped,
        },
        damage: 0,
        deflected: false,
        shielded: true,
        shieldPopped: popped,
        // Mirror shield bounces the shard back at the attacker.
        shieldReflected: options.mirrorShield === true,
      };
    }
  }

  // 3. Pass-through.
  return {
    player,
    damage,
    deflected: false,
    shielded: false,
    shieldPopped: false,
    shieldReflected: false,
  };
}

/**
 * Test whether the incoming projectile sits within the parry arc anchored on
 * `parryFacing`. The "source direction" is the vector from the player back
 * toward the shard (i.e. the shard is *that way*), so we compare it against
 * the captured facing.
 */
export function isHitInParryArc(
  player: PlayerEntity,
  facing: number,
  projectile: Pick<ProjectileEntity, "x" | "y" | "vx" | "vy">,
  arcRadians: number = PARRY_ARC_RADIANS,
): boolean {
  // Direction to the projectile from the player. If the shard is in the same
  // half-plane as the parry facing, it's a candidate for deflection.
  const dx = projectile.x - player.x;
  const dy = projectile.y - player.y;
  const sourceAngle = dx === 0 && dy === 0
    ? // Degenerate — use opposite of velocity if available.
      lutAtan2(-projectile.vy, -projectile.vx)
    : lutAtan2(dy, dx);
  const delta = wrapAngle(sourceAngle - facing);
  return Math.abs(delta) <= arcRadians / 2;
}

function wrapAngle(angle: number): number {
  const TWO_PI = Math.PI * 2;
  let a = angle;
  while (a < -Math.PI) a += TWO_PI;
  while (a >= Math.PI) a -= TWO_PI;
  return a;
}

// Re-export the entity id type for callers that build SimEvents around the
// helpers in this file without importing types directly.
export type { EntityId };
