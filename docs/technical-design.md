# JAKESJAM — Technical Design Notes

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
3. Convex lobby.
4. Online 1v1 sync.
5. Card draft.

## Networking Boundary

Convex is not initially a 60 FPS simulation server.

Use Convex for:

- room lifecycle;
- player membership;
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

## Client Scenes

- BootScene
- MainMenuScene
- LobbyScene
- MatchScene
- DraftScene
- ResultsScene

## Systems

- MovementSystem
- CombatSystem
- ProjectileSystem
- CardSystem
- RoomSync
- MatchSync
- AudioSystem
- CameraSystem

## Future Java Server Trigger

Add Java simulation server only if:

- Convex movement sync is too delayed;
- combat disagreement is unacceptable;
- anti-cheat matters;
- more players require server authority;
- projectile-heavy builds need authoritative tick simulation.

## Initial Dev Commands

Exact commands depend on final scaffold, but target scripts should be:

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```
