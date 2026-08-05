// Touch input contract for HangoutScene (Doors 1.5a — "make the bell wait
// survivable", docs/open-doors-goal.md Phase 1).
//
// The venue lobby is a live-fire room (S2.C practice dummies, the loadout
// station's "try it on the dummies" promise) and the bell wait can reach
// ~100 s — but until this fix, touch input was masked to walk-only in the
// lobby, so the platform with the shortest attention span could not even
// hit a dummy. Venue mode now passes the FULL TouchControls bitfield
// through (Fire / Shield / Dash / Emission / drafted-active slots — the
// same verbs the touch MATCH sends); the sim validates everything
// server-side exactly as it does for keyboard venue visitors.
//
// Private hangouts keep the original walk-only contract: there is no
// combat there for the bits to react to (the private MatchHost no-ops
// stepWeapon — MatchScene's combatButtons:false precedent). The mask still
// matters even with combat buttons hidden, because the aim stick auto-fire
// sets InputBit.Fire regardless of the combatButtons option.
//
// Pure and engine-free so the mask semantics are testable under bun:test
// (HangoutScene itself can't be constructed there — Phaser import throws;
// hangoutRigRebuild.test.ts precedent).

import { InputBit } from "../../net/protocol";

/** Movement-only verbs — the private hangout's touch contract. */
export const WALK_ONLY_TOUCH_MASK =
  InputBit.Left | InputBit.Right | InputBit.Jump | InputBit.Down | InputBit.Crouch;

/** Venue mode: full combat passthrough. Private mode: walk-only. */
export function hangoutTouchKeys(touchKeys: number, mode: "private" | "venue"): number {
  return mode === "venue" ? touchKeys : touchKeys & WALK_ONLY_TOUCH_MASK;
}
