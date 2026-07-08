import Phaser from "phaser";
import type {
  ElementType,
  ImpactBehavior,
  PlatformDefinition,
  ProjectilePathing,
  ProjectileShape,
  Vec2,
} from "../types/game";
import type { ResolvedWeaponBuild } from "./WeaponSystem";
import { GLOW_TEXTURE_SIZE } from "../render/glowTexture";
import type { ParticlePool } from "./ParticlePool";
import { transientVfx } from "../render/TransientVfx";

export type ProjectileTarget = {
  id: string;
  position: Vec2;
  size: Vec2;
  alive: boolean;
};

export type ProjectileHit = {
  targetId: string;
  damage: number;
  knockback: number;
  position: Vec2;
  element: ElementType;
  impact: ImpactBehavior;
  impactRadiusPx: number;
};

export type WeaponFireResult = {
  fired: boolean;
  hits: ProjectileHit[];
};

type ActiveProjectile = {
  id: number;
  graphics: Phaser.GameObjects.Graphics;
  /** Persistent additive halo following the projectile body. Pooled. */
  glow: Phaser.GameObjects.Image | null;
  position: Vec2;
  previousPosition: Vec2;
  origin: Vec2;
  velocity: Vec2;
  shape: ProjectileShape;
  element: ElementType;
  impact: ImpactBehavior;
  pathing: ProjectilePathing;
  radius: number;
  damage: number;
  knockback: number;
  lifetimeSeconds: number;
  ageSeconds: number;
  rangePx: number;
  traveledPx: number;
  gravityScale: number;
  homingStrength: number;
  accelerationMultiplier: number;
  bouncesInitial: number;
  bouncesLeft: number;
  impactRadiusPx: number;
  pierceLeft: number;
  splitCount: number;
  slowMultiplier: number;
  visualOnly: boolean;
  hasSplit: boolean;
  returning: boolean;
  trailMs: number;
  stickyFuseSeconds?: number;
};

type SweptCollision<T> = {
  item: T;
  point: Vec2;
  normal: Vec2;
  t: number;
};

const MAX_ACTIVE_PROJECTILES = 90;

export class ProjectileSystem {
  private readonly scene: Phaser.Scene;
  private readonly pool: ParticlePool | null;
  private readonly projectiles: ActiveProjectile[] = [];
  private nextProjectileId = 1;

  constructor(scene: Phaser.Scene, pool: ParticlePool | null = null) {
    this.scene = scene;
    this.pool = pool;
  }

  fire(
    origin: Vec2,
    aimAngle: number,
    build: ResolvedWeaponBuild,
    targets: ProjectileTarget[] = [],
    visualOnly = false,
  ): WeaponFireResult {
    if (build.delivery === "raycast" || build.delivery === "continuous-beam") {
      return this.fireBeam(origin, aimAngle, build, targets);
    }

    if (build.delivery === "area-pulse") {
      return this.firePulse(origin, build, targets);
    }

    const count = build.projectile.count;
    const spread = count > 1 ? build.spreadRadians : 0;
    const startAngle = aimAngle - spread / 2;
    const angleStep = count > 1 ? spread / (count - 1) : 0;

    for (let index = 0; index < count; index += 1) {
      const shotAngle = startAngle + angleStep * index;
      this.spawnProjectile(origin, shotAngle, build, 1, visualOnly);
    }

    return { fired: true, hits: [] };
  }

  update(
    deltaSeconds: number,
    platforms: PlatformDefinition[],
    targets: ProjectileTarget[] = [],
  ): ProjectileHit[] {
    const hits: ProjectileHit[] = [];

    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      if (!projectile) continue;
      projectile.ageSeconds += deltaSeconds;

      if (projectile.stickyFuseSeconds !== undefined) {
        projectile.stickyFuseSeconds -= deltaSeconds;
        if (projectile.stickyFuseSeconds <= 0) {
          this.impact(projectile);
          this.removeProjectile(index);
          continue;
        }

        this.drawProjectile(projectile, deltaSeconds);
        continue;
      }

      projectile.previousPosition = { ...projectile.position };
      this.applyPathing(projectile, deltaSeconds, targets);

      projectile.position.x += projectile.velocity.x * deltaSeconds;
      projectile.position.y += projectile.velocity.y * deltaSeconds;

      projectile.traveledPx += distance(projectile.previousPosition, projectile.position);

      const targetHit = projectile.visualOnly ? null : findProjectileTargetHit(projectile, targets);
      const platformHit = findProjectilePlatformHit(projectile, platforms);

      if (targetHit && (!platformHit || targetHit.t <= platformHit.t)) {
        projectile.position = targetHit.point;
        hits.push(this.createHit(projectile, targetHit.item.id));
        this.handleProjectileImpact(index, projectile, targetHit.point);
        continue;
      }

      if (platformHit) {
        projectile.position = platformHit.point;
        this.handlePlatformCollision(index, projectile, platformHit.item, platformHit.normal);
        continue;
      }

      if (this.shouldExpire(projectile)) {
        this.impact(projectile);
        this.removeProjectile(index);
        continue;
      }

      this.drawProjectile(projectile, deltaSeconds);
    }

