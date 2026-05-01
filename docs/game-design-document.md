# JAKESJAM — Game Design Document

**Version:** 0.1  
**Status:** Pre-production / prototype-ready draft  
**Date:** 2026-05-01  
**Primary format:** Markdown, intended for repository use and AI-assisted development  
**Source input:** Team discussion plus the engine/multiplayer handoff document  

---

## 0. Design Snapshot

### Working Title

**JAKESJAM**

The name is treated as a working title until branding is locked.

### One-Sentence Pitch

**JAKESJAM is a browser-first 2D multiplayer arena platform shooter where players use fast movement, punchy weapons, and round-to-round upgrade drafting to turn simple gunfights into escalating physics-driven chaos.**

### Genre

2D arena platform shooter / PvP party shooter / round-based competitive action game.

### Core References

The team reference direction is:

- **Soldat-like:** fast side-view platform shooting, readable projectile combat, arena movement, short life-or-death engagements.
- **ROUNDS-like:** short duels, comeback-oriented upgrade drafting, escalating builds, absurd but readable combat outcomes.

These references are directional only. The game should not clone either reference. JAKESJAM should be defined by browser-first accessibility, readable chaos, and upgrade-driven tactical nonsense.

### Primary Platform

Browser-first PC game.

### Secondary Platform Goals

- Desktop wrapper build later if needed.
- Controller support later if the core mouse/keyboard game works.
- Mobile is not a launch target unless the design is heavily simplified.

### Target Session Length

- Single round: **15–60 seconds**
- Full match: **5–12 minutes**
- Lobby-to-action target: **under 30 seconds once a room exists**

### Target Player Count

Prototype:

- 1v1 online duel
- 1 local test player plus dummy/bot target for offline tuning

MVP:

- 1v1 online duel
- 2–4 player free-for-all experimental mode, if networking feel allows it

Future:

- 2v2 teams
- custom lobbies
- party modifiers
- map rotation
- private rooms

---

## 1. Design Pillars

Every feature should support at least one of these pillars. If a feature does not support one, it should be cut, delayed, or redesigned.

### Pillar 1 — Fast, Physical Gunfights

Combat should feel immediate, kinetic, and physical. The player should understand why they died, but the moment-to-moment action should still feel wild.

Design implications:

- Strong movement readability.
- Clear projectile paths or impact feedback.
- Knockback, recoil, explosions, and bounce interactions should feel satisfying.
- Weapons should create different movement and positioning problems.
- Deaths should feel like the result of a readable chain of events, not random noise.

### Pillar 2 — Escalating Builds, Not Static Loadouts

A match should become more ridiculous over time because players make upgrade choices between rounds.

Design implications:

- Players draft upgrades from a small set of options.
- Upgrades should stack into surprising combinations.
- The losing or disadvantaged player should get tools to come back.
- Upgrades should change decisions, not only increase numbers.
- Builds should be visible and understandable to opponents.

### Pillar 3 — Browser-First Multiplayer Accessibility

The game should be easy to run, easy to share, and easy to contribute to.

Design implications:

- Phaser + TypeScript client.
- Vite-based local development.
- Convex for rooms, lobbies, profiles, and low-frequency multiplayer state.
- Java simulation server only if proven necessary later.
- Short tasks and clear documentation for Codex and human contributors.

---

## 2. Core Player Fantasy

The player should feel like a tiny armed maniac in a compact arena, using movement, aim, positioning, recoil, and absurd upgrades to survive impossible fights.

The fantasy is not military realism. It is:

- scramble through platforms;
- dodge bullets by a few pixels;
- land a lucky grenade bounce;
- get launched by an explosion and still win;
- pick an upgrade that makes the next round disgusting;
- laugh when the physics produce a beautiful disaster.

The game should be competitive enough to be replayable, but silly enough that losing is funny.

---

## 3. Core Game Loop

### Match Loop

```text
Enter lobby
  -> Ready up
  -> Load map
  -> Spawn into round
  -> Move, aim, shoot, dodge
  -> Player dies or objective resolves
  -> Round winner is declared
  -> Disadvantaged player drafts upgrade
  -> Next round begins
  -> Match ends at score target
  -> Results saved
  -> Return to lobby or rematch
```

### Moment-to-Moment Loop

```text
Read opponent position
  -> Move to better angle
  -> Fire or bait shot
  -> Use terrain for cover
  -> React to projectile / explosion / knockback
  -> Secure hit or escape
  -> Reload / reposition / finish
```

### Upgrade Loop

```text
Lose or fall behind
  -> Choose one card from a small draft
  -> Card modifies weapon, body, defense, movement, or projectile behavior
  -> New build creates new tactics
  -> Opponent adapts
```

---

## 4. Game Modes

### 4.1 Prototype Mode — 1v1 Duel

This is the first real gameplay target.

**Rules:**

- Two players enter one arena.
- Each player has one life per round.
- Last player alive wins the round.
- First to a configurable score wins the match.
- The player who loses the round receives an upgrade draft.
- If the same player loses multiple rounds, their build should become increasingly threatening.

**Default prototype settings:**

| Setting | Value |
|---|---:|
| Players | 2 |
| Lives per round | 1 |
| Round time limit | 60 seconds |
| Match target | First to 5 round wins |
| Upgrade draft | Losing player picks 1 of 3 cards |
| Draw state | Sudden death or both players damaged |

