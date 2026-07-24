import { describe, expect, test } from "bun:test";
import {
  appendBladeTip,
  BLADE_SWING_MS,
  EDGE_SWING_MS,
  INTERSTICE_BLADE_REACH_PX,
  INTERSTICE_BLADE_SWEEP_RAD,
  KINDLED_BLADE_REACH_PX,
  KINDLED_BLADE_SWEEP_RAD,
  meleeActiveHand,
  meleeBladeAngle,
  meleeBladeDrawParams,
  meleeBladeTip,
  meleeContactT,
  meleeHandPose,
  meleeKineticChain,
  meleeStage,
} from "../meleeTiming.js";

describe("melee attack rhythm", () => {
  test("Interstice keeps anticipation brief — a flick, not a wind-up", () => {
    expect(meleeStage(0.1, "interstice").anticipation).toBeGreaterThan(0.5);
    expect(meleeStage(0.1, "interstice").cut).toBe(0);
    expect(meleeStage(0.7, "interstice").cut).toBe(1);
    expect(meleeStage(0.7, "interstice").followThrough).toBeGreaterThan(0);
    expect(meleeStage(0.7, "interstice").recovery).toBe(0);
  });

  test("Kindled commits longer than Interstice", () => {
    expect(EDGE_SWING_MS).toBeGreaterThan(BLADE_SWING_MS);
    expect(meleeStage(0.25, "kindled").cut).toBe(0);
    expect(meleeStage(0.86, "kindled").followThrough).toBeGreaterThan(0.8);
    expect(meleeStage(0.86, "kindled").recovery).toBe(0);
  });

  test("Interstice is a broad cut rather than a full windmill", () => {
    const start = meleeBladeAngle(0, 2.25, 1, 0.15, "interstice");
    const finish = meleeBladeAngle(0, 2.25, 1, 0.80, "interstice");
    const travel = finish - start;
    expect(travel).toBeGreaterThan(Math.PI);
    expect(travel).toBeLessThan(Math.PI * 1.15);
  });

  test("the elbow/hand chain is not welded collinear with the blade", () => {
    const t = 0.28;
    const blade = meleeBladeAngle(0, 2.25, 1, t, "interstice");
    const hand = meleeHandPose(0, 1, t, "interstice");
    expect(Math.abs(blade - hand.angle)).toBeGreaterThan(0.3);
  });

  test("the sword hand folds in during coil then extends beyond contact", () => {
    const coil = meleeHandPose(0, 1, 0.15, "interstice");
    const extension = meleeHandPose(0, 1, 0.42, "interstice");
    // Extension is deliberately capped well under ProceduralPlayerRig's
    // ARM_REACH (40) so the two-bone solve keeps a visible elbow bend at
    // contact instead of pinning straight (see meleeHandPose's comment) —
    // this still asserts real growth, just not enough to weld the arm.
    expect(extension.reach - coil.reach).toBeGreaterThan(10);
    expect(extension.reach).toBeLessThan(36);
    expect(extension.angle).toBeGreaterThan(coil.angle);
  });

  test("the authored radial intercept crosses aim near peak tip speed", () => {
    for (const [style, duration] of [
      ["interstice", BLADE_SWING_MS],
      ["kindled", EDGE_SWING_MS],
    ] as const) {
      const contact = meleeContactT(style);
      const angle = meleeBladeAngle(0, 2.25, 1, contact, style);
      expect(Math.abs(angle)).toBeLessThan(0.08);

      const speedAt = (t: number) =>
        (meleeBladeAngle(0, 2.25, 1, t + 0.004, style) -
          meleeBladeAngle(0, 2.25, 1, t - 0.004, style)) /
        0.008;
      expect(speedAt(contact)).toBeGreaterThan(speedAt(contact - 0.06));
      expect(speedAt(contact)).toBeGreaterThan(speedAt(contact + 0.06));

      // R1 ROW 2 CONTACT-FRAME ALIGNMENT (I1, 2026-07-24 — the R3-binding
      // step): the visual cut must cross the target on the SIM's own
      // damage-gate tick ±1t (16.7ms @60Hz). Sim gates (World.ts/world.zig):
      // Interstice SLASH_WINDUP_MS + SLASH_CONTACT_DELAY_MS = 60 + 22 = 82ms;
      // Kindled EDGE 200 + 100 = 300ms. 245 × 0.3336 = 81.8ms; 560 × 0.5364
      // = 300.4ms. The old interstice 120ms sentence landed ~40ms — the
      // blade finished cutting before damage could even gate on.
      const simGateMs = style === "interstice" ? 82 : 300;
      expect(Math.abs(contact * duration - simGateMs)).toBeLessThan(1000 / 60);
    }
  });

  test("the cut releases hips, chest, then shoulders instead of one rigid block", () => {
    for (const style of ["interstice", "kindled"] as const) {
      const cutStart = style === "interstice" ? 0.15 : 0.38;
      const cutEnd = style === "interstice" ? 0.42 : 0.61;
      const earlyCut = cutStart + (cutEnd - cutStart) * 0.24;
      const early = meleeKineticChain(earlyCut, style);
      expect(early.pelvisDrive).toBeGreaterThan(early.chestDrive);
      expect(early.shoulderTwist).toBeLessThan(0);
      expect(early.frontBrace).toBe(1);

      const contact = meleeKineticChain(meleeContactT(style), style);
      expect(contact.pelvisDrive).toBeGreaterThan(0);
      expect(contact.chestDrive).toBeGreaterThan(0);
      expect(contact.headDrive).toBeLessThan(contact.chestDrive);
      const follow = meleeKineticChain(style === "interstice" ? 0.7 : 0.76, style);
      expect(follow.shoulderTwist).toBeGreaterThan(contact.shoulderTwist);
      expect(follow.chestDrive).toBeGreaterThan(follow.pelvisDrive);
    }
  });

  test("the distal blade overtakes the hands at the radial intercept", () => {
    for (const style of ["interstice", "kindled"] as const) {
      const contact = meleeContactT(style);
      const delta = 0.002;
      const bladeSpeed = Math.abs(
        meleeBladeAngle(0, 2.25, 1, contact + delta, style) -
        meleeBladeAngle(0, 2.25, 1, contact - delta, style)
      ) / (2 * delta);
      const handSpeed = Math.abs(
        meleeHandPose(0, 1, contact + delta, style).angle -
        meleeHandPose(0, 1, contact - delta, style).angle
      ) / (2 * delta);
      expect(bladeSpeed).toBeGreaterThan(handSpeed * 2);
    }
  });
});

