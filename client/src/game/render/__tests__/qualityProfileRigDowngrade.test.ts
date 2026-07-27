// Runtime rig downgrade — see qualityProfile.ts's own docblock on
// forceRigDowngrade(). Module-level mutable state, so tests share it
// across the file (matches the module's own single-flag design: this is
// a one-way, session-scoped switch, not something meant to be reset and
// retested many times over — the ordering below is deliberate, not
// incidental).
//
// (2026-07-27) The flag is ALSO process-wide across FILES, not just within
// this one — renderGovernorTiming.test.ts legitimately drives the real
// RenderGovernor into its real futility-restore branch, which calls the
// real `forceRigDowngrade()`. Whether that runs before or after this file,
// in the same `bun test` process, is scheduling-dependent and not this
// file's to assume away. The first test below used to hard-assert "starts
// false" — only ever true by accident (this was the sole consumer). It
// now asserts the INVARIANT that actually matters regardless of which flag
// value the process arrived with: `getEffectiveRigStyle()` correctly
// reflects whatever `isRigDowngraded()` currently reports.
import { describe, expect, test } from "bun:test";
import { forceRigDowngrade, isRigDowngraded, getEffectiveRigStyle } from "../qualityProfile.ts";
import { getQualityProfile } from "../qualityProfile.ts";

describe("runtime rig downgrade", () => {
  test("effective style always reflects the current downgrade flag (order-independent invariant)", () => {
    const expected = isRigDowngraded() ? "baked" : getQualityProfile().rigStyle;
    expect(getEffectiveRigStyle()).toBe(expected);
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
