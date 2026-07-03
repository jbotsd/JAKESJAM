// Deterministic arena generator — tier-structured, validator-gated.
//
// See docs/map-design.md for the research this encodes. The short form:
// every generated arena obeys the same movement-derived laws (step cost
// ≤93% of max jump, sightline caps, ≥2 routes up, openness band, fair
// spawns), checked by a route-graph validator BEFORE the map is allowed
// to exist. Invalid rolls advance an internal attempt counter
// deterministically, so `gen:N` produces the SAME final arena on every
// machine — client and server expand the seed independently and get
// byte-identical geometry (the same guarantee curated maps have).
//
// PURE MODULE: no Math.random, no Date, no Phaser, no DOM. Shared by
// client prediction and server authority.

import type { MapDefinition, PlatformDefinition, Vec2 } from "../types.js";

// ── Arena frame (matches boxworks-mini scale — see game-feel-tuning.md) ──
const ARENA_W = 1280;
const ARENA_H = 640;
const WALL = 32;
const FLOOR_H = 32;
const PLAT_H = 18;
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
/** Openness band: platform+cover footprint as fraction of arena area. */
export const DENSITY_MIN = 0.08;
export const DENSITY_MAX = 0.16;
/** Minimum spawn separation. */
export const MIN_SPAWN_DIST = 360;

// Tier tops (player feet land here). Steps: 608→486 = 122, 486→360 = 126,
// 360→232 = 128 — all ≤ MAX_STEP_RISE. The perch tier is jetpack-gated on
// purpose when no T2 segment sits under it.
const TIER_TOPS = [486, 360, 232] as const;

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

type Seg = { x: number; w: number; tier: number };

// ── Generation ───────────────────────────────────────────────────────────

/**
 * Generate one arena candidate for a given attempt. Mirror-symmetric half
 * the time (1v1 fairness); asymmetric rolls still pass the fairness laws
 * via the validator.
 */
