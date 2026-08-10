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
| `step_player(...)` | full stepPlayer (gravity, jump, jetpack, sub-stepped collision, true-slope foot-point pass) | `playerParity.test.ts`, `longHorizonCanary.test.ts`, `slopeParity.test.ts` |
| `world_state_set_slopes(slopes_ptr, count) → u32` | true slopes (module-level like launch pads — zero WorldState bytes; 7×f64 per slope `[span_min_x, span_max_x, base_x, base_y, dy_dx, tx, ty]`, the exact `deriveSlopeStatics` bits from collision.ts, order = `map.slopes`); read by the stepPlayer slope pass in BOTH `step_player` and `step_world`'s player pass | `slopeParity.test.ts`, `serverWasmHost.test.ts` "true slopes execute inside step_world" |

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
| `world_state_set_statics(state, aabbs, one_way, count) → u32` | bulk-write static AABB cache; returns actual count written (clamped) | I30 |
| `world_state_set_target_score(state, target)` | set match target_score + reset match_winner_idx | I30 |
| `world_state_set_arena_bounds(ceiling_y, has_ceiling, kill_plane_y)` | ceiling-clamp + void kill-plane bounds (module-level; host sets per match) | B3 |
| `world_state_set_arena_size(width, height)` | raw arena width/height (module-level, same cadence as arena bounds/statics above); consumed by `findCollisionFreeLanding`'s bounds check (Slip Node/Plant Charge/Bulwark Step/Drift Step, Phase 4c) | docs/zig-step-world-parity-goal.md |
| `world_state_set_launch_pads(pads_ptr, count) → u32` | static launch pads (module-level like arena bounds — zero WorldState bytes; 6×f64 per pad `[x,y,w,h,ix,iy]`, order = `map.launchPads` = event `entity_id`); mirrors `sim/launchPad.ts`, stepped in world.zig §8c | `serverWasmHost.test.ts` “launch pads fire inside step_world” |
| `world_state_set_spawn_points(points_ptr, count) → u32` | map spawn points (module-level like launch pads — zero WorldState bytes; 2×f64 per point `[x,y]`, order = `map.spawns`, ORDER LOAD-BEARING for `assignSpawnPoints`'s strict-`>` tiebreak); seats world.zig's mid-round fast respawn + round-boundary respawn at the same seals TS's `assignSpawnPoints` picks (Track Z0b Item A; callers pass TS's no-spawns center fallback — world.zig has no map size) | `respawnParity.test.ts` |
| `world_state_set_hangout_mode(enabled)` | Track E1d hangout flag (module-level STEP INPUT, arena-bounds pattern — zero WorldState bytes): hosts write it before EVERY `step_world` call (client `runWasmStepSync` opts / server `serverWasmHost.step` opts), so the shared instance stepping the venue lobby and an arena interleaved never leaks one mode into the other. Gates the no-PvP lobby semantics — see `world.zig`'s `g_hangout_mode` doc for the full site list + recorded cuts | smoke.zig hangout tests + `hangoutModeParity.test.ts` |
| `resolve_player_fire_config(state, player_index, indices_ptr, count)` | resolve player's build from card indices → player_fire_config (weapon_build.zig; replaces TS createWeaponBuild). Class-aware since 2026-07-24 (THE GEOMETRICIAN RULING): derives the class from the player's own `character_id` in state — no ABI change | B4 |
| `resolve_player_loadout(state, player_index, indices_ptr, count)` | Track Z1b superset of `resolve_player_fire_config`: fire config + `player_card_ids` + `card_count` + the `EquippedActives` rack from one ordered-hand delivery — the hosts call it after EVERY pack because the pack zero-fills all three loadout parallel arrays (before this, no ability was castable at all on the live wasm path) | Z1b |
| `aim_assist_dir(state, local_index, ox, oy, sx, sy, out)` | **N-AIM / E4** — the touch assist as a sim-level dialect: blends the stick direction toward the nearest living enemy inside a 20 deg cone / 900px, blend ramping to 0.6 at zero error. Port of `touchAimAssist.ts`, so the raylib shell and a future gamepad path share ONE assist instead of growing a second slightly-different one. Writes `[x, y]` | `aimDialectParity.test.ts` |
| `aim_resolve(state, dialect, local_index, ox, oy, rx, ry, reach, out)` | **N-AIM / E4** — resolve a shell's raw aim into the world point the sim uses. `exact` (0, mouse) passes through UNTRANSFORMED — mouse aim is never assisted, and that rule is pinned by a test; `assisted` (1) and `snap` (2, gamepad, currently behaves as assisted) treat the input as a direction and project to `reach`. THE CONTRACT: a shell submits a WORLD-SPACE point; the sim never sees screen coordinates | `aimDialectParity.test.ts` |
| `bot_target_set_foe(i, x, y, vx, vy, alive, is_bot, is_fresh)` | **N-BOT** — stage one foe in the module-level scratch roster before a targeting query. Flat args so the parity test needs no struct layout | `botTargetParity.test.ts` |
| `bot_target_nearest(me_index, me_x, me_y, count) → i32` | **N-BOT** — port of `worldBots.ts`'s `nearestFoe`: four running bests (nearest anything / bot / non-fresh / human) resolved by the bot-on-bot preference (a bot within **1.55x** of the nearest human wins) and the newcomer grace window. Every comparison is a strict `<`, so order is load-bearing — getting it subtly wrong does not throw, it just makes the gang dogpile the wrong player. Returns an INDEX (-1 = none) so the caller keeps entity identity | `botTargetParity.test.ts` |
| `bot_target_heading_toward(me_x, me_y, fx, fy, fvx, fvy) → u32` | **N-BOT** — port of `headingTowardMe`: is the foe closing on me (alignment > 0.5)? The TS `\|\| 1` guards on zero speed/distance are transcribed rather than cleaned up, so a stationary foe resolves the same way on both sides | `botTargetParity.test.ts` |
| `bot_nav_build(platforms_ptr, count, map_w, map_h) → u32` | **N-BOT (first slice)** — compile a map into the bot brain's nav (cover columns + hop ledges + floor top), port of `botArenaNav.ts`'s `buildArenaNav`. 5 f64 per platform `[cx, cy, w, h, kind + (floor_by_id ? 8 : 0)]` — the flag carries the one thing the TS builder reads from the string id (`isFloorId`). Returns `cover_count * 1000 + ledge_count` | `botNavParity.test.ts` |
| `bot_nav_floor_top() → f64` | **N-BOT** — the compiled nav's floor top | `botNavParity.test.ts` |
| `bot_nav_has_los(ax, ay, bx, by) → u32` | **N-BOT** — shoulder-height segment LOS against cover columns; 1 = clear. Stops bots spraying into bulkheads | `botNavParity.test.ts` |
| `bot_nav_cover_flank(me_x, me_y, foe_x, max_dist, out)` | **N-BOT** — best cover flank breaking LOS to the foe; writes `[found, x, y, cover_cx]`. Picks by strict `<` on a float score, so cover sort order is load-bearing | `botNavParity.test.ts` |
| `bot_nav_hop_target(me_x, me_top, foe_x, foe_y, max_rise, max_gap, out)` | **N-BOT** — nearby ledge to hop toward when the foe is above; writes `[found, cx, top, x0, x1]` | `botNavParity.test.ts` |
| `bot_nav_mega_scale() → f64` | **N-BOT** — mega-dock scale from map width (1 at ~1280, capped 2.4) | `botNavParity.test.ts` |
| `bot_nav_dir_toward_x(from_x, to_x, deadzone) → i32` | **N-BOT** — horizontal run intent, -1/0/+1 | `botNavParity.test.ts` |
| `world_state_load_named_map(state, id_ptr, id_len) → u32` | **N-MAP** — load a HAND-AUTHORED map's geometry (statics + one_way into the state, spawns into the module-level spawn table so `world_init_roster` places players correctly, plus arena size). The `gen:N` counterpart is `world_state_generate_arena`; with both, a native shell can construct every arena the browser can. Returns 0 for an unknown id and touches NOTHING — never a substituted default, because swapping geometry silently turns a replay desync into a mystery | `namedMapParity.test.ts` + smoke.zig |
| `named_map_count() → u32` | **N-MAP** — how many named maps the core carries; lets a shell enumerate without hardcoding the list and lets a test assert the codegen actually ran | `namedMapParity.test.ts` |
| `named_map_geometry(id_ptr, id_len, out) → u32` | **N-MAP** parity export, same shape as `gen_arena_geometry`: `[static_count, (x,y,w,h,one_way)×N, spawn_count, (x,y)×M, width, height]` as f64s. Exists so the parity test can compare against `buildStaticCache` without reimplementing WorldState struct offsets in JS | `namedMapParity.test.ts` |
| `world_init_player(state, player_index, archetype_raw, spawn_index)` | **N0.5** — construct ONE player natively: place at `g_spawn_points[spawn_index % count]` (wraps when the roster outruns the spawns), class-chassis base health (`baseMaxHealthForArchetype`), alive flag, every buff/debuff window cleared, aim set right-of-centre so an input-less player still has a defined facing. Out-of-range `archetype_raw` clamps to `balanced` rather than producing an illegal enum. Does NOT resolve the loadout — call `resolve_player_loadout` after, same order as the TS path | smoke.zig `world_init_*` tests |
| `world_init_roster(state, archetypes_ptr, count, seed) → u32` | **N0.5** — build a whole roster with no packed-state input, the row's acceptance bar. ZEROES the entire WorldState first: setting only the counters it knows about left destructible/pickup/paper-double counts as the caller's garbage and `step_world` panicked on `0xAAAAAAAA` deep inside the step. Seeds `rng_state`, never with 0 (xorshift fixed point). SCOPE: builds players onto a map already established by `world_state_generate_arena` / the `world_state_set_*` family — named maps (boxworks-tower, vessel-nexus, skyseam) are TS data and remain N-MAP's job | smoke.zig `world_init_*` tests |
| `offset_player_draft_state()` | Track Z2 drafting bridge — byte offset of `player_draft_state[0]` in WorldState; pins the TS codec's PLAYER_DRAFT_STATE_OFFSET derivation (draftOfferParity.test.ts) | Z2 |
| `sizeof_player_draft_state()` | Track Z2 — @sizeOf(PlayerDraftState) pin for the bridge's PLAYER_DRAFT_STATE_SIZE stride | Z2 |
| `world_apply_card_pick(state, player_idx, offer_slot)` | Track Z2 — apply one host-queued draft pick (draft.applyCardPick, auto=false) between pack and step_world; returns 1 if it landed. Its own draft_resolved event is wiped by stepWorld's event reset — the host synthesizes the TS event for queued picks | Z2 |
| `world_draft_roll_offers(state)` | Track Z2 parity-test entry — draft.rollOffersForRound exactly as stepWorld's round_over→drafting transition calls it, host-invokable on a hand-seeded state for the TS-vs-Zig offer-roll parity suite | Z2 |
| `resolve_build_test(card_index, out_ptr)` | test-only: resolve base (idx<0) or base+cards[idx] into out (class-blind) | B4 |
| `resolve_build_test_class(card_index, class_idx, out_ptr)` | test-only: class-AWARE resolve (class_idx 0=wizard..3=priest, else class-blind) — locks THE GEOMETRICIAN RULING's wizard-forces-raycast rule against TS (2026-07-24) | `weaponBuildParity.test.ts` wizard walk |
| `resolve_build_card_count() → u32` | test-only: count of cards in the generated table | B4 |
| `resolve_emission_test(card_index, out_ptr)` | test-only: emission cast derivation (weapon_build.emissionFromConfig, mirrors emission.ts resolveEmission) → [volley, damage, speed, radius, impactRadius] as 5×f64 | `emissionParity.test.ts` |
| `gen_arena_geometry(seed, out_ptr) → u32` | test-only: write generated arena geometry (platforms+spawns) for parity vs mapGen.ts | B4 |
| `world_state_generate_arena(state, seed)` | generate arena into state.statics/spawns (map_gen.zig) — mapgen authority | B4 |

