// noteVisible() — the mobile resume watchdog. iOS Safari kills background
// WebSockets without firing onclose, so on resume the transport still
// claims "open" while nothing will ever arrive. The watchdog must force a
// local close (non-terminal reason → supervisor reconnects) exactly when
// the socket is open-but-silent, and never when traffic is fresh.

import { describe, expect, test } from "bun:test";
import { ClientLoop } from "../clientLoop";
import type { Transport, TransportState } from "../transport";

function makeTransport(state: TransportState): Transport & { closedWith: string[] } {
  const closedWith: string[] = [];
  return {
    state,
    closedWith,
    send: () => {},
    onOpen: () => {},
    onMessage: () => {},
    onClose: () => {},
    close: (reason?: string) => {
      closedWith.push(reason ?? "");
    },
  } as Transport & { closedWith: string[] };
}

function makeLoop(transport: Transport) {
  return new ClientLoop({
    transport,
    matchId: "m1",
    playerId: "p1",
  });
}

describe("ClientLoop.noteVisible (resume watchdog)", () => {
  test("open + never-heard-from socket forces a stale-on-resume close", () => {
    const t = makeTransport("open");
    const loop = makeLoop(t);
    loop.noteVisible(10_000);
    expect(t.closedWith).toEqual(["stale-on-resume"]);
  });

  test("does nothing when the socket is already closed (supervisor owns it)", () => {
    const t = makeTransport("closed");
    const loop = makeLoop(t);
    loop.noteVisible(10_000);
    expect(t.closedWith).toEqual([]);
  });

  test("does nothing when traffic is fresh", () => {
    const t = makeTransport("open");
    const loop = makeLoop(t);
    // Simulate a recently-received message via the private field the
    // handler sets — decode path needs a real protocol frame, so poke the
    // timestamp directly (what handleMessage's first line does).
    (loop as unknown as { lastMessageAtMs: number }).lastMessageAtMs = 9_000;
    loop.noteVisible(10_000);
    expect(t.closedWith).toEqual([]);
  });

  test("fires when the last message is older than the stale threshold", () => {
    const t = makeTransport("open");
    const loop = makeLoop(t);
    (loop as unknown as { lastMessageAtMs: number }).lastMessageAtMs = 1_000;
    loop.noteVisible(10_000);
    expect(t.closedWith).toEqual(["stale-on-resume"]);
  });
});
