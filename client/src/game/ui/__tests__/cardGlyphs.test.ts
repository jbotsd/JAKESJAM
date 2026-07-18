// Content-sensitivity regression guard (2026-07-18): Jake flagged the
// "triangle" card-icon shape as personally sensitive (Illuminati-adjacent
// imagery — see memory/feedback_no_illuminati_symbolism.md). Every card's
// `visual.iconShape` was moved off "triangle" onto another shape from the
// approved crystal/diamond vocabulary (hexagon/circle/square/x/bar/orb).
// This test is a strong, simple guard against a future card silently
// reintroducing the banned shape.

import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../../../sim/data/cards.js";
import { cardGlyphHtml } from "../cardGlyphs.js";

describe("card glyph shapes — no triangle iconShape", () => {
  test("zero cards in crystalRoundsCards have iconShape: \"triangle\"", () => {
    const triangleCards = crystalRoundsCards.filter(
      (card) => card.visual?.iconShape === "triangle",
    );
    expect(triangleCards.map((c) => c.id)).toEqual([]);
  });

  test("triangle-rounds' rendered glyph is a diamond, not a filled 3-point triangle", () => {
    const card = crystalRoundsCards.find((c) => c.id === "triangle-rounds");
    expect(card).toBeDefined();
    const html = cardGlyphHtml(card!);
    // The old glyph was a literal 3-point <polygon points="32,10 52,50 12,50">.
    // The new glyph is a 4-point diamond/kite (crystal-diamond grammar) —
    // assert the old dominant-triangle polygon points are gone.
    expect(html).not.toContain("32,10 52,50 12,50");
    // Sanity: still renders a polygon-based shard glyph (4 points expected).
    expect(html).toContain("<polygon");
  });

  test("no card's rendered glyph falls through to the generic filled-triangle case", () => {
    // Belt-and-suspenders: even if a future card forgets to set iconShape
    // away from "triangle", cardGlyphHtml's own fallback switch should never
    // be reachable with shape === "triangle" once no card sets it. This just
    // re-confirms the source data, exercised through the real render path.
    for (const card of crystalRoundsCards) {
      const html = cardGlyphHtml(card);
      if (card.visual?.iconShape === "triangle") {
        throw new Error(`card ${card.id} still declares iconShape: "triangle"`);
      }
      expect(html).toContain("<svg");
    }
  });
});
