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

### JJ-0203 — Implement Projectile System

Implement projectile spawn, movement, collision, and despawn.

Acceptance criteria:

- left click fires projectile;
- projectile starts from muzzle;
- projectile moves at configured speed;
- projectile despawns on terrain hit;
- projectile despawns after lifetime expiry.

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

## Phase 5 — Upgrade Cards

### JJ-0501 — Create Card Data

Create initial card definitions.

Acceptance criteria:

- at least 12 cards exist;
- each card has id, name, category, rarity, description;
- unique/maxStacks fields supported;
- cards are data-driven.

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
