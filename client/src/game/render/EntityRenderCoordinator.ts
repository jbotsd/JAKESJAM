// Phase C2a of the architecture deepening plan
// (/home/jimothy/.claude/plans/enchanted-juggling-cocke.md).
//
// Owns the per-frame state-driven render systems that are pure
// translations from `WorldState` to Phaser sprites/graphics:
//
//   - projectile sprites
//   - satellite sprites
//   - destructible graphics (with damage-flash flash bookkeeping)
//   - fire-patch graphics
//   - pickup graphics
//
// Player rigs stay in OnlineMatchScene because their lifecycle
// couples to kill-streak detection + character resolution + the
// local-vs-remote distinction. C2b extracts the remaining
// scene-bound concerns (sim-event routing + UI overlay state).
//
// The coordinator's `update(state, deltaMs, nowMs)` is the single
// per-frame entry point. The owning scene calls it once per RAF.
// On scene shutdown, `destroy()` cleans up the graphics objects.

import Phaser from "phaser";
import type {
  DestructibleEntity,
  ElementType,
  FireEntity,
  PickupEntity,
  PlayerId,
  WorldState,
} from "../../sim/types";

const PROJECTILE_RADIUS_DEFAULT = 6;
const DAMAGE_FLASH_MS = 110;

/**
 * Resolves projectile colour. Caller injects so the coordinator
 * doesn't depend on the scene's per-player colour table.
 */
export type ProjectileColorResolver = (
  element: ElementType,
  ownerId: PlayerId | null,
) => number;

/**
 * Draws a single destructible into a shared graphics buffer.
 * Same shape as the OnlineMatchScene-local helpers.
 */
export type DestructibleDrawer = (
  graphics: Phaser.GameObjects.Graphics,
  obj: DestructibleEntity,
  flashing: boolean,
) => void;

export type FireDrawer = (
  graphics: Phaser.GameObjects.Graphics,
  fire: FireEntity,
  nowMs: number,
) => void;

export type PickupDrawer = (
  graphics: Phaser.GameObjects.Graphics,
  pickup: PickupEntity,
  nowMs: number,
) => void;

export type EntityRenderConfig = {
  projectileColor: ProjectileColorResolver;
  drawDestructible: DestructibleDrawer;
  drawFirePatch: FireDrawer;
  drawPickup: PickupDrawer;
};

export class EntityRenderCoordinator {
  private readonly scene: Phaser.Scene;
  private readonly cfg: EntityRenderConfig;

  private readonly projectileSprites = new Map<number, Phaser.GameObjects.Arc>();
  private readonly satelliteSprites = new Map<number, Phaser.GameObjects.Arc>();
  private readonly destructibleGraphics: Phaser.GameObjects.Graphics;
  private readonly fireGraphics: Phaser.GameObjects.Graphics;
  private readonly pickupGraphics: Phaser.GameObjects.Graphics;

  private readonly prevDestructibleHealth = new Map<number, number>();
  private readonly destructibleFlashUntilMs = new Map<number, number>();

  constructor(scene: Phaser.Scene, cfg: EntityRenderConfig) {
    this.scene = scene;
    this.cfg = cfg;
    this.pickupGraphics = scene.add.graphics();
    this.pickupGraphics.setDepth(2);
    this.destructibleGraphics = scene.add.graphics();
    this.destructibleGraphics.setDepth(3);
    this.fireGraphics = scene.add.graphics();
    this.fireGraphics.setDepth(4);
  }

  /**
   * Per-frame entry. Reads `state` and updates all 5 render
   * subsystems (projectiles / satellites / destructibles / fire /
   * pickups) in a single call.
   */
  update(state: WorldState, _deltaMs: number, nowMs: number): void {
    this.renderProjectiles(state);
    this.renderDestructibles(state, nowMs);
    this.renderFirePatches(state, nowMs);
    this.renderPickups(state, nowMs);
    this.renderSatellites(state);
  }

