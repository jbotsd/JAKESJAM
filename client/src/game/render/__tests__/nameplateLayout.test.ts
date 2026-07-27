// clip-goal STUDY 3, CL.A regression — "adjacent bot nameplates collide/
// overlap" was noted in passing on the 2026-07-17 CL.A ledger entry but no
// pillar ever assigned it a test; it reproduced on tape 2026-07-27
// (`0e21238e`, t≈0.03s: VVOC/BOT·PISTON nameplates garbled together).

import { describe, test, expect } from "bun:test";
import { resolveNameplateLifts, type NameplateActor } from "../nameplateLayout";

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
