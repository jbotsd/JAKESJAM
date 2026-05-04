// ───────────────────────────────────────────────────────────────────────────
// SUBSTRATE PIVOT IN PROGRESS — port target Zig→WASM. See
// docs/adr/0006-zig-wasm-sim-substrate.md and
// docs/zig-wasm-migration.md before adding behaviour here.
// ───────────────────────────────────────────────────────────────────────────
//
// Deterministic collision system for sim/.
//
// Architecture:
//   - AABB primitives: overlap, point-in, circle-vs-AABB (proper closest-point)
//   - Swept AABB: slab-method sweep with multi-pass slide resolution
//   - Spatial hash grid: O(1) broadphase for all static geometry
//   - Pre-computed static cache: platforms converted once at map load
//   - One-way platform support: pass-through from below, solid from above
//   - Shared platformToAABB utility: single source of truth for the conversion
//
// Perf contract: ~80 platforms, ~10 destructibles, ~15 projectiles, ~10 players.
// The spatial hash makes per-entity checks touch only ~4-6 cells rather than
// sweeping all 80+ platforms every tick. At 60Hz with 10 players that's ~4800
// fewer comparisons per second.

import type { PlatformDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Core AABB type
// ---------------------------------------------------------------------------

export type AABB = { x: number; y: number; w: number; h: number };

/**
 * Height threshold (px) at or below which a `kind: "platform"` entry is
 * treated as a thin jump-through-from-below platform. Anything taller is
 * cover or wall-equivalent — kept solid 4-way regardless of `kind`. This
 * keeps the existing map authoring stable: thin ledges + the mid platform
 * stay one-way; cover obstacles stop accidentally being passable.
 *
 * Pick: 24 px is wider than any current thin platform (boxworks-mini's
 * thinnest is 18 px) and well below the smallest cover obstacle (80 px).
 * Adjust if a designer adds a thin platform > 24 px.
 */
export const ONE_WAY_MAX_HEIGHT_PX = 24;

// ---------------------------------------------------------------------------
// Coordinate conversion — single source of truth
// ---------------------------------------------------------------------------

/** Convert a center-origin PlatformDefinition to top-left AABB. */
export function platformToAABB(p: PlatformDefinition): AABB {
  return {
    x: p.position.x - p.size.x / 2,
    y: p.position.y - p.size.y / 2,
    w: p.size.x,
    h: p.size.y,
  };
}

/** Convert a center-origin destructible-like entity to top-left AABB. */
export function centerToAABB(
  cx: number,
  cy: number,
  width: number,
  height: number,
): AABB {
  return { x: cx - width / 2, y: cy - height / 2, w: width, h: height };
}

// ---------------------------------------------------------------------------
// Static overlap tests
// ---------------------------------------------------------------------------

/** Static AABB-vs-AABB overlap. Strict inequalities (edge-touching = no overlap). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Point-in-AABB (inclusive edges). */
export function pointInAABB(px: number, py: number, b: AABB): boolean {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

/**
 * Proper circle-vs-AABB overlap using closest-point distance.
 * Handles corner cases correctly (unlike the old Minkowski expansion approach
 * which treated corners the same as edges — a circle near a corner would
 * register false positives at diagonal offsets beyond its radius).
 */
export function circleOverlapsAABB(
  cx: number,
  cy: number,
  radius: number,
  b: AABB,
): boolean {
  // Find the closest point on the AABB to the circle center
  const closestX = Math.max(b.x, Math.min(cx, b.x + b.w));
  const closestY = Math.max(b.y, Math.min(cy, b.y + b.h));

  // Check if the distance from circle center to closest point <= radius
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

// ---------------------------------------------------------------------------
// Spatial Hash Grid — broadphase acceleration
// ---------------------------------------------------------------------------

/**
 * A spatial hash grid that buckets static AABBs into fixed-size cells.
 * Queries return candidate indices that might overlap the query region.
 *
 * Cell size tuned for JAKESJAM's geometry: platforms are 100-300px wide,
 * player body is 26x56. A 128px cell means most platforms span 1-3 cells
 * and most queries touch 1-4 cells.
 */
export const SPATIAL_CELL_SIZE = 128;

export type SpatialGrid = {
  cellSize: number;
  /** Map from cell key to array of indices into the source AABB array. */
  cells: Map<number, number[]>;
  /** The source AABBs (reference, not copied). */
  aabbs: readonly AABB[];
  /** Grid width in cells (for key computation). */
  cols: number;
};

/** Pack (col, row) into a single integer key. */
function cellKey(col: number, row: number, cols: number): number {
  return row * cols + col;
}

/**
 * Build a spatial grid from a static AABB array. Call once at map load.
 * The grid covers [0, worldWidth] x [0, worldHeight].
 */
export function buildSpatialGrid(
  aabbs: readonly AABB[],
  worldWidth: number,
  worldHeight: number,
  cellSize: number = SPATIAL_CELL_SIZE,
): SpatialGrid {
  const cols = Math.ceil(worldWidth / cellSize) + 1;
  const rows = Math.ceil(worldHeight / cellSize) + 1;
  const cells = new Map<number, number[]>();

  for (let i = 0; i < aabbs.length; i++) {
    const a = aabbs[i]!;
    const minCol = Math.max(0, Math.floor(a.x / cellSize));
    const maxCol = Math.min(cols - 1, Math.floor((a.x + a.w) / cellSize));
    const minRow = Math.max(0, Math.floor(a.y / cellSize));
    const maxRow = Math.min(rows - 1, Math.floor((a.y + a.h) / cellSize));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = cellKey(c, r, cols);
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(i);
      }
    }
  }

  return { cellSize, cells, aabbs, cols };
}

/**
 * Query the spatial grid for all AABB indices that might overlap the given
 * region. Returns a de-duplicated array of candidate indices.
 *
 * Use the pre-allocated `seen` set from the StaticCollisionCache to avoid
 * per-query allocations in the hot path. If not provided, allocates a new Set.
 */
export function queryGrid(
  grid: SpatialGrid,
  region: AABB,
  seen?: Set<number>,
): number[] {
  const { cellSize, cells, cols } = grid;
  const minCol = Math.max(0, Math.floor(region.x / cellSize));
  const maxCol = Math.floor((region.x + region.w) / cellSize);
  const minRow = Math.max(0, Math.floor(region.y / cellSize));
  const maxRow = Math.floor((region.y + region.h) / cellSize);

  const s = seen ?? new Set<number>();
  s.clear();
  const result: number[] = [];

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const bucket = cells.get(cellKey(c, r, cols));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const idx = bucket[i]!;
        if (!s.has(idx)) {
          s.add(idx);
          result.push(idx);
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pre-computed Static Collision Cache
// ---------------------------------------------------------------------------

/**
 * Immutable cache built once at map load. Holds pre-converted AABBs, the
 * spatial hash grid, and a reusable scratch Set for zero-alloc queries.
 *
 * The `oneWay` bitfield marks which platforms allow pass-through from below
 * (kind === 'platform'). Floors and walls are always solid from all directions.
 */
export type StaticCollisionCache = {
  /** Pre-converted AABBs (top-left origin). */
  aabbs: readonly AABB[];
  /** Spatial grid built from those AABBs. */
  grid: SpatialGrid;
  /** Bitmask: true = one-way (pass-through from below). */
  oneWay: readonly boolean[];
  /** Query scratch set — reuse across frames to avoid GC. */
  _seen: Set<number>;
};

/**
 * Build the static collision cache from a platform array + world size.
 * Call once at match start — the result is immutable for the match lifetime.
 */
export function buildStaticCache(
  platforms: readonly PlatformDefinition[],
  worldWidth: number,
  worldHeight: number,
): StaticCollisionCache {
  const aabbs: AABB[] = [];
  const oneWay: boolean[] = [];

  for (const p of platforms) {
    aabbs.push(platformToAABB(p));
    // 'platform' kind = jump-through-from-below ONLY when the platform is
    // thin (≤ 24 px tall). Anything taller is a chest-high cover obstacle —
    // boxworks-mini's `cover-left/right` are 80 px tall and meant to be
    // solid 4-way. The original `kind === "platform"` rule made cover
    // pass-through laterally because the one-way short-circuit at
    // collision.ts ~line 336 treats any mover with bottom > coverTop+2 as
    // "below the platform" and skips the side hit. Floors and walls are
    // always solid regardless of height.
    oneWay.push(p.kind === "platform" && p.size.y <= ONE_WAY_MAX_HEIGHT_PX);
  }

  const grid = buildSpatialGrid(aabbs, worldWidth, worldHeight);

  return {
    aabbs,
    grid,
    oneWay,
    _seen: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Sweep Hit type
// ---------------------------------------------------------------------------

export type SweepHit = {
  /** 0..1, the fraction of the velocity step at which contact occurred */
  t: number;
  /** Surface normal at contact (-1, 0, +1 on each axis) */
  nx: number;
  ny: number;
  /** Index into the statics array */
  index: number;
};

// ---------------------------------------------------------------------------
// Swept AABB
// ---------------------------------------------------------------------------

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

/**
 * Swept AABB using the spatial grid for broadphase. Only tests candidates
 * that share grid cells with the mover's trajectory bounding box.
 * Respects one-way platform semantics: skips downward-blocking hits on
 * one-way platforms when the mover approaches from below.
 */
export function sweepAABBCached(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  cache: StaticCollisionCache,
  respectOneWay: boolean = false,
): SweepHit | null {
  const dx = vx * dt;
  const dy = vy * dt;

  // Compute the trajectory bounding box (mover start + mover end, union)
  const endX = mover.x + dx;
  const endY = mover.y + dy;
  const queryRegion: AABB = {
    x: Math.min(mover.x, endX),
    y: Math.min(mover.y, endY),
    w: mover.w + Math.abs(dx),
    h: mover.h + Math.abs(dy),
  };

  const candidates = queryGrid(cache.grid, queryRegion, cache._seen);
  let best: SweepHit | null = null;

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci]!;
    const s = cache.aabbs[i]!;
    const hit = sweepAgainstOne(mover, dx, dy, s);
    if (!hit) continue;

    // One-way platform logic: only block if mover is ABOVE the platform
    // (mover's bottom edge <= platform's top edge at contact time) and
    // moving downward (dy > 0). Skip hits from below/side.
    if (respectOneWay && cache.oneWay[i]) {
      // Only block downward motion hitting the top surface
      if (hit.ny >= 0) continue; // Not a downward-into-top hit
      // Mover bottom must be at or above platform top at start of frame.
      // The +2 px slack is PROTECTIVE, not slop: float drift accumulating
      // over many ticks can put a grounded player's moverBottom between
      // platformTop+0.5 and platformTop+2, and the sweep needs to STILL
      // find the hit so we push the player back up onto the surface.
      // (See git blame: H1 tightened this to +0.5 and re-introduced
      // fall-through-terrain at production scale; reverted here.)
      const moverBottom = mover.y + mover.h;
      const platformTop = s.y;
      if (moverBottom > platformTop + 2) continue; // Already inside/below — pass through
    }

    if (best === null || hit.t < best.t) {
      best = { t: hit.t, nx: hit.nx, ny: hit.ny, index: i };
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
  let xEntry: number;
  let xExit: number;
  if (dx > 0) {
    xEntry = (target.x - (mover.x + mover.w)) / dx;
    xExit = (target.x + target.w - mover.x) / dx;
  } else if (dx < 0) {
    xEntry = (target.x + target.w - mover.x) / dx;
    xExit = (target.x - (mover.x + mover.w)) / dx;
  } else {
    if (mover.x + mover.w <= target.x || mover.x >= target.x + target.w) {
      return null;
    }
    xEntry = -Infinity;
    xExit = Infinity;
  }

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

// ---------------------------------------------------------------------------
// Movement resolution
// ---------------------------------------------------------------------------

/**
 * Resolve mover motion against statics: try full motion, on hit clip to the
 * contact and slide along the surface. Up to 3 substeps.
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

    // Float-safety pull-back: stop just before the contact in `t`-space so
    // `curX/curY` never sit *inside* the static. Without this, a follow-up
    // sweep on the same surface can return t≈0 with the mover already
    // overlapping by sub-pixel float error, which the slide loop then
    // burns a pass on. 1e-4 in normalised t ≈ 0.0017 px at 16.67 ms ×
    // 1000 px/s — well below visible.
    const epsilon = 1e-4;
    const tClamped = Math.max(0, hit.t - epsilon);
    curX += curVx * remaining * tClamped;
    curY += curVy * remaining * tClamped;

    if (hit.nx !== 0) {
      curVx = 0;
    }
    if (hit.ny !== 0) {
      curVy = 0;
      if (hit.ny < 0) {
        grounded = true;
      }
    }

    remaining = remaining * (1 - tClamped);
  }

  return { x: curX, y: curY, vx: curVx, vy: curVy, groundedThisFrame: grounded };
}

/**
 * Resolve movement using the spatial-grid-accelerated sweep. Identical logic
 * to `resolveMove` but uses `sweepAABBCached` for O(1) broadphase.
 * Supports one-way platforms when `respectOneWay` is true.
 */
export function resolveMoveCached(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  cache: StaticCollisionCache,
  respectOneWay: boolean = false,
): { x: number; y: number; vx: number; vy: number; groundedThisFrame: boolean } {
  let curX = mover.x;
  let curY = mover.y;
  let curVx = vx;
  let curVy = vy;
  let remaining = dt;
  let grounded = false;

  for (let pass = 0; pass < 3; pass += 1) {
    if (remaining <= 0) break;
    const hit = sweepAABBCached(
      { x: curX, y: curY, w: mover.w, h: mover.h },
      curVx,
      curVy,
      remaining,
      cache,
      respectOneWay,
    );

    if (!hit) {
      curX += curVx * remaining;
      curY += curVy * remaining;
      remaining = 0;
      break;
    }

    // Float-safety pull-back: stop just before the contact in `t`-space so
    // `curX/curY` never sit *inside* the static. Without this, a follow-up
    // sweep on the same surface can return t≈0 with the mover already
    // overlapping by sub-pixel float error, which the slide loop then
    // burns a pass on. 1e-4 in normalised t ≈ 0.0017 px at 16.67 ms ×
    // 1000 px/s — well below visible.
    const epsilon = 1e-4;
    const tClamped = Math.max(0, hit.t - epsilon);
    curX += curVx * remaining * tClamped;
    curY += curVy * remaining * tClamped;

    if (hit.nx !== 0) {
      curVx = 0;
    }
    if (hit.ny !== 0) {
      curVy = 0;
      if (hit.ny < 0) {
        grounded = true;
      }
    }

    remaining = remaining * (1 - tClamped);
  }

  // Post-resolve "am I touching/overlapping the ground?" probe (D2). The
  // swept loop only sets `grounded=true` when a *new* hit fires this tick.
  // Two scenarios this misses:
  //   1. Player resting on platform with vy~0 — sweep returns null because
  //      entry is at t=0 or in the past (already at contact).
  //   2. Player whose foot has drifted past platformTop by 0..2 px due to
  //      float accumulation — sweep returns null because entry < 0.
  // Without this probe + snap, scenario 2 was producing the user-reported
  // "falls through terrain" bug: gravity kept adding to vy each tick while
  // grounded stayed false, eventually breaking through.
  //
  // The probe AABB extends 2 px below the resolved position. On overlap with
  // a static AABB, we set grounded=true AND snap the foot back to the static
  // top + zero vy if descending. The snap is what makes the fix work — just
  // setting grounded=true while letting vy keep climbing is the bug we hit.
  if (!grounded) {
    // Probe extends 2 px below current position — matches the +2 slack used
    // by the swept one-way short-circuit so we recover any drift the swept
    // loop legitimately ignored.
    const probe: AABB = { x: curX, y: curY, w: mover.w, h: mover.h + 2 };
    const candidates = queryGrid(cache.grid, probe, cache._seen);
    let bestPlatformTop = Infinity;
    for (let ci = 0; ci < candidates.length; ci++) {
      const i = candidates[ci]!;
      const s = cache.aabbs[i]!;
      if (!aabbOverlap(probe, s)) continue;
      // For one-way platforms only ground if mover was already at-or-above
      // the platform top going into this tick. The +2 slack matches the
      // swept short-circuit.
      if (respectOneWay && cache.oneWay[i]) {
        const moverBottomBefore = mover.y + mover.h;
        const platformTop = s.y;
        if (moverBottomBefore > platformTop + 2) continue;
      }
      grounded = true;
      // Track the highest platform top under us — that's where we snap to.
      if (s.y < bestPlatformTop) bestPlatformTop = s.y;
    }
    // Snap foot back to platform top if probe found ground. Stops the
    // "drifted past + grounded but still gravitating downward" failure.
    if (grounded && bestPlatformTop < Infinity) {
      curY = bestPlatformTop - mover.h;
      if (curVy > 0) curVy = 0;
    }
  }

  return { x: curX, y: curY, vx: curVx, vy: curVy, groundedThisFrame: grounded };
}

// ---------------------------------------------------------------------------
// Circle-vs-static-cache queries (for projectiles / destructibles / fire)
// ---------------------------------------------------------------------------

/**
 * Check if a circle (projectile) overlaps any platform in the cache.
 * Returns the index of the first overlapping platform, or -1.
 * Uses the spatial grid for broadphase.
 */
export function circleHitsAnyCached(
  cx: number,
  cy: number,
  radius: number,
  cache: StaticCollisionCache,
): number {
  const region: AABB = {
    x: cx - radius,
    y: cy - radius,
    w: radius * 2,
    h: radius * 2,
  };
  const candidates = queryGrid(cache.grid, region, cache._seen);

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci]!;
    if (circleOverlapsAABB(cx, cy, radius, cache.aabbs[i]!)) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the first platform a circle overlaps and compute bounce reflection.
 * Returns null if no overlap. Used by projectile bouncing.
 */
export function circleBounceCached(
  cx: number,
  cy: number,
  prevX: number,
  prevY: number,
  radius: number,
  _vx: number,
  _vy: number,
  cache: StaticCollisionCache,
): { index: number; reflectX: boolean; reflectY: boolean } | null {
  const region: AABB = {
    x: cx - radius,
    y: cy - radius,
    w: radius * 2,
    h: radius * 2,
  };
  const candidates = queryGrid(cache.grid, region, cache._seen);

  for (let ci = 0; ci < candidates.length; ci++) {
    const i = candidates[ci]!;
    const aabb = cache.aabbs[i]!;
    if (!circleOverlapsAABB(cx, cy, radius, aabb)) continue;

    // Determine reflection axis: which side did we cross?
    const left = aabb.x - radius;
    const right = aabb.x + aabb.w + radius;
    const top = aabb.y - radius;
    const bottom = aabb.y + aabb.h + radius;

    let reflectX = false;
    let reflectY = false;
    if (prevX <= left || prevX >= right) {
      reflectX = true;
    } else if (prevY <= top || prevY >= bottom) {
      reflectY = true;
    } else {
      const dxEdge = Math.min(Math.abs(cx - left), Math.abs(cx - right));
      const dyEdge = Math.min(Math.abs(cy - top), Math.abs(cy - bottom));
      if (dxEdge < dyEdge) reflectX = true;
      else reflectY = true;
    }

    return { index: i, reflectX, reflectY };
  }

  return null;
}
