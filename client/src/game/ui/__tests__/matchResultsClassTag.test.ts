// matchResultsClassTag tests — pure lookup composition, no Phaser import,
// no DOM. Verifies the match-results scoreboard tag matches the in-match
// nameplate's GEO/INT/KIN/SYZ convention exactly, including the shared
// combat-cyan register between Geometrician/Interstice, and the
// undefined-characterId omit-don't-guess behavior.

import { describe, expect, test } from "bun:test";
import { matchResultsClassTag } from "../matchResultsClassTag";

describe("matchResultsClassTag", () => {
  test("maps each archetype to its nameplate abbreviation", () => {
    expect(matchResultsClassTag("balanced")?.label).toBe("GEO");
    expect(matchResultsClassTag("sprinter")?.label).toBe("INT");
    expect(matchResultsClassTag("heavy")?.label).toBe("KIN");
    expect(matchResultsClassTag("shielded")?.label).toBe("SYZ");
  });

  test("Geometrician and Interstice share the exact combat-cyan register (CA2/CA3)", () => {
    const geo = matchResultsClassTag("balanced");
    const int = matchResultsClassTag("sprinter");
    expect(geo?.colorCss).toBe(int?.colorCss);
    expect(geo?.colorCss).toBe("#8ff8ff");
  });

  test("Kindled gets house gold, Syzygist gets measured white — both distinct from the cyan pair", () => {
    expect(matchResultsClassTag("heavy")?.colorCss).toBe("#c9a84c");
    expect(matchResultsClassTag("shielded")?.colorCss).toBe("#dff2ff");
    expect(matchResultsClassTag("heavy")?.colorCss).not.toBe(matchResultsClassTag("balanced")?.colorCss);
    expect(matchResultsClassTag("shielded")?.colorCss).not.toBe(matchResultsClassTag("balanced")?.colorCss);
  });

  test("omits the tag entirely when the row carries no characterId — no crash, no placeholder", () => {
    expect(matchResultsClassTag(undefined)).toBeUndefined();
  });
});
