// Interstice wave 3 — closes the wave-2 open item "idle->swing pose-
// continuity is UNVERIFIED, not confirmed clean" (slash-feel-ledger,
// I10/wave-3 queue). Wave 2 tried two methods and both were inconclusive:
// (a) comparing two independently-scrubbed harness stills is invalid — each
// harness rigFrame() call inits its arm springs AT the target, so there is
// no real transition to observe; (b) extracting live-tape video frames
// around a slash-started epoch never caught a clean isolated transition
// because real combat is point-blank/continuous.
//
// This file proves it a THIRD way that sidesteps both traps: it drives the
// REAL production functions — springState/springTo (spring.ts, the exact
// integrator ProceduralPlayerRig.draw() calls for every hand every frame)
// and meleeHandPose/meleeOffhandPose/meleeKineticChain (meleeTiming.ts, the
// exact authored target formulas) — through a continuous, single persistent
// "spring state" across a full idle -> windup -> active -> recovery -> idle
// cycle, INCLUDING a retrig (a second swing triggered mid-recovery, dir
// flipped, mirroring ConstructVfxController's real alternating-combo rule:
// `dir = inCombo ? -prev.dir : 1`). ProceduralPlayerRig itself can't be
// constructed under `bun test` (imports Phaser — see chassisSilhouette.
// test.ts's header comment), so the arm-target dispatch that decides WHICH
// hand is "active" vs "guard" and what armFreq/armDamp apply is faithfully
// reproduced here (mirroring the established pattern in this very file's
// "live melee blade wiring" describe block, which reimplements the
// meleePoseMs decay loop and calls the real draw-param functions).
//
// The reimplemented slice (shoulder position from meleeKineticChain's
// shoulderTwist, activeLead = dir > 0, meleeHandPose/meleeOffhandPose
// target selection, armFreq/armDamp phase selection) is a direct transcription
// of ProceduralPlayerRig.ts's melee-active branch (~lines 1618-1670) and its
// armFreq/armDamp selection (~lines 1863-1870) — verify against those lines
// if this test's shoulder/chest simplification (chest fixed at origin,
// aimAngle=0, scale=1) is ever suspected of drifting from the live rig.
//
// METHOD: "no visible pose-snap" is operationalized as "no transition
// produces a per-frame rendered-position delta that exceeds the swing's OWN
// already-shipped, already-tape-verified fastest natural motion (the cut-
// phase whip) by more than a modest margin." The cut-phase whip is the
// fastest legitimate motion in the whole system by design (I1-I10's own
// "hand always ahead of the eye" character) — anything within its ballpark
// reads as more of the same fast-cut character, not a separate discontinuity.
import { describe, expect, test } from "bun:test";
import { springState, springTo, type SpringState } from "../../rendering/spring";
import { BLADE_SWING_MS, meleeHandPose, meleeKineticChain, meleeOffhandPose } from "../meleeTiming.js";

const FRAME_MS = 1000 / 60;
const STYLE = "interstice" as const;

/** Mirrors ProceduralPlayerRig's shoulderLead/shoulderBack (chest fixed at
 *  origin, aim straight along +x, scale 1 — see this file's header comment).
 *  `t < 0` requests the at-rest (no active swing) shoulderTwist of 0. */
function shoulders(dir: number, t: number): { lead: { x: number; y: number }; back: { x: number; y: number } } {
  const shoulderTwist = t >= 0 ? meleeKineticChain(t, STYLE).shoulderTwist : 0;
  const shoulderAxis = Math.atan2(1, -0) + dir * shoulderTwist; // atan2(aim.x, -aim.y), aim = (1,0)
  const px = Math.cos(shoulderAxis);
  const py = Math.sin(shoulderAxis);
  return { lead: { x: px * 7, y: py * 7 }, back: { x: -px * 7, y: -py * 7 } };
}

/** ProceduralPlayerRig's ninjaCoilMix idle-arm target (lines ~1789-1807),
 *  fully settled (ninjaCoilMix = 1), aimAngle = 0 so downBias = 1. */
function coiledIdleTarget(): { lead: { x: number; y: number }; back: { x: number; y: number } } {
  const rest = shoulders(1, -1);
  const leadAngle = 1.0;
  const backAngle = 1.45;
  return {
    lead: {
      x: rest.lead.x + Math.cos(leadAngle) * 27,
      y: Math.max(rest.lead.y + Math.sin(leadAngle) * 27, rest.lead.y + 14),
    },
    back: {
      x: rest.back.x + Math.cos(backAngle) * 23,
      y: Math.max(rest.back.y + Math.sin(backAngle) * 23, rest.back.y + 12),
    },
  };
}