    return hits;
  }

  activeCount(): number {
    return this.projectiles.length;
  }

  destroy() {
    for (const projectile of this.projectiles) {
      projectile.graphics.destroy();
      this.releaseGlow(projectile);
    }
    this.projectiles.length = 0;
  }

  /**
   * One-shot additive glow at (x,y) that fades and grows outward. Pooled —
   * silently no-ops if the glow pool is unavailable or exhausted, so this is
   * a pure visual layer over the existing projectile FX.
   */
  private spawnGlowBurst(
    x: number,
    y: number,
    color: number,
    radiusPx: number,
    alpha: number,
    durationMs: number,
    growthScale: number = 1.6,
  ): void {
    const pool = this.pool;
    if (!pool) return;
    const glow = pool.acquireGlow();
    if (!glow) return;

    const startScale = (radiusPx * 2) / GLOW_TEXTURE_SIZE;
    glow.setPosition(x, y);
    glow.setTint(color);
    glow.setAlpha(alpha);
    glow.setScale(startScale);
    glow.setDepth(199); // just under projectile body (200)

    transientVfx.spawn({
      // The pool already constructed the object — return it as-is.
      factory: () => glow,
      lifetimeMs: durationMs,
      startAlpha: alpha,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const g = obj as Phaser.GameObjects.GameObject & {
          setScale: (s: number) => unknown;
        };
        g.setScale(startScale + (startScale * growthScale - startScale) * t);
      },
      release: () => pool.release(glow),
    });
  }

  private acquireProjectileGlow(projectile: ActiveProjectile, color: number): void {
    if (projectile.glow || !this.pool) return;
    const glow = this.pool.acquireGlow();
    if (!glow) return;
    glow.setTint(color);
    glow.setAlpha(0.85);
    glow.setDepth(199);
    projectile.glow = glow;
  }

  private releaseGlow(projectile: ActiveProjectile): void {
    if (!projectile.glow) return;
    this.pool?.release(projectile.glow);
    projectile.glow = null;
  }

  private fireBeam(
    origin: Vec2,
    aimAngle: number,
    build: ResolvedWeaponBuild,
    targets: ProjectileTarget[],
  ): WeaponFireResult {
    const range = build.projectile.rangePx;
    const end = {
      x: origin.x + Math.cos(aimAngle) * range,
      y: origin.y + Math.sin(aimAngle) * range,
    };
    const color = elementColor(build.projectile.element);
    const width = build.delivery === "continuous-beam" ? 9 : 5;
    // C1a: route through TransientVfx so the beam's lifetime is
    // owned by the visual coordinator (auto-drain on round-end,
    // cumulative-geometry scrub on cleanup).
    transientVfx.spawn({
      factory: () => {
        const graphics = this.scene.add.graphics();
        graphics.lineStyle(width + 7, color, 0.16);
        graphics.beginPath();
        graphics.moveTo(origin.x, origin.y);
        graphics.lineTo(end.x, end.y);
        graphics.strokePath();
        graphics.lineStyle(width, color, 0.92);
        graphics.beginPath();
        graphics.moveTo(origin.x, origin.y);
        graphics.lineTo(end.x, end.y);
        graphics.strokePath();
        return graphics;
      },
      lifetimeMs: build.delivery === "continuous-beam" ? 140 : 95,
    });

    // Muzzle + tip flash.
    this.spawnGlowBurst(origin.x, origin.y, color, width * 3, 0.9, 160, 1.4);
    this.spawnGlowBurst(end.x, end.y, color, width * 2.2, 0.7, 200, 1.6);

    // Hot path: single for-loop, no filter+map intermediates (game-loop-perf).
    const hits: ProjectileHit[] = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      if (!target.alive) continue;
      if (!segmentIntersectsTarget(origin, end, target)) continue;
      hits.push({
        targetId: target.id,
        damage: build.damage,
        knockback: build.knockbackImpulse,
        position: { ...target.position },
        element: build.projectile.element,
        impact: build.projectile.impact,
        impactRadiusPx: build.projectile.impactRadiusPx,
      });
    }

    for (const hit of hits) {
      this.impactAt(hit.position, build.projectile.element, build.projectile.impact, hit.impactRadiusPx);
    }

    return { fired: true, hits };
  }

  private firePulse(
    origin: Vec2,
    build: ResolvedWeaponBuild,
    targets: ProjectileTarget[],
  ): WeaponFireResult {
    const radius = Math.max(80, build.projectile.impactRadiusPx || build.projectile.rangePx);
    const color = elementColor(build.projectile.element);
    transientVfx.spawn({
      factory: () => {
        const ring = this.scene.add.circle(origin.x, origin.y, 8, color, 0.16);
        ring.setStrokeStyle(3, color, 0.9);
        // Drive the radius expansion via onTick — Phaser's tween
        // can't directly tween Arc.radius without going through
        // setRadius and that's a setter, not a property. Tween
        // owns alpha; we expand radius procedurally.
        return ring;
      },
      lifetimeMs: 220,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const ring = obj as Phaser.GameObjects.Arc;
        ring.setRadius(8 + (radius - 8) * t);
      },
    });

    // Hot path: single for-loop, no filter+map intermediates (game-loop-perf).
    const hits: ProjectileHit[] = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      if (!target.alive) continue;
      if (distance(origin, target.position) > radius + target.size.x / 2) continue;
      hits.push({
        targetId: target.id,
        damage: build.damage,
        knockback: build.knockbackImpulse,
        position: { ...target.position },
        element: build.projectile.element,
        impact: build.projectile.impact,
        impactRadiusPx: radius,
      });
    }

    return { fired: true, hits };
  }

  private spawnProjectile(
    origin: Vec2,
    angle: number,
    build: ResolvedWeaponBuild,
    damageScale: number,
    visualOnly = false,
  ) {
    if (this.projectiles.length >= MAX_ACTIVE_PROJECTILES) {
      const oldest = this.projectiles.shift();
      oldest?.graphics.destroy();
    }

    const speed = build.projectileSpeed * build.projectile.speedMultiplier;
    const projectile: ActiveProjectile = {
      id: this.nextProjectileId,
      graphics: this.scene.add.graphics(),
      glow: null,
      position: { ...origin },
      previousPosition: { ...origin },
      origin: { ...origin },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      shape: build.projectile.shape,
      element: build.projectile.element,
      impact: build.projectile.impact,
      pathing: build.projectile.pathing,
      radius: 7 * build.projectile.sizeMultiplier,
      damage: build.damage * damageScale,
      knockback: build.knockbackImpulse,
      lifetimeSeconds: build.projectileLifetimeSeconds * build.projectile.lifetimeMultiplier,
      ageSeconds: 0,
      rangePx: build.projectile.rangePx,
      traveledPx: 0,
      gravityScale: build.projectile.gravityScale,
      homingStrength: build.projectile.homingStrength,
      accelerationMultiplier: build.projectile.accelerationMultiplier,
      bouncesInitial: build.projectile.bounces,
      bouncesLeft: build.projectile.bounces,
      impactRadiusPx: build.projectile.impactRadiusPx,
      pierceLeft: build.projectile.pierceCount,
      splitCount: build.projectile.splitCount,
      slowMultiplier: build.projectile.slowMultiplier,
      visualOnly,
      hasSplit: false,
      returning: false,
      trailMs: 0,
    };

    this.nextProjectileId += 1;
    this.projectiles.push(projectile);
    this.acquireProjectileGlow(projectile, elementColor(projectile.element));
    this.drawProjectile(projectile, 0);
  }

  private applyPathing(
    projectile: ActiveProjectile,
    deltaSeconds: number,
    targets: ProjectileTarget[],
  ) {
    if (projectile.pathing === "gravity") {
      projectile.velocity.y += projectile.gravityScale * deltaSeconds;
    }

    if (projectile.pathing === "float") {
      projectile.velocity.y += Math.sin(projectile.ageSeconds * 9 + projectile.id) * 22 * deltaSeconds;
      projectile.velocity.x += Math.cos(projectile.ageSeconds * 5 + projectile.id) * 11 * deltaSeconds;
    }

    if (projectile.pathing === "accelerate") {
      const factor = 1 + projectile.accelerationMultiplier * deltaSeconds;
      projectile.velocity.x *= factor;
      projectile.velocity.y *= factor;
    }

    if (projectile.pathing === "boomerang" && !projectile.returning) {
      projectile.returning = projectile.traveledPx > projectile.rangePx * 0.55;
    }

    if (projectile.pathing === "boomerang" && projectile.returning) {
      rotateVelocityToward(projectile, projectile.origin, 8.4, deltaSeconds);
      return;
    }

    if (projectile.pathing === "homing" || projectile.pathing === "anti-homing") {
      const target = closestTarget(projectile.position, targets);
      if (!target) {
        return;
      }

      const turnTarget = projectile.pathing === "anti-homing"
        ? {
            x: projectile.position.x * 2 - target.position.x,
            y: projectile.position.y * 2 - target.position.y,
          }
        : target.position;

      rotateVelocityToward(projectile, turnTarget, projectile.homingStrength, deltaSeconds);
    }
  }

  private handleProjectileImpact(index: number, projectile: ActiveProjectile, position: Vec2) {
    if (projectile.splitCount > 0 && !projectile.hasSplit) {
      this.spawnSplit(projectile);
      projectile.hasSplit = true;
    }

    if (projectile.impact === "sticky") {
      projectile.position = { ...position };
      projectile.velocity = { x: 0, y: 0 };
      projectile.stickyFuseSeconds = 0.72;
      this.drawProjectile(projectile, 0);
      return;
    }

    if (projectile.pierceLeft > 0) {
      projectile.pierceLeft -= 1;
      this.impactAt(position, projectile.element, projectile.impact, projectile.impactRadiusPx * 0.55);
      return;
    }

    this.impact(projectile);
    this.removeProjectile(index);
  }

  private handlePlatformCollision(
    index: number,
    projectile: ActiveProjectile,
    platform: PlatformDefinition,
    normal?: Vec2,
  ) {
    if (projectile.splitCount > 0 && !projectile.hasSplit) {
      this.spawnSplit(projectile);
      projectile.hasSplit = true;
    }

    if (projectile.impact === "sticky") {
      projectile.velocity = { x: 0, y: 0 };
      projectile.stickyFuseSeconds = 0.72;
      this.drawProjectile(projectile, 0);
      return;
    }

    if (projectile.pathing === "bounce" && projectile.bouncesLeft > 0) {
      reflectFromPlatform(projectile, platform, normal);
      projectile.bouncesLeft -= 1;
      this.bounceSpark(projectile);
      this.drawProjectile(projectile, 0);
      return;
    }

    this.impact(projectile);
    this.removeProjectile(index);
  }

  private spawnSplit(projectile: ActiveProjectile) {
    const splitCount = Math.min(projectile.splitCount, 8);
    const angle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
    const spread = Math.PI * 0.95;

    for (let index = 0; index < splitCount; index += 1) {
      const t = splitCount === 1 ? 0.5 : index / (splitCount - 1);
      const splitAngle = angle - spread / 2 + spread * t;
      const splitBuild = projectileToBuild(projectile);
      this.spawnProjectile(projectile.position, splitAngle, splitBuild, 0.42, projectile.visualOnly);
    }
  }

  private createHit(projectile: ActiveProjectile, targetId: string): ProjectileHit {
    return {
      targetId,
      damage: projectile.damage,
      knockback: projectile.knockback,
      position: { ...projectile.position },
      element: projectile.element,
      impact: projectile.impact,
      impactRadiusPx: projectile.impactRadiusPx,
    };
  }

  private shouldExpire(projectile: ActiveProjectile): boolean {
    if (projectile.ageSeconds >= projectile.lifetimeSeconds) {
      return true;
    }

    if (projectile.pathing === "boomerang" && projectile.returning) {
      return distance(projectile.position, projectile.origin) < projectile.radius + 8;
    }

    return projectile.traveledPx >= projectile.rangePx;
  }

  private impact(projectile: ActiveProjectile) {
    this.impactAt(projectile.position, projectile.element, projectile.impact, projectile.impactRadiusPx);
  }

  private impactAt(
    position: Vec2,
    element: ElementType,
    impact: ImpactBehavior,
    impactRadiusPx: number,
  ) {
    // P1: cataclysmic-prism (radiant + explosive) advertises "pure white crystal
    // flash" — override the elementColor's pale yellow with true white for this
    // specific combo so the card looks like it reads.
    const color =
      element === "radiant" && impact === "explosive"
        ? 0xffffff
        : elementColor(element);
    const radius = Math.max(impactRadiusPx, impact === "none" ? 18 : 34);

    // P2: radiant-overload promises a flash sized to its impact radius. Scale
    // the primary glow burst directly with impactRadiusPx for radiant element
    // so card-authored larger radii produce visibly bigger halos.
    const primaryGlowRadius =
      element === "radiant" ? Math.max(impactRadiusPx, radius * 0.85) : radius * 0.85;
    // Soft additive flash — the "rounds"-style halo. Hot core grows out fast.
    this.spawnGlowBurst(position.x, position.y, color, primaryGlowRadius, 0.95, impact === "explosive" ? 320 : 200, 1.7);
    if (impact === "explosive") {
      // Extra wide secondary wash for explosions.
      this.spawnGlowBurst(position.x, position.y, color, radius * 1.6, 0.55, 380, 1.4);
    }

    transientVfx.spawn({
      factory: () => {
        const burst = this.scene.add.circle(position.x, position.y, 6, color, 0.32);
        burst.setStrokeStyle(2, color, 0.86);
        return burst;
      },
      lifetimeMs: impact === "explosive" ? 280 : 180,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const burst = obj as Phaser.GameObjects.Arc;
        burst.setRadius(6 + (radius - 6) * t);
      },
    });

    const particleCount = impact === "explosive" ? 16 : 7;
    for (let index = 0; index < particleCount; index += 1) {
      const angle = (Math.PI * 2 * index) / particleCount;
      const targetX = position.x + Math.cos(angle) * radius * 0.65;
      const targetY = position.y + Math.sin(angle) * radius * 0.65;
      transientVfx.spawn({
        factory: () => {
          const shard = this.scene.add.rectangle(position.x, position.y, 3, 8, color, 0.85);
          shard.rotation = angle;
          return shard;
        },
        lifetimeMs: 220,
        ease: "Sine.easeOut",
        onTick: (obj, t) => {
          const shard = obj as Phaser.GameObjects.Rectangle;
          shard.x = position.x + (targetX - position.x) * t;
          shard.y = position.y + (targetY - position.y) * t;
        },
      });
    }
  }

  private bounceSpark(projectile: ActiveProjectile) {
    const color = elementColor(projectile.element);
    // bouncy-prism: brighter spark + larger glow on each successive bounce.
    // bouncesInitial captures the spawn-time bounce budget; bouncesLeft is
    // already decremented before this call, so used = initial - left.
    const initial = Math.max(1, projectile.bouncesInitial);
    const used = Math.max(1, initial - projectile.bouncesLeft);
    const ramp = Math.min(1, used / initial);
    const glowRadius = 14 + 10 * ramp;
    const sparkAlpha = 0.86 + 0.14 * ramp;
    const sparkExpand = 18 + 8 * ramp;
    this.spawnGlowBurst(projectile.position.x, projectile.position.y, color, glowRadius, 0.9 + 0.1 * ramp, 140, 1.5);
    const sparkX = projectile.position.x;
    const sparkY = projectile.position.y;
    transientVfx.spawn({
      factory: () => this.scene.add.circle(sparkX, sparkY, 3, color, sparkAlpha),
      lifetimeMs: 120,
      startAlpha: sparkAlpha,
      onTick: (obj, t) => {
        const spark = obj as Phaser.GameObjects.Arc;
        spark.setRadius(3 + (sparkExpand - 3) * t);
      },
    });
  }

  private drawProjectile(projectile: ActiveProjectile, deltaSeconds: number) {
    const color = elementColor(projectile.element);
    const graphics = projectile.graphics;
    const radius = projectile.radius;

    if (projectile.glow) {
      // Halo ~3.4× projectile body — soft falloff, sits behind the body sprite.
      // sticky-shards: while the fuse counts down, the halo grows + brightens
      // so the projectile reads as "about to burst" before impact.
      let glowMultiplier = 1;
      if (projectile.stickyFuseSeconds !== undefined) {
        const STICKY_FUSE_TOTAL = 0.72;
        const remaining = Math.max(0, projectile.stickyFuseSeconds);
        const progress = Math.min(1, 1 - remaining / STICKY_FUSE_TOTAL);
        // Fast pulse layered on top of the linear ramp so it reads as alive.
        const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 8);
        glowMultiplier = 1 + 0.7 * progress + 0.18 * pulse;
      }
      const glowScale = (radius * 3.4 * 2 * glowMultiplier) / GLOW_TEXTURE_SIZE;
      projectile.glow.setPosition(projectile.position.x, projectile.position.y);
      projectile.glow.setScale(glowScale);
    }

    graphics.clear();
    graphics.lineStyle(2, color, 0.95);
    graphics.fillStyle(color, 0.82);

    if (projectile.shape === "circle") {
      graphics.fillCircle(projectile.position.x, projectile.position.y, radius);
      graphics.strokeCircle(projectile.position.x, projectile.position.y, radius);
    } else if (projectile.shape === "orb") {
      graphics.fillCircle(projectile.position.x, projectile.position.y, radius * 1.14);
      graphics.lineStyle(2, 0xffffff, 0.7);
      graphics.strokeCircle(projectile.position.x, projectile.position.y, radius * 0.58);
    } else if (projectile.shape === "square") {
      graphics.fillRect(
        projectile.position.x - radius,
        projectile.position.y - radius,
        radius * 2,
        radius * 2,
      );
      graphics.strokeRect(
        projectile.position.x - radius,
        projectile.position.y - radius,
        radius * 2,
        radius * 2,
      );
    } else if (projectile.shape === "x") {
      graphics.lineStyle(Math.max(3, radius * 0.5), color, 0.95);
      graphics.beginPath();
      graphics.moveTo(projectile.position.x - radius, projectile.position.y - radius);
      graphics.lineTo(projectile.position.x + radius, projectile.position.y + radius);
      graphics.moveTo(projectile.position.x + radius, projectile.position.y - radius);
      graphics.lineTo(projectile.position.x - radius, projectile.position.y + radius);
      graphics.strokePath();
    } else if (projectile.shape === "bar") {
      graphics.fillRoundedRect(
        projectile.position.x - radius * 0.42,
        projectile.position.y - radius * 1.38,
        radius * 0.84,
        radius * 2.76,
        Math.max(2, radius * 0.18),
      );
      graphics.strokeRoundedRect(
        projectile.position.x - radius * 0.42,
        projectile.position.y - radius * 1.38,
        radius * 0.84,
        radius * 2.76,
        Math.max(2, radius * 0.18),
      );
    } else {
      drawPolygon(graphics, projectile.position, radius, projectile.shape === "triangle" ? 3 : 6);
    }

    projectile.trailMs += deltaSeconds * 1000;
    if (projectile.trailMs >= 32) {
      projectile.trailMs = 0;
      const trailX = projectile.position.x;
      const trailY = projectile.position.y;
      const trailRadius = Math.max(2, radius * 0.45);
      transientVfx.spawn({
        factory: () => this.scene.add.circle(trailX, trailY, trailRadius, color, 0.34),
        lifetimeMs: 210,
        startAlpha: 0.34,
        onTick: (obj, t) => {
          const c = obj as Phaser.GameObjects.Arc;
          c.setScale(1 - 0.7 * t);
        },
      });

      // Pooled additive glow puffs — replaces the ad-hoc circle blobs. Two
      // jittered halos give the soft "rounds"-style streak behind the body.
      const blobRadius = Math.max(2, radius * 0.7);
      const offsets: [number, number][] = [
        [2 + Math.random() * 2, -(2 + Math.random() * 2)],
        [-(2 + Math.random() * 2), 2 + Math.random() * 2],
      ];
      for (const [ox, oy] of offsets) {
        this.spawnGlowBurst(
          projectile.position.x + ox,
          projectile.position.y + oy,
          color,
          blobRadius,
          0.55,
          180,
          0.6,
        );
      }

      // voltaic-spark: travel-phase electric crackle. Tiny perpendicular zigzag
      // line behind the projectile, jittered every trail tick. Render-only —
      // Math.random is fine here per phaser4-game/SKILL.md (sim/ uses rng.ts).
      if (projectile.element === "lightning") {
        const vx = projectile.velocity.x;
        const vy = projectile.velocity.y;
        const speed = Math.hypot(vx, vy) || 1;
        const px = -vy / speed; // perpendicular unit vector
        const py = vx / speed;
        const len = Math.max(6, radius * 1.6);
        const jitter = (Math.random() - 0.5) * len * 0.8;
        const ax = projectile.position.x - vx / speed * (radius * 1.8);
        const ay = projectile.position.y - vy / speed * (radius * 1.8);
        transientVfx.spawn({
          factory: () => {
            const arc = this.scene.add.graphics();
            arc.lineStyle(Math.max(1, radius * 0.35), 0xfef9c3, 0.95);
            arc.beginPath();
            arc.moveTo(ax + px * len * 0.5, ay + py * len * 0.5);
            arc.lineTo(ax + px * jitter, ay + py * jitter);
            arc.lineTo(ax - px * len * 0.5, ay - py * len * 0.5);
            arc.strokePath();
            return arc;
          },
          lifetimeMs: 120,
        });
      }
    }
  }

  private removeProjectile(index: number) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (!projectile) return;
    projectile.graphics.destroy();
    this.releaseGlow(projectile);
  }
}

