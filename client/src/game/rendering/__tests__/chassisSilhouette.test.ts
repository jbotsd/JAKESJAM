// chassisSilhouette tests — Phaser-runtime-free (this module has zero
// Phaser import, purely point-array math), following the established
// precedent for this codebase: `import Phaser from "phaser"` throws under
// `bun test` ("window is not defined"), so ProceduralPlayerRig itself
// cannot be instantiated in a test — see actionBarGlyphs.test.ts's header
// comment. This file verifies the two properties that actually matter for
// the chassis silhouette pass:
//
//   1. The DEFAULT path (classId "wizard", and any unrecognized classId)
//      is byte-identical to the pre-existing geometry ProceduralPlayerRig
//      drew before this module existed — the hard "purely additive"
//      requirement.
//   2. The four classes produce GENUINELY DIFFERENT draw-call geometry
//      (not just a color difference) — different point coordinates, and
//      Syzygist specifically draws no crest at all.

import { describe, expect, test } from "bun:test";
import { headCrestGeometry, headHoodGeometry } from "../chassisSilhouette";
import type { HeadCrestGeometry, HeadHoodGeometry } from "../chassisSilhouette";
import type { ClassId } from "../../types/game";

const HEAD = { x: 100, y: 200 };
const S = 1.4; // arbitrary non-1 scale to catch any missed `* s` factor
const F = 1; // facing right

describe("headCrestGeometry — default path (wizard) is byte-identical to the pre-existing formula", () => {
  test("matches ProceduralPlayerRig's original drawHeadCrest literals exactly", () => {
    const rootX = HEAD.x - F * 1 * S;
    const rootY = HEAD.y - 8 * S;
    const tipX = HEAD.x - F * 19 * S;
    const tipY = HEAD.y - 19 * S;
    const expected: HeadCrestGeometry = {
      darkBase: [
        { x: rootX - F * 3 * S, y: rootY + 3 * S },
        { x: tipX, y: tipY },
        { x: rootX + F * 4 * S, y: rootY - 1.5 * S },
      ],
      brightPlate: [
        { x: rootX - F * 1.5 * S, y: rootY + 1.5 * S },
        { x: tipX + F * 1.5 * S, y: tipY + 1.5 * S },
        { x: rootX + F * 3 * S, y: rootY - 1 * S },
      ],
      edgeLine: [
        { x: rootX + F * 3 * S, y: rootY - 1 * S },
        { x: tipX + F * 1.5 * S, y: tipY + 1.5 * S },
      ],
      tipGlow: { x: tipX + F * 1.5 * S, y: tipY + 1.5 * S },
    };
    expect(headCrestGeometry("wizard", HEAD, S, F)).toEqual(expected);
  });

  test("an unrecognized classId falls back to the wizard geometry (never crashes, never a placeholder shape)", () => {
    const wizard = headCrestGeometry("wizard", HEAD, S, F);
    const fallback = headCrestGeometry("not-a-real-class" as ClassId, HEAD, S, F);
    expect(fallback).toEqual(wizard);
  });

  test("facing mirror (f = -1) flips the wizard crest horizontally, matching the pre-existing formula", () => {
    const f = -1;
    const rootX = HEAD.x - f * 1 * S;
    const rootY = HEAD.y - 8 * S;
    const tipX = HEAD.x - f * 19 * S;
    const tipY = HEAD.y - 19 * S;
    const crest = headCrestGeometry("wizard", HEAD, S, f)!;
    expect(crest.darkBase[1]).toEqual({ x: tipX, y: tipY });
    expect(crest.darkBase[0]).toEqual({ x: rootX - f * 3 * S, y: rootY + 3 * S });
  });
});

