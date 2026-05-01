// Weapon definitions. Pure data. Lives in sim/ so authority + prediction
// share one source of truth for base weapon stats.

import type { WeaponDefinition } from "./cardTypes.js";

export const starterWeapon: WeaponDefinition = {
  id: "starter-pistol",
  name: "Crystal Blaster / Scrap Rifle",
  weaponClass: "baseline",
  delivery: "projectile",
  damage: 10,
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

export const weapons = [starterWeapon] as const;
