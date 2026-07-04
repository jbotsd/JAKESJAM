// Spawn assignment contract (World.assignSpawnPoints).
//
// Replaces the old `spawns[index % length]` which stacked players on
// identical coordinates once players outnumbered spawn points, and gave a
// spawn-camper a fixed target every round. The assigner must be:
//   - deterministic + order-independent (parity: client == server),
//   - stacking-free while enough distinct points exist,
//   - max-spread (each player as far as possible from those already placed).

import { describe, expect, test } from "bun:test";
import { assignSpawnPoints } from "../World.js";
import { resolveMap } from "../data/maps.js";

const ids8 = ["p3", "p1", "bot_spark", "p2", "bot_piston", "p5", "p4", "p6"];

describe("assignSpawnPoints", () => {
  test("order-independent + deterministic (parity-safe)", () => {
    const map = resolveMap("boxworks-mini");
    const a = assignSpawnPoints(map, ids8);
    const b = assignSpawnPoints(map, [...ids8].reverse());
    for (const id of ids8) {
      expect(a.get(id)).toEqual(b.get(id)); // same result regardless of input order
    }
  });

  test("no stacking when distinct points >= players", () => {
    const map = resolveMap("boxworks-mini"); // 8 spawns
    const ids = ["a", "b", "c", "d", "e", "f"]; // 6 players
    const assigned = [...assignSpawnPoints(map, ids).values()];
    const keys = new Set(assigned.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(ids.length); // all distinct
  });

  test("first two players open far apart (max-spread)", () => {
    const map = resolveMap("boxworks-mini");
    const assigned = assignSpawnPoints(map, ["a", "b"]);
    const pts = [...assigned.values()];
    // With opposite-corner spawns present, a 2-player round should open
    // most of the arena apart.
    expect(Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)).toBeGreaterThan(
      map.size.x * 0.6,
    );
  });

  test("degrades gracefully when players outnumber spawns", () => {
    const map = resolveMap("boxworks-mini"); // 8 spawns
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const assigned = assignSpawnPoints(map, ids);
    expect(assigned.size).toBe(12); // everyone gets a point, no crash
  });
});
