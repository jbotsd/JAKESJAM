// Auto wall-hop — mobile-only movement assist (playtest feedback: walls
// are a dead end on touch; jump gymnastics mid-run are thumb-hostile).
//
// Rule: while the MOVE input pushes INTO a wall the character is touching,
// pulse the Jump bit — a short press every cycle, so the sim sees clean
// rising edges and the character hops, regrips, hops: an automatic wall
// climb that reads as intent, not scripting. Release the stick (or leave
// the wall) and it stops instantly. Desktop input is never transformed.

import { InputBit } from "../../net/protocol";

/** Press length per cycle — a few sim ticks, enough for a full jump edge. */
const PULSE_MS = 70;
/** Cycle length — hop cadence while held into the wall. */
const CYCLE_MS = 260;

export type AutoHopState = {
  /** When the push-into-wall condition became true; null = not active. */
  epochMs: number | null;
};

export function makeAutoHopState(): AutoHopState {
  return { epochMs: null };
}

/**
 * Returns `keys` with Jump pulsed in while the movement keys push into
 * `touchingWallDir` (-1 wall on left, 1 wall on right, 0 none).
 */
export function autoWallHopKeys(
  keys: number,
  touchingWallDir: number,
  nowMs: number,
  st: AutoHopState,
): number {
  const movingDir = keys & InputBit.Left ? -1 : keys & InputBit.Right ? 1 : 0;
  if (movingDir === 0 || touchingWallDir !== movingDir) {
    st.epochMs = null;
    return keys;
  }
  if (st.epochMs === null) st.epochMs = nowMs;
  const phase = (nowMs - st.epochMs) % CYCLE_MS;
  return phase < PULSE_MS ? keys | InputBit.Jump : keys;
}
