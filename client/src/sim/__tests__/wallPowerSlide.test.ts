// Wall power-slide: holding Down at the instant a wall-jump triggers swaps
// in a flatter, faster launch (trade height for speed) instead of the
// normal steep kick. Same trigger/precedence as the ordinary wall-jump —
// this is a strictly additional option, never required by the reachability
// model (mapGen.ts's wall-jump-shaft constants are untouched).

import { describe, expect, test } from "bun:test";
import { buildStaticCache } from "../collision.js";
import { stepPlayer, freshPlayerMovementMemory } from "../player.js";
import { PlayerId, type PlayerEntity, type InputSeq, type PlatformDefinition } from "../types.js";

const STEP = 1000 / 60;
const Bit = { Left: 1 << 0, Right: 1 << 1, Jump: 1 << 4, Crouch: 1 << 5 };
// Gravity applies in the SAME tick right after the jump impulse is set (rise
// gravity, since vy is negative immediately after a wall-jump/power-slide),
// so the returned vy is the raw kick value plus one tick of it — not the
// bare constant. GRAVITY=1450 (player.ts M.gravity).
const ONE_TICK_GRAVITY = 1450 * (STEP / 1000);

function miniMap() {
  const p = (id: string, kind: string, cx: number, cy: number, w: number, h: number): PlatformDefinition => ({
    id, kind: kind as PlatformDefinition["kind"], position: { x: cx, y: cy }, size: { x: w, y: h },
  });
  return {
    size: { x: 1280, y: 640 },
    platforms: [
      p("floor", "floor", 640, 624, 1280, 32),
      p("wall-left", "wall", 16, 320, 32, 640),
      p("wall-right", "wall", 1264, 320, 32, 640),
      p("ceiling", "wall", 640, 16, 1280, 32),
    ],
  };
}

function mkPlayer(): PlayerEntity {
  return {
    id: PlayerId("t"), characterId: "balanced", x: 400, y: 300, vx: 0, vy: 0,
    aimX: 600, aimY: 300, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 24, abilityCharge: 0, lastProcessedInputSeq: 0 as InputSeq,
  };
}

/** Airborne, gripping a wall on the given side, ready for a jump-buffer trigger. */
function airborneAgainstWall(wallDir: -1 | 1) {
  const player = mkPlayer();
  const mem = freshPlayerMovementMemory();
  mem.groundedLastFrame = false;
  mem.touchingWallDir = wallDir;
  mem.jumpBufferMs = 50; // as if jump was just pressed this tick
  return { player, mem };
}

describe("wall power-slide", () => {
  test("plain wall-jump (no crouch): steep, matches the existing signature kick", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache };
    const { player, mem } = airborneAgainstWall(-1); // wall on the left

    const r = stepPlayer(player, 0, Bit.Jump, 600, 300, mem, map.platforms, STEP, opts);

    expect(r.player.vy).toBeCloseTo(-720 + ONE_TICK_GRAVITY, 1);
    expect(r.player.vx).toBeCloseTo(470, 0); // away from the left wall = +x
  });

  test("power-slide (Jump + Down held): flatter and faster than the plain kick", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache };
    const { player, mem } = airborneAgainstWall(-1);

    const r = stepPlayer(player, 0, Bit.Jump | Bit.Crouch, 600, 300, mem, map.platforms, STEP, opts);

    expect(r.player.vy).toBeCloseTo(-430 + ONE_TICK_GRAVITY, 1);
    expect(r.player.vx).toBeCloseTo(690, 0);

    // The actual point of the move: less height, more horizontal speed than
    // the plain wall-jump.
    expect(Math.abs(r.player.vy)).toBeLessThan(720);
    expect(Math.abs(r.player.vx)).toBeGreaterThan(470);
  });

  test("power-slide direction flips with which wall is gripped", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache };

    const fromLeftWall = airborneAgainstWall(-1);
    const rLeft = stepPlayer(
      fromLeftWall.player, 0, Bit.Jump | Bit.Crouch, 600, 300, fromLeftWall.mem, map.platforms, STEP, opts,
    );
    expect(rLeft.player.vx).toBeGreaterThan(0); // kicked away from the left wall

    const fromRightWall = airborneAgainstWall(1);
    const rRight = stepPlayer(
      fromRightWall.player, 0, Bit.Jump | Bit.Crouch, 600, 300, fromRightWall.mem, map.platforms, STEP, opts,
    );
    expect(rRight.player.vx).toBeLessThan(0); // kicked away from the right wall
  });

  test("wallJumpMultiplier scales the power-slide's vy the same as the plain kick", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache, wallJumpMultiplier: 1.5 };
    const { player, mem } = airborneAgainstWall(-1);

    const r = stepPlayer(player, 0, Bit.Jump | Bit.Crouch, 600, 300, mem, map.platforms, STEP, opts);

    // wallJumpMultiplier only ever scaled vy (pre-existing behavior,
    // unchanged by the power-slide addition) — vx is untouched by it.
    expect(r.player.vy).toBeCloseTo(-430 * 1.5 + ONE_TICK_GRAVITY, 1);
    expect(r.player.vx).toBeCloseTo(690, 0);
  });
});
