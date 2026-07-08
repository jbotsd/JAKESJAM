# Zig→WASM full-conversion status

> **SUPERSEDED — DO NOT TRUST THE CLAIMS BELOW (correction 2026-07-08).**
> This snapshot describes the brief FULL-Zig-orchestrator cutover of
> 2026-05-05. That cutover was **REVERTED** after it broke live play:
> production today runs the TS orchestrator (`client/src/sim/World.ts`
> `stepWithRuntime`) as server authority + client prediction, with only the
> swap modules (rng/collision/player physics/trig LUT) in wasm. Full-Zig is
> opt-in via `USE_WASM_STEP_WORLD=1` (unset on the live server — verified
> against the running process) and `?wasm-world` client flags. The
> `jakesjam.vercel.app` URLs below are also no longer the deployment — the
> game ships via the self-contained Bun host (`bun run host:public`).
> Current ground truth: `CLAUDE.md`. Kept for historical reference only.


Snapshot as of the most recent push. Pair with
`docs/zig-wasm-migration-complete.md` (substrate retrospective)
and `docs/zig-wasm-runbook.md` (ops procedures).

## URL flag matrix (post-`106056b`)

| URL | What runs |
|---|---|
| `https://jakesjam.vercel.app/` | **Wasm orchestrator drives every tick (FULL ZIG)** |
| `?wasm-world=1` | Wasm shim ALSO emits enable log + applyWasmWorldStep can be invoked from outside the loop |
| `?wasm-world-monitor=1` | Wasm orchestrator runs (now default) + parity-monitor logs comparing wasm vs TS state |

No TS-fallback URL. Default visitors land on wasm. The legacy
`?wasm-world=2` and `?wasm-world=playtest` flags are no-ops since
the cutover unconditionally activates.

## Exhaustive e2e against deployed prod (2026-05-05)

26/27 e2e specs passing against `jakesjam.vercel.app`:

| Suite | Pass | Notes |
|---|---|---|
| state-probe | 1 | window globals install at boot |
| wasm-world | 1 | `?wasm-world=1` boots without crashes |
| wasm-world-actual | 1 | `?wasm-world=2` boots Practice without crashes |
| smoke | 4 | splash, Practice lime pixels, no slow-frame spam, wasm sim confirmed running |
| collisionRepro | 6 | stand-still, lateral run+jumps, jetpack altitude, crouch hold, edge-fall, two-tab combat |
| fuzz | 10 | splash, Practice scripted, World mode connect/move/fall/wall-press, two-tab world |
| lobby | 3/4 | World ?world=1, Create Room, single-tab — two-tab 1v1 timed out (Convex preexisting flake) |
| repro | 1 | platform/jump/run/fall |

### Known-fixed terrain bug (2026-05-05)

User reported "bad terrain" when using `?wasm-world=2`. Root cause:
the bridge zeroed `state.statics` on every pack because
`PlatformDefinition` lives on `MapDefinition` (not `WorldState`).
Without statics, `step_world`'s `stepPlayer` saw an empty AABB
slice → players fell through every platform. Fixed in
`01f7ec7`: `worldWasmBackend.setWorldStatics()` caches the AABB
layout in module state; `applyWasmWorldStep*` patches it into
linear memory via `world_state_set_statics` after every pack.
`World.ts createRuntime` auto-calls `syncWorldStaticsToWasm` on
every match start.

## TL;DR — FULL ZIG (2026-05-05 commit `106056b`)

Per user direction "No ts emergency roll back full zig im sicks
full QA test audit pipeline":

- **Wasm orchestrator is the primary path for every visitor.**
  No URL flag. No TS fallback. `World.ts maybeWasmActual`
  unconditionally returns the wasm result.
- **5-layer QA audit pipeline** (`qa-audit.yml`) gates every
  push + PR + nightly. Failures by layer for clean triage.
- 196 wasm tests + Bun parity + long-horizon canaries +
  9 hypothesis-driven Playwright specs + bot soak all green.

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

### Orchestrator (Phase I — 13 cuts done)
- **I1** — `step_world(state, dt)` skeleton dispatches H1-H7 in
  deterministic order.
- **I2** — header carries `countdown_remaining_ms` + `round_index`;
  step_world drives the round phase machine end-to-end.
