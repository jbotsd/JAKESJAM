//! In-sim card build resolution — mirrors client/src/sim/data/weaponBuild.ts
//! createWeaponBuild + applyCard + clampBuild, and the packResolvedFireConfig
//! mapping into ResolvedFireConfig. Card data comes from the generated
//! cards_gen.zig (single source: cards.ts). This lets the Zig orchestrator
//! resolve builds itself instead of the host writing them each tick.

const std = @import("std");
const gen = @import("data/cards_gen.zig");
const world_state = @import("world_state.zig");

const B = gen.StarterBase;

fn round2(v: f64) f64 {
    return @round(v * 100.0) / 100.0;
}

/// archetype → class dev-id. Mirrors cardTypes.ts's ARCHETYPE_CLASS_ID map
/// (balanced→wizard, heavy→paladin, sprinter→ninja, shielded→priest) —
/// needed here because THE GEOMETRICIAN RULING (see resolveMods) makes the
/// build resolver class-aware, and the live entry points below derive the
/// class from the player's own `character_id` rather than widening the wasm
/// ABI with a new parameter.
pub fn classForArchetype(archetype: world_state.CharacterArchetype) gen.ClassId {
    return switch (archetype) {
        .balanced => .wizard,
        .heavy => .paladin,
        .sprinter => .ninja,
        .shielded => .priest,
    };
}

/// Resolve starter-base + `card_ids` → ResolvedFireConfig (valid=1).
/// `class_id` null = class-blind resolution, byte-identical to the
/// pre-class-era behavior (mirrors createWeaponBuild's optional classId).
pub fn resolveBuild(card_ids: []const []const u8, class_id: ?gen.ClassId) world_state.ResolvedFireConfig {
    var buf: [world_state.MAX_PLAYER_CARDS]gen.CardMod = undefined;
    var n: usize = 0;
    for (card_ids) |id| {
        if (n >= buf.len) break;
        if (gen.cardMod(id)) |m| {
            buf[n] = m;
            n += 1;
        }
    }
    return resolveMods(buf[0..n], class_id);
}

/// Resolve starter-base + cards named by their index into `cards_gen.cards`.
pub fn resolveByIndices(indices: []const u8, class_id: ?gen.ClassId) world_state.ResolvedFireConfig {
    var buf: [world_state.MAX_PLAYER_CARDS]gen.CardMod = undefined;
    var n: usize = 0;
    for (indices) |idx| {
        if (n >= buf.len) break;
        if (idx < gen.cards.len) {
            buf[n] = gen.cards[idx].mod;
            n += 1;
        }
    }
    return resolveMods(buf[0..n], class_id);
}

