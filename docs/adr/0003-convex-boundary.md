# ADR-0003: Convex is lobby/match metadata only (not 60 Hz path)

## Status
Accepted

## Context
Convex is the backend for JAKESJAM's lobby, room creation, and match metadata storage. It also acts as the registry for which Fly game server URL owns which match after the matchmaker picks a server. The 60 Hz simulation hot path (inputs, snapshots, lag compensation) also needs a backend — should that flow through Convex, or be direct?

Per `AGENTS.md` "Multiplayer Boundary" and `game-netcode` SKILL.md "Anti-patterns: Treating Convex as a snapshot bus", Convex must be **lobby/match metadata only**. The 60 Hz path goes through WebSocket directly to the Bun process hosting the match.

## Decision
Use Convex for:
- `rooms` table (lobby codes, `status`, `hostPlayerId`)
- `roomPlayers` table (ready toggles, colors, names)
- `matches` table (roomId, mapId, `gameServerUrl`, region)
- `matchResults` table (winner, scores, round count)
- `chatMessages` table (lobby chat)

Use **direct WebSocket** for:
- 60 Hz input frames from player to server (e.g., `keys` bitmask, `tick`, `aimX`, `aimY` per `client/src/net/clientLoop.ts`)
- 60 Hz snapshot broadcasts from server to player (msgpack `Snapshot` messages)
- Lag compensation, snapshot interpolation, and entity rewind

Per `bun-ws-server` SKILL.md, one `MatchHost` per match per process owns the `World` and its own set of connected `ServerWebSocket` instances. The `MatchHost` is attached to a `ws.subscribe(matchId)` topic, and snapshots are broadcast via `server.publish(matchId, encoded)` — never routed through Convex.

## Consequences
- **Clean separation**: Convex handles "slow" state (lobby setup, ready state, match setup, drafting offers, match end result write). WebSocket handles "fast" state (60 Hz loop, prediction reconciliation).
- **Convex pricing fits lobby-cadence load**. Reads/mutations happen on round creation, ready toggle, chat, and match-end — not every frame.
- **Rebuilds aren't gated by Convex deploy**. You can rotate the WebSocket server (e.g. for a bug fix) without re-initializing the lobby or forcing clients to re-query Convex mid-match.
- **Matchmaker URL assignment** goes through `convex/matchmaker.ts`'s `GAME_REGIONS` constant and `pickGameServerUrl()` function, which writes `gameServerUrl` to the match doc. The client then connects directly to `wss://jakesjam-srv-{region}.fly.dev/ws/match` with a Convex-minted HMAC token.
- **Idempotent match-result writes**: The server posts the final score to Convex once via an async `postMatchResult()` (fire-and-forget in the tick loop). The mutation checks for existing results before insert to handle retries.

## Verification after change
```bash
npx convex dev --once
bun run typecheck
```
