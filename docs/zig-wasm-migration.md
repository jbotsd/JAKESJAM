# JAKESJAM — Zig → WASM sim migration plan

> Companion to `docs/netcode-architecture.md`. That doc is
> substrate-neutral; this one is the implementation roadmap for the
> Zig→WASM substrate decision.

## Why this exists

The TS sim has shipped jitter and fall-through symptoms across two
weeks of patches because IEEE 754 float math is not bit-exact across
V8 (browsers) and JSC (Bun). Each tick the client predicts at
`y = 580.0000001` and the server says `y = 580.0`; the per-entity
reconcile rebuilds 60 Hz. Smoothing hides ~80% of this; the remaining
20% is what users describe as *"barely detects standing"*.

Pivot: move the deterministic core to **Zig compiled to WASM**.
WASM bytecode runs IEEE 754 ops bit-exactly across all hosts per the
WASM specification. The same `.wasm` runs in the browser (via
`WebAssembly.instantiate`) and in Bun (native `WebAssembly` support).
Single binary, both sides, true determinism.

## Boundary

Only the **deterministic core** moves to Zig. Everything else stays
TypeScript:

```
  KEEP IN TS                           MOVE TO ZIG
  ──────────                           ───────────
  Phaser scenes                        World.step + tick orchestrator
  HUD / overlays / DOM                 collision.ts (swept AABB, drift probe)
  Input capture                        player.ts (movement + jetpack + jump)
  clientLoop.ts (predict/reconcile)    projectile.ts (pathing, hit detection)
  snapshotDelta.ts                     weapon.ts (fire emit, recoil)
  protocol.ts (msgpack codec)          satellite.ts (orbit + fire)
  WsTransport / Bun WS server          combat.ts (parry / shield / damage)
  Convex lobby + matchmaker            destructible.ts (hp + AABB)
  ReplayRecorder                       fire.ts (DoT patches)
                                       rng.ts (mulberry32 in Zig)
                                       hash.ts (FNV1a in Zig)
                                       data/ map literals (compiled in)
```

The boundary is a single typed interface exposed by the wasm module:

```zig
// In Zig:
export fn step(
    state_ptr: [*]u8, state_len: usize,
    inputs_ptr: [*]const u8, inputs_len: usize,
    dt_ms: u32,
) void;  // mutates state in place

export fn alloc_state() [*]u8;     // wasm allocator returns ptr to zeroed state
export fn free_state(ptr: [*]u8) void;
export fn state_size() usize;
```

```ts
// In TS, around step:
const inputs = encodeInputs(inputsByPlayer);  // msgpack
const inputsBytes = inputs.byteLength;
copyToWasm(inputsPtr, inputs);
wasm.step(statePtr, stateLen, inputsPtr, inputsBytes, dtMs);
const newState = decodeState(readFromWasm(statePtr, stateLen));
```

State is a flat byte buffer with a known struct layout. Both sides
agree on the layout via a single source: a Zig `pub const` plus
generated TS bindings (Zig has reflection/comptime to emit the TS
type).

## Phased rollout (8 PRs over ~3 weeks)

### Phase A — toolchain (1-2 days)

**PR A1.** `sim/zig/build.zig` — Zig project skeleton. `zig build`
produces `client/src/sim/wasm/sim.wasm`. CI step: `zig fmt --check`
+ `zig test`. Pin Zig version (0.13.0 at time of writing) in a
`.zig-version` file + `.tool-versions` for asdf users.

**PR A2.** Vite plugin to load `.wasm` as a URL (`?url`) and
`WebAssembly.instantiateStreaming` it on boot. Vite already supports
this natively — just configure asset handling. Hot reload via
`vite-plugin-watch-and-run` rebuilding `.wasm` on Zig source change.

### Phase B — minimum viable Zig sim (1 week)

**PR B1.** `sim/zig/world.zig` + `sim/zig/types.zig` — port
`WorldState` struct (no logic yet). Round-trip test: TS encodes,
wasm decodes, wasm encodes, TS decodes, deep-equal. Locks the wire
layout.

**PR B2.** `sim/zig/rng.zig` (mulberry32) + `sim/zig/hash.zig`
(FNV1a). Bit-exact unit tests porting the existing TS test vectors.

**PR B3.** `sim/zig/collision.zig` — swept AABB + drift probe + sub-
stepping. Port the 34-test `playerLanding.test.ts` matrix to
`zig test` directly. The matrix covers the same vy×platform-h
cells; same assertions; if Zig collision passes the matrix we know
parity holds. Same `.wasm` runs in `bun:test` and in `zig test`
because Zig's test runner produces a wasm binary that bun can
execute via `WebAssembly.instantiate`.

**PR B4.** `sim/zig/player.zig` — movement, jetpack, jump, crouch,
`groundedLastFrame`. The `world-determinism.test.ts` parity test
becomes the canary: same seed + same inputs ⇒ byte-equal final
state on both sides.

### Phase C — projectiles + combat + everything else (1 week)

**PR C1.** `sim/zig/projectile.zig` — pathing, bouncing, homing,
splits, sticky fuses. Trig via `std.math.sin/cos/atan2` (Zig's
`std.math` is IEEE 754; same wasm bytecode = same result).

