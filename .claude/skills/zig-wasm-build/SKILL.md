---
name: zig-wasm-build
description: >
  Authoritative recipe for compiling Zig source to a `wasm32-freestanding`
  module that loads in both browsers (via Vite) and Bun. Use when starting,
  expanding, or debugging the build pipeline of a Zig→WASM library that
  serves as a deterministic shared core (game sim, physics engine, parser,
  policy engine). PROJECT-AGNOSTIC: no JAKESJAM-specific paths in the rules.
version: 1.0.0
---

# Zig → WASM build

## Why this skill exists

When a project's deterministic core moves from a host language (TS, Python,
Go) to Zig→WASM for cross-host bit-exactness, the *build pipeline* becomes
the load-bearing piece. A wrong target triple gets you a wasm that fails
in the browser. A missed allocator declaration gets you a wasm that crashes
on first call. A missing vite plugin gets you a stale `.wasm` after every
edit. This skill encodes the canonical build recipe and pre-empts the
common traps.

## The hard line

**Target `wasm32-freestanding` (NOT `wasm32-wasi`) for game/physics sims.
Export functions explicitly with `export fn`. Pin Zig version via
`.zig-version`. Wire a vite plugin to rebuild on `.zig` save. Verify
binary size budget at every commit — anything over 64 KB for a sim
is a smell, not a feature.**

## What the KOL says

