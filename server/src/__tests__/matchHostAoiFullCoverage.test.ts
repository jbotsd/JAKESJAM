// Perf audit N2 (2026-07-18) regression test.
//
// On a small map (boxworks-tower is the reported case), the InterestGrid's
// observe radius already spans the whole grid from any cell — AOI filtering
// is a provable no-op there, but the grid.rebuild()/cellsAround()/observed()/
// filterRecord() pipeline used to run at full cost anyway on EVERY snapshot.
// MatchHost now detects this once (aoiFullCoverage) and short-circuits both
// the grid rebuild and the per-recipient filter to a direct pass-through.
// This test proves: (1) the flag is set correctly for small vs large maps,
// (2) buildFilteredSnap returns the SAME state reference (no allocation, no
// filtering) when full-coverage, and (3) it still filters normally — and
// does NOT return the same reference — on a large map.
import { describe, test, expect } from "bun:test";
import { MatchHost } from "../matchHost.ts";
import type { MapDefinition, PlayerSpawnInfo, WorldState } from "@sim/types.ts";
import { PlayerId } from "@sim/types.ts";

const PID = PlayerId("p1");

function makeSpawn(): PlayerSpawnInfo {
  return { playerId: PID, characterId: "balanced", weaponId: "starter-pistol", color: "#ff0000", name: "P1" };
}

function makeMap(id: string, sizeX: number, sizeY: number): MapDefinition {
  return {
    id,
    name: id,
    size: { x: sizeX, y: sizeY },
    spawns: [{ x: sizeX / 2, y: sizeY / 2 }],
    platforms: [{ id: "floor", kind: "floor", position: { x: 0, y: sizeY - 40 }, size: { x: sizeX, y: 40 } }],
  };
}

type HostInternals = {
  aoiFullCoverage: boolean;
  state: WorldState;
  buildFilteredSnap(state: WorldState, recipientId: string, debugAoi: boolean): WorldState;
};

describe("MatchHost AOI full-coverage short-circuit (perf audit N2)", () => {
  test("a small map (like boxworks-tower) is detected as full-coverage", () => {
    // 1280×720 at CELL_SIZE_PX=320 → 4×3 cells; OBSERVE_RADIUS_CELLS=2 spans 5×5.
    const smallMap = makeMap("small-arena", 1280, 720);
    const host = new MatchHost("test-small", [makeSpawn()], [], smallMap);
    const internals = host as unknown as HostInternals;
    expect(internals.aoiFullCoverage).toBe(true);
  });

  test("a large map is NOT full-coverage", () => {
    const bigMap = makeMap("big-arena", 6000, 6000);
    const host = new MatchHost("test-big", [makeSpawn()], [], bigMap);
    const internals = host as unknown as HostInternals;
    expect(internals.aoiFullCoverage).toBe(false);
  });

  test("buildFilteredSnap on a full-coverage map returns the SAME reference (no filtering work)", () => {
    const smallMap = makeMap("small-arena-2", 1280, 720);
    const host = new MatchHost("test-small-2", [makeSpawn()], [], smallMap);
    const internals = host as unknown as HostInternals;
    const result = internals.buildFilteredSnap(internals.state, PID as unknown as string, false);
    expect(result).toBe(internals.state);
  });

  test("buildFilteredSnap on a large map still filters (different reference)", () => {
    const bigMap = makeMap("big-arena-2", 6000, 6000);
    const host = new MatchHost("test-big-2", [makeSpawn()], [], bigMap);
    const internals = host as unknown as HostInternals;
    const result = internals.buildFilteredSnap(internals.state, PID as unknown as string, false);
    expect(result).not.toBe(internals.state);
    // Structurally equivalent for a state with zero entities to filter —
    // this proves the large-map path still produces a correct pass-through
    // result, just via the real filtering code instead of a reference skip.
    expect(result.projectiles).toEqual(internals.state.projectiles);
  });
});
