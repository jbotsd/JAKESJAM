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
    // Wizard's basic shot is a real projectile again (2026-07-22:
    // Geometrician's hitscan reverted back to a projectile — weapons.ts's
    // `wizardStarterWeapon`), so `describeShot` falls through to its
    // ordinary projectile phrasing rather than the "raycast" instant-beam
    // branch (still reachable via delivery-changing cards like Raycast Prism).
    expect(result.summary).toContain("single projectile");
  });
});
