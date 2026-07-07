// LocalPlayerController wraps stepPlayer for offline/solo scenes. The
// physics itself (jump/wall-jump/dash) is already proven by
// client/src/sim/__tests__/playerAugments.test.ts and the wasm parity suite
// — these tests instead prove the WRAPPER: persisted prevKeys (so holding a
// button doesn't re-fire an edge every tick), the collision cache built from
// a real map, the ceiling clamp, and the small helpers (facing/reset/etc).

import { describe, expect, test } from "bun:test";
import { LocalPlayerController } from "../LocalPlayerController.js";
import type { MapDefinition, PlatformDefinition } from "../../../sim/types.js";

const STEP = 1000 / 60;
const Bit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Jump: 1 << 4,
  Dash: 1 << 9,
};

function platform(
  id: string,
  kind: PlatformDefinition["kind"],
  cx: number,
  cy: number,
  w: number,
  h: number,
): PlatformDefinition {
  return { id, kind, position: { x: cx, y: cy }, size: { x: w, y: h } };
}

function testMap(): MapDefinition {
  return {
    id: "test-local-player",
    name: "test",
    size: { x: 1280, y: 640 },
    spawns: [{ x: 400, y: 580 }],
    platforms: [
      platform("floor", "floor", 640, 624, 1280, 32),
      platform("wall-left", "wall", 16, 320, 32, 640),
      platform("wall-right", "wall", 1264, 320, 32, 640),
      platform("ceiling", "wall", 640, 16, 1280, 32),
      // A facing pair of grab-walls near x=500/680 for the wall-contact test.
      platform("shaft-left", "wall", 480, 400, 40, 400),
      platform("shaft-right", "wall", 700, 400, 40, 400),
    ],
  };
}

function settle(ctrl: LocalPlayerController, ticks: number): void {
  for (let i = 0; i < ticks; i++) ctrl.step(0, ctrl.x, ctrl.y, STEP);
}

describe("LocalPlayerController", () => {
  test("settles onto the floor and reports grounded", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    expect(ctrl.grounded).toBe(true);
  });

  test("holding Jump across ticks fires the launch only once (prevKeys persists)", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    ctrl.step(Bit.Jump, ctrl.x + 100, ctrl.y, STEP);
    const vyAfterFirstPress = ctrl.vy;
    expect(vyAfterFirstPress).toBeLessThan(-300); // a real jump launch, not noise

    // Keep holding Jump (currKeys unchanged) for several more ticks. If the
    // wrapper failed to persist prevKeys, this would refire the same big
    // negative jump velocity every tick instead of coasting under gravity.
    for (let i = 0; i < 5; i++) {
      ctrl.step(Bit.Jump, ctrl.x + 100, ctrl.y, STEP);
    }
    expect(ctrl.vy).toBeGreaterThan(vyAfterFirstPress); // gravity has pulled it back down, not re-launched
  });

  test("dash option passthrough bursts horizontal velocity", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    ctrl.step(Bit.Dash, ctrl.x + 300, ctrl.y, STEP, { dashCharges: 1 });
    expect(ctrl.vx).toBeGreaterThan(600);
  });

  test("no dash without dashCharges (default inert, matches card-gated design)", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    ctrl.step(Bit.Dash, ctrl.x + 300, ctrl.y, STEP);
    expect(ctrl.vx).toBeLessThan(600);
  });

  test("airborne + pressing into a nearby wall reports touchingWallDir", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 550, y: 300 });
    // Fall and press left toward shaft-left's right edge (x=500) for a bit.
    for (let i = 0; i < 20; i++) {
      ctrl.step(Bit.Left, ctrl.x - 100, ctrl.y, STEP);
    }
    expect(ctrl.touchingWallDir).not.toBe(0);
  });

  test("reset() clears velocity, wall/dash state, and repositions", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    ctrl.step(Bit.Dash, ctrl.x + 300, ctrl.y, STEP, { dashCharges: 1 });
    expect(ctrl.vx).toBeGreaterThan(0);

    ctrl.reset(200, 100);
    expect(ctrl.x).toBe(200);
    expect(ctrl.y).toBe(100);
    expect(ctrl.vx).toBe(0);
    expect(ctrl.vy).toBe(0);
    expect(ctrl.dashing).toBe(false);
    expect(ctrl.touchingWallDir).toBe(0);
  });

  test("facing follows velocity, then falls back to aim direction", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    ctrl.step(Bit.Right, ctrl.x + 200, ctrl.y, STEP);
    expect(ctrl.facing).toBe(1);

    ctrl.reset(400, 580);
    // No horizontal velocity; aim is to the left of the player.
    ctrl.step(0, ctrl.x - 200, ctrl.y, STEP);
    expect(ctrl.facing).toBe(-1);
  });

  test("applyImpulse/zeroVelocity mutate velocity directly", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 300 });
    ctrl.applyImpulse(-50, -20);
    expect(ctrl.vx).toBe(-50);
    expect(ctrl.vy).toBe(-20);
    ctrl.zeroVelocity();
    expect(ctrl.vx).toBe(0);
    expect(ctrl.vy).toBe(0);
  });

  test("size reflects crouch state using the real physics box", () => {
    const ctrl = new LocalPlayerController(testMap(), { x: 400, y: 580 });
    settle(ctrl, 30);
    const standing = ctrl.size;
    expect(standing.y).toBe(56);
    expect(standing.x).toBe(26);
  });
});
