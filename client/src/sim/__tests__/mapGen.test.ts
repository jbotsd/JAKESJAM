// Map generator + validator contracts (docs/map-design.md).
//
//   1. DETERMINISM — gen:<seed> is a pure function: two independent
//      expansions are deep-equal (client and server must agree byte-for-
//      byte, same guarantee curated maps have).
//   2. FUZZ — every seed in a wide range yields a VALID arena (the laws:
//      full reachability, ≥2 routes up, sightline cap, openness band,
//      fair spawns).
//   3. CURATED AUDIT — the same validator runs against the hand-made
//      maps, so a T1-class bug (unreachable ledge shipped for weeks) can
//      never re-enter ANY map, curated or generated.

import { describe, expect, test } from "bun:test";
import { generateArena, unreachablePlatforms, validateMap } from "../data/mapGen.js";
import { resolveMap } from "../data/maps.js";

describe("mapGen determinism", () => {
  test("same seed twice → identical geometry", () => {
    for (const seed of [0, 1, 7, 1234, 999999]) {
      const a = generateArena(seed);
      const b = generateArena(seed);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("resolveMap caches and parses gen ids", () => {
    const m1 = resolveMap("gen:4242");
    const m2 = resolveMap("gen:4242");
    expect(m1).toBe(m2); // cached instance
    expect(m1.id).toBe("gen:4242");
    expect(m1.platforms.length).toBeGreaterThan(4);
  });

  test("malformed gen ids fall back to the default map", () => {
    expect(resolveMap("gen:nope").id).toBe("boxworks-mini");
    expect(resolveMap("gen:-5").id).toBe("boxworks-mini");
  });
});

describe("mapGen fuzz — the laws hold for every seed", () => {
  test("60 seeds: all valid", () => {
    for (let seed = 0; seed < 60; seed++) {
      const map = generateArena(seed);
      const v = validateMap(map);
      expect(
        v.ok,
        `seed ${seed}: unreachable=${v.unreachable.join(",")} routesUp=${v.routesUp} sight=${v.sightline} density=${v.density.toFixed(3)} spawns=${v.spawnsOk}`,
      ).toBe(true);
    }
  });

  test("60 seeds: generous, well-separated spawn sets", () => {
    for (let seed = 0; seed < 60; seed++) {
      const map = generateArena(seed);
      // At least 4 spawns; opposite floor corners guaranteed. All pairs
      // keep the min separation so a full lobby never stacks.
      expect(map.spawns.length, `seed ${seed} spawn count`).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < map.spawns.length; i++) {
        for (let j = i + 1; j < map.spawns.length; j++) {
          const a = map.spawns[i]!;
          const b = map.spawns[j]!;
          expect(
            Math.hypot(a.x - b.x, a.y - b.y),
            `seed ${seed} spawns ${i},${j} too close`,
          ).toBeGreaterThanOrEqual(360);
        }
      }
    }
  });
});

describe("curated map audit — same validator, no exceptions for age", () => {
  test("boxworks-mini: everything reachable (post-T1)", () => {
    expect(unreachablePlatforms(resolveMap("boxworks-mini"))).toEqual([]);
  });

  test("boxworks-tower: only HIGH ground is jetpack-gated", () => {
    // Tower is the designated jetpack map ("burn fuel or fall") — its
    // upper structure is deliberately out of jump reach. The audit
    // asserts the gate is honest: every unreachable platform sits in the
    // upper portion of the arena. A LOW platform you can't jump to would
    // be a T1-class bug, not a design choice.
    const tower = resolveMap("boxworks-tower");
    const unreachable = new Set(unreachablePlatforms(tower, false));
    for (const p of tower.platforms) {
      if (!unreachable.has(p.id)) continue;
      const top = p.position.y - p.size.y / 2;
      expect(top, `${p.id} is unreachable AND low (top=${top})`).toBeLessThan(
        tower.size.y * 0.72,
      );
    }
  });
});
