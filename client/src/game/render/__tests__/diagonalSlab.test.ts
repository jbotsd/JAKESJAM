// Diagonal slab silhouette — id grouping + vertex math (render-only;
// collision stays rectangles, per docs/map-design.md).

import { describe, expect, test } from "bun:test";
import {
  computeDiagonalSlabGeometry,
  groupDiagonalChainSteps,
  SLAB_EMBED,
  SLAB_MIN_CORE,
  type SlabStep,
} from "../diagonalSlab";

const plat = (id: string, x: number, y: number, w = 112, h = 18) => ({
  id,
  position: { x, y },
  size: { x: w, y: h },
});

// Real steps from resolveMap("gen:98") chain 2 (ascending right).
const GEN98_CHAIN2: SlabStep[] = [
  { x: 2312, y: 2053, w: 112, h: 18 },
  { x: 2456, y: 1925, w: 112, h: 18 },
  { x: 2600, y: 1797, w: 112, h: 18 },
  { x: 2752, y: 1677, w: 128, h: 18 },
];

describe("groupDiagonalChainSteps", () => {
  test("groups generated diag-<chain>-<i> ids by chain, ordered by step index", () => {
    const chains = groupDiagonalChainSteps([
      plat("diag-0-1", 2112, 1949, 128),
      plat("floor", 1500, 2200, 3000, 40),
      plat("diag-1-0", 1040, 2069),
      plat("diag-0-2", 1952, 1853, 96),
      plat("diag-0-0", 2280, 2053),
      plat("diag-1-1", 888, 1957),
    ]);
    expect(chains.length).toBe(2);
    const chain0 = chains.find((c) => c.length === 3)!;
    expect(chain0.map((s) => s.x)).toEqual([2280, 2112, 1952]); // sorted by i, not input order
  });

  test("groups skyseam seam-a-*/seam-b-* in authoring order; junction/walls/fins excluded", () => {
    const chains = groupDiagonalChainSteps([
      plat("seam-a-t1", 400, 965, 150),
      plat("seam-a-t2", 600, 857, 150),
      plat("seam-a-land3", 1090, 749, 280),
      plat("cross-junction", 1500, 533, 300),
      plat("seam-b-t1", 2600, 965, 150),
      plat("seam-b-t2", 2400, 857, 150),
      plat("wall-left", 16, 550, 32, 1100),
      plat("fin-0", 900, 400, 24, 200),
      plat("skycol-0-1", 700, 300, 40, 40),
    ]);
    expect(chains.length).toBe(2);
    expect(chains[0]!.map((s) => s.x)).toEqual([400, 600, 1090]);
    expect(chains[1]!.map((s) => s.x)).toEqual([2600, 2400]);
  });

  test("degenerate safety: single-step chains dropped, malformed ids ignored, id-less no-op", () => {
    expect(
      groupDiagonalChainSteps([
        plat("diag-7-0", 100, 100), // chain of 1 → no slab
        plat("diag-x-1", 200, 200), // malformed
        plat("diag-3", 300, 300), // malformed
        plat("diag-1-2-3", 400, 400), // malformed (anchored regex)
        plat("seam-a", 500, 500), // no step suffix
        { position: { x: 1, y: 2 }, size: { x: 3, y: 4 } }, // no id at all
      ]),
    ).toEqual([]);
    expect(groupDiagonalChainSteps([])).toEqual([]);
  });
});

