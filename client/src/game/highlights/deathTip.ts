// Pure death-tip picker: at most ONE tip, or null when no evidence.
// Silence preferred over generic "git gud".

export type DeathTipSignal = {
  /** Local player was killed by a projectile this life. */
  diedToProjectile?: boolean;
  /** Parry was available / recently usable when they died. */
  parryAvailableRecently?: boolean;
  /** Death came from long range. */
  longRange?: boolean;
  /** Movement/dodge was available. */
  dodgeAvailable?: boolean;
};

const PARRY_TIP = "Hold right-click (or parry) to deflect incoming fire.";
const DODGE_TIP = "You had room to dodge that shot — keep moving.";

/**
 * Returns at most one contextual tip string, or null.
 * Priority: parry signal > long-range dodge > none.
 */
export function pickDeathTip(signal: DeathTipSignal | null | undefined): string | null {
  if (!signal) return null;
  if (signal.diedToProjectile && signal.parryAvailableRecently) {
    return PARRY_TIP;
  }
  if (signal.longRange && signal.dodgeAvailable) {
    return DODGE_TIP;
  }
  return null;
}