fn resolveMods(mods: []const gen.CardMod, class_id: ?gen.ClassId) world_state.ResolvedFireConfig {
    var damage = B.damage;
    var fire_rate = B.fire_rate;
    var projectile_speed = B.projectile_speed;
    var spread = B.spread_radians;
    // Recoil (Track Z0c Item A): two independent channels, exactly like
    // weaponBuild.ts — the build-level impulse (base × top-level card
    // recoilMultiplier, :278) and the per-projectile multiplier (:428).
    var recoil_impulse = B.recoil_impulse;
    var p_recoil_mul = B.p_recoil_mul;
    var max_health_add: f64 = 0;
    var move_speed_mul: f64 = 1;
    var parry_cover_mul: f64 = 1;
    var parry_cooldown_mul: f64 = 1;
    var gravity_mul: f64 = 1;
    var shield_charge_mul: f64 = 1;
    var shield_recharge_mul: f64 = 1;
    var jump_mul: f64 = 1;
    var wall_jump_mul: f64 = 1;
    var wall_slide_mul: f64 = 1;
    var air_jumps: f64 = 0;
    var dash_charges: f64 = 0;
    var dash_cooldown_mul: f64 = 1;
    var mirror = false;
    var directional = false;
    // Delivery identity (0=projectile, 1=raycast, 2=continuous-beam,
    // 3=area-pulse) — seeded from the BASE weapon's own delivery (true
    // hitscan, 2026-07-20: StarterBase.delivery is 1/raycast, not the old
    // hardcoded-0 default), mirrors weaponBuild.ts's applyCard delivery
    // merge exactly: a card's delivery only overrides while the CURRENT
    // value still equals the untouched base default — once a card has
    // upgraded it away, a later "projectile" (0) card never stomps that
    // upgrade. See weaponBuild.ts's `applyCard`'s own `baseDelivery` param
    // doc comment for the full reasoning.
    //
    // Track Z1c item 1: the base delivery is CLASS-GATED, mirroring
    // weapons.ts's `baseWeaponForClass` — priest (priestStarterWeapon)
    // and paladin (paladinStarterWeapon) both carry an explicit
    // `delivery: "projectile"` override ("homing tendrils need real
    // travel time to curve in"); wizard and ninja share `starterWeapon`'s
    // raycast, and class-blind resolution (`class_id == null`) uses
    // `starterWeapon` too (TS `baseWeaponForClass(undefined)`). ONLY the
    // delivery seed is class-gated here — the per-class starter STAT
    // overrides (priest tendril damage/speed/homing, paladin's heavier
    // bolt) remain an unported, recorded gap (they predate this cut and
    // are not delivery-shaped work).
    const base_delivery: u8 = if (class_id) |c| switch (c) {
        .priest, .paladin => 0,
        else => B.delivery,
    } else B.delivery;
    var delivery: u8 = base_delivery;

    var p_shape: u8 = B.p_shape;
    var p_element: u8 = B.p_element;
    var p_pathing: u8 = B.p_pathing;
    var p_impact: u8 = B.p_impact;
    var p_count = B.p_count;
    var p_range = B.p_range_px;
    var p_speed_mul = B.p_speed_mul;
    var p_size_mul = B.p_size_mul;
    var p_lifetime_mul = B.p_lifetime_mul;
    var p_gravity_scale = B.p_gravity_scale;
    var p_homing = B.p_homing_strength;
    var p_accel_mul = B.p_acceleration_mul;
    var p_bounces = B.p_bounces;
    var p_impact_radius = B.p_impact_radius;
    var p_pierce = B.p_pierce_count;
    var p_split = B.p_split_count;
    var p_slow = B.p_slow_mul;

    for (mods) |m| {
        if (m.delivery) |d| {
            if (delivery == base_delivery or d != 0) delivery = d;
        }
        damage *= m.damage_mul;
        fire_rate *= m.fire_rate_mul;
        recoil_impulse *= m.recoil_mul;
        projectile_speed *= m.projectile_speed_mul;
        max_health_add += m.max_health_add;
        move_speed_mul *= m.move_speed_mul;
        parry_cover_mul *= m.parry_cover_mul;
        parry_cooldown_mul *= m.parry_cooldown_mul;
        gravity_mul *= m.gravity_mul;
        shield_charge_mul *= m.shield_charge_mul;
        shield_recharge_mul *= m.shield_recharge_mul;
        jump_mul *= m.jump_mul;
        wall_jump_mul *= m.wall_jump_mul;
        wall_slide_mul *= m.wall_slide_mul;
        air_jumps += m.air_jumps_add;
        dash_charges += m.dash_charges_add;
        dash_cooldown_mul *= m.dash_cooldown_mul;
        directional = directional or m.directional_shield;
        mirror = mirror or m.mirror_shield;
        if (m.spread_radians_set) |s| spread = s;
        spread += m.spread_radians_add;
        // Projectile merge: set-fields override, then the top-level adds.
        if (m.proj_shape) |v| p_shape = v;
        if (m.proj_element) |v| p_element = v;
        if (m.proj_pathing) |v| p_pathing = v;
        if (m.proj_impact) |v| p_impact = v;
        if (m.proj_count_set) |v| p_count = v;
        if (m.proj_range_px_set) |v| p_range = v;
        if (m.proj_gravity_scale_set) |v| p_gravity_scale = v;
        if (m.proj_homing_strength_set) |v| p_homing = v;
        if (m.proj_acceleration_mul_set) |v| p_accel_mul = v;
        if (m.proj_bounces_set) |v| p_bounces = v;
        if (m.proj_impact_radius_set) |v| p_impact_radius = v;
        if (m.proj_pierce_count_set) |v| p_pierce = v;
        if (m.proj_split_count_set) |v| p_split = v;
        if (m.proj_slow_mul_set) |v| p_slow = v;
        p_speed_mul *= m.proj_speed_mul;
        p_size_mul *= m.proj_size_mul;
        p_recoil_mul *= m.proj_recoil_mul;
        p_lifetime_mul *= m.proj_lifetime_mul;
        p_count += m.proj_count_add;
        p_bounces += m.proj_bounce_add;
        p_split += m.proj_split_add;
        p_homing += m.proj_homing_add;
    }

    // ── THE GEOMETRICIAN RULING (Jake, 2026-07-24 — supersedes 2026-07-22)
    // Geometrician (classId "wizard") is ALWAYS raycast/hitscan delivery.
    // Never projectile. Nothing may flip it — no card, no fallback. Mirrors
    // createWeaponBuild's post-card-loop enforcement (weaponBuild.ts, see
    // the full history there: the 2026-07-22 "abilities change the hitscan
    // to a projectile — change that" message was about cards FLIPPING the
    // hitscan, got misread as "make the base gun a projectile", and is now
    // reverted). Same judgment call, pinned in the TS lock test:
    // continuous-beam (2) is the one legal carve-out (instant-feel);
    // "projectile" (0) and "area-pulse" (3, travel-time by construction)
    // are forced back to raycast (1). Runs BEFORE the delivery-feel section
    // below so the raycast feel floors apply — exact same ordering as TS.
    if (class_id) |c| {
        if (c == .wizard and delivery != 2) delivery = 1;
    }

    // applyDeliveryFeel (weaponBuild.ts) — runs BEFORE clampBuild there, same
    // order here. Maps the rare delivery identity onto projectile params so
    // raycast/beam/pulse cards feel distinct without a separate hitscan step.
    // PATHING_RANK, by pathing enum index (0=straight..7=accelerate, see
    // gen_card_data.ts's PATHING array order) — mirrors weaponBuild.ts's
    // PATHING_RANK table exactly; the one unlisted index (5=anti-homing)
    // falls back to rank 0 same as TS's `?? 0`. Index 7 (accelerate) is
    // rank 1 — TS added `accelerate: 1` in the i-rounds/falling-star
    // speed-profile pass and this table was never updated (stale comment
    // here even claimed accelerate was unlisted in TS), silently force-
    // resetting accelerate→straight in the raycast/beam feel branch on the
    // Zig side only. Invisible to the class-blind parity walk (i-rounds'
    // own `delivery: "projectile"` fallback meant the raycast branch never
    // ran for it) — caught 2026-07-24 by the wizard-forces-raycast parity
    // walk the GEOMETRICIAN RULING added, which resolves i-rounds through
    // the raycast branch for the first time.
    const pathing_rank = [8]u8{ 0, 3, 1, 2, 5, 0, 4, 1 };
    if (delivery == 1) { // raycast
        p_count = @max(1.0, p_count);
        if (pathing_rank[p_pathing] == 0) p_pathing = 0; // → "straight"
        p_speed_mul = @max(p_speed_mul, 3.2);
        p_lifetime_mul = @min(p_lifetime_mul, 0.35);
        p_range = @max(p_range, 880.0);
        if (p_gravity_scale == 0 or p_pathing == 0) p_gravity_scale = 0;
        p_size_mul = @max(0.55, p_size_mul);
    } else if (delivery == 2) { // continuous-beam
        if (pathing_rank[p_pathing] == 0) p_pathing = 0;
        p_size_mul = @min(@max(p_size_mul, 0.55), @max(0.7, p_size_mul));
        p_lifetime_mul = @min(p_lifetime_mul, 0.55);
        p_range = @max(p_range, 720.0);
        p_gravity_scale = 0;
        fire_rate = @max(fire_rate, 8.0);
    } else if (delivery == 3) { // area-pulse
        // preferImpact(current, "explosive") always yields "explosive" —
        // it's the max-rank impact in IMPACT_RANK, so ir>=cr is always true.
        p_impact = 1; // "explosive" (IMPACT array index 1)
        p_impact_radius = @max(p_impact_radius, 72.0);
        p_speed_mul = @max(0.5, p_speed_mul);
        p_size_mul = @max(p_size_mul, 1.25);
    }

    // clampBuild (weaponBuild.ts). Positive values → @round matches Math.round.
    damage = round2(damage);
    fire_rate = round2(@max(0.35, @min(12.0, fire_rate)));
    // clampBuild:619 rounds ONLY the build-level impulse; the projectile
    // channel stays raw and multiplies in afterward, matching weapon.ts's
    // fire-time `build.recoilImpulse * build.projectile.recoilMultiplier`
    // bit-for-bit (both terms are per-build constants, so baking the
    // product here is exact — same values, same one multiplication).
    recoil_impulse = round2(@max(0.0, recoil_impulse));
    projectile_speed = round2(@max(80.0, projectile_speed));
    const pls = round2(@max(0.1, B.projectile_lifetime_seconds));
    spread = @max(0.0, spread);
    max_health_add = @max(0.0, @round(max_health_add));
    move_speed_mul = round2(@max(0.45, move_speed_mul));
    parry_cover_mul = round2(@max(0.45, parry_cover_mul));
    parry_cooldown_mul = round2(@max(0.28, parry_cooldown_mul));
    // Data-hygiene floor only — the gameplay-safe floor (cooldown can never
    // shrink below burst+recovery) is enforced in player.zig's stepPlayer.
    dash_cooldown_mul = round2(@max(0.5, dash_cooldown_mul));
    // Every one of these upper bounds (min-caps) was previously missing —
    // the block below kept every clampBuild.ts LOWER bound but silently
    // dropped almost every UPPER bound, a systematic gap, not an isolated
    // typo. Found via weaponBuildParity's card-by-card failures (raycast
    // delivery → shard-bloom range → seeker-facets homing, each revealing
    // the next); cross-checked the rest directly against clampBuild.ts
    // rather than waiting for a card to happen to hit each one.
    p_count = @max(1.0, @min(8.0, @round(p_count)));
    p_range = @max(48.0, p_range);
    p_size_mul = @max(0.35, @min(2.4, p_size_mul));
    p_speed_mul = @max(0.15, @min(4.5, p_speed_mul));
    p_lifetime_mul = @max(0.1, p_lifetime_mul);
    p_bounces = @max(0.0, @min(12.0, @round(p_bounces)));
    p_homing = round2(@max(0.0, @min(2.5, p_homing)));
    p_impact_radius = @max(0.0, @min(160.0, p_impact_radius));
    p_pierce = @max(0.0, @min(6.0, @round(p_pierce)));
    p_split = @max(0.0, @min(6.0, @round(p_split)));
    p_slow = @max(0.1, @min(1.0, p_slow));

    // TTK balance clamp (weaponBuild.ts's clampBuild tail) — was missing
    // entirely from the Zig side, which is the actual root cause of the
    // parity gap on multi-projectile cards like shard-bloom: TS scales
    // damage/fireRate DOWN when effective DPS exceeds the TTK ceiling
    // (more pellets ≠ free extra damage), Zig just never applied it.
    {
        const player_base_hp: f64 = 100.0;
        const ttk_floor_s: f64 = 1.55;
        const ttk_ceiling_s: f64 = 4.0;
        const floor_target = ttk_floor_s + 0.03;
        const pellet_eff = 0.62 + 0.38 / @max(1.0, p_count);
        const dps = damage * fire_rate * p_count * pellet_eff;
        const max_dps = player_base_hp / floor_target;
        const min_dps = player_base_hp / ttk_ceiling_s;
        if (dps > max_dps and dps > 0) {
            const s = @sqrt(max_dps / dps);
            damage = round2(damage * s);
            fire_rate = round2(@max(0.35, fire_rate * s));
        } else if (dps < min_dps and dps > 0 and p_count <= 2) {
            const s = @sqrt(min_dps / dps);
            damage = round2(damage * @min(1.35, s));
        }
    }

    return .{
        .damage = damage,
        .fire_rate = fire_rate,
        .projectile_speed = projectile_speed,
        .projectile_lifetime_seconds = pls,
        .spread_radians = spread,
        .range_px = p_range,
        .homing_strength = p_homing,
        .acceleration_multiplier = p_accel_mul,
        .gravity_scale = p_gravity_scale,
        .slow_multiplier = p_slow,
        .impact_radius_px = p_impact_radius,
        .size_multiplier = p_size_mul,
        .speed_multiplier = p_speed_mul,
        .lifetime_multiplier = p_lifetime_mul,
        .projectile_count = @intFromFloat(p_count),
        .bounces = @intFromFloat(p_bounces),
        .pierce_count = @intFromFloat(p_pierce),
        .split_count = @intFromFloat(p_split),
        .shape = @enumFromInt(p_shape),
        .element = @enumFromInt(p_element),
        .pathing = @enumFromInt(p_pathing),
        .impact = @enumFromInt(p_impact),
        .valid = 1,
        .move_speed_mul = move_speed_mul,
        .gravity_mul = gravity_mul,
        .jump_mul = jump_mul,
        .wall_jump_mul = wall_jump_mul,
        .wall_slide_mul = wall_slide_mul,
        .shield_charge_mul = shield_charge_mul,
        .shield_recharge_mul = shield_recharge_mul,
        .parry_cover_mul = parry_cover_mul,
        .parry_cooldown_mul = parry_cooldown_mul,
        .max_health_add = max_health_add,
        .air_jumps = @intFromFloat(air_jumps),
        .dash_charges = @intFromFloat(dash_charges),
        .dash_cooldown_mul = dash_cooldown_mul,
        .mirror_shield = if (mirror) 1 else 0,
        .directional_shield = if (directional) 1 else 0,
        .recoil_impulse = recoil_impulse * p_recoil_mul,
        .delivery = delivery,
    };
}

