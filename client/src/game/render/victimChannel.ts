// Victim-channel planner — slash-feel-ledger R1 rows 3-8 (2026-07-24,
// Kindled wave 1; SHARED with the Interstice wave: class-parameterized,
// never class-forked). Pure and Phaser-free on purpose: this module is
// the testable surface (the rig only *applies* what these evaluators
// return), and it must never be imported into a bun test through Phaser.
//
// The contact chord it encodes, per chassis:
//   row 3  pair-scoped hit-stop on hit    — 50ms (I) / 100ms (K), rigs only
//   row 4  hit-stop on kill               — 117ms (I) / 150ms (K); the
//          VICTIM rig holds 1.5x; global cap 250ms
//   row 5  behavior during the hold       — victim vibrates (±1.5px I /
//          ±2.5px K), decaying; attacker keeps ~10% drift
//   row 6  victim white-flash             — 33+33ms (I) / 50+50ms (K);
//          kill flash 67ms then dissolve
//   row 7  victim reaction pose           — same-frame directional flinch,
//          4px/125ms (I) / 7px/175ms (K), ease-out
//   row 8  victim squash                  — (1.25,0.8) 50ms+100ms (I) /
//          (1.35,0.7) 67ms+133ms (K), spring back
//
// HARD RULES honored here: the hold is PAIR-scoped (attacker+victim rigs;
// the world tween clock is never touched for melee), and re-triggers
// NEVER stack — apply() semantics are "restart at max(remaining, fresh)",
// encoded in the rig, with the numbers here staying per-hit constants.

export type MeleeChassis = "interstice" | "kindled";

export type ImpactChannelParams = {
  chassis: MeleeChassis;
  /** Pair-scoped freeze on an ordinary hit (ms). */
  pairStopHitMs: number;
  /** Pair-scoped freeze on a kill (ms) — attacker's hold. */
  pairStopKillMs: number;
  /** Victim's kill hold = pairStopKillMs * this (Melee's electric 1.5x). */
  victimKillHoldMul: number;
  /** Absolute ceiling on any single hold (Sakurai cap doctrine). */
  holdCapMs: number;
  /** Vibration amplitude during the hold (px, decaying). */
  vibrationPx: number;
  /** White-flash: full-white ramp-in, then decay (ms each). */
  flashInMs: number;
  flashOutMs: number;
  /** Kill flash holds full white this long before the decay. */
  killFlashInMs: number;
  /** Directional flinch along the hit vector (px), ease-out over (ms). */
  flinchPx: number;
  flinchMs: number;
  /** Squash scale at impact (x wide, y low) and its clocks (ms). */
  squashX: number;
  squashY: number;
  squashHoldMs: number;
  squashSpringMs: number;
};

export function impactChannelParams(chassis: MeleeChassis): ImpactChannelParams {
  if (chassis === "kindled") {
    return {
      chassis,
      pairStopHitMs: 100,
      pairStopKillMs: 150,
      victimKillHoldMul: 1.5,
      holdCapMs: 250,
      // 2.5 → 3.5 (K5 live-tape retune, 2026-07-24): at real game scale
      // (~0.9 world→screen at arena zoom, 25fps tape) the pair hold read
      // as a STATIC freeze — the ±2.5px buzz was sub-legible while flash/
      // squash/flinch all read at spec. One more pixel puts the shiver
      // above the perception floor without breaking the hold's stillness.
      // Kindled-only: Interstice keeps the research number until its own
      // wave live-tapes it (channel stays parameterized, never forked).
      vibrationPx: 3.5,
      flashInMs: 50,
      flashOutMs: 50,
      killFlashInMs: 67,
      // 7 → 12 (K6 live-tape retune, 2026-07-24): during the pair hold the
      // flinch is the ONLY body translation (knockback is frozen out), and
      // at gameplay zoom (~45px fighter, ~0.9 world→screen) a 7px offset
      // was under the motion-perception floor — the victim read as a
      // statue. 12px puts the first flinch frame at ~11 screen px (~25% of
      // body height), matching the research row's INTENT (a visible
      // same-frame directional jolt) over its literal number.
      flinchPx: 12,
      flinchMs: 175,
      squashX: 1.35,
      squashY: 0.7,
      squashHoldMs: 67,
      squashSpringMs: 133,
    };
  }
  return {
    chassis,
    pairStopHitMs: 50,
    pairStopKillMs: 117,
    victimKillHoldMul: 1.5,
    holdCapMs: 250,
    vibrationPx: 1.5,
    flashInMs: 33,
    flashOutMs: 33,
    killFlashInMs: 67,
    flinchPx: 4,
    flinchMs: 125,
    squashX: 1.25,
    squashY: 0.8,
    squashHoldMs: 50,
    squashSpringMs: 100,
  };
}

