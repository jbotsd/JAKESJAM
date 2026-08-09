// venue-goal Pillar 1, acceptance 4: "No orphan ceremonies — a venue-path
// client can never receive a MATCH WINNER overlay for a cycle it wasn't
// fighting in."
//
// venue-goal's own Evidence Ledger marks this OPEN with unusually good
// discipline: "the two-host separation makes it structurally implausible…
// but there is no dedicated regression test pinning this claim — marked OPEN
// rather than PASSED on architecture alone." This is that test.
//
// There is no dedicated "results" wire message: the MATCH WINNER surface is
// driven by the ROUND STATE inside snapshots. So an orphan ceremony is
// concretely "an arena-flavoured frame reached a lobby socket", and the two
// tells are a round winner (the lobby's phase is pinned to "fighting" and
// never resolves) and the arena's bot roster (lobby and arena hold different
// players). Asserting on the frames a lobby socket actually receives is what
// makes this a regression test rather than a restatement of the design.

import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { VenueHost, VENUE_LOBBY_MATCH_ID } from "../venueHost.ts";
import { WorldHost } from "../worldHost.ts";
import type { MatchSocketData } from "../matchHost.ts";
import { decodeMessage } from "@net/protocol.ts";

type Captured = Array<Buffer | ArrayBuffer | Uint8Array | string>;

/** A lobby socket that records every frame the server pushes to it. */
function makeCapturingWs(
  playerId: string,
  name: string,
  captured: Captured,
): ServerWebSocket<MatchSocketData> {
  return {
    data: { matchId: VENUE_LOBBY_MATCH_ID, playerId, name, authedAt: Date.now() },
    send: (payload: Buffer | ArrayBuffer | Uint8Array | string) => {
      captured.push(payload);
      return 1;
    },
    close: () => {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<MatchSocketData>;
}

type AnyFrame = {
  t?: string;
  round?: { winnerPlayerId?: string | null; phase?: string };
  players?: Record<string, unknown> | Array<{ id?: string }>;
};

function decodeAll(captured: Captured): AnyFrame[] {
  const out: AnyFrame[] = [];
  for (const raw of captured) {
    if (typeof raw === "string") continue; // no string frames on this path
    const bytes =
      raw instanceof Buffer
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : raw instanceof Uint8Array
          ? raw
          : new Uint8Array(raw);
    const decoded = decodeMessage<AnyFrame>(bytes);
    // Unknown/corrupt frames are skipped rather than failing the test — the
    // claim here is about what IS delivered, not about the codec.
    if (decoded?.message) out.push(decoded.message as AnyFrame);
  }
  return out;
}

describe("venue: no orphan ceremonies (venue-goal Pillar 1.4)", () => {
  test(
    "a lobby-only client receives no arena match-winner frame across a cycle end",
    async () => {
    // Arena with bots so it has a real roster and a real cycle to finish.
    const arena = new WorldHost({ mapId: "vessel-nexus", bots: 2 });
    const venue = new VenueHost({ arena });

    const captured: Captured = [];
    venue.attachLobby(makeCapturingWs("p_lobby_only", "WATCHER", captured));

    // The lobby loop is deliberately LEFT RUNNING. Stopping it (the pattern
    // the other venue tests use) made this test capture exactly one frame —
    // a `hello` — so both assertions passed while observing no traffic at
    // all: "correctly nothing" and "nothing happened" were indistinguishable.
    // Real lobby snapshots have to be flowing for "no arena frame among
    // them" to mean anything.
    await Bun.sleep(400);

    // End the arena's cycle the same way the timer path does. This is the
    // exact moment a MATCH WINNER surface would be pushed to anyone eligible
    // for it — and a lobby-only client is not.
    (arena as unknown as { recycle(): void }).recycle();
    await Bun.sleep(400);

    const frames = decodeAll(captured);

    // The test must have observed real lobby traffic, or it proves nothing.
    const snapshots = frames.filter((f) => f.t === "snap" || f.t === "snap-raw");
    expect(snapshots.length).toBeGreaterThan(0);

    // Tell #1 — a resolved round winner. The lobby's own round phase is
    // pinned to "fighting" and never resolves, so ANY winner in a frame the
    // lobby socket received came from the arena.
    const withWinner = frames.filter(
      (f) => f.round?.winnerPlayerId !== undefined && f.round?.winnerPlayerId !== null,
    );
    expect(withWinner).toEqual([]);

    // Tell #2 — the arena's bot roster. Lobby and arena hold different
    // players, so an arena bot appearing in a lobby-bound frame is the same
    // leak seen from the other side.
    const arenaBotIds = Object.keys(arena.summary()?.scores ?? {});
    const leaked: string[] = [];
    for (const f of frames) {
      const players = f.players;
      if (!players) continue;
      const ids = Array.isArray(players)
        ? players.map((p) => p?.id).filter((id): id is string => typeof id === "string")
        : Object.keys(players);
      for (const id of ids) if (arenaBotIds.includes(id)) leaked.push(id);
    }
    expect(leaked).toEqual([]);

    venue.dispose();
    },
    15_000,
  );

  test("the lobby's own round never resolves a winner (the premise above)", () => {
    // If the lobby's phase ever DID resolve, tell #1 would start firing on
    // legitimate lobby frames and this suite would go quietly useless. Pin
    // the premise so that failure is loud instead.
    const arena = new WorldHost({ mapId: "vessel-nexus", bots: 0 });
    const venue = new VenueHost({ arena });
    const lobby = venue.lobbyHostForTest();
    type LobbyInternals = { stop(): void };
    (lobby as unknown as LobbyInternals).stop();

    const state = lobby.getStateSnapshot();
    expect(state.round.phase).toBe("fighting");
    expect(state.round.winnerPlayerId ?? null).toBeNull();

    venue.dispose();
  });
});
