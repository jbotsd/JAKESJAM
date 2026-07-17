// Punch-zoom lock-on: the punch should genuinely bias the frame toward the
// actual point of impact (e.g. a victim elsewhere on screen), not just pulse
// the zoom level while framing stays centred on the local player. Also
// verifies the offsets are additive springs that settle back to 0 rather
// than a competing tween system (see ActionCamera.punchZoom's docstring).

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

/** Fire every pending delayedCall whose delay is <= the given ms, then clear
 *  them (matches this file's punches never scheduling more than one level
 *  deep of follow-up delayedCall). */
function advance(pending: PendingCall[], ms: number): void {
  const due = pending.filter((p) => p.delay <= ms);
  pending.length = 0;
  for (const p of due) p.cb();
}

function focusAt(x: number, y: number): CameraFocus {
  return { x, y, vx: 0, vy: 0, aimX: x + 1, aimY: y };
}

describe("ActionCamera.punchZoom — lock-on targeting", () => {
  test("without a lock-on target, framing stays on the player as usual", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    ac.punchZoom(0.06, 70, 200);
    for (let i = 0; i < 20; i++) ac.update(16, focusAt(0, 0));
    // Camera stays centred near the player — no lock-on target given.
    const centerX = cam.scrollX + cam.width / 2;
    expect(Math.abs(centerX)).toBeLessThan(20);
  });

  test("with a lock-on target far from the player, framing biases toward it", () => {
    const { cam, pending } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    const centerBefore = cam.scrollX + cam.width / 2;

    // Victim is 300px away from the local player — a real off-centre kill.
    ac.punchZoom(0.06, 70, 200, 300, 0);
    for (let i = 0; i < 6; i++) ac.update(16, focusAt(0, 0));
    const centerDuringPunch = cam.scrollX + cam.width / 2;

    // The frame should have moved meaningfully toward the victim (positive
    // x direction), not stayed pinned on the player at 0.
    expect(centerDuringPunch - centerBefore).toBeGreaterThan(20);

    // Let the punch's release phase begin and run it down.
    advance(pending, 70);
    for (let i = 0; i < 180; i++) ac.update(16, focusAt(0, 0));
    const centerAfter = cam.scrollX + cam.width / 2;
    // Settles back near the player — the lock-on was transient, not
    // permanent (small residual from the deadzone is expected/fine; it
    // should be nowhere near the 300px it reached mid-punch).
    expect(Math.abs(centerAfter)).toBeLessThan(60);
  });

  test("a second punch fired mid-flight continues smoothly instead of popping back to centre", () => {
    // Regression for the 2026-07-15 live playtest bug: "camera pops in and
    // out" during a fast run of kills. Root cause was punchLockOffset being
    // hard `.reset(0, 0)` on every punchZoom call, teleporting the frame to
    // dead-centre even when the prior punch's offset hadn't settled yet.
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    const centerBefore = cam.scrollX + cam.width / 2;

    // First kill, well off to the side.
    ac.punchZoom(0.06, 70, 200, 300, 0);
    for (let i = 0; i < 6; i++) ac.update(16, focusAt(0, 0));
    const centerMidFirstPunch = cam.scrollX + cam.width / 2;
    expect(centerMidFirstPunch - centerBefore).toBeGreaterThan(20);

    // Second kill lands before the first punch has released — a fast
    // back-to-back sequence, same as a burst of hits in a live match.
    ac.punchZoom(0.06, 70, 200, 320, 0);
    ac.update(16, focusAt(0, 0));
    const centerNextFrame = cam.scrollX + cam.width / 2;

    // The frame must NOT collapse back toward the pre-punch centre on the
    // very next frame — it should carry forward from where it already was,
    // continuing toward the new (nearby) lock target.
    expect(centerNextFrame - centerBefore).toBeGreaterThan(20);
  });

  test("punch zoom offset genuinely increases zoom above the envelope baseline mid-punch", () => {
    const { cam, pending } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    const zoomBefore = cam.zoom;

    ac.punchZoom(0.5, 70, 200);
    for (let i = 0; i < 4; i++) ac.update(16, focusAt(0, 0));
    expect(cam.zoom).toBeGreaterThan(zoomBefore);

    advance(pending, 70);
    for (let i = 0; i < 60; i++) ac.update(16, focusAt(0, 0));
    // Settles back close to baseline once the punch fully releases.
    expect(Math.abs(cam.zoom - zoomBefore)).toBeLessThan(0.05);
  });

  test("a snap (respawn/teleport) mid-punch cancels the lock-on rather than carrying it to the new position", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));

    ac.punchZoom(0.5, 70, 200, 500, 0);
    ac.update(16, focusAt(0, 0));

    ac.snap(1000, 1000);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(1000, 1000));

    const centerX = cam.scrollX + cam.width / 2;
    const centerY = cam.scrollY + cam.height / 2;
    // Framing follows the new position, not still biased toward the old
    // lock-on target (which would put it well past 1000 on the x-axis).
    expect(Math.abs(centerX - 1000)).toBeLessThan(20);
    expect(Math.abs(centerY - 1000)).toBeLessThan(20);
  });
});

describe("ActionCamera.sideSwipe — fast whip, fast return", () => {
  test("whips the frame toward the swipe direction", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    const centerBefore = cam.scrollX + cam.width / 2;

    ac.sideSwipe(400, 0, 90, 60);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    const centerDuring = cam.scrollX + cam.width / 2;

    expect(centerDuring - centerBefore).toBeGreaterThan(20);
  });

  test("returns to normal framing FAST — near-instant, not a lingering ease", () => {
    const { cam, pending } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));

    ac.sideSwipe(400, 0, 90, 60);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    advance(pending, 90); // enter the release phase

    // "Near instant": within ~6 frames (100ms) of release starting, back
    // close to baseline — not still lingering out near the swipe peak.
    for (let i = 0; i < 6; i++) ac.update(16, focusAt(0, 0));
    const centerX = cam.scrollX + cam.width / 2;
    expect(Math.abs(centerX)).toBeLessThan(60);
  });

  test("a snap mid-swipe cancels it rather than carrying the offset to the new position", () => {
    const { cam } = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));

    ac.sideSwipe(600, 0, 90, 60);
    ac.update(16, focusAt(0, 0));
    ac.snap(2000, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(2000, 0));

    const centerX = cam.scrollX + cam.width / 2;
    expect(Math.abs(centerX - 2000)).toBeLessThan(20);
  });
});
