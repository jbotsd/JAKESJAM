---
name: zig-code-quality
description: >
  Zig style + idiom + footgun rules for the JAKESJAM `sim/` Zig code
  (Zig 0.15.2, wasm32-freestanding). Use when editing any
  `sim/src/*.zig` or `sim/build.zig` — covers naming, error handling,
  comptime vs runtime, memory ownership, ABI stability, integer
  arithmetic, common pitfalls. Read before merging Zig PRs. Pairs
  with `zig-wasm-build`, `wasm-ts-bridge`, `wasm-game-sim-zig` —
  those skills cover toolchain + boundary; this one is the language
  itself.
---

# Zig Code Quality (JAKESJAM)

The `sim/` Zig code is the deterministic core of the game. It runs
in wasm32-freestanding on V8, JSC (Bun), and any future host. Every
line shipped here either runs identically on every platform or
silently produces a divergence bug that the netcode reconcile loop
can't catch. The bar is high.

## Source authority

- Zig **0.15.2** (pinned in `.zig-version`).
- Official style guide: <https://ziglang.org/documentation/0.15.1/#Style-Guide>
- Zig standard library is the reference for idiomatic patterns —
  read `std.math`, `std.mem`, `std.testing` source when in doubt.
- TigerBeetle's Zig style guide is the best-in-class production
  reference: <https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md>

## Naming (non-negotiable)

| Kind | Style | Example |
|---|---|---|
| Type (struct, enum, union) | `PascalCase` | `AABB`, `SweepHit`, `WorldState` |
| Function returning a type | `PascalCase` | `fn ArrayList(comptime T: type) type` |
| All other functions | `camelCase` | `nextU32`, `sweepAgainstOne`, `resolveMove` |
| Variable, parameter | `snake_case` | `state_buffer`, `mover_x`, `cur_vy` |
| Constant | `SCREAMING_SNAKE` | `STATE_SIZE`, `FNV1A_PRIME_32` |
| Field on a struct | `snake_case` | `grounded_this_frame`, `state_ptr` |
| File / module | `snake_case` | `rng.zig`, `collision.zig` |

**Wasm exports** match the wasm convention (`snake_case`) since
they're called from JS:
```zig
pub export fn rng_next_u32(state: u32) u32 { ... }   // ✓ wasm-friendly
pub export fn rngNextU32(state: u32) u32 { ... }     // ✗ awkward in JS
```

The internal Zig fn called by other Zig modules is `camelCase`; the
wasm export shim wraps it in `snake_case`. See `sim/src/rng.zig`'s
`nextU32` (internal) vs `rng_next_u32` (export).

## Integer arithmetic — the determinism rules

**Always pick the operator deliberately.** Zig has three flavours of
arithmetic and silently picking the wrong one is the #1 source of
hard-to-find bugs:

| Operator | Behaviour | When to use |
|---|---|---|
| `+`, `-`, `*` | Checked: panics in Debug on overflow, UB in Release | Arithmetic on values you can prove won't overflow (loop indices, byte counts) |
| `+%`, `-%`, `*%` | Wrapping: 2's complement modular arithmetic | RNG, hash, anything that ports a `>>> 0` / `Math.imul` JS pattern |
| `+\|`, `-\|`, `*\|` | Saturating: clamps to MIN/MAX on overflow | Health, damage clamping, score |

For our porting work: **JS `>>> 0` ⇒ Zig u32 + `+%`/`*%`/`-%`**.
JS `Math.imul(a, b)` ⇒ Zig `*%` on i32 OR u32 (same bits). The
`rng.zig` and `hash.zig` ports MUST use wrapping ops or they'll
panic in debug builds and produce wrong values in release.

**Shifts:** `>>` and `<<` are unchecked in Zig. The shift amount type
is `std.math.Log2Int(T)` (e.g. `u5` for `u32`). When porting JS
`x >>> 15`, the literal `15` works because Zig coerces; for variable
shifts, cast to `u5`.

## Error handling

Use Zig's error union types (`!T` or `ErrorSet!T`); never invent
sentinel return values. The wasm boundary is the exception — that's
where errors get flattened to int return codes (`0 = ok`, `< 0 =
error code`) because wasm has no exceptions. See `wasm-ts-bridge`
skill.

