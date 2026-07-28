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
  /** Dark hood shadow polygon (drawn first, larger). At least 3 points. */
  shadow: Point[];
  /** Player-colored hood main polygon, inset from shadow. At least 3 points. */
  main: Point[];
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
    //
    // REVISED 2026-07-27 (Jake, live screenshot: "looks silly," nowhere near
    // as cool as the other 3 classes): rendering the live rig and comparing
    // side-by-side against Geometrician/Interstice/Syzygist found the ACTUAL
    // bug isn't the width above — it's that this triangle is almost entirely
    // INVISIBLE. `drawHead` paints `headHoodGeometry`'s shadow/main polygons
    // (opaque, `outlineDark`/`colorDark` fill) OVER this crest every frame
    // (drawHeadCrest runs first, hood second — ProceduralPlayerRig.drawHead).
    // The shared `rootY` (`head.y - 8*s`, used by every class below) sits
    // deep inside paladin's hood silhouette, which — as of the 2026-07-22
    // KKK-read fix — peaked at `head.y - 20*s`. Only the sliver of this
    // triangle ABOVE that line survived being painted over, and because the
    // shape tapers linearly to a point, that sliver was a nearly-zero-width
    // fragment of the tip: rendering the live harness rig and zooming in
    // confirmed nothing crown-like was visible at all, just a soft glow dot
    // (`tipGlow`) floating above a shapeless hood blob — exactly the "silly"
    // read, and exactly why it didn't look "biggest thing in the room" next
    // to the other three classes' fully-visible fin/hood crests. Fix: this
    // class now roots its OWN taller local point (`paladinRootY`, NOT the
    // shared `rootY`) right at the shortened hood's new peak (see
    // `headHoodGeometry`'s paladin case, also revised this session) so the
    // full triangle clears the hood and is actually on-screen, and widens
    // moderately (still well short of the rejected wide/flat original —
    // height still ~3x width at the base, an unambiguous blade, not an
    // icon-triangle). Verified side-by-side against the harness rig render
    // (this rig still can't be constructed under `bun test`, see file
    // header) before/after, and against all 3 sibling classes' current
    // in-game silhouettes at the same harness scale — not just kindled-v2.jpg
    // in isolation, per the "match the shipped 3, not just concept art" call.
    // REVISED 2026-07-28 (mobile-QA B2 finding: still "barely-visible ~2-3px
    // sliver" one day after the 07-27 pass above). Root-caused against the
    // REAL in-game scale, not the harness's own preview scale: every caller
    // that actually spawns a match player resolves scale from
    // `PLAYER_VISUAL_SCALE (0.78) * character.sizeScale` (OnlineMatchScene.ts/
    // MatchScene.ts's getVisualScale) — Kindled's "heavy" archetype
    // (sizeScale 1.18) puts real `s` at ≈0.92, NOT the harness/dev-render
    // scale (1.15, constructHarness.ts) the 07-27 fix was eyeballed against.
    // At s≈0.92 the 07-27 geometry's darkBase collapses to a ~5×11px sliver
    // (`(-2.4s..+3s) wide × (16s..25s) tall` → ~5px × ~11px) — technically
    // non-degenerate, genuinely on-screen, but far too thin to read as
    // "the biggest thing in the room" next to Interstice's wide raked fin
    // (Interstice reads not because it's tall — its own crest is only 3*s
    // tall — but because it sweeps WIDE, 24*s horizontally, clear of the
    // hood in every direction). Paladin's crest is deliberately vertical
    // (the sword-echo silhouette, not a horizontal sweep — see 07-18 note
    // above), so the only lever left is width + clearance: widened the
    // base ~60% (2.4/3.0 -> 3.8/4.6, 1.2/1.8 -> 2.0/2.6) and lifted the root
    // further clear of the hood's peak (16*s -> 19*s — was a 3*s gap above
    // the hood's `-13*s` peak, now 6*s) so the whole shape sits unambiguously
    // above the hood with real margin instead of grazing it. Tip stays at
    // 25*s (unchanged) — the nameplate-clearance ceiling from the 07-18 note
    // is still the hard constraint on how much taller this can ever get.
    const paladinRootY = head.y - 19 * s;
    const tipX = head.x;
    const tipY = head.y - 25 * s;
    return {
      darkBase: [
        { x: rootX - f * 3.8 * s, y: paladinRootY + 3 * s },
        { x: tipX, y: tipY },
        { x: rootX + f * 4.6 * s, y: paladinRootY - 1.5 * s },
      ],
      brightPlate: [
        { x: rootX - f * 2.0 * s, y: paladinRootY + 1.5 * s },
        { x: tipX, y: tipY + 2 * s },
        { x: rootX + f * 2.6 * s, y: paladinRootY - 0.8 * s },
      ],
      edgeLine: [
        { x: rootX + f * 2.6 * s, y: paladinRootY - 0.8 * s },
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
      // Kindled: a flat-topped, flared-shoulder SHIELD — tapering to a
      // single point at the chin — CENTERED (no facing skew), sat beneath
      // the crest spike above. REVISED 2026-07-22 (Jake, live feedback: "the
      // head cone ... looks like kkk"): the previous shape was a narrow-top/
      // wide-base cone that, combined with the centered blade crest above
      // it, read as a pointed hood — see feedback_no_illuminati_symbolism
      // memory for this project's hard line against accidental hate-symbol
      // silhouettes. A shield tapers the OPPOSITE way (wide at the top,
      // point at the bottom) so it can't be mistaken for a hood, while still
      // reading as "the biggest thing in the room" (chassis-design-axioms
      // CA3) via the flared shoulders. Verified side-by-side against the old
      // geometry as a rendered PNG before committing (this rig can't be
      // constructed under `bun test`, see file header).
      //
      // REVISED 2026-07-27 (Jake, live screenshot: "looks silly" vs. the
      // other 3 classes): this shape itself was never the problem, but it
      // peaked at `head.y - 20*s` — so tall it fully swallowed the crest
      // spike drawn just underneath it in z-order (see `headCrestGeometry`'s
      // paladin case for the full accounting: that crest's base sat inside
      // THIS shape and got painted over almost entirely, leaving only a
      // faint glow dot visible above a shapeless hood — the actual "silly"
      // read). Shortened the peak (-20/-18 -> -13/-11.5) to hand that
      // vertical room to the crest, which is where the concept art's height
      // statement actually lives, and widened the flare slightly (+0.5s at
      // the shoulder/top edges) so "broadest" doesn't get lost in the
      // trade — net silhouette footprint is comparable, just proportioned
      // so the crest can do its job on top of it. Taper direction (wide top
      // -> single point at chin) is UNCHANGED — that's the specific fix for
      // the KKK read and this pass doesn't touch it. Verified side-by-side,
      // rendered, against the pre-existing shape and against the other 3
      // classes' current in-game silhouettes (not just kindled-v2.jpg) at
      // the same harness scale.
      return {
        shadow: [
          { x: head.x - 7.5 * s, y: head.y - 13 * s },
          { x: head.x + 7.5 * s, y: head.y - 13 * s },
          { x: head.x + 9 * s, y: head.y - 6 * s },
          { x: head.x, y: head.y + 6 * s },
          { x: head.x - 9 * s, y: head.y - 6 * s },
        ],
        main: [
          { x: head.x - 5.8 * s, y: head.y - 11.5 * s },
          { x: head.x + 5.8 * s, y: head.y - 11.5 * s },
          { x: head.x + 7.2 * s, y: head.y - 5 * s },
          { x: head.x, y: head.y + 4 * s },
          { x: head.x - 7.2 * s, y: head.y - 5 * s },
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
