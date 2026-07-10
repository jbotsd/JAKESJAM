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

// ── Arena AABB — Hot Lobby mega scale (≤16 vessels).
// ALWAYS a full solid floor (recoverable ground). Side walls keep you in.
// Open sky (partial ceiling). Elevated plates are hop-chained from ground.
const ARENA_W = 3000;
const ARENA_H = 1100;
const WALL = 32;
const FLOOR_H = 36;
const PLAT_H = 18; // thin one-way ledge thickness (≤ 24 → pass-through)
/** Standing surface of the always-present ground floor. */
const FLOOR_TOP = ARENA_H - FLOOR_H; // 1064

// ── Movement-derived law constants (docs/map-design.md) ──────────────────
/** Max rise a standard jump may be asked to clear (93% of 139px apex). */
export const MAX_STEP_RISE = 129;
/** Max horizontal gap while RISING to a higher platform. */
export const MAX_GAP_RISING = 180;
/** Max horizontal gap when FALLING/level (full-speed arc). */
export const MAX_GAP_FALLING = 300;
/** Sightline cap on the ground band — cover pylons must break snipes.
 *  ~½ screen at 960p; scales for mega width as mid-range brawls. */
export const MAX_SIGHTLINE = 480;
/** Openness band: structure vs AABB. Full floor + cover sits mid-band. */
export const DENSITY_MIN = 0.06;
export const DENSITY_MAX = 0.28;
/** Minimum spawn separation — open silhouettes pack 16 pads across
 *  islands + tiers; 280 keeps FFA honest without forcing a sealed box. */
export const MIN_SPAWN_DIST = 280;

// ── Wall-movement law constants (docs/character-controller-overhaul.md) ──
/** A `platform` taller than this is SOLID 4-way (grabbable). Mirrors
 *  ONE_WAY_MAX_HEIGHT_PX in collision.ts — the reason columns can be walls. */
export const GRAB_MIN_H = 25;
/** Max gap between two facing grab walls that can still be climbed as a
 *  shaft (wall-jump vx 430 crosses this comfortably). */
export const SHAFT_MAX = 230;
/** Extra reach ABOVE a shaft's climb-top for the final wall-jump hop. The true
 *  wall-jump apex is 720²/(2·1450) ≈ 178.8px (vy -720, rise gravity 1450); we
 *  sit a hair UNDER it so the reachability model never OVER-claims. */
export const WALL_JUMP_UP = 178;
/** Horizontal reach of a wall-jump onto a side ledge. */
export const GRAB_REACH_SIDE = 200;

// ── Jump-arc physics (mirrors player.ts M). The reachability model must not
//    over-approximate: rise and gap trade off along a REAL arc, so a platform
//    near the max rise admits far less horizontal gap than a level hop. Using
//    independent rise/gap budgets was a wrong-PASS risk (agent audit).
const JUMP_V0 = 635; // |jumpVelocity|
const JUMP_GRAV = 1450; // rise-phase gravity
const RUN_SPEED = 330; // maxGroundSpeed
/** Apex height of a plain jump (~139px). */
export const JUMP_APEX = (JUMP_V0 * JUMP_V0) / (2 * JUMP_GRAV);

/** Max horizontal gap a jump can cross while RISING to a platform `rise` px
 *  above: (time to reach that height) × run speed. Solves rise = v0·t − ½g·t²
 *  for the earliest t. Returns -1 when `rise` is above the apex. */
function maxGapForRise(rise: number): number {
  if (rise <= 0) return MAX_GAP_FALLING;
  const disc = JUMP_V0 * JUMP_V0 - 2 * JUMP_GRAV * rise;
  if (disc < 0) return -1; // above apex — unreachable by a plain jump
  const t = (JUMP_V0 - Math.sqrt(disc)) / JUMP_GRAV;
  return RUN_SPEED * t;
}

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

// ── Generation ───────────────────────────────────────────────────────────

/**
 * Generate one recoverable arena:
 *   • ALWAYS a full solid floor (fall → land → climb back)
 *   • side walls contain play; partial ceiling (open sky center)
 *   • cover pylons break floor-band snipes (≤ MAX_SIGHTLINE)
 *   • elevated plates hop-chained from ground (rise ≤ MAX_STEP_RISE)
 */
