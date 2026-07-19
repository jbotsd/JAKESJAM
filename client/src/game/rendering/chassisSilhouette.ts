// Chassis silhouette geometry — the CA3 "readable in flat black alone"
// helmet-shape differentiator (docs/chassis-design-axioms.md), factored
// out of ProceduralPlayerRig's drawHeadCrest/drawHead as PURE point-array
// math so it can be unit tested without a live Phaser scene (this repo's
// established constraint: `import Phaser from "phaser"` throws under
// `bun test` — "window is not defined" — see
// client/src/game/ui/__tests__/actionBarGlyphs.test.ts's own header
// comment for the precedent this file follows).
//
// Grounding: docs/class-inspiration/*-v2.jpg (locked concept art) +
// docs/chassis-design-axioms.md's per-class chassis sheet. Every class
// shares the same underlying body/torso/limb geometry (CA1 — "one body,
// four accents") and the same visor/face-plate code in ProceduralPlayerRig
// (untouched by this file) — ONLY the crest (head-crest fin/spike) and the
// hood outline vary here.
//
// `wizard` (Geometrician) is the "home base" chassis every other class is
// measured against (chassis-design-axioms.md) — its geometry below is
// COPIED VERBATIM from ProceduralPlayerRig's pre-existing drawHeadCrest/
// drawHead numeric literals, not redesigned. Any caller that resolves to
// `classId: "wizard"` (or a class ID this module doesn't recognize) must
// get byte-identical output to what those methods drew before this file
// existed — that's the hard "purely additive for the default path"
// requirement this whole chassis pass is built under.

import type { ClassId } from "../types/game";

export type Point = { x: number; y: number };

export type HeadCrestGeometry = {
  /** Dark silhouette base triangle (drawn first, slightly larger). */
  darkBase: [Point, Point, Point];
  /** Bright plate fill triangle (player body color), inset from darkBase. */
  brightPlate: [Point, Point, Point];
  /** Accent glow edge line along the leading side. */
  edgeLine: [Point, Point];
  /** Soft glow dot at the very tip. */
  tipGlow: Point;
};

export type HeadHoodGeometry = {
  /** Dark hood shadow quad (drawn first, larger). */
  shadow: [Point, Point, Point, Point];
  /** Player-colored hood main quad, inset from shadow. */
  main: [Point, Point, Point, Point];
};

/**
 * Head-crest (fin/horn/spike) geometry for a class, in WORLD-SPACE offsets
 * from `head` (already scaled by `s`, already mirrored by facing `f`).
 * Returns `null` for Syzygist (priest) — CA3: "a smooth teardrop head, no
 * crest, no crown, no fins... the quietest silhouette of the four by
 * deliberate contrast." ProceduralPlayerRig.drawHeadCrest must skip
 * drawing entirely when this returns null.
 */
