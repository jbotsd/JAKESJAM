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
import {
  DENSITY_MAX_TALL,
  DENSITY_MIN_TALL,
  GRAB_MIN_H,
  KICK_CARRY,
  KICK_RISE,
  KICK_SHAFT_GAP_MIN,
  MAX_STEP_RISE,
  SHAFT_MAX,
  TALL_ARENA_H,
  generateArena,
  generateCandidate,
  genProfileForSeed,
  maxGapForRise,
  perchViolations,
  unreachablePlatforms,
  validateMap,
} from "../data/mapGen.js";
import type { MapDefinition, PlatformDefinition } from "../types.js";
import { resolveMap } from "../data/maps.js";

// ── Helpers for the "Diagonals & sky" vocabulary tests ──────────────────

type Box = { id: string; x0: number; x1: number; top: number };

function boxes(map: MapDefinition, prefix: string): Box[] {
  return map.platforms
    .filter((p) => p.id.startsWith(prefix))
    .map((p) => ({
      id: p.id,
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
    }));
}

/** Group diag-<chain>-<step> platforms into ordered chains. */
function diagChains(map: MapDefinition): Box[][] {
  const byChain = new Map<string, { step: number; box: Box }[]>();
  for (const b of boxes(map, "diag-")) {
    const m = /^diag-(\d+)-(\d+)$/.exec(b.id);
    expect(m, `malformed diag id ${b.id}`).not.toBeNull();
    const list = byChain.get(m![1]!) ?? [];
    list.push({ step: Number(m![2]!), box: b });
    byChain.set(m![1]!, list);
  }
  return [...byChain.values()].map((l) =>
    l.sort((a, b) => a.step - b.step).map((e) => e.box),
  );
}

function floorTop(map: MapDefinition): number {
  const f = map.platforms.find((p) => p.id === "floor")!;
  return f.position.y - f.size.y / 2;
}

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
    expect(resolveMap("gen:nope").id).toBe("vessel-nexus");
    expect(resolveMap("gen:-5").id).toBe("vessel-nexus");
  });
});

describe("mapGen fuzz — the laws hold for every seed", () => {
  test("160 seeds: all valid at 3000×2200 (Jake dial 3: double height)", () => {
    for (let seed = 0; seed < 160; seed++) {
      const map = generateArena(seed);
      const v = validateMap(map);
      expect(
        v.ok,
        `seed ${seed}: unreachable=${v.unreachable.join(",")} routesUp=${v.routesUp} sight=${v.sightline} density=${v.density.toFixed(3)} spawns=${v.spawnsOk} upper=${v.upperReach}`,
      ).toBe(true);
      // Generated arenas are the doubled-height Hot Lobby scale.
      expect(map.size.y, `seed ${seed} height`).toBe(2200);
      expect(map.size.y).toBeGreaterThanOrEqual(TALL_ARENA_H);
      // Tall openness band (recalibrated law, docs/map-design.md).
      expect(v.density, `seed ${seed} density`).toBeGreaterThanOrEqual(DENSITY_MIN_TALL);
      expect(v.density, `seed ${seed} density`).toBeLessThanOrEqual(DENSITY_MAX_TALL);
      // Tall law: real standable structure in the upper half — 2x height
      // must never ship a bottom-heavy arena with an empty sky.
      expect(v.upperReach, `seed ${seed} upper-half reach`).toBe(true);
    }
  });

  test("60 seeds: 16-pad Hot Lobby spawn sets", () => {
    for (let seed = 0; seed < 60; seed++) {
      const map = generateArena(seed);
      // Mega docks target 16; validator floor is 12. All pairs ≥300px.
      expect(map.spawns.length, `seed ${seed} spawn count`).toBeGreaterThanOrEqual(12);
      expect(map.size.x, `seed ${seed} width`).toBeGreaterThanOrEqual(2600);
      for (let i = 0; i < map.spawns.length; i++) {
        for (let j = i + 1; j < map.spawns.length; j++) {
          const a = map.spawns[i]!;
          const b = map.spawns[j]!;
          expect(
            Math.hypot(a.x - b.x, a.y - b.y),
            `seed ${seed} spawns ${i},${j} too close`,
          ).toBeGreaterThanOrEqual(280);
        }
      }
    }
  });
});

