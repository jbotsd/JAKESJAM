# client/src/net — Client Netcode

Owned by Dev B (netcode + infra). Implements the client side of the Gambetta loop described in `docs/netcode-architecture.md`.

## Layout

- `transport.ts` — `Transport` interface (so the loop is testable with mocks)
- `wsTransport.ts` — Browser `WebSocket` implementation, binary frames
- `protocol.ts` — Wire shapes + MessagePack codec; mirror of `server/src/protocol.ts`
- `clientLoop.ts` — Predicts locally, sends inputs, ingests snapshots, replays unacked inputs, populates remote interpolation buffers
- `interpolationBuffer.ts` — Per-remote-entity ring buffer for "render 100ms in past" smoothing
- `matchmakerClient.ts` — Convex query wrapper that fetches the game server URL + per-player auth token
- `index.ts` — Public exports

## Wiring example (intended end-state)

```ts
import { ConvexReactClient } from "convex/react";
import {
  ClientLoop,
  WsTransport,
  fetchMatchAssignment,
  buildGameServerWsUrl,
  InputBit,
} from "../net";

const assignment = await fetchMatchAssignment(convex, matchId, playerId);
const transport = new WsTransport({ url: buildGameServerWsUrl(assignment, matchId) });
const loop = new ClientLoop({ transport, matchId, playerId, onEvents: handleEvents });

// every frame, before render:
loop.setLocalInput({
  keys: pollKeys(),
  aimX: pointer.worldX,
  aimY: pointer.worldY,
});

// in your Phaser scene update():
const state = loop.getRenderState();
if (state) renderFromState(state);
```

## Dependencies on the sim contract

Imports from `../sim/index.js` and `../sim/types.js`. Until Dev A's sim is real, `World.step` is a no-op stub, so prediction has nothing to predict — but the call shape, snapshot ingestion, replay loop, and interpolation buffers are all wired and exercised end-to-end against the placeholder.

## Package boundaries (KEEP THESE)

**This netcode crate is game-agnostic.** Future games can lift
it as-is. Allowed dependencies:

- `@sim/*` — the deterministic-sim package. Snapshots carry sim
  state; the netcode layer is the wire that shuttles it.
- `convex/browser` — generic Convex client SDK.
- `@msgpack/msgpack` — wire codec.
- DOM `WebSocket` — transport.

Forbidden in this directory:

- `phaser` / Phaser types — that's the rendering layer.
- `@/game/*` — JAKESJAM-specific scene + UI code. The netcode
  emits SimEvents and snapshot-derived states; the game decides
  what to do with them.
- JAKESJAM-specific data tables (cards, chaos modifiers, weapon
  profiles). Those live in `@sim/data` (TS) or `sim/src/data`
  (Zig) and are consumed by the SIM, not the wire.

If you need to send a piece of data over the wire that doesn't
fit a generic shape, add it to `@sim/types.ts` first (so the
sim contract carries it) and let the netcode marshal it
through.
