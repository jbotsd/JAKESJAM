---
name: wasm-ts-bridge
description: >
  Patterns for the JS/TS host ↔ WASM module boundary — typed-array views
  on linear memory, struct memory layouts, msgpack at the seam, hot
  reload, error propagation. Use when wrapping a wasm module exported
  by Zig/Rust/AssemblyScript with a typed TypeScript surface that mirrors
  the wasm exports. PROJECT-AGNOSTIC: drops into any TS app that loads
  a wasm module.
version: 1.0.0
---

# WASM ↔ TypeScript bridge

## Why this skill exists

A wasm module gives bit-deterministic compute. The bridge gives the
*host* (browser or Bun) a way to talk to that compute without losing
the determinism property. Most bridge bugs come from:

1. Reading wasm memory through a stale `Uint8Array` view (memory grew
   during a call).
2. Wrong struct layout — the host reads field offsets that don't
   match the wasm side's struct.
3. Allocation crossings — host allocates, wasm holds reference, GC
   moves something at the wrong moment.

This skill encodes the safe patterns for a small, fast, type-safe
bridge.

## The hard line

**One source of truth for struct layouts (Zig comptime → TS codegen
OR a hand-written shared schema). Refresh `Uint8Array` views after
any export call that may grow memory. Use msgpack for variable-shape
payloads (events, snapshots), raw memory views for fixed-shape state.
Errors propagate as return-code ints, never as wasm `unreachable`.**

## What the KOL says

