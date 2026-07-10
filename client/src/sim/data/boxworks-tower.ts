// Boxworks-tower — vertical jetpack-focused FFA arena.
//
// 1440×1080 — taller than wide. 6 spawn points spread across 3 vertical
// tiers. Many drop-through platforms reward jetpack management. No
// horizontal sniping lanes longer than ~600px.
//
// Design intent: chaotic vertical engagements; jetpack fuel is the
// scarce resource. Boss-mode + slow-motion chaos modifiers make this
// map sing.

import type { MapDefinition } from "../types.js";

export const boxworksTower: MapDefinition = {
  id: "boxworks-tower",
  name: "Spire Dock",
  arenaTheme: "autogenesHull",
  size: { x: 1440, y: 1080 },
  // 16 spawn points — vertical tiers keep pairs ≥300px apart.
  spawns: [
    // Ground
    { x: 160, y: 1000 },
    { x: 400, y: 1000 },
    { x: 720, y: 1000 },
    { x: 1040, y: 1000 },
    { x: 1280, y: 1000 },
    // Mid
    { x: 280, y: 690 },
    { x: 560, y: 690 },
    { x: 880, y: 690 },
    { x: 1160, y: 690 },
    // Upper mid
    { x: 400, y: 480 },
    { x: 720, y: 480 },
    { x: 1040, y: 480 },
    // High + crow
    { x: 220, y: 320 },
    { x: 1220, y: 320 },
    { x: 560, y: 200 },
    { x: 880, y: 200 },
  ],
  platforms: [
    // Floor.
    { id: "floor", kind: "floor", position: { x: 720, y: 1064 }, size: { x: 1440, y: 32 } },
    // Walls.
    { id: "wall-left", kind: "wall", position: { x: 16, y: 540 }, size: { x: 32, y: 1080 } },
    { id: "wall-right", kind: "wall", position: { x: 1424, y: 540 }, size: { x: 32, y: 1080 } },
    // Ceiling cap.
    { id: "ceiling", kind: "wall", position: { x: 720, y: 16 }, size: { x: 1440, y: 32 } },

    // ── Mid tier: two side platforms + one center bridge ─────────────
    { id: "mid-left", kind: "platform", position: { x: 320, y: 760 }, size: { x: 320, y: 22 } },
    { id: "mid-right", kind: "platform", position: { x: 1120, y: 760 }, size: { x: 320, y: 22 } },
    { id: "mid-bridge", kind: "platform", position: { x: 720, y: 620 }, size: { x: 280, y: 22 } },
    // Cover columns to break the 480px mid-tier sightline gap between the
    // mid-left/mid-right platforms (arena-map-design: max ~320px unbroken).
    { id: "mid-cover-left",  kind: "platform", position: { x: 560, y: 760 }, size: { x: 60, y: 90 } },
    { id: "mid-cover-right", kind: "platform", position: { x: 880, y: 760 }, size: { x: 60, y: 90 } },

    // ── High tier: stepped towers + crow's nest at top ───────────────
    { id: "high-left", kind: "platform", position: { x: 240, y: 460 }, size: { x: 260, y: 22 } },
    { id: "high-right", kind: "platform", position: { x: 1200, y: 460 }, size: { x: 260, y: 22 } },
    { id: "crow-nest", kind: "platform", position: { x: 720, y: 280 }, size: { x: 220, y: 22 } },

    // ── Ground tier: small cover stubs so spawn isn't exposed ────────
    { id: "ground-cover-left", kind: "platform", position: { x: 380, y: 940 }, size: { x: 160, y: 18 } },
    { id: "ground-cover-right", kind: "platform", position: { x: 1060, y: 940 }, size: { x: 160, y: 18 } },
  ],
};
