# JAKESJAM - Changelog

## v0.25 - 2026-05-01

- Added actual health numbers and bars above local and remote player rigs.
- Added a respawn reconciliation guard so stale remote death snapshots do not repeatedly kill the player after respawn.
- Added shot sequencing to match player snapshots and visual-only remote projectile playback so other players' shots can be seen in online rooms.

## v0.24 - 2026-05-01

- Removed Pulse Nova from card progression and changed melee-mode firing away from pulse waves into close-range projectile spray.
- Added more stackable homing options, including Seeker Facets stacking, Micro Seekers, and Magnet Spray.
- Added extra projectile spray patterns with Shard Bloom, Wide Barrage, and Needle Hose.
- Made random card cache rolls less bucket-ordered and more chaotic, with extra weighting toward visible homing and multi-projectile mutations.

## v0.23 - 2026-05-01

- Added a small rechargeable Space-hold jetpack for higher traversal while keeping W as a clean jump input.
- Added jetpack fuel/debug readout beside player health and a small flame plume while the boost is active.
- Moved directional parry to right mouse button while keeping `C` as a keyboard fallback.
- Tuned jetpack fuel and lift upward so Space-hold can reach higher platform blocks reliably.

## v0.22 - 2026-05-01

- Reworked card progression so mutator cards can stack into outrageous builds instead of being hard-limited to one card per bucket.
- Added stackable projectile mutators for +1 projectile, +1 bounce, boomerang pathing, faster projectile velocity, X/I projectile shapes, projectile size changes, and fire-rate/size tradeoffs.
- Added shot cooldown tax based on projectile count, split count, bounce count, homing, beam delivery, and impact radius so fractured bullet builds have a balance cost.
- Added directional parry on `C` with a large cooldown, visible forward arc, no-block counterplay, and stackable card upgrades for wider cover and faster parry recovery.
- Added stackable health and movement cards to counter glass-cannon weapon builds.
- Added new arena pickups: damage amp, speed boost, melee mode, slow trap, vulnerability trap, block jammer, and boss core.
- Added boss pickup mode with bonus health, higher damage, slower movement, reduced fire rate, and a forced rotating bullet-pattern aim system.
- Changed card caches into seven roaming random-spawn pickups that relocate every 20 seconds instead of leaving card stacks everywhere on the map.
- Rebuilt standalone Host and Player HTML bundles with the new gameplay pass.

## v0.21 - 2026-05-01

- Added a first-run splash menu with Practice, Host, Join, and Options actions.
- Added menu music loop support using the supplied `ChatGPT Stickgame.wav` track.
- Added options for menu music volume, mute, and display resolution width.
- Added a held-Tab scoreboard overlay with per-player kills and deaths.
- Reworked 5x3 map expansion to use varied seeded room archetypes instead of repeated mirrored clones.
- Reduced the in-match HUD to only player health plus the active weapon and its current mutators.
- Changed player death into a full respawn sequence: explode, disappear, show taunt, count down 3 seconds, then respawn cleanly.
- Added louder card-cache weapon identity rolls: explicit circle, triangle, square, orb, and five-projectile spray mutators.
- Card caches now prioritize visible weapon changes such as delivery, projectile count, shape, pathing, impact, and element before subtle utility cards.
- Player death now resets collected weapon mutators back to the default starter weapon for the next life.
- Changed the weapon model back to the intended progression rule: every player starts from the default starter weapon and card pickups add mutators over time.
- Added card-cache pickups to the arena so collected cards rebuild the current weapon into divergent player-specific builds.
- Added deterministic variation to the 5x3 Boxworks grid so cells mirror, jitter, resize platforms, and place pickups/destructibles differently instead of being direct copies.
- Added player death explosion feedback with the requested on-screen taunt.
- Raised the room target from 6 players to 10-player all-v-all free-for-all support.
- Added prototype remote-player projectile targets, shield-aware damage snapshots, and remote damage writes for multiplayer hit sanity testing.
- Tuned starter weapon damage down from 15 to 10 after a 10-player sanity pass showed the baseline time-to-kill was too fast before card progression.

## v0.20 - 2026-05-01

- Fixed player gun aiming under camera-follow by feeding the procedural rig the same world-space aim target used by reticle and projectile firing.
- Cleared vertical traversal lanes in every 5x3 Boxworks grid cell by splitting blocking floor/mid platforms around a central shaft.
- Reworked row-to-row climb helpers so ledges sit beside the shaft instead of blocking the vertical entrance and exit path.
- Added a standalone HTML build path that emits single-file Host and Player pages for cross-platform Linux/Windows testing.
- Standalone pages now set their default client role and derive the Convex backend URL from the serving host, with a `?convex=` override for manual test routing.

## v0.19 - 2026-05-01

- Expanded Boxworks from a 5x2 world to a 5x3 grid.
- Added traversal connector platforms between copied grid blocks so rows and columns can be reached through normal movement.
- Changed local player spawning to choose a random spawn from the full expanded grid on reset/start.
- Allowed hosted room matches to start with a single ready player for solo hosted testing.