### 4.2 MVP Mode — Duel With Private Rooms

The MVP should support:

- private room code;
- host starts match;
- ready state;
- rematch flow;
- basic player names and colours;
- match result persistence.

### 4.3 Stretch Mode — Free-for-All Deathmatch

A more Soldat-like mode with respawns.

**Rules:**

- 2–4 players.
- Respawn after death.
- Score by kills.
- Short time limit or kill limit.
- Upgrade drafting may happen every few deaths or between mini-rounds.

This mode should not block the 1v1 duel prototype.

### 4.4 Future Modes

Possible future modes:

- 2v2 Team Duel
- King of the Hill
- Gun Game
- Capture the Flag
- Juggernaut
- Random Mod Party Mode
- Custom Cards Lobby
- Workshop/custom maps, if tooling exists

---

## 5. Player Controls

### 5.1 Keyboard and Mouse Baseline

| Action | Input |
|---|---|
| Move left/right | A / D |
| Jump | W or Space |
| Aim | Mouse cursor |
| Fire primary | Left mouse button |
| Secondary / alt-fire | Right mouse button |
| Reload | R |
| Throw grenade / utility | G or middle mouse |
| Interact / ready | E |
| Pause / menu | Esc |
| Scoreboard | Tab |

### 5.2 Controller Stretch Goal

Controller support is not required for the first prototype. If added later:

| Action | Input |
|---|---|
| Move | Left stick |
| Aim | Right stick |
| Jump | A / Cross |
| Fire | Right trigger |
| Alt-fire | Left trigger |
| Reload | X / Square |
| Grenade | Right bumper |

### 5.3 Control Design Rules

- Movement must be readable before it is complex.
- Aim should be decoupled from movement.
- Rebinding should be considered after the first playable prototype.
- The first prototype should not include too many movement abilities at once.

---

## 6. Movement System

Movement is the backbone of the game. The shooter only works if moving, dodging, and repositioning feel good.

### 6.1 Prototype Movement Set

Prototype should include:

- run left/right;
- jump;
- air control;
- fast fall or gravity tuning;
- landing feedback;
- simple collision against platforms and walls.

Optional in prototype, only if movement feels too plain:

- double jump;
- short dodge burst;
- limited jetpack/boost;
- wall jump.

### 6.2 MVP Movement Set

Recommended MVP movement:

- run;
- jump;
- air control;
- double jump or boost, but not both initially;
- knockback from weapon hits and explosions;
- platform drop-through on selected platforms;
- coyote time and jump buffering for better feel.

### 6.3 Movement Tuning Targets

These are starting values only. They should be tuned through playtesting.

| Variable | Starting Target |
|---|---:|
| Ground max speed | 220–320 px/s |
| Ground acceleration | Snappy, under 0.25s to max speed |
| Jump height | 90–140 px |
| Time to apex | 0.3–0.45s |
| Air control | 60–85% of ground steering |
| Coyote time | 80–120 ms |
| Jump buffer | 80–120 ms |

### 6.4 Movement Feel Requirements

Movement should be:

- responsive, not floaty;
- generous enough for casual play;
- precise enough for skill expression;
- readable at high speed;
- resilient under latency or visual delay.

### 6.5 Movement Risks

| Risk | Mitigation |
|---|---|
| Too slow | Increase air control and acceleration before adding abilities |
| Too chaotic | Reduce stacked speed upgrades and knockback scaling |
| Too hard for new players | Add coyote time, jump buffering, and clear map collision |
| Too much latency sensitivity | Keep client-side movement responsive and avoid relying on Convex for per-frame authority |

---

## 7. Combat System

### 7.1 Combat Goals

Combat should feel like quick platform-fighting gun chaos. The player should constantly make small decisions:

- take the angle or retreat;
- jump now or hold cover;
- shoot directly or bank a projectile;
- reload now or risk one more shot;
- choose high ground or chase damage;
- exploit the current upgrade build.

### 7.2 Projectile Model

The recommended prototype model is **projectile-based combat**, not pure hitscan.

Reasons:

- projectile travel is readable;
- projectile upgrades are easier to visualize;
- bounce, split, gravity, explosive, and homing modifiers become more interesting;
- networked reconciliation can be approximated visually before full authority exists.

Hitscan weapons may exist later as special cases.

### 7.3 Health and Damage

Prototype default:

| Setting | Value |
|---|---:|
| Player health | 100 |
| Base bullet damage | 12–20 |
| Grenade damage | 40–80 with falloff |
| Environmental hazard damage | TBD |
| Death condition | Health <= 0 or out-of-bounds |

### 7.4 Weapon Requirements

Each weapon must define:

- name;
- weapon class;
- damage;
- fire rate;
- projectile speed;
- projectile lifetime;
- projectile gravity;
- spread;
- recoil;
- knockback;
- reload time;
- magazine size;
- visual trail;
- sound profile;
- upgrade compatibility.

### 7.5 Prototype Weapon

Start with one weapon.

**Name:** Scrap Rifle  
**Class:** baseline automatic or semi-automatic rifle  
**Purpose:** prove movement, aiming, hit detection, knockback, reload, and damage loop  

Starting values:

