// Behavioural tests pinning down the player's landing + standing + walking-into-
// terrain behavior. These are the symptoms users actually feel — "I fall through
// terrain", "ground detection flickers" — which the existing collision tests
// (sweep math, single-frame slide) don't catch.
//
// Skill source: sim-tests + game-sim-determinism.
//
// Construction: small inline maps, fixed dt at the real STEP_MS, no
// MapDefinition with the offline-only fields. Each test runs N ticks of a
// scripted input and asserts a behavioural invariant.

import { describe, expect, test } from "bun:test";
import { resolveMoveCached, buildStaticCache, type AABB } from "../collision.js";
import { stepPlayer, freshPlayerMovementMemory } from "../player.js";
import { PlayerId, type PlayerEntity, type InputSeq } from "../types.js";
import type { PlatformDefinition } from "../types.js";

// Map building helper. Centre-origin platforms (matches PlatformDefinition).
function platform(
  id: string,
  kind: "platform" | "floor" | "wall" | "cover",
  cx: number,
  cy: number,
  w: number,
  h: number,
): PlatformDefinition {
  return {
    id,
    // Cast: tests intentionally include "cover" before D1 lands the kind in
    // the type. Once D1 ships, the cast comes off.
    kind: kind as PlatformDefinition["kind"],
    position: { x: cx, y: cy },
    size: { x: w, y: h },
  };
}

// A canonical 1280×640 mini map fragment — floor at y=624 (h=32), single
// thin one-way platform mid-arena, vertical walls to the left/right.
function miniMap(): { platforms: PlatformDefinition[]; size: { x: number; y: number } } {
  return {
    size: { x: 1280, y: 640 },
    platforms: [
      platform("floor", "floor", 640, 624, 1280, 32),
      platform("wall-left", "wall", 16, 320, 32, 640),
      platform("wall-right", "wall", 1264, 320, 32, 640),
      platform("ceiling", "wall", 640, 16, 1280, 32),
      platform("mid", "platform", 640, 360, 380, 22),
      platform("cover-left", "cover", 280, 360, 72, 80),
    ],
  };
}

// Sim constants used at the player layer — duplicated locally so the test
// stays a pure unit on collision; the integration with stepPlayer comes via
// the determinism suite.
const STEP_MS = 1000 / 60;
const STEP_SEC = STEP_MS / 1000;
const PLAYER_W = 26;
const PLAYER_H = 56;

function aabbAt(x: number, footY: number): AABB {
  return { x: x - PLAYER_W / 2, y: footY - PLAYER_H, w: PLAYER_W, h: PLAYER_H };
}