function projectileToBuild(projectile: ActiveProjectile): ResolvedWeaponBuild {
  return {
    id: "split-shard",
    name: "Split Shard",
    delivery: "projectile",
    damage: projectile.damage,
    fireRate: 1,
    magazineSize: 1,
    reloadSeconds: 1,
    projectileSpeed: Math.max(180, magnitude(projectile.velocity) * 0.82),
    projectileLifetimeSeconds: Math.max(0.28, projectile.lifetimeSeconds * 0.42),
    spreadRadians: 0,
    recoilImpulse: 0,
    knockbackImpulse: projectile.knockback * 0.44,
    projectile: {
      shape: projectile.shape,
      count: 1,
      rangePx: projectile.rangePx * 0.32,
      speedMultiplier: 1,
      sizeMultiplier: Math.max(0.45, projectile.radius / 10),
      recoilMultiplier: 1,
      pathing: "straight",
      element: projectile.element,
      impact: projectile.impact === "sticky" ? "sticky" : "none",
      lifetimeMultiplier: 1,
      gravityScale: 0,
      homingStrength: 0,
      accelerationMultiplier: 0,
      bounces: 0,
      impactRadiusPx: projectile.impactRadiusPx * 0.45,
      pierceCount: 0,
      splitCount: 0,
      slowMultiplier: projectile.slowMultiplier,
    },
    ammoRegenPerSecond: 0,
    overchargeMultiplier: 1,
    orbitingSatellites: 0,
    mirrorShield: false,
    maxHealthAdd: 0,
    moveSpeedMultiplier: 1,
    parryCoverMultiplier: 1,
    parryCooldownMultiplier: 1,
    gravityMultiplier: 1,
    shieldChargeMultiplier: 1,
    shieldRechargeMultiplier: 1,
    directionalShield: false,
    stolenFangs: false,
    jumpMultiplier: 1,
    wallJumpMultiplier: 1,
    wallSlideMultiplier: 1,
    airJumps: 0,
    dashCharges: 0,
    dashCooldownMultiplier: 1,
    cards: [],
    occupiedBuckets: [],
  };
}