export function generateCandidate(rand: () => number): MapDefinition {
  const platforms: PlatformDefinition[] = [];
  let idc = 0;
  const nid = (p: string) => `${p}-${idc++}`;

  // Solid grab column from a baseY up to `top`.
  const addColumn = (cx: number, w: number, top: number, baseY = FLOOR_TOP) => {
    const h = Math.max(GRAB_MIN_H + 8, baseY - top);
    platforms.push({
      id: nid("col"),
      kind: "platform",
      position: { x: snap8(cx), y: snap8(top + h / 2) },
      size: { x: w, y: snap8(h) },
    });
  };
  const addLedge = (cx: number, w: number, top: number) => {
    platforms.push({
      id: nid("ledge"),
      kind: "platform",
      position: { x: snap8(cx), y: top + PLAT_H / 2 },
      size: { x: snap8(w), y: PLAT_H },
    });
  };
  // Partial roof plate (not full-width → open sky, no ceiling clamp).
  const addRoofPlate = (cx: number, w: number, top: number) => {
    platforms.push({
      id: nid("roof"),
      kind: "wall",
      position: { x: snap8(cx), y: top + 14 },
      size: { x: snap8(w), y: 28 },
    });
  };

  const colW = snap8(36 + rand() * 12);
  const STEP = 108; // hop rise ≤ MAX_STEP_RISE

  // ── ALWAYS full ground floor + side walls (recoverable, contained) ─
  platforms.push({
    id: "floor",
    kind: "floor",
    position: { x: ARENA_W / 2, y: ARENA_H - FLOOR_H / 2 },
    size: { x: ARENA_W, y: FLOOR_H },
  });
  platforms.push({
    id: "wall-left",
    kind: "wall",
    position: { x: WALL / 2, y: ARENA_H / 2 },
    size: { x: WALL, y: ARENA_H },
  });
  platforms.push({
    id: "wall-right",
    kind: "wall",
    position: { x: ARENA_W - WALL / 2, y: ARENA_H / 2 },
    size: { x: WALL, y: ARENA_H },
  });
  // Partial ceiling shards (open sky center)
  addRoofPlate(snap8(380 + rand() * 80), snap8(600 + rand() * 120), 16);
  addRoofPlate(snap8(ARENA_W - 380 - rand() * 80), snap8(600 + rand() * 120), 16);

  // ── SIGHTLINE COVER on the ground band (~every 420–480px) ─────────
  const coverCount = 5 + Math.floor(rand() * 2);
  const coverSpan = ARENA_W - 2 * WALL - 200;
  for (let i = 0; i < coverCount; i++) {
    const cx = snap8(WALL + 120 + (coverSpan * (i + 0.5)) / coverCount + (rand() - 0.5) * 40);
    const h = snap8(80 + rand() * 50);
    addColumn(cx, snap8(40 + rand() * 20), FLOOR_TOP - h, FLOOR_TOP);
    // Low lip next to some covers
    if (rand() < 0.55) {
      addLedge(snap8(cx + (rand() < 0.5 ? -70 : 70)), snap8(70 + rand() * 30), FLOOR_TOP - 36);
    }
  }

  // ── Elevated plates hop-chained from ground (recoverable) ──────────
  // T1 always present — launch pads across the floor.
  const t1Count = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < t1Count; i++) {
    const cx = snap8(WALL + 200 + ((ARENA_W - 2 * WALL - 400) * (i + 0.5)) / t1Count + (rand() - 0.5) * 60);
    addLedge(cx, snap8(200 + rand() * 100), FLOOR_TOP - STEP);
  }
  // T2 asymmetric — not every column
  const t2Slots = [0.2, 0.5, 0.8].filter(() => rand() < 0.85);
  for (const t of t2Slots) {
    const cx = snap8(WALL + 180 + (ARENA_W - 2 * WALL - 360) * t + (rand() - 0.5) * 80);
    addLedge(cx, snap8(160 + rand() * 90), FLOOR_TOP - 2 * STEP);
  }
  // T3 sparse high
  if (rand() < 0.9) addLedge(snap8(ARENA_W * (0.25 + rand() * 0.15)), snap8(150 + rand() * 60), FLOOR_TOP - 3 * STEP);
  if (rand() < 0.9) addLedge(snap8(ARENA_W * (0.6 + rand() * 0.2)), snap8(150 + rand() * 60), FLOOR_TOP - 3 * STEP);
  // Nest / perch
  addLedge(snap8(ARENA_W * 0.5 + (rand() - 0.5) * 120), snap8(160 + rand() * 50), FLOOR_TOP - 4 * STEP);

  // ONE optional chimney over center T1
  if (rand() < 0.75) {
    const chimMid = snap8(ARENA_W / 2 + (rand() - 0.5) * 100);
    const chimneyGap = snap8(170 + rand() * 35);
    const chimneyTop = FLOOR_TOP - 4 * STEP - 20;
    const half = chimneyGap / 2 + colW / 2;
    addColumn(chimMid - half, colW, chimneyTop, FLOOR_TOP - STEP);
    addColumn(chimMid + half, colW, chimneyTop, FLOOR_TOP - STEP);
    addLedge(chimMid - half - 70, 100, FLOOR_TOP - STEP - 6);
    addLedge(chimMid + half + 70, 100, FLOOR_TOP - STEP - 6);
    addLedge(chimMid, chimneyGap + 28, chimneyTop - 4);
    addLedge(chimMid - half - 70, 95, FLOOR_TOP - 2.5 * STEP);
  }

  // A few side floaters, always within hop of a T1/T2 plate
  for (let f = 0; f < 3 + Math.floor(rand() * 3); f++) {
    const side = rand() < 0.5 ? 1 : -1;
    const cx = snap8(ARENA_W / 2 + side * (400 + rand() * 900));
    const tier = 1 + Math.floor(rand() * 2);
    addLedge(cx, snap8(100 + rand() * 50), FLOOR_TOP - tier * STEP - snap8(rand() * 30));
  }

  // ── Spawns: ground lattice first (recoverable), then elevated tops ─
  const SPAWN_TARGET = 16;
  const solidCols = platforms
    .filter((p) => p.id.startsWith("col") || (p.kind === "platform" && p.size.y >= GRAB_MIN_H))
    .map((p) => ({
      x0: p.position.x - p.size.x / 2 - 10,
      x1: p.position.x + p.size.x / 2 + 10,
      top: p.position.y - p.size.y / 2,
    }));
  const clearOfCols = (x: number, y: number) =>
    solidCols.every((c) => !(x > c.x0 && x < c.x1 && y > c.top));

  type Pad = Vec2 & { pri: number };
  const ordered: Pad[] = [];
  // Ground lattice across the full floor — always landable/recoverable.
  for (let x = WALL + 80; x <= ARENA_W - WALL - 80; x += 300) {
    const y = FLOOR_TOP - 68;
    if (clearOfCols(x, y)) ordered.push({ x: snap8(x), y: snap8(y), pri: 0 });
  }
  for (const p of platforms) {
    if (p.kind !== "platform") continue;
    if (p.size.y >= GRAB_MIN_H) continue; // solid columns
    if (p.id.startsWith("roof")) continue;
    const top = p.position.y - p.size.y / 2;
    const x0 = p.position.x - p.size.x / 2 + 28;
    const x1 = p.position.x + p.size.x / 2 - 28;
    if (x1 <= x0) continue;
    const xs =
      p.size.x > 180
        ? [x0 + 16, (x0 + x1) / 2, x1 - 16]
        : [(x0 + x1) / 2];
    const pri = top < FLOOR_TOP - 2 * STEP ? 1 : 2;
    for (const x of xs) {
      const y = top - 68;
      if (clearOfCols(x, y)) ordered.push({ x: snap8(x), y: snap8(y), pri });
    }
  }
  // Ground first, then high, then mid — left→right within band.
  ordered.sort((a, b) => a.pri - b.pri || a.y - b.y || a.x - b.x);

  const spawns: Vec2[] = [];
  for (const cand of ordered) {
    if (spawns.length >= SPAWN_TARGET) break;
    if (spawns.every((sp) => Math.hypot(sp.x - cand.x, sp.y - cand.y) >= MIN_SPAWN_DIST)) {
      spawns.push({ x: cand.x, y: cand.y });
    }
  }

  const themes = ["voidVessel", "crystalDock", "autogenesHull"] as const;
  return {
    id: "gen",
    name: "Generated Dock",
    arenaTheme: themes[Math.floor(rand() * themes.length)]!,
    size: { x: ARENA_W, y: ARENA_H },
    spawns,
    platforms,
  };
}