## Round (`round.zig`) — Phase H7

Tick-driven phase machine. Drafting transitions land in H7b
once the card data tables ship.

| Export | Purpose | Parity test |
|---|---|---|
| `round_step_phase(phase, remaining_ms, dt, winner_decided, out)` | tick countdown + phase transitions (countdown → fighting → round_over → countdown) | `roundPhaseParity.test.ts` |
| `round_countdown_ms() → f64` | 3000 | `roundPhaseParity.test.ts` |
| `round_time_limit_ms() → f64` | 90_000 | `roundPhaseParity.test.ts` |
| `round_over_hold_ms() → f64` | 2500 | `roundPhaseParity.test.ts` |
| `round_draft_window_ms() → f64` | 8000 | `roundPhaseParity.test.ts` |
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
| `sizeof_resolved_fire_config` | 136 | `worldStateLayout.test.ts` (I-final) |
| `offset_player_fire_config` | byte offset | host-side fire config write (I-final) |
| `offset_player_movement` | byte offset | `movementMemoryBridge.test.ts` (Track Z0e — bridged movement memory) |
| `offset_melee_swing` | byte offset | `meleeSwingMemoryBridge.test.ts` (Track Z1a — bridged melee swing FSM memory) |
| `sizeof_melee_swing_memory` | 32 | `meleeSwingMemoryBridge.test.ts` (Track Z1a) |
| `offset_paper_doubles` | byte offset | `paperDoubleBridge.test.ts` (Track E1c — bridged Paper Double decoys) |
| `sizeof_paper_double_entity` | 96 | `paperDoubleBridge.test.ts` (Track E1c) |
| `world_state_max_paper_doubles` | 16 | `paperDoubleBridge.test.ts` (Track E1c) |
| `combat_hitbox_scale` | per-archetype sizeScale | `combatHitboxScaleParity.test.ts` (Track Z1a item 2 — class-scaled combat hitboxes) |
| `world_state_max_statics` | 256 | `worldStateLayout.test.ts` (I15) |
| `world_state_max_events_per_tick` | 64 | `worldStateLayout.test.ts` (I18) |
| `sizeof_sim_event` | 40 | `worldStateLayout.test.ts` (I18) |
| `world_state_max_players` | 16 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_projectiles` | 256 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_satellites` | 32 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_destructibles` | 64 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_fire` | 32 | `worldStateBridge.test.ts` (G2) |
| `world_state_max_pickups` | 32 | `worldStateBridge.test.ts` (G2) |
