// venue-goal.md Pillar 0.5 (audit seam #16) — reconnect must be REAL.
//
// The supervisor + backoff + transport-rebuild machinery existed and was
// fully tested in isolation, but OnlineMatchScene never passed a
// reconnectUrl, so the supervisor was constructed disabled: every WS drop
// abandoned instantly while the overlay promised "Trying to reconnect…".
// These tests pin the ClientLoop-level contract the scene now relies on:
// with a reconnectUrl, a non-terminal close schedules a retry (and says
// so); terminal closes and disabled loops abandon to onConnectionLost.

import { describe, expect, test } from "bun:test";
import { ClientLoop } from "../clientLoop";
import type { Transport, TransportState } from "../transport";

type MockTransport = Transport & {
  fireClose: (reason: string) => void;
  closedWith: string[];
};

function makeTransport(): MockTransport {
  let closeHandler: ((reason: string) => void) | null = null;
  const closedWith: string[] = [];
  const t = {
    state: "open" as TransportState,
    send: () => {},
    onOpen: () => {},
    onMessage: () => {},
    onClose: (h: (reason: string) => void) => {
      closeHandler = h;
    },
    close: (reason?: string) => {
      closedWith.push(reason ?? "");
    },
    closedWith,
    fireClose: (reason: string) => closeHandler?.(reason),
  };
  return t as unknown as MockTransport;
}

function makeLoop(
  transport: Transport,
  opts: { reconnectUrl?: string } = {},
): { loop: ClientLoop; lost: string[]; attempts: Array<{ n: number; delayMs: number }> } {
  const lost: string[] = [];
  const attempts: Array<{ n: number; delayMs: number }> = [];
  const loop = new ClientLoop({
    transport,
    matchId: "world",
    playerId: "p1",
    reconnectUrl: opts.reconnectUrl,
    onConnectionLost: (reason) => lost.push(reason),
    onReconnectAttempt: (n, delayMs) => attempts.push({ n, delayMs }),
  });
  return { loop, lost, attempts };
}

describe("ClientLoop reconnect wiring (Pillar 0.5)", () => {
  test("with reconnectUrl: a non-terminal close schedules attempt 1, does NOT abandon", () => {
    const t = makeTransport();
    const { loop, lost, attempts } = makeLoop(t, { reconnectUrl: "ws://localhost:1/ws/world" });
    t.fireClose("transport-error");
    expect(attempts).toEqual([{ n: 1, delayMs: 500 }]);
    expect(lost).toEqual([]);
    loop.stop(); // cancels the scheduled attempt so the test exits clean
  });

  test("with reconnectUrl: a terminal close ('replaced') abandons immediately, no retry", () => {
    const t = makeTransport();
    const { loop, lost, attempts } = makeLoop(t, { reconnectUrl: "ws://localhost:1/ws/world" });
    t.fireClose("replaced");
    expect(lost).toEqual(["replaced"]);
    expect(attempts).toEqual([]);
    loop.stop();
  });

  test("without reconnectUrl: every close abandons (the explicit opt-out path)", () => {
    const t = makeTransport();
    const { loop, lost, attempts } = makeLoop(t);
    t.fireClose("transport-error");
    expect(lost).toEqual(["transport-error"]);
    expect(attempts).toEqual([]);
    loop.stop();
  });
});

describe("ClientLoop.disconnect — leave means leave (Pillar 0.6)", () => {
  test("closes the transport with the leave reason", () => {
    const t = makeTransport();
    const { loop } = makeLoop(t, { reconnectUrl: "ws://localhost:1/ws/world" });
    loop.disconnect("client-leave");
    expect(t.closedWith).toEqual(["client-leave"]);
  });

  test("the socket's own close event after disconnect neither retries nor reports a lost connection", () => {
    const t = makeTransport();
    const { loop, lost, attempts } = makeLoop(t, { reconnectUrl: "ws://localhost:1/ws/world" });
    loop.disconnect();
    // The real WS close event lands asynchronously after close() — it must
    // not resurrect the connection (supervisor disposed) and must not show
    // "connection lost" UI (leaving is not a failure).
    t.fireClose("client-leave");
    expect(attempts).toEqual([]);
    expect(lost).toEqual([]);
  });

  test("stop() alone still never touches the socket (tab blur/focus safety)", () => {
    const t = makeTransport();
    const { loop } = makeLoop(t, { reconnectUrl: "ws://localhost:1/ws/world" });
    loop.stop();
    expect(t.closedWith).toEqual([]);
  });
});
