/**
 * diagonalSlab — PURE geometry for the render-only diagonal slab silhouette.
 *
 * Maps generate diagonal ascent chains (mapGen `diag-${chain}-${i}` — runs of
 * small one-way steps along a slope line) and skyseam authors two curated
 * seam-ramps (`seam-a-*` / `seam-b-*`). Kinetically they work, but each step
 * renders as a lone horizontal shelf — nothing reads as a diagonal SLAB.
 * docs/map-design.md sanctions the fix: "Renderer may later draw a connecting
 * sloped silhouette over the steps (render-only; collision stays rectangles)."
 *
 * This module computes that silhouette. It is deliberately Phaser-free so the
 * grouping + vertex math is unit-testable under plain `bun test` (same split
 * as renderContract.ts vs deathFxPainter.ts). PlatformPainter.paintDiagonalSlab
 * does the actual Graphics work.
 *
 * WHAT A HUMAN SHOULD SEE (per chain of ≥2 steps):
 * one solid angled slab — a stair-stringer — running under the whole chain:
 *
 *                                ┌────┐   ← individual steps (painted later,
 *                          ┌────┐╱    ╱      on TOP of the slab)
 *                    ┌────┐╱    ╱
 *              ┌────┐╱    ╱  ← slab body: top edge hugs each step's underside
 *              ╱    ╱          (tucked SLAB_EMBED px up into the step so no
 *             ╱    ╱            hairline gap shows), bridging the air gaps
 *            ╱____╱   ← bottom edge: ONE straight line parallel to the
 *                       base→crest chord — the straight underside is what
 *                       makes it read as ONE angled slab. Ends are single
 *                       slanted chamfer cuts (vessel hard-edge language).
 *
 * The slab is PURE DECORATION: zero collision, zero sim contact. Steps are
 * painted after (and platform drop-shadows sit at a higher depth), so the
 * slab can never occlude a step's walkable top face.
 */

export type SlabPoint = { x: number; y: number };

/** Structural step shape (world-space centre + size, like PlatformDefinition). */
export type SlabStep = { x: number; y: number; w: number; h: number };

export type SlabGeometry = {
  /** Closed polygon: base→crest along the hugging top edge, then crest-end
   *  chamfer point, then base-end chamfer point (straight bottom line between). */
  outline: SlabPoint[];
  /** The hugging top polyline (base→crest) — also the rim-highlight path. */
  topEdge: SlabPoint[];
  /** The straight stringer underside, [baseEnd, crestEnd] (chamfered in). */
  bottomEdge: [SlabPoint, SlabPoint];
};

/** Slab top edge tucks this far up into each step's side (steps are 18px
 *  tall; the overlap hides behind the step once the step paints over it). */
export const SLAB_EMBED = 6;
/** Nominal perpendicular thickness of the stringer below the nose chord —
 *  reads clearly against 18px steps without dominating them. */
export const SLAB_THICKNESS = 34;
/** Guaranteed vertical body between any top-edge vertex and the bottom line.
 *  Random per-step rises make noses sag below the base→crest chord (measured
 *  up to ~25px on generated chains); without this floor the polygon could
 *  pinch shut. Also guarantees the brush-streak band always stays inside. */
export const SLAB_MIN_CORE = 26;
/** Ends are cut back along the slope by this much (single slanted facet). */
export const SLAB_CHAMFER = 12;

/**
 * Group a map's platform list into diagonal ascent chains by id.
 *
 * Recognised id schemes (strict — anything else is left alone, so wall fins
 * `fin-*`, kick-shaft walls, sky columns `skycol-*`, ArenaForge drafts, etc.
 * never get slabs):
 *   - Generated (mapGen.ts addChainStep): `diag-${chain}-${i}`
 *       → grouped by chain number, ordered by step index i.
 *   - Curated skyseam seam-ramps (skyseam.ts): `seam-a-*` / `seam-b-*`
 *       → grouped by seam letter, kept in authoring order (skyseam lists
 *         each seam base→crest; the shared `cross-junction` deck has its own
 *         id on purpose and is excluded).
 *
 * Degenerate safety: chains of a single step are dropped (no slab), malformed
 * ids simply don't match, and an empty/never-matching list returns [].
 */
export function groupDiagonalChainSteps(
  platforms: ReadonlyArray<{
    id?: string;
    position: { x: number; y: number };
    size: { x: number; y: number };
  }>,
): SlabStep[][] {
  const chains = new Map<string, { order: number; step: SlabStep }[]>();
  let seq = 0;
  for (const p of platforms) {
    const id = p.id;
    if (typeof id !== "string") continue;
    let key: string;
    let order: number;
    const gen = /^diag-(\d+)-(\d+)$/.exec(id);
    if (gen) {
      key = `diag-${gen[1]}`;
      order = Number(gen[2]);
    } else {
      const seam = /^seam-([a-z0-9]+)-./.exec(id);
      if (!seam) continue;
      key = `seam-${seam[1]}`;
      order = seq;
    }
    seq += 1;
    let bucket = chains.get(key);
    if (!bucket) {
      bucket = [];
      chains.set(key, bucket);
    }
    bucket.push({
      order,
      step: { x: p.position.x, y: p.position.y, w: p.size.x, h: p.size.y },
    });
  }

  const result: SlabStep[][] = [];
  for (const bucket of chains.values()) {
    if (bucket.length < 2) continue; // a "chain" of 1 step draws no slab
    bucket.sort((a, b) => a.order - b.order);
    result.push(bucket.map((b) => b.step));
  }
  return result;
}

