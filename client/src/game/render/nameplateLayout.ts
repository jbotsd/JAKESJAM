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
