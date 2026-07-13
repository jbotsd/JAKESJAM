// ActionCamera.snap(): telemetry 2026-07-12 (sigs qobqem/5jtz75, builds
// OghnpP0u/DeF5OTQp) — resetPlayer() at scene create() can call snap()
// before Phaser's Camera has finished its first internal update, and
// centerOn's internal clampX then derefs a null bounds/target. Locks the
// defensive fallback: a throwing centerOn must never propagate, and the
// camera must still land on the correct position via the scrollX/Y path.

import { describe, expect, test } from "bun:test";
import { ActionCamera } from "../ActionCamera.js";

function fakeCam(opts: { throwOnCenterOn?: boolean } = {}) {
  return {
    zoom: 1,
    width: 800,
    height: 600,
    scrollX: 0,
    scrollY: 0,
    setZoom(z: number) {
      this.zoom = z;
      return this;
    },
    centerOn(_x: number, _y: number) {
      if (opts.throwOnCenterOn) {
        // Mirrors the real failure: Phaser's clampX dereferences a null
        // internal bounds/target during the boot-order race.
        throw new TypeError("Cannot read properties of null (reading 'x')");
      }
      return this;
    },
  };
}

describe("ActionCamera.snap — boot-order race guard", () => {
  test("normal path: centerOn succeeds, no fallback engaged", () => {
    const cam = fakeCam();
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    expect(() => ac.snap(500, 300)).not.toThrow();
  });

  test("centerOn throwing during boot never propagates out of snap()", () => {
    const cam = fakeCam({ throwOnCenterOn: true });
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    expect(() => ac.snap(500, 300)).not.toThrow();
  });

  test("fallback still lands the camera on the requested centre via scroll", () => {
    const cam = fakeCam({ throwOnCenterOn: true });
    const ac = new ActionCamera(cam as unknown as Phaser.Cameras.Scene2D.Camera);
    ac.snap(500, 300);
    // scroll = centre - half viewport, matching Phaser's own centerOn math.
    expect(cam.scrollX).toBe(500 - cam.width / 2);
    expect(cam.scrollY).toBe(300 - cam.height / 2);
  });
});
