// Skyseam — Hot Lobby mega-dock (≤16). Vessel Nexus's successor: the map's
// PRIMARY IDENTITY is diagonals + sky (docs/map-design.md "Diagonals & sky",
// 2026-07-16 — Jake: "more diagonals, lots of stuff in the sky to jump into,
// large ramps").
//
// Two seam-ramps — long diagonal ascent chains of small one-way steps —
// cross the arena in a big X: seam A climbs bottom-left → top-right, seam B
// climbs bottom-right → top-left, and they share ONE contested junction deck
// at T5 dead center. Each step rises exactly one STEP (≤129 law); each
// terrace landing is a level link (≤300px falling-gap law). Kinetically each
// seam is one continuous ascent line; tactically it's a risk gradient (full
// cover from below, full exposure from above).
//
// Above the seams, the upper third is a SKY ARCHIPELAGO: islands alternating
// T7/T8, chained inside the gap laws so the whole width is traversable
// without touching down. The sky is for everyone — every island is plain-
// jump-reachable (no jetpack/perch exemptions anywhere; validateMap must
// report zero unreachable). Sky stakes are REAL: the map-authored pickups
// (this is the pickup mechanism — World.create consumes map.pickups; nothing
// spawns pickups at runtime) sit predominantly in the sky band — overcharge
// crown on the center island, amps/shields across the chain — plus the sky
// line owes nothing to cover, so holding it is sightline dominance.
//
// Floor law: there is ALWAYS a full solid floor. Fall off a seam → land on
// ground → climb back. No soft-kill pits.
// Sightline law: floor-band pylons + lips every ~420–480px (≤480 open).
// Three pylons double as flush pedestals under seam bases / the core pad.
// Theme: crystalDock (voidVessel family).

import type { MapDefinition, PlatformDefinition } from "../types.js";

// True slopes replaced the seam-base launch pads 2026-07-17 (Jake: "true
// slops like we have no diagnal set peices yet and i want them"). The pads
// were explicitly the interim "80% of ramp feel with no collision-shape
// change" (docs/map-design.md item 3); the real thing supersedes them at
// the two seam bases. Launch pads remain a live mechanism elsewhere
// (mapGen emits them at generated diagonal-chain bases).

const W = 3000;
const H = 1100;
const FLOOR_H = 36;
const PLAT_H = 18;
const WALL = 32;
/** Standing surface of the always-present ground floor. */
const GROUND = H - FLOOR_H; // 1064
/** Comfortable hop rise toward max jump (139). */
const STEP = 108;
/** Tier tops: T1..T8 = 956, 848, 740, 632, 524, 416, 308, 200. */
const T = (k: number) => GROUND - k * STEP;

const cy = (top: number, h = PLAT_H) => top + h / 2;

