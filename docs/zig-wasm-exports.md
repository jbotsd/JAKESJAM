# Zig→WASM exports manifest

Generated 2026-05-05. Tracks every wasm export from `sim.wasm`,
its purpose, and which parity test gates byte-equality vs the
TS reference impl.

Total exports: **72 functions** + memory + state buffer.

The exports manifest is gated by
`client/src/sim/wasm/__tests__/exportsManifest.test.ts` — that
test fails if a Zig refactor accidentally drops or renames an
export.

## Boundary primitives

| Export | Purpose | Parity test |
|---|---|---|
| `memory` | wasm linear memory; loader reads LUTs from here | `pingPong.test.ts` |
| `alloc_state` | returns ptr to static state buffer | `pingPong.test.ts` |
| `free_state` | no-op (static buffer); kept for symmetry | `pingPong.test.ts` |
| `state_size` | bytes in state buffer | `pingPong.test.ts` |
| `current_tick` | tick counter (stub for D2 sim load) | `pingPong.test.ts` |
| `step` | no-op increment (stub) | `pingPong.test.ts` |
| `reset` | clear state + tick | `pingPong.test.ts` |

## RNG (`rng.zig`)

| Export | Sig | Parity test |
|---|---|---|
| `rng_next_u32(state: u32) → u32` | mulberry32 step | `rngParity.test.ts` |
| `rng_next_int(state, min, maxExcl) → i64` | int in [min, maxExcl), packed result | `rngParity.test.ts` |

## Hash (`hash.zig`)

| Export | Sig | Parity test |
|---|---|---|
| `hash_fnv1a_basis() → u32` | FNV1a-32 basis constant | `hashParity.test.ts` |
| `hash_fnv1a_mix(hash, byte) → u32` | mix one byte | `hashParity.test.ts` |
| `hash_mix_u32(hash, v) → u32` | mix u32 (LE byte order) | `hashParity.test.ts` |
| `hash_quantise(value, grid) → i32` | round-then-truncate | `hashParity.test.ts` |

## Trig LUT (`trig.zig`)

| Export | Sig | Parity test |
|---|---|---|
| `lut_sin(x: f64) → f64` | LUT-based sin | `trigParity.test.ts` |
| `lut_cos(x: f64) → f64` | LUT-based cos | `trigParity.test.ts` |
| `lut_atan2(y, x: f64) → f64` | LUT-based atan2 | `trigParity.test.ts` |
| `lut_sin_table_ptr() → ptr` | sin table base address | `trigParity.test.ts` |
| `lut_atan_table_ptr() → ptr` | atan table base address | `trigParity.test.ts` |
| `lut_table_size() → u32` | 1024 | `trigParity.test.ts` |

## Collision (`collision.zig`)

### Sweep + slide

| Export | Purpose | Parity test |
|---|---|---|
| `sweep_against_one_flat(...)` | single-target swept AABB | `collisionParity.test.ts` |
| `sweep_aabb_many(...)` | swept AABB against array | `collisionParity.test.ts` |
| `sweep_aabb_cached(...)` | one-way-aware swept | `collisionBackendSwap.test.ts` |
| `resolve_move(...)` | multi-pass slide solver | `collisionParity.test.ts` |
| `resolve_move_cached(...)` | with one-way + drift snap | `collisionBackendSwap.test.ts` |

### Circles

| Export | Purpose | Parity test |
|---|---|---|
| `circle_overlaps_aabb(...)` | closest-point distance check | `circleParity.test.ts` |
| `circle_hits_any(...)` | first overlapping AABB index | `circleParity.test.ts` |
| `circle_bounce(...)` | reflection axis decision | `circleParity.test.ts` |

## Spatial grid (`spatial.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `spatial_build_grid(aabbs, w, h, cellSize)` | populate static grid | `spatialParity.test.ts` |
| `spatial_query_grid(region, out, cap) → count` | deduped indices | `spatialParity.test.ts` |
| `spatial_cell_size_default() → f64` | 128 px | `spatialParity.test.ts` |
| `spatial_max_aabbs() → u32` | 256 | `spatialParity.test.ts` |

## Player physics (`player.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `step_player(...)` | full stepPlayer (gravity, jump, jetpack, sub-stepped collision) | `playerParity.test.ts`, `longHorizonCanary.test.ts` |

