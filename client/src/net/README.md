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
