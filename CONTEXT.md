# JAKESJAM Domain Glossary

Shared vocabulary used across sim, server, client, and netcode. Use these
terms exactly — no synonyms ("entity" vs "actor", "match" vs "session").

## Core domain

**Match**
A single game session between 2+ players. Bounded by `targetScore` rounds.
Hosted by exactly one `MatchHost` on the Bun server. Players join via
matchmaker (Convex), play via WebSocket against the host, and the final
result is written back to Convex. Lives entirely in `server/src/matchHost.ts`.

**Round**
One play-to-the-death iteration inside a Match. Has phases:
`countdown → fighting → round-over → drafting → countdown ...`. The pure
state machine is `client/src/sim/round.ts::stepRound`.

**Drafting**
The between-rounds card-pick phase. Every player (alive or freshly killed)
gets `DRAFT_OFFER_COUNT = 3` rolled offers. Drafting holds until every
participant commits a pick. No auto-pick. Cards augment the player's
`weaponBuild` for the rest of the match.

**WorldState**
The deterministic snapshot of the simulation at a single tick. Includes
players, projectiles, destructibles, fire patches, pickups, satellites,
round, RNG cursor, chaos modifier ids. Defined in `client/src/sim/types.ts`.
Identical on server and client by construction.

**Tick**
A 16.67ms (60 Hz) sim step. The unit of time everything is measured in
once we leave wall-clock land. `tick: number` on `WorldState`.

**Player**
A participant in a Match. Identified by `PlayerId` (string, opaque to
the sim). Has health, position, velocity, aim, weapon, cards, buff timers,
shield/parry state. See `PlayerEntity` in `sim/types.ts`.

**WeaponBuild**
The resolved set of (base weapon + cards). Computed by
`sim/data/weaponBuild.ts::createWeaponBuild`. Drives projectile shape,
pathing, damage, fire rate, and impact behaviour.

**Card**
A rogue-lite augmentation. Picked during Drafting. Defined in
`sim/data/cards.ts`. Cards are `unique: true` (single-copy) or stackable.

**Chaos Modifier**
A per-match (currently per-round, planned per-round-roll) global rule
twist. Defined in `sim/data/chaosModifiers.ts`. Examples: low-gravity,
slow-motion, golden-gun, max-recoil. Resolved via `getChaosProfile`.

## Layered architecture

**Sim layer** (`client/src/sim/`)
Pure deterministic simulation. No Phaser, no DOM, no `Math.random`, no
`Date.now`, no I/O. Imported as `@sim/`. Runs identically on the Bun
server (authoritative) and the Phaser client (predictive). Threading the
RNG cursor (`WorldState.rngState`) is the only "stateful" thing.

**Net layer** (`client/src/net/`)
Everything between the sim and the wire. Owns prediction, reconciliation,
smoothing, lag-compensation handshake, ping/pong, reconnect supervisor.
The boundary into the sim is one-way: net feeds inputs in, reads
`WorldState` out.

**Render layer** (`client/src/game/`)
Phaser scenes (`MatchScene`, `OnlineMatchScene`), procedural rigs, UI
overlays, audio. Reads `WorldState`, writes nothing back into the sim
except via `setLocalInput`.

**Lobby layer** (`convex/`)
Lobby/matchmaking/match-result writes. Convex is **not** allowed in the
60Hz path. It owns: room codes, player names + ready state, chat,
matchmaker assignment to a Bun host, final score persistence.

## Seams (where modules meet)

**Sim ↔ Net seam** — `World.step(state, inputs, dtMs) → StepResult`.
Pure. Every cross-process bug should narrow to either an input mismatch
or a missing inclusion in `WorldState`.

**Net ↔ Render seam** — `clientLoop.getRenderState() → WorldState`.
Render code never sees raw snapshots, baselines, or the prediction
buffer.

**Render ↔ DOM seam** — `client/src/game/ui/*` overlays. DOM lifecycle
(`show / hide / destroy`) is owned by the overlay; scenes only hold a
reference and call into the seam.

**Server ↔ Convex seam** — `server/src/convexClient.ts`. The Bun host
posts match summaries here; Convex never reaches into the live world.

## Player roles in code

**Local player** — the player whose inputs originate at *this* client.
Always `state.players[localPlayerId]`. The only player whose movement
is predicted client-side.

**Remote player** — any other player visible in the world. Rendered from
interpolated authoritative snapshots (no prediction).

**Host** — the Bun process that owns a Match's authoritative WorldState.
Distinct from "lobby host" (the Convex room creator).
