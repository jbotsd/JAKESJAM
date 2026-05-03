// Parity guard: the canonical CHAOS_MODIFIER_IDS list lives in two places
// because Convex's V8 sandbox can't import from outside `convex/`. This
// test ensures the two arrays stay byte-identical so adding/removing a
// modifier in one place fails CI loudly until both copies match.

import { describe, expect, test } from "bun:test";
import { CHAOS_MODIFIER_IDS as SIM_IDS } from "../data/chaosModifiers.js";
import { CHAOS_MODIFIER_IDS as CONVEX_IDS } from "../../../../convex/chaosIds.js";

describe("chaos modifier ids parity", () => {
  test("convex/chaosIds.ts matches client/src/sim/data/chaosModifiers.ts", () => {
    expect(CONVEX_IDS).toEqual(SIM_IDS);
  });
});
