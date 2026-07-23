> **ARCHIVED 2026-07-23** — superseded by `docs/cohesion-goal.md` + `docs/STATE-OF-PLAY.md`; kept for history. Contents predate the Bun/venue/class era (npm/Convex-as-backend and the retired gsr host-replay workflow are NOT current practice).

# JAKESJAM — Milestone Roadmap

This roadmap turns the GDD and backlog into a practical build order. The project should prove feel first, then combat, then multiplayer, then orthogonal upgrade depth.

## Roadmap Principles

- Build the smallest playable loop before scaling content.
- Everyone starts with the same Starter Pistol / Scrap Rifle baseline.
- Cards mutate independent axes: count, range, fire rate, speed, size, shape, recoil, pathing, element/status, lifetime, and character tradeoffs.
- One good map beats five unfinished maps.
- Convex proves lobby/session flow first; high-frequency combat authority is deferred until playtesting proves a need.
- Loot boxes, gacha, meta buffs, and dice modes are post-MVP experiments unless used as temporary local prototypes.

## Milestone 0 — Local Project Foundation

**Goal:** turn the documentation pack into a runnable repo.

**Status:** scaffolded on 2026-05-01. Continue to refine only as needed for Milestone 1.

Backlog scope:

- JJ-0001 — Create Project Skeleton
- JJ-0002 — Scaffold Phaser + TypeScript + Vite Client
- JJ-0003 — Scaffold Convex Backend

Deliverables:

- `client/`, `convex/`, `assets/`, and `tests/` folders.
- Vite + TypeScript + Phaser client runs locally.
- Placeholder BootScene and MatchScene.
- Convex schema placeholder and setup notes.
- Root scripts for dev, build, typecheck, and test.

Exit criteria:

- `npm install` works.
- `npm run dev` starts the client.
- `npm run typecheck` passes.
- A contributor can understand where gameplay, data, and docs live.

## Milestone 1 — Offline Movement Playground

**Goal:** make the body feel good before networking or cards.

**Status:** first playable playground scaffolded on 2026-05-01. Continue tuning movement feel during combat work.

Backlog scope:

- JJ-0101 — Add Game Types
- JJ-0102 — Create Boxworks Test Arena
- JJ-0103 — Implement Player Movement
- JJ-0104 — Add Movement Feel Helpers

Deliverables:

- Player placeholder in Boxworks.
- Floor, walls, platforms, spawn, and out-of-bounds reset.
- Run, jump, gravity, air control, coyote time, and jump buffering.
- Debug overlay for position/velocity.
- Early `CharacterDefinition` support for health, size, movement, recoil handling, and ability.

Exit criteria:

- Movement feels responsive in a local browser.
- Collision is stable.
- The first map supports close, mid, and risky long-angle positions.

## Milestone 2 — Baseline Combat and Projectile Axes

**Goal:** prove the shared starter weapon and projectile mutation model.

**Status:** first playable combat loop scaffolded on 2026-05-01. Remaining work: first pathing modifiers and deeper card-driven projectile mutation.

Backlog scope:

- JJ-0201 — Add Aim Reticle
- JJ-0202 — Implement Starter Pistol / Scrap Rifle Data
- JJ-0202A — Add Projectile Modifier Types
- JJ-0203 — Implement Projectile System
- JJ-0203A — Render Basic Projectile Shapes
- JJ-0203B — Implement First Pathing Modifiers
- JJ-0204 — Implement Health and Damage
- JJ-0205 — Implement Offline Round Reset

Deliverables:

- Mouse aim and visible reticle.
- Starter Pistol / Scrap Rifle fires one readable projectile.
- Projectile shapes: circle, triangle, square, hexagon, orb.
- Modifier axes for count, range, fire rate, speed, size, recoil, pathing, element/status, and lifetime.
- First pathing experiments: bounce, boomerang, weak homing, anti-homing.
- Health, damage, death, score, and round reset.

Exit criteria:

- Shooting feels understandable and physical.
- Projectile shapes are visually distinct.
- Homing-style upgrades can carry readable downsides such as larger character size.
- Offline rounds can end and reset.

