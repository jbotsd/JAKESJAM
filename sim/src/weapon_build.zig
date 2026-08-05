//! In-sim card build resolution — mirrors client/src/sim/data/weaponBuild.ts
//! createWeaponBuild + applyCard + clampBuild, and the packResolvedFireConfig
//! mapping into ResolvedFireConfig. Card data comes from the generated
//! cards_gen.zig (single source: cards.ts). This lets the Zig orchestrator
//! resolve builds itself instead of the host writing them each tick.

const std = @import("std");
const gen = @import("data/cards_gen.zig");
const world_state = @import("world_state.zig");

fn round2(v: f64) f64 {
    return @round(v * 100.0) / 100.0;
}

// ── True merge semantics (Track E1 classModifiers port) ──────────────────
// weaponBuild.ts's mergeProjectileModifier / applyCard don't last-write
// categorical identities or scalar sets — they rank-prefer, max, min, or
// orthogonally blend. The old direct-set folds here were only ever
// exercised from the class-blind starter base, whose values are the
// weakest in every dimension (element crystal, pathing straight, impact
// none, count 1, spread 0.03, homing 0), so "incoming wins" coincided
// with TS on every single-card parity walk. The class-gated bases break
// that coincidence (priest: element fire, pathing homing rank 5, count 3,
// spread 0.45; paladin: sizeMultiplier 1.15), and multi-card hands always
// could — so the real semantics are ported 1:1 below.

/// weaponBuild.ts PATHING_RANK, by pathing enum index (0=straight ..
/// 7=accelerate; 5=anti-homing is unlisted in TS and falls back to 0 via
/// `?? 0`). Shared by preferPathing and the delivery-feel branches.
const PATHING_RANK = [8]u8{ 0, 3, 1, 2, 5, 0, 4, 1 };

/// weaponBuild.ts WEAK_SHAPES ("default starter shapes — safe to
/// overwrite"): circle (0) and hexagon (3), by shape enum index.
const WEAK_SHAPE = [7]bool{ true, false, false, true, false, false, false };

/// weaponBuild.ts ELEMENT_RANK by element enum index (crystal, neutral,
/// fire, ice, lightning, void, radiant, electric, toxic, sticky,
/// explosive). electric/toxic are unlisted in TS (`?? 0`).
const ELEMENT_RANK = [11]u8{ 1, 0, 3, 3, 3, 4, 4, 0, 0, 2, 2 };

/// weaponBuild.ts IMPACT_RANK by impact enum index (none, explosive,
/// sticky, pierce-chain, slow-field).
const IMPACT_RANK = [5]u8{ 0, 4, 2, 3, 1 };

fn preferShape(current: u8, incoming: u8) u8 {
    const cw = WEAK_SHAPE[current];
    const iw = WEAK_SHAPE[incoming];
    if (cw and !iw) return incoming;
    if (iw and !cw) return current;
    if (current == incoming) return current;
    if (cw) return incoming;
    return current;
}

fn preferPathing(current: u8, incoming: u8) u8 {
    return if (PATHING_RANK[incoming] >= PATHING_RANK[current]) incoming else current;
}

fn preferElement(current: u8, incoming: u8) u8 {
    if (incoming == 1) return current; // neutral never overwrites
    if (current == 1) return incoming;
    return if (ELEMENT_RANK[incoming] > ELEMENT_RANK[current]) incoming else current;
}

fn preferImpact(current: u8, incoming: u8) u8 {
    return if (IMPACT_RANK[incoming] >= IMPACT_RANK[current]) incoming else current;
}

/// weaponBuild.ts orthogonalScale: same-direction factors multiply;
/// mixed grow/shrink log-blend (stronger |log| at 1.0, weaker at 0.55) so
/// opposing cards don't cancel to mush. @log/@exp here vs JS Math.log/exp
/// may differ in the last ULP on the (rare) mixed branch — recorded
/// tolerance-level residual, vs. the plain product's guaranteed wrongness.
fn orthogonalScale(current: f64, incoming: f64) f64 {
    if (incoming == 1) return current;
    if (current == 1) return incoming;
    const cur_grow = current >= 1;
    const in_grow = incoming >= 1;
    if (cur_grow == in_grow) return current * incoming;
    const a = @log(@max(1e-6, current));
    const b = @log(@max(1e-6, incoming));
    const abs_a = @abs(a);
    const abs_b = @abs(b);
    const w_a: f64 = if (abs_a >= abs_b) 1 else 0.55;
    const w_b: f64 = if (abs_b > abs_a) 1 else 0.55;
    return @exp(a * w_a + b * w_b);
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
        // Track E1 classModifiers port: pick the EFFECTIVE mod for this
        // class (the card's wholesale per-class override when authored,
        // else the class-blind mod) — mirrors weaponBuild.ts's
        // `effectiveCardModifier` at the exact same point in the pipeline
        // (per card, before any folding).
        for (&gen.cards) |*c| {
            if (std.mem.eql(u8, c.id, id)) {
                buf[n] = gen.effectiveCardMod(c, class_id);
                n += 1;
                break;
            }
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
            // Same effective-mod selection as resolveBuild above (Track E1).
            buf[n] = gen.effectiveCardMod(&gen.cards[idx], class_id);
            n += 1;
        }
    }
    return resolveMods(buf[0..n], class_id);
}

