---
name: fly-game-deploy
description: >
  Fly.io deployment patterns for JAKESJAM's stateful Bun game server. Use
  when editing fly.toml, server/Dockerfile, the deploy:server:* npm scripts,
  health check handlers, or anything involving: flyctl, fly apps create,
  fly secrets, primary_region, auto_stop_machines, min_machines_running,
  multi-region game server topology, syd/sjc/fra app naming, GAME_SERVER_SECRET,
  or matchmaker → host URL routing. Skip for client (Vite) deploys and
  Convex deploys (use convex skills for those).
---

# Fly.io Deploy — Stateful Game Server

The game server is **stateful per match** — once a `MatchHost` is hosting players, you cannot move it to another machine. Fly's defaults (auto-stop on idle, autoscale based on CPU) actively fight that. Configure deliberately.

## Required fly.toml shape

```toml
app = "jakesjam-srv-sin"
primary_region = "sin"

[build]
  dockerfile = "server/Dockerfile"

[env]
  PORT = "8080"
  REGION = "sin"
  NODE_ENV = "production"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false        # ← stateful: NEVER let Fly stop us
  auto_start_machines = true        # ← but allow cold-start on first req
  min_machines_running = 1
  processes = ["app"]

[[http_service.checks]]
  grace_period = "10s"
  interval = "10s"
  method = "get"
  path = "/health"
  protocol = "http"
  timeout = "2s"

[[vm]]
  cpu_kind = "shared"               # bump to dedicated for >50 CCU per VM
  cpus = 1
  memory_mb = 512
```

The non-obvious bits:
- `auto_stop_machines = false` is mandatory. If Fly stops a VM mid-match, the match is dead — there's no migration story for in-flight WS connections.
- `min_machines_running = 1` keeps a warm host so first-match latency is OK. Bump per region as concurrent matches grow.
- The `/health` handler in `server/src/index.ts` should be **cheap**: respond `200` if the process is up. Don't gate on Convex reachability — health checks shouldn't fail because of an upstream blip.

## Multi-region pattern (one app per region)

We deploy **one Fly app per region**, not one app with `regions = [...]`. Reason: matchmaker routes a client to a specific region's app, and per-app secrets/scaling/observability stay clean.

```bash
flyctl deploy --config fly.toml --app jakesjam-srv-sin  --region sin
flyctl deploy --config fly.toml --app jakesjam-srv-sjc  --region sjc
flyctl deploy --config fly.toml --app jakesjam-srv-fra  --region fra
```

The `app` field in fly.toml is a default; `--app` overrides at deploy time. Naming convention: `jakesjam-srv-<3-letter-region>`.

## First-time region setup

```bash
flyctl apps create jakesjam-srv-<region>
flyctl secrets set --app jakesjam-srv-<region> \
  GAME_SERVER_SECRET=<from password manager> \
  CONVEX_URL=https://<deployment>.convex.cloud
flyctl deploy --config fly.toml --app jakesjam-srv-<region> --region <region>
```

`GAME_SERVER_SECRET` is the HMAC key the server uses to verify match tickets issued by Convex (`server/src/auth.ts`). It **must match** the secret stored in Convex env (`bunx convex env set GAME_SERVER_SECRET …`). If they drift, every WS upgrade 401s.

## Matchmaker → host URL flow

1. Client calls a Convex action (`createOrJoinMatch`) and receives `{ matchId, hostUrl, ticket }`.
2. `hostUrl` is `wss://jakesjam-srv-<region>.fly.dev/match` based on the player's geolocated region (or chosen by lobby).
3. Client opens a WS to `hostUrl` with the `ticket` in the protocol handshake. Server verifies the HMAC, attaches `{ matchId, playerId }` to `ws.data`, joins the topic.

The server **never** publishes its URL — Convex is the registry. To add a region, add an app + deploy + add the region to the matchmaker's region list.

## What to check before a production deploy

- `bun run typecheck` clean across client / server / convex.
- `bun run --filter server test` (if any server-only tests exist) clean.
- `flyctl status --app jakesjam-srv-<region>` shows the current machine healthy.
- `flyctl logs --app jakesjam-srv-<region>` for the last 1–2 mins shows no error spam.
- Active match count is 0 (or you have buy-in to interrupt). Check via Convex query, not by guessing.

## Rollback

`flyctl releases --app jakesjam-srv-<region>` lists prior images. `flyctl deploy --image <prior-image-ref> --app …` redeploys an old build instantly. Safer than re-building old code.

## Anti-patterns (don't do these)

- ❌ `auto_stop_machines = true` on the game server. Mid-match shutdown = dead match.
- ❌ Putting `regions = [a, b, c]` in fly.toml under one app. The matchmaker can't route to a specific region that way.
- ❌ Reading `GAME_SERVER_SECRET` from anywhere except Fly secrets in prod and `.env.local` in dev. Don't commit it; don't put it in `[env]`.
- ❌ Heavy `/health` handlers (DB ping, Convex query). Health checks must be cheap and local.
- ❌ Shipping a deploy mid-match without confirming. Auto mode is not a license here — confirm `match.activeCount` first.
- ❌ Using `flyctl deploy` without `--config` in this repo. Multiple region apps share `fly.toml`; ambiguity breaks deploys.

## References

- [Fly.io WebSockets docs](https://fly.io/docs/networking/websockets/)
- [Fly.io scaling — auto_stop / auto_start semantics](https://fly.io/docs/launch/autostop-autostart/)
- [Fly.io health checks](https://fly.io/docs/reference/configuration/#http_service-checks)
- See also: project `bun-ws-server` skill (server-side WS patterns) and `game-netcode` skill (matchmaker → host handshake).