## Milestone 3 — Arena Physics, Destructibles, and Fire

**Goal:** add Worms-meets-Smash map interaction without breaking readability.

**Status:** first playable destructible/fire pass scaffolded on 2026-05-01. Remaining work: richer physics response, better ownership/scoring, and tuning object placement/readability.

Backlog scope:

- JJ-04A1 — Add Destructible Object Types
- JJ-04A2 — Implement Destructible Object Damage
- JJ-04A3 — Add Fire/Napalm Prototype

Deliverables:

- Barrels, boxes, mines, and cubes/blocks.
- Core map geometry remains non-destructible.
- Basic physics interactions for movable or explosive objects.
- Fire catches on objects/zones, deals short damage-over-time, and dissipates.
- Ownership tracking for fire and explosions.

Exit criteria:

- Destructibles create choices, not random match endings.
- Fire is readable and temporary.
- Physics objects do not hide players or projectiles.

## Milestone 4 — Convex Lobby and Online 1v1

**Goal:** prove multiplayer flow with the smallest real online match.

**Status:** lobby-to-match handoff, room-player spawning, and low-frequency player snapshots scaffolded on 2026-05-01. Remaining work: two-window latency tuning, combat authority decisions, and results submission.

Backlog scope:

- JJ-0301 — Implement Room Schema
- JJ-0302 — Implement Client Convex Connection
- JJ-0303 — Build Lobby Scene
- JJ-0304 — Add Chat or Emote Ping
- JJ-0401 — Add Match State Transition
- JJ-0402 — Spawn Two Players Online
- JJ-0403 — Add Low-Frequency Player Snapshot Sync
- JJ-0404 — Submit Round and Match Results

Deliverables:

- Create/join room by code.
- Player name, colour, connected state, ready state.
- Simple chat or emote ping.
- Two players spawn in the map.
- Local movement remains responsive.
- Remote player uses throttled snapshot sync and smoothing.
- Round and match results save to Convex.

Exit criteria:

- Two browser windows can play a rough 1v1.
- Convex write rate is documented and acceptable.
- Any latency limitations are written down before adding more players.

## Milestone 5 — Orthogonal Cards and Characters

**Goal:** make builds feel different without adding many separate weapons.

**Status:** first playable character archetype integration scaffolded on 2026-05-01. Card caches now collect mutators onto the starter weapon so player weapons diverge during play. Remaining work: draft flow, online card sync, active ability variety, and deeper path identity tuning.

Backlog scope:

- JJ-0501 — Create Card Data
- JJ-0501A — Define Four Weapon Paths
- JJ-0502 — Implement Card System
- JJ-0503 — Implement Draft Scene
- JJ-0504 — Add Prototype Card Effects
- JJ-0505 — Add Orthogonal Prototype Cards
- JJ-0506 — Add Character Stat Archetypes
- JJ-0507 — Add Pickup and Map Incentive Prototype

Deliverables:

- At least 12 cards.
- Four paths: Blap, Heavy, Trick, Element.
- Draft screen offers three cards to the losing player.
- Cards can modify weapon, projectile, movement, defense, utility, and tradeoff values.
- Prototype weird cards: Boomerang Rounds, Square Rounds, Hex Rounds, Homing Greed, Reverse Pull, Orby Blap Blap, Napalm Bloke.
- Four character archetypes with different health/movement/size/recoil/ability tradeoffs.
- One pickup or loot-crate-style map incentive for movement pressure.

Exit criteria:

- Builds are readable to both players.
- At least two builds feel meaningfully different.
- Character stats nudge playstyle without deciding the match alone.
- Pickups create map-control decisions without replacing draft cards.

## Milestone 6 — Single-Map MVP Stress Target

**Goal:** complete a replayable MVP loop on one main map.

**Status:** first single-map polish pass scaffolded on 2026-05-01 with a 15-screen 5x3 Boxworks world, camera follow, world-space aiming, generated placeholder audio, main-menu entry flow, local fire/explosion health damage, and a held Shift shield prototype for shield-capable characters. Target player count is now all-v-all 10-player free-for-all. Remaining work: full PvP health authority, draft/pickup rewards, results/rematch flow, deployment checklist, and real two-window/10-player stress notes.

