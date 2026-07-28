// Highlight camera (clip-goal CL.E) — pure math, no Phaser.
//
// The studied baseline was a static wide anchored on the star while every
// kill landed at the frame edge (one victim half off-screen — B6). This
// module gives the render camera a highlight vocabulary:
//
//   FRAME THE RELATIONSHIP  anchor = star weighted toward the engaged
//     victim, CLAMPED so both stay on screen whenever their separation
//     fits the view at base zoom; when it genuinely can't fit even at the
//     zoom floor, split the anchor to the midpoint rather than favor either.
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
 *  studied baseline's static wide.
 *
 *  D9 fix (clip-goal STUDY 4): the old 1.25 floor was tuned for "a
 *  separated duel" in the loose sense, not this game's actual long-range
 *  engagements — real hitscan kills on the production arenas (generated
 *  arenas run up to 3000×2200; vessel-nexus/skyseam are 3000×1100) routinely
 *  separate star and victim well past what 1.25× can frame, reproducing the
 *  "credited kill, zero visual proof" symptom via a camera-framing cause
 *  distinct from D1's (already-fixed) wrong-victim-identity bug — live
 *  footage showed the victim reduced to an edge sliver or fully off-frame
 *  even with the camera already at its old widest. 0.35 keeps both actors
 *  inside the frame (given EDGE_MARGIN's slack) for any separation up to the
 *  largest registered arena's full diagonal, even through a full final-kill
 *  punch beat — see the punch-safe fit math in `stepHighlightCamera` below,
 *  which is the other half of this fix (the floor alone isn't sufficient;
 *  the punch-in was independently able to re-violate containment right at
 *  the kill-credit frame). */
export const HIGHLIGHT_MIN_ZOOM = 0.35;
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
  // D9 (clip-goal STUDY 4): the punch-in beat multiplies zoom UP for the
  // cinematic flourish — that multiply happens on top of fitZoom, so it has
  // to be accounted for BEFORE the fit is computed, not after. Live footage
  // showed the camera zoomed to its (old) widest right before a credited
  // kill, then punching in tighter exactly on the kill-credit frame — the
  // one moment the victim's death has to read — clipping or fully losing
  // them. Discounting the fit box by the multiplier up front guarantees
  // targetZoom (fitZoom * punchMultiplier, below) never zooms in past what
  // containment actually allows, through the whole punch envelope.
  const punchMultiplier = 1 + (input.finalPunch ? FINAL_PUNCH_ZOOM : PUNCH_ZOOM) * input.punch;

  // Zoom-to-fit: a separated duel WIDENS the camera (down to a floor) so
  // both actors project on screen — the studied baseline's off-frame
  // victim (B6) is exactly what a fixed zoom produces. Close-quarters
  // tightens back toward base.
  let fitZoom = HIGHLIGHT_BASE_ZOOM;
  if (input.victim) {
    const sepX = Math.abs(input.victim.x - input.star.x);
    const sepY = Math.abs(input.victim.y - input.star.y);
    const needX = viewW / (Math.max(1, sepX + EDGE_MARGIN * 2) * punchMultiplier);
    const needY = viewH / (Math.max(1, sepY + EDGE_MARGIN * 2) * punchMultiplier);
    fitZoom = Math.max(HIGHLIGHT_MIN_ZOOM, Math.min(HIGHLIGHT_BASE_ZOOM, needX, needY));
  }
  const targetZoom = fitZoom * punchMultiplier;

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
 *  both fit, split the difference rather than favoring either actor. */
function clampAnchor(anchor: number, a: number, b: number, half: number): number {
  const mid = (a + b) / 2;
  if (half <= 0) return mid;
  const lo = Math.max(a, b) - half; // anchor must be ≥ this to include max
  const hi = Math.min(a, b) + half; // anchor must be ≤ this to include min
  if (lo > hi) {
    // D9 (clip-goal STUDY 4): with the punch-safe fit math and the much
    // lower HIGHLIGHT_MIN_ZOOM above, this only fires for separations past
    // the largest registered arena's diagonal — a purely defensive case
    // with no real footage behind it. The old behavior snapped fully to the
    // star whenever the raw weighted anchor drifted far enough, which is
    // exactly the reproduced "victim never appears" symptom; the midpoint
    // gives both actors equal (partial) screen presence instead of
    // deleting the victim outright.
    return mid;
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
