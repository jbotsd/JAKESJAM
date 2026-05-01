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
//
// ---------------------------------------------------------------------------
// LEVEL DESIGN RATIONALE — BOXWORKS (always-on FFA, rogue-lite, 6-10 players)
// ---------------------------------------------------------------------------
//
// Boxworks is the only map. The arena must hold up under continuous join/leave
// FFA (no rounds-as-rotation), all chaos modifier permutations, and a roster
// that drifts between 2 and 10 players over a single session. Every shape and
// number below was picked against those constraints.
//
// World scale
//   - Base cell:   960 x 540 px (matches jetpack ceiling + jump apex math
//                  in client/src/sim/player.ts: jump apex ~139 px, fast-fall
//                  cap 900 px/s, jetpack thrust caps vy at -640 px/s).
//   - boxworks:    3 x 2 = 2880 x 1080 px. Six cells. Comfortable for 4-8
//                  concurrent players. Tighter than the historic 5x3 sprawl
//                  (which played as a deathmatch ghost town under 6 players).
//   - boxworksLarge: 4 x 2 = 3840 x 1080 px. Same vertical budget, one extra
//                  column. Reserved for sessions that consistently hold 8-10
//                  concurrent players. Server may pick at boot.
//
// Spawn placement
//   - Each CELL_LAYOUT exports 4-6 spawn anchors. Across 6 cells x ~5 spawns
//     that's ~30 candidate positions in the default map (more in Large).
//   - All spawn anchors sit within 60 px vertical of a platform top, so a
//     fresh player isn't free-falling into combat.
//   - Anchors are *off-axis* from the central vertical shaft and the row
//     bridge so a respawning player isn't directly in the most-trafficked
//     corridors.
//   - Anchors are pushed to cell edges/corners and one mid spot per layout.
//     The MatchScene picker that walks `boxworksWorld.spawns` will round-
//     robin them; with up to 10 players competing for ~30 anchors, no one
//     spawns on top of an existing player.
//
// Sightlines
//   - Max unbroken horizontal sightline inside a single cell: ~360 px
//     (≈ half a cell). Designed against starter projectile speed (~700 px/s)
//     and 800 ms lifetimes — a shooter has to commit movement to land hits,
//     not just hold a corner.
//   - The central vertical shaft (VERTICAL_SHAFT_WIDTH px wide) cuts every
//     row-spanning platform via `appendPlatformWithShaftGap`, guaranteeing a
//     drop-through column between rows. That column is also the one place
//     a player can be visible from two cells at once — so the climb ledges
//     in `addTraversalConnectors` deliberately stagger left/right to break
//     line-of-sight between rows.
//   - Each cell has at least one solid raised platform between mid and the
//     edges, so a defender can't lock down the floor from a single perch.
//
// Engagement ranges
//   - Intended close-to-mid range: 60-380 px. That covers melee/slappers,
//     starter pistol arc, and most card-modified weapons before they enter
//     "sniper" territory.
//   - Cells are deliberately sized so even a max-range straight-fire weapon
//     usually has to move one platform forward to confirm the hit. This
//     discourages camping but doesn't punish positional play.
//
// Destructibles
//   - 5 per cell (mix of barrel/box/mine/cube). Placed at predictable choke
//     points: ledge edges, mid-bridge approaches, near spawn anchors. Their
//     job is to force the cover-breaking player to either commit or detour,
//     not to be primary cover themselves (platforms do that).
//   - Mines on the floor near the lower spawn points double as "anti-rush"
//     deterrents — chasers eat the mine before reaching a fresh spawn.
//
// Chaos modifier interaction (every modifier in sim/data/chaosModifiers.ts
// must remain playable here):
//   - low-gravity (g x0.46): apex roughly doubles. Top platforms stay
//     jetpack-only by design; low-grav merely lets non-jetpack players reach
//     them too. No platform is so high it becomes unreachable under normal
//     gravity though — every ledge is reachable with jetpack at 1.0 grav.
//   - slow-motion (timeScale 0.55): tighter sightlines mean half-speed
//     shots still threaten — players can't freely walk across cells without
//     being telegraphed. Works.
//   - golden-gun (dmg x9, fire x0.28): cover-rich layout prevents the
//     "one-shot from across the map" worst case. Players have to round a
//     ledge or destructible to land the killing shot.
//   - slappers-only (no projectiles, recoil x2.8): tight cells + low ceilings
//     keep melee chases short and lethal.
//   - fire-hazard (interval 2.4s): multi-platform verticality lets players
//     hop levels to avoid patches. Floor patches don't deny the whole arena
//     because the upper platforms are independent paths.
//   - random-shapes / max-recoil: cosmetic / movement-tuning. No specific
//     layout dependency.
//
// What this file does NOT do anymore
//   - Pickups. JAKESJAM is rogue-lite now: between-rounds card draft handles
//     all progression. The pickup-related types and helpers below are
//     intentionally left in place so the schema stays additive — but the
//     base `boxworks.pickups` array is empty and `expandMap` produces no
//     pickups in the world.

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

