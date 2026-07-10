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
import type { ParticlePool } from "../systems/ParticlePool";
import { ProjectileVfx } from "./ProjectileVfx";

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

  private readonly satelliteSprites = new Map<number, Phaser.GameObjects.Arc>();
  private readonly destructibleGraphics: Phaser.GameObjects.Graphics;
  private readonly fireGraphics: Phaser.GameObjects.Graphics;
  private readonly pickupGraphics: Phaser.GameObjects.Graphics;
  /** High-fidelity projectile bodies/trails/muzzle/impact (docs/vfx-spec.md).
   *  Replaces the old flat-circle sprites on the live path. */
  private readonly projectileVfx: ProjectileVfx;

  private readonly prevDestructibleHealth = new Map<number, number>();
  private readonly destructibleFlashUntilMs = new Map<number, number>();
  /** Per-frame scratch — reused so the render loop allocates nothing
   *  (the old `new Set()` + `Object.entries()` pair churned every frame). */
  private readonly seenScratch = new Set<number>();
  private readonly staleScratch: number[] = [];

  constructor(scene: Phaser.Scene, cfg: EntityRenderConfig, pool: ParticlePool | null = null) {
    this.scene = scene;
    this.cfg = cfg;
    this.projectileVfx = new ProjectileVfx(scene, pool);
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
    this.projectileVfx.destroy();
    for (const arc of this.satelliteSprites.values()) arc.destroy();
    this.satelliteSprites.clear();
    this.destructibleGraphics.destroy();
    this.fireGraphics.destroy();
    this.pickupGraphics.destroy();
    this.prevDestructibleHealth.clear();
    this.destructibleFlashUntilMs.clear();
  }

  private renderProjectiles(state: WorldState): void {
    // Delegated to ProjectileVfx: shaped/glowing/trailed bodies + muzzle
    // flash on spawn + element impact/fizzle on despawn. Reads the same
    // element colour resolver the flat-circle path used.
    this.projectileVfx.render(state, this.cfg.projectileColor);
  }

  private renderDestructibles(state: WorldState, nowMs: number): void {
    const graphics = this.destructibleGraphics;
    graphics.clear();
    const seen = this.seenScratch;
    seen.clear();
    for (const idStr in state.destructibles) {
      const obj = state.destructibles[idStr as unknown as keyof typeof state.destructibles]!;
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
    // Two-pass delete via scratch list — deleting while iterating a Map's
    // keys() is legal but the scratch keeps intent explicit and alloc-free.
    const stale = this.staleScratch;
    stale.length = 0;
    for (const id of this.prevDestructibleHealth.keys()) {
      if (!seen.has(id)) stale.push(id);
    }
    for (const id of stale) {
      this.prevDestructibleHealth.delete(id);
      this.destructibleFlashUntilMs.delete(id);
    }
  }

  private renderFirePatches(state: WorldState, nowMs: number): void {
    const graphics = this.fireGraphics;
    graphics.clear();
    for (const id in state.firePatches) {
      this.cfg.drawFirePatch(graphics, state.firePatches[id as unknown as keyof typeof state.firePatches]!, nowMs);
    }
  }

  private renderPickups(state: WorldState, nowMs: number): void {
    const graphics = this.pickupGraphics;
    graphics.clear();
    for (const id in state.pickups) {
      this.cfg.drawPickup(graphics, state.pickups[id as unknown as keyof typeof state.pickups]!, nowMs);
    }
  }

  private renderSatellites(state: WorldState): void {
    const seen = this.seenScratch;
    seen.clear();
    for (const idStr in state.satellites) {
      const sat = state.satellites[idStr as unknown as keyof typeof state.satellites]!;
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
    const stale = this.staleScratch;
    stale.length = 0;
    for (const id of this.satelliteSprites.keys()) {
      if (!seen.has(id)) stale.push(id);
    }
    for (const id of stale) {
      this.satelliteSprites.get(id)?.destroy();
      this.satelliteSprites.delete(id);
    }
  }
}
