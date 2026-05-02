# JAKESJAM Domain Glossary

Shared vocabulary used across sim, server, client, and netcode. Use these
terms exactly — no synonyms ("entity" vs "actor", "match" vs "session").

## ✅ Active Skills Context (15 total)

When the user mentions keywords related to the 15 skills, also read:

- `.agents/skills/ROOT-SKILL.md` — Master routing matrix
- The matching `.claude/skills/<name>/SKILL.md` or `.agents/skills/convex/*.SKILL.md`

### Hard Triggers (always load matching skill)

```regex
(phaser|Scene|Sprite|GameObject|Atlas|Loader)      → phaser4-game
(determinism|simulation|RNG|seed|prediction)       → game-sim-determinism
(netcode|Snapshot|interpolation|msgpack)           → game-netcode
(60 FPS|frame|stutter|jitter|accumulator)          → game-loop-perf
(TTK|combat|weapon|parry|dodge)                    → combat-balance-ttk
(juice|shake|hit-stop|particle)                    → game-feel-juice
(TypeScript|satisfies|branded|escap)               → ts-pocock
(MMR|Glicko|Elo|OpenSkill|rating|matchmaking)      → matchmaking-skill-rating
(test|bun:test|determinism test)                   → sim-tests
(replay|spectator|POV)                            → replay-spectator
(card|draft|rogue-lite|synergy|pick rate)          → roguelite-draft-design
(onboarding|FTUE|tutorial|first time)              → onboarding-ftue
(fly|Dockerfile|deploy|server|Fly\.io)             → fly-game-deploy
(architecture|refactor|module|interface|seam)      → improve-codebase-architecture
(Convex|schema|migration|auth|component)           → convex/ROOT-SKILL.md, etc.
```

### Skill Domains Quick Reference

| Domain | File Path |
| ------ | --------- |
| Phaser 4 Client | `.claude/skills/phaser4-game/SKILL.md` |
| Shared Simulation | `.claude/skills/game-sim-determinism/SKILL.md` |
| Netcode | `.claude/skills/game-netcode/SKILL.md` |
| 60 FPS Perf | `.claude/skills/game-loop-perf/SKILL.md` |
| Combat Balance | `.claude/skills/combat-balance-ttk/SKILL.md` |
| Game Feel | `.claude/skills/game-feel-juice/SKILL.md` |
| TS Discipline | `.claude/skills/ts-pocock/SKILL.md` |
| Matchmaking | `.claude/skills/matchmaking-skill-rating/SKILL.md` |
| Sim Testing | `.claude/skills/sim-tests/SKILL.md` |
| Replay | `.claude/skills/replay-spectator/SKILL.md` |
| Rogue-lite | `.claude/skills/roguelite-draft-design/SKILL.md` |
| FTUE | `.claude/skills/onboarding-ftue/SKILL.md` |
| Infra | `.claude/skills/fly-game-deploy/SKILL.md` |
| Arch | `.claude/skills/improve-codebase-architecture/SKILL.md` |
| Convex Workflow | `.agents/skills/convex/SKILL.md` |

For details, see `SKILLS.md` (all 15 skills, 126KB, 125 sections).

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

## Active Skills Workflow

When the user mentions a domain keyword, Pi will:

1. **Read the matching SKILL.md file(s)** from `.claude/skills/` or `.agents/skills/`
2. **Parse keywords** against ROOT-SKILL.md's routing matrix
3. **Load additional related skills** if the domain intersects
4. **Apply skill-specific rules** from the domain guide
5. **Execute tools** (read, grep, find, edit, bash) against the target files

### Example: "The prediction keeps snapping after a kill"

**Keyword match:** "determinism"/"prediction" → `game-sim-determinism` + `game-netcode` + `game-feel-juice`

