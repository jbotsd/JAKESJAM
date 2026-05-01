// Shared Boxworks map. Built once at module load and consumed by:
//   - client/src/game/scenes/MatchScene.ts (offline play, render, pickup logic)
//   - server/src/matchHost.ts (authoritative simulation collision)
//
// The exported `boxworksWorld` MUST be byte-identical between client and server
// so that authoritative collision matches client prediction. To guarantee that:
//   - No `Math.random()` — all variation comes from deterministic cell rotation.
//   - No Phaser, no DOM, no wall-clock reads.
//   - `expandMap` is called once at module import time with constant inputs,
//     producing a frozen-ish data structure both runtimes consume.
//
// ---------------------------------------------------------------------------
// LEVEL DESIGN RATIONALE — BOXWORKS (always-on FFA, rogue-lite, 6-10 players)
// ---------------------------------------------------------------------------
//
// Boxworks is the only map. Designed for continuous FFA (no round rotation),
// all chaos modifier permutations, and 2-10 player drift.
//
// Design principles:
//   1. SIMPLICITY: 3 clean cell layouts, no procedural variance. Every platform
//      is hand-placed at grid-snapped positions. Players learn the map fast.
//   2. THREE-TIER FLOW: Ground → Mid → High. Clear vertical lanes.
//      Each tier has purpose: ground for speed/safety, mid for engagement,
//      high for control/risk.
//   3. CIRCULATION: Every cell has at least 2 ways up and 2 ways down.
//      No dead ends. Players always have an escape route.
//   4. SIGHTLINES: Max ~320px unbroken horizontal line per tier.
//      Forces commitment to engage. No cross-map sniping.
//   5. ONE-WAY PLATFORMS: All 'platform' kind surfaces can be jumped through
//      from below. Only floors and walls are fully solid. This massively
//      improves vertical flow.
//
// World scale:
//   - Base cell: 960 × 540 px (matches movement math)
//   - Default map: 3×2 = 2880 × 1080 px (6 cells, good for 4-8 players)
//   - Large map: 4×2 = 3840 × 1080 px (for 8-10 players)

import type {
  DestructibleDefinition,
  MapDefinition,
  PickupKind as SimPickupKind,
  PlatformDefinition,
  Vec2,
} from "../types.js";

// ---------------------------------------------------------------------------
// Type augmentations (additive — sim/types.ts is shared and must not change).
// ---------------------------------------------------------------------------

export type BoxworksPickupKind =
  | SimPickupKind
  | "card-cache"
  | "damage-amp"
  | "speed-boost"
  | "melee-mode"
  | "slow-trap"
  | "vulnerability-trap"
  | "block-jammer"
  | "boss-core";

export type BoxworksPickupDefinition = {
  id: string;
  kind: BoxworksPickupKind;
  position: Vec2;
  radius: number;
  amount: number;
  respawnMs: number;
  durationMs?: number;
};