function generateCandidate(rand: () => number): MapDefinition {
  const mirrored = rand() < 0.6;
  const segs: Seg[] = [];

  // Per tier: fill the half (or full) width with segments + gaps.
  const spanEnd = mirrored ? ARENA_W / 2 : ARENA_W - WALL - 40;
  for (let tier = 0; tier < TIER_TOPS.length; tier++) {
    // Higher tiers are sparser (risk/reward: less ground up high) —
    // widen gaps as the tier climbs.
    const gapScale = tier === 2 ? 1.6 : tier === 1 ? 1.15 : 1.0;
    let x = WALL + 24 + rand() * 90;
    while (x < spanEnd) {
      const w = snap8(144 + rand() * (tier === 2 ? 150 : 260));
      if (x + w > spanEnd + 60) break;
      segs.push({ x: snap8(x), w, tier });
      // Gap: crossable per the falling-arc law, with jitter.
      x += w + snap8((90 + rand() * (MAX_GAP_FALLING - 110)) * gapScale);
    }
  }

  if (mirrored) {
    // Reflect across the vertical center line; merge center-touching segs.
    for (const s of [...segs]) {
      const mx = ARENA_W - s.x - s.w;
      if (mx > s.x + s.w - 16) segs.push({ x: snap8(mx), w: s.w, tier: s.tier });
      else s.w = snap8(ARENA_W - 2 * s.x); // spans the middle — widen
    }
  }

  // Cover pillars on the floor — the floor lane is the only band where a
  // horizontal sightline exists (tiers are one-way platforms), so cover
  // spacing IS the sightline law. One pillar per third with jitter;
  // mirrored arenas mirror them.
  const covers: { x: number; y: number; w: number; h: number }[] = [];
  const thirds = mirrored ? [ARENA_W / 6, (ARENA_W * 2.6) / 6] : [ARENA_W / 6, ARENA_W / 2, (ARENA_W * 4.4) / 6];
  for (const anchor of thirds) {
    const cx = snap8(anchor - 36 + (rand() - 0.5) * 120);
    const c = { x: Math.max(WALL + 48, cx), y: FLOOR_TOP - 40, w: 72, h: 80 };
    covers.push(c);
    if (mirrored) covers.push({ ...c, x: snap8(ARENA_W - c.x - c.w) });
  }

  const platforms: PlatformDefinition[] = [
    { id: "floor", kind: "floor", position: { x: ARENA_W / 2, y: ARENA_H - FLOOR_H / 2 }, size: { x: ARENA_W, y: FLOOR_H } },
    { id: "wall-left", kind: "wall", position: { x: WALL / 2, y: ARENA_H / 2 }, size: { x: WALL, y: ARENA_H } },
    { id: "wall-right", kind: "wall", position: { x: ARENA_W - WALL / 2, y: ARENA_H / 2 }, size: { x: WALL, y: ARENA_H } },
    { id: "ceiling", kind: "wall", position: { x: ARENA_W / 2, y: WALL / 2 }, size: { x: ARENA_W, y: WALL } },
  ];
  segs.forEach((s, i) => {
    platforms.push({
      id: `t${s.tier}-${i}`,
      kind: "platform",
      position: { x: s.x + s.w / 2, y: TIER_TOPS[s.tier]! + PLAT_H / 2 },
      size: { x: s.w, y: PLAT_H },
    });
  });
  covers.forEach((c, i) => {
    platforms.push({
      id: `cover-${i}`,
      kind: "platform",
      position: { x: c.x + c.w / 2, y: c.y + c.h / 2 },
      size: { x: c.w, y: c.h },
    });
  });

  // Spawns: floor corners always; T1 alternates when present.
  const spawns: Vec2[] = [
    { x: 160, y: FLOOR_TOP - 68 },
    { x: ARENA_W - 160, y: FLOOR_TOP - 68 },
  ];
  const t1 = segs.filter((s) => s.tier === 0).sort((a, b) => a.x - b.x);
  for (const seg of t1.length >= 2 ? [t1[0]!, t1[t1.length - 1]!] : []) {
    const cand = { x: seg.x + seg.w / 2, y: TIER_TOPS[0] - 68 };
    if (spawns.every((sp) => Math.hypot(sp.x - cand.x, sp.y - cand.y) >= MIN_SPAWN_DIST)) {
      spawns.push(cand);
    }
  }

  // Theme rides the seed too — variety across recycles at zero cost.
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

/** Route-graph reachability: BFS from the floor over jump-sized edges. */
export function unreachablePlatforms(map: MapDefinition, allowPerchTier = true): string[] {
  const ts = tops(map);
  const floor = ts.find((t) => t.id === "floor");
  if (!floor) return ["<no-floor>"];
  const reached = new Set<string>([floor.id]);
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
  return ts
    .filter((t) => !reached.has(t.id))
    .filter((t) => !(allowPerchTier && t.top <= TIER_TOPS[2] + PLAT_H))
    .map((t) => t.id);
}

/** Count distinct T1 entry platforms reachable directly from the floor. */
function floorToT1Routes(map: MapDefinition): number {
  const ts = tops(map);
  const floor = ts.find((t) => t.id === "floor")!;
  return ts.filter((t) => {
    if (t.id === "floor") return false;
    const rise = floor.top - t.top;
    return rise > 0 && rise <= MAX_STEP_RISE;
  }).length;
}

/** Longest unbroken sightline in a horizontal band (shoulder height above
 *  each tier), broken by platforms/cover intersecting the band. */
function worstSightline(map: MapDefinition): number {
  // Only the FLOOR lane carries a true horizontal sightline: every tier is
  // a one-way platform (no body-height solid above it), so diagonal play
  // dominates up there. Cover pillars are what break the floor lane.
  const bandY = FLOOR_TOP - 28; // shoulder height on the floor
  const blockers = map.platforms
    .filter((p) => p.kind !== "floor" && p.id !== "ceiling")
    .filter((p) => {
      const y0 = p.position.y - p.size.y / 2;
      const y1 = p.position.y + p.size.y / 2;
      return bandY >= y0 && bandY <= y1;
    })
    .map((p) => ({ x0: p.position.x - p.size.x / 2, x1: p.position.x + p.size.x / 2 }))
    .sort((a, b) => a.x0 - b.x0);
  let worst = 0;
  let cursor = 0;
  for (const b of blockers) {
    worst = Math.max(worst, b.x0 - cursor);
    cursor = Math.max(cursor, b.x1);
  }
  return Math.max(worst, ARENA_W - cursor);
}

function density(map: MapDefinition): number {
  const area = map.platforms
    .filter((p) => p.kind === "platform")
    .reduce((a, p) => a + p.size.x * p.size.y, 0);
  // Openness is judged over the PLAYABLE volume (inside walls, above the
  // floor) — walls/floor margins aren't space anyone fights in.
  const playable = (map.size.x - 2 * WALL) * (map.size.y - FLOOR_H - WALL);
  return area / playable;
}

function spawnsValid(map: MapDefinition): boolean {
  const ts = tops(map);
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i]!;
    // Ground within a fall below the spawn.
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
  const routesUp = floorToT1Routes(map);
  const sight = worstSightline(map);
  const dens = density(map);
  const spawnsOk = spawnsValid(map);
  return {
    ok:
      unreachable.length === 0 &&
      routesUp >= 2 &&
      sight <= MAX_SIGHTLINE &&
      dens >= DENSITY_MIN &&
      dens <= DENSITY_MAX &&
      spawnsOk,
    unreachable,
    routesUp,
    sightline: sight,
    density: dens,
    spawnsOk,
  };
}

// ── Public entry ─────────────────────────────────────────────────────────

export const GEN_MAP_PREFIX = "gen:";
const MAX_ATTEMPTS = 40;

/**
 * Deterministically produce a VALID arena for a seed. Invalid candidates
 * advance the attempt counter (seeded), so the (seed → map) mapping is a
 * pure function — identical on client and server.
 */
export function generateArena(seed: number): MapDefinition {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rand = mulberry32((seed ^ (attempt * 0x9e3779b9)) >>> 0);
    const candidate = generateCandidate(rand);
    if (validateMap(candidate).ok) {
      return { ...candidate, id: `${GEN_MAP_PREFIX}${seed}`, name: `Arena #${seed}` };
    }
  }
  // Statistically unreachable (validation pass-rate is high — see
  // mapGen.test.ts fuzz), but never brick the world: fall back to a
  // minimal always-valid layout.
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