export const WORLD_COLUMNS = 3;
export const WORLD_ROWS = 2;
export const WORLD_COLUMNS_LARGE = 4;
export const WORLD_ROWS_LARGE = 2;
export const VERTICAL_SHAFT_WIDTH = 150;
export const CARD_CACHE_RESPAWN_MS = 20000;
export const ROAMING_CARD_CACHE_COUNT = 7;

// ---------------------------------------------------------------------------
// Base 1-cell Boxworks layout. The world is built by tiling and varying this
// across `WORLD_COLUMNS * WORLD_ROWS` cells.
//
// `spawns` here are "fallback" anchors — `expandMap` actually pulls the per-
// cell spawn anchors from each chosen `CellLayout.spawns`. Keep this array
// non-empty so MatchScene's spawn picker has something to fall back to even
// if expansion is bypassed.
// ---------------------------------------------------------------------------

export const boxworks: BoxworksMapDefinition = {
  id: "boxworks",
  name: "Boxworks",
  size: { x: 960, y: 540 },
  spawns: [
    // Six anchor points. Distributed: corners + mid-top + mid-bottom. Each
    // sits within 50 px above a platform top so a fresh player lands cleanly.
    { x: 200, y: 430 },
    { x: 760, y: 430 },
    { x: 240, y: 250 },
    { x: 720, y: 250 },
    { x: 480, y: 380 },
    { x: 480, y: 180 },
  ],
  platforms: [
    // Floor + side walls.
    { id: "floor", kind: "floor", position: { x: 480, y: 492 }, size: { x: 880, y: 32 } },
    { id: "left-wall", kind: "wall", position: { x: 34, y: 270 }, size: { x: 28, y: 460 } },
    { id: "right-wall", kind: "wall", position: { x: 926, y: 270 }, size: { x: 28, y: 460 } },
    // Lower ledges — the jump-up tier. Edges are within max horizontal speed
    // of the floor so non-jetpack players can step up.
    { id: "left-low", kind: "platform", position: { x: 200, y: 400 }, size: { x: 200, y: 22 } },
    { id: "right-low", kind: "platform", position: { x: 760, y: 400 }, size: { x: 200, y: 22 } },
    // Mid bridges — the primary fight tier. The center mid is shaft-split.
    { id: "center-mid", kind: "platform", position: { x: 480, y: 308 }, size: { x: 280, y: 20 } },
    // Upper perches — jetpack-required (≥150 px above mid). Two of them so
    // there's no single dominant high ground.
    { id: "left-high", kind: "platform", position: { x: 220, y: 196 }, size: { x: 180, y: 18 } },
    { id: "right-high", kind: "platform", position: { x: 740, y: 196 }, size: { x: 180, y: 18 } },
  ],
  destructibles: [
    // 5 destructibles per cell. Placed against established choke points:
    //  - barrel-a: center-mid bridge approach. Explosive — punishes campers.
    //  - box-a:    left-low ledge edge cover.
    //  - cube-a:   right-low ledge edge cover (heavier, harder to break).
    //  - mine-a:   floor near right spawn — anti-rush deterrent.
    //  - barrel-b: mid-air cover under center bridge to break line of fire
    //              from one ledge to the other.
    { id: "barrel-a", kind: "barrel", health: 35, position: { x: 480, y: 268 }, size: { x: 28, y: 38 }, explosive: true, flammable: true },
    { id: "box-a",    kind: "box",    health: 45, position: { x: 300, y: 360 }, size: { x: 40, y: 40 }, explosive: false, flammable: true },
    { id: "cube-a",   kind: "cube",   health: 70, position: { x: 660, y: 360 }, size: { x: 42, y: 42 }, explosive: false, flammable: false },
    { id: "mine-a",   kind: "mine",   health: 10, position: { x: 600, y: 470 }, size: { x: 24, y: 12 }, explosive: true, flammable: false },
    { id: "barrel-b", kind: "barrel", health: 35, position: { x: 480, y: 430 }, size: { x: 28, y: 38 }, explosive: true, flammable: true },
  ],
  // Pickups removed — JAKESJAM is going rogue-lite with all build progression
  // happening at the between-rounds card draft instead of arena pickups.
  pickups: [],
};

