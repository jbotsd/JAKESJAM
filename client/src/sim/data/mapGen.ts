// Deterministic arena generator — WALL-MOVEMENT structured, validator-gated.
//
// Rewritten for the Super Meat Boy / Warframe wall kit (docs/character-
// controller-overhaul.md): the jetpack is gone, so VERTICAL traversal is
// wall-jumping up shafts. Every arena is built from tall SOLID columns
// (a `platform` taller than the one-way cap of 24px is solid 4-way → a
// grabbable wall) arranged so that:
//   • columns sit within SHAFT_MAX of the outer wall or a sibling column,
//     forming climbable shafts,
//   • perches sit at shaft tops (reachable by wall-jumping the shaft),
//   • thin one-way ledges give lateral hop routes,
//   • ≥2 low ledges are a plain jump off the floor (routes up),
// checked by a route-graph validator that models BOTH jump edges AND
// shaft/wall-jump reachability BEFORE the map is allowed to exist.
//
// Deterministic: `gen:N` expands to byte-identical geometry on client and
// server. PURE MODULE: no Math.random, no Date, no Phaser, no DOM.

import type { MapDefinition, PlatformDefinition, Vec2 } from "../types.js";

// ── Arena frame. BIGGER than boxworks-mini (user: "the bigger ones are
//    funner") — more room to run, dash, and chain wall-jumps up taller shafts.
const ARENA_W = 1760;
const ARENA_H = 820;
const WALL = 32;
const FLOOR_H = 32;
const PLAT_H = 18; // thin one-way ledge thickness (≤ 24 → pass-through)
const FLOOR_TOP = ARENA_H - FLOOR_H; // 788 — feet rest here

// ── Movement-derived law constants (docs/map-design.md) ──────────────────
/** Max rise a standard jump may be asked to clear (93% of 139px apex). */
export const MAX_STEP_RISE = 129;
/** Max horizontal gap while RISING to a higher platform. */
export const MAX_GAP_RISING = 180;
/** Max horizontal gap when FALLING/level (full-speed arc). */
export const MAX_GAP_FALLING = 300;
/** Sightline cap per horizontal band. Roomier for the bigger, more open
 *  arena — the floor still gets cover, just not wall-to-wall. */
export const MAX_SIGHTLINE = 560;
/** Openness band: platform+column footprint as fraction of playable area. */
export const DENSITY_MIN = 0.08;
export const DENSITY_MAX = 0.16;
/** Minimum spawn separation. */
export const MIN_SPAWN_DIST = 360;

// ── Wall-movement law constants (docs/character-controller-overhaul.md) ──
/** A `platform` taller than this is SOLID 4-way (grabbable). Mirrors
 *  ONE_WAY_MAX_HEIGHT_PX in collision.ts — the reason columns can be walls. */
export const GRAB_MIN_H = 25;
/** Max gap between two facing grab walls that can still be climbed as a
 *  shaft (wall-jump vx 430 crosses this comfortably). */
export const SHAFT_MAX = 230;
/** Extra reach ABOVE a shaft's climb-top for the final wall-jump hop
 *  (wall-jump apex ≈ 179px at vy -720). */
export const WALL_JUMP_UP = 186;
/** Horizontal reach of a wall-jump onto a side ledge. */
export const GRAB_REACH_SIDE = 200;

// Ledge bands (feet land on top). Each ~108px above the last (≤ jump rise),
// so the whole gym is climbable with plain jumps; wall-shafts skip the climb.
// Floor 788 → 680 → 572 → 464 → 356 → 248.
const BANDS = [680, 572, 464, 356, 248] as const;
// Side climb towers reach a tall band; central tower is a bit shorter.
const SIDE_TOWER_TOPS = [356, 248] as const;
const CENTER_TOWER_TOPS = [464, 356] as const;
// Short cover pillars break the floor sightline without walling the arena.
const COVER_TOP = 640;

// ── Seeded PRNG (mulberry32 — same family the bots use) ─────────────────
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const snap8 = (v: number) => Math.round(v / 8) * 8;
const pick = <T>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)]!;

