import type { PlatformDefinition, Vec2 } from "../types/game";

export type MovementInput = {
  left: boolean;
  right: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  fastFall: boolean;
  crouch: boolean;
};

export type PlayerBody = {
  position: Vec2;
  velocity: Vec2;
  size: Vec2;
  grounded: boolean;
  crouching: boolean;
  facing: 1 | -1;
};

export type MovementDebug = {
  coyoteMs: number;
  jumpBufferMs: number;
};

export type MovementStats = {
  speedMultiplier: number;
  gravityMultiplier?: number;
};

const MOVEMENT = {
  maxGroundSpeed: 330,
  groundAcceleration: 2700,
  airAcceleration: 2050,
  groundFriction: 3600,
  gravity: 1450,
  fastFallGravity: 2150,
  jumpVelocity: -635,
  jumpCutMultiplier: 0.48,
  coyoteMs: 110,
  jumpBufferMs: 110,
  maxFallSpeed: 900,
};

export class MovementSystem {
  private coyoteTimerMs = 0;
  private jumpBufferTimerMs = 0;
  private jumpWasReleased = true;
  private jumpCutApplied = false;

  reset() {
    this.coyoteTimerMs = 0;
    this.jumpBufferTimerMs = 0;
    this.jumpWasReleased = true;
    this.jumpCutApplied = false;
  }

  update(
    body: PlayerBody,
    input: MovementInput,
    platforms: PlatformDefinition[],
    deltaSeconds: number,
    stats: MovementStats = { speedMultiplier: 1 },
  ): MovementDebug {
    const deltaMs = deltaSeconds * 1000;
    if (body.grounded) {
      this.coyoteTimerMs = MOVEMENT.coyoteMs;
    } else {
      this.coyoteTimerMs = Math.max(0, this.coyoteTimerMs - deltaMs);
    }

    if (input.jumpPressed) {
      this.jumpBufferTimerMs = MOVEMENT.jumpBufferMs;
    } else {
      this.jumpBufferTimerMs = Math.max(0, this.jumpBufferTimerMs - deltaMs);
    }

    body.crouching = input.crouch && body.grounded;

    const direction = Number(input.right) - Number(input.left);
    if (direction !== 0) {
      body.facing = direction > 0 ? 1 : -1;
      const acceleration =
        (body.grounded ? MOVEMENT.groundAcceleration : MOVEMENT.airAcceleration) *
        stats.speedMultiplier;
      body.velocity.x += direction * acceleration * deltaSeconds;
    } else if (body.grounded) {
      body.velocity.x = approach(body.velocity.x, 0, MOVEMENT.groundFriction * deltaSeconds);
    }

    const maxSpeed = MOVEMENT.maxGroundSpeed * stats.speedMultiplier * (body.crouching ? 0.42 : 1);
    body.velocity.x = clamp(body.velocity.x, -maxSpeed, maxSpeed);

    const shouldJump = this.jumpBufferTimerMs > 0 && this.coyoteTimerMs > 0;
    if (shouldJump) {
      body.velocity.y = MOVEMENT.jumpVelocity;
      body.grounded = false;
      this.coyoteTimerMs = 0;
      this.jumpBufferTimerMs = 0;
      this.jumpWasReleased = false;
      this.jumpCutApplied = false;
    }

    if (!input.jumpHeld) {
      this.jumpWasReleased = true;
    }

    if (this.jumpWasReleased && !this.jumpCutApplied && body.velocity.y < 0) {
      body.velocity.y *= MOVEMENT.jumpCutMultiplier;
      this.jumpWasReleased = false;
      this.jumpCutApplied = true;
    }

    const gravity =
      (input.fastFall && body.velocity.y > 0 ? MOVEMENT.fastFallGravity : MOVEMENT.gravity) *
      (stats.gravityMultiplier ?? 1);
    body.velocity.y = Math.min(MOVEMENT.maxFallSpeed, body.velocity.y + gravity * deltaSeconds);

    body.position.x += body.velocity.x * deltaSeconds;
    resolveAxis(body, platforms, "x");

    body.position.y += body.velocity.y * deltaSeconds;
    body.grounded = false;
    resolveAxis(body, platforms, "y");

    return {
      coyoteMs: Math.round(this.coyoteTimerMs),
      jumpBufferMs: Math.round(this.jumpBufferTimerMs),
    };
  }
}

function resolveAxis(body: PlayerBody, platforms: PlatformDefinition[], axis: "x" | "y") {
  for (const platform of platforms) {
    if (!overlaps(body, platform)) {
      continue;
    }

    if (axis === "x") {
      const pushLeft = platform.position.x - platform.size.x / 2 - body.size.x / 2;
      const pushRight = platform.position.x + platform.size.x / 2 + body.size.x / 2;
      body.position.x = body.position.x < platform.position.x ? pushLeft : pushRight;
      body.velocity.x = 0;
      continue;
    }

    const pushUp = platform.position.y - platform.size.y / 2 - body.size.y / 2;
    const pushDown = platform.position.y + platform.size.y / 2 + body.size.y / 2;
    if (body.position.y < platform.position.y) {
      body.position.y = pushUp;
      body.velocity.y = 0;
      body.grounded = true;
    } else {
      body.position.y = pushDown;
      body.velocity.y = Math.max(0, body.velocity.y);
    }
  }
}

function overlaps(body: PlayerBody, platform: PlatformDefinition): boolean {
  const bodyHalfWidth = body.size.x / 2;
  const bodyHalfHeight = body.size.y / 2;
  const platformHalfWidth = platform.size.x / 2;
  const platformHalfHeight = platform.size.y / 2;

  return (
    Math.abs(body.position.x - platform.position.x) < bodyHalfWidth + platformHalfWidth &&
    Math.abs(body.position.y - platform.position.y) < bodyHalfHeight + platformHalfHeight
  );
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) {
    return Math.min(value + amount, target);
  }
  if (value > target) {
    return Math.max(value - amount, target);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