/**
 * Compute the slab polygon for one ordered chain (base→crest).
 *
 * Vertex math (ascending-right chain shown; dir = ±1 mirrors it):
 *   bottom_i = y_i + h_i/2                       (step underside)
 *   top edge: for each step, two points at y = bottom_i - SLAB_EMBED spanning
 *     [near, far] edges in the ascent direction, joined by straight bridges
 *     across the air gaps (a terrace step at the same height yields a
 *     horizontal bridge — skyseam's landings read as flat slab sections).
 *     X is clamped monotonic in the ascent direction so malformed or
 *     overlapping curated steps can never fold the edge back on itself.
 *   nose chord: S = base step's bottom-OUTER corner, E = crest step's
 *     bottom-OUTER corner ("outer" = the edge facing away from the chain).
 *   bottom edge: the chord offset SLAB_THICKNESS along the downward
 *     perpendicular, then shifted further down (pure +y) just enough that
 *     every top-edge vertex keeps SLAB_MIN_CORE px of body above it.
 *   ends: bottom corners pulled back SLAB_CHAMFER along the slope, so each
 *     end face is one slanted hard-edge cut from step corner to underside.
 *
 * Returns null (draw nothing) for degenerate input: fewer than 2 steps, a
 * near-vertical stack (|dx| < 32), a flat run (|dy| < 16), or non-finite
 * coordinates — malformed chains no-op rather than throw.
 */
export function computeDiagonalSlabGeometry(
  steps: ReadonlyArray<SlabStep>,
): SlabGeometry | null {
  if (steps.length < 2) return null;
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const bottom = (s: SlabStep) => s.y + s.h / 2;
  const dir = Math.sign(last.x - first.x);
  if (dir === 0) return null;
  if (Math.abs(last.x - first.x) < 32) return null; // vertical stack, not a diagonal
  if (Math.abs(bottom(last) - bottom(first)) < 16) return null; // flat run

  // ── Top edge: hug each step's underside, bridge the gaps ───────────
  const topEdge: SlabPoint[] = [];
  let lastX = dir > 0 ? -Infinity : Infinity;
  const push = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const cx = dir > 0 ? Math.max(x, lastX) : Math.min(x, lastX);
    lastX = cx;
    const prev = topEdge[topEdge.length - 1];
    if (prev && Math.abs(prev.x - cx) < 0.01 && Math.abs(prev.y - y) < 0.01) return;
    topEdge.push({ x: cx, y });
  };
  for (const s of steps) {
    const yTop = bottom(s) - SLAB_EMBED;
    push(s.x - dir * (s.w / 2), yTop); // near (base-facing) bottom corner
    push(s.x + dir * (s.w / 2), yTop); // far (crest-facing) bottom corner
  }
  if (topEdge.length < 2) return null;

  // ── Nose chord base→crest, and the downward perpendicular ──────────
  const S: SlabPoint = { x: first.x - dir * (first.w / 2), y: bottom(first) };
  const E: SlabPoint = { x: last.x + dir * (last.w / 2), y: bottom(last) };
  const len = Math.hypot(E.x - S.x, E.y - S.y);
  if (!Number.isFinite(len) || len < 48) return null;
  const u = { x: (E.x - S.x) / len, y: (E.y - S.y) / len };
  // Perpendicular pointing below the slope (+y is down in screen space).
  let down = { x: -u.y, y: u.x };
  if (down.y < 0) down = { x: u.y, y: -u.x };

  // ── Bottom edge: one straight stringer line ─────────────────────────
  let b0 = { x: S.x + down.x * SLAB_THICKNESS, y: S.y + down.y * SLAB_THICKNESS };
  let b1 = { x: E.x + down.x * SLAB_THICKNESS, y: E.y + down.y * SLAB_THICKNESS };
  // b1.x - b0.x === E.x - S.x ≠ 0 (guarded above), so lineY is total.
  const lineY = (x: number): number =>
    b0.y + ((x - b0.x) * (b1.y - b0.y)) / (b1.x - b0.x);
  let extra = 0;
  for (const v of topEdge) extra = Math.max(extra, v.y + SLAB_MIN_CORE - lineY(v.x));
  extra = Math.min(extra, 96); // sanity cap — malformed data can't drag the slab away
  if (extra > 0) {
    b0 = { x: b0.x, y: b0.y + extra };
    b1 = { x: b1.x, y: b1.y + extra };
  }

  // ── Chamfered ends: pull the bottom corners back along the slope ────
  const ch = Math.min(SLAB_CHAMFER, len * 0.25);
  const crestBottom: SlabPoint = { x: b1.x - u.x * ch, y: b1.y - u.y * ch };
  const baseBottom: SlabPoint = { x: b0.x + u.x * ch, y: b0.y + u.y * ch };

  return {
    outline: [...topEdge, crestBottom, baseBottom],
    topEdge,
    bottomEdge: [baseBottom, crestBottom],
  };
}
