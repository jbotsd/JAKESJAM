// AI-lock super zoom — Jake, 2026-07-15 (live playtest): "don't roll the
// camera, come up with a new one, do that AI-assisted super zoom lock-on
// too... like the tiktok thing" / "don't be afraid to do one or two super
// close ups." Replaces the old peak-hype roll: a sustained, snappy push-in
// that tracks the nearest opponent (or, solo, a point ahead of the local
// player's aim), with occasional bigger punches to a genuine close-up.

import { describe, expect, test } from "bun:test";
import { ActionCamera, type CameraFocus } from "../ActionCamera.js";

type PendingCall = { delay: number; cb: () => void };

function fakeCam() {
  const pending: PendingCall[] = [];
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
    scene: {
      time: {
        delayedCall(delay: number, cb: () => void) {
          pending.push({ delay, cb });
        },
      },
    },
  };
  return { cam, pending };
}

function advance(pending: PendingCall[], ms: number): void {
  const due = pending.filter((p) => p.delay <= ms);
  pending.length = 0;
  for (const p of due) p.cb();
}

function focusAt(
  x: number,
  y: number,
  extra: Partial<CameraFocus> = {},
): CameraFocus {
  return { x, y, vx: 0, vy: 0, aimX: x + 1, aimY: y, hype: 0, ...extra };
}

describe("ActionCamera — AI-lock super zoom", () => {
  test("no peak: zoom and framing stay at baseline", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    for (let i = 0; i < 60; i++) {
      ac.update(16, focusAt(0, 0, { peak: false }));
    }
    expect(cam.zoom).toBeCloseTo(1, 5);
    expect(Math.abs(cam.scrollX + cam.width / 2)).toBeLessThan(1);
  });

  test("peak with a nearby opponent: zoom pushes in and framing biases toward them", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    for (let i = 0; i < 90; i++) {
      ac.update(16, focusAt(0, 0, { peak: true, extra: [{ x: 400, y: 0 }] }));
    }
    expect(cam.zoom).toBeGreaterThan(1.05);
    const centerX = cam.scrollX + cam.width / 2;
    expect(centerX).toBeGreaterThan(20); // biased toward the +x opponent
  });

  test("peak with no opponent: locks onto the character itself, NOT the aim/mouse direction", () => {
    // Regression for the 2026-07-15 live playtest bug ("unshippably
    // nauseating" / "i didnt mean zoom in on the mouse i mean the
    // character"): the first version projected the lock target out along
    // the aim direction, so ordinary mouse aiming while standing still
    // whipped a tight zoomed-in frame around unpredictably. It must stay
    // centred on the player regardless of how erratically aim moves.
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    for (let i = 0; i < 90; i++) {
      // Aiming straight down +x, no opponents in range (solo/practice) —
      // this used to whip the frame toward +x; it must not anymore.
      ac.update(16, { x: 0, y: 0, vx: 0, vy: 0, aimX: 500, aimY: 0, hype: 0, peak: true });
    }
    expect(cam.zoom).toBeGreaterThan(1.05); // still zooms in tight...
    const centerX = cam.scrollX + cam.width / 2;
    expect(Math.abs(centerX)).toBeLessThan(20); // ...but stays centred on the player

    // Even wildly erratic aim (a mouse being whipped around) must not move
    // the frame — the whole point of locking onto the character instead.
    for (let i = 0; i < 30; i++) {
      const angle = i * 1.7; // fast, incoherent direction changes
      ac.update(16, {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        aimX: Math.cos(angle) * 500,
        aimY: Math.sin(angle) * 500,
        hype: 0,
        peak: true,
      });
      expect(Math.abs(cam.scrollX + cam.width / 2)).toBeLessThan(20);
    }
  });

  test("super close-up on peak entry punches well past the sustained lock level, then relaxes", () => {
    const { cam, pending } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));

    // Peak entry frame — triggers the super-close-up.
    for (let i = 0; i < 15; i++) ac.update(16, focusAt(0, 0, { peak: true }));
    const zoomDuringSuper = cam.zoom;
    expect(zoomDuringSuper).toBeGreaterThan(1.4); // genuinely tight, not the ~1.24 sustained level

    // Let the super-close-up hold expire and the sustained level take over.
    advance(pending, 550);
    for (let i = 0; i < 120; i++) ac.update(16, focusAt(0, 0, { peak: true }));
    expect(cam.zoom).toBeLessThan(zoomDuringSuper);
    expect(cam.zoom).toBeGreaterThan(1.05); // still locked in, just not at super level
  });

  test("peak dropping eases the lock back out smoothly (not an instant hard cut, unlike beat-cut)", () => {
    const { cam, pending } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    for (let i = 0; i < 15; i++) ac.update(16, focusAt(0, 0, { peak: true }));
    advance(pending, 550); // past the super-close-up hold
    for (let i = 0; i < 60; i++) ac.update(16, focusAt(0, 0, { peak: true }));
    const zoomAtPeak = cam.zoom;
    expect(zoomAtPeak).toBeGreaterThan(1.05);

    // A few frames after peak drops (a still spring's very first frame can
    // have near-zero velocity/delta by construction — that's expected, not
    // a bug), a SPRING (not a hard cut) still hasn't reached baseline yet.
    for (let i = 0; i < 3; i++) ac.update(16, focusAt(0, 0, { peak: false }));
    expect(cam.zoom).toBeGreaterThan(1.001);
    expect(cam.zoom).toBeLessThan(zoomAtPeak);

    for (let i = 0; i < 120; i++) ac.update(16, focusAt(0, 0, { peak: false }));
    expect(cam.zoom).toBeCloseTo(1, 2);
  });

  test("snap() resets the AI-lock cleanly", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    for (let i = 0; i < 90; i++) {
      ac.update(16, focusAt(0, 0, { peak: true, extra: [{ x: 400, y: 0 }] }));
    }
    expect(cam.zoom).toBeGreaterThan(1.05);

    ac.snap(1000, 1000);
    expect(cam.zoom).toBeCloseTo(1, 5);
  });
});
