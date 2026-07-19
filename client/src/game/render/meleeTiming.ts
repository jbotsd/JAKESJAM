// The cut itself stays fast; these wider sentences buy a ground-loaded read
// before it and a cinematic finishing silhouette after it.
export const BLADE_SWING_MS = 360;
export const EDGE_SWING_MS = 560;
/** Point inside the authored cut where the blade crosses the captured aim
 * radius at peak tip speed. This is deliberately not the end of the move:
 * contact needs visible follow-through on the far side of the target. */
export const MELEE_CONTACT_CUT_FRACTION = 0.68;

export function meleeContactT(style: "interstice" | "kindred"): number {
  const cutStart = style === "interstice" ? 0.32 : 0.38;
  const cutEnd = style === "interstice" ? 0.52 : 0.61;
  return cutStart + (cutEnd - cutStart) * MELEE_CONTACT_CUT_FRACTION;
}

export function meleeStage(t: number, style: "interstice" | "kindred"): {
  anticipation: number;
  cut: number;
  followThrough: number;
  recovery: number;
} {
  const aEnd = style === "interstice" ? 0.32 : 0.38;
  const cutEnd = style === "interstice" ? 0.52 : 0.61;
  const followEnd = style === "interstice" ? 0.84 : 0.88;
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
export function meleeSweepFraction(t: number, style: "interstice" | "kindred"): number {
  const s = meleeStage(t, style);
  if (style === "interstice") {
    // Five silhouette keys, expressed against the nominal start/end sweep:
    // ready → deep coil → contact extension → blade-led overshoot → guard.
    // The cut uses an acceleration-to-contact curve rather than generic
    // smoothstep: sparse frames before contact, then visible braking after.
    if (t < 0.32) return lerp(0.24, -0.22, smooth(s.anticipation));
    if (t < 0.52) return lerp(-0.22, 0.88, cutWhip(s.cut));
    if (t < 0.84) return lerp(0.88, 1.22, easeOutCubic(s.followThrough));
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
  style: "interstice" | "kindred",
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
  style: "interstice" | "kindred",
): {
  pelvisDrive: number;
  chestDrive: number;
  headDrive: number;
  shoulderTwist: number;
  frontBrace: number;
} {
  const stage = meleeStage(t, style);
  const aEnd = style === "interstice" ? 0.32 : 0.38;
  const cutEnd = style === "interstice" ? 0.52 : 0.61;
  const followEnd = style === "interstice" ? 0.84 : 0.88;
  const heavy = style === "kindred";
  const loadPelvis = heavy ? -5.5 : -4.5;
  const loadChest = heavy ? -8 : -6.5;
  const pelvisThrough = heavy ? 9.5 : 8;
  const chestThrough = heavy ? 14 : 12;
  // Keep the eyes/head comparatively quiet over the braced front side while
  // the torso turns underneath. Driving the head farther than the chest made
  // the release read as a shoulder-first lunge, not a grounded kinetic chain.
  const headThrough = heavy ? 10 : 9;

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
  style: "interstice" | "kindred",
): { angle: number; reach: number } {
  const s = meleeStage(t, style);
  const d = dir >= 0 ? 1 : -1;
  const keys = style === "interstice"
    ? {
        readyAngle: -0.12, coilAngle: -0.58, contactAngle: 0.14, followAngle: 0.82, guardAngle: 0.34,
        readyReach: 29, coilReach: 20, contactReach: 45, followReach: 37, guardReach: 30,
      }
    : {
        readyAngle: -0.1, coilAngle: -0.5, contactAngle: 0.08, followAngle: 0.66, guardAngle: 0.26,
        readyReach: 30, coilReach: 22, contactReach: 41, followReach: 34, guardReach: 30,
      };
  if (t < (style === "interstice" ? 0.32 : 0.38)) {
    const e = smooth(s.anticipation);
    return {
      angle: aimRad + d * lerp(keys.readyAngle, keys.coilAngle, e),
      reach: lerp(keys.readyReach, keys.coilReach, e),
    };
  }
  if (t < (style === "interstice" ? 0.52 : 0.61)) {
    // The hands begin their trip with the torso, then yield some speed into
    // the blade at the intercept. The blade continues to use cutWhip(), so it
    // visibly lags early and becomes the fastest/distal link at contact.
    const e = handTransfer(s.cut);
    return {
      angle: aimRad + d * lerp(keys.coilAngle, keys.contactAngle, e),
      reach: lerp(keys.coilReach, keys.contactReach, e),
    };
  }
  if (t < (style === "interstice" ? 0.84 : 0.88)) {
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

/** Off-hand blade keeps a compact guard/counterbalance path. It is late by
 * design: the dominant cut owns the silhouette, while the second dagger
 * closes the exposed line instead of drawing a duplicate windmill. */
export function meleeOffhandBladeAngle(
  aimRad: number,
  dir: number,
  t: number,
): number {
  const s = meleeStage(t, "interstice");
  const d = dir >= 0 ? 1 : -1;
  if (t < 0.32) return aimRad + d * lerp(0.3, 0.78, smooth(s.anticipation));
  if (t < 0.52) return aimRad + d * lerp(0.78, -0.4, cutWhip(Math.max(0, s.cut - 0.18) / 0.82));
  if (t < 0.84) return aimRad + d * lerp(-0.4, -0.22, easeOutCubic(s.followThrough));
  return aimRad + d * lerp(-0.22, 0.18, smooth(s.recovery));
}

export function meleeOffhandPose(
  aimRad: number,
  dir: number,
  t: number,
): { angle: number; reach: number } {
  const s = meleeStage(t, "interstice");
  const d = dir >= 0 ? 1 : -1;
  if (t < 0.32) {
    const e = smooth(s.anticipation);
    return { angle: aimRad + d * lerp(0.18, 0.48, e), reach: lerp(25, 21, e) };
  }
  if (t < 0.52) {
    const e = cutWhip(Math.max(0, s.cut - 0.18) / 0.82);
    return { angle: aimRad + d * lerp(0.48, -0.5, e), reach: lerp(21, 29, e) };
  }
  if (t < 0.84) {
    const e = easeOutCubic(s.followThrough);
    return { angle: aimRad + d * lerp(-0.5, -0.72, e), reach: lerp(29, 23, e) };
  }
  const e = smooth(s.recovery);
  return { angle: aimRad + d * lerp(-0.72, 0.2, e), reach: lerp(23, 25, e) };
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