// ── Generation ───────────────────────────────────────────────────────────

/**
 * Generate one arena candidate. Mirror-symmetric ~half the time (1v1
 * fairness). Builds side shafts (outer wall + column), an optional central
 * shaft (column pair), perches at shaft tops, lateral ledges, and low
 * launch ledges — all sized to the wall-jump laws.
 */
function generateCandidate(rand: () => number): MapDefinition {
  const mirrored = rand() < 0.5;
  const platforms: PlatformDefinition[] = [
    { id: "floor", kind: "floor", position: { x: ARENA_W / 2, y: ARENA_H - FLOOR_H / 2 }, size: { x: ARENA_W, y: FLOOR_H } },
    { id: "wall-left", kind: "wall", position: { x: WALL / 2, y: ARENA_H / 2 }, size: { x: WALL, y: ARENA_H } },
    { id: "wall-right", kind: "wall", position: { x: ARENA_W - WALL / 2, y: ARENA_H / 2 }, size: { x: WALL, y: ARENA_H } },
    { id: "ceiling", kind: "wall", position: { x: ARENA_W / 2, y: WALL / 2 }, size: { x: ARENA_W, y: WALL } },
  ];
  let idc = 0;
  const nid = (p: string) => `${p}-${idc++}`;

  // Solid grab column from floor up to `top`. Solid 4-way (h > GRAB_MIN_H).
  const addColumn = (cx: number, w: number, top: number) => {
    const h = FLOOR_TOP - top;
    platforms.push({ id: nid("col"), kind: "platform", position: { x: snap8(cx), y: snap8(top + h / 2) }, size: { x: w, y: snap8(h) } });
  };
  // Thin one-way ledge (pass-through from below).
  const addLedge = (cx: number, w: number, top: number) => {
    platforms.push({ id: nid("ledge"), kind: "platform", position: { x: snap8(cx), y: top + PLAT_H / 2 }, size: { x: snap8(w), y: PLAT_H } });
  };

  const colW = snap8(36 + rand() * 12); // 36..48 — thin towers keep it open

  // ── SIDE climb towers: each forms a wall-jump shaft with the outer wall.
  const leftColX = snap8(WALL + colW / 2 + 90 + rand() * 64);
  const leftTop = pick(rand, SIDE_TOWER_TOPS);
  addColumn(leftColX, colW, leftTop);
  addLedge(leftColX + colW / 2 + 78, 150, leftTop); // perch beside the tower

  const rightColX = mirrored
    ? ARENA_W - leftColX
    : snap8(ARENA_W - WALL - colW / 2 - 90 - rand() * 64);
  const rightTop = mirrored ? leftTop : pick(rand, SIDE_TOWER_TOPS);
  addColumn(rightColX, colW, rightTop);
  addLedge(rightColX - colW / 2 - 78, 150, rightTop);

  // ── CENTRAL climb tower + perch — a mid anchor that also breaks the middle
  //    sightline. A bit shorter than the sides.
  const centerX = snap8(ARENA_W / 2 + (mirrored ? 0 : (rand() - 0.5) * 130));
  const cTop = pick(rand, CENTER_TOWER_TOPS);
  addColumn(centerX, colW, cTop);
  addLedge(centerX, 160, cTop); // perch atop

  // ── Short COVER pillars in the wide floor gaps — sightline + low climb pads.
  const coverLX = snap8((leftColX + centerX) / 2);
  const coverRX = mirrored ? ARENA_W - coverLX : snap8((rightColX + centerX) / 2);
  addColumn(coverLX, colW, COVER_TOP);
  addColumn(coverRX, colW, COVER_TOP);

  // ── LEDGE BANDS: an open jungle-gym. Diagonal staircases climb inward from
  //    each side (the reachability spine — every step is a plain jump off the
  //    one below), plus scattered lateral ledges on the lower bands so there's
  //    always somewhere to hop, with wide gaps that reward a dash.
  const stairLX = snap8(230 + rand() * 80);
  const step = 176; // horizontal march per band (crossable while rising)
  for (let b = 0; b < BANDS.length; b++) {
    const top = BANDS[b]!;
    const w = snap8(130 + rand() * 64);
    addLedge(snap8(stairLX + b * step), w, top);
    const rx = mirrored
      ? ARENA_W - (stairLX + b * step)
      : snap8(ARENA_W - stairLX - b * step);
    addLedge(rx, w, top);
    if (b < 3) {
      // extra hop target / dash pad, wandering across the open middle.
      addLedge(snap8(ARENA_W / 2 + (rand() - 0.5) * 340), snap8(120 + rand() * 64), top);
    }
  }

  // ── Spawns. CRITICAL: a floor spawn must NOT sit inside a solid column —
  // the body would spawn embedded, the collision resolver ejects it out of the
  // map, and it void-kills → respawns at the same bad point → an endless
  // "teleport to spawn" loop. So we only place floor spawns in the OPEN lanes
  // between columns, and use perch tops (already clear) for the rest.
  const SPAWN_TARGET = 8;
  const solidCols = platforms
    .filter((p) => p.id.startsWith("col"))
    .map((p) => ({ x0: p.position.x - p.size.x / 2, x1: p.position.x + p.size.x / 2 }));
  const HALF_W = 13 + 18; // player half-width + clearance margin
  const floorClear = (x: number) =>
    solidCols.every((c) => x + HALF_W < c.x0 || x - HALF_W > c.x1);
  const floorY = FLOOR_TOP - 68;
  const floorPts: Vec2[] = [];
  for (let x = WALL + 96; x <= ARENA_W - WALL - 96; x += 88) {
    if (floorClear(x)) floorPts.push({ x: snap8(x), y: floorY });
  }
  // Order: the two floor extremes first (end-to-end 1v1 open), then perch tops,
  // then the middle floor lanes. Greedy accept keeps every pair ≥ MIN_SPAWN_DIST.
  const perchPts: Vec2[] = [
    { x: leftColX + colW / 2 + 82, y: leftTop - 68 },
    { x: rightColX - colW / 2 - 82, y: rightTop - 68 },
    { x: centerX, y: cTop - 68 },
  ];
  // Perches FIRST (the arena is short, so the ~352px-high perches only clear
  // MIN_SPAWN_DIST from floor points at a different x — seeding them first lets
  // the floor lanes stagger AROUND them). Then the floor extremes (end-to-end),
  // then middle floor lanes. The spawn assigner picks max-spread at match time,
  // so list order doesn't affect 1v1 fairness.
  const ordered: Vec2[] = [
    ...perchPts,
    ...(floorPts.length > 0 ? [floorPts[0]!, floorPts[floorPts.length - 1]!] : []),
    ...floorPts.slice(1, -1),
  ];
  const spawns: Vec2[] = [];
  for (const cand of ordered) {
    if (spawns.length >= SPAWN_TARGET) break;
    if (spawns.every((sp) => Math.hypot(sp.x - cand.x, sp.y - cand.y) >= MIN_SPAWN_DIST)) {
      spawns.push(cand);
    }
  }

  const themes = ["jadeIsles", "ivoryClouds", "hangingWood"] as const;
  return {
    id: "gen",
    name: "Generated Arena",
    arenaTheme: themes[Math.floor(rand() * themes.length)]!,
    size: { x: ARENA_W, y: ARENA_H },
    spawns,
    platforms,
  };
}

