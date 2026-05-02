# JAKESJAM Game Server

Bun + uWebSockets (via `Bun.serve`) authoritative game server. Owned by Dev B (netcode + infra). See `docs/netcode-architecture.md` for the full architecture.

## Run locally

```bash
cd server
bun install
GAME_SERVER_SECRET=dev-secret bun run dev
```

The server listens on `:8088` in dev (`:8080` in prod via Fly). Override with `PORT=...`. **Auto-heal**: if the desired port is taken, the server tries the next `PORT_SEARCH_RANGE` ports (default 10) — check the boot log for the actual bound port. Health: `GET /health`. WebSocket upgrade: `GET /ws?matchId=...&token=...`.

To validate end-to-end with a real Convex token, set the same `GAME_SERVER_SECRET` in your Convex deployment:

```bash
npx convex env set GAME_SERVER_SECRET dev-secret
```

## Deploy

See `fly.toml` and `Dockerfile` at the repo root. One Fly app per region:

```bash
flyctl deploy --config fly.toml --app jakesjam-srv-syd --region syd
```

Set the production secret on each region app:

```bash
flyctl secrets set --app jakesjam-srv-syd GAME_SERVER_SECRET=<from a password manager>
flyctl secrets set --app jakesjam-srv-syd CONVEX_URL=https://...convex.cloud
```

## Layout

- `src/index.ts` — Bun.serve entrypoint, WebSocket upgrade, auth check
- `src/matchRegistry.ts` — active matches indexed by matchId
- `src/matchHost.ts` — per-match World + tick loop + per-client snapshot broadcast
- `src/protocol.ts` — message types + MessagePack codec (mirrors client)
- `src/auth.ts` — HMAC-SHA256 match token validation
- `src/config.ts` — env parsing
- `Dockerfile` — `oven/bun:1` base, copies `server/` and shared `client/src/sim/`

## Shared sim package

`@sim/*` resolves to `../client/src/sim/*` via tsconfig paths. The Dockerfile preserves the same relative layout in the production image so the import path doesn't change between dev and prod.
