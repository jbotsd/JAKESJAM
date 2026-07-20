// Interstice is the "flick, no drag" chassis (chassis-design-axioms CA — the
// ninja weight contract): research on fast/player-controlled melee (Owlboy's
// Nemo has near-zero anticipation; Hollow Knight decouples visual swing from
// input-lock) says anticipation should read as almost-already-cut, not a
// telegraphed wind-up. Kindled is the deliberate opposite — a heavier,
// ground-loaded commit — and keeps its wider sentence.
// BLADE_SWING_MS halved 2026-07-20 (was 240) alongside the sim's own
// SLASH_WINDUP_MS/SLASH_ACTIVE_MS/SLASH_RECOVERY_MS halving (World.ts) —
// same DPS, twice the swing cadence. Without this, the visual swing pose
// would still play at the old (now stale) duration while the sim already
// allows the next swing input twice as soon, reading as desynced/laggy.
// EDGE_SWING_MS (Kindled) is untouched — that chassis's own timing wasn't
// part of this balance pass.
export const BLADE_SWING_MS = 120;
export const EDGE_SWING_MS = 560;

/** Blade-construct geometry (reach/sweep) for the LIVE swing render — same
 * literals the offline construct-harness review uses for `drawBladeSwing`/
 * `drawKindledSwing` (client/src/constructHarness.ts), kept as one named
 * source here so the live rig and the harness read the same "how big is
 * this blade" contract instead of two independently-tuned magic numbers. */
export const INTERSTICE_BLADE_REACH_PX = 82;
export const INTERSTICE_BLADE_SWEEP_RAD = 2.25;
export const KINDLED_BLADE_REACH_PX = 88;
export const KINDLED_BLADE_SWEEP_RAD = 2.5;
/** Point inside the authored cut where the blade crosses the captured aim
 * radius at peak tip speed. This is deliberately not the end of the move:
 * contact needs visible follow-through on the far side of the target. */
export const MELEE_CONTACT_CUT_FRACTION = 0.68;

export function meleeContactT(style: "interstice" | "kindled"): number {
  const cutStart = style === "interstice" ? 0.15 : 0.38;
  const cutEnd = style === "interstice" ? 0.42 : 0.61;
  return cutStart + (cutEnd - cutStart) * MELEE_CONTACT_CUT_FRACTION;
}

export function meleeStage(t: number, style: "interstice" | "kindled"): {
  anticipation: number;
  cut: number;
  followThrough: number;
  recovery: number;
} {
  const aEnd = style === "interstice" ? 0.15 : 0.38;
  const cutEnd = style === "interstice" ? 0.42 : 0.61;
  const followEnd = style === "interstice" ? 0.80 : 0.88;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    anticipation: clamp(t / aEnd),
    cut: clamp((t - aEnd) / (cutEnd - aEnd)),
    followThrough: clamp((t - cutEnd) / (followEnd - cutEnd)),
    recovery: clamp((t - followEnd) / (1 - followEnd)),
  };
}

/** Rotation fraction including coil and overshoot. Kept shared by painter and
 * controller so the visible blade and its sampled world-space tip path cannot
 * diverge. */
export function meleeSweepFraction(t: number, style: "interstice" | "kindled"): number {
  const s = meleeStage(t, style);
  if (style === "interstice") {
    // Five silhouette keys, expressed against the nominal start/end sweep:
    // ready → deep coil → contact extension → blade-led overshoot → guard.
    // The cut uses an acceleration-to-contact curve rather than generic
    // smoothstep: sparse frames before contact, then visible braking after.
    if (t < 0.15) return lerp(0.24, -0.22, smooth(s.anticipation));
    if (t < 0.42) return lerp(-0.22, 0.88, cutWhip(s.cut));
    if (t < 0.80) return lerp(0.88, 1.22, easeOutCubic(s.followThrough));
    return lerp(1.22, 0.92, smooth(s.recovery));
  }
  if (t < 0.38) return lerp(0.28, -0.12, smooth(s.anticipation));
  if (t < 0.61) return lerp(-0.12, 0.82, cutWhip(s.cut));
  if (t < 0.88) return lerp(0.82, 1.1, easeOutCubic(s.followThrough));
  return lerp(1.1, 0.85, smooth(s.recovery));
}

export function meleeBladeAngle(
  aimRad: number,
  sweepRad: number,
  dir: number,
  t: number,
  style: "interstice" | "kindled",
): number {
  const start = aimRad - dir * sweepRad / 2;
  const end = aimRad + dir * sweepRad / 2;
  return start + (end - start) * meleeSweepFraction(t, style);
}

