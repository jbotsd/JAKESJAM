import { describe, test, expect, beforeEach } from "bun:test";
import { InterestGrid, CELL_SIZE_PX, OBSERVE_RADIUS_CELLS } from "../InterestGrid.ts";
import type { PlayerEntity, WorldState } from "@sim/types.ts";
import { EntityId, InputSeq, PlayerId, Tick } from "@sim/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal WorldState for AOI tests. Only entity position and id matter. */
function makeState(
  overrides: Partial<{
    projectiles: WorldState["projectiles"];
    destructibles: WorldState["destructibles"];
    firePatches: WorldState["firePatches"];
    pickups: WorldState["pickups"];
    satellites: WorldState["satellites"];
    players: WorldState["players"];
  }> = {},
): WorldState {
  return {
    tick: Tick(0),
    rngState: 0,
    players: overrides.players ?? {},
    projectiles: overrides.projectiles ?? {},
    destructibles: overrides.destructibles ?? {},
    firePatches: overrides.firePatches ?? {},
    pickups: overrides.pickups ?? {},
    satellites: overrides.satellites ?? {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

function projectile(id: number, x: number, y: number): WorldState["projectiles"] {
  return {
    [EntityId(id)]: {
      id: EntityId(id),
      ownerId: PlayerId("p1"),
      x,
      y,
      vx: 0,
      vy: 0,
      shape: "circle",
      radius: 8,
      damage: 10,
      lifetimeMs: 2000,
      pathing: "straight",
      element: "neutral",
      bouncesRemaining: 0,
      pierceRemaining: 0,
    },
  };
}

function player(id: string, x: number, y: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x,
    aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
  };
}

function satellite(
  id: number,
  ownerId: string,
  angle: number,
  orbitRadius: number,
): WorldState["satellites"] {
  return {
    [EntityId(id)]: {
      id: EntityId(id),
      ownerId: PlayerId(ownerId),
      angle,
      orbitRadius,
      fireCooldownMs: 0,
      lifetimeMs: Infinity,
    },
  };
}

function pickup(id: number, x: number, y: number): WorldState["pickups"] {
  return {
    [EntityId(id)]: {
      id: EntityId(id),
      kind: "health-shard",
      x,
      y,
      radius: 12,
      amount: 25,
      active: true,
      respawnAtTick: Tick(0),
    },
  };
}

// World size for tests: 960×540 (one Boxworks cell = 3 columns wide default)
const WORLD_W = 960;
const WORLD_H = 540;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InterestGrid", () => {
  let grid: InterestGrid;

  beforeEach(() => {
    grid = new InterestGrid(WORLD_W, WORLD_H, CELL_SIZE_PX);
  });

  test("empty grid returns empty sets", () => {
    grid.rebuild(makeState());
    const cells = grid.cellsAround(480, 270, OBSERVE_RADIUS_CELLS);
    const obs = grid.observed(cells);
    expect(obs.projectileIds.size).toBe(0);
    expect(obs.destructibleIds.size).toBe(0);
    expect(obs.firePatchIds.size).toBe(0);
    expect(obs.pickupIds.size).toBe(0);
    expect(obs.satelliteIds.size).toBe(0);
    // players are never in the grid (v1 always sends all)
    expect(obs.playerIds.size).toBe(0);
  });

  test("nearby entity observed from center", () => {
    // CELL_SIZE_PX=320 → cell (1,0) covers x=[320,640), y=[0,320).
    // Observer at (480,270) is in cell (1,0). Entity at (480,100) is also in (1,0).
    const state = makeState({
      projectiles: projectile(1, 480, 100),
    });
    grid.rebuild(state);
    const cells = grid.cellsAround(480, 270, OBSERVE_RADIUS_CELLS);
    const obs = grid.observed(cells);
    expect(obs.projectileIds.has(EntityId(1))).toBe(true);
  });

  test("far entity not observed with radius 1", () => {
    // Entity at far right edge of world (x=900) — cell (2,0).
    // Observer at (0,0) — cell (0,0). With radius=1 the neighbourhood is
    // cells (0,0),(1,0),(0,1),(1,1) only. Cell (2,0) is excluded.
    const state = makeState({
      projectiles: projectile(2, 900, 100),
    });
    grid.rebuild(state);
    const cells = grid.cellsAround(0, 0, 1);
    const obs = grid.observed(cells);
    expect(obs.projectileIds.has(EntityId(2))).toBe(false);
  });

  test("10 entities — only nearby ones returned", () => {
    // Place 5 entities close to (480, 270) and 5 far away.
    const nearby = { ...projectile(1, 480, 270), ...projectile(2, 500, 280), ...projectile(3, 460, 260), ...projectile(4, 510, 250), ...projectile(5, 470, 290) };
    const far = { ...pickup(6, 900, 500), ...pickup(7, 920, 510), ...pickup(8, 890, 490), ...pickup(9, 910, 520), ...pickup(10, 880, 480) };
    const state = makeState({
      projectiles: nearby,
      pickups: far,
    });
    grid.rebuild(state);
    // Observer at world center; radius 1 keeps cells (0-2)×(0-1) at most.
    // 480/320=1, 270/320=0. With radius=1: cx=0..2, cy=0..1 → full world for 960×540.
    // Use radius=0 (single cell) to get only the center cell.
    const cells = grid.cellsAround(480, 270, 0);
    const obs = grid.observed(cells);

    // All 5 nearby projectiles are in cell (1,0) [x=320-640, y=0-320]
    expect(obs.projectileIds.has(EntityId(1))).toBe(true);
    expect(obs.projectileIds.has(EntityId(2))).toBe(true);
    expect(obs.projectileIds.has(EntityId(3))).toBe(true);
    expect(obs.projectileIds.has(EntityId(4))).toBe(true);
    expect(obs.projectileIds.has(EntityId(5))).toBe(true);

    // Far pickups (x≈900, y≈500) → cell (2,1) — not in radius=0 neighbourhood
    expect(obs.pickupIds.has(EntityId(6))).toBe(false);
    expect(obs.pickupIds.has(EntityId(7))).toBe(false);
  });

  test("entity exactly on cell boundary falls into the lower cell", () => {
    // x=320 is the boundary between cells 0 and 1.
    // floor(320 / 320) = 1 → falls into cell (1, 0).
    const state = makeState({
      projectiles: projectile(11, 320, 100),
    });
    grid.rebuild(state);
    // Observer in cell (1,0) with radius=0 should see it.
    const cells = grid.cellsAround(480, 100, 0);
    const obs = grid.observed(cells);
    expect(obs.projectileIds.has(EntityId(11))).toBe(true);
  });

  test("entity at x=319 falls into cell 0", () => {
    // floor(319 / 320) = 0 → cell (0,0)
    const state = makeState({
      projectiles: projectile(12, 319, 100),
    });
    grid.rebuild(state);
    // Observer in cell (0,0) at (100,100) with radius=0 sees it.
    const cellsIn0 = grid.cellsAround(100, 100, 0);
    const obs0 = grid.observed(cellsIn0);
    expect(obs0.projectileIds.has(EntityId(12))).toBe(true);

    // Observer in cell (1,0) at (480,100) with radius=0 does NOT see it.
    const cellsIn1 = grid.cellsAround(480, 100, 0);
    const obs1 = grid.observed(cellsIn1);
    expect(obs1.projectileIds.has(EntityId(12))).toBe(false);
  });

  test("observer at world corner — cellsAround clamps and deduplicates", () => {
    // Observer at (-10, -10) should clamp to cell (0,0) only.
    const cells = grid.cellsAround(-10, -10, OBSERVE_RADIUS_CELLS);
    // All cells in the neighbourhood clamp to (0,0) since we're in the corner.
    // After dedup there should be at most cols×rows unique cells, all >= (0,0).
    for (const { cx, cy } of cells) {
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cy).toBeGreaterThanOrEqual(0);
    }
    // No duplicates
    const keys = cells.map((c) => `${c.cx},${c.cy}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  test("observer outside world bounds (far right) clamps to last column", () => {
    const cols = Math.ceil(WORLD_W / CELL_SIZE_PX); // 3
    const cells = grid.cellsAround(WORLD_W + 9999, 270, OBSERVE_RADIUS_CELLS);
    for (const { cx } of cells) {
      expect(cx).toBeLessThanOrEqual(cols - 1);
    }
  });

  test("rebuild is idempotent — second rebuild clears first", () => {
    const state1 = makeState({ projectiles: projectile(20, 480, 270) });
    grid.rebuild(state1);
    const state2 = makeState({}); // no projectiles
    grid.rebuild(state2);
    const cells = grid.cellsAround(480, 270, OBSERVE_RADIUS_CELLS);
    const obs = grid.observed(cells);
    expect(obs.projectileIds.has(EntityId(20))).toBe(false);
  });

  test("CELL_SIZE_PX and OBSERVE_RADIUS_CELLS constants have expected values", () => {
    expect(CELL_SIZE_PX).toBe(320);
    expect(OBSERVE_RADIUS_CELLS).toBe(2);
  });

  test("satellite is binned by owner position + orbit offset, not orbit angle alone (perf audit N3)", () => {
    // Owner sits far from the world origin; if the satellite were binned
    // using only its orbit-relative offset (the old, wasted first pass),
    // it would land near cell (0,0) instead of near the owner.
    const owner = player("p1", 900, 500);
    const state = makeState({
      players: { [PlayerId("p1")]: owner },
      satellites: satellite(30, "p1", 0, 50), // angle=0 → offset (+50, 0)
    });
    grid.rebuild(state);
    // Satellite world position ≈ (950, 500) — cell (2,1) for a 960×540 world.
    const cellsNearOwner = grid.cellsAround(950, 500, 0);
    expect(grid.observed(cellsNearOwner).satelliteIds.has(EntityId(30))).toBe(true);
    // Cell (0,0), where the discarded orbit-only approximation would have
    // placed it, must NOT see it.
    const cellsAtOrigin = grid.cellsAround(0, 0, 0);
    expect(grid.observed(cellsAtOrigin).satelliteIds.has(EntityId(30))).toBe(false);
  });

  test("orphaned satellite (ownerId null) falls back to (0,0) without throwing", () => {
    const state = makeState({
      satellites: {
        [EntityId(31)]: {
          id: EntityId(31),
          ownerId: null,
          angle: 0,
          orbitRadius: 50,
          fireCooldownMs: 0,
          lifetimeMs: Infinity,
        },
      },
    });
    expect(() => grid.rebuild(state)).not.toThrow();
    const cells = grid.cellsAround(0, 0, 0);
    expect(grid.observed(cells).satelliteIds.has(EntityId(31))).toBe(true);
  });

  describe("isFullCoverage (perf audit N2)", () => {
    test("a map small enough that radius already spans the whole grid is full-coverage", () => {
      // 960×540 at CELL_SIZE_PX=320 → 3×2 cells; radius 2 spans 5×5.
      expect(grid.isFullCoverage(2)).toBe(true);
      // Even radius 1 (3×3 span) already covers a 3×2 grid.
      expect(grid.isFullCoverage(1)).toBe(true);
    });

    test("a large map is NOT full-coverage at the production radius", () => {
      const bigGrid = new InterestGrid(6000, 6000, CELL_SIZE_PX);
      expect(bigGrid.isFullCoverage(OBSERVE_RADIUS_CELLS)).toBe(false);
    });

    test("radius 0 is only full-coverage for a single-cell map", () => {
      expect(grid.isFullCoverage(0)).toBe(false);
      const oneCell = new InterestGrid(200, 200, CELL_SIZE_PX);
      expect(oneCell.isFullCoverage(0)).toBe(true);
    });
  });
});