## Projectile (`projectile.zig`)

### Motion + helpers

| Export | Purpose | Parity test |
|---|---|---|
| `step_projectile(...)` | straight + gravity + lifetime + terrain hit (V1) | `projectileParity.test.ts` |
| `step_projectile_v2(...)` | full 8-pathing dispatch in one call (straight/gravity/float/accelerate/boomerang/homing/anti-homing/bounce); needs player array + sized struct | `projectileStepV2Parity.test.ts` |
| `projectile_apply_float(...)` | sin/cos oscillation pathing | `projectilePathingsParity.test.ts` |
| `projectile_apply_accelerate(...)` | (1+k·dt) velocity scale | `projectilePathingsParity.test.ts` |
| `projectile_rotate_velocity_toward(...)` | turn-rate-limited rotation | `projectilePathingsParity.test.ts` |
| `projectile_closest_non_owner_player(...)` | min-distance lookup over player array | `projectileHomingParity.test.ts` |
| `projectile_boomerang_should_return(...)` | range-fraction return trigger | `projectileHomingParity.test.ts` |
| `projectile_bounce_resolve(...)` | full reflection + nudge step | `projectileBounceParity.test.ts` |
| `projectile_anti_homing_target(...)` | (2x-tx, 2y-ty) mirror | `projectileBounceParity.test.ts` |
| `projectile_boomerang_turn_rate() → f64` | 8.4 | `projectileHomingParity.test.ts` |
| `projectile_homing_turn_rate_default() → f64` | 4.0 | `projectileHomingParity.test.ts` |

### Phase H1 — orchestration helpers

| Export | Purpose | Parity test |
|---|---|---|
| `projectile_pre_step(proj, dt_ms) → u8` | sticky-fuse / lifetime-expire pre-step decision (returns PreStepResult: 0 advance, 1 sticky_linger, 2 sticky_expired, 3 lifetime_expired) | `projectileLifecycleParity.test.ts` |
| `projectile_split_velocities(parent, rng, out, cap) → u64` | velocity fan for split children; packed (rng<<32 \| count) | `projectileLifecycleParity.test.ts` |
| `projectile_sticky_fuse_default_ms() → f64` | 720 | `projectileLifecycleParity.test.ts` |
| `projectile_split_max() → u32` | 8 | `projectileLifecycleParity.test.ts` |
| `sizeof_split_velocity` | 24 | `projectileLifecycleParity.test.ts` |

## Weapon (`weapon.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `weapon_muzzle_position(...)` | aim-direction × reach | `weaponParity.test.ts` |
| `weapon_recoil(...)` | impulse to subtract from velocity | `weaponParity.test.ts` |
| `weapon_tick_cooldown(cd, dt) → f64` | clamp at 0 | `weaponParity.test.ts` |
| `weapon_spread_offset(...)` | per-shot fan angle | `weaponParity.test.ts` |
| `weapon_cooldown_from_fire_rate(...)` | 1000/max(min,rate) | `weaponParity.test.ts` |

### Phase H2 — fire-decision orchestration

| Export | Purpose | Parity test |
|---|---|---|
| `weapon_tick_fire(player, fire_requested, dt, cooldown_after_fire, out)` | tick player.fire_cooldown_ms; decide fired? mutate in place | `weaponFireDecisionParity.test.ts` |
| `weapon_tick_fire_with_keys(player, keys, dt, cooldown_after_fire, out)` | same but reads InputBit.Fire from keys bitmask | `weaponFireDecisionParity.test.ts` |
| `sizeof_fire_decision` | 8 | `weaponFireDecisionParity.test.ts` |

## Satellite (`satellite.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `satellite_tick(in, out)` | orbit + cooldown + lifetime + fire decision | `satelliteParity.test.ts` |
| `satellite_orbit_rad_per_sec() → f64` | π/1.5 | `satelliteParity.test.ts` |
| `satellite_fire_cooldown_ms() → f64` | 600 | `satelliteParity.test.ts` |

### Phase H3 — orchestration helper

