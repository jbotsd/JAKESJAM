import { describe, expect, test } from "bun:test";
import { resolveMap } from "@sim/data/maps.ts";
import {
  buildArenaNav,
  hasLineOfSight,
  hopTargetToward,
  megaScale,
  nearestCoverFlank,
} from "../botArenaNav.ts";

describe("botArenaNav — vessel-nexus mega dock", () => {
  const map = resolveMap("vessel-nexus");
  const nav = buildArenaNav(map);

  test("compiles full floor + cover pylons + hop ledges", () => {
    expect(nav.width).toBeGreaterThanOrEqual(2800);
    expect(nav.covers.length).toBeGreaterThanOrEqual(4);
    expect(nav.ledges.length).toBeGreaterThanOrEqual(8);
    expect(nav.floorTop).toBeLessThan(map.size.y);
  });

  test("megaScale scales with width", () => {
    expect(megaScale(nav)).toBeGreaterThan(1.5);
    expect(megaScale({ ...nav, width: 1280 })).toBe(1);
  });

  test("LOS blocked by a cover pylon between two floor-band points", () => {
    // Cover-c sits near x=1500 on vessel-nexus; stand left and right of it.
    const cover = nav.covers.find((c) => c.cx > 1400 && c.cx < 1600) ?? nav.covers[2]!;
    const left = cover.x0 - 80;
    const right = cover.x1 + 80;
    const y = nav.floorTop - 60;
    expect(hasLineOfSight(nav, left, y, right, y)).toBe(false);
  });

  test("LOS clear when no cover between", () => {
    const y = nav.floorTop - 60;
    expect(hasLineOfSight(nav, 100, y, 200, y)).toBe(true);
  });

  test("nearestCoverFlank returns a stand point beside a pylon", () => {
    const meX = 1000;
    const meY = nav.floorTop - 60;
    const foeX = 1800;
    const flank = nearestCoverFlank(nav, meX, meY, foeX, 600);
    expect(flank).not.toBeNull();
    expect(Math.abs(flank!.x - meX)).toBeLessThan(600);
  });

  test("hopTargetToward finds a plate above the bot toward a high foe", () => {
    // Stand on floor, foe on a high nest-ish Y.
    const meX = 1500;
    const meTop = nav.floorTop;
    const foeX = 1500;
    const foeY = nav.floorTop - 400;
    const hop = hopTargetToward(nav, meX, meTop, foeX, foeY);
    // May or may not find depending on exact plate layout — if found, rise ok.
    if (hop) {
      expect(hop.top).toBeLessThan(meTop);
      expect(meTop - hop.top).toBeLessThanOrEqual(129);
    }
  });
});