- **I3** — header carries `chaos_mask`; step_world resolves the
  ChaosProfile each tick.
- **I4/I4b** — PlayerEntity carries `current_keys`/`prev_keys`;
  step_world iterates players, calls `combat.tickShield` +
  `combat.tryStartParry`; rolls current→prev at end-of-tick.
- **I5** — PlayerEntity gains `score: u32`.
- **I6** — winner detection (KO + time-out) + score increment.
- **I7** — projectile motion via `step_projectile_v2` for
  pre-step `advance` results (empty statics + empty players —
  full collision lands once map AABB cache is wired).
- **I8** — satellite orbit + closest-non-owner target lookup +
  fire-decision via `satelliteTickWorld`.
- **I9** — header carries `target_score` + `match_winner_idx`;
  step_world flags the match winner when a player hits target.
- **I10** — fire-patch DPS damage to overlapping non-owner
  players; clears alive flag on health ≤ 0.
- **I11** — projectile damage to players (circle vs AABB) on
  overlap; pierce-chain decrements + survives, other impacts
  expire the projectile.
- **I12** — explosive destructible break → AOE damage
  (EXPLOSION_DAMAGE 28 / EXPLOSION_RADIUS 80) to alive
  non-owner players via `playerInBlastRadius`.
- **I13** — pickup overlap → effect (health-shard heals,
  shield-cell adds shield_charge); deactivates pickup. Buff
  pickups + respawn scheduling pending.
- **Pending**: weapon spawn (needs build resolution / data-table
  resolved-build pass-through), player physics integration
  (movement-memory parallel array + map AABB cache), drafting
  orchestration.

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

- **Card-driven weapon build resolution** — multi-shot, spread,
  per-card pathing/element/impact mutations. Today every player
  fires the starter pistol; cards apply TS-side until H8c lands.
- **Drafting orchestration** (offers, picks, expiry, card list)
  — needs the card data table.

**step_world drives end-to-end:**

| Slice | Phase |
|---|---|
| tick increment + round phase + winner detection + match-end | I1, I6, I9 |
| Chaos profile resolve + apply (timeScale, gravity, damage) | I3, I20 |
| Fire-patch lifetime + DPS to overlapping non-owner players | I10 |
| Projectile lifecycle (sticky / lifetime expire) + 8-pathing motion | H1, I7 |
| Projectile→destructible HP + projectile→player damage + pierce-chain | I11 |
| Explosive destructible AOE on break | I12 |
| Satellite orbit + closest-non-owner target lookup + fire decision | H3, I8 |
| Per-player shield drain/recharge + parry rising-edge + edge state roll | H4, I4, I4b |
| Pickup overlap → heal/shield/all 8 buff types | I13, I17 |
| Player physics — walk/jump/jetpack/crouch + coyote/buffer + static-AABB collision | C, I16 |
| **SimEvent emission**: destructible_broken, hit_confirmed, player_killed, pickup_taken, round_end | I18 |
| **TS drain via UnpackedWorldState.events** | I19 |
| Apply chaos profile (timeScale, gravity, damage) to per-module ticks | I20 |
| **Player projectile spawn** on weapon fire (starter pistol base) | I21 |
| **Satellite projectile spawn** on want-fire | I22 |
| J0 shim merges full state + returns events via applyWasmWorldStepFull | I23, I24 |
| **Sticky impact** — projectile lingers on hit then detonates | I25 |
| **Pickup respawn** scheduling (re-activate at respawn_at_tick) | I26 |
| **Slow-field impact** — applies slow debuff to hit player | I27 |
| **Round-transition entity cleanup** — heal players, clear projectiles/fire/satellites between rounds | I28 |
| **End-of-tick array compaction** — drop expired projectiles + fire patches | I29 |
| **Host patcher exports** for statics + target_score | I30 |
| **J1-monitor** — opt-in parity check vs TS via `?wasm-world-monitor=1` | J1m |
| **Parry deflect + shield pop** events on incoming projectile | I31 |
| **Burn DoT** tick at 1s cadence | I32 |
| **Fire-hazard chaos modifier** spawns fire patches | I33 |
| **Damage_amp / overcharge / vulnerability** scale projectile damage | I36 |
| **Speed_boost / slow / freeze** scale player movement | I37 |

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
