---
name: game-sim-determinism
description: >
  Rules for the shared simulation in client/src/sim/ (imported as @sim/) that
  runs identically on the Bun server and the Phaser client. Use when editing
  any file under sim/ — World, World.step, collision, combat, projectile,
  player, weapon, fire, pickup, satellite, round, rng, types, constants,
  destructible — or anywhere "deterministic", "RNG", "seed", "rollback",
  "shared sim", "client/server parity", or "prediction divergence" comes up.
---

# Shared Simulation & Determinism

The `@sim/` package is the **only** code path allowed to mutate authoritative game state. Both the Bun server (`server/src/matchHost.ts`) and the Phaser client (`client/src/net/clientLoop.ts`) import the same `World` and call `World.step(input, dt)`. If they ever produce different output for the same inputs, **client prediction will visibly snap** every snapshot.

The bar here is **soft determinism**: same RNG seed + same input sequence + same starting state ⇒ same world state on both sides, within float epsilon. We're not doing cross-platform hard determinism (lockstep) — the server is authoritative and corrects drift on every snapshot.

> **STATUS UPDATE (May 2026):** the "soft determinism, accept float
> epsilon drift" rule has been **superseded** in JAKESJAM by the
> Zig→WASM substrate decision (ADR-0006, see
> `docs/adr/0006-zig-wasm-sim-substrate.md`). The pivot upgrades
> determinism from "soft / corrected by snapshots" to "hard / bit-
> exact across all hosts" via WASM's spec-mandated IEEE 754
> reproducibility. The rules below are still the *contract* — no
> Math.random, no wall clock, fixed step, etc. The substrate just
> makes the contract automatically enforced rather than aspirational.
>
> See companion skills `zig-wasm-build`, `wasm-ts-bridge`,
> `wasm-game-sim-zig`, and the project-agnostic generalisation in
> `deterministic-netcode-architecture`.

## What "shared" means

- `client/src/sim/` is the source of truth. The server reaches it via the `@sim/` TS path alias (see `tsconfig.json`).
- **Sim files import nothing outside `@sim/` and `@msgpack/msgpack`** — no Phaser, no DOM, no `fetch`, no `convex`. If you need to import any of those, you're in the wrong layer.
- `@sim/types.ts` defines wire-relevant types (`WorldState`, `InputFrame`, `SimEvent`, `Tick`, `InputSeq`). Touching these is a wire-protocol change — bump `PROTOCOL_VERSION`.

## The determinism rules

1. **Seeded RNG only.** Use `@sim/rng.ts` (mulberry32 / xoshiro). **Never** `Math.random` inside `@sim/`. The server sends `rngSeed` in `ServerHello`; client seeds its predicted World with the same value.
2. **No wall clock.** Don't read `Date.now()`, `performance.now()`, or `new Date()` inside the sim. Time is `tick * STEP_MS`, full stop.
3. **Fixed step.** `World.step` takes `dt` for compat but should treat it as `STEP_MS`. Variable dt breaks parity. Clamp/quantise inputs at the loop boundary, not inside the sim.
4. **Stable iteration order.** `Map`/`Set` insertion order is deterministic in V8/Bun, but only as long as you don't delete then re-add. For player lists, sort by `playerId` before iterating any logic that depends on order (e.g. tie-breaking).
5. **No floating-point platform drift assumptions.** The same JS engine on client (V8) and server (JSC, via Bun) is **mostly** the same for IEEE-754 ops, but trig and `Math.pow` can vary. Avoid them in tight authoritative paths or reconcile via snapshot anyway. Server is authoritative — drift is acceptable, just keep it small enough that prediction looks smooth.
6. **No mutation outside `World`.** Sim entities are owned by `World`. A function in `combat.ts` doesn't return a new entity it created — it asks the World to spawn one. This keeps "what changed" auditable for snapshot/event generation.
7. **Events are explicit.** Side effects that the renderer cares about (hit flash, death, pickup) are pushed onto `SimEvent[]` and shipped in the snapshot. Don't infer "a hit happened" by diffing HP — race conditions and missed events are exactly what `events` exists to prevent.

## RNG patterns

```ts
// @sim/rng.ts exposes a stateful generator
const rng = createRng(seed);
const dmg = baseDamage + rng.range(0, 5);   // ✓ deterministic
const dmg = baseDamage + Math.random() * 5; // ✗ desync source
```

When forking RNG (e.g. one stream per round, or one per entity for independent randomness), seed each stream from a hash of `(parentSeed, streamId)`. Don't share one rng across rounds if you ever rewind a round.

## Tests

- `client/src/sim/__tests__/` runs with `bun test`. Sim tests should be **deterministic** by definition — the same inputs always produce the same outputs.
- Snapshot a `World` after N ticks of canned inputs and assert byte equality (msgpack-encoded `WorldState`) across runs. Any test flakiness here = a determinism bug, not a flaky test.
- A "parity" test that runs the same input log through two `World` instances (one created from a serialised snapshot, one from scratch) is gold for catching state-not-fully-captured bugs.

## When to break determinism (rarely)

Cosmetic-only randomness that the renderer owns is fine outside the sim — particle jitter, screen-shake offsets, idle-anim timing. These never feed back into gameplay state, so they don't need to match between peers.

## Anti-patterns (don't do these)

- ❌ `Math.random()` anywhere under `client/src/sim/`. CI should have a grep gate for this.
- ❌ `performance.now()` / `Date.now()` in sim. Use `tick`.
- ❌ Importing Phaser types into `@sim/`. The sim must be runnable by Bun with no DOM.
- ❌ Hidden async (`await`, microtasks) inside `World.step`. The sim is synchronous.
- ❌ Mutating `WorldState` from outside the World methods. Snapshot diffing depends on the World being the only mutator.
- ❌ Adding fields to `WorldState` without updating `protocol.ts` on both sides and bumping `PROTOCOL_VERSION`.

## References (KOLs / sources)

- [Glenn Fiedler — Deterministic Lockstep (why floats are tricky)](https://gafferongames.com/post/deterministic_lockstep/)
- [Glenn Fiedler — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [Casey Muratori — The Curious Case of Casey and the Clearly Deterministic Contraptions](https://gamesfromwithin.com/casey-and-the-clearly-deterministic-contraptions)
