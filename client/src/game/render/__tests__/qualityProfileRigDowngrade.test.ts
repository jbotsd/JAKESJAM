// Runtime rig downgrade — see qualityProfile.ts's own docblock on
// forceRigDowngrade(). Module-level mutable state, so tests share it
// across the file (matches the module's own single-flag design: this is
// a one-way, session-scoped switch, not something meant to be reset and
// retested many times over — the ordering below is deliberate, not
// incidental).
import { describe, expect, test } from "bun:test";
import { forceRigDowngrade, isRigDowngraded, getEffectiveRigStyle } from "../qualityProfile.ts";
import { getQualityProfile } from "../qualityProfile.ts";

describe("runtime rig downgrade", () => {
  test("starts un-downgraded — effective style matches the frozen tier profile", () => {
    expect(isRigDowngraded()).toBe(false);
    expect(getEffectiveRigStyle()).toBe(getQualityProfile().rigStyle);
  });

  test("forceRigDowngrade() flips the flag and overrides the effective style to baked", () => {
    forceRigDowngrade();
    expect(isRigDowngraded()).toBe(true);
    expect(getEffectiveRigStyle()).toBe("baked");
  });

  test("the downgrade is sticky — calling it again is a harmless no-op, not a toggle", () => {
    forceRigDowngrade();
    forceRigDowngrade();
    expect(isRigDowngraded()).toBe(true);
    expect(getEffectiveRigStyle()).toBe("baked");
  });
});
