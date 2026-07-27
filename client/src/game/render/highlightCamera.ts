// Highlight camera (clip-goal CL.E) — pure math, no Phaser.
//
// The studied baseline was a static wide anchored on the star while every
// kill landed at the frame edge (one victim half off-screen — B6). This
// module gives the render camera a highlight vocabulary:
//
//   FRAME THE RELATIONSHIP  anchor = star weighted toward the engaged
//     victim, CLAMPED so both stay on screen whenever their separation
//     fits the view at base zoom; when it can't fit, bias the star.
//   PUNCH THE BEATS  each kill eases the zoom in ~15% for a beat; the
//     cluster's FINAL kill punches ~25% and rides a slow-mo stretch
//     (schedule computed here, applied by the renderer as 1-tick frames).
//   NO CUTS  position/zoom exponentially chase their targets — bounded
//     per-frame deltas by construction, asserted in tests.
//
// All times are RENDER FRAMES (30fps video), not wall clock — offline
// rendering owns its clock.

export type HighlightCamState = { x: number; y: number; zoom: number };

export type HighlightCamInput = {
  star: { x: number; y: number };
  /** Engaged victim (nearest living enemy, or the just-killed victim held
   *  briefly) — null when the star is alone. */
  victim: { x: number; y: number } | null;
  /** 0..1 punch envelope (killBeatEnvelope) and whether it's the final. */
  punch: number;
  finalPunch: boolean;
};

export const HIGHLIGHT_BASE_ZOOM = 2.2;
/** Widest the camera goes when the duel separates — still closer than the
 *  studied baseline's static wide. */
export const HIGHLIGHT_MIN_ZOOM = 1.25;
const PUNCH_ZOOM = 0.15; // +15% on a kill beat
const FINAL_PUNCH_ZOOM = 0.25; // +25% on the cluster's final kill
/** Victim weight in the anchor (star keeps the lead role). */
const VICTIM_WEIGHT = 0.35;
/** Edge margin (world px at zoom 1) kept around both actors. */
const EDGE_MARGIN = 90;
/** Exponential chase rates per frame (30fps): position ~7 frames to 63%,
 *  zoom a touch snappier. */
const POS_K = 0.14;
const ZOOM_K = 0.2;

export function makeHighlightCamState(x: number, y: number): HighlightCamState {
  return { x, y, zoom: HIGHLIGHT_BASE_ZOOM };
}

/** One camera step per rendered frame. viewW/H = broadcast box (1920×1080). */
export function stepHighlightCamera(
  s: HighlightCamState,
  input: HighlightCamInput,
  viewW: number,
  viewH: number,
): HighlightCamState {
  // Zoom-to-fit: a separated duel WIDENS the camera (down to a floor) so
  // both actors project on screen — the studied baseline's off-frame
  // victim (B6) is exactly what a fixed zoom produces. Close-quarters
  // tightens back toward base.
  let fitZoom = HIGHLIGHT_BASE_ZOOM;
  if (input.victim) {
    const sepX = Math.abs(input.victim.x - input.star.x);
    const sepY = Math.abs(input.victim.y - input.star.y);
    const needX = viewW / Math.max(1, sepX + EDGE_MARGIN * 2);
    const needY = viewH / Math.max(1, sepY + EDGE_MARGIN * 2);
    fitZoom = Math.max(HIGHLIGHT_MIN_ZOOM, Math.min(HIGHLIGHT_BASE_ZOOM, needX, needY));
  }
  const targetZoom =
    fitZoom * (1 + (input.finalPunch ? FINAL_PUNCH_ZOOM : PUNCH_ZOOM) * input.punch);

  // Anchor: star biased toward the victim…
  let ax = input.star.x;
  let ay = input.star.y - 20;
  if (input.victim) {
    ax = input.star.x + (input.victim.x - input.star.x) * VICTIM_WEIGHT;
    ay = input.star.y - 20 + (input.victim.y - input.star.y) * VICTIM_WEIGHT;
    // …clamped so BOTH actors project inside the view at the target zoom.
    const halfW = viewW / (2 * targetZoom) - EDGE_MARGIN;
    const halfH = viewH / (2 * targetZoom) - EDGE_MARGIN;
    ax = clampAnchor(ax, input.star.x, input.victim.x, halfW);
    ay = clampAnchor(ay, input.star.y, input.victim.y, halfH);
  }

  return {
    x: s.x + (ax - s.x) * POS_K,
    y: s.y + (ay - s.y) * POS_K,
    zoom: s.zoom + (targetZoom - s.zoom) * ZOOM_K,
  };
}

