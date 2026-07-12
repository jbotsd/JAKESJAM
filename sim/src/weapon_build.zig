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

/// Resolve starter-base + `card_ids` → ResolvedFireConfig (valid=1).
pub fn resolveBuild(card_ids: []const []const u8) world_state.ResolvedFireConfig {
    var buf: [world_state.MAX_PLAYER_CARDS]gen.CardMod = undefined;
    var n: usize = 0;
    for (card_ids) |id| {
        if (n >= buf.len) break;
        if (gen.cardMod(id)) |m| {
            buf[n] = m;
            n += 1;
        }
    }
    return resolveMods(buf[0..n]);
}

/// Resolve starter-base + cards named by their index into `cards_gen.cards`.
pub fn resolveByIndices(indices: []const u8) world_state.ResolvedFireConfig {
    var buf: [world_state.MAX_PLAYER_CARDS]gen.CardMod = undefined;
    var n: usize = 0;
    for (indices) |idx| {
        if (n >= buf.len) break;
        if (idx < gen.cards.len) {
            buf[n] = gen.cards[idx].mod;
            n += 1;
        }
    }
    return resolveMods(buf[0..n]);
}

fn resolveMods(mods: []const gen.CardMod) world_state.ResolvedFireConfig {
    var damage = B.damage;
    var fire_rate = B.fire_rate;
    var projectile_speed = B.projectile_speed;
    var spread = B.spread_radians;
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
    // Delivery identity (0=projectile/default, 1=raycast, 2=continuous-beam,
    // 3=area-pulse) — mirrors weaponBuild.ts's applyCard delivery merge:
    // only upgrades from the default; a later "projectile" card never stomps
    // an already-set raycast/beam/pulse identity.
    var delivery: u8 = 0;

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
            if (delivery == 0 or d != 0) delivery = d;
        }
        damage *= m.damage_mul;
        fire_rate *= m.fire_rate_mul;
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
        p_lifetime_mul *= m.proj_lifetime_mul;
        p_count += m.proj_count_add;
        p_bounces += m.proj_bounce_add;
        p_split += m.proj_split_add;
        p_homing += m.proj_homing_add;
    }

    // applyDeliveryFeel (weaponBuild.ts) — runs BEFORE clampBuild there, same
    // order here. Maps the rare delivery identity onto projectile params so
    // raycast/beam/pulse cards feel distinct without a separate hitscan step.
    // PATHING_RANK, by pathing enum index (0=straight..7=accelerate, see
    // gen_card_data.ts's PATHING array order) — mirrors weaponBuild.ts's
    // PATHING_RANK table exactly; unlisted indices (5=anti-homing,
    // 7=accelerate) fall back to rank 0 same as TS's `?? 0`.
    const pathing_rank = [8]u8{ 0, 3, 1, 2, 5, 0, 4, 0 };
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
    };
}

pub const card_count: u32 = gen.cards.len;

/// Parity-test export: resolve base (index<0) or base+cards[index] into `out`.
pub export fn resolve_build_test(card_index: i32, out_ptr: *world_state.ResolvedFireConfig) void {
    if (card_index < 0) {
        out_ptr.* = resolveBuild(&.{});
    } else {
        const one = [_][]const u8{gen.cards[@intCast(card_index)].id};
        out_ptr.* = resolveBuild(&one);
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
    state_ptr.player_fire_config[player_index] = resolveByIndices(indices_ptr[0..n]);
}
