// KINDLED WARD BRACE pose (K11 — slash-feel-ledger FULL ANIMATION GAMUT
// "Ward raise/hold": braced set, knees bent, slab planted). Pure planner
// layer, Phaser-free — same testable-surface discipline as
// meleeBashPose.test.ts. Proves the whole-body contract: everything eases
// with braceK (no pop), the slab plants forward-square along aim, the
// sword yields to the low-rear guard on the bash's own chamber line (so
// ward → bash flows without a pose reset), and the stance sets wider and
// lower than the braced idle.

import { describe, expect, test } from "bun:test";
import { bashSwordHandPose, wardBracePose } from "../meleeTiming.js";

const AIM = -0.276; // the harness's canonical aim angle

describe("ward brace — scales with braceK, quiet at zero", () => {
  test("braceK 0 is the resting hand line (no drop, no widen, no lean)", () => {
    const rest = wardBracePose(0, AIM, 1);
    expect(rest.kneeDropPx).toBe(0);
    expect(rest.stanceWidenPx).toBe(0);
    expect(rest.leanPx).toBe(0);
    expect(rest.slab.angle).toBeCloseTo(AIM, 5); // no raise-tilt yet
    expect(rest.sword.angle).toBeCloseTo(AIM, 5);
  });

  test("every channel is monotonic in braceK (the raise EASES, never pops)", () => {
    let prev = wardBracePose(0, AIM, 1);
    for (const k of [0.25, 0.5, 0.75, 1]) {
      const cur = wardBracePose(k, AIM, 1);
      expect(cur.kneeDropPx).toBeGreaterThan(prev.kneeDropPx);
      expect(cur.stanceWidenPx).toBeGreaterThan(prev.stanceWidenPx);
      expect(cur.leanPx).toBeGreaterThan(prev.leanPx);
      expect(cur.slab.reach).toBeGreaterThan(prev.slab.reach);
      prev = cur;
    }
  });

  test("braceK clamps outside 0..1", () => {
    expect(wardBracePose(-1, AIM, 1)).toEqual(wardBracePose(0, AIM, 1));
    expect(wardBracePose(2, AIM, 1)).toEqual(wardBracePose(1, AIM, 1));
  });
});

describe("ward brace — the slab PLANTS, the sword YIELDS", () => {
  test("slab punches forward along aim (near-square, chest-line high bias)", () => {
    const full = wardBracePose(1, AIM, 1);
    // Within ~5° of square to the threat, biased slightly high (guarding
    // the chest/visor line, never drooping).
    expect(Math.abs(full.slab.angle - AIM)).toBeLessThan(0.09);
    expect(full.slab.angle).toBeLessThan(AIM);
    // Planted well forward of the braced-idle slab (~21px).
    expect(full.slab.reach).toBeGreaterThan(30);
  });

  test("sword pulls to the LOW-REAR guard — behind the body line, off the slab's lane", () => {
    const full = wardBracePose(1, AIM, 1);
    expect(Math.abs(full.sword.angle - AIM)).toBeGreaterThan(2);
    // Reach stays short — held, not swung.
    expect(full.sword.reach).toBeLessThan(full.slab.reach);
  });

  test("sword guard sits on the bash's own chamber line (ward → bash flows, no pose reset)", () => {
    const full = wardBracePose(1, AIM, 1);
    const bashChamberEnd = bashSwordHandPose(AIM, 1, 0.35);
    expect(Math.abs(full.sword.angle - bashChamberEnd.angle)).toBeLessThan(0.15);
    expect(Math.abs(full.sword.reach - bashChamberEnd.reach)).toBeLessThan(4);
  });

  test("facing mirror flips the sword guard side, slab stays on aim", () => {
    const right = wardBracePose(1, AIM, 1);
    const left = wardBracePose(1, AIM, -1);
    expect(right.slab.angle).toBeCloseTo(left.slab.angle, 5);
    expect(right.sword.angle - AIM).toBeCloseTo(-(left.sword.angle - AIM), 5);
  });
});

describe("ward brace — braced SET, knees bent, wider than the braced idle", () => {
  test("full brace drops the knees and widens past the idle's ±3.5px plant", () => {
    const full = wardBracePose(1, AIM, 1);
    expect(full.kneeDropPx).toBeGreaterThanOrEqual(6);
    expect(full.stanceWidenPx).toBeGreaterThan(3.5);
    // Lean presses INTO the shield, but stays subordinate to the drop —
    // a set stance, not a stagger forward.
    expect(full.leanPx).toBeGreaterThan(0);
    expect(full.leanPx).toBeLessThan(full.kneeDropPx);
  });
});
