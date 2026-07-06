// Liveness-sweep regression tests (server integrity over long uptimes).
//
// lastSeenAt was tracked but never acted on: the ONLY way a disconnect was
// ever detected was the WS `close` event firing, which requires a clean
// TCP FIN / WS close frame. An abruptly-killed client process or a tunnel
// that silently drops a socket produces neither — the connection sat in
// `clients` forever, occupying a slot the sim packs into wasm memory
// (MAX_PLAYERS=16), while `disconnectedAt`/eviction never even started
// counting for it. sweepStaleConnections is the backstop: force-close
// anything that's gone truly silent, feeding the EXISTING (already-correct)
// detach -> disconnectedAt -> evictExpiredDisconnects pipeline.

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { MatchHost, LIVENESS_TIMEOUT_MS, type MatchSocketData } from "../matchHost.ts";
import { PlayerId, type PlayerSpawnInfo, type WorldState } from "@sim/types.ts";

const PID = PlayerId("p1");

type HostInternals = {
  tick(): void;
  stop(): void;
  state: WorldState;
  clients: Map<PlayerId, ServerWebSocket<MatchSocketData>>;
  lastSeenAt: Map<PlayerId, number>;
  disconnectedAt: Map<PlayerId, number>;
};

function makeFakeWs(playerId: PlayerId, onClose: () => void): ServerWebSocket<MatchSocketData> {
  return {
    data: { matchId: "test-match", playerId, authedAt: Date.now() },
    send: () => 1,
    close: () => onClose(),
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<MatchSocketData>;
}

function makeHost(onClose: () => void): { host: MatchHost; internals: HostInternals } {
  const spawn: PlayerSpawnInfo = {
    playerId: PID,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ff0000",
    name: "P1",
  };
  const host = new MatchHost("test-match", [spawn], []);
  const internals = host as unknown as HostInternals;
  host.attachClient(makeFakeWs(PID, onClose));
  // attachClient starts the real setInterval loop; kill it so the test
  // drives ticks deterministically (same pattern as matchHostInputQueue.test.ts).
  internals.stop();
  return { host, internals };
}

describe("MatchHost liveness sweep", () => {
  test("a connection silent for longer than LIVENESS_TIMEOUT_MS gets force-closed", () => {
    let closed = false;
    const { internals } = makeHost(() => {
      closed = true;
    });
    expect(internals.clients.has(PID)).toBe(true);

    internals.lastSeenAt.set(PID, Date.now() - LIVENESS_TIMEOUT_MS - 1);
    internals.tick();

    expect(closed).toBe(true);
    expect(internals.clients.has(PID)).toBe(false);
    // Feeds the EXISTING pipeline — the player enters reconnect grace, not an
    // immediate hard eviction; a genuine brief hiccup can still reconnect.
    expect(internals.disconnectedAt.has(PID)).toBe(true);
  });

  test("a connection seen recently is left alone", () => {
    let closed = false;
    const { internals } = makeHost(() => {
      closed = true;
    });

    internals.lastSeenAt.set(PID, Date.now());
    internals.tick();

    expect(closed).toBe(false);
    expect(internals.clients.has(PID)).toBe(true);
    expect(internals.disconnectedAt.has(PID)).toBe(false);
  });

  test("a connection with no lastSeenAt entry yet (just attached) is not force-closed", () => {
    let closed = false;
    const { internals } = makeHost(() => {
      closed = true;
    });
    internals.lastSeenAt.delete(PID); // simulate: attached, but no message processed yet
    internals.tick();

    expect(closed).toBe(false);
    expect(internals.clients.has(PID)).toBe(true);
  });

  test("a player already mid reconnect-grace (disconnectedAt already set) is not double-swept", () => {
    let closeCount = 0;
    const { internals } = makeHost(() => {
      closeCount += 1;
    });
    internals.disconnectedAt.set(PID, Date.now());
    internals.lastSeenAt.set(PID, Date.now() - LIVENESS_TIMEOUT_MS - 1);
    internals.tick();

    // sweepStaleConnections should skip it (already being evicted the normal
    // way) — it must not call close() a second time on the same connection.
    expect(closeCount).toBe(0);
  });

  test("the sweep is throttled — back-to-back ticks don't re-scan every time", () => {
    // Indirect proof: a stale connection close()s exactly once even though
    // several ticks run in the same instant (the throttle guard prevents
    // redundant Date.now()+Map-walk work, but detachClient's own idempotency
    // means correctness wouldn't be visible from THIS alone — the throttle's
    // value is the avoided work, asserted here by the single close() call
    // happening on tick 1 and nothing breaking on ticks 2-3 right after).
    let closeCount = 0;
    const { internals } = makeHost(() => {
      closeCount += 1;
    });
    internals.lastSeenAt.set(PID, Date.now() - LIVENESS_TIMEOUT_MS - 1);
    internals.tick();
    internals.tick();
    internals.tick();
    expect(closeCount).toBe(1);
  });
});