pub const card_count: u32 = gen.cards.len;

// ── Emission derivation (docs/emission-engine-goal.md) ──────────────────
// Mirrors client/src/sim/data/emission.ts resolveEmission: the cast is
// derived ENTIRELY from the already-resolved fire config — the parameters
// crossed the wasm boundary once (player_fire_config); no second config
// struct, no new host writer, no ABI change. Constants must move in
// lock-step with emission.ts.

pub const EMISSION_DAMAGE_BUDGET: f64 = 70;
pub const EMISSION_VOLLEY_MIN: u32 = 6;
pub const EMISSION_VOLLEY_MAX: u32 = 16;
pub const EMISSION_SPEED_MULT: f64 = 0.85;
pub const EMISSION_RANGE_PX: f64 = 520;
pub const EMISSION_LIFETIME_MS: f64 = 900;
pub const EMISSION_IMPACT_RADIUS_MULT: f64 = 1.6;
pub const EMISSION_IMPACT_RADIUS_MIN_PX: f64 = 48;

pub const EmissionParams = struct {
    volley_count: u32,
    damage_per_shard: f64,
    speed: f64,
    radius_px: f64,
    impact_radius_px: f64,
};

/// Derive the cast payload from a resolved fire config. Pure math —
/// identical rounding to emission.ts (round-to-2-decimals via *100).
pub fn emissionFromConfig(cfg: *const world_state.ResolvedFireConfig) EmissionParams {
    const count_f: f64 = @floatFromInt(@max(@as(u32, 1), cfg.projectile_count));
    const raw: f64 = @round(count_f * 4.0);
    const volley: u32 = @min(
        EMISSION_VOLLEY_MAX,
        @max(EMISSION_VOLLEY_MIN, @as(u32, @intFromFloat(raw))),
    );
    const damage = @round((EMISSION_DAMAGE_BUDGET / @as(f64, @floatFromInt(volley))) * 100.0) / 100.0;
    return .{
        .volley_count = volley,
        .damage_per_shard = damage,
        .speed = cfg.projectile_speed * cfg.speed_multiplier * EMISSION_SPEED_MULT,
        .radius_px = @max(2.0, 7.0 * cfg.size_multiplier),
        .impact_radius_px = @max(
            EMISSION_IMPACT_RADIUS_MIN_PX,
            cfg.impact_radius_px * EMISSION_IMPACT_RADIUS_MULT,
        ),
    };
}

