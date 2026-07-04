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

// ── Arena frame (matches boxworks-mini scale — see game-feel-tuning.md) ──
const ARENA_W = 1280;
const ARENA_H = 640;
const WALL = 32;
const FLOOR_H = 32;
const PLAT_H = 18; // thin one-way ledge thickness (≤ 24 → pass-through)
const FLOOR_TOP = ARENA_H - FLOOR_H; // 608 — feet rest here

// ── Movement-derived law constants (docs/map-design.md) ──────────────────
/** Max rise a standard jump may be asked to clear (93% of 139px apex). */
export const MAX_STEP_RISE = 129;
/** Max horizontal gap while RISING to a higher platform. */
export const MAX_GAP_RISING = 180;
/** Max horizontal gap when FALLING/level (full-speed arc). */
export const MAX_GAP_FALLING = 300;
/** Sightline cap per horizontal band. */
export const MAX_SIGHTLINE = 420;
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
 *  (wall-jump apex ≈ 124px at vy -600). */
export const WALL_JUMP_UP = 138;
/** Horizontal reach of a wall-jump onto a side ledge. */
export const GRAB_REACH_SIDE = 200;

// Column top heights (feet/perch land here). Higher = taller shaft climb.
const COL_TOPS = [316, 256, 196] as const;
// Low-ledge top: one plain jump off the floor (rise 608-498 = 110 ≤ RISE).
const LOW_LEDGE_TOP = 498;
const MID_LEDGE_TOPS = [430, 356] as const;

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

  const colW = snap8(40 + rand() * 16); // 40..56

  // ── Side shafts: a column near each outer wall forms a wall+column shaft.
  // Gap (wall inner=WALL) → column left edge is ≤ SHAFT_MAX so it climbs.
  const leftColX = snap8(WALL + colW / 2 + 96 + rand() * 70); // gap ~96..166
  const leftTop = pick(rand, COL_TOPS);
  addColumn(leftColX, colW, leftTop);
  // Perch just INSIDE the column (wall-jump off the column lands here).
  addLedge(leftColX + colW / 2 + 82, 150, leftTop);

  const rightColX = mirrored
    ? ARENA_W - leftColX
    : snap8(ARENA_W - WALL - colW / 2 - 96 - rand() * 70);
  const rightTop = mirrored ? leftTop : pick(rand, COL_TOPS);
  addColumn(rightColX, colW, rightTop);
  addLedge(rightColX - colW / 2 - 82, 150, rightTop);

  // ── Central shaft: a column PAIR (gap ≤ SHAFT_MAX) with a bridging perch.
  const centerGap = snap8(150 + rand() * (SHAFT_MAX - 170)); // 150..210
  const centerX = ARENA_W / 2 + (mirrored ? 0 : snap8((rand() - 0.5) * 120));
  const cTop = pick(rand, COL_TOPS);
  const cLX = snap8(centerX - centerGap / 2 - colW / 2);
  const cRX = snap8(centerX + centerGap / 2 + colW / 2);
  addColumn(cLX, colW, cTop);
  addColumn(cRX, colW, cTop);
  // Perch bridging the shaft top (spans the gap so you top out onto it).
  addLedge(centerX, centerGap + colW, cTop - PLAT_H);

  // ── Low launch ledges: ≥2 plain jumps off the floor (routes up), placed
  // between the side columns and center so lateral hops chain upward.
  const lowXs = mirrored
    ? [snap8(ARENA_W * 0.32), snap8(ARENA_W * 0.68)]
    : [snap8(ARENA_W * 0.3 + (rand() - 0.5) * 80), snap8(ARENA_W * 0.72 + (rand() - 0.5) * 80)];
  for (const lx of lowXs) addLedge(lx, snap8(150 + rand() * 70), LOW_LEDGE_TOP);

  // ── Mid ledges: lateral wall-jump targets between the perches. Kept within
  // GRAB_REACH_SIDE of a column so they're wall-reachable, and within a jump
  // of the low ledges so there are multiple routes.
  const midTop = pick(rand, MID_LEDGE_TOPS);
  addLedge(snap8((leftColX + centerX) / 2), snap8(140 + rand() * 60), midTop);
  if (!mirrored || rand() < 0.5) {
    addLedge(snap8((rightColX + centerX) / 2), snap8(140 + rand() * 60), MID_LEDGE_TOPS[mirrored ? 0 : 1]!);
  } else {
    addLedge(snap8(ARENA_W - (leftColX + centerX) / 2), snap8(140 + rand() * 60), midTop);
  }

  // ── Spawns: opposite floor corners first (end-to-end 1v1 open), then fill
  // toward SPAWN_TARGET across floor + perches keeping MIN_SPAWN_DIST.
  const SPAWN_TARGET = 8;
  const spawns: Vec2[] = [
    { x: 160, y: FLOOR_TOP - 68 },
    { x: ARENA_W - 160, y: FLOOR_TOP - 68 },
  ];
  const candidates: Vec2[] = [
    { x: ARENA_W / 2, y: FLOOR_TOP - 68 },
    { x: lowXs[0]!, y: LOW_LEDGE_TOP - 68 },
    { x: lowXs[1]!, y: LOW_LEDGE_TOP - 68 },
    { x: leftColX + colW / 2 + 82, y: leftTop - 68 },
    { x: rightColX - colW / 2 - 82, y: rightTop - 68 },
    { x: centerX, y: cTop - 68 },
  ];
  for (const cand of candidates) {
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