export type BoxworksMapDefinition = Omit<MapDefinition, "pickups"> & {
  pickups: BoxworksPickupDefinition[];
  destructibles: DestructibleDefinition[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WORLD_COLUMNS = 3;
export const WORLD_ROWS = 2;
export const WORLD_COLUMNS_LARGE = 4;
export const WORLD_ROWS_LARGE = 2;
export const CARD_CACHE_RESPAWN_MS = 20000;
export const ROAMING_CARD_CACHE_COUNT = 7;

/** Cell dimensions — all geometry is authored relative to this. */
const CELL_W = 960;
const CELL_H = 540;

/** Standard platform thickness. */
const PLAT_H = 16;
/** Floor thickness. */
const FLOOR_H = 32;
/** Wall thickness. */
const WALL_W = 32;

// ---------------------------------------------------------------------------
// Cell Layout System — 3 clean, hand-authored layouts
// ---------------------------------------------------------------------------
//
// Each layout serves a distinct gameplay purpose:
//   - "arena":    Symmetrical, fair fights. Classic 3-tier structure.
//   - "heights":  Asymmetric verticality. High-ground advantage vs mobility.
//   - "gauntlet": Tight corridors through center, open flanks.
//
// All positions are grid-snapped (multiples of 8px) and hand-tuned for
// readability. Zero randomness in placement.
// ---------------------------------------------------------------------------

type CellLayout = {
  name: string;
  /** Platforms local to this cell (no floor/walls — those are added by expand). */
  platforms: { id: string; position: Vec2; size: Vec2 }[];
  /** Spawn anchors — 4 per cell, distributed across tiers. */
  spawns: Vec2[];
  /** Destructible positions local to this cell. */
  destructibles: DestructibleDefinition[];
};

const CELL_LAYOUTS: CellLayout[] = [
  // ===== ARENA =====
  // Symmetrical three-tier structure. The "fair fight" cell.
  // Ground: wide open with two low ledges for step-up access to mid.
  // Mid: two mid-width platforms at equal height, spaced evenly.
  // High: one central perch (jetpack-only), commands sightlines down.
  {
    name: "arena",
    platforms: [
      // Low tier — step-up ledges to reach mid platforms
      { id: "low-left",  position: { x: 216, y: 432 }, size: { x: 192, y: PLAT_H } },
      { id: "low-right", position: { x: 744, y: 432 }, size: { x: 192, y: PLAT_H } },
      // Mid tier — primary engagement platforms
      { id: "mid-left",  position: { x: 264, y: 328 }, size: { x: 208, y: PLAT_H } },
      { id: "mid-right", position: { x: 696, y: 328 }, size: { x: 208, y: PLAT_H } },
      // Mid bridge — connects the two sides, creates crossfire opportunity
      { id: "mid-bridge", position: { x: 480, y: 368 }, size: { x: 160, y: PLAT_H } },
      // High perch — jetpack-only, risky but commanding
      { id: "high-center", position: { x: 480, y: 208 }, size: { x: 176, y: PLAT_H } },
    ],
    spawns: [
      { x: 200, y: 400 },
      { x: 760, y: 400 },
      { x: 264, y: 296 },
      { x: 696, y: 296 },
    ],
    destructibles: [
      { id: "barrel-mid", kind: "barrel", health: 35, position: { x: 480, y: 344 }, size: { x: 28, y: 38 }, explosive: true, flammable: true },
      { id: "box-left",   kind: "box",    health: 45, position: { x: 320, y: 408 }, size: { x: 40, y: 40 }, explosive: false, flammable: true },
      { id: "mine-right", kind: "mine",   health: 10, position: { x: 640, y: 472 }, size: { x: 24, y: 12 }, explosive: true, flammable: false },
    ],
  },

  // ===== HEIGHTS =====
  // Asymmetric verticality. Left side is tall staircase, right side is open
  // with a high lookout. Creates interesting asymmetric engagements.
  // Ground: mostly open. A floor-level step on the right.
  // Mid: staggered platforms ascending left-to-right.
  // High: left upper platform + right lookout perch.
  {
    name: "heights",
    platforms: [
      // Ascending staircase (left → right, low → high)
      { id: "step-1", position: { x: 176, y: 416 }, size: { x: 160, y: PLAT_H } },
      { id: "step-2", position: { x: 352, y: 344 }, size: { x: 168, y: PLAT_H } },
      { id: "step-3", position: { x: 568, y: 280 }, size: { x: 168, y: PLAT_H } },
      // High lookout — reward for climbing, but exposed
      { id: "lookout", position: { x: 776, y: 208 }, size: { x: 176, y: PLAT_H } },
      // Low-right pad — quick escape from the base
      { id: "low-pad", position: { x: 760, y: 424 }, size: { x: 176, y: PLAT_H } },
      // Counter-perch — left high ground to challenge the lookout
      { id: "counter", position: { x: 200, y: 224 }, size: { x: 152, y: PLAT_H } },
    ],
    spawns: [
      { x: 176, y: 384 },
      { x: 760, y: 392 },
      { x: 568, y: 248 },
      { x: 200, y: 192 },
    ],
    destructibles: [
      { id: "barrel-step", kind: "barrel", health: 35, position: { x: 352, y: 320 }, size: { x: 28, y: 38 }, explosive: true, flammable: true },
      { id: "cube-look",   kind: "cube",   health: 70, position: { x: 776, y: 184 }, size: { x: 42, y: 42 }, explosive: false, flammable: false },
      { id: "mine-base",   kind: "mine",   health: 10, position: { x: 480, y: 472 }, size: { x: 24, y: 12 }, explosive: true, flammable: false },
    ],
  },

  // ===== GAUNTLET =====
  // Tight center corridor with open flanks. Forces close-range fights through
  // the middle or wide-flanking movements around the edges.
  // Ground: open on both sides.
  // Mid: central platform cluster creates a "chokepoint" zone.
  // High: two flanking perches that overlook the gauntlet.
  {
    name: "gauntlet",
    platforms: [
      // The gauntlet — stacked central platforms that force close-range
      { id: "gauntlet-low",  position: { x: 480, y: 408 }, size: { x: 224, y: PLAT_H } },
      { id: "gauntlet-mid",  position: { x: 480, y: 320 }, size: { x: 192, y: PLAT_H } },
      { id: "gauntlet-high", position: { x: 480, y: 232 }, size: { x: 152, y: PLAT_H } },
      // Flanking perches — overlook the center, good for ranged pressure
      { id: "flank-left",  position: { x: 152, y: 296 }, size: { x: 160, y: PLAT_H } },
      { id: "flank-right", position: { x: 808, y: 296 }, size: { x: 160, y: PLAT_H } },
      // Low access — helps players transition from flank to center
      { id: "access-left",  position: { x: 240, y: 424 }, size: { x: 128, y: PLAT_H } },
      { id: "access-right", position: { x: 720, y: 424 }, size: { x: 128, y: PLAT_H } },
    ],
    spawns: [
      { x: 152, y: 264 },
      { x: 808, y: 264 },
      { x: 480, y: 376 },
      { x: 480, y: 200 },
    ],
    destructibles: [
      { id: "barrel-top", kind: "barrel", health: 35, position: { x: 480, y: 208 }, size: { x: 28, y: 38 }, explosive: true, flammable: true },
      { id: "box-flank-l", kind: "box", health: 45, position: { x: 152, y: 272 }, size: { x: 40, y: 40 }, explosive: false, flammable: true },
      { id: "box-flank-r", kind: "box", health: 45, position: { x: 808, y: 272 }, size: { x: 40, y: 40 }, explosive: false, flammable: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// Base map template — defines the floor/wall structure for a single cell.
// The exported `boxworks` constant preserves API compatibility.
// ---------------------------------------------------------------------------

export const boxworks: BoxworksMapDefinition = {
  id: "boxworks",
  name: "Boxworks",
  size: { x: CELL_W, y: CELL_H },
  spawns: [
    { x: 200, y: 432 },
    { x: 760, y: 432 },
    { x: 240, y: 264 },
    { x: 720, y: 264 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: CELL_W / 2, y: CELL_H - 16 }, size: { x: CELL_W - 64, y: FLOOR_H } },
    { id: "left-wall",  kind: "wall", position: { x: 16, y: CELL_H / 2 }, size: { x: WALL_W, y: CELL_H } },
    { id: "right-wall", kind: "wall", position: { x: CELL_W - 16, y: CELL_H / 2 }, size: { x: WALL_W, y: CELL_H } },
  ],
  destructibles: [],
  pickups: [],
};

// ---------------------------------------------------------------------------
// Deterministic cell assignment — no randomness, just rotation.
// ---------------------------------------------------------------------------

/**
 * Deterministic cell layout index based on grid position.
 * Uses a simple pattern that ensures adjacent cells are never the same layout.
 * No Math.random, no hash functions, no jitter. Just modular arithmetic.
 */
function cellLayoutIndex(column: number, row: number): number {
  // Checkerboard-like pattern that avoids same-layout adjacency
  return (column * 2 + row) % CELL_LAYOUTS.length;
}

/**
 * Whether a cell should be horizontally mirrored. Alternating columns
 * get mirrored for visual variety without randomness.
 */
function cellMirrored(column: number, row: number): boolean {
  return (column + row) % 2 === 1;
}

// ---------------------------------------------------------------------------
// Map expansion — clean, deterministic, no jitter
// ---------------------------------------------------------------------------

/**
 * Tile the base cell across `columns × rows`. Each cell gets a deterministic
 * layout from the palette. Platforms are placed exactly as authored; the only
 * transform is optional horizontal mirroring.
 *
 * Pure function: same inputs always produce identical output.
 */
export function expandMap(
  base: BoxworksMapDefinition,
  columns: number,
  rows: number,
): BoxworksMapDefinition {
  const platforms: PlatformDefinition[] = [];
  const destructibles: DestructibleDefinition[] = [];
  const pickups: BoxworksPickupDefinition[] = [];
  const spawns: Vec2[] = [];
  const worldWidth = CELL_W * columns;
  const worldHeight = CELL_H * rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const offsetX = col * CELL_W;
      const offsetY = row * CELL_H;
      const layout = CELL_LAYOUTS[cellLayoutIndex(col, row)]!;
      const mirrored = cellMirrored(col, row);

      // --- Floor (per-cell) ---
      platforms.push({
        id: `floor-${col}-${row}`,
        kind: "floor",
        position: { x: offsetX + CELL_W / 2, y: offsetY + CELL_H - 16 },
        size: { x: CELL_W - 64, y: FLOOR_H },
      });

      // --- Layout platforms (one-way) ---
      for (const plat of layout.platforms) {
        const localX = mirrored ? CELL_W - plat.position.x : plat.position.x;
        platforms.push({
          id: `${layout.name}-${plat.id}-${col}-${row}`,
          kind: "platform",
          position: { x: offsetX + localX, y: offsetY + plat.position.y },
          size: { ...plat.size },
        });
      }

      // --- Spawns ---
      for (const spawn of layout.spawns) {
        const localX = mirrored ? CELL_W - spawn.x : spawn.x;
        spawns.push({ x: offsetX + localX, y: offsetY + spawn.y });
      }

      // --- Destructibles ---
      for (const d of layout.destructibles) {
        const localX = mirrored ? CELL_W - d.position.x : d.position.x;
        destructibles.push({
          ...d,
          id: `${d.id}-${col}-${row}`,
          position: { x: offsetX + localX, y: offsetY + d.position.y },
        });
      }
    }
  }

  // --- Inter-cell connectors ---
  // Horizontal bridges between adjacent columns (one per row boundary gap)
  for (let row = 0; row < rows; row++) {
    for (let gap = 1; gap < columns; gap++) {
      const bridgeX = gap * CELL_W;
      const bridgeY = row * CELL_H + 432; // Low tier connector
      platforms.push({
        id: `bridge-${gap}-${row}`,
        kind: "platform",
        position: { x: bridgeX, y: bridgeY },
        size: { x: 120, y: PLAT_H },
      });
      // Mid-tier connector slightly offset
      platforms.push({
        id: `bridge-mid-${gap}-${row}`,
        kind: "platform",
        position: { x: bridgeX, y: row * CELL_H + 312 },
        size: { x: 104, y: PLAT_H },
      });
    }
  }

  // Vertical connectors: staggered climb platforms between row boundaries
  for (let row = 0; row < rows - 1; row++) {
    const boundaryY = (row + 1) * CELL_H;
    for (let col = 0; col < columns; col++) {
      const centerX = col * CELL_W + CELL_W / 2;
      // Three staggered climb ledges — left, right, left pattern breaks
      // vertical sightlines while providing clear upward path
      platforms.push(
        {
          id: `climb-upper-${col}-${row}`,
          kind: "platform",
          position: { x: centerX - 128, y: boundaryY + 56 },
          size: { x: 112, y: PLAT_H },
        },
        {
          id: `climb-mid-${col}-${row}`,
          kind: "platform",
          position: { x: centerX + 128, y: boundaryY + 136 },
          size: { x: 112, y: PLAT_H },
        },
        {
          id: `climb-lower-${col}-${row}`,
          kind: "platform",
          position: { x: centerX - 128, y: boundaryY + 216 },
          size: { x: 112, y: PLAT_H },
        },
      );
    }
  }

  // --- World boundary walls ---
  platforms.push(
    {
      id: "world-left-wall",
      kind: "wall",
      position: { x: 16, y: worldHeight / 2 },
      size: { x: WALL_W, y: worldHeight },
    },
    {
      id: "world-right-wall",
      kind: "wall",
      position: { x: worldWidth - 16, y: worldHeight / 2 },
      size: { x: WALL_W, y: worldHeight },
    },
  );

  return {
    ...base,
    id: `${base.id}-expanded`,
    name: `${base.name} ${columns}x${rows}`,
    size: { x: worldWidth, y: worldHeight },
    spawns,
    platforms,
    destructibles,
    pickups,
  };
}

// ---------------------------------------------------------------------------
// Exported maps
// ---------------------------------------------------------------------------

export const boxworksWorld: BoxworksMapDefinition = expandMap(boxworks, WORLD_COLUMNS, WORLD_ROWS);

export const boxworksLargeWorld: BoxworksMapDefinition = (() => {
  const expanded = expandMap(boxworks, WORLD_COLUMNS_LARGE, WORLD_ROWS_LARGE);
  return {
    ...expanded,
    id: "boxworks-large",
    name: `Boxworks Large ${WORLD_COLUMNS_LARGE}x${WORLD_ROWS_LARGE}`,
  };
})();

// ---------------------------------------------------------------------------
// Legacy exports — kept for backward compatibility with any code that imports
// these helpers. They're no-ops or simplified now.
// ---------------------------------------------------------------------------

export function seededUnit(column: number, row: number, salt: number): number {
  const value = Math.sin((column + 1) * 127.1 + (row + 1) * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

export function seededRange(column: number, row: number, salt: number, min: number, max: number): number {
  return min + (max - min) * seededUnit(column, row, salt);
}

export function nudgeBoxOutOfShaft(
  position: Vec2,
  _size: Vec2,
  _shaftX: number,
  _cellLeft: number,
  _cellRight: number,
): Vec2 {
  return position; // No-op — shaft system removed in favor of clean cell boundaries
}

export function nudgeCircleOutOfShaft(
  position: Vec2,
  _radius: number,
  _shaftX: number,
  _cellLeft: number,
  _cellRight: number,
): Vec2 {
  return position; // No-op
}

export function appendPlatformWithShaftGap(
  platforms: PlatformDefinition[],
  platform: PlatformDefinition,
  _shaftX: number,
): void {
  platforms.push(platform); // No-op — no shaft gap splitting
}

export function addTraversalConnectors(
  _platforms: PlatformDefinition[],
  _base: BoxworksMapDefinition,
  _columns: number,
  _rows: number,
): void {
  // No-op — connectors are built directly in expandMap now
}

// Legacy constant — kept for any imports but unused by new map system
export const VERTICAL_SHAFT_WIDTH = 150;
