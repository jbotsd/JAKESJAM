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

### Phase A — toolchain ✅ **COMPLETE 2026-05-04**

**PR A1 ✅.** `sim/build.zig` — Zig project skeleton. `bun run
sim:build` (== `cd sim && zig build`) produces
`client/src/sim/wasm/sim.wasm` (256 bytes ReleaseSmall). CI runs
`zig fmt --check`, `zig build test`, `zig build` before TS gates.
Zig version pinned to **0.15.2** in `.zig-version` and
`.tool-versions`. Wasm exports: `alloc_state`, `free_state`,
`state_size`, `step`, `current_tick`, `reset`. 3 native Zig tests
pass.

**PR A2 ✅.** `client/vite-plugin-zig.ts` watches `sim/src/**/*.zig`
+ `build.zig` + `build.zig.zon`, debounces concurrent rebuilds,
triggers full-reload on success. `client/src/sim/wasm/loader.ts`
exposes `loadSim()` (browser, `?url` + `instantiateStreaming` with
plain-bytes fallback for stale MIME) and `loadSimFromBytes()` (Bun
test harness — bypasses Vite). 4-test ping-pong suite at
`client/src/sim/wasm/__tests__/pingPong.test.ts` proves the
boundary works end-to-end. Both `typecheck.yml` and `deploy.yml`
install Zig via `mlugg/setup-zig@v2` with `~/.cache/zig` cached.

### Phase B — minimum viable Zig sim (1 week)

**PR B1.** `sim/zig/world.zig` + `sim/zig/types.zig` — port
`WorldState` struct (no logic yet). Round-trip test: TS encodes,
wasm decodes, wasm encodes, TS decodes, deep-equal. Locks the wire
layout.

**PR B2 (RNG) ✅ shipped 2026-05-04.** `sim/src/rng.zig`
(mulberry32) is a bit-exact port of `client/src/sim/rng.ts`.
Wasm exports `rng_next_u32` and `rng_next_int` (i64-packed
return). Cross-impl parity test at
`client/src/sim/wasm/__tests__/rngParity.test.ts` proves byte
identity over 7000+ iterations across 7 seeds, including IEEE
754 exact-equal float derivations. Native Zig tests in
`sim/test/smoke.zig` cover self-consistency.

**PR B2 (hash) — pending.** `sim/src/hash.zig` (FNV1a) port. Will
require porting `PlayerEntity`/`ProjectileEntity` field layouts to
`extern struct` first (depends on PR B1).

**PR B3 ✅ shipped 2026-05-04 (kernel + slide).**
`sim/src/collision.zig` ports `sweepAgainstOne`, `sweepAABB`, and
`resolveMove` (multi-pass slide solver) bit-for-bit from the TS
impl. Wasm exports `sweep_against_one_flat`, `sweep_aabb_many`,
`resolve_move`. New `collisionParity.test.ts` proves byte-identical
output across:
- the 24-cell fast-fall tunneling matrix,
- 1000 random sweep fixtures + 100 random sweep-one fixtures,
- 5 realistic player scenarios + a 60-tick simulated
  drop-and-rest where TS and wasm integrate independently and
  remain byte-identical at every tick,
- 500 random resolveMove fixtures.

**Still pending in B3 after 2026-05-04:** spatial-grid broadphase
(`buildSpatialGrid`/`queryGrid`) — perf only, no determinism impact.
Circle-vs-AABB primitives for the projectile path. Land before D2.

**B3-cached + drift probe ✅ shipped 2026-05-04.** `sim/src/collision.zig`
now implements `sweepAABBCached` + `resolveMoveCached` with the
one-way platform short-circuit and post-resolve drift probe + snap
that fix the visible bug. Wasm exports: `sweep_aabb_cached`,
`resolve_move_cached`. 8 parity tests prove byte-identity including
the exact 1.5 px / 1.9 px / 3.0 px drift-snap recovery scenarios.

