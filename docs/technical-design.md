# JAKESJAM — Technical Design Notes

> **Architecture note (added 2026-07-08):** the Convex/Vercel-centric
> platform sections of this doc describe the original plan and are now
> historical. The shipped deployment is a **self-contained Bun host**
> (`bun run host:public`): one process serves the built client AND the
> authoritative game server, exposed via Tailscale Funnel — no Vercel, no
> Fly, no Convex required (`CONVEX_URL` is unset live; the Convex code
> paths are env-gated off). Gameplay/design content in this doc is still
> broadly valid, but check `CLAUDE.md` for current mechanics (e.g. the
> timed parry was replaced by the right-click aegis power-slide; jetpack
> was removed; drafts are loser-only).


## Current Stack Decision

Use Phaser + TypeScript + Vite + Convex.

- Phaser: client game runtime and rendering.
- TypeScript: shared client/backend language.
- Vite: client development/build tooling.
- Convex: rooms, lobbies, ready state, chat/emotes, profiles, persistence, match results, and low-frequency shared state.

Java is reserved for a future authoritative WebSocket simulation server only if testing proves it is needed.

## Architecture Principle

Build the smallest playable loop before adding infrastructure.

Prototype first:

1. Offline movement.
2. Offline combat.
3. Orthogonal projectile modifier data.
4. Convex lobby.
5. Online 1v1 sync.
6. Card draft.

## Networking Boundary

Convex is not initially a 60 FPS simulation server.

Use Convex for:

- room lifecycle;
- player membership;
- host-owned room settings such as chaos modifiers;
- ready checks;
- draft choices;
- match phase;
- match result;
- low-frequency snapshots for prototype testing.

Avoid:

- per-frame movement writes;
- every projectile update;
- anti-cheat-critical authority;
- deterministic physics through Convex.

## Future Prediction and Reconciliation Direction

Online movement should grow toward the client-side prediction and server reconciliation model described by Gabriel Gambetta:

https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html

Implementation direction:

- local player input is applied immediately on the client;
- each input frame gets an increasing sequence number;
- the server-authoritative state includes the last processed input sequence for each player;
- the client discards acknowledged inputs and replays unacknowledged local inputs after each authoritative snapshot;
- remote players use interpolation instead of local prediction;
- early Convex snapshots stay low-frequency until we know whether a dedicated simulation server is needed.

Milestone 0 only stores room/session state. Movement prediction belongs to the online match prototype after offline movement feels good.

## Client Scenes

- BootScene
- MainMenuScene
- LobbyScene
- MatchScene
- DraftScene
- ResultsScene

## Host and Player Client Split

The browser app supports two client roles:

- Host client: creates the room, displays the current host address and port, chooses game modifiers, starts matches, and runs local practice.
- Player client: enters host IP address, port, and room code, then joins with player identity fields only.

The current prototype still uses Convex as the shared lobby/session backend. The displayed host address and port refer to the web client endpoint players should open. Convex room codes still identify the room session after the player reaches that endpoint.

Room modifiers are stored on the Convex room document and can only be changed by the room host while the room is in lobby state. Match startup reads modifiers from room state instead of trusting each player's local UI.

## Systems

- ~~MovementSystem~~ deleted (2026-07-07) — movement is `sim/player.ts`'s `stepPlayer`, wrapped for offline Practice by `client/src/game/systems/LocalPlayerController.ts`
- WeaponSystem
- CombatSystem
- ProjectileSystem
- DestructibleSystem
- FireSystem
- PickupSystem
- CardSystem
- RoomSync
- MatchSync
- AudioSystem
- CameraSystem

## Orthogonal Weapon Direction

All players start with the same pistol-style baseline weapon/projectile. The current prototype calls its crystal-tech visual identity **Crystal Blaster / Scrap Rifle**. Cards mutate that weapon along independent axes: delivery, trajectory, quantity, impact, element, utility, projectile count, range, fire rate, speed, size, shape, recoil, pathing, status, lifetime, and character tradeoffs.

The first implemented data model uses one selected card per orthogonal bucket:

- Delivery: projectile, raycast, continuous beam, or area pulse.
- Trajectory: straight, gravity, homing, bounce, float, accelerate, boomerang, or anti-homing.
- Quantity: shot count, spread, orbitals, or cluster splits.
- Impact: none, explosive, sticky, pierce-chain, or slow field.
- Element: crystal, fire, ice, lightning, void, radiant, plus legacy neutral/electric/toxic hooks.
- Utility: cooldown, ammo sustain, overcharge, or mirror shield hooks.

Wild legendary cards may occupy two buckets and should be treated explicitly in draft UI.

The first curated paths are:

- Blap: high fire rate and many weak projectiles.
- Heavy: fewer larger projectiles, damage, recoil, and knockback.
- Trick: bounce, boomerang, split, homing, and anti-homing behaviour.
- Element: fire, napalm, electric, sticky, explosive, and lingering hazards.

The baseline should feel as direct as a simple raycast shooter while still using visible projectile entities for readability and upgrade expression.

## MVP Content Target

- One main map first.
- Up to 10 players as an all-v-all stress target after 1v1 works.
- Four weapon paths.
- Four character stat archetypes with one active shield/ability button.
- Four destructible/interactive element types: barrels, boxes, mines, and cubes/blocks.
- Fire/napalm hazards that catch, burn, and dissipate under strict duration and readability limits.

## Future Java Server Trigger

Add Java simulation server only if:

- Convex movement sync is too delayed;
- combat disagreement is unacceptable;
- anti-cheat matters;
- more players require server authority;
- projectile-heavy builds need authoritative tick simulation.

## Initial Dev Commands

Current scaffold commands:

```bash
npm install
npm run dev:convex
npm run dev:client
npm run dev:full
npm run typecheck
npm run build
```
