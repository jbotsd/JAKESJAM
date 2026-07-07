// Reachability proof for boxworks-practice.ts (docs/practice-zone-goal.md).
//
// Proven two ways, honestly, not silently assumed:
//   1. `unreachablePlatforms()` — the same route-graph validator
//      boxworks-mini is checked against (mapGen.test.ts) — for the
//      plain-jump warm-up, the wall-jump shaft, and the walkway. This is
//      NOT run through the full `validateMap()`: that also enforces
//      PvP-only invariants (multi-spawn count, sightline caps, route-up
//      minimums) that make no sense for a single-spawn linear corridor.
//   2. A scripted stepPlayer run for the dash gap specifically, because
//      the route-graph BFS has NO dash edge modeled at all — only
//      plain-jump and wall-jump-shaft edges (confirmed by reading
//      mapGen.ts). `dash-landing` is therefore EXPECTED to show up in
//      `unreachablePlatforms`'s output — the test below asserts the
//      unreachable set is EXACTLY `["dash-landing"]`, not empty, so a
//      real accidental-unreachability regression elsewhere still fails
//      loudly instead of being masked by "oh, that's just the dash gap."

import { describe, expect, test } from "bun:test";
import { unreachablePlatforms } from "../data/mapGen.js";
import { boxworksPractice } from "../data/boxworks-practice.js";
import { buildStaticCache } from "../collision.js";
import { stepPlayer, freshPlayerMovementMemory } from "../player.js";
import { PlayerId, type PlayerEntity, type InputSeq } from "../types.js";

const STEP = 1000 / 60;
const Bit = { Left: 1 << 0, Right: 1 << 1, Jump: 1 << 4, Dash: 1 << 9 };

describe("boxworks-practice reachability", () => {
  test("only the dash gap is unreachable by the plain-jump/wall-jump route graph", () => {
    expect(unreachablePlatforms(boxworksPractice)).toEqual(["dash-landing"]);
  });

  test("the dash gap IS crossable with a run-up + dash (scripted stepPlayer)", () => {
    const cache = buildStaticCache(
      boxworksPractice.platforms,
      boxworksPractice.size.x,
      boxworksPractice.size.y,
    );
    const opts = { collisionCache: cache, dashCharges: 1 };

    let player: PlayerEntity = {
      id: PlayerId("t"),
      characterId: "balanced",
      // Start well back on the walkway (top y=218) for a real run-up,
      // same height as the walkway/dash-landing platforms.
      x: 1150,
      y: 190,
      vx: 0,
      vy: 0,
      aimX: 1400,
      aimY: 190,
      health: 100,
      shieldActive: false,
      crouching: false,
      alive: true,
      weaponId: "starter-pistol",
      cards: [],
      fireCooldownMs: 0,
      ammo: 24,
      abilityCharge: 0,
      lastProcessedInputSeq: 0 as InputSeq,
    };
    let mem = freshPlayerMovementMemory();

    // Run to the walkway's edge (x=1600) BEFORE dashing — a real player
    // dashes right at the ledge, not mid-runway. Capped iteration count
    // guards against an infinite loop if the run-up math is ever wrong.
    let prevKeys = 0;
    for (let i = 0; i < 200 && player.x < 1580; i++) {
      const r = stepPlayer(player, prevKeys, Bit.Right, 2000, player.y, mem, boxworksPractice.platforms, STEP, opts);
      player = r.player;
      mem = r.memory;
      prevKeys = Bit.Right;
    }
    expect(player.x).toBeGreaterThanOrEqual(1580); // sanity: run-up actually reached the edge

    // Dash right at the edge, then keep holding right through the burst and
    // beyond (1 second — plenty for the ~150ms burst plus normal run speed).
    let r = stepPlayer(player, prevKeys, Bit.Right | Bit.Dash, 2000, player.y, mem, boxworksPractice.platforms, STEP, opts);
    player = r.player;
    mem = r.memory;
    for (let i = 0; i < 60; i++) {
      r = stepPlayer(player, Bit.Right, Bit.Right, 2000, player.y, mem, boxworksPractice.platforms, STEP, opts);
      player = r.player;
      mem = r.memory;
    }

    // dash-landing spans x 1940-2340. Clearing its near edge with margin
    // proves the gap (walkway ends 1600, dash-landing starts 1940) is
    // genuinely crossable under real physics, not just in theory.
    expect(player.x).toBeGreaterThan(1940);
  });
});