/** White-flash intensity 0..1 at `elapsedMs` since impact. Full white for
 *  the in-window (instant on — SNK/SFA3 flash frames are FIRST frames,
 *  not ramps), then a decay. */
export function flashMix(
  elapsedMs: number,
  p: ImpactChannelParams,
  kill = false,
): number {
  const inMs = kill ? p.killFlashInMs : p.flashInMs;
  if (elapsedMs < 0) return 0;
  if (elapsedMs <= inMs) return 1;
  const out = (elapsedMs - inMs) / p.flashOutMs;
  return Math.max(0, 1 - out);
}

/** Squash scale at `elapsedMs` since impact: held at full squash, then a
 *  slightly under-damped spring back toward 1 (volume-preserving pair —
 *  x widens exactly while y flattens). */
export function squashScale(
  elapsedMs: number,
  p: ImpactChannelParams,
): { x: number; y: number } {
  if (elapsedMs < 0 || elapsedMs >= p.squashHoldMs + p.squashSpringMs) {
    return { x: 1, y: 1 };
  }
  if (elapsedMs <= p.squashHoldMs) {
    return { x: p.squashX, y: p.squashY };
  }
  const q = (elapsedMs - p.squashHoldMs) / p.squashSpringMs;
  // Damped single-overshoot spring: passes 1, overshoots a touch (the
  // rebound), settles. cos envelope keeps it cheap and deterministic.
  const k = (1 - q) * Math.cos(q * Math.PI * 1.5) * 0.9;
  return { x: 1 + (p.squashX - 1) * k, y: 1 + (p.squashY - 1) * k };
}

/** Directional flinch offset (px) along the hit vector at `elapsedMs` —
 *  INSTANT full offset on frame 0 (zero cross-fade), easing out. */
export function flinchOffset(
  elapsedMs: number,
  p: ImpactChannelParams,
  dirX: number,
  dirY: number,
): { x: number; y: number } {
  if (elapsedMs < 0 || elapsedMs >= p.flinchMs) return { x: 0, y: 0 };
  const len = Math.hypot(dirX, dirY) || 1;
  const e = 1 - elapsedMs / p.flinchMs;
  const mag = p.flinchPx * e * e; // ease-out from full
  return { x: (dirX / len) * mag, y: (dirY / len) * mag };
}

/** Victim vibration during the hold: a decaying oscillation, ±amplitude,
 *  ~90Hz-ish read at 60fps (alternates sign fast enough to buzz). The
 *  AXIS is the caller's business (horizontal grounded / vertical air). */
export function vibrationOffset(
  elapsedMs: number,
  totalMs: number,
  amplitudePx: number,
): number {
  if (totalMs <= 0 || elapsedMs < 0 || elapsedMs >= totalMs) return 0;
  const decay = 1 - elapsedMs / totalMs;
  return Math.sin(elapsedMs * 0.55) * amplitudePx * decay;
}

/** The pair-hold durations for one impact. Never stacks: callers must
 *  apply with max(remaining, fresh), and every value is capped. */
export function pairHoldMs(
  p: ImpactChannelParams,
  role: "attacker" | "victim",
  kill: boolean,
): number {
  const base = kill ? p.pairStopKillMs : p.pairStopHitMs;
  const held = role === "victim" && kill ? base * p.victimKillHoldMul : base;
  return Math.min(p.holdCapMs, held);
}

/** Directional camera kick (R1 row 9 — directional-FIRST shake): the
 *  first camera displacement on a melee hit must be ALONG the hit vector;
 *  the random layer is only noise on top. Roll is deliberately omitted —
 *  Jake's standing camera direction is "don't roll the camera" (the peak
 *  camera replaced roll with the AI lock for the same reason). */
export function cameraKickParams(
  chassis: MeleeChassis,
  kill: boolean,
): { kickPx: number; noisePx: number; durMs: number } {
  if (kill) return { kickPx: 12, noisePx: 6, durMs: 180 };
  return chassis === "kindled"
    ? { kickPx: 8, noisePx: 4, durMs: 120 }
    : { kickPx: 4, noisePx: 2, durMs: 80 };
}
