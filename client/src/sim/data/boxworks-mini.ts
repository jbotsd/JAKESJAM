// Boxworks-mini — tight 1v1 brawl arena.
//
// Single 1280×640 cell. Two ground spawns at opposite walls, one floating
// mid-platform that splits the airspace. No destructibles. No pickups
// (we're rogue-lite — cards drafted between rounds, not collected).
//
// Design intent: every shot is a real engagement; no running away. ~5s
// to traverse end-to-end at base speed.

import type { MapDefinition } from "../types.js";

export const boxworksMini: MapDefinition = {
  id: "boxworks-mini",
  name: "Dock Cell",
  arenaTheme: "crystalDock",
  size: { x: 1280, y: 640 },
  // 8 spawn points spread across all three tiers and the full width, so the
  // deterministic max-spread assigner (World.assignSpawnPoints) can seat a
  // full lobby without stacking and vary each round's opening positions.
  // Every point sits on solid ground within a jump-fall (map-validated).
  spawns: [
    // Floor — four across, opposite corners first.
    { x: 160, y: 540 },
    { x: 1120, y: 540 },
    { x: 470, y: 540 },
    { x: 810, y: 540 },
    // Side ledges (top 479).
    { x: 220, y: 420 },
    { x: 1060, y: 420 },
    // Mid platform ends (top 351).
    { x: 540, y: 292 },
    { x: 740, y: 292 },
  ],
  platforms: [
    // Floor.
    { id: "floor", kind: "floor", position: { x: 640, y: 624 }, size: { x: 1280, y: 32 } },
    // Walls.
    { id: "wall-left", kind: "wall", position: { x: 16, y: 320 }, size: { x: 32, y: 640 } },
    { id: "wall-right", kind: "wall", position: { x: 1264, y: 320 }, size: { x: 32, y: 640 } },
    // Ceiling cap so jetpacks don't escape.
    { id: "ceiling", kind: "wall", position: { x: 640, y: 16 }, size: { x: 1280, y: 32 } },
    // Single floating mid-platform — splits airspace, drop-through enabled
    // because all 'platform' kinds are one-way (per boxworks.ts contract).
    // y=362 (top 351): ledge(479)→mid rise = 128px ≤ the 129px step law.
    // At y=360 the rise was 130 — one pixel over, caught by the map
    // validator (mapGen.test.ts curated audit).
    { id: "mid", kind: "platform", position: { x: 640, y: 362 }, size: { x: 380, y: 22 } },
    // Two side ledges at brawl height — give crouchers an angle.
    // y=488 (top 479): floor→ledge rise is 129px = 93% of the 139px max
    // jump. At the previous y=460 the rise was 157px — mathematically
    // UNREACHABLE by jumping (max jump 2.48 body-heights), so the
    // intended floor→ledge→mid flow silently required jetpack fuel.
    // See docs/game-feel-tuning.md (finding T1).
    { id: "ledge-left", kind: "platform", position: { x: 220, y: 488 }, size: { x: 220, y: 18 } },
    { id: "ledge-right", kind: "platform", position: { x: 1060, y: 488 }, size: { x: 220, y: 18 } },
    // Cover pillars to break the 418px sightline gap between the mid-platform
    // edges and the walls (arena-map-design: max ~320px unbroken sightline).
    // Placed at mid-height so they provide cover while not blocking vertical flow.
    { id: "cover-left", kind: "platform", position: { x: 280, y: 360 }, size: { x: 72, y: 80 } },
    { id: "cover-right", kind: "platform", position: { x: 1000, y: 360 }, size: { x: 72, y: 80 } },
  ],
};