```zig
// ✓ Idiomatic Zig within sim
fn loadMap(name: []const u8) !MapDefinition { ... }

// ✓ At the wasm export boundary
pub export fn load_map(name_ptr: [*]const u8, name_len: u32) i32 {
    const name = name_ptr[0..name_len];
    _ = loadMap(name) catch |err| return @intFromEnum(err);
    return 0;
}
```

`catch unreachable` is **only** for cases that are provably
impossible — assert it loud:
```zig
const v = parseU32("123") catch unreachable; // ✗ if "123" ever changes, silent crash in Release
const v = parseU32("123") catch |err| std.debug.panic("static parse failed: {}", .{err}); // ✓
```

## Memory & allocation

In wasm32-freestanding the rules are tight:

- **No `std.heap.GeneralPurposeAllocator`** — depends on syscalls.
- **No global allocator on the hot path.** State buffers are
  static (`var state_buffer: [N]u8 align(8) = @splat(0);`) sized
  for the worst case at comptime.
- For dynamic-but-bounded allocation inside a tick, use
  `std.heap.FixedBufferAllocator` over a per-tick scratch buffer,
  reset at tick end. Allocations cost a pointer bump.
- Slices over the static buffer are how data flows internally —
  pass `[]const T` into pure functions; never pass an Allocator
  through a function that doesn't need to allocate.
- **Never return a pointer to a stack-local.** Zig won't catch this
  in Release; you'll see corrupt `WorldState` fields after a return.

```zig
// ✓ static, no allocator
var entities: [MAX_ENTITIES]Entity align(8) = @splat(.{});
pub fn entitiesActive(world: *const World) []const Entity {
    return entities[0..world.entity_count];
}

// ✗ heap allocation inside step
pub fn step(world: *World) !void {
    const tmp = try allocator.alloc(u32, 100); // GC-equivalent — not ok
    defer allocator.free(tmp);
    // ...
}
```

## Struct kinds (pick deliberately)

| Kind | Layout | Use for |
|---|---|---|
| `struct` | Compiler chooses (may reorder fields) | Internal Zig types, never crossing wasm boundary |
| `extern struct` | C ABI, source order, no reorder | EVERY type at the wasm boundary, EVERY type in `WorldState` (must round-trip across hosts) |
| `packed struct` | Bit-packed, no padding | Wire-format flags / bitfields — rare in our sim |

Default to `extern struct` for any sim type that's part of
`WorldState`, even if no boundary call references it today. The
moment you switch to a struct that gets reordered, snapshot bytes
diverge across compilations.

```zig
pub const AABB = extern struct {  // ✓ stable layout
    x: f64,
    y: f64,
    w: f64,
    h: f64,
};

pub const InternalScratch = struct { ... };  // ✓ ok if never serialised
```

## Optionals & null

Zig's `?T` is explicit nullability with type-level safety. Never
fake-null with sentinel values (`-1`, `0xFFFF_FFFF`) inside Zig
code — only at the wasm boundary where the ABI demands it.

```zig
// ✓ idiomatic
fn findPlayer(world: *const World, id: PlayerId) ?*const Player { ... }
if (findPlayer(world, id)) |p| {
    use(p);
} else {
    // not found
}

// ✗ sentinel inside Zig
fn findPlayerIdx(...) i32 {
    return -1; // not found
}
```

`orelse` for fallback, `?` operator for propagation:
```zig
const p = findPlayer(world, id) orelse return error.PlayerMissing;
```

## Comptime — use it, but only when it pays

Comptime is for compile-time computation, generic types, and lookup
tables. Don't use it for "runtime config that happens to be known
at comptime" — that's just `const`.

```zig
// ✓ generic type
fn ArrayList(comptime T: type) type { ... }

// ✓ lookup table
const SIN_TABLE: [4096]f64 = comptime build: {
    var t: [4096]f64 = undefined;
    for (&t, 0..) |*slot, i| slot.* = @sin(@as(f64, @floatFromInt(i)) * std.math.pi / 8192.0);
    break :build t;
};

// ✗ comptime where const would do
comptime var counter: u32 = 0;
counter += 1; // why? `const counter: u32 = 1;` is the answer
```

## Tests

- Use Zig's built-in `test "name" { ... }` blocks; run via
  `zig build test`.
- Test files live at `sim/test/*.zig` and import the module under
  test as a build-graph dependency (see `sim/build.zig`'s
  `test_module.addImport("sim_root", sim_root_native)`).
