/**
 * Stable semi-implicit spring-damper for procedural secondary motion (rig
 * limb wobble, overshoot, etc.). Render-layer only — never touches sim state.
 *
 * Formula: implicit-Euler critically-tunable spring (frequency + damping
 * ratio), stable for any deltaMs (no substepping needed, unlike a naive
 * explicit-Euler spring which explodes at low frame rates).
 */

export type SpringState = { value: number; vel: number };

export function springState(value: number): SpringState {
  return { value, vel: 0 };
}

/** Advance a spring toward `target`. `frequencyHz` sets oscillation speed,
 *  `dampingRatio` < 1 underdamps (visible overshoot/wobble), 1 critically
 *  damps (no overshoot), > 1 overdamps (sluggish). */
export function springTo(
  state: SpringState,
  target: number,
  deltaMs: number,
  frequencyHz: number,
  dampingRatio: number,
): SpringState {
  const dt = deltaMs / 1000;
  if (dt <= 0) return state;
  const angularFreq = 2 * Math.PI * frequencyHz;
  const f = 1 + 2 * dt * dampingRatio * angularFreq;
  const oo = angularFreq * angularFreq;
  const hoo = dt * oo;
  const detInv = 1 / (f + dt * hoo);
  const value = (f * state.value + dt * state.vel + dt * hoo * target) * detInv;
  const vel = (state.vel + hoo * (target - state.value)) * detInv;
  return { value, vel };
}

/** Instantly kick a spring's velocity (e.g. landing impact), leaving its
 *  value where it is so the spring visibly recoils from the new target. */
export function springKick(state: SpringState, velDelta: number): SpringState {
  return { value: state.value, vel: state.vel + velDelta };
}