describe("player landing", () => {
  test("drops from spawn, lands on floor, stays grounded for 10 ticks", () => {
    const cache = buildStaticCache(miniMap().platforms, 1280, 640);
    // x=80 has clear vertical drop: between wall-left (right edge 32) and
    // ledge-left (left edge 110). Falls past everything to the floor.
    let pos = aabbAt(80, 100);
    let vy = 0;
    let landedTick = -1;
    for (let tick = 0; tick < 60; tick++) {
      // Simple gravity model — match player.ts M.gravity.
      vy = Math.min(900, vy + 1450 * STEP_SEC);
      const result = resolveMoveCached(pos, 0, vy, STEP_SEC, cache, true);
      pos = { ...pos, x: result.x, y: result.y };
      vy = result.vy;
      if (result.groundedThisFrame && landedTick < 0) landedTick = tick;
    }
    expect(landedTick).toBeGreaterThanOrEqual(0);
    // Foot should be on the floor surface (floor top at 624 - 16 = 608).
    expect(pos.y + pos.h).toBeCloseTo(608, 1);
    expect(vy).toBe(0);
  });

  test("stays grounded for 10 consecutive ticks once landed (no flutter)", () => {
    const cache = buildStaticCache(miniMap().platforms, 1280, 640);
    // Pre-positioned: foot at floor top (y=608), zero velocity.
    let pos = aabbAt(640, 608);
    let groundedSeq = 0;
    let groundedFlickers = 0;
    for (let tick = 0; tick < 30; tick++) {
      const vy = Math.min(900, 0 + 1450 * STEP_SEC); // gravity from rest
      const result = resolveMoveCached(pos, 0, vy, STEP_SEC, cache, true);
      pos = { ...pos, x: result.x, y: result.y };
      if (result.groundedThisFrame) groundedSeq++;
      else groundedFlickers++;
    }
    // Once landed, every subsequent tick should still report grounded.
    // BEFORE D2 (post-resolve probe): this fails — flutter.
    // AFTER D2: passes.
    expect(groundedFlickers).toBe(0);
    expect(groundedSeq).toBe(30);
  });

  test("walking into vertical wall blocks vx, no tunnel", () => {
    const cache = buildStaticCache(miniMap().platforms, 1280, 640);
    // Player on floor, against the right wall path.
    let pos = aabbAt(1200, 608);
    for (let tick = 0; tick < 30; tick++) {
      const result = resolveMoveCached(pos, 330 /* maxGroundSpeed */, 0, STEP_SEC, cache, true);
      pos = { ...pos, x: result.x, y: result.y };
    }
    // Wall left edge at x=1264-16=1248, player right edge must not pass it.
    expect(pos.x + pos.w).toBeLessThanOrEqual(1248 + 0.01);
  });

  test("airborne lateral approach into 'cover' is blocked (post-D1)", () => {
    const cache = buildStaticCache(miniMap().platforms, 1280, 640);
    // Cover-left spans x=244..316, y=320..400 — chest-high obstacle in
    // mid-air. Approaching from the left at cover-mid height (y=360),
    // a player should not pass through. BEFORE D1 cover is `kind:
    // "platform"` with oneWay=true; the moverBottom > platformTop+2
    // check short-circuits the side hit (mover bottom is at y=380,
    // 380 > 320+2 = 322 → "pass through"). Player walks/flies straight
    // through cover. AFTER D1 (oneWay restricted to thin platforms),
    // cover stays solid 4-way.
    let pos = { x: 200 - PLAYER_W / 2, y: 360 - PLAYER_H / 2, w: PLAYER_W, h: PLAYER_H };
    for (let tick = 0; tick < 60; tick++) {
      const result = resolveMoveCached(pos, 330, 0, STEP_SEC, cache, true);
      pos = { ...pos, x: result.x, y: result.y };
    }
    expect(pos.x + pos.w).toBeLessThanOrEqual(244 + 0.01);
  });

  test("real stepPlayer integrator: player on floor reports grounded every tick", () => {
    // Replicates the user's "barely detects standing" symptom path. Uses the
    // actual stepPlayer integrator (not just resolveMoveCached) so any bug in
    // the gravity/resolve handoff is caught.
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    let player: PlayerEntity = {
      id: PlayerId("test"),
      characterId: "balanced",
      x: 80,
      // foot at floor top (608) with bodyHeight 56 → center at 580
      y: 580,
      vx: 0, vy: 0,
      aimX: 1, aimY: 0,
      health: 100, shieldActive: false,
      crouching: false, alive: true,
      weaponId: "starter-pistol", cards: [],
      fireCooldownMs: 0, ammo: 24,
      abilityCharge: 0,
      lastProcessedInputSeq: 0 as InputSeq,
    };
    let memory = freshPlayerMovementMemory();
    memory.groundedLastFrame = true; // already standing
    let groundedTrueCount = 0;
    let groundedFalseCount = 0;
    const STEP_MS_LOCAL = 1000 / 60;
    for (let tick = 0; tick < 60; tick++) {
      const result = stepPlayer(
        player, 0, 0, 1, 0, memory,
        map.platforms, STEP_MS_LOCAL,
        { collisionCache: cache },
      );
      player = result.player;
      memory = result.memory;
      if (memory.groundedLastFrame) groundedTrueCount++;
      else groundedFalseCount++;
    }
    // Player did nothing — pure idle on floor for 60 ticks. Must report
    // grounded every tick.
    expect(groundedFalseCount).toBe(0);
    expect(groundedTrueCount).toBe(60);
  });

  // D3: matrix sweep over (vy, platform height) — guards the canonical
  // tunneling bug class. Player must never end up below a platform that
  // resolveMoveCached should have stopped them on.
  for (const platH of [12, 18, 22, 32]) {
    for (const vyInit of [300, 600, 900, 1200, 1500, 2000]) {
      test(`fast-fall vy=${vyInit} does not tunnel through ${platH}px floor`, () => {
        const platform: PlatformDefinition = {
          id: "single",
          kind: "floor",
          position: { x: 100, y: 200 + platH / 2 },
          size: { x: 1000, y: platH },
        };
        const cache = buildStaticCache([platform], 1000, 400);
        // Mover bottom 4 px above platform top, single tick at vy=vyInit.
        const platformTop = 200;
        const mover: AABB = { x: 100, y: platformTop - PLAYER_H - 4, w: PLAYER_W, h: PLAYER_H };
        const result = resolveMoveCached(mover, 0, vyInit, STEP_SEC, cache, true);
        // Player's foot must not be past the platform top.
        expect(result.y + mover.h).toBeLessThanOrEqual(platformTop + 0.01);
        expect(result.groundedThisFrame).toBe(true);
      });
    }
  }

  test("jumping under a thin one-way platform passes through, lands on top", () => {
    const cache = buildStaticCache(miniMap().platforms, 1280, 640);
    // Player below the mid platform (top at 360-11=349). Use a stronger
    // boost (-900) so the upward apex (~280px) clears the platform from
    // a starting foot at y=500 (distance 151 to platform top).
    let pos = aabbAt(640, 500);
    let vy = -900;
    let passedThrough = false;
    let landedOnTop = false;
    for (let tick = 0; tick < 90; tick++) {
      vy = Math.min(900, vy + 1450 * STEP_SEC);
      const result = resolveMoveCached(pos, 0, vy, STEP_SEC, cache, true);
      const prevFootY = pos.y + pos.h;
      pos = { ...pos, x: result.x, y: result.y };
      vy = result.vy;
      const footY = pos.y + pos.h;
      // Track upward pass-through.
      if (prevFootY > 349 && footY < 349) passedThrough = true;
      // Track land-on-top during descent.
      if (result.groundedThisFrame && Math.abs(footY - 349) < 1) landedOnTop = true;
    }
    expect(passedThrough).toBe(true);
    expect(landedOnTop).toBe(true);
  });
});