**Lin Clark, "WebAssembly's post-MVP future"** ([CSS-Tricks 2018](https://hacks.mozilla.org/2018/10/webassemblys-post-mvp-future/)):

> "WebAssembly currently can only use numbers as parameters. Strings
> and other complex types must be encoded into linear memory and
> passed as integer offsets and lengths."

That's still the operational rule even after Component Model
proposals — for production today, your bridge is `int → memory offset`.

## Canonical bridge module shape

```ts
// wasmShim.ts (or whatever the host calls it)
import wasmUrl from "./wasm/sim.wasm?url";

type Exports = {
  memory: WebAssembly.Memory;
  alloc_state: () => number;     // returns ptr
  state_size: () => number;      // bytes
  step: (state_ptr: number, dt_ms: number) => void;
  // ... domain-specific exports
};

export class Wasm {
  private readonly exports: Exports;
  private readonly statePtr: number;
  private readonly stateSize: number;

  static async load(url: string = wasmUrl): Promise<Wasm> {
    const response = await fetch(url);
    const { instance } = await WebAssembly.instantiateStreaming(response);
    return new Wasm(instance.exports as Exports);
  }

  private constructor(exports: Exports) {
    this.exports = exports;
    this.statePtr = exports.alloc_state();
    this.stateSize = exports.state_size();
  }

  /** Read N bytes at the state pointer. ALWAYS allocate a fresh view
   *  (a previous view becomes invalid if memory grew since it was
   *  taken). */
  readState(): Uint8Array {
    return new Uint8Array(
      this.exports.memory.buffer,
      this.statePtr,
      this.stateSize,
    );
  }

  step(dtMs: number): void {
    this.exports.step(this.statePtr, dtMs);
  }
}
```

Use:

```ts
const sim = await Wasm.load();
sim.step(16);
const stateBytes = sim.readState();
// decode stateBytes into a typed shape...
```

## The memory-view trap

`WebAssembly.Memory` can grow. When it does, the underlying
`ArrayBuffer` is replaced — every existing `Uint8Array`/`DataView`
that referenced the old buffer is **detached**. Reading from it
silently returns zero on V8 and throws on JSC.

Rule: **never cache a view across a wasm call.** Always re-create:

```ts
// ❌ BAD — view becomes detached after step() if step grows memory
const view = new DataView(this.exports.memory.buffer);
this.exports.step(this.statePtr, dtMs);
const tick = view.getUint32(this.statePtr, true); // garbage on V8

// ✅ GOOD — fresh view after the call
this.exports.step(this.statePtr, dtMs);
const view = new DataView(this.exports.memory.buffer);
const tick = view.getUint32(this.statePtr, true);
```

For sims that use a fixed-size static state buffer (no allocator
calls during step), memory never grows — so caching is safe in
practice. But the safer default is to re-create the view; it's a
two-line cost in the common case.

## Struct layout: single source of truth

Three viable patterns, in order of preference:

**Pattern A — Zig comptime → JSON → TS codegen.** Zig's `@typeInfo`
introspects struct layouts at compile time. Emit a JSON manifest
during build, run a small codegen step to produce TS interfaces +
DataView read/write helpers. Highest correctness; some build
infrastructure cost.

**Pattern B — hand-written shared schema (msgpack-typed).** Define
struct field names + types in a `.schema.json` or similar; both
sides import from it. Pattern Zig→TS codegen still uses but skipping
the compile-time piece. Drift catches when running unit tests on
both sides.

**Pattern C — single-source TS file with manual offset constants.**
Cheapest for a 3-field state buffer. Two-source drift risk: the
Zig and TS field offsets must match. Use only for hyper-stable
state shapes; not for actively-evolving sim states.

```ts
// Pattern C example — hand-aligned offsets
const OFFSETS = {
  tick: 0,            // u32
  rngState: 4,        // u32
  playerCount: 8,     // u32
  // ...
} as const;
const STATE_SIZE = 12; // bytes

function readState(memory: WebAssembly.Memory, ptr: number) {
  const view = new DataView(memory.buffer, ptr, STATE_SIZE);
  return {
    tick: view.getUint32(OFFSETS.tick, true),
    rngState: view.getUint32(OFFSETS.rngState, true),
    playerCount: view.getUint32(OFFSETS.playerCount, true),
  };
}
```

## When to use msgpack at the boundary

For **fixed-shape state** (struct of N fixed fields), raw memory
views win — no encoder/decoder cost.

For **variable-shape payloads** (event arrays, snapshot deltas with
optional fields, draft offers), msgpack via the existing
`@msgpack/msgpack` is the right call:

```ts
import { decode, encode } from "@msgpack/msgpack";

// On step exit, wasm writes a msgpack payload to a known buffer.
const eventsPtr = exports.events_ptr();
const eventsLen = exports.events_len();
const eventsBytes = new Uint8Array(memory.buffer, eventsPtr, eventsLen);
const events = decode(eventsBytes);
```

Inside Zig you'd use a small msgpack writer (~100 LOC) or hand-emit
known-shape messages. The host stays mature with `@msgpack/msgpack`.

## Error propagation

Wasm functions **cannot throw** in a way the host can catch as a JS
exception (without the proposed exception-handling extension that
isn't broadly supported yet). Two viable patterns:

**Pattern A — return an int error code.** `0` = ok, non-zero = error
type. Cheap, universal, the right call for sim-step errors:

```zig
export fn step(state_ptr: [*]u8, dt_ms: u32) i32 {
    // ... step logic
    if (something_bad) return 1;
    return 0;
}
```

```ts
const rc = exports.step(statePtr, dtMs);
if (rc !== 0) console.error(`[wasm] step error ${rc}`);
```

**Pattern B — set a global error byte, host reads after each call.**
For when the error type alone isn't enough and you need a message:

```zig
var last_error_buf: [256]u8 = undefined;
var last_error_len: usize = 0;

export fn last_error_ptr() [*]u8 { return &last_error_buf; }
export fn last_error_len_export() usize { return last_error_len; }
```

The host reads the message bytes when `step` returns non-zero. Don't
do this for the hot path; it's for diagnostic surfaces.

## Hot reload during dev

```ts
// Idiomatic Vite HMR for wasm-backed modules
if (import.meta.hot) {
  import.meta.hot.accept(/* deps */);
  // Wasm rebuilds trigger full reload (above) — per-module HMR isn't
  // useful because the wasm module is a unit.
}
```

**Server-side hot reload** (Bun): the server process must reload
the wasm bytes when the file changes. Cheapest pattern is process
restart on `.wasm` change via Bun's `--hot` flag — it watches and
restarts on any imported file change.

## Anti-patterns

- ❌ **Caching a `Uint8Array` view across wasm calls.** Detached
  views, silent corruption.
- ❌ **Passing JS strings to wasm.** Encode to bytes (TextEncoder),
  pass `(ptr, len)` ints.
- ❌ **Throwing from wasm.** Return error codes.
- ❌ **Using `wasm-bindgen` patterns** (high-level types at the
  boundary). Adds glue surface; the explicit-int approach is
  smaller and faster.
- ❌ **Allocating from JS into wasm memory** mid-call. Allocate
  once at init via a wasm-side static buffer; reuse.
- ❌ **Two sources of truth for struct layouts.** Manual offsets
  on both sides drift the moment a field is added.
- ❌ **Synchronous `WebAssembly.compile`** — blocks the main
  thread. Always `instantiateStreaming` (async).

## Pre-flight checklist

- [ ] `WebAssembly.instantiateStreaming` (not `instantiate(buffer)`)
      for the initial load.
- [ ] No `Uint8Array` cached across export calls in the hot path.
- [ ] Struct layout single-source (codegen, schema, OR const file —
      pick one).
- [ ] Error codes returned, never wasm `unreachable` in production.
- [ ] msgpack for variable-shape payloads, raw memory for fixed.
- [ ] Server-side host (Bun, Deno, Node) loads the *exact same*
      `.wasm` as the browser. Verify via SHA hash if paranoid.
- [ ] Hot reload wired (Vite plugin in dev, Bun `--hot` for server).
- [ ] Binary size budget tracked in CI (skill: `zig-wasm-build`).

## Source

- [MDN — WebAssembly.Memory](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory)
- [Lin Clark — WebAssembly's post-MVP future](https://hacks.mozilla.org/2018/10/webassemblys-post-mvp-future/) (canonical statement of the int+memory boundary)
- [SwiftWasm Agent Skills](https://github.com/swiftwasm/Swift-Wasm-Agent-Skill) — Swift-specific but the BridgeJS host patterns transfer
- [@msgpack/msgpack — TypeScript implementation](https://github.com/msgpack/msgpack-javascript)
- [Bun docs — `--hot` mode](https://bun.sh/docs/runtime/hot) — server-side hot reload reference
- Companion skills: `zig-wasm-build`, `wasm-game-sim-zig`,
  `deterministic-netcode-architecture`
