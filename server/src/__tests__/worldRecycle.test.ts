// WorldHost recycle regression tests.
//
// The sim's round machine deliberately parks in "round-over" when a player
// reaches the target score (results UI). Room mode tears the host down;
// the always-on world previously had NO handler — the first completed
// match bricked the world in round-over forever (observed live 2026-07-03).
//
// Contracts:
//   1. Match completion → after resultsHoldMs the world rebuilds on the
//      next rotation map and migrates live sockets (fresh hello included).
//   2. Completion with zero live sockets → host torn down, lazy reboot.
//   3. Old host is disposed (no tick interval left running).

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { WorldHost } from "../worldHost.ts";
import type { MatchHost, MatchSocketData } from "../matchHost.ts";

type WorldInternals = {
  host: MatchHost | null;
  recycle(): void;
  scheduleRecycle(): void;
  sockets: Map<string, ServerWebSocket<MatchSocketData>>;
};

function fakeWs(playerId: string): ServerWebSocket<MatchSocketData> & { sent: number } {
  const ws = {
    sent: 0,
    readyState: 1,
    data: { matchId: "world", playerId, authedAt: Date.now() },
    send() { ws.sent += 1; return 1; },
    close() { (ws as { readyState: number }).readyState = 3; },
    getBufferedAmount: () => 0,
  };
  return ws as unknown as ServerWebSocket<MatchSocketData> & { sent: number };
}

const hostInternals = (h: MatchHost) =>
  h as unknown as { interval: unknown; stop(): void };

describe("WorldHost recycle", () => {
  test("migrates live sockets into a fresh host on a new map", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", rotateMaps: true, resultsHoldMs: 1 });
    const wi = wh as unknown as WorldInternals;
    const a = fakeWs("pA");
    const b = fakeWs("pB");
    wh.attach(a);
    wh.attach(b);
    const oldHost = wi.host!;
    hostInternals(oldHost).stop(); // deterministic ticks not needed here
    const oldMap = wh.summary()!.mapId;
    const sentBefore = a.sent;

    wi.recycle();

    const newHost = wi.host!;
    expect(newHost).not.toBe(oldHost);
    // Rotation advanced to the next map.
    expect(wh.summary()!.mapId).not.toBe(oldMap);
    // Both players are in the new match and got a fresh hello.
    expect(newHost.hasPlayer("pA" as never)).toBe(true);
    expect(newHost.hasPlayer("pB" as never)).toBe(true);
    expect(a.sent).toBeGreaterThan(sentBefore);
    // Old host fully disposed — no tick interval left.
    expect(hostInternals(oldHost).interval).toBeNull();
    hostInternals(newHost).stop();
  });

  test("zero live sockets → lazy reboot (host null until next attach)", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 1 });
    const wi = wh as unknown as WorldInternals;
    const a = fakeWs("pA");
    wh.attach(a);
    hostInternals(wi.host!).stop();
    wh.detach(a); // player leaves before the recycle fires

    wi.recycle();
    expect(wi.host).toBeNull();

    // Next attach boots a fresh world.
    const b = fakeWs("pB");
    wh.attach(b);
    expect(wi.host).not.toBeNull();
    expect(wi.host!.hasPlayer("pB" as never)).toBe(true);
    hostInternals(wi.host!).stop();
  });

  test("scheduleRecycle debounces to a single timer", async () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 5 });
    const wi = wh as unknown as WorldInternals;
    const a = fakeWs("pA");
    wh.attach(a);
    hostInternals(wi.host!).stop();
    const oldHost = wi.host!;
    wi.scheduleRecycle();
    wi.scheduleRecycle();
    wi.scheduleRecycle();
    await new Promise((r) => setTimeout(r, 30));
    expect(wi.host).not.toBe(oldHost);
    if (wi.host) hostInternals(wi.host).stop();
  });
});