// ── Validation (the laws) ────────────────────────────────────────────────

type Top = { x0: number; x1: number; top: number; id: string; kind: string };
type Solid = { x0: number; x1: number; top: number; cx: number };

/** True for full-width legacy floor or segmented open-silhouette decks. */
function isFloorId(id: string): boolean {
  return id === "floor" || id.startsWith("floor-");
}

/** Platform TOPS you can stand on: floors + ledges + short cover pads.
 *  Tall tunnel/chimney walls (h ≥ 120 or vt-/col-/tun- ids) are climb
 *  substrate only — not required stand targets. */
function tops(map: MapDefinition): Top[] {
  return map.platforms
    .filter((p) => {
      if (p.id.startsWith("roof") || p.id === "ceiling") return false;
      if (p.id.startsWith("col") || p.id.startsWith("vt-") || p.id.startsWith("tun-"))
        return false;
      if (p.kind === "floor" || isFloorId(p.id)) return true;
      if (p.kind !== "platform") return false;
      // One-way ledges always; short cover pillars (boxworks-mini) yes;
      // full-height chimney walls no.
      return p.size.y < 120;
    })
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      x0: p.position.x - p.size.x / 2,
      x1: p.position.x + p.size.x / 2,
      top: p.position.y - p.size.y / 2,
    }));
}

