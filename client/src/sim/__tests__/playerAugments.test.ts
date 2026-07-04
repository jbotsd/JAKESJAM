// Movement-augment behavior: double-jump + dash. Verifies the card-gated
// deep-movement logic in stepPlayer (mirrored bit-for-bit in player.zig; the
// wasm parity test proves the two agree — this proves the logic is correct).

import { describe, expect, test } from "bun:test";
import { buildStaticCache } from "../collision.js";
import { stepPlayer, freshPlayerMovementMemory } from "../player.js";
import { PlayerId, type PlayerEntity, type InputSeq, type PlatformDefinition } from "../types.js";

const STEP = 1000 / 60;
const JUMP = 1 << 4;
const DASH = 1 << 9;

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
    id: PlayerId("t"), characterId: "balanced", x: 400, y: 580, vx: 0, vy: 0,
    aimX: 600, aimY: 580, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 24, abilityCharge: 0, lastProcessedInputSeq: 0 as InputSeq,
  };
}

describe("movement augments", () => {
  test("double-jump: airJumps=1 grants a mid-air jump after coyote expires", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache, airJumps: 1 };
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    // Ground jump.
    let r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    player = r.player; mem = r.memory;
    expect(player.vy).toBeLessThan(0);
    // Coast airborne (jump released) long enough for coyote to expire.
    for (let i = 0; i < 12; i++) {
      r = stepPlayer(player, 0, 0, 600, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
    }
    expect(mem.groundedLastFrame).toBe(false);
    const vyBefore = player.vy;
    // Fresh jump press in the air → double-jump.
    r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    expect(r.player.vy).toBeLessThan(0);
    expect(r.player.vy).toBeLessThan(vyBefore);
    expect(r.memory.airJumpsUsed).toBe(1);
  });

  test("no double-jump without the card (airJumps=0)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    const opts = { collisionCache: cache, airJumps: 0 };
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    let r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    player = r.player; mem = r.memory;
    for (let i = 0; i < 12; i++) {
      r = stepPlayer(player, 0, 0, 600, 580, mem, map.platforms, STEP, opts);
      player = r.player; mem = r.memory;
    }
    const vyBefore = player.vy; // falling (positive)
    r = stepPlayer(player, 0, JUMP, 600, 580, mem, map.platforms, STEP, opts);
    // No air jump: still falling, vy didn't flip strongly negative.
    expect(r.player.vy).toBeGreaterThan(vyBefore - 50);
    expect(r.memory.airJumpsUsed).toBe(0);
  });

  test("dash: dashCharges=1 bursts horizontally on the Dash bit", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    // Aim to the right (+x). Press Dash with no L/R → dash toward the aim side.
    const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
      collisionCache: cache, dashCharges: 1,
    });
    expect(r.player.vx).toBeGreaterThan(600);
    expect(r.memory.dashCooldownMs).toBeGreaterThan(0);
  });

  test("no dash without the card (dashCharges=0)", () => {
    const map = miniMap();
    const cache = buildStaticCache(map.platforms, map.size.x, map.size.y);
    let player = mkPlayer();
    let mem = freshPlayerMovementMemory();
    mem.groundedLastFrame = true;
    const r = stepPlayer(player, 0, DASH, 900, 580, mem, map.platforms, STEP, {
      collisionCache: cache, dashCharges: 0,
    });
    expect(Math.abs(r.player.vx)).toBeLessThan(50);
  });
});