| Variable | Value |
|---|---:|
| Damage | 15 |
| Fire rate | 4 shots/sec |
| Magazine | 8 |
| Reload time | 1.1 sec |
| Projectile speed | 650 px/s |
| Projectile lifetime | 1.2 sec |
| Spread | low |
| Recoil | light |
| Knockback | medium-light |

### 7.6 MVP Weapon Set

Keep the first weapon list small.

| Weapon | Role | Notes |
|---|---|---|
| Scrap Rifle | Baseline | All-rounder, easiest to tune |
| Scattergun | Close range | High knockback, wide spread |
| Heavy Pistol | Precision | Slow, high impact |
| Launcher | Area denial | Slow projectile, explosive splash |
| Needler / SMG | Pressure | Low damage, high rate |

Do not add more than five weapons before upgrade cards are fun.

### 7.7 Grenades and Utility

Grenades are optional for prototype. If added:

- one grenade per round;
- visible arc preview optional;
- bounce off terrain;
- fuse timer;
- explosion radius with damage falloff;
- knockback more important than raw damage.

### 7.8 Combat Feedback Requirements

Every shot should communicate:

- muzzle flash;
- sound;
- projectile trail or visible bullet;
- impact spark/dust;
- hit marker or hit flash;
- knockback response;
- damage number optional, not mandatory;
- death burst/ragdoll/animation.

---

## 8. Upgrade Card System

The upgrade card system is the main long-term differentiator. It turns short fights into evolving builds.

### 8.1 Design Goal

Cards should create new tactics and funny combinations without making the game unreadable.

Good card:

- changes how the player plays;
- can be understood quickly;
- has visible feedback;
- stacks in interesting but bounded ways;
- creates opponent adaptation.

Bad card:

- only gives +5% to a stat;
- silently changes something invisible;
- creates instant wins;
- removes counterplay;
- requires a spreadsheet to understand.

### 8.2 Draft Rules

Prototype:

- losing player drafts one card after losing a round;
- draft presents three random choices;
- selected card applies for the rest of the match;
- cards can stack unless explicitly marked unique;
- winner does not draft by default.

MVP options:

- player behind by 2+ rounds may receive stronger rarity weighting;
- both players may draft after every two rounds, with loser choosing first;
- duplicate cards may be limited to prevent runaway builds.

### 8.3 Card Categories

| Category | Function | Examples |
|---|---|---|
| Weapon | Changes shooting | split shot, bounce, faster reload |
| Projectile | Changes bullet behaviour | gravity bullets, ricochet, explosive rounds |
| Movement | Changes body control | double jump, dash, speed, wall kick |
| Defense | Helps survive | shield, armour, regen, damage reduction |
| Utility | Adds tactical options | grenade, blink, trap, smoke |
| Curse/Tradeoff | Power with downside | more damage but slower reload |

### 8.4 Prototype Card List

Start with 12–18 cards. This is enough to test drafting without exploding scope.

| Card | Category | Effect | Risk |
|---|---|---|---|
| Bigger Bullets | Projectile | Projectile hitbox increases slightly | Can become unfair if stacked too hard |
| Ricochet | Projectile | Bullets bounce once off terrain | Can clutter arenas |
| Split Shot | Weapon | Fires two weaker angled bullets | Can overwhelm visuals |
| Heavy Rounds | Weapon | More damage and knockback, slower fire rate | May create burst dominance |
| Quick Hands | Weapon | Faster reload | Low excitement if alone |
| Spray & Pray | Weapon | Higher fire rate, more spread | Can become spammy |
| Rocket Feet | Movement | Increased jump impulse | May break maps |
| Air Control | Movement | Better steering while airborne | Strong but readable |
| Panic Shield | Defense | Small shield at round start | Could slow rounds |
| Last Chance | Defense | Survive one lethal hit at 1 HP | Must be visibly telegraphed |
| Boom Bullets | Projectile | Every Nth shot has small explosion | Needs strict VFX control |
| Vampire Hit | Defense | Heal a little on confirmed hit | Can drag rounds if too high |
| Glass Cannon | Tradeoff | More damage, lower max health | Good readable risk |
| Lead Boots | Tradeoff | More knockback resistance, less jump height | Map-dependent |
| Grenadier | Utility | Gain one grenade per round | Needs grenade system |
| Blink Tap | Utility | Short directional blink with cooldown | High complexity; stretch card |

### 8.5 Card Rarity

Recommended rarity tiers:

- Common: direct, easy-to-understand stat or behaviour changes.
- Uncommon: stronger tactical effects.
- Rare: build-defining effects.
- Cursed: strong effects with downsides.

Prototype can ignore rarity and simply use a curated draft pool.

### 8.6 Card Stacking Rules

Initial stacking rules:

- Cards may stack by default.
- Unique cards cannot repeat.
- Stat cards must have soft caps.
- Projectile count should have a hard cap.
- Explosion and bounce cards should have strict limits.
- Movement cards must be tested against every map.

Suggested caps:

| Stat | Cap Direction |
|---|---|
| Fire rate | Do not exceed animation/readability threshold |
| Projectile count | Hard cap at 5 active child projectiles per shot initially |
| Bounces | Hard cap at 2 initially |
| Movement speed | Soft cap with diminishing returns |
| Damage reduction | Hard cap to prevent immortality |
| Lifesteal | Low cap; never heal more than damage dealt |

