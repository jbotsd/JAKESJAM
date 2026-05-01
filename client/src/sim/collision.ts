// Deterministic AABB + swept-AABB collision for sim/.
// Replaces Phaser Arcade physics in the simulation layer. Phaser stays in the
// rendering layer for sprites that follow WorldState entity positions.
//
// Scale: ~30 platforms, ~10 destructibles, ~15 projectiles. O(n*m) brute force
// is correct here — spatial hashing is premature.

export type AABB = { x: number; y: number; w: number; h: number };

/** Static-vs-static overlap. Cheap; use for triggers (pickups, fire patches). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Point-in-AABB. */
export function pointInAABB(px: number, py: number, b: AABB): boolean {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

/**
 * Circle-vs-AABB by Minkowski expansion: expand box by radius, treat as point.
 * Use for projectiles vs platforms / destructibles.
 */
export function circleOverlapsAABB(
  cx: number,
  cy: number,
  radius: number,
  b: AABB,
): boolean {
  return pointInAABB(cx, cy, {
    x: b.x - radius,
    y: b.y - radius,
    w: b.w + radius * 2,
    h: b.h + radius * 2,
  });
}

export type SweepHit = {
  /** 0..1, the fraction of the velocity step at which contact occurred */
  t: number;
  /** Surface normal at contact (-1, 0, +1 on each axis) */
  nx: number;
  ny: number;
  /** Index into the statics array */
  index: number;
};

/**
 * Swept AABB: where does `mover` first contact any of `statics`
 * along velocity (vx*dt, vy*dt)? Returns null if no contact this step.
 *
 * Standard slab method. Mover is treated as a moving box; statics are stationary.
 */
export function sweepAABB(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  statics: readonly AABB[],
): SweepHit | null {
  const dx = vx * dt;
  const dy = vy * dt;
  let best: SweepHit | null = null;

  for (let i = 0; i < statics.length; i += 1) {
    const s = statics[i]!;
    const hit = sweepAgainstOne(mover, dx, dy, s);
    if (hit && (best === null || hit.t < best.t)) {
      best = { ...hit, index: i };
    }
  }

  return best;
}

function sweepAgainstOne(
  mover: AABB,
  dx: number,
  dy: number,
  target: AABB,
): Omit<SweepHit, "index"> | null {
  // Compute entry/exit times on each axis.
  // X axis
  let xEntry: number;
  let xExit: number;
  if (dx > 0) {
    xEntry = (target.x - (mover.x + mover.w)) / dx;
    xExit = (target.x + target.w - mover.x) / dx;
  } else if (dx < 0) {
    xEntry = (target.x + target.w - mover.x) / dx;
    xExit = (target.x - (mover.x + mover.w)) / dx;
  } else {
    // No X motion. Must already be overlapping in X for any X-axis contact.
    if (mover.x + mover.w <= target.x || mover.x >= target.x + target.w) {
      return null;
    }
    xEntry = -Infinity;
    xExit = Infinity;
  }

  // Y axis
  let yEntry: number;
  let yExit: number;
  if (dy > 0) {
    yEntry = (target.y - (mover.y + mover.h)) / dy;
    yExit = (target.y + target.h - mover.y) / dy;
  } else if (dy < 0) {
    yEntry = (target.y + target.h - mover.y) / dy;
    yExit = (target.y - (mover.y + mover.h)) / dy;
  } else {
    if (mover.y + mover.h <= target.y || mover.y >= target.y + target.h) {
      return null;
    }
    yEntry = -Infinity;
    yExit = Infinity;
  }

  const entry = Math.max(xEntry, yEntry);
  const exit = Math.min(xExit, yExit);

  if (entry > exit || entry < 0 || entry > 1) {
    return null;
  }

  // Determine the contact normal (the axis with the later entry wins).
  let nx = 0;
  let ny = 0;
  if (xEntry > yEntry) {
    nx = dx < 0 ? 1 : -1;
  } else {
    ny = dy < 0 ? 1 : -1;
  }

  return { t: entry, nx, ny };
}

/**
 * Resolve mover motion against statics: try full motion, on hit clip to the
 * contact and slide along the surface. Up to two substeps (one per axis).
 *
 * Returns the final position, post-slide velocity, and whether the mover
 * touched ground this step (a downward-blocking hit).
 */
export function resolveMove(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  statics: readonly AABB[],
): { x: number; y: number; vx: number; vy: number; groundedThisFrame: boolean } {
  let curX = mover.x;
  let curY = mover.y;
  let curVx = vx;
  let curVy = vy;
  let remaining = dt;
  let grounded = false;

  for (let pass = 0; pass < 3; pass += 1) {
    if (remaining <= 0) break;
    const hit = sweepAABB(
      { x: curX, y: curY, w: mover.w, h: mover.h },
      curVx,
      curVy,
      remaining,
      statics,
    );

    if (!hit) {
      curX += curVx * remaining;
      curY += curVy * remaining;
      remaining = 0;
      break;
    }

    // Move up to the contact point (with a tiny epsilon so we don't land in the surface)
    const epsilon = 1e-4;
    const tClamped = Math.max(0, hit.t - epsilon);
    curX += curVx * remaining * tClamped;
    curY += curVy * remaining * tClamped;

    // Cancel velocity along the contact normal — slide along the surface.
    if (hit.nx !== 0) {
      curVx = 0;
    }
    if (hit.ny !== 0) {
      curVy = 0;
      if (hit.ny < 0) {
        // Mover is on top of the surface (normal pointing up at mover).
        grounded = true;
      }
    }

    remaining = remaining * (1 - tClamped);
  }

  return { x: curX, y: curY, vx: curVx, vy: curVy, groundedThisFrame: grounded };
}
