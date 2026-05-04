---
name: wasm-game-sim-zig
description: >
  Game-sim design rules SPECIFIC to a Zig-implemented WASM core. Covers
  data-oriented layout, comptime tricks for entity tables, allocator
  discipline (no GC, no per-step allocs), the deterministic step
  contract, and how it composes with the host's prediction-reconcile
  loop. Use when designing or extending the sim-side module of a
  Zig→WASM gamedev project. PROJECT-AGNOSTIC.
version: 1.0.0
---

# WASM game sim in Zig

## Why this skill exists

A WASM-backed sim is only useful if it stays *deterministic* and
*allocation-free* during the per-tick step. Zig's manual memory model
makes that easy by default — but only if you write the sim that way.
Patterns that look fine in TS or Rust (heap-allocating per-frame
structs, hashmaps keyed by string) silently undo the determinism +
perf wins. This skill encodes the design rules for a sim that
*stays* fast and exact.

Read the companion skills first:

- `zig-wasm-build` — toolchain + binary
- `wasm-ts-bridge` — host boundary
- `deterministic-netcode-architecture` — how the sim plugs into
  prediction + reconciliation
- `game-sim-determinism` — substrate-neutral determinism rules
  (no `Math.random`, no wall-clock, no `await`)

## The hard line

**Static state buffer + `FixedBufferAllocator` only — no
`GeneralPurposeAllocator` calls during step. Entity tables are
struct-of-arrays. RNG is a single `u32` cursor threaded through
every system. Trig is `std.math.sin`/`cos` (wasm spec guarantees
identical results across hosts). All cross-system iteration order
is comptime-deterministic — no hashmap iteration where order
matters.**

## What the KOLs say

**Mike Acton, "Data-Oriented Design and C++"** (CppCon 2014):

> "Where there is one, there are many. Reason about your data."

For a sim with N players + M projectiles + K destructibles, the
default OOP shape (`class Player { ... }; class Projectile { ... };`
each allocated independently) is the wrong reflex. Pack each
entity type into a struct-of-arrays so the per-frame cache
behaviour is predictable + the layout is wasm-export-friendly.