fn resolveMods(mods: []const gen.CardMod, class_id: ?gen.ClassId) world_state.ResolvedFireConfig {
    // Track E1 classModifiers port: the WHOLE base weapon is class-gated
    // now, mirroring weapons.ts's `baseWeaponForClass` (priest's tendril
    // rework / paladin's heavier bolt; wizard/ninja/class-blind share
    // `starter_base`). This closes the old "per-class starter STAT
    // overrides remain an unported, recorded gap" residual — the previous
    // `base_delivery` class switch here covered ONLY the delivery seed;
    // the per-class literals in cards_gen.zig carry it inside `.delivery`.
    const base = gen.baseWeaponForClass(class_id);
    var damage = base.damage;
    var fire_rate = base.fire_rate;
    var projectile_speed = base.projectile_speed;
    var spread = base.spread_radians;
    // Recoil (Track Z0c Item A): two independent channels, exactly like
    // weaponBuild.ts — the build-level impulse (base × top-level card
    // recoilMultiplier, :278) and the per-projectile multiplier (:428).
    var recoil_impulse = base.recoil_impulse;
    var p_recoil_mul = base.p_recoil_mul;
    var max_health_add: f64 = 0;
    // Passive Tithe leech (Track E1 classModifiers port) — applyCard's
    // max-fold (weaponBuild.ts:361, "cap, don't stack unboundedly"),
    // clamped + rounded below exactly like clampBuild's tail. Replaces
    // the host-side patchLeechFraction stopgap (fireConfigShared.ts,
    // retired).
    var leech: f64 = 0;
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
    // 3=area-pulse) — seeded from the class-gated BASE weapon's own
    // delivery (Track Z1c item 1, now via `base.delivery` itself: priest/
    // paladin literals carry the explicit "projectile" override — "homing
    // tendrils need real travel time to curve in" — while wizard/ninja/
    // class-blind share starter_base's raycast, true hitscan 2026-07-20).
    // Mirrors weaponBuild.ts's applyCard delivery merge exactly: a card's
    // delivery only overrides while the CURRENT value still equals the
    // untouched base default — once a card has upgraded it away, a later
    // "projectile" (0) card never stomps that upgrade. See applyCard's own
    // `baseDelivery` param doc comment for the full reasoning.
    const base_delivery: u8 = base.delivery;
    var delivery: u8 = base_delivery;

    var p_shape: u8 = base.p_shape;
    var p_element: u8 = base.p_element;
    var p_pathing: u8 = base.p_pathing;
    var p_impact: u8 = base.p_impact;
    var p_count = base.p_count;
    var p_range = base.p_range_px;
    var p_speed_mul = base.p_speed_mul;
    var p_size_mul = base.p_size_mul;
    var p_lifetime_mul = base.p_lifetime_mul;
    var p_gravity_scale = base.p_gravity_scale;
    var p_homing = base.p_homing_strength;
    var p_accel_mul = base.p_acceleration_mul;
    var p_bounces = base.p_bounces;
    var p_impact_radius = base.p_impact_radius;
    var p_pierce = base.p_pierce_count;
    var p_split = base.p_split_count;
    var p_slow = base.p_slow_mul;

    for (mods) |m| {
        if (m.delivery) |d| {
            if (delivery == base_delivery or d != 0) delivery = d;
        }
        damage *= m.damage_mul;
        fire_rate *= m.fire_rate_mul;
        recoil_impulse *= m.recoil_mul;
        projectile_speed *= m.projectile_speed_mul;
        max_health_add += m.max_health_add;
        leech = @max(leech, m.leech_fraction);
        // moveSpeed/gravity accumulate via orthogonalScale in TS
        // (applyCard:328-341) — mixed grow/shrink stacks must not cancel.
        move_speed_mul = orthogonalScale(move_speed_mul, m.move_speed_mul);
        parry_cover_mul *= m.parry_cover_mul;
        parry_cooldown_mul *= m.parry_cooldown_mul;
        gravity_mul = orthogonalScale(gravity_mul, m.gravity_mul);
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
        // Spread: never shrink a prior wide fan with a later absolute set
        // (applyCard:364-367).
        if (m.spread_radians_set) |s| spread = @max(spread, s);
        spread += m.spread_radians_add;
        // Projectile merge — mergeProjectileModifier's real semantics
        // (prefer/max/min/extreme/direct per field, see that function's own
        // doc comment), then the top-level adds, then the cosmetic bump
        // channel (ensureVisibleCardSignature — plain multiply + direct
        // shape overwrite, runs LAST in applyCard, same order here).
        if (m.proj_shape) |v| p_shape = preferShape(p_shape, v);
        if (m.proj_element) |v| p_element = preferElement(p_element, v);
        if (m.proj_pathing) |v| p_pathing = preferPathing(p_pathing, v);
        if (m.proj_impact) |v| p_impact = preferImpact(p_impact, v);
        if (m.proj_count_set) |v| p_count = @max(p_count, v);
        if (m.proj_range_px_set) |v| p_range = v; // direct: a set may be a nerf
        if (m.proj_gravity_scale_set) |v| {
            // Keep the more extreme |g| away from 0 when both set.
            if (@abs(v) >= @abs(p_gravity_scale)) p_gravity_scale = v;
        }
        if (m.proj_homing_strength_set) |v| p_homing = @max(p_homing, v);
        if (m.proj_acceleration_mul_set) |v| p_accel_mul = v; // direct (i-rounds ruling)
        if (m.proj_bounces_set) |v| p_bounces = @max(p_bounces, v);
        if (m.proj_impact_radius_set) |v| p_impact_radius = @max(p_impact_radius, v);
        if (m.proj_pierce_count_set) |v| p_pierce = @max(p_pierce, v);
        if (m.proj_split_count_set) |v| p_split = @max(p_split, v);
        // Slow: lower multiplier = stronger slow — keep the stronger one.
        if (m.proj_slow_mul_set) |v| p_slow = @min(p_slow, v);
        p_speed_mul = orthogonalScale(p_speed_mul, m.proj_speed_mul);
        p_size_mul = orthogonalScale(p_size_mul, m.proj_size_mul);
        p_recoil_mul *= m.proj_recoil_mul;
        p_lifetime_mul = orthogonalScale(p_lifetime_mul, m.proj_lifetime_mul);
        p_count += m.proj_count_add;
        p_bounces += m.proj_bounce_add;
        p_split += m.proj_split_add;
        p_homing += m.proj_homing_add;
        // Visible-signature bump (plain channel — see CardMod's own
        // proj_*_bump doc comments; exactly one channel live per card).
        p_speed_mul *= m.proj_speed_bump;
        p_size_mul *= m.proj_size_bump;
        if (m.proj_shape_bump) |v| p_shape = v;
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
    // PATHING_RANK is the file-scope table now (Track E1 true-merge port —
    // preferPathing shares it); its i-rounds/accelerate history lives on
    // the table's own doc comment.
    if (delivery == 1) { // raycast
        p_count = @max(1.0, p_count);
        if (PATHING_RANK[p_pathing] == 0) p_pathing = 0; // → "straight"
        p_speed_mul = @max(p_speed_mul, 3.2);
        p_lifetime_mul = @min(p_lifetime_mul, 0.35);
        p_range = @max(p_range, 880.0);
        if (p_gravity_scale == 0 or p_pathing == 0) p_gravity_scale = 0;
        p_size_mul = @max(0.55, p_size_mul);
    } else if (delivery == 2) { // continuous-beam
        if (PATHING_RANK[p_pathing] == 0) p_pathing = 0;
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
    const pls = round2(@max(0.1, base.projectile_lifetime_seconds));
    spread = @max(0.0, spread);
    max_health_add = @max(0.0, @round(max_health_add));
    // clampBuild:705 — cap so no stack of leech sources can out-leech the
    // timed ability's own cap, then round to 3dp (roundTo(x, 3)).
    leech = @round(@max(0.0, @min(0.5, leech)) * 1000.0) / 1000.0;
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
        .leech_fraction = @floatCast(leech),
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
    // Class derived from the player's own character_id (no ABI change).
    // The class gates the wizard delivery rule, the per-class starter base
    // (gen.baseWeaponForClass), and each card's effective mod
    // (gen.effectiveCardMod — the Track E1 classModifiers port).
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