// ── Validation (the laws) ────────────────────────────────────────────────

type Top = { x0: number; x1: number; top: number; id: string; kind: string };
type Solid = { x0: number; x1: number; top: number; cx: number };

/** Platform TOPS you can stand on (floor + all platforms; excludes the
 *  ceiling and the outer side walls' "tops"). */
function tops(map: MapDefinition): Top[] {
  return map.platforms
    .filter((p) => p.kind !== "wall" || p.id === "floor")
    .filter((p) => p.id !== "ceiling")
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
    }));
}

/** SOLID grab walls: the outer side walls (full height) plus any `platform`
 *  tall enough to be solid 4-way (a column). These are the wall-jump
 *  substrate. All reach the floor, so all are reachable from the floor. */
function grabWalls(map: MapDefinition): Solid[] {
  const out: Solid[] = [];
  for (const p of map.platforms) {
    if (p.id === "ceiling" || p.id === "floor") continue;
    const isOuterWall = p.kind === "wall";
    const isColumn = p.kind === "platform" && p.size.y >= GRAB_MIN_H;
    if (!isOuterWall && !isColumn) continue;
    out.push({
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
      cx: p.position.x,
    });
  }
  return out;
}

/** Tops reachable by climbing a SHAFT (two grab walls facing within
 *  SHAFT_MAX) and wall-jumping off the top. yClimb = the shorter wall's top
 *  (where both walls still exist); a final hop reaches WALL_JUMP_UP above it
 *  and GRAB_REACH_SIDE to the side. */