/** Clamp `anchor` so both a and b sit within ±half of it; when they can't
 *  both fit, keep `a` (the star) in frame. */
function clampAnchor(anchor: number, a: number, b: number, half: number): number {
  if (half <= 0) return a;
  const lo = Math.max(a, b) - half; // anchor must be ≥ this to include max
  const hi = Math.min(a, b) + half; // anchor must be ≤ this to include min
  if (lo > hi) {
    // Separation exceeds the view — star wins, victim rides the edge.
    return Math.abs(anchor - a) > half ? a : anchor;
  }
  return Math.min(hi, Math.max(lo, anchor));
}

// ── Kill beats ──────────────────────────────────────────────────────────

/** Punch envelope per rendered frame: ease-in ~6f (200ms), hold ~10f
 *  (350ms), ease-out ~12f (400ms). */
export function killBeatEnvelope(
  frame: number,
  killFrames: readonly number[],
): { punch: number; finalPunch: boolean } {
  let punch = 0;
  let finalPunch = false;
  const last = killFrames[killFrames.length - 1];
  for (const k of killFrames) {
    const rel = frame - k;
    let v = 0;
    if (rel >= 0 && rel < 6) v = rel / 6;
    else if (rel >= 6 && rel < 16) v = 1;
    else if (rel >= 16 && rel < 28) v = 1 - (rel - 16) / 12;
    if (v > punch) {
      punch = v;
      finalPunch = k === last;
    }
  }
  return { punch, finalPunch };
}

// ── Engaged-victim identity (clip-goal STUDY 3, D1/CL.E) ────────────────

/**
 * Resolves which victimId the camera should engage with at the given
 * relative tick — the credited kill nearest in time, BY IDENTITY, not a
 * proximity guess. Live verification (STUDY 3 follow-up) found the old
 * "nearest living opponent" heuristic locking onto the star alone (or a
 * bystander) whenever the true victim was far away on screen — routine for
 * a ranged hitscan kill, which is most of them. `killTicks`/`killVictims`
 * are parallel arrays (same order/length) from the render window's
 * `&kills=`/`&victims=` params.
 */
export function resolveEngagedVictimId(
  rel: number,
  killTicks: readonly number[],
  killVictims: readonly string[],
): string | null {
  if (killTicks.length === 0 || killTicks.length !== killVictims.length) return null;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < killTicks.length; i++) {
    const d = Math.abs(killTicks[i]! - rel);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx >= 0 ? killVictims[bestIdx]! : null;
}

// ── Slow-mo schedule ────────────────────────────────────────────────────

/** Sim ticks (relative to window start) rendered at 1 tick/frame instead
 *  of 2 — 2× time dilation around the FINAL kill. 30 ticks (0.5s of sim)
 *  → +15 encoded frames; the renderer and the duration gate both derive
 *  their numbers from this one function. */
export const SLOWMO_SPAN_TICKS = 30;
export const SLOWMO_EXTRA_FRAMES = SLOWMO_SPAN_TICKS / 2;

export function slowMoTickRange(
  killTicks: readonly number[],
  windowTicks: number,
): { start: number; end: number } | null {
  const last = killTicks[killTicks.length - 1];
  if (last === undefined) return null;
  // Lead the impact slightly so the hit itself lands inside the dilation.
  const start = Math.max(0, last - 6);
  const end = Math.min(windowTicks, start + SLOWMO_SPAN_TICKS);
  if (end <= start) return null;
  return { start, end };
}
