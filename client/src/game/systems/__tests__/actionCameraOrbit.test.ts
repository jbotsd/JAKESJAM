// Peak-hype "pop and lock" orbit. The camera ROLL that used to live here was
// removed 2026-07-15 (Jake, live playtest: "don't roll the camera, come up
// with a new one, do that AI-assisted super zoom lock-on too... like the
// tiktok thing") — see actionCameraAiLock.test.ts for its replacement. This
// file now only covers the orbital "pop and lock" displacement.

import { describe, expect, test } from "bun:test";
import { ActionCamera, type CameraFocus } from "../ActionCamera.js";

function fakeCam() {
  const cam = {
    zoom: 1,
    width: 800,
    height: 600,
    scrollX: 0,
    scrollY: 0,
    setZoom(z: number) {
      this.zoom = z;
      return this;
    },
    setRotation(_r: number) {
      return this;
    },
    centerOn(x: number, y: number) {
      this.scrollX = x - this.width / 2;
      this.scrollY = y - this.height / 2;
      return this;
    },
  };
  return cam;
}

function focusAt(x: number, y: number): CameraFocus {
  return { x, y, vx: 0, vy: 0, aimX: x + 1, aimY: y, hype: 1 };
}

describe("ActionCamera — peak-hype orbit bounds", () => {
  test("sustained peak hype produces a real, bounded circular displacement", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    let maxAbsDx = 0;
    // ~3 minutes of sustained hype=1 at 60fps — should never runaway.
    for (let i = 0; i < 3 * 60 * 60; i++) {
      ac.update(16, focusAt(0, 0));
      const dx = cam.scrollX + cam.width / 2;
      maxAbsDx = Math.max(maxAbsDx, Math.abs(dx));
    }
    expect(maxAbsDx).toBeGreaterThan(0); // it should still DO something
    expect(maxAbsDx).toBeLessThan(200); // nowhere near unbounded
  });

  test("orbit oscillates (goes both left and right of centre), not a one-way drift", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    let sawPositive = false;
    let sawNegative = false;
    for (let i = 0; i < 600; i++) {
      ac.update(16, focusAt(0, 0));
      const dx = cam.scrollX + cam.width / 2;
      if (dx > 1) sawPositive = true;
      if (dx < -1) sawNegative = true;
    }
    expect(sawPositive).toBe(true);
    expect(sawNegative).toBe(true);
  });

  test("zero hype (and no peak) means zero orbit displacement", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 300; i++) {
      ac.update(16, { x: 0, y: 0, vx: 0, vy: 0, aimX: 1, aimY: 0, hype: 0 });
    }
    expect(Math.abs(cam.scrollX + cam.width / 2)).toBeLessThan(1);
    expect(Math.abs(cam.scrollY + cam.height / 2)).toBeLessThan(1);
  });
});
