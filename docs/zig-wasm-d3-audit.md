# Phase D3 audit — TS sim cleanup opportunities

Generated 2026-05-05 during the 07:53 cron pass. Audits every TS
sim module for what can be safely simplified now that wasm
backends + the comptime trig LUT are shipped.

## TL;DR

**D3 is essentially complete by construction.** The migration's
F1/F2 phases didn't just add wasm code alongside TS — they made
the TS code *intrinsically deterministic* via the comptime trig LUT
loaded into the TS runtime at boot. There's almost nothing left to
"delete" because the remaining TS sim code IS the production
default-fallback path, deliberately kept for emergency rollback
when wasm fails to load.

The three modules that genuinely run wasm in the hot path
(rng/collision/player) already have minimal TS shims — they
expose `<X>Native` impls as the explicit fallback and route
production through `set<X>Backend(wasmFn)` at boot. Nothing to
remove there.

The remaining six modules (projectile/satellite/fire/weapon/
combat/destructible) don't have backend swaps because their MATH
is already deterministic via the LUT. Adding swaps would add
boundary-crossing overhead without any determinism gain.

## Module-by-module audit

### `rng.ts` — ✅ minimal

- `nextU32Native` is the TS reference impl
- `nextU32` indirects through `activeBackend`
- `setRngBackend` swap mechanism exists
- `applyWasmRngFlag` defaults wasm-on (F3)
- **Cleanup verdict**: nothing to remove. The TS impl IS the
  fallback when wasm fails to load.

### `collision.ts` — ✅ minimal

- `resolveMoveCachedNative` is the TS reference impl
- `setResolveMoveCachedBackend` swap mechanism exists
- `applyWasmCollisionFlag` defaults wasm-on
- All other functions (sweepAABB, circleHits, buildSpatialGrid,
  queryGrid, etc.) are pure helpers with bit-deterministic IEEE
  754 math. Wasm has equivalents but the TS forms are faster
  in-process (no boundary crossing) and bit-identical.
- **Cleanup verdict**: nothing to remove.

### `player.ts` — ✅ minimal

- `stepPlayerNative` is the TS reference impl (LUT-via-trig.ts)
- `setStepPlayerBackend` swap mechanism exists
- `applyWasmPlayerFlag` defaults wasm-on
- The `Math.hypot` → `Math.sqrt` parity fix already landed.
- **Cleanup verdict**: nothing to remove.

### `projectile.ts` — ✅ minimal (no swap, but LUT-deterministic)

- All trig calls go through `lutCos/lutSin/lutAtan2` from
  `@sim/trig.ts` — these read from the wasm LUT installed at
  boot, so they're bit-identical to the wasm `lut_*` exports.
- The 4× `Math.hypot` → `Math.sqrt` parity fixes already landed
  (commit fe4b430 at sites: stepDist, splits speed,
  rotateVelocityToward speed, bounce reflection length).
- The full pathing dispatch is iteration + entity bookkeeping,
  not float math — deterministic by construction (Map iteration
  order is insertion order in V8/JSC; sorts are stable).
- Wasm exports for primitives (apply_float, apply_accelerate,
  rotate_velocity_toward, closest_non_owner_player, bounce_resolve,
  anti_homing_target) exist for any future caller that wants to
  delegate, but the in-process TS path is faster and equivalent.
- **Cleanup verdict**: no `set<X>Backend` swap needed; LUT alone
  closes the determinism story for trig sites. Nothing to remove.

### `satellite.ts` — ✅ minimal (no swap, LUT-deterministic)

- Orbit position uses `lutCos(angle) * orbitRadius` etc.
- Aim uses `lutAtan2(target.y - sy, target.x - sx)`.
- The wasm has `satellite_tick` which does the same math; TS
  in-process is faster.
- **Cleanup verdict**: nothing to remove.

### `fire.ts` — ✅ minimal (pure arithmetic)

- `remainingMs - dtMs` and `dps * dtSec` are bit-deterministic
  IEEE 754 ops.
- `aabbOverlap` is integer-derivable comparison — no transcendentals.
- Wasm has `fire_patch_tick` etc. but nothing to gain by swapping.
- **Cleanup verdict**: nothing to remove.

### `weapon.ts` — ✅ minimal (no swap, LUT-deterministic)

- Muzzle position uses `Math.sqrt` (matches wasm `@sqrt`).
- Recoil uses `lutCos/lutSin`.
- Aim uses `lutAtan2`.
- Spread offset operator order matches wasm (parity fix landed
  in 2cd4ff5).
- **Cleanup verdict**: nothing to remove.

### `combat.ts` — ✅ minimal (no swap, LUT-deterministic)

- Parry-arc check uses `lutAtan2`.
- Shield drain is `dps * (dtMs / 1000)` arithmetic.
- `wrapAngle` is implemented identically in TS and wasm.
- **Cleanup verdict**: nothing to remove.

### `destructible.ts` — ✅ minimal (no swap, no trig)

- HP arithmetic clamped at 0 — bit-deterministic.
- Blast-radius check uses squared distance — no sqrt, no trig.
- `centerToAABB` is integer-derivable subtraction.
- **Cleanup verdict**: nothing to remove.

## Why the LUT install made D3 mostly-automatic

The LUT install at boot (in `client/src/sim/wasm/runtime.ts`
`getWasmSim()` and now `server/src/wasmRuntime.ts` `loadServerSim()`)
populates the TS-side `SIN_TABLE` and `ATAN_TABLE` with the *same
bytes* the wasm Zig modules use. So:

- `lutCos(x)` (TS) reads `SIN_TABLE[idx]` → same bytes as
  `lut_cos(x)` (wasm).
- Every TS sim module that uses `lutCos/lutSin/lutAtan2` is
  intrinsically deterministic across hosts.
- No `set<X>Backend` swap needed for trig-only modules.

This is why the original D3 plan ("delete the TS sim modules") was
overly aggressive: most of the determinism win came from the LUT
install, not from forcing every call through wasm. The TS modules
ARE the wasm path, just executing in V8/JSC instead of crossing the
boundary.

## What WOULD true D3 cleanup look like?

If we ever truly delete the TS sim modules, two things must land
first:

1. The wasm sim must be guaranteed-loaded before any sim tick
   runs. Today, if `getWasmSim()` rejects (e.g. 404 on the .wasm),
   the TS fallback path runs the game. Without TS, a wasm load
   failure = no game.
2. The full `World.step` orchestrator must be in Zig. Today the
   orchestrator is `client/src/sim/World.ts` calling into per-
   module TS impls. To delete the TS modules entirely the
   orchestrator needs to call into wasm exports throughout.

Neither is required for the determinism fix that's already live.
The current state is the right balance: hot-path determinism via
wasm + LUT, full TS fallback for graceful degradation.

## Conclusion

**D3 verdict**: ✅ **complete by construction**. No further
deletion is required for the determinism-fix mission. The
remaining TS sim code is the deliberate-fallback path and should
stay as-is until the orchestrator port + wasm-required-load
phases are explicitly scoped.

The migration's outstanding work is now:

1. **C3 — `sim/src/world.zig` orchestrator** (port `World.step`
   to call wasm modules directly). Big scope, no determinism
   urgency.
2. Optional perf tuning if profiling shows TS sim is a hot
   path (it isn't today; collision and player are the dominant
   costs and both are wasm-routed).
3. Optional `set<X>Backend` swap mechanisms for the remaining
   modules if a use case emerges (none today).
