// Shared Boxworks map. Built once at module load and consumed by:
//   - client/src/game/scenes/MatchScene.ts (offline play, render, pickup logic)
//   - server/src/matchHost.ts (authoritative simulation collision)
//
// The exported `boxworksWorld` MUST be byte-identical between client and server
// so that authoritative collision matches client prediction. To guarantee that:
//   - No `Math.random()` — all variation comes from the deterministic
//     `seededUnit` hash of (column, row, salt).
//   - No Phaser, no DOM, no wall-clock reads.
//   - `expandMap` is called once at module import time with constant inputs,
//     producing a frozen-ish data structure both runtimes consume.
//
// If you need to extend the geometry, do it here and re-run typecheck on both
// client and server.

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

/**
 * Boxworks ships pickups beyond the three baseline kinds the sim originally
 * shipped with (`health-shard`, `shield-cell`, `overcharge-core`). These
 * widened kinds are inert to the sim itself — `World.create` only copies
 * `pickup.kind` through into `WorldState.pickups`, so any string is safe at
 * runtime. We declare the full set here so the client's pickup logic stays
 * type-safe without modifying the shared `sim/types.ts` contract.
 */
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

/**
 * Map definition used by Boxworks in particular. Compatible with sim's
 * `MapDefinition` for everything the simulation actually inspects (platforms,
 * spawns, destructibles, baseline pickups). Pickup kinds are widened.
 */
export type BoxworksMapDefinition = Omit<MapDefinition, "pickups"> & {
  pickups: BoxworksPickupDefinition[];
  destructibles: DestructibleDefinition[];
};

// ---------------------------------------------------------------------------
// Constants. Tweaking these changes layout — keep in sync between runtimes by
// virtue of being defined exactly once, here.
// ---------------------------------------------------------------------------

export const WORLD_COLUMNS = 5;
export const WORLD_ROWS = 3;
export const VERTICAL_SHAFT_WIDTH = 150;
export const CARD_CACHE_RESPAWN_MS = 20000;
export const ROAMING_CARD_CACHE_COUNT = 7;

// ---------------------------------------------------------------------------
// Base 1-cell Boxworks layout. The world is built by tiling and varying this
// across `WORLD_COLUMNS * WORLD_ROWS` cells.
// ---------------------------------------------------------------------------