/** Deck tops (ground seeds for reachability BFS). */
function floorTops(map: MapDefinition): Top[] {
  return tops(map).filter((t) => t.kind === "floor" || isFloorId(t.id));
}

/** SOLID grab walls: flank stubs + tall columns (wall-jump substrate).
 *  Lateral duct ceilings (thin horizontal wall plates) are NOT grab walls. */
function grabWalls(map: MapDefinition): Solid[] {
  const out: Solid[] = [];
  for (const p of map.platforms) {
    if (isFloorId(p.id) || p.id === "ceiling" || p.id.startsWith("roof")) continue;
    // Duct ceilings: kind wall, short height, wide — exclude from shaft/embed.
    if (p.id.startsWith("lceil") || p.id.includes("-ceil") || p.id.startsWith("lt-")) {
      if (p.kind === "wall" && p.size.y <= 40) continue;
    }
    if (p.kind === "wall" && p.size.y <= 40 && p.size.x > 80) continue; // any thin wide ceil
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
        if (isFloorId(t.id)) continue;
        const cx = (t.x0 + t.x1) / 2;
        // Open maps: allow shaft reach to any ledge above the climb, not only
        // a fixed FLOOR_TOP constant from the generator's default deck.
        // Ledges from hop-top down to just below the shorter wall's top.
        if (cx >= xLo && cx <= xHi && t.top >= reachTop && t.top <= yClimb + 24) {
          reached.add(t.id);
        }
      }
    }
  }
  return reached;
}

/**
 * Route-graph reachability: seed with ALL floor islands + shaft-reachable
 * tops, then BFS over jump-sized edges. Open silhouettes have many decks.
 */