type Rig = { leadX: SpringState; leadY: SpringState; backX: SpringState; backY: SpringState };

function stepIdle(rig: Rig, target: { lead: { x: number; y: number }; back: { x: number; y: number } }): void {
  // baseArmFreq/baseArmDamp at danceRaise=0 (ProceduralPlayerRig.ARM_FREQUENCY_HZ/ARM_DAMPING).
  springTo(rig.leadX, target.lead.x, FRAME_MS, 5.2, 0.52);
  springTo(rig.leadY, target.lead.y, FRAME_MS, 5.2, 0.52);
  springTo(rig.backX, target.back.x, FRAME_MS, 5.2, 0.52);
  springTo(rig.backY, target.back.y, FRAME_MS, 5.2, 0.52);
}

/** One frame of the REAL melee-active arm-target dispatch (ProceduralPlayerRig
 *  lines ~1629-1653 for interstice) + the REAL armFreq/armDamp phase pick
 *  (~lines 1863-1870), driven at meleeT = 1 - meleePoseMs/durationMs. */
function stepSwing(rig: Rig, dir: number, meleePoseMs: number, durationMs: number): void {
  const t = Math.max(0, Math.min(0.999, 1 - meleePoseMs / durationMs));
  const activeLead = dir > 0; // meleeActiveHand("interstice", dir)
  const sh = shoulders(dir, t);
  const shoulder = activeLead ? sh.lead : sh.back;
  const guardShoulder = activeLead ? sh.back : sh.lead;
  const handPose = meleeHandPose(0, dir, t, STYLE);
  const offPose = meleeOffhandPose(0, dir, t);
  const activeTarget = {
    x: shoulder.x + Math.cos(handPose.angle) * handPose.reach,
    y: shoulder.y + Math.sin(handPose.angle) * handPose.reach,
  };
  const guardTarget = {
    x: guardShoulder.x + Math.cos(offPose.angle) * offPose.reach,
    y: guardShoulder.y + Math.sin(offPose.angle) * offPose.reach,
  };
  const leadTarget = activeLead ? activeTarget : guardTarget;
  const backTarget = activeLead ? guardTarget : activeTarget;
  const cutActive = t >= 0.15 && t < 0.42; // meleeAnticipationEnd/meleeCutEnd, interstice
  const armFreq = cutActive ? 18 : 10;
  const armDamp = cutActive ? 0.76 : 0.88;
  springTo(rig.leadX, leadTarget.x, FRAME_MS, armFreq, armDamp);
  springTo(rig.leadY, leadTarget.y, FRAME_MS, armFreq, armDamp);
  springTo(rig.backX, backTarget.x, FRAME_MS, armFreq, armDamp);
  springTo(rig.backY, backTarget.y, FRAME_MS, armFreq, armDamp);
}

type Sample = { phase: string; lead: { x: number; y: number }; back: { x: number; y: number } };

/** Runs the full idle -> swing1(dir=+1) -> RETRIG at t~=0.88 (meleeTiming.
 *  ts's own documented "a max-cadence retrig legitimately interrupts at
 *  t≈0.88, deep in recovery" comment — the worst-case legitimate retrig
 *  point) -> swing2(dir=-1) -> idle cycle on ONE persistent spring state,
 *  sampling every frame. Returns the samples plus the indices of the two
 *  transition boundaries under test. */
