---
name: bun-ws-server
description: >
  Bun-native WebSocket patterns for JAKESJAM's authoritative game server
  under server/src/ (index.ts, matchHost.ts, matchRegistry.ts, auth.ts,
  protocol.ts). Use when editing the WS server, the upgrade handshake, the
  per-match tick loop, broadcast/publish, room/topic membership, backpressure
  handling, or anything involving: Bun.serve, ServerWebSocket, ws.subscribe,
  server.publish, perMessageDeflate, ws.data, upgrade, fly.toml deployment,
  match host registry, or graceful shutdown of an in-flight match.
---

# Bun WebSocket Game Server

The server is a Bun process that hosts one or more `MatchHost`s. Each `MatchHost` owns:
- A `World` (sim) ticking at `STEP_MS`.
- A set of authenticated `ServerWebSocket<MatchSocketData>` connections.
- A position-history ring buffer per player for lag compensation.

Bun's native WebSocket binding is significantly faster than the `ws` npm package on Node. Use it directly.

## The upgrade handshake

```ts
Bun.serve<MatchSocketData>({
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname !== "/match") return new Response("not found", { status: 404 });
    const auth = await verifyToken(req); // Convex-issued match ticket
    if (!auth) return new Response("unauthorized", { status: 401 });
    const ok = server.upgrade(req, {
      data: { matchId: auth.matchId, playerId: auth.playerId, authedAt: Date.now() },
    });
    return ok ? undefined : new Response("upgrade failed", { status: 500 });
  },
  websocket: {
    perMessageDeflate: false,             // see below
    maxPayloadLength: 64 * 1024,
    open(ws) { matchRegistry.attach(ws); },
    message(ws, data) { matchRegistry.route(ws, data); },
    close(ws, code, reason) { matchRegistry.detach(ws, code, reason); },
  },
});
```

Key points:
1. **Authenticate in `fetch` before `upgrade`.** Once upgraded, you can't 401 cleanly. The match ticket should be a short-lived signed token issued by a Convex action.
2. **Stash typed per-conn state in `data`.** It's typed via the `Bun.serve<T>` generic and survives across `open`/`message`/`close`.
3. **Validate `matchId` server-side.** Never trust the client's claim — the ticket binds them.

## Topics for fan-out

Bun WS supports pub/sub via topics:

```ts
// in open(ws)
ws.subscribe(`match:${ws.data.matchId}`);
// broadcast snapshot
server.publish(`match:${matchId}`, encoded);
```

`server.publish` serialises **once** and writes to all subscribers. This is what you want for snapshot broadcast. Don't loop and `ws.send` per client — you'll re-encode the same payload N times.

## perMessageDeflate: keep it OFF

For binary msgpack frames at 20–30 Hz, `perMessageDeflate` adds CPU and end-to-end latency without meaningfully reducing bandwidth — the frames are already small and mostly non-redundant. Keep it `false` for the gameplay socket. (For a chat-only socket with text payloads, `true` is fine.)

## Backpressure

`ws.send(data)` returns:
- `> 0` — bytes written.
- `0` — backpressured (kernel buffer full).
- `-1` — closed.

For snapshots, **drop on backpressure rather than queue**. An old snapshot delivered late is worse than a new snapshot. Track per-conn `pendingSnapshot: Encoded | null`; on the broadcast tick, replace pending; on a `drain` event, flush pending if still relevant (i.e. it's the latest tick).

For inputs (server → client direction is mostly snapshots; the input direction is client → server) the same applies — server should not queue old inputs received during a stall, just drop them.

## The tick loop

Use `setInterval(tick, STEP_MS)` or — preferred — a self-rescheduling `setTimeout` so the loop adapts when a tick takes longer than `STEP_MS`:

```ts
let nextTickAt = performance.now();
const loop = () => {
  const now = performance.now();
  while (nextTickAt <= now) {
    matchHost.tick();
    nextTickAt += STEP_MS;
  }
  setTimeout(loop, Math.max(0, nextTickAt - performance.now()));
};
loop();
```

Don't `await` heavy work inside `tick()`. Convex writes (e.g. recording match results) should be fired off async with the result discarded into a logger — they're not in the gameplay critical path.

## MatchHost lifecycle

- **Create** when matchmaker assigns a match to this server (either eagerly on a Convex match-created event, or lazily on first WS connect with that matchId).
- **Pause** when zero players are connected for > `EMPTY_GRACE_MS` — keep the World around briefly in case of disconnects, then dispose.
- **Dispose** on match end (`round.ts` reports a winner). Write final result via Convex mutation, then close all sockets with code `1000` and clear the registry entry.

## Horizontal scale (when you outgrow one box)

- One Fly machine handles many matches per process; many machines × many processes scale further.
- The matchmaker (Convex) records `match.hostUrl` once a host accepts a match. Clients fetch `hostUrl` from Convex, then connect there directly. The `hostUrl` is the source of truth — clients should retry by re-querying Convex on connect failure, never hard-code.
- Don't try to make matches mobile across hosts. A match lives and dies on one process; if that process dies, the match is over.

## Graceful shutdown

On SIGTERM (Fly autoscale or deploy):
1. Stop accepting new upgrades (`fetch` returns 503).
2. For each in-flight match: send a `bye{ reason: "host-restarting" }` and close after a small grace.
3. Persist final state to Convex.
4. Exit.

Fly gives you ~25 seconds. Plenty for cleanly ending live matches at this scale.

## Anti-patterns (don't do these)

- ❌ Importing the `ws` npm package. Use Bun's native API.
- ❌ `perMessageDeflate: true` on the gameplay socket.
- ❌ `JSON.stringify` for snapshots. msgpack only.
- ❌ Loop + `ws.send` per subscriber instead of `server.publish`.
- ❌ Queueing old snapshots during backpressure. Drop, don't accumulate.
- ❌ Long-running `await` inside `tick()`.
- ❌ Trusting the client's `playerId` from the WS message. Use `ws.data.playerId` set during the authed upgrade.
- ❌ Sharing one `MatchHost` across processes. One process owns it; the matchmaker decides which.

## References (KOLs / sources)

- [Bun WebSockets — official docs](https://bun.sh/docs/api/websockets)
- [Bun benchmarks — chat throughput vs Node ws](https://dev.to/sahaj-b/benchmarking-socketio-servers-4n9k)
- [Colyseus + Bun adapter (reference for room patterns)](https://www.npmjs.com/package/@colyseus/bun-websockets)
- [Glenn Fiedler — Networking for Game Programmers (foundational)](https://gafferongames.com/categories/game-networking/)
