// lowerThirdAlpha — pure closed-form alpha for the clip lower-third
// (clip-goal CL.D).
//
// STUDY 3 regression (2026-07-27, 2 of 7 render-path clips): the lower-
// third rode all the way to the hard cut still full-opacity in one clip,
// and was still full-opacity on the literal last video frame in another —
// both violate CL.D.2's "exits 0.6s before the out-point". The previous
// implementation stepped alpha by a fixed ±0.12 per rendered FRAME toward
// a 0/1 target — an iterative approach that only ever gets CLOSE to its
// target, and has no guarantee of enough frames of runway to fully
// converge depending on how the tick/frame ratio plays out around a
// slow-mo stretch. This version computes the exact target alpha directly
// from the current tick, so it is IDENTICALLY 0 at and after `hideAt`,
// with no iterative convergence to fall short of.

/**
 * @param rel current tick relative to the render window's start
 * @param clipTicks total window length in ticks
 * @param showFrom tick (relative) the lower-third enters at — the
 *   cluster's first kill
 * @param exitLeadTicks ticks held clear of the out-point before hidden
 * @param fadeTicks fade duration in ticks (both directions)
 */
export function computeLowerThirdAlpha(
  rel: number,
  clipTicks: number,
  showFrom: number,
  exitLeadTicks = 36,
  fadeTicks = 18,
): number {
  const hideAt = clipTicks - exitLeadTicks;
  let alpha: number;
  if (rel < showFrom) {
    alpha = 0;
  } else if (rel < showFrom + fadeTicks) {
    alpha = (rel - showFrom) / fadeTicks;
  } else if (rel < hideAt - fadeTicks) {
    alpha = 1;
  } else if (rel < hideAt) {
    alpha = 1 - (rel - (hideAt - fadeTicks)) / fadeTicks;
  } else {
    alpha = 0;
  }
  return Math.max(0, Math.min(1, alpha));
}