| Export | Purpose | Parity test |
|---|---|---|
| `satellite_tick_world(sat, owner_x, owner_y, target_x, target_y, has_target, can_fire, dt, out)` | tick SatelliteEntity in place; emits TickOutput with fire decision + world position | `satelliteWorldParity.test.ts` |

## Combat (`combat.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `combat_wrap_angle(angle) → f64` | normalise to [-π, π) | `combatParity.test.ts` |
| `combat_is_hit_in_parry_arc(...)` | atan2-based arc inclusion | `combatParity.test.ts` |
| `combat_shield_drain(dps, dt) → f64` | dps × dt | `combatParity.test.ts` |
| `combat_parry_arc_radians() → f64` | π/3 | `combatParity.test.ts` |

### Phase H4 — orchestration helpers

| Export | Purpose | Parity test |
|---|---|---|
| `combat_try_start_parry(player, curr_keys, prev_keys, tick, dt, active_ms, cooldown_ms) → i32` | edge-detect Ability + cooldown gate; sets parry tick bounds + facing | `combatOrchestrationParity.test.ts` |
| `combat_is_parry_active(player, tick) → i32` | true while parryActiveUntilTick > tick | `combatOrchestrationParity.test.ts` |
| `combat_tick_shield(player, curr_keys, dt, max_override, drain_dps, recharge_dps)` | drain when held; recharge otherwise | `combatOrchestrationParity.test.ts` |
| `combat_parry_active_ms() → f64` | 420 | `combatOrchestrationParity.test.ts` |
| `combat_parry_cooldown_ms_default() → f64` | 1800 | `combatOrchestrationParity.test.ts` |
| `combat_shield_max_charge_default() → f64` | 100 | `combatOrchestrationParity.test.ts` |
| `combat_shield_drain_per_second() → f64` | 35 | `combatOrchestrationParity.test.ts` |
| `combat_shield_recharge_per_second() → f64` | 14 | `combatOrchestrationParity.test.ts` |

## Destructible (`destructible.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `destructible_apply_damage(hp, dmg) → f64` | max(0, hp-dmg) | `destructibleParity.test.ts` |
| `destructible_player_in_blast(...)` | squared-distance blast check | `destructibleParity.test.ts` |
| `destructible_center_to_aabb(...)` | center-origin → top-left AABB | `destructibleParity.test.ts` |

### Phase H5 — orchestration helpers

| Export | Purpose | Parity test |
|---|---|---|
| `destructible_resolve_projectile_hit(proj, dest) → u8` | overlap + damage application; returns 0 no_overlap, 1 damaged, 2 broken | `destructibleHitParity.test.ts` |
| `destructible_explosion_radius() → f64` | 80 | `destructibleHitParity.test.ts` |
| `destructible_explosion_damage() → f64` | 28 | `destructibleHitParity.test.ts` |
| `destructible_fire_patch_default_lifetime_ms() → f64` | 1800 | `destructibleHitParity.test.ts` |
| `destructible_fire_patch_default_radius() → f64` | 36 | `destructibleHitParity.test.ts` |
| `destructible_fire_patch_default_dps() → f64` | 14 | `destructibleHitParity.test.ts` |

## Fire (`fire.zig`)

| Export | Purpose | Parity test |
|---|---|---|
| `fire_patch_tick(remainingMs, dt, out)` | lifetime decay + alive flag | `fireParity.test.ts` |
| `fire_patch_damage(dps, dt) → f64` | dps × dt | `fireParity.test.ts` |
| `fire_patch_hits_player(...)` | AABB overlap | `fireParity.test.ts` |

### Phase H6 — orchestration helpers

| Export | Purpose | Parity test |
|---|---|---|
| `fire_patch_tick_world(fire, dt) → i32` | tick FireEntity in place; returns alive flag | `fireWorldParity.test.ts` |
| `fire_patch_hits_player_world(fire, px, py, pw, ph) → i32` | overlap test using FireEntity | `fireWorldParity.test.ts` |

## Weapons data (`data/weapons.zig`) — Phase H8b

JAKESJAM-specific data table. Base weapon stats by id.

| Export | Purpose | Parity test |
|---|---|---|
| `weapon_base_by_id(id, out)` | populate WeaponBase from the static table; out-of-range falls back to starter | `weaponDataParity.test.ts` |
| `weapon_count` | length of weapons table | `weaponDataParity.test.ts` |
| `sizeof_weapon_base` | bytes | `weaponDataParity.test.ts` |