/// Parity-test export: emission derivation for base (index<0) or
/// base+cards[index]. Writes [volley_count, damage_per_shard, speed,
/// radius_px, impact_radius_px] — compared against resolveEmission by the
/// TS parity suite (docs/emission-engine-goal.md `resolve_emission_test`).
pub export fn resolve_emission_test(card_index: i32, out_ptr: *[5]f64) void {
    var cfg: world_state.ResolvedFireConfig = undefined;
    resolve_build_test(card_index, &cfg);
    const e = emissionFromConfig(&cfg);
    out_ptr[0] = @floatFromInt(e.volley_count);
    out_ptr[1] = e.damage_per_shard;
    out_ptr[2] = e.speed;
    out_ptr[3] = e.radius_px;
    out_ptr[4] = e.impact_radius_px;
}

/// Parity-test export: resolve base (index<0) or base+cards[index] into `out`.
/// Class-blind (mirrors createWeaponBuild with classId omitted).
pub export fn resolve_build_test(card_index: i32, out_ptr: *world_state.ResolvedFireConfig) void {
    if (card_index < 0) {
        out_ptr.* = resolveBuild(&.{}, null);
    } else {
        const one = [_][]const u8{gen.cards[@intCast(card_index)].id};
        out_ptr.* = resolveBuild(&one, null);
    }
}