describe("diagonal ascent chains — slope lines within the movement laws", () => {
  test("120 seeds: every chain step obeys rise/arc-gap laws, flows one direction", () => {
    let chainsSeen = 0;
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      const fTop = floorTop(map);
      for (const chain of diagChains(map)) {
        chainsSeen++;
        expect(chain.length, `seed ${seed}: chain too short`).toBeGreaterThanOrEqual(3);
        // 3-4 = shelf substitutions, 7-10 = long ramps, 12-13 = sky-entry
        // ramps (floor→yBand at 2200 tall, ~118px per step).
        expect(chain.length, `seed ${seed}: chain too long`).toBeLessThanOrEqual(13);
        // First step is a plain jump off the floor.
        const rise0 = fTop - chain[0]!.top;
        expect(rise0, `seed ${seed}: first step above jump reach`).toBeGreaterThan(0);
        expect(rise0).toBeLessThanOrEqual(MAX_STEP_RISE);
        const dir = Math.sign(
          (chain[1]!.x0 + chain[1]!.x1) / 2 - (chain[0]!.x0 + chain[0]!.x1) / 2,
        );
        for (let i = 1; i < chain.length; i++) {
          const prev = chain[i - 1]!;
          const cur = chain[i]!;
          const rise = prev.top - cur.top;
          expect(rise, `seed ${seed} step ${i}: must ascend`).toBeGreaterThan(0);
          expect(rise, `seed ${seed} step ${i}: rise law`).toBeLessThanOrEqual(MAX_STEP_RISE);
          const gap = Math.max(cur.x0 - prev.x1, prev.x0 - cur.x1);
          expect(gap, `seed ${seed} step ${i}: steps must not stack`).toBeGreaterThan(0);
          expect(gap, `seed ${seed} step ${i}: arc-model gap law (rise ${rise})`).toBeLessThanOrEqual(
            maxGapForRise(rise),
          );
          const d = Math.sign((cur.x0 + cur.x1) / 2 - (prev.x0 + prev.x1) / 2);
          expect(d, `seed ${seed} step ${i}: chain must flow one direction`).toBe(dir);
        }
      }
    }
    // The vocabulary is actually in use across the seed space.
    expect(chainsSeen).toBeGreaterThan(100);
  });

  test("vocabulary MIX: chains substitute SOME shelves, never all (120 seeds)", () => {
    let mapsWithSubstitution = 0;
    let mapsWithShelves = 0;
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      // Substitution chains are 3-4 steps; sky-entry ramps are 12-13.
      if (diagChains(map).some((c) => c.length < 6)) mapsWithSubstitution++;
      // Classic shelf ledges still exist (T1 band is always shelves).
      if (map.platforms.some((p) => p.id.startsWith("ledge-"))) mapsWithShelves++;
    }
    expect(mapsWithSubstitution).toBeGreaterThan(40);
    expect(mapsWithShelves).toBe(120);
  });
});

describe("sky archipelago — a traversable aerial layer", () => {
  test("120 seeds: islands sit in the upper band and are route-reachable", () => {
    let islandsSeen = 0;
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      const islands = boxes(map, "sky-");
      islandsSeen += islands.length;
      for (const isl of islands) {
        expect(isl.top, `seed ${seed} ${isl.id}: not in upper third`).toBeLessThanOrEqual(
          map.size.y * 0.36,
        );
      }
      // The reachability law covers the sky too: no island may be scatter.
      expect(unreachablePlatforms(map), `seed ${seed}`).toEqual([]);
      // Open-sky convention: still no full ceiling.
      expect(map.platforms.some((p) => p.id === "ceiling")).toBe(false);
    }
    expect(islandsSeen).toBeGreaterThan(300);
  });
});