function rotateVelocityToward(
  projectile: ActiveProjectile,
  target: Vec2,
  turnStrength: number,
  deltaSeconds: number,
) {
  const speed = magnitude(projectile.velocity);
  if (speed <= 0) {
    return;
  }

  const current = Math.atan2(projectile.velocity.y, projectile.velocity.x);
  const desired = Math.atan2(target.y - projectile.position.y, target.x - projectile.position.x);
  const next = rotateAngleToward(current, desired, turnStrength * deltaSeconds);
  projectile.velocity.x = Math.cos(next) * speed;
  projectile.velocity.y = Math.sin(next) * speed;
}

function rotateAngleToward(current: number, target: number, maxStep: number): number {
  const difference = normalizeAngle(target - current);
  if (Math.abs(difference) <= maxStep) {
    return target;
  }
  return current + Math.sign(difference) * maxStep;
}

function normalizeAngle(angle: number): number {
  return Phaser.Math.Angle.Wrap(angle);
}

function closestTarget(position: Vec2, targets: ProjectileTarget[]): ProjectileTarget | undefined {
  let closest: ProjectileTarget | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    if (!target.alive) {
      continue;
    }

    const targetDistance = distance(position, target.position);
    if (targetDistance < closestDistance) {
      closest = target;
      closestDistance = targetDistance;
    }
  }

  return closest;
}

