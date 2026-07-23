// Voice-register lint (convergence Track V / cohesion P2, 2026-07-23).
// The two-register decision: in-play copy speaks the crucible (gnostic,
// optimistic, self-empowering — "iron begets iron"); the record's gravity
// ("unmade", "testimony", "let the record show") belongs ONLY to
// end-of-match surfaces. Cards are in-play copy, so this suite pins BOTH
// walls: no juridical/transgressive vocabulary, and no record vocabulary
// leaking forward into the fight.

import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../data/cards.js";

// Juridical/transgressive words banned from all in-play copy. Roots are
// matched case-insensitively so variants ("sanctioned", "prohibits") fail.
const BANNED_IN_PLAY = [
  "prohibit",
  "tribunal",
  "war crime",
  "illegal",
  "treaty",
  "sanction",
  "forbidden",
  "contraband",
];

// End-of-match register markers that must never appear on a card.
const RECORD_REGISTER = ["unmade", "testimony", "let the record show"];

const copyOf = (card: (typeof crystalRoundsCards)[number]): string =>
  [card.name, card.description, card.flavorText ?? ""].join(" ").toLowerCase();

describe("card copy voice register", () => {
  test("no card copy uses banned in-play vocabulary", () => {
    for (const card of crystalRoundsCards) {
      const copy = copyOf(card);
      for (const word of BANNED_IN_PLAY) {
        expect(copy, `${card.id} contains banned in-play word "${word}"`).not.toContain(word);
      }
    }
  });

  test("no card copy leaks the record register", () => {
    for (const card of crystalRoundsCards) {
      const copy = copyOf(card);
      for (const marker of RECORD_REGISTER) {
        expect(copy, `${card.id} leaks record-register marker "${marker}"`).not.toContain(marker);
      }
    }
  });

  test("every description is non-empty and fits the card face (<=160 chars)", () => {
    for (const card of crystalRoundsCards) {
      expect(card.description.length, `${card.id} description is empty`).toBeGreaterThan(0);
      expect(
        card.description.length,
        `${card.id} description is ${card.description.length} chars (max 160)`,
      ).toBeLessThanOrEqual(160);
    }
  });
});