// ---------------------------------------------------------------------------
// Layout primitives. CELL_LAYOUTS is a deterministic palette from which
// `expandMap` draws to vary cells across the tiled world.
//
// Each layout aims for:
//   - 5-7 platforms covering low/mid/high tiers
//   - 4-6 spawn anchors distributed corners + mid
//   - Max ~360 px unbroken horizontal sightline per tier
//   - At least one jetpack-only ledge (≥160 px above the next-down platform)
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
    // Two-tier interlocked ledges with a center mid bridge and a high perch.
    // Spawns hug the cell edges so the bridge fight stays clean.
    name: "broken-lanes",
    platforms: [
      { id: "left-low", position: { x: 180, y: 402 }, size: { x: 220, y: 22 } },
      { id: "right-low", position: { x: 770, y: 402 }, size: { x: 220, y: 22 } },
      { id: "left-mid", position: { x: 290, y: 286 }, size: { x: 170, y: 18 } },
      { id: "right-mid", position: { x: 670, y: 286 }, size: { x: 170, y: 18 } },
      { id: "center-bridge", position: { x: 480, y: 348 }, size: { x: 220, y: 18 } },
      { id: "high-perch", position: { x: 480, y: 184 }, size: { x: 200, y: 18 } },
    ],
    spawns: [
      { x: 170, y: 362 },
      { x: 770, y: 362 },
      { x: 290, y: 246 },
      { x: 670, y: 246 },
      { x: 480, y: 144 },
      { x: 480, y: 460 },
    ],
  },
  {
    // Diagonal stairwell — every platform reachable via running jumps. No
    // jetpack required to traverse this cell, but the high-right perch
    // commands the column above (in the next row up) so jetpacking up still
    // matters.
    name: "stairwell",
    platforms: [
      { id: "low-left-step", position: { x: 170, y: 426 }, size: { x: 180, y: 20 } },
      { id: "mid-left-step", position: { x: 330, y: 332 }, size: { x: 160, y: 18 } },
      { id: "mid-right-step", position: { x: 630, y: 268 }, size: { x: 160, y: 18 } },
      { id: "high-right-step", position: { x: 790, y: 196 }, size: { x: 170, y: 18 } },
      { id: "top-left-perch", position: { x: 200, y: 184 }, size: { x: 150, y: 16 } },
      { id: "low-right-pad", position: { x: 760, y: 416 }, size: { x: 170, y: 20 } },
    ],
    spawns: [
      { x: 170, y: 386 },
      { x: 330, y: 292 },
      { x: 630, y: 228 },
      { x: 790, y: 156 },
      { x: 200, y: 144 },
      { x: 760, y: 376 },
    ],
  },
  {
    // Bowl arena: high rim platforms on both sides + low pockets. The top
    // needle is jetpack-only and acts as a riskier high-ground than the rims.
    name: "bowl",
    platforms: [
      { id: "left-rim", position: { x: 195, y: 318 }, size: { x: 230, y: 20 } },
      { id: "right-rim", position: { x: 765, y: 318 }, size: { x: 230, y: 20 } },
      { id: "low-left-pocket", position: { x: 295, y: 422 }, size: { x: 180, y: 20 } },
      { id: "low-right-pocket", position: { x: 665, y: 422 }, size: { x: 180, y: 20 } },
      { id: "top-needle", position: { x: 480, y: 168 }, size: { x: 200, y: 18 } },
      { id: "mid-step", position: { x: 480, y: 376 }, size: { x: 140, y: 16 } },
    ],
    spawns: [
      { x: 195, y: 278 },
      { x: 765, y: 278 },
      { x: 295, y: 382 },
      { x: 665, y: 382 },
      { x: 480, y: 128 },
      { x: 480, y: 336 },
    ],
  },
  {
    // Floating islands — mostly mid-tier, with two upper offsets. Encourages
    // jetpack hopping and aerial duels.
    name: "islands",
    platforms: [
      { id: "left-island", position: { x: 175, y: 296 }, size: { x: 160, y: 18 } },
      { id: "left-low-island", position: { x: 320, y: 416 }, size: { x: 180, y: 20 } },
      { id: "right-island", position: { x: 785, y: 296 }, size: { x: 160, y: 18 } },
      { id: "right-low-island", position: { x: 640, y: 416 }, size: { x: 180, y: 20 } },
      { id: "upper-left", position: { x: 295, y: 200 }, size: { x: 150, y: 16 } },
      { id: "upper-right", position: { x: 665, y: 200 }, size: { x: 150, y: 16 } },
      { id: "center-anchor", position: { x: 480, y: 350 }, size: { x: 130, y: 16 } },
    ],
    spawns: [
      { x: 175, y: 256 },
      { x: 785, y: 256 },
      { x: 320, y: 376 },
      { x: 640, y: 376 },
      { x: 295, y: 160 },
      { x: 665, y: 160 },
    ],
  },
  {
    // Crossfire: asymmetric. One side has a wide low ledge, the other has a
    // wide high ledge. The mirror salt in expandMap flips which side is which
    // per cell, so back-to-back cells never feel identical.
    name: "crossfire",
    platforms: [
      { id: "left-wide-low", position: { x: 230, y: 408 }, size: { x: 280, y: 20 } },
      { id: "right-wide-high", position: { x: 730, y: 240 }, size: { x: 280, y: 18 } },
      { id: "left-short-high", position: { x: 220, y: 196 }, size: { x: 140, y: 16 } },
      { id: "right-short-low", position: { x: 740, y: 410 }, size: { x: 150, y: 20 } },
      { id: "center-bridge", position: { x: 480, y: 320 }, size: { x: 200, y: 18 } },
      { id: "low-mid-step", position: { x: 480, y: 440 }, size: { x: 140, y: 16 } },
    ],
    spawns: [
      { x: 230, y: 368 },
      { x: 730, y: 200 },
      { x: 220, y: 156 },
      { x: 740, y: 370 },
      { x: 480, y: 280 },
      { x: 480, y: 400 },
    ],
  },
  {
    // Tight nest — closer-quarters cell tuned for slappers/melee chaos. All
    // platforms within ~120 px of each other, encouraging shotgun-range duels
    // and short jetpack hops.
    name: "tight-nest",
    platforms: [
      { id: "low-left", position: { x: 200, y: 430 }, size: { x: 180, y: 20 } },
      { id: "low-right", position: { x: 760, y: 430 }, size: { x: 180, y: 20 } },
      { id: "mid-left-cap", position: { x: 280, y: 312 }, size: { x: 150, y: 18 } },
      { id: "mid-right-cap", position: { x: 680, y: 312 }, size: { x: 150, y: 18 } },
      { id: "center-floor", position: { x: 480, y: 376 }, size: { x: 200, y: 18 } },
      { id: "ceiling-cap", position: { x: 480, y: 192 }, size: { x: 240, y: 18 } },
    ],
    spawns: [
      { x: 200, y: 390 },
      { x: 760, y: 390 },
      { x: 280, y: 272 },
      { x: 680, y: 272 },
      { x: 480, y: 152 },
      { x: 480, y: 336 },
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
 *
 * The climb ledges are intentionally staggered left/right at three different
 * depths inside the shaft so a player can't sit at the top of one and shoot
 * straight down a column — the ledges break vertical line-of-sight between
 * rows, which keeps the row-to-row vertical shaft from becoming a sniper lane.
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

  // Roaming card caches disabled — rogue-lite picker handles card progression.
  // (Helper kept in case we want a Risk-of-Rain style optional pickup later.)
  void addRoamingCardCaches;
  void worldSize;
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
// The fully expanded Boxworks worlds. `boxworksWorld` is the default map both
// client prediction and authoritative server collision consume today.
// `boxworksLargeWorld` is provided for high-population sessions (8-10 players)
// — it shares all geometry primitives, just one extra column wide.
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