describe("sky-heavy allocation profile", () => {
  test("profile derives from the seed alone — deterministic, both occur", () => {
    const heavy: number[] = [];
    for (let seed = 0; seed < 200; seed++) {
      expect(genProfileForSeed(seed)).toBe(genProfileForSeed(seed));
      if (genProfileForSeed(seed) === "sky-heavy") heavy.push(seed);
    }
    expect(heavy.length).toBeGreaterThan(40); // ~30% of seed space
    expect(heavy.length).toBeLessThan(120);
  });

  test("sky-heavy seeds: dense traversable sky, every law green (30 seeds)", () => {
    let checked = 0;
    for (let seed = 0; checked < 30 && seed < 300; seed++) {
      if (genProfileForSeed(seed) !== "sky-heavy") continue;
      checked++;
      const map = generateArena(seed);
      const v = validateMap(map);
      expect(
        v.ok,
        `sky-heavy seed ${seed}: unreachable=${v.unreachable.join(",")} routes=${v.routesUp} sight=${v.sightline} dens=${v.density.toFixed(3)} spawns=${v.spawnsOk}`,
      ).toBe(true);
      // Denser sky: a real archipelago plus at least one entry ramp
      // (12-13 steps at 2200 tall — the "large flowing line" to the band).
      expect(boxes(map, "sky-").length, `seed ${seed} islands`).toBeGreaterThanOrEqual(8);
      expect(
        diagChains(map).filter((c) => c.length >= 11).length,
        `seed ${seed} entry ramps`,
      ).toBeGreaterThanOrEqual(1);
      expect(map.name).toBe(`Sky Dock #${seed}`);
    }
    expect(checked).toBe(30);
  });

  test("density inversion: sky-heavy has more sky and less floor clutter on average", () => {
    const acc = {
      "sky-heavy": { n: 0, islands: 0, lips: 0 },
      standard: { n: 0, islands: 0, lips: 0 },
      vertical: { n: 0, islands: 0, lips: 0 },
    };
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      const g = acc[genProfileForSeed(seed)];
      g.n++;
      g.islands += boxes(map, "sky-").length;
      const fTop = floorTop(map);
      // Floor lips: thin ledges hugging the ground band.
      g.lips += map.platforms.filter(
        (p) =>
          p.id.startsWith("ledge-") &&
          p.size.y < 24 &&
          Math.abs(p.position.y - p.size.y / 2 - (fTop - 36)) < 1,
      ).length;
    }
    const heavy = acc["sky-heavy"];
    const std = acc.standard;
    expect(heavy.n).toBeGreaterThan(10);
    expect(std.n).toBeGreaterThan(10);
    expect(heavy.islands / heavy.n).toBeGreaterThan((std.islands / std.n) * 1.5);
    expect(heavy.lips / heavy.n).toBeLessThan(std.lips / std.n);
  });
});

describe("launch pads at diagonal-chain bases (map-design.md item 3)", () => {
  test("120 seeds: every emitted pad is lawful and anchored to a chain base", () => {
    let padsSeen = 0;
    let mapsWithPads = 0;
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      const pads = map.launchPads ?? [];
      if (pads.length > 0) mapsWithPads++;
      expect(pads.length, `seed ${seed}: pad cap`).toBeLessThanOrEqual(4);
      const chains = diagChains(map);
      for (const pad of pads) {
        padsSeen++;
        // Floor-seated, inside the playfield margins (X_MIN/X_MAX).
        expect(pad.position.y, `seed ${seed} ${pad.id}: floor-seated`).toBeGreaterThan(
          map.size.y * 0.9,
        );
        expect(pad.position.x - 48, `seed ${seed} ${pad.id}: left bound`).toBeGreaterThanOrEqual(80);
        expect(pad.position.x + 48, `seed ${seed} ${pad.id}: right bound`).toBeLessThanOrEqual(
          map.size.x - 80,
        );
        // Fires UP-slope: real vertical + real horizontal.
        expect(pad.impulse.y, `seed ${seed} ${pad.id}: upward`).toBeLessThan(0);
        expect(Math.abs(pad.impulse.x), `seed ${seed} ${pad.id}: sideways`).toBeGreaterThan(0);
        // Anchored: some chain's FIRST step sits just ahead of the pad on
        // its launch side (pads only ever spawn at chain bases).
        const dir = Math.sign(pad.impulse.x);
        const anchored = chains.some((chain) => {
          const first = chain[0]!;
          const cx = (first.x0 + first.x1) / 2;
          const delta = cx - pad.position.x;
          return Math.sign(delta) === dir && Math.abs(delta) < 200;
        });
        expect(anchored, `seed ${seed} ${pad.id}: no chain base nearby`).toBe(true);
      }
    }
    // The hook is actually live across the seed space (odds 0.5/0.65 per
    // chain base) without being mandatory.
    expect(mapsWithPads).toBeGreaterThan(20);
    expect(padsSeen).toBeGreaterThan(30);
  });

  test("pads ride the determinism guarantee: same seed → identical pads", () => {
    for (const seed of [3, 7, 11, 42, 99]) {
      const a = generateArena(seed).launchPads ?? [];
      const b = generateArena(seed).launchPads ?? [];
      expect(a).toEqual(b);
    }
  });
});

