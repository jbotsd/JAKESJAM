// Badge honesty (venue-goal.md Pillar 0.1): summary() reports humans and
// bots as SEPARATE counts. The splash badge is the funnel's one liveness
// signal — before this split, an empty server with 2 bots advertised
// "2 players · Live", counting bots as people exactly where a prospective
// player decides whether the game is alive.

import { describe, test, expect } from "bun:test";
import { MatchHost } from "../matchHost.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";

function spawn(id: string, name: string): PlayerSpawnInfo {
  return {
    playerId: PlayerId(id),
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ff0000",
    name,
  };
}

type Stoppable = { stop(): void };

describe("MatchHost.summary() population honesty", () => {
  test("2 bots + 1 human → humans:1 bots:2, and no blended players field", () => {
    const host = new MatchHost(
      "test-summary",
      [spawn("human_1", "JAKE"), spawn("bot_spark", "SPARK"), spawn("bot_piston", "PISTON")],
      [],
    );
    (host as unknown as Stoppable).stop();
    const s = host.summary();
    expect(s.humans).toBe(1);
    expect(s.bots).toBe(2);
    // The old combined count must not silently survive the rename — a
    // consumer still reading `players` would render undefined, not a lie.
    expect("players" in s).toBe(false);
  });

  test("bots-only world (empty-server reality) → humans:0", () => {
    const host = new MatchHost(
      "test-summary-bots",
      [spawn("bot_spark", "SPARK"), spawn("bot_piston", "PISTON")],
      [],
    );
    (host as unknown as Stoppable).stop();
    const s = host.summary();
    expect(s.humans).toBe(0);
    expect(s.bots).toBe(2);
  });

  test("humans-only match (private room) → bots:0", () => {
    const host = new MatchHost("test-summary-humans", [spawn("p1", "A"), spawn("p2", "B")], []);
    (host as unknown as Stoppable).stop();
    const s = host.summary();
    expect(s.humans).toBe(2);
    expect(s.bots).toBe(0);
  });
});
