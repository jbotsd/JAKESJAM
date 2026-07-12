# JAKESJAM

Browser-first 2D multiplayer arena platform shooter prototype built around fast platform movement, geometric projectile chaos, and stackable roguelike weapon cards.

The design target is a 10-player all-v-all arena game: every player starts with the same Crystal Blaster, then roaming card pickups mutate that one weapon into wildly different homing, bouncing, splitting, spraying, elemental, and utility builds. Weapons reset on death so each life becomes a fresh little science accident.

## Current Status

Playable locally as a browser game. The main loop currently supports:

- Splash menu with Practice, room flow, and options.
- Local single-player practice with no backend required.
- 5x3 Boxworks arena with camera follow and varied generated room blocks.
- Random spawn points across the full grid.
- Procedural character rig with standing, crouch, jump, recoil, aim, death, and respawn feedback.
- Health, shield cells, overcharge, damage amp, speed boost, traps, boss core, and roaming card caches.
- Destructible barrels, boxes, mines, cubes, explosions, and fire patches.
- Wall movement (SMB/Warframe style): wall-jump, wall-slide, and power-slide chains for reaching higher blocks.
- Held Shift aim-shield; blocked hits reflect the projectile back at the attacker.
- Right-click dash-bash: an aimable shield power-slide that blocks on the way in and bashes on contact.
- 3 second respawn after death, with weapon/card reset.
- Always-on kill/death scoreboard down the left side of the HUD.

## Weapon And Card Direction

Current progression rule:

1. Everyone starts with the same default Crystal Blaster.
2. Card pickups add mutators to that weapon.
3. Cards stack, so builds can become ridiculous instead of staying clean and polite.
4. Card caches move around the map every 20 seconds.
5. Death resets weapon cards back to the starter weapon.

Recent card pass:

- Removed Pulse Nova from normal card progression.
- Replaced pulse-wave melee mode with close-range projectile spray.
- Added stackable homing support via Seeker Facets, Micro Seekers, and Magnet Spray.
- Added more spray patterns via Shard Bloom, Wide Barrage, Needle Hose, Triple Fan, Five Shard Spray, and +1 Projectile.
- Card rolls are now less bucket-ordered and more random, with extra weight toward visible homing and multi-projectile mutations.

## Controls

| Action | Input |
|---|---|
| Move | A / D |
| Jump | W or Space |
| Crouch / fast fall | S |
| Aim | Mouse |
| Fire | Left mouse |
| Shield | Hold Left Shift |
| Dash-bash (shield power-slide) | Right mouse button, C alternate |
| Stats overlay | Backtick (`) |
| Reset local match | R |

## Project Layout

- `client/` - Phaser + TypeScript + Vite browser game.
- `client/src/game/` - current playable Phaser scenes, systems, data, rendering, and UI.
- `client/src/sim/` - shared deterministic simulation. The hot paths route through Zig→WASM (see `sim/`).
- `client/src/sim/wasm/` - TS-side wasm loader, runtime, and parity tests.
- `client/src/net/` - WebSocket transport, client prediction, reconciliation, and interpolation work.
- `sim/` - Zig source for the deterministic sim core (compiled to wasm). `bun run sim:build` produces `client/public/wasm/sim.wasm`. See `docs/zig-wasm-migration-complete.md` for the architecture.
- `server/` - Bun + uWebSockets authoritative game server. Loads the same wasm artifact; LUT install + sim swap gates predict↔authority bit-equality.
- `convex/` - lobby, room, matchmaking, and persistence.
- `docs/` - GDD, roadmap, netcode architecture, stream handoff docs, changelog, playtest notes, and the Zig→WASM migration docs (start at `docs/README.md`).
- `standalone/` - generated single-file host/player HTML builds for quick cross-platform testing.

### Sim architecture in one paragraph

The deterministic core is Zig compiled to WebAssembly (Zig 0.15.2,
`wasm32-freestanding`, ReleaseSmall ~29 KB). The same `.wasm` runs in
the browser (V8) for client prediction and in Bun (server) for
authoritative simulation. A comptime-baked sin/cos/atan2 LUT is
loaded into the TS runtime at boot so even the TS sim modules sample
bit-identical bytes — no `Math.sin/cos/atan2` libm divergence between
hosts. `setRngBackend` / `setResolveMoveCachedBackend` /
`setStepPlayerBackend` route the heavy paths through wasm by
default in production, with `?wasm-collision=0` style URL flags as
emergency opt-out and `JAKESJAM_WASM_*=0` as the server-side
counterpart. Read `docs/zig-wasm-migration-complete.md` for the
full retrospective.

## Local Development

Bun is the intended toolchain:

```bash
bun install
bun run dev:client
```

For the full online stack, run these in separate terminals:

```bash
# Terminal 1 - Convex local backend
bun run dev:convex

# Terminal 2 - authoritative game server
GAME_SERVER_SECRET=dev-secret bun run dev:server

# Terminal 3 - Vite client
bun run dev:client
```

Or start the online dev stack together:

```bash
GAME_SERVER_SECRET=dev-secret bun run dev:online
```

Set the same `GAME_SERVER_SECRET` in Convex when using the online flow:

```bash
bunx convex env set GAME_SERVER_SECRET dev-secret
```

Optional client override for the game server:

```bash
VITE_GAME_SERVER_URL=ws://localhost:8088/ws
```

## Standalone HTML Builds

The repo can emit single-file HTML launchers:

```bash
bun run build:standalone
```

On a Windows machine without Bun installed, this fallback has been used successfully:

```powershell
npm.cmd run build --workspace client
node tools/build-standalone.mjs
```

Outputs:

- `standalone/JAKESJAM-host.html`
- `standalone/JAKESJAM-player.html`

These are useful for quick local testing across Windows and Linux, but the active online direction is browser client plus authoritative server, not separate native executables.

## Online Architecture

Short version:

- Convex owns lobby, matchmaking, room state, player readiness, and persistence.
- Bun WebSocket server owns authoritative 60 Hz match simulation.
- Browser client uses client-side prediction and server reconciliation.
- `client/src/sim/` is being built as the runtime-agnostic simulation package that both browser and server can run.

Important architecture docs:

- `docs/netcode-architecture.md`
- `docs/dev-stream-sim.md`
- `docs/game-design-document.md`
- `docs/milestone-roadmap.md`
- `docs/codex-task-backlog.md`
- `docs/changelog.md`

## Checks

```bash
bun run typecheck
bun run build
bun run test
```

Current Windows/npm checks used during recent gameplay work:

```powershell
npm.cmd run typecheck --workspace client
npm.cmd run build --workspace client
node tools/build-standalone.mjs
```

## Development Focus

Near-term gameplay focus:

- Make weapon cards feel more obviously different through projectile count, shape, pathing, impact, and element changes.
- Keep improving randomized 5x3 maps so rooms are traversable and less repetitive.
- Tune health, shield, parry, jetpack, cooldown, and card stacking balance for 10-player all-v-all.
- Move gameplay logic out of Phaser scenes/systems into `client/src/sim/` so online prediction and server authority use the same rules.

Repo rules:

- New gameplay should move toward `client/src/sim/` as the extraction progresses.
- Do not make Convex the frame-by-frame gameplay server.
- Coordinate changes to `server/`, `client/src/net/`, Convex schema/matchmaker, and deployment config with the netcode stream.
- Do not use Java as the main runtime.