// ── Helpers for the "wall-rich vertical" vocabulary tests (2026-07-17) ───

function defs(map: MapDefinition, prefix: string): PlatformDefinition[] {
  return map.platforms.filter((p) => p.id.startsWith(prefix));
}

/** Group ks-<n>-a / ks-<n>-b walls into ordered pairs. */
function shaftPairs(map: MapDefinition): { a: PlatformDefinition; b: PlatformDefinition }[] {
  const out: { a: PlatformDefinition; b: PlatformDefinition }[] = [];
  for (const a of defs(map, "ks-")) {
    const m = /^ks-(\d+)-a$/.exec(a.id);
    if (!m) continue;
    const b = map.platforms.find((p) => p.id === `ks-${m[1]}-b`);
    expect(b, `${a.id} without its b wall`).toBeDefined();
    out.push({ a, b: b! });
  }
  return out;
}

/** Minimal hand-built arena: floor → ledge ladder → island; a fin hangs
 *  beside the island; a perch floats 184px above it (out of jump reach —
 *  MAX_STEP_RISE 129 — but inside the fin's wall-kick envelope). */
function finGauntlet(opts: { fin: boolean; ladder: boolean }): MapDefinition {
  const platforms: PlatformDefinition[] = [
    { id: "floor", kind: "floor", position: { x: 600, y: 1010 }, size: { x: 1200, y: 20 } },
    { id: "island", kind: "platform", position: { x: 600, y: 409 }, size: { x: 200, y: 18 } },
    { id: "perch", kind: "platform", position: { x: 848, y: 225 }, size: { x: 96, y: 18 } },
  ];
  if (opts.ladder) {
    for (const top of [880, 760, 640, 520]) {
      platforms.push({
        id: `rung-${top}`,
        kind: "platform",
        position: { x: 600, y: top + 9 },
        size: { x: 200, y: 18 },
      });
    }
  }
  if (opts.fin) {
    // top 336 (64 above the island top 400), bottom 496 (latchable from it).
    platforms.push({
      id: "fin-0",
      kind: "wall",
      position: { x: 760, y: 416 },
      size: { x: 24, y: 160 },
    });
  }
  return {
    id: "fin-gauntlet",
    name: "Fin Gauntlet",
    arenaTheme: "voidVessel",
    size: { x: 1200, y: 1020 },
    spawns: [{ x: 600, y: 960 }],
    platforms,
  };
}

describe("kick-shaft pairs — the signature climb structure", () => {
  test("160 seeds: every pair obeys the shaft laws (gap 200-400, kickable solids)", () => {
    let pairsSeen = 0;
    for (let seed = 0; seed < 160; seed++) {
      const map = generateArena(seed);
      const fTop = floorTop(map);
      for (const { a, b } of shaftPairs(map)) {
        pairsSeen++;
        for (const w of [a, b]) {
          // Solid ≥ GRAB_MIN_H platform = grabbable/kickable 4-way.
          expect(w.kind, `seed ${seed} ${w.id}`).toBe("platform");
          expect(w.size.y, `seed ${seed} ${w.id}: must be kickable-solid`).toBeGreaterThanOrEqual(
            GRAB_MIN_H,
          );
          // Rises 400-1000 off the floor (mid-band connectors), or a full
          // ~1450px SKY SPIRE overhanging the island band (dial 2+3).
          expect(w.size.y, `seed ${seed} ${w.id}: height band`).toBeGreaterThanOrEqual(300);
          expect(w.size.y, `seed ${seed} ${w.id}: height band`).toBeLessThanOrEqual(1600);
          expect(w.position.y + w.size.y / 2, `seed ${seed} ${w.id}: floor-rooted`).toBe(fTop);
        }
        // Parallel walls: same top, gap inside the measured-carry band.
        expect(a.position.y).toBe(b.position.y);
        const gap = b.position.x - b.size.x / 2 - (a.position.x + a.size.x / 2);
        expect(gap, `seed ${seed}: shaft gap`).toBeGreaterThanOrEqual(KICK_SHAFT_GAP_MIN);
        expect(gap, `seed ${seed}: shaft gap`).toBeLessThanOrEqual(SHAFT_MAX);
        // Payoff: a cap perch bridges the shaft top (wall-gated by height).
        const wallTop = a.position.y - a.size.y / 2;
        const mid = (a.position.x + b.position.x) / 2;
        const cap = map.platforms.find(
          (p) =>
            p.kind === "platform" &&
            p.size.y < GRAB_MIN_H &&
            Math.abs(p.position.x - mid) < 8 &&
            Math.abs(p.position.y - p.size.y / 2 - (wallTop - 4)) < 0.001,
        );
        expect(cap, `seed ${seed}: shaft has no cap perch`).toBeDefined();
      }
      // Shafts never break the laws — the whole map still validates.
    }
    // The vocabulary is COMMON across the seed space, not "optional 1".
    expect(pairsSeen).toBeGreaterThan(100);
  });
});

