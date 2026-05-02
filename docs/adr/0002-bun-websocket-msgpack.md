# ADR-0002: Bun WebSocket + msgpack for the gameplay socket

## Status
Accepted

## Context
JAKESJAM's authoritative multiplayer server runs game logic via the deterministic sim under `client/src/sim/`. The server needs a high-throughput transport for 60 Hz input/snapshot flows. The choice of WebSocket library, serialization format, and buffering strategy directly impacts the frame-budget and latency of the hot path.

## Decision
Use Bun's native `Bun.serve({ websocket: { ... } })` API instead of the `ws` npm package. Disable `perMessageDeflate`. Use msgpack-encoded frames with a 1-byte version prefix (`PROTOCOL_VERSION`).

Concrete configuration (per `server/src/matchHost.ts` and `server/src/protocol.ts`):

```ts
Bun.serve<MatchSocketData>({
  fetch(req, server) {
    // authenticate via Convex-issued match ticket
    const ok = server.upgrade(req, {
      data: { matchId: auth.matchId, playerId: auth.playerId, authedAt: Date.now() },
    });
  },
  websocket: {
    perMessageDeflate: false,             // binary frames are small enough
    maxPayloadLength: 64 * 1024,
    open(ws) { matchRegistry.attach(ws); },
    message(ws, data) { matchRegistry.route(ws, data); },
    close(ws, code, reason) { matchRegistry.detach(ws, code, reason); },
  },
});
```

Topics for fan-out use the `ws` API:
```ts
ws.subscribe(`match:${matchId}`);   // on join
server.publish(`match:${matchId}`, encoded);   // snapshot broadcast once, to all
```

Wire format:
- msgpack with 1-byte `PROTOCOL_VERSION` prefix (constants in `server/src/protocol.ts` / `client/src/net/protocol.ts`).
- Inputs are bitmasks (`keys: number`) — 8 bytes packed into 1 byte.
- Snapshots currently ship full `WorldState`; delta encoding is a drop-in future upgrade.

Per-game-netcode SKILL.md, Bun's native binding is ~6× faster than `ws` on raw throughput.

## Consequences
- **Native binding ~6× faster** than `ws` package. The server processes inputs without per-frame GC pressure from the heavier `ws` C++ binding.
- **Binary frames** reduce serialization overhead vs JSON. `JSON.stringify` allocates strings on every frame; msgpack is compact and GC-friendly.
- **No per-message deflate overhead**. `perMessageDeflate: true` adds CPU for small 20–30 Hz snapshots with minimal bandwidth savings.
- **One serialise, N sends** via `server.publish` avoids re-encoding the same payload per client.
- **Horizontal scale requires matchmaker hand-off**. One `MatchHost` per match per process is fine for prototype; multiple processes need Convex/Redis to coordinate `match.hostUrl` and reconnection (per `convex/matchmaker.ts`).
- **Backpressure handling**: `ws.send()` returning `-1` means drop old snapshots and send the newest. Self-replacing tick-stamped snapshots make this safe.

## Verification after change
```bash
bun run typecheck
bun run --filter server test
```
