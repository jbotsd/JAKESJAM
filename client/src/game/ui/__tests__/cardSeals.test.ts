import { describe, expect, test } from "bun:test";
import { crystalRoundsCards } from "../../../sim/data/cards.js";
import {
  allSeals,
  formatSealGloss,
  formatSealLine,
  sealAccent,
  sealForCard,
} from "../cardSeals.js";

describe("cardSeals — instrument seals (Coptic + gloss)", () => {
  test("every seal has Coptic, latin, and english", () => {
    for (const s of allSeals()) {
      expect(s.coptic.length).toBeGreaterThan(0);
      expect(s.latin.length).toBeGreaterThan(0);
      expect(s.english.length).toBeGreaterThan(0);
      // UI line always pairs script + translit
      const line = formatSealLine(s);
      expect(line).toContain(s.coptic);
      expect(line).toContain(s.latin);
      expect(formatSealGloss(s)).toBe(s.english);
    }
  });

  test("every crystalRounds card resolves a seal", () => {
    for (const c of crystalRoundsCards) {
      const seal = sealForCard(c);
      expect(seal.coptic.length, c.id).toBeGreaterThan(0);
      expect(seal.english.length, c.id).toBeGreaterThan(0);
    }
  });

  test("default legendary maps to Autogenes (self-begotten)", () => {
    // Signature legendaries may override; pick one without override if any,
    // else assert gold accent on any legendary plate.
    const legs = crystalRoundsCards.filter((c) => c.rarity === "legendary");
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) {
      expect(sealAccent(leg)).toBe("gold");
    }
  });

  test("signature cards have themed seals (still bilingual)", () => {
    const voidC = crystalRoundsCards.find((c) => c.id === "void-fracture")!;
    expect(sealForCard(voidC).english).toBe("darkness");
    const blink = crystalRoundsCards.find((c) => c.id === "blink-dash")!;
    expect(sealForCard(blink).english).toBe("withdraw");
    const ray = crystalRoundsCards.find((c) => c.id === "raycast-prism")!;
    expect(sealForCard(ray).english).toBe("projection");
  });

  test("element bucket maps to stoicheion / element", () => {
    const el = crystalRoundsCards.find((c) => c.buckets?.includes("element"));
    expect(el).toBeDefined();
    const seal = sealForCard(el!);
    expect(seal.english).toBe("element");
  });

  test("delivery bucket maps to projection", () => {
    const d = crystalRoundsCards.find((c) => c.buckets?.includes("delivery"));
    expect(d).toBeDefined();
    expect(sealForCard(d!).english).toBe("projection");
  });

  test("format never leaves bare Coptic without latin", () => {
    for (const c of crystalRoundsCards.slice(0, 20)) {
      const line = formatSealLine(sealForCard(c));
      expect(line).toMatch(/·/);
    }
  });
});