/** Proximal-to-distal body sentence, expressed as absolute forward drives in
 * rig pixels plus a shoulder-line rotation. It borrows the useful mechanism
 * from a baseball swing: load against the rear side, open the pelvis first,
 * let the chest and shoulders chase it, brace the front side, and allow the
 * weapon to be the final/fastest link. It does not make either fighter hold a
 * sword like a two-handed bat. */
export function meleeKineticChain(
  t: number,
  style: "interstice" | "kindled",
): {
  pelvisDrive: number;
  chestDrive: number;
  headDrive: number;
  shoulderTwist: number;
  frontBrace: number;
} {
  const stage = meleeStage(t, style);
  const aEnd = style === "interstice" ? 0.15 : 0.38;
  const cutEnd = style === "interstice" ? 0.42 : 0.61;
  const followEnd = style === "interstice" ? 0.80 : 0.88;
  const heavy = style === "kindled";
  const loadPelvis = heavy ? -5.5 : -4.5;
  const loadChest = heavy ? -8 : -6.5;
  // Interstice carries farther forward than Kindled despite being the
  // lighter chassis: a fast cut that is nearly pure wrist/arm rotation around
  // a barely-translating pivot reads as a fan opening in place, not a step
  // into a cut. Real arc-length travel on the tip (not just angle) is what
  // separates a slash from a pinwheel.
  const pelvisThrough = heavy ? 9.5 : 15;
  const chestThrough = heavy ? 14 : 21;
  // Keep the eyes/head comparatively quiet over the braced front side while
  // the torso turns underneath. Driving the head farther than the chest made
  // the release read as a shoulder-first lunge, not a grounded kinetic chain.
  const headThrough = heavy ? 10 : 15;

  if (t < aEnd) {
    const e = smooth(stage.anticipation);
    return {
      pelvisDrive: lerp(0, loadPelvis, e),
      chestDrive: lerp(0, loadChest, e),
      headDrive: lerp(0, loadChest - 1, e),
      shoulderTwist: lerp(0, heavy ? -0.38 : -0.32, e),
      frontBrace: smooth(clamp01((stage.anticipation - 0.58) / 0.42)),
    };
  }
  if (t < cutEnd) {
    const c = stage.cut;
    // Pelvis is already opening while the shoulders are still closed. The
    // delayed links then catch up in order; this separation is the source of
    // the visible whip rather than a whole-body turn at one speed.
    const pelvis = easeOutCubic(clamp01(c / 0.5));
    const chest = smooth(clamp01((c - 0.08) / 0.7));
    const shoulders = smooth(clamp01((c - 0.16) / 0.72));
    return {
      pelvisDrive: lerp(loadPelvis, pelvisThrough, pelvis),
      chestDrive: lerp(loadChest, chestThrough, chest),
      headDrive: lerp(loadChest - 1, headThrough, chest),
      shoulderTwist: lerp(heavy ? -0.38 : -0.32, heavy ? 0.27 : 0.31, shoulders),
      frontBrace: 1,
    };
  }
  if (t < followEnd) {
    const f = easeOutCubic(stage.followThrough);
    return {
      pelvisDrive: lerp(pelvisThrough, pelvisThrough * 0.72, f),
      chestDrive: lerp(chestThrough, chestThrough * 1.08, f),
      headDrive: lerp(headThrough, headThrough * 1.04, f),
      shoulderTwist: lerp(heavy ? 0.27 : 0.31, heavy ? 0.46 : 0.52, f),
      frontBrace: 1,
    };
  }
  const r = smooth(stage.recovery);
  return {
    pelvisDrive: lerp(pelvisThrough * 0.72, 0, r),
    chestDrive: lerp(chestThrough * 1.08, 0, r),
    headDrive: lerp(headThrough * 1.04, 0, r),
    shoulderTwist: lerp(heavy ? 0.46 : 0.52, 0, r),
    frontBrace: 1 - r,
  };
}

/** Shoulder→hand motion is deliberately NOT the blade angle. A sword cut is
 * a linked chain: the shoulder/upper arm loads first, the elbow leads, the
 * hand extends through contact, and the blade/wrist continues after the arm
 * begins folding across the body. Making arm and blade collinear turns the
 * fighter into a clock hand rotating a spear from the shoulder. */