describe("headHoodGeometry — default path (wizard) is byte-identical to the pre-existing formula", () => {
  test("matches ProceduralPlayerRig's original drawHead hood literals exactly", () => {
    const expected: HeadHoodGeometry = {
      shadow: [
        { x: HEAD.x - 8.5 * S, y: HEAD.y + 6 * S },
        { x: HEAD.x + F * 2 * S - 6.5 * S, y: HEAD.y - 14 * S },
        { x: HEAD.x + F * 2 * S + 6.5 * S, y: HEAD.y - 14 * S },
        { x: HEAD.x + 8.5 * S, y: HEAD.y + 6 * S },
      ],
      main: [
        { x: HEAD.x - 6.5 * S, y: HEAD.y + 4 * S },
        { x: HEAD.x + F * 2 * S - 5 * S, y: HEAD.y - 12 * S },
        { x: HEAD.x + F * 2 * S + 5 * S, y: HEAD.y - 12 * S },
        { x: HEAD.x + 6.5 * S, y: HEAD.y + 4 * S },
      ],
    };
    expect(headHoodGeometry("wizard", HEAD, S, F)).toEqual(expected);
  });

  test("an unrecognized classId falls back to the wizard hood geometry", () => {
    const wizard = headHoodGeometry("wizard", HEAD, S, F);
    const fallback = headHoodGeometry("not-a-real-class" as ClassId, HEAD, S, F);
    expect(fallback).toEqual(wizard);
  });
});

describe("per-class silhouette differentiation (CA3 — readable in flat black alone)", () => {
  const classes: ClassId[] = ["wizard", "ninja", "paladin", "priest"];

  test("Syzygist (priest) has NO crest — the only class where headCrestGeometry returns null", () => {
    expect(headCrestGeometry("priest", HEAD, S, F)).toBeNull();
    for (const c of ["wizard", "ninja", "paladin"] as ClassId[]) {
      expect(headCrestGeometry(c, HEAD, S, F)).not.toBeNull();
    }
  });

  test("every class with a crest produces a distinct tip position (genuinely different geometry, not a recolor)", () => {
    const tips = new Map<ClassId, { x: number; y: number }>();
    for (const c of classes) {
      const crest = headCrestGeometry(c, HEAD, S, F);
      if (crest) tips.set(c, crest.tipGlow);
    }
    const seen = new Set<string>();
    for (const p of tips.values()) {
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      expect(seen.has(key)).toBe(false); // no two classes share a tip position
      seen.add(key);
    }
  });

  test("Kindled (paladin) is the tallest crest — smallest (most negative) tip.y magnitude beats every other class", () => {
    const heights = classes
      .map((c) => ({ c, crest: headCrestGeometry(c, HEAD, S, F) }))
      .filter((x): x is { c: ClassId; crest: NonNullable<ReturnType<typeof headCrestGeometry>> } => x.crest !== null)
      .map((x) => ({ c: x.c, tipY: x.crest.tipGlow.y }));
    const paladin = heights.find((h) => h.c === "paladin")!;
    for (const h of heights) {
      if (h.c === "paladin") continue;
      // Smaller (more negative) y = higher above the head = taller crest.
      expect(paladin.tipY).toBeLessThan(h.tipY);
    }
  });

  test("Kindled's crest is CENTERED (no facing sweep) — tip.x stays at head.x regardless of facing, unlike wizard/ninja", () => {
    const paladinRight = headCrestGeometry("paladin", HEAD, S, 1)!;
    const paladinLeft = headCrestGeometry("paladin", HEAD, S, -1)!;
    expect(paladinRight.tipGlow.x).toBeCloseTo(HEAD.x, 5);
    expect(paladinLeft.tipGlow.x).toBeCloseTo(HEAD.x, 5);

    const wizardRight = headCrestGeometry("wizard", HEAD, S, 1)!;
    const wizardLeft = headCrestGeometry("wizard", HEAD, S, -1)!;
    expect(wizardRight.tipGlow.x).not.toBeCloseTo(wizardLeft.tipGlow.x, 1);
  });

  test("every class's hood shape is distinct from every other class's hood shape", () => {
    const shapes = classes.map((c) => JSON.stringify(headHoodGeometry(c, HEAD, S, F)));
    const unique = new Set(shapes);
    expect(unique.size).toBe(classes.length);
  });

  test("Interstice (ninja) hood is lower-profile (flatter) than Geometrician's (wizard) — smaller peak height", () => {
    const wizard = headHoodGeometry("wizard", HEAD, S, F);
    const ninja = headHoodGeometry("ninja", HEAD, S, F);
    const wizardPeakHeight = HEAD.y - wizard.main[1].y;
    const ninjaPeakHeight = HEAD.y - ninja.main[1].y;
    expect(ninjaPeakHeight).toBeLessThan(wizardPeakHeight);
  });
});