export function headCrestGeometry(
  classId: ClassId,
  head: Point,
  s: number,
  f: number,
): HeadCrestGeometry | null {
  if (classId === "priest") return null;

  const rootX = head.x - f * 1 * s;
  const rootY = head.y - 8 * s;

  if (classId === "paladin") {
    // Kindled: a TALL, THIN blade-spike — centered (no facing sweep,
    // unlike every other class's crest), the tallest/most-vertical
    // silhouette of the four (kindled-v2.jpg's tall pointed crown), echoing
    // the sword this class actually wields rather than reading as a
    // generic crown-spike. REVISED 2026-07-18 (Jake, live playtest: "no
    // triangle head" — the original version was a wide, flat, symmetric,
    // solid-filled isosceles triangle, which reads as literally "a
    // triangle" the way this rig's other, asymmetric/swept crests don't;
    // see feedback_no_illuminati_symbolism memory's 2026-07-18 tightening).
    // Fix: cut the base width by ~55-60% (dark ±4/+5 -> ±1.7/+2.2, bright
    // ±2/+3.5 -> ±0.8/+1.3) so the same silhouette reads as a thin blade,
    // not a filled wedge — verified by rendering candidate geometries to a
    // standalone SVG/PNG and comparing side-by-side (this rig can't be
    // constructed under `bun test`, see this file's own header comment, so
    // this was the only way to actually SEE the shape before committing).
    // A twin-horn candidate was tried and rejected (reads as devil horns);
    // a needle+cross-guard candidate was tried and rejected (the guard bar
    // crossing the blade reads as a literal cross, a second banned motif).
    // Tip magnitude stays at 25*s (unchanged) so it stays clear of the
    // nameplate badge, which occupies roughly [-41s, -26s] above head.y
    // (see ProceduralPlayerRig.drawNameplate) — a taller spike would
    // visually poke through the name/HP plate.
    const tipX = head.x;
    const tipY = head.y - 25 * s;
    return {
      darkBase: [
        { x: rootX - f * 1.7 * s, y: rootY + 4 * s },
        { x: tipX, y: tipY },
        { x: rootX + f * 2.2 * s, y: rootY - 2 * s },
      ],
      brightPlate: [
        { x: rootX - f * 0.8 * s, y: rootY + 2 * s },
        { x: tipX, y: tipY + 2 * s },
        { x: rootX + f * 1.3 * s, y: rootY - 1 * s },
      ],
      edgeLine: [
        { x: rootX + f * 1.3 * s, y: rootY - 1 * s },
        { x: tipX, y: tipY + 2 * s },
      ],
      tipGlow: { x: tipX, y: tipY + 2 * s },
    };
  }

  if (classId === "ninja") {
    // Interstice: sleeker, lower-profile, more RAKED than Geometrician's —
    // shorter rise, swept further back (interstice-v2.jpg's low raked
    // hood on a horizontal-leap silhouette — "already moving").
    const tipX = head.x - f * 24 * s;
    const tipY = head.y - 11 * s;
    return {
      darkBase: [
        { x: rootX - f * 3 * s, y: rootY + 3 * s },
        { x: tipX, y: tipY },
        { x: rootX + f * 4 * s, y: rootY - 1.5 * s },
      ],
      brightPlate: [
        { x: rootX - f * 1.5 * s, y: rootY + 1.5 * s },
        { x: tipX + f * 1.5 * s, y: tipY + 1.5 * s },
        { x: rootX + f * 3 * s, y: rootY - 1 * s },
      ],
      edgeLine: [
        { x: rootX + f * 3 * s, y: rootY - 1 * s },
        { x: tipX + f * 1.5 * s, y: tipY + 1.5 * s },
      ],
      tipGlow: { x: tipX + f * 1.5 * s, y: tipY + 1.5 * s },
    };
  }

  // wizard (Geometrician) and any unrecognized classId: the pre-existing
  // default geometry, UNCHANGED (see file header — copied verbatim).
  const tipX = head.x - f * 19 * s;
  const tipY = head.y - 19 * s;
  return {
    darkBase: [
      { x: rootX - f * 3 * s, y: rootY + 3 * s },
      { x: tipX, y: tipY },
      { x: rootX + f * 4 * s, y: rootY - 1.5 * s },
    ],
    brightPlate: [
      { x: rootX - f * 1.5 * s, y: rootY + 1.5 * s },
      { x: tipX + f * 1.5 * s, y: tipY + 1.5 * s },
      { x: rootX + f * 3 * s, y: rootY - 1 * s },
    ],
    edgeLine: [
      { x: rootX + f * 3 * s, y: rootY - 1 * s },
      { x: tipX + f * 1.5 * s, y: tipY + 1.5 * s },
    ],
    tipGlow: { x: tipX + f * 1.5 * s, y: tipY + 1.5 * s },
  };
}

/**
 * Hood outline geometry for a class, in WORLD-SPACE offsets from `head`
 * (already scaled by `s`, already mirrored by facing `f`). Always returns
 * a shape (every class keeps a hood/helmet base — only the crest is
 * class-optional). The face plate + visor seam drawn on top of this in
 * ProceduralPlayerRig.drawHead are NOT parameterized by class — they stay
 * anchored directly to `head`, matching CA1's shared "faceless smooth
 * ovoid-visored helmet... face is an aperture" across all four classes.
 */
