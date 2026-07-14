// Drives ONE local player through the real physics (stepPlayer, sim/player.ts)
// for offline/solo scenes — the same physics + collision system the online
// path (World.ts + the Bun server) already uses, minus any networking.
// Built directly on the sim package the way its own tests do (createRuntime +
// stepPlayer called standalone), not by faking a ClientLoop/transport.
//
// Persists `prevKeys` itself so callers only ever hand it "this tick's raw
// input bitfield" — never re-derive jump/dash edges on their own. Two
// independent edge-trackers reading the same button is a classic
// double-edge bug; this class is the only place that tracks it.

import {
  stepPlayer,
  freshPlayerMovementMemory,
  mirrorMovementMemoryOntoEntity,
  PLAYER_BODY_WIDTH,
  PLAYER_BODY_HEIGHT,
  PLAYER_CROUCH_HEIGHT,
  type PlayerMovementMemory,
  type PlayerStepOptions,
} from "../../sim/player.js";
import { createRuntime } from "../../sim/World.js";
import { PlayerId } from "../../sim/types.js";
import type {
  PlayerEntity,
  InputBitfield,
  InputSeq,
  MapDefinition,
  Vec2,
} from "../../sim/types.js";
import type { StaticCollisionCache } from "../../sim/collision.js";

const PLAYER_HALF_HEIGHT = PLAYER_BODY_HEIGHT / 2;

export type LocalPlayerStepOptions = Omit<PlayerStepOptions, "collisionCache">;

function freshEntity(id: PlayerId, spawn: Vec2): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    aimX: spawn.x,
    aimY: spawn.y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 24,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as InputSeq,
  };
}

export class LocalPlayerController {
  private entity: PlayerEntity;
  private memory: PlayerMovementMemory;
  private prevKeys: InputBitfield = 0;
  private readonly collisionCache: StaticCollisionCache;
  private readonly ceilingClampY: number | null;
  private readonly platforms: MapDefinition["platforms"];

  constructor(map: MapDefinition, spawn: Vec2, playerId: PlayerId = PlayerId("local-practice")) {
    // createRuntime builds the static collision cache + ceiling-clamp Y the
    // same way the online path does (and syncs the wasm static-AABB cache as
    // a side effect) — reused here rather than hand-rolling buildStaticCache,
    // so wasm-parity collision comes for free if that backend is ever toggled.
    const runtime = createRuntime(map);
    this.collisionCache = runtime.collisionCache;
    this.ceilingClampY = runtime.ceilingClampY;
    this.platforms = map.platforms;
    this.entity = freshEntity(playerId, spawn);
    this.memory = freshPlayerMovementMemory();
  }

  /** Advance one tick. `currKeys` is this tick's raw input bitfield. */
  step(currKeys: InputBitfield, aimX: number, aimY: number, dtMs: number, options: LocalPlayerStepOptions = {}): void {
    const result = stepPlayer(
      this.entity,
      this.prevKeys,
      currKeys,
      aimX,
      aimY,
      this.memory,
      this.platforms,
      dtMs,
      { ...options, collisionCache: this.collisionCache },
    );
    this.entity = mirrorMovementMemoryOntoEntity(
      result.player,
      result.memory,
      options.dashCharges,
      options.dashCooldownMultiplier,
    );
    this.memory = result.memory;
    this.prevKeys = currKeys;

    // Ceiling clamp — mirrors World.ts's per-tick pass: a powerful wall-jump
    // into the wall/ceiling corner can otherwise tunnel a body onto the roof.
    if (this.ceilingClampY !== null) {
      const minCenterY = this.ceilingClampY + PLAYER_HALF_HEIGHT;
      if (this.entity.y < minCenterY) {
        this.entity = { ...this.entity, y: minCenterY, vy: Math.max(this.entity.vy, 0) };
      }
    }
  }

  /** Instantaneous velocity impulse (e.g. weapon recoil). Purely additive. */
  applyImpulse(dx: number, dy: number): void {
    this.entity = { ...this.entity, vx: this.entity.vx + dx, vy: this.entity.vy + dy };
  }

  zeroVelocity(): void {
    this.entity = { ...this.entity, vx: 0, vy: 0 };
  }

  /** Matches ProceduralPlayerRig's own facing derivation exactly (velocity
   *  sign, falling back to aim direction) so the two can never disagree. */
  get facing(): 1 | -1 {
    if (Math.abs(this.entity.vx) > 8) return this.entity.vx > 0 ? 1 : -1;
    const d = this.entity.aimX - this.entity.x;
    if (Math.abs(d) > 2) return d > 0 ? 1 : -1;
    return 1;
  }

  get size(): Vec2 {
    return { x: PLAYER_BODY_WIDTH, y: this.entity.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_BODY_HEIGHT };
  }

  /** Read-only snapshot of the live entity. */
  snapshot(): PlayerEntity {
    return this.entity;
  }

  reset(x: number, y: number): void {
    this.entity = freshEntity(this.entity.id, { x, y });
    this.memory = freshPlayerMovementMemory();
    this.prevKeys = 0;
  }

  // Convenience passthrough getters for the most commonly read fields.
  get x(): number {
    return this.entity.x;
  }
  get y(): number {
    return this.entity.y;
  }
  get vx(): number {
    return this.entity.vx;
  }
  get vy(): number {
    return this.entity.vy;
  }
  get position(): Vec2 {
    return { x: this.entity.x, y: this.entity.y };
  }
  get velocity(): Vec2 {
    return { x: this.entity.vx, y: this.entity.vy };
  }
  get grounded(): boolean {
    return this.entity.grounded ?? false;
  }
  get crouching(): boolean {
    return this.entity.crouching;
  }
  get touchingWallDir(): number {
    return this.entity.touchingWallDir ?? 0;
  }
  get dashing(): boolean {
    return this.entity.dashing ?? false;
  }
}
