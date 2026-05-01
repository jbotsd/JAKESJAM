# JAKESJAM

Browser-first 2D multiplayer arena platform shooter prototype.

Current stack:

- Phaser + TypeScript + Vite client in `client/`
- Convex backend/database functions in `convex/`
- Design docs and roadmap in `docs/`

## Local Setup

Install dependencies:

```bash
npm install
```

Start the Convex backend:

```bash
npm run dev:convex
```

Start the browser client in another terminal:

```bash
npm run dev:client
```

Or start Convex and the client together:

```bash
npm run dev:full
```

For LAN playtesting, start the browser client on all interfaces:

```bash
npm run dev:full:host
```

Then open the Host client on the machine/address other players can reach. If the browser is still opened through `127.0.0.1`, set `VITE_PUBLIC_HOST_ADDRESS` and `VITE_PUBLIC_HOST_PORT` in `client/.env.local` so the Host panel advertises the LAN address players should enter.

The first local Convex setup writes `.env.local` at the repo root. The Vite client reads Convex's `CONVEX_URL` from that file automatically.

Optional client override:

```bash
VITE_CONVEX_URL=http://127.0.0.1:3210
```

## Checks

```bash
npm run typecheck
npm run build
```

## Standalone HTML Builds

Generate single-file Host and Player launch pages:

```bash
npm run build:standalone
```

Outputs:

- `standalone/JAKESJAM-host.html`
- `standalone/JAKESJAM-player.html`

For solo practice, open either file directly in a browser. For room testing across Linux/Windows machines, run the Convex local backend on the host machine and serve the `standalone/` folder over HTTP from that host. The standalone pages derive the Convex URL from the page host as `http://<host>:3210` and can also be overridden with `?convex=http://<host>:3210`.

## Current Milestone

Milestone 2 is underway:

- playable Boxworks movement playground
- controllable placeholder player
- collision platforms and side walls
- run, jump, crouch, fast fall, coyote time, and jump buffering
- out-of-bounds/reset handling
- debug overlay for movement tuning
- aim reticle and Starter Pistol / Crystal Blaster firing
- projectile shape rendering for circle, triangle, square, hexagon, and orb
- dummy target damage, knockback, score, and reset

Next milestone: first projectile pathing modifiers, then arena destructibles/fire.

## Important Docs

- `AGENTS.md` — contributor and Codex rules
- `docs/game-design-document.md` — full GDD
- `docs/milestone-roadmap.md` — milestone sequencing
- `docs/codex-task-backlog.md` — implementation backlog
- `docs/technical-design.md` — stack and architecture notes
- `docs/changelog.md` — design and scaffold changes