## Chaos data (`data/chaos.zig`) — Phase H8a

JAKESJAM-specific data table. Bitmask → ChaosProfile resolver.
Lives in `sim/src/data/` to keep core sim modules game-agnostic.

| Export | Purpose | Parity test |
|---|---|---|
| `chaos_profile_from_mask(mask, out)` | resolve bit positions of active modifier ids → composed ChaosProfile | `chaosDataParity.test.ts` |
| `sizeof_chaos_profile` | 56 | `chaosDataParity.test.ts` |
| `chaos_modifier_count` | 7 | `chaosDataParity.test.ts` |

## World (`world.zig`) — Phase I

The orchestrator that drives one tick: ticks fire patches, runs
projectile pre-step lifecycle, resolves projectile×destructible
HP application. Score keeping, drafting transitions, projectile
spawn, satellite owner-lookup land in I2-I4.

| Export | Purpose | Parity test |
|---|---|---|
| `step_world(state, dt_ms) → i32` | one full tick of the orchestrator over WorldState | `worldStepParity.test.ts` |

## Round (`round.zig`) — Phase H7

Tick-driven phase machine. Drafting transitions land in H7b
once the card data tables ship.

| Export | Purpose | Parity test |
|---|---|---|
| `round_step_phase(phase, remaining_ms, dt, winner_decided, out)` | tick countdown + phase transitions (countdown → fighting → round_over → countdown) | `roundPhaseParity.test.ts` |
| `round_countdown_ms() → f64` | 3000 | `roundPhaseParity.test.ts` |
| `round_time_limit_ms() → f64` | 90_000 | `roundPhaseParity.test.ts` |
| `round_over_hold_ms() → f64` | 2500 | `roundPhaseParity.test.ts` |
| `sizeof_round_phase_step_result` | 16 | `roundPhaseParity.test.ts` |

## Sizeof helpers

These let the host pre-allocate the right amount of wasm memory
when packing struct arrays.

| Export | Returns |
|---|---|
| `sizeof_aabb` | 32 |
| `sizeof_sweep_hit` | 32 |
| `sizeof_resolve_move_out` | 40 |
| `sizeof_player_step` | 96 |
| `sizeof_projectile_kinematics` | 80 |
| `sizeof_projectile_step_result` | 8 |
| `sizeof_projectile_kinematics_v2` | 136 |
| `sizeof_projectile_step_result_v2` | 16 |
| `sizeof_circle_bounce` | 16 |
| `sizeof_bounce_resolve` | 48 |
| `sizeof_satellite_tick_input` | 80 |
| `sizeof_satellite_tick_output` | 56 |
| `sizeof_muzzle_position` | 16 |
| `sizeof_recoil_impulse` | 16 |
| `sizeof_fire_patch_tick_result` | 16 |

## WorldState (`world_state.zig`) — Phase G1

Full WorldState extern struct landed in G1a/G1b. Sizes are the
wire contract — bumping any number is a protocol-version change.

| Export | Returns | Parity test |
|---|---|---|
| `sizeof_world_state` | total bytes of `WorldState` | `worldStateBridge.test.ts` (G2) |
| `sizeof_world_state_header` | 40 | `worldStateBridge.test.ts` (G2) |
| `sizeof_player_entity` | 288 | `worldStateBridge.test.ts` (G2) |
| `sizeof_projectile_entity` | 216 | `worldStateBridge.test.ts` (G2) |
| `sizeof_satellite_entity` | 96 | `worldStateBridge.test.ts` (G2) |
| `sizeof_destructible_entity` | 64 | `worldStateBridge.test.ts` (G2) |
| `sizeof_fire_entity` | 88 | `worldStateBridge.test.ts` (G2) |
| `sizeof_pickup_entity` | 64 | `worldStateBridge.test.ts` (G2) |
| `sizeof_player_movement_memory` | 24 | `worldStateLayout.test.ts` (I14) |
| `world_state_max_players` | 16 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_projectiles` | 256 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_satellites` | 32 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_destructibles` | 64 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_fire` | 32 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_pickups` | 32 | `worldStateBridge.test.ts` (G2) |