export const skyseam: MapDefinition = {
  id: "skyseam",
  name: "Skyseam",
  arenaTheme: "crystalDock",
  size: { x: W, y: H },
  spawns: [],
  platforms: [
    // ════════════════════════════════════════════════════════════════
    // ALWAYS-ON FLOOR + FRAME (recoverable ground)
    // ════════════════════════════════════════════════════════════════
    floor("floor", W / 2, W, GROUND),
    {
      id: "wall-left",
      kind: "wall",
      position: { x: WALL / 2, y: H / 2 },
      size: { x: WALL, y: H },
    },
    {
      id: "wall-right",
      kind: "wall",
      position: { x: W - WALL / 2, y: H / 2 },
      size: { x: WALL, y: H },
    },
    // Partial ceiling only (open sky in the middle — no full box lid)
    {
      id: "ceil-L",
      kind: "wall",
      position: { x: 400, y: WALL / 2 },
      size: { x: 700, y: WALL },
    },
    {
      id: "ceil-R",
      kind: "wall",
      position: { x: W - 400, y: WALL / 2 },
      size: { x: 700, y: WALL },
    },

    // ════════════════════════════════════════════════════════════════
    // SIGHTLINE COVER — floor-band pylons (break snipes ≤480)
    // cover-a/-e (h=90, tops 974) sit FLUSH under the seam base steps
    // (956..974) as pedestals; cover-c likewise under the core pad.
    // Worst open floor run: wall→cover-a = 344px.
    // ════════════════════════════════════════════════════════════════
    col("cover-a", 400, 48, GROUND - 90, GROUND), // pedestal: seam-a-t1
    col("cover-b", 940, 52, GROUND - 110, GROUND),
    col("cover-c", 1500, 56, GROUND - 90, GROUND), // pedestal: core-t1
    col("cover-d", 2060, 52, GROUND - 110, GROUND),
    col("cover-e", 2600, 48, GROUND - 90, GROUND), // pedestal: seam-b-t1
    // Low crouch barriers (short, break anklesight without sealing)
    ledge("lip-a", 700, 80, GROUND - 36),
    ledge("lip-b", 1220, 90, GROUND - 40),
    ledge("lip-c", 1780, 90, GROUND - 40),
    ledge("lip-d", 2300, 80, GROUND - 36),

    // ════════════════════════════════════════════════════════════════
    // SEAM A — diagonal ascent chain, bottom-left → top-right.
    // Steps: rise = STEP (108), edge gaps 40–60 (≤76 rising-arc law for
    // a 108 rise). Landings: level links, edge gap 75 (≤300 falling law).
    // Reads as one large terraced ramp: ╱ ╱ ╱ — ╱ ╳ ╱ — ╱ —
    // ════════════════════════════════════════════════════════════════
    ledge("seam-a-t1", 400, 150, T(1)),
    ledge("seam-a-t2", 600, 150, T(2)),
    ledge("seam-a-t3", 800, 150, T(3)),
    ledge("seam-a-land3", 1090, 280, T(3)), // terrace
    ledge("seam-a-t4", 1365, 150, T(4)),
    // (T5 = shared cross-junction below)
    ledge("seam-a-t6", 1765, 150, T(6)),
    ledge("seam-a-land6", 2055, 280, T(6)), // terrace
    ledge("seam-a-t7", 2330, 150, T(7)),
    ledge("seam-a-crest", 2600, 240, T(7)), // crest → sky-far-r

    // ════════════════════════════════════════════════════════════════
    // SEAM B — mirror diagonal, bottom-right → top-left.
    // ════════════════════════════════════════════════════════════════
    ledge("seam-b-t1", 2600, 150, T(1)),
    ledge("seam-b-t2", 2400, 150, T(2)),
    ledge("seam-b-t3", 2200, 150, T(3)),
    ledge("seam-b-land3", 1910, 280, T(3)), // terrace
    ledge("seam-b-t4", 1635, 150, T(4)),
    // (T5 = shared cross-junction below)
    ledge("seam-b-t6", 1235, 150, T(6)),
    ledge("seam-b-land6", 945, 280, T(6)), // terrace
    ledge("seam-b-t7", 670, 150, T(7)),
    ledge("seam-b-crest", 400, 240, T(7)), // crest → sky-far-l

    // ════════════════════════════════════════════════════════════════
    // THE CROSSING — both seams pass through ONE shared junction deck
    // at T5 dead center. The X literally intersects here: the most
    // contested tile on the map (both ascent lines, no cover).
    // ════════════════════════════════════════════════════════════════
    ledge("cross-junction", 1500, 300, T(5)),

    // ════════════════════════════════════════════════════════════════
    // SKY ARCHIPELAGO — the upper third IS the point. Islands alternate
    // T7/T8 so the whole width routes without touching down:
    // rising T7→T8 hops keep edge gaps ≤70 (≤76 law); the T8→T7 drops
    // are falling links (≤300). Entry from either seam crest (gap-0
    // step-ups at both ends) or up the T7 line mid-map. No perches —
    // every island is jump-chained, the sky is for everyone.
    // ════════════════════════════════════════════════════════════════
    ledge("sky-far-l", 210, 140, T(8)), // ← seam-b-crest, rise 108 gap 0
    ledge("sky-l1", 640, 140, T(8)), //   ← seam-b-crest, rise 108 gap 50
    ledge("sky-l2", 900, 140, T(7)), //   drop from sky-l1 / level from seam-b-t7
    ledge("sky-l3", 1110, 140, T(8)), //  rise from sky-l2, gap 70
    ledge("sky-l4", 1370, 140, T(7)), //  drop, gap 120
    ledge("sky-crown", 1590, 160, T(8)), // center island — overcharge crown
    ledge("sky-r4", 1850, 140, T(7)), //  drop from crown, gap 110
    ledge("sky-r3", 2060, 140, T(8)), //  rise from sky-r4, gap 70
    ledge("sky-far-r", 2790, 140, T(8)), // ← seam-a-crest, rise 108 gap 0

    // ════════════════════════════════════════════════════════════════
    // CORE STACK — short center tower under the junction (mid-map
    // vertical option + spawn real estate). cover-c is its pedestal.
    // ════════════════════════════════════════════════════════════════
    ledge("core-t1", 1500, 220, T(1)),
    ledge("core-t2", 1500, 200, T(2)),
  ],

  // Sky stakes (map-design.md: "sky needs stakes or it's dead weight").
  // Pickups are MAP-AUTHORED here (World.create reads map.pickups; there is
  // no runtime pickup spawner) — and they're deliberately sky-heavy: 5 in
  // the T8 sky band, 2 on the T7 crests, only 2 baseline shards on the
  // floor. Owning the archipelago = owning the economy.
  pickups: [
    { id: "pk-crown", kind: "overcharge-core", position: { x: 1590, y: 172 }, radius: 16, amount: 1, respawnMs: 30000, durationMs: 8000 },
    { id: "pk-sky-amp", kind: "damage-amp", position: { x: 1110, y: 172 }, radius: 16, amount: 1, respawnMs: 25000, durationMs: 8000 },
    { id: "pk-sky-speed", kind: "speed-boost", position: { x: 2060, y: 172 }, radius: 16, amount: 1, respawnMs: 25000, durationMs: 8000 },
    { id: "pk-sky-shield-l", kind: "shield-cell", position: { x: 210, y: 172 }, radius: 16, amount: 50, respawnMs: 20000 },
    { id: "pk-sky-shield-r", kind: "shield-cell", position: { x: 2790, y: 172 }, radius: 16, amount: 50, respawnMs: 20000 },
    { id: "pk-crest-l", kind: "health-shard", position: { x: 400, y: 280 }, radius: 16, amount: 35, respawnMs: 18000 },
    { id: "pk-crest-r", kind: "health-shard", position: { x: 2600, y: 280 }, radius: 16, amount: 35, respawnMs: 18000 },
    { id: "pk-floor-l", kind: "health-shard", position: { x: 750, y: GROUND - 28 }, radius: 16, amount: 25, respawnMs: 20000 },
    { id: "pk-floor-r", kind: "health-shard", position: { x: 2250, y: GROUND - 28 }, radius: 16, amount: 25, respawnMs: 20000 },
  ],

  // TRUE SLOPES (map-design.md "Diagonals & sky" — the deferred piece,
  // shipped 2026-07-17). Foot-point one-way grounding + magnitude-
  // preserving tangent projection (player.ts / player.zig): run at a ramp
  // and the run speed CONVERTS to climb — the real "hitting a ramp at
  // speed", replacing the two seam-base launch pads that proxied it.
  //
  //   ramp-seam-a: 2:1, run 216 / rise 108, base (109, 1064) ascending
  //     right — crests EXACTLY flush with seam-a-t1's top-left corner
  //     (325, 956): sprint from the left wall straight onto the seam
  //     chain at full stride (~324 vx / −162 vy of free crest launch).
  //   ramp-seam-b: the mirror (dir −1), base (2891, 1064), crests flush
  //     with seam-b-t1's top-right corner (2675, 956).
  //   ramp-junction: the 45° SET PIECE — one full-tier assault ramp from
  //     seam-a-land3's terrace lip (1230, 740 = T3) straight up to the
  //     cross-junction deck (1446, 524 = T5), rise 216 in run 216. Two
  //     tiers in one committed run at the most contested deck on the map;
  //     45° costs real speed-to-climb conversion (tangent 1/√2), so the
  //     junction rush is readable and interceptable. It deliberately
  //     crosses over seam-a-t4's one-way ledge (their surfaces meet at
  //     x = 1338) — rect-vs-slope "whichever grounds higher" handles the
  //     overlap, giving a mid-ramp bail-out onto t4.
  slopes: [
    { id: "ramp-seam-a", base: { x: 109, y: GROUND }, run: 216, grade: "2:1", dir: 1 },
    { id: "ramp-seam-b", base: { x: 2891, y: GROUND }, run: 216, grade: "2:1", dir: -1 },
    { id: "ramp-junction", base: { x: 1230, y: T(3) }, run: 216, grade: "1:1", dir: 1 },
  ],
};

