// nameplateLayout — resolves adjacent-nameplate collisions.
//
// clip-goal STUDY 3 (CL.A regression): the 2026-07-17 CL.A ledger entry
// noted "adjacent bot nameplates collide/overlap" in passing but no pillar
// ever assigned it a test or a fix — it reproduced on tape for the first
// time 2026-07-27 (`0e21238e`, t≈0.03s: VVOC/BOT·PISTON nameplates garbled
// together). Root cause: `ProceduralPlayerRig.drawNameplate` draws each
// player's plate independently at that player's own head position with no
// awareness of any OTHER player's plate — two characters standing close
// together (routine at melee range, or right after a fight starts) draw
// directly on top of each other.
//
// Pure math, no Phaser: given every on-screen actor's approximate nameplate
// anchor + footprint (nameplateWidth() is the SAME formula drawNameplate
// itself uses — see ProceduralPlayerRig.ts), returns a per-actor vertical
// LIFT (world px) that, subtracted from the anchor's y, clears every
// collision. Deterministic + input-order-independent (actors are sorted by
// id before resolving) so a replay re-sim never wobbles frame to frame from
// object-iteration order alone.

export type NameplateActor = {
  id: string;
  /** Anchor x — the plate is horizontally centered on this. */
  x: number;
  /** Anchor y BEFORE any lift is applied (i.e. drawNameplate's un-lifted
   *  call site: `head.y - 24*s`, or an approximation of it). */
  y: number;
  /** Plate footprint at this actor's scale — nameplateWidth()/NAMEPLATE_HEIGHT. */
  width: number;
  height: number;
};

/** World-px vertical gap enforced between two plates once nudged apart. */
const CLEARANCE = 4;
/** Nudge-iteration safety cap — collisions resolve in 1-2 passes in every
 *  realistic (≤4 nearby actors) case; this just bounds worst-case cost. */
const MAX_ITERATIONS = 8;

function overlaps(
  a: { x: number; y: number; width: number; height: number; lift: number },
  b: { x: number; y: number; width: number; height: number; lift: number },
): boolean {
  const aTop = a.y - a.lift - a.height / 2;
  const aBottom = a.y - a.lift + a.height / 2;
  const aLeft = a.x - a.width / 2;
  const aRight = a.x + a.width / 2;
  const bTop = b.y - b.lift - b.height / 2;
  const bBottom = b.y - b.lift + b.height / 2;
  const bLeft = b.x - b.width / 2;
  const bRight = b.x + b.width / 2;
  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

/**
 * Returns a per-actor vertical LIFT (world px, subtract from the plate's
 * un-lifted anchor y — moves it further above the head) sufficient that no
 * two actors' plate boxes overlap. Actors are processed in stable id order;
 * each one only ever lifts away from an already-placed earlier actor it
 * collides with, so the result is independent of the input array's order.
 */
export function resolveNameplateLifts(actors: readonly NameplateActor[]): Map<string, number> {
  const sorted = [...actors].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Array<NameplateActor & { lift: number }> = [];
  const lifts = new Map<string, number>();

  for (const actor of sorted) {
    let lift = 0;
    for (let guard = 0; guard < MAX_ITERATIONS; guard++) {
      const candidate = { ...actor, lift };
      const collider = placed.find((p) => overlaps(candidate, p));
      if (!collider) break;
      // Lift just enough that our bottom edge clears the collider's top
      // edge (plus clearance) — always lifting UP, never sideways, so the
      // plate stays centered on its owner's head horizontally.
      const colliderTop = collider.y - collider.lift - collider.height / 2;
      const requiredBottom = colliderTop - CLEARANCE;
      const currentBottom = actor.y - lift + actor.height / 2;
      lift += currentBottom - requiredBottom;
    }
    placed.push({ ...actor, lift });
    lifts.set(actor.id, lift);
  }
  return lifts;
}

// clip-goal wave-2 (mobile-experience.md clusterA-06): the in-world
// nameplate is drawn at a FIXED offset above the player's head
// (`drawNameplate`'s `y = head.y - 24*s - lift`) with zero awareness of the
// camera. On portrait mobile, OnlineMatchScene/MatchScene/HangoutScene all
// share the same `PORTRAIT_CAM_Y_BIAS = 150` trick — the camera's visible
// window is shifted DOWN 150 world px so the player rides in the upper
// third of the tall screen, clear of the bottom touch-control band. That
// trade specifically eats into the headroom ABOVE the player, which is
// exactly where the plate lives: a high platform (or simply a jump) can
// push the plate's own top edge above the camera's visible top edge,
// hard-clipping it mid-glyph instead of just sliding off-screen whole.

/** drawNameplate's own anchor-to-plate-top offset at scale 1
 *  (`ProceduralPlayerRig.drawNameplate`'s `const plateTop = y - 17 * s`).
 *  Duplicated as a plain number rather than imported — this module is
 *  deliberately Phaser-free (see the file header) so it stays trivially
 *  unit-testable; ProceduralPlayerRig.ts already duplicates nameplateWidth's
 *  formula the same way in reverse (see that file's own comment), so this
 *  matches an established convention rather than inventing a new one. */
const PLATE_TOP_OFFSET = 17;
/** Extra safety gutter (world px at scale 1) on top of PLATE_TOP_OFFSET —
 *  keeps the plate from ever touching the LITERAL frame edge even right at
 *  the clamp, not just technically-still-one-pixel-visible. Sized to also
 *  clear roughly one HudSystem roster row's screen height across the
 *  camera zooms this game actually ships (0.8 portrait / 1.0 touch-
 *  landscape / 1.4 desktop): 28 world px → ~22-39 screen px at those
 *  zooms, matching a single roster row's rough height. This does NOT
 *  guarantee clearance of a tall multi-row roster (8-player match) — that
 *  would need the clamp to read the roster panel's actual live screen
 *  height, a bigger cross-system change out of scope here — but it closes
 *  the literal frame-edge clip outright and the common small-roster HUD
 *  overlap too. */
const FRAME_TOP_CLEARANCE = 28;

/**
 * Given the raw (unclamped) nameplate anchor y `drawNameplate` would
 * otherwise use, and the camera's current visible-world top edge
 * (`camera.worldView.y` — every caller already reads this for off-screen
 * rig culling), returns the anchor y that keeps the plate's own top edge on
 * or below that line. Below the clamp threshold this is a no-op (returns
 * `rawAnchorY` unchanged); only once the plate would actually poke above
 * the frame does it get floored.
 *
 * `cameraTopWorldY: undefined` (a caller with no camera reference) is also
 * a no-op — additive/optional exactly like `ProceduralPlayerPose.nameplateLift`,
 * so old call sites that never pass it see zero behavior change.
 */
export function clampNameplateAnchorY(
  rawAnchorY: number,
  scale: number,
  cameraTopWorldY: number | undefined,
): number {
  if (cameraTopWorldY === undefined) return rawAnchorY;
  const minAnchorY = cameraTopWorldY + (PLATE_TOP_OFFSET + FRAME_TOP_CLEARANCE) * scale;
  return Math.max(rawAnchorY, minAnchorY);
}