**Andrew Kelley, Zig BDFL** ([Zig docs §Targets](https://ziglang.org/documentation/master/#Targets)):

> "Zig's first-class WASM support means you can `zig build-lib -target wasm32-freestanding -dynamic` and get a working module without any external toolchain — no `wasm-pack`, no `wasm-bindgen`, no Emscripten."

The two target choices:

- `wasm32-freestanding` — no syscalls, no stdlib I/O. **Right** for
  pure-compute sims that talk to a host via exported functions and shared
  linear memory.
- `wasm32-wasi` — provides POSIX-like syscalls (file I/O, env vars).
  Wrong choice for a game sim because (a) browsers don't implement WASI
  by default and (b) it bloats the binary.

## Canonical project layout

```
<project>/
├── sim/                          ← Zig source root (rename if needed)
│   ├── build.zig                 ← THE build recipe
│   ├── src/
│   │   ├── root.zig              ← public exports
│   │   ├── world.zig
│   │   ├── collision.zig
│   │   └── ...
│   └── test/                     ← `zig test` regression net
├── client/
│   └── src/
│       └── sim/
│           ├── wasm/sim.wasm     ← BUILD ARTIFACT, gitignored
│           └── wasmShim.ts       ← TS host wrapper
├── .zig-version                  ← e.g. `0.13.0`
└── vite.config.ts                ← rebuild plugin
```

The `sim/` directory at the repo root is canonical. Keeping the Zig source
out of the TS workspace makes the build artifact placement obvious and
prevents the TypeScript LSP from indexing thousands of irrelevant files.

## build.zig recipe (Zig 0.13)

```zig
// sim/build.zig
const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });
    const optimize = b.standardOptimizeOption(.{
        .preferred_optimize_mode = .ReleaseSmall,
    });

    const lib = b.addExecutable(.{
        .name = "sim",
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    // CRITICAL: tells Zig to emit a wasm reactor (not a CLI binary with main).
    // Reactors export functions that the host can call. Without this you get
    // a wasm that exports `_start` and nothing else.
    lib.entry = .disabled;
    lib.rdynamic = true;

    // Output goes to a path the TS host expects.
    const install = b.addInstallArtifact(lib, .{
        .dest_dir = .{ .override = .{ .custom = "../client/src/sim/wasm" } },
    });
    b.getInstallStep().dependOn(&install.step);

    // `zig build test` runs Zig-side unit tests — same source, no wasm.
    const tests = b.addTest(.{
        .root_source_file = b.path("src/root.zig"),
        .target = b.host,  // tests run on the dev machine, not wasm
    });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "run unit tests");
    test_step.dependOn(&run_tests.step);
}
```

Key flags explained:
- `lib.entry = .disabled` — emit a wasm reactor, not an executable.
- `lib.rdynamic = true` — re-export everything marked `export fn` so the
  host can call them.
- `.preferred_optimize_mode = .ReleaseSmall` — minimises binary size.
  Default `Debug` builds ship 200+ KB of asserts; `ReleaseSmall` lands
  ~10-30 KB for typical sim scope.

## Exporting functions

```zig
// sim/src/root.zig
const std = @import("std");

pub const State = extern struct {
    tick: u32,
    rng_state: u32,
    // ... rest of the world
};

// Static buffer — wasm allocator surface kept tiny.
var state_buffer: State = std.mem.zeroes(State);

export fn alloc_state() [*]u8 {
    return @ptrCast(&state_buffer);
}

export fn state_size() usize {
    return @sizeOf(State);
}

export fn step(state_ptr: [*]u8, dt_ms: u32) void {
    const state: *State = @ptrCast(@alignCast(state_ptr));
    state.tick += 1;
    _ = dt_ms;
    // ... real step logic
}
```

Rules:
- All exports use **C ABI types**: `u32`, `i32`, pointers (`[*]u8`),
  `usize`. Never `[]u8` (Zig slice) or `*Self` (method receiver) at the
  boundary — those are Zig-specific shapes the host can't read.
- No `try`/`catch` propagation across exports. Wrap in `catch unreachable`
  inside the export, or return an error code.
- Static state buffers are fine and recommended over `allocator.alloc`
  for sim state — it's deterministic, reusable, and the size is
  comptime-knowable.

## Vite integration

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { execSync } from "node:child_process";

export default defineConfig({
  plugins: [
    {
      name: "zig-wasm-rebuild",
      configureServer(server) {
        server.watcher.add("./sim/src/**/*.zig");
        server.watcher.on("change", (path) => {
          if (path.endsWith(".zig")) {
            try {
              execSync("cd sim && zig build", { stdio: "inherit" });
              server.ws.send({ type: "full-reload" });
            } catch (e) {
              console.error("[zig-wasm] build failed:", e);
            }
          }
        });
      },
    },
  ],
  // Vite serves /src/sim/wasm/sim.wasm verbatim because anything in
  // public/ or as a relative URL is treated as a static asset. The TS
  // host fetches it via `await fetch(new URL('./wasm/sim.wasm', import.meta.url))`.
});
```

**Hot reload**: each `.zig` save triggers `zig build` (~200ms in
ReleaseSmall for a small sim), then Vite triggers a full page reload.
Per-component HMR isn't useful for a sim because the *entire wasm
module* is a unit.

## Loading from the host

Browser side:

```ts
const wasmUrl = new URL("./wasm/sim.wasm", import.meta.url);
const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl));
const exports = instance.exports as {
  alloc_state: () => number;
  state_size: () => number;
  step: (state_ptr: number, dt_ms: number) => void;
  memory: WebAssembly.Memory;
};
```

Bun side (server) — identical shape, different fetch:

```ts
const wasmBytes = await Bun.file(import.meta.dir + "/sim.wasm").arrayBuffer();
const { instance } = await WebAssembly.instantiate(wasmBytes);
```

The host code is **substrate-agnostic** — same TS wrapper works for both
sides. That's the determinism guarantee made operational.

## Anti-patterns

- ❌ **Targeting `wasm32-wasi`** for a sim. Adds POSIX surface the
  browser can't satisfy without polyfills.
- ❌ **Forgetting `lib.entry = .disabled`**. You'll get a wasm that
  exports `_start` and your `step` won't be visible.
- ❌ **Allocating in step**. Use `std.heap.FixedBufferAllocator` if
  you must — but the sim's contract is "no allocations during tick".
  See companion skill `wasm-game-sim-zig`.
- ❌ **Slices or Zig structs at the export boundary**. Always C ABI.
- ❌ **No `.zig-version` file**. Zig is pre-1.0; without pinning, a
  contributor on a different version sees mysterious build errors.
- ❌ **Relying on `Math.imul`-style host fallbacks**. Wasm has its
  own integer ops; let Zig generate them.
- ❌ **Shipping debug builds**. `Debug` mode embeds DWARF + asserts —
  binary 5-10× larger. CI must build `ReleaseSmall` (or `ReleaseFast`
  if profiling proves it's needed).

## Pre-flight checklist

- [ ] `.zig-version` file with exact pinned version.
- [ ] `sim/build.zig` exists and `zig build` from clean checkout
      produces `client/src/sim/wasm/sim.wasm`.
- [ ] Binary size < 64 KB. (`du -b client/src/sim/wasm/sim.wasm`)
- [ ] `entry = .disabled` and `rdynamic = true` set on the
      `addExecutable` call.
- [ ] All exports use C ABI types only.
- [ ] Vite plugin reloads on `.zig` save.
- [ ] CI step that runs `zig build && zig build test` on every push.
- [ ] `client/src/sim/wasm/` is in `.gitignore` (build artifact).

## Source

- [Zig — Targets documentation](https://ziglang.org/documentation/master/#Targets)
- [Zig docs — Build system](https://ziglang.org/learn/build-system/)
- [Ziggit thread — wasm32-freestanding in Zig build system](https://ziggit.dev/t/wasm32-freestanding-in-zig-build-system/6340)
- [whit3rabbit/claude-zig-skill](https://github.com/whit3rabbit/claude-zig-skill) — broader Zig fundamentals (use as companion skill, not replacement)
- [WebAssembly Spec — Numeric Instructions (IEEE 754 mandate)](https://webassembly.github.io/spec/core/exec/numerics.html) — *why* wasm gives bit-exact float math