export function headHoodGeometry(classId: ClassId, head: Point, s: number, f: number): HeadHoodGeometry {
  switch (classId) {
    case "paladin":
      // Kindled: tall, CENTERED (no facing skew), narrow-tapered — the
      // crown base beneath the crest spike above. Reads as "the biggest
      // thing in the room" even in flat black (chassis-design-axioms CA3).
      return {
        shadow: [
          { x: head.x - 8.5 * s, y: head.y + 6 * s },
          { x: head.x - 3.5 * s, y: head.y - 20 * s },
          { x: head.x + 3.5 * s, y: head.y - 20 * s },
          { x: head.x + 8.5 * s, y: head.y + 6 * s },
        ],
        main: [
          { x: head.x - 6.5 * s, y: head.y + 4 * s },
          { x: head.x - 2.5 * s, y: head.y - 18 * s },
          { x: head.x + 2.5 * s, y: head.y - 18 * s },
          { x: head.x + 6.5 * s, y: head.y + 4 * s },
        ],
      };

    case "ninja":
      // Interstice: lower-profile and more raked forward than
      // Geometrician's — flatter top, exaggerated forward lean.
      return {
        shadow: [
          { x: head.x - 8.5 * s, y: head.y + 6 * s },
          { x: head.x + f * 4 * s - 6.5 * s, y: head.y - 10 * s },
          { x: head.x + f * 4 * s + 6.5 * s, y: head.y - 10 * s },
          { x: head.x + 8.5 * s, y: head.y + 6 * s },
        ],
        main: [
          { x: head.x - 6.5 * s, y: head.y + 4 * s },
          { x: head.x + f * 4 * s - 5 * s, y: head.y - 9 * s },
          { x: head.x + f * 4 * s + 5 * s, y: head.y - 9 * s },
          { x: head.x + 6.5 * s, y: head.y + 4 * s },
        ],
      };

    case "priest":
      // Syzygist: smooth, symmetric, minimal peak, no forward rake at all
      // — the "quietest" hood (CA3: distinct BECAUSE it under-designs
      // where the other three over-design). Narrower top taper than any
      // other class reads rounder/teardrop within this rig's straight-
      // line-polygon vector style (no true beziers anywhere in this file).
      return {
        shadow: [
          { x: head.x - 7.5 * s, y: head.y + 6 * s },
          { x: head.x - 4 * s, y: head.y - 11 * s },
          { x: head.x + 4 * s, y: head.y - 11 * s },
          { x: head.x + 7.5 * s, y: head.y + 6 * s },
        ],
        main: [
          { x: head.x - 5.7 * s, y: head.y + 4 * s },
          { x: head.x - 3 * s, y: head.y - 9.5 * s },
          { x: head.x + 3 * s, y: head.y - 9.5 * s },
          { x: head.x + 5.7 * s, y: head.y + 4 * s },
        ],
      };

    case "wizard":
    default:
      // Geometrician (and any unrecognized classId): the pre-existing
      // default geometry, UNCHANGED (see file header — copied verbatim).
      return {
        shadow: [
          { x: head.x - 8.5 * s, y: head.y + 6 * s },
          { x: head.x + f * 2 * s - 6.5 * s, y: head.y - 14 * s },
          { x: head.x + f * 2 * s + 6.5 * s, y: head.y - 14 * s },
          { x: head.x + 8.5 * s, y: head.y + 6 * s },
        ],
        main: [
          { x: head.x - 6.5 * s, y: head.y + 4 * s },
          { x: head.x + f * 2 * s - 5 * s, y: head.y - 12 * s },
          { x: head.x + f * 2 * s + 5 * s, y: head.y - 12 * s },
          { x: head.x + 6.5 * s, y: head.y + 4 * s },
        ],
      };
  }
}