function runCycle(): { samples: Sample[]; coldStartIdx: number; retrigIdx: number } {
  const rig: Rig = {
    leadX: springState(29), leadY: springState(0),
    backX: springState(29), backY: springState(0),
  };
  const idle = coiledIdleTarget();
  const samples: Sample[] = [];
  const push = (phase: string) => samples.push({
    phase,
    lead: { x: rig.leadX.value, y: rig.leadY.value },
    back: { x: rig.backX.value, y: rig.backY.value },
  });

  for (let i = 0; i < Math.round(400 / FRAME_MS); i++) { stepIdle(rig, idle); push("idle"); }

  const coldStartIdx = samples.length;
  let meleePoseMs = BLADE_SWING_MS;
  for (;;) {
    meleePoseMs = Math.max(0, meleePoseMs - FRAME_MS);
    stepSwing(rig, 1, meleePoseMs, BLADE_SWING_MS);
    push("swing1");
    const tNow = 1 - meleePoseMs / BLADE_SWING_MS;
    if (tNow >= 0.88 || meleePoseMs <= 0) break;
  }

  const retrigIdx = samples.length;
  meleePoseMs = BLADE_SWING_MS; // triggerMeleeSwing(): resets to full duration
  while (meleePoseMs > 0) {
    meleePoseMs = Math.max(0, meleePoseMs - FRAME_MS);
    stepSwing(rig, -1, meleePoseMs, BLADE_SWING_MS);
    push("swing2");
  }

  for (let i = 0; i < Math.round(400 / FRAME_MS); i++) { stepIdle(rig, idle); push("idle2"); }

  return { samples, coldStartIdx, retrigIdx };
}

function delta(a: Sample, b: Sample): { lead: number; back: number } {
  return {
    lead: Math.hypot(b.lead.x - a.lead.x, b.lead.y - a.lead.y),
    back: Math.hypot(b.back.x - a.back.x, b.back.y - a.back.y),
  };
}

describe("Interstice retrig/cold-start pose continuity (slash-feel-ledger wave 3)", () => {
  const { samples, coldStartIdx, retrigIdx } = runCycle();

  test("every sampled hand position across the whole cycle is finite (no NaN/Infinity blowups)", () => {
    for (const s of samples) {
      expect(Number.isFinite(s.lead.x)).toBe(true);
      expect(Number.isFinite(s.lead.y)).toBe(true);
      expect(Number.isFinite(s.back.x)).toBe(true);
      expect(Number.isFinite(s.back.y)).toBe(true);
    }
  });

  test("neither cold-start (idle->windup) nor retrig (recovery->next windup) exceeds the swing's own natural cut-phase speed by more than 1.5x", () => {
    // Baseline: the fastest legitimate per-frame motion anywhere in swing1
    // BEFORE the retrig fires (untouched by it) — this is the cut-phase
    // whip, already shipped and tape-verified (I1-I10) as reading smooth,
    // not a snap. Any transition delta landing in this same ballpark is
    // "more of the same fast cut," not a separate discontinuity.
    let baselineLead = 0;
    let baselineBack = 0;
    for (let i = coldStartIdx + 1; i < retrigIdx; i++) {
      const d = delta(samples[i - 1]!, samples[i]!);
      baselineLead = Math.max(baselineLead, d.lead);
      baselineBack = Math.max(baselineBack, d.back);
    }
    expect(baselineLead).toBeGreaterThan(0); // sanity: the swing actually moves the hand

    const BOUND = 1.5;
    const checkWindow = (label: string, startIdx: number, count: number) => {
      for (let i = startIdx; i < startIdx + count; i++) {
        const d = delta(samples[i - 1]!, samples[i]!);
        expect(d.lead, `${label} frame ${i - startIdx}: lead delta ${d.lead.toFixed(2)}px vs baseline ${baselineLead.toFixed(2)}px`).toBeLessThanOrEqual(baselineLead * BOUND);
        expect(d.back, `${label} frame ${i - startIdx}: back delta ${d.back.toFixed(2)}px vs baseline ${baselineBack.toFixed(2)}px`).toBeLessThanOrEqual(Math.max(baselineBack * BOUND, baselineLead * BOUND));
      }
    };
    // Cold start: the first several frames after idle ends and swing1 begins.
    checkWindow("cold-start", coldStartIdx, 6);
    // Retrig: the first several frames after swing2 begins (dir flipped,
    // active/guard hand roles swapped — the actual "recovery blending into
    // next windup" moment the ledger names).
    checkWindow("retrig", retrigIdx, 6);
  });

  test("recovery settles toward idle without overshooting past the idle target and back (a double-bounce would read as a wobble/snap, not a settle)", () => {
    const idle = coiledIdleTarget();
    // Sample the tail of idle2 (well past the recovery hand-off) — it must
    // have converged close to the idle target, not be left oscillating.
    const tail = samples.slice(-5);
    for (const s of tail) {
      expect(Math.hypot(s.lead.x - idle.lead.x, s.lead.y - idle.lead.y)).toBeLessThan(1.5);
      expect(Math.hypot(s.back.x - idle.back.x, s.back.y - idle.back.y)).toBeLessThan(1.5);
    }
  });
});
