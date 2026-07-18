// Class era P1 (docs/classes-goal.md): chassis id sanitizer + the
// id-vs-display contract. The four sim/wire ids stay the ORIGINAL
// archetype words (replays/wire compat); the player-facing layer speaks
// class names. These tests pin both halves so a future rename can't
// silently break the wire or resurrect archetype words in the UI.

import { describe, expect, test } from "bun:test";
import {
  CHARACTER_ARCHETYPE_IDS,
  DEFAULT_CHARACTER_ID,
  sanitizeCharacterId,
} from "../playerCharacter.js";
import { characters } from "../../game/data/characters.js";

describe("sanitizeCharacterId (authoritative whitelist)", () => {
  test("passes each of the four archetype ids through unchanged", () => {
    for (const id of CHARACTER_ARCHETYPE_IDS) {
      expect(sanitizeCharacterId(id)).toBe(id);
    }
  });

  test("falls back to the default chassis for anything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "wizard", // class ids are DISPLAY ids, never wire ids
      "ninja",
      "paladin",
      "priest",
      "BALANCED", // exact-match only
      "balanced ",
      "balanced'; DROP TABLE",
    ]) {
      expect(sanitizeCharacterId(bad)).toBe(DEFAULT_CHARACTER_ID);
    }
  });
});

describe("characters.ts — class-era display layer over stable ids", () => {
  test("ids are exactly the four sim archetypes (wire/replay stability)", () => {
    expect(characters.map((c) => c.id).sort()).toEqual(
      [...CHARACTER_ARCHETYPE_IDS].sort(),
    );
  });

  test("display names are the LOCKED persona names per canon mapping (docs/classes-goal.md § Naming, 2026-07-17)", () => {
    const byId = new Map(characters.map((c) => [c.id, c]));
    expect(byId.get("balanced")?.name).toBe("Geometrician");
    expect(byId.get("sprinter")?.name).toBe("Interstice");
    expect(byId.get("heavy")?.name).toBe("Kindred");
    expect(byId.get("shielded")?.name).toBe("Syzygist");
    // classId dev-id layer (code/docs/sigil lookup) stays the English word.
    expect(byId.get("balanced")?.classId).toBe("wizard");
    expect(byId.get("sprinter")?.classId).toBe("ninja");
    expect(byId.get("heavy")?.classId).toBe("paladin");
    expect(byId.get("shielded")?.classId).toBe("priest");
  });

  test("no player-facing archetype words survive in names", () => {
    for (const c of characters) {
      expect(["Balanced", "Heavy", "Sprinter", "Shielded"]).not.toContain(c.name);
    }
  });

  test("only the wizard ships its full kit in P1 (honesty rule)", () => {
    for (const c of characters) {
      if (c.classId === "wizard") expect(c.kitComing).toBeUndefined();
      else expect(c.kitComing).toBe(true);
    }
    // Kit summaries describe what's true TODAY — no future verbs.
    for (const c of characters) {
      expect(c.kitSummary.toLowerCase()).not.toMatch(
        /sword|slash|blade|heal|buff|curse|board|melee/,
      );
    }
  });
});
