# ADR-0001: The sim layer is pure and deterministic

## Status
Accepted

## Context
JAKESJAM ships a single `client/src/sim/` package that runs identically on
the Bun authoritative server and on every Phaser client (for prediction).
Both sides need byte-identical WorldStates given the same inputs so that
client prediction can be reconciled cleanly against the server's truth.

## Decision
The sim layer is pure: no Phaser, no DOM, no `Math.random`, no `Date.now`,
no network, no file I/O. The only "state" the sim carries beyond its
arguments is the seeded RNG cursor (`WorldState.rngState`), which is
threaded through every step explicitly.

Anything that needs randomness uses `mulberry32(rngState)`. Anything that
needs time uses the `tick: number` field on `WorldState` (or `dtMs` passed
into `step`). Anything that needs I/O lives outside `client/src/sim/`.

## Consequences
- The sim is trivially testable with `bun test` — no mocks, no fakes,
  no setup.
- Server and client divergence is not possible by code path; only by
  input-stream mismatch (the single thing the netcode layer guards).
- Adding a feature that needs wall-clock time, browser APIs, or
  external randomness requires moving the calculation out of the sim
  and threading the result in as a sim input.
- New developers may try to reach for `Math.random` inside sim code —
  CONTEXT.md explicitly forbids it.