### 8.7 Card UI Requirements

Each card must show:

- name;
- icon placeholder;
- short one-line effect;
- category;
- rarity colour or marker;
- stack count if already owned;
- warning if unique or capped.

Card text should be short enough to read under pressure.

Example:

```text
RICHOCHET
Bullets bounce once off walls.
```

Not:

```text
Projectiles now calculate collision response against map geometry and preserve 65% of velocity after reflecting based on surface normal.
```

---

## 9. Arena and Level Design

### 9.1 Arena Goals

Arenas should create fast fights with clear movement options.

Good arena:

- has at least two routes between major zones;
- includes cover but not camping fortresses;
- supports vertical play;
- has safe-ish spawns;
- creates interesting projectile bounces;
- remains readable with upgrades active.

Bad arena:

- one dominant high ground;
- too many tiny platforms;
- no cover;
- spawn traps;
- visual clutter over collision clarity;
- geometry that breaks movement cards.

### 9.2 Prototype Arena

**Map Name:** Boxworks  
**Purpose:** test core combat and movement  

Required elements:

- left and right spawn points;
- central platform;
- lower route;
- two vertical cover pieces;
- out-of-bounds kill plane;
- no moving platforms;
- no hazards.

Suggested dimensions:

| Property | Value |
|---|---:|
| Logical game area | 1280 x 720 |
| Collision tile size | 16 or 32 px |
| Spawn separation | Enough to prevent instant first shot |
| Round camera | Single-screen arena initially |

### 9.3 MVP Arena Set

| Map | Purpose |
|---|---|
| Boxworks | Baseline symmetrical duel |
| Pitline | Tests vertical knockback and recovery |
| Pipeworks | Tests ricochet and cover |
| Rooftops | Tests long sightlines and jumping |
| Crusher Test | Optional hazard map |

### 9.4 Map Rules

- All collision should be visually obvious.
- Avoid decorative foreground elements that look solid but are not.
- Keep first maps single-screen to reduce camera/network complexity.
- Each map should support at least three combat ranges: close, mid, and risky long angle.
- Every spawn must have immediate movement choice.

---

## 10. Match Flow

### 10.1 Lobby Flow

```text
Main menu
  -> Create room or join room
  -> Room lobby
  -> Players choose name/colour
  -> Players ready up
  -> Host starts match or auto-start when all ready
  -> Match scene loads
```

### 10.2 Round Flow

```text
Countdown
  -> Players spawn
  -> Round active
  -> Combat
  -> Death / timeout / draw
  -> Result banner
  -> Draft phase if required
  -> Next round countdown
```

### 10.3 Match End Flow

```text
Score target reached
  -> Winner shown
  -> Build summary shown
  -> Match result saved
  -> Rematch or return to lobby
```

### 10.4 Draw Handling

Draws are dangerous because they can stall match flow.

Prototype options:

1. If both players die within 500 ms, no one scores and both draft.
2. If time expires, sudden death begins.
3. During sudden death, arena shrinks or both players take slow damage.

Recommended prototype:

- Time expires at 60 seconds.
- Sudden death begins.
- Both players slowly take unavoidable damage after a warning.

---

## 11. Multiplayer and Networking Design

### 11.1 Technical Direction

The project should start as a browser-first multiplayer game using:

- Phaser + TypeScript for the game client;
- Vite for frontend build tooling;
- Convex for realtime platform/backend features;
- optional future Java WebSocket service only if required for authoritative high-frequency simulation.

### 11.2 Multiplayer Philosophy

The first multiplayer goal is not perfect esports netcode. The first goal is to prove that two players can join a room, see each other, start a match, play a rough duel, and finish with saved results.

The project should avoid overengineering before the core game is fun.

### 11.3 Convex Responsibilities

Convex should be used for:

- authentication/player identity;
- player profiles;
- lobby creation;
- room lists;
- join/leave room;
- ready checks;
- chat and emotes;
- match setup;
- low-frequency shared room state;
- match results;
- persistent unlocks/cosmetics;
- development admin/debug metadata.

### 11.4 Convex Should Not Initially Handle

Convex should not initially be treated as a 60 FPS simulation server for:

- per-frame player movement;
- every projectile tick;
- twitch combat authority;
- deterministic physics;
- high-frequency anti-cheat-critical state;
- rollback networking.

### 11.5 Prototype Sync Model

Prototype model:

- local Phaser client simulates own movement immediately;
- local client writes throttled player snapshots to Convex;
- other clients subscribe and interpolate remote snapshots;
- match room state is authoritative in Convex;
- combat may initially be client-declared for testing;
- authoritative combat can be revisited after feel is proven.

Suggested snapshot fields:

```ts
export type PlayerSnapshot = {
  playerId: string;
  roomId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimAngle: number;
  health: number;
  activeWeaponId: string;
  animationState: string;
  sequence: number;
  updatedAt: number;
};
```

### 11.6 Write Throttling

Do not write every frame to Convex.

Initial targets:

| Data | Suggested Rate |
|---|---:|
| Lobby/ready state | On change |
| Chat/emotes | On event |
| Player position snapshot | 5–15 Hz for prototype tests |
| Match result | Once at match end |
| Draft choice | Once per selection |

If 5–15 Hz position writes feel bad or too expensive, keep Convex for platform state and introduce a dedicated simulation transport later.

