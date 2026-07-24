import { describe, expect, test } from "bun:test";
import { describeBuild } from "../buildDescription.js";

describe("describeBuild", () => {
  test("turns a card stack into plain-language attack causality", () => {
    const result = describeBuild(["seeker-facets", "molten-core", "explosive-facet"]);
    expect(result.title).toContain("Seeker Facets");
    expect(result.summary).toContain("homes toward targets");
    expect(result.summary).toContain("burns targets");
    expect(result.summary).toContain("explodes on impact");
  });

  test("describes an undrafted starter honestly", () => {
    const result = describeBuild([]);
    expect(result.title).toBe("Starter build");
    expect(result.cardCount).toBe(0);
    // describeBuild defaults to "balanced" (wizard), and Wizard's basic
    // shot is true hitscan again (THE GEOMETRICIAN RULING, 2026-07-24,
    // weapons.ts — the 2026-07-22 "single projectile" era was a misread of
    // Jake's intent), so `describeShot` takes the "raycast" instant-beam
    // branch.
    expect(result.summary).toContain("single instant beam");
  });
});
