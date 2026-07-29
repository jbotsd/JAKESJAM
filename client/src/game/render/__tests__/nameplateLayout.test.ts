// clip-goal STUDY 3, CL.A regression — "adjacent bot nameplates collide/
// overlap" was noted in passing on the 2026-07-17 CL.A ledger entry but no
// pillar ever assigned it a test; it reproduced on tape 2026-07-27
// (`0e21238e`, t≈0.03s: VVOC/BOT·PISTON nameplates garbled together).

import { describe, test, expect } from "bun:test";
import { resolveNameplateLifts, clampNameplateAnchorY, type NameplateActor } from "../nameplateLayout";

describe("resolveNameplateLifts", () => {
  test("two actors standing at the same spot get pushed apart until their plates clear", () => {
    const actors: NameplateActor[] = [
      { id: "a", x: 500, y: 300, width: 100, height: 15 },
      { id: "b", x: 500, y: 300, width: 100, height: 15 },
    ];
    const lifts = resolveNameplateLifts(actors);
    // "a" sorts first — placed with no lift; "b" must lift clear of it.
    expect(lifts.get("a")).toBe(0);
    const bLift = lifts.get("b")!;
    expect(bLift).toBeGreaterThan(0);

    // Verify the actual boxes no longer overlap after the lift is applied.
    const aTop = 300 - 15 / 2;
    const aBottom = 300 + 15 / 2;
    const bTop = 300 - bLift - 15 / 2;
    const bBottom = 300 - bLift + 15 / 2;
    const verticallyClear = bBottom <= aTop || aBottom <= bTop;
    expect(verticallyClear).toBe(true);
  });

  test("actors far apart horizontally (no overlap) get zero lift regardless of matching y", () => {
    const actors: NameplateActor[] = [
      { id: "a", x: 100, y: 300, width: 80, height: 15 },
      { id: "b", x: 900, y: 300, width: 80, height: 15 },
    ];
    const lifts = resolveNameplateLifts(actors);
    expect(lifts.get("a")).toBe(0);
    expect(lifts.get("b")).toBe(0);
  });

  test("three actors clustered together all resolve to a non-overlapping stack", () => {
    const actors: NameplateActor[] = [
      { id: "a", x: 500, y: 300, width: 90, height: 15 },
      { id: "b", x: 510, y: 302, width: 90, height: 15 },
      { id: "c", x: 495, y: 298, width: 90, height: 15 },
    ];
    const lifts = resolveNameplateLifts(actors);
    const boxes = actors.map((actor) => {
      const lift = lifts.get(actor.id)!;
      return {
        id: actor.id,
        top: actor.y - lift - actor.height / 2,
        bottom: actor.y - lift + actor.height / 2,
        left: actor.x - actor.width / 2,
        right: actor.x + actor.width / 2,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlaps).toBe(false);
      }
    }
  });

  test("result is independent of input array order (stable id-sorted resolution)", () => {
    const a: NameplateActor = { id: "a", x: 500, y: 300, width: 90, height: 15 };
    const b: NameplateActor = { id: "b", x: 505, y: 300, width: 90, height: 15 };
    const forward = resolveNameplateLifts([a, b]);
    const reversed = resolveNameplateLifts([b, a]);
    expect(forward.get("a")).toBe(reversed.get("a"));
    expect(forward.get("b")).toBe(reversed.get("b"));
  });

  test("a single actor never gets lifted", () => {
    const lifts = resolveNameplateLifts([{ id: "solo", x: 0, y: 0, width: 100, height: 15 }]);
    expect(lifts.get("solo")).toBe(0);
  });
});

// mobile-experience.md wave-2, clusterA-06 — the in-world nameplate had zero
// camera awareness: on portrait mobile, PORTRAIT_CAM_Y_BIAS rides the player
// high in the frame (clear of the bottom touch-control band), which eats
// into the headroom the plate lives in — a high platform/jump can push the
// plate's own top edge above the camera's visible top edge, hard-clipping
// it mid-glyph. clampNameplateAnchorY closes that: it floors the anchor so
// the plate's top edge never crosses the camera's worldView.y line.
describe("clampNameplateAnchorY", () => {
  test("no camera reference is a no-op — matches pre-fix behavior exactly", () => {
    expect(clampNameplateAnchorY(1000, 1, undefined)).toBe(1000);
    expect(clampNameplateAnchorY(-500, 1, undefined)).toBe(-500);
  });

  test("anchor comfortably inside the frame is left untouched", () => {
    // cameraTopWorldY=1000 → clamp floor is 1045 (scale 1); 1500 is well clear.
    expect(clampNameplateAnchorY(1500, 1, 1000)).toBe(1500);
  });

  test("anchor that would push the plate above the frame gets floored to the safe line", () => {
    // Raw anchor sits ABOVE the camera's visible top edge (900 < 1000) — the
    // plate would render partially/fully off-screen without the clamp.
    const clamped = clampNameplateAnchorY(900, 1, 1000);
    expect(clamped).toBe(1045); // 1000 + (17 + 28) * 1
    expect(clamped).toBeGreaterThan(900);
  });

  test("clamp floor scales with the rig's scale factor", () => {
    const clamped = clampNameplateAnchorY(0, 2, 1000);
    expect(clamped).toBe(1090); // 1000 + (17 + 28) * 2
  });

  test("the clamped plate's own top edge (17*s above anchor) never lands above the camera's visible top edge", () => {
    const cameraTopWorldY = 400;
    const scale = 1.5;
    const clampedAnchor = clampNameplateAnchorY(-1000, scale, cameraTopWorldY);
    const plateTop = clampedAnchor - 17 * scale;
    // FRAME_TOP_CLEARANCE(28)*scale of gutter above the camera's own edge.
    expect(plateTop).toBeGreaterThanOrEqual(cameraTopWorldY + 28 * scale - 1e-9);
  });

  test("right at the threshold, the anchor passes through unchanged (boundary is inclusive)", () => {
    const cameraTopWorldY = 200;
    const scale = 1;
    const threshold = cameraTopWorldY + 45 * scale;
    expect(clampNameplateAnchorY(threshold, scale, cameraTopWorldY)).toBe(threshold);
  });
});