export const boxworks: BoxworksMapDefinition = {
  id: "boxworks",
  name: "Boxworks",
  size: { x: 960, y: 540 },
  spawns: [
    { x: 220, y: 430 },
    { x: 740, y: 430 },
    { x: 260, y: 250 },
    { x: 700, y: 250 },
    { x: 480, y: 420 },
    { x: 480, y: 210 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 480, y: 492 }, size: { x: 860, y: 32 } },
    { id: "left-wall", kind: "wall", position: { x: 34, y: 314 }, size: { x: 28, y: 350 } },
    { id: "right-wall", kind: "wall", position: { x: 926, y: 314 }, size: { x: 28, y: 350 } },
    { id: "left-low", kind: "platform", position: { x: 215, y: 388 }, size: { x: 210, y: 22 } },
    { id: "right-low", kind: "platform", position: { x: 745, y: 388 }, size: { x: 210, y: 22 } },
    { id: "center-mid", kind: "platform", position: { x: 480, y: 296 }, size: { x: 260, y: 20 } },
    { id: "left-high", kind: "platform", position: { x: 240, y: 214 }, size: { x: 190, y: 18 } },
    { id: "right-high", kind: "platform", position: { x: 720, y: 214 }, size: { x: 190, y: 18 } },
  ],
  destructibles: [
    { id: "barrel-a", kind: "barrel", health: 35, position: { x: 480, y: 430 }, size: { x: 28, y: 38 }, explosive: true, flammable: true },
    { id: "box-a", kind: "box", health: 45, position: { x: 320, y: 315 }, size: { x: 40, y: 40 }, explosive: false, flammable: true },
    { id: "mine-a", kind: "mine", health: 10, position: { x: 640, y: 456 }, size: { x: 24, y: 12 }, explosive: true, flammable: false },
    { id: "cube-a", kind: "cube", health: 70, position: { x: 610, y: 315 }, size: { x: 42, y: 42 }, explosive: false, flammable: false },
  ],
  pickups: [
    { id: "health-shard-a", kind: "health-shard", position: { x: 190, y: 350 }, radius: 15, amount: 25, respawnMs: 9500 },
    { id: "shield-cell-a", kind: "shield-cell", position: { x: 480, y: 256 }, radius: 16, amount: 48, respawnMs: 12000, durationMs: 8500 },
    { id: "overcharge-core-a", kind: "overcharge-core", position: { x: 770, y: 350 }, radius: 16, amount: 1, respawnMs: 14000, durationMs: 8000 },
    { id: "damage-amp-a", kind: "damage-amp", position: { x: 300, y: 238 }, radius: 15, amount: 1, respawnMs: 11000, durationMs: 8000 },
    { id: "speed-boost-a", kind: "speed-boost", position: { x: 660, y: 238 }, radius: 15, amount: 1, respawnMs: 11000, durationMs: 8000 },
    { id: "melee-mode-a", kind: "melee-mode", position: { x: 480, y: 380 }, radius: 16, amount: 1, respawnMs: 15000, durationMs: 9000 },
    { id: "slow-trap-a", kind: "slow-trap", position: { x: 255, y: 450 }, radius: 14, amount: 1, respawnMs: 13000, durationMs: 5500 },
    { id: "vulnerability-trap-a", kind: "vulnerability-trap", position: { x: 705, y: 450 }, radius: 14, amount: 1, respawnMs: 13000, durationMs: 5500 },
    { id: "block-jammer-a", kind: "block-jammer", position: { x: 480, y: 190 }, radius: 14, amount: 1, respawnMs: 14000, durationMs: 6500 },
    { id: "boss-core-a", kind: "boss-core", position: { x: 480, y: 256 }, radius: 20, amount: 1, respawnMs: 45000, durationMs: 16000 },
  ],
};

// ---------------------------------------------------------------------------
// Layout primitives. CELL_LAYOUTS is a deterministic palette from which
// `expandMap` draws to vary cells across the tiled world.
// ---------------------------------------------------------------------------

type LocalPlatformShape = {
  id: string;
  position: Vec2;
  size: Vec2;
};

type CellLayout = {
  name: string;
  platforms: LocalPlatformShape[];
  spawns: Vec2[];
};