### 11.7 Future Authoritative Server Trigger Conditions

Add a dedicated Java WebSocket simulation server only if one or more of these become true:

- Convex position updates feel too delayed for the intended game pace.
- Combat disagreement between clients becomes unacceptable.
- Cheating prevention becomes important.
- More than 2 players creates state conflict problems.
- Projectile-heavy builds need server authority.
- The game needs tick-based replays or validation.

### 11.8 Future Java Server Responsibilities

If added, the Java server should handle:

- authoritative player movement;
- collision validation;
- projectile spawning and lifetime;
- combat resolution;
- anti-cheat checks;
- tick-based simulation;
- match replay data;
- final result submission to Convex.

Convex should remain responsible for:

- rooms;
- profiles;
- persistence;
- match history;
- unlocks;
- lobby chat;
- non-frame-critical data.

---

## 12. Technical Architecture

### 12.1 Repository Structure

Recommended repository structure:

```text
/
  AGENTS.md
  package.json
  README.md

  client/
    index.html
    package.json
    vite.config.ts
    src/
      main.ts
      game/
        GameConfig.ts
        scenes/
          BootScene.ts
          MainMenuScene.ts
          LobbyScene.ts
          MatchScene.ts
          DraftScene.ts
          ResultsScene.ts
        systems/
          MovementSystem.ts
          CombatSystem.ts
          ProjectileSystem.ts
          CardSystem.ts
          CameraSystem.ts
          AudioSystem.ts
        entities/
          Player.ts
          Projectile.ts
          Weapon.ts
        data/
          weapons.ts
          cards.ts
          maps.ts
        net/
          ConvexClient.ts
          RoomSync.ts
          MatchSync.ts
        ui/
          Hud.ts
          CardDraftPanel.ts
          LobbyPanel.ts
        types/
          game.ts
          net.ts

  convex/
    schema.ts
    rooms.ts
    players.ts
    matches.ts
    chat.ts

  docs/
    game-design-document.md
    technical-design.md
    art-direction.md
    codex-task-backlog.md
    tuning-values.md
    changelog.md

  assets/
    sprites/
    audio/
    maps/

  tests/
    unit/
    integration/
```

Do not create `server-java/` until the prototype proves it is necessary.

### 12.2 Phaser Scene Responsibilities

| Scene | Responsibility |
|---|---|
| BootScene | load config, preload minimum assets, initialize services |
| MainMenuScene | create/join room entry point |
| LobbyScene | room display, players, chat/emotes, ready state |
| MatchScene | core gameplay, movement, combat, HUD |
| DraftScene | show upgrade cards and apply selection |
| ResultsScene | match winner, stats, rematch/return |

### 12.3 Core Systems

| System | Responsibility |
|---|---|
| MovementSystem | input, acceleration, jump, air control, collision response |
| CombatSystem | weapon firing, reload, damage application |
| ProjectileSystem | projectile spawn, movement, collision, lifetime, effects |
| CardSystem | apply card modifiers to player/weapon/projectiles |
| RoomSync | lobby state and ready checks through Convex |
| MatchSync | low-frequency state sync and match result submission |
| AudioSystem | one-shot sounds, music, mix categories |
| CameraSystem | framing, shake, bounds, transitions |

### 12.4 Shared TypeScript Types

Core gameplay data should be typed early.

```ts
export type PlayerId = string;
export type RoomId = string;
export type MatchId = string;
export type CardId = string;
export type WeaponId = string;

export type Vec2 = {
  x: number;
  y: number;
};

export type PlayerState = {
  id: PlayerId;
  name: string;
  color: string;
  position: Vec2;
  velocity: Vec2;
  aimAngle: number;
  health: number;
  maxHealth: number;
  weaponId: WeaponId;
  cards: CardId[];
  alive: boolean;
};

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadSeconds: number;
  projectileSpeed: number;
  projectileLifetimeSeconds: number;
  spreadRadians: number;
  recoilImpulse: number;
  knockbackImpulse: number;
};

export type CardDefinition = {
  id: CardId;
  name: string;
  category: 'weapon' | 'projectile' | 'movement' | 'defense' | 'utility' | 'tradeoff';
  rarity: 'common' | 'uncommon' | 'rare' | 'cursed';
  description: string;
  unique?: boolean;
  maxStacks?: number;
};
```

### 12.5 Convex Schema Draft

Draft schema concept:

```ts
rooms: {
  code: string;
  hostPlayerId: string;
  status: 'lobby' | 'starting' | 'in_match' | 'complete';
  createdAt: number;
  updatedAt: number;
  currentMatchId?: string;
}

roomPlayers: {
  roomId: string;
  playerId: string;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

matches: {
  roomId: string;
  status: 'loading' | 'active' | 'draft' | 'complete';
  mapId: string;
  targetScore: number;
  roundIndex: number;
  scores: Record<string, number>;
  startedAt: number;
  completedAt?: number;
}

matchResults: {
  matchId: string;
  roomId: string;
  winnerPlayerId: string;
  finalScores: Record<string, number>;
  roundsPlayed: number;
  createdAt: number;
}

chatMessages: {
  roomId: string;
  playerId: string;
  message: string;
  createdAt: number;
}
```

### 12.6 Build Tooling

