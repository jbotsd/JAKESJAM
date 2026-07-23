//! Combat math primitives — bit-exact port of the kernel ops in
//! `client/src/sim/combat.ts`. Phase F1d (ADR-0006).
//!
//! Scope: parry-arc cosine check, shield drain/recharge math, angle
//! wrap helper. The orchestration (state-machine for parry timing,
//! deflection event emission) stays TS-side — those are control
//! flow + entity bookkeeping, not float math.

const std = @import("std");
const trig = @import("trig.zig");
const world_state = @import("world_state.zig");
const collision = @import("collision.zig");

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;

// Phase H4 — combat orchestration constants. Mirror
// `client/src/sim/combat.ts` exactly. Bit-exact bumps require
// parity-test updates on both sides.
pub const PARRY_ACTIVE_MS: f64 = 420.0;
pub const PARRY_COOLDOWN_MS_DEFAULT: f64 = 1800.0;
pub const SHIELD_MAX_CHARGE_DEFAULT: f64 = 100.0;
pub const SHIELD_DRAIN_PER_SECOND: f64 = 35.0;
pub const SHIELD_RECHARGE_PER_SECOND: f64 = 14.0;
pub const SHIELD_HIT_DRAIN_MULTIPLIER: f64 = 1.8;

/// Ghost Guard (Ninja, Phase 4a follow-up, docs/zig-step-world-parity-
/// goal.md) — "if moving" gate on the banked evasion charge: the VICTIM's
/// own current velocity magnitude at hit time (not cast time) must clear
/// this threshold. Mirrors `combat.ts`'s `NINJA_GHOST_GUARD_MOVE_SPEED_
/// THRESHOLD = 60` exactly.
pub const NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD: f64 = 60.0;

// Input bit layout — mirrors client/src/net/protocol.ts InputBit.
const InputBit = struct {
    pub const ability: u32 = 1 << 7;
    pub const shield: u32 = 1 << 8;
};

/// Parry arc — full angular width within which incoming shards
/// can be deflected. Mirrors `combat.ts` `PARRY_ARC_RADIANS = π/3`.
pub const PARRY_ARC_RADIANS: f64 = PI / 3.0;

/// Wrap an angle into [-π, π). Matches `combat.ts` `wrapAngle`.
pub fn wrapAngle(angle: f64) f64 {
    var a = angle;
    while (a < -PI) a += TWO_PI;
    while (a >= PI) a -= TWO_PI;
    return a;
}

/// True if a projectile incoming from `(proj_x, proj_y)` (with
/// fallback velocity `(proj_vx, proj_vy)` when the projectile is
/// at the player center) lies within the parry arc centered on
/// `facing`.
///
/// Bit-exact port of `combat.ts` `isHitInParryArc`. Uses the
/// comptime LUT for atan2.
pub fn isHitInParryArc(
    player_x: f64,
    player_y: f64,
    facing: f64,
    proj_x: f64,
    proj_y: f64,
    proj_vx: f64,
    proj_vy: f64,
) bool {
    return isHitInArc(player_x, player_y, facing, proj_x, proj_y, proj_vx, proj_vy, PARRY_ARC_RADIANS);
}

/// Aim-shield cone: mirrors `combat.ts` `SHIELD_AIM_ARC_RADIANS = 2π/3`.
pub const SHIELD_AIM_ARC_RADIANS: f64 = (2.0 * PI) / 3.0;

/// Parameterized arc test — TS `isHitInParryArc(player, facing, proj, arc)`
/// passes a variable arc (parry cover mult widens it; the aim shield uses the
/// wider SHIELD_AIM_ARC). `arc_radians` is the FULL arc; covered when the
/// source direction is within ±arc/2 of `facing`.
pub fn isHitInArc(
    player_x: f64,
    player_y: f64,
    facing: f64,
    proj_x: f64,
    proj_y: f64,
    proj_vx: f64,
    proj_vy: f64,
    arc_radians: f64,
) bool {
    const dx = proj_x - player_x;
    const dy = proj_y - player_y;
    const source_angle = if (dx == 0.0 and dy == 0.0)
        trig.lutAtan2(-proj_vy, -proj_vx)
    else
        trig.lutAtan2(dy, dx);
    const delta = wrapAngle(source_angle - facing);
    return @abs(delta) <= arc_radians / 2.0;
}

