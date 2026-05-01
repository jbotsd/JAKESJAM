# JAKESJAM

Browser-first 2D multiplayer arena platform shooter prototype inspired by fast side-view shooters and round-based upgrade chaos.

JAKESJAM is a Phaser + TypeScript client served from Vercel, a Bun authoritative game server, and Convex for lobby/matchmaking/results. The shared `client/src/sim/` package is the deterministic simulation that runs in both the browser (for prediction) and the server (for authority).

## Current Stack

- `client/` — Phaser 4 + TypeScript + Vite browser game.
- `client/src/sim/` — shared simulation contract and stub `World` for prediction/server authority work.
- `client/src/net/` — client netcode (WebSocket transport, prediction, reconciliation, interpolation).
- `server/` — Bun + uWebSockets game server (one MatchHost per match, 60 Hz tick, 30 Hz snapshots).
- `convex/` — lobby, room, ready-state, matchmaker, persistence.
- `docs/` — GDD, roadmap, netcode architecture, stream handoff docs, changelog, playtest plans.
- `vercel.json`, `fly.toml`, `server/Dockerfile` — deployment configs.
- `standalone/` — legacy single-file HTML host/player launchers, kept for offline/LAN demos.

## What Is Playable Now

- Splash menu with Practice, Create Room, Join Room, Options.
- Local practice match with no backend required.
- 5×3 expanded Boxworks arena with seeded varied room layouts and camera follow.
- Procedural placeholder character with standing, crouch, jump, aim, recoil, and death feedback.
- Run, jump, crouch, fast fall, coyote time, jump buffering.
- Shared starter weapon: Starter Pistol / Crystal Blaster.
- Stackable card pickups that mutate the starter weapon into chaotic builds.
- Projectile shapes, modifiers, pathing variants, and elemental effects.
- Destructible barrels, boxes, mines, cubes; fire patches; explosions.
- Pickups: health shard, shield cell, overcharge core, damage amp, speed boost, melee mode, slow trap, vulnerability trap, block jammer, boss core, roaming card caches.
- Held shield (Shift), directional parry (C), 3 second respawn, weapon reset on death.
- Held Tab kill/death scoreboard.

## Controls

| Action | Input |
|---|---|
| Move | A / D |
| Jump | W or Space |
| Jetpack boost | Hold Space while airborne |
| Crouch / fast fall | S |
| Aim | Mouse |
| Fire | Left mouse |
| Shield | Left Shift |
| Directional parry | Right mouse button (C fallback) |
| Scoreboard | Tab |
| Reset local match | R |

## Local Setup

Install dependencies (Bun is the primary toolchain):

```bash
bun install
```

Three terminals for full online dev:

```bash
# Terminal 1 — Convex (cloud or local)
bunx convex dev          # cloud — first run will provision a project
# or, fully offline:
bun run dev:convex       # local Convex backend on :3210

# Terminal 2 — Bun game server
GAME_SERVER_SECRET=dev-secret bun run dev:server

# Terminal 3 — Vite client
bun run dev:client
```

Or in one terminal (spawns all three):

```bash
GAME_SERVER_SECRET=dev-secret bun run dev:online
```

Set `GAME_SERVER_SECRET` to the same value you set in Convex (`bunx convex env set GAME_SERVER_SECRET <value>`) so the per-player auth tokens validate.

To point the client at a non-default game server (e.g. localhost during dev, or a Cloudflare tunnel during playtest), add to `client/.env.local`:

```
VITE_GAME_SERVER_URL=ws://localhost:8080/ws
```

## Web Playtest

Two free paths to publicly playable. Pick one for the game server; both work the same.

**Option A — Cloudflare Tunnel + your own PC (no cloud bill):**

1. Run the server on your PC: `GAME_SERVER_SECRET=<value> bun run dev:server`.
2. Expose `localhost:8080` via your existing `cloudflared` tunnel as `wss://jakesjam-srv.<your-domain>/ws`.
3. Set the Vercel env vars `VITE_CONVEX_URL` (from `bunx convex env list` or the Convex dashboard) and `VITE_GAME_SERVER_URL=wss://jakesjam-srv.<your-domain>/ws`.
4. Deploy the client: `vercel deploy --prod` (or import via Vercel dashboard).
5. Share the Vercel URL. Players open it, create or join a room with a code, the WebSocket connects to your tunnel.

**Option B — Fly.io (multi-region, ~$0/mo at jam scale):**

1. `flyctl auth login`, `flyctl apps create jakesjam-srv-syd`.
2. `flyctl secrets set --app jakesjam-srv-syd GAME_SERVER_SECRET=<value>`.
3. `bun run deploy:server:syd` (alias for `flyctl deploy --config fly.toml --region syd`).
4. The matchmaker in `convex/matchmaker.ts` already points clients at `wss://jakesjam-srv-syd.fly.dev/ws` — no Vercel env override needed.
5. Set Vercel env var `VITE_CONVEX_URL` and deploy: `vercel deploy --prod`.

In both cases the same Convex deployment must hold the same `GAME_SERVER_SECRET` as the game server, so the per-player HMAC tokens validate. See `docs/netcode-architecture.md` for the full handshake.

## Online Architecture (Short Version)

- Convex owns lobby, matchmaking, profile, ready state, match results.
- Bun WebSocket server owns authoritative 60 Hz match simulation.
- Browser client uses client-side prediction and server reconciliation (Gambetta pattern).
- `client/src/sim/` is the shared runtime-agnostic simulation imported by both sides.

Source-of-truth docs:

- `docs/netcode-architecture.md` — full architecture.
- `docs/dev-stream-sim.md` — sim/gameplay stream handoff.

## Checks

```bash
bun run typecheck            # client + server + convex codegen
bun run build                # production client build
bun run --filter '*' test    # workspace tests if any
```

## Current Development Focus

The active architecture work is the simulation extraction:

1. Keep `client/src/sim/types.ts` stable for the netcode stream.
2. Move pure gameplay logic out of `MatchScene.ts` and old Phaser systems into `client/src/sim/`.
3. Keep `sim/` free of Phaser, DOM, Convex, Bun, wall-clock reads, and `Math.random()`.
4. Add deterministic collision, movement, projectile, weapon, fire, pickup, destructible tests.
5. Reduce `MatchScene.ts` to rendering, input capture, audio/VFX events, and scene lifecycle.

Gameplay continues in `sim/` after extraction: cards, draft, projectile pathing, fire tuning, destructibles, shields, parry, boss pickup, and PvP health authority.

## Important Docs

- `AGENTS.md` — contributor and agent rules.
- `docs/game-design-document.md` — full GDD.
- `docs/netcode-architecture.md` — online architecture source of truth.
- `docs/dev-stream-sim.md` — Sim & gameplay stream handoff.
- `docs/milestone-roadmap.md` — milestone sequencing.
- `docs/codex-task-backlog.md` — implementation backlog.
- `docs/technical-design.md` — stack and architecture notes.
- `docs/changelog.md` — implementation history.
- `docs/playtest-stress-plan.md` — sanity and stress-test procedure.

## Repo Notes

- Bun is the primary toolchain. Scripts use `bun run --filter <pkg>` for workspaces; `npm` should also work but bun is supported and tested.
- Convex is not the 60 FPS gameplay server. Per-frame state lives on the Bun server.
- Coordinate changes to `server/`, `client/src/net/`, Convex schema/matchmaker files, and deployment config with the netcode stream.
- New gameplay code should move toward `client/src/sim/` rather than growing `MatchScene.ts`.
- Do not use Java as the main runtime.
