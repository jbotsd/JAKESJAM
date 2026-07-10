// InterestGrid — per-tick spatial filter for snapshot AOI (Area of Interest).
//
// DESIGN ASSUMPTION (delta-codec compatibility):
//   This filter runs BEFORE any per-client delta encoding in MatchHost.tick.
//   The delta encoder receives an already-filtered WorldState and diffs it
//   against THAT RECIPIENT's per-client baseline. The baseline ring must
//   therefore store filtered snapshots, not full-world ones. When the
//   delta-snapshot agent lands, MatchHost.tick order will be:
//     1. grid.rebuild(fullState)
//     2. filteredState = buildFilteredSnap(fullState, recipientPlayerId)
//     3. delta = deltaEncode(filteredState, clientBaseline[recipientPlayerId])
//     4. clientBaseline[recipientPlayerId] = filteredState  ← store filtered
//   This file is responsible for steps 1-2 only; steps 3-4 are out of scope.
//
// FishNet-inspired grid observer pattern. The grid is rebuilt from scratch each
// tick snapshot (20× per second at SNAPSHOT_INTERVAL_TICKS=3 @ 60Hz).
// Rebuild cost is O(E) where E = total entity count; observe cost is O(R²) where
// R = OBSERVE_RADIUS_CELLS (typically 2, giving a 5×5 neighbourhood = 25 cells).

import type {
  EntityId,
  PlayerId,
  WorldState,
} from "@sim/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Spatial cell side length in pixels. ~one screen width for a 1920-wide display
 *  halved: large enough to avoid constant cell changes on fast-moving players,
 *  small enough to give meaningful filtering. */
export const CELL_SIZE_PX = 320;

/** Chebyshev radius of cells each observer sees around their own cell.
 *  Radius 2 → 5×5 neighbourhood = 25 cells = ~1600×1600 px observation window.
 *  Generous enough that entities on the far edge of the screen are always
 *  visible, even accounting for inter-snapshot movement. */
export const OBSERVE_RADIUS_CELLS = 2;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Cell = { cx: number; cy: number };

export type ObservedSets = {
  playerIds: Set<PlayerId>;
  projectileIds: Set<EntityId>;
  destructibleIds: Set<EntityId>;
  firePatchIds: Set<EntityId>;
  pickupIds: Set<EntityId>;
  satelliteIds: Set<EntityId>;
};

// ---------------------------------------------------------------------------
// InterestGrid
// ---------------------------------------------------------------------------

export class InterestGrid {
  private readonly cols: number;
  private readonly rows: number;

  // Per-collection bins keyed by `"cx,cy"` strings.
  // Using Map<string, Set<...>> is noUncheckedIndexedAccess-safe.
  private readonly projectileBins = new Map<string, Set<EntityId>>();
  private readonly destructibleBins = new Map<string, Set<EntityId>>();
  private readonly firePatchBins = new Map<string, Set<EntityId>>();
  private readonly pickupBins = new Map<string, Set<EntityId>>();
  private readonly satelliteBins = new Map<string, Set<EntityId>>();

