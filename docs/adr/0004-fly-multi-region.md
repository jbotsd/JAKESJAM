# ADR-0004: Fly.io multi-region deployment

## Status
Accepted

## Context
The game server is stateful per match — once a `MatchHost` owns a set of connected clients, moving the process to another machine mid-match requires recreating the exact in-memory state (impractical for live matches). Fly.io's default `auto_stop_machines` and `regions` configuration would kill or migrate VMs, breaking the connection. The matchmaker in `convex/matchmaker.ts` already defines `GAME_REGIONS = ["syd", "sjc", "fra"]`.

## Decision
Deploy **one Fly app per region** (`jakesjam-srv-syd`, `jakesjam-srv-sjc`, `jakesjam-srv-fra`), with the following `fly.toml` overrides per region:

```toml
app = "jakesjam-srv-syd"
primary_region = "syd"

# ... (build, env)

[http_service]
  internal_port = 8080
  force_https = true
  # stateful: NEVER let Fly stop a running match
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
```

Store a separate `GAME_SERVER_SECRET` per region in `flyctl secrets set`. The server uses this HMAC in `server/src/auth.ts` to verify the match ticket for each WebSocket upgrade. The matchmaker (`convex/matchmaker.ts`) records the region in the match document after assigning the URL.

## Concrete setup (one-time per region):
```bash
flyctl apps create jakesjam-srv-syd
flyctl secrets set --app jakesjam-srv-syd \
  GAME_SERVER_SECRET=<from password manager> \
  CONVEX_URL=https://your-deployment.convex.cloud
flyctl deploy --config fly.toml --app jakesjam-srv-syd --region syd
```

## Matching registry flow:
1. Client calls Convex `getMyMatchToken(matchId, playerId)` and receives `{ gameServerUrl, token }`.
2. `gameServerUrl` is `wss://jakesjam-srv-{region}.fly.dev/ws` based on `requestedRegion` (fallback `DEFAULT_REGION="syd"`).
3. Client opens `ws.connect(gameServerUrl)` and includes `token` in protocol handshake.
4. Server validates HMAC with its `GAME_SERVER_SECRET` and attaches `{ matchId, playerId }` to `ws.data`.

## Consequences
- **Latency-aware routing future-friendly**. The matchmaker can pick the region closest to the client. No cross-region handoff is needed — a match lives and dies on one Fly machine.
- **Secret rotation per-region** without affecting others. `GAME_SERVER_SECRET` can be rotated independently per app.
- **No cross-region match handoff**. If a server VM dies, the in-memory `MatchHost` is lost — the client must reconnect to whatever region the matchmaker assigned. This is acceptable for prototype scale; a Redis-backed "match persistence" layer can add later.
- **Horizontal scaling** follows "one app per region": double `min_machines_running` instead of adding `regions = [...]` in a single app definition.

## Verification after change
```bash
flyctl status --app jakesjam-srv-syd
flyctl logs --app jakesjam-srv-syd
flyctl deploy --config fly.toml --app jakesjam-srv-sjc --region sjc
flyctl secrets set --app jakesjam-srv-sjc GAME_SERVER_SECRET=…
```
