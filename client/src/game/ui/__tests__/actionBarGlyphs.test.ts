// actionBarGlyphs tests — proves every Geometrician catalog AbilityKind
// (docs/class-ability-catalogs-v1.md) gets a distinct action-bar glyph
// instead of falling through to the generic dot fallback.
//
// Phaser-runtime-free: `import Phaser from "phaser"` throws under `bun test`
// (`window is not defined` — phaser assumes a DOM), so we duck-type a
// call-recording Graphics stub instead of constructing a real one. Same
// approach as cardIcons.test.ts's makeGraphicsStub.

import { describe, expect, test } from "bun:test";
import { drawActiveGlyph, type GlyphGraphics } from "../actionBarGlyphs";
import type { AbilityKind } from "../../../sim/data/cardTypes";

/** Records every call (method + rounded args) as a string — two glyphs are
 *  "the same shape" iff their recorded call logs are identical. */
function makeRecordingGraphics(): { g: GlyphGraphics; log: () => string[] } {
  const calls: string[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec =
    (name: string) =>
    (...args: any[]) => {
      calls.push(
        `${name}(${args.map((a) => (typeof a === "number" ? round(a) : String(a))).join(",")})`,
      );
      return undefined;
    };
  const g: GlyphGraphics = {
    lineStyle: rec("lineStyle"),
    fillStyle: rec("fillStyle"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    closePath: rec("closePath"),
    strokePath: rec("strokePath"),
    strokeCircle: rec("strokeCircle"),
    fillCircle: rec("fillCircle"),
    arc: rec("arc"),
  };
  return { g, log: () => calls };
}

function glyphLog(kind: string): string[] {
  const { g, log } = makeRecordingGraphics();
  drawActiveGlyph(g, 100, 100, 20, kind, 0x3c79f0);
  return log();
}

// The ten Geometrician catalog kinds (cardTypes.ts AbilityKind union,
// class-ability-catalogs-v1.md). Typed against AbilityKind so this list
// breaks at compile time if a kind is renamed upstream.
const GEOMETRICIAN_KINDS: AbilityKind[] = [
  "sunlance",
  "facet-break",
  "prism-fan",
  "lattice",
  "return-glass",
  "hard-aperture",
  "overclock",
  "measure",
  "slip-node",
  "recoil-step",
];

// The five pre-existing class-blind six-axes kinds — already had bespoke
// glyphs before this chunk; included to prove the extraction didn't collide
// with or flatten them into the new catalog's shapes.
const CLASS_BLIND_KINDS: AbilityKind[] = [
  "crimson-tithe",
  "shadow-step",
  "veil-of-nought",
  "severing-answer",
  "shelter-seal",
];

describe("drawActiveGlyph — Geometrician catalog (chunk 4.3)", () => {
  test("all 10 catalog kinds draw something (non-empty call log)", () => {
    for (const kind of GEOMETRICIAN_KINDS) {
      const calls = glyphLog(kind);
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  test("none of the 10 catalog kinds fall back to the generic dot", () => {
    const dotLog = glyphLog("__unknown-kind__").join("|");
    for (const kind of GEOMETRICIAN_KINDS) {
      expect(glyphLog(kind).join("|")).not.toBe(dotLog);
    }
  });

  test("all 10 catalog kinds are pairwise visually distinct", () => {
    const logs = GEOMETRICIAN_KINDS.map((kind) => glyphLog(kind).join("|"));
    const distinct = new Set(logs);
    expect(distinct.size).toBe(GEOMETRICIAN_KINDS.length);
  });

  test("catalog kinds are distinct from the five pre-existing class-blind glyphs", () => {
    const catalogLogs = new Set(GEOMETRICIAN_KINDS.map((k) => glyphLog(k).join("|")));
    for (const kind of CLASS_BLIND_KINDS) {
      expect(catalogLogs.has(glyphLog(kind).join("|"))).toBe(false);
    }
  });

  test("unknown kind still falls back to a filled dot (regression guard)", () => {
    const calls = glyphLog("some-future-kind-not-yet-drawn");
    expect(calls.some((c) => c.startsWith("fillCircle"))).toBe(true);
    expect(calls.some((c) => c.startsWith("fillStyle"))).toBe(true);
  });

  test("hard-aperture draws four gated arcs (not a closed ring)", () => {
    const calls = glyphLog("hard-aperture");
    const arcCalls = calls.filter((c) => c.startsWith("arc("));
    expect(arcCalls.length).toBe(4);
  });

  test("readyColor vs window-active crimson both draw the same shape", () => {
    // The active-effect-window recolor (crimson) must not change *which*
    // glyph is drawn, only its color — drawActiveGlyph doesn't see
    // windowFrac at all, only the resolved color, so shape logs should be
    // identical modulo the color arg embedded in fillStyle/lineStyle calls.
    const { g: g1, log: log1 } = makeRecordingGraphics();
    drawActiveGlyph(g1, 50, 50, 20, "sunlance", 0x3c79f0);
    const { g: g2, log: log2 } = makeRecordingGraphics();
    drawActiveGlyph(g2, 50, 50, 20, "sunlance", 0xdc2626);
    // Strip the color arg (last element in each lineStyle/fillStyle call)
    // by comparing call *shapes* (method name + point coords only).
    const shapeOf = (calls: string[]) =>
      calls.map((c) => c.replace(/^(lineStyle|fillStyle)\([^)]*\)$/, "$1(...)"));
    expect(shapeOf(log1())).toEqual(shapeOf(log2()));
  });
});

// The nine wired Interstice catalog kinds (cardTypes.ts AbilityKind union,
// class-ability-catalogs-v1.md — "paper-double" is not in the union at all,
// see that file's own header comment).
const INTERSTICE_KINDS: AbilityKind[] = [
  "undercut",
  "edge-storm",
  "needle",
  "read-mark",
  "shard-ring",
  "wall-bloom",
  "ghost-guard",
  "second-wind",
  "razor-route",
];

describe("drawActiveGlyph — Interstice catalog v1", () => {
  test("all 9 catalog kinds draw something (non-empty call log)", () => {
    for (const kind of INTERSTICE_KINDS) {
      const calls = glyphLog(kind);
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  test("none of the 9 catalog kinds fall back to the generic dot", () => {
    const dotLog = glyphLog("__unknown-kind__").join("|");
    for (const kind of INTERSTICE_KINDS) {
      expect(glyphLog(kind).join("|")).not.toBe(dotLog);
    }
  });

  test("all 9 catalog kinds are pairwise visually distinct", () => {
    const logs = INTERSTICE_KINDS.map((kind) => glyphLog(kind).join("|"));
    const distinct = new Set(logs);
    expect(distinct.size).toBe(INTERSTICE_KINDS.length);
  });

  test("catalog kinds are distinct from the five pre-existing class-blind glyphs and the Geometrician catalog", () => {
    const existingLogs = new Set(
      [...CLASS_BLIND_KINDS, ...GEOMETRICIAN_KINDS].map((k) => glyphLog(k).join("|")),
    );
    for (const kind of INTERSTICE_KINDS) {
      expect(existingLogs.has(glyphLog(kind).join("|"))).toBe(false);
    }
  });
});
