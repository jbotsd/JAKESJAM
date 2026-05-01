import type { ChaosModifierId, ProjectileShape } from "../types/game";

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

export const projectileShapes: ProjectileShape[] = ["circle", "triangle", "square", "hexagon", "orb"];

export function getChaosModifiers(ids: ChaosModifierId[]): ChaosModifierDefinition[] {
  const byId = new Map(chaosModifiers.map((modifier) => [modifier.id, modifier]));
  return ids.flatMap((id) => {
    const modifier = byId.get(id);
    return modifier ? [modifier] : [];
  });
}