**PR C2.** `sim/zig/weapon.zig` + `satellite.zig` + `combat.zig` +
`destructible.zig` + `fire.zig`. The trig-heavy systems flip to
native Zig float math.

**PR C3.** `sim/zig/world.zig` orchestrator step function — calls
into all the above in order. Round/orchestrator state machine
ported.

### Phase D — TS integration + cutover (3-4 days)

**PR D1.** `client/src/sim/wasmShim.ts` — minimal TS wrapper that
exposes the same surface as the current TS World class
(`World.step`, `World.create`, etc) but delegates to wasm. Both old
TS sim and new wasm sim coexist behind a feature flag for one PR.

**PR D2.** Server cutover. `server/src/matchHost.ts` switches its
`stepWithRuntime` import to `wasmShim`. Bun loads the same
`.wasm` as the client. The first cross-host parity log lands —
client + server hashes match every tick, pre-existing `dev-tools`
debug overlay shows reconcile delta = 0 in steady state.

**PR D3.** Delete the TS sim. `client/src/sim/{World,player,
collision,projectile,weapon,satellite,combat,destructible,fire,
rng,hash}.ts` removed. Only `wasmShim.ts` + `types.ts` (TS-side
type mirrors) + the wasm build artifact remain.

### Phase E — observability + performance shake-out (1-2 days)

**PR E1.** Determinism canary CI job: spin up two ephemeral Bun
processes, feed identical input streams, log state hashes every 10
ticks for 60 s, fail on any mismatch.

**PR E2.** Performance pass. Profile per-tick wasm cost. Expected
~10-30× faster than TS for hot path; if it regresses we look at
allocator setup (`std.heap.FixedBufferAllocator` for sim state,
no `GeneralPurposeAllocator` per step).

## Hard rules during migration

- **Each PR keeps `bun test` + `bun run --filter client typecheck`
  green.** No "WIP, will fix in next PR".
- **The 34 `playerLanding.test.ts` cases are the contract.** They
  shift from running against TS code to running against wasm code,
  but the assertions don't change.
- **No PROTOCOL_VERSION bump** unless wire shape changes. State
  buffer layout changes between Zig versions are caught by the
  round-trip test in PR B1.
- **One reviewer per PR.** Zig is new ground for the team; second
  set of eyes catches dumb-pointer-math errors.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Zig 0.13 → 0.14 breaking changes | `.zig-version` pinned; upgrade is a separate PR with full test re-run |
| Hot-reload too slow during dev | `zig build-lib` with `-O ReleaseSmall` finishes in ~200ms for our scope; vite plugin debounces |
| TS↔wasm boundary serialisation cost | State buffer is 1-2 KB at our scale, copy is sub-millisecond |
| Server-side wasm load on Bun | Bun's `WebAssembly.instantiateStreaming` is mature; tested on Fly already via the chaos modifier path |
| Map literals in Zig | `comptime` lets us declare maps in `.zig` files identical to `client/src/sim/data/*.ts`; fewer translation hops |
| Sticky-fuse RNG order vs TS | Locked by the `world-determinism.test.ts` parity test — any divergence in iteration order surfaces immediately |

## Out of scope

- **Rust→wasm.** Considered, rejected: bigger binary, wasm-bindgen
  glue surface, slower compile.
- **Client-only WASM (server stays TS).** Considered, rejected:
  defeats the "same code both sides" property that's the whole
  point of this pivot.
- **Replay file format change.** Replay records inputs + RNG seed;
  these are substrate-neutral. Wasm sim consumes the same replay
  files.
- **Visual / juice work** — separate streams, parallel to this
  migration.

## Critical files referenced

| File | Phase | Status |
|---|---|---|
| `sim/zig/build.zig` | A1 | new |
| `sim/zig/{world,types,rng,hash,collision,player,projectile,weapon,satellite,combat,destructible,fire}.zig` | B-C | new |
| `client/vite.config.ts` | A2 | small edit |
| `client/src/sim/wasmShim.ts` | D1 | new |
| `client/src/sim/types.ts` | D1 | type mirrors stay; logic deleted |
| `server/src/matchHost.ts` | D2 | import swap |
| All `client/src/sim/*.ts` (logic) | D3 | deleted |
| `.github/workflows/deploy.yml` | A1, E1 | add Zig install step + parity job |

## Verification checkpoints

- **End of phase A:** `zig build` from clean checkout produces a
  valid `.wasm`. Vite dev server can serve it. Ping pong via wasm
  exports (a no-op `step()` returning unchanged state).
- **End of phase B:** all 34 collision tests + the 24-cell
  tunneling matrix pass against the Zig collision module.
- **End of phase C:** the world-determinism test passes (canned
  inputs → byte-equal `WorldState` after 600 ticks) on the wasm
  sim.
- **End of phase D:** two-tab playtest on `jakesjam.vercel.app`
  shows zero reconcile delta in steady-state, the rig stops
  jittering, and a 60-second standing-still test produces a
  byte-stable position.
- **End of phase E:** CI determinism canary running on every push.