Backlog scope:

- JJ-0601 — Add Basic Audio
- JJ-0603 — Add Results Summary
- JJ-0604 — Deployment Build
- selected stability fixes from earlier milestones

MVP content target:

- One main map.
- Up to 10-player all-v-all stress testing after 1v1 works.
- Four weapon paths.
- Four characters.
- Four destructible/interactive element types.
- Health/damage/death, score, draft, result, rematch.
- Placeholder but readable art/audio.

Exit criteria:

- A new player can open the game, join a room, play a match, draft cards, see results, and rematch.
- Ten-player local/online free-for-all stress testing has a written result, even if the final MVP ships with a lower recommended count.
- The game is fun enough to replay immediately.

## Milestone 7 — Post-MVP Experiments

**Goal:** explore high-chaos and long-term retention ideas without contaminating the core loop.

**Status:** first data-driven chaos modifier pass scaffolded on 2026-05-01. Remaining work: cosmetic loot reveal prototype, custom-room persistence for modifiers, and playtest-based pruning.

Backlog scope:

- JJ-0701 — Add Dice-Roll Chaos Modifiers
- JJ-0702 — Prototype Cosmetic Loot Crate Presentation
- JJ-0703 — Explore Long-Term Meta Buffs and Debuffs

Experiment candidates:

- low gravity;
- 4x map;
- slow motion;
- golden gun;
- slappers only;
- Big Purp Dilly Mode;
- fire hazard round;
- exploding barrels only;
- random projectile shapes;
- max recoil;
- cosmetic loot crate/gacha reveals;
- temporary custom-room buffs and debuffs.

Exit criteria:

- Experiments are data-driven where possible.
- Cosmetic systems never gate gameplay power.
- Buffs/debuffs are temporary, readable, and optional.
- Anything that makes the core duel worse stays in party/custom modes.

## Milestone 8 — Playtest and Stress Harness

**Goal:** turn the prototype into something we can learn from with real people and multiple browser clients.

**Status:** playtest stress plan added on 2026-05-01. Remaining work: run the tests, record results, and tune the top issues.

Backlog scope:

- JJ-0801 — Create playtest stress plan.
- JJ-0802 — Run local combat and chaos-stack smoke tests.
- JJ-0803 — Run two-window online snapshot test.
- JJ-0804 — Run ten-tab lobby stress test.

Deliverables:

- [Playtest stress plan](playtest-stress-plan.md).
- Written results for local, 1v1, and lobby stress passes.
- Top-three fix list after each session.

Exit criteria:

- Two browser windows can start and move in one match.
- Ten lobby clients can join and ready without corrupting room state.
- Camera, chaos modifiers, and destructibles have clear playtest notes.

## Milestone 9 — Release Readiness

**Goal:** make the project handoff-friendly enough for external playtest builds.

**Status:** release checklist and root `verify` script added on 2026-05-01. Remaining work: production hosting notes and first tagged build.

Backlog scope:

- JJ-0901 — Add root verification command.
- JJ-0902 — Create release readiness checklist.
- JJ-0903 — Document production Convex deployment.
- JJ-0904 — Tag first external playtest build.

Deliverables:

- `npm run verify`.
- [Release readiness checklist](release-readiness-checklist.md).
- A repeatable ship/no-ship gate for playtest builds.

Exit criteria:

- Fresh install, typecheck, build, and local dev run are documented.
- One local combat loop and one two-window online flow pass before sharing a build.
- Known limits are listed beside the playtest build.

## Milestone 10 - Duel Flow Core

**Goal:** make one match progress through real rounds instead of an endless sandbox.

Backlog scope:

- JJ-1001 - Add round state machine: countdown, fighting, round over, reset.
- JJ-1002 - Add local and online score tracking.
- JJ-1003 - Add round timer and sudden-death fallback.
- JJ-1004 - Add death/out-of-bounds round winner detection.

Deliverables:

- Countdown before control starts.
- Round winner banner.
- First-to-target match score.
- Reset keeps selected character, chaos, and room context.