Expected tooling:

- TypeScript everywhere possible.
- Vite for client build.
- npm scripts for dev, build, test, lint, typecheck.
- Convex dev server for backend functions.
- Future CI should run typecheck and tests before merges.

Recommended root scripts:

```json
{
  "scripts": {
    "dev": "npm run dev --workspace client",
    "typecheck": "npm run typecheck --workspaces",
    "test": "npm run test --workspaces",
    "lint": "npm run lint --workspaces",
    "build": "npm run build --workspaces"
  }
}
```

---

## 13. UI and UX Design

### 13.1 UI Principles

- Players should know what state they are in: lobby, countdown, fighting, draft, result.
- The HUD should show only what matters during combat.
- Upgrade choices should be readable in under three seconds.
- Match flow should restart quickly.
- Avoid complex menus until the core loop works.

### 13.2 Required Screens

| Screen | Prototype | MVP |
|---|---|---|
| Main Menu | Yes | Yes |
| Create/Join Room | Yes | Yes |
| Lobby | Yes | Yes |
| Match HUD | Yes | Yes |
| Draft UI | Yes | Yes |
| Results | Yes | Yes |
| Settings | No | Basic audio/input later |
| Cosmetics | No | Stretch |

### 13.3 Match HUD

Prototype HUD must show:

- player health;
- opponent health;
- ammo/reload state;
- round score;
- countdown/timer;
- current round number;
- draft/build summary minimal indicator.

### 13.4 Draft UI

Draft UI must show:

- three card choices;
- selected player name;
- clear pick instruction;
- card names and descriptions;
- existing stack count;
- confirm selection.

### 13.5 Lobby UI

Lobby UI must show:

- room code;
- connected players;
- player colour/name;
- ready state;
- host/start button;
- optional chat/emote feed;
- connection status.

---

## 14. Art Direction

### 14.1 Visual Goals

The game should be readable first and stylish second.

Recommended initial direction:

- bold silhouettes;
- simple animated characters;
- bright projectile trails;
- clear collision geometry;
- stylized industrial/scrap/factory environments;
- comic violence without heavy realism.

### 14.2 Prototype Art

Prototype should use:

- rectangles/capsules for players;
- simple weapon sprite or line;
- coloured projectiles;
- solid collision tiles;
- basic UI boxes;
- placeholder sounds.

Do not block gameplay development on final art.

### 14.3 MVP Art Needs

| Asset | Quantity |
|---|---:|
| Player character base | 1 |
| Player colour variants | 4–8 |
| Weapon sprites | 5 |
| Projectile sprites/trails | 6–10 |
| Explosion VFX | 2–4 |
| Hit impact VFX | 3–5 |
| Death VFX | 2 |
| Arena tileset | 1–2 |
| UI card frame | 1 set |
| Card icons | 12–18 prototype icons |

### 14.4 Readability Rules

- Player colours must stand out from backgrounds.
- Projectiles must be visible against every map.
- Explosions must not hide follow-up shots for too long.
- Cosmetic effects must never obscure hitboxes.
- Cards that modify projectiles should alter visuals enough to be recognized.

---

## 15. Audio Direction

### 15.1 Audio Goals

Audio should make the game easier to understand and more satisfying.

Priority sounds:

- weapon fire;
- reload;
- jump/land;
- projectile impact;
- player hit;
- shield trigger;
- explosion;
- round win/loss;
- card selection;
- lobby ready.

### 15.2 Music

Prototype does not require final music.

MVP music direction:

- short looping combat track;
- calmer lobby loop;
- punchy round start/end stingers;
- avoid overly dense music that masks combat sounds.

### 15.3 Audio Mix Rules

- Gunshots and hits are highest priority.
- UI should be crisp but not annoying.
- Repeated weapons need variation to avoid fatigue.
- Explosions should be strong but not drown out all information.

---

## 16. Progression and Persistence

### 16.1 Prototype Persistence

Prototype persistence only needs:

- player name;
- room state;
- match result;
- basic match history, optional.

### 16.2 MVP Persistence

MVP may include:

- profile name;
- wins/losses;
- total matches;
- favourite card stats;
- cosmetic unlock placeholders;
- settings.

### 16.3 Long-Term Progression Philosophy

Permanent progression should not create gameplay power advantages in competitive modes.

Allowed:

- cosmetics;
- titles;
- stats;
- profile badges;
- alternate announcer lines;
- custom room options.

Avoid:

- permanent damage boosts;
- paid/stat unlock weapons;
- long grinds to access core competitive tools.

---

## 17. MVP Definition

### 17.1 MVP Goal

The MVP proves that JAKESJAM is fun as a short browser-based multiplayer duel with upgrade drafting.

### 17.2 MVP Must Include

- Browser-playable Phaser client.
- TypeScript project structure.
- Convex-backed room creation and joining.
- Two players in one room.
- Ready checks.
- One playable 1v1 arena.
- Core movement.
- One baseline weapon.
- Health/damage/death.
- Round win detection.
- Score tracking.
- Card draft for losing player.
- At least 12 cards.
- Match result screen.
- Saved match result.
- Basic placeholder art and audio.

### 17.3 MVP Should Not Include

- Full cosmetic economy.
- Ranked matchmaking.
- Public matchmaking queue.
- Java simulation server.
- More than five weapons.
- More than five maps.
- Level editor.
- Mobile support.
- Complex account system beyond what is needed.
- Full anti-cheat.