describe("sky-band wall fins — wall-bounce chains extend into the sky", () => {
  test("160 seeds: every fin is latchable from an island and kick-gates its perch", () => {
    let finsSeen = 0;
    for (let seed = 0; seed < 160; seed++) {
      const map = generateArena(seed);
      // Fins anchor on band islands (`sky-`) OR vertical-field stack
      // islands (`skycol-`, 2026-07-17 "more verticle islands" dial).
      const islands = [...boxes(map, "sky-"), ...boxes(map, "skycol-")];
      for (const fin of defs(map, "fin-")) {
        finsSeen++;
        const fx0 = fin.position.x - fin.size.x / 2;
        const fx1 = fin.position.x + fin.size.x / 2;
        const fTopY = fin.position.y - fin.size.y / 2;
        const fBotY = fin.position.y + fin.size.y / 2;
        expect(fin.kind, `seed ${seed} ${fin.id}`).toBe("wall"); // solid, non-standable
        expect(fin.size.y, `seed ${seed} ${fin.id}: fin height`).toBeGreaterThanOrEqual(100);
        expect(fin.size.y, `seed ${seed} ${fin.id}: fin height`).toBeLessThanOrEqual(200);
        // Latchable from an adjacent island: face within a sideways hop,
        // bottom hanging below the island top, usable face above it.
        const anchor = islands.find((i) => {
          const gap = Math.max(fx0 - i.x1, i.x0 - fx1, 0);
          return gap > 0 && gap <= 200 && fBotY >= i.top + 24 && fTopY <= i.top - 24;
        });
        expect(anchor, `seed ${seed} ${fin.id}: no latchable island`).toBeDefined();
        // The paired perch: jump-unreachable from the band, kick-reachable.
        const perch = map.platforms.find((p) => p.id === `finperch-${fin.id.slice(4)}`);
        expect(perch, `seed ${seed} ${fin.id}: no fin perch`).toBeDefined();
        const pTop = perch!.position.y - perch!.size.y / 2;
        expect(anchor!.top - pTop, `seed ${seed} ${fin.id}: perch must out-rise a jump`)
          .toBeGreaterThan(MAX_STEP_RISE);
        expect(pTop, `seed ${seed} ${fin.id}: perch above kick rise`).toBeGreaterThanOrEqual(
          fTopY - KICK_RISE,
        );
        const perchGap = Math.max(
          fx0 - (perch!.position.x + perch!.size.x / 2),
          perch!.position.x - perch!.size.x / 2 - fx1,
          0,
        );
        expect(perchGap, `seed ${seed} ${fin.id}: perch beyond kick carry`).toBeLessThanOrEqual(
          KICK_CARRY,
        );
      }
    }
    expect(finsSeen).toBeGreaterThan(150);
  });

  test("fins do REAL reachability work: removing the fin strands its perch", () => {
    const withFin = finGauntlet({ fin: true, ladder: true });
    expect(unreachablePlatforms(withFin)).toEqual([]);
    const noFin = finGauntlet({ fin: false, ladder: true });
    expect(unreachablePlatforms(noFin)).toEqual(["perch"]);
  });
});

describe("long diagonal chains — the large ramps", () => {
  test("160 seeds: 7-10 step ramps exist and span a big fraction of the arena", () => {
    let longSeen = 0;
    for (let seed = 0; seed < 160; seed++) {
      const map = generateArena(seed);
      for (const chain of diagChains(map)) {
        if (chain.length < 7) continue;
        longSeen++;
        // 7-10 = long mid-band ramps; 12-13 = floor→sky entry ramps.
        expect(chain.length, `seed ${seed}: ramp too long`).toBeLessThanOrEqual(13);
        const cx = (b: Box) => (b.x0 + b.x1) / 2;
        const span = Math.abs(cx(chain[chain.length - 1]!) - cx(chain[0]!));
        expect(span, `seed ${seed}: long ramp must read as a LARGE ramp`)
          .toBeGreaterThanOrEqual((chain.length - 1) * 128);
        // Step laws (rise/arc-gap/one-direction) are enforced for ALL chains
        // by the diagonal-ascent-chains suite above.
      }
    }
    expect(longSeen).toBeGreaterThan(40);
  });
});