export function unreachablePlatforms(map: MapDefinition): string[] {
  const ts = tops(map);
  const decks = floorTops(map);
  if (decks.length === 0) return ["<no-floor>"];
  const reached = shaftReachable(ts, grabWalls(map));
  for (const d of decks) reached.add(d.id);
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
            ? rise <= MAX_STEP_RISE && gap <= maxGapForRise(rise)
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

/** Distinct routes UP from any deck: plain jump onto a ledge, OR a shaft. */
function routesUp(map: MapDefinition): number {
  const ts = tops(map);
  const decks = floorTops(map);
  if (decks.length === 0) return 0;
  const jumpRoutes = ts.filter((t) => {
    if (isFloorId(t.id)) return false;
    return decks.some((floor) => {
      const rise = floor.top - t.top;
      return rise > 0 && rise <= MAX_STEP_RISE;
    });
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

/** Longest unbroken sightline across floor islands at shoulder height.
 *  Void fissures between islands break sightlines naturally. */
function worstSightline(map: MapDefinition): number {
  const decks = floorTops(map);
  if (decks.length === 0) return map.size.x;
  // Per-island band: measure open runs on each deck, take global max.
  let worst = 0;
  for (const deck of decks) {
    const bandY = deck.top - 28;
    const blockers = map.platforms
      .filter((p) => p.kind === "platform" || (p.kind === "wall" && !isFloorId(p.id)))
      .filter((p) => {
        const y0 = p.position.y - p.size.y / 2;
        const y1 = p.position.y + p.size.y / 2;
        return bandY >= y0 && bandY <= y1;
      })
      .map((p) => ({ x0: p.position.x - p.size.x / 2, x1: p.position.x + p.size.x / 2 }))
      .filter((b) => b.x1 > deck.x0 && b.x0 < deck.x1)
      .sort((a, b) => a.x0 - b.x0);
    let cursor = deck.x0;
    for (const b of blockers) {
      worst = Math.max(worst, Math.min(b.x0, deck.x1) - cursor);
      cursor = Math.max(cursor, b.x1);
    }
    worst = Math.max(worst, deck.x1 - cursor);
  }
  return worst;
}

function density(map: MapDefinition): number {
  // Structure = platforms + floor islands (open maps have less wall mass).
  const area = map.platforms
    .filter((p) => p.kind === "platform" || p.kind === "floor")
    .reduce((a, p) => a + p.size.x * p.size.y, 0);
  // Denominator = AABB playable region (void is intentional open space).
  const playable = Math.max(1, map.size.x * map.size.y * 0.55);
  return area / playable;
}

/** Half the player body (26w × 56h) + a small margin — a spawn this close to a
 *  solid column embeds the body and the resolver ejects it out of the map. */
const SPAWN_HALF_W = 13 + 6;
const SPAWN_HALF_H = 28 + 6;

function spawnsValid(map: MapDefinition): boolean {
  const ts = tops(map);
  const solids = grabWalls(map).filter((w) => {
    // Tall grab COLUMNS only; flank stubs at x≈0 / x≈map.w are not embed risks.
    return w.cx > 80 && w.cx < map.size.x - 80;
  });
  // Lowest deck top (largest y) — used only as an upper bound for embed checks.
  const decks = floorTops(map);
  const lowestDeckTop =
    decks.length > 0 ? Math.max(...decks.map((d) => d.top)) : map.size.y;
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i]!;
    // Standing pad: platform top within 40..120px below spawn y (y-down).
    const under = ts.some(
      (t) => s.x >= t.x0 - 8 && s.x <= t.x1 + 8 && t.top > s.y && t.top - s.y < 120,
    );
    if (!under) return false;
    // No spawn embedded in a solid column.
    for (const c of solids) {
      const overlapsX = s.x + SPAWN_HALF_W > c.x0 && s.x - SPAWN_HALF_W < c.x1;
      const overlapsY = s.y > c.top && s.y - 2 * SPAWN_HALF_H < lowestDeckTop + 40;
      if (overlapsX && overlapsY) return false;
    }
    for (let j = i + 1; j < map.spawns.length; j++) {
      const o = map.spawns[j]!;
      if (Math.hypot(s.x - o.x, s.y - o.y) < MIN_SPAWN_DIST) return false;
    }
  }
  // Mega Hot Lobby law: ≥12 well-separated pads (16 target; 12 still FFA-honest).
  const minSpawns = map.size.x >= 2000 ? 12 : 4;
  return map.spawns.length >= minSpawns;
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
  let lastFail: MapValidation | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rand = mulberry32((seed ^ (attempt * 0x9e3779b9)) >>> 0);
    const candidate = generateCandidate(rand);
    const v = validateMap(candidate);
    if (v.ok) {
      return { ...candidate, id: `${GEN_MAP_PREFIX}${seed}`, name: `Dock #${seed}` };
    }
    lastFail = v;
  }
  // Surface last failure in the throw path below via void ref (debug aid).
  void lastFail;
  // Statistically unreachable (every real seed validates well within
  // MAX_ATTEMPTS). But NEVER ship an UNVALIDATED map — a future constant change
  // could make the old hardcoded fallback invalid and silently ship a broken
  // arena. Scan fixed fallback seeds and return the first that VALIDATES; the
  // scan is deterministic so (seed → map) stays pure.
  for (let f = 0; f < 256; f++) {
    const cand = generateCandidate(mulberry32((0xfa11bacc + f * 0x9e3779b9) >>> 0));
    if (validateMap(cand).ok) {
      return { ...cand, id: `${GEN_MAP_PREFIX}${seed}`, name: `Dock #${seed}` };
    }
  }
  // Truly unreachable — if even 256 fallback seeds fail, the laws are
  // self-contradictory (a build bug). Surface it loudly rather than ship junk.
  throw new Error("mapGen: no valid arena found — validator laws are unsatisfiable");
}

export function isGenMapId(id: string | undefined): boolean {
  return !!id && id.startsWith(GEN_MAP_PREFIX);
}

export function parseGenSeed(id: string): number | null {
  if (!isGenMapId(id)) return null;
  const n = Number(id.slice(GEN_MAP_PREFIX.length));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
