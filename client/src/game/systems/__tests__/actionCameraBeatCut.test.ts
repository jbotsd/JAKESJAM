// Beat-cut cinematic — Jake, 2026-07-15 (live playtest): "those cameras...
// every beat for 8 beats in 16 should be camera cuts, each one a beat long."
// A strict 8-on/8-off, 16-beat cycle, gated to CameraHype's peak flag, where
// "on" beats are genuine hard cuts (held constant, not sprung) rather than
// the continuous orbit/AI-lock-zoom also running during peak. Tests read
// debugBeatCutState() directly for the hold-then-jump assertions since the
// AI-lock zoom (also peak-only, see actionCameraAiLock.test.ts) contributes
// to cam.zoom/scrollX throughout peak too and would otherwise mask beat-cut's
// own exact behavior.

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
    // Peak entry also triggers the AI-lock's super-close-up (see
    // ActionCamera.triggerSuperCloseUp), which schedules a delayedCall —
    // these tests don't need to fire it, just tolerate it existing.
    scene: {
      time: {
        delayedCall(_delay: number, _cb: () => void) {},
      },
    },
  };
  return cam;
}

function focusAt(
  x: number,
  y: number,
  extra: { peak?: boolean; beatPulse?: number } = {},
): CameraFocus {
  return { x, y, vx: 0, vy: 0, aimX: x + 1, aimY: y, hype: 0, ...extra };
}

/** Square-wave beat pulse: `high` frames above the rise threshold, then
 *  `low` frames below the fall threshold, repeating. */
function pulseAt(i: number, high: number, low: number): number {
  return i % (high + low) < high ? 1 : 0;
}

describe("ActionCamera — beat-cut cinematic", () => {
  test("no peak: beat pulses never produce a cut (frame stays on the player, zoom stays at baseline)", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));
    for (let i = 0; i < 60; i++) {
      ac.update(16, focusAt(0, 0, { peak: false, beatPulse: pulseAt(i, 3, 3) }));
      // No peak means BOTH beat-cut and AI-lock are inert, so black-box cam
      // state is a valid check here.
      expect(Math.abs(cam.scrollX + cam.width / 2)).toBeLessThan(1);
      expect(cam.zoom).toBeCloseTo(1, 5);
      expect(ac.debugBeatCutState().active).toBe(false);
    }
  });

  test("peak entry resets the cycle to beat 0: first 8 detected beats cut, next 8 don't", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 60; i++) ac.update(16, focusAt(0, 0)); // settle, no peak yet

    let beatsDetected = 0;
    let wasHigh = false;
    const cutOnBeat: boolean[] = [];
    for (let i = 0; i < 400 && beatsDetected < 16; i++) {
      const pulse = pulseAt(i, 3, 3);
      ac.update(16, focusAt(0, 0, { peak: true, beatPulse: pulse }));
      if (pulse >= 0.55 && !wasHigh) {
        cutOnBeat.push(ac.debugBeatCutState().active);
        beatsDetected++;
      }
      wasHigh = pulse >= 0.55;
    }

    expect(beatsDetected).toBe(16);
    expect(cutOnBeat.slice(0, 8)).toEqual(new Array(8).fill(true));
    expect(cutOnBeat.slice(8, 16)).toEqual(new Array(8).fill(false));
  });

  test("a cut holds EXACTLY constant across the beat, not sprung/interpolated", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 60; i++) ac.update(16, focusAt(0, 0));

    // Trigger the first (cutting) beat.
    ac.update(16, focusAt(0, 0, { peak: true, beatPulse: 1 }));
    const stateAfterCut = ac.debugBeatCutState();
    expect(stateAfterCut.active).toBe(true);
    expect(stateAfterCut.zoomMul).not.toBe(1);

    // Hold low (below fall threshold) so no new beat fires, but keep
    // updating for several frames — beat-cut's own offset/zoom must not
    // move at all (the AI-lock zoom riding alongside it in cam.zoom DOES
    // keep easing, which is exactly why this test reads the isolated
    // debug state rather than cam.zoom directly).
    for (let i = 0; i < 10; i++) {
      ac.update(16, focusAt(0, 0, { peak: true, beatPulse: 0 }));
      const s = ac.debugBeatCutState();
      expect(s.active).toBe(true);
      expect(s.offsetX).toBe(stateAfterCut.offsetX);
      expect(s.offsetY).toBe(stateAfterCut.offsetY);
      expect(s.zoomMul).toBe(stateAfterCut.zoomMul);
    }
  });

  test("peak dropping mid-cut clears the beat-cut offset immediately (hard, not eased)", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 60; i++) ac.update(16, focusAt(0, 0));

    ac.update(16, focusAt(0, 0, { peak: true, beatPulse: 1 }));
    expect(ac.debugBeatCutState().active).toBe(true);

    ac.update(16, focusAt(0, 0, { peak: false, beatPulse: 1 }));
    const s = ac.debugBeatCutState();
    expect(s.active).toBe(false);
    expect(s.offsetX).toBe(0);
    expect(s.offsetY).toBe(0);
    expect(s.zoomMul).toBe(1);
  });

  test("snap() resets the beat-cut cycle (a respawn shouldn't resume mid-pattern)", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(0, 0);
    for (let i = 0; i < 60; i++) ac.update(16, focusAt(0, 0));
    // Burn through several beats so beatCutBeatIndex is well past 0.
    for (let i = 0; i < 60; i++) {
      ac.update(16, focusAt(0, 0, { peak: true, beatPulse: pulseAt(i, 3, 3) }));
    }
    ac.snap(0, 0);
    for (let i = 0; i < 5; i++) ac.update(16, focusAt(0, 0));

    // First beat after a fresh peak entry post-snap must be beat 0 (a cut).
    ac.update(16, focusAt(0, 0, { peak: true, beatPulse: 1 }));
    expect(ac.debugBeatCutState().active).toBe(true);
  });
});
