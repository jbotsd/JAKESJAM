// Lightweight arena navigation for Hot Lobby bots.
//
// Bots used to be map-blind: only "stuck → jump". On vessel-nexus / gen mega
// docks (full floor + cover pylons every ~480px + hop plates), that produces
// grinding into bulkheads and spraying into cover. This module compiles a
// MapDefinition into cover columns + standable ledges + LOS helpers.
// PURE: no Math.random, no Date, no host — safe for unit tests.

import type { MapDefinition } from "@sim/types.ts";

export type CoverCol = {
  x0: number;
  x1: number;
  /** Top of solid (world y, down-positive). */
  top: number;
  /** Bottom / base y. */
  base: number;
  cx: number;
};

export type Ledge = {
  x0: number;
  x1: number;
  top: number;
  cx: number;
};

export type ArenaNav = {
  width: number;
  height: number;
  floorTop: number;
  covers: CoverCol[];
  ledges: Ledge[];
};

const GRAB_MIN_H = 25;
const ONE_WAY_MAX = 24;

function isFloorId(id: string): boolean {
  return id === "floor" || id.startsWith("floor-");
}

/** Build nav from a resolved MapDefinition. Empty/minimal if map has no geometry. */
export function buildArenaNav(map: MapDefinition): ArenaNav {
  const covers: CoverCol[] = [];
  const ledges: Ledge[] = [];
  let floorTop = map.size.y - 36;

  for (const p of map.platforms) {
    const x0 = p.position.x - p.size.x / 2;
    const x1 = p.position.x + p.size.x / 2;
    const top = p.position.y - p.size.y / 2;
    const base = p.position.y + p.size.y / 2;
    const cx = p.position.x;

    if (p.kind === "floor" || isFloorId(p.id)) {
      if (top < floorTop || floorTop === map.size.y - 36) floorTop = top;
      continue;
    }
    // Skip outer frame walls / thin ceilings — not useful cover flanks.
    if (p.kind === "wall") {
      if (p.size.y > map.size.y * 0.5) continue; // full side wall
      if (p.size.y <= 40 && p.size.x > 80) continue; // roof shard
      continue;
    }
    if (p.kind !== "platform") continue;

    // Tall solid = cover / grab column (blocks LOS at shoulder height).
    if (p.size.y >= GRAB_MIN_H) {
      covers.push({ x0, x1, top, base, cx });
      continue;
    }
    // Thin one-way = hop ledge.
    if (p.size.y <= ONE_WAY_MAX) {
      ledges.push({ x0, x1, top, cx });
    }
  }

  covers.sort((a, b) => a.cx - b.cx);
  ledges.sort((a, b) => a.top - b.top || a.cx - b.cx);

  return {
    width: map.size.x,
    height: map.size.y,
    floorTop,
    covers,
    ledges,
  };
}

/** Shoulder-height band for LOS (same idea as mapGen worstSightline). */
export function shoulderY(bodyY: number): number {
  return bodyY - 28;
}

/**
 * Segment LOS from a→b at approximate shoulder height. Blocks if the
 * horizontal span crosses a cover column whose vertical span contains
 * the ray's interpolated Y at the column.
 * Coarse but enough to stop bots spraying into bulkheads.
 */
export function hasLineOfSight(
  nav: ArenaNav,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (nav.covers.length === 0) return true;
  const xLo = Math.min(ax, bx);
  const xHi = Math.max(ax, bx);
  if (xHi - xLo < 8) return true;
  const yA = shoulderY(ay);
  const yB = shoulderY(by);

  for (const c of nav.covers) {
    // Column must sit strictly between the two ends.
    if (c.x1 <= xLo || c.x0 >= xHi) continue;
    // Sample Y at column centre along the segment.
    const t = (c.cx - ax) / (bx - ax || 1);
    if (t <= 0.02 || t >= 0.98) continue;
    const yAt = yA + (yB - yA) * t;
    // Cover blocks if ray height is inside the solid column (with a little
    // margin so standing ON a short pylon doesn't count as blocked).
    if (yAt >= c.top - 4 && yAt <= c.base + 4) return false;
  }
  return true;
}

/**
 * Best cover flank near `me` that breaks LOS to `foe`. Returns a run-to
 * world point beside the cover (on the side away from the foe when possible).
 */
export function nearestCoverFlank(
  nav: ArenaNav,
  meX: number,
  meY: number,
  foeX: number,
  maxDist = 420,
): { x: number; y: number; coverCx: number } | null {
  let best: { x: number; y: number; coverCx: number; score: number } | null = null;
  for (const c of nav.covers) {
    // Prefer covers roughly at our elevation (floor-band pylons).
    if (c.top > meY + 40) continue; // column top far below us — useless
    if (c.base < meY - 200) continue; // floating high mass
    const d = Math.abs(c.cx - meX);
    if (d > maxDist || d < 20) continue;
    // Stand on the side opposite the foe when possible (harder to push).
    const foeOnRight = foeX >= c.cx;
    const standX = foeOnRight ? c.x0 - 36 : c.x1 + 36;
    // Prefer covers that actually break LOS to the foe from the flank.
    const breaks = !hasLineOfSight(nav, standX, meY, foeX, meY);
    const score = (breaks ? 0 : 200) + d;
    if (!best || score < best.score) {
      best = { x: standX, y: meY, coverCx: c.cx, score };
    }
  }
  return best ? { x: best.x, y: best.y, coverCx: best.coverCx } : null;
}

/**
 * When the foe is above us, pick a nearby ledge top to hop toward
 * (rise within maxRise of our feet, under the foe's band).
 */
export function hopTargetToward(
  nav: ArenaNav,
  meX: number,
  meTop: number,
  foeX: number,
  foeY: number,
  maxRise = 129,
  maxGap = 220,
): Ledge | null {
  if (foeY >= meTop - 40) return null; // foe not meaningfully above
  let best: Ledge | null = null;
  let bestScore = Infinity;
  for (const L of nav.ledges) {
    const rise = meTop - L.top; // positive = ledge above our feet
    if (rise <= 8 || rise > maxRise) continue;
    // Prefer ledges between us and the foe, or under the foe.
    const gap = Math.abs(L.cx - meX) - (L.x1 - L.x0) / 2;
    if (gap > maxGap) continue;
    // Don't pick ledges higher than the foe (overshoot).
    if (L.top < foeY - 80) continue;
    const towardFoe = Math.sign(foeX - meX) || 1;
    const towardLedge = Math.sign(L.cx - meX) || 1;
    const align = towardFoe === towardLedge ? 0 : 80;
    const score = rise + Math.abs(L.cx - meX) * 0.5 + align + Math.abs(L.top - foeY) * 0.3;
    if (score < bestScore) {
      bestScore = score;
      best = L;
    }
  }
  return best;
}

/** Horizontal run intent toward a world X. */
export function dirTowardX(fromX: number, toX: number, deadzone = 18): -1 | 0 | 1 {
  const d = toX - fromX;
  if (Math.abs(d) <= deadzone) return 0;
  return d < 0 ? -1 : 1;
}

/** Mega-dock scale factor from map width (1 at ~1280, ~2.3 at 3000). */
export function megaScale(nav: ArenaNav | null): number {
  if (!nav) return 1;
  return Math.min(2.4, Math.max(1, nav.width / 1280));
}