/// Parity-test export: class-AWARE resolve of base (index<0) or
/// base+cards[index]. `class_idx` indexes gen.ClassId (0=wizard, 1=ninja,
/// 2=paladin, 3=priest); any other value = class-blind, same as
/// resolve_build_test. Added for THE GEOMETRICIAN RULING (2026-07-24) so
/// weaponBuildParity.test.ts can walk every card as wizard and prove the
/// wizard-forces-raycast rule resolves byte-identically on both sides.
pub export fn resolve_build_test_class(
    card_index: i32,
    class_idx: u32,
    out_ptr: *world_state.ResolvedFireConfig,
) void {
    const cls: ?gen.ClassId = if (class_idx < 4) @enumFromInt(class_idx) else null;
    if (card_index < 0) {
        out_ptr.* = resolveBuild(&.{}, cls);
    } else {
        const one = [_][]const u8{gen.cards[@intCast(card_index)].id};
        out_ptr.* = resolveBuild(&one, cls);
    }
}

pub export fn resolve_build_card_count() u32 {
    return gen.cards.len;
}

/// Host entry: resolve player[player_index]'s build from `count` card indices
/// (into cards_gen.cards) and write it into state.player_fire_config[i]. Replaces
/// the TS host-side writeFireConfigs — the build LOGIC now lives in Zig.
pub export fn resolve_player_fire_config(
    state_ptr: *world_state.WorldState,
    player_index: u32,
    indices_ptr: [*]const u8,
    count: u32,
) void {
    if (player_index >= world_state.MAX_PLAYERS) return;
    const n = @min(count, @as(u32, world_state.MAX_PLAYER_CARDS));
    // Class derived from the player's own character_id (no ABI change) —
    // THE GEOMETRICIAN RULING needs the resolver to know when the player is
    // a wizard; every other class resolves exactly as before (the class
    // only gates the wizard delivery rule, nothing else — Zig carries no
    // classModifiers data, see gen_card_data.ts).
    const cls = classForArchetype(state_ptr.players[player_index].character_id);
    state_ptr.player_fire_config[player_index] = resolveByIndices(indices_ptr[0..n], cls);
}

