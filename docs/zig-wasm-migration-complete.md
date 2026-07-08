# Zig→WASM migration — completion summary

> **Scope note (added 2026-07-08):** accurate for the SWAP MODULES —
> rng, collision, player physics (`stepPlayer`/`resolveMoveCached`) and the
> trig LUT really do run in wasm by default on both hosts. But "the
> migration" here does NOT mean the whole sim: the orchestration layer
> (weapon fire, combat mitigation, rounds, drafts, events) is TypeScript in
> `client/src/sim/World.ts` and runs as production authority. A later
> FULL-Zig `step_world` cutover was attempted and **reverted** (see
> `docs/zig-wasm-conversion-status.md`'s banner). Current ground truth:
> `CLAUDE.md`.


Captured 2026-05-05 after the migration substantially shipped. This
is the consolidated retrospective: what got built, what determinism
properties hold, what remains. Read this if you're new to the
codebase and want to understand the sim architecture without
trawling 50+ commits.

## TL;DR

The deterministic core of the game sim is now **Zig compiled to
WebAssembly**. The same `.wasm` bytecode runs in:
- Browsers (V8) for client prediction
- Bun (server) for authoritative simulation

Both hosts route the heavy paths (`resolveMoveCached`, `stepPlayer`)
through the wasm module by default. Both hosts install the same
comptime-baked trig LUT at boot, so every TS sim trig call also
samples bit-identical bytes regardless of which libm the host's
JS engine ships.

**Result**: predict-vs-authority drift on float-math paths is
eliminated by construction. The "barely detects standing"
jitter and "falls through floor" bug class are mathematically dead.

## What's in the sim

### `sim/` (Zig source, compiled to wasm)

| File | Lines | Purpose |
|---|---|---|
| `src/root.zig` | 50 | Module entry, force-link sub-modules |
| `src/types.zig` | 5 | Shared type aliases |
| `src/rng.zig` | 60 | Mulberry32 RNG |
| `src/hash.zig` | 60 | FNV1a-32 hash primitives |
| `src/trig.zig` | 175 | **Comptime sin/cos/atan2 LUT** (1024 entries × 8 B = 8 KB per table) |
| `src/collision.zig` | 460 | Swept AABB, slide, bounce, drift snap, circle vs AABB |
| `src/spatial.zig` | 175 | Static spatial grid (replaces TS `Map<>`) |
| `src/player.zig` | 280 | Full `stepPlayer` (gravity, jump, jetpack, sub-stepped collision) |
| `src/projectile.zig` | 480 | All 8 pathings (straight/gravity/float/accelerate/boomerang/homing/anti-homing/bounce) + helpers |
| `src/satellite.zig` | 130 | Per-satellite tick (orbit + cooldown + fire decision) |
| `src/weapon.zig` | 130 | Muzzle, recoil, cooldown, spread |
| `src/combat.zig` | 80 | Parry-arc cosine check, shield drain |
| `src/destructible.zig` | 70 | HP clamp, blast radius, AABB conversion |
| `src/fire.zig` | 100 | Fire patch tick, AABB overlap |
| `build.zig` | 70 | Zig build script (Zig 0.15.2, ReleaseSmall, wasm32-freestanding) |
| `test/smoke.zig` | 40 | Native Zig unit tests (6 cases) |

**Wasm binary**: ~29 KB ReleaseSmall. **72 functions** exposed via
extern wasm exports. Full export manifest at
`docs/zig-wasm-exports.md`.

### TS host integration

- `client/src/sim/wasm/loader.ts` — browser-side wasm loader.
  `loadSim()` for `?url`+streaming, `loadSimFromBytes()` for
  Bun tests.
- `client/src/sim/wasm/runtime.ts` — boot orchestrator. Installs
  the trig LUT, applies the `?wasm-rng/collision/player=0` opt-out
  flags, exposes `applyWasm*Flag()` entry points called from
  `main.ts`.
- `client/src/sim/trig.ts` — TS-side LUT consumer. `lutSin/lutCos/
  lutAtan2` functions read from a `Float64Array` populated at boot
  by `installLutTables()`.
- `client/src/sim/wasm/playerWasmBackend.ts` — shared factory that
  builds the `StepPlayerFn` swap. Used by both browser and server.
- `server/src/wasmRuntime.ts` — server-side wasm loader. Mirrors
  the browser `getWasmSim()` exactly (including LUT install).
- `server/src/config.ts` — env-var parsing for the
  `JAKESJAM_WASM_*=0` emergency-disable flags.

### Backend swap mechanism (sim purity preserved)

Three modules expose `set<X>Backend(fn)` swap mechanisms; the wasm
loader installs wasm-backed fns at boot:

| Module | Backend swap | Default-on flag (TS = client side, ENV = server) |
|---|---|---|
| `rng.ts` | `setRngBackend` | TS: `?wasm-rng=0` opt-out |
| `collision.ts` | `setResolveMoveCachedBackend` | TS: `?wasm-collision=0`; ENV: `JAKESJAM_WASM_COLLISION=0` |
| `player.ts` | `setStepPlayerBackend` | TS: `?wasm-player=0`; ENV: `JAKESJAM_WASM_PLAYER=0` |

The other modules (projectile, satellite, weapon, combat, fire,
destructible) don't have backend swaps because their TS code uses
`lutCos/lutSin/lutAtan2` — the LUT install at boot already gives
them cross-host parity.

## Determinism contract — what's locked

| Property | Mechanism | Verified by |
|---|---|---|
| RNG sequence cross-host | mulberry32 in Zig wasm; TS swaps to wasm at boot | `rngParity.test.ts` (7000+ ops byte-identical) |
| Trig cross-host | comptime LUT baked into wasm; TS reads same bytes via `installLutTables` | `trigParity.test.ts` (8000+ angles byte-identical), `serverTrigLut.test.ts` |
| Hash cross-host | FNV1a in Zig wasm; TS calls wasm export | `hashParity.test.ts` (1264 ops byte-identical) |
| Collision cross-host | Zig wasm impl swapped via `setResolveMoveCachedBackend` | `collisionParity.test.ts` (1600+ random fixtures, 24-cell tunneling matrix), `collisionBackendSwap.test.ts` |
| Player physics cross-host | Zig wasm impl swapped via `setStepPlayerBackend` | `playerParity.test.ts` (90-tick scripted run), `longHorizonCanary.test.ts` (10k + 100k tick canary) |
| Projectile pathings | Zig wasm helpers + LUT-backed TS dispatch | `projectileParity.test.ts`, `projectilePathingsParity.test.ts`, `projectileHomingParity.test.ts`, `projectileBounceParity.test.ts`, `projectileStepV2Parity.test.ts` |
| Server-side trig install | `loadServerSim()` calls `installLutTables` unconditionally | `serverTrigLut.test.ts` |
| F3 default-on env semantics | `=== "0"` opt-out, not `=== "1"` opt-in | `configWasmDefaults.test.ts` |

**Tests**: 328 client + 58 server + 6 native Zig = 392 total. Plus
3-test smoke against deployed prod.

## What's NOT in scope (deferred deliberately)

### C3 — `sim/src/world.zig` orchestrator

The full `World.step` orchestrator stays TS for now
(`client/src/sim/World.ts`). It dispatches per-tick to the
ported sub-systems: rng/collision/player/projectile/satellite/
weapon/combat/destructible/fire. Each sub-system either runs in
wasm (collision, player) or runs in TS using the LUT-shared trig
+ pure IEEE 754 arithmetic (everything else).

Porting `World.step` to Zig would require ferrying the whole
`WorldState` (entity dictionaries, snapshot scaffolding, event
queues) across the wasm boundary which is significant ABI work
without a clear determinism payoff — the sub-systems already
produce identical bits across hosts.

### True D3 — TS sim deletion

Per `docs/zig-wasm-d3-audit.md`, TS sim modules are kept as the
graceful-degradation path when wasm fails to load. Deleting them
requires a wasm-required-load guarantee (i.e. error out instead
of falling back), which is a product decision, not a technical
one.

### Web Worker offload

Moving the wasm sim into a `Worker` thread would isolate it from
the rendering thread. Today the sim runs on the main thread; with
`stepPlayer` at ~370 ns/call and 4 players × 60 Hz = 89 µs/sec, it's
not anywhere near the 16.67 ms frame budget. Defer until profiling
shows otherwise.

## How to run / verify

```sh
# Build the wasm (auto-installs Zig 0.15.2 if missing — see
# scripts/vercel-build.sh for the install logic):
bun run sim:build

# Run all gates:
bun run sim:fmt          # zig fmt --check
bun run sim:test         # zig build test
bun run --filter client test
bun run --filter server test

# Performance comparison TS vs wasm:
bun run sim:bench

# E2E smoke against prod:
bunx playwright test tests/e2e/smoke.spec.ts
```

Production deploy:
- Vercel builds the client (uses `scripts/vercel-build.sh` to
  install Zig at build time, run `zig build`, then `vite build`).
- Fly builds the server image (`server/Dockerfile` COPYs
  `client/public/wasm/` into the image; `deploy-server` job in
  `.github/workflows/deploy.yml` runs `zig build` first to
  populate that path).

## How to extend

Adding a new wasm export:
1. Write the Zig in `sim/src/<mod>.zig`. Follow `.claude/skills/
   zig-code-quality/SKILL.md` (especially the "Lessons learned"
   section — operator order, hypot vs sqrt, etc.).
2. Add to `client/src/sim/wasm/types.ts` `SimExports` interface.
3. Add a parity test under `client/src/sim/wasm/__tests__/` that
   compares the wasm output to a TS reference impl.
4. Add to `docs/zig-wasm-exports.md` manifest.
5. Add the export name to `exportsManifest.test.ts`'s required
   list (this is the regression gate).

Adding a new module:
- Same as above plus `pub const <mod> = @import("<mod>.zig")` in
  `sim/src/root.zig` and `_ = <mod>` in the `comptime` block to
  force-link.

## Acknowledgements

The migration was driven through ~50 commits over approximately
2.5 days. Bug-fix urgency was the catalyst (the "barely detects
standing" jitter became unignorable in playtest), but the
substrate change has paid for itself across the sim — every
trig-driven event, projectile pathing, and collision check now
operates with cross-host bit-equality guaranteed by construction.

The migration plan is in `docs/zig-wasm-migration.md`. The ADR
documenting the substrate decision is `docs/adr/0006-zig-wasm-sim-substrate.md`.
The architectural skills are in `.claude/skills/{zig-wasm-build,
wasm-ts-bridge, wasm-game-sim-zig, zig-code-quality,
deterministic-netcode-architecture}/SKILL.md`.
