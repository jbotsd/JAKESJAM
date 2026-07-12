// Player-name sanitizer: extreme-allowlist behavior. This is the ONE
// function both client input handling and the server's authoritative
// ws-upgrade check call — see net/playerName.ts.

import { describe, expect, test } from "bun:test";
import { sanitizePlayerName, stripDisallowedChars } from "../playerName.js";

describe("sanitizePlayerName — legitimate names pass through", () => {
  test("plain alnum", () => {
    expect(sanitizePlayerName("Jake123")).toBe("Jake123");
  });
  test("apostrophe + hyphen (real-name shapes)", () => {
    expect(sanitizePlayerName("O'Brien")).toBe("O'Brien");
    expect(sanitizePlayerName("Anne-Marie")).toBe("Anne-Marie");
  });
  test("internal space preserved", () => {
    expect(sanitizePlayerName("Iron Jake")).toBe("Iron Jake");
  });
  test("exactly 14 chars is fine, 15 gets truncated to 14", () => {
    expect(sanitizePlayerName("12345678901234")).toBe("12345678901234");
    expect(sanitizePlayerName("123456789012345")).toBe("12345678901234");
  });
});

describe("sanitizePlayerName — the extreme allowlist strips everything else", () => {
  test("HTML/script injection characters removed, not escaped", () => {
    expect(sanitizePlayerName("<script>x</script>")).toBe("scriptxscript"); // 13 chars, no truncation
    expect(sanitizePlayerName("a<b>c")).toBe("abc");
    expect(sanitizePlayerName('"onmouseover="')).toBe("onmouseover");
  });
  test("homoglyphs (Cyrillic а vs Latin a) are removed, not preserved", () => {
    // U+0430 CYRILLIC SMALL LETTER A — visually identical to "a" but not \w.
    const cyrillicA = "ааа";
    expect(sanitizePlayerName(cyrillicA)).toBeUndefined();
    expect(sanitizePlayerName(`re${cyrillicA}l`)).toBe("rel");
  });
  test("zero-width joiners / RTL override stripped", () => {
    expect(sanitizePlayerName("a‍b‮c")).toBe("abc");
  });
  test("zalgo / combining-mark stacks stripped", () => {
    const zalgo = "j̵̧́á̈k̰͗è";
    const cleaned = sanitizePlayerName(zalgo);
    expect(cleaned).toBe("jake");
  });
  test("emoji stripped without corrupting surrogate pairs", () => {
    expect(sanitizePlayerName("Jake\u{1F525}Fire")).toBe("JakeFire");
  });
  test("massive input never causes unbounded work — capped before regex", () => {
    const huge = "a".repeat(1_000_000);
    const start = performance.now();
    const result = sanitizePlayerName(huge);
    expect(performance.now() - start).toBeLessThan(50);
    expect(result?.length).toBeLessThanOrEqual(14);
  });
});

describe("sanitizePlayerName — structural rejection", () => {
  test("too short after cleaning falls back to undefined", () => {
    expect(sanitizePlayerName("a")).toBeUndefined();
    expect(sanitizePlayerName("")).toBeUndefined();
  });
  test("punctuation/space-only (no alnum) rejected", () => {
    expect(sanitizePlayerName("...")).toBeUndefined();
    expect(sanitizePlayerName("---")).toBeUndefined();
    expect(sanitizePlayerName("   ")).toBeUndefined();
    expect(sanitizePlayerName("''''")).toBeUndefined();
  });
  test("collapses internal whitespace runs to one space", () => {
    expect(sanitizePlayerName("A          B")).toBe("A B");
  });
  test("trims leading/trailing whitespace", () => {
    expect(sanitizePlayerName("  Jake  ")).toBe("Jake");
  });
});

describe("sanitizePlayerName — impersonation denylist", () => {
  test("reserved labels rejected case-insensitively", () => {
    for (const w of ["you", "You", "YOU", "system", "Admin", "SERVER", "jakesjam", "binipe"]) {
      expect(sanitizePlayerName(w)).toBeUndefined();
    }
  });
  test("anything starting with 'bot' rejected (spoofs the BOT · plate)", () => {
    expect(sanitizePlayerName("bot")).toBeUndefined();
    expect(sanitizePlayerName("BotKiller")).toBeUndefined();
    expect(sanitizePlayerName("bot piston")).toBeUndefined();
  });
  test("substrings that merely CONTAIN a reserved word are fine", () => {
    expect(sanitizePlayerName("youtuber")).toBe("youtuber");
    expect(sanitizePlayerName("Robot99")).toBe("Robot99"); // contains "bot" but doesn't start with it
  });
});

describe("stripDisallowedChars — live-typing filter never over-rejects", () => {
  test("does NOT blank a transient reserved-word substring mid-typing", () => {
    // Typing "you" then continuing to "youtuber" must never blank the field.
    expect(stripDisallowedChars("you")).toBe("you");
    expect(stripDisallowedChars("youtuber123")).toBe("youtuber123");
  });
  test("does NOT trim or reject short input — that's sanitizePlayerName's job", () => {
    expect(stripDisallowedChars("  a  ")).toBe(" a ");
  });
  test("still strips disallowed characters live", () => {
    expect(stripDisallowedChars("<b>hi</b>")).toBe("bhib");
  });
});