function findProjectileTargetHit(
  projectile: ActiveProjectile,
  targets: ProjectileTarget[],
): SweptCollision<ProjectileTarget> | undefined {
  let closestHit: SweptCollision<ProjectileTarget> | undefined;

  for (const target of targets) {
    if (!target.alive) {
      continue;
    }

    const hit = sweepProjectileAgainstAabb(projectile, target, target.position, target.size);
    if (hit && (!closestHit || hit.t < closestHit.t)) {
      closestHit = hit;
    }
  }

  return closestHit;
}

function findProjectilePlatformHit(
  projectile: ActiveProjectile,
  platforms: PlatformDefinition[],
): SweptCollision<PlatformDefinition> | undefined {
  let closestHit: SweptCollision<PlatformDefinition> | undefined;

  for (const platform of platforms) {
    const hit = sweepProjectileAgainstAabb(projectile, platform, platform.position, platform.size);
    if (hit && (!closestHit || hit.t < closestHit.t)) {
      closestHit = hit;
    }
  }

  return closestHit;
}

function sweepProjectileAgainstAabb<T>(
  projectile: ActiveProjectile,
  item: T,
  center: Vec2,
  size: Vec2,
): SweptCollision<T> | undefined {
  const hit = sweepSegmentAgainstExpandedAabb(
    projectile.previousPosition,
    projectile.position,
    center,
    size,
    projectile.radius,
  );

  if (!hit) {
    return undefined;
  }

  return {
    item,
    ...hit,
  };
}