export function meleeHandPose(
  aimRad: number,
  dir: number,
  t: number,
  style: "interstice" | "kindled",
): { angle: number; reach: number } {
  const s = meleeStage(t, style);
  const d = dir >= 0 ? 1 : -1;
  const keys = style === "interstice"
    ? {
        // contactReach/followReach kept well under ProceduralPlayerRig's
        // ARM_REACH (40, see rollLockPose's "arms dont swing past the
        // elbows" note): the old 45/37 pinned or nearly-pinned the two-bone
        // solve straight (jointAngle -> 0), so both hands read as a pair of
        // rigid spears thrust at the target instead of arcing blades — a
        // stab, not a slash. Staying under ~33 keeps a real, visible elbow
        // bend through contact.
        readyAngle: -0.12, coilAngle: -0.58, contactAngle: 0.14, followAngle: 0.82, guardAngle: 0.34,
        readyReach: 29, coilReach: 20, contactReach: 33, followReach: 30, guardReach: 30,
      }
    : {
        readyAngle: -0.1, coilAngle: -0.5, contactAngle: 0.08, followAngle: 0.66, guardAngle: 0.26,
        readyReach: 30, coilReach: 22, contactReach: 41, followReach: 34, guardReach: 30,
      };
  if (t < (style === "interstice" ? 0.15 : 0.38)) {
    const e = smooth(s.anticipation);
    return {
      angle: aimRad + d * lerp(keys.readyAngle, keys.coilAngle, e),
      reach: lerp(keys.readyReach, keys.coilReach, e),
    };
  }
  if (t < (style === "interstice" ? 0.42 : 0.61)) {
    // The hands begin their trip with the torso, then yield some speed into
    // the blade at the intercept. The blade continues to use cutWhip(), so it
    // visibly lags early and becomes the fastest/distal link at contact.
    const e = handTransfer(s.cut);
    return {
      angle: aimRad + d * lerp(keys.coilAngle, keys.contactAngle, e),
      reach: lerp(keys.coilReach, keys.contactReach, e),
    };
  }
  if (t < (style === "interstice" ? 0.80 : 0.88)) {
    const e = easeOutCubic(s.followThrough);
    return {
      angle: aimRad + d * lerp(keys.contactAngle, keys.followAngle, e),
      reach: lerp(keys.contactReach, keys.followReach, e),
    };
  }
  const e = smooth(s.recovery);
  return {
    angle: aimRad + d * lerp(keys.followAngle, keys.guardAngle, e),
    reach: lerp(keys.followReach, keys.guardReach, e),
  };
}

/** Off-hand blade keeps a TIGHT guard/counterbalance path close to the body.
 * An earlier version swept nearly as wide as the dominant blade (0.3 to
 * -0.4 rad, almost 1.2 rad of independent travel) and read as two blades
 * scissoring open. Narrowing that arc without moving its CENTER just traded
 * one twin-blade illusion for another: sitting close to aimRad (0.08-0.4
 * rad off dead-ahead) made the off-hand point at the same target as the
 * main hand, so together they read as a pair of thrust spears, not a cut
 * with a counterbalance. The arc stays the same ~0.3 rad width but is now
 * centered high and back (~1.0-1.3 rad off aim — a chambered guard angle
 * above the dominant blade's own arc). The dominant hand itself sweeps
 * -0.58 to +0.82 rad off aim across the whole cycle (coil through follow);
 * an earlier ~0.65-0.95 rad off-hand band still overlapped its follow-
 * through end (+0.82 sits inside 0.65-0.95), so the two hands converged
 * again there even though contact itself looked fine. Sitting the off-hand
 * band entirely above +0.82 guarantees the two never numerically converge
 * at any point in the swing. */
export function meleeOffhandBladeAngle(
  aimRad: number,
  dir: number,
  t: number,
): number {
  const s = meleeStage(t, "interstice");
  const d = dir >= 0 ? 1 : -1;
  if (t < 0.15) return aimRad + d * lerp(1.05, 1.25, smooth(s.anticipation));
  if (t < 0.42) return aimRad + d * lerp(1.25, 1.1, cutWhip(s.cut));
  if (t < 0.80) return aimRad + d * lerp(1.1, 1.0, easeOutCubic(s.followThrough));
  return aimRad + d * lerp(1.0, 1.05, smooth(s.recovery));
}

/** Same tight-guard choreography for the full rig's off-hand IK target —
 * reach stays close to the body throughout instead of extending out to
 * nearly the dominant blade's own reach. */
export function meleeOffhandPose(
  aimRad: number,
  dir: number,
  t: number,
): { angle: number; reach: number } {
  const s = meleeStage(t, "interstice");
  const d = dir >= 0 ? 1 : -1;
  if (t < 0.15) {
    const e = smooth(s.anticipation);
    return { angle: aimRad + d * lerp(1.05, 1.28, e), reach: lerp(22, 19, e) };
  }
  if (t < 0.42) {
    const e = cutWhip(s.cut);
    return { angle: aimRad + d * lerp(1.28, 1.12, e), reach: lerp(19, 22, e) };
  }
  if (t < 0.80) {
    const e = easeOutCubic(s.followThrough);
    return { angle: aimRad + d * lerp(1.12, 1.02, e), reach: lerp(22, 20, e) };
  }
  const e = smooth(s.recovery);
  return { angle: aimRad + d * lerp(1.02, 1.05, e), reach: lerp(20, 22, e) };
}