Exit criteria:

- A player can complete several rounds without manually pressing reset.
- The game clearly explains who won each round and why.

## Milestone 11 - Draft and Build Escalation

**Goal:** turn the Crystal Rounds data into the actual between-round comeback loop.

Backlog scope:

- JJ-1101 - Add draft scene/panel with three card choices.
- JJ-1102 - Award draft to the losing player first.
- JJ-1103 - Persist selected cards for the match session.
- JJ-1104 - Show opponent-readable build summaries.
- JJ-1105 - Add stack/cap feedback for unique and max-stack cards.

Deliverables:

- Three-card draft UI.
- Card pick confirmation.
- Applied cards carry into the next round.
- Compact in-match card/build summary.

Exit criteria:

- Losing a round gives a meaningful comeback choice.
- At least two selected builds feel different by round three.

## Milestone 12 - Pickups and Map Pressure

**Goal:** give players a reason to move through the arena instead of camping one angle.

**Status:** first local prototype added on 2026-05-01 with health shards, shield cells, and overcharge cores distributed across the expanded Boxworks world.

Backlog scope:

- JJ-1201 - Add pickup definitions to map data.
- JJ-1202 - Add health, shield/ability, and overcharge pickups.
- JJ-1203 - Add respawn timers and visible inactive states.
- JJ-1204 - Tune pickup placement around risky angles.
- JJ-1205 - Decide which pickup state must sync online.

Deliverables:

- Pickup icons and collection feedback.
- Temporary or charge-based effects only.
- Respawn timing that can be tuned from data.
- Written note on pickup sync authority.

Exit criteria:

- Pickups create visible map-control decisions.
- Pickups support draft/build play without replacing it.

## Milestone 13 - PvP Health, Shield, and Authority

**Goal:** make combat affect real players, not only dummies and local hazards.

Backlog scope:

- JJ-1301 - Add projectile targets for remote/online players.
- JJ-1302 - Apply player damage, shield mitigation, knockback, death, and respawn.
- JJ-1303 - Display compact local and opponent health/shield HUD.
- JJ-1304 - Choose client-authoritative prototype rules or server-side arbitration for hits.
- JJ-1305 - Document latency and trust limits.

Deliverables:

- Player projectiles can damage opponents.
- Shield state is visible and limited-use.
- Death triggers round flow.
- Health/shield snapshots include enough state for remote readability.

Exit criteria:

- Two players can fight to a round result.
- Shielding feels useful without stalling rounds forever.

## Milestone 14 - Results, Rematch, and Persistence

**Goal:** complete the MVP loop from room to results and back.

Backlog scope:

- JJ-1401 - Add results scene or results panel.
- JJ-1402 - Save match results to Convex.
- JJ-1403 - Add rematch and return-to-room actions.
- JJ-1404 - Show final score, cards picked, damage notes, and winner.

Deliverables:

- Match summary.
- Convex result write.
- Rematch flow.
- Return-to-lobby flow.

Exit criteria:

- A new player can host, play, finish, and rematch without developer controls.

## Milestone 15 - Cosmetic Loot Prototype

**Goal:** test loot-box/gacha presentation without adding gameplay power or monetization.

Backlog scope:

- JJ-1501 - Add placeholder cosmetic reward data.
- JJ-1502 - Add local loot-crate reveal animation.
- JJ-1503 - Add duplicate-handling rules.
- JJ-1504 - Keep rewards cosmetic-only and removable.

Deliverables:

- Cosmetic-only reveal prototype.
- No cards, stats, weapons, or characters gated behind loot.
- Documented guardrails for future monetization discussions.

Exit criteria:

- The reveal is fun but has zero effect on competitive power.

## Immediate Next Sprint

Recommended next sprint:

1. Finish Milestone 10 round flow.
2. Start Milestone 11 draft UI using the existing Crystal Rounds card data.
3. Tune Milestone 12 pickup placement after one local play pass.
4. Move Milestone 13 PvP damage authority from notes into code.

This sprint should end with a playable loop: menu, practice/room entry, round start, fight, round winner, draft choice, next round.