function sweepSegmentAgainstExpandedAabb(
  start: Vec2,
  end: Vec2,
  center: Vec2,
  size: Vec2,
  padding: number,
): Omit<SweptCollision<unknown>, "item"> | undefined {
  const min = {
    x: center.x - size.x / 2 - padding,
    y: center.y - size.y / 2 - padding,
  };
  const max = {
    x: center.x + size.x / 2 + padding,
    y: center.y + size.y / 2 + padding,
  };
  const delta = {
    x: end.x - start.x,
    y: end.y - start.y,
  };

  if (pointInsideAabb(start, min, max)) {
    return {
      point: { ...start },
      normal: insideAabbNormal(start, delta, min, max),
      t: 0,
    };
  }

  let entryTime = 0;
  let exitTime = 1;
  let hitNormal = { x: 0, y: 0 };

  const xHit = axisIntersection(start.x, delta.x, min.x, max.x, { x: -1, y: 0 }, { x: 1, y: 0 });
  if (!xHit) {
    return undefined;
  }

  if (xHit.entry > entryTime) {
    entryTime = xHit.entry;
    hitNormal = xHit.normal;
  }
  exitTime = Math.min(exitTime, xHit.exit);

  const yHit = axisIntersection(start.y, delta.y, min.y, max.y, { x: 0, y: -1 }, { x: 0, y: 1 });
  if (!yHit) {
    return undefined;
  }

  if (yHit.entry > entryTime) {
    entryTime = yHit.entry;
    hitNormal = yHit.normal;
  }
  exitTime = Math.min(exitTime, yHit.exit);

  if (entryTime > exitTime || entryTime < 0 || entryTime > 1) {
    return undefined;
  }

  return {
    point: {
      x: start.x + delta.x * entryTime,
      y: start.y + delta.y * entryTime,
    },
    normal: hitNormal,
    t: entryTime,
  };
}