type Vec2Like = { x: number; y: number };

/** Which hand is actually swinging the blade this frame. Mirrors the
 * anatomy decision ProceduralPlayerRig's own arm IK already makes (Kindled
 * always cuts with the sword/lead hand; Interstice alternates by combo
 * `dir`) — kept here as one pure, testable rule so the render-time blade
 * pivot can never drift from the arm pose it's drawn on top of. */
export function meleeActiveHand(
  style: "interstice" | "kindled",
  dir: number,
): "lead" | "back" {
  const activeLead = style === "kindled" || dir > 0;
  return activeLead ? "lead" : "back";
}

/** Pure "what should this frame's blade construct look like" computation —
 * factored out of ProceduralPlayerRig.draw() so it's testable without a
 * live Phaser Graphics context (this codebase's established pattern, see
 * chassisSilhouette.ts + its test header comment: `import Phaser from
 * "phaser"` throws under `bun test`, so anything that decides WHAT to draw
 * belongs in a Phaser-free module; only the actual `g.lineStyle()`/
 * `g.strokePath()` calls need the real engine). Returns null when there is
 * no active swing (meleePoseMs <= 0) — the caller should draw nothing. */
export function meleeBladeDrawParams(
  style: "interstice" | "kindled",
  meleePoseMs: number,
  meleePoseDurationMs: number,
  dir: number,
  aimRad: number,
  leadHand: Vec2Like,
  backHand: Vec2Like,
): {
  style: "interstice" | "kindled";
  leadPivot: Vec2Like;
  backPivot: Vec2Like;
  activePivot: Vec2Like;
  aimRad: number;
  reach: number;
  sweepRad: number;
  dir: number;
  t: number;
} | null {
  if (meleePoseMs <= 0 || meleePoseDurationMs <= 0) return null;
  const t = clamp01(1 - meleePoseMs / meleePoseDurationMs);
  const active = meleeActiveHand(style, dir);
  return {
    style,
    leadPivot: leadHand,
    backPivot: backHand,
    activePivot: active === "lead" ? leadHand : backHand,
    aimRad,
    reach: style === "kindled" ? KINDLED_BLADE_REACH_PX : INTERSTICE_BLADE_REACH_PX,
    sweepRad: style === "kindled" ? KINDLED_BLADE_SWEEP_RAD : INTERSTICE_BLADE_SWEEP_RAD,
    dir,
    t,
  };
}

/** World-space position of the blade's tip this frame — the same formula
 * the construct-harness review samples (constructHarness.ts's
 * harnessRigFrame), reused so a LIVE per-frame accumulator and the
 * harness's analytic precompute agree on what a "tip" even is. */
export function meleeBladeTip(
  pivot: Vec2Like,
  aimRad: number,
  sweepRad: number,
  dir: number,
  t: number,
  style: "interstice" | "kindled",
  reach: number,
): Vec2Like {
  const a = meleeBladeAngle(aimRad, sweepRad, dir, t, style);
  return { x: pivot.x + Math.cos(a) * reach, y: pivot.y + Math.sin(a) * reach };
}

/** Append one live-sampled tip position to the trail, capped to `maxLen` —
 * the LIVE per-frame shape (append + cap), deliberately NOT the harness's
 * offline-review shape (precompute the whole timeline analytically from a
 * scrubbed `t`, which only works because that path is scrubbing a fixed
 * duration up front, not accumulating real per-frame state). Pure/immutable
 * so it's trivially testable; the caller owns clearing it on swing start. */
export function appendBladeTip(
  history: readonly Vec2Like[],
  tip: Vec2Like,
  maxLen: number,
): Vec2Like[] {
  const next = history.length >= maxLen ? history.slice(history.length - maxLen + 1) : history.slice();
  next.push(tip);
  return next;
}

function cutWhip(v: number): number {
  const x = Math.max(0, Math.min(1, v));
  const contact = MELEE_CONTACT_CUT_FRACTION;
  if (x < contact) {
    const q = x / contact;
    return contact * q * q;
  }
  const q = (x - contact) / (1 - contact);
  return contact + (1 - contact) * (1 - (1 - q) * (1 - q));
}

function handTransfer(v: number): number {
  const x = clamp01(v);
  return x * 0.55 + cutWhip(x) * 0.45;
}

function easeOutCubic(v: number): number {
  const x = Math.max(0, Math.min(1, v));
  return 1 - (1 - x) ** 3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function smooth(v: number): number {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
