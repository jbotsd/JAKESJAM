# JAKESJAM

Browser-first 2D multiplayer arena platform shooter prototype inspired by fast side-view shooters and round-based upgrade chaos.

JAKESJAM is currently a Phaser + TypeScript gameplay prototype with Convex lobby support, standalone HTML builds for quick cross-platform testing, and a new shared `sim/` contract that will let the browser client and Bun authoritative server run the same deterministic simulation.

## Current Stack

- `client/` - Phaser 4 + TypeScript + Vite browser game.
- `client/src/sim/` - shared simulation contract and stub `World` for prediction/server authority work.
- `client/src/net/` - client netcode scaffold for WebSocket prediction and reconciliation.
- `server/` - Bun WebSocket game-server scaffold.
- `convex/` - lobby, room, ready-state, matchmaker, and persistence functions.
- `docs/` - GDD, roadmap, netcode architecture, stream handoff docs, changelog, and playtest plans.
- `standalone/` - generated single-file host/player HTML launchers.

## What Is Playable Now

- Splash menu with Practice, Host, Join, and Options.
- Local practice match from the Host/client menu.
- 5 x 3 expanded Boxworks arena with seeded varied room layouts.
- Camera-follow gameplay window over a larger traversable world.
- Procedural placeholder character with standing, crouch, jump, aim, recoil, and death feedback.
- Run, jump, crouch, fast fall, coyote time, and jump buffering.
- Shared starter weapon: Starter Pistol / Crystal Blaster.
- Stackable card pickups that mutate the starter weapon into chaotic builds.
- Projectile shapes: circle, triangle, square, hexagon, orb, X, and I/bar.
- Projectile modifiers: extra projectiles, spread, bounce, boomerang, gravity, float, homing, anti-homing, split, pierce, sticky, explosive, slow-field, and elemental effects.
- Shot cooldown tax for high-projectile, split, bounce, homing, beam, and large-impact builds.
- Destructible barrels, boxes, mines, and cubes.
- Fire patches, burnable objects, explosions, and area damage.
- Pickups: health shard, shield cell, overcharge core, damage amp, speed boost, melee mode, slow trap, vulnerability trap, block jammer, boss core, and roaming card caches.
- Held shield on Shift where available or temporarily granted.
- Directional parry/block on C with large cooldown and card upgrades for cover size/cooldown.
- Death explosion, 3 second respawn timer, and weapon reset on death.
- Held Tab kill/death scoreboard.
- Standalone Host and Player HTML builds for Windows/Linux browser testing.

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

Install dependencies:

```bash
npm install
```

Start Convex locally:

```bash
npm run dev:convex
```

Start the client in another terminal:

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

Then open the Host client on the machine/address other players can reach. If the browser opens through `127.0.0.1`, set `VITE_PUBLIC_HOST_ADDRESS` and `VITE_PUBLIC_HOST_PORT` in `client/.env.local` so the Host panel advertises the LAN address players should enter.

## Online Server Scaffold

The repo now includes a Bun game-server workspace:

```bash
npm run dev:server
```

The current server/netcode work is scaffold-level. The target architecture is:

- Convex owns lobby, matchmaking, profile, ready state, and match results.
- Bun WebSocket server owns authoritative 60 Hz match simulation.
- Browser client uses client-side prediction and server reconciliation.
- `client/src/sim/` is the shared runtime-agnostic simulation package used by both sides.

See `docs/netcode-architecture.md` and `docs/dev-stream-sim.md` before changing this area.

## Standalone HTML Builds

Generate single-file Host and Player pages:

```bash
npm run build:standalone
```

Outputs:

- `standalone/JAKESJAM-host.html`
- `standalone/JAKESJAM-player.html`

For solo practice, open either file directly in a browser. For room testing across Linux/Windows machines, run the Convex local backend on the host machine and serve the `standalone/` folder over HTTP from that host.

Standalone pages derive the Convex URL from the page host as `http://<host>:3210`. You can override it with:

```text
?convex=http://<host>:3210
```

## Checks

```bash
npm run typecheck
npm run build
npm run test --workspaces --if-present
```

Generate standalone pages as part of a release/smoke pass:

```bash
npm run build:standalone
```

## Current Development Focus

The active architecture work is the simulation extraction:

1. Keep `client/src/sim/types.ts` stable for Dev B's netcode work.
2. Move pure gameplay logic out of `MatchScene.ts` and old Phaser systems into `client/src/sim/`.
3. Keep `sim/` free of Phaser, DOM, Convex, Bun, wall-clock reads, and `Math.random()`.
4. Add deterministic collision, movement, projectile, weapon, fire, pickup, and destructible tests.
5. Reduce `MatchScene.ts` to rendering, input capture, audio/VFX event handling, and scene lifecycle.

Gameplay continues in `sim/` after extraction: cards, draft, projectile pathing, fire tuning, destructibles, shields, parry, boss pickup, and PvP health authority.

## Important Docs

- `AGENTS.md` - contributor and Codex rules.
- `docs/game-design-document.md` - full game design document.
- `docs/netcode-architecture.md` - online architecture source of truth.
- `docs/dev-stream-sim.md` - Sim & gameplay stream handoff.
- `docs/milestone-roadmap.md` - milestone sequencing.
- `docs/codex-task-backlog.md` - implementation backlog.
- `docs/technical-design.md` - stack and architecture notes.
- `docs/changelog.md` - implementation history.
- `docs/playtest-stress-plan.md` - sanity and stress-test procedure.

## Repo Notes

- Do not use Java as the main runtime.
- Convex is not the 60 FPS gameplay server.
- Do not put high-frequency movement/projectile writes through Convex.
- Coordinate changes to `server/`, `client/src/net/`, Convex schema/matchmaker files, and deployment config with the netcode stream.
- New gameplay code should move toward `client/src/sim/` rather than growing `MatchScene.ts`.
