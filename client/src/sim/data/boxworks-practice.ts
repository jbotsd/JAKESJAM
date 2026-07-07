// Boxworks-practice — a linear no-enemy movement-teaching corridor, not a
// symmetric PvP arena. Single spawn; walk left-to-right through four
// sections, each teaching one traversal mechanic in sequence, then a
// continuous base floor carries you straight back to the start (no menu,
// no reload — just run left and go again):
//
//   1. Warm-up: one flat, forgiving gap. Proves input works, costs nothing.
//   2. Wall-jump shaft: two facing grab-walls (SHAFT_MAX-gap apart), tall
//      enough to need several kicks to top out.
//   3. Dash gap: deliberately WIDER than the reachability model's own
//      flat-jump allowance (MAX_GAP_FALLING) — see docs/practice-zone-goal.md
//      and the note on `unreachablePlatforms` below. Only crossable with a
//      dash on top of a run-up.
//   4. Landing/wobble showcase: the course simply ends in open air — the
//      long fall back to the safety-net floor below is the payoff moment
//      for the rig's landing-impact secondary motion, and doubles as a
//      forgiving "you don't have to redo the whole course" safety net if
//      the dash was missed.
//
// Reachability is proven two ways, honestly, not silently assumed:
//   - `unreachablePlatforms()` (client/src/sim/data/mapGen.ts) for sections
//     1/2/4, the same route-graph validator `boxworks-mini` is checked
//     against (see client/src/sim/__tests__/boxworksPractice.test.ts).
//   - The dash gap is EXPECTED to fail that check — the BFS has no dash
//     edge modeled at all, only plain-jump and wall-jump-shaft edges. That
//     test asserts the unreachable set is EXACTLY `["dash-landing"]` (not
//     empty) and separately proves the dash gap clears via a scripted
//     stepPlayer run, the same pattern client/src/sim/__tests__/
//     playerAugments.test.ts uses for card-gated movement.
//
// IMPORTANT gotcha discovered while authoring this map, worth recording so
// it isn't rediscovered the hard way: `unreachablePlatforms`'s flat/level
// branch (rise <= 0) admits any gap <= MAX_GAP_FALLING (300px) — a budget
// that's correct for falling onto a platform genuinely BELOW the takeoff
// (long hang time available) but is NOT a validated bound for a same-height
// flat gap, where the arc must rise AND return to the identical height
// within one run-speed jump. A scripted stepPlayer measurement (full run
// speed, jump timed at the exact edge) found the real same-height max is
// only ~135px, not 300px — the validator will happily pass a 200px flat gap
// that real physics cannot actually cross. That's a latent blind spot in
// the shared validator (out of scope to change here — other callers rely on
// its current behavior); the fix on this side is simply to never trust
// MAX_GAP_FALLING for a flat gap and to keep this one comfortably under the
// measured real limit.
//
// NOT run through the full `validateMap()` — that also enforces PvP-only
// invariants (multi-spawn count, sightline caps, route-up minimums) that
// make no sense for a single-spawn linear teaching corridor.

import type { MapDefinition } from "../types.js";

export const boxworksPractice: MapDefinition = {
  id: "boxworks-practice",
  name: "Boxworks Practice",
  arenaTheme: "hangingWood",
  size: { x: 2600, y: 900 },
  spawns: [{ x: 150, y: 800 }],
  platforms: [
    // Boundary.
    { id: "wall-left", kind: "wall", position: { x: 16, y: 450 }, size: { x: 32, y: 900 } },
    { id: "wall-right", kind: "wall", position: { x: 2584, y: 450 }, size: { x: 32, y: 900 } },
    { id: "ceiling", kind: "wall", position: { x: 1300, y: 16 }, size: { x: 2600, y: 32 } },

    // 1. Warm-up: floor (spawn sits here) → a 100px flat gap → floor resumes.
    // Comfortably under the ~135px real same-height jump limit measured via
    // scripted stepPlayer (see the file header note) — genuinely forgiving,
    // not just nominally-passing-a-validator forgiving.
    // `id: "floor"` specifically — unreachablePlatforms seeds its BFS from
    // whichever platform is literally named "floor".
    { id: "floor", kind: "floor", position: { x: 280, y: 884 }, size: { x: 560, y: 32 } },
    // gap: x 560 → 660
    // floor-2 also serves as the shaft's base AND the safety-net/return
    // floor for the entire rest of the course.
    { id: "floor-2", kind: "floor", position: { x: 1630, y: 884 }, size: { x: 1940, y: 32 } },

    // 2. Wall-jump shaft. Two solid columns (kind 'platform' but taller than
    // ONE_WAY_MAX_HEIGHT_PX=24, so solid 4-way per collision.ts — the same
    // "tall platform = grabbable wall" convention mapGen.ts's procedural
    // generator uses) standing on floor-2, gap 170px (comfortably under
    // SHAFT_MAX=230), tall enough (650px, top at y=218) to need several
    // wall-jump kicks (WALL_JUMP_UP=178 per kick) to top out.
    { id: "shaft-left", kind: "platform", position: { x: 1080, y: 543 }, size: { x: 40, y: 650 } },
    { id: "shaft-right", kind: "platform", position: { x: 1250, y: 543 }, size: { x: 40, y: 650 } },
    // Walkway bridging the shaft tops onward toward the dash section. One-way
    // (18px thick), flush with both columns' tops (y top = 218) for a
    // continuous walking surface once the shaft is climbed.
    { id: "shaft-walkway", kind: "platform", position: { x: 1350, y: 227 }, size: { x: 500, y: 18 } },

    // 3. Dash gap. Walkway ends at x=1600; dash-landing starts at x=1940 —
    // a 340px gap, deliberately past MAX_GAP_FALLING(300) so a plain jump
    // cannot cross it (see the file header note on unreachablePlatforms).
    { id: "dash-landing", kind: "platform", position: { x: 2140, y: 227 }, size: { x: 400, y: 18 } },

    // 4. Landing/wobble showcase: nothing past x=2340 at this height — the
    // course just ends. The fall back to floor-2 (634px) is the payoff.
  ],
};