**Andrew Kelley, "How to make a small Zig project"** ([Zig blog 2024](https://ziglang.org/news/migrate-to-0.12.0/)):

> "If you find yourself reaching for `try allocator.alloc` inside a
> hot loop, stop. Pre-allocate at init; reuse the buffer."

The sim's tick loop is the hot loop. Pre-allocate buffers at
`init()`, reset them at the top of each `step()`, never `alloc`
during a step.

## Canonical sim layout

```
sim/src/
├── root.zig              ← public exports: alloc_state, state_size, step
├── state.zig             ← `State` extern struct (the wire-shape buffer)
├── world.zig             ← `step()` orchestrator
├── rng.zig               ← mulberry32 / xoshiro
├── collision.zig         ← AABB, swept hit, drift probe
├── player.zig            ← stepPlayer
├── projectile.zig        ← stepProjectile
└── ...
```

`state.zig` is the load-bearing file. It defines the sim's WIRE
shape. Both the host (TS) and the sim (Zig) read the same byte
layout. Whatever fields you declare here become wire-encoded for
free.

```zig
// sim/src/state.zig
pub const MAX_PLAYERS = 8;
pub const MAX_PROJECTILES = 256;
pub const MAX_DESTRUCTIBLES = 64;

pub const Player = extern struct {
    id: u32,
    x: f32, y: f32,
    vx: f32, vy: f32,
    health: i32,
    flags: u32,  // bitfield: alive, grounded, crouching, ...
};

pub const Projectile = extern struct {
    id: u32, owner: u32,
    x: f32, y: f32,
    vx: f32, vy: f32,
    age_ms: u32,
    flags: u32,
};

pub const State = extern struct {
    tick: u32,
    rng_state: u32,
    player_count: u32,
    projectile_count: u32,
    destructible_count: u32,
    players: [MAX_PLAYERS]Player,
    projectiles: [MAX_PROJECTILES]Projectile,
    destructibles: [MAX_DESTRUCTIBLES]Destructible,
};
```

Properties this gives you for free:

- `extern struct` = guaranteed C ABI layout, identical on every
  wasm host.
- Static array sizes + counts = no heap, no growable allocators.
- `State` size is comptime-knowable: ~`@sizeOf(State)` bytes.
  Host reads/writes a single `Uint8Array` slice of that size.
- Wire-encode is a memcpy — no msgpack overhead for fixed-shape
  state.
- The `flags` bitfield packs ~32 booleans per player; far cheaper
  than 32 `bool` fields each occupying a byte (or worse, padded
  to 4 bytes).

## RNG threading

```zig
// sim/src/rng.zig
pub fn next(rng_state: *u32) u32 {
    // mulberry32
    rng_state.* +%= 0x6D2B79F5;
    var z = rng_state.*;
    z = (z ^ (z >> 15)) *% (z | 1);
    z ^= z +% (z ^ (z >> 7)) *% (z | 61);
    return z ^ (z >> 14);
}

pub fn nextFloat01(rng_state: *u32) f32 {
    return @as(f32, @floatFromInt(next(rng_state))) / 4294967296.0;
}
```

Single cursor, threaded through every system. No `std.Random` (its
implementation isn't guaranteed wire-stable across Zig versions).

## The step orchestrator

```zig
// sim/src/world.zig
pub fn step(state: *State, dt_ms: u32) void {
    state.tick += 1;
    const dt_sec: f32 = @as(f32, @floatFromInt(dt_ms)) / 1000.0;

    // 1. Player movement + fire — every alive player.
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        player.step(&state.players[i], dt_sec, &state.rng_state);
    }
    // 2. Projectile motion + impact.
    i = 0;
    while (i < state.projectile_count) : (i += 1) {
        projectile.step(&state.projectiles[i], state, dt_sec);
    }
    // 3. ... etc
}
```

Properties:
- No allocations during step.
- Iteration order = array order = comptime-deterministic.
- `dt_sec` is a parameter; no wall-clock reads inside.
- All randomness threaded via `state.rng_state` — no hidden RNG.

## Comptime patterns

Zig's `comptime` lets you express invariants the type system can't:

```zig
// Static-assert that State fits in 64 KB (wasm linear memory page).
comptime {
    if (@sizeOf(State) > 65536) {
        @compileError("State exceeds one wasm page; either shrink or
                       grow MAX_* limits deliberately.");
    }
}
```

Lookup tables (e.g. weapon stats, character archetypes) declared at
`comptime` are baked into the wasm `.rodata` segment — zero runtime
cost, zero allocation.

```zig
const WEAPONS = [_]WeaponDef{
    .{ .id = 0, .damage_per_shot = 25, .shots_per_sec = 5 },
    .{ .id = 1, .damage_per_shot = 60, .shots_per_sec = 1.5 },
    // ...
};
```

## Allocator discipline

The sim should have **at most one allocator**: a
`std.heap.FixedBufferAllocator` over a static buffer for cases
where you genuinely need scratch space (e.g. the swept-collision
slide loop's candidate list).

```zig
var scratch_buf: [16384]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&scratch_buf);

pub fn step(...) void {
    fba.reset();  // free everything from the previous step
    const allocator = fba.allocator();
    // ... use allocator inside step; reset at top of next step
}
```

**Never** use `std.heap.GeneralPurposeAllocator` in the sim — it
performs OS-level mmap calls that don't exist in
`wasm32-freestanding`. The build will fail.

## Determinism gotchas

- **`std.math.sin`/`cos` are deterministic in wasm** because the
  WASM spec mandates IEEE 754. Use them freely. (This is the whole
  reason for the wasm pivot.)
- **Iteration over `std.AutoHashMap`** has nondeterministic order
  across Zig versions — never iterate a hashmap where order
  matters; sort first or use a struct-of-arrays.
- **`std.time.nanoTimestamp()`** reads wall clock — forbidden in
  sim, exactly like `Date.now()` in TS.
- **`std.Thread`** doesn't exist in `wasm32-freestanding`. The sim
  is single-threaded by construction.
- **Floating-point exceptions** are silently turned off in wasm —
  `0.0 / 0.0` produces NaN without trapping. Be defensive in
  divides where the divisor can be zero.

## Test harness

Zig has a built-in test runner. Tests run on the dev host (not
wasm) for speed; the *contract* is that the same code produces
the same outputs whether run native or in wasm:

```zig
// sim/src/collision.zig
test "swept AABB does not tunnel through thin floor" {
    const platform = AABB{ .x = 0, .y = 100, .w = 200, .h = 18 };
    var mover = AABB{ .x = 50, .y = 0, .w = 28, .h = 56 };
    const result = resolveMove(&mover, 0, 1500, 1.0 / 60.0, &.{platform});
    try std.testing.expect(result.grounded);
    try std.testing.expectApproxEqAbs(@as(f32, 100.0), mover.y + mover.h, 0.001);
}
```

Run with `zig build test`. CI runs both `zig build` (compiles wasm)
and `zig build test` (runs the test suite). Same source.

## Anti-patterns

- ❌ **`std.heap.GeneralPurposeAllocator` in the sim.** Crashes
  in wasm32-freestanding.
- ❌ **`@import("std").debug.print` in step.** No stdout in wasm
  freestanding; logs go nowhere.
- ❌ **`std.AutoHashMap` for entity lookup.** Use
  `for (players[0..player_count])` and let the linear scan win at
  this scale (< 50 entities per tick).
- ❌ **`pub fn step` on a `pub const Self = @This()` method.**
  Method receivers don't survive the wasm export ABI; export free
  functions.
- ❌ **Per-step `try allocator.alloc`.** Pre-allocate or use the
  `FixedBufferAllocator`.
- ❌ **`std.crypto.random`** — not deterministic. Always thread
  the seeded RNG state.
- ❌ **Mutating fields in the wrong sim phase.** Order of phases
  (input → movement → fire → projectiles → collision → round) is
  the contract; reordering breaks parity tests.

## Pre-flight checklist

- [ ] `State` is `extern struct` with comptime-knowable size.
- [ ] No `pub fn step` with a method receiver — free functions only.
- [ ] No `std.heap.GeneralPurposeAllocator` anywhere in the sim.
- [ ] All randomness through `state.rng_state` + `rng.next()`.
- [ ] No `std.time.*`, no `std.fs.*`, no `std.process.*`.
- [ ] All trig through `std.math.{sin,cos,atan2,sqrt}`.
- [ ] Test suite runs via `zig build test` and passes the same
      cases the host's test suite passed pre-pivot.
- [ ] Step is single-threaded; no `std.Thread`, no `async`.
- [ ] Comptime asserts on State size, MAX_* counts, struct
      alignment.

## Source

- [Mike Acton — Data-Oriented Design and C++ (CppCon 2014)](https://www.youtube.com/watch?v=rX0ItVEVjHc)
- [Andrew Kelley — Zig 0.12.0 release notes](https://ziglang.org/news/migrate-to-0.12.0/)
- [Zig docs — `extern struct` semantics](https://ziglang.org/documentation/master/#extern-struct)
- [Zig docs — `std.heap`](https://ziglang.org/documentation/master/std/#std.heap) — allocator catalogue
- [WebAssembly Spec — Numeric Instructions](https://webassembly.github.io/spec/core/exec/numerics.html) — IEEE 754 mandate
- Companion skills: `zig-wasm-build`, `wasm-ts-bridge`,
  `deterministic-netcode-architecture`, `game-sim-determinism`
