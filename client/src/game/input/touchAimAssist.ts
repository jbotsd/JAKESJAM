// Touch aim assist — a soft magnetic input transform for thumb aiming.
//
// Thumbs are ~an order of magnitude less precise than a mouse (occlusion,
// no wrist micro-adjust), and every serious mobile shooter compensates with
// cone-based assist as the NORM, not a cheat (see the scaling research:
// MY.GAMES fair-auto-aim writeup). Design rules here:
//
//   - INPUT TRANSFORM ONLY: the assisted direction is submitted as the
//     player's ordinary aim input and validated server-side like any aim.
//     No hit-box inflation, no server special-casing, nothing hidden from
//     the sim. Touch-only — mouse aim is never transformed.
//   - SOFT + BOUNDED: the stick direction is blended toward the nearest
//     living enemy within a ±20° cone and 900px range. Blend strength
//     peaks at 0.6 for near-perfect aim and fades to 0 at the cone edge —
//     the player always steers; the assist never locks on or tracks
//     through walls it wasn't pointed at.
//
// Engine-free and pure: (state, origin, stick dir) → dir. Unit-tested.

import type { PlayerId, WorldState } from "../../sim/types";

const ASSIST_RANGE_PX = 900;
/** cos(20°) — outside this cone the assist contributes nothing. */
const CONE_COS = Math.cos((20 * Math.PI) / 180);
const MAX_BLEND = 0.6;

export type Vec2 = { x: number; y: number };

/**
 * Blend `stickDir` (unit-ish) toward the nearest living enemy inside the
 * assist cone. Returns a NEW normalized direction; returns `stickDir`
 * unchanged when no eligible target exists.
 */
export function assistTouchAim(
  state: WorldState,
  localId: PlayerId | string,
  origin: Vec2,
  stickDir: Vec2,
): Vec2 {
  const len = Math.hypot(stickDir.x, stickDir.y);
  if (len < 1e-6) return stickDir;
  const dx = stickDir.x / len;
  const dy = stickDir.y / len;

  let bestCos = CONE_COS;
  let bestTx = 0;
  let bestTy = 0;
  let found = false;
  for (const pid in state.players) {
    if (pid === localId) continue;
    const p = state.players[pid as PlayerId];
    if (!p || !p.alive || p.health <= 0) continue;
    const ox = p.x - origin.x;
    const oy = p.y - origin.y;
    const dist = Math.hypot(ox, oy);
    if (dist < 1 || dist > ASSIST_RANGE_PX) continue;
    const cos = (ox * dx + oy * dy) / dist;
    // Nearest-to-crosshair wins (largest cosine), not nearest-by-distance —
    // the player's stick intent is the tiebreaker.
    if (cos > bestCos) {
      bestCos = cos;
      bestTx = ox / dist;
      bestTy = oy / dist;
      found = true;
    }
  }
  if (!found) return stickDir;

  // Blend strength ramps from 0 at the cone edge to MAX_BLEND at 0° error.
  const t = ((bestCos - CONE_COS) / (1 - CONE_COS)) * MAX_BLEND;
  const bx = dx + (bestTx - dx) * t;
  const by = dy + (bestTy - dy) * t;
  const blen = Math.hypot(bx, by);
  if (blen < 1e-6) return stickDir;
  return { x: bx / blen, y: by / blen };
}
