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
  name: "Boxworks Mini",
  arenaTheme: "ivoryClouds",
  size: { x: 1280, y: 640 },
  spawns: [
    { x: 160, y: 540 },
    { x: 1120, y: 540 },
    { x: 320, y: 320 },
    { x: 960, y: 320 },
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
    { id: "mid", kind: "platform", position: { x: 640, y: 360 }, size: { x: 380, y: 22 } },
    // Two side ledges at brawl height — give crouchers an angle.
    { id: "ledge-left", kind: "platform", position: { x: 220, y: 460 }, size: { x: 220, y: 18 } },
    { id: "ledge-right", kind: "platform", position: { x: 1060, y: 460 }, size: { x: 220, y: 18 } },
  ],
};
