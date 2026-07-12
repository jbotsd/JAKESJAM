// The Pretennoia tutorial arena — a linear, single-spawn, scripted level
// (authoring style borrowed from boxworks-practice.ts: one continuous safety-
// net floor, no round/score/multi-spawn concerns) but with real combat
// geometry (cover, engagement ranges) unlike that movement-only corridor.
// Reads as the inside of the game's Gnostic seal (see client/src/shell/
// identShader.ts) — the visual dressing (ring/arc/liquid-light motifs) is a
// RENDER-layer concern (TutorialScene's diegetic cue system), not encoded in
// these axis-aligned collision boxes.
//
// Zone map (x-ranges are level-design pacing references only — the
// AUTHORITATIVE sync source is the song's own clock via SongDirector, never
// player position; see client/src/game/systems/SongDirector.ts):
//
//   Silence (spawn + long runway)     x    20-1180
//   First Word (the one gap)          x  1180-1290  (110px, well under the
//                                                     ~135px real same-height
//                                                     jump limit)
//   The Voice Speaks (combat arena)   x  1290-2900  — Fire + dash-parry taught
//   (breather)                        x  2900-3400
//   The Response (combat arena)       x  3400-4700  — dummy returns fire
//   The Three Forms (wall-jump shaft) x  4700-5150  — ONE continuous 2-column
//                                                     shaft (proven pattern,
//                                                     see boxworks-practice.ts);
//                                                     "three forms" is a
//                                                     lighting/cue narrative
//                                                     beat layered on top by
//                                                     SongDirector at three
//                                                     points along the SAME
//                                                     climb, not three
//                                                     separate structures.
//   The Turn (overlook, cinematic)    x  5150-6100  — floating vista platform
//   The Vessel Answers (final arena)  x  6100-7500  — toughest dummy
//   Silence, again (outro plaza)      x  7500-7968
//
// Real constants used throughout (measured, not the validator's nominal
// bounds — see boxworks-practice.ts's header note on this exact trap):
// max flat-ground jump ~135px, wall-jump shaft gap must stay ≤230px
// (SHAFT_MAX), ~178px vertical gain per wall-jump kick (WALL_JUMP_UP).
//
// The First Word gap sits at the END of a long (1160px) run-up so a player
// moving forward — which the diegetic cues in "Silence" actively invite —
// is naturally at or near full run speed by the time they cross it, landing
// mid-motion right as the song's own beat-drop cue fires at 0:32. The cue
// itself never gates on the player's actual jump timing (see SongDirector's
// governing rule) — this is purely level pacing that makes the common case
// (a player who's been moving) land the moment right, not a hard guarantee.
//
// Reachability: proven via `unreachablePlatforms()` (mapGen.ts) for every
// pure-platforming zone (Silence/First Word/shaft/vista/outro), same
// validator boxworks-mini and boxworks-practice are checked against — see
// client/src/sim/__tests__/tutorialArena.test.ts. Combat arenas are NOT run
// through the PvP-oriented `validateMap()` (multi-spawn/sightline invariants
// that don't apply here), same precedent boxworks-practice.ts sets.

import type { MapDefinition, PlatformDefinition } from "../types.js";

// Same authoring convention vessel-nexus.ts (the Hot Lobby's own combat map)
// uses — reused verbatim rather than reinvented, per its own design laws:
//   Sightline law: cover pylons break floor-band snipes, spaced ≤~480px.
//   Elevation law: plates are asymmetric and hop-chained (≤STEP rise each),
//     never a stacked shelf warehouse.
// The combat zones below (The Voice Speaks / The Response / The Vessel
// Answers) were originally just flat floor + 2 chest-high pillars each —
// correct in spirit (real cover, real engagement ranges) but nowhere near
// vessel-nexus's actual rigor. Reworked with the same tiered, asymmetric
// language, scaled down for three back-to-back scripted 1v1s instead of a
// 16-player brawl.
const STEP = 108; // comfortable hop rise, well under the ~135px real jump limit
const GROUND = 952; // floor-2's standing surface (top edge)