const CELL_LAYOUTS: CellLayout[] = [
  {
    name: "broken-lanes",
    platforms: [
      { id: "left-low", position: { x: 190, y: 386 }, size: { x: 238, y: 22 } },
      { id: "right-low-short", position: { x: 735, y: 372 }, size: { x: 170, y: 20 } },
      { id: "left-high-chip", position: { x: 255, y: 220 }, size: { x: 134, y: 18 } },
      { id: "right-high-long", position: { x: 710, y: 224 }, size: { x: 252, y: 18 } },
      { id: "mid-splitter", position: { x: 480, y: 302 }, size: { x: 270, y: 18 } },
    ],
    spawns: [
      { x: 178, y: 346 },
      { x: 734, y: 332 },
      { x: 268, y: 180 },
      { x: 700, y: 184 },
    ],
  },
  {
    name: "stairwell",
    platforms: [
      { id: "low-left-step", position: { x: 178, y: 416 }, size: { x: 170, y: 20 } },
      { id: "mid-left-step", position: { x: 336, y: 338 }, size: { x: 155, y: 18 } },
      { id: "mid-right-step", position: { x: 624, y: 284 }, size: { x: 155, y: 18 } },
      { id: "high-right-step", position: { x: 778, y: 214 }, size: { x: 170, y: 18 } },
      { id: "top-left-perch", position: { x: 220, y: 186 }, size: { x: 150, y: 16 } },
    ],
    spawns: [
      { x: 174, y: 376 },
      { x: 338, y: 298 },
      { x: 626, y: 244 },
      { x: 778, y: 174 },
    ],
  },
  {
    name: "bowl",
    platforms: [
      { id: "left-rim", position: { x: 190, y: 328 }, size: { x: 220, y: 20 } },
      { id: "right-rim", position: { x: 770, y: 328 }, size: { x: 220, y: 20 } },
      { id: "low-left-pocket", position: { x: 304, y: 430 }, size: { x: 170, y: 20 } },
      { id: "low-right-pocket", position: { x: 656, y: 430 }, size: { x: 170, y: 20 } },
      { id: "top-needle", position: { x: 480, y: 202 }, size: { x: 230, y: 18 } },
    ],
    spawns: [
      { x: 190, y: 288 },
      { x: 770, y: 288 },
      { x: 304, y: 390 },
      { x: 656, y: 390 },
    ],
  },
  {
    name: "islands",
    platforms: [
      { id: "left-island", position: { x: 168, y: 292 }, size: { x: 150, y: 18 } },
      { id: "left-low-island", position: { x: 300, y: 420 }, size: { x: 168, y: 20 } },
      { id: "right-island", position: { x: 792, y: 292 }, size: { x: 150, y: 18 } },
      { id: "right-low-island", position: { x: 660, y: 420 }, size: { x: 168, y: 20 } },
      { id: "upper-offset", position: { x: 604, y: 198 }, size: { x: 172, y: 18 } },
      { id: "upper-counter", position: { x: 356, y: 228 }, size: { x: 144, y: 16 } },
    ],
    spawns: [
      { x: 168, y: 252 },
      { x: 300, y: 380 },
      { x: 792, y: 252 },
      { x: 660, y: 380 },
    ],
  },
  {
    name: "crossfire",
    platforms: [
      { id: "left-wide-low", position: { x: 235, y: 398 }, size: { x: 285, y: 20 } },
      { id: "right-wide-high", position: { x: 725, y: 258 }, size: { x: 285, y: 18 } },
      { id: "left-short-high", position: { x: 224, y: 214 }, size: { x: 134, y: 16 } },
      { id: "right-short-low", position: { x: 736, y: 410 }, size: { x: 134, y: 20 } },
      { id: "center-bridge", position: { x: 480, y: 328 }, size: { x: 222, y: 18 } },
    ],
    spawns: [
      { x: 236, y: 358 },
      { x: 724, y: 218 },
      { x: 224, y: 174 },
      { x: 736, y: 370 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pure helpers. None of these touch Phaser, the DOM, or the wall clock; all
// pseudo-randomness is the deterministic `seededUnit` hash. Safe to call from
// either runtime; calling `expandMap` with the same inputs produces identical
// output everywhere.
// ---------------------------------------------------------------------------

type CellVariant = {
  mirror: boolean;
  layoutIndex: number;
  xJitter: number;
  yJitter: number;
  platformWidthScale: number;
  platformYSkew: number;
};

/** clamp(v, min, max) — replaces Phaser.Math.Clamp. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Hash (column, row, salt) → unit float in [0, 1). Deterministic, identical
 * across V8 / JavaScriptCore / Bun. We use Math.sin + multiply + fract — this
 * is the well-known shader trick. It's not high-quality randomness but it's
 * stable and that's what we need for shared map generation.
 */
export function seededUnit(column: number, row: number, salt: number): number {
  const value = Math.sin((column + 1) * 127.1 + (row + 1) * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

export function seededRange(column: number, row: number, salt: number, min: number, max: number): number {
  return min + (max - min) * seededUnit(column, row, salt);
}

function createCellVariant(column: number, row: number): CellVariant {
  return {
    mirror: seededUnit(column, row, 1) > 0.5,
    layoutIndex:
      (column * 2 + row * 3 + Math.floor(seededUnit(column, row, 7) * CELL_LAYOUTS.length)) %
      CELL_LAYOUTS.length,
    xJitter: seededRange(column, row, 2, -52, 52),
    yJitter: seededRange(column, row, 3, -28, 30),
    platformWidthScale: seededRange(column, row, 4, 0.82, 1.18),
    platformYSkew: seededRange(column, row, 8, -18, 18),
  };
}

function transformCellPosition(
  localPosition: Vec2,
  offset: Vec2,
  base: BoxworksMapDefinition,
  variant: CellVariant,
  jitterScale: number,
): Vec2 {
  const mirroredX = variant.mirror ? base.size.x - localPosition.x : localPosition.x;
  return {
    x: clamp(
      offset.x + mirroredX + variant.xJitter * jitterScale,
      offset.x + 82,
      offset.x + base.size.x - 82,
    ),
    y: clamp(
      offset.y + localPosition.y + variant.yJitter * jitterScale,
      offset.y + 138,
      offset.y + base.size.y - 54,
    ),
  };
}

function createCellPlatforms(
  base: BoxworksMapDefinition,
  layout: CellLayout,
  offset: Vec2,
  variant: CellVariant,
  column: number,
  row: number,
): PlatformDefinition[] {
  const floor = base.platforms.find((platform) => platform.kind === "floor");
  const platforms: PlatformDefinition[] = [];

  if (floor) {
    platforms.push({
      ...floor,
      id: "floor",
      position: { x: floor.position.x + offset.x, y: floor.position.y + offset.y },
      size: { ...floor.size },
    });
  }

  for (const [index, shape] of layout.platforms.entries()) {
    const widthScale = variant.platformWidthScale * seededRange(column, row, 90 + index, 0.88, 1.12);
    const position = transformCellPosition(
      {
        x: shape.position.x,
        y: shape.position.y + variant.platformYSkew * seededRange(column, row, 110 + index, 0.45, 1.1),
      },
      offset,
      base,
      variant,
      0.82,
    );

    platforms.push({
      id: `${layout.name}-${shape.id}`,
      kind: "platform",
      position,
      size: {
        x: Math.max(96, shape.size.x * widthScale),
        y: shape.size.y,
      },
    });
  }

  return platforms;
}

function createCellScatterPosition(
  offset: Vec2,
  base: BoxworksMapDefinition,
  variant: CellVariant,
  column: number,
  row: number,
  salt: number,
  radius: number,
): Vec2 {
  const onRightSide = seededUnit(column, row, salt) > 0.48;
  const localX = onRightSide
    ? seededRange(column, row, salt + 1, 610, base.size.x - 130 - radius)
    : seededRange(column, row, salt + 1, 130 + radius, 350);
  const localY = seededRange(column, row, salt + 2, 178, base.size.y - 94);

  return transformCellPosition({ x: localX, y: localY }, offset, base, variant, 0.48);
}

function nudgeHorizontalOutOfShaft(
  position: Vec2,
  halfWidth: number,
  shaftX: number,
  cellLeft: number,
  cellRight: number,
): Vec2 {
  const gapLeft = shaftX - VERTICAL_SHAFT_WIDTH / 2;
  const gapRight = shaftX + VERTICAL_SHAFT_WIDTH / 2;
  if (position.x + halfWidth <= gapLeft || position.x - halfWidth >= gapRight) {
    return position;
  }

  const padding = 28;
  const preferredX =
    position.x <= shaftX ? gapLeft - halfWidth - padding : gapRight + halfWidth + padding;
  const minX = cellLeft + halfWidth + 52;
  const maxX = cellRight - halfWidth - 52;

  return {
    ...position,
    x: Math.min(maxX, Math.max(minX, preferredX)),
  };
}

export function nudgeBoxOutOfShaft(
  position: Vec2,
  size: Vec2,
  shaftX: number,
  cellLeft: number,
  cellRight: number,
): Vec2 {
  return nudgeHorizontalOutOfShaft(position, size.x / 2, shaftX, cellLeft, cellRight);
}

export function nudgeCircleOutOfShaft(
  position: Vec2,
  radius: number,
  shaftX: number,
  cellLeft: number,
  cellRight: number,
): Vec2 {
  return nudgeHorizontalOutOfShaft(position, radius, shaftX, cellLeft, cellRight);
}

/**
 * Splits a horizontal platform across the central vertical shaft so players
 * can drop straight down between rows. If the platform doesn't intersect the
 * shaft, it is appended unchanged.
 */
export function appendPlatformWithShaftGap(
  platforms: PlatformDefinition[],
  platform: PlatformDefinition,
  shaftX: number,
): void {
  const left = platform.position.x - platform.size.x / 2;
  const right = platform.position.x + platform.size.x / 2;
  const gapLeft = shaftX - VERTICAL_SHAFT_WIDTH / 2;
  const gapRight = shaftX + VERTICAL_SHAFT_WIDTH / 2;

  if (right <= gapLeft || left >= gapRight) {
    platforms.push(platform);
    return;
  }

  const pieces = [
    { id: `${platform.id}-left`, left, right: gapLeft },
    { id: `${platform.id}-right`, left: gapRight, right },
  ];

  for (const piece of pieces) {
    const width = piece.right - piece.left;
    if (width < 36) continue;

    platforms.push({
      ...platform,
      id: piece.id,
      position: { x: piece.left + width / 2, y: platform.position.y },
      size: { x: width, y: platform.size.y },
    });
  }
}

/**
 * Adds horizontal jump bridges between adjacent columns and vertical climb
 * platforms inside each shaft. Mutates `platforms` in place.
 */
export function addTraversalConnectors(
  platforms: PlatformDefinition[],
  base: BoxworksMapDefinition,
  columns: number,
  rows: number,
): void {
  for (let row = 0; row < rows; row += 1) {
    const rowOffsetY = row * base.size.y;
    for (let gap = 1; gap < columns; gap += 1) {
      const gapX = gap * base.size.x;
      platforms.push({
        id: `row-${row}-gap-${gap}-jump-bridge`,
        kind: "platform",
        position: { x: gapX, y: rowOffsetY + 430 },
        size: { x: 116, y: 16 },
      });
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    const boundaryY = (row + 1) * base.size.y;
    for (let column = 0; column < columns; column += 1) {
      const shaftX = column * base.size.x + base.size.x / 2;
      platforms.push(
        {
          id: `row-${row}-column-${column}-upper-climb-left`,
          kind: "platform",
          position: { x: shaftX - 154, y: boundaryY + 62 },
          size: { x: 118, y: 16 },
        },
        {
          id: `row-${row}-column-${column}-middle-climb-right`,
          kind: "platform",
          position: { x: shaftX + 154, y: boundaryY + 142 },
          size: { x: 118, y: 16 },
        },
        {
          id: `row-${row}-column-${column}-lower-climb-left`,
          kind: "platform",
          position: { x: shaftX - 154, y: boundaryY + 222 },
          size: { x: 118, y: 16 },
        },
      );
    }
  }
}

function shouldPlacePickupInCell(
  kind: BoxworksPickupKind,
  column: number,
  row: number,
  pickupIndex: number,
): boolean {
  if (kind === "boss-core") {
    return column === 2 && row === 1;
  }
  if (kind === "health-shard" || kind === "shield-cell" || kind === "overcharge-core") {
    return seededUnit(column, row, 500 + pickupIndex) > 0.22;
  }
  if (kind === "damage-amp" || kind === "speed-boost" || kind === "melee-mode") {
    return seededUnit(column, row, 520 + pickupIndex) > 0.56;
  }
  return seededUnit(column, row, 540 + pickupIndex) > 0.66;
}

function addRoamingCardCaches(
  pickups: BoxworksPickupDefinition[],
  spawns: Vec2[],
  worldSize: Vec2,
): void {
  if (spawns.length === 0) return;

  for (let index = 0; index < ROAMING_CARD_CACHE_COUNT; index += 1) {
    const spawnIndex = Math.floor(seededUnit(index, 0, 700) * spawns.length) % spawns.length;
    const spawn = spawns[spawnIndex]!;
    const angle = seededUnit(index, 0, 701) * Math.PI * 2;
    const radius = 30 + seededUnit(index, 0, 702) * 64;
    pickups.push({
      id: `card-cache-roaming-${index}`,
      kind: "card-cache",
      position: {
        x: clamp(spawn.x + Math.cos(angle) * radius, 80, worldSize.x - 80),
        y: clamp(spawn.y + Math.sin(angle) * radius, 140, worldSize.y - 70),
      },
      radius: 18,
      amount: 1,
      respawnMs: CARD_CACHE_RESPAWN_MS,
    });
  }
}

/**
 * Tile + perturb the base 1-cell layout into a `columns × rows` world. Pure;
 * given the same `(base, columns, rows)` you always get the same output.
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

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offset: Vec2 = {
        x: column * base.size.x,
        y: row * base.size.y,
      };
      const variant = createCellVariant(column, row);
      const layout = CELL_LAYOUTS[variant.layoutIndex]!;
      const shaftX = offset.x + base.size.x / 2;
      const cellLeft = offset.x;
      const cellRight = offset.x + base.size.x;

      for (const spawn of layout.spawns) {
        spawns.push(transformCellPosition(spawn, offset, base, variant, 0.28));
      }

      for (const platform of createCellPlatforms(base, layout, offset, variant, column, row)) {
        appendPlatformWithShaftGap(
          platforms,
          { ...platform, id: `${platform.id}-${column}-${row}` },
          shaftX,
        );
      }

      for (const [objectIndex, object] of base.destructibles.entries()) {
        const position = nudgeBoxOutOfShaft(
          createCellScatterPosition(offset, base, variant, column, row, 20 + objectIndex, object.size.x / 2),
          object.size,
          shaftX,
          cellLeft,
          cellRight,
        );
        destructibles.push({
          ...object,
          id: `${object.id}-${column}-${row}`,
          position,
        });
      }

      for (const [pickupIndex, pickup] of base.pickups.entries()) {
        if (!shouldPlacePickupInCell(pickup.kind, column, row, pickupIndex)) continue;
        const position = nudgeCircleOutOfShaft(
          createCellScatterPosition(offset, base, variant, column, row, 40 + pickupIndex, pickup.radius),
          pickup.radius,
          shaftX,
          cellLeft,
          cellRight,
        );
        pickups.push({
          ...pickup,
          id: `${pickup.id}-${column}-${row}`,
          position,
        });
      }
    }
  }

  const worldSize: Vec2 = {
    x: base.size.x * columns,
    y: base.size.y * rows,
  };

  addRoamingCardCaches(pickups, spawns, worldSize);
  addTraversalConnectors(platforms, base, columns, rows);

  platforms.push(
    {
      id: "world-left-wall",
      kind: "wall",
      position: { x: 34, y: worldSize.y / 2 },
      size: { x: 28, y: worldSize.y },
    },
    {
      id: "world-right-wall",
      kind: "wall",
      position: { x: worldSize.x - 34, y: worldSize.y / 2 },
      size: { x: 28, y: worldSize.y },
    },
  );

  return {
    ...base,
    id: `${base.id}-expanded`,
    name: `${base.name} ${columns}x${rows}`,
    size: worldSize,
    spawns,
    platforms,
    destructibles,
    pickups,
  };
}

// ---------------------------------------------------------------------------
// The fully expanded Boxworks world. This single object is what client
// prediction and authoritative server collision both consume.
// ---------------------------------------------------------------------------

export const boxworksWorld: BoxworksMapDefinition = expandMap(boxworks, WORLD_COLUMNS, WORLD_ROWS);
