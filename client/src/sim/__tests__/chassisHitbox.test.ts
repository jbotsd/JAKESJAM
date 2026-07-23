// cohesion-goal.md P1.4 (contested call #1, own commit, flagged): the
// combat hitbox scales by the chassis sizeScale — Kindled is a genuinely
// bigger target, Interstice genuinely smaller, Geometrician byte-identical
// to the pre-scaling box. Movement collision stays uniform (player.zig
// parity untouched) — these tests cover the COMBAT box only, which is
// exactly the box every hit path consumes (projectile sweep, hitscan
// candidate list, melee arc, dash-bash overlap all call playerHitboxAABB).

import { describe, expect, test } from "bun:test";
import {
  CLASS_HITBOX_SCALE_ENABLED,
  PLAYER_BODY_WIDTH,
  PLAYER_BODY_HEIGHT,
  HEADSHOT_ZONE_FRAC,
  playerHitboxAABB,
  isHeadshot,
} from "../player.js";
import type { CharacterArchetype } from "../types.js";

const at = (characterId?: CharacterArchetype, crouching = false) => ({
  x: 400,
  y: 300,
  crouching,
  ...(characterId ? { characterId } : {}),
});

describe("P1.4 — class-scaled combat hitbox", () => {
  test("the flag is ON (flip CLASS_HITBOX_SCALE_ENABLED to revert, then this test)", () => {
    expect(CLASS_HITBOX_SCALE_ENABLED).toBe(true);
  });

  test("Geometrician (scale 1) is byte-identical to the unscaled home-base box", () => {
    expect(playerHitboxAABB(at("balanced"))).toEqual(playerHitboxAABB(at(undefined)));
    expect(playerHitboxAABB(at("balanced"))).toEqual({
      x: 400 - PLAYER_BODY_WIDTH / 2,
      y: 300 - PLAYER_BODY_HEIGHT / 2,
      w: PLAYER_BODY_WIDTH,
      h: PLAYER_BODY_HEIGHT,
    });
  });

  test("Kindled's box is strictly larger, Interstice's strictly smaller, both centred", () => {
    const geo = playerHitboxAABB(at("balanced"));
    const kin = playerHitboxAABB(at("heavy"));
    const int = playerHitboxAABB(at("sprinter"));
    expect(kin.w).toBeCloseTo(geo.w * 1.18, 5);
    expect(kin.h).toBeCloseTo(geo.h * 1.18, 5);
    expect(int.w).toBeCloseTo(geo.w * 0.92, 5);
    expect(int.h).toBeCloseTo(geo.h * 0.92, 5);
    // Centred on the same x/y: centres agree even though extents differ.
    for (const box of [geo, kin, int]) {
      expect(box.x + box.w / 2).toBeCloseTo(400, 5);
      expect(box.y + box.h / 2).toBeCloseTo(300, 5);
    }
  });

  test("the graze: a point just past Geometrician's head edge is INSIDE Kindled's box at the same spot", () => {
    // This point-in-box check IS the sweep's hit test — projectile.ts /
    // World.ts overlap the returned AABB directly, so containment here is
    // containment in play.
    const geo = playerHitboxAABB(at("balanced"));
    const kin = playerHitboxAABB(at("heavy"));
    const grazeY = geo.y - 2; // 2px above the Geometrician box top
    const inBox = (box: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
      px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
    expect(inBox(geo, 400, grazeY)).toBe(false);
    expect(inBox(kin, 400, grazeY)).toBe(true);
    // And the mirror: a shot inside Geometrician's edge MISSES Interstice.
    const int = playerHitboxAABB(at("sprinter"));
    const edgeY = geo.y + 1; // 1px inside the Geometrician box top
    expect(inBox(geo, 400, edgeY)).toBe(true);
    expect(inBox(int, 400, edgeY)).toBe(false);
  });

  test("crouch scales with the class too (box stays a single coherent body)", () => {
    const kinStand = playerHitboxAABB(at("heavy", false));
    const kinCrouch = playerHitboxAABB(at("heavy", true));
    expect(kinCrouch.h).toBeLessThan(kinStand.h);
    expect(kinCrouch.w).toBeCloseTo(kinStand.w, 5); // width unaffected by crouch
  });

  test("isHeadshot's band rides the scaled box (same scale source, never detaches)", () => {
    const kin = playerHitboxAABB(at("heavy"));
    const kinBandBottom = kin.y + kin.h * HEADSHOT_ZONE_FRAC;
    // Just inside the scaled band = headshot; just below = not.
    expect(isHeadshot(kinBandBottom - 0.5, at("heavy"))).toBe(true);
    expect(isHeadshot(kinBandBottom + 0.5, at("heavy"))).toBe(false);
    // The same hitY relative to an UNSCALED box would misclassify — proves
    // the band uses the class scale, not the home-base height.
    const geo = playerHitboxAABB(at("balanced"));
    expect(kin.y).toBeLessThan(geo.y); // Kindled's head starts higher
    expect(isHeadshot(kin.y + 1, at("heavy"))).toBe(true); // top of the tall box
  });
});