function axisIntersection(
  start: number,
  delta: number,
  min: number,
  max: number,
  minNormal: Vec2,
  maxNormal: Vec2,
): { entry: number; exit: number; normal: Vec2 } | undefined {
  if (Math.abs(delta) < 0.0001) {
    if (start < min || start > max) {
      return undefined;
    }

    return {
      entry: Number.NEGATIVE_INFINITY,
      exit: Number.POSITIVE_INFINITY,
      normal: { x: 0, y: 0 },
    };
  }

  if (delta > 0) {
    return {
      entry: (min - start) / delta,
      exit: (max - start) / delta,
      normal: minNormal,
    };
  }

  return {
    entry: (max - start) / delta,
    exit: (min - start) / delta,
    normal: maxNormal,
  };
}

function pointInsideAabb(point: Vec2, min: Vec2, max: Vec2): boolean {
  return point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y;
}

function insideAabbNormal(point: Vec2, delta: Vec2, min: Vec2, max: Vec2): Vec2 {
  if (Math.abs(delta.x) > Math.abs(delta.y)) {
    return { x: delta.x > 0 ? -1 : 1, y: 0 };
  }

  if (Math.abs(delta.y) > 0) {
    return { x: 0, y: delta.y > 0 ? -1 : 1 };
  }

  const left = Math.abs(point.x - min.x);
  const right = Math.abs(max.x - point.x);
  const top = Math.abs(point.y - min.y);
  const bottom = Math.abs(max.y - point.y);
  const shortest = Math.min(left, right, top, bottom);

  if (shortest === left) {
    return { x: -1, y: 0 };
  }
  if (shortest === right) {
    return { x: 1, y: 0 };
  }
  if (shortest === top) {
    return { x: 0, y: -1 };
  }
  return { x: 0, y: 1 };
}