describe("vertical allocation profile — Shaft Docks", () => {
  function mb32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("3-way split is deterministic; the sky-heavy band is UNCHANGED (r<0.3)", () => {
    const counts = { "sky-heavy": 0, vertical: 0, standard: 0 };
    for (let seed = 0; seed < 300; seed++) {
      const r = mb32((seed ^ 0x5eedbead) >>> 0)();
      const expected = r < 0.3 ? "sky-heavy" : r < 0.53 ? "vertical" : "standard";
      expect(genProfileForSeed(seed), `seed ${seed}`).toBe(expected);
      counts[expected]++;
    }
    // All three occur at healthy rates across the seed space.
    expect(counts["sky-heavy"]).toBeGreaterThan(60);
    expect(counts.vertical).toBeGreaterThan(45);
    expect(counts.standard).toBeGreaterThan(100);
  });

  test("25 vertical seeds: all laws green, 2-3 mandatory kick-shafts, Shaft Dock name", () => {
    let checked = 0;
    for (let seed = 0; checked < 25 && seed < 300; seed++) {
      if (genProfileForSeed(seed) !== "vertical") continue;
      checked++;
      const map = generateArena(seed);
      const v = validateMap(map);
      expect(
        v.ok,
        `vertical seed ${seed}: unreachable=${v.unreachable.join(",")} routes=${v.routesUp} sight=${v.sightline} dens=${v.density.toFixed(3)} spawns=${v.spawnsOk}`,
      ).toBe(true);
      const pairs = shaftPairs(map).length;
      // ×1.6 vertical budget (2026-07-17): mandatory floor raised 2 → 3;
      // cap = 4 mid-band shafts + 1 sky spire.
      expect(pairs, `seed ${seed}: kick-shafts are MANDATORY`).toBeGreaterThanOrEqual(3);
      expect(pairs, `seed ${seed}: shaft cap`).toBeLessThanOrEqual(5);
      expect(map.name).toBe(`Shaft Dock #${seed}`);
    }
    expect(checked).toBe(25);
  });
});

describe("wall-gated perch law — the jetpack exemption is dead", () => {
  test("a perch with no kickable wall in reach is a violation; wall-gated is lawful", () => {
    // No walls at all: the stranded perch is a hard violation.
    const noFin = finGauntlet({ fin: false, ladder: true });
    expect(perchViolations(noFin)).toEqual(["perch"]);
    // Fin present + climbable approach: perch is plain REACHABLE (wall-kick
    // edges are part of the route graph now) — nothing to exempt.
    const withFin = finGauntlet({ fin: true, ladder: true });
    expect(perchViolations(withFin)).toEqual([]);
    // Fin present but its approach ladder removed: island + perch are
    // unreachable, yet both sit inside a kickable wall's envelope — lawful
    // perches (wall-gated), NOT violations.
    const noLadder = finGauntlet({ fin: true, ladder: false });
    expect(unreachablePlatforms(noLadder).sort()).toEqual(["island", "perch"]);
    expect(perchViolations(noLadder)).toEqual([]);
  });
});

