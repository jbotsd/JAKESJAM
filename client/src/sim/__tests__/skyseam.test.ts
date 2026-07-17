// Skyseam curated audit — same validator, same laws as mapGen.test.ts's
// curated-map audits (kept in its own file: mapGen.test.ts's blocks are
// per-map and this map ships with identity guarantees of its own).
//
// Identity contract (docs/map-design.md "Diagonals & sky"):
//   • two diagonal seam-ramps crossing at a shared T5 junction,
//   • a jump-chained sky archipelago (NO perch exemptions — zero
//     unreachable platforms, unlike boxworks-tower's gated audit),
//   • sky-heavy map-authored pickups (the stakes law),
//   • all Hot Lobby mega laws: full floor, side walls, partial ceiling,
//     ≥12 pads @ ≥280px, floor sightlines ≤480.

import { describe, expect, test } from "bun:test";
import { unreachablePlatforms, validateMap } from "../data/mapGen.js";
import { resolveMap } from "../data/maps.js";

describe("skyseam curated mega — diagonals + sky", () => {
  const map = resolveMap("skyseam");

  test("passes the full validator (all laws at once)", () => {
    expect(map.id).toBe("skyseam");
    const v = validateMap(map);
    expect(
      v.ok,
      `unreachable=${v.unreachable.join(",")} routesUp=${v.routesUp} sight=${v.sightline} density=${v.density.toFixed(3)} spawns=${v.spawnsOk}`,
    ).toBe(true);
    expect(v.sightline).toBeLessThanOrEqual(480);
  });

  test("mega frame: full recoverable floor, side walls, open sky", () => {
    expect(map.size.x).toBe(3000);
    expect(map.size.y).toBe(1100);
    const floor = map.platforms.find((p) => p.id === "floor");
    expect(floor?.kind).toBe("floor");
    expect(floor!.size.x).toBeGreaterThanOrEqual(2800);
    expect(map.platforms.some((p) => p.id === "wall-left")).toBe(true);
    expect(map.platforms.some((p) => p.id === "wall-right")).toBe(true);
    // Partial ceiling only — never a full box lid.
    expect(map.platforms.some((p) => p.id === "ceiling")).toBe(false);
    const ceils = map.platforms.filter((p) => p.id.startsWith("ceil-"));
    expect(ceils.length).toBeGreaterThanOrEqual(2);
    const ceilSpan = ceils.reduce((a, p) => a + p.size.x, 0);
    expect(ceilSpan).toBeLessThan(map.size.x * 0.6); // open sky center
  });

  test("the sky is for everyone: ZERO unreachable platforms (no perches)", () => {
    expect(unreachablePlatforms(map)).toEqual([]);
  });

  test("signature geometry: two crossing seams + shared junction + sky band", () => {
    const seamA = map.platforms.filter((p) => p.id.startsWith("seam-a-"));
    const seamB = map.platforms.filter((p) => p.id.startsWith("seam-b-"));
    // Each seam is a long chain (≥8 elements) spanning most of the width.
    expect(seamA.length).toBeGreaterThanOrEqual(8);
    expect(seamB.length).toBeGreaterThanOrEqual(8);
    const span = (ps: typeof seamA) =>
      Math.max(...ps.map((p) => p.position.x + p.size.x / 2)) -
      Math.min(...ps.map((p) => p.position.x - p.size.x / 2));
    expect(span(seamA)).toBeGreaterThan(map.size.x * 0.7);
    expect(span(seamB)).toBeGreaterThan(map.size.x * 0.7);
    // Seam A climbs left→right; seam B climbs right→left (opposing slopes
    // = the X). Correlate x with height (top y decreases as it climbs).
    const slope = (ps: typeof seamA) => {
      const sorted = [...ps].sort((a, b) => a.position.x - b.position.x);
      return sorted[sorted.length - 1]!.position.y - sorted[0]!.position.y;
    };
    expect(slope(seamA)).toBeLessThan(-400); // rises going right
    expect(slope(seamB)).toBeGreaterThan(400); // falls going right = rises going left
    // The crossing is a single shared junction deck at center.
    const junction = map.platforms.find((p) => p.id === "cross-junction");
    expect(junction).toBeDefined();
    expect(Math.abs(junction!.position.x - map.size.x / 2)).toBeLessThan(100);
    // Sky archipelago: ≥8 islands, all in the upper third of the arena.
    const sky = map.platforms.filter((p) => p.id.startsWith("sky-"));
    expect(sky.length).toBeGreaterThanOrEqual(8);
    for (const p of sky) {
      expect(p.position.y, `${p.id} must live in the upper third`).toBeLessThan(
        map.size.y / 3,
      );
    }
  });

  test("sky stakes: pickups are map-authored and predominantly high", () => {
    const pickups = map.pickups ?? [];
    expect(pickups.length).toBeGreaterThanOrEqual(6);
    const high = pickups.filter((p) => p.position.y < map.size.y / 3);
    const ground = pickups.filter((p) => p.position.y >= map.size.y * 0.66);
    expect(high.length).toBeGreaterThan(ground.length * 2);
    // The crown buff sits on the center sky island.
    const crown = pickups.find((p) => p.kind === "overcharge-core");
    expect(crown).toBeDefined();
    expect(crown!.position.y).toBeLessThan(map.size.y / 4);
  });

  test("16 spawn pads, all ≥280px apart, ground lattice included", () => {
    expect(map.spawns.length).toBe(16);
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const a = map.spawns[i]!;
        const b = map.spawns[j]!;
        expect(
          Math.hypot(a.x - b.x, a.y - b.y),
          `spawns ${i},${j} too close`,
        ).toBeGreaterThanOrEqual(280);
      }
    }
    // Recoverability: a healthy share of pads on the ground band…
    const groundPads = map.spawns.filter((s) => s.y > map.size.y * 0.8);
    expect(groundPads.length).toBeGreaterThanOrEqual(6);
    // …and real spawn presence up in the sky band (the map's identity).
    const skyPads = map.spawns.filter((s) => s.y < map.size.y / 3);
    expect(skyPads.length).toBeGreaterThanOrEqual(4);
  });

  test("floor-band cover pylons keep sightlines mid-range", () => {
    const covers = map.platforms.filter((p) => p.id.startsWith("cover-"));
    expect(covers.length).toBeGreaterThanOrEqual(4);
  });

  test("true slopes: a 2:1 ramp feeds each seam base + a 45° junction piece", () => {
    // 2026-07-17 — the seam-base launch pads (interim "80% of ramp feel")
    // are REPLACED by true slopes; pads remain a live mechanism on
    // generated maps only.
    expect(map.launchPads ?? []).toEqual([]);
    const slopes = map.slopes ?? [];
    expect(slopes.length).toBe(3);

    const seamAT1 = map.platforms.find((p) => p.id === "seam-a-t1")!;
    const seamBT1 = map.platforms.find((p) => p.id === "seam-b-t1")!;
    const junction = map.platforms.find((p) => p.id === "cross-junction")!;

    // Ramp A: 2:1, ground-seated, crest EXACTLY flush with seam-a-t1's
    // top-left corner — sprint from the left wall straight onto the chain.
    const rampA = slopes.find((s) => s.id === "ramp-seam-a")!;
    expect(rampA.grade).toBe("2:1");
    expect(rampA.dir).toBe(1);
    expect(rampA.base.y).toBe(1064); // floor top (GROUND)
    expect(rampA.base.x + rampA.run).toBe(seamAT1.position.x - seamAT1.size.x / 2);
    expect(rampA.base.y - rampA.run * 0.5).toBe(seamAT1.position.y - seamAT1.size.y / 2);
    expect(rampA.base.x).toBeGreaterThan(32); // clear of wall-left

    // Ramp B: the mirror at seam B's base.
    const rampB = slopes.find((s) => s.id === "ramp-seam-b")!;
    expect(rampB.grade).toBe("2:1");
    expect(rampB.dir).toBe(-1);
    expect(rampB.base.y).toBe(1064);
    expect(rampB.base.x - rampB.run).toBe(seamBT1.position.x + seamBT1.size.x / 2);
    expect(rampB.base.y - rampB.run * 0.5).toBe(seamBT1.position.y - seamBT1.size.y / 2);
    expect(rampB.base.x).toBeLessThan(map.size.x - 32); // clear of wall-right

    // The 45° set piece: terrace lip (T3) → cross-junction deck (T5), a
    // full two-tier assault ramp into the most contested deck.
    const rampJ = slopes.find((s) => s.id === "ramp-junction")!;
    expect(rampJ.grade).toBe("1:1");
    expect(rampJ.dir).toBe(1);
    const land3 = map.platforms.find((p) => p.id === "seam-a-land3")!;
    expect(rampJ.base.x).toBe(land3.position.x + land3.size.x / 2);
    expect(rampJ.base.y).toBe(land3.position.y - land3.size.y / 2);
    // Crest height = junction deck top, and the crest lands INSIDE the
    // deck's span (smooth on-surface handoff, no gap).
    const crestX = rampJ.base.x + rampJ.run;
    const crestY = rampJ.base.y - rampJ.run;
    expect(crestY).toBe(junction.position.y - junction.size.y / 2);
    expect(crestX).toBeGreaterThan(junction.position.x - junction.size.x / 2);
    expect(crestX).toBeLessThan(junction.position.x + junction.size.x / 2);
  });

  test("slope walk-edges register in the validator's route graph", () => {
    // Strip the seam chains' first steps' floor-jump reachability by
    // checking the slope-node model directly: a map whose ONLY route to a
    // ledge is a slope must validate. Synthetic: floor + a ledge 216px up
    // (beyond the 129 jump law), fed by a 2:1 slope.
    const synthetic = {
      id: "slope-model-probe",
      name: "probe",
      size: { x: 1200, y: 700 },
      spawns: [
        { x: 200, y: 600 }, { x: 500, y: 600 },
        { x: 800, y: 600 }, { x: 1000, y: 600 },
      ],
      platforms: [
        { id: "floor", kind: "floor" as const, position: { x: 600, y: 660 }, size: { x: 1200, y: 40 } },
        // Ledge top at 424 — rise 216 from the floor top (640): NOT
        // jump-reachable, NOT wall-kickable (no walls).
        { id: "high-ledge", kind: "platform" as const, position: { x: 900, y: 433 }, size: { x: 200, y: 18 } },
      ],
      slopes: [
        // 2:1 from the floor (432 run, 216 rise) cresting flush with the
        // ledge's left edge.
        { id: "ramp", base: { x: 368, y: 640 }, run: 432, grade: "2:1" as const, dir: 1 as const },
      ],
    };
    expect(unreachablePlatforms(synthetic)).toEqual([]);
    // Same map WITHOUT the slope: the ledge must be unreachable — proving
    // the walk-edge (not some other relaxation) carried it.
    expect(
      unreachablePlatforms({ ...synthetic, slopes: [] }),
    ).toEqual(["high-ledge"]);
  });
});
