# sim/ — Shared Simulation Package

Owned by Dev A. See `docs/dev-stream-sim.md` for the full handoff.

This directory is imported by:

- `client/src/net/` (client-side prediction and reconciliation)
- `server/src/` (authoritative tick loop on Bun)

## Hard rules

1. No imports from `phaser`, the DOM, `convex/react`, `Bun`, `fetch`, or any side-effecting global.
2. No wall-clock reads — `Date.now()`, `performance.now()`, `Math.random()` are forbidden. Time is a parameter; randomness is `rng.ts` (seeded).
3. `World.step(state, inputs, dt)` is pure and deterministic given `(state, inputs, dt, rngState)`.
4. Iterate entities in sorted order, never raw `Object.values()` order.

## Current status

`types.ts` and `World.ts` are placeholders seeded by Dev B so the netcode and server can compile. Dev A finalizes both per the contract in `docs/dev-stream-sim.md`. Until then `World.step` is a no-op that just advances the tick and acks inputs.
