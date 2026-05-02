---
name: bisect-determinism
description: >
  Playbook for diagnosing JAKESJAM sim determinism failures. Use when
  world-determinism.test.ts (or any parity test in client/src/sim/__tests__/)
  fails, when the user reports "client/server desync", "rollback
  divergence", "RNG drift", "snapshot mismatch", or when a sim-touching
  change broke a previously-green test.
version: 1.0.0
---

# Bisect Determinism Failures

## Why this skill exists

The deterministic sim is JAKESJAM's authority foundation. When parity
breaks, every higher layer (netcode, replay, spectator) is degraded.
Determinism failures often look small (one tick of divergence) but
compound exponentially — a single non-deterministic op anywhere in
sim/ poisons everything downstream.

This skill is a structured bisect protocol so you find the cause in
≤4 tool calls instead of guessing.

## The hard line

**Determinism is not a feature you tune. It's binary: either every
input sequence produces the same `WorldState` snapshot bit-for-bit on
every host, or the game is broken. Don't try to "tolerate small drift".
Find and remove the source.**

## Step 1 — Confirm and characterize

```bash
bun test client/src/sim/__tests__/world-determinism.test.ts
```

Read the failure carefully. What you want to extract:

- Which seed(s) failed?
- At what tick does the divergence first appear? (Tests usually log
  the first differing tick.)
- Which `WorldState` field differs? (player position, projectile
  array length, RNG cursor, fire patches, etc.)

If the test doesn't print enough detail, edit the test to log the
first differing field — but do this in a separate commit, don't mix
it with your fix.

## Step 2 — Suspect list (in order of likelihood)

Bisect by category. Each category has a grep that catches it.

### A. Non-deterministic primitives in sim/

```bash
grep -rn "Math\.random\|Date\.now\|performance\.now\|crypto\." client/src/sim/
```

If any hit: that's the source. Sim/ must use the seeded RNG only
(see `client/src/sim/rng.ts` or equivalent).

### B. Iteration order over a Map/Set

```bash
grep -rn "Map\|Set\|forEach\|for.*of" client/src/sim/ | grep -v "// deterministic"
```

`Map` and `Set` iteration is insertion-ordered, which IS deterministic
**if** insertions happen in the same order on every host. Cross-host
hash collisions or async insertions break this. Look for any sim path
that inserts based on a non-deterministic source.

### C. Floating point order-of-operations

Sums of forces or velocities computed in different orders give
different bits. Search for arithmetic over arrays:

```bash
grep -rn "reduce\|\.\\.\\.players\|\\.forEach.*\\+=\|sort" client/src/sim/
```

If the suspect is a `sort`, check the comparator is total-ordering
(equal elements must have stable resolution by ID).

### D. Object reference equality

Identity-based comparisons `entity === otherEntity` survive within one
host but break across hosts that re-build the snapshot from wire.
Search:

```bash
grep -rn "===\s*[a-z]\|!==\s*[a-z]" client/src/sim/ | head
```

Convert to ID-based comparisons.

### E. JSON serialization order

`JSON.stringify` is not stable across object shapes. If parity test
hashes via stringify, the schema must use the same key insertion
order. Prefer msgpack or a fixed-order serializer.

## Step 3 — Bisect the recent diff

If categories A–E don't immediately surface a culprit, bisect by
recent commits:

```bash
git log --oneline -- client/src/sim/ | head -10
```

Pick a commit known-green (last successful test run) and the current
HEAD. Stash any uncommitted work, then:

```bash
git bisect start <bad> <good> -- client/src/sim/
git bisect run bun test client/src/sim/__tests__/world-determinism.test.ts
```

When `bisect` lands on a single commit, read the diff with `git show
<sha>` and look for any of A–E patterns introduced.

## Step 4 — Reproduce minimally

Once you suspect a specific function, write a minimal test:

- Same seed
- Same starting `WorldState`
- Run `step()` N times for N just past the first divergent tick
- Compare snapshot fields

This is a separate test file, not a modification of the existing one.
Deletes once the fix lands.

## Step 5 — Fix and verify

Apply the smallest possible fix. Re-run:

```bash
bun test client/src/sim/__tests__/
```

All sim tests must pass — not just the one that was failing. A fix
that breaks adjacent tests is worse than the original bug.

## Common JAKESJAM-specific gotchas

- **Spawning order:** if players spawn in a Map keyed by `playerId`
  and `playerId` comes from a non-deterministic source (e.g. a UUID
  generated client-side), iteration order diverges. Solution: spawn
  via a sorted-by-ID list, or pass spawn order as a deterministic
  input.
- **Projectile pool reuse:** if pooled projectile slots are reclaimed
  in a "first-free-slot" manner that depends on previous-tick state,
  one missed tick on a host poisons all subsequent slot indices.
- **RNG cursor:** `WorldState.rngCursor` must advance the same number
  of times on every host. If a code path on the client calls the RNG
  but the server path doesn't (or vice versa), they desync without an
  obvious data difference.
- **Chaos modifiers:** `getChaosProfile()` must be pure of any state
  outside the modifier id list. Anything reading the wall clock, the
  match start time, or the round index from anywhere other than the
  passed-in `WorldState` is a bug.

## Reporting the fix

```
bisected: <suspect category A-E or commit sha>
root cause: <one sentence>
fix: <file:line, what changed>
verified: bun test sim/ → all pass (N tests, Xms)
```
