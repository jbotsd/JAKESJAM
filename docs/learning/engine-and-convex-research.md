# Engine and Convex Research

This note captures the first technical direction for creating a viable 2D multiplayer browser game engine for JAKESJAM.

## Goal

Build a 2D multiplayer game that:

- runs in the browser with HTML5/WebGL;
- supports live multiplayer through Convex where it fits;
- stays approachable for collaborators;
- can still use Java later if we need a dedicated authoritative simulation server.

## Short Recommendation

Start with **Phaser + TypeScript + Convex**.

Use Convex for accounts, lobbies, matchmaking, room state, persistence, chat, inventory, progression, and slower realtime game state. If the game becomes a high-tick action multiplayer game, add a dedicated authoritative simulation server later, potentially in Java.

Best starting architecture:

```text
client/
  Phaser + TypeScript browser game

convex/
  TypeScript Convex backend functions, schema, auth, lobbies, persistence

docs/
  Game design, architecture notes, research, contribution flow

server-java/   optional later
  Java authoritative realtime simulation if Convex is not enough for combat/movement
```

## Convex Fit

Convex is strongest as a realtime application backend, not as a traditional high-frequency game server.

Good uses:

- player accounts and auth;
- lobbies and room lists;
- matchmaking;
- ready checks;
- persistent player data;
- inventory, unlocks, progress, economy;
- chat and social state;
- turn-based or low-frequency multiplayer;
- live editor/collaboration tooling;
- storing authoritative match results.

Risky uses:

- sending every player position update through database mutations;
- 30 or 60 tick-per-second simulation;
- latency-critical combat;
- deterministic physics authority;
- high-volume bullet or projectile state.

Reasoning from docs:

- Convex is automatically realtime through reactive query subscriptions.
- Convex JavaScript clients work in browser-like JavaScript environments with WebSockets.
- Convex functions and generated APIs are TypeScript-centered.
- Convex limits include function call, transaction, execution-time, concurrency, and document-size ceilings that matter if every game tick becomes a backend write.

Conclusion: Convex should be the game platform backend. It should not be assumed to be the final realtime simulation loop for fast action until proven in a prototype.

## Engine Options

### Phaser

Phaser is the strongest default choice for this project.

Pros:

- Built specifically for browser-first HTML5 games.
- Designed for 2D.
- Uses JavaScript or TypeScript.
- WebGL and Canvas rendering.
- Mature ecosystem and many examples.
- Easy to connect directly to Convex's JavaScript client.
- Easy for web developers to join.
- Good fit for arcade, platformer, top-down, puzzle, and action prototypes.

Cons:

- No visual editor like Godot or Unity by default.
- Java is not used on the client.
- Large games need discipline around scenes, systems, assets, and state management.
- For serious action multiplayer, server authority still needs careful design.

Verdict:

Use Phaser unless the team strongly wants a visual editor or Java-first game code.

### Excalibur

Excalibur is a clean TypeScript 2D engine for the web.

Pros:

- TypeScript-first.
- Friendlier structure for smaller teams.
- Browser-first and easy to integrate with Convex.
- Good for learning and building clear code.

Cons:

- Smaller ecosystem than Phaser.
- Pre-1.0 according to its docs.
- Fewer examples, plugins, and long-term production references.

Verdict:

Good alternative if the team prefers a simpler, more TypeScript-native engine. Phaser is safer for ecosystem depth.

### PixiJS

PixiJS is a renderer, not a full game engine.

Pros:

- Excellent rendering performance.
- WebGL/WebGL2 support, with WebGPU available but still not the safest production default.
- Great for custom engines, UI-heavy games, particles, maps, and bespoke rendering.
- Easy to integrate with Convex because it is JavaScript/TypeScript.

Cons:

- You build more yourself: scenes, collisions, physics, asset lifecycle, game loop conventions, input mapping.
- Better for teams that want to create their own engine layer.

Verdict:

Only choose PixiJS if the goal is specifically to build a custom engine. For making a game sooner, Phaser is better.

### libGDX

libGDX is the strongest Java-first option.

Pros:

- Game code can be written in Java.
- Supports an HTML5 backend through GWT.
- Mature cross-platform framework.
- Good if the team is Java-heavy and wants desktop/mobile options too.

Cons:

- Browser export has GWT-specific restrictions.
- Some Java features are limited or different in the HTML5 backend.
- Multithreading is not supported in the HTML5 backend.
- Browser audio has restrictions.
- Convex integration is awkward compared with TypeScript because Convex is much more natural from JS/TS clients.

Verdict:

Choose libGDX only if Java-first game code matters more than Convex/browser-native development speed.

### Godot

Godot is a great 2D engine, but it is not the best fit for this specific target.

Pros:

- Excellent visual editor.
- Strong 2D tooling.
- Good for level design, animation, collision shapes, and exported builds.

Cons:

- Not Java-based.
- Browser export exists, but Godot 4 web export has platform constraints.
- Godot 4 C# projects currently cannot export to web, according to the Godot docs.
- Convex integration would usually need a JavaScript bridge or custom web plumbing.

Verdict:

Use Godot if a visual editor is more important than Convex-native web integration. Otherwise skip it for this project.

### PlayCanvas or Babylon.js

These are stronger for 3D or 2.5D browser games than for a straightforward 2D multiplayer game.

Verdict:

Not the first choice for JAKESJAM unless the game direction changes toward 3D.

## Java Role

If we choose Convex, Java should not be the first backend unless we have a clear reason.

Useful Java roles later:

- authoritative combat/movement simulation;
- anti-cheat validation;
- load-tested realtime socket server;
- match replay processor;
- simulation bots;
- tooling pipelines.

Less useful Java roles at the start:

- duplicating Convex lobbies and persistence;
- acting as a pass-through API between Phaser and Convex;
- trying to make Convex feel like a Java database.

Recommended stance:

Start without Java in the runtime path. Add Java only when the prototype proves it needs a dedicated simulation service.

## Multiplayer Architecture Options

### Option A: Convex-Only Multiplayer

```text
Browser Phaser client <-> Convex queries/mutations/subscriptions
```

Best for:

- lobbies;
- shared rooms;
- turn-based play;
- slower co-op;
- live building/editor modes;
- simple prototypes.

Pros:

- Fastest to build.
- Lowest infrastructure burden.
- Excellent realtime app data model.
- Easy contributor onboarding.

Cons:

- May not suit high-frequency action state.
- Need careful rate limiting and state design.

### Option B: Phaser + Convex + Java Simulation Server

```text
Browser Phaser client <-> Java WebSocket simulation server
Browser Phaser client <-> Convex app backend
Java server <-> Convex for match metadata/results
```

Best for:

- action combat;
- physics authority;
- anti-cheat;
- tick-based server simulation.

Pros:

- Strong realtime authority.
- Java is useful where it matters.
- Convex still handles app/backend/product state.

Cons:

- More infrastructure.
- More deployment complexity.
- More moving parts for contributors.

### Option C: libGDX + Java + Convex

```text
Browser libGDX/GWT client <-> Java server and/or Convex HTTP endpoints
```

Best for:

- Java-first team.

Pros:

- Java game code.
- Java backend symmetry.

Cons:

- Most awkward Convex fit.
- HTML5/GWT restrictions.
- Slower web iteration.

## Decision Matrix

| Option | Browser fit | Java fit | Convex fit | Multiplayer fit | Contributor fit | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| Phaser + Convex | Excellent | Low initially | Excellent | Good for lobbies/rooms, needs testing for action | Excellent | Best start |
| Phaser + Convex + Java later | Excellent | Strong later | Excellent | Excellent if simulation server is needed | Good | Best long-term path |
| Excalibur + Convex | Excellent | Low | Excellent | Good, smaller ecosystem | Good | Good alternative |
| PixiJS custom engine + Convex | Excellent | Low | Excellent | Depends on custom code | Medium | Good only for custom engine work |
| libGDX + Java + Convex | Good but restricted | Excellent | Weak to medium | Good with Java server | Medium | Java-first fallback |
| Godot web + Convex | Medium | Weak | Medium | Medium | Good for artists/designers | Not ideal here |

## Proposed Learning Path

1. Build a tiny Phaser + Convex room prototype.
2. Prove browser clients can join the same room and see each other.
3. Keep movement local first, then sync low-frequency snapshots through Convex.
4. Measure latency, write frequency, and gameplay feel.
5. Decide whether Convex is enough for the game type.
6. If not enough, add a Java WebSocket simulation server while keeping Convex for persistence and lobbies.

## First Prototype Scope

The first prototype should not be a full game. It should answer the hardest architecture question:

Can Convex handle the kind of multiplayer state JAKESJAM needs?

Prototype features:

- create room;
- join room;
- display connected players;
- each player has a name/color;
- shared ready state;
- simple position sync at a deliberately low rate;
- chat or emote ping;
- persist room result.

Pass criteria:

- two browser windows can join one room;
- updates feel acceptable for the intended game pace;
- the code path is understandable to new contributors;
- Convex usage stays within sane limits.

## Sources

- Phaser docs: https://docs.phaser.io/phaser/getting-started/what-is-phaser
- Excalibur docs: https://excaliburjs.com/docs/
- PixiJS rendering docs: https://pixijs.download/dev/docs/rendering.html
- libGDX HTML5 backend docs: https://libgdx.com/wiki/html5-backend-and-gwt-specifics
- Godot web export docs: https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html
- Convex docs home: https://docs.convex.dev/home
- Convex realtime docs: https://docs.convex.dev/realtime
- Convex JavaScript client docs: https://docs.convex.dev/client/javascript
- Convex limits: https://docs.convex.dev/production/state/limits

