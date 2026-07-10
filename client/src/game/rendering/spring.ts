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
 *  damps (no overshoot), > 1 overdamps (sluggish).
 *
 *  MUTATES `state` and returns it — the rig advances ~14 springs per player
 *  per frame, and the previous fresh-object return was a top per-frame
 *  allocation source (game-loop-perf). Every call site is
 *  `x = springTo(x, ...)`, so in-place is behavior-identical. */
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
  state.value = value;
  state.vel = vel;
  return state;
}

/** Instantly kick a spring's velocity (e.g. landing impact), leaving its
 *  value where it is so the spring visibly recoils from the new target.
 *  MUTATES `state` and returns it (see springTo). */
export function springKick(state: SpringState, velDelta: number): SpringState {
  state.vel += velDelta;
  return state;
}
