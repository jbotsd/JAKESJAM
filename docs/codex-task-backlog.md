# JAKESJAM — Codex Task Backlog

This backlog is written as small, implementation-ready tasks. Each task should be used as a separate Codex prompt or GitHub issue.

---

## Phase 0 — Repository Bootstrap

### JJ-0001 — Create Project Skeleton

Create the repository folders:

```text
client/
convex/
docs/
assets/
tests/
```

Acceptance criteria:

- folders exist;
- root `README.md` exists;
- `docs/game-design-document.md` exists;
- root `AGENTS.md` exists.

### JJ-0002 — Scaffold Phaser + TypeScript + Vite Client

Create a Vite TypeScript client project under `client/` and install Phaser.

Acceptance criteria:

- `client/src/main.ts` starts a Phaser game;
- `BootScene` and `MatchScene` exist;
- `npm run dev` starts the client;
- `npm run typecheck` works.

### JJ-0003 — Scaffold Convex Backend

Create Convex backend folder and initial schema placeholder.

Acceptance criteria:

- `convex/schema.ts` exists;
- rooms and roomPlayers draft tables are represented;
- local Convex setup instructions are documented.

---

## Phase 1 — Offline Movement Playground

### JJ-0101 — Add Game Types

Create shared gameplay types.

Acceptance criteria:

- `PlayerState`, `WeaponDefinition`, `CardDefinition`, and `Vec2` exist;
- types are exported from a clear location;
- no circular imports.

### JJ-0102 — Create Boxworks Test Arena

Implement a simple test arena in `MatchScene`.

Acceptance criteria:

- floor, walls, and platforms exist;
- collision is visible;
- player spawn point exists;
- out-of-bounds reset exists.

### JJ-0103 — Implement Player Movement

Implement run, jump, gravity, and air control.

Acceptance criteria:

- A/D moves player;
- Space or W jumps;
- gravity and collision work;
- player cannot fall through platforms;
- movement constants are configurable.

### JJ-0104 — Add Movement Feel Helpers

Add coyote time and jump buffering.

Acceptance criteria:

- coyote time duration is configurable;
- jump buffer duration is configurable;
- behaviour can be disabled with constants;
- no TypeScript errors.

---

## Phase 2 — Offline Combat

### JJ-0201 — Add Aim Reticle

Add mouse aiming and visible aim reticle.

Acceptance criteria:

- aim angle updates with mouse;
- weapon muzzle points toward cursor;
- reticle is visible;
- debug angle can be logged or shown if needed.

### JJ-0202 — Implement Scrap Rifle Data

Create first weapon definition.

Acceptance criteria:

- Scrap Rifle has damage, fire rate, magazine, reload, projectile speed, spread, recoil, and knockback values;
- weapon values live in a data file;
- types enforce required fields.

### JJ-0202A — Add Projectile Modifier Types

Create typed projectile modifier data for the orthogonal weapon system.

Acceptance criteria:

- projectile shape supports circle, triangle, square, hexagon, and orb;
- projectile modifiers support count, range, fire rate, speed, size, recoil, pathing, element, and lifetime;
- pathing supports straight, bounce, boomerang, homing, and reverse/anti-homing as typed options;
- element/status supports neutral, fire, electric, sticky, and explosive as typed options;
- modifier values can be composed without hardcoding each card.

### JJ-0203 — Implement Projectile System

Implement projectile spawn, movement, collision, and despawn.

Acceptance criteria:

- left click fires projectile;
- projectile starts from muzzle;
- projectile moves at configured speed;
- projectile despawns on terrain hit;
- projectile despawns after lifetime expiry.

### JJ-0203A — Render Basic Projectile Shapes

Render projectile shapes from data.

Acceptance criteria:

- circle, triangle, square, hexagon, and orb projectiles are visually distinct;
- projectile hitbox can be tuned separately from visual size;
- projectile colour/effect can represent element/status;
- shape rendering remains readable against the test arena.

### JJ-0203B — Implement First Pathing Modifiers

Implement the first non-straight projectile behaviours.

Acceptance criteria:

- bounce projectile reflects from terrain with a configurable bounce count;
- boomerang projectile returns after max range or lifetime threshold;
- weak homing projectile curves toward a target with capped turn rate;
- reverse/anti-homing projectile curves away or delays its correction;
- all behaviours respect projectile lifetime and active projectile caps.

### JJ-0204 — Implement Health and Damage

Add dummy target or second local player target.

Acceptance criteria:

- projectile hit reduces health;
- hit feedback appears;
- health reaches zero;
- death event fires.

### JJ-0205 — Implement Offline Round Reset

Add round reset after death.

Acceptance criteria:

- dead player/target triggers round over;
- result banner appears;
- scene resets after short delay;
- score counter increments.

---

## Phase 3 — Convex Lobby Prototype

### JJ-0301 — Implement Room Schema

Create room and roomPlayers tables/functions.

Acceptance criteria:

- createRoom mutation exists;
- joinRoom mutation exists;
- leaveRoom or disconnect state exists;
- room code is generated.

### JJ-0302 — Implement Client Convex Connection

Connect Phaser client UI to Convex.

Acceptance criteria:

- client can call createRoom;
- client can call joinRoom by code;
- errors are displayed simply;
- connection config documented.

### JJ-0303 — Build Lobby Scene