function reflectFromPlatform(projectile: ActiveProjectile, platform: PlatformDefinition, normal?: Vec2) {
  if (normal && (normal.x !== 0 || normal.y !== 0)) {
    const dot = projectile.velocity.x * normal.x + projectile.velocity.y * normal.y;
    projectile.velocity.x -= 2 * dot * normal.x;
    projectile.velocity.y -= 2 * dot * normal.y;
    projectile.position.x += normal.x * Math.max(1, projectile.radius * 0.5);
    projectile.position.y += normal.y * Math.max(1, projectile.radius * 0.5);
    return;
  }

  const left = platform.position.x - platform.size.x / 2 - projectile.radius;
  const right = platform.position.x + platform.size.x / 2 + projectile.radius;
  const top = platform.position.y - platform.size.y / 2 - projectile.radius;
  const bottom = platform.position.y + platform.size.y / 2 + projectile.radius;

  if (projectile.previousPosition.x <= left || projectile.previousPosition.x >= right) {
    projectile.velocity.x *= -1;
  } else if (projectile.previousPosition.y <= top || projectile.previousPosition.y >= bottom) {
    projectile.velocity.y *= -1;
  } else {
    const dx = Math.min(Math.abs(projectile.position.x - left), Math.abs(projectile.position.x - right));
    const dy = Math.min(Math.abs(projectile.position.y - top), Math.abs(projectile.position.y - bottom));
    if (dx < dy) {
      projectile.velocity.x *= -1;
    } else {
      projectile.velocity.y *= -1;
    }
  }

  projectile.position = { ...projectile.previousPosition };
}

function segmentIntersectsTarget(start: Vec2, end: Vec2, target: ProjectileTarget): boolean {
  const radius = Math.max(target.size.x, target.size.y) / 2;
  return distancePointToSegment(target.position, start, end) <= radius;
}

function distancePointToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(point, start);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t,
  });
}

function drawPolygon(
  graphics: Phaser.GameObjects.Graphics,
  position: Vec2,
  radius: number,
  sides: number,
) {
  const rotation = -Math.PI / 2;
  graphics.beginPath();

  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    const x = position.x + Math.cos(angle) * radius;
    const y = position.y + Math.sin(angle) * radius;
    if (index === 0) {
      graphics.moveTo(x, y);
    } else {
      graphics.lineTo(x, y);
    }
  }

  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();
}

function elementColor(element: ElementType): number {
  const colors: Record<ElementType, number> = {
    crystal: 0x50e3c2,
    neutral: 0xf7fbff,
    fire: 0xff7a18,
    ice: 0x93c5fd,
    lightning: 0xfef08a,
    void: 0xa78bfa,
    radiant: 0xfff7d6,
    electric: 0xfef08a,
    toxic: 0x86efac,
    sticky: 0xf97316,
    explosive: 0xfb7185,
  };
  return colors[element];
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function magnitude(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}