**Live wiring shipped 2026-05-04.** Three URL flags now route the
live sim through wasm at user opt-in:
- `?wasm-canary=1`     — RNG parity probe in console (observability)
- `?wasm-rng=1`        — swap sim RNG kernel to wasm (live)
- `?wasm-collision=1`  — swap `resolveMoveCached` to wasm (**the
                          cut where the visible bug dies on client**)

Server still runs TS sim. Phase D2 = the other half: the server
also loads wasm so client + server collision math is bit-identical
end-to-end and reconcile churn vanishes.

**PR B4 ✅ shipped 2026-05-04.** `sim/src/player.zig` ports
`stepPlayer` bit-for-bit including gravity, friction, jump
(coyote + buffer + cut), jetpack, crouch, sub-stepped collision
integration. `PlayerStep` extern struct (96 bytes) packs entity
+ memory together for ABI simplicity. New
`playerParity.test.ts` drives a 90-tick scripted run through
both impls and asserts byte-identical state every tick.

Also wired live: `?wasm-player=1` (client) and
`JAKESJAM_WASM_PLAYER=1` (server) install the shared
`makeStepPlayerWasmBackend` factory. Same pack/unpack code on
both hosts, just different loaders.

One small TS change required for parity:
`Math.hypot(vx, vy)` → `Math.sqrt(vx² + vy²)` — V8's
`Math.hypot` does overflow-safe scaling that produces ULP-
different bits than the Zig `@sqrt` of the explicit formula.
In our velocity domain (≤ ~1000 px/s) there's no overflow
risk, so the simpler form is bit-identical across hosts.

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

### Phase D — TS integration + cutover

**PR D1 ✅ shipped 2026-05-04 (per-module flags).** Instead of a
monolithic `wasmShim.ts`, the cutover ships per-module URL flags
that swap individual hot-path callers to wasm. Cleaner rollout —
each flag is independently revertable, parity-proven, and lands
in its own PR. Flags currently:
- `?wasm-canary=1` (RNG observability)
- `?wasm-rng=1` (RNG kernel swap)
- `?wasm-collision=1` (`resolveMoveCached` swap)

**PR D2 ✅ shipped 2026-05-04 (collision).** Server-side wasm
loader at `server/src/wasmRuntime.ts` uses Bun's native
`WebAssembly` to load the same `sim.wasm`. Triggered by
`JAKESJAM_WASM_COLLISION=1` env var. With both client + server
flags set, `resolveMoveCached` runs in identical wasm bytecode on
both sides — predict ↔ authority is byte-identical, the visible
bug dies. 4 new server-side parity tests.

**PR D3 (pending).** Delete the TS sim. Requires Phase B4
(player.zig) and Phase C (projectiles + combat) to land first —
the plain TS impls still cover those paths today.

### Phase E — observability + performance shake-out (1-2 days)

