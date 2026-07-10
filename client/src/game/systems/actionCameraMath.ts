// Pure framing math for ActionCamera — no Phaser, unit-testable.
//
// Envelope law: when enemies are in range, lean the frame so the fight pair
// stays readable. Hard min/max clamps on a thrashing subject set caused
// stutter — prefer continuous soft pulls + sticky subjects + smoothed zoom.

export type Point2 = { x: number; y: number };

/** Enter envelope when foe is within this distance (mid: 620↔880). */
export const ENVELOPE_RANGE = 750;
/** Leave envelope only beyond this (hysteresis — stops subject flicker). */
export const ENVELOPE_RANGE_EXIT = 950;
/** Soft edge band as fraction of half-view (mid: 0.12↔0.20). */
export const ENVELOPE_MARGIN_FRAC = 0.16;
/** Player-heavy centroid; foes lean without yanking (mid: 3.6/1.35 ↔ 5.5/0.75). */
export const SELF_WEIGHT = 4.5;
export const OTHER_WEIGHT = 1.05;
export const OTHER_FADE = 520;
export const OTHER_MAX_DIST = 1250;
/** One sticky duel partner keeps FFA stable. */
export const ENVELOPE_MAX_OTHERS = 1;
export const ENVELOPE_MIN_ZOOM = 1.02;
/** Don't re-zoom for sub-this delta (mid: 0.035↔0.06). */
export const ZOOM_DEADBAND = 0.048;

/**
 * Soft weighted centroid: player heavy, nearby action fades in by distance.
 */
export function weightedCentroid(
  self: Point2,
  extras: ReadonlyArray<Point2>,
): Point2 {
  let tx = self.x * SELF_WEIGHT;
  let ty = self.y * SELF_WEIGHT;
  let wSum = SELF_WEIGHT;
  for (const p of extras) {
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    if (d > OTHER_MAX_DIST) continue;
    const w = OTHER_WEIGHT / (1 + d / OTHER_FADE);
    tx += p.x * w;
    ty += p.y * w;
    wSum += w;
  }
  return { x: tx / wSum, y: ty / wSum };
}

/**
 * Sticky subject pick: keep previous subjects while they stay under
 * ENVELOPE_RANGE_EXIT; fill remaining slots with nearest under ENVELOPE_RANGE.
 * Prevents nearest-enemy thrash when two foes swap distance ranks.
 */
export function stickyEnvelopeSubjects(
  self: Point2,
  extras: ReadonlyArray<Point2>,
  prev: ReadonlyArray<Point2>,
  maxOthers = ENVELOPE_MAX_OTHERS,
): Point2[] {
  const out: Point2[] = [];
  const used = new Set<number>();

  // Keep previous subjects if still close enough (match by nearest extra).
  for (const p of prev) {
    if (out.length >= maxOthers) break;
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < extras.length; i++) {
      if (used.has(i)) continue;
      const e = extras[i]!;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0) continue;
    const e = extras[bestI]!;
    const dSelf = Math.hypot(e.x - self.x, e.y - self.y);
    // Sticky: stay if still within exit range and roughly same body (50px match).
    if (bestD < 80 && dSelf <= ENVELOPE_RANGE_EXIT) {
      out.push(e);
      used.add(bestI);
    }
  }

  // Fill with nearest under enter range.
  const ranked = extras
    .map((p, i) => ({ p, i, d: Math.hypot(p.x - self.x, p.y - self.y) }))
    .filter((e) => !used.has(e.i) && e.d <= ENVELOPE_RANGE && e.d > 0)
    .sort((a, b) => a.d - b.d);
  for (const e of ranked) {
    if (out.length >= maxOthers) break;
    out.push(e.p);
  }
  return out;
}

/** @deprecated use stickyEnvelopeSubjects — kept for simple tests. */
export function envelopeSubjects(
  self: Point2,
  extras: ReadonlyArray<Point2>,
  maxOthers = ENVELOPE_MAX_OTHERS,
  range = ENVELOPE_RANGE,
): Point2[] {
  const ranked = extras
    .map((p) => ({ p, d: Math.hypot(p.x - self.x, p.y - self.y) }))
    .filter((e) => e.d <= range && e.d > 0)
    .sort((a, b) => a.d - b.d);
  const out: Point2[] = [];
  for (const e of ranked) {
    out.push(e.p);
    if (out.length >= maxOthers) break;
  }
  return out;
}

export type EnvelopeResult = {
  x: number;
  y: number;
  neededHalfW: number;
  neededHalfH: number;
  subjectCount: number;
  /** 0 = soft only; 1 = fully constrained (subjects at edge/outside). */
  tension: number;
};