Create lobby UI.

Acceptance criteria:

- room code visible;
- connected players visible;
- player name and colour visible;
- ready button exists;
- ready state updates across two browser windows.

### JJ-0304 — Add Chat or Emote Ping

Add minimal lobby communication.

Acceptance criteria:

- player can send short message or emote;
- other connected players receive it;
- messages are stored with roomId and playerId;
- spam control or basic limit exists.

---

## Phase 4 — Online Match Prototype

### JJ-0401 — Add Match State Transition

Start a match from lobby.

Acceptance criteria:

- host can start match when players ready;
- room status changes to in_match;
- clients transition to MatchScene;
- matchId or match state exists.

### JJ-0402 — Spawn Two Players Online

Create two-player match spawn logic.

Acceptance criteria:

- two players spawn at separate spawn points;
- local player is controllable;
- remote player is visually distinct;
- player names/colours persist from lobby.

### JJ-0403 — Add Low-Frequency Player Snapshot Sync

Sync player position snapshots through Convex at a throttled rate.

Acceptance criteria:

- local player writes snapshots no more than configured rate;
- remote player interpolates or smooths updates;
- two browser windows can see movement;
- write rate is documented.

### JJ-0404 — Submit Round and Match Results

Persist match result.

Acceptance criteria:

- round winner is recorded;
- match winner is recorded;
- result appears in ResultsScene;
- Convex stores matchResults entry.

---

## Phase 4A — Arena Physics and Destructibles

### JJ-04A1 — Add Destructible Object Types

Create data definitions for basic destructible arena objects.

Acceptance criteria:

- barrel, box, mine, and cube object types exist;
- each object has health, collision shape, damage response, and optional physics behaviour;
- objects can be placed in the test arena from data.

### JJ-04A2 — Implement Destructible Object Damage

Allow projectiles and explosions to damage destructible objects.

Acceptance criteria:

- boxes break after damage threshold;
- barrels explode or ignite after destruction;
- mines trigger on contact or damage;
- cubes can be pushed or used as temporary cover if physics is enabled.

### JJ-04A3 — Add Fire/Napalm Prototype

Implement the first fire status and map hazard loop.

Acceptance criteria:

- fire can be spawned by a weapon/card or barrel;
- fire deals damage over time in a small area;
- fire dissipates after a configurable duration;
- fire VFX does not hide players or projectiles;
- ownership is tracked for scoring/debugging.

---

## Phase 5 — Upgrade Cards

### JJ-0501 — Create Card Data

Create initial card definitions.

Acceptance criteria:

- at least 12 cards exist;
- each card has id, name, category, rarity, description;
- unique/maxStacks fields supported;
- cards are data-driven.

### JJ-0501A — Define Four Weapon Paths

Create the first curated weapon evolution paths.

Acceptance criteria:

- Blap path exists for fire rate and projectile count;
- Heavy path exists for damage, recoil, knockback, and large shapes;
- Trick path exists for bounce, boomerang, and split behaviours;
- Element path exists for fire/napalm/status effects;
- every path has at least three draftable cards.

### JJ-0502 — Implement Card System

Create CardSystem that applies card modifiers.

Acceptance criteria:

- cards can modify weapon stats;
- cards can modify movement stats;
- cards can modify projectile behaviour;
- stacking/caps are respected.

### JJ-0503 — Implement Draft Scene

Create draft UI after round loss.

Acceptance criteria:

- losing player sees 3 cards;
- player selects one;
- selected card is applied;
- next round begins;
- opponent can see selected card summary.

### JJ-0504 — Add Prototype Card Effects

Implement first practical card effects.

Acceptance criteria:

- Bigger Bullets works;
- Ricochet works;
- Heavy Rounds works;
- Quick Hands works;
- Air Control works;
- Panic Shield works.

### JJ-0505 — Add Orthogonal Prototype Cards

Add the first strange projectile/build cards.

Acceptance criteria:

- Boomerang Rounds works;
- Square Rounds works;
- Hex Rounds works;
- Homing Greed works and increases player size as a downside;
- Reverse Pull changes recoil behaviour;
- Orby Blap Blap fires slow orb clusters with projectile caps;
- Napalm Bloke creates short-lived fire patches.

### JJ-0506 — Add Character Stat Archetypes

Create the first four character stat identities.

Acceptance criteria:

- four character definitions exist;
- each character has health, movement, size, shield/ability, and weakness values;
- characters do not use permanent progression power;
- character choice is visible in lobby and match debug UI.

---

## Phase 6 — MVP Polish

### JJ-0601 — Add Basic Audio

Add placeholder sounds.

Acceptance criteria:

- gunshot sound;
- hit sound;
- jump/land sound;
- explosion sound if needed;
- card selection sound;
- volume constants exist.

### JJ-0602 — Add Additional Maps

Add two more arenas.

Acceptance criteria:

- three maps total;
- random or rotating map selection;
- maps have spawn points;
- maps do not break movement.

### JJ-0603 — Add Results Summary

Improve match end screen.

Acceptance criteria:

- winner shown;
- final score shown;
- selected cards shown;
- rematch button exists;
- return to lobby button exists.

### JJ-0604 — Deployment Build

Prepare browser deployment.

Acceptance criteria:

- production build succeeds;
- environment variables documented;
- deployment instructions written;
- smoke test checklist exists.
