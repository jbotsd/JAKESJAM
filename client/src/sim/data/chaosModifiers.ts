// Pure-data chaos modifier definitions and resolver.
//
// Lives in sim/ so both the client (offline practice + prediction) and the
// authoritative Bun server can read the same numbers when applying per-tick
// effects. No Phaser, no DOM, no wall-clock — just data + a deterministic
// reducer that collapses a list of modifier ids into one ChaosProfile the
// World.step path consumes.

import type { ProjectileShape } from "../types.js";

/** Canonical list of chaos modifier ids. Use as the single source of truth;
 *  `ChaosModifierId` is derived from this so adding/removing a modifier is a
 *  one-line change. */
export const CHAOS_MODIFIER_IDS = [
  "low-gravity",
  "slow-motion",
  "golden-gun",
  "slappers-only",
  "fire-hazard",
  "random-shapes",
  "max-recoil",
] as const;

export type ChaosModifierId = typeof CHAOS_MODIFIER_IDS[number];

/** Type guard for trust-boundary input (localStorage, URL params, WS payloads). */
export function isChaosModifierId(value: unknown): value is ChaosModifierId {
  return typeof value === "string" &&
    (CHAOS_MODIFIER_IDS as readonly string[]).includes(value);
}

/** Validates a `localStorage`-style JSON payload of chaos modifier ids.
 *  Returns `[]` on any parse error or shape mismatch. */
export function parseStoredChaosModifiers(raw: string | null): ChaosModifierId[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn("[chaosModifiers] failed to parse stored modifier list", e);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isChaosModifierId);
}

/**
 * Resolved per-tick chaos effect bundle. Multiplicatively composed across the
 * active modifiers. Booleans are OR-ed. `fireHazardIntervalMs` is the smallest
 * defined interval among active modifiers (only `fire-hazard` sets it today).
 *
 * Shape mirrors `ChaosProfile` in MatchScene's offline path so the tuning
 * numbers stay in one place. Additive new fields should default to "no
 * effect" so older WorldStates without `chaosModifierIds` remain compatible.
 */
export type ChaosProfile = {
  gravityMultiplier: number;
  timeScale: number;
  damageMultiplier: number;
  fireRateMultiplier: number;
  recoilMultiplier: number;
  disableProjectiles: boolean;
  randomShapes: boolean;
  fireHazardActive: boolean;
  fireHazardIntervalMs?: number;
};

export type ChaosModifierDefinition = {
  id: ChaosModifierId;
  name: string;
  description: string;
  gravityMultiplier: number;
  timeScale: number;
  damageMultiplier: number;
  fireRateMultiplier: number;
  recoilMultiplier: number;
  disableProjectiles: boolean;
  randomProjectileShapes: boolean;
  fireHazardIntervalMs?: number;
};

const defaults = {
  gravityMultiplier: 1,
  timeScale: 1,
  damageMultiplier: 1,
  fireRateMultiplier: 1,
  recoilMultiplier: 1,
  disableProjectiles: false,
  randomProjectileShapes: false,
};

export const chaosModifiers: ChaosModifierDefinition[] = [
  {
    ...defaults,
    id: "low-gravity",
    name: "Low Grav",
    description: "Floatier jumps and slower falls.",
    gravityMultiplier: 0.46,
  },
  {
    ...defaults,
    id: "slow-motion",
    name: "Slo Mo",
    description: "Whole match runs at half tempo.",
    timeScale: 0.55,
  },
  {
    ...defaults,
    id: "golden-gun",
    name: "Golden Gun",
    description: "Huge damage, slow firing, big punishment.",
    damageMultiplier: 9,
    fireRateMultiplier: 0.28,
    recoilMultiplier: 1.8,
  },
  {
    ...defaults,
    id: "slappers-only",
    name: "Slappers Only",
    description: "No projectiles; recoil shove only.",
    disableProjectiles: true,
    recoilMultiplier: 2.8,
  },
  {
    ...defaults,
    id: "fire-hazard",
    name: "Fire Hazard",
    description: "Arena spits temporary fire patches.",
    fireHazardIntervalMs: 2400,
  },
  {
    ...defaults,
    id: "random-shapes",
    name: "Random Shapes",
    description: "Every shot rerolls projectile shape.",
    randomProjectileShapes: true,
  },
  {
    ...defaults,
    id: "max-recoil",
    name: "Max Recoil",
    description: "Every shot kicks hard.",
    recoilMultiplier: 3.6,
  },
];

export const projectileShapes: ProjectileShape[] = [
  "circle",
  "triangle",
  "square",
  "hexagon",
  "orb",
  "x",
  "bar",
];

const modifierById = new Map<ChaosModifierId, ChaosModifierDefinition>(
  chaosModifiers.map((modifier) => [modifier.id, modifier]),
);

export function getChaosModifiers(
  ids: readonly ChaosModifierId[],
): ChaosModifierDefinition[] {
  return ids.flatMap((id) => {
    const modifier = modifierById.get(id);
    return modifier ? [modifier] : [];
  });
}

/**
 * Identity profile: no modifiers active. Used as the default whenever a
 * caller omits `chaosModifierIds` (which is most of the determinism-test
 * surface area today).
 */
export const NEUTRAL_CHAOS_PROFILE: ChaosProfile = {
  gravityMultiplier: 1,
  timeScale: 1,
  damageMultiplier: 1,
  fireRateMultiplier: 1,
  recoilMultiplier: 1,
  disableProjectiles: false,
  randomShapes: false,
  fireHazardActive: false,
  fireHazardIntervalMs: undefined,
};

/**
 * Reduce a list of chaos modifier ids into one ChaosProfile. Multiplicative
 * for numeric fields, OR for boolean fields, min-of-defined for the fire
 * hazard interval.
 */
export function getChaosProfile(
  ids: readonly ChaosModifierId[] | undefined,
): ChaosProfile {
  if (!ids || ids.length === 0) return NEUTRAL_CHAOS_PROFILE;
  const modifiers = getChaosModifiers(ids);
  if (modifiers.length === 0) return NEUTRAL_CHAOS_PROFILE;

  let gravityMultiplier = 1;
  let timeScale = 1;
  let damageMultiplier = 1;
  let fireRateMultiplier = 1;
  let recoilMultiplier = 1;
  let disableProjectiles = false;
  let randomShapes = false;
  let fireHazardActive = false;
  let fireHazardIntervalMs: number | undefined;

  for (const m of modifiers) {
    gravityMultiplier *= m.gravityMultiplier;
    timeScale *= m.timeScale;
    damageMultiplier *= m.damageMultiplier;
    fireRateMultiplier *= m.fireRateMultiplier;
    recoilMultiplier *= m.recoilMultiplier;
    disableProjectiles = disableProjectiles || m.disableProjectiles;
    randomShapes = randomShapes || m.randomProjectileShapes;
    if (m.fireHazardIntervalMs !== undefined) {
      fireHazardActive = true;
      fireHazardIntervalMs =
        fireHazardIntervalMs === undefined
          ? m.fireHazardIntervalMs
          : Math.min(fireHazardIntervalMs, m.fireHazardIntervalMs);
    }
  }

  return {
    gravityMultiplier,
    timeScale,
    damageMultiplier,
    fireRateMultiplier,
    recoilMultiplier,
    disableProjectiles,
    randomShapes,
    fireHazardActive,
    fireHazardIntervalMs,
  };
}