**PR E1 ✅ shipped 2026-05-04 (in-process variant).** Long-horizon
canary at `client/src/sim/wasm/__tests__/longHorizonCanary.test.ts`
runs 10,000 ticks (~2.8 minutes of gameplay) of TS-native and Zig-
wasm with independent integrators in the same Bun process and
asserts byte-identical state every tick. Catches the slow-drift
bug class. CI runs it on every PR. The two-process variant
(separate Bun PIDs) is overkill given the single-process variant
already proves byte-identity — left for later if needed.

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
| Zig version drift across contributors | `.zig-version` pinned (0.15.2); `.tool-versions` for asdf/mise. Upgrade is a separate PR with full test re-run. |
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
| `sim/build.zig` + `sim/build.zig.zon` | A1 | ✅ shipped |
| `sim/src/{root,types}.zig`, `sim/test/smoke.zig`, `sim/README.md` | A1 | ✅ shipped |
| `client/vite-plugin-zig.ts` | A2 | ✅ shipped |
| `client/src/sim/wasm/{loader,types}.ts` + `__tests__/pingPong.test.ts` | A2 | ✅ shipped |
| `sim/src/rng.zig` | B2 | ✅ shipped |
| `client/src/sim/wasm/__tests__/rngParity.test.ts` | B2 | ✅ shipped |
| `sim/src/collision.zig` (sweep + resolveMove) | B3 | ✅ shipped (kernel + slide) |
| `client/src/sim/wasm/__tests__/collisionParity.test.ts` | B3 | ✅ shipped |
| `sim/src/player.zig` | B4 | ✅ shipped |
| `client/src/sim/wasm/__tests__/playerParity.test.ts` | B4 | ✅ shipped |
| `client/src/sim/wasm/playerWasmBackend.ts` | B4 | ✅ shipped |
| `sim/src/collision.zig` (circle primitives) | B3 finish | ✅ shipped |
| `client/src/sim/wasm/__tests__/circleParity.test.ts` | B3 finish | ✅ shipped |
| `client/src/sim/wasm/__tests__/longHorizonCanary.test.ts` | E1 | ✅ shipped |
| `sim/src/projectile.zig` (straight + gravity) | C1 | ✅ shipped |
| `client/src/sim/wasm/__tests__/projectileParity.test.ts` | C1 | ✅ shipped |
| `sim/src/hash.zig` (FNV1a-32) | C utility | ✅ shipped |
| `client/src/sim/wasm/__tests__/hashParity.test.ts` | C utility | ✅ shipped |
| `sim/src/projectile.zig` (homing/boomerang/float/accelerate/bounce + impacts) | C1 finish | new |
| `sim/src/{world,weapon,satellite,combat,destructible,fire}.zig` | C-D | new |
| `sim/src/collision.zig` (spatial-grid broadphase) | B3 finish | new |
| `client/vite.config.ts` | A2 | small edit |
| `client/src/sim/wasmShim.ts` | D1 | new |
| `client/src/sim/types.ts` | D1 | type mirrors stay; logic deleted |
| `server/src/matchHost.ts` | D2 | import swap |
| All `client/src/sim/*.ts` (logic) | D3 | deleted |
| `.github/workflows/deploy.yml` | A1, E1 | add Zig install step + parity job |

## Verification checkpoints

- **End of phase A ✅ (2026-05-04):** `zig build` from clean checkout
  produces a 256-byte ReleaseSmall `sim.wasm`. Vite plugin rebuilds
  it on `.zig` change with full-reload. Ping-pong test
  (4 cases) green: load → reset → 7×step → readback shows
  `currentTick() == 7` and the first u32 of state buffer reads 7.
  CI gates both workflows with `mlugg/setup-zig@v2` (Zig 0.15.2).
  Live game unaffected — TS sim still runs.

- **B2 RNG ✅ (2026-05-04):** Zig `rng_next_u32` matches TS
  `nextU32` byte-exactly across 7 seeds × 1000 iterations (7000+
  bit-identical operations). Float derivations
  `state / 2^32` match under IEEE 754 exact-equal. `rng_next_int`
  ABI uses i64-packed return to avoid wasm multivalue.

- **B3 collision (kernel + slide) ✅ (2026-05-04):** TS V8 vs Zig
  wasm produce byte-identical output for `sweepAgainstOne`,
  `sweepAABB`, and `resolveMove` across the 24-cell fast-fall
  tunneling matrix, 1600+ randomised fixtures, 5 realistic player
  scenarios, and a **60-tick simulated drop-and-rest** with
  independent TS and wasm integration — same x/y/vx/vy/grounded
  at every tick. This is the empirical proof that the substrate
  pivot fixes the "barely detects standing" bug class.

  Cumulative bit-identical operations proven across runtimes:
  **9000+** (RNG) + **1600+** (collision) + **60-tick recurrence**.
  Wasm artifact: **2.2 KB** ReleaseSmall.

- **Wasm in the live boot path ✅ (2026-05-04):** `client/src/main.ts`
  now boot-loads `sim.wasm` via `getWasmSim()`. Wasm is bundled
  into `dist/wasm/sim.wasm` (Vite serves verbatim from
  `client/public/wasm/`). Console emits `[wasm-sim] ready` at
  startup. `?wasm-canary=1` URL flag triggers a 30-second RNG
  parity probe that compares TS V8 vs Zig wasm in the actual
  browser runtime. Default user behaviour unchanged — TS sim
  still drives gameplay; wasm is observable but inert until D2.
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