  /** Destroy all owned graphics. Called from scene shutdown. */
  destroy(): void {
    for (const arc of this.projectileSprites.values()) arc.destroy();
    this.projectileSprites.clear();
    for (const arc of this.satelliteSprites.values()) arc.destroy();
    this.satelliteSprites.clear();
    this.destructibleGraphics.destroy();
    this.fireGraphics.destroy();
    this.pickupGraphics.destroy();
    this.prevDestructibleHealth.clear();
    this.destructibleFlashUntilMs.clear();
  }

  private renderProjectiles(state: WorldState): void {
    const seen = new Set<number>();
    for (const [idStr, proj] of Object.entries(state.projectiles)) {
      const id = Number(idStr);
      seen.add(id);
      const color = this.cfg.projectileColor(
        proj.element as ElementType,
        proj.ownerId,
      );
      let arc = this.projectileSprites.get(id);
      if (!arc) {
        arc = this.scene.add.circle(
          proj.x,
          proj.y,
          proj.radius || PROJECTILE_RADIUS_DEFAULT,
          color,
        );
        arc.setDepth(6);
        this.projectileSprites.set(id, arc);
      }
      arc.setPosition(proj.x, proj.y);
      arc.setRadius(proj.radius || PROJECTILE_RADIUS_DEFAULT);
      arc.setFillStyle(color);
    }
    for (const [id, arc] of this.projectileSprites) {
      if (!seen.has(id)) {
        arc.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

  private renderDestructibles(state: WorldState, nowMs: number): void {
    const graphics = this.destructibleGraphics;
    graphics.clear();
    const seen = new Set<number>();
    for (const [idStr, obj] of Object.entries(state.destructibles)) {
      const id = Number(idStr);
      seen.add(id);
      const prev = this.prevDestructibleHealth.get(id);
      if (prev !== undefined && obj.health < prev) {
        this.destructibleFlashUntilMs.set(id, nowMs + DAMAGE_FLASH_MS);
      }
      this.prevDestructibleHealth.set(id, obj.health);
      const flashing = (this.destructibleFlashUntilMs.get(id) ?? 0) > nowMs;
      this.cfg.drawDestructible(graphics, obj, flashing);
    }
    for (const id of this.prevDestructibleHealth.keys()) {
      if (!seen.has(id)) {
        this.prevDestructibleHealth.delete(id);
        this.destructibleFlashUntilMs.delete(id);
      }
    }
  }

  private renderFirePatches(state: WorldState, nowMs: number): void {
    const graphics = this.fireGraphics;
    graphics.clear();
    for (const fire of Object.values(state.firePatches)) {
      this.cfg.drawFirePatch(graphics, fire, nowMs);
    }
  }

  private renderPickups(state: WorldState, nowMs: number): void {
    const graphics = this.pickupGraphics;
    graphics.clear();
    for (const pickup of Object.values(state.pickups)) {
      this.cfg.drawPickup(graphics, pickup, nowMs);
    }
  }

  private renderSatellites(state: WorldState): void {
    const seen = new Set<number>();
    for (const [idStr, sat] of Object.entries(state.satellites)) {
      const id = Number(idStr);
      seen.add(id);
      const owner = sat.ownerId !== null ? state.players[sat.ownerId] : undefined;
      if (!owner) continue;
      const x = owner.x + Math.cos(sat.angle) * sat.orbitRadius;
      const y = owner.y + Math.sin(sat.angle) * sat.orbitRadius;
      let arc = this.satelliteSprites.get(id);
      if (!arc) {
        arc = this.scene.add.circle(x, y, 5, 0xfff7d6, 0.92);
        arc.setStrokeStyle(2, 0xffd166, 0.7);
        arc.setDepth(7);
        this.satelliteSprites.set(id, arc);
      }
      arc.setPosition(x, y);
    }
    for (const [id, arc] of this.satelliteSprites) {
      if (!seen.has(id)) {
        arc.destroy();
        this.satelliteSprites.delete(id);
      }
    }
  }
}