**Loaded context:**
- `.claude/skills/game-sim-determinism/SKILL.md` (events, soft determinism, RNG)
- `.claude/skills/game-netcode/SKILL.md` (reconciliation, interpolation)
- `.claude/skills/game-feel-juice/SKILL.md` (kill stack, hit-stop)

**Tool execution:**
```bash
# Grep the event flow for the kill
grep -r "projectileImpacted" client/src/sim/ server/src/

# Check if the kill event pauses anything (shouldn't)
grep -r "projectileImpacted" client/src/game/
```

**Expected answer:** "The kill event triggers `projectileImpacted`. Check if
`MatchScene` or `OnlineMatchScene` pauses the sim loop (should only pause
`tweens.timeScale`, not the sim tick)."

### Example: "Setup auth and Convex for the new project"

**Keyword match:** "Convex"/"auth"/"project" → `convex-quickstart` + `convex-setup-auth`

**Loaded context:**
- `.agents/skills/convex-quickstart/SKILL.md` (scaffolding, setup)
- `.agents/skills/convex-setup-auth/SKILL.md` (providers, users, roles)

**Tool execution:**
```bash
# Check if Convex AI files are installed
ls -la convex/ai-files/

# Check existing auth setup
ls -la convex/auth.* 2>/dev/null || echo "No auth config yet"
```

**Expected answer:** Ask which auth provider, then scaffold or integrate:
```bash
# For new Convex backend
npx convex ai-files install
```

### Example: "Make the game feel juicier"

**Keyword match:** "juice"/"feel" → `game-feel-juice`

**Loaded context:**
- `.claude/skills/game-feel-juice/SKILL.md` (hit-stop, shake, particles)

**Tool execution:**
```bash
# Check the kill stack implementation
grep -A 30 "onPlayerKilled" client/src/game/systems/StatusVfxController.ts

# Verify no sim-layer pause
grep -r "projectile.*Impacted" client/src/sim/
```

**Expected answer:** Review against Nijman's checklist: 30ms kill-stop, 180ms
kill-shake, 24-particle burst, random pitch ±10%, etc.

### Example: "Review combat balance"

**Keyword match:** "combat"/"weapon"/"TTK" → `combat-balance-ttk`

**Loaded context:**
- `.claude/skills/combat-balance-ttk/SKILL.md` (TTK 1.8-3.5s, 4 archetypes)

**Tool execution:**
```bash
# Check weapons TTK against the 1.8-3.5s band
bun test client/src/sim/__tests__/weaponBuild.test.ts

# Review the 4 weapon archetypes
grep -r "WEAPONS" client/src/sim/data/weapons.ts
```

**Expected answer:** Verify TTK band compliance, check dodge windows (≥250ms),
parry timing (120-180ms), etc.

## File Locations by Domain

| Domain | Primary Files |
| ------ | ------------- |
| Sim core | `client/src/sim/World.ts`, `client/src/sim/combat.ts`, `client/src/sim/projectile.ts` |
| Sim data | `client/src/sim/data/weapons.ts`, `client/src/sim/data/cards.ts`, `client/src/sim/data/chaosModifiers.ts` |
| Sim tests | `client/src/sim/__tests__/`, runs with `bun test` |
| Net layer | `client/src/net/clientLoop.ts`, `client/src/net/interpolationBuffer.ts`, `client/src/net/protocol.ts` |
| Server | `server/src/matchHost.ts`, `server/src/protocol.ts`, `server/src/convexClient.ts` |
| Render | `client/src/game/scenes/MatchScene.ts`, `client/src/game/systems/` |
| Convex | `convex/`, runs with `npx convex dev` |

## Quick Commands

```bash
# Run sim tests
bun test client/src/sim/__tests__/

# Run netcode/performance tests
bun test client/src/net/__tests__/

# Run typecheck
bun run typecheck

# Run full suite
bun run test

# Start convext dev
npx convex dev

# Start frontend
bun --hot ./index.ts

# Check all 15 skills exist
bun read SKILLS.md | head -20
```
