# Zig→WASM full-conversion status

Snapshot as of the most recent push. Pair with
`docs/zig-wasm-migration-complete.md` (substrate retrospective)
and `docs/zig-wasm-runbook.md` (ops procedures).

## TL;DR

The substrate migration's bug-fix mission was complete weeks
back: trig LUT, every per-module wasm equivalent, backend swap
mechanisms, server-side LUT install, perf bench, runbook,
e2e prod smoke, doc-sync gates — all live.

The **full orchestrator port** is in flight. Foundation +
verification scaffolding shipped (~24 cuts so far). Production
hot path still runs TS World.step; wasm orchestrator is opt-in
via `?wasm-world=1` and growing tick by tick toward feature
parity.

## What ships in wasm today

### Foundation (Phase G — done)
- `WorldState` extern struct + per-entity extern structs
  (PlayerEntity 288B, ProjectileEntity 216B, SatelliteEntity 96B,
  DestructibleEntity 64B, FireEntity 88B, PickupEntity 64B).
- `WorldStateHeader` 40B carrying tick / rng_state / round_phase /
  next_entity_id / map_id / chaos_mask / fire_hazard_timer_ms /
  round_index / countdown_remaining_ms.
- TS↔wasm bridge (`worldStateBridge.ts`) — `packWorldState` /
  `unpackWorldState` round-trip every sim-relevant field
  through the byte-stable layout.
- `PROTOCOL_VERSION` bumped to 3 (RawBytesSnapshot wire variant
  available; emission flip lands in J3).

### Per-module orchestration helpers (Phase H — 7 ports done)
- **H1 projectile** — `projectile_pre_step` (sticky / lifetime
  decision), `projectile_split_velocities` (8-shard fan).
- **H2 weapon** — `weapon_tick_fire(_with_keys)` cooldown +
  fire-decision in place.
- **H3 satellite** — `satellite_tick_world` orbit + cooldown +
  fire decision over `SatelliteEntity`.
- **H4 combat** — `combat_try_start_parry`, `combat_is_parry_active`,
  `combat_tick_shield` (drain when held / recharge / dead-player
  guard).
- **H5 destructible** — `destructible_resolve_projectile_hit` per
  pair (no_overlap / damaged / broken).
- **H6 fire** — `fire_patch_tick_world`, `fire_patch_hits_player_world`.
- **H7 round** — `round_step_phase` countdown / fighting /
  round-over / drafting transitions.

### Data tables (Phase H8 — 2 done, more pending)
- **H8a chaos** — `data/chaos.zig` with all 7 chaos modifiers +
  `chaos_profile_from_mask` resolver (multiplicative / OR /
  min-of-defined composition).
- **H8b weapons** — `data/weapons.zig` with starter pistol +
  `weapon_base_by_id` lookup.
- **Pending**: cards, maps, pickups (H8c-e).

### Orchestrator (Phase I — 5 cuts done)
- **I1** — `step_world(state, dt)` skeleton dispatches H1-H7 in
  deterministic order.
- **I2** — header carries `countdown_remaining_ms` + `round_index`;
  step_world drives the round phase machine end-to-end.
- **I3** — header carries `chaos_mask`; step_world resolves the
  ChaosProfile each tick.
- **I4** — PlayerEntity carries `current_keys` + `prev_keys`;
  step_world iterates players, calls `combat.tickShield`. I4b
  also calls `combat.tryStartParry` and rolls current → prev at
  end-of-tick.
- **I5** — PlayerEntity gains `score: u32` for orchestrator-side
  score keeping (winner-detection cut still pending).
- **Pending**: winner detection + score increment, satellite
  owner-target lookup, projectile motion dispatch, weapon spawn
  (needs build resolution port), player physics integration
  (needs movement-memory parallel array + map AABB cache).

### TS shim (Phase J — partial)
- **J0** — `applyWasmWorldStep(state, dt)` packs the TS
  WorldState into wasm linear memory, calls step_world, unpacks
  the result, merges wasm-owned fields back. Opt-in via
  `?wasm-world=1`. Default OFF.
- **Pending**: J1 World.ts / stepWithRuntime delegation
  (sync/async barrier needs a sync wrapper), J2 server matchHost
  swap, J3 cross-host parity verification, J4 backend-swap
  decommission.

### Evidence + verification (Phase V)
- **V1** — Playwright video evidence suite, 7 input-driven
  scenarios (walk-x, jump+jetpack, fire-weapon, wall-collision,
  gravity, take-damage, 60s-autoplay). Each test records
  `video.webm` + `frames/{first,last}.png` (ffmpeg sparse
  extract per the image-buffer discipline) + `console.json` +
  `color-probe.json` + `state-hashes.json`.