/// Shield drain over a tick: `dps * (dt_ms / 1000)`. Pure float
/// arithmetic; identical bits across IEEE 754 hosts.
pub fn shieldDrain(drain_per_second: f64, dt_ms: f64) f64 {
    return drain_per_second * (dt_ms / 1000.0);
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn combat_wrap_angle(angle: f64) f64 {
    return wrapAngle(angle);
}

pub export fn combat_is_hit_in_parry_arc(
    player_x: f64,
    player_y: f64,
    facing: f64,
    proj_x: f64,
    proj_y: f64,
    proj_vx: f64,
    proj_vy: f64,
) i32 {
    return if (isHitInParryArc(player_x, player_y, facing, proj_x, proj_y, proj_vx, proj_vy)) 1 else 0;
}

pub export fn combat_shield_drain(drain_per_second: f64, dt_ms: f64) f64 {
    return shieldDrain(drain_per_second, dt_ms);
}

pub export fn combat_parry_arc_radians() f64 {
    return PARRY_ARC_RADIANS;
}

// =================================================================
// Phase H4 — orchestration helpers operating on PlayerEntity from
// the WorldState extern struct. These are the smallest pieces of
// the TS combat orchestrator that can be lifted without dragging
// in the events bus or the projectile array. The Phase I
// orchestrator wires them into per-tick player iteration.

/// Try to start a parry. Mirrors `tryStartParry` in
/// client/src/sim/combat.ts. Returns 1 if a parry started this
/// tick (caller can read the new parryActiveUntilTick /
/// parryCooldownUntilTick / parryFacing fields), 0 otherwise.
///
/// Mutation: when started, sets has_parry_active +
/// has_parry_cooldown + has_parry_facing flags + the
/// corresponding tick / facing values.
pub fn tryStartParry(
    player: *world_state.PlayerEntity,
    curr_keys: u32,
    prev_keys: u32,
    tick: u32,
    dt_ms: f64,
    active_ms: f64,
    cooldown_ms: f64,
) bool {
    if (!player.flags.alive) return false;

    const pressed = (curr_keys & InputBit.ability) != 0;
    const was_pressed = (prev_keys & InputBit.ability) != 0;
    if (!pressed or was_pressed) return false;

    const cooldown_until: u32 =
        if (player.flags.has_parry_cooldown) player.parry_cooldown_until_tick else 0;
    if (cooldown_until > tick) return false;

    const dt: f64 = if (dt_ms > 0) dt_ms else 1.0;
    const active_ticks_f = @ceil(active_ms / dt);
    const cooldown_ticks_f = @ceil(cooldown_ms / dt);
    const active_ticks: u32 = @max(1, @as(u32, @intFromFloat(active_ticks_f)));
    const cooldown_ticks: u32 = @max(1, @as(u32, @intFromFloat(cooldown_ticks_f)));

    // Capture aim direction (radians) at trigger time. Same
    // dx==0 && dy==0 → 0 fallback as TS.
    const dx = player.aim_x - player.x;
    const dy = player.aim_y - player.y;
    const facing: f64 = if (dx == 0.0 and dy == 0.0)
        0.0
    else
        trig.lutAtan2(dy, dx);

    player.parry_active_until_tick = tick + active_ticks;
    player.parry_cooldown_until_tick = tick + cooldown_ticks;
    player.parry_facing = facing;
    player.flags.has_parry_active = true;
    player.flags.has_parry_cooldown = true;
    player.flags.has_parry_facing = true;
    return true;
}

pub export fn combat_try_start_parry(
    player_ptr: *world_state.PlayerEntity,
    curr_keys: u32,
    prev_keys: u32,
    tick: u32,
    dt_ms: f64,
    active_ms: f64,
    cooldown_ms: f64,
) i32 {
    return if (tryStartParry(
        player_ptr,
        curr_keys,
        prev_keys,
        tick,
        dt_ms,
        active_ms,
        cooldown_ms,
    )) 1 else 0;
}

/// True if the player has an active parry window covering this
/// tick. Mirrors `isParryActive` in TS.
pub fn isParryActive(player: *const world_state.PlayerEntity, tick: u32) bool {
    return player.flags.has_parry_active and
        player.parry_active_until_tick > tick;
}

pub export fn combat_is_parry_active(
    player_ptr: *const world_state.PlayerEntity,
    tick: u32,
) i32 {
    return if (isParryActive(player_ptr, tick)) 1 else 0;
}

/// Held-shield update: drain while held + charge available;
/// otherwise deactivate and recharge toward `max_charge`.
/// Mirrors `tickShield` in TS bit-exact. Mutates `player` in
/// place.
pub fn tickShield(
    player: *world_state.PlayerEntity,
    curr_keys: u32,
    dt_ms: f64,
    max_charge_override: f64,
    drain_per_second: f64,
    recharge_per_second: f64,
) void {
    if (!player.flags.alive) {
        if (player.flags.shield_active) player.flags.shield_active = false;
        return;
    }
    const dt_sec = dt_ms / 1000.0;
    const max_charge: f64 = blk: {
        if (max_charge_override > 0) break :blk max_charge_override;
        if (player.flags.has_shield_charge) {
            break :blk player.shield_max_charge;
        }
        break :blk SHIELD_MAX_CHARGE_DEFAULT;
    };

    const current_charge: f64 = if (player.flags.has_shield_charge)
        player.shield_charge
    else
        max_charge;

    const wants_shield = (curr_keys & InputBit.shield) != 0;
    if (wants_shield and current_charge > 0) {
        const drained = @max(0.0, current_charge - drain_per_second * dt_sec);
        player.shield_charge = drained;
        player.shield_max_charge = max_charge;
        player.flags.has_shield_charge = true;
        player.flags.shield_active = drained > 0;
        return;
    }

    const recharged = @min(max_charge, current_charge + recharge_per_second * dt_sec);
    player.shield_charge = recharged;
    player.shield_max_charge = max_charge;
    player.flags.has_shield_charge = true;
    player.flags.shield_active = false;
}

pub export fn combat_tick_shield(
    player_ptr: *world_state.PlayerEntity,
    curr_keys: u32,
    dt_ms: f64,
    max_charge_override: f64,
    drain_per_second: f64,
    recharge_per_second: f64,
) void {
    tickShield(
        player_ptr,
        curr_keys,
        dt_ms,
        max_charge_override,
        drain_per_second,
        recharge_per_second,
    );
}

pub export fn combat_parry_active_ms() f64 {
    return PARRY_ACTIVE_MS;
}

pub export fn combat_parry_cooldown_ms_default() f64 {
    return PARRY_COOLDOWN_MS_DEFAULT;
}

pub export fn combat_shield_max_charge_default() f64 {
    return SHIELD_MAX_CHARGE_DEFAULT;
}

pub export fn combat_shield_drain_per_second() f64 {
    return SHIELD_DRAIN_PER_SECOND;
}

pub export fn combat_shield_recharge_per_second() f64 {
    return SHIELD_RECHARGE_PER_SECOND;
}

// =================================================================
// Melee arc-containment primitive (2026-07-20, base-melee-mechanic
// gap-closure pass — Ninja Slash + Paladin Kindled Edge). Bit-exact port
// of `isAABBInMeleeArc`/`playerHitboxAABB` in client/src/sim/World.ts:
// 686-734 and client/src/sim/player.ts:105-113. Lives in combat.zig (not
// world.zig) because it's a pure geometry primitive in the same family as
// `isHitInArc` immediately above — the melee FSM orchestration itself
// (swing phase/timing/hit application) lives in world.zig's new melee
// step section, mirroring the existing split between this file (math
// primitives) and world.zig (per-tick orchestration).

/// Real player body box — bodyWidth × crouch-aware bodyHeight, centred on
/// (x, y). Mirrors `player.ts`'s `M.bodyWidth`/`M.bodyHeight`/
/// `M.crouchHeight` constants exactly (26 × 56, 38 crouched). NOT the same
/// as world.zig section 4's projectile-hit box (a fixed 30×56
/// approximation, non-crouch-aware) — that's a pre-existing simplification
/// in the projectile path, left untouched by this melee-only port. Melee's
/// own arc-check uses the REAL hitbox because World.ts's own
/// `isBodyInMeleeArc` doc comment calls this out explicitly ("sample the
/// victim's real crouch-aware hitbox").
pub const MELEE_BODY_WIDTH: f64 = 26.0;
pub const MELEE_BODY_HEIGHT: f64 = 56.0;
pub const MELEE_BODY_CROUCH_HEIGHT: f64 = 38.0;

/// Class hitbox scaling (Track Z1a item 2 — mirror of cohesion-goal.md
/// P1.4, player.ts's CLASS_HITBOX_SCALE_ENABLED, flipped on 2026-07-23):
/// COMBAT hitboxes scale by the chassis sizeScale so Kindled is a
/// genuinely bigger target and Interstice genuinely smaller, matching the
/// rendered silhouette. Mirror of player.ts's flag — the TS side
/// documents "flip to `false` to revert the whole gameplay change with
/// one line"; if that ever happens, THIS line is the Zig half of the
/// revert (combatHitboxScaleParity.test.ts pins the two behaviors to
/// each other).
///
/// Deliberately scoped to COMBAT only, exactly like TS: the MOVEMENT
/// collision box (player.zig's own body constants, walls/platforms)
/// stays uniform across classes so traversal stays class-fair and
/// platforming parity is untouched — do NOT thread this scale into
/// player.zig.
pub const CLASS_HITBOX_SCALE_ENABLED: bool = true;

/// Per-chassis combat hitbox scale — the sizeScale column of
/// cardTypes.ts's CHASSIS_STATS, keyed by archetype exactly like
/// world.zig's baseMaxHealthForArchetype / recoilControlForArchetype
/// mirrors of the same table (the established "tiny switch on
/// character_id" pattern for chassis stats).
pub fn combatHitboxScale(archetype: world_state.CharacterArchetype) f64 {
    if (!CLASS_HITBOX_SCALE_ENABLED) return 1.0;
    return switch (archetype) {
        .heavy => 1.18, // Kindled (paladin)
        .sprinter => 0.92, // Interstice (ninja)
        .shielded => 1.05, // Syzygist (priest)
        .balanced => 1.0, // Geometrician (wizard) — home base, byte-identical
    };
}

/// Wasm pin for the scale table (Track Z1a item 2) —
/// combatHitboxScaleParity.test.ts asserts this against cardTypes.ts's
/// CHASSIS_STATS sizeScale for all four archetypes, same "constants match
/// TS pinned values" contract as the combat_parry_*/combat_shield_*
/// exports above. `archetype` is the CharacterArchetype enum(u8) ordinal
/// (balanced 0, heavy 1, sprinter 2, shielded 3 — the bridge's
/// CHARACTER_ARCHETYPES order); callers must pass a valid ordinal.
pub export fn combat_hitbox_scale(archetype: u8) f64 {
    return combatHitboxScale(@enumFromInt(archetype));
}

/// Combat body box, class-scaled (Track Z1a item 2 — parity with
/// player.ts's playerHitboxAABB, which scales width AND height by the
/// chassis sizeScale, centred on the same (x, y)).
pub fn playerHitboxAabb(
    x: f64,
    y: f64,
    crouching: bool,
    archetype: world_state.CharacterArchetype,
) collision.AABB {
    const s = combatHitboxScale(archetype);
    const h: f64 = (if (crouching) MELEE_BODY_CROUCH_HEIGHT else MELEE_BODY_HEIGHT) * s;
    const w: f64 = MELEE_BODY_WIDTH * s;
    return .{
        .x = x - w / 2.0,
        .y = y - h / 2.0,
        .w = w,
        .h = h,
    };
}

/// Melee arc hit test — bit-exact port of World.ts's `isAABBInMeleeArc`
/// (World.ts:707-734): sample the victim's AABB at its centre + 4 corners,
/// hit if ANY sampled point is within `range` of `(origin_x, origin_y)` AND
/// within `half_arc` of `aim_angle`. `half_arc` is HALF the full cone width
/// — callers pass e.g. `SLASH_ARC_RADIANS / 2`, matching the TS source's
/// own `halfArc` parameter naming exactly. This is a DIFFERENT convention
/// from `isHitInArc` above (whose `arc_radians` param IS the full width) —
/// deliberately kept as a literal, checkable port of the TS source rather
/// than harmonized with this file's own parry-arc convention.
pub fn isBodyInMeleeArc(
    origin_x: f64,
    origin_y: f64,
    aim_angle: f64,
    half_arc: f64,
    range: f64,
    center_x: f64,
    center_y: f64,
    box: collision.AABB,
) bool {
    const points = [5][2]f64{
        .{ center_x, center_y },
        .{ box.x, box.y },
        .{ box.x + box.w, box.y },
        .{ box.x, box.y + box.h },
        .{ box.x + box.w, box.y + box.h },
    };
    for (points) |p| {
        const dx = p[0] - origin_x;
        const dy = p[1] - origin_y;
        const dist = @sqrt(dx * dx + dy * dy);
        if (dist > range or dist < 1e-3) continue;
        const da = wrapAngle(trig.lutAtan2(dy, dx) - aim_angle);
        if (@abs(da) <= half_arc) return true;
    }
    return false;
}
