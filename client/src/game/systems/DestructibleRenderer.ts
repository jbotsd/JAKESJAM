import type Phaser from "phaser";
import type { DestructibleKind, Vec2 } from "../types/game";
import type { ProjectileTarget } from "./ProjectileSystem";

/**
 * Shape required by the renderer. Mirrors the local `ArenaDestructible`
 * type kept in MatchScene.ts — kept here as a structural type so the
 * renderer doesn't have to import the scene's private alias.
 */
export type RenderableDestructible = ProjectileTarget & {
  kind: DestructibleKind;
  health: number;
  maxHealth: number;
  burnMs: number;
};

/**
 * Pure presentation system for arena destructibles.
 *
 * Owns:
 *  - a single Phaser.Graphics layer
 *  - the per-frame redraw of all destructibles based on their current state
 *
 * Has no opinions about destructible *behavior* — the scene still owns
 * health/burn updates and calls `redraw(states)` whenever they change.
 */
export class DestructibleRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
  }

  redraw(destructibles: ReadonlyArray<RenderableDestructible>): void {
    const graphics = this.graphics;
    graphics.clear();

    for (const object of destructibles) {
      if (!object.alive) {
        continue;
      }

      const { position, size } = object;
      const healthRatio = object.health / object.maxHealth;
      const color = object.burnMs > 0 ? 0xff7a18 : destructibleColor(object.kind);

      graphics.fillStyle(0x07101c, 0.45);
      graphics.fillRoundedRect(
        position.x - size.x / 2 - 3,
        position.y - size.y / 2 - 3,
        size.x + 6,
        size.y + 6,
        3,
      );

      graphics.fillStyle(color, object.kind === "mine" ? 0.92 : 0.84);
      if (object.kind === "barrel") {
        graphics.fillRoundedRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y, 7);
        graphics.lineStyle(2, 0xf7fbff, 0.35);
        graphics.beginPath();
        graphics.moveTo(position.x - size.x / 2 + 3, position.y - 5);
        graphics.lineTo(position.x + size.x / 2 - 3, position.y - 5);
        graphics.moveTo(position.x - size.x / 2 + 3, position.y + 8);
        graphics.lineTo(position.x + size.x / 2 - 3, position.y + 8);
        graphics.strokePath();
      } else if (object.kind === "mine") {
        graphics.fillRoundedRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y, 2);
        graphics.fillStyle(0xfff7d6, 0.9);
        graphics.fillCircle(position.x, position.y - 2, 3);
      } else {
        graphics.fillRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y);
        if (object.kind === "box") {
          graphics.lineStyle(2, 0x513820, 0.45);
          graphics.strokeLineShape(makeLine(
            position.x - size.x / 2 + 4,
            position.y - size.y / 2 + 4,
            position.x + size.x / 2 - 4,
            position.y + size.y / 2 - 4,
          ));
          graphics.strokeLineShape(makeLine(
            position.x + size.x / 2 - 4,
            position.y - size.y / 2 + 4,
            position.x - size.x / 2 + 4,
            position.y + size.y / 2 - 4,
          ));
        }
      }

      graphics.lineStyle(1, 0xf7fbff, 0.5);
      graphics.strokeRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y);

      // Rim highlight — single bright line along the top edge to suggest a
      // directional light source. Alpha scales with health (dims as damaged).
      const rimAlpha = 0.55 * (object.health / object.maxHealth);
      graphics.lineStyle(1.5, 0xffffff, rimAlpha);
      graphics.beginPath();
      graphics.moveTo(position.x - size.x / 2 + 2, position.y - size.y / 2 + 1);
      graphics.lineTo(position.x + size.x / 2 - 2, position.y - size.y / 2 + 1);
      graphics.strokePath();

      if (healthRatio < 1) {
        const barWidth = Math.max(24, size.x + 8);
        graphics.fillStyle(0x1f2937, 0.9);
        graphics.fillRect(position.x - barWidth / 2, position.y - size.y / 2 - 10, barWidth, 4);
        graphics.fillStyle(healthRatio > 0.35 ? 0xb8f05a : 0xfb7185, 1);
        graphics.fillRect(position.x - barWidth / 2, position.y - size.y / 2 - 10, barWidth * healthRatio, 4);
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}

/**
 * Tiny structural Line factory. Phaser.Graphics#strokeLineShape only reads
 * the x1/y1/x2/y2 properties, so a plain object is sufficient and lets us
 * skip a runtime Phaser import in this module (keeping unit tests fast).
 */
function makeLine(x1: number, y1: number, x2: number, y2: number): Phaser.Geom.Line {
  return { x1, y1, x2, y2 } as unknown as Phaser.Geom.Line;
}

export function destructibleColor(kind: DestructibleKind): number {
  const colors: Record<DestructibleKind, number> = {
    barrel: 0xff6b6b,
    box: 0xc49a6c,
    mine: 0xffd166,
    cube: 0x8fa3c8,
  };
  return colors[kind];
}

// Force consumer of Vec2 to be type-only at module level so a future tightening
// of the Renderable type can reuse this import.
export type { Vec2 };
