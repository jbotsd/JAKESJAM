// Weapon definitions. Pure data. Lives in sim/ so authority + prediction
// share one source of truth for base weapon stats.

import type { ClassId, WeaponDefinition } from "./cardTypes.js";

export const starterWeapon: WeaponDefinition = {
  id: "starter-pistol",
  name: "Crystal Blaster / Scrap Rifle",
  weaponClass: "baseline",
  delivery: "projectile",
  // Bumped 10->12 (balance audit): round-1, pre-card duels sat at a
  // 10-shot/2.25s sustained TTK — spongy next to the genre (Duck
  // Game/Towerfall are one-hit; Stick Fight is 3-5 hits). 12 dmg = 8
  // shots/~1.75s, snappier without touching card-curve pacing (the max
  // damage-stack path stays well clear of the 1.5s TTK guardrail).
  damage: 12,
  fireRate: 4,
  magazineSize: 8,
  reloadSeconds: 1.1,
  projectileSpeed: 650,
  projectileLifetimeSeconds: 1.2,
  spreadRadians: 0.03,
  recoilImpulse: 95,
  knockbackImpulse: 120,
  projectile: {
    shape: "hexagon",
    count: 1,
    rangePx: 720,
    speedMultiplier: 1,
    sizeMultiplier: 1,
    recoilMultiplier: 1,
    pathing: "straight",
    element: "crystal",
    impact: "none",
    lifetimeMultiplier: 1,
    gravityScale: 0,
    homingStrength: 0,
    accelerationMultiplier: 0,
    bounces: 0,
    impactRadiusPx: 0,
    pierceCount: 0,
    splitCount: 0,
    slowMultiplier: 1,
  },
};

/**
 * Priest / Syzygist baseline (docs/classes-goal.md "Priest / Syzygist":
 * "Baseline attack: modest projectile (wizard's starter, detuned)"; docs/
 * class-overhaul-workboard.md chunk 0.3). A copy of `starterWeapon` — same
 * hexagon shape, same fire rate, same everything else — with damage cut
 * from 12 to 9 (25% detune). Neutral TTK moves from ~2.08s to ~2.78s, still
 * comfortably inside the 1.8-3.5s combat-balance-ttk band (weaponBuild.ts
 * TTK_FLOOR_S/TTK_CEILING_S), so it reads as a genuinely weaker gun rather
 * than a broken one — the honest cost of a kit whose real power lives in
 * curses + lifesteal, not the bolt. Keeps the SAME wire id ("starter-pistol")
 * — this is a base-STAT reskin selected by class, not a second weapon slot —
 * so it never appears in the `weapons` export below (weaponDataParity.test.ts
 * asserts `weapon_count() === 1`; that Zig-side count is unaffected, since
 * Zig only ever sees the packed, already-class-resolved fire config —
 * see sim/src/world.zig's "parity with the TS orchestrator's
 * resolvePlayerBuild" comment).
 */
export const priestStarterWeapon: WeaponDefinition = {
  ...starterWeapon,
  damage: 9,
  projectile: { ...starterWeapon.projectile },
};

/**
 * Paladin/Kindred baseline (class-overhaul-workboard.md chunk 2.5,
 * docs/classes-goal.md "E-KEY RULING": the ultimate IS the composed
 * Emission through the resolved build). Kindled Edge REPLACES this weapon
 * entirely for Paladin's actual Fire input (World.ts: "Ninja/Paladin: Fire
 * is the SAME 'primary attack' input as every other class, but the chassis
 * verb is a melee arc... this branch captures the rising edge for loop 2's
 * FSM instead of ever calling stepWeapon") — so `paladinStarterWeapon`'s
 * ONLY live consumer is `resolveEmission` (verified class-aware wiring,
 * emissionClassAware.test.ts / 0.2), which reads the resolved build
 * regardless of whether the chassis ever fires it conventionally. A copy
 * of `starterWeapon` re-tuned toward "heavier, slower, bigger" — the task
 * brief's explicit "heavier/tankier cast" ask — rather than the wizard's
 * fast/light bolt: damage 12→15, fireRate 4→3 (TTK stays inside the
 * combat-balance-ttk band: 100/(15×3)≈2.22s, same neighbourhood as
 * starterWeapon's ~2.08s — weaponBuild.ts's TTK_FLOOR_S/TTK_CEILING_S,
 * verified even though Paladin never actually fires this weapon, the same
 * "still a real, functional gun" discipline priestStarterWeapon's own test
 * applies), projectileSpeed 650→520 (a heavier bolt arrives slower),
 * sizeMultiplier 1→1.15 (reads bigger). Same SAME-wire-id contract as
 * priestStarterWeapon (never appears in the `weapons` export below;
 * weaponDataParity.test.ts's `weapon_count() === 1` is unaffected).
 */
export const paladinStarterWeapon: WeaponDefinition = {
  ...starterWeapon,
  damage: 15,
  fireRate: 3,
  projectileSpeed: 520,
  projectile: { ...starterWeapon.projectile, sizeMultiplier: 1.15 },
};

/**
 * Class-gated base-weapon selection. Same doctrine as `classModifiers` on
 * CardDefinition (cardTypes.ts header: "REPLACES wholesale... class-blind
 * fallback is total and silent-by-design") applied one level up — to the
 * WEAPON a class starts with, since the baseline has no card in hand to
 * hang a `classModifiers` entry off. Omitted/unknown class or any class
 * with no authored entry here falls back to `starterWeapon`, byte-identical
 * to every existing call site that resolves a class-blind build today.
 */
const CLASS_BASE_WEAPON: Partial<Record<ClassId, WeaponDefinition>> = {
  priest: priestStarterWeapon,
  paladin: paladinStarterWeapon,
};

export function baseWeaponForClass(classId?: ClassId): WeaponDefinition {
  if (classId) {
    const override = CLASS_BASE_WEAPON[classId];
    if (override) return override;
  }
  return starterWeapon;
}

export const weapons = [starterWeapon] as const;