## v0.18 - 2026-05-01

- Split the lobby UI into Host and Player client roles.
- Host clients now own game setup: room creation, practice, match start, character test selection, and chaos modifier controls.
- Player clients now join by IP address, port, and room code while only exposing player identity fields for name and colour.
- Added displayed host IP/port fields based on the current browser location.
- Added player-side host IP/port inputs that redirect to the requested host client when needed.
- Added LAN host dev scripts and optional advertised host address/port environment overrides.
- Moved room chaos modifiers into Convex room state with a host-only settings mutation so players no longer carry private modifier state into online matches.

## v0.17 - 2026-05-01

- Extended the roadmap with post-M9 implementation milestones for full duel flow, pickup economy, PvP health authority, draft/results UX, and cosmetic-only loot experiments.
- Added map pickup definitions to the shared map data model.
- Added health shards, shield cells, and overcharge cores across the expanded Boxworks world.
- Added pickup collection, respawn timers, floating pickup feedback, HUD/debug pickup status, and a generated pickup sound.
- Shield cells now grant shield charge and temporary field-shield access, while overcharge temporarily boosts local damage and fire rate.

## v0.16 - 2026-05-01

- Added a first main-menu scene so the game boots into character, chaos, and room setup before entering the match loop.
- Added a local Practice button that starts a match from the current lobby-side character and chaos selections.
- Changed chaos selection updates to return to the main menu instead of immediately restarting live gameplay.
- Added local player health hooks for fire and explosion damage.
- Added held Shift shielding for shield-capable characters with limited charge, drain, recharge, and visible shield feedback.
- Confirmed card data/test loadouts exist, but real card collecting, draft rewards, and map pickup systems are still upcoming Milestone 5 work.

## v0.15 - 2026-05-01

- Added Milestone 9 release-readiness scope.
- Added root `npm run verify` to run typecheck and production build together.
- Added `docs/release-readiness-checklist.md` with smoke-test and ship/no-ship gates.
- Updated the running client build tag to M9.

## v0.14 - 2026-05-01

- Added Milestone 8 playtest and stress-harness scope.
- Added `docs/playtest-stress-plan.md` with local, chaos-stack, online 1v1, and six-tab lobby test procedures.
- Added a reusable playtest notes template and current known limitations.

## v0.13 - 2026-05-01

- Advanced to Milestone 7 with data-driven custom chaos modifiers.
- Added party toggles for Low Grav, Slo Mo, Golden Gun, Slappers Only, Fire Hazard, Random Shapes, and Max Recoil.
- Wired chaos modifiers into local/custom match behavior: gravity, time scale, damage, fire rate, projectile disabling, random projectile shape rerolls, arena fire hazards, and recoil.
- Persisted local chaos toggle selections and restarted the match scene when modifiers change.

## v0.12 - 2026-05-01

- Advanced to Milestone 6 with the first single-map MVP polish pass.
- Expanded Boxworks into a 10-screen world while keeping the visible game viewport at the original 960x540 size.
- Added camera bounds and camera follow so the player only sees the current local slice of the larger arena.
- Updated mouse aiming to convert screen pointer coordinates into world coordinates under the moving camera.
- Added generated placeholder audio for shooting, hits, jumping, landing, explosions, fire, and loadout/card changes.
- Updated the running client build tag to M6.

## v0.11 - 2026-05-01

- Advanced to Milestone 5 with the first playable character archetype integration.
- Added lobby character selection for Balanced, Heavy, Sprinter, and Shielded.
- Room players now carry selected character ids into match startup and the player list displays each player's archetype.
- MatchScene applies character movement speed, size scale, recoil control, max health metadata, and visual scale to local and remote player rigs.
- Updated the running client build tag to M5.

## v0.10 - 2026-05-01

- Added the first low-frequency online player snapshot loop for Milestone 4.
- Added Convex `matchPlayerSnapshots` storage plus submit/query functions for latest per-player match state.
- Extended the client room API to publish local position, velocity, aim angle, health, alive state, crouch state, and sequence at a capped rate.
- MatchScene now subscribes to match player snapshots and drives remote player rigs from subscribed room state.

## v0.9 - 2026-05-01

- Advanced to Milestone 4 with the first Convex lobby-to-match gameplay handoff.
- Lobby clients now dispatch match context when the room enters `in_match`, including room code, match id, local player id, and room players.
- MatchScene can start from room player data, place the local player in their spawn slot, and render remote room players with lobby names and colours.
- Updated the client build tag to M4 so the running prototype reflects the current milestone.

## v0.8 - 2026-05-01

- Advanced to Milestone 3 with a first playable destructible/fire arena pass.
- Made Boxworks barrels, boxes, mines, and cubes real projectile targets with health, hit flashes, break VFX, and reset behavior.
- Added explosive destructible reactions for barrels and mines with area damage against the dummy and nearby destructibles.
- Added temporary fire patches from fire impacts and flammable object destruction; fire damages flammable objects and dissipates after a short duration.
- Shortened the local player character by reducing the procedural rig scale and gameplay hitbox, while keeping crouch/standing muzzle origins aligned to the pose.

