# Engine and Multiplayer Framework Handoff

## Recommended Technical Direction

JAKESJAM should be built as a browser-first 2D multiplayer game using:

- **Game client:** Phaser + TypeScript
- **Frontend build tooling:** Vite
- **Realtime/backend platform:** Convex
- **Optional future simulation server:** Java WebSocket service, only if needed

This stack is the most efficient path for creating a playable multiplayer prototype quickly while keeping the codebase friendly for AI-assisted development and human contributors.

## Core Decision

Use **Phaser + TypeScript + Convex** as the foundation.

Do not begin with Java as the main game runtime. Java should be reserved for a later dedicated authoritative simulation server if the game eventually needs lower-latency server authority, anti-cheat validation, or high-frequency combat/state simulation.

## Why Phaser

Phaser is the best starting engine for this project because it is:

- built specifically for 2D HTML5 browser games;
- mature and widely used;
- compatible with JavaScript and TypeScript;
- easy to run locally with npm tooling;
- easy to deploy to the web;
- well-suited to AI code generation and refactoring;
- supported by a large library of examples and tutorials.

Phaser is a code-first engine. It does not provide a full visual editor like Godot, but that is a strength for this project because the repo can stay lightweight, readable, and easy for AI tools to modify.

## Why Convex

Convex is a strong fit for the multiplayer platform layer because it provides:

- realtime reactive queries;
- TypeScript backend functions;
- persistent database state;
- client subscriptions over WebSockets;
- simple room/lobby state management;
- easy integration with browser TypeScript clients.

Convex should be used for multiplayer systems that do not require frame-perfect authority.

Good Convex responsibilities:

- player profiles;
- authentication;
- lobby creation;
- room lists;
- joining and leaving rooms;
- ready checks;
- chat and emotes;
- inventory and unlocks;
- match results;
- persistent progression;
- shared low-frequency room state;
- collaborative tools or level-editing state.

Convex should not initially be treated as a 60 FPS game simulation server.

Risky Convex responsibilities:

- every-frame player movement;
- high-frequency projectile updates;
- twitch combat authority;
- deterministic physics simulation;
- anti-cheat-critical state;
- rollback networking.

## Multiplayer Model

The first multiplayer prototype should use Convex as the authoritative source for room and session state, while keeping moment-to-moment rendering and prediction local in the Phaser client.

Initial flow:

```text
Player opens browser game
        |
        v
Phaser client connects to Convex
        |
        v
Player creates or joins a room
        |
        v
Convex stores room/player state
        |
        v
Subscribed clients receive realtime room updates
        |
        v
Phaser renders players and shared game state
```

## Proposed Repository Structure

```text
client/
  Phaser + TypeScript game client

convex/
  Convex schema, queries, mutations, auth, rooms, lobbies

docs/
  Game design document, technical design, art direction, planning notes

server-java/
  Optional future authoritative simulation server
```

The `server-java/` folder should not be created until the prototype proves it is needed.

## Recommended Prototype Scope

The first prototype should prove whether Convex is viable for the intended multiplayer feel.

Prototype features:

- create room;
- join room;
- display connected players;
- assign each player a name and color;
- show ready state;
- sync simple player position at a low rate;
- send chat or emote pings;
- start a match;
- save match result.

This prototype should be deliberately small. Its job is to answer the architecture question before the game grows.

## Pass Criteria

The first multiplayer prototype is successful if:

- two browser windows can join the same room;
- both players can see each other update;
- lobby and ready state work reliably;
- the code is easy for contributors to understand;
- Convex usage does not require excessive writes;
- the gameplay feel is acceptable for the intended game pace.

If the prototype feels too delayed or write-heavy, keep Convex for platform state and add a dedicated simulation server later.

## Future Java Server Option

Java becomes useful if JAKESJAM needs an authoritative realtime simulation layer.

Possible future architecture:

```text
Browser Phaser client
        |
        | realtime movement/combat
        v
Java WebSocket simulation server

Browser Phaser client
        |
        | lobbies, profiles, persistence, results
        v
Convex backend

Java server
        |
        | match summaries/results
        v
Convex backend
```

Java server responsibilities, if added:

- authoritative player movement;
- collision validation;
- combat resolution;
- anti-cheat checks;
- tick-based simulation;
- match replay data;
- final result submission to Convex.

This should be a second-stage architecture, not the starting point.

## Engines Considered

### Phaser

Recommended.

Best for:

- 2D browser games;
- fast prototypes;
- TypeScript-first workflows;
- Convex integration;
- AI-assisted coding.

Tradeoff:

- no built-in full visual editor.

### Excalibur

Good alternative.

Best for:

- smaller TypeScript-first 2D games;
- cleaner beginner-friendly structure.

Tradeoff:

- smaller ecosystem than Phaser.

### PixiJS

Useful only if building a custom engine layer.

Best for:

- custom rendering;
- UI-heavy or renderer-heavy projects.

Tradeoff:

- not a full game engine by itself.

### libGDX

Java-first fallback.

Best for:

- teams that strongly want Java game code.

Tradeoff:

- browser export through GWT has restrictions;
- Convex integration is less natural than with TypeScript.

### Godot

Not recommended for this project direction.

Best for:

- visual editing;
- scene-based design;
- non-Convex-native workflows.

Tradeoff:

- not Java-based;
- web export has constraints;
- Convex integration is less direct.

## AI Development Advantages

Phaser + TypeScript + Convex is the best fit for AI-assisted development because:

- one primary language can cover client and backend;
- TypeScript types help AI tools avoid mismatched client/backend calls;
- Vite projects are simple to scaffold and run;
- Phaser scenes are easy to generate and refactor;
- Convex schema and functions are easy to document;
- small vertical slices can be built quickly;
- GitHub issues can map directly to small code tasks.

Recommended AI workflow:

1. Keep each task small and specific.
2. Ask AI to modify one feature area at a time.
3. Keep architecture notes in `docs/`.
4. Use TypeScript types aggressively.
5. Add simple playable tests before scaling systems.
6. Use pull requests for human review once collaborators join.

## Final Recommendation for GDD

JAKESJAM will use a browser-first 2D technology stack centered on Phaser, TypeScript, and Convex.

Phaser will power the playable client and rendering layer. Convex will provide realtime backend features including rooms, lobbies, player state, persistence, chat, and match results. The first prototype will test low-frequency multiplayer synchronization through Convex. If later gameplay requires tighter realtime authority, a Java WebSocket simulation server may be added while Convex remains responsible for persistent platform state.

This approach prioritizes speed, contributor accessibility, browser compatibility, and AI-assisted development while preserving a path toward more advanced multiplayer infrastructure if the game demands it.