function col(id: string, cx: number, w: number, top: number, baseY: number): PlatformDefinition {
  const h = Math.max(40, baseY - top);
  return { id, kind: "platform", position: { x: cx, y: top + h / 2 }, size: { x: w, y: h } };
}
function ledge(id: string, cx: number, w: number, top: number, h = 18): PlatformDefinition {
  return { id, kind: "platform", position: { x: cx, y: top + h / 2 }, size: { x: w, y: h } };
}

export const tutorialArena: MapDefinition = {
  id: "tutorial-arena",
  name: "Pretennoia",
  arenaTheme: "voidVessel",
  size: { x: 8000, y: 1000 },
  spawns: [{ x: 150, y: 900 }],
  platforms: [
    // Boundary.
    { id: "wall-left", kind: "wall", position: { x: 16, y: 500 }, size: { x: 32, y: 1000 } },
    { id: "wall-right", kind: "wall", position: { x: 7984, y: 500 }, size: { x: 32, y: 1000 } },
    { id: "ceiling", kind: "wall", position: { x: 4000, y: 16 }, size: { x: 8000, y: 32 } },

    // Silence — spawn sits here, long flat runway. `id: "floor"` specifically
    // — unreachablePlatforms seeds its BFS from whichever platform is
    // literally named "floor" (same convention boxworks-practice.ts uses).
    { id: "floor", kind: "floor", position: { x: 600, y: 968 }, size: { x: 1160, y: 32 } },
    // GAP: x 1180 → 1290 (110px, comfortably under the ~135px real limit).

    // floor-2: the single continuous "safety net" floor for everything from
    // the far side of First Word through the wall-jump shaft's base and the
    // whole final arena — same one-long-floor convention boxworks-practice.ts
    // uses. Cover pillars / mid-platforms for the combat zones sit on top of
    // it; the wall-jump shaft's columns also stand on it (no void beneath a
    // whiffed wall-jump — you just fall back to solid ground).
    { id: "floor-2", kind: "floor", position: { x: 4629, y: 968 }, size: { x: 6678, y: 32 } },

    // The Voice Speaks (x 1290-2900, 1610px) — first combat arena, teaching
    // Fire then dash-parry, so kept the LEAST dense of the three (a player
    // still learning the controls shouldn't also be reading a warehouse).
    // Still real: 3 sightline pylons at ~400-450px spacing (under the
    // ≤480px law), one asymmetric T1 landing.
    col("voice-cover-a", 1550, 60, GROUND - 100, GROUND),
    col("voice-cover-b", 1950, 64, GROUND - 110, GROUND),
    col("voice-cover-c", 2400, 56, GROUND - 90, GROUND),
    ledge("voice-t1", 1780, 220, GROUND - STEP),

    // The Response (x 3400-4700, 1300px) — tougher: 3 pylons, TWO asymmetric
    // T1 ledges (different widths/heights, not mirrored) plus one real T2
    // shelf above them — a genuine vertical engagement, not a flat lane
    // with furniture.
    col("response-cover-a", 3600, 56, GROUND - 95, GROUND),
    col("response-cover-b", 4000, 60, GROUND - 115, GROUND),
    col("response-cover-c", 4400, 52, GROUND - 90, GROUND),
    ledge("response-t1-l", 3520, 200, GROUND - STEP),
    ledge("response-t1-r", 4560, 170, GROUND - STEP + 12),
    ledge("response-t2", 4000, 240, GROUND - 2 * STEP),

    // The Three Forms (x 4700-5150) — one continuous wall-jump shaft, 200px
    // gap (under SHAFT_MAX=230), 820px tall (≈4-5 kicks at 178px/kick per
    // WALL_JUMP_UP) — mirrors boxworks-practice.ts's proven shaft geometry.
    { id: "shaft-left", kind: "platform", position: { x: 4750, y: 542 }, size: { x: 40, y: 820 } },
    { id: "shaft-right", kind: "platform", position: { x: 4950, y: 542 }, size: { x: 40, y: 820 } },

    // The Turn — the shaft's exit doubles as the overlook vista. Sized and
    // positioned to actually land within the wall-jump reach envelope: the
    // columns' own top sits at y=132, so a landing surface must sit within
    // reachTop=132-178=-46 .. yClimb+24=156 vertically (mapGen.ts's
    // shaftReachable) AND have its CENTER within GRAB_REACH_SIDE=200 of the
    // columns horizontally (4530..5170) — the validator (and real physics)
    // test the platform's center point, so being merely "near" the shaft
    // isn't enough if the center sits past that window. The camera's
    // cinematic pull-back sells "wide overlook" visually; this platform
    // only needs to be physically standable right at the shaft's top.
    { id: "vista", kind: "platform", position: { x: 5075, y: 110 }, size: { x: 750, y: 18 } },
    // One-way (thin platform), so after the pull-back the player can simply
    // drop through it back down to floor-2 for the final arena rather than
    // needing a separate descent path.

    // The Vessel Answers (x 6100-7500, 1400px) — the extraction, the
    // richest verticality in the whole map, matching vessel-nexus's own
    // tiered/asymmetric language at real scale: 3 pylons (sightline law),
    // TWO asymmetric T1s, a T2 shelf, a T3 perch (hop-chained from T2, not
    // stacked shelf-warehouse style), and one small twin-column "chimney"
    // centerpiece — vessel-nexus's own signature-vertical-drama move,
    // scaled down — with recoverable exits, so the toughest fight of the
    // piece actually uses the full arena height, not just its floor.
    // Narrowed all three (60→44, 64→48, 56→42) and dropped a touch shorter
    // — cover still breaks sightlines (the actual job), but a cascading
    // fight needs a real GROUND-LEVEL lane to sprint through, not a
    // dodge-three-pylons gauntlet. The eastward run toward the exit
    // (Silence, again — already open past x 7500) is the intended flee
    // route once the cascade at vessel-wave-2 outpaces clearing it.
    col("vessel-cover-a", 6300, 44, GROUND - 85, GROUND),
    col("vessel-cover-b", 6750, 48, GROUND - 100, GROUND),
    // Nudged 7200→7320: Estaphaios's thorn-crown silhouette (~300-340px
    // across, TutorialShardThrall's "estaphaios" tier) is a much bigger
    // footprint than the old humanoid boss rig this cover spacing was
    // sized for — the clear stretch it spawns into (chimney-r's end to
    // this pylon) needs real margin, not a fit-exactly gap, since combat
    // pushes it around.
    col("vessel-cover-c", 7320, 42, GROUND - 80, GROUND),
    ledge("vessel-t1-l", 6220, 220, GROUND - STEP),
    ledge("vessel-t1-r", 7380, 190, GROUND - STEP + 10),
    ledge("vessel-t2", 6900, 260, GROUND - 2 * STEP),
    ledge("vessel-t3-perch", 6900, 170, GROUND - 3 * STEP),
    // Chimney: two grab columns (SHAFT_MAX-safe 190px gap), mouth ledges at
    // T1 height feeding it, an exit cap at T3 height — a real, if small,
    // signature climb inside the fight itself.
    col("vessel-chimney-l", 6600, 32, GROUND - 3 * STEP - 20, GROUND - STEP),
    col("vessel-chimney-r", 6790, 32, GROUND - 3 * STEP - 20, GROUND - STEP),
    ledge("vessel-chimney-mouth", 6695, 90, GROUND - STEP - 6),
    ledge("vessel-chimney-cap", 6695, 150, GROUND - 3 * STEP - 26),

    // Silence, again (x 7500-7968) — outro plaza is just the tail end of
    // floor-2, deliberately bare.
  ],
};
