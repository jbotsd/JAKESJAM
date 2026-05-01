# sim/ - Shared Simulation Package

Owned by Dev A. This package is imported by client prediction code and the
authoritative Bun server.

## Hard Rules

1. No imports from Phaser, the DOM, Convex, Bun, fetch, or other runtime-specific APIs.
2. No wall-clock reads. Time enters through `dtMs`; randomness will enter through seeded `rngState`.
3. `World.step(state, inputs, dtMs)` is pure at the boundary. It returns a `StepResult`.
4. Entity iteration must be sorted once real simulation logic lands.

## Current Status

`types.ts` is the Day 1 network contract. `World.create` builds a minimal starting
snapshot from map/player data. `World.step` is intentionally a no-op that returns
`{ state, events: [] }` so Dev B can wire transport, prediction, and authority
against stable call shapes before gameplay extraction begins.