describe("computeDiagonalSlabGeometry", () => {
  test("null for degenerate chains: <2 steps, vertical stack, flat run", () => {
    expect(computeDiagonalSlabGeometry([])).toBeNull();
    expect(computeDiagonalSlabGeometry([GEN98_CHAIN2[0]!])).toBeNull();
    // Vertical stack (same x) is not a diagonal
    expect(
      computeDiagonalSlabGeometry([
        { x: 500, y: 900, w: 100, h: 18 },
        { x: 500, y: 780, w: 100, h: 18 },
      ]),
    ).toBeNull();
    // Flat run has no slope line
    expect(
      computeDiagonalSlabGeometry([
        { x: 500, y: 900, w: 100, h: 18 },
        { x: 700, y: 900, w: 100, h: 18 },
      ]),
    ).toBeNull();
  });

  test("top edge hugs each step underside (embedded), spanning outer corners", () => {
    const geo = computeDiagonalSlabGeometry(GEN98_CHAIN2)!;
    expect(geo).not.toBeNull();
    // Two vertices per step at y = bottom - SLAB_EMBED
    expect(geo.topEdge.length).toBe(GEN98_CHAIN2.length * 2);
    for (let i = 0; i < GEN98_CHAIN2.length; i++) {
      const s = GEN98_CHAIN2[i]!;
      const yTop = s.y + s.h / 2 - SLAB_EMBED;
      expect(geo.topEdge[2 * i]!.y).toBeCloseTo(yTop, 5);
      expect(geo.topEdge[2 * i + 1]!.y).toBeCloseTo(yTop, 5);
    }
    // Starts at the base step's bottom-outer (left, dir=+1) corner…
    expect(geo.topEdge[0]!.x).toBeCloseTo(2312 - 56, 5);
    // …ends at the crest step's bottom-outer (right) corner.
    expect(geo.topEdge[geo.topEdge.length - 1]!.x).toBeCloseTo(2752 + 64, 5);
    // Outline = top polyline + the two chamfered bottom corners.
    expect(geo.outline.length).toBe(geo.topEdge.length + 2);
  });

  test("bottom line stays at least SLAB_MIN_CORE below every top vertex (no pinch)", () => {
    // Irregular rises/runs (worst case for the straight stringer line).
    const irregular: SlabStep[] = [
      { x: 300, y: 1000, w: 112, h: 18 },
      { x: 460, y: 904, w: 128, h: 18 }, // rise 96
      { x: 620, y: 776, w: 96, h: 18 }, // rise 128
      { x: 760, y: 680, w: 112, h: 18 }, // rise 96
      { x: 920, y: 552, w: 112, h: 18 }, // rise 128
    ];
    for (const steps of [GEN98_CHAIN2, irregular]) {
      const geo = computeDiagonalSlabGeometry(steps)!;
      const [b0, b1] = geo.bottomEdge;
      const lineY = (x: number) => b0.y + ((x - b0.x) * (b1.y - b0.y)) / (b1.x - b0.x);
      for (const v of geo.topEdge) {
        expect(lineY(v.x) - v.y).toBeGreaterThanOrEqual(SLAB_MIN_CORE - 1e-6);
      }
    }
  });

  test("mirror symmetry: an ascending-left chain produces the mirrored slab", () => {
    const right = computeDiagonalSlabGeometry(GEN98_CHAIN2)!;
    const mirrored = GEN98_CHAIN2.map((s) => ({ ...s, x: 5000 - s.x }));
    const left = computeDiagonalSlabGeometry(mirrored)!;
    expect(left.outline.length).toBe(right.outline.length);
    for (let i = 0; i < right.outline.length; i++) {
      expect(left.outline[i]!.x).toBeCloseTo(5000 - right.outline[i]!.x, 5);
      expect(left.outline[i]!.y).toBeCloseTo(right.outline[i]!.y, 5);
    }
  });

  test("terraced seam (flat landings mid-chain) still yields one simple polygon", () => {
    // skyseam-style: rise, terrace (same level), rise — like seam-a t3→land3→t4.
    const terraced: SlabStep[] = [
      { x: 400, y: 965, w: 150, h: 18 },
      { x: 600, y: 857, w: 150, h: 18 },
      { x: 800, y: 749, w: 150, h: 18 },
      { x: 1090, y: 749, w: 280, h: 18 }, // terrace — same height
      { x: 1365, y: 641, w: 150, h: 18 },
    ];
    const geo = computeDiagonalSlabGeometry(terraced)!;
    expect(geo).not.toBeNull();
    // Top edge x strictly non-decreasing (monotonic clamp held).
    for (let i = 1; i < geo.topEdge.length; i++) {
      expect(geo.topEdge[i]!.x).toBeGreaterThanOrEqual(geo.topEdge[i - 1]!.x);
    }
    // Terrace bridge is horizontal: both terrace vertices share the t3 level.
    const terraceY = 749 + 9 - SLAB_EMBED;
    const atTerrace = geo.topEdge.filter((v) => Math.abs(v.y - terraceY) < 1e-6);
    expect(atTerrace.length).toBe(4); // t3 near/far + land3 near/far
  });

  test("overlapping malformed steps cannot fold the top edge back (monotonic clamp)", () => {
    const overlapping: SlabStep[] = [
      { x: 300, y: 1000, w: 200, h: 18 },
      { x: 320, y: 880, w: 200, h: 18 }, // overlaps the first horizontally
      { x: 560, y: 760, w: 120, h: 18 },
    ];
    const geo = computeDiagonalSlabGeometry(overlapping)!;
    expect(geo).not.toBeNull();
    for (let i = 1; i < geo.topEdge.length; i++) {
      expect(geo.topEdge[i]!.x).toBeGreaterThanOrEqual(geo.topEdge[i - 1]!.x);
    }
  });
});