describe("2026-07-17 dials — horizontals −58%, verticals ×1.6, height ×2", () => {
  test("dial 1: T1 shelf band thinned to the 0.42 budget (120 seeds)", () => {
    // Pre-dial the generator emitted 4-5 T1 shelves per map (E≈4.5) at
    // exactly FLOOR_TOP−108. The deco cull keeps round(0.42·n) of the
    // budget horizontals, so the surviving T1 average must sit near
    // 4.5 × 0.42 ≈ 1.9 — and far below the old 4.5.
    let t1 = 0;
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      const t1Top = map.size.y - 36 - 108;
      t1 += map.platforms.filter(
        (p) =>
          p.id.startsWith("ledge-") &&
          p.size.y < 24 &&
          Math.abs(p.position.y - p.size.y / 2 - t1Top) < 1,
      ).length;
    }
    const avg = t1 / 120;
    expect(avg, `avg T1 shelves ${avg.toFixed(2)}`).toBeGreaterThanOrEqual(1.0);
    expect(avg, `avg T1 shelves ${avg.toFixed(2)}`).toBeLessThanOrEqual(2.8);
  });

  test("dial 2+3: sky spires — full-height shaft pairs overhang the island band", () => {
    let spires = 0;
    for (let seed = 0; seed < 160; seed++) {
      const map = generateArena(seed);
      const islands = boxes(map, "sky-");
      for (const { a, b } of shaftPairs(map)) {
        if (a.size.y < 1200) continue; // mid-band shaft, not a spire
        spires++;
        // A spire exists to serve the band: its cap perch sits exactly
        // 28px above the island band, a falling hop from an island.
        const capTop = a.position.y - a.size.y / 2 - 4;
        const mid = (a.position.x + b.position.x) / 2;
        const gap = b.position.x - b.size.x / 2 - (a.position.x + a.size.x / 2);
        const capX0 = mid - (gap + 28) / 2;
        const capX1 = mid + (gap + 28) / 2;
        const anchor = islands.find((i) => {
          const lat = Math.max(i.x0 - capX1, capX0 - i.x1, 0);
          return i.top - capTop === 28 && lat <= 300;
        });
        expect(anchor, `seed ${seed}: spire cap does not overhang the band`).toBeDefined();
      }
    }
    // Spires are a real presence across the seed space (E≈0.4/map).
    expect(spires).toBeGreaterThan(25);
  });

  test("vertical island field: stack islands chain to the band within the hop grammar", () => {
    let stacks = 0;
    let fieldMaps = 0;
    for (let seed = 0; seed < 120; seed++) {
      const map = generateArena(seed);
      const band = boxes(map, "sky-");
      const cols = new Map<string, Box[]>();
      for (const s of boxes(map, "skycol-")) {
        const m = /^skycol-(\d+)-(\d+)$/.exec(s.id)!;
        const list = cols.get(m[1]!) ?? [];
        list[Number(m[2]!)] = s;
        cols.set(m[1]!, list);
      }
      if (cols.size > 0) fieldMaps++;
      for (const chain of cols.values()) {
        for (let i = 0; i < chain.length; i++) {
          const cur = chain[i]!;
          expect(cur, "skycol indices must be contiguous").toBeDefined();
          stacks++;
          // Parent = previous stack island, or a band island for i=0.
          const parents = i === 0 ? band : [chain[i - 1]!];
          const parent = parents.find((p) => {
            const rise = cur.top - p.top; // stack descends: cur is LOWER
            const overlap = Math.min(cur.x1, p.x1) - Math.max(cur.x0, p.x0);
            return rise >= 104 && rise <= 128 && overlap >= 8;
          });
          // rise ≤ 129 with x-overlap → rising gap 0: the climb UP through
          // the field is always legal; downward is a plain fall.
          expect(parent, `seed ${seed} ${cur.id}: no hop-law parent`).toBeDefined();
        }
      }
      // The reachability law already covers the field (unreachable=[] in
      // the fuzz suite) — this suite pins the CHAIN construction.
    }
    expect(stacks).toBeGreaterThan(400); // dramatically island-rich overall
    expect(fieldMaps).toBeGreaterThan(90); // nearly every map grows a field
  });
});

