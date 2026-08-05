// Doors 1.5a regression guard — the venue lobby's touch input contract.
//
// The exact bug this locks against: HangoutScene's touch branch used to
// mask the TouchControls bitfield to walk-only UNCONDITIONALLY, so a phone
// could never set Fire/Shield/Dash/Emission/slot bits in the venue — the
// practice dummies were unhittable on the platform with the shortest
// attention span, for the entire (up to ~100 s) bell wait. Venue mode is
// now a full passthrough (same verbs the touch MATCH sends, all
// server-validated); private hangouts keep the original walk-only mask
// (no combat exists there — and the aim stick auto-fires Fire regardless
// of the combatButtons option, so the mask is still load-bearing).

import { describe, expect, test } from "bun:test";
import { InputBit } from "../../../net/protocol";
import { hangoutTouchKeys, WALK_ONLY_TOUCH_MASK } from "../hangoutTouchKeys";

const SLOT_BITS = (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13);
const COMBAT_BITS =
  InputBit.Fire | InputBit.Shield | InputBit.Dash | InputBit.Ability | SLOT_BITS;
const MOVEMENT_BITS =
  InputBit.Left | InputBit.Right | InputBit.Jump | InputBit.Down | InputBit.Crouch;

describe("hangoutTouchKeys (Doors 1.5a)", () => {
  test("venue mode passes EVERY combat verb through untouched — the full match bitfield", () => {
    const everything = MOVEMENT_BITS | COMBAT_BITS;
    expect(hangoutTouchKeys(everything, "venue")).toBe(everything);
  });

  test("venue mode: each combat bit survives individually (no partial re-masking)", () => {
    for (const bit of [
      InputBit.Fire,
      InputBit.Shield,
      InputBit.Dash,
      InputBit.Ability,
      1 << 10,
      1 << 11,
      1 << 12,
      1 << 13,
    ]) {
      expect(hangoutTouchKeys(bit, "venue")).toBe(bit);
    }
  });

  test("private mode strips every combat bit — including the aim stick's auto-Fire", () => {
    const everything = MOVEMENT_BITS | COMBAT_BITS;
    expect(hangoutTouchKeys(everything, "private")).toBe(MOVEMENT_BITS);
    // The auto-fire case specifically: aiming sets Fire even with
    // combatButtons hidden, so the mask must catch it.
    expect(hangoutTouchKeys(InputBit.Fire | InputBit.Right, "private")).toBe(InputBit.Right);
  });

  test("private mode preserves the full movement vocabulary", () => {
    expect(hangoutTouchKeys(MOVEMENT_BITS, "private")).toBe(MOVEMENT_BITS);
    expect(WALK_ONLY_TOUCH_MASK).toBe(MOVEMENT_BITS);
  });
});
