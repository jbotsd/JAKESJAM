// Live class-swap wire regression (2026-07-31, "shooting projectiles as
// Kindled/Interstice" report).
//
// characterId is BIT-LESS in the snapshot delta encoding — an update patch
// can never carry it, so `MatchHost.setPlayerCharacter`'s hangout live-swap
// was invisible to every already-connected client (including the picker's
// own prediction, which kept firing the old chassis's verb — ranged bolts
// instead of Kindled Edge / Interstice slash).
//
// Contract pinned here, end to end through the real broadcast path: with a
// client fully in the DELTA regime (acked baselines), a class swap arrives
// on the very next delta as a whole-entity `players.added` replacement —
// encodeDelta's `identityChanged` escalation (snapshotDelta.ts). No full
// snapshot required, no mutation-site countermeasure involved.
import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { MatchHost, type MatchSocketData } from "../matchHost.ts";
import { decodeMessage } from "@net/protocol.ts";
import { PlayerId, Tick, type PlayerSpawnInfo, type WorldState } from "@sim/types.ts";

type HostInternals = {
  tick(): void;
  stop(): void;
  state: WorldState;
  lastAckedTick: Map<PlayerId, Tick>;
};

function makeRecordingWs(
  playerId: PlayerId,
  sink: Uint8Array[],
): ServerWebSocket<MatchSocketData> {
  return {
    data: { matchId: "test-hangout", playerId, authedAt: Date.now() },
    send: (payload: Uint8Array) => {
      sink.push(payload);
      return 1;
    },
    close: () => {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<MatchSocketData>;
}

function lastSnap(sink: Uint8Array[]) {
  for (let i = sink.length - 1; i >= 0; i--) {
    const decoded = decodeMessage(sink[i]!);
    if (decoded?.message.t === "snap") return decoded.message;
  }
  return null;
}

describe("hangout live class swap reaches connected clients", () => {
  test("swap rides the next DELTA as a whole-entity players.added", () => {
    const pid = PlayerId("p1");
    const spawn: PlayerSpawnInfo = {
      playerId: pid,
      characterId: "balanced",
      weaponId: "starter-pistol",
      color: "#ff0000",
      name: "P1",
    };
    const host = new MatchHost("test-hangout", [spawn], [], undefined, {
      mode: "hangout",
    });
    const internals = host as unknown as HostInternals;
    const sent: Uint8Array[] = [];
    host.attachClient(makeRecordingWs(pid, sent));
    internals.stop();

    // Enter the delta regime: tick until a snapshot goes out, ack it (the
    // real client acks every snap; the fake ws can't, so set the watermark
    // the way the ack handler would), then confirm the NEXT snap is a delta.
    for (let t = 0; t < 12; t++) internals.tick();
    const first = lastSnap(sent);
    expect(first).not.toBeNull();
    internals.lastAckedTick.set(pid, first!.tick);
    sent.length = 0;
    for (let t = 0; t < 12 && lastSnap(sent) === null; t++) internals.tick();
    const steady = lastSnap(sent);
    expect(steady).not.toBeNull();
    expect(steady!.baseline).not.toBeNull(); // genuinely delta-encoding now
    internals.lastAckedTick.set(pid, steady!.tick);
    sent.length = 0;

    // The venue-station pick: server-side live swap to Kindled.
    host.setPlayerCharacter(pid, "heavy");

    for (let t = 0; t < 12 && lastSnap(sent) === null; t++) internals.tick();
    const after = lastSnap(sent);
    expect(after).not.toBeNull();
    // Still a delta — the identity escalation makes a full snap unnecessary.
    if (after!.baseline === null) {
      throw new Error("expected delta snapshot; got full (escalation not needed?)");
    }
    // The swapped chassis arrives as a whole-entity replacement in `added`.
    expect(after!.delta.players.added[pid]?.characterId).toBe("heavy");
    expect(after!.delta.players.updated[pid]).toBeUndefined();
  });
});