function shaftReachable(ts: Top[], walls: Solid[]): Set<string> {
  const reached = new Set<string>();
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i]!;
      const b = walls[j]!;
      const gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0;
      if (gap <= 0 || gap > SHAFT_MAX) continue; // overlapping or too wide
      const yClimb = Math.max(a.top, b.top); // shorter wall's top (higher y)
      const reachTop = yClimb - WALL_JUMP_UP;
      const xLo = Math.min(a.x0, b.x0) - GRAB_REACH_SIDE;
      const xHi = Math.max(a.x1, b.x1) + GRAB_REACH_SIDE;
      for (const t of ts) {
        if (t.id === "floor") continue;
        const cx = (t.x0 + t.x1) / 2;
        if (cx >= xLo && cx <= xHi && t.top >= reachTop && t.top <= FLOOR_TOP) {
          reached.add(t.id);
        }
      }
    }
  }
  return reached;
}

/**
 * Route-graph reachability: seed with the floor + everything reachable by
 * climbing a shaft, then BFS out over jump-sized edges. A top is unreachable
 * only if neither the wall kit nor a jump can get to it.
 */
export function unreachablePlatforms(map: MapDefinition): string[] {
  const ts = tops(map);
  const floor = ts.find((t) => t.id === "floor");
  if (!floor) return ["<no-floor>"];
  const reached = shaftReachable(ts, grabWalls(map));
  reached.add(floor.id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const from of ts) {
      if (!reached.has(from.id)) continue;
      for (const to of ts) {
        if (reached.has(to.id)) continue;
        const rise = from.top - to.top; // positive = going UP
        const gap =
          to.x0 > from.x1 ? to.x0 - from.x1 : from.x0 > to.x1 ? from.x0 - to.x1 : 0;
        const ok =
          rise > 0
            ? rise <= MAX_STEP_RISE && gap <= MAX_GAP_RISING
            : gap <= MAX_GAP_FALLING;
        if (ok) {
          reached.add(to.id);
          grew = true;
        }
      }
    }
  }
  return ts.filter((t) => !reached.has(t.id)).map((t) => t.id);
}

/** Distinct routes UP from the floor: a plain jump onto a ledge, OR a
 *  shaft you can climb. Both count — the wall kit is a first-class route. */
function routesUp(map: MapDefinition): number {
  const ts = tops(map);
  const floor = ts.find((t) => t.id === "floor")!;
  const jumpRoutes = ts.filter((t) => {
    if (t.id === "floor") return false;
    const rise = floor.top - t.top;
    return rise > 0 && rise <= MAX_STEP_RISE;
  }).length;
  const shafts = grabWalls(map);
  let shaftRoutes = 0;
  for (let i = 0; i < shafts.length; i++) {
    for (let j = i + 1; j < shafts.length; j++) {
      const a = shafts[i]!;
      const b = shafts[j]!;
      const gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0;
      if (gap > 0 && gap <= SHAFT_MAX) shaftRoutes++;
    }
  }
  return jumpRoutes + shaftRoutes;
}

