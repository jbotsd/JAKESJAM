// Weapon firing — fire-rate gating, recoil, projectile spawn. First cut wires
// the starter pistol with constants matching the existing client weapon data.
// Card-driven mutators (homing, split, pierce, bounce, count, spread) come in
// a follow-up pass keyed off PlayerEntity.cards.

import { spawnProjectile, type ProjectileSpawnParams } from "./projectile.js";
import type { EntityId, PlayerEntity, ProjectileEntity, Vec2 } from "./types.js";

export const STARTER_PISTOL = {
  damage: 10,
  speed: 720,
  lifetimeMs: 1200,
  cooldownMs: 180,
  recoilImpulse: 145,
  spreadRadians: 0.05,
  projectileRadius: 7,
} as const;

export type FireResult = {
  player: PlayerEntity;
  projectiles: ProjectileEntity[];
  fired: boolean;
};

/**
 * Try to fire the player's weapon this tick. Returns the new player state
 * (cooldown ticked, recoil applied if fired) and any projectiles to insert
 * into the world.
 *
 * `fireRequested` should be the value of the Fire input bit on this tick.
 * `nextEntityId` is a callback that returns the next free entity id; the world
 * is responsible for keeping its own id counter consistent.
 */
export function stepWeapon(
  player: PlayerEntity,
  fireRequested: boolean,
  aim: Vec2,
  dtMs: number,
  nextEntityId: () => EntityId,
): FireResult {
  const next: PlayerEntity = {
    ...player,
    fireCooldownMs: Math.max(0, player.fireCooldownMs - dtMs),
  };

  if (!fireRequested || !next.alive || next.fireCooldownMs > 0) {
    return { player: next, projectiles: [], fired: false };
  }

  const muzzle: Vec2 = playerMuzzlePosition(next, aim);
  const aimAngle = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x);

  const params: ProjectileSpawnParams = {
    ownerId: next.id,
    origin: muzzle,
    aimAngle,
    speed: STARTER_PISTOL.speed,
    damage: STARTER_PISTOL.damage,
    lifetimeMs: STARTER_PISTOL.lifetimeMs,
    radius: STARTER_PISTOL.projectileRadius,
    shape: "circle",
    pathing: "straight",
    element: "crystal",
  };
  const projectile = spawnProjectile(nextEntityId(), params);

  // Apply recoil — push the player opposite to the aim direction.
  next.vx -= Math.cos(aimAngle) * STARTER_PISTOL.recoilImpulse;
  next.vy -= Math.sin(aimAngle) * STARTER_PISTOL.recoilImpulse * 0.45;

  next.fireCooldownMs = STARTER_PISTOL.cooldownMs;
  next.ammo = Math.max(0, next.ammo - 1);

  return { player: next, projectiles: [projectile], fired: true };
}

/**
 * Where the projectile spawns from on the player rig. Approximate match to the
 * existing MatchScene muzzle math, kept simple here since the sim doesn't know
 * about visual rig pose (crouching offset etc. — close enough for hitscan).
 */
function playerMuzzlePosition(player: PlayerEntity, aim: Vec2): Vec2 {
  const reach = 22;
  const dx = aim.x - player.x;
  const dy = aim.y - player.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: player.x + (dx / len) * reach,
    y: player.y + (dy / len) * reach,
  };
}
