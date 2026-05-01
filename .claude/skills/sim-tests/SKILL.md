---
name: sim-tests
description: >
  Patterns for the deterministic sim test suite under
  client/src/sim/__tests__/ that runs with `bun test`. Use when writing
  or fixing tests for the simulation: chaos, collision, combat,
  destructible, fire, pickup, rng, round, weaponBuild, world-determinism,
  or anything involving "bun:test", scripted InputFrames, World.create,
  stepWithRuntime, snapshot equality, parity runs, or RNG seeding in
  tests. Skip for non-sim tests.
---

# Sim Test Patterns

The sim under `@sim/` is the only thing in this codebase that is **fully deterministic by design** — that's both why it's testable and why every test must defend that invariant. Tests live alongside source in `client/src/sim/__tests__/` and run with `bun test` (see `package.json` workspace `test` script). The Bun runtime is also what the production server uses, so tests exercise the real engine.

## What a good sim test looks like

```ts
import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";

const TICKS = 600;          // 10 sim-seconds at 60Hz
const DT_MS = 1000 / 60;    // STEP_MS — must match World step

test("two runs with same seed and inputs produce identical state", () => {
  const seed = 42;
  const inputs = scriptInputs(TICKS);

  const a = runWorld(seed, inputs);
  const b = runWorld(seed, inputs);

  expect(a).toEqual(b);
});
```

The `world-determinism.test.ts` file is the **gold standard** — read it before adding new tests in the same shape.

## The four kinds of sim tests

1. **Determinism / parity** — same seed + same inputs ⇒ identical end state. Run the same scenario twice in one test, assert structural equality of `WorldState`. Anything flaky here is a real bug, not a test bug.
2. **Behavioural** — given a known starting state, does X mechanic do Y? `combat.test.ts`, `collision.test.ts`, `pickup.test.ts`. Use small custom maps, not real game maps.
3. **Property / chaos** — generate randomised input streams and check invariants that should *always* hold (e.g. "no entity ever has NaN position", "HP never negative"). `chaos.test.ts` is the prototype here. Use a seeded generator so failures repro.
4. **RNG** — the RNG itself is tested in `rng.test.ts`. New RNG primitives need: distribution sanity, repro from seed, fork independence.

## Mandatory rules for sim tests

- **Use `bun:test`, not Jest.** Imports are `from "bun:test"`. Don't add a Jest config.
- **Always seed the World explicitly.** `World.create({ ..., rngSeed: 42 })`. Tests that don't seed are non-deterministic; CI will be flaky.
- **Step at the real `STEP_MS`.** A test that uses `dt: 50` is testing an alternate physics — fine for one-off, but never passes that into a parity test.
- **Tests must not import Phaser, the DOM, Convex, or `fetch`.** If you can't run the test with `bun test --silent` from a cold checkout, it's not a sim test.
- **Construct minimal `MapDefinition`s in-test.** Don't load real arena maps from disk in unit tests — they couple tests to designer-tweakable data. The `oneFloorMap` shape in `world-determinism.test.ts` is the template.
- **Compare snapshots, not field-by-field.** `expect(stateA).toEqual(stateB)` deep-checks the whole `WorldState`. If equality drift becomes a problem, hash the msgpack-encoded form.

## Useful test helpers (write these once, reuse)

```ts
// constant-input-for-N-ticks helper
function holdInput(playerId: PlayerId, keys: InputBitfield, n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let tick = 0; tick < n; tick++) {
    out.push({ playerId, seq: tick, tick, keys, aimX: 0, aimY: 0, dt: DT_MS });
  }
  return out;
}

// run-and-collect helper
function runWorld(seed: number, frames: InputFrame[][]): WorldState {
  const world = World.create({ ..., rngSeed: seed });
  const runtime = createRuntime(world);
  for (let tick = 0; tick < frames.length; tick++) {
    stepWithRuntime(runtime, frames[tick], DT_MS);
  }
  return world.state;
}
```

## What tests catch (and what they don't)

- ✅ Sim drift between client prediction and server (parity tests).
- ✅ Mechanic regressions when refactoring `combat.ts` etc.
- ✅ NaN / Infinity / negative-HP class bugs (chaos tests).
- ❌ Network desync caused by message ordering — that's an integration concern; mock the transport in `client/src/net/` tests, not here.
- ❌ Phaser rendering issues — out of scope.
- ❌ Performance regressions — `bun test` is correctness, not perf. Use a separate bench.

## When a test fails for "non-determinism"

1. Grep your changes for `Math.random` and `Date.now()` — that's >90% of cases.
2. Check for `Map`/`Set` deletion-then-reinsertion changing iteration order.
3. Check for new `Array.from(set)` or `[...set]` patterns where the set isn't insertion-ordered.
4. Run with `--reporter=verbose` to see which expectation diverged first; the *first* divergence is almost always the cause.

## CI integration

- `bun run test` runs every workspace's `test` script that exists. Sim tests run under `client`.
- A failing parity test should **block the merge**. These are the load-bearing tests for netcode correctness.

## References

- [Bun Test runner docs](https://bun.sh/docs/cli/test)
- [Glenn Fiedler — Deterministic Lockstep (why determinism matters)](https://gafferongames.com/post/deterministic_lockstep/)
- See also the project's `game-sim-determinism` skill for sim-authoring rules these tests defend.