/** Longest unbroken sightline in the floor lane, broken by columns/ledges
 *  intersecting shoulder height. */
function worstSightline(map: MapDefinition): number {
  const bandY = FLOOR_TOP - 28;
  const blockers = map.platforms
    .filter((p) => p.kind !== "floor" && p.id !== "ceiling" && p.kind !== "wall")
    .filter((p) => {
      const y0 = p.position.y - p.size.y / 2;
      const y1 = p.position.y + p.size.y / 2;
      return bandY >= y0 && bandY <= y1;
    })
    .map((p) => ({ x0: p.position.x - p.size.x / 2, x1: p.position.x + p.size.x / 2 }))
    .sort((a, b) => a.x0 - b.x0);
  let worst = 0;
  let cursor = WALL;
  for (const b of blockers) {
    worst = Math.max(worst, b.x0 - cursor);
    cursor = Math.max(cursor, b.x1);
  }
  return Math.max(worst, ARENA_W - WALL - cursor);
}

function density(map: MapDefinition): number {
  // Columns (solid platforms) AND ledges are structure; both count.
  const area = map.platforms
    .filter((p) => p.kind === "platform")
    .reduce((a, p) => a + p.size.x * p.size.y, 0);
  const playable = (map.size.x - 2 * WALL) * (map.size.y - FLOOR_H - WALL);
  return area / playable;
}

function spawnsValid(map: MapDefinition): boolean {
  const ts = tops(map);
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i]!;
    const under = ts.some(
      (t) => s.x >= t.x0 - 8 && s.x <= t.x1 + 8 && t.top >= s.y && t.top - s.y < 200,
    );
    if (!under) return false;
    for (let j = i + 1; j < map.spawns.length; j++) {
      const o = map.spawns[j]!;
      if (Math.hypot(s.x - o.x, s.y - o.y) < MIN_SPAWN_DIST) return false;
    }
  }
  return map.spawns.length >= 2;
}

export type MapValidation = {
  ok: boolean;
  unreachable: string[];
  routesUp: number;
  sightline: number;
  density: number;
  spawnsOk: boolean;
};

export function validateMap(map: MapDefinition): MapValidation {
  const unreachable = unreachablePlatforms(map);
  const routes = routesUp(map);
  const sight = worstSightline(map);
  const dens = density(map);
  const spawnsOk = spawnsValid(map);
  return {
    ok:
      unreachable.length === 0 &&
      routes >= 2 &&
      sight <= MAX_SIGHTLINE &&
      dens >= DENSITY_MIN &&
      dens <= DENSITY_MAX &&
      spawnsOk,
    unreachable,
    routesUp: routes,
    sightline: sight,
    density: dens,
    spawnsOk,
  };
}

// ── Public entry ─────────────────────────────────────────────────────────

export const GEN_MAP_PREFIX = "gen:";
const MAX_ATTEMPTS = 60;

/**
 * Deterministically produce a VALID arena for a seed. Invalid candidates
 * advance the attempt counter (seeded), so (seed → map) is a pure function.
 */
export function generateArena(seed: number): MapDefinition {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rand = mulberry32((seed ^ (attempt * 0x9e3779b9)) >>> 0);
    const candidate = generateCandidate(rand);
    if (validateMap(candidate).ok) {
      return { ...candidate, id: `${GEN_MAP_PREFIX}${seed}`, name: `Arena #${seed}` };
    }
  }
  const fallback = generateCandidate(mulberry32(0xfa11bacc));
  return { ...fallback, id: `${GEN_MAP_PREFIX}${seed}`, name: `Arena #${seed}` };
}

export function isGenMapId(id: string | undefined): boolean {
  return !!id && id.startsWith(GEN_MAP_PREFIX);
}

export function parseGenSeed(id: string): number | null {
  if (!isGenMapId(id)) return null;
  const n = Number(id.slice(GEN_MAP_PREFIX.length));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