- One assertion per concept; multiple `try expectEqual(...)` calls
  per test are fine.
- `try std.testing.expectEqual(@as(T, expected), actual)` — the
  `@as` cast is needed because `expectEqual` infers the second arg's
  type and an integer literal is `comptime_int` until coerced.
- For determinism tests, run the same input through the function N
  times and assert byte-equality of every output, not just the
  final state.

## Common Zig footguns (don't do these)

- ❌ `var` where `const` would do. Zig flags this in 0.13+ but it
  used to silently allow it; pre-existing code may need a sweep.
- ❌ `_ = thing;` to silence unused warnings inside a function — use
  `_ = thing;` only at function-level for unused params, never in
  the middle of a fn body where you actually meant to use it.
- ❌ `@as(T, x)` where the coercion is implicit — adds noise. Only
  use when the inference fails or you want an explicit narrowing.
- ❌ Returning `[*]u8` (many-pointer) from a Zig fn — the caller has
  no length. Return `[]u8` (slice) for safety. `[*]` is only for
  the wasm boundary where ABI demands it.
- ❌ `undefined` for partial initialisation when you mean
  zero-init. Use `@splat(0)` or `.{ ... }` with all fields. Reading
  `undefined` in Debug panics; in Release reads garbage.
- ❌ Forgetting `pub` on declarations meant to be visible. Zig
  compiles fine without it but the consumer's import returns
  "is not marked pub" at use-site. (We hit this on Phase A —
  `export fn` doesn't imply `pub`.)
- ❌ Importing the rest of `std` when you only need `std.testing` —
  bloats compile time. Just `const testing = @import("std").testing`.
- ❌ `@cImport` in this codebase. Zig→wasm freestanding has no C
  to import.

## Format + lint gates

- `zig fmt --check sim/` MUST pass — CI gates it.
- `zig fmt` is canonical; do not configure formatter options. The
  Zig project deliberately removed knobs. If `zig fmt` rewrites
  your code, accept it.
- No third-party linter required — Zig's compiler diagnostics +
  `zig fmt` cover the surface area we care about. `zig build`
  with `-Doptimize=ReleaseSmall` will catch most issues; debug
  builds catch overflow/undefined-read issues that release won't.

## Wasm export ABI checklist

Before exposing a new wasm export:

- [ ] All argument types are `i32`, `i64`, `f32`, `f64`, or
      `[*]T` / `*T` (pointer).
- [ ] Multi-value return is avoided (some hosts trip on it). Pack
      into i64 or use an out-pointer.
- [ ] Output structs are `extern struct` and the size is exposed
      via a `sizeof_*` export so the host can validate.
- [ ] No allocator argument — wasm-freestanding has none in scope.
- [ ] No error union return — flatten to `i32` status code.
- [ ] Function name uses `snake_case` to match wasm convention.

## Pre-PR checklist for `sim/*.zig`

- [ ] `zig fmt --check sim/` passes.
- [ ] `zig build test` all green.
- [ ] `zig build` with no -Doptimize flag also produces a wasm at
      `client/public/wasm/sim.wasm` (ReleaseSmall is forced for the
      wasm artifact).
- [ ] `bun run --filter client test` — TS parity tests still
      green; if you added a wasm export, you added a parity test
      under `client/src/sim/wasm/__tests__/`.
- [ ] No new `extern struct` field added without bumping the
      protocol or a layout-stability comment.
- [ ] Wrapping ops `+%`/`-%`/`*%` used wherever a TS `>>> 0` /
      `Math.imul` lived in the source.
- [ ] No `std.debug.print` / `std.log` calls reachable from a wasm
      export — there's no console in freestanding.

## References

- [Zig Style Guide](https://ziglang.org/documentation/0.15.1/#Style-Guide)
- [Zig Documentation](https://ziglang.org/documentation/0.15.1/)
- [TigerBeetle TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md)
- [Andrew Kelley — Zero-Cost Stack Traces](https://andrewkelley.me/post/zig-stack-traces-kernel-panic-bare-bones-os.html)
- [Zig std.math source](https://github.com/ziglang/zig/tree/master/lib/std/math)
- Adjacent skills:
  `zig-wasm-build`, `wasm-ts-bridge`, `wasm-game-sim-zig`,
  `game-sim-determinism`.
