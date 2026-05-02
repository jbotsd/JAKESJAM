// MatchLogic — pure functions for the offline match's gameplay calculations.
//
// These were extracted from MatchScene to give the logic a stable, testable
// home that does not depend on Phaser. All functions here are pure: they take
// values and return values, with no side-effects and no scene references.
//
// Depth: buff/debuff timer tick-down, parry geometry computation, damage
// factor resolution, and move-speed modifier are all behind small signatures.

// ─── Buff / debuff tick-down ──────────────────────────────────────────────────

export type BuffTimers = {
  overchargeMs: number;
  damageAmpMs: number;
  speedBoostMs: number;
  meleeModeMs: number;
  slowDebuffMs: number;
  vulnerabilityMs: number;
  blockJammerMs: number;
  temporaryShieldMs: number;
};

/**
 * Tick all buff/debuff timers down by `deltaMs`. Floors at zero.
 * Pure: returns a new BuffTimers record.
 */
export function tickBuffTimers(timers: BuffTimers, deltaMs: number): BuffTimers {
  return {
    overchargeMs: Math.max(0, timers.overchargeMs - deltaMs),
    damageAmpMs: Math.max(0, timers.damageAmpMs - deltaMs),
    speedBoostMs: Math.max(0, timers.speedBoostMs - deltaMs),
    meleeModeMs: Math.max(0, timers.meleeModeMs - deltaMs),
    slowDebuffMs: Math.max(0, timers.slowDebuffMs - deltaMs),
    vulnerabilityMs: Math.max(0, timers.vulnerabilityMs - deltaMs),
    blockJammerMs: Math.max(0, timers.blockJammerMs - deltaMs),
    temporaryShieldMs: Math.max(0, timers.temporaryShieldMs - deltaMs),
  };
}

// ─── Parry geometry ───────────────────────────────────────────────────────────

const PARRY_BASE_ARC_RADIANS = Math.PI * 0.72;
const PARRY_BASE_RANGE = 98;
const PARRY_COOLDOWN_MS = 4300;

/**
 * Arc width in radians for the parry window, clamped to ~314 degrees.
 * `parryCoverMultiplier` comes from the resolved weapon build.
 */
export function parryArcRadians(parryCoverMultiplier: number): number {
  return Math.min(Math.PI * 1.55, PARRY_BASE_ARC_RADIANS * parryCoverMultiplier);
}

/**
 * Maximum parry hit-detection range in pixels.
 */
export function parryRange(parryCoverMultiplier: number): number {
  return PARRY_BASE_RANGE * Math.sqrt(parryCoverMultiplier);
}

/**
 * Full cooldown window before the parry can be re-activated.
 */
export function parryCooldownMs(parryCooldownMultiplier: number): number {
  return PARRY_COOLDOWN_MS * parryCooldownMultiplier;
}

// ─── Move-speed modifier ──────────────────────────────────────────────────────

const SLOW_DEBUFF_MULTIPLIER = 0.62;

/**
 * Compose the local player's effective move-speed multiplier from the
 * weapon build's base value and any active debuff.
 */
export function moveSpeedModifier(
  weaponMoveSpeedMultiplier: number,
  slowDebuffMs: number,
): number {
  let multiplier = weaponMoveSpeedMultiplier;
  if (slowDebuffMs > 0) {
    multiplier *= SLOW_DEBUFF_MULTIPLIER;
  }
  return multiplier;
}

// ─── Damage factors ───────────────────────────────────────────────────────────

const VULNERABILITY_MULTIPLIER = 1.38;

/**
 * Incoming damage factor for the local player. Multiplies raw damage when
 * the vulnerability debuff is active.
 */
export function incomingDamageFactor(vulnerabilityMs: number): number {
  return vulnerabilityMs > 0 ? VULNERABILITY_MULTIPLIER : 1;
}

/**
 * Outgoing damage factor for the local player. Multiplies raw damage when
 * the damageAmp buff is active (using the weapon-build's multiplier).
 */
export function outgoingDamageFactor(
  damageAmpMs: number,
  weaponDamageMultiplier: number,
): number {
  let factor = weaponDamageMultiplier;
  if (damageAmpMs > 0) {
    // damageAmpMs > 0 means the damage-amp pickup is active; apply a flat +38%.
    factor *= VULNERABILITY_MULTIPLIER; // same constant as incoming — intentional symmetry
  }
  return factor;
}