  constructor(
    private readonly worldW: number,
    private readonly worldH: number,
    private readonly cellSize: number,
  ) {
    // Ceiling so a world that doesn't divide evenly still has a valid last cell.
    this.cols = Math.max(1, Math.ceil(worldW / cellSize));
    this.rows = Math.max(1, Math.ceil(worldH / cellSize));
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Reset & rebuild from current world state. Call once per snapshot tick,
   * before any per-recipient `observed()` calls.
   */
  rebuild(state: WorldState): void {
    this.projectileBins.clear();
    this.destructibleBins.clear();
    this.firePatchBins.clear();
    this.pickupBins.clear();
    this.satelliteBins.clear();

    for (const [idStr, proj] of Object.entries(state.projectiles)) {
      const id = Number(idStr) as EntityId;
      this.insertEntity(this.projectileBins, proj.x, proj.y, id);
    }
    for (const [idStr, dest] of Object.entries(state.destructibles)) {
      const id = Number(idStr) as EntityId;
      this.insertEntity(this.destructibleBins, dest.x, dest.y, id);
    }
    for (const [idStr, fire] of Object.entries(state.firePatches)) {
      const id = Number(idStr) as EntityId;
      this.insertEntity(this.firePatchBins, fire.x, fire.y, id);
    }
    for (const [idStr, pickup] of Object.entries(state.pickups)) {
      const id = Number(idStr) as EntityId;
      this.insertEntity(this.pickupBins, pickup.x, pickup.y, id);
    }
    for (const [idStr, sat] of Object.entries(state.satellites)) {
      const id = Number(idStr) as EntityId;
      // Satellite world position: owner.x + cos(angle)*orbitRadius.
      // We store the owner lookup in the grid using the satellite's owner
      // position when available; fall back to (0,0) for orphaned sats.
      // The ownerId position is NOT looked up here to keep rebuild O(E) — we
      // use the satellite's orbit parameters to approximate position instead,
      // which is accurate within one orbit-radius unit (always < CELL_SIZE_PX
      // given typical orbit radii of ~60-100px).
      const approxX = sat.orbitRadius * Math.cos(sat.angle);
      const approxY = sat.orbitRadius * Math.sin(sat.angle);
      // Position is relative to owner; we don't have owner x/y here without a
      // second pass. Use a sentinel (0,0) approximation: satellites always end
      // up in the owner's observed neighbourhood anyway since the owner IS a
      // player and v1 includes ALL players. This field is therefore filtered
      // only against the high-cardinality collections. If we later filter
      // players too, we'd need owner position here.
      this.insertEntity(this.satelliteBins, approxX, approxY, id);
      // Suppress TS unused-var for orbit computation (kept for correctness doc).
      void approxX; void approxY;
    }

    // Satellites: re-insert using actual owner positions if available.
    // Replace the orbit-angle approximation above with precise owner x/y lookup.
    this.satelliteBins.clear();
    for (const [idStr, sat] of Object.entries(state.satellites)) {
      const id = Number(idStr) as EntityId;
      const owner = sat.ownerId !== null ? state.players[sat.ownerId] : undefined;
      const sx = owner ? owner.x + Math.cos(sat.angle) * sat.orbitRadius : 0;
      const sy = owner ? owner.y + Math.sin(sat.angle) * sat.orbitRadius : 0;
      this.insertEntity(this.satelliteBins, sx, sy, id);
    }
  }

  /**
   * Returns the set of cells in the Chebyshev neighbourhood of `(x, y)` with
   * the given radius. Observer position is in world pixels. Cells that lie
   * outside the world bounds are clamped (so corner observers still get valid
   * cells, never out-of-range keys).
   */
  cellsAround(x: number, y: number, radius: number): Cell[] {
    const cx = this.worldToCellX(x);
    const cy = this.worldToCellY(y);
    const cells: Cell[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = Math.max(0, Math.min(this.cols - 1, cx + dx));
        const ny = Math.max(0, Math.min(this.rows - 1, cy + dy));
        // Deduplicate: when observer is near a corner, multiple (dx,dy) pairs
        // clamp to the same cell. Use a simple coord-equality filter.
        if (!cells.some((c) => c.cx === nx && c.cy === ny)) {
          cells.push({ cx: nx, cy: ny });
        }
      }
    }
    return cells;
  }

  /**
   * Returns all entity ids present in the given cells, across every collection
   * tracked by the grid. Players are NOT tracked in the grid (v1 keeps all
   * players in every snapshot; see module doc).
   */
  observed(cells: Cell[]): ObservedSets {
    const projectileIds = new Set<EntityId>();
    const destructibleIds = new Set<EntityId>();
    const firePatchIds = new Set<EntityId>();
    const pickupIds = new Set<EntityId>();
    const satelliteIds = new Set<EntityId>();

    for (const { cx, cy } of cells) {
      const key = cellKey(cx, cy);
      collectInto(this.projectileBins, key, projectileIds);
      collectInto(this.destructibleBins, key, destructibleIds);
      collectInto(this.firePatchBins, key, firePatchIds);
      collectInto(this.pickupBins, key, pickupIds);
      collectInto(this.satelliteBins, key, satelliteIds);
    }

    // playerIds is always empty here — callers should include all players.
    return {
      playerIds: new Set<PlayerId>(),
      projectileIds,
      destructibleIds,
      firePatchIds,
      pickupIds,
      satelliteIds,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private worldToCellX(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
  }

  private worldToCellY(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
  }

  private insertEntity(
    bins: Map<string, Set<EntityId>>,
    x: number,
    y: number,
    id: EntityId,
  ): void {
    const cx = this.worldToCellX(x);
    const cy = this.worldToCellY(y);
    const key = cellKey(cx, cy);
    let bin = bins.get(key);
    if (!bin) {
      bin = new Set<EntityId>();
      bins.set(key, bin);
    }
    bin.add(id);
  }
}

// ---------------------------------------------------------------------------
// Module-private utilities
// ---------------------------------------------------------------------------

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function collectInto(
  bins: Map<string, Set<EntityId>>,
  key: string,
  out: Set<EntityId>,
): void {
  const bin = bins.get(key);
  if (!bin) return;
  for (const id of bin) {
    out.add(id);
  }
}