/// Host entry (Track Z1b — finding (b) of multiSeedDivergence's Z1a
/// header): superset of `resolve_player_fire_config` that re-establishes
/// the player's WHOLE build-resolved loadout from one ordered-hand
/// delivery — fire config, `player_card_ids`, `card_count`, AND the
/// `EquippedActives` rack. The full-sync hosts repack the entire
/// WorldState buffer every tick, zero-filling all three parallel arrays;
/// before this export the rack was therefore stripped EVERY tick, so no
/// ability was castable at all on the live wasm path (`stepAbilityDispatch`
/// read `ABILITY_KIND_NONE` in every slot), and `draft.zig`'s
/// uniqueness/maxStacks/rack-cap gates read a zeroed hand.
///
/// All of this is BUILD-RESOLVED data (ResolvedFireConfig's own category
/// per `EquippedActives`'s doc comment — "host resolves [X] from cards,
/// patches it into wasm memory each tick; step_world only READS it"), so
/// the fix is host re-delivery after every pack, NOT a pack/unpack
/// carrier: TS's own orchestrator re-derives `build.actives` from
/// `player.cards` every tick the same way (`resolvePlayerBuild`).
///
/// Rack derivation walks the ordered hand front to back, filling slots
/// with each ability card's kind, capped at MAX_ABILITY_SLOTS — the
/// from-scratch equivalent of `draft.applyCardPick`'s write-into-first-
/// empty-slot (equivalent because nothing ever removes or reorders a
/// card; see that function's own equivalence proof), and the mirror of
/// TS `createWeaponBuild`'s `build.actives.push(...)` walk.
pub export fn resolve_player_loadout(
    state_ptr: *world_state.WorldState,
    player_index: u32,
    indices_ptr: [*]const u8,
    count: u32,
) void {
    if (player_index >= world_state.MAX_PLAYERS) return;
    const n = @min(count, @as(u32, world_state.MAX_PLAYER_CARDS));

    const hand = &state_ptr.player_card_ids[player_index];
    hand.* = .{};
    var i: u32 = 0;
    while (i < n) : (i += 1) hand.indices[i] = indices_ptr[i];
    // Keep the Zig-side hand self-consistent: card_count arrives packed as
    // `cards.length`, but if the host's index mapping dropped an unknown
    // id, an unshrunk count would make draft.zig's ownsCard/copiesOfCard
    // read stale zero slots as "owns card 0".
    state_ptr.players[player_index].card_count = @intCast(n);

    const equipped = &state_ptr.player_equipped_actives[player_index];
    equipped.* = .{};
    var filled: usize = 0;
    i = 0;
    while (i < n and filled < world_state.MAX_ABILITY_SLOTS) : (i += 1) {
        const idx = hand.indices[i];
        if (idx >= gen.cards.len) continue;
        if (gen.cards[idx].meta.active) |active| {
            equipped.slot_kind[filled] = @intFromEnum(active.kind) + 1;
            filled += 1;
        }
    }

    const cls = classForArchetype(state_ptr.players[player_index].character_id);
    state_ptr.player_fire_config[player_index] = resolveByIndices(indices_ptr[0..n], cls);
}