### 17.4 MVP Success Criteria

The MVP is successful if:

- two browser windows can create/join the same room;
- both players can ready up and start a match;
- both players can complete a full match;
- round flow and draft flow are clear;
- card upgrades create noticeably different rounds;
- the match is fun enough to replay immediately;
- Convex usage does not create obvious write-rate or latency problems;
- the repo is understandable to Codex and human contributors.

---

## 18. Milestones

### Milestone 0 — Repository and Documentation Bootstrap

**Goal:** Create the project skeleton and source-of-truth docs.

Deliverables:

- repo structure;
- `AGENTS.md`;
- `docs/game-design-document.md`;
- Phaser + Vite client scaffold;
- Convex scaffold;
- typecheck command;
- README with local dev instructions.

Definition of done:

- project installs;
- client dev server runs;
- Convex dev command runs or setup instructions are clear;
- Codex can read project guidance.

### Milestone 1 — Offline Movement Playground

**Goal:** Make movement feel good before networking.

Deliverables:

- MatchScene with test arena;
- player capsule/entity;
- run/jump/air control;
- collision with platforms;
- camera bounds;
- debug overlay for position/velocity.

Definition of done:

- player can move around Boxworks smoothly;
- jumps feel responsive;
- no major collision bugs in the test arena.

### Milestone 2 — Offline Combat Prototype

**Goal:** Prove shooting, damage, and round reset.

Deliverables:

- aim cursor;
- Scrap Rifle;
- projectile spawn/update/collision;
- health;
- hit feedback;
- death;
- round reset against dummy or second local player.

Definition of done:

- shooting feels understandable;
- projectiles collide with terrain and player target;
- round result can trigger and reset.

### Milestone 3 — Convex Lobby Prototype

**Goal:** Prove rooms and ready checks.

Deliverables:

- create room;
- join room by code;
- connected player list;
- player name/colour;
- ready toggle;
- basic chat or emote ping;
- start match state.

Definition of done:

- two browser windows can join one room;
- ready state updates reliably;
- match can be started from lobby state.

### Milestone 4 — Online 1v1 Match Prototype

**Goal:** Prove basic multiplayer feel.

Deliverables:

- two players spawn in arena;
- local player moves responsively;
- remote player displayed via subscribed snapshots;
- low-rate position sync;
- round result submitted;
- match result saved.

Definition of done:

- two players can complete a rough online match;
- latency is acceptable enough for continued prototype work;
- limitations are documented.

### Milestone 5 — Upgrade Draft Prototype

**Goal:** Add the core escalation hook.

Deliverables:

- CardSystem;
- 12-card data list;
- draft UI;
- loser receives draft;
- selected cards affect player/weapon/projectiles;
- card list shown in match summary.

Definition of done:

- card choices change gameplay noticeably;
- players understand selected effects;
- no card instantly breaks the match.

### Milestone 6 — MVP Vertical Slice

**Goal:** One complete playable loop.

Deliverables:

- polished placeholder art;
- sound pass;
- 3 maps;
- 3 weapons or 1 weapon plus deep cards;
- match results;
- rematch flow;
- bug pass;
- deployment build.

Definition of done:

- a new player can open the game, join a room, play a full match, draft cards, see results, and rematch.

---

## 19. Codex-Ready Development Rules

### 19.1 Source of Truth

Codex and contributors should treat these as the source of truth:

1. `AGENTS.md` for repo working rules.
2. `docs/game-design-document.md` for design intent.
3. `docs/technical-design.md` for architecture decisions once created.
4. `docs/codex-task-backlog.md` for implementation order.
5. `docs/changelog.md` for design/implementation changes.

### 19.2 Task Style

Good Codex task:

```text
Implement the offline Scrap Rifle projectile system in client/src/game/systems/ProjectileSystem.ts.
Use the WeaponDefinition type from client/src/game/types/game.ts.
Acceptance criteria:
- left click fires a projectile from the player weapon muzzle;
- projectile travels at configured speed;
- projectile despawns on terrain hit or lifetime expiry;
- projectile damages dummy target;
- npm run typecheck passes.
```

Bad Codex task:

```text
Build the game.
```

### 19.3 Definition of Done for Code Tasks

Every code task should end with:

- no TypeScript errors;
- no obvious runtime crash;
- changed files summarized;
- manual test steps documented;
- relevant docs updated if behaviour changed.

### 19.4 Codex Constraints

Codex should not:

- add a Java server unless specifically asked after prototype review;
- replace Phaser with another engine;
- introduce large dependencies without explaining why;
- create final art requirements before prototype gameplay;
- implement ranked matchmaking before private lobbies;
- write high-frequency game simulation directly through Convex without throttle limits;
- broaden scope without updating the GDD.

---

## 20. QA and Playtesting

### 20.1 Manual Test Checklist

Offline movement:

- player can run left/right;
- jump works from ground;
- coyote time works if implemented;
- player cannot clip through floors/walls;
- out-of-bounds reset works.

Combat:

- weapon fires at intended rate;
- projectiles despawn correctly;
- hits reduce health;
- player death triggers round result;
- reload works;
- feedback is visible and audible.

Cards:

- draft shows three valid cards;
- selected card applies;
- stack counts work;
- capped cards do not exceed caps;
- card effects are visible in gameplay.

Multiplayer:

- room creation works;
- join by room code works;
- ready state syncs;
- match start syncs;
- remote player display updates;
- match result saves;
- disconnected player state is handled.

### 20.2 Playtest Questions

After every playtest, ask:

1. Did players understand how to move and shoot?
2. Did players understand why they died?
3. Did the losing player feel like they had a comeback path?
4. Did any card feel useless?
5. Did any card feel unbeatable?
6. Was the match too short, too long, or about right?
7. Did latency or sync issues ruin any moment?
8. Did players ask for rematch?

### 20.3 Metrics to Track Later

Possible metrics:

- average round length;
- match length;
- most picked cards;
- highest win-rate cards;
- disconnect rate;
- rematch rate;
- average damage per weapon;
- deaths by out-of-bounds;
- draw frequency.

---

## 21. Balance Philosophy

### 21.1 Balance Goal

The game does not need perfect competitive balance at prototype stage. It needs **fun imbalance that still has counterplay**.

### 21.2 Balance Rules

- Overpowered is acceptable briefly if it is funny and fixable.
- Unreadable is not acceptable.
- Slow/boring is worse than slightly broken during early prototyping.
- Cards should create stories.
- Every dominant strategy should have at least one possible answer.
- Defensive cards must not drag rounds too long.
- Damage scaling must be watched carefully.

### 21.3 Tuning Process

1. Start with conservative numbers.
2. Make the effect visibly exciting.
3. Add caps when stacks break readability.
4. Prefer tradeoffs over flat nerfs.
5. Remove cards that are not fun even when balanced.

---

## 22. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|---|---:|---:|---|
| Convex not suitable for twitch combat sync | High | Medium | Use Convex for platform state first; add Java/WebSocket sim later only if needed |
| Scope creep from too many modes | High | High | Lock prototype to 1v1 duel |
| Card stacking becomes unreadable | Medium | High | Caps, clear VFX, limited card pool |
| Movement feels bad | High | Medium | Build offline movement playground before multiplayer |
| Combat lacks impact | High | Medium | Prioritize feedback, hit pause/shake/sound |
| Maps break under movement upgrades | Medium | High | Test every movement card on every map |
| Cheating in client-authoritative prototype | Medium | Medium | Accept for prototype; plan server authority only after fun is proven |
| AI-generated code gets messy | Medium | High | Use AGENTS.md, small tasks, strict types, docs |
| Too much UI before gameplay | Medium | Medium | Build only necessary UI until MVP |

---

## 23. Open Decisions

These decisions should be resolved through prototype testing, not theory alone.

| Decision | Current Lean | Test Method |
|---|---|---|
| Double jump vs jetpack/boost | Double jump first | Movement playground |
| One life rounds vs respawn deathmatch | One life duel first | Prototype match flow |
| Hitscan vs projectile | Projectile first | Combat prototype |
| 1v1 only vs 2–4 players | 1v1 first | Multiplayer prototype |
| Card draft for loser only vs both players | Loser only first | Upgrade prototype |
| Keyboard/mouse only vs controller | Keyboard/mouse first | MVP usability |
| Client combat authority vs server authority | Client for prototype | Latency/playtest review |

---

## 24. Initial Content Checklist

### 24.1 Prototype Content

- 1 arena: Boxworks.
- 1 player placeholder.
- 1 weapon: Scrap Rifle.
- 1 projectile type.
- 1 death effect.
- 12 upgrade cards.
- 1 lobby UI.
- 1 draft UI.
- 1 result UI.

### 24.2 MVP Content

- 3 arenas.
- 1–3 player skins/colour variants.
- 3 weapons or one weapon with strong card variety.
- 18–30 upgrade cards.
- basic sound pack.
- simple menu/lobby/match/draft/results UI.
- match result persistence.

---

## 25. Immediate Next Implementation Tasks

These tasks are ordered for Codex or human contributors.

1. Create repo skeleton with `client/`, `convex/`, `docs/`, and `assets/`.
2. Add `AGENTS.md` with project rules.
3. Scaffold Phaser + TypeScript + Vite client.
4. Add placeholder BootScene and MatchScene.
5. Create `PlayerState`, `WeaponDefinition`, and `CardDefinition` types.
6. Implement Boxworks test arena with simple collision.
7. Implement player movement.
8. Implement aim direction and debug reticle.
9. Implement Scrap Rifle projectile firing.
10. Implement dummy target damage/death.
11. Implement round reset offline.
12. Scaffold Convex schema for rooms and roomPlayers.
13. Implement create/join room.
14. Implement lobby ready state.
15. Implement low-frequency player snapshot sync.
16. Implement match start state.
17. Implement draft screen.
18. Implement first 12 cards.
19. Save match result.
20. Create first deployable MVP build.

---

## 26. Change Log

### v0.1 — 2026-05-01

- Created full GDD from team direction and engine/multiplayer handoff.
- Locked prototype direction as browser-first 2D multiplayer 1v1 platform shooter.
- Defined Phaser + TypeScript + Vite + Convex as starting architecture.
- Deferred Java server until multiplayer prototype proves a need.
- Added Codex-ready implementation guidelines, milestones, and acceptance criteria.