// ── live-rig wiring: the actual bug fix ─────────────────────────────────────
// ProceduralPlayerRig itself can't be constructed under `bun test` — this
// codebase's established rule (see chassisSilhouette.test.ts's header
// comment): `import Phaser from "phaser"` throws ("window is not defined").
// So the WHAT-TO-DRAW decision was factored out of ProceduralPlayerRig.draw()
// into these pure, Phaser-free functions (meleeBladeDrawParams/meleeBladeTip/
// appendBladeTip/meleeActiveHand in meleeTiming.ts) precisely so the wiring
// that closes the "invisible blade" bug is provable without a live engine.
// This simulates the exact frame loop ProceduralPlayerRig.update() runs
// (meleePoseMs = Math.max(0, meleePoseMs - deltaMs) once per frame) and
// asserts the blade-draw params that would feed drawBladeSwing/
// drawKindledSwing are non-null, non-NaN, and sane throughout an active
// swing — this is the part that's programmatically proven. Whether the
// resulting pixels actually READ as a blade on screen depends on
// drawBladeSwing/drawKindledSwing's own internal painting, which is outside
// what a unit test can see (no browser/screenshot access here).
describe("live melee blade wiring — ProceduralPlayerRig.draw()'s per-frame params", () => {
  const FRAME_MS = 1000 / 60;
  const LEAD_HAND = { x: 120, y: 80 };
  const BACK_HAND = { x: 96, y: 88 };

  function simulateSwing(style: "interstice" | "kindled", dir: number) {
    const durationMs = style === "interstice" ? BLADE_SWING_MS : EDGE_SWING_MS;
    let meleePoseMs = durationMs;
    const frames: ReturnType<typeof meleeBladeDrawParams>[] = [];
    // Mirrors triggerMeleeSwing(): meleePoseMs starts at the full duration,
    // and the first frame after the trigger has already ticked down once
    // (the same order ProceduralPlayerRig.update() runs: decay, then draw).
    while (meleePoseMs > 0) {
      meleePoseMs = Math.max(0, meleePoseMs - FRAME_MS);
      frames.push(
        meleeBladeDrawParams(style, meleePoseMs, durationMs, dir, 0, LEAD_HAND, BACK_HAND),
      );
    }
    return frames;
  }

  test("Interstice: every frame of an active swing produces sane, non-NaN draw params", () => {
    const frames = simulateSwing("interstice", 1);
    expect(frames.length).toBeGreaterThan(3); // 245ms @60fps ≈ 14 frames
    const active = frames.slice(0, -1); // last frame is the swing's own end (meleePoseMs hits 0)
    expect(active.length).toBeGreaterThan(0);
    for (const p of active) {
      expect(p).not.toBeNull();
      expect(Number.isNaN(p!.t)).toBe(false);
      expect(p!.t).toBeGreaterThanOrEqual(0);
      expect(p!.t).toBeLessThanOrEqual(1);
      expect(p!.reach).toBe(INTERSTICE_BLADE_REACH_PX);
      expect(p!.sweepRad).toBe(INTERSTICE_BLADE_SWEEP_RAD);
      expect(p!.leadPivot).toEqual(LEAD_HAND);
      expect(p!.backPivot).toEqual(BACK_HAND);
    }
    // t climbs from near-zero toward 1 across the swing (monotonic progress,
    // not a stuck or reversed value).
    expect(active[0]!.t).toBeLessThan(0.25);
    expect(active[active.length - 1]!.t).toBeGreaterThan(0.85);
  });

  test("Kindled: same sanity, with the heavier chassis's own reach/sweep/duration", () => {
    const frames = simulateSwing("kindled", 1);
    expect(frames.length).toBeGreaterThan(3);
    const active = frames.slice(0, -1);
    for (const p of active) {
      expect(p).not.toBeNull();
      expect(Number.isNaN(p!.t)).toBe(false);
      expect(p!.reach).toBe(KINDLED_BLADE_REACH_PX);
      expect(p!.sweepRad).toBe(KINDLED_BLADE_SWEEP_RAD);
    }
    expect(active[active.length - 1]!.t).toBeGreaterThan(0.85);
  });

  test("once meleePoseMs hits 0 the params go null — no swing renders at rest", () => {
    const frames = simulateSwing("interstice", 1);
    expect(frames[frames.length - 1]).toBeNull();
    // Explicitly: a frame called with meleePoseMs<=0 outside any swing loop
    // also yields null, matching draw()'s `if (bladeParams) { ... }` guard.
    expect(meleeBladeDrawParams("interstice", 0, BLADE_SWING_MS, 1, 0, LEAD_HAND, BACK_HAND)).toBeNull();
    expect(meleeBladeDrawParams("kindled", -5, EDGE_SWING_MS, 1, 0, LEAD_HAND, BACK_HAND)).toBeNull();
  });

  test("Kindled always swings from the lead/sword hand; Interstice alternates by combo dir", () => {
    expect(meleeActiveHand("kindled", 1)).toBe("lead");
    expect(meleeActiveHand("kindled", -1)).toBe("lead"); // shield hand never swings
    expect(meleeActiveHand("interstice", 1)).toBe("lead");
    expect(meleeActiveHand("interstice", -1)).toBe("back");

    const leadSwing = meleeBladeDrawParams("interstice", 100, BLADE_SWING_MS, 1, 0, LEAD_HAND, BACK_HAND);
    expect(leadSwing!.activePivot).toEqual(LEAD_HAND);
    const backSwing = meleeBladeDrawParams("interstice", 100, BLADE_SWING_MS, -1, 0, LEAD_HAND, BACK_HAND);
    expect(backSwing!.activePivot).toEqual(BACK_HAND);
    const kindledSwing = meleeBladeDrawParams("kindled", 100, EDGE_SWING_MS, -1, 0, LEAD_HAND, BACK_HAND);
    expect(kindledSwing!.activePivot).toEqual(LEAD_HAND);
  });

  test("meleeBladeTip lands roughly `reach` px from the pivot, never NaN/degenerate", () => {
    for (const style of ["interstice", "kindled"] as const) {
      const reach = style === "interstice" ? INTERSTICE_BLADE_REACH_PX : KINDLED_BLADE_REACH_PX;
      const sweep = style === "interstice" ? INTERSTICE_BLADE_SWEEP_RAD : KINDLED_BLADE_SWEEP_RAD;
      for (const t of [0, 0.15, 0.5, 0.85, 0.999]) {
        const tip = meleeBladeTip(LEAD_HAND, 0, sweep, 1, t, style, reach);
        expect(Number.isFinite(tip.x)).toBe(true);
        expect(Number.isFinite(tip.y)).toBe(true);
        const dist = Math.hypot(tip.x - LEAD_HAND.x, tip.y - LEAD_HAND.y);
        expect(dist).toBeCloseTo(reach, 1);
      }
    }
  });

  test("appendBladeTip accumulates live per-frame samples and caps length (not the harness's precomputed timeline)", () => {
    let history: { x: number; y: number }[] = [];
    for (let i = 0; i < 40; i++) {
      history = appendBladeTip(history, { x: i, y: -i }, 24);
    }
    expect(history.length).toBe(24);
    // Newest sample is last, oldest samples were dropped (not the earliest
    // pushed survive-forever — a live trail must forget, not just grow).
    expect(history[history.length - 1]).toEqual({ x: 39, y: -39 });
    expect(history[0]).toEqual({ x: 16, y: -16 });

    // Clearing (triggerMeleeSwing's reset) starts a fresh trail, not a
    // continuation of the previous swing's tail.
    const cleared = appendBladeTip([], { x: 0, y: 0 }, 24);
    expect(cleared).toEqual([{ x: 0, y: 0 }]);
  });
});
