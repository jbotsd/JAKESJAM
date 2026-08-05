// Identity-escalation contract for bit-less fields (2026-07-31, "shooting
// projectiles as Kindled/Interstice" report).
//
// characterId/teamId have no delta bit — historically fine ("set once at
// spawn"), broken the day MatchHost.setPlayerCharacter started live-swapping
// chassis mid-session: an update patch cannot carry the change, so every
// already-connected client silently kept the old class (and its old fire
// verb). The structural fix pinned here: encodeDelta escalates an entity
// whose identity fields changed into the `added` collection (whole-entity
// copy), which applyDelta already applies as whole-entity replacement.
import { describe, test, expect } from "bun:test";
import { World } from "../../sim/World.ts";
import { resolveMap } from "../../sim/data/maps.ts";
import { encodeDelta, applyDelta } from "../snapshotDelta.ts";
import { PlayerId, type WorldState } from "../../sim/types.ts";

const PID = PlayerId("p1");

function makeState(): WorldState {
  return World.create(
    resolveMap(undefined),
    [
      {
        playerId: PID,
        characterId: "balanced",
        weaponId: "starter-pistol",
        color: "#ff0000",
        name: "P1",
      },
    ],
    1234,
    [],
  );
}

describe("encodeDelta identity escalation (bit-less characterId)", () => {
  test("mid-session characterId change rides `added` as a whole entity", () => {
    const prev = makeState();
    const player = prev.players[PID]!;
    const next: WorldState = {
      ...prev,
      tick: (prev.tick + 1) as WorldState["tick"],
      players: {
        ...prev.players,
        // The venue-station live swap: same entity key, new chassis, plus an
        // ordinary bit-carried change (x) that must NOT mask the escalation.
        [PID]: { ...player, characterId: "heavy", x: player.x + 5 },
      },
    };

    const delta = encodeDelta(prev, next);
    // Escalated: whole entity in `added`, not a bit-patch in `updated`.
    expect(delta.players.added[PID]?.characterId).toBe("heavy");
    expect(delta.players.updated[PID]).toBeUndefined();

    // Decoder round-trip: the receiving client's state adopts the swap.
    const applied = applyDelta(prev, delta);
    expect(applied.players[PID]?.characterId).toBe("heavy");
    expect(applied.players[PID]?.x).toBe(player.x + 5);
  });

  test("no identity change → normal bit-patched update path", () => {
    const prev = makeState();
    const player = prev.players[PID]!;
    const next: WorldState = {
      ...prev,
      tick: (prev.tick + 1) as WorldState["tick"],
      players: { ...prev.players, [PID]: { ...player, x: player.x + 5 } },
    };
    const delta = encodeDelta(prev, next);
    expect(delta.players.added[PID]).toBeUndefined();
    expect(delta.players.updated[PID]).toBeDefined();
    const applied = applyDelta(prev, delta);
    expect(applied.players[PID]?.x).toBe(player.x + 5);
    expect(applied.players[PID]?.characterId).toBe("balanced");
  });
});