describe("RNG-stream discipline — base skeleton is pinned across vocab changes", () => {
  // generateCandidate's BASE stream (floor/walls/roofs/covers/T1/nest/chimney)
  // must keep its exact draw order: these tuples were captured from the
  // generator BEFORE the diagonals-&-sky vocabulary landed. If this test
  // breaks, every gen:<seed> map players have seen just silently changed.
  function mulberry32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("seed 7 / attempt 0 base skeleton matches the pre-change capture", () => {
    const base = (7 ^ (0 * 0x9e3779b9)) >>> 0;
    const cand = generateCandidate(
      mulberry32(base),
      mulberry32((base + 0x51ab7e0d) >>> 0),
      "standard",
    );
    const tup = new Map(
      cand.platforms.map((p) => [
        p.id,
        [p.position.x, p.position.y, p.size.x, p.size.y].join(","),
      ]),
    );
    // Captured from the pre-change generator (baseline 2026-07-16), then
    // mapped through the 2026-07-17 DOUBLE-HEIGHT dial (1100 → 2200):
    //   • x positions and ALL sizes are unchanged — they prove the base
    //     rand() draw order is byte-identical (the pin's actual job);
    //   • floor-rooted y shifts by +1100 (±4 snap: FLOOR_TOP is 2164 ≡ 4
    //     mod 8 where 1064 was ≡ 0, so snap8 rounds differently);
    //   • cover-column IDs renumber (old col-5 → col-4 etc.): the shared
    //     id counter no longer ticks for cover lips inline, because
    //     budget horizontals are emitted by the deferred deco cull
    //     (Jake dial 1). Same columns, same geometry stream, new labels.
    expect(tup.get("floor")).toBe("1500,2182,3000,36"); // was 1500,1082
    expect(tup.get("wall-left")).toBe("16,1100,32,2200"); // was 16,550,h 1100
    expect(tup.get("roof-0")).toBe("384,30,720,28"); // unchanged (sky-fixed)
    expect(tup.get("roof-1")).toBe("2568,30,664,28"); // unchanged
    expect(tup.get("col-2")).toBe("424,2120,48,88"); // was 424,1024
    expect(tup.get("col-3")).toBe("960,2120,56,88"); // was 960,1024
    expect(tup.get("col-4")).toBe("1512,2112,48,104"); // was col-5 @1016
  });
});

describe("vessel-nexus curated mega — always floor + sightlines", () => {
  test("full recoverable floor, cover, reachable, ≥12 pads", () => {
    const map = resolveMap("vessel-nexus");
    expect(map.id).toBe("vessel-nexus");
    expect(map.spawns.length).toBeGreaterThanOrEqual(12);
    expect(map.size.x).toBeGreaterThanOrEqual(2800);
    expect(unreachablePlatforms(map)).toEqual([]);
    // ALWAYS a continuous ground floor (no void death between islands).
    const floor = map.platforms.find((p) => p.id === "floor");
    expect(floor?.kind).toBe("floor");
    expect(floor!.size.x).toBeGreaterThanOrEqual(2800);
    // Contained sides + open sky (no full-width ceiling box lid).
    expect(map.platforms.some((p) => p.id === "wall-left")).toBe(true);
    expect(map.platforms.some((p) => p.id === "wall-right")).toBe(true);
    expect(map.platforms.some((p) => p.id === "ceiling")).toBe(false);
    // Floor-band cover pylons for sightline discipline.
    const covers = map.platforms.filter((p) => p.id.startsWith("cover-"));
    expect(covers.length).toBeGreaterThanOrEqual(4);
    const v = validateMap(map);
    expect(v.ok, `sight=${v.sightline} dens=${v.density} spawns=${v.spawnsOk}`).toBe(true);
    expect(v.sightline).toBeLessThanOrEqual(480);
  });
});

describe("curated map audit — same validator, no exceptions for age", () => {
  test("boxworks-mini: everything reachable (post-T1)", () => {
    expect(unreachablePlatforms(resolveMap("boxworks-mini"))).toEqual([]);
  });

  test("boxworks-tower: high ground must be wall-kick gated (jetpack is dead)", () => {
    // Tower was "the designated jetpack map" — but the jetpack is DEAD CODE
    // (player.ts: jetpackActive = false unconditionally), so the old
    // "unreachable-but-high = fine" exemption is a lie. Under the wall-kick
    // model, high-left/high-right stay UNREACHABLE in-graph (their route is
    // a sustained outer-wall pogo climb, which the model deliberately does
    // not credit) but are LAWFUL wall-gated perches: the outer walls sit
    // 78px away laterally — climb-or-fall high ground, honest gate.
    const tower = resolveMap("boxworks-tower");
    expect(unreachablePlatforms(tower).sort()).toEqual([
      "crow-nest",
      "high-left",
      "high-right",
    ]);
    // KNOWN FINDING (2026-07-17, pinned so it stays tracked): crow-nest
    // (top y=269, x 610-830) has NO kickable wall inside the conservative
    // kick envelope — the nearest walls are the mid-cover columns (top 715,
    // i.e. 446px below the nest, ≫ KICK_RISE 160) and the outer walls
    // (578px away laterally, ≫ KICK_CARRY 380). Fix belongs in the curated
    // map (raise the mid-cover columns, or hang a 24×200 fin with its top
    // ≤ y≈430 within ~380px of the nest); curated maps are not edited from
    // mapGen work.
    expect(perchViolations(tower)).toEqual(["crow-nest"]);
  });
});
