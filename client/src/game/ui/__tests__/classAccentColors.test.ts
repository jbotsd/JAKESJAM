// classAccentColors tests — pure lookup table, no Phaser import, no DOM.
// Verifies docs/chassis-design-axioms.md CA2's three registers: cyan is
// SHARED between Geometrician/Interstice (differentiated by silhouette,
// not color — CA3), gold is Kindled-only, and Syzygist gets its own
// distinct "measured white" register (not a dim cyan, not violet).

import { describe, expect, test } from "bun:test";
import { classAccentPalette } from "../classAccentColors";

describe("classAccentPalette", () => {
  test("Geometrician (wizard) and Interstice (ninja) share the exact same cyan register", () => {
    const wizard = classAccentPalette("wizard");
    const ninja = classAccentPalette("ninja");
    expect(wizard).toEqual(ninja);
    expect(wizard.accentColor).toBe(0x8ff8ff);
  });

  test("Kindled (paladin) uses the Autogenes house gold — same hex as the Ward-absorb flash", () => {
    const paladin = classAccentPalette("paladin");
    expect(paladin.accentColor).toBe(0xc9a84c);
    expect(paladin.visorColor).toBe(0xc9a84c);
  });

  test("Syzygist (priest) gets a distinct cool-white register, not cyan and not violet", () => {
    const priest = classAccentPalette("priest");
    expect(priest.accentColor).not.toBe(0x8ff8ff);
    expect(priest.accentColor).not.toBe(0xc9a84c);
    // Not violet (no purple hue — high red+blue, low green) and reads as a
    // pale, cool (blue-leaning) near-white: high across all channels, blue
    // channel highest.
    const r = (priest.accentColor >> 16) & 0xff;
    const g = (priest.accentColor >> 8) & 0xff;
    const b = priest.accentColor & 0xff;
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(180);
    expect(b).toBeGreaterThanOrEqual(r);
    expect(b).toBeGreaterThanOrEqual(g);
  });

  test("every class has all five channels populated (accent/visor/palm/joint/aura)", () => {
    for (const c of ["wizard", "ninja", "paladin", "priest"] as const) {
      const p = classAccentPalette(c);
      expect(typeof p.accentColor).toBe("number");
      expect(typeof p.visorColor).toBe("number");
      expect(typeof p.palmColor).toBe("number");
      expect(typeof p.jointColor).toBe("number");
      expect(typeof p.auraColor).toBe("number");
    }
  });

  test("exactly three distinct registers across four classes (wizard/ninja share one)", () => {
    const values = new Set(
      (["wizard", "ninja", "paladin", "priest"] as const).map((c) => classAccentPalette(c).accentColor),
    );
    expect(values.size).toBe(3);
  });
});