- **V2** — `window.__simStateHash() / __simStepNo() /
  __simSampleHashes()` globals installed at boot; OnlineMatchScene
  registers its loop's render-state getter when active.
- **V6** — Bun-test 600-tick long-horizon canary against the
  J0 shim (50 projectiles + 20 destructibles + 10 fire patches;
  asserts tick=600, fires expired, destructibles damaged
  correctly, no NaN). 61ms runtime.
- **V8** — Playwright e2e proves `?wasm-world=1` boots
  step_world without crashes against deployed prod.
- **V8b** — 20s `?wasm-world=1` gameplay session with random
  inputs + state-probe sampling.
- **V6b** — Determinism canary. Same seed + 200 ticks → byte-
  identical final state. Different seeds diverge. Interleaved
  A/B/A/B sequence equals sequential AAAA/BBBB.
- **I4c** — 100-tick combat integration: shield held →
  released → Ability rising-edge parry → idle. Asserts
  shield_charge band, parry_active_until_tick exact value,
  flag bits set, prev_keys rolled.
- **Pending**: V3 multi-instance (4 concurrent browsers in same
  room → byte-identical state-hash arrays), V4 visual regression
  with golden PNGs, V7 per-cron evidence dirs.

## What's still TS (production hot path)

- Player physics (walk / jump / jetpack / crouch / collision /
  coyote time / jump-buffer).
- Projectile motion + pathing dispatch (the wasm v2 kernel
  exists but the orchestrator's per-tick dispatch is TS).
- Weapon projectile spawn (build resolution + projectile
  insertion).
- Satellite owner-target lookup + projectile spawn.
- Combat shield / parry tick (input-driven).
- Score keeping + winner detection.
- Drafting orchestration (offers, picks, expiry).
- Score → match winner check.

These pieces are reachable from wasm via the H1-H7 helpers but
the orchestrator (`step_world`) hasn't yet wired the per-tick
loop iteration that calls them.

## Test surface

```
$ bun test client/src/sim/wasm/__tests__/
185 tests across 41 files
11280 expect() calls
0 failures
≈ 430ms total
```

Every wasm export passes through `exportsManifest.test.ts` +
`exportsDocSync.test.ts` (doc-sync gate) + per-module parity
tests against the canonical TS implementation.

## Done definition (from the plan)

- [x] G1-G3 — WorldState extern struct + bridge + round-trip test
- [x] H1-H7 — module orchestration helpers
- [ ] H8a-e — JAKESJAM data tables (chaos + weapons done)
- [x] I1-I3 — step_world skeleton + round phase + chaos lookup
- [ ] I4 — player-input drain into the wasm orchestrator
- [x] J0 — wasm-world shim + `?wasm-world=1` opt-in
- [ ] J1-J4 — production cutover, server matchHost, parity
      verification, backend-swap decommission
- [ ] K1-K4 — TS sim files deleted / replaced by re-export shims
- [ ] L1-L4 — wasm-required-load + multi-host playtest
- [ ] M1-M4 — decommission URL flags + env vars + deprecated paths

## How to extend

Every new wasm function:
1. Lands in the appropriate `sim/src/*.zig` module (or
   `sim/src/data/*.zig` if it's JAKESJAM-specific data).
2. Gets a `pub export fn` ABI wrapper.
3. Gets a row in `docs/zig-wasm-exports.md` (the doc-sync gate
   fails otherwise).
4. Gets a parity test under `client/src/sim/wasm/__tests__/`
   that calls the wasm export + asserts against the TS
   implementation. Bit-exact via `.toBe()` whenever the
   maths permit; `.toBeCloseTo(_, 8)` only when last-ULP
   variance is unavoidable.

Every new field in `WorldStateHeader` or any entity extern
struct:
1. Bumps the `comptime std.debug.assert(@sizeOf(...) == ...)`
   in `world_state.zig` deliberately.
2. Updates `worldStateBridge.ts` pack + unpack offsets.
3. Updates `worldStateLayout.test.ts` size assertions.
4. Updates parity-test offset constants for all tests that
   poke into the layout.

## What to read next

- `docs/zig-wasm-migration-complete.md` — substrate
  retrospective + determinism contract.
- `docs/zig-wasm-runbook.md` — emergency procedures.
- `docs/zig-wasm-perf-baseline.md` — measured ns/op for the
  hot paths.
- `sim/README.md` — Zig package boundaries.
- `client/src/net/README.md` — netcode package boundaries.