// Spawns: ground lattice first (always recoverable), then elevated pads —
// the sky band fills next by design (its islands are the highest tops), so
// the pad split lands ~9 ground / ~7 seam-and-sky.
// Hard floor MIN_SPAWN_DIST = 280 — never loosen below the validator.
{
  const MIN = 280;
  const cols = skyseam.platforms.filter(
    (p) => p.kind === "platform" && p.size.y >= 25,
  );
  const clear = (x: number, y: number) =>
    cols.every((c) => {
      const x0 = c.position.x - c.size.x / 2 - 10;
      const x1 = c.position.x + c.size.x / 2 + 10;
      const top = c.position.y - c.size.y / 2;
      return !(x > x0 && x < x1 && y > top);
    });

  const pads: { x: number; y: number; pri: number }[] = [];
  // Ground band: explicit lattice across the full floor (recoverable spawns).
  for (let x = WALL + 80; x <= W - WALL - 80; x += 300) {
    pads.push({ x: Math.round(x), y: Math.round(GROUND - 68), pri: 0 });
  }
  // Elevated standable tops (skip solid columns).
  for (const p of skyseam.platforms) {
    if (p.kind !== "platform") continue;
    if (p.size.y >= 25) continue;
    const top = p.position.y - p.size.y / 2;
    const x0 = p.position.x - p.size.x / 2 + 28;
    const x1 = p.position.x + p.size.x / 2 - 28;
    if (x1 <= x0) continue;
    const xs =
      p.size.x > 220
        ? [x0 + 16, (x0 + x1) / 2, x1 - 16]
        : [(x0 + x1) / 2];
    // Prefer mid/high for vertical spread after ground fills.
    const pri = top < GROUND - 2 * STEP ? 1 : 2;
    for (const x of xs) {
      pads.push({ x: Math.round(x), y: Math.round(top - 68), pri });
    }
  }
  pads.sort((a, b) => a.pri - b.pri || a.y - b.y || a.x - b.x);

  const picked: { x: number; y: number }[] = [];
  for (const cand of pads) {
    if (picked.length >= 16) break;
    if (!clear(cand.x, cand.y)) continue;
    if (picked.every((s) => Math.hypot(s.x - cand.x, s.y - cand.y) >= MIN)) {
      picked.push({ x: cand.x, y: cand.y });
    }
  }
  skyseam.spawns = picked;
}

function floor(
  id: string,
  cx: number,
  w: number,
  top: number,
): PlatformDefinition {
  return {
    id,
    kind: "floor",
    position: { x: cx, y: top + FLOOR_H / 2 },
    size: { x: w, y: FLOOR_H },
  };
}

function col(
  id: string,
  cx: number,
  w: number,
  top: number,
  baseY: number,
): PlatformDefinition {
  const h = Math.max(40, baseY - top);
  return {
    id,
    kind: "platform",
    position: { x: cx, y: top + h / 2 },
    size: { x: w, y: h },
  };
}

function ledge(
  id: string,
  cx: number,
  w: number,
  top: number,
): PlatformDefinition {
  return {
    id,
    kind: "platform",
    position: { x: cx, y: cy(top) },
    size: { x: w, y: PLAT_H },
  };
}