// ── Ability-cast dispatch support (Phase 1, docs/zig-step-world-parity-
//    goal.md) ─────────────────────────────────────────────────────────

/// Reverse lookup: `AbilityKind` → its owning card's `CardActive`
/// (cooldown_ms + optional duration_ms). Ability-cast dispatch (world.zig)
/// knows WHICH kind is equipped in a slot (via
/// `world_state.EquippedActives`, a raw `u8` cast back to `AbilityKind` at
/// the one call site that needs it) but needs the cooldown to gate
/// re-presses — this is the "go from AbilityKind back to the owning card's
/// CardMeta" helper the goal doc's own Phase 1 section flags as possibly
/// needed. Every one of the 45 `AbilityKind` values corresponds to exactly
/// one card with `meta.active.kind == kind` (cards_gen.zig's 45 ability
/// cards are 1:1 with the enum — see cards_gen's own "AbilityKind has
/// exactly 45 members" test) so a linear scan over `gen.cards` (104
/// entries) always finds a match for a real value; `null` only for a
/// (theoretically unreachable, given the enum is exhaustively generated
/// from the same 45 cards) value with no owning card. Lives here, not in
/// cards_gen.zig, because that file is GENERATED (its own header: "DO NOT
/// EDIT") — this is genuinely hand-written logic over the generated data,
/// same relationship `resolveMods` already has to `gen.cards`.
pub fn cardActiveForKind(kind: gen.AbilityKind) ?gen.CardActive {
    for (gen.cards) |c| {
        if (c.meta.active) |a| {
            if (a.kind == kind) return a;
        }
    }
    return null;
}
