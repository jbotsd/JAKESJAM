// Vessel Nexus — Hot Lobby mega-dock (≤16).
//
// Floor law: there is ALWAYS a full solid floor. Fall off a high plate →
// land on ground → climb back. No soft-kill pits between “islands.”
//
// Sightline law: cover pylons break floor-band snipes (~≤480px open).
// Elevated plates are asymmetric and hop-chained (≤129 rise), not stacked
// shelf warehouses.
// Theme: voidVessel.

import type { MapDefinition, PlatformDefinition } from "../types.js";

const W = 3000;
const H = 1100;
const FLOOR_H = 36;
const PLAT_H = 18;
const WALL = 32;
/** Standing surface of the always-present ground floor. */
const GROUND = H - FLOOR_H; // 1064
/** Comfortable hop rise toward max jump (139). */
const STEP = 108;

const cy = (top: number, h = PLAT_H) => top + h / 2;

export const vesselNexus: MapDefinition = {
  id: "vessel-nexus",
  name: "Vessel Nexus",
  arenaTheme: "voidVessel",
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
    // SIGHTLINE COVER — floor-band pylons (break snipes)
    // Spaced ~420–480 so worst floor sightline stays mid-range.
    // ════════════════════════════════════════════════════════════════
    col("cover-a", 480, 48, GROUND - 90, GROUND),
    col("cover-b", 960, 52, GROUND - 110, GROUND),
    col("cover-c", 1500, 56, GROUND - 100, GROUND),
    col("cover-d", 2040, 52, GROUND - 110, GROUND),
    col("cover-e", 2520, 48, GROUND - 90, GROUND),
    // Low crouch barriers (short, break anklesight without sealing)
    ledge("lip-a", 720, 80, GROUND - 36),
    ledge("lip-b", 1260, 90, GROUND - 40),
    ledge("lip-c", 1740, 90, GROUND - 40),
    ledge("lip-d", 2280, 80, GROUND - 36),

    // ════════════════════════════════════════════════════════════════
    // ELEVATED PLATES — asymmetric jobs, hop-recoverable to ground
    // Every plate is ≤2 hops from ground or a lower plate (rise ≤ STEP).
    // ════════════════════════════════════════════════════════════════
    // T1 — launch pads off ground (rise STEP from GROUND)
    ledge("t1-L", 360, 280, GROUND - STEP),
    ledge("t1-ML", 900, 240, GROUND - STEP),
    ledge("t1-C", 1500, 320, GROUND - STEP),
    ledge("t1-MR", 2100, 240, GROUND - STEP),
    ledge("t1-R", 2640, 280, GROUND - STEP),

    // T2 — mid fight shelves (asymmetric density)
    ledge("t2-L", 500, 220, GROUND - 2 * STEP),
    ledge("t2-C", 1400, 260, GROUND - 2 * STEP),
    ledge("t2-R", 2500, 200, GROUND - 2 * STEP),
    ledge("t2-bridge", 950, 160, GROUND - 2 * STEP), // L↔C connector
    // No full right bridge — forces ground or leap for CR pressure

    // T3 — high pressure (sparse)
    ledge("t3-L", 620, 180, GROUND - 3 * STEP),
    ledge("t3-C", 1550, 200, GROUND - 3 * STEP),
    ledge("t3-R", 2380, 180, GROUND - 3 * STEP),

    // T4 — perch / nest (few)
    ledge("nest", 1500, 180, GROUND - 4 * STEP),
    ledge("perch-L", 400, 140, GROUND - 4 * STEP),
    ledge("perch-R", 2600, 140, GROUND - 4 * STEP),

    // ════════════════════════════════════════════════════════════════
    // ONE signature chimney (optional vertical drama, recoverable exits)
    // ════════════════════════════════════════════════════════════════
    col("chimney-L", 1320, 40, GROUND - 4 * STEP - 20, GROUND - STEP),
    col("chimney-R", 1520, 40, GROUND - 4 * STEP - 20, GROUND - STEP),
    ledge("chimney-mouth-L", 1240, 100, GROUND - STEP - 8),
    ledge("chimney-mouth-R", 1600, 100, GROUND - STEP - 8),
    ledge("chimney-exit-L", 1240, 110, GROUND - 4 * STEP - 20),
    ledge("chimney-exit-R", 1600, 110, GROUND - 4 * STEP - 20),
    ledge("chimney-cap", 1420, 180, GROUND - 4 * STEP - 28),
    // Single mid balcony (not a balcony stack)
    ledge("chimney-bal", 1180, 100, GROUND - 2.5 * STEP),

    // Side floaters chained from T1/T2 (recoverable, not void death)
    ledge("float-L1", 280, 120, GROUND - 2 * STEP - 40),
    ledge("float-R1", 2720, 120, GROUND - 2 * STEP - 40),
  ],
};

// Spawns: ground lattice first (always recoverable), then elevated pads.
// Hard floor MIN_SPAWN_DIST = 280 — never loosen below the validator.
{
  const MIN = 280;
  const cols = vesselNexus.platforms.filter(
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
  for (const p of vesselNexus.platforms) {
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
  vesselNexus.spawns = picked;
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