## v0.7 - 2026-05-01

- Reworked the offline combat prototype around the Crystal Rounds orthogonal weapon system.
- Added typed weapon buckets for Delivery, Trajectory, Quantity, Impact, Element, Utility, and Wild multi-bucket cards.
- Expanded prototype card data to 28 crystal-tech cards, including Raycast Prism, Pulse Nova, Homing Cluster, Cataclysmic Prism, and Sticky Ray.
- Added a WeaponSystem composer that resolves selected card hands into one playable Scrap Rifle / Crystal Blaster build while enforcing bucket ownership.
- Upgraded ProjectileSystem with projectile, raycast, continuous beam, and pulse delivery; gravity, float, homing, bounce, split, sticky, pierce, slow-field, and element-colour VFX hooks.
- Replaced debug shape switching with five test loadouts in MatchScene for quick local synergy testing.

## v0.6 - 2026-05-01

- Advanced to Milestone 2 with the first playable offline combat loop.
- Added aim reticle and aim line from player muzzle to mouse target.
- Added Starter Pistol / Crystal Blaster projectile firing with recoil and fire-rate cooldown.
- Added projectile system with range, lifetime, terrain collision, target collision, shape rendering, and element glow colours.
- Added debug projectile shape switching on number keys 1-5 for circle, triangle, square, hexagon, and orb.
- Added dummy target health, hit knockback, score, death banner, and round reset.

## v0.5 - 2026-05-01

- Advanced to Milestone 1 with a playable offline Boxworks movement playground.
- Added Boxworks collision platforms, side walls, spawn markers, and placeholder destructible props.
- Added manual movement system with acceleration, friction, gravity, fast fall, variable jump cut, coyote time, and jump buffering.
- Added controllable procedural placeholder player rig, aim-facing gun line, out-of-bounds/reset handling, and debug overlay for position, velocity, grounded state, coyote timer, and jump buffer timer.
- Added grounded crouch on `S`, keeping airborne `S` as fast fall.
- Split player rig poses so crouch keeps the compact bent-leg stance while standing uses taller, straighter legs.
- Updated the game boot flow to open directly into the playable match scene.

## v0.4 - 2026-05-01

- Scaffolded Milestone 0 as an npm workspace.
- Added Phaser + TypeScript + Vite client under `client/`.
- Added Convex schema, generated API files, and room functions for host, join, ready, heartbeat, leave, and start-match placeholder flow.
- Configured anonymous local Convex development for `http://127.0.0.1:3210`.
- Added host/join browser UI with room code, player name/colour, ready state, and connected player list.
- Added starter gameplay data files for weapon, projectile modifiers, characters, cards, and Boxworks map/destructible placeholders.
- Added local setup commands and checks to `README.md`.
- Added future client-side prediction and server reconciliation direction from Gabriel Gambetta's networking article.

## v0.3 - 2026-05-01

- Captured art reference direction: low-fi side-view arena readability, rough painted terrain, bright projectile/action accents, tiny expressive fighters, compact HUD, optional saturated teal/lime map palettes, and procedural 2D IK puppet animation.
- Added stronger orthogonal weapon mutation direction around one shared starter pistol/projectile.
- Clarified that the baseline should feel like a simple raycast shooter while using visible projectiles for readability and upgrade expression.
- Added character stat archetype and active shield/ability button direction.
- Added milestone roadmap document for project sequencing.
- Clarified MVP target as one main map with up to 6-player stress testing, four weapon paths, four characters, and four destructible elements.
- Added pickup, loot crate, cosmetic-only loot/gacha, and temporary buff/debuff boundaries.
- Added post-MVP dice modifier tasks for low gravity, 4x map, slow motion, golden gun, slappers only, Big Purp Dilly Mode, fire hazard rounds, exploding barrels only, random projectile shapes, and max recoil.

## v0.2 - 2026-05-01

- Added orthogonal projectile/build design direction.
- Defined projectile shape variables: circle, triangle, square, hexagon, and orb.
- Added four weapon evolution paths: Blap, Heavy, Trick, and Element.
- Added homing/tradeoff examples such as Homing Greed and Orby Blap Blap.
- Added destructible arena object direction: barrels, boxes, mines, and cubes.
- Added fire/napalm status system direction.
- Updated MVP target notes for up to 6 players, one main map, four characters, four weapon paths, and four destructible elements.
- Added implementation backlog tasks for projectile modifiers, destructibles, fire, weapon paths, and character archetypes.

## v0.1 - 2026-05-01

- Created production-ready GDD.
- Locked prototype around 1v1 browser-first 2D platform shooter.
- Added Phaser + TypeScript + Vite + Convex technical direction.
- Added Codex-ready task backlog.
- Deferred Java simulation server until prototype testing proves need.
