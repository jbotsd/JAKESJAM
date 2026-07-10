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
import {
  makeDestructibleFlashState,
  produceDestructibles,
  produceSatellites,
  type DestructibleRenderModel,
  type SatelliteRenderModel,
} from "./renderContract";

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

  private readonly flashState = makeDestructibleFlashState();
  private readonly destructibleModels: DestructibleRenderModel[] = [];
  private readonly satelliteModels: SatelliteRenderModel[] = [];
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
    this.flashState.prevHealth.clear();
    this.flashState.flashUntilMs.clear();
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
    // Contract producer owns the damage-flash derivation + bookkeeping.
    const count = produceDestructibles(state, nowMs, this.flashState, this.destructibleModels);
    for (let i = 0; i < count; i++) {
      const m = this.destructibleModels[i]!;
      this.cfg.drawDestructible(graphics, m.entity, m.flashing);
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
    // Contract producer resolves the orbit (owner lookup + trig).
    const count = produceSatellites(state, this.satelliteModels);
    const seen = this.seenScratch;
    seen.clear();
    for (let i = 0; i < count; i++) {
      const m = this.satelliteModels[i]!;
      seen.add(m.id);
      let arc = this.satelliteSprites.get(m.id);
      if (!arc) {
        arc = this.scene.add.circle(m.x, m.y, 5, 0xfff7d6, 0.92);
        arc.setStrokeStyle(2, 0xffd166, 0.7);
        arc.setDepth(7);
        this.satelliteSprites.set(m.id, arc);
      }
      arc.setPosition(m.x, m.y);
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