/**
 * Soft envelope: start at `soft`, pull only as far as needed so each subject
 * sits inside the view with margin. Continuous (no min/max interval snap that
 * flips when loX/hiX thrash). When span > view, blend toward group midpoint.
 */
export function fitEnvelope(
  soft: Point2,
  self: Point2,
  subjects: ReadonlyArray<Point2>,
  halfW: number,
  halfH: number,
  marginFrac = ENVELOPE_MARGIN_FRAC,
): EnvelopeResult {
  const pts: Point2[] = [self, ...subjects];
  if (pts.length === 1 || halfW <= 1 || halfH <= 1) {
    return {
      x: soft.x,
      y: soft.y,
      neededHalfW: 0,
      neededHalfH: 0,
      subjectCount: 0,
      tension: 0,
    };
  }

  let minX = pts[0]!.x;
  let maxX = pts[0]!.x;
  let minY = pts[0]!.y;
  let maxY = pts[0]!.y;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const neededHalfW = (spanX / 2) / Math.max(0.2, 1 - 2 * marginFrac);
  const neededHalfH = (spanY / 2) / Math.max(0.2, 1 - 2 * marginFrac);

  const fitHalfW = halfW * (1 - marginFrac);
  const fitHalfH = halfH * (1 - marginFrac);

  // Soft pull: only move center when a subject sits outside the fit rect.
  let x = soft.x;
  let y = soft.y;
  let pull = 0;
  for (const p of pts) {
    const dx = p.x - x;
    if (dx > fitHalfW) {
      x += dx - fitHalfW;
      pull += dx - fitHalfW;
    } else if (dx < -fitHalfW) {
      x += dx + fitHalfW;
      pull += -dx - fitHalfW;
    }
    const dy = p.y - y;
    if (dy > fitHalfH) {
      y += dy - fitHalfH;
      pull += dy - fitHalfH;
    } else if (dy < -fitHalfH) {
      y += dy + fitHalfH;
      pull += -dy - fitHalfH;
    }
  }

  // If the group is wider than the view, ease toward midpoint (best effort)
  // rather than fighting impossible constraints.
  const overflowX = Math.max(0, neededHalfW - halfW);
  const overflowY = Math.max(0, neededHalfH - halfH);
  if (overflowX > 0 || overflowY > 0) {
    const t = Math.min(1, (overflowX + overflowY) / (halfW + halfH + 1));
    x = x + (midX - x) * t;
    y = y + (midY - y) * t;
    pull += overflowX + overflowY;
  }

  const tension = Math.min(1, pull / (halfW * 0.5 + 1));

  return {
    x,
    y,
    neededHalfW: subjects.length ? neededHalfW : 0,
    neededHalfH: subjects.length ? neededHalfH : 0,
    subjectCount: subjects.length,
    tension,
  };
}

export function zoomToFit(
  viewportW: number,
  viewportH: number,
  neededHalfW: number,
  neededHalfH: number,
  baseZoom: number,
  minZoom = ENVELOPE_MIN_ZOOM,
): number {
  if (neededHalfW <= 0 && neededHalfH <= 0) return baseZoom;
  let z = baseZoom;
  if (neededHalfW > 0) z = Math.min(z, viewportW / (2 * neededHalfW));
  if (neededHalfH > 0) z = Math.min(z, viewportH / (2 * neededHalfH));
  return Math.min(baseZoom, Math.max(minZoom, z));
}

/**
 * Apply deadband around current zoom so tiny goal flips don't thrash.
 * Zoom-out (goal < current) responds sooner than zoom-in (hysteresis).
 */
export function smoothZoomGoal(
  current: number,
  goal: number,
  baseZoom: number,
  deadband = ZOOM_DEADBAND,
): number {
  const g = Math.min(baseZoom, Math.max(ENVELOPE_MIN_ZOOM, goal));
  const d = g - current;
  // Zooming out (negative d): smaller deadband so fights open up quickly.
  // Zooming in: larger deadband so we don't pump when the gap flickers.
  const band = d < 0 ? deadband * 0.45 : deadband;
  if (Math.abs(d) < band) return current;
  return g;
}

export function fightPairFocus(
  self: Point2,
  extras: ReadonlyArray<Point2>,
  range = ENVELOPE_RANGE,
): Point2 {
  const subjects = envelopeSubjects(self, extras, 1, range);
  if (subjects.length === 0) return self;
  const o = subjects[0]!;
  return { x: (self.x + o.x) / 2, y: (self.y + o.y) / 2 };
}

/** Exp-smooth a point toward target (frame-rate independent via k). */
export function expSmoothPoint(
  cur: Point2,
  target: Point2,
  k: number,
  dt: number,
): Point2 {
  const a = 1 - Math.exp(-k * dt);
  return {
    x: cur.x + (target.x - cur.x) * a,
    y: cur.y + (target.y - cur.y) * a,
  };
}
