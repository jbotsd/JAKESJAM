//! Phase I1 — step_world orchestrator skeleton.
//!
//! Drives one tick of the simulation by walking the entity arrays
//! in WorldState and dispatching to the per-module H1-H7 helpers
//! in deterministic order:
//!
//!   1. round.step_phase — phase machine
//!   2. fire patches — tick remaining_ms in place
//!   3. destructibles — passive (HP changes happen via projectile
//!                     resolution below)
//!   4. projectiles — pre_step lifecycle (sticky / lifetime expire)
//!                    and per-pair destructible hit resolution
//!   5. satellites — orbit + cooldown
//!   6. combat — per-player tick_shield (parry start handled via
//!               input, not iterated here)
//!
//! Score keeping, drafting transitions, projectile spawning, and
//! events emission stay TS-side via the Phase G2 worldStateBridge
//! for now. Phase I2-I4 lift those into wasm as data tables port.
//!
//! Pure-additive — `step_world` is a NEW export. The legacy `step`
//! no-op stays as the boot smoke. Phase J cuts swap the host's
//! call site from the TS World.step to step_world.

const std = @import("std");
const world_state = @import("world_state.zig");
const round = @import("round.zig");
const projectile = @import("projectile.zig");
const destructible = @import("destructible.zig");
const fire = @import("fire.zig");
const combat = @import("combat.zig");
const chaos = @import("data/chaos.zig");
const collision_types = @import("collision.zig");
const satellite = @import("satellite.zig");
const player_mod = @import("player.zig");
const weapon = @import("weapon.zig");
const weapon_build = @import("weapon_build.zig");
const weapons_data = @import("data/weapons.zig");
const trig = @import("trig.zig");
const gen = @import("data/cards_gen.zig");
const draft = @import("draft.zig");

/// Grace after ALL humans die before the bot-shootout guard ends the round
/// (parity with round.ts NO_HUMAN_SURVIVOR_END_MS). Round resolution
/// itself lives in `detectRoundWinner` below — see its doc comment for the
/// fast-respawn (2026-07-17) semantics.
const NO_HUMAN_SURVIVOR_END_MS: f64 = 6000;

/// Emission Engine charge economy (parity with constants.ts —
/// EMISSION_CHARGE_MAX / EMISSION_FILL_PER_DAMAGE_DEALT /
/// EMISSION_FILL_PER_DAMAGE_TAKEN; docs/emission-engine-goal.md).
/// The TS state hash mixes ability_charge — these must move in
/// lock-step with constants.ts or reconcile hashes diverge.
const EMISSION_CHARGE_MAX: f64 = 100;
const EMISSION_FILL_PER_DAMAGE_DEALT: f64 = 0.5;
const EMISSION_FILL_PER_DAMAGE_TAKEN: f64 = 0.2;
/// Ward shell mitigation (six-axes-goal.md Layer 1, data/emission.ts's
/// EMISSION_WARD_DAMAGE_MULT) — halves incoming RANGED damage while
/// `ward_shell_until_tick > tick` is live on the victim. Consumed at
/// section 4's projectile-vs-player hit resolution ONLY: verified directly
/// against World.ts, not assumed — the multiplier is computed inside
/// `resolveRangedHit` (World.ts:1671-1673), which is called ONLY from the
/// hitscan-hit and real-projectile-hit sites (World.ts:4514/6037), NEVER
/// from the melee (Ninja Slash/Kindled Edge, World.ts's "1z2"/"1z3"
/// sections) or instant-AOE (`resolveInstantAoeCasts`) resolution paths —
/// both of those call `tryDeflectDamage` directly, bypassing
/// `resolveRangedHit`'s wrapper entirely, so ward-shell structurally cannot
/// apply there in TS either. Hard Aperture's own card flavor text ("melee,
/// ability blasts, and burn ticks pass through untouched") is consistent
/// with this: "ability blasts" reads as the AOE-radius abilities (Wall
/// Bloom/Shock Ring/etc, which use the AOE path), not the shard-projectile
/// abilities (Sunspike/Severance/Needle/etc, which travel as real
/// ProjectileEntity instances and DO route through `resolveRangedHit` like
/// any other shot — the flavor text doesn't claim otherwise).
const EMISSION_WARD_DAMAGE_MULT: f64 = 0.5;
/// Burn duration cap (data/emission.ts's EMISSION_BURN_CAP_MS) — TS composes
/// burn duration as `min(3000 * statusScale, EMISSION_BURN_CAP_MS)`; every
/// shard actually spawned in step_world today leaves `statusScale` at TS's
/// own default (1), so `3000 * 1 == EMISSION_BURN_CAP_MS` exactly and the
/// min() is a no-op — this port skips carrying a separate statusScale term
/// (ProjectileEntity.status_scale exists but has zero consumption sites
/// anywhere in this file yet) and just uses the cap value directly.
const EMISSION_BURN_CAP_MS: f64 = 3000.0;

/// Half the player body height (parity with World.ts PLAYER_HALF_HEIGHT).
const PLAYER_HALF_HEIGHT: f64 = 28;

/// Wizard basic-fire ramping channel (2026-07-20 gap-closure pass — parity
/// with constants.ts's GEO_CHANNEL_RAMP_MS / GEO_CHANNEL_RAMP_FIRE_RATE_
/// MULTIPLIER_MAX). Time holding Fire (ms) to reach max ramp, and the fire-
/// rate multiplier at max ramp — composed into the fire-rate calc below
/// exactly like TS's channelFireRateMul.
const GEO_CHANNEL_RAMP_MS: f64 = 2000;
const GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX: f64 = 1.6;

/// Paper Double decoy body (2026-07-20 gap-closure pass item 3 — parity
/// with client/src/sim/player.ts's PLAYER_BODY_WIDTH/PLAYER_BODY_HEIGHT,
/// used by paperDouble.ts's `paperDoubleAABB` — the SAME box a real player
/// uses, per that function's own doc comment, NOT the looser
/// PLAYER_HALF_W=15/PLAYER_HALF_H=28 approximation this file's section 4
/// player-hit loop uses elsewhere). Centered on (x, y).
const PAPER_DOUBLE_BODY_HALF_W: f64 = 13.0;
const PAPER_DOUBLE_BODY_HALF_H: f64 = 28.0;

// Arena bounds for the ceiling clamp + void-plane kill (parity with World.ts).
// Module-level (not packed in WorldState) — one sim instance, same lifetime as
// the statics cache; set by the host on match start.
var g_ceiling_clamp_y: f64 = 0;
var g_has_ceiling: bool = false;
var g_kill_plane_y: f64 = 0; // map.size.y + KILL_PLANE_MARGIN_PX; 0 = disabled

/// Host sets arena bounds on match start: ceiling-clamp Y (World.ts
/// computeCeilingClampY, has_ceiling=0 when the map has no ceiling) and the
/// void kill-plane Y (map.size.y + KILL_PLANE_MARGIN_PX).
pub export fn world_state_set_arena_bounds(
    ceiling_y: f64,
    has_ceiling: i32,
    kill_plane_y: f64,
) void {
    g_ceiling_clamp_y = ceiling_y;
    g_has_ceiling = has_ceiling != 0;
    g_kill_plane_y = kill_plane_y;
}

// Hangout mode (Track E1d — gospel-goal.md "hangout flag in `step_world`",
// lifting the hosts' TS-only pin). Module-level like the arena bounds above
// (zero WorldState bytes — a STEP INPUT, not sim state): hosts write it
// before EVERY step_world call (client runWasmStepSync / server
// serverWasmHost.step both write it unconditionally per step, so a shared
// wasm instance stepping a lobby and an arena interleaved can never leak
// one match's mode into the other). Default false = combat semantics, the
// exact behavior every pre-flag sim.wasm shipped.
//
// What it gates (each site mirrors the World.ts hangoutMode branch it
// names — the venue lobby is a no-PvP walking space, docs/venue-goal.md):
//   - fighting-phase pin (World.ts:2510) — movement/fire stay live;
//   - player-hit ghosting for real projectiles (:6770), hitscan (:3113),
//     and the belt-and-braces resolver guard (:1824);
//   - melee arc (:5725/:6148), dash-through tag (:5588), paladin landing
//     hooks (:2936), instant-AOE resolution (:5313), Paper Double burst
//     resolution (:7148), emission cast (:3333);
//   - fire-patch (:7030) / destructible-blast (:6987) player damage;
//   - shrink-zone storm skip (:7167) — hangout pins the round clock, which
//     would otherwise read as "final seconds" and run the soft zone
//     permanently at full strength;
//   - void-plane fall = silent respawn, not a kill (:6397);
//   - round machine freeze (:7407), kill-tally credit (:7389), charge
//     fill (:7312), mid-round fast respawn (:7478).
// NOT mirrored (recorded cuts, all hangout-only ALTERNATE paths TS runs
// for the practice dummies): melee/edge arc-vs-destructible hits
// (:5904/:6334 — needs a per-swing dedupe set in the ABI-frozen
// MeleeSwingMemory), instant-AOE-vs-destructibles (:5330), and the
// hangout destructible-damage charge source (:7318's sibling block).
var g_hangout_mode: bool = false;

/// Host sets hangout mode before EVERY step_world call (step-input
/// cadence, not match-start — see g_hangout_mode's own doc comment).
pub export fn world_state_set_hangout_mode(enabled: u32) void {
    g_hangout_mode = enabled != 0;
}

// Arena X/Y extent (map.size.x/map.size.y in TS) — a SEPARATE global pair
// from the ceiling/kill-plane bounds above because it serves a different
// consumer: Phase 4c's movement-ability collision-free-landing search
// (findCollisionFreeLanding below — Slip Node/Plant Charge/Bulwark Step/
// Drift Step all clamp candidate landing points against `runtime.map.size`
// in World.ts, and unlike the kill-plane's derived margin math, this needs
// the RAW width/height, not a pre-offset threshold). 0 = not yet set by the
// host (the search's bound check in that axis is skipped, same "0 =
// disabled" convention `g_kill_plane_y` already uses) — wiring the host call
// (server/serverWasmHost.ts, alongside its existing setArenaBounds call) is
// OUT OF SCOPE here: this pass's whole write-scope is sim/, and every real
// map's boundary geometry is already enclosed in solid statics wall
// platforms, so an unset bound here degrades to "rely on the statics
// overlap check alone" rather than a silent correctness gap.
var g_arena_size_x: f64 = 0;
var g_arena_size_y: f64 = 0;

/// Host sets the arena's raw width/height on match start (same cadence as
/// world_state_set_arena_bounds/world_state_set_statics above).
pub export fn world_state_set_arena_size(width: f64, height: f64) void {
    g_arena_size_x = width;
    g_arena_size_y = height;
}

// ── Launch pads (§8c — parity with client/src/sim/launchPad.ts) ─────────────
// STATIC map geometry, module-level like the arena bounds above: pads carry
// ZERO WorldState bytes (the retrigger condition is stateless — see the TS
// header for the proof), so they live outside the packed extern struct and
// imply no worldStateBridge layout / wire change. Host sets them on match
// start next to the statics/arena-bounds calls.

pub const MAX_LAUNCH_PADS: usize = 16;

/// One pad: AABB center + full size + impulse vector. Mirrors the TS
/// `LaunchPadDefinition` field-for-field.
pub const LaunchPad = extern struct {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    impulse_x: f64,
    impulse_y: f64,
};

/// MIRROR of launchPad.ts constants — change both or neither.
const LAUNCH_PLAYER_HALF_W: f64 = 15;
const LAUNCH_PLAYER_HALF_H: f64 = 28;
const LAUNCH_RETRIGGER_FRACTION: f64 = 0.5;
const LAUNCH_ALONG_CAP_FACTOR: f64 = 1.35;

var g_launch_pads: [MAX_LAUNCH_PADS]LaunchPad = undefined;
var g_launch_pad_count: u32 = 0;

/// Host sets the map's launch pads on match start (same cadence as
/// world_state_set_statics / world_state_set_arena_bounds). `pads_ptr`
/// is a flat f64 array of 6 values per pad: [x, y, w, h, impulse_x,
/// impulse_y] — pad order MUST be the map's `launchPads` array order
/// (the index doubles as the event entity_id on both sides). Returns
/// the count actually written (clamped at MAX_LAUNCH_PADS).
pub export fn world_state_set_launch_pads(
    pads_ptr: [*]const f64,
    count: u32,
) u32 {
    const clamped: u32 = @min(count, @as(u32, @intCast(MAX_LAUNCH_PADS)));
    var i: u32 = 0;
    while (i < clamped) : (i += 1) {
        const base = i * 6;
        g_launch_pads[i] = .{
            .x = pads_ptr[base + 0],
            .y = pads_ptr[base + 1],
            .w = pads_ptr[base + 2],
            .h = pads_ptr[base + 3],
            .impulse_x = pads_ptr[base + 4],
            .impulse_y = pads_ptr[base + 5],
        };
    }
    g_launch_pad_count = clamped;
    return clamped;
}

// ── Spawn points (Track Z0b Item A — parity with World.ts assignSpawnPoints)
// STATIC map geometry, module-level like the launch pads above: the spawn
// list carries zero WorldState bytes. Host sets them on match start next to
// the statics/pads/slopes calls. The TS-side wrapper (worldWasmBackend's
// setWorldSpawnPoints) is responsible for passing TS's own no-spawns
// fallback (`map.spawns.length > 0 ? map.spawns : [center]`) so this module
// never needs the map size; an EMPTY list here degrades to (0, 0) — the
// same `?? { x: 0, y: 0 }` fallback World.ts's respawn call site uses for a
// missing assignment.

pub const MAX_SPAWN_POINTS: usize = 16;

var g_spawn_points_x: [MAX_SPAWN_POINTS]f64 = undefined;
var g_spawn_points_y: [MAX_SPAWN_POINTS]f64 = undefined;
var g_spawn_point_count: u32 = 0;

/// Host sets the map's spawn points on match start. `points_ptr` is a flat
/// f64 array of 2 values per point: [x, y] — point order MUST be the map's
/// `spawns` array order (assignSpawnPoints iterates candidates in that
/// order, and its strict-`>` best-score comparison makes order load-bearing
/// for ties). Returns the count actually written (clamped).
pub export fn world_state_set_spawn_points(
    points_ptr: [*]const f64,
    count: u32,
) u32 {
    const clamped: u32 = @min(count, @as(u32, @intCast(MAX_SPAWN_POINTS)));
    var i: u32 = 0;
    while (i < clamped) : (i += 1) {
        g_spawn_points_x[i] = points_ptr[i * 2 + 0];
        g_spawn_points_y[i] = points_ptr[i * 2 + 1];
    }
    g_spawn_point_count = clamped;
    return clamped;
}

/// Mid-round fast-respawn delay (parity with constants.ts RESPAWN_DELAY_MS
/// — Jake's fast-respawn ruling 2026-07-17): ordinary-round deaths re-form
/// this many ms after the death tick; SUDDEN DEATH keeps last-one-standing.
const RESPAWN_DELAY_MS: f64 = 3000.0;

/// Compare two players by id bytes (lexicographic) — the Zig mirror of
/// TS's `[...ids].sort()` (ASCII ids: UTF-16 code-unit order == byte
/// order). Used to walk the roster in sorted-id order for spawn
/// assignment. NOTE: pack order (worldStateBridge sorts by localeCompare)
/// is NOT trusted here — localeCompare is locale-sensitive and TS's own
/// respawn path re-sorts with plain `.sort()` anyway, so this derives the
/// order it needs from the bytes it can see.
fn playerIdLessThan(a: *const world_state.PlayerEntity, b: *const world_state.PlayerEntity) bool {
    return std.mem.order(u8, a.id_bytes[0..a.id_len], b.id_bytes[0..b.id_len]) == .lt;
}

/// Port of World.ts `assignSpawnPoints` for ONE target player: players are
/// placed one at a time in stable id-sorted order, each at the spawn point
/// that is farthest from everyone already placed, preferring unused points
/// (`score = (used ? 0 : 1e7) + (minD == ∞ ? 2e7 : minD)`, strict `>` —
/// first-listed point wins exact ties, matching TS). The full placement is
/// recomputed per call, exactly like TS's respawn site calls
/// `assignSpawnPoints(map, idsNow)` fresh per respawning player — the
/// assignment depends only on the sorted roster + point list, not on who
/// is alive, so both sides agree. Returns the target's assigned point;
/// (0, 0) when no spawn points were ever registered (see the module note
/// above — the TS wrapper's center fallback makes this unreachable in
/// production).
const SpawnSeat = struct { x: f64, y: f64 };

fn assignedSpawnPoint(
    state: *const world_state.WorldState,
    target_idx: u32,
) SpawnSeat {
    // Fail-safe, NOT the TS fallback: with no registered spawn points the
    // respawn keeps the player where they stand (TS would use the map
    // center — but this module has no map size, and a Zig-only test that
    // never wired spawn points should not teleport its roster to a made-up
    // origin). The TS wrapper always registers at least one point, so
    // production/parity paths never take this branch.
    if (g_spawn_point_count == 0)
        return .{ .x = state.players[target_idx].x, .y = state.players[target_idx].y };
    // Sorted-id order over the roster (selection sort into an index list —
    // MAX_PLAYERS is small and this runs only on respawn ticks).
    var order: [world_state.MAX_PLAYERS]u32 = undefined;
    var n: u32 = 0;
    while (n < state.player_count) : (n += 1) order[n] = n;
    var si: u32 = 0;
    while (si + 1 < state.player_count) : (si += 1) {
        var best = si;
        var sj: u32 = si + 1;
        while (sj < state.player_count) : (sj += 1) {
            if (playerIdLessThan(&state.players[order[sj]], &state.players[order[best]]))
                best = sj;
        }
        if (best != si) {
            const tmp = order[si];
            order[si] = order[best];
            order[best] = tmp;
        }
    }
    var placed_x: [world_state.MAX_PLAYERS]f64 = undefined;
    var placed_y: [world_state.MAX_PLAYERS]f64 = undefined;
    var placed_count: u32 = 0;
    var oi: u32 = 0;
    while (oi < state.player_count) : (oi += 1) {
        var best_x = g_spawn_points_x[0];
        var best_y = g_spawn_points_y[0];
        var best_score = -std.math.inf(f64);
        var pt: u32 = 0;
        while (pt < g_spawn_point_count) : (pt += 1) {
            const px = g_spawn_points_x[pt];
            const py = g_spawn_points_y[pt];
            var min_d = std.math.inf(f64);
            var used = false;
            var pl: u32 = 0;
            while (pl < placed_count) : (pl += 1) {
                const d = std.math.hypot(px - placed_x[pl], py - placed_y[pl]);
                if (d < min_d) min_d = d;
                if (placed_x[pl] == px and placed_y[pl] == py) used = true;
            }
            const used_bonus: f64 = if (used) 0 else 1e7;
            const dist_term: f64 = if (min_d == std.math.inf(f64)) 2e7 else min_d;
            const score = used_bonus + dist_term;
            if (score > best_score) {
                best_score = score;
                best_x = px;
                best_y = py;
            }
        }
        if (order[oi] == target_idx) return .{ .x = best_x, .y = best_y };
        placed_x[placed_count] = best_x;
        placed_y[placed_count] = best_y;
        placed_count += 1;
    }
    return .{ .x = 0, .y = 0 }; // unreachable for a valid target_idx
}

/// Class-chassis base max health (parity with cardTypes.ts CHASSIS_STATS
/// maxHealth — enforced TS-side 2026-07-22): Geometrician/balanced 100,
/// Kindled/heavy 125, Interstice/sprinter 85, Syzygist/shielded 100.
fn baseMaxHealthForArchetype(archetype: world_state.CharacterArchetype) f64 {
    return switch (archetype) {
        .heavy => 125.0,
        .sprinter => 85.0,
        else => 100.0,
    };
}

/// Class-chassis recoil steadiness (parity with cardTypes.ts CHASSIS_STATS
/// recoilControlMultiplier — enforced TS-side 2026-07-23, cohesion-goal.md
/// P1.3): the fire self-knockback DIVIDES by this (>1 = steadier, <1 =
/// kickier). Kindled/heavy 1.25, Interstice/sprinter 0.9, everyone else 1
/// — same mirror shape as baseMaxHealthForArchetype directly above.
fn recoilControlForArchetype(archetype: world_state.CharacterArchetype) f64 {
    return switch (archetype) {
        .heavy => 1.25,
        .sprinter => 0.9,
        else => 1.0,
    };
}

/// A player's REAL max health right now (parity with weapon.ts
/// maxHealthForPlayer): class base + the resolved build's maxHealthAdd —
/// read from the host-patched per-player fire config, the same
/// createWeaponBuild resolution TS's own maxHealthForPlayer reads.
fn maxHealthForPlayer(
    p: *const world_state.PlayerEntity,
    fcfg: *const world_state.ResolvedFireConfig,
) f64 {
    const add: f64 = if (fcfg.valid != 0) fcfg.max_health_add else 0;
    return baseMaxHealthForArchetype(p.character_id) + add;
}

/// The one respawn reset (port of World.ts `respawnPlayerAt` — shared by
/// the round-boundary reset and the mid-round fast respawn so the two
/// paths can never drift). Slot cooldowns and ability_charge deliberately
/// persist (same law as TS's round carry-over); slow deliberately
/// persists too (TS's respawnPlayerAt clears burn/freeze/parry but NOT
/// slowedUntilTick — mirrored bit-for-bit, not "improved").
fn respawnPlayerAt(
    p: *world_state.PlayerEntity,
    fcfg: *const world_state.ResolvedFireConfig,
    spawn_x: f64,
    spawn_y: f64,
) void {
    p.x = spawn_x;
    p.y = spawn_y;
    p.vx = 0;
    p.vy = 0;
    p.health = maxHealthForPlayer(p, fcfg);
    p.flags.alive = true;
    p.flags.crouching = false;
    p.flags.shield_active = false;
    p.fire_cooldown_ms = 0;
    // jetpackFuel: JETPACK_MAX_FUEL (player.zig's constant, 125 — TS
    // constants.ts JETPACK_MAX_FUEL). Defined-after-respawn in TS, so the
    // has-flag turns on here too.
    p.jetpack_fuel = 125.0;
    p.flags.has_jetpack_fuel = true;
    // Parry timers clear (mirrors clearTemporaryCombatEffects).
    p.parry_active_until_tick = 0;
    p.parry_cooldown_until_tick = 0;
    p.parry_facing = 0;
    p.flags.has_parry_active = false;
    p.flags.has_parry_cooldown = false;
    p.flags.has_parry_facing = false;
    // Shield charge resets to full: TS `player.shieldMaxCharge ?? 100` —
    // after a bridge round-trip shieldMaxCharge is defined iff
    // hasShieldCharge, so gate on the flag, then set it (shieldCharge is a
    // plain number after this in TS).
    p.shield_charge = if (p.flags.has_shield_charge) p.shield_max_charge else 100.0;
    p.flags.has_shield_charge = true;
    // Element status effects clear on respawn (burn + freeze; NOT slow —
    // see this fn's doc comment).
    p.burn_until_tick = 0;
    p.burn_dps = 0;
    p.burn_tick_last_applied = 0;
    p.flags.has_burn = false;
    p.freeze_until_tick = 0;
    p.freeze_multiplier = 0;
    p.flags.has_freeze = false;
    // The pending mid-round respawn is consumed by re-forming.
    p.respawn_at_tick = 0;
}

/// A player whose id begins with "bot_" is AI (parity with round.ts BOT_ID_PREFIX).
fn isBotPlayer(p: *const world_state.PlayerEntity) bool {
    if (p.id_len < 4) return false;
    return p.id_bytes[0] == 'b' and p.id_bytes[1] == 'o' and
        p.id_bytes[2] == 't' and p.id_bytes[3] == '_';
}

/// Resolve a player array index from raw owner-id bytes (projectile /
/// fire-patch owners). Returns -1 when no roster player matches.
fn playerIdxById(
    state: *const world_state.WorldState,
    id_bytes: []const u8,
) i32 {
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        const p = &state.players[i];
        if (p.id_len == id_bytes.len and
            std.mem.eql(u8, p.id_bytes[0..p.id_len], id_bytes))
        {
            return @intCast(i);
        }
    }
    return -1;
}

/// Credit a kill to the round tally (parity with World.ts's fold rule:
/// killerId non-null and != victimId). No-op for attacker-less deaths
/// (void, burn, storm) and self-kills — they credit nobody.
fn creditKill(
    state: *world_state.WorldState,
    attacker_idx: i32,
    victim_idx: i32,
) void {
    // Hangout: the kill tally never accrues (World.ts:7389's !hangoutMode
    // fold gate). Belt-and-braces — every damage path is already gated.
    if (g_hangout_mode) return;
    if (attacker_idx < 0 or attacker_idx == victim_idx) return;
    state.players[@intCast(attacker_idx)].round_kills += 1;
}

/// First-blood wager claim (Track Z0d — port of World.ts's resolveRangedHit
/// check, :1882-1889, plus its :6805 end-of-tick commit collapsed into one
/// write): the round's FIRST non-self, attacker-attributed RANGED hit that
/// survives mitigation claims a persistent FIRST_BLOOD_SPEED_MULTIPLIER
/// move boost for its owner. Call sites mirror TS's resolveRangedHit
/// coverage exactly — section 4's projectile damage site + the lightning
/// chain's secondary hit; NOT melee (TS's melee damage block never touches
/// firstBloodAwardThisTick), NOT fire/storm/void/explosion (attacker-less
/// or non-ranged in TS too).
///
/// Direct header write is TS-equivalent, not a shortcut: TS defers the
/// commit to end-of-tick only so its per-player MOVEMENT loop (which runs
/// before the projectile drain and reads `state.round.firstBloodPlayerId`,
/// the PRE-tick value — World.ts:2529's "boost takes effect starting next
/// tick" comment) can't see a same-tick award. In this orchestrator's
/// tick order movement (section 8) runs before every award site too, so
/// the claimant's boost still starts NEXT tick, and the round machine that
/// clears the field runs LAST — after every award site — exactly like TS's
/// stepRound. The `== 0` guard collapses TS's
/// `firstBloodAlreadyClaimedThisRound` + tick-local `firstBlood` pair
/// (header state and tick state are the same cell here).
fn maybeAwardFirstBlood(
    state: *world_state.WorldState,
    attacker_idx: i32,
    victim_idx: i32,
    is_fighting: bool,
) void {
    // Hangout: no ranged hit can land on a player (empty candidate pools),
    // so TS's resolveRangedHit claim site is unreachable there. Explicit
    // guard rather than emergent — is_fighting is PINNED true in hangout
    // (World.ts:2510), so without this a future hangout-reachable caller
    // would silently open the wager in the lobby.
    if (g_hangout_mode) return;
    if (!is_fighting) return;
    if (state.header.first_blood_idx_plus1 != 0) return;
    if (attacker_idx < 0 or attacker_idx == victim_idx) return;
    const ai: u32 = @intCast(attacker_idx);
    state.header.first_blood_idx_plus1 = ai + 1;
    emitEvent(
        state,
        .first_blood,
        attacker_idx,
        -1,
        0,
        0,
        state.players[ai].x,
        state.players[ai].y,
    );
}

// =================================================================
// Hitscan resolution (Track Z1c item 1 — convergence-goal.md). Same-tick
// ray resolution for a `delivery == raycast` build, called from section 6's
// fire site instead of the real-projectile spawn loop. Mirrors World.ts's
// `resolveHitscanShot` (the ray geometry) + `resolveRangedHit` (the
// mitigation/damage chain) — this is what makes THE GEOMETRICIAN RULING
// (weapon_build.zig — wizard is ALWAYS raycast) actually apply damage
// under wasm prediction: before this, world.zig ignored the resolved
// `delivery` field entirely and spawned a traveling ProjectileEntity for
// every build, hitscan included.
//
// SCOPE (v1 — deliberately narrower than TS's full chain; each cut was a
// recorded gap, not an oversight, and each is orthogonal to whether the
// core "hitscan build deals same-tick damage" behavior is correct).
// Track Z5 item 3 (finish-line-goal.md) closed 3 of the 5 v1 cuts in its
// first pass, then a follow-up pass closed a 4th — STATUS as of that
// follow-up:
//   - CLOSED (follow-up pass): candidates were alive non-owner PLAYERS +
//     static walls only. TS's `resolveHitscanShot` also sweeps Paper
//     Double decoys and destructibles as candidate pools (World.ts:2393-
//     2488) — this is now ported as a THIRD/FOURTH candidate-kind category
//     alongside players, mirroring section 4's own projectile ×
//     {destructible, paper-double, player} resolution pattern (the
//     nearest-across-all-pools sweep + swap-remove-on-consume shape lives
//     in `sweepHitscanCandidates` just below `applyHitscanHitOnPlayer`).
//     A direct decoy/destructible hit takes raw `base_damage` only (no
//     headshot/chaos/shooter-amp — those are player-hit-only, matching
//     TS's `pellet.damage` used for `pendingPaperDoubleDamage`/
//     `pendingHangoutDestructibleDamage`, distinct from the amp-scaled
//     `finalDamage` chain `resolveRangedHit` composes for players). A
//     decoy killed this way is picked up by this file's existing "6y"
//     Paper Double death/expiry burst scan generically (no extra event
//     needed at the hit site — that scan doesn't care which system zeroed
//     the health); a destructible killed this way emits `.destructible_
//     broken` directly, same as the real-projectile site, and (matching
//     TS's own `pendingHangoutDestructibleDamage` apply site, World.ts:
//     6926-6952, which every non-projectile damage source funnels
//     through, melee included) does NOT trigger the exploding-barrel
//     chain-AOE-vs-players reaction — that chain is a real-projectile-
//     only path in TS too (`stepDestructibles`' own collision loop), never
//     wired to the direct-damage funnel non-projectile sources use.
//   - PARTIALLY CLOSED (Track E item E1, split-spawn orchestrator):
//     pierce (ordered multi-hit along one ray, wall-terminated) IS ported
//     (and walks decoy/destructible candidates too, not just players).
//     The REAL-PROJECTILE half of the split gap is now DONE: every
//     projectile death/expiry TS splits on is orchestrated (see the
//     `queueSplitDeath` section comment + the "4s" materialisation pass)
//     — sticky fuse-end, lifetime expiry, terrain impact, player-hit
//     consumption (mitigated hits included — TS splits before
//     resolveRangedHit's mitigation runs), plus the boomerang
//     home-return and range-cap expiries (which stepV2 had never
//     implemented at all). `projectileSplitVelocities` is no longer an
//     orphaned primitive. STILL CUT: split-spawn at a HITSCAN ray's
//     terminal point (World.ts:3254-3275) — that site cannot be
//     mirrored bit-exactly today for two concrete reasons: (a) TS
//     builds the synthetic split parent's velocity from libm
//     `Math.cos/Math.sin(pellet.aimAngle)` (World.ts:3260-3261), which
//     wasm cannot reproduce bit-for-bit (the LUT trig used everywhere
//     else is a different function; note the hitscan RAY itself already
//     carries this same accepted approximation, lutCos vs Math.cos, at
//     `resolveHitscanFire`), and (b) TS draws the fan jitter from the
//     SHADOW rng cursor (`runtimeRngState`, World.ts:2559/3272 — seeded
//     from tick-start rngState, advanced by fire.ts's spread draws at
//     World.ts:3070-3072, and DISCARDED at end of tick, never merged
//     back), a cursor whose position Zig cannot know without also
//     porting the fire-path rng draws — out of this item's scope.
//   - CLOSED: impact-AOE routing (explosive/slow-field) detonates into
//     `pending_instant_aoe` at the ray's terminal point exactly like
//     World.ts's own `pellet.impact === "explosive" || "slow-field"`
//     branch, replacing per-hit direct damage entirely. A direct decoy/
//     destructible hit ALSO takes its own point damage before/alongside
//     the splash (World.ts:3172-3204) — closed alongside the candidates
//     cut above (same follow-up pass); the player-hit case was already
//     covered by the first pass.
//   - CLOSED: mirror shield's TS-side behavior ("no real projectile to
//     reverse, so re-trace once back at the attacker instead") is now
//     ported — see `HitscanHitOutcome` + `resolveHitscanMirrorBounce`.
//   - CLOSED: the shooter-side amp chain (damage_amp/overcharge/boss_mode/
//     Facet Break/Focus Hex/Rally Light/Kindled Resolve) and Ghost Guard
//     evasion — both real `resolveRangedHit` mechanics already mirrored on
//     the real-projectile path (section 4 above) — are now mirrored onto
//     this path too, inside `applyHitscanHitOnPlayer`.
// Everything else `resolveRangedHit` does for a direct hit IS ported:
// headshot, chaos scaling, victim vulnerability, Hard Aperture's ward-
// shell halving, parry deflect, Self-Lattice's partial absorb, the
// generic shield block (drain + pop), first blood, HP/kill,
// fire/ice/lightning-chain on-hit effects, AND (CLOSED, Track Z1c "six-axes
// axis payloads") passive Tithe leech — `ResolvedFireConfig.leech_fraction`
// now crosses (that field's own doc comment in world_state.zig has the
// full story, including the STOPGAP that bridges the classModifiers gap
// for this one field) and is consumed at `applyHitscanHitOnPlayer`'s tail,
// same formula/cap as the real-projectile site. No real card reaches
// hitscan+leech together today (see that consumption site's own note), but
// the CODE path is complete on both hit sites now, matching the item's
// "both the existing projectile path AND the new hitscan path" ask.

/// Signal from `applyHitscanHitOnPlayer` back to its caller
/// (`resolveHitscanFire`): mirror shield has no real traveling entity to
/// physically reverse (unlike the real-projectile site's `proj_ptr.vx =
/// -proj_ptr.vx * 1.15` reassignment) — TS's own fix (World.ts:4950-4995,
/// the `pendingHitscanHits` drain) is a SEPARATE immediate re-trace, once,
/// back toward the original shot's source, now owned by the blocker. Track
/// Z5 item 3's "mirror-shield retrace" sub-item — `bouncer_idx` is only
/// meaningful when `mirror_bounce` is true.
const HitscanHitOutcome = struct {
    mirror_bounce: bool = false,
    bouncer_idx: u32 = 0,
};

/// Direct-hit damage + mitigation for ONE hitscan pellet landing on
/// `victim_idx`, fired by `shooter_idx`. Mirrors World.ts's
/// `resolveRangedHit` for the subset ported here (see the section header
/// above this function for the exact scope line). `half_h` is the SAME
/// half-height the caller's own sweep used to confirm the hit — passed
/// through (rather than re-derived) so the headshot band stays self-
/// consistent with whichever box actually decided the hit, matching
/// `combat.isHeadshotAtHalfHeight`'s own doc comment. Returns a
/// `HitscanHitOutcome` (Track Z5 item 3) — non-default only when a mirror
/// shield just absorbed the hit, telling the caller to fire ONE reflected
/// retrace; every other exit returns the all-default `.{}`.
fn applyHitscanHitOnPlayer(
    state: *world_state.WorldState,
    victim_idx: u32,
    shooter_idx: i32,
    hit_x: f64,
    hit_y: f64,
    half_h: f64,
    base_damage: f64,
    element: world_state.ElementType,
    chaos_profile: chaos.ChaosProfile,
    origin_x: f64,
    origin_y: f64,
    aim_angle: f64,
    eff_dt: f64,
    is_fighting: bool,
    leech_fraction: f64,
) HitscanHitOutcome {
    _ = hit_x; // kept for signature symmetry with the caller's hit point; only hit_y feeds the headshot band (a pure Y-band check, matching TS's isHeadshot).
    // Belt-and-braces pair mirroring World.ts:1824's `!victim.alive ||
    // ctx.hangoutMode` resolver guard exactly: the caller only ever builds
    // candidates from alive players, and hangout empties the player pool
    // upstream — but a future ranged source that bypasses the pool build
    // must not quietly reopen player damage in the lobby.
    if (!state.players[victim_idx].flags.alive or g_hangout_mode) return .{};

    // Ninja dash i-frames (Track Z1c "ninja dash i-frames" item) — ahead of
    // everything else (headshot/vulnerability/ward/parry/shield/peel), same
    // "wasn't there" pre-emption as the real-projectile site below. No
    // event, no damage — the shot is simply consumed by returning here.
    if (isNinjaEvading(state, victim_idx)) return .{};

    // Ghost Guard (Ninja, Track Z5 item 3's "shooter-side amp chain" sub-
    // item, which also names this victim-side evasion): banked
    // evasion charge, mirrors the real-projectile site's own block exactly
    // (character_id gate + charge window + move-speed threshold), checked
    // here ahead of headshot/damage composition — matches this function's
    // own existing "early-return checks first" shape (ninja dash i-frames
    // immediately above), not a behavior change from the real-projectile
    // site's relative ordering (an evaded hit deals zero damage regardless
    // of when in the chain it's detected — nothing before this point has
    // written any state yet). Full evasion: zero damage, no event, the
    // pellet is simply consumed by returning here.
    if (state.players[victim_idx].character_id == .sprinter and
        state.players[victim_idx].ghost_guard_charge_until_tick > state.header.tick and
        @sqrt(state.players[victim_idx].vx * state.players[victim_idx].vx +
            state.players[victim_idx].vy * state.players[victim_idx].vy) > combat.NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD)
    {
        state.players[victim_idx].ghost_guard_charge_until_tick = 0;
        return .{};
    }

    // Headshot (mirrors projectile.ts's applyHitOn — the multiplier applies
    // to the RAW base damage BEFORE chaos scaling, same ordering as the
    // real-projectile site's own headshot port above).
    const headshot = combat.isHeadshotAtHalfHeight(hit_y, state.players[victim_idx].y, half_h);
    const headshot_dmg: f64 = if (headshot) base_damage * combat.HEADSHOT_DAMAGE_MULTIPLIER else base_damage;
    var final_dmg = headshot_dmg * chaos_profile.damage_multiplier;

    // Shooter-side amp chain (Track Z5 item 3's "shooter-side amp chain"
    // sub-item) — same composition shape
    // as the real-projectile site's own block (section 4 above), just
    // without that site's owner_id_bytes lookup: `shooter_idx` already
    // arrives here as a resolved player INDEX (the caller's own candidate
    // sweep never deals in ids), so this reads straight off it.
    if (shooter_idx >= 0) {
        const sp = &state.players[@as(usize, @intCast(shooter_idx))];
        if (sp.flags.has_damage_amp and sp.damage_amp_until_tick > state.header.tick) {
            final_dmg *= 2.0;
        }
        if (sp.flags.has_overcharge and sp.overcharge_until_tick > state.header.tick) {
            final_dmg *= 1.5;
        }
        if (sp.flags.has_boss_mode and sp.boss_mode_until_tick > state.header.tick) {
            final_dmg *= 2.0;
        }
        // Facet Break (Wizard) / Focus Hex (Priest) — mark lives on the
        // SHOOTER; a landed hit against the exact marked victim is
        // amplified. Same "until_tick check first" short-circuit shape as
        // the real-projectile site (guards the zero-length-id vacuous
        // match at tick 0).
        if (sp.facet_mark_until_tick > state.header.tick and
            sp.facet_target_id_len == state.players[victim_idx].id_len and
            std.mem.eql(u8, sp.facet_target_id_bytes[0..sp.facet_target_id_len], state.players[victim_idx].id_bytes[0..state.players[victim_idx].id_len]))
        {
            final_dmg *= GEO_FACET_BREAK_AMP_MULTIPLIER;
        }
        if (sp.focus_hex_mark_until_tick > state.header.tick and
            sp.focus_hex_target_id_len == state.players[victim_idx].id_len and
            std.mem.eql(u8, sp.focus_hex_target_id_bytes[0..sp.focus_hex_target_id_len], state.players[victim_idx].id_bytes[0..state.players[victim_idx].id_len]))
        {
            final_dmg *= SYZ_FOCUS_HEX_AMP_MULTIPLIER;
        }
        // Rally Light — attacker-side amp, ordered BEFORE Kindled Resolve,
        // matching the real-projectile site's own World.ts-mirrored order.
        if (hasRallyLightSource(state, @as(u32, @intCast(shooter_idx)), state.header.tick)) {
            final_dmg *= KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER;
        }
        // Kindled Resolve (Paladin) — attacker-side amp, same shooter-buff
        // composition shape as damage_amp/overcharge/boss_mode above.
        if (sp.kindled_resolve_until_tick > state.header.tick) {
            final_dmg *= KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER;
        }
    }

    // Victim buff: vulnerability multiplies incoming damage.
    if (state.players[victim_idx].flags.has_vulnerability and
        state.players[victim_idx].vulnerability_until_tick > state.header.tick)
    {
        final_dmg *= 1.5;
    }
    // Hard Aperture (Wizard) — ward shell: halves incoming damage BEFORE
    // parry/shield mitigation. Same site as the real-projectile block.
    if (state.players[victim_idx].ward_shell_until_tick > state.header.tick) {
        final_dmg *= EMISSION_WARD_DAMAGE_MULT;
    }

    // Parry deflect: active parry window AND the shot's source direction
    // lies within the parry arc (widened by cover mult). The "source"
    // is the MUZZLE origin (not the hit point) with the aim unit vector as
    // the direction fallback — exactly what TS's hitscan `RangedHitSource`
    // carries (`x: pellet.originX, y: pellet.originY, vx: cos(aimAngle),
    // vy: sin(aimAngle)`), not the real-projectile block's live proj_ptr
    // position (which IS the current position for a traveling shard).
    const vcfg = &state.player_fire_config[victim_idx];
    const parry_arc = combat.PARRY_ARC_RADIANS *
        (if (vcfg.valid != 0) vcfg.parry_cover_mul else 1.0);
    const aim_ux = trig.lutCos(aim_angle);
    const aim_uy = trig.lutSin(aim_angle);
    if (combat.isParryActive(&state.players[victim_idx], state.header.tick) and
        combat.isHitInArc(
            state.players[victim_idx].x,
            state.players[victim_idx].y,
            state.players[victim_idx].parry_facing,
            origin_x,
            origin_y,
            aim_ux,
            aim_uy,
            parry_arc,
        ))
    {
        emitEvent(
            state,
            .parry_deflected,
            @intCast(victim_idx),
            -1,
            0,
            0,
            state.players[victim_idx].x,
            state.players[victim_idx].y,
        );
        // No bounce-back: TS's own parry deflect for a hitscan pellet is
        // ALSO just a consume (World.ts's `resolveRangedHit` returns
        // `{ suppressed: true }` for parry with no `reflectedVictimId` set
        // — only the MIRROR-SHIELD branch below sets that, see
        // `HitscanHitOutcome`'s own doc comment). v1 just consumes the
        // shot here, matching TS exactly (not a cut — parry never bounces
        // on either engine).
        return .{};
    }

    // Self-Lattice (Priest) — Syzygist Ward's flat absorb pool. Checked
    // BEFORE the generic shield step and mutually exclusive with it,
    // matching combat.ts's `trySyzygistWard` / the real-projectile site.
    var syz_ward_consumed = false;
    if (state.players[victim_idx].syz_ward_absorb_until_tick > state.header.tick and
        state.players[victim_idx].syz_ward_absorb_remaining > 0)
    {
        syz_ward_consumed = true;
        const blocked = @min(final_dmg, state.players[victim_idx].syz_ward_absorb_remaining);
        state.players[victim_idx].syz_ward_absorb_remaining -= blocked;
        final_dmg -= blocked;
        if (state.players[victim_idx].syz_ward_absorb_remaining <= 0) {
            state.players[victim_idx].syz_ward_absorb_remaining = 0;
            state.players[victim_idx].syz_ward_absorb_until_tick = 0;
        }
    }

    var kindled_warded = false;
    shield_block: {
        if (syz_ward_consumed) break :shield_block;
        if (!(state.players[victim_idx].flags.shield_active and
            state.players[victim_idx].flags.has_shield_charge and
            state.players[victim_idx].shield_charge > 0)) break :shield_block;
        // Kindled Ward (Paladin) — REPLACES the generic mitigation below
        // entirely for this class (Track Z1c "Kindled Ward partial
        // mitigation" item), matching combat.ts's `tryDeflectDamage`
        // exactly: partial (60%) if the source is in the player's own
        // frontal cone, full damage with NO charge drain if not (an
        // unwarded hit costs nothing to the bar either way). The "source"
        // is the MUZZLE origin, same as the parry check above. `kindled_
        // warded` gates team peel below — TS's own peel call is `if
        // (!mitigation.warded)`, so an already-Warded hit never ALSO peels.
        if (state.players[victim_idx].character_id == .heavy) {
            const vp = &state.players[victim_idx];
            const dx_aim = vp.aim_x - vp.x;
            const dy_aim = vp.aim_y - vp.y;
            const facing = if (dx_aim == 0.0 and dy_aim == 0.0) 0.0 else trig.lutAtan2(dy_aim, dx_aim);
            const in_cone = combat.isSourceInWardCone(vp.x, vp.y, facing, origin_x, origin_y);
            const mit = combat.computeKindledWardMitigation(final_dmg, in_cone);
            if (mit.applies) {
                vp.kindling = @min(KINDLING_MAX, vp.kindling + mit.kindling_granted);
                kindled_warded = true;
            }
            final_dmg = mit.damage;
            break :shield_block; // no charge drain either way — fall through to the health write below.
        }
        // Ninja/Interstice — LOCKED doctrine (docs/character-sheets-v1.md:
        // "Dash i-frames only — never block"): held Shield still drains/
        // recharges the charge economy via `tickShield` (untouched), but
        // never mitigates a single point of damage. Simplest possible
        // branch — fall straight through, byte-identical to
        // shield_active===false.
        if (state.players[victim_idx].character_id == .sprinter) break :shield_block;
        // Aim shield: only blocks hits arriving within the aim cone;
        // flank/back shots pass through to damage below.
        if (vcfg.valid != 0 and vcfg.directional_shield != 0) {
            const vp = &state.players[victim_idx];
            const adx = vp.aim_x - vp.x;
            const ady = vp.aim_y - vp.y;
            const aim_facing = if (adx == 0.0 and ady == 0.0)
                0.0
            else
                trig.lutAtan2(ady, adx);
            if (!combat.isHitInArc(vp.x, vp.y, aim_facing, origin_x, origin_y, aim_ux, aim_uy, combat.SHIELD_AIM_ARC_RADIANS))
                break :shield_block; // not covered → take the hit
        }
        state.players[victim_idx].shield_charge -=
            final_dmg * combat.SHIELD_HIT_DRAIN_MULTIPLIER;
        if (state.players[victim_idx].shield_charge <= 0) {
            state.players[victim_idx].shield_charge = 0;
            state.players[victim_idx].flags.shield_active = false;
            emitEvent(
                state,
                .shield_popped,
                @intCast(victim_idx),
                -1,
                0,
                0,
                state.players[victim_idx].x,
                state.players[victim_idx].y,
            );
        }
        // Mirror shield (Track Z5 item 3's "mirror-shield retrace" sub-
        // item, CLOSED): a hitscan shot has no real traveling entity to
        // reverse in place (unlike the real-projectile site's `proj_ptr.vx
        // = -proj_ptr.vx * 1.15`), so signal the caller to fire ONE
        // reflected retrace instead — exactly TS's own fix (World.ts:
        // 4950-4995: "a hitscan shot has no entity to reverse, so
        // re-resolve ONE more trace from the victim back along the same
        // line toward where it came from — single bounce only, no further
        // reflection"). Every OTHER shield block (no mirror_shield card)
        // still ends the hit here with a plain full absorb.
        if (vcfg.valid != 0 and vcfg.mirror_shield != 0) {
            return .{ .mirror_bounce = true, .bouncer_idx = victim_idx };
        }
        return .{};
    }

    // Team peel (Track Z1c "team peel" item) — same site/gate as the real-
    // projectile path immediately above in this file (both mirror TS's
    // shared `resolveRangedHit`); see `applyTeamPeel`'s own doc comment.
    // Gated on `!kindled_warded` (Track Z1c "Kindled Ward partial
    // mitigation" item) — TS's own peel call is `if (!mitigation.warded)`.
    if (!kindled_warded) {
        final_dmg = applyTeamPeel(state, victim_idx, final_dmg, state.header.tick);
    }
    maybeAwardFirstBlood(state, shooter_idx, @intCast(victim_idx), is_fighting);
    state.players[victim_idx].health -= final_dmg;
    emitEvent(
        state,
        .hit_confirmed,
        @intCast(victim_idx),
        shooter_idx,
        0,
        final_dmg,
        state.players[victim_idx].x,
        state.players[victim_idx].y,
    );
    if (state.players[victim_idx].health <= 0) {
        state.players[victim_idx].health = 0;
        state.players[victim_idx].flags.alive = false;
        creditKill(state, shooter_idx, @intCast(victim_idx));
        emitEvent(
            state,
            .player_killed,
            @intCast(victim_idx),
            shooter_idx,
            0,
            0,
            state.players[victim_idx].x,
            state.players[victim_idx].y,
        );
    }

    // Element on-hit effects (parity with World.ts phase 6d / the real-
    // projectile site above).
    switch (element) {
        .fire => {
            const burn_ticks: u32 = @intFromFloat(@ceil(EMISSION_BURN_CAP_MS / @max(1.0, eff_dt)));
            state.players[victim_idx].flags.has_burn = true;
            state.players[victim_idx].burn_until_tick = state.header.tick + burn_ticks;
            state.players[victim_idx].burn_dps = final_dmg * 0.4;
            state.players[victim_idx].burn_tick_last_applied = state.header.tick;
        },
        .ice => {
            const freeze_ticks: u32 = @intFromFloat(@ceil(1000.0 / @max(1.0, eff_dt)));
            state.players[victim_idx].flags.has_freeze = true;
            state.players[victim_idx].freeze_until_tick = state.header.tick + freeze_ticks;
            state.players[victim_idx].freeze_multiplier = 0.5;
        },
        .lightning, .electric => {
            const chain_dmg = final_dmg * 0.5;
            const hx = state.players[victim_idx].x;
            const hy = state.players[victim_idx].y;
            var best: i32 = -1;
            var best_d2: f64 = 220.0 * 220.0;
            var ci: u32 = 0;
            while (ci < state.player_count) : (ci += 1) {
                if (ci == victim_idx or !state.players[ci].flags.alive) continue;
                const cdx = state.players[ci].x - hx;
                const cdy = state.players[ci].y - hy;
                const d2 = cdx * cdx + cdy * cdy;
                if (d2 <= best_d2) {
                    best_d2 = d2;
                    best = @intCast(ci);
                }
            }
            if (best >= 0) {
                const cb: u32 = @intCast(best);
                maybeAwardFirstBlood(state, shooter_idx, best, is_fighting);
                state.players[cb].health -= chain_dmg;
                emitEvent(state, .hit_confirmed, best, shooter_idx, 0, chain_dmg, state.players[cb].x, state.players[cb].y);
                if (state.players[cb].health <= 0) {
                    state.players[cb].health = 0;
                    state.players[cb].flags.alive = false;
                    creditKill(state, shooter_idx, best);
                    emitEvent(state, .player_killed, best, shooter_idx, 0, 0, state.players[cb].x, state.players[cb].y);
                }
            }
        },
        else => {},
    }

    // Drain axis (Track Z1c "six-axes axis payloads"): passive Tithe leech
    // on a hitscan pellet, mirroring the real-projectile site's own leech
    // block immediately above in this file (same formula, same chassis-
    // aware `maxHealthForPlayer` cap, same self-damage guard, same
    // relative ordering — right after the element on-hit switch). No real
    // card reaches this combination today (Priest — the only class whose
    // build can carry a nonzero `leechFraction`, via Stolen Fangs' class-
    // gated reading — is ALWAYS `delivery: projectile` per THE GEOMETRICIAN
    // RULING's class-gated base, weapon_build.zig's `base_delivery`), so
    // this path's coverage rides on sharing the exact same formula as the
    // proven real-projectile site rather than a same-input parity test;
    // recorded here so the next reader knows this is a deliberate, honest
    // scope note, not an oversight.
    if (leech_fraction > 0 and shooter_idx >= 0 and @as(u32, @intCast(shooter_idx)) != victim_idx) {
        const healer_idx: usize = @intCast(shooter_idx);
        const healer = &state.players[healer_idx];
        if (healer.flags.alive) {
            const cap = maxHealthForPlayer(healer, &state.player_fire_config[healer_idx]);
            healer.health = @min(@max(cap, healer.health), healer.health + final_dmg * leech_fraction);
        }
    }
    return .{}; // normal (non-mirror-shield) hit — no retrace requested.
}

/// Which of the three candidate-kind pools a hitscan ray's nearest hit
/// belongs to (Track Z5 item 3's "decoy/destructible hitscan candidates"
/// sub-item, follow-up pass) — mirrors `resolveHitscanShot`'s own
/// `hitPlayerId` / `hitDecoyId` / `hitDestructibleId` triple (World.ts:
/// 2428-2460), collapsed to one tagged result instead of three nullable
/// fields since Zig has no natural "exactly one of three" union-of-null
/// idiom as ergonomic as a plain enum here.
const HitscanCandidateKind = enum(u8) { none = 0, player = 1, decoy = 2, destructible = 3 };

/// Result of one `sweepHitscanCandidates` call: which pool won (if any),
/// its index INTO THAT POOL's own `*_idx`/`*_box` arrays (not a world
/// entity index — callers resolve that via `cand_idx`/`decoy_idx`/
/// `dest_idx`), and the winning sweep `t` (defaults to the wall's own `t`
/// when nothing beats it, matching `bestT = wallT` — the floor every
/// candidate must beat — in `resolveHitscanShot`).
const HitscanCandidateHit = struct {
    kind: HitscanCandidateKind = .none,
    slot: u32 = 0,
    t: f64 = 1.0,
};

/// One swept-AABB pass per candidate-kind pool, keeping the SAME priority
/// order `resolveHitscanShot` uses for its own three sequential `if
/// (...Hit && ...Hit.t < bestT)` checks (World.ts:2434-2460): player
/// checked first, then decoy overrides only if STRICTLY closer, then
/// destructible overrides only if STRICTLY closer still. This ordering
/// only matters on an exact-tie `t` between two different candidate
/// kinds (an astronomically unlikely float coincidence with real per-tick
/// positions, same caveat the existing player-pool doc comment above
/// already makes for the pierce swap-remove vs. TS's order-preserving
/// splice) — kept anyway for byte-for-byte behavioral parity with TS's
/// own tie-break, not just "close enough."
fn sweepHitscanCandidates(
    mover: collision_types.AABB,
    vxr: f64,
    vyr: f64,
    player_box: []const collision_types.AABB,
    decoy_box: []const collision_types.AABB,
    dest_box: []const collision_types.AABB,
    wall_t: f64,
) HitscanCandidateHit {
    var result: HitscanCandidateHit = .{ .t = wall_t };

    var player_hit: collision_types.SweepHit = undefined;
    if (player_box.len > 0 and
        collision_types.sweepAABB(mover, vxr, vyr, 1.0, player_box, &player_hit) and
        player_hit.t < result.t)
    {
        result = .{ .kind = .player, .slot = @intCast(player_hit.index), .t = player_hit.t };
    }

    var decoy_hit: collision_types.SweepHit = undefined;
    if (decoy_box.len > 0 and
        collision_types.sweepAABB(mover, vxr, vyr, 1.0, decoy_box, &decoy_hit) and
        decoy_hit.t < result.t)
    {
        result = .{ .kind = .decoy, .slot = @intCast(decoy_hit.index), .t = decoy_hit.t };
    }

    var dest_hit: collision_types.SweepHit = undefined;
    if (dest_box.len > 0 and
        collision_types.sweepAABB(mover, vxr, vyr, 1.0, dest_box, &dest_hit) and
        dest_hit.t < result.t)
    {
        result = .{ .kind = .destructible, .slot = @intCast(dest_hit.index), .t = dest_hit.t };
    }

    return result;
}

/// Ray-trace ONE hitscan pellet from `(origin_x, origin_y)` along
/// `aim_angle` out to `range_px`, gathering ordered hits against alive
/// non-owner PLAYERS, non-owner live Paper Double decoys, and live
/// destructibles (Track Z5 item 3's "decoy/destructible hitscan
/// candidates" sub-item closed this pool out to all three kinds — see the
/// section header above for the full scope line) and applying damage
/// immediately: players via `applyHitscanHitOnPlayer` (full mitigation
/// chain), decoys/destructibles via a direct raw-`base_damage` write (no
/// mitigation — mirrors World.ts's `resolveHitscanShot` geometry +
/// `pendingPaperDoubleDamage`/`pendingHangoutDestructibleDamage` push for
/// those two candidate kinds). Unlike TS's own `pendingHitscanHits` batch
/// (deferred to avoid a stale-copy-on-write overwrite hazard on `players`,
/// a per-tick RECORD there), Zig's `state.players`/`state.paper_doubles`/
/// `state.destructibles` are flat, directly-mutated arrays — a hit lands
/// immediately with no equivalent hazard to defer around.
fn resolveHitscanFire(
    state: *world_state.WorldState,
    shooter_idx: u32,
    origin_x: f64,
    origin_y: f64,
    aim_angle: f64,
    range_px: f64,
    radius: f64,
    pierce_budget: u32,
    base_damage: f64,
    element: world_state.ElementType,
    chaos_profile: chaos.ChaosProfile,
    eff_dt: f64,
    is_fighting: bool,
    leech_fraction: f64,
    impact_kind: world_state.ProjectileImpact,
    impact_radius_px: f64,
    slow_multiplier: f64,
) void {
    const vxr = trig.lutCos(aim_angle) * range_px;
    const vyr = trig.lutSin(aim_angle) * range_px;
    const mover: collision_types.AABB = .{
        .x = origin_x - radius,
        .y = origin_y - radius,
        .w = radius * 2.0,
        .h = radius * 2.0,
    };

    // Wall stop is fixed for the whole ray — piercing never moves it
    // (mirrors `resolveHitscanShot`'s own `wallT`, computed once outside
    // the per-hit loop).
    var wall_hit: collision_types.SweepHit = undefined;
    const wall_found = collision_types.sweepAABBCached(
        mover,
        vxr,
        vyr,
        1.0,
        state.statics[0..state.static_count],
        state.one_way[0..state.static_count],
        &wall_hit,
    );
    const wall_t: f64 = if (wall_found) wall_hit.t else 1.0;

    // Candidate pool: every alive non-owner player. Fixed-size arrays
    // (MAX_PLAYERS is small) with swap-remove on pierce instead of TS's
    // order-preserving splice — the "next-nearest candidate behind a
    // pierced hit" result is identical either way; only the tie-break
    // loser on an EXACT-equal sweep `t` could differ, an astronomically
    // unlikely float coincidence with real per-tick positions.
    var cand_idx: [world_state.MAX_PLAYERS]u32 = undefined;
    var cand_box: [world_state.MAX_PLAYERS]collision_types.AABB = undefined;
    var cand_n: u32 = 0;
    // Hangout ghosting (World.ts:3113 `hitscanPlayerCandidateIds =
    // hangoutMode ? [] : ...`): players take ZERO ranged damage in the
    // lobby — an EMPTY player pool makes a player hit structurally
    // unreachable, while the decoy/destructible pools below stay live
    // (practice dummies still break).
    if (!g_hangout_mode) {
        var cpi: u32 = 0;
        while (cpi < state.player_count) : (cpi += 1) {
            if (cpi == shooter_idx) continue;
            if (!state.players[cpi].flags.alive) continue;
            cand_idx[cand_n] = cpi;
            cand_box[cand_n] = combat.playerHitboxAabb(
                state.players[cpi].x,
                state.players[cpi].y,
                state.players[cpi].flags.crouching,
                state.players[cpi].character_id,
            );
            cand_n += 1;
        }
    }

    // Decoy candidate pool (Track Z5 item 3's "decoy/destructible hitscan
    // candidates" sub-item, follow-up pass) — mirrors `resolveHitscanShot`'s
    // own decoy pool build (World.ts:2393-2403): every live (health > 0 AND
    // remaining_ms > 0) Paper Double NOT owned by the shooter. Owner-
    // exclusion matches section 4's real-projectile × decoy loop precedent
    // ("a caster's own shot never pops their own decoy").
    var decoy_idx: [world_state.MAX_PAPER_DOUBLES]u32 = undefined;
    var decoy_box: [world_state.MAX_PAPER_DOUBLES]collision_types.AABB = undefined;
    var decoy_n: u32 = 0;
    {
        const shooter_id_len = state.players[shooter_idx].id_len;
        const shooter_id = state.players[shooter_idx].id_bytes[0..shooter_id_len];
        var pdi: u32 = 0;
        while (pdi < state.paper_double_count) : (pdi += 1) {
            const pd = &state.paper_doubles[pdi];
            if (pd.health <= 0 or pd.remaining_ms <= 0) continue;
            if (pd.owner_id_len == shooter_id_len and
                std.mem.eql(u8, pd.owner_id_bytes[0..pd.owner_id_len], shooter_id))
            {
                continue;
            }
            decoy_idx[decoy_n] = pdi;
            decoy_box[decoy_n] = .{
                .x = pd.x - PAPER_DOUBLE_BODY_HALF_W,
                .y = pd.y - PAPER_DOUBLE_BODY_HALF_H,
                .w = PAPER_DOUBLE_BODY_HALF_W * 2.0,
                .h = PAPER_DOUBLE_BODY_HALF_H * 2.0,
            };
            decoy_n += 1;
        }
    }

    // Destructible candidate pool (same sub-item) — mirrors
    // `resolveHitscanShot`'s own destructible pool build (World.ts:2405-
    // 2413): every destructible with health > 0. No owner exclusion —
    // matches section 4's real-projectile × destructible loop, which has
    // none either (anyone's shot can break a barrel/dummy).
    var dest_idx: [world_state.MAX_DESTRUCTIBLES]u32 = undefined;
    var dest_box: [world_state.MAX_DESTRUCTIBLES]collision_types.AABB = undefined;
    var dest_n: u32 = 0;
    {
        var ddi: u32 = 0;
        while (ddi < state.destructible_count) : (ddi += 1) {
            const d = &state.destructibles[ddi];
            if (d.health <= 0) continue;
            dest_idx[dest_n] = ddi;
            dest_box[dest_n] = destructible.centerToAABB(d.x, d.y, d.width, d.height);
            dest_n += 1;
        }
    }

    // Impact-AOE routing (Track Z5 item 3's "impact-AOE routing" sub-item)
    // — mirrors World.ts's own `pellet.impact === "explosive" || "slow-
    // field"` branch (World.ts:3044-3068) EXACTLY: for these two impact
    // kinds the ray's per-hit direct-damage resolution is REPLACED
    // entirely by a single radial cast at the ray's terminal point (queued
    // onto the SAME `pending_instant_aoe` batch instant-AOE ability casts
    // already use, so headshot/leech never apply here — matches TS routing
    // through `resolveInstantAoeCasts`, never `resolveRangedHit`, for
    // these two impacts). A single nearest-candidate sweep (no pierce
    // loop) is exactly equivalent to TS's own "read only the FINAL trace"
    // shortcut — neither impact kind combines with `pierceCount` in the
    // shipped card pool (Explosive Facet/Cataclysmic Prism/Slow Field/
    // Frost Prism all resolve at pierceCount 0, the same fact World.ts's
    // own comment there relies on). A direct hit on a decoy or destructible
    // additionally takes its own point damage before/alongside the splash
    // (World.ts:3172-3204's "an explosive shot must still be able to pop a
    // dummy/decoy directly") — now ported below (follow-up pass), matching
    // the raw-`base_damage`-only rule the pierce loop further down uses for
    // the same two candidate kinds.
    if (impact_kind == .explosive or impact_kind == .slow_field) {
        const nearest = sweepHitscanCandidates(
            mover,
            vxr,
            vyr,
            cand_box[0..cand_n],
            decoy_box[0..decoy_n],
            dest_box[0..dest_n],
            wall_t,
        );
        const hx = origin_x + vxr * nearest.t;
        const hy = origin_y + vyr * nearest.t;
        switch (nearest.kind) {
            .decoy => {
                const pd_ptr = &state.paper_doubles[decoy_idx[nearest.slot]];
                pd_ptr.health = @max(0.0, pd_ptr.health - base_damage);
            },
            .destructible => {
                const dest_ptr = &state.destructibles[dest_idx[nearest.slot]];
                dest_ptr.health = destructible.applyDamage(dest_ptr.health, base_damage);
                if (dest_ptr.health <= 0) {
                    emitEvent(state, .destructible_broken, -1, -1, dest_ptr.id, 0, dest_ptr.x, dest_ptr.y);
                }
            },
            .player, .none => {},
        }
        if (state.pending_instant_aoe_count < world_state.MAX_PENDING_INSTANT_AOE) {
            state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                .x = hx,
                .y = hy,
                .radius = impact_radius_px,
                // Explosive: real damage (matches TS's `pellet.damage`,
                // this function's own `base_damage` param). Slow-field:
                // status-only — `resolveInstantAoeCasts`'s own "nominal 1
                // damage" branch handles the shield-mitigation check
                // without writing real HP, matching TS's `damage: 0`.
                .damage = if (impact_kind == .explosive) base_damage else 0,
                .caster_idx = shooter_idx,
                .has_slow = if (impact_kind == .slow_field) 1 else 0,
                .slow_multiplier = slow_multiplier,
                // SLOW_FIELD_DURATION_MS (client/src/sim/projectile.ts:67)
                // — same literal the real-projectile slow-field impact
                // site above already hardcodes (no named Zig constant
                // exists yet for it).
                .slow_duration_ms = 1500.0,
            };
            state.pending_instant_aoe_count += 1;
        }
        return;
    }

    const max_hits = pierce_budget + 1;
    var hits: u32 = 0;
    while (hits < max_hits) : (hits += 1) {
        const nearest = sweepHitscanCandidates(
            mover,
            vxr,
            vyr,
            cand_box[0..cand_n],
            decoy_box[0..decoy_n],
            dest_box[0..dest_n],
            wall_t,
        );
        if (nearest.kind == .none) break; // wall, or a clean miss at max range — ray ends.

        const hx = origin_x + vxr * nearest.t;
        const hy = origin_y + vyr * nearest.t;

        switch (nearest.kind) {
            .none => unreachable,
            .player => {
                const hit_slot = nearest.slot;
                const hit_idx = cand_idx[hit_slot];
                const half_h = cand_box[hit_slot].h / 2.0;
                const outcome = applyHitscanHitOnPlayer(
                    state,
                    hit_idx,
                    @intCast(shooter_idx),
                    hx,
                    hy,
                    half_h,
                    base_damage,
                    element,
                    chaos_profile,
                    origin_x,
                    origin_y,
                    aim_angle,
                    eff_dt,
                    is_fighting,
                    leech_fraction,
                );

                // Mirror-shield retrace (Track Z5 item 3's "mirror-shield
                // retrace" sub-item) — mirrors World.ts's own post-
                // `resolveRangedHit` bounce exactly (World.ts:4950-4995): ONE
                // fresh ray back the way this pellet came, fired FROM the
                // blocker's own position, now owned by the blocker.
                // `backAngle = atan2(pending.source.vy, pending.source.vx) +
                // PI` in TS reduces to `aim_angle + PI` here (TS's pellet
                // vx/vy are `cos(aimAngle)`/`sin(aimAngle)`, the exact same
                // unit vector `vxr`/`vyr` above are scaled from) — no
                // separate atan2 round-trip needed. Single bounce only, no
                // further reflection (TS: "never pierces — [0] is always the
                // only trace" — this discards the retrace's OWN
                // `HitscanHitOutcome`, so a second mirror shield on the
                // bounced-back target never chains again), and it never
                // touches this ray's own `cand_*`/pierce bookkeeping — a
                // fully separate, self-contained side event. Player-only,
                // matching TS's own bounce call (World.ts:5084-5096 passes
                // `undefined, undefined` for decoys/destructibles) —
                // `resolveHitscanMirrorBounce` is untouched by this pass.
                if (outcome.mirror_bounce) {
                    resolveHitscanMirrorBounce(
                        state,
                        outcome.bouncer_idx,
                        aim_angle,
                        range_px,
                        radius,
                        base_damage,
                        element,
                        chaos_profile,
                        eff_dt,
                        is_fighting,
                        leech_fraction,
                    );
                }

                // Splice the pierced candidate out of the live pool so the
                // next pass's sweep finds whatever's next behind it.
                cand_n -= 1;
                cand_idx[hit_slot] = cand_idx[cand_n];
                cand_box[hit_slot] = cand_box[cand_n];
            },
            .decoy => {
                // Decoy/destructible hitscan candidates (Track Z5 item 3,
                // follow-up pass) — direct point damage only, no mitigation
                // chain (mirrors World.ts's `pendingPaperDoubleDamage` push:
                // raw `pellet.damage`, no headshot/chaos/shooter-amp — those
                // only apply to `resolveRangedHit`'s player path). A death
                // discovered here (health drops to <= 0) is picked up
                // generically by this tick's own "6y" Paper Double death/
                // expiry burst scan further down this file — no separate
                // event needed at this site, matching TS's own "just apply
                // the damage, stepPaperDoubles' burst detection finds it
                // later" shape. A pierce budget lets the ray continue past a
                // popped decoy exactly like a pierced player.
                const hit_slot = nearest.slot;
                const pd_ptr = &state.paper_doubles[decoy_idx[hit_slot]];
                pd_ptr.health = @max(0.0, pd_ptr.health - base_damage);
                decoy_n -= 1;
                decoy_idx[hit_slot] = decoy_idx[decoy_n];
                decoy_box[hit_slot] = decoy_box[decoy_n];
            },
            .destructible => {
                // Same sub-item — mirrors World.ts's
                // `pendingHangoutDestructibleDamage` push exactly: raw
                // `pellet.damage`, `destructible-broken` on kill, no
                // exploding-barrel chain-AOE (that chain is real-projectile-
                // only in TS too, see the section-header note above).
                const hit_slot = nearest.slot;
                const dest_ptr = &state.destructibles[dest_idx[hit_slot]];
                dest_ptr.health = destructible.applyDamage(dest_ptr.health, base_damage);
                if (dest_ptr.health <= 0) {
                    emitEvent(state, .destructible_broken, -1, -1, dest_ptr.id, 0, dest_ptr.x, dest_ptr.y);
                }
                dest_n -= 1;
                dest_idx[hit_slot] = dest_idx[dest_n];
                dest_box[hit_slot] = dest_box[dest_n];
            },
        }
    }
}

/// The single reflected retrace a mirror-shield block requests (see
/// `HitscanHitOutcome`'s own doc comment). Fired FROM `bouncer_idx`'s own
/// position (TS: `bouncer.x, bouncer.y`, not the original hit point) along
/// `aim_angle + PI`, excluding only the bouncer itself — the original
/// shooter is a valid, often-intended target. One candidate only (no
/// pierce, matching TS's `[0]`); its own `HitscanHitOutcome` is discarded
/// (single bounce, never chains).
fn resolveHitscanMirrorBounce(
    state: *world_state.WorldState,
    bouncer_idx: u32,
    aim_angle: f64,
    range_px: f64,
    radius: f64,
    base_damage: f64,
    element: world_state.ElementType,
    chaos_profile: chaos.ChaosProfile,
    eff_dt: f64,
    is_fighting: bool,
    leech_fraction: f64,
) void {
    const back_angle = aim_angle + std.math.pi;
    const bvxr = trig.lutCos(back_angle) * range_px;
    const bvyr = trig.lutSin(back_angle) * range_px;
    const bouncer_x = state.players[bouncer_idx].x;
    const bouncer_y = state.players[bouncer_idx].y;
    const bmover: collision_types.AABB = .{
        .x = bouncer_x - radius,
        .y = bouncer_y - radius,
        .w = radius * 2.0,
        .h = radius * 2.0,
    };
    var bwall_hit: collision_types.SweepHit = undefined;
    const bwall_found = collision_types.sweepAABBCached(
        bmover,
        bvxr,
        bvyr,
        1.0,
        state.statics[0..state.static_count],
        state.one_way[0..state.static_count],
        &bwall_hit,
    );
    const bwall_t: f64 = if (bwall_found) bwall_hit.t else 1.0;

    var bcand_idx: [world_state.MAX_PLAYERS]u32 = undefined;
    var bcand_box: [world_state.MAX_PLAYERS]collision_types.AABB = undefined;
    var bcand_n: u32 = 0;
    var bci: u32 = 0;
    while (bci < state.player_count) : (bci += 1) {
        if (bci == bouncer_idx) continue;
        if (!state.players[bci].flags.alive) continue;
        bcand_idx[bcand_n] = bci;
        bcand_box[bcand_n] = combat.playerHitboxAabb(
            state.players[bci].x,
            state.players[bci].y,
            state.players[bci].flags.crouching,
            state.players[bci].character_id,
        );
        bcand_n += 1;
    }

    var bhit: collision_types.SweepHit = undefined;
    const bfound = if (bcand_n > 0)
        collision_types.sweepAABB(bmover, bvxr, bvyr, 1.0, bcand_box[0..bcand_n], &bhit)
    else
        false;
    if (!bfound or bhit.t >= bwall_t) return; // wall, or nothing behind the blocker.

    const bslot: u32 = @intCast(bhit.index);
    const bvictim_idx = bcand_idx[bslot];
    const bhx = bouncer_x + bvxr * bhit.t;
    const bhy = bouncer_y + bvyr * bhit.t;
    const bhalf_h = bcand_box[bslot].h / 2.0;
    _ = applyHitscanHitOnPlayer(
        state,
        bvictim_idx,
        @intCast(bouncer_idx),
        bhx,
        bhy,
        bhalf_h,
        base_damage,
        element,
        chaos_profile,
        bouncer_x,
        bouncer_y,
        back_angle,
        eff_dt,
        is_fighting,
        leech_fraction,
    );
}

/// Time-out / force-resolve winner (parity with round.ts
/// decideRoundWinner's forceResolve branch — kill-tally rule 2026-07-17):
///   1. most `round_kills` wins, dead or alive (landing kills is the
///      round's work; a fresh respawn's health bar isn't);
///   2. kill-tie: an ALIVE tied leader beats a dead one; among alive
///      tied leaders most health wins, then lowest index (players are
///      sorted by id at pack time, so lowest index = lowest id — the
///      TS tiebreak); all tied leaders dead → lowest index among them;
///   3. zero kills all round: most health among ALIVE, first-seen wins
///      health ties; nobody alive → -1 (draw, round ends unscored).
fn timeoutWinnerIdx(state: *const world_state.WorldState) i32 {
    if (state.player_count == 0) return -1;
    var max_kills: u32 = 0;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.players[i].round_kills > max_kills)
            max_kills = state.players[i].round_kills;
    }
    if (max_kills > 0) {
        var first_leader: i32 = -1;
        var best_alive: i32 = -1;
        var best_alive_health: f64 = 0;
        var k: u32 = 0;
        while (k < state.player_count) : (k += 1) {
            const p = &state.players[k];
            if (p.round_kills != max_kills) continue;
            if (first_leader < 0) first_leader = @intCast(k);
            if (p.flags.alive and (best_alive < 0 or p.health > best_alive_health)) {
                best_alive = @intCast(k);
                best_alive_health = p.health;
            }
        }
        return if (best_alive >= 0) best_alive else first_leader;
    }
    // Zero kills all round: most health among alive; -1 = draw when
    // nobody is alive at the bell.
    var best_idx: i32 = -1;
    var best_health: f64 = 0;
    var a: u32 = 0;
    while (a < state.player_count) : (a += 1) {
        const p = &state.players[a];
        if (!p.flags.alive) continue;
        if (best_idx < 0 or p.health > best_health) {
            best_idx = @intCast(a);
            best_health = p.health;
        }
    }
    return best_idx;
}

/// True sudden-death trigger (Track Z0a port of orphaned-branch commit
/// 02b74f5 — parity with client/src/sim/round.ts's isSuddenDeathRound).
/// Every player who has EVER scored (score > 0 — TS's sparse `scores` map
/// only has entries for players who've won at least one round, so a player
/// still at 0 is excluded, not counted as "tied at 0") is exactly one round
/// away from winning. Needs at least 2 scored players — a single scorer
/// can't have a decider round with themselves.
fn isSuddenDeathRound(state: *const world_state.WorldState) bool {
    if (state.header.target_score == 0) return false;
    const threshold = state.header.target_score - 1;
    var scored_count: u32 = 0;
    var all_at_threshold = true;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        const s = state.players[i].score;
        if (s > 0) {
            scored_count += 1;
            if (s != threshold) all_at_threshold = false;
        }
    }
    if (scored_count < 2) return false;
    return all_at_threshold;
}

/// Round-resolution verdict for one tick — the Zig mirror of TS
/// `decideRoundWinner`'s THREE-way return (`PlayerId | null | undefined`):
/// `ended=false` ⇔ TS `undefined` (round continues, `winner_idx` is -1);
/// `ended=true, winner_idx=-1` ⇔ TS `null` (round ends as a DRAW —
/// sudden-death mutual KO, or a force-resolve with nobody creditable);
/// `ended=true, winner_idx>=0` ⇔ a real winner. The old i32-only shape
/// couldn't represent "ends as a draw" distinctly from "keeps going",
/// which is exactly the case a sudden-death mutual KO needs.
const RoundResolution = struct { ended: bool, winner_idx: i32 };

/// Decide whether the fighting round resolves this tick (Track Z0b Item A
/// — full port of round.ts's fighting-phase resolution, fast-respawn
/// ruling 2026-07-17):
///   * LAST-ALIVE rules apply ONLY in sudden death (`suddenDeathActive` ⇔
///     `header.sudden_death_active`): 0 alive → mutual-KO draw; exactly 1
///     alive (roster > 1) → that player wins. In ORDINARY rounds a wiped
///     field is a moment, not an ending — the fallen re-form after
///     RESPAWN_DELAY_MS and the clock decides.
///   * Force-resolve (time-out, or the bot-shootout guard: humans present
///     but ALL dead for ≥ NO_HUMAN_SURVIVOR_END_MS) → most `round_kills`
///     wins with alive-health tiebreaks (timeoutWinnerIdx; -1 = draw).
/// `eff_dt` is taken so the countdown used here is the POST-decrement
/// value (`next.countdownRemainingMs` in round.ts) — the pre-decrement
/// header value made both the time-out and the bot-shootout guard read
/// one tick behind the phase machine (the phase machine transitions on
/// the post-decrement value, so the old code's time-out branch was
/// unreachable: the phase left `fighting` before the header ever read 0).
fn detectRoundWinner(
    state: *const world_state.WorldState,
    eff_dt: f64,
) RoundResolution {
    if (state.header.round_phase != @intFromEnum(round.RoundPhase.fighting))
        return .{ .ended = false, .winner_idx = -1 };
    const next_remaining = @max(0.0, state.header.countdown_remaining_ms - eff_dt);
    // Empty roster: keep the round in-progress on a normal tick, but on a
    // forced resolve let it end as a draw so the phase can't hang forever
    // (round.ts's `playerIds.length === 0` branch — no bot-shootout term
    // here because `humanIds.length > 0` is false with zero players).
    if (state.player_count == 0) {
        if (next_remaining <= 0)
            return .{ .ended = true, .winner_idx = -1 };
        return .{ .ended = false, .winner_idx = -1 };
    }
    var alive_count: u32 = 0;
    var alive_idx: i32 = -1;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.players[i].flags.alive) {
            alive_count += 1;
            alive_idx = @intCast(i);
        }
    }
    // Last-alive resolution belongs to SUDDEN DEATH only (fast-respawn
    // ruling 2026-07-17 — round.ts's `lastAliveResolves`).
    if (state.header.sudden_death_active != 0) {
        if (alive_count == 0) return .{ .ended = true, .winner_idx = -1 }; // mutual KO
        if (alive_count == 1 and state.player_count > 1)
            return .{ .ended = true, .winner_idx = alive_idx };
    }
    // Bot-shootout guard (parity with round.ts): humans present but ALL
    // dead, and the round has run ≥ NO_HUMAN_SURVIVOR_END_MS →
    // force-resolve so the lobby isn't stuck watching bots duel. Computed
    // fresh each tick, so a live human cancels it.
    var force_resolve = next_remaining <= 0;
    if (!force_resolve) {
        var humans: u32 = 0;
        var alive_humans: u32 = 0;
        var h: u32 = 0;
        while (h < state.player_count) : (h += 1) {
            if (!isBotPlayer(&state.players[h])) {
                humans += 1;
                if (state.players[h].flags.alive) alive_humans += 1;
            }
        }
        const elapsed = round.ROUND_TIME_LIMIT_MS - next_remaining;
        force_resolve = humans > 0 and alive_humans == 0 and
            elapsed >= NO_HUMAN_SURVIVOR_END_MS;
    }
    if (force_resolve) {
        // Kill-tally rule 2026-07-17: most round_kills wins, then
        // alive-health tiebreaks — see timeoutWinnerIdx. -1 = draw.
        return .{ .ended = true, .winner_idx = timeoutWinnerIdx(state) };
    }
    return .{ .ended = false, .winner_idx = -1 };
}

/// Push an event into state.events[event_count++]. Drops silently
/// when the buffer is full (caller should drain every tick).
fn emitEvent(
    state: *world_state.WorldState,
    kind: world_state.SimEventKind,
    a: i32,
    b: i32,
    eid: u32,
    scalar: f64,
    x: f64,
    y: f64,
) void {
    if (state.event_count >= world_state.MAX_EVENTS_PER_TICK) return;
    state.events[state.event_count] = .{
        .kind = @intFromEnum(kind),
        .player_idx_a = a,
        .player_idx_b = b,
        .entity_id = eid,
        .scalar = scalar,
        .x = x,
        .y = y,
    };
    state.event_count += 1;
}

/// Resolve every queued instant-AOE cast against the player roster — the
/// deferred-write PRIMITIVE itself (2026-07-20 gap-closure pass), ported
/// from World.ts's `resolveInstantAoeCasts` (World.ts:3675-3821). Takes an
/// explicit `casts` slice (not always `state.pending_instant_aoe[0..
/// state.pending_instant_aoe_count]`) so a future phase can call this a
/// SECOND time against a distinct batch — exactly how TS itself calls it
/// twice: once for the main per-player-loop queue (World.ts:3828), once
/// more for Paper Double's decoy bursts, discovered too late in tick order
/// to land in the first batch (World.ts:5903, its own comment explains
/// why a second call is needed rather than reusing the first array).
///
/// Caller contract: call this strictly AFTER every player's per-tick turn
/// has already run (world.zig section "6b", after section 6's per-player
/// loop) and strictly BEFORE section 9's end-of-tick compaction — same
/// timing TS's own call site comment documents. This is what makes the
/// primitive safe: `resolveInstantAoeCasts` is the ONLY place in a tick
/// that writes cast damage into another player's entity, and by the time
/// it runs every player's own per-tick state (fire, shield, parry, etc.)
/// is already final for this tick.
///
/// MITIGATION — what's real vs. stubbed (see the task-level report for the
/// full accounting): implements the geometry gate (radius + optional cone)
/// and the ONE piece of the TS mitigation chain that both (a) Zig already
/// has the primitives for (shield charge state, `combat.SHIELD_HIT_DRAIN_
/// MULTIPLIER`) and (b) TS's own `tryDeflectDamage` actually applies to a
/// null-projectile hit: the generic shield block. Parry and the dash-bash
/// power-slide deliberately do NOT apply here — this is not a gap, it's
/// EXACT TS parity: both of tryDeflectDamage's parry branches (combat.ts:
/// 592, 622) are gated `projectile !== null`, and `resolveInstantAoeCasts`
/// always calls `tryDeflectDamage(victim, null, ...)`. Directional shield's
/// facing check is likewise gated `options.directionalShield && projectile
/// !== null` (combat.ts:783) — false for every AOE cast — so an equipped
/// directional shield still fully blocks an AOE regardless of facing,
/// which is what this port does too (no facing check at all before the
/// block below).
///
/// STUBBED (ability-state fields with no Zig PlayerEntity mirror yet, same
/// "additive growth cut needed first" contract as PlayerEntity.
/// channel_hold_ms's own doc comment — none of these are silently dropped,
/// they're just not portable without growing PlayerEntity, which is
/// exactly the "large port" this pass's scoping asked NOT to take on):
///   - Syzygist Ward (already flagged TS-owned/TS-applied on its own field
///     comment, world_state.zig's syz_ward_absorb_until_tick)
///   - fooledDamageMultiplier (reads a TS-only fooledUntilTick field with
///     no Zig mirror). rallyLightDamageMultiplier is NO LONGER stubbed
///     here (Track Z1a item 3) — the ally substrate landed and this
///     function's damage block now applies the rally amp at the exact
///     TS position (World.ts:4861, immediately before Kindled Resolve).
/// kindledResolveDamageMultiplier / applyKindledResolveStaggerResist are NO
/// LONGER stubbed here (Phase 4a follow-up, this pass) — `kindled_resolve_
/// until_tick` is now a real PlayerEntity field (world_state.zig), wired at
/// both consumption sites below, matching TS's own :4662/:4719 call sites
/// exactly. Ghost Guard (combat.ts step 0.6) is ALSO no longer stubbed
/// (this pass) — corrected finding: unlike step 0.5 immediately above it,
/// Ghost Guard's own condition never reads `player.dashing` at all, so it
/// didn't actually need the substrate the original STUBBED line grouped it
/// under; see the switch arm's own doc comment below for the full citation.
/// Victim `has_vulnerability` is ALSO correctly absent here — checked
/// directly against TS: `resolveInstantAoeCasts` never reads
/// vulnerabilityUntilTick at all (unlike the projectile-hit path in
/// section 4 above, which does) — porting it here would be inventing
/// behavior TS itself doesn't have for this code path.
/// Team-peel is NO LONGER stubbed here either (Track Z1c "team peel" item)
/// — `applyTeamPeel`/`findTeamPeelWarderIdx` (below, near `isAlly`) port
/// World.ts's `applyTeamPeel`/`findTeamPeelWarder` using the Track Z1a
/// ally substrate, wired at this function's own damage block (matching
/// World.ts:5064's call site), the real-projectile hit site (section 4),
/// the hitscan hit site (Track Z1c item 1), and `stepMeleeSwing`. Ninja
/// dash i-frames (Track Z1c "ninja dash i-frames" item) are NO LONGER
/// stubbed either — `isNinjaEvading` (near `isAlly`) is checked ahead of
/// Ghost Guard in this function's own damage block, the real-projectile
/// site, the hitscan site, and `stepMeleeSwing`. Paladin Kindled Ward's
/// partial-mitigation branch (Track Z1c "Kindled Ward partial mitigation"
/// item) is ALSO no longer stubbed — `combat.isSourceInWardCone`/
/// `combat.computeKindledWardMitigation` REPLACE the generic shield block
/// in this function's own damage block (and at the real-projectile/
/// hitscan/melee sites) for a Paladin specifically; Ninja is EXCLUDED from
/// the generic block too (LOCKED doctrine: shield never mitigates for that
/// class).
pub fn resolveInstantAoeCasts(
    state: *world_state.WorldState,
    casts: []const world_state.PendingInstantAoe,
    tick: u32,
    eff_dt: f64,
) void {
    for (casts) |cast| {
        if (cast.caster_idx >= state.player_count) continue;
        var vi: u32 = 0;
        while (vi < state.player_count) : (vi += 1) {
            if (vi == cast.caster_idx) continue;
            const victim = &state.players[vi];
            if (!victim.flags.alive) continue;

            const dx = victim.x - cast.x;
            const dy = victim.y - cast.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 > cast.radius * cast.radius) continue;

            if (cast.has_cone != 0) {
                const target_angle = trig.lutAtan2(dy, dx);
                const da = combat.wrapAngle(target_angle - cast.aim_angle);
                if (@abs(da) > cast.cone_radians / 2.0) continue;
            }

            // Ninja dash i-frames (Track Z1c "ninja dash i-frames" item) —
            // checked AHEAD of Ghost Guard, matching combat.ts's step 0.5
            // (ahead of step 0.6). TS's `tryDeflectDamage` has no
            // `projectile !== null` gate on this step either, so it applies
            // to a null-projectile AOE hit same as melee/ranged. Same "no
            // damage, no slow/fooled status either" shape Ghost Guard's own
            // `continue` immediately below already documents.
            if (isNinjaEvading(state, vi)) continue;
            // Ghost Guard (Ninja, this pass) — banked evasion charge. TS's
            // `tryDeflectDamage` step 0.6 has no `projectile !== null` gate
            // (unlike parry/directional-shield), so it DOES apply to a
            // null-projectile AOE hit same as melee/ranged — closing the
            // 3rd of 3 mitigation-carrying sites this pass ships (see
            // stepMeleeSwing's own consumption site for the full "why this
            // doesn't need the dashing substrate" citation). Checked ahead
            // of the shield block below, matching step 0.6's position
            // ahead of step 2 in TS. Same "no damage, no slow/fooled
            // status either" shape the shield-block branch below already
            // documents for its own `continue`.
            if (victim.character_id == .sprinter and
                victim.ghost_guard_charge_until_tick > tick and
                @sqrt(victim.vx * victim.vx + victim.vy * victim.vy) > combat.NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD)
            {
                victim.ghost_guard_charge_until_tick = 0;
                continue;
            }

            // Status-only entries (cast.damage <= 0 — none of the 5 live
            // push sites emit one today, but TS keeps the branch, so this
            // does too) still need the real shield check evaluated with a
            // nominal 1 damage, exactly like TS's own `nominalDamage`
            // trick — only `cast.damage` (the real amount) ever reaches
            // health below.
            const nominal: f64 = if (cast.damage > 0) cast.damage else 1.0;

            // Kindled Ward (Paladin) — REPLACES the generic shield block
            // below entirely for this class (Track Z1c "Kindled Ward
            // partial mitigation" item): partial (60%) if the cast origin
            // (`cast.x/cast.y` — the caster's position at cast time, this
            // struct's own `attackerPos` equivalent) is in the player's own
            // frontal cone, full damage with NO charge drain if not.
            // `kindled_warded` gates team peel below (TS: `if
            // (!mitigation.warded)`). Only meaningful when `cast.damage >
            // 0` (a status-only entry has no real damage to mitigate), but
            // computed unconditionally alongside the shield-active gate,
            // matching the "nominal 1 damage" trick's own scope.
            var kindled_warded = false;
            // Nominal-damage-carrying seed for the health write below —
            // `nominal` unmodified unless Kindled Ward mitigates it
            // (nominal === cast.damage whenever cast.damage > 0, per this
            // block's own definition above, so mitigating `nominal` here
            // and reading it back below is exactly equivalent to
            // mitigating `cast.damage` directly — no separate recompute
            // needed).
            var damage_after_ward = nominal;
            if (victim.flags.shield_active and
                victim.flags.has_shield_charge and
                victim.shield_charge > 0 and
                victim.character_id == .heavy)
            {
                const dx_aim = victim.aim_x - victim.x;
                const dy_aim = victim.aim_y - victim.y;
                const facing = if (dx_aim == 0.0 and dy_aim == 0.0) 0.0 else trig.lutAtan2(dy_aim, dx_aim);
                const in_cone = combat.isSourceInWardCone(victim.x, victim.y, facing, cast.x, cast.y);
                const mit = combat.computeKindledWardMitigation(nominal, in_cone);
                if (mit.applies) {
                    victim.kindling = @min(KINDLING_MAX, victim.kindling + mit.kindling_granted);
                    kindled_warded = true;
                }
                damage_after_ward = mit.damage;
                // no charge drain either way — fall through to `cast.damage
                // > 0` below.
            } else if (victim.flags.shield_active and
                victim.flags.has_shield_charge and
                victim.shield_charge > 0 and
                victim.character_id != .sprinter)
            {
                // Generic shield block (wizard/priest — see the doc
                // comment above for exactly which mitigation steps this
                // does and doesn't cover). Full block, no overflow carry —
                // matches combat.ts's shield branch exactly (always
                // `damage: 0` on block, never a partial-charge remainder).
                // Ninja/Interstice is EXCLUDED here (LOCKED doctrine: shield
                // never mitigates) — falls straight through unmitigated,
                // same as `shield_active===false`.
                victim.shield_charge -= nominal * combat.SHIELD_HIT_DRAIN_MULTIPLIER;
                if (victim.shield_charge <= 0) {
                    victim.shield_charge = 0;
                    victim.flags.shield_active = false;
                    emitEvent(state, .shield_popped, @intCast(vi), -1, 0, 0, victim.x, victim.y);
                }
                // Blocked: matches TS's `if (mit.evaded || blocked) { ...;
                // continue; }` — no damage, no slow/fooled status either.
                continue;
            }

            if (cast.damage > 0) {
                var final_dmg = damage_after_ward;
                // Rally Light (Track Z1a item 3) — caster-side amp,
                // matches World.ts:4861's `finalDamage *=
                // rallyLightDamageMultiplier(liveCaster, players, aoeTick)`
                // and its position immediately BEFORE the Kindled Resolve
                // amp below (:4862).
                if (hasRallyLightSource(state, cast.caster_idx, tick)) {
                    final_dmg *= KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER;
                }
                // Kindled Resolve (Paladin, Phase 4a follow-up) —
                // caster-side amp, matches World.ts:4662's
                // `finalDamage *= kindledResolveDamageMultiplier(liveCaster, aoeTick)`
                // exactly (the caster is already known in-bounds from this
                // loop's own top-of-function guard above).
                if (state.players[cast.caster_idx].kindled_resolve_until_tick > tick) {
                    final_dmg *= KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER;
                }
                // Team peel (Track Z1c "team peel" item — CLOSES this
                // function's own STUBBED-list entry above): extends a
                // nearby warding Paladin ally's Ward to cover this AOE hit,
                // matching World.ts:5064's `applyTeamPeel(victim, ...)`
                // call in `resolveInstantAoeCasts` exactly. Gated on
                // `!kindled_warded` (Track Z1c "Kindled Ward partial
                // mitigation" item) — TS: `if (!mitigation.warded)`.
                if (!kindled_warded) {
                    final_dmg = applyTeamPeel(state, vi, final_dmg, tick);
                }
                const new_health = @max(0.0, victim.health - final_dmg);
                const was_alive = victim.flags.alive;
                victim.health = new_health;
                victim.flags.alive = new_health > 0;
                emitEvent(
                    state,
                    .hit_confirmed,
                    @intCast(vi),
                    @intCast(cast.caster_idx),
                    0,
                    final_dmg,
                    victim.x,
                    victim.y,
                );
                if (was_alive and new_health <= 0) {
                    creditKill(state, @intCast(cast.caster_idx), @intCast(vi));
                    emitEvent(
                        state,
                        .player_killed,
                        @intCast(vi),
                        @intCast(cast.caster_idx),
                        0,
                        0,
                        victim.x,
                        victim.y,
                    );
                }
            }

            // Slow status — applied whenever the hit wasn't blocked above,
            // independent of whether real damage also landed (Flock
            // Pulse carries both). Same "keep whichever ends later, take
            // the lower (more punishing) multiplier" stacking policy as TS.
            if (cast.has_slow != 0) {
                const dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                const ticks_duration: u32 = @intFromFloat(@ceil(cast.slow_duration_ms / dt));
                const new_until = tick + ticks_duration;
                const prev_until: u32 = if (victim.flags.has_slow) victim.slowed_until_tick else 0;
                const prev_mul: f64 = if (victim.flags.has_slow) victim.slow_multiplier else 1.0;
                // Kindled Resolve (Phase 4a follow-up): resist BEFORE the
                // stacking comparison, so a resisted stagger competes
                // fairly against any pre-existing slow using its
                // actually-applied strength — matches World.ts:4715-4719
                // exactly (`applyKindledResolveStaggerResist(post,
                // cast.slowMultiplier, aoeTick)` runs before the `Math.min`
                // stacking pick). No-op (mul unchanged) for every victim
                // without a live window.
                const resisted_mul: f64 = if (victim.kindled_resolve_until_tick > tick)
                    cast.slow_multiplier + (1.0 - cast.slow_multiplier) * KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION
                else
                    cast.slow_multiplier;
                victim.slowed_until_tick = @max(prev_until, new_until);
                victim.slow_multiplier = @min(prev_mul, resisted_mul);
                victim.flags.has_slow = true;
            }

            // cast.has_fooled: deliberately NOT applied — see
            // PendingInstantAoe.has_fooled's own doc comment (no
            // fooled_until_tick field exists on PlayerEntity yet).
        }
    }
}

// ── MELEE (2026-07-20, base-melee-mechanic gap-closure pass) — Ninja Slash
// + Paladin Kindled Edge swing FSM + arc hit-check. Bit-exact port of the
// TIMING/RANGE/ARC/DAMAGE numbers from World.ts's "1z2. NINJA MELEE"
// (World.ts:4029-4409, SLASH_* constants at 523-553) and "1z3. PALADIN
// MELEE" (World.ts:4412+, EDGE_* constants at 624-674) sections. Scope is
// the BASE melee mechanic — can a Ninja/Paladin swing and land a hit for
// the right damage, at the right range/arc/timing, with shield mitigation
// applying — PLUS (2026-07-20, Phase 1 ability-cast dispatch pass) the 6
// melee-hook ability-card consumption sites Phase 0's own deferral list
// named: Undercut's execute, Read Mark's amp, Second Wind's heal+energy
// (Ninja); Judgment Line's amp, Unbroken Seal's amp+stagger (Paladin); and
// Edge Storm's wave-off-swing. See `stepAbilityDispatch` (below this
// function) for the CAST half of all 6 — this function only holds the
// CONSUMPTION half, at the arc-hit-resolution / active-to-recovery-
// transition sites, matching exactly where World.ts consumes each one.
//
// Deliberately NOT ported here (see this pass's own report for the full
// accounting):
//   - The baseline "energy from contact" grant now DOES run here (Second
//     Wind needs it to add on top of) — PlayerEntity.energy's own doc
//     comment in world_state.zig is updated alongside this cut to reflect
//     that step_world now mutates it at this ONE site, same "name the
//     ownership boundary that changed" discipline this whole goal doc asks
//     for. Dash-through's OWN energy grant is ALSO now ported (a later
//     pass, docs/zig-step-world-parity-goal.md's Razor Route substrate) —
//     but at section 8's dash-through detection block, not here; this
//     function's own melee-contact grant stays a structurally separate
//     site, matching TS's own two-separate-code-paths shape. Wall-kick's
//     energy grant (Wall Bloom's own hook, section 8, unrelated to this
//     paragraph) stays TS-owned/un-ported.
//   - Destructible arc hits — World.ts's own comment marks this path
//     hangout-mode-only. UPDATED (Track E1d): step_world now HAS a hangout
//     mode (g_hangout_mode), so "no Zig analog exists" no longer applies —
//     what still blocks the port is the per-swing destructible dedupe set
//     (TS's mem.hitDestructiblesThisSwing) needing a new field in the
//     ABI-frozen MeleeSwingMemory; recorded in g_hangout_mode's cuts list.
//   - Paper Double arc hits — STILL not ported (UPDATED, this pass: no
//     longer "nothing to hit in practice" — Paper Double now HAS a
//     spawn-on-cast path, world.zig section 6z's `.paper_double` arm, so
//     this is now a real, more-visible gap, not dead weight deferred
//     alongside a nonexistent cast site). A decoy can currently only die
//     by projectile hit or lifetime expiry (both already wired, see
//     section 6y's burst-detection comment below) — a Ninja Slash/Kindled
//     Edge landing on a live decoy does zero damage today. Genuinely
//     deferred, not silently dropped: melee's own arc-hit loop would need
//     a THIRD target category (destructible/paper-double/player) plus a
//     `hitPaperDoublesThisSwing`-equivalent per-swing dedupe set (mirrors
//     `mem.hitPaperDoublesThisSwing`, World.ts:5029-5051) — a real touch
//     surface on already-shipped baseline melee code this pass's own
//     scope (Paper Double's cast + burst, not new melee mechanics) does
//     not cover.
//   - Dash-through body-cross — key off a `dashing` boolean with no Zig
//     PlayerEntity mirror (`PlayerMovementMemory` tracks dash TIMERS, not a
//     wire-visible dashing flag); ported separately (section 8's own
//     dash-through detection block, right after Wall Bloom/Shock Ring's
//     landing hooks — see that block's own doc comment). Ghost Guard is
//     NO LONGER in this list (a prior pass) — corrected finding: it never
//     actually keyed off `dashing` at all, see its own consumption block
//     below. Ninja evasion i-frames (combat.ts step 0.5, a full
//     "untouchable while dashing" mitigation) is ALSO no longer in this
//     list (Track Z1c "ninja dash i-frames" item) — `isNinjaEvading`
//     (near `isAlly`) reads `state.player_movement[idx].dash_active_ms >
//     0.0` directly, the SAME derived-from-timer approach `razor_route_
//     until_tick`'s own doc comment already used for a different
//     consumer — no new PlayerMovementMemory field was needed after all,
//     just a damage-resolution-site reader.
//
// MITIGATION — re-derived independently here and confirmed byte-for-byte
// against combat.ts, landing on the SAME finding resolveInstantAoeCasts's
// own doc comment already documents for null-projectile hits:
// `tryDeflectDamage`'s parry branches (combat.ts:592,625) AND the
// directional-shield facing check (combat.ts:790) are ALL gated
// `projectile !== null`. BOTH World.ts melee call sites pass
// `tryDeflectDamage(victim, null, ...)` — so **parry never applies to a
// melee hit in TS**, despite this task's own brief assuming the opposite
// ("confirm parry ... DOES apply here since melee ... passes a real attack
// context that can be parried"); the actual source contradicts that
// assumption, and TS parity wins — no parry check exists anywhere below.
// Directional shield's facing gate is likewise skipped for melee (same
// `projectile !== null` guard), so an equipped directional shield fully
// blocks a melee hit from ANY angle, not just the front — exactly the same
// port resolveInstantAoeCasts already made for AOE casts. Paladin's
// Kindled Ward (a PARTIAL mitigation, not the generic 100% block) is NO
// LONGER unimplemented (Track Z1c "Kindled Ward partial mitigation" item)
// — `combat.isSourceInWardCone`/`combat.computeKindledWardMitigation`
// REPLACE the generic shield block below for a Paladin specifically, at
// this site AND section 4's projectile path AND resolveInstantAoeCasts
// (all three now consistent); Ninja is EXCLUDED from the generic block
// too (LOCKED doctrine: shield never mitigates for that class). Syzygist
// Ward (Self-Lattice, this pass)
// is DIFFERENT from Kindled Ward in exactly this respect: verified
// directly against combat.ts, `trySyzygistWard`'s branch inside
// `tryDeflectDamage` (1.7) has NO `projectile !== null` guard — unlike
// parry/directional-shield above, it applies uniformly to melee AND ranged
// hits alike, so a melee consumption site is not "inventing" anything, it's
// closing a real gap the parry/directional-shield precedent above does NOT
// extend to. See this function's own arc-hit loop for the consumption.
//
// PLACEMENT / WRITE STRATEGY: runs as its own section "6a", positioned
// AFTER section 6's per-player shield/parry/weapon-fire loop finishes for
// EVERY player (so a shield raised THIS tick already blocks, same
// ordering guarantee section 6b's AOE resolver relies on) and BEFORE
// section 6b. Resolved INLINE (direct `state.players[victim_idx]` field
// writes during the attacker's own loop iteration), NOT deferred through a
// pending-write queue like section 6b's AOE primitive: that queue exists
// because TS's OWN per-player loop uses an immutable
// snapshot-then-commit-at-end-of-turn pattern (`players[pid] = nextEntity`
// from a frozen `entity` read at the top of the SAME player's turn), where
// a cross-player write landing mid-loop gets silently overwritten the
// moment the victim's own turn later commits ITS stale snapshot. Zig has
// no such hazard: every mutation in this file (section 4's projectile-vs-
// player resolution, section 8b's burn DoT, and section 6a below) is a
// direct in-place field mutation (`victim.health -= dmg`) on the single
// shared `state.players` array — nothing anywhere in stepWorld ever
// replaces another player's WHOLE struct wholesale, so there is no stale
// snapshot for a later iteration to commit over a melee hit's damage
// write. Section 4's own projectile-vs-player loop is the closest existing
// precedent: it already does exactly this "read attacker, write victim,
// mid-loop, inline" pattern today, safely.
// pub (2026-07-20, Phase 5 test-fragility fix): these were plain `const`
// (module-private) until smoke.zig's melee tests broke against this exact
// file's own same-day balance pass (damage+timing halved together) —
// the tests hardcoded literal expected values (`78.0` meaning `100 -
// SLASH_DAMAGE`'s OLD 22) instead of referencing the constant, so a
// legitimate tuning change silently desynced them. Exported so
// smoke.zig can assert against `root.world.SLASH_DAMAGE` etc. directly —
// robust to future tuning by construction, not by manual test upkeep.
pub const SLASH_RANGE: f64 = 78.0;
pub const SLASH_ARC_RADIANS: f64 = (5.0 * std.math.pi) / 9.0;
// 2026-07-20 balance pass ("hits faster, same DPS"): damage + the three
// commit-frame timings below scaled by a uniform 0.5x together (22->11,
// 430ms->215ms cycle) — bit-exact mirror of World.ts's own comment/math.
// 2026-07-26 balance pass (finish-line-goal.md Track B, banked finding a):
// 11->14, cadence untouched this time (a deliberate DPS raise, not a
// neutral rescale) — bit-exact mirror of World.ts's own SLASH_DAMAGE doc
// comment, which has the full sustained-DPS measurement.
pub const SLASH_DAMAGE: f64 = 14.0;
pub const SLASH_KNOCKBACK: f64 = 260.0;
pub const SLASH_KNOCK_UP: f64 = 60.0;
pub const SLASH_WINDUP_MS: f64 = 60.0;
pub const SLASH_ACTIVE_MS: f64 = 45.0;
pub const SLASH_RECOVERY_MS: f64 = 110.0;
pub const SLASH_CONTACT_DELAY_MS: f64 = 22.0;

pub const EDGE_RANGE: f64 = 84.0;
pub const EDGE_ARC_RADIANS: f64 = (7.0 * std.math.pi) / 18.0;
// 2026-07-26 balance pass (finish-line-goal.md Track B, banked finding a):
// 32->38 — bit-exact mirror of World.ts's own EDGE_DAMAGE doc comment,
// which has the full sustained-DPS measurement (shield-bash's mixed-in
// third beat pulled the chain-average below the original bare-swing DPS).
pub const EDGE_DAMAGE: f64 = 38.0;
pub const EDGE_KNOCKBACK: f64 = 420.0;
pub const EDGE_KNOCK_UP: f64 = 110.0;
pub const EDGE_WINDUP_MS: f64 = 200.0;
pub const EDGE_ACTIVE_MS: f64 = 110.0;
pub const EDGE_RECOVERY_MS: f64 = 340.0;
pub const EDGE_CONTACT_DELAY_MS: f64 = 100.0;

/// Melee input buffer window (ms), BOTH classes — slash-feel-ledger R1
/// row 1 (2026-07-24). Bit-exact mirror of World.ts's MELEE_BUFFER_MS;
/// consumed in stepMeleeSwing's FSM (queue on a mid-swing press, fire at
/// phase 0 on the recovery→idle transition tick).
pub const MELEE_BUFFER_MS: f64 = 100.0;

// ── KINDLED SHIELD BASH (2026-07-24, slash-feel-ledger design-decision
// block) — every THIRD Edge swing is the slab-led BASH: low damage, the
// game's biggest knockback, brief stagger. Bit-exact mirrors of World.ts's
// SHIELD_BASH_* / KIN_BASH_CHAIN_GAP_MS; the chain state itself lives in
// MeleeSwingMemory.chain_index/chain_gap_ms (world_state.zig). Same FSM
// phase timings as Edge — only reach/arc/damage/knockback/contact-gate
// swap per verb.
pub const SHIELD_BASH_RANGE: f64 = 62.0;
pub const SHIELD_BASH_ARC_RADIANS: f64 = (5.0 * std.math.pi) / 9.0;
pub const SHIELD_BASH_DAMAGE: f64 = 14.0;
pub const SHIELD_BASH_KNOCKBACK: f64 = 760.0;
pub const SHIELD_BASH_KNOCK_UP: f64 = 260.0;
pub const SHIELD_BASH_CONTACT_DELAY_MS: f64 = 60.0;
pub const SHIELD_BASH_STAGGER_MS: f64 = 300.0;
pub const SHIELD_BASH_STAGGER_MULTIPLIER: f64 = 0.55;
pub const KIN_BASH_CHAIN_GAP_MS: f64 = 350.0;
/// KINDLED CANCEL WINDOW (2026-07-24 wave 2, slash-feel-ledger R1 row 16)
/// — dash/ward may cancel the FINAL 40% of Edge recovery. Bit-exact mirror
/// of World.ts's KIN_CANCEL_TAIL_FRACTION; see that constant's doc block
/// for the full design (rising-edge triggers only, engaged-ward gate, and
/// the "a queued swing WINS over a cancel" precedence).
pub const KIN_CANCEL_TAIL_FRACTION: f64 = 0.4;

// ── NINJA STAB (2026-07-26, finish-line-goal.md Track F1) — Interstice's
// own chain's third beat, a linear thrust. Bit-exact mirrors of World.ts's
// NINJA_STAB_*; the chain state itself lives in the SAME
// MeleeSwingMemory.chain_index/chain_gap_ms the Kindled bash uses (see that
// struct's own doc comment, world_state.zig). Same FSM phase timings as the
// ordinary slash — only reach/arc/damage/knockback/contact-gate swap per
// verb. Every number here is a JUDGMENT CALL per World.ts's own doc
// comments on these constants (not a transcribed spec) — see those comments
// for the per-constant reasoning this mirrors bit-for-bit.
pub const NINJA_STAB_RANGE: f64 = 104.0;
pub const NINJA_STAB_ARC_RADIANS: f64 = std.math.pi / 6.0;
pub const NINJA_STAB_DAMAGE: f64 = 14.0;
pub const NINJA_STAB_KNOCKBACK: f64 = 340.0;
pub const NINJA_STAB_KNOCK_UP: f64 = 30.0;
pub const NINJA_STAB_CONTACT_DELAY_MS: f64 = 12.0;
pub const NINJA_STAB_CHAIN_GAP_MS: f64 = 785.0;

// ── Ability-cast dispatch (Phase 1, docs/zig-step-world-parity-goal.md
//    "the next unblock") — constants for the 6 melee-hook abilities wired
//    this pass. Bit-exact port of the matching World.ts/constants.ts
//    values (re-verified live, not from the goal doc's own citations —
//    doctrine #1/#6).
// Ninja — Undercut (constants.ts:1031).
const NINJA_UNDERCUT_HEALTH_THRESHOLD: f64 = 15.0;
// Ninja — Read Mark (constants.ts:1058-1059).
const NINJA_READ_MARK_RANGE_PX: f64 = 340.0;
pub const NINJA_READ_MARK_AMP_MULTIPLIER: f64 = 1.28;
// Ninja — Second Wind (constants.ts:1091-1092) + the baseline per-hit
// energy grant it tops up (World.ts:576/582 NINJA_ENERGY_MAX/
// NINJA_ENERGY_ON_MELEE_HIT — see this pass's own report for why the
// baseline grant is now in scope alongside Second Wind).
const NINJA_ENERGY_MAX: f64 = 100.0;
const NINJA_ENERGY_ON_MELEE_HIT: f64 = 10.0;
// Dash-through body-cross's own baseline energy grant (World.ts:602
// NINJA_ENERGY_ON_DASH_THROUGH), same "top-up an existing resource" shape
// as NINJA_ENERGY_ON_MELEE_HIT immediately above — this pass (docs/zig-
// step-world-parity-goal.md, Razor Route substrate), consumed in world.zig
// section 8's own dash-through detection block, not stepMeleeSwing.
const NINJA_ENERGY_ON_DASH_THROUGH: f64 = 15.0;
const NINJA_SECOND_WIND_HEAL: f64 = 12.0;
const NINJA_SECOND_WIND_ENERGY: f64 = 30.0;
// Ninja — Edge Storm (constants.ts:1039-1040) + the wave-off-swing
// projectile it gates (World.ts:566-570 WAVE_*). The wave ONLY ever
// spawns while Edge Storm is live and has charges — TS's own comment at
// the spawn site is explicit ("without Edge Storm live, the swing is
// melee-only"), so there is no separate "always-on wave" mechanic to port
// underneath this — Edge Storm's window IS the wave's entire gate.
const NINJA_EDGE_STORM_CHARGES: u32 = 3;
const NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER: f64 = 2.2;
const WAVE_RANGE: f64 = 260.0;
const WAVE_SPEED: f64 = 780.0;
const WAVE_LIFETIME_MS: f64 = 333.0; // Math.round((260/780)*1000), World.ts:568
const WAVE_DAMAGE: f64 = 10.0;
const WAVE_RADIUS: f64 = 10.0;
// Paladin — Judgment Line (constants.ts:257-259).
const KIN_JUDGMENT_AMP_MULTIPLIER: f64 = 1.3;
const KIN_JUDGMENT_RANGE_PX: f64 = 420.0;
const KIN_JUDGMENT_CONE_RADIANS: f64 = (60.0 * std.math.pi) / 180.0;
// Paladin — Unbroken Seal (constants.ts:267-268/272).
const KIN_SEAL_DAMAGE_MULTIPLIER: f64 = 1.45;
const KIN_SEAL_STAGGER_MS: f64 = 900.0;
const KIN_SEAL_STAGGER_MULTIPLIER: f64 = 0.25;
// Paladin — Kindled Resolve (constants.ts:416-423). Self-only outgoing-
// damage amp + incoming-stagger-resist window. Consumption sites shipped
// Phase 4a follow-up; the CAST itself (spend Kindling, open the window)
// shipped Track Z5 item 1 — see `.kindled_resolve`'s own switch arm below.
const KIN_KINDLED_RESOLVE_KINDLING_COST: f64 = 40.0;
const KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER: f64 = 1.1;
/// Fraction of an incoming stagger's SEVERITY removed while Kindled Resolve
/// is live on the VICTIM: `resisted = mul + (1 - mul) * this` — mirrors
/// TS's `applyKindledResolveStaggerResist` exactly (World.ts:941-950).
const KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION: f64 = 0.5;

// ── Phase 4b targeting/marking constants (docs/zig-step-world-parity-goal.md
//    "4b. Targeting/marking") — Facet Break/Focus Hex. Unlike the melee-hook
//    marks above (Judgment Line/Read Mark, consumed by `stepMeleeSwing`),
//    both of these are consumed at the generic ranged-hit-resolution site
//    in section 4 below (mirrors World.ts's `resolveRangedHit`, which
//    amplifies ANY ranged hit — basic weapon fire included, not just
//    ability projectiles — landing on the marked victim).
// Wizard — Facet Break (constants.ts:83-87). Cone-gated, same targeting
// shape as Judgment Line above (verified directly against World.ts's
// "facet-break" case — its own inline scan has no team/ally check either,
// same "team-awareness deferral" `findNearestEnemyInCone` already documents).
const GEO_FACET_BREAK_AMP_MULTIPLIER: f64 = 1.25;
const GEO_FACET_BREAK_RANGE_PX: f64 = 900.0;
const GEO_FACET_BREAK_CONE_RADIANS: f64 = (60.0 * std.math.pi) / 180.0;
// Priest — Focus Hex (constants.ts:800). Omnidirectional, no cone — same
// targeting shape as Read Mark above (verified directly against World.ts's
// "focus-hex" case: `findNearestEnemy(nextEntity, state.players,
// SYZ_ENEMY_SEARCH_RANGE_PX)`, no cone argument). SYZ_ENEMY_SEARCH_RANGE_PX
// (constants.ts:726) is a range TS reuses across several Syzygist
// abilities — Focus Hex is the only one that reads it in Zig today, the
// others sharing it are still unported (Phase 4d/4e).
const SYZ_FOCUS_HEX_AMP_MULTIPLIER: f64 = 1.28;
const SYZ_ENEMY_SEARCH_RANGE_PX: f64 = 420.0;

// ── AOE-queue ability constants (this pass — the 2nd half of Phase 1's own
//    "first real abilities" list: Wall Bloom, Shock Ring, Prism Fan, Flock
//    Pulse, Shard Ring push onto the `PendingInstantAoe` queue from commit
//    4340859; Paper Double's cast spawns a `PaperDoubleEntity` and its
//    death/expiry burst ALSO pushes onto that same queue). Bit-exact port
//    of the matching World.ts/constants.ts values (re-verified live —
//    doctrine #1/#6), same "duplicated as a local constant, not exported"
//    convention the Phase 1 block above already establishes.
// Wizard — Prism Fan (constants.ts:100-102). Damage is BUILD-SCALED
// (`build.damage * GEO_PRISM_FAN_DAMAGE_MULTIPLIER`), unlike every other
// AOE ability in this block — verified directly against World.ts's
// "prism-fan" case, not assumed; `state.player_fire_config[idx].damage`
// is step_world's own mirror of `build.damage` (same value weapon fire
// already reads at this same struct field).
const GEO_PRISM_FAN_CONE_RADIANS: f64 = (50.0 * std.math.pi) / 180.0;
const GEO_PRISM_FAN_DAMAGE_MULTIPLIER: f64 = 0.5;
const GEO_PRISM_FAN_RANGE_PX: f64 = 260.0;
// Ninja — Shard Ring (constants.ts:1076-1077). Flat constant damage, NOT
// build-scaled — verified directly against World.ts's "shard-ring" case
// (`damage: NINJA_SHARD_RING_DAMAGE`, no `build.damage` factor anywhere
// in that case).
const NINJA_SHARD_RING_RADIUS_PX: f64 = 150.0;
const NINJA_SHARD_RING_DAMAGE: f64 = 14.0;
// Ninja — Wall Bloom (constants.ts:1085-1086). Flat constant damage, same
// "not build-scaled" verification as Shard Ring above. Wall-contact-point
// offset mirrors World.ts's own `PLAYER_BODY_WIDTH / 2 + 6` (player.ts:
// bodyWidth 26, half 13) — a local constant rather than importing
// PLAYER_BODY_WIDTH, matching PAPER_DOUBLE_BODY_HALF_W's own "duplicated,
// not imported" precedent right above this function's start.
const NINJA_WALL_BLOOM_RADIUS_PX: f64 = 110.0;
const NINJA_WALL_BLOOM_DAMAGE: f64 = 10.0;
const NINJA_WALL_BLOOM_WALL_OFFSET_PX: f64 = 13.0 + 6.0;
// Paladin — Shock Ring (constants.ts:339-342). Flat constant damage, same
// "not build-scaled" verification. The hop's arm-window duration is read
// from the card's own `active.durationMs` (1500, cards.ts) at the cast
// site below, matching the Undercut/Second Wind/etc. precedent of reading
// `active_spec.duration_ms` rather than duplicating the window length as
// a second constant — KIN_SHOCK_RING_ARM_WINDOW_MS is named here purely
// for doc-comment cross-reference, never read directly.
const KIN_SHOCK_RING_HOP_VY: f64 = 420.0;
const KIN_SHOCK_RING_ARM_WINDOW_MS: f64 = 1500.0; // == the "shock-ring" card's active.durationMs
const KIN_SHOCK_RING_DAMAGE: f64 = 18.0;
const KIN_SHOCK_RING_RADIUS_PX: f64 = 170.0;
// Priest — Flock Pulse (constants.ts:824-828). BASE damage only — the
// ally/enemy "source count" scaling term (SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE
// × sourceCount × syzygistLeadBrakeMultiplier) reads TS-only ally-buff-
// carrier tracking (regenSourceId/hasteSourceId/wardAbsorbSourceId/
// burnSourceId — none exist on Zig's PlayerEntity, all Phase 3 ally-
// targeting-substrate-adjacent) — verified directly against World.ts's
// "flock-pulse" case, not guessed. DEFERRED, not silently dropped: this
// port always resolves sourceCount as 0 (the correct, honest solo-case
// value — a Zig Syzygist genuinely carries no ally/enemy buff sources
// today, since nothing upstream populates those source-id fields), so
// every Zig Flock Pulse cast does exactly SYZ_FLOCK_PULSE_BASE_DAMAGE —
// bit-exact parity with what TS itself would compute for a solo caster
// with zero live buffs, never an invented substitute shape.
const SYZ_FLOCK_PULSE_BASE_DAMAGE: f64 = 8.0;
const SYZ_FLOCK_PULSE_RADIUS_PX: f64 = 170.0;
const SYZ_FLOCK_PULSE_SLOW_MULTIPLIER: f64 = 0.8;
const SYZ_FLOCK_PULSE_SLOW_DURATION_MS: f64 = 1200.0;
// Ninja — Paper Double (constants.ts:1114-1132). Cast spawns a
// PaperDoubleEntity (mechanics already ported, commit 6aa0dc9 — this pass
// wires the SPAWN only); its death/expiry burst is a SECOND, later push
// onto the same `PendingInstantAoe` queue (see the burst-detection block
// in stepWorld's section "6b" below for the tick-order trace). The
// resonance-gated SWAP branch (World.ts:4174-4221, "cast into a live
// window: swap places with the decoy instead") is DELIBERATELY NOT
// ported — grepped directly: no `resonance` field/concept exists
// anywhere in sim/src/ today (Zig has no resonance system at all yet),
// so the swap branch's eligibility condition can never be true here —
// this port always takes TS's OWN "v1 always SPAWNS when the swap isn't
// eligible" fallback path, which is exactly what a resonance-less caster
// gets in TS too, not an invented shortcut.
const NINJA_PAPER_DOUBLE_SPEED: f64 = 362.0;
const NINJA_PAPER_DOUBLE_MAX_HEALTH: f64 = 20.0;
const NINJA_PAPER_DOUBLE_LIFETIME_MS: f64 = 2500.0;
const NINJA_PAPER_DOUBLE_BURST_RADIUS_PX: f64 = 90.0;
const NINJA_PAPER_DOUBLE_BURST_DAMAGE: f64 = 10.0;
const NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX: f64 = 5.0;
// Paper Double's burst carries a fooled-debuff duration into the
// PendingInstantAoe entry (has_fooled/fooled_duration_ms — forward-compat
// fields the primitive already reserves, see PendingInstantAoe.has_fooled's
// own doc comment in world_state.zig) even though `resolveInstantAoeCasts`
// does not apply it yet (no `fooled_until_tick` field on PlayerEntity) —
// same "carry the value now, the field-growth pass only touches the
// resolver later" reasoning that doc comment already documents.
const NINJA_FOOLED_DURATION_MS: f64 = 2000.0;

// ── Phase 4a self-only window-buff constants (docs/zig-step-world-parity-
//    goal.md "4a. Self-only window buffs" — Sunlance/Overclock/Measure
//    (Geometrician catalog v1) + Return Glass/Bastion Pulse's instant
//    shield-charge ticks). Bit-exact port of the matching
//    World.ts/weapon.ts/constants.ts values (re-verified live —
//    doctrine #1/#6), same "duplicated as a local constant, not exported"
//    convention every other block in this file already establishes.
// Wizard — Sunlance (constants.ts:82, weapon.ts:401-423). Composes with
// Measure below via the SAME priority chain weapon.ts uses (Sunlance wins
// if both windows are somehow live) — Stolen Fangs, which TS ranks ABOVE
// Sunlance in that same chain, has no Zig mirror anywhere
// (pendingLockCharges — unrelated to this pass), so this port's chain
// correctly starts at Sunlance, exactly what a Stolen-Fangs-less TS caster
// would compute anyway.
const GEO_SUNLANCE_DAMAGE_MULTIPLIER: f64 = 1.6;
// Wizard — Overclock (constants.ts:126-127, weapon.ts:339-342/558-565).
// Fire rate up AND spread tighter while live — UNLESS Measure is also
// live, which forces spread all the way to 0 and wins that one sub-term
// (weapon.ts:353-355's own "measureActive ? ... : overclockActive ? ...
// : 1" chain).
const GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER: f64 = 1.35;
const GEO_OVERCLOCK_SPREAD_MULTIPLIER: f64 = 0.7;
// Wizard — Measure (constants.ts:145/150, weapon.ts:343-355/411-423,
// reworked 2026-07-19 per that field's own types.ts doc comment — v1's
// original +1-ammo effect is gone, this is the CURRENT mechanic). Spread
// forced to exactly 0 (dead-center shots) plus a smaller damage amp than
// Sunlance's, ranked BELOW it in the damage-priority chain (never stacks).
const GEO_MEASURE_SPREAD_MULTIPLIER: f64 = 0;
const GEO_MEASURE_DAMAGE_MULTIPLIER: f64 = 1.3;
// Wizard — Recoil Step (constants.ts:129/157, World.ts's "recoil-step"
// case + weapon.ts:589-604's rider read — Track Z0c Item A closes the
// Phase 4a deferral now that ResolvedFireConfig carries the resolved
// recoil the rider scales). Instant hop opposite the aim direction (0.6
// vertical factor at cast) + the rider window: fire self-knockback × 0.3
// while live, consumed at section 6's fire site below.
const GEO_RECOIL_STEP_HOP_SPEED: f64 = 220.0;
const GEO_RECOIL_STEP_RECOIL_MULTIPLIER: f64 = 0.3;
// Wizard — Return Glass (constants.ts:125, World.ts's "return-glass" case).
// Instant self-shield-charge tick, capped at the resolved build's own max
// charge — no window field needed at all (unlike every sibling in this
// block), consumed immediately at cast time against the SAME shield_charge/
// shield_charge_mul substrate section 6's tickShield already reads/writes
// every tick (combat.zig's tickShield, world.zig's cfg3/has3 pattern).
const GEO_RETURN_GLASS_SHIELD_REFUND: f64 = 22.0;
// Paladin — Bastion Pulse (constants.ts:234-235, World.ts's "bastion-pulse"
// case). Same instant shield-charge-tick shape as Return Glass immediately
// above, doubled if `shield_active` is already true AT CAST TIME — reads
// `attacker.flags.shield_active` directly, which section 6's tickShield
// (this SAME tick, always running before section 6z's dispatch — see
// `stepAbilityDispatch`'s own file-level ordering doc comment) has already
// refreshed from this tick's held Shield input, matching World.ts's own
// `nextEntity.shieldActive` read (tickShield/its TS equivalent similarly
// runs before the ability-cast switch in World.ts's per-player loop).
const KIN_BASTION_PULSE_SHIELD_REFUND: f64 = 22.0;
const KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER: f64 = 2.0;

// ── Phase 4c: movement (docs/zig-step-world-parity-goal.md "4c. Movement")
// — constants.ts's own range exports for the 4 abilities that share
// findCollisionFreeLanding below (Slip Node/Plant Charge/Bulwark Step/
// Drift Step). Razor Route was DELIBERATELY absent from this group — verified
// directly against World.ts's "razor-route" case, it is not a
// landing-search blink at all (a TS-side additive velocity impulse on the
// existing always-on dash, plus a Read-mark byproduct write); it's SHIPPED
// now (this pass) via its own dash-through substrate, see world.zig section
// 8's own dash-through detection block and this file's `.razor_route`
// dispatch arm.
const GEO_SLIP_NODE_RANGE_PX: f64 = 280.0;
const KIN_PLANT_CHARGE_RANGE_PX: f64 = 190.0;
const KIN_PLANT_CHARGE_SHIELD_REFUND: f64 = 12.0;
const KIN_BULWARK_STEP_RANGE_PX: f64 = 110.0;
const SYZ_DRIFT_STEP_RANGE_PX: f64 = 210.0;
// Ninja — Razor Route (constants.ts:1071/1114). SHIPPED this pass (docs/
// zig-step-world-parity-goal.md) — see the comment block immediately above
// for why it doesn't belong in the findCollisionFreeLanding group.
const NINJA_RAZOR_ROUTE_READ_MARK_MS: f64 = 3000.0;
const NINJA_RAZOR_ROUTE_BOOST_SPEED: f64 = 260.0;

// ── Phase 4a follow-up (this pass, docs/zig-step-world-parity-goal.md —
//    closing Hard Aperture's original deferral): Self-Lattice (Priest).
//    Writes the same `wardAbsorbUntilTick`/`wardAbsorbRemaining` pair
//    Glass Ward/Aegis Share (still-deferred siblings) would also write —
//    self-cast only, bypassing the isAlly team gate entirely (World.ts's
//    "self-lattice" case writes `nextEntity`'s own fields directly, never
//    routes through `applyWardToAlly`). SYZ_WARD_DURATION_TICKS_DEFAULT is
//    a RAW TICK COUNT in TS (constants.ts:678 — `Math.round(6000 /
//    STEP_MS)`, STEP_MS = 1000/60), not a `durationMs` on the card's own
//    `active` spec (cards.ts's "self-lattice" entry has no `durationMs` at
//    all) — mirrored here as a literal tick count for the same reason,
//    NOT re-derived via `eff_dt` the way every `active_spec.duration_ms`-
//    driven window above is (this one has no ms source to divide).
const SYZ_WARD_DURATION_TICKS_DEFAULT: u32 = 360;
const SYZ_SELF_LATTICE_ABSORB: f64 = 20.0;

// ── Phase 4e: structurally distinct abilities (docs/zig-step-world-parity-
//    goal.md "4e. Structurally distinct, port individually") — Sunspike/
//    Needle/Severance/Contagion/Lattice, each with its own real mechanic,
//    no shared substrate built first. Bit-exact port of the matching
//    World.ts/constants.ts values (re-verified live — doctrine #1/#6), same
//    "duplicated as a local constant, not exported" convention every
//    earlier sub-group's own block already establishes.
// Priest/Syzygist — Bleed Tithe (constants.ts:746-758). SHIPPED in a
// later pass than the rest of this group (this pass, docs/zig-step-world-
// parity-goal.md) — originally deferred here because Zig's element on-hit
// switch had no `.fire` arm and `leech_fraction` had zero readers; both
// gaps are closed now (see the element switch in section 4 and its
// sibling leech-heal block right after it).
const SYZ_BLEED_TITHE_DAMAGE: f64 = 26.0;
const SYZ_BLEED_TITHE_LEECH_FRACTION: f64 = 0.35;
const SYZ_BLEED_TITHE_SPEED: f64 = 1100.0;
const SYZ_BLEED_TITHE_HOMING_STRENGTH: f64 = 5.5;
// Paladin/Kindled — Sunspike (constants.ts:249-251).
const KIN_SUNSPIKE_DAMAGE: f64 = 40.0;
const KIN_SUNSPIKE_RANGE_PX: f64 = 150.0;
const KIN_SUNSPIKE_SPEED: f64 = 1500.0;
// Ninja — Needle (constants.ts:1055-1058).
const NINJA_NEEDLE_RANGE_PX: f64 = 300.0;
const NINJA_NEEDLE_LUNGE_PX: f64 = 230.0; // 2026-07-20 gap-closer pass, see constants.ts
const NINJA_NEEDLE_DAMAGE: f64 = 36.0;
const NINJA_NEEDLE_SPEED: f64 = 1400.0;
// Priest/Syzygist — Severance (constants.ts:767-768).
const SYZ_SEVERANCE_DAMAGE: f64 = 34.0;
const SYZ_SEVERANCE_SPEED: f64 = 1300.0;
// Priest/Syzygist — Contagion (constants.ts:808-809).
const SYZ_CONTAGION_RADIUS_PX: f64 = 260.0;
const SYZ_CONTAGION_JUMP_RADIUS_PX: f64 = 220.0;
// Wizard/Geometrician — Lattice (constants.ts:122-124).
const GEO_LATTICE_ZONE_RADIUS_PX: f64 = 150.0;
const GEO_LATTICE_ZONE_DURATION_MS: f64 = 2200.0;
const GEO_LATTICE_ZONE_DPS: f64 = 11.0;

// ── Track Z1a item 3: ally substrate + the four ally-targeted abilities
//    (convergence-goal.md Z1 — the oldest named deferral block). Bit-exact
//    mirror of the matching constants.ts/combat.ts values (re-verified
//    live), same "duplicated as a local constant, not exported" convention
//    as every block above.
// Kindled — Rally Light (constants.ts:361-363). Consumed at the
// movement speed-mul composition (section 7), section 4's ranged amp, and
// resolveInstantAoeCasts' AOE amp — the EXACT TS consumption set
// (World.ts:2552/1844/4861; TS melee sites apply kindledResolve but NOT
// rally, verified by grep, despite :1844's own prose).
const KIN_RALLY_LIGHT_RADIUS_PX: f64 = 220.0;
const KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER: f64 = 1.12;
const KIN_RALLY_LIGHT_MOVE_MULTIPLIER: f64 = 1.08;
// Kindled — Aegis Share (constants.ts:286/300; the search radius factors
// combat.ts's WARD_PEEL_RADIUS_PX=160 — mirrored here rather than imported
// from combat.zig, which predates the team-peel port itself: this Aegis
// Share window landed in Track Z1a, BEFORE Track Z1c's "team peel" item
// added combat.zig's own WARD_ARC_RADIANS/WARD_MITIGATION_FRACTION/
// KINDLING_PER_DAMAGE_BLOCKED — kept as the local duplicate rather than
// re-plumbed, since `findTeamPeelWarderIdx` (below, near `isAlly`) ALSO
// reads these two locals directly and world.zig already establishes the
// "duplicated as a local constant, not exported" convention for every
// other ability constant on this file).
const KIN_AEGIS_SHARE_RADIUS_MULTIPLIER: f64 = 1.6;
const KIN_AEGIS_SHARE_SOLO_KINDLING_FEED: f64 = 12.0;
const WARD_PEEL_RADIUS_PX: f64 = 160.0;
/// combat.ts:131 — the kindling resource cap (Aegis Share's solo
/// fallback is the FIRST kindling write anywhere in sim/src, see the
/// kindled_resolve arm's own "ZERO writes" audit note). Team peel's own
/// kindling grant (`applyTeamPeel`, Track Z1c) reuses this same constant.
const KINDLING_MAX: f64 = 100.0;
// Syzygist — shared ally auto-target range (constants.ts:719).
const SYZ_ALLY_SEARCH_RANGE_PX: f64 = 320.0;
// Syzygist — Borrowed Time (constants.ts:780-786). DEBT_DELAY_TICKS is a
// RAW TICK COUNT in TS (`Math.round(6000 / STEP_MS)`, STEP_MS=1000/60 →
// 360) — mirrored as a literal, same reasoning as
// SYZ_WARD_DURATION_TICKS_DEFAULT above.
const SYZ_BORROWED_TIME_HEAL_ALLY: f64 = 30.0;
const SYZ_BORROWED_TIME_DRAIN_ALLY: f64 = 15.0;
const SYZ_BORROWED_TIME_HEAL_SELF: f64 = 15.0;
const SYZ_BORROWED_TIME_DRAIN_SELF: f64 = 8.0;
const SYZ_BORROWED_TIME_DEBT_DELAY_TICKS: u32 = 360;
// Syzygist — Glass Ward (constants.ts:695/701); duration reuses
// SYZ_WARD_DURATION_TICKS_DEFAULT above (TS applyWardToAlly's own
// default), absorb amounts per branch.
const SYZ_GLASS_WARD_ALLY_ABSORB: f64 = 45.0;
const SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB: f64 = 28.0;

/// Half-extent of the REAL player body box (PLAYER_BODY_WIDTH=26 /
/// PLAYER_BODY_HEIGHT=56 in player.ts) — the box World.ts's own
/// `centerToAABB(cx, cy, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT)` uses inside
/// EVERY landing-search loop (slip-node/plant-charge/bulwark-step/
/// drift-step cases), NOT this file's looser PLAYER_HALF_W=15/
/// PLAYER_HALF_H=28 approximation used elsewhere (section 4's player-hit
/// loop, launch pads) — same real-body precedent Paper Double's own
/// PAPER_DOUBLE_BODY_HALF_W/H already established. PLAYER_HALF_HEIGHT
/// (defined above, =28) already matches PLAYER_BODY_HEIGHT/2 exactly, so
/// only the half-width needs its own name here.
const MOVE_SEARCH_HALF_W: f64 = 13.0;

/// The "farthest-collision-free-landing search" substrate Slip Node/Plant
/// Charge/Bulwark Step/Drift Step all share — verified independently
/// against each ability's own World.ts case (not assumed from the goal
/// doc's "there's likely one shared shape here too" hedge): all 4 run the
/// EXACT same loop shape (step inward from `max_range` to 24px in 12px
/// decrements, reject any candidate that fails the arena-bounds check or
/// overlaps a static's AABB, take the first — i.e. FARTHEST — clear point),
/// differing only in their direction vector, range, and what they do with
/// the landing point once found (Bulwark Step also skips vertical bound
/// checking since it's horizontal-only, but running the same y-check on a
/// dir_y=0 candidate is a harmless no-op: cy stays `origin_y`, already
/// valid). World.ts itself keeps these as 4 separate inline loops rather
/// than a shared TS helper ("kept as its own small loop rather than a
/// shared helper, so tuning one never silently retunes the other" — the
/// slip-node case's own comment) — that reasoning is about NOT
/// cross-wiring each ability's TUNING (range/direction), which this Zig
/// port still keeps fully separate (each call site passes its own
/// range/direction); only the pure search MECHANICS (arithmetic with zero
/// per-ability tuning inside the loop body) are shared, so one Zig helper
/// serving 4 callers carries none of the "silent retune" risk TS's own
/// comment is guarding against — this is exactly the "build the substrate
/// once" shape Phase 3's ally-targeting helpers already set precedent for.
///
/// Returns true and writes `*out_x`/`*out_y` on the first (farthest) clear
/// candidate; returns false (out params untouched) if the WHOLE range is
/// blocked — callers must leave `activated` false in that case (a press
/// that finds no landing spot is a dead press: no cooldown burn, no state
/// change — the same legibility-law precedent Shadow Step's blocked-blink/
/// Judgment Line's no-target case already establish elsewhere in this
/// switch).
fn findCollisionFreeLanding(
    origin_x: f64,
    origin_y: f64,
    dir_x: f64,
    dir_y: f64,
    max_range: f64,
    statics: []const collision_types.AABB,
    out_x: *f64,
    out_y: *f64,
) bool {
    var d: f64 = max_range;
    while (d >= 24.0) : (d -= 12.0) {
        const cx = origin_x + dir_x * d;
        const cy = origin_y + dir_y * d;
        if (cx < MOVE_SEARCH_HALF_W) continue;
        if (g_arena_size_x > 0 and cx > g_arena_size_x - MOVE_SEARCH_HALF_W) continue;
        if (cy < PLAYER_HALF_HEIGHT) continue;
        if (g_arena_size_y > 0 and cy > g_arena_size_y - PLAYER_HALF_HEIGHT) continue;
        const box = collision_types.AABB{
            .x = cx - MOVE_SEARCH_HALF_W,
            .y = cy - PLAYER_HALF_HEIGHT,
            .w = MOVE_SEARCH_HALF_W * 2.0,
            .h = PLAYER_HALF_HEIGHT * 2.0,
        };
        var blocked = false;
        for (statics) |s| {
            // Strict-inequality overlap test — mirrors World.ts's
            // `aabbOverlap` exactly (edge-touching = no overlap).
            if (box.x < s.x + s.w and box.x + box.w > s.x and box.y < s.y + s.h and box.y + box.h > s.y) {
                blocked = true;
                break;
            }
        }
        if (!blocked) {
            out_x.* = cx;
            out_y.* = cy;
            return true;
        }
    }
    return false;
}

/// Nearest ALIVE other player within `range_px`, ignoring the caster —
/// Read Mark's own targeting shape (World.ts's `findNearestEnemy` call at
/// its cast site: omnidirectional, no cone). Team-aware since Track Z1a
/// item 3 (the ally substrate landed): allies are skipped, mirroring TS
/// `findNearestEnemy`'s own `if (isAlly(caster, other)) continue` — the
/// old "an ENEMY-search can't exclude teammates" deferral note here is
/// closed. (`findNearestEnemyInCone` below deliberately does NOT get the
/// same skip — TS's Judgment-Line inline cone scan has no isAlly check
/// either, verified by grep; mirroring TS, not "improving" it.) In FFA
/// (no team ids) `isAlly` is always false, so this is behavior-identical
/// to the pre-Z1a helper for every existing FFA test.
fn findNearestEnemyInRange(
    state: *const world_state.WorldState,
    caster_idx: u32,
    range_px: f64,
) i32 {
    const caster = &state.players[caster_idx];
    var best_idx: i32 = -1;
    var best_dist_sq: f64 = std.math.inf(f64);
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (i == caster_idx) continue;
        const other = &state.players[i];
        if (!other.flags.alive) continue;
        if (isAlly(caster, other)) continue;
        const dx = other.x - caster.x;
        const dy = other.y - caster.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range_px * range_px) continue;
        if (d2 < best_dist_sq) {
            best_dist_sq = d2;
            best_idx = @intCast(i);
        }
    }
    return best_idx;
}

/// Nearest ALIVE other player within `range_px` AND inside a cone of
/// half-width `cone_radians / 2` centered on the caster's aim direction —
/// Judgment Line's own targeting shape, ported verbatim from its inline
/// scan in World.ts (that ability does NOT call the shared
/// `findNearestEnemy` helper — there is no cone-aware variant of it in
/// TS either, each cone-gated ability inlines its own scan). `aim_x`/
/// `aim_y` on `PlayerEntity` are an ABSOLUTE cursor point (same
/// convention `stepMeleeSwing`'s own aim capture and every TS
/// ability-cast case already use), not a direction vector — the caster's
/// facing direction is `aim - position`, computed here the same way
/// `stepMeleeSwing` computes its own swing direction. Same team-awareness
/// deferral as `findNearestEnemyInRange` above.
fn findNearestEnemyInCone(
    state: *const world_state.WorldState,
    caster_idx: u32,
    range_px: f64,
    cone_radians: f64,
) i32 {
    const caster = &state.players[caster_idx];
    const dx0 = caster.aim_x - caster.x;
    const dy0 = caster.aim_y - caster.y;
    const aim_angle = trig.lutAtan2(dy0, dx0);
    var best_idx: i32 = -1;
    var best_dist_sq: f64 = std.math.inf(f64);
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (i == caster_idx) continue;
        const other = &state.players[i];
        if (!other.flags.alive) continue;
        const dx = other.x - caster.x;
        const dy = other.y - caster.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range_px * range_px or d2 < 1e-6) continue;
        const target_angle = trig.lutAtan2(dy, dx);
        const da = combat.wrapAngle(target_angle - aim_angle);
        if (@abs(da) > cone_radians / 2.0) continue;
        if (d2 < best_dist_sq) {
            best_dist_sq = d2;
            best_idx = @intCast(i);
        }
    }
    return best_idx;
}

/// Team membership (Track Z1a item 3 — the ally substrate, port of
/// team.ts's `isAlly`, deliberately the only place Zig reasons about team
/// identity, same single-source-of-truth contract as the TS file): true
/// iff BOTH players carry a defined team id and the ids are byte-equal.
/// TS semantics mirrored exactly: `a.teamId !== undefined && a.teamId ===
/// b.teamId` — two FFA players (no team id) are NOT allies, and a player
/// with a team id IS trivially their own ally (`isAlly(a, a)`); callers
/// that must exclude self-targeting filter separately, exactly as TS's
/// doc comment prescribes.
fn isAlly(a: *const world_state.PlayerEntity, b: *const world_state.PlayerEntity) bool {
    if (!a.flags.has_team_id or !b.flags.has_team_id) return false;
    if (a.team_id_len != b.team_id_len) return false;
    return std.mem.eql(u8, a.team_id_bytes[0..a.team_id_len], b.team_id_bytes[0..b.team_id_len]);
}

/// Ninja dash i-frames (Track Z1c "ninja dash i-frames" item — port of
/// combat.ts's `tryDeflectDamage` step 0.5: "ninja = evasion — dash
/// i-frames — never blocks, only isn't there"). True while `victim_idx` is
/// a Ninja (sprinter chassis) currently mid-dash. Omnidirectional (unlike
/// parry/dash-bash's frontal arc) and checked AHEAD of every other
/// mitigation (parry/shield/Self-Lattice/Ghost Guard/team peel/etc) at
/// every call site below — a dodge means the hit never reaches the body,
/// pre-empting the whole chain rather than adding to it, exactly matching
/// TS's step ordering (0.5, ahead of 0.6's Ghost Guard).
///
/// `state.player_movement[victim_idx].dash_active_ms > 0.0` IS the derived
/// Zig equivalent of TS's `player.dashing === true` (player.ts:288 —
/// `dashing: memory.dashActiveMs > 0`) — `razor_route_until_tick`'s own
/// doc comment (world_state.zig) already established this precedent for a
/// DIFFERENT consumer (Razor Route's cast-then-next-dash window); this is
/// the first DAMAGE-resolution site to read it. No new PlayerMovementMemory
/// field needed — player.zig's dash-timer memory already tracked this for
/// movement purposes.
///
/// KNOWN GAP, same as TS's own (combat.ts's step 0.5 doc comment): burn
/// DoT / chain-lightning / shrink-zone storm damage apply directly without
/// going through a `tryDeflectDamage`-equivalent gate in EITHER codebase,
/// so i-frames don't cover those on either side — not a Zig-specific
/// shortfall.
fn isNinjaEvading(state: *const world_state.WorldState, victim_idx: u32) bool {
    return state.players[victim_idx].character_id == .sprinter and
        state.player_movement[victim_idx].dash_active_ms > 0.0;
}

/// Nearest ALIVE ally within `range_px`, excluding the caster — port of
/// World.ts's `findNearestAlly` (the Syzygist low-aim auto-target helper;
/// every call site this pass ports uses the default `excludeSelf: true`,
/// so the option isn't carried). `require_injured` mirrors the
/// `requireInjured` option INCLUDING the 2026-07-22 fix: "injured" means
/// below the player's REAL max health (`maxHealthForPlayer` — chassis
/// base + build maxHealthAdd), NOT a flat 100, so a Kindled at 110/125
/// is a valid heal target.
///
/// ITERATION ORDER (the divergence trap the goal doc names): TS scans
/// `Object.entries(players)` in record-insertion order and keeps the
/// FIRST strictly-nearest candidate. On the wasm full-sync path that
/// insertion order IS this array's slot order — packWorldState seats
/// slots by sorted player id and unpackWorldState re-inserts in slot
/// order — so iterating 0..player_count with the same strict `<` keeps
/// distance ties resolved identically on both sides. Distances compare
/// SQUARED (findNearestEnemyInRange's own shipped precedent) — same
/// result as TS's hypot compare except in sub-ulp ties.
fn findNearestAllyIdx(
    state: *const world_state.WorldState,
    caster_idx: u32,
    range_px: f64,
    require_injured: bool,
) i32 {
    const caster = &state.players[caster_idx];
    var best_idx: i32 = -1;
    var best_dist_sq: f64 = std.math.inf(f64);
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (i == caster_idx) continue;
        const other = &state.players[i];
        if (!other.flags.alive) continue;
        if (!isAlly(caster, other)) continue;
        if (require_injured and
            other.health >= maxHealthForPlayer(other, &state.player_fire_config[i]))
        {
            continue;
        }
        const dx = other.x - caster.x;
        const dy = other.y - caster.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range_px * range_px) continue;
        if (d2 < best_dist_sq) {
            best_dist_sq = d2;
            best_idx = @intCast(i);
        }
    }
    return best_idx;
}

/// Team peel warder search (Track Z1c "team peel" item — port of World.ts's
/// `findTeamPeelWarder`). A Paladin ally currently holding Ward
/// (`shield_active`) within `WARD_PEEL_RADIUS_PX` of the victim (widened by
/// `KIN_AEGIS_SHARE_RADIUS_MULTIPLIER` while THEIR OWN Aegis Share window is
/// live — the window lives on the candidate warder, not the victim, so it's
/// read directly off the candidate being tested, matching TS exactly) AND
/// facing the victim's body extends their block to cover this hit. Returns
/// -1 when no eligible warder exists — including, by construction, every
/// solo/FFA victim (`isAlly` is false for any pairing when either side
/// lacks a team id, per `isAlly`'s own doc comment). Multiple eligible
/// warders (2+ paladins on one team, both holding Ward, both in range)
/// resolve to the CLOSEST one, scanned in slot order for the same cross-
/// platform determinism guarantee `findNearestAllyIdx` above already
/// establishes (squared-distance compare — same "identical result except
/// sub-ulp ties" precedent that function's own doc comment cites). A
/// warder never peels for themselves (self-Ward is the separate existing
/// mechanism, `syz_ward_absorb_*`/the still-unported Kindled Ward branch) —
/// callers exclude `victim_idx` from the candidate scan below, matching
/// TS's `if (wid === victim.id) continue`.
fn findTeamPeelWarderIdx(state: *const world_state.WorldState, victim_idx: u32, tick: u32) i32 {
    const victim = &state.players[victim_idx];
    if (!victim.flags.has_team_id) return -1;
    var best_idx: i32 = -1;
    var best_dist_sq: f64 = std.math.inf(f64);
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (i == victim_idx) continue;
        const candidate = &state.players[i];
        if (!candidate.flags.alive or !candidate.flags.shield_active) continue;
        if (candidate.character_id != .heavy) continue; // classIdForArchetype(...) === "paladin"
        if (!isAlly(candidate, victim)) continue;
        const aegis_active = candidate.aegis_share_until_tick > tick;
        const radius_px = if (aegis_active)
            WARD_PEEL_RADIUS_PX * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER
        else
            WARD_PEEL_RADIUS_PX;
        if (!combat.isAllyBodyInWardCone(candidate.x, candidate.y, candidate.aim_x, candidate.aim_y, victim.x, victim.y, radius_px)) continue;
        const dx = victim.x - candidate.x;
        const dy = victim.y - candidate.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best_dist_sq) {
            best_dist_sq = d2;
            best_idx = @intCast(i);
        }
    }
    return best_idx;
}

/// Apply team peel to a hit landing on `victim_idx` for `raw_damage`, IFF an
/// eligible warding ally exists (`findTeamPeelWarderIdx`) — port of World.ts's
/// `applyTeamPeel`. Mutates the warder's kindling in place ("your block,
/// your Kindling", same contract as self-Ward) and returns the mitigated
/// damage (unchanged `raw_damage` when no warder exists or `raw_damage <=
/// 0` — TS's optional-return + "callers only invoke on unmitigated hits"
/// contract collapses to a plain damage-in/damage-out shape here since
/// every Zig call site already just reassigns `final_dmg`/`final_damage`
/// to this return value, no separate "did it happen" branch needed).
///
/// CALLER CONTRACT (matches every TS call site's own gate): only call this
/// on a hit no OTHER mitigation already fully handled — self-Ward/Self-
/// Lattice, parry, and the generic shield are all upstream, higher-
/// priority outcomes that already `continue`/`break` before reaching this
/// point at every site below. Callers ALSO gate this on their own local
/// "was this hit already covered by Kindled Ward's self-mitigation"
/// tracking (Track Z1c "Kindled Ward partial mitigation" item — matches
/// TS's `if (!mitigation.warded)` at every one of its own peel call
/// sites), since `applyTeamPeel` itself has no visibility into whether the
/// victim's OWN Ward already ran at this call site.
fn applyTeamPeel(state: *world_state.WorldState, victim_idx: u32, raw_damage: f64, tick: u32) f64 {
    if (raw_damage <= 0) return raw_damage;
    const warder_idx = findTeamPeelWarderIdx(state, victim_idx, tick);
    if (warder_idx < 0) return raw_damage;
    const mit = combat.computeTeamPeelMitigation(raw_damage);
    const w: u32 = @intCast(warder_idx);
    state.players[w].kindling = @min(KINDLING_MAX, state.players[w].kindling + mit.kindling_granted);
    emitEvent(
        state,
        .team_peel_absorbed,
        @intCast(victim_idx),
        warder_idx,
        0,
        mit.damage_blocked,
        state.players[victim_idx].x,
        state.players[victim_idx].y,
    );
    return mit.mitigated_damage;
}

/// Rally Light aura coverage (Track Z1a item 3 — port of World.ts's
/// `hasRallyLightSource`): true when the beneficiary's OWN window is
/// live (a player is always their own eligible source — the solo-viable
/// clause that closed the axiom audit's AX.2 "Rally Light is solo-dead"
/// flag; `isAlly` is only consulted for OTHER candidates) or a live
/// ALLY source stands within KIN_RALLY_LIGHT_RADIUS_PX. Read-only —
/// never writes another player's entity, so it's safe from any per-tick
/// pass, same contract as the TS helper's own doc comment.
fn hasRallyLightSource(
    state: *const world_state.WorldState,
    beneficiary_idx: u32,
    tick: u32,
) bool {
    const b = &state.players[beneficiary_idx];
    if (b.rally_light_until_tick > tick) return true;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (i == beneficiary_idx) continue;
        const other = &state.players[i];
        if (!other.flags.alive) continue;
        if (other.rally_light_until_tick <= tick) continue;
        if (!isAlly(other, b)) continue;
        const dx = other.x - b.x;
        const dy = other.y - b.y;
        if (dx * dx + dy * dy <= KIN_RALLY_LIGHT_RADIUS_PX * KIN_RALLY_LIGHT_RADIUS_PX) {
            return true;
        }
    }
    return false;
}

/// Shared shape for the single-shard ability-cast projectile spawns Phase
/// 4e's Sunspike/Needle/Severance all use (docs/zig-step-world-parity-goal.md
/// — verified live against World.ts's own `spawnProjectile` call at each of
/// those 3 case sites: same param shape every time — owner/origin/aimAngle/
/// speed/damage/lifetimeMs/radius/shape/element/pathing — differing only in
/// the values). Origin is always `(attacker.x, attacker.y - 20)`, matching
/// every existing ability-shard spawn site in this file (Edge Storm's wave
/// above is the closest precedent — same origin offset, same "no shot_fired
/// event" choice, since World.ts itself never emits one for these either,
/// just a plain `projectilesCow.set`). Deliberately NOT reused by section
/// 6's basic-weapon-fire spawn (multi-shot/spread/bounce/pierce/impact-kind
/// is a materially different contract — forcing one shared helper there
/// would obscure both, the same "don't force a shape TS itself doesn't
/// share" discipline this whole file already follows). `range_px == null`
/// mirrors a TS case that never sets `shard.rangePx` at all (Bleed Tithe/
/// Severance leave it unset); `homing_strength`/`leech_fraction` are
/// intentionally NOT parameters — callers that need them (Bleed Tithe) set
/// them on the returned pointer afterward, exactly like World.ts's own
/// post-spawn `shard.leechFraction = ...` field patches.
fn spawnAbilityShard(
    state: *world_state.WorldState,
    attacker: *const world_state.PlayerEntity,
    aim_angle: f64,
    speed: f64,
    damage: f64,
    lifetime_ms: f64,
    radius: f64,
    shape: world_state.ProjectileShape,
    element: world_state.ElementType,
    pathing: world_state.ProjectilePathing,
    range_px: ?f64,
) ?*world_state.ProjectileEntity {
    // Zig-only defensive cap (MAX_PROJECTILES) has no TS equivalent (TS's
    // Record is unbounded) — callers do NOT gate `activated` on a null
    // return, same "a dropped spawn there is a silent bug, not a
    // legitimate no-op" reasoning Paper Double's own comment documents.
    if (state.projectile_count >= world_state.MAX_PROJECTILES) return null;
    const slot: u32 = state.projectile_count;
    state.projectile_count += 1;
    const new_id: u32 = state.header.next_entity_id;
    state.header.next_entity_id += 1;
    const origin_x = attacker.x;
    const origin_y = attacker.y - 20.0;
    state.projectiles[slot] = .{
        .x = origin_x,
        .y = origin_y,
        .vx = trig.lutCos(aim_angle) * speed,
        .vy = trig.lutSin(aim_angle) * speed,
        .radius = radius,
        .damage = damage,
        .lifetime_ms = lifetime_ms,
        .age_ms = 0,
        .traveled_px = 0,
        .origin_x = origin_x,
        .origin_y = origin_y,
        .homing_strength = 0,
        .acceleration_multiplier = 0,
        .gravity_scale = 0,
        .range_px = range_px orelse 0,
        .slow_multiplier = 1,
        .sticky_fuse_ms = 0,
        .impact_radius_px = 0,
        .id = new_id,
        .bounces_remaining = 0,
        .pierce_remaining = 0,
        .split_count = 0,
        .flags = .{
            .has_owner = true,
            .has_impact = false,
            .has_split = false,
            .has_slow = false,
            .has_homing = pathing == .homing,
            .has_acceleration = false,
            .has_gravity_scale = false,
            .has_range = range_px != null,
            .has_age = true,
            .has_traveled = true,
            .has_origin = true,
            .returning = false,
            .has_sticky_fuse = false,
            .has_impact_radius = false,
        },
        .pathing = pathing,
        .element = element,
        .impact = .none,
        .shape = shape,
        .owner_id_len = attacker.id_len,
        .owner_id_bytes = attacker.id_bytes,
    };
    return &state.projectiles[slot];
}

/// Ability-cast dispatch — one player, one tick: for each of the 3 rack
/// slots (`world_state.MAX_ABILITY_SLOTS`), on a rising edge of that
/// slot's input bit, look up the equipped `AbilityKind`
/// (`state.player_equipped_actives[player_idx]` — host-resolved, see
/// `EquippedActives`'s own doc comment), gate on cooldown, and dispatch.
/// `slot_rising_edge` MUST be pre-captured before section 6 (in
/// `stepWorld`) rolls `prev_keys = current_keys` for every player — same
/// "captured before prev_keys rolls" contract `melee_fire_rising_edge`
/// already establishes for the melee FSM, and for the identical reason
/// (section 6's own per-player loop body is what does the rolling).
///
/// An empty slot (`ABILITY_KIND_NONE`) is a no-op by construction — the
/// `continue` right after the sentinel check means nothing downstream
/// (cooldown read/write, the switch, an event) ever runs for it, so it is
/// provably inert under repeated presses: no crash, no state change, no
/// false cooldown-set (see this phase's own dedicated test).
///
/// EVERY one of the 45 `AbilityKind` arms below is explicit — Zig's
/// switch-exhaustiveness check on an enum IS the safety net
/// docs/zig-step-world-parity-goal.md's Phase 1 section calls for: add a
/// 46th `AbilityKind` later and forget an arm here, `zig build` itself
/// fails at compile time, not a silent runtime gap. No `else`/`_`
/// catch-all exists anywhere in this switch. As of Track Z1a item 3, 27
/// arms carry a real cast-time effect (the four ally-substrate arms —
/// Aegis Share/Rally Light/Borrowed Time/Glass Ward — joined the Phase 4c
/// count of 23 below; same re-verify-by-grep caveat).
/// Superseded count note: as of Phase 4c, 23 arms carried
/// a real cast-time effect (updated from Phase 1's original 12 — each
/// later sub-group's own commit grew this count; re-verify with a grep
/// count, not this number, before trusting it further into the future):
/// the original 6 melee-hook abilities (Phase 1's own "first real
/// abilities" list — see `stepMeleeSwing` for their CONSUMPTION half) plus
/// 6 more from the AOE-queue group (Prism Fan/Shard Ring/Flock Pulse push
/// straight onto `PendingInstantAoe` from this switch; Wall Bloom/Shock
/// Ring only OPEN a window here, consumed at a movement hook in section 8
/// below — see `stepWorld`'s own section-8 comment; Paper Double spawns a
/// `PaperDoubleEntity` directly, whose death/expiry burst is pushed
/// separately, see section 6b's burst-detection block); 5 Phase 4a
/// self-only window buffs (Sunlance/Overclock/Measure/Return Glass/Bastion
/// Pulse); 2 Phase 4b caster-side marks (Facet Break/Focus Hex); and 4
/// Phase 4c movement blinks (Slip Node/Plant Charge/Bulwark Step/Drift
/// Step, all sharing `findCollisionFreeLanding` above). The other 22 are
/// explicit, individually-commented
/// no-ops.
fn stepAbilityDispatch(
    state: *world_state.WorldState,
    player_idx: u32,
    eff_dt: f64,
    slot_rising_edge: [world_state.MAX_ABILITY_SLOTS]bool,
) void {
    const attacker = &state.players[player_idx];
    if (!attacker.flags.alive) return;
    if (state.header.round_phase != @intFromEnum(round.RoundPhase.fighting)) return;

    const equipped = &state.player_equipped_actives[player_idx];

    var slot: usize = 0;
    while (slot < world_state.MAX_ABILITY_SLOTS) : (slot += 1) {
        if (!slot_rising_edge[slot]) continue;

        const raw_kind = equipped.slot_kind[slot];
        if (raw_kind == world_state.ABILITY_KIND_NONE) continue; // empty slot: inert

        // Storage is AbilityKind + 1 (see EquippedActives.slot_kind's own
        // doc comment for why 0 is reserved as the zero-init-safe "empty"
        // sentinel rather than a top-of-range value).
        const kind: gen.AbilityKind = @enumFromInt(raw_kind - 1);
        const cd_until = attacker.slot_cooldown_until_tick[slot];
        if (cd_until > state.header.tick) continue; // still on cooldown: no-op, no reset

        const active_spec = weapon_build.cardActiveForKind(kind) orelse continue;

        var activated = false;
        switch (kind) {
            .undercut => {
                // Window — consumed by the NINJA MELEE arc-hit-resolution
                // section (stepMeleeSwing below). Unconditional activation
                // (no target check at cast time — matches World.ts).
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.undercut_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .edge_storm => {
                // Charge bank — consumed at the wave-spawn site
                // (stepMeleeSwing below) for up to NINJA_EDGE_STORM_CHARGES
                // swings.
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.edge_storm_until_tick = state.header.tick + dur_ticks;
                attacker.edge_storm_charges_remaining = NINJA_EDGE_STORM_CHARGES;
                activated = true;
            },
            .unbroken_seal => {
                // Window consumed by the NEXT landed Kindled Edge hit
                // (amp + stagger), at the PALADIN MELEE section below —
                // single-use, cleared on that hit, not just on timeout.
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.seal_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .second_wind => {
                // Window — consumed by the NEXT landed Ninja Slash hit
                // (self-heal + bonus energy, NINJA MELEE section below).
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.second_wind_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .judgment_line => {
                // Mark lives on the CASTER (judgment_target_id_*/
                // judgment_mark_until_tick), never the victim — same
                // cross-player-write-hazard-avoidance shape every other
                // self-write in this dispatch loop already follows.
                // No target in the cone: a press that does nothing is a
                // dead press (legibility law, matches World.ts) — no
                // cooldown burn (activated stays false).
                const target_idx = findNearestEnemyInCone(state, player_idx, KIN_JUDGMENT_RANGE_PX, KIN_JUDGMENT_CONE_RADIANS);
                if (target_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(target_idx))];
                    const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                    attacker.judgment_target_id_len = target.id_len;
                    attacker.judgment_target_id_bytes = target.id_bytes;
                    attacker.judgment_mark_until_tick = state.header.tick + dur_ticks;
                    activated = true;
                }
            },
            .read_mark => {
                // Omnidirectional auto-target mark on the CASTER — same
                // shape as Judgment Line above but for Ninja Slash hits,
                // consumed at the NINJA MELEE section below. Non-consuming
                // window (a per-target amp while live), unlike Seal.
                const target_idx = findNearestEnemyInRange(state, player_idx, NINJA_READ_MARK_RANGE_PX);
                if (target_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(target_idx))];
                    const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                    attacker.read_target_id_len = target.id_len;
                    attacker.read_target_id_bytes = target.id_bytes;
                    attacker.read_mark_until_tick = state.header.tick + dur_ticks;
                    activated = true;
                }
            },
            .prism_fan => {
                // Instant cone AOE straight from the cast — no window/hook
                // indirection, the simplest of the 5 AOE-queue abilities
                // (docs/zig-step-world-parity-goal.md's own "do this one
                // FIRST" note). Unconditional activation, matching
                // World.ts's "prism-fan" case (no target-existence check
                // at cast time — everyone in the cone at cast time is
                // resolved later, by section 6b below).
                const dx0 = attacker.aim_x - attacker.x;
                const dy0 = attacker.aim_y - attacker.y;
                const base_angle = trig.lutAtan2(dy0, dx0);
                // Same fallback-to-starter-pistol shape the weapon-fire site
                // (section 6 below) already establishes for every other
                // `fcfg.valid`-gated read — `build.damage` in TS always
                // resolves to AT LEAST the starter weapon's base damage
                // (never undefined), so an unresolved fire config here must
                // fall back the same way, not silently read a zeroed field.
                const fcfg = &state.player_fire_config[player_idx];
                const base_damage: f64 = if (fcfg.valid != 0) fcfg.damage else weapons_data.weaponBaseById(.starter_pistol).damage;
                if (state.pending_instant_aoe_count < world_state.MAX_PENDING_INSTANT_AOE) {
                    state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                        .x = attacker.x,
                        .y = attacker.y,
                        .radius = GEO_PRISM_FAN_RANGE_PX,
                        .damage = base_damage * GEO_PRISM_FAN_DAMAGE_MULTIPLIER,
                        .aim_angle = base_angle,
                        .cone_radians = GEO_PRISM_FAN_CONE_RADIANS,
                        .caster_idx = player_idx,
                        .has_cone = 1,
                    };
                    state.pending_instant_aoe_count += 1;
                }
                activated = true;
            },
            .shard_ring => {
                // Instant self-centered radius AOE, cast-time push, flat
                // NINJA_SHARD_RING_DAMAGE (verified NOT build-scaled — see
                // this constant's own doc comment above). Unconditional
                // activation, same shape as Prism Fan above.
                if (state.pending_instant_aoe_count < world_state.MAX_PENDING_INSTANT_AOE) {
                    state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                        .x = attacker.x,
                        .y = attacker.y,
                        .radius = NINJA_SHARD_RING_RADIUS_PX,
                        .damage = NINJA_SHARD_RING_DAMAGE,
                        .caster_idx = player_idx,
                    };
                    state.pending_instant_aoe_count += 1;
                }
                activated = true;
            },
            .flock_pulse => {
                // Instant self-centered radius AOE + slow, cast-time push.
                // BASE damage only (SYZ_FLOCK_PULSE_BASE_DAMAGE) — the
                // ally/enemy source-count scaling term is DEFERRED (Phase 3
                // ally-targeting substrate; see this constant's own doc
                // comment above for the full "verified against World.ts,
                // not guessed" accounting). Unconditional activation, same
                // shape as Prism Fan/Shard Ring above.
                if (state.pending_instant_aoe_count < world_state.MAX_PENDING_INSTANT_AOE) {
                    state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                        .x = attacker.x,
                        .y = attacker.y,
                        .radius = SYZ_FLOCK_PULSE_RADIUS_PX,
                        .damage = SYZ_FLOCK_PULSE_BASE_DAMAGE,
                        .slow_multiplier = SYZ_FLOCK_PULSE_SLOW_MULTIPLIER,
                        .slow_duration_ms = SYZ_FLOCK_PULSE_SLOW_DURATION_MS,
                        .caster_idx = player_idx,
                        .has_slow = 1,
                    };
                    state.pending_instant_aoe_count += 1;
                }
                activated = true;
            },
            .wall_bloom => {
                // Window — consumed at the wall-kick hook (world.zig
                // section 8's per-player physics loop below), single-use
                // (cleared on that wall-kick, not just on timeout). Mirrors
                // World.ts's "wall-bloom" case exactly: opens the window
                // only, no AOE queued from THIS switch arm.
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.wall_bloom_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .shock_ring => {
                // A modest upward hop (KIN_SHOCK_RING_HOP_VY) plus an arm
                // window covering the hop's airtime — landing detection +
                // the actual slam AOE happen in the MOVEMENT section
                // (world.zig section 8 below), since dispatch (this
                // function, section 6z) runs AFTER section 8 has already
                // moved every player this tick — "just landed" for THIS
                // press can only be detected on a LATER tick, same "window
                // persists across ticks until consumed" shape Wall Bloom
                // above uses. Mirrors World.ts's "shock-ring" case exactly.
                attacker.vy = -KIN_SHOCK_RING_HOP_VY;
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.shock_ring_armed_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .paper_double => {
                // Spawns a PaperDoubleEntity via the caster's CURRENT
                // horizontal velocity direction if actually running
                // (|vx| > NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX), falling
                // back to the aim direction for a horizontally-stationary
                // caster — ported verbatim from World.ts's "paper-double"
                // case / paperDouble.ts's own header comment (deliberately
                // horizontal-only, not the full vx/vy vector: vy is
                // gravity-driven, not player input). `attacker.vx` here is
                // ALREADY this tick's post-movement velocity (section 8
                // runs before section 6z, same ordering World.ts's single
                // per-player loop gets for free). The resonance-gated SWAP
                // branch is DELIBERATELY NOT ported — see
                // NINJA_PAPER_DOUBLE_SPEED's own doc comment above for why
                // (no resonance substrate exists in Zig at all, so this
                // port always takes TS's own "v1 always spawns" fallback,
                // never an invented shortcut).
                var dir_x: f64 = 1;
                var dir_y: f64 = 0;
                if (@abs(attacker.vx) > NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX) {
                    dir_x = if (attacker.vx > 0) 1.0 else -1.0;
                    dir_y = 0;
                } else {
                    const aim_dx = attacker.aim_x - attacker.x;
                    const aim_dy = attacker.aim_y - attacker.y;
                    const aim_len = @sqrt(aim_dx * aim_dx + aim_dy * aim_dy);
                    if (aim_len > 1e-3) {
                        dir_x = aim_dx / aim_len;
                        dir_y = aim_dy / aim_len;
                    }
                }
                if (state.paper_double_count < world_state.MAX_PAPER_DOUBLES) {
                    const pd_slot: u32 = state.paper_double_count;
                    state.paper_double_count += 1;
                    const new_id: u32 = state.header.next_entity_id;
                    state.header.next_entity_id += 1;
                    state.paper_doubles[pd_slot] = .{
                        .x = attacker.x,
                        .y = attacker.y,
                        .vx = dir_x * NINJA_PAPER_DOUBLE_SPEED,
                        .vy = dir_y * NINJA_PAPER_DOUBLE_SPEED,
                        .health = NINJA_PAPER_DOUBLE_MAX_HEALTH,
                        .remaining_ms = NINJA_PAPER_DOUBLE_LIFETIME_MS,
                        .id = new_id,
                        .owner_id_len = attacker.id_len,
                        .owner_id_bytes = attacker.id_bytes,
                    };
                }
                // Matches World.ts: the cast ALWAYS activates (a decoy
                // always spawns when the swap isn't eligible, and the swap
                // never is here) — the MAX_PAPER_DOUBLES bound is a
                // Zig-only defensive cap with no TS equivalent (TS's
                // Record is unbounded), sized so it can never actually
                // trigger under normal single-decoy-per-player play (see
                // MAX_PAPER_DOUBLES's own doc comment) — a dropped spawn
                // there would be a silent bug, not a legitimate no-op, so
                // this does NOT gate `activated` on it.
                activated = true;
            },
            // ── Not yet ported (Phase 4 — docs/zig-step-world-parity-goal.md) ──
            .crimson_tithe => {}, // Phase 4 — not yet ported
            .shelter_seal => {}, // Phase 4 — not yet ported
            .shadow_step => {}, // Phase 4 — not yet ported
            .veil_of_nought => {}, // Phase 4 — not yet ported
            .severing_answer => {}, // Phase 4 — not yet ported
            // ── Phase 4a: self-only window buffs (docs/zig-step-world-
            //    parity-goal.md "4a. Self-only window buffs") — Sunlance/
            //    Overclock/Measure open a window here, consumed at
            //    world.zig's weapon-fire composition chain (section 6,
            //    mirrors weapon.ts:336-423/558-565 bit-exact — see
            //    GEO_SUNLANCE_DAMAGE_MULTIPLIER's own doc comment for the
            //    full priority-chain reasoning). Return Glass/Bastion Pulse
            //    are INSTANT self-shield-charge ticks against the existing
            //    shield_charge/shield_charge_mul substrate section 6's
            //    tickShield already reads/writes every tick — no window
            //    field at all, same shape TS itself uses (no
            //    `*UntilTick` field for either in types.ts).
            .sunlance => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.sunlance_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .facet_break => {
                // Mark lives on the CASTER (facet_target_id_*/
                // facet_mark_until_tick), never the victim — same
                // cross-player-write-hazard-avoidance shape Judgment Line
                // above already establishes. Consumed at the GENERIC
                // ranged-hit-resolution site in section 4 below (not
                // stepMeleeSwing) — World.ts's own "facet-break" amp lives
                // in resolveRangedHit, which runs for every ranged hit
                // (basic weapon fire included), not just ability
                // projectiles.
                const target_idx = findNearestEnemyInCone(state, player_idx, GEO_FACET_BREAK_RANGE_PX, GEO_FACET_BREAK_CONE_RADIANS);
                if (target_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(target_idx))];
                    const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                    attacker.facet_target_id_len = target.id_len;
                    attacker.facet_target_id_bytes = target.id_bytes;
                    attacker.facet_mark_until_tick = state.header.tick + dur_ticks;
                    activated = true;
                }
            },
            // Lattice (Geometrician): genuine lingering damage zone (aoe
            // role rework, 2026-07-18) — World.ts's own case comment says
            // it reuses the SAME `firePatches`/`FireEntity` primitive fire
            // hazards already use ("no new entity kind, no new Zig ABI
            // surface"). Verified directly, not assumed per this goal
            // doc's own "may warrant its own small primitive" hedge for
            // this ability: Zig ALREADY has that exact primitive as a
            // first-class step_world entity array (`state.fires`/
            // `FireEntity`, spawned by the chaos fire-hazard modifier and
            // ticked/compacted every tick by section 2/section 9 above) —
            // so this needs NO new deferred-write primitive at all, the
            // hedge doesn't hold once you check what TS itself reuses.
            // Pure damage, no status, self-centered, owner-immune
            // (has_owner=1 — "patches never damage their owner", same
            // contract every other fire-patch spawn in this file has).
            .lattice => {
                if (state.fire_count < world_state.MAX_FIRE) {
                    const fire_slot = state.fire_count;
                    state.fire_count += 1;
                    const new_id: u32 = state.header.next_entity_id;
                    state.header.next_entity_id += 1;
                    state.fires[fire_slot] = .{
                        .x = attacker.x,
                        .y = attacker.y,
                        .radius = GEO_LATTICE_ZONE_RADIUS_PX,
                        .remaining_ms = GEO_LATTICE_ZONE_DURATION_MS,
                        .damage_per_second = GEO_LATTICE_ZONE_DPS,
                        .id = new_id,
                        .has_owner = 1,
                        .owner_id_len = attacker.id_len,
                        .owner_id_bytes = attacker.id_bytes,
                    };
                }
                // Zig-only defensive cap (MAX_FIRE) has no TS equivalent
                // (TS's Record is unbounded) — same "doesn't gate
                // activated" reasoning Paper Double's own comment
                // documents above; a dropped spawn there would be a
                // silent bug, not a legitimate no-op.
                activated = true;
            },
            .return_glass => {
                const fcfg = &state.player_fire_config[player_idx];
                const max_charge = combat.SHIELD_MAX_CHARGE_DEFAULT * (if (fcfg.valid != 0) fcfg.shield_charge_mul else 1.0);
                attacker.shield_charge = @min(max_charge, attacker.shield_charge + GEO_RETURN_GLASS_SHIELD_REFUND);
                activated = true;
            },
            // Hard Aperture (Wizard, shipped this pass — docs/zig-step-
            // world-parity-goal.md's own Phase 4a deferral for this ability
            // is now closed). v1 reuses TS's exact ward-shell mechanic
            // (`wardShellUntilTick`, mirrored as `ward_shell_until_tick`
            // since Phase 5) — same shape as `.overclock`/`.measure` above.
            // The consumption half (this file's PREVIOUS blocker: nothing
            // read the field) now lives at section 4's projectile-vs-player
            // hit resolution — see `EMISSION_WARD_DAMAGE_MULT`'s own doc
            // comment above for exactly which paths do and don't apply it
            // (ranged only, verified against TS; melee/AOE structurally
            // can't per TS itself).
            .hard_aperture => {
                // TS's own "hard-aperture" case uses `state.tick + 1 +
                // durTicks` (World.ts:3204, the SAME "+1" shape Self-Lattice
                // below and ward_shell_until_tick's own TS cast sites use) —
                // verified directly rather than copied from the sibling
                // `.overclock`/`.measure` arms above, which are missing the
                // +1 (a pre-existing discrepancy in already-shipped code,
                // out of THIS pass's scope to touch).
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.ward_shell_until_tick = state.header.tick + 1 + dur_ticks;
                activated = true;
            },
            .overclock => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.overclock_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .measure => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.measure_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            .slip_node => {
                // Phase 4c (docs/zig-step-world-parity-goal.md "4c.
                // Movement") — aim-directed blink using the shared
                // findCollisionFreeLanding search above. Falls back to +X
                // when aim is exactly on the caster (dLen ~0), matching
                // World.ts's own `dLen > 0.001 ? ... : 1` fallback.
                const dx0 = attacker.aim_x - attacker.x;
                const dy0 = attacker.aim_y - attacker.y;
                const d_len = @sqrt(dx0 * dx0 + dy0 * dy0);
                const dir_x: f64 = if (d_len > 0.001) dx0 / d_len else 1.0;
                const dir_y: f64 = if (d_len > 0.001) dy0 / d_len else 0.0;
                var cx: f64 = undefined;
                var cy: f64 = undefined;
                if (findCollisionFreeLanding(
                    attacker.x,
                    attacker.y,
                    dir_x,
                    dir_y,
                    GEO_SLIP_NODE_RANGE_PX,
                    state.statics[0..state.static_count],
                    &cx,
                    &cy,
                )) {
                    attacker.x = cx;
                    attacker.y = cy;
                    activated = true;
                }
                // TS's "leaves a fading node enemies can read" flavor is a
                // render-layer VFX note satisfied there by a generic
                // client-side ability-activated event — step_world has no
                // such event type and doesn't need one for this goal (pure
                // presentation, not sim state); same v2-deferral World.ts's
                // own comment already records for a real lingering marker
                // entity, not a Zig-specific gap.
            },
            // Recoil Step (Wizard) — SHIPPED (Track Z0c Item A; formerly
            // the Phase 4a "needs ResolvedFireConfig grown with a resolved
            // recoil field" deferral, which is exactly the substrate this
            // pass built — see `ResolvedFireConfig.recoil_impulse`'s own
            // doc comment for the full resolution chain). Parity with
            // World.ts's "recoil-step" case (World.ts:3467-3487): instant
            // hop OPPOSITE the aim direction (hop angle = atan2 toward aim
            // + π, 0.6 vertical factor) plus the rider window weapon.ts's
            // fire site reads to scale self-knockback — here consumed at
            // section 6's fire-recoil block (GEO_RECOIL_STEP_RECOIL_
            // MULTIPLIER). Same `state.header.tick + dur_ticks` window
            // arithmetic as every sibling arm in this switch (sunlance et
            // al.), NOT TS's `tick + 1 + durTicks` — the two agree because
            // Zig's header.tick was already incremented at the top of this
            // step while TS's `state.tick` still holds the pre-step value.
            .recoil_step => {
                const dxr = attacker.aim_x - attacker.x;
                const dyr = attacker.aim_y - attacker.y;
                const hop_angle = trig.lutAtan2(dyr, dxr) + std.math.pi;
                attacker.vx += trig.lutCos(hop_angle) * GEO_RECOIL_STEP_HOP_SPEED;
                attacker.vy += trig.lutSin(hop_angle) * GEO_RECOIL_STEP_HOP_SPEED * 0.6;
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.recoil_step_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            // Sunspike (Paladin/Kindled): v1 = a single fast, narrow,
            // short-range shot — PLAYER-AIMED (the caster's own cursor),
            // NOT auto-targeted, verified directly against World.ts's
            // "sunspike" case (`aimX - nextEntity.x`, unlike its 3 auto-
            // targeted siblings in this sub-group). Inherits the resolved
            // build's own element/shape identity (constants.ts KIN_
            // SUNSPIKE_* header note: "so a fire-handed paladin's Sunspike
            // burns too") — same fallback-to-starter-pistol shape section
            // 6's weapon-fire site already uses for an unresolved fire
            // config. A build resolving to a fire element still won't
            // burn on hit here: that's a PRE-EXISTING gap shared by EVERY
            // build-resolved-element shot in step_world today (verified —
            // the element on-hit switch in section 4 below has no `.fire`
            // arm at all yet, only `.ice`/`.lightning`/`.electric`), not a
            // new gap this ability introduces. Unconditional activation —
            // no target-existence gate, matches World.ts exactly.
            .sunspike => {
                const fcfg = &state.player_fire_config[player_idx];
                const shape = if (fcfg.valid != 0) fcfg.shape else weapons_data.weaponBaseById(.starter_pistol).projectile_shape;
                const element = if (fcfg.valid != 0) fcfg.element else weapons_data.weaponBaseById(.starter_pistol).projectile_element;
                const size_mul: f64 = if (fcfg.valid != 0) fcfg.size_multiplier else 1.0;
                const dx0 = attacker.aim_x - attacker.x;
                const dy0 = attacker.aim_y - attacker.y;
                const aim_angle: f64 = if (dx0 == 0 and dy0 == 0) 0 else trig.lutAtan2(dy0, dx0);
                const lifetime_ms = @max(50.0, (KIN_SUNSPIKE_RANGE_PX / KIN_SUNSPIKE_SPEED) * 1000.0);
                _ = spawnAbilityShard(
                    state,
                    attacker,
                    aim_angle,
                    KIN_SUNSPIKE_SPEED,
                    KIN_SUNSPIKE_DAMAGE,
                    lifetime_ms,
                    @max(2.0, 9.0 * size_mul),
                    shape,
                    element,
                    .straight,
                    KIN_SUNSPIKE_RANGE_PX,
                );
                // Bespoke render identity (`kindledThrust`, types.ts) is
                // client-render-only — a solid symmetric gold spike
                // instead of the build-resolved shape, damage/impact
                // unaffected. No Zig field exists or is needed for it:
                // unlike Hard Aperture/Self-Lattice above (which defer
                // because a REAL gameplay reader is genuinely missing),
                // this one has no gameplay reader by design — TS's own
                // field comment confirms it's presentation-only.
                activated = true;
            },
            .bastion_pulse => {
                const fcfg = &state.player_fire_config[player_idx];
                const max_charge = combat.SHIELD_MAX_CHARGE_DEFAULT * (if (fcfg.valid != 0) fcfg.shield_charge_mul else 1.0);
                const refund: f64 = if (attacker.flags.shield_active)
                    KIN_BASTION_PULSE_SHIELD_REFUND * KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER
                else
                    KIN_BASTION_PULSE_SHIELD_REFUND;
                attacker.shield_charge = @min(max_charge, attacker.shield_charge + refund);
                activated = true;
            },
            // Aegis Share (Kindled — Track Z1a item 3, ally substrate).
            // World.ts's "aegis-share" case: opens the team-peel-radius
            // window on the CASTER unconditionally; solo fallback
            // (axiom-deviations audit, "Kindled — two structural gaps")
            // grants a flat Kindling tick when NO ally stands inside the
            // SAME radius the window actually widens. The window's reader
            // (`findTeamPeelWarderIdx`'s `aegis_share_until_tick` check) is
            // NO LONGER stubbed (Track Z1c "team peel" item, landed after
            // this field was bridged) — the field was carried + bridged
            // here FIRST so that port could consume it without another
            // growth cut; the solo Kindling branch is live either way.
            //
            // TICK BASE — corrected (was `+ 1 + dur_ticks`, same off-by-one
            // class as kindled_resolve's own fix, see that arm's comment
            // for the full derivation): `stepAbilityDispatch` runs AFTER
            // `state.header.tick += 1` already ran for this step, so
            // `state.header.tick` here is ALREADY numerically equal to TS's
            // `state.tick + 1`. TS's "aegis-share" case computes
            // `state.tick + 1 + durTicks`; the Zig-side equivalent is
            // therefore `state.header.tick + dur_ticks` — no extra `+1`.
            // The stale `+1` here double-counted and landed the window one
            // tick late vs TS on every cast; covered by
            // aegisShareRallyLightCastParity.test.ts.
            .aegis_share => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                const solo_ally = findNearestAllyIdx(
                    state,
                    player_idx,
                    WARD_PEEL_RADIUS_PX * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER,
                    false,
                );
                attacker.aegis_share_until_tick = state.header.tick + dur_ticks;
                if (solo_ally < 0) {
                    attacker.kindling = @min(KINDLING_MAX, attacker.kindling + KIN_AEGIS_SHARE_SOLO_KINDLING_FEED);
                }
                activated = true;
            },
            .plant_charge => {
                // Phase 4c — same shared search as Slip Node above (shorter
                // range: "plant-to-plant, not freeflow ninja"), plus a
                // small shield-charge tick for "ends in ward-ready stance"
                // on a successful blink only (World.ts writes the refund
                // inside the same `if (!blocked)` branch as the position
                // write, not unconditionally).
                const dx0 = attacker.aim_x - attacker.x;
                const dy0 = attacker.aim_y - attacker.y;
                const d_len = @sqrt(dx0 * dx0 + dy0 * dy0);
                const dir_x: f64 = if (d_len > 0.001) dx0 / d_len else 1.0;
                const dir_y: f64 = if (d_len > 0.001) dy0 / d_len else 0.0;
                var cx: f64 = undefined;
                var cy: f64 = undefined;
                if (findCollisionFreeLanding(
                    attacker.x,
                    attacker.y,
                    dir_x,
                    dir_y,
                    KIN_PLANT_CHARGE_RANGE_PX,
                    state.statics[0..state.static_count],
                    &cx,
                    &cy,
                )) {
                    const fcfg = &state.player_fire_config[player_idx];
                    const max_charge = combat.SHIELD_MAX_CHARGE_DEFAULT * (if (fcfg.valid != 0) fcfg.shield_charge_mul else 1.0);
                    attacker.x = cx;
                    attacker.y = cy;
                    attacker.shield_charge = @min(max_charge, attacker.shield_charge + KIN_PLANT_CHARGE_SHIELD_REFUND);
                    activated = true;
                }
            },
            // Rally Light (Kindled — Track Z1a item 3). World.ts's
            // "rally-light" case: opens the aura-SOURCE window on the
            // caster — no cross-player write (every beneficiary READS a
            // nearby source's window via hasRallyLightSource and
            // multiplies its OWN speed/damage; see that helper). Consumed
            // at section 7's speed-mul composition, section 4's ranged
            // amp, and resolveInstantAoeCasts — the exact TS consumption
            // set.
            //
            // TICK BASE — corrected (was `+ 1 + dur_ticks`, same off-by-one
            // class as kindled_resolve's own fix and aegis_share's own arm
            // just above, see either for the full derivation):
            // `stepAbilityDispatch` runs AFTER `state.header.tick += 1`
            // already ran for this step, so `state.header.tick` here is
            // ALREADY numerically equal to TS's `state.tick + 1`. TS's
            // "rally-light" case computes `state.tick + 1 + durTicks`; the
            // Zig-side equivalent is therefore `state.header.tick +
            // dur_ticks` — no extra `+1`. The stale `+1` here double-
            // counted and landed the window one tick late vs TS on every
            // cast; covered by aegisShareRallyLightCastParity.test.ts.
            .rally_light => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.rally_light_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            // Kindled Resolve (Paladin) — CONSUMPTION side shipped Phase 4a
            // follow-up: re-verified the original "SIX call sites" citation
            // directly against live World.ts rather than trusting the old
            // line numbers (doctrine #6, the file moves). Found 7 raw call
            // sites, one genuine class-blind pair (:5163 Ninja Slash +
            // :5478 Kindled Edge both call the SAME helper, so "melee
            // damage" is one consumption SHAPE, not two):
            // projectile hit (:1815) — wired, section 4 above, alongside
            // Facet Break/Focus Hex.
            // melee damage, both classes (:5163/:5478) — wired,
            // `stepMeleeSwing` above, generic (not Paladin-gated), matching
            // TS's own class-blind helper call.
            // melee stagger-resist (:5500, Kindled Edge's Unbroken-Seal-
            // triggered stagger only — Ninja Slash has no stagger write to
            // resist against in either codebase) — wired, same site.
            // instant-AOE damage (:4662) — wired, `resolveInstantAoeCasts`
            // above.
            // instant-AOE stagger-resist (:4719) — wired, same function.
            // dash-bash (:4876) — genuinely NO Zig equivalent: grepped
            // directly, `step_world` has no dash-bash power-slide mechanic
            // at all (no "dashing" state, no bash damage constant, nothing
            // — confirmed absent, not just unwired) — this is the one real,
            // verified gap among the 7, deferred alone rather than blocking
            // the other 6 on it, per doctrine #4's "partial-but-correct
            // beats all-or-nothing."
            // CAST side — CLOSED (Track Z5 item 1, 2026-07-26). Prior finding
            // stands (ZERO writes to `.kindling` existed anywhere in
            // sim/src/ when this comment was first written, so gating the
            // cast on `kindling >= KIN_KINDLED_RESOLVE_KINDLING_COST` would
            // have been a dead press forever); that's been false since
            // `applyTeamPeel`/`combat.computeKindledWardMitigation` started
            // granting real Kindling (Track Z1c), so the resource now climbs
            // past 40 in a live match. Wires the cast itself: matches
            // World.ts's "kindled-resolve" case exactly (World.ts:3944-3963)
            // — insufficient Kindling is a dead press (legibility law, same
            // "activated stays false" contract as Judgment Line's no-target
            // case above), no cooldown burn, no spend. On affordability:
            // spends KIN_KINDLED_RESOLVE_KINDLING_COST and opens
            // `kindled_resolve_until_tick`.
            //
            // TICK BASE — verified directly against a real TS/Zig wasm
            // lockstep (kindledResolveCastParity.test.ts), NOT copied blind
            // from rally_light/aegis_share's own "+1" (both untested against
            // a real lockstep cast — only smoke.zig's native hardcoded-
            // number checks exist for them, which can't catch a cross-engine
            // tick-base drift). `stepAbilityDispatch` runs AFTER
            // `state.header.tick += 1` already ran for this step (line
            // ~4449 above), so `state.header.tick` here is ALREADY the
            // POST-increment tick — numerically equal to TS's own
            // `state.tick + 1` (TS's `state.tick` is read PRE-increment
            // throughout `stepWithRuntime`, only becoming `tick+1` in the
            // returned next state). TS's "kindled-resolve" case computes
            // `state.tick + 1 + durTicks`; the Zig-side numeric equivalent
            // is therefore `state.header.tick + dur_ticks` — NO extra `+1`
            // — exactly `.sunlance`'s own already-shipped, already-tested
            // pattern two arms up in this same switch (`sunlance_until_tick
            // = state.header.tick + dur_ticks`), not rally_light/
            // aegis_share's. Adding rally_light's uncritically-copied `+1`
            // here landed the window ONE TICK LATE vs TS on every cast
            // (confirmed empirically before this line was corrected).
            .kindled_resolve => {
                if (attacker.kindling >= KIN_KINDLED_RESOLVE_KINDLING_COST) {
                    const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                    attacker.kindling -= KIN_KINDLED_RESOLVE_KINDLING_COST;
                    attacker.kindled_resolve_until_tick = state.header.tick + dur_ticks;
                    activated = true;
                }
            },
            .bulwark_step => {
                // Phase 4c — same search SHAPE as Plant Charge above, but
                // the direction comes from currently-HELD movement input
                // (LeftBit/RightBit — player.zig's own private `Bit.left`/
                // `Bit.right` values, mirrored locally here exactly like
                // this switch's own FIRE_BIT/ABILITY_BIT precedent
                // elsewhere in this file), never aim — "board-facing
                // shuffle-reposition" per constants.ts's KIN_BULWARK_STEP_*
                // header comment. Falls back to the caster's current
                // horizontal velocity sign, then +X, when neither left nor
                // right is held — same "always resolves a direction, never
                // a dead press for lack of aim" contract Plant Charge's own
                // dx0/dy0 fallback uses. Horizontal-only: dir_y stays 0, so
                // findCollisionFreeLanding's y-bound check degrades to a
                // no-op against the caster's own already-valid y (TS's own
                // case skips that check entirely for the same reason — see
                // findCollisionFreeLanding's own doc comment).
                const LEFT_BIT: u32 = 1 << 0;
                const RIGHT_BIT: u32 = 1 << 1;
                const left_held = (attacker.current_keys & LEFT_BIT) != 0;
                const right_held = (attacker.current_keys & RIGHT_BIT) != 0;
                var dir_x: f64 = undefined;
                if (right_held and !left_held) {
                    dir_x = 1.0;
                } else if (left_held and !right_held) {
                    dir_x = -1.0;
                } else if (@abs(attacker.vx) > 0.01) {
                    dir_x = if (attacker.vx > 0) 1.0 else -1.0;
                } else {
                    dir_x = 1.0;
                }
                var cx: f64 = undefined;
                var cy: f64 = undefined;
                if (findCollisionFreeLanding(
                    attacker.x,
                    attacker.y,
                    dir_x,
                    0.0,
                    KIN_BULWARK_STEP_RANGE_PX,
                    state.statics[0..state.static_count],
                    &cx,
                    &cy,
                )) {
                    // x only — deliberately does NOT touch `shieldActive`;
                    // section 6's tickShield runs AFTER this whole switch
                    // and recomputes it fresh from held input every tick
                    // regardless, so Ward already survives this reposition
                    // (constants.ts's KIN_BULWARK_STEP_RANGE_PX doc comment
                    // has the full "keeps Ward up" verification).
                    attacker.x = cx;
                    activated = true;
                }
            },
            // Bleed Tithe (Priest): SHIPPED this pass (docs/zig-step-world-
            // parity-goal.md) — the deferral's premise ("needs a real
            // fire-burn-on-hit consumption site AND a real leech_fraction
            // consumption site built first") is now closed: section 4's
            // element switch has a real `.fire` arm and a leech-heal block
            // right after it (see both for the consumption half). Cast
            // side: auto-targeted at the nearest enemy in range (dead
            // press, no cooldown burn, if none found — matches World.ts's
            // "severance" precedent immediately below). Genuine per-tick
            // homing (`pathing: .homing`, `has_homing` set by
            // `spawnAbilityShard` from the pathing arg) plus
            // `leech_fraction`/`homing_strength` patched onto the returned
            // pointer afterward — exactly the shape `spawnAbilityShard`'s
            // own doc comment already anticipated this call site needing.
            // `has_leech_fraction` also set explicitly so the field crosses
            // the wasm ABI correctly if this shard is ever inspected
            // cross-boundary (matches the "BRIDGED" contract
            // ProjectileFlags's own doc comment documents for this bit),
            // even though the Zig-internal read site below doesn't gate on
            // it (mirrors TS's plain `leechFraction ?? 0` — no separate
            // boolean check there either).
            .bleed_tithe => {
                const target_idx = findNearestEnemyInRange(state, player_idx, SYZ_ENEMY_SEARCH_RANGE_PX);
                if (target_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(target_idx))];
                    const dx0 = target.x - attacker.x;
                    const dy0 = target.y - attacker.y;
                    const aim_angle = trig.lutAtan2(dy0, dx0);
                    const fcfg = &state.player_fire_config[player_idx];
                    const shape = if (fcfg.valid != 0) fcfg.shape else weapons_data.weaponBaseById(.starter_pistol).projectile_shape;
                    if (spawnAbilityShard(
                        state,
                        attacker,
                        aim_angle,
                        SYZ_BLEED_TITHE_SPEED,
                        SYZ_BLEED_TITHE_DAMAGE,
                        1200.0,
                        8.0,
                        shape,
                        .fire,
                        .homing,
                        null,
                    )) |shard| {
                        shard.leech_fraction = @floatCast(SYZ_BLEED_TITHE_LEECH_FRACTION);
                        shard.flags.has_leech_fraction = true;
                        shard.homing_strength = SYZ_BLEED_TITHE_HOMING_STRENGTH;
                    }
                    activated = true;
                }
            },
            // Severance (Priest): burst curse-detonate on the nearest
            // ALREADY-cursed enemy — "execute-adjacent; take polarity"
            // (verified against World.ts's "severance" case). "Cursed" =
            // an active burn/freeze/slow window, the SAME 3-field OR
            // World.ts's own `requireCursed` option checks — unlike Bleed
            // Tithe above, all three already have real Zig PlayerEntity
            // mirrors AND real Zig consumption elsewhere (burn DoT tick
            // section 8b, freeze/slow movement multipliers section 7) —
            // this ability only READS an existing status, it doesn't need
            // a new one applied ON HIT. The shard itself is a plain
            // straight shot, build-resolved element/shape (same fallback-
            // to-starter-pistol shape every other fcfg-gated read uses),
            // flat SYZ_SEVERANCE_DAMAGE via the SAME generic hit-
            // resolution path every other shard already uses — no bespoke
            // consumption site needed, fully portable. No cursed target in
            // range = a dead press (legibility law, matches World.ts) — no
            // cooldown burn. Bespoke inline scan (not a shared helper):
            // the cursed-predicate is unique to this one ability, same
            // "don't force a shared shape only one consumer needs"
            // discipline Contagion's own scan below and Judgment Line's
            // cone scan already established.
            .severance => {
                var best_idx: i32 = -1;
                var best_dist_sq: f64 = std.math.inf(f64);
                var ei: u32 = 0;
                while (ei < state.player_count) : (ei += 1) {
                    if (ei == player_idx) continue;
                    const other = &state.players[ei];
                    if (!other.flags.alive) continue;
                    const cursed = (other.flags.has_burn and other.burn_until_tick > state.header.tick) or
                        (other.flags.has_freeze and other.freeze_until_tick > state.header.tick) or
                        (other.flags.has_slow and other.slowed_until_tick > state.header.tick);
                    if (!cursed) continue;
                    const dx = other.x - attacker.x;
                    const dy = other.y - attacker.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 > SYZ_ENEMY_SEARCH_RANGE_PX * SYZ_ENEMY_SEARCH_RANGE_PX) continue;
                    if (d2 < best_dist_sq) {
                        best_dist_sq = d2;
                        best_idx = @intCast(ei);
                    }
                }
                if (best_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(best_idx))];
                    const dx0 = target.x - attacker.x;
                    const dy0 = target.y - attacker.y;
                    const aim_angle = trig.lutAtan2(dy0, dx0);
                    const fcfg = &state.player_fire_config[player_idx];
                    const shape = if (fcfg.valid != 0) fcfg.shape else weapons_data.weaponBaseById(.starter_pistol).projectile_shape;
                    const element = if (fcfg.valid != 0) fcfg.element else weapons_data.weaponBaseById(.starter_pistol).projectile_element;
                    _ = spawnAbilityShard(
                        state,
                        attacker,
                        aim_angle,
                        SYZ_SEVERANCE_SPEED,
                        SYZ_SEVERANCE_DAMAGE,
                        1000.0,
                        8.0,
                        shape,
                        element,
                        .straight,
                        null,
                    );
                    activated = true;
                }
            },
            // Borrowed Time (Syzygist — Track Z1a item 3). World.ts's
            // "borrowed-time" case: instant heal to the nearest INJURED
            // ally (auto-target, chassis-aware injury check — the
            // 2026-07-22 maxHealthForPlayer fix, mirrored inside
            // findNearestAllyIdx), self at the doc's weaker solo figures
            // when none; a flat UNCONDITIONAL drain lands
            // SYZ_BORROWED_TIME_DEBT_DELAY_TICKS later (section 8b's debt
            // block). TS defers the ally branch to pendingSyzygistCasts
            // purely for its snapshot-commit hazard — Zig mutates in
            // place, so the cross-player write ships INLINE, same
            // investigated-and-confirmed reasoning as the Contagion arm's
            // own deferred-write note below. Heal caps at the target's
            // REAL max health (chassis base + build add), both branches.
            .borrowed_time => {
                const ally_idx = findNearestAllyIdx(state, player_idx, SYZ_ALLY_SEARCH_RANGE_PX, true);
                const debt_delay_tick: u32 = state.header.tick + 1 + SYZ_BORROWED_TIME_DEBT_DELAY_TICKS;
                if (ally_idx >= 0) {
                    const tidx: u32 = @intCast(ally_idx);
                    const target = &state.players[tidx];
                    target.health = @min(
                        maxHealthForPlayer(target, &state.player_fire_config[tidx]),
                        target.health + SYZ_BORROWED_TIME_HEAL_ALLY,
                    );
                    target.debt_until_tick = debt_delay_tick;
                    target.debt_amount = SYZ_BORROWED_TIME_DRAIN_ALLY;
                } else {
                    attacker.health = @min(
                        maxHealthForPlayer(attacker, &state.player_fire_config[player_idx]),
                        attacker.health + SYZ_BORROWED_TIME_HEAL_SELF,
                    );
                    attacker.debt_until_tick = debt_delay_tick;
                    attacker.debt_amount = SYZ_BORROWED_TIME_DRAIN_SELF;
                }
                activated = true;
            },
            .focus_hex => {
                // Omnidirectional auto-target mark on the CASTER — same
                // shape as Read Mark above but consumed at the generic
                // ranged-hit-resolution site (section 4 below), matching
                // Facet Break's own consumption site, not stepMeleeSwing.
                const target_idx = findNearestEnemyInRange(state, player_idx, SYZ_ENEMY_SEARCH_RANGE_PX);
                if (target_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(target_idx))];
                    const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                    attacker.focus_hex_target_id_len = target.id_len;
                    attacker.focus_hex_target_id_bytes = target.id_bytes;
                    attacker.focus_hex_mark_until_tick = state.header.tick + dur_ticks;
                    activated = true;
                }
            },
            // Contagion (Priest): instant pulse — every OTHER alive player
            // within SYZ_CONTAGION_RADIUS_PX of the caster who is ALREADY
            // burning has that burn "jump" onto the nearest non-burning
            // OTHER player within SYZ_CONTAGION_JUMP_RADIUS_PX of THAT
            // SOURCE — verified directly against World.ts's "contagion"
            // case, not the goal doc's own "jump-targeting" gloss alone.
            //
            // Team-awareness: TS's own isAlly gate (excluding the caster's
            // allies from being a source OR a jump target, World.ts:3968/
            // 3977) is still unported HERE — but the blocking reason
            // changed in Track Z1a item 3: the isAlly substrate now EXISTS
            // (this file's own `isAlly`, and findNearestEnemyInRange now
            // skips allies), so this arm's two gates are an unblocked
            // one-line-each follow-up rather than a substrate deferral.
            // Left un-ported by Z1a's own scoping (its four named
            // abilities don't include Contagion) — a named, now-cheap gap,
            // not a silent one.
            //
            // Deferred-write shape: TS pushes this onto `pendingSyzygistCasts`
            // — a queue resolved in its own dedicated pass after the per-
            // player loop closes — because TS's per-player loop commits via
            // an immutable snapshot-then-whole-record-replace
            // (`players[pid] = nextEntity`), where a cross-player write
            // landing mid-loop is silently lost the moment the target's own
            // turn later commits ITS stale snapshot over it (see this
            // file's section-6a "PLACEMENT / WRITE STRATEGY" comment,
            // already investigated and confirmed a non-issue for Zig).
            // Zig mutates `state.players` directly in place — no snapshot,
            // nothing to lose — so a cross-player write here is exactly as
            // safe as section 6a's melee-hit damage writes or section 4's
            // projectile-hit writes already are: this ships INLINE, no
            // queue that survives past this tick.
            //
            // What Zig DOES still need, that TS's two-phase queue gets for
            // free, is a two-pass split WITHIN this single cast: TS's scan
            // phase finds every qualifying source+jump-target pair against
            // a value that is stable BEFORE any of THIS cast's own writes
            // land, so an early jump inside this same press can never (a)
            // make a LATER source's own target search see an
            // already-mutated victim, or (b) turn a freshly-ignited jump
            // target into a chained SOURCE within the same press.
            // Collecting pairs first and writing second (a small
            // MAX_PLAYERS-sized local scratch array, not a persistent
            // WorldState field — nothing here needs to survive past this
            // switch arm) reproduces that ordering guarantee without a
            // cross-tick queue.
            //
            // burnSourceId is deliberately NOT carried onto the jump target
            // (unlike World.ts's own "carries the ORIGINAL curse's
            // attribution forward" comment) — Zig's PlayerEntity has no
            // burn-source-id field at all (Flock Pulse's own shipped port
            // above already established this: its ally/enemy source-count
            // scaling term, the ONE consumer of burnSourceId in Zig's
            // future, is itself deferred to Phase 3). Copying a field that
            // doesn't exist and has no reader would be exactly the
            // "half-ported, silently wrong" shape doctrine #4 exists to
            // avoid — burn_until_tick/burn_dps/burn_tick_last_applied/
            // has_burn are the only fields that have a real Zig reader
            // (section 8b's burn DoT tick), so those are the only ones
            // this copies.
            .contagion => {
                var jump_src: [world_state.MAX_PLAYERS]u32 = undefined;
                var jump_tgt: [world_state.MAX_PLAYERS]u32 = undefined;
                var jump_count: u32 = 0;
                var src_i: u32 = 0;
                while (src_i < state.player_count) : (src_i += 1) {
                    if (src_i == player_idx) continue;
                    const source = &state.players[src_i];
                    if (!source.flags.alive) continue;
                    if (!source.flags.has_burn or source.burn_until_tick <= state.header.tick) continue;
                    const dsx = source.x - attacker.x;
                    const dsy = source.y - attacker.y;
                    if (dsx * dsx + dsy * dsy > SYZ_CONTAGION_RADIUS_PX * SYZ_CONTAGION_RADIUS_PX) continue;
                    var best_idx: i32 = -1;
                    var best_dist_sq: f64 = std.math.inf(f64);
                    var tgt_i: u32 = 0;
                    while (tgt_i < state.player_count) : (tgt_i += 1) {
                        if (tgt_i == src_i or tgt_i == player_idx) continue;
                        const other = &state.players[tgt_i];
                        if (!other.flags.alive) continue;
                        if (other.flags.has_burn and other.burn_until_tick > state.header.tick) continue;
                        const dx = other.x - source.x;
                        const dy = other.y - source.y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 > SYZ_CONTAGION_JUMP_RADIUS_PX * SYZ_CONTAGION_JUMP_RADIUS_PX) continue;
                        if (d2 < best_dist_sq) {
                            best_dist_sq = d2;
                            best_idx = @intCast(tgt_i);
                        }
                    }
                    if (best_idx >= 0 and jump_count < world_state.MAX_PLAYERS) {
                        jump_src[jump_count] = src_i;
                        jump_tgt[jump_count] = @intCast(best_idx);
                        jump_count += 1;
                    }
                }
                var jumped = false;
                var k: u32 = 0;
                while (k < jump_count) : (k += 1) {
                    const s = &state.players[jump_src[k]];
                    const t = &state.players[jump_tgt[k]];
                    // Defensive re-check (matches World.ts's own
                    // resolution-time re-check comment) — nothing else
                    // this cast clears burn between scan and here, but
                    // guard anyway rather than trust a stale read.
                    if (s.flags.has_burn and s.burn_until_tick > state.header.tick) {
                        t.burn_until_tick = s.burn_until_tick;
                        t.burn_dps = s.burn_dps;
                        t.burn_tick_last_applied = state.header.tick;
                        t.flags.has_burn = true;
                        jumped = true;
                    }
                }
                activated = jumped;
            },
            // Self-Lattice (Priest, shipped this pass — closes the Phase 4a
            // deferral). Writes the SAME wardAbsorbUntilTick/
            // wardAbsorbRemaining pair Glass Ward/Aegis Share (still
            // deferred) would also write, self-only, bypassing the isAlly
            // team gate — matches World.ts's "self-lattice" case exactly,
            // including its lack of a `wardAbsorbSourceId` gameplay
            // consumer in Zig (that field only ever feeds a
            // `syz-ward-absorbed` event's `casterId` cosmetic attribution
            // in TS — no Zig PlayerEntity mirror exists for it, and
            // step_world has no such event type; self-cast makes the
            // source trivially "self" anyway, so nothing is lost). The
            // consumption half now lives at BOTH `stepMeleeSwing` and
            // section 4's projectile-vs-player hit resolution — see
            // `SYZ_SELF_LATTICE_ABSORB`'s own doc comment above for the
            // exact absorb-pool mechanic (flat pool, not a %, mutually
            // exclusive with the generic shield step, matching
            // combat.ts's `trySyzygistWard` early-return ordering).
            .self_lattice => {
                attacker.syz_ward_absorb_until_tick = state.header.tick + 1 + SYZ_WARD_DURATION_TICKS_DEFAULT;
                attacker.syz_ward_absorb_remaining = SYZ_SELF_LATTICE_ABSORB;
                // Track Z1a item 3 fix (found porting Glass Ward): without
                // this bit the bridge's unpack drops the pool (its decode
                // gates on hasSyzWard) and the next full-sync repack wipes
                // it — the Z0e bug class, here as a one-flag omission.
                attacker.flags.has_syz_ward = true;
                activated = true;
            },
            // Glass Ward (Syzygist — Track Z1a item 3). World.ts's
            // "glass-ward" case: stronger absorb on the nearest ally
            // (auto-target, injury NOT required), self at reduced strength
            // if none in range. Writes the same field pair Self-Lattice
            // (below) already writes — the ally branch is the isAlly-gated
            // cross-player write TS routes through applyWardToAlly
            // (deferred there, inline here — the Contagion precedent).
            // `flags.has_syz_ward` is set alongside the fields on BOTH
            // branches: the bridge's unpack gates the round-trip on that
            // bit, so without it the pool would be invisible to TS and
            // wiped by the next full-sync repack (the Z0e bug class).
            // wardAbsorbSourceId stays unported (Self-Lattice's own
            // documented reasoning — TS-cosmetic attribution only).
            .glass_ward => {
                const ally_idx = findNearestAllyIdx(state, player_idx, SYZ_ALLY_SEARCH_RANGE_PX, false);
                if (ally_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(ally_idx))];
                    target.syz_ward_absorb_until_tick = state.header.tick + 1 + SYZ_WARD_DURATION_TICKS_DEFAULT;
                    target.syz_ward_absorb_remaining = SYZ_GLASS_WARD_ALLY_ABSORB;
                    target.flags.has_syz_ward = true;
                } else {
                    attacker.syz_ward_absorb_until_tick = state.header.tick + 1 + SYZ_WARD_DURATION_TICKS_DEFAULT;
                    attacker.syz_ward_absorb_remaining = SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB;
                    attacker.flags.has_syz_ward = true;
                }
                activated = true;
            },
            .haste_gift => {}, // Phase 4 — not yet ported
            .drift_step => {
                // Phase 4c — same shared search as Slip Node/Plant Charge
                // above. The ONE catalog ability the doc tags "(player
                // aim)" — deliberately aim-directed like Slip Node/Plant
                // Charge rather than the Syzygist low-aim auto-target
                // helpers this class's OTHER abilities use (Haste Gift/
                // Flock Pulse etc.) — verified directly against the
                // constants.ts SYZ_DRIFT_STEP_RANGE_PX header note, not
                // assumed. The doc's "snap slightly toward/away an
                // entangled entity" nuance is a recorded v1 deferral in TS
                // itself (World.ts's own comment: "would need a second,
                // target-aware branch on top of the shared blink-search
                // loop") — Zig mirrors that same v1 scope, not a Zig-only
                // gap.
                const dx0 = attacker.aim_x - attacker.x;
                const dy0 = attacker.aim_y - attacker.y;
                const d_len = @sqrt(dx0 * dx0 + dy0 * dy0);
                const dir_x: f64 = if (d_len > 0.001) dx0 / d_len else 1.0;
                const dir_y: f64 = if (d_len > 0.001) dy0 / d_len else 0.0;
                var cx: f64 = undefined;
                var cy: f64 = undefined;
                if (findCollisionFreeLanding(
                    attacker.x,
                    attacker.y,
                    dir_x,
                    dir_y,
                    SYZ_DRIFT_STEP_RANGE_PX,
                    state.statics[0..state.static_count],
                    &cx,
                    &cy,
                )) {
                    attacker.x = cx;
                    attacker.y = cy;
                    activated = true;
                }
            },
            // Needle (Ninja): auto-targeted gap-finish — a short self-lunge
            // toward the nearest enemy in range (clamped short of contact,
            // flavor "already closed the distance") plus a fast, short-
            // range, high-damage shard. Element FIXED at "crystal" (NOT
            // build-resolved, unlike Sunspike/Severance above — verified
            // directly against World.ts's "needle" case), shape stays
            // build-resolved. "Crystal" has no on-hit special-case in
            // either TS or Zig (it's the sim-wide default/neutral element)
            // — no gap, this ability's shard needs nothing section 4's
            // element switch doesn't already cover today. The self-lunge
            // only ever writes `attacker.x`/`attacker.y` (the CASTER's own
            // position) — no cross-player write, no deferred-queue
            // question at all, same shape World.ts's own case comment
            // makes explicit ("rather than a hand-rolled direct-damage
            // write that would need a cross-player deferred-write queue
            // this chassis's kit otherwise never needs"). No enemy in
            // range = a dead press, no lunge, no cooldown burn.
            .needle => {
                const target_idx = findNearestEnemyInRange(state, player_idx, NINJA_NEEDLE_RANGE_PX);
                if (target_idx >= 0) {
                    const target = &state.players[@as(usize, @intCast(target_idx))];
                    const dx0 = target.x - attacker.x;
                    const dy0 = target.y - attacker.y;
                    const dist = @sqrt(dx0 * dx0 + dy0 * dy0);
                    const dir_x: f64 = if (dist > 0.001) dx0 / dist else 1.0;
                    const dir_y: f64 = if (dist > 0.001) dy0 / dist else 0.0;
                    const lunge = @min(NINJA_NEEDLE_LUNGE_PX, @max(0.0, dist - 20.0));
                    attacker.x += dir_x * lunge;
                    attacker.y += dir_y * lunge;
                    const aim_angle = trig.lutAtan2(dy0, dx0);
                    const fcfg = &state.player_fire_config[player_idx];
                    const shape = if (fcfg.valid != 0) fcfg.shape else weapons_data.weaponBaseById(.starter_pistol).projectile_shape;
                    const lifetime_ms = @max(50.0, (NINJA_NEEDLE_RANGE_PX / NINJA_NEEDLE_SPEED) * 1000.0);
                    _ = spawnAbilityShard(
                        state,
                        attacker,
                        aim_angle,
                        NINJA_NEEDLE_SPEED,
                        NINJA_NEEDLE_DAMAGE,
                        lifetime_ms,
                        7.0,
                        shape,
                        .crystal,
                        .straight,
                        NINJA_NEEDLE_RANGE_PX,
                    );
                    // `ninjaBladeShard` (types.ts) is client-render-only,
                    // same "no gameplay reader by design" reasoning
                    // Sunspike's `kindledThrust` comment above already
                    // covers — no Zig field needed.
                    activated = true;
                }
            },
            // Ghost Guard (Ninja): SHIPPED this pass (docs/zig-step-world-
            // parity-goal.md) — corrected finding, not just a re-attempt:
            // the earlier deferral's premise ("consumed by a branch right
            // after the always-on dash-i-frame check... a `dashing`
            // boolean that has NO Zig PlayerEntity mirror") does NOT
            // actually hold for THIS ability. Re-verified directly against
            // combat.ts's `tryDeflectDamage`: Ghost Guard's own branch
            // (step 0.6) has no `player.dashing` check anywhere in its
            // condition — only a class check, this window, and the
            // VICTIM's own current velocity magnitude
            // (`NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD`). The dash-i-frame
            // check immediately above it (step 0.5, a DIFFERENT, bigger
            // ninja-invuln-while-dashing feature) is genuinely still
            // unported and out of this pass's scope — but Ghost Guard
            // itself never reads `dashing` at all, so it doesn't need that
            // substrate to function correctly. Consumption wired at all 3
            // mitigation sites (`stepMeleeSwing`, section 4's projectile
            // loop, `resolveInstantAoeCasts`) — see each site's own doc
            // comment. This arm only opens the window, same "plain u32
            // tick" shape as every sibling window-open above; "if moving"
            // is re-checked at hit time against the victim's OWN velocity,
            // not baked in here.
            .ghost_guard => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.ghost_guard_charge_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
            // Razor Route (Ninja): SHIPPED this pass (docs/zig-step-world-
            // parity-goal.md) — corrected finding: the original deferral's
            // premise ("needs the dash-through body-cross substrate... a
            // `dashing` boolean that has NO Zig PlayerEntity mirror at
            // all") is technically true (no wire-visible PlayerEntity
            // field) but doesn't survive investigation of what's ACTUALLY
            // needed — `state.player_movement[i].dash_active_ms > 0.0` IS
            // the derived Zig equivalent of TS's `attacker.dashing ===
            // true` (player.zig's own dash-timer memory already tracks
            // exactly this internally), and `MeleeSwingMemory` already had
            // a per-player host-only slot to carry the extra
            // dashThroughTagged/wasDashing/razorRouteActiveDash bookkeeping
            // (grown this pass — see that struct's own doc comment). This
            // arm only opens the window (`razor_route_until_tick`) — the
            // REAL effect (the velocity boost + "marks Read on the first
            // body crossed") is consumed by the NEXT dash's rising edge,
            // in world.zig section 8's own dash-through detection block
            // (right after Wall Bloom/Shock Ring's landing hooks), not
            // here. Same "plain u32 tick" shape as every sibling
            // window-open ability.
            .razor_route => {
                const dur_ticks: u32 = @intFromFloat(@ceil((active_spec.duration_ms orelse 0) / @max(1.0, eff_dt)));
                attacker.razor_route_until_tick = state.header.tick + dur_ticks;
                activated = true;
            },
        }

        if (!activated) continue; // a press that does nothing burns no cooldown

        const cd_ticks: u32 = @intFromFloat(@ceil(active_spec.cooldown_ms / @max(1.0, eff_dt)));
        attacker.slot_cooldown_until_tick[slot] = state.header.tick + cd_ticks;
    }
}

/// Start a melee swing toward an absolute aim POINT (cursor coords) —
/// shared by the idle fresh-press path and the R1-row-1 buffered-press
/// consume paths (2026-07-24). Bit-exact mirror of World.ts's
/// `startSwing` closures (ninja + paladin blocks): direction normalizes
/// from the attacker's position AT FIRE TIME toward the point (+X
/// fallback when the cursor sits on the body), the per-swing victim mask
/// clears, and the buffer zeroes so one press can never double-fire.
fn startMeleeSwingFromAim(
    mem: *world_state.MeleeSwingMemory,
    attacker: *const world_state.PlayerEntity,
    aim_point_x: f64,
    aim_point_y: f64,
    windup_ms: f64,
) void {
    const dx = aim_point_x - attacker.x;
    const dy = aim_point_y - attacker.y;
    const len = @sqrt(dx * dx + dy * dy);
    mem.phase = .windup;
    mem.phase_ms = windup_ms;
    mem.aim_x = if (len > 1e-3) dx / len else 1.0;
    mem.aim_y = if (len > 1e-3) dy / len else 0.0;
    mem.hit_this_swing_mask = 0;
    mem.buffered_ms = 0;
}

/// Advance one attacker's melee swing FSM one tick + resolve the arc
/// hit-check when contact-delay-gated active. `fire_rising_edge` MUST be
/// captured before section 6 (below, in stepWorld) rolls
/// `prev_keys = current_keys` for every player — see stepWorld's own
/// "melee rising-edge capture" comment for why a pre-captured bool is
/// threaded in rather than re-deriving the edge from
/// `attacker.current_keys`/`attacker.prev_keys` here.
fn stepMeleeSwing(
    state: *world_state.WorldState,
    attacker_idx: u32,
    eff_dt: f64,
    fire_rising_edge: bool,
    ward_raise_edge: bool,
) void {
    const attacker = &state.players[attacker_idx];
    if (!attacker.flags.alive) {
        // Death resets the bash chain (ledger design-decision block, TS
        // mirror: the dead-paladin branch of World.ts's 1z3 loop) — a
        // respawn always re-opens with blades. Harmless no-op for every
        // non-paladin (their chain fields are always 0).
        state.melee_swing[attacker_idx].chain_index = 0;
        state.melee_swing[attacker_idx].chain_gap_ms = 0;
        return;
    }
    // classIdForArchetype(...) === "ninja" / "paladin" (cardTypes.ts's
    // ARCHETYPE_CLASS_ID: sprinter->ninja, heavy->paladin) — same inline-
    // comparison convention section 6 already uses for `is_wizard_channel`
    // (`character_id == .balanced`) rather than a named helper function.
    const is_ninja = attacker.character_id == .sprinter;
    const is_paladin = attacker.character_id == .heavy;
    if (!is_ninja and !is_paladin) return;

    const range: f64 = if (is_ninja) SLASH_RANGE else EDGE_RANGE;
    const arc: f64 = if (is_ninja) SLASH_ARC_RADIANS else EDGE_ARC_RADIANS;
    const damage: f64 = if (is_ninja) SLASH_DAMAGE else EDGE_DAMAGE;
    const knockback: f64 = if (is_ninja) SLASH_KNOCKBACK else EDGE_KNOCKBACK;
    const knock_up: f64 = if (is_ninja) SLASH_KNOCK_UP else EDGE_KNOCK_UP;
    const windup_ms: f64 = if (is_ninja) SLASH_WINDUP_MS else EDGE_WINDUP_MS;
    const active_ms: f64 = if (is_ninja) SLASH_ACTIVE_MS else EDGE_ACTIVE_MS;
    const recovery_ms: f64 = if (is_ninja) SLASH_RECOVERY_MS else EDGE_RECOVERY_MS;
    const contact_delay_ms: f64 = if (is_ninja) SLASH_CONTACT_DELAY_MS else EDGE_CONTACT_DELAY_MS;

    const mem = &state.melee_swing[attacker_idx];

    // ---- Swing FSM (idle -> windup -> active -> recovery -> idle) ----
    const was_active = mem.phase == .active;
    const active_elapsed_before: f64 = if (was_active) active_ms - mem.phase_ms else 0;
    // Edge Storm (Ninja) — wave-off-swing gate (2026-07-20, Phase 1 ability-
    // cast dispatch pass). Set true on the EXACT tick the swing transitions
    // active -> recovery, mirroring World.ts's own `waveShouldSpawn` local
    // (World.ts:4737/4764 — "aftermath of contact, not a free cast: fires
    // regardless of whether the arc landed a hit"). Computed for BOTH
    // classes (this FSM is shared) but only ever ACTED on below when
    // `is_ninja` — Paladin has no wave in TS, matching this gate with a
    // dead-but-harmless `true` for a paladin swing is simpler than forking
    // the shared FSM update just to skip setting one bool.
    var wave_should_spawn = false;

    // Age the buffered press BEFORE this tick's capture (a press stored
    // this very tick keeps its full window, starts aging next tick) —
    // exact ordering mirror of World.ts's own buffer block (2026-07-24,
    // slash-feel-ledger R1 row 1).
    if (mem.buffered_ms > 0) mem.buffered_ms = @max(0.0, mem.buffered_ms - eff_dt);

    // Chain-reset clock (Kindled's bash OR Ninja's own STAB, 2026-07-26
    // Track F1 — ledger design-decision block): idle time accrues; past the
    // class's own gap the chain cools back to ordinary swings. Runs BEFORE
    // any swing start this tick — exact ordering mirror of World.ts's 1z3/
    // 1z2 blocks.
    if ((is_paladin or is_ninja) and mem.phase == .idle) {
        mem.chain_gap_ms += eff_dt;
        const chain_gap_limit: f64 = if (is_paladin) KIN_BASH_CHAIN_GAP_MS else NINJA_STAB_CHAIN_GAP_MS;
        if (mem.chain_gap_ms > chain_gap_limit) mem.chain_index = 0;
    }

    if (mem.phase == .idle) {
        // A fresh press from idle starts a swing immediately; otherwise a
        // still-live buffered press (queued mid-swing, consumed on the
        // recovery→idle transition below — this branch is the defensive
        // idle-consume mirror of TS's) fires now.
        if (fire_rising_edge) {
            startMeleeSwingFromAim(mem, attacker, attacker.aim_x, attacker.aim_y, windup_ms);
        } else if (mem.buffered_ms > 0) {
            startMeleeSwingFromAim(mem, attacker, mem.buffered_aim_x, mem.buffered_aim_y, windup_ms);
        }
    } else {
        // Press mid-swing: QUEUE it (latest press wins, cursor point
        // captured at press time) instead of eating it — R1 row 1.
        if (fire_rising_edge) {
            mem.buffered_ms = MELEE_BUFFER_MS;
            mem.buffered_aim_x = attacker.aim_x;
            mem.buffered_aim_y = attacker.aim_y;
        }
        mem.phase_ms -= eff_dt;
        if (mem.phase_ms <= 0) {
            switch (mem.phase) {
                .windup => {
                    mem.phase = .active;
                    mem.phase_ms = active_ms;
                },
                .active => {
                    mem.phase = .recovery;
                    mem.phase_ms = recovery_ms;
                    wave_should_spawn = true;
                },
                .recovery => {
                    mem.phase = .idle;
                    mem.phase_ms = 0;
                    // Chain advances per STARTED swing (whiffs count —
                    // cadence is rhythm, not hit-confirm), stamped at the
                    // swing's end so the position is stable for the swing's
                    // whole lifetime. Matches World.ts's 1z3 (Kindled bash)
                    // / 1z2 (Ninja stab, Track F1).
                    if (is_paladin or is_ninja) {
                        mem.chain_index = (mem.chain_index + 1) % 3;
                        mem.chain_gap_ms = 0;
                    }
                    // Buffered press fires AT phase 0 — the same tick
                    // recovery expires, zero dead frames ("smooth on
                    // retrig"), matching World.ts exactly.
                    if (mem.buffered_ms > 0) {
                        startMeleeSwingFromAim(mem, attacker, mem.buffered_aim_x, mem.buffered_aim_y, windup_ms);
                    }
                },
                .idle => unreachable,
            }
        }
    }

    // ---- Cancel window (R1 row 16, 2026-07-24 wave 2) — exact mirror of
    //      World.ts's 1z3 cancel block (see KIN_CANCEL_TAIL_FRACTION's TS
    //      doc block for the design): runs AFTER the FSM advance, rising
    //      edges only, engaged-ward gate (flags.shield_active is section-
    //      6-final by the time 6a runs), a queued swing WINS, and the
    //      chain still advances on cancel. `was_dashing` is free on the
    //      paladin path — the ninja dash-through pass that rolls it is
    //      gated `character_id == .sprinter`. ----
    if (is_paladin) {
        const dashing_now = state.player_movement[attacker_idx].dash_active_ms > 0.0;
        const dash_started_this_tick = dashing_now and !mem.was_dashing;
        mem.was_dashing = dashing_now;
        const ward_raised_this_tick = ward_raise_edge and attacker.flags.shield_active;
        if (mem.phase == .recovery and
            mem.phase_ms <= EDGE_RECOVERY_MS * KIN_CANCEL_TAIL_FRACTION and
            mem.buffered_ms <= 0 and
            (dash_started_this_tick or ward_raised_this_tick))
        {
            mem.phase = .idle;
            mem.phase_ms = 0;
            mem.chain_index = (mem.chain_index + 1) % 3;
            mem.chain_gap_ms = 0;
        }
    }

    // ---- Contact-delay gate: the arc goes live at the start of `active`,
    //      but only DAMAGES from `contact_delay_ms` into that window
    //      onward (the blade visually crosses the aim radius partway
    //      through the swing, not on the very first active tick). Mirrors
    //      World.ts's `hasReachedSlashContact`/equivalent Edge check
    //      exactly, including the "elapsed" accounting across the tick
    //      that just transitioned OUT of active (`wasActive`). ----
    // Which verb is the CURRENT swing? (SHIELD BASH / NINJA STAB — chain
    // position 2, whichever class this player is.) Stable for the swing's
    // whole lifetime: chain_index only advances at recovery→idle, and the
    // contact gate below can never be reached on that transition tick.
    // Exact mirror of World.ts's swingIsBash/swingIsStab/swing* locals.
    const swing_is_bash = is_paladin and mem.chain_index == 2;
    const swing_is_stab = is_ninja and mem.chain_index == 2;
    const eff_range: f64 = if (swing_is_bash) SHIELD_BASH_RANGE else if (swing_is_stab) NINJA_STAB_RANGE else range;
    const eff_arc: f64 = if (swing_is_bash) SHIELD_BASH_ARC_RADIANS else if (swing_is_stab) NINJA_STAB_ARC_RADIANS else arc;
    const eff_damage: f64 = if (swing_is_bash) SHIELD_BASH_DAMAGE else if (swing_is_stab) NINJA_STAB_DAMAGE else damage;
    const eff_knockback: f64 = if (swing_is_bash) SHIELD_BASH_KNOCKBACK else if (swing_is_stab) NINJA_STAB_KNOCKBACK else knockback;
    const eff_knock_up: f64 = if (swing_is_bash) SHIELD_BASH_KNOCK_UP else if (swing_is_stab) NINJA_STAB_KNOCK_UP else knock_up;
    const eff_contact_delay: f64 = if (swing_is_bash) SHIELD_BASH_CONTACT_DELAY_MS else if (swing_is_stab) NINJA_STAB_CONTACT_DELAY_MS else contact_delay_ms;

    const is_active_now = mem.phase == .active;
    const active_elapsed_after: f64 = if (is_active_now)
        active_ms - mem.phase_ms
    else if (was_active)
        @min(active_ms, active_elapsed_before + eff_dt)
    else
        0;
    const reached_contact = (was_active or is_active_now) and active_elapsed_after >= eff_contact_delay;
    if (!reached_contact) return;

    // Hangout: the swing FSM itself stays live (windup/active/recovery all
    // ran above, same as TS), but the player arc hit-check below never runs
    // — World.ts gates it `hasReachedSlashContact && !hangoutMode` (:5725)
    // / `hasReachedEdgeContact && !hangoutMode` (:6148). TS's hangout-only
    // ALTERNATE (arc-vs-destructible practice-dummy hits, :5904/:6334)
    // remains unported — it needs a per-swing destructible dedupe set in
    // the ABI-frozen MeleeSwingMemory (see the "deliberately NOT ported"
    // list in this fn's doc comment).
    if (g_hangout_mode) return;

    // ---- Arc hit-check (from the contact-delay tick onward, every
    //      victim in the cone — not "first hit only") ----
    const aim_angle = trig.lutAtan2(mem.aim_y, mem.aim_x);
    const half_arc = eff_arc / 2.0;

    var vi: u32 = 0;
    while (vi < state.player_count) : (vi += 1) {
        if (vi == attacker_idx) continue;
        const bit: u16 = @as(u16, 1) << @as(u4, @intCast(vi));
        if ((mem.hit_this_swing_mask & bit) != 0) continue;
        const victim = &state.players[vi];
        if (!victim.flags.alive) continue;
        const box = combat.playerHitboxAabb(victim.x, victim.y, victim.flags.crouching, victim.character_id);
        if (!combat.isBodyInMeleeArc(attacker.x, attacker.y, aim_angle, half_arc, eff_range, victim.x, victim.y, box)) {
            continue;
        }
        mem.hit_this_swing_mask |= bit;

        // Ninja dash i-frames (Track Z1c "ninja dash i-frames" item) —
        // checked BEFORE Ghost Guard (TS step 0.5, ahead of step 0.6) and
        // BEFORE knockback, same "no damage, no knockback, no event" shape
        // Ghost Guard's own `continue` immediately below already
        // establishes (TS's `post = mit.evaded ? mit.player : {...
        // knockback}` means an evaded hit gets no knockback either).
        if (isNinjaEvading(state, vi)) continue;
        // Ghost Guard (Ninja, this pass) — banked evasion charge, checked
        // BEFORE knockback: TS's own `post = mit.evaded ? mit.player :
        // {...knockback}` (World.ts:5271-5277) means an evaded hit gets NO
        // knockback either, not just no damage. Same tryDeflectDamage step
        // 0.6 ordering as every other site — ahead of Self-Lattice/shield,
        // both of which stay correctly reachable below. "If moving": the
        // VICTIM's own current velocity at hit time (not cast time).
        if (victim.character_id == .sprinter and
            victim.ghost_guard_charge_until_tick > state.header.tick and
            @sqrt(victim.vx * victim.vx + victim.vy * victim.vy) > combat.NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD)
        {
            victim.ghost_guard_charge_until_tick = 0;
            continue; // evaded: no damage, no knockback, no event — "victim phased through"
        }

        // Knockback lands on every arc hit that wasn't evaded above (TS:
        // `post` always gets the knockback velocity unless `mit.evaded`).
        // Bash knockback is the game's biggest (control, not DPS).
        victim.vx = mem.aim_x * eff_knockback;
        victim.vy = mem.aim_y * eff_knockback - eff_knock_up;

        // Self-Lattice (Priest) — Syzygist Ward's flat absorb pool, checked
        // BEFORE the generic shield step and mutually exclusive with it
        // (same ordering/reasoning as section 4's own consumption site —
        // see that site's own doc comment for the full citation). Melee is
        // a genuine consumer here (this function's own doc comment above
        // now explains why), unlike parry/directional-shield which stay
        // correctly absent.
        var damage_after_ward = eff_damage;
        var syz_ward_consumed = false;
        if (victim.syz_ward_absorb_until_tick > state.header.tick and victim.syz_ward_absorb_remaining > 0) {
            syz_ward_consumed = true;
            const blocked = @min(damage_after_ward, victim.syz_ward_absorb_remaining);
            victim.syz_ward_absorb_remaining -= blocked;
            damage_after_ward -= blocked;
            if (victim.syz_ward_absorb_remaining <= 0) {
                victim.syz_ward_absorb_remaining = 0;
                victim.syz_ward_absorb_until_tick = 0;
            }
        }

        // Kindled Ward (Paladin) — REPLACES the generic shield mitigation
        // below entirely for this class (Track Z1c "Kindled Ward partial
        // mitigation" item — this section's own doc comment used to say
        // Kindled Ward had "NO Zig implementation anywhere"). The "source"
        // for melee's null-projectile hit is the ATTACKER's own CURRENT
        // position, matching TS's melee call site's `attackerPos: {x:
        // attacker.x, y: attacker.y}` exactly. `kindled_warded` gates team
        // peel below (TS: `if (!mitigation.warded)`). Skipped entirely
        // when Syzygist Ward already consumed this hit above (mutual
        // exclusivity, matches TS).
        var kindled_warded = false;
        if (!syz_ward_consumed and victim.flags.shield_active and victim.flags.has_shield_charge and victim.shield_charge > 0 and victim.character_id == .heavy) {
            const dx_aim = victim.aim_x - victim.x;
            const dy_aim = victim.aim_y - victim.y;
            const facing = if (dx_aim == 0.0 and dy_aim == 0.0) 0.0 else trig.lutAtan2(dy_aim, dx_aim);
            const in_cone = combat.isSourceInWardCone(victim.x, victim.y, facing, attacker.x, attacker.y);
            const mit = combat.computeKindledWardMitigation(damage_after_ward, in_cone);
            if (mit.applies) {
                victim.kindling = @min(KINDLING_MAX, victim.kindling + mit.kindling_granted);
                kindled_warded = true;
            }
            damage_after_ward = mit.damage;
            // no charge drain either way — falls through to the ability-
            // card hooks / health write below.
        } else if (!syz_ward_consumed and victim.flags.shield_active and victim.flags.has_shield_charge and victim.shield_charge > 0 and victim.character_id != .sprinter) {
            // Generic shield mitigation (wizard/priest — see this
            // section's own doc comment for why parry/directional-facing
            // are correctly absent here). Ninja/Interstice is EXCLUDED
            // (LOCKED doctrine: shield never mitigates) — falls straight
            // through unmitigated, same as shield_active===false.
            victim.shield_charge -= damage_after_ward * combat.SHIELD_HIT_DRAIN_MULTIPLIER;
            if (victim.shield_charge <= 0) {
                victim.shield_charge = 0;
                victim.flags.shield_active = false;
                emitEvent(state, .shield_popped, @intCast(vi), -1, 0, 0, victim.x, victim.y);
            }
            continue;
        }

        // ── Ability-card hooks (Phase 1, docs/zig-step-world-parity-goal.md)
        //    — Read Mark's amp, Undercut's execute (Ninja); Judgment Line's
        //    amp, Unbroken Seal's amp+stagger (Paladin). Reads `attacker.*`
        //    directly (not a re-fetched "live attacker" the way World.ts
        //    needs to, per that file's own comment at this exact site) —
        //    Zig mutates `state.players` in place, so `attacker` is ALREADY
        //    the live record; no TS-style frozen-snapshot hazard exists
        //    here (this function's own doc comment above establishes that
        //    for the whole section). `victim.health` is read BEFORE this
        //    hit's damage is applied, matching TS's own execute-threshold
        //    check ("a target already at or below the threshold").
        //
        //    DELIBERATELY NOT applied here (same "correctness over
        //    completeness" scope as the rest of this pass — see the
        //    report): fooledDamageMultiplier (Paper Double burst — no
        //    fooled_until_tick field on PlayerEntity yet), rallyLight
        //    damage multiplier (CORRECTED reasoning, Track Z1a item 3:
        //    Rally Light is now live in Zig, but TS's melee sites apply
        //    kindledResolve WITHOUT rally — grep World.ts: the rally amp's
        //    only call sites are resolveRangedHit :1844 and the AOE
        //    resolver :4861, despite :1844's own "bash/slash/edge" prose —
        //    so its absence HERE is exact TS parity, not a stub). Team peel
        //    is NO LONGER in this list either (Track Z1c "team peel" item)
        //    — see the health-write site just below this if/else.
        //    kindledResolveDamageMultiplier/
        //    applyKindledResolveStaggerResist are NO LONGER in this
        //    "unreachable" list (Phase 4a follow-up, this pass) — see the
        //    generic post-class-switch block below, right after this
        //    if/else. Every one
        //    of these is a TRUE no-op today given nothing upstream can
        //    populate the state they'd read, not a silent shortcut.
        var final_damage = damage_after_ward;
        if (is_ninja) {
            if (attacker.read_mark_until_tick > state.header.tick and
                attacker.read_target_id_len == victim.id_len and
                std.mem.eql(u8, attacker.read_target_id_bytes[0..attacker.read_target_id_len], victim.id_bytes[0..victim.id_len]))
            {
                final_damage *= NINJA_READ_MARK_AMP_MULTIPLIER;
            }
            // Undercut: a landed arc hit against a target already at or
            // below the execute threshold becomes a guaranteed kill while
            // the window lives — non-consuming (no clearing here, matches
            // World.ts).
            if (attacker.undercut_until_tick > state.header.tick and
                victim.health <= NINJA_UNDERCUT_HEALTH_THRESHOLD)
            {
                final_damage = @max(final_damage, victim.health);
            }
        }
        var stagger_victim = false;
        if (is_paladin) {
            if (attacker.judgment_mark_until_tick > state.header.tick and
                attacker.judgment_target_id_len == victim.id_len and
                std.mem.eql(u8, attacker.judgment_target_id_bytes[0..attacker.judgment_target_id_len], victim.id_bytes[0..victim.id_len]))
            {
                final_damage *= KIN_JUDGMENT_AMP_MULTIPLIER;
            }
            if (attacker.seal_until_tick > state.header.tick) {
                final_damage *= KIN_SEAL_DAMAGE_MULTIPLIER;
                stagger_victim = true;
                // Consumed on this landed hit, not just on timeout — "the
                // NEXT Kindled Edge hit" (matches World.ts). Cleared via
                // `attacker` directly (the live record), not a re-fetch.
                attacker.seal_until_tick = 0;
            }
        }
        // Kindled Resolve (Paladin, Phase 4a follow-up). Attacker-side
        // damage amp, applied GENERICALLY regardless of class: verified
        // directly against World.ts, `slashFinalDamage *=
        // kindledResolveDamageMultiplier(...)` (Ninja Slash, :5163) AND
        // `edgeDamage *= kindledResolveDamageMultiplier(...)` (Kindled
        // Edge, :5478) both call the SAME class-blind helper — a Ninja who
        // somehow held a live Kindled Resolve window would be amplified too
        // (today that can never happen: the card is Paladin-exclusive, and
        // even the now-real cast, Track Z5 item 1, is gated behind the
        // catalog's own class-lock — but the READ site itself must not
        // silently assume Paladin-only, matching what TS's own composition
        // site actually does).
        if (attacker.kindled_resolve_until_tick > state.header.tick) {
            final_damage *= KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER;
        }
        // Team peel (Track Z1c "team peel" item — CLOSES this function's
        // own "team peel (its own Z1 item)" note above): extends a nearby
        // warding Paladin ally's Ward to cover this landed arc hit,
        // matching World.ts's melee slash (:5592) / Kindled Edge (:6008)
        // call sites exactly (both use the identical `applyTeamPeel(victim,
        // ..., meleeIds, meleeTick)` shape this mirrors). Gated on
        // `!kindled_warded` (Track Z1c "Kindled Ward partial mitigation"
        // item) — TS: `if (!mitigation.warded)`.
        if (!kindled_warded) {
            final_damage = applyTeamPeel(state, vi, final_damage, state.header.tick);
        }

        const new_health = @max(0.0, victim.health - final_damage);
        const was_alive = victim.flags.alive;
        victim.health = new_health;
        victim.flags.alive = new_health > 0;
        if (stagger_victim or swing_is_bash) {
            // Two stagger sources share the slowed_until_tick machinery
            // (no new status system — ledger design-decision block):
            // Unbroken Seal's 900ms/0.25 and the shield bash's brief
            // 300ms/0.55. Seal's stronger one takes precedence when both
            // apply to a single hit. Mirrors World.ts's combined block.
            const stg_ms: f64 = if (stagger_victim) KIN_SEAL_STAGGER_MS else SHIELD_BASH_STAGGER_MS;
            const stg_mul: f64 = if (stagger_victim) KIN_SEAL_STAGGER_MULTIPLIER else SHIELD_BASH_STAGGER_MULTIPLIER;
            const stagger_ticks: u32 = @intFromFloat(@ceil(stg_ms / @max(1.0, eff_dt)));
            victim.slowed_until_tick = state.header.tick + stagger_ticks;
            // Kindled Resolve (Phase 4a follow-up): softens the stagger's
            // SEVERITY toward 1 if the VICTIM (not the attacker) currently
            // holds a live window — "resist", not immune. Mirrors TS's
            // `applyKindledResolveStaggerResist` exactly (World.ts's
            // combined Seal/bash stagger site — only Kindled melee ever
            // reaches this write in either codebase; Ninja Slash has no
            // stagger-write site).
            victim.slow_multiplier = if (victim.kindled_resolve_until_tick > state.header.tick)
                stg_mul + (1.0 - stg_mul) * KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION
            else
                stg_mul;
            victim.flags.has_slow = true;
        }
        emitEvent(state, .hit_confirmed, @intCast(vi), @intCast(attacker_idx), 0, final_damage, victim.x, victim.y);
        if (was_alive and new_health <= 0) {
            creditKill(state, @intCast(attacker_idx), @intCast(vi));
            emitEvent(state, .player_killed, @intCast(vi), @intCast(attacker_idx), 0, 0, victim.x, victim.y);
        }

        // Energy from contact (Ninja only) — the attacker's own landed hit
        // restores the rack ("aggression feeds the rack", World.ts:4829-
        // 4831). Second Wind (this phase's own 6th ability) piggybacks on
        // this SAME self-write: a landed hit while its window lives also
        // heals + dumps bonus energy, single-use (window cleared on the
        // qualifying hit, not just on timeout) — matches World.ts exactly,
        // including the flat `100` heal cap (NOT build-max-health-aware;
        // a TS quirk this port mirrors as-is, not fixes, per this goal
        // doc's "port AS-IS" doctrine). See this pass's own report for why
        // the baseline (unconditional) energy grant is now in scope here
        // too — Second Wind's top-up needs a baseline to top up.
        if (is_ninja) {
            const second_wind_live = attacker.second_wind_until_tick > state.header.tick;
            attacker.energy = @min(
                NINJA_ENERGY_MAX,
                attacker.energy + NINJA_ENERGY_ON_MELEE_HIT + (if (second_wind_live) NINJA_SECOND_WIND_ENERGY else 0),
            );
            if (second_wind_live) {
                attacker.health = @min(100.0, attacker.health + NINJA_SECOND_WIND_HEAL);
                attacker.second_wind_until_tick = 0;
            }
        }
    }

    // ---- Wave-off-swing (Ninja, Edge Storm-gated only — see
    //      `wave_should_spawn`'s own doc comment above) ----
    if (wave_should_spawn and is_ninja) {
        const edge_storm_live = attacker.edge_storm_until_tick > state.header.tick and
            attacker.edge_storm_charges_remaining > 0;
        if (edge_storm_live and state.projectile_count < world_state.MAX_PROJECTILES) {
            const wave_damage = WAVE_DAMAGE * NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER;
            const wave_aim_angle = trig.lutAtan2(mem.aim_y, mem.aim_x);
            const slot: u32 = state.projectile_count;
            state.projectile_count += 1;
            const new_id: u32 = state.header.next_entity_id;
            state.header.next_entity_id += 1;
            state.projectiles[slot] = .{
                .x = attacker.x,
                .y = attacker.y - 20,
                .vx = trig.lutCos(wave_aim_angle) * WAVE_SPEED,
                .vy = trig.lutSin(wave_aim_angle) * WAVE_SPEED,
                .radius = WAVE_RADIUS,
                .damage = wave_damage,
                .lifetime_ms = WAVE_LIFETIME_MS,
                .age_ms = 0,
                .traveled_px = 0,
                .origin_x = attacker.x,
                .origin_y = attacker.y - 20,
                .homing_strength = 0,
                .acceleration_multiplier = 0,
                .gravity_scale = 0,
                .range_px = WAVE_RANGE,
                .slow_multiplier = 1,
                .sticky_fuse_ms = 0,
                .impact_radius_px = 0,
                .id = new_id,
                .bounces_remaining = 0,
                .pierce_remaining = 0,
                .split_count = 0,
                .flags = .{
                    .has_owner = true,
                    .has_impact = false,
                    .has_split = false,
                    .has_slow = false,
                    .has_homing = false,
                    .has_acceleration = false,
                    .has_gravity_scale = false,
                    .has_range = true,
                    .has_age = true,
                    .has_traveled = true,
                    .has_origin = true,
                    .returning = false,
                    .has_sticky_fuse = false,
                    .has_impact_radius = false,
                },
                .pathing = .straight,
                .element = .crystal,
                .impact = .none,
                .shape = .circle,
                .owner_id_len = attacker.id_len,
                .owner_id_bytes = attacker.id_bytes,
            };
            attacker.edge_storm_charges_remaining -= 1;
            if (attacker.edge_storm_charges_remaining == 0) {
                attacker.edge_storm_until_tick = 0;
            }
        }
    }
}

// =================================================================
// Split-spawn orchestrator (Track E item E1 — gospel-goal.md; closes the
// one remaining Z5 scope-cut re-confirmed in the "Hitscan resolution"
// section header above). TS's `stepProjectile` spawns `splitCount` child
// shards at every projectile death that isn't a sticky-stick or a
// pierce-survival (projectile.ts sites: sticky fuse-end :236, lifetime
// expiry :248, player-hit consumption :513, terrain impact :579/:652,
// boomerang home-return :673, range cap :700) and World.ts inserts them
// with fresh ids AFTER each projectile's own step (World.ts:6854-6858).
// `projectileSplitVelocities` (projectile.zig, bit-exact vs TS's
// `spawnSplit`) computes the fan; the three pieces below are the missing
// orchestration:
//
//   1. `projectile_lifetime_pre_step` — TS's split parent is the INPUT
//      `proj` spread (`{...proj, x, y, vx, vy, ...}`), whose lifetimeMs
//      is the PRE-decrement value; Zig's section 3 decrements
//      `lifetime_ms` before section 4 ever sees the shard, so the
//      pre-step value is stashed per slot and restored onto the parent
//      snapshot (child lifetime = max(280, parent.lifetimeMs * 0.42) —
//      recomputing via `lifetime_ms + eff_dt` would not be bit-exact).
//   2. `pending_split_parents`/`pending_split_valid` — deaths are
//      DISCOVERED across two phases (section 3 motion/expiry, section 4
//      hit resolution) but TS consumes split RNG draws strictly in
//      ascending projectile-id order (one interleaved per-projectile
//      pass). Spawning at each Zig discovery site would reorder the RNG
//      stream whenever a lower-id shard dies in section 4 while a
//      higher-id shard dies in section 3 (draw order would flip).
//      Deaths are therefore only RECORDED (full parent snapshot, taken
//      before any post-death mutation like the parry velocity flip),
//      and one ordered pass right after section 4 does every draw +
//      insertion in slot order — `state.projectiles` is append-ordered
//      with monotonically increasing ids and section 9's compaction is
//      an order-preserving copy-down, so slot order == TS's
//      sorted-id order.
//   3. The materialisation pass itself (see its call site after
//      section 4) — child field inheritance mirrors `spawnSplit`'s
//      spec literal (projectile.ts:922-955) field for field.
//
// Scratch is file-scope (wasm-freestanding: no allocator; stepWorld is
// single-threaded and non-reentrant on both hosts). Slots are cleared
// eagerly at the top of section 3's loop each tick, so stale entries
// from a prior tick/world can never leak across compaction reindexing.
var pending_split_valid: [world_state.MAX_PROJECTILES]bool = @splat(false);
var pending_split_parents: [world_state.MAX_PROJECTILES]world_state.ProjectileEntity = undefined;
var projectile_lifetime_pre_step: [world_state.MAX_PROJECTILES]f64 = @splat(0);

/// Record a split-eligible projectile death for the post-section-4
/// materialisation pass. `slot` is the projectile's CURRENT index in
/// `state.projectiles` (stable between section 3 and the pass — nothing
/// spawns or compacts in between). The parent snapshot is taken NOW so
/// later same-tick mutations (parry/mirror velocity flip, lifetime
/// zeroing) can't corrupt the fan; `lifetime_pre` restores the TS
/// parent's pre-decrement lifetime (see the section comment above).
/// No-split shards are filtered here so the pass can skip them without
/// consuming RNG — mirrors TS's `(proj.splitCount ?? 0) > 0` guard
/// wrapping every `spawnSplit` call site.
fn queueSplitDeath(
    slot: u32,
    proj: *const world_state.ProjectileEntity,
    lifetime_pre: f64,
) void {
    if (!(proj.flags.has_split and proj.split_count > 0)) return;
    pending_split_parents[slot] = proj.*;
    pending_split_parents[slot].lifetime_ms = lifetime_pre;
    pending_split_valid[slot] = true;
}

/// TS's player-hit split site (projectile.ts:513) is only reached when
/// the shard is CONSUMED by the body contact — a sticky shard sticks
/// (splits later, at fuse-end) and a shard with pierce budget survives
/// (no split). Zig's section-4 mitigation branches (ninja i-frames,
/// Ghost Guard, parry, mirror shield, generic shield block) consume the
/// shard BEFORE its own pierce/sticky checks run, so each of those
/// hooks applies this same eligibility test explicitly. The generic
/// post-damage kill site needs no guard — its sticky/pierce branches
/// already diverted above it, same as TS.
fn splitEligibleOnPlayerHit(proj: *const world_state.ProjectileEntity) bool {
    if (proj.impact == .sticky) return false;
    if (proj.impact == .pierce_chain and proj.pierce_remaining > 0) return false;
    return true;
}

pub fn stepWorld(state: *world_state.WorldState, dt_ms: f64) i32 {
    state.event_count = 0;
    state.header.tick += 1;

    // 0. Resolve the chaos profile for this tick + apply
    //    timeScale to dt (I20). All downstream per-module
    //    calls use `eff_dt` so movement, projectile flight, and
    //    cooldown decrement run at the chaos-scaled tempo.
    const chaos_profile = chaos.chaosProfileFromMask(state.header.chaos_mask);
    const eff_dt = dt_ms * chaos_profile.time_scale;

    // 0a. Alive-flag snapshot for the mid-round fast-respawn stamp (Track
    //     Z0b Item A — the Zig mirror of World.ts's `wasAlive =
    //     state.players[pid]?.alive` diff): captured before ANY damage
    //     section runs so the end-of-tick block below can stamp
    //     `respawn_at_tick` for exactly the players who died THIS tick,
    //     whatever the cause (projectile, chain, burn, storm, bash,
    //     kill-plane) — one stamp site, same as TS.
    var was_alive: [world_state.MAX_PLAYERS]bool = undefined;
    {
        var wai: u32 = 0;
        while (wai < state.player_count) : (wai += 1) {
            was_alive[wai] = state.players[wai].flags.alive;
        }
    }

    // 0b. PRE-step round snapshot for the shrink-zone storm (Track Z0b
    //     Item C): TS's storm block reads `state.round` as it stood at
    //     tick ENTRY (World.ts §3d's own "one-tick lag is imperceptible"
    //     comment — `roundStateForStep` isn't computed yet there). Since
    //     the Z0c Item B reorder the round machine runs LAST, so section
    //     2z would read the entry values off the header anyway — the
    //     snapshot is kept for the explicitness (2z's contract is "tick-
    //     entry round state", and this spells it) rather than necessity;
    //     the boundary-tick behavior it documents is unchanged: at
    //     countdown 0 entering the tick, a full-scale storm tick still
    //     applies WHILE this same tick's (now-later) machine transitions
    //     the round.
    const storm_prestep_phase = state.header.round_phase;
    const storm_prestep_countdown = state.header.countdown_remaining_ms;
    const storm_prestep_sudden = state.header.sudden_death_active;

    // Round phase as of tick ENTRY (Track Z0c Item B — port of orphaned-
    // branch commit 3d465f3's tick-order fix, adapted to main's grown
    // step): parity with World.ts's `fightingPhase` const, read once at
    // the top before its own round machine runs at the END of the tick.
    // Player movement + weapon fire gate on this; the round machine itself
    // now runs LAST (just before end-of-tick compaction) instead of first
    // — see its own relocated comment below for the full reasoning.
    // Hangout OR-pin (World.ts:2510 `fightingPhase = hangoutMode ||
    // phase === "fighting"`): movement + fire stay live in the lobby
    // regardless of the (frozen) round machine's phase cell.
    const is_fighting = g_hangout_mode or state.header.round_phase ==
        @intFromEnum(round.RoundPhase.fighting);

    // 8. Player physics (I16). Bridge PlayerEntity +
    //    PlayerMovementMemory → PlayerStep, run stepPlayer with
    //    the statics + one_way cache, write motion + memory back.
    const statics_slice = state.statics[0..state.static_count];
    const one_way_slice = state.one_way[0..state.static_count];
    var pmi: u32 = 0;
    while (pmi < state.player_count) : (pmi += 1) {
        if (!state.players[pmi].flags.alive) continue;
        // Host-resolved card build for this player (movement/shield/parry
        // augments) — parity with the TS orchestrator's resolvePlayerBuild.
        const fcfg = &state.player_fire_config[pmi];
        const has_cfg = fcfg.valid != 0;
        var ps = player_mod.PlayerStep{
            .x = state.players[pmi].x,
            .y = state.players[pmi].y,
            .vx = state.players[pmi].vx,
            .vy = state.players[pmi].vy,
            .aim_x = state.players[pmi].aim_x,
            .aim_y = state.players[pmi].aim_y,
            .jetpack_fuel = if (state.players[pmi].flags.has_jetpack_fuel)
                state.players[pmi].jetpack_fuel
            else
                100.0,
            .crouching = if (state.players[pmi].flags.crouching) 1 else 0,
            .coyote_ms = state.player_movement[pmi].coyote_ms,
            .jump_buffer_ms = state.player_movement[pmi].jump_buffer_ms,
            .jump_cut_applied = @intCast(state.player_movement[pmi].jump_cut_applied),
            .jump_released_since_jump = @intCast(state.player_movement[pmi].jump_released_since_jump),
            .grounded_last_frame = @intCast(state.player_movement[pmi].grounded_last_frame),
            .jetpack_active = @intCast(state.player_movement[pmi].jetpack_active),
            .touching_wall_dir = @intCast(state.player_movement[pmi].touching_wall_dir),
            // Augment INPUTS from the host-resolved card build.
            .jump_mul = if (has_cfg) fcfg.jump_mul else 1.0,
            .wall_jump_mul = if (has_cfg) fcfg.wall_jump_mul else 1.0,
            .wall_slide_mul = if (has_cfg) fcfg.wall_slide_mul else 1.0,
            .air_jumps = if (has_cfg) @intCast(fcfg.air_jumps) else 0,
            // BASELINE dash floor — mirror of weapon.ts resolvePlayerBuild's
            // `Math.max(withInnate.dashCharges, 1)` ("the dash-bash
            // power-slide is a core move for EVERYONE"). TS layers that
            // floor AFTER createWeaponBuild, so the raw fire-config bytes
            // stay pure card resolution (orchestratorAugmentParity pins
            // no-cards → dash_charges 0) — the Zig mirror therefore lands
            // HERE, at the player-step read (the exact analog of World.ts
            // handing build.dashCharges into the movement step), NOT inside
            // resolve_player_fire_config. Without it a card-less player
            // could never dash on the full-Zig path — dash-bash, Razor
            // Route, and the R1 row-16 dash cancel all silently dead
            // (found 2026-07-24 by the cancel-window parity gate).
            .dash_charges = @max(1, if (has_cfg) @as(i32, @intCast(fcfg.dash_charges)) else 0),
            .dash_cooldown_mul = if (has_cfg) fcfg.dash_cooldown_mul else 1.0,
            // Augment MEMORY carried from world state.
            .dash_cooldown_ms = state.player_movement[pmi].dash_cooldown_ms,
            .dash_active_ms = state.player_movement[pmi].dash_active_ms,
            .dash_recovery_ms = state.player_movement[pmi].dash_recovery_ms,
            .air_jumps_used = @intCast(state.player_movement[pmi].air_jumps_used),
            .dash_used_in_air = @intCast(state.player_movement[pmi].dash_used_in_air),
        };
        // Compose per-player movement speed (I37). Defaults 1.0;
        // speed_boost buff multiplies, slow_debuff / freeze /
        // slow_field debuffs multiply (≤1).
        var speed_mul: f64 = 1.0;
        const ple = &state.players[pmi];
        if (ple.flags.has_speed_boost and ple.speed_boost_until_tick > state.header.tick) {
            speed_mul *= 1.4;
        }
        if (ple.flags.has_slow_debuff and ple.slow_debuff_until_tick > state.header.tick) {
            speed_mul *= 0.5;
        }
        if (ple.flags.has_slow and ple.slowed_until_tick > state.header.tick) {
            speed_mul *= ple.slow_multiplier;
        }
        if (ple.flags.has_freeze and ple.freeze_until_tick > state.header.tick) {
            speed_mul *= ple.freeze_multiplier;
        }
        // First-blood wager (Track Z0d — port of World.ts:2532's
        // firstBloodMul): whoever claimed it this round moves faster for
        // the rest of it. Reads the header as it stands at THIS point of
        // the tick — the award sites all run later (sections 4/6, after
        // movement), so a fresh claim boosts starting next tick, exactly
        // TS's "reads the PRE-tick round state" cadence. Positioned
        // between freeze and the card move-speed augment to mirror TS's
        // own composition order (slow × freeze × firstBlood × … ×
        // moveSpeedMultiplier).
        if (state.header.first_blood_idx_plus1 == pmi + 1) {
            speed_mul *= round.FIRST_BLOOD_SPEED_MULTIPLIER;
        }
        // Syzygist haste (Track Z1a item 3 ride-along — mechanism parity
        // gap found porting Rally Light: TS composes hasteMul into the
        // SAME speedMul chain, World.ts:2543-2546, and the fire-rate half
        // was already consumed at section 6, but this movement half had
        // no Zig mirror — a TS-authored haste crossing the bridge moved
        // the player at 1.0x under wasm authority). Position in the chain
        // mirrors TS exactly: slow × freeze × firstBlood × haste × rally
        // × build move-speed.
        if (ple.flags.has_haste and ple.haste_until_tick > state.header.tick) {
            speed_mul *= ple.haste_multiplier;
        }
        // Rally Light "move tick" (Track Z1a item 3 — World.ts:2552's
        // rallyMul): anyone the aura currently covers, self-source
        // included. Read-only scan, same safety contract as the TS
        // helper's own doc comment.
        if (hasRallyLightSource(state, pmi, state.header.tick)) {
            speed_mul *= KIN_RALLY_LIGHT_MOVE_MULTIPLIER;
        }
        // Card move-speed + gravity augments ride the existing step multipliers.
        if (has_cfg) speed_mul *= fcfg.move_speed_mul;
        const grav_mul = chaos_profile.gravity_multiplier *
            (if (has_cfg) fcfg.gravity_mul else 1.0);
        // Wall Bloom / Shock Ring hook capture (this pass, AOE-queue
        // ability wiring) — captured BEFORE stepPlayer mutates movement
        // memory, same "read stepPlayer's INPUT and OUTPUT only, never its
        // internals" backend-agnostic idiom World.ts's own
        // wallDirBeforeStep/groundedBeforeStep locals use (World.ts:2377-
        // 2392) and for the identical reason: Wall Bloom's wall-kick
        // detection and Shock Ring's landing detection both need the
        // PRE-step values to compare against this same call's OUTPUT
        // below.
        const wall_dir_before_step = state.player_movement[pmi].touching_wall_dir;
        const grounded_before_step = state.player_movement[pmi].grounded_last_frame;
        // Gated on is_fighting (Track Z0c Item B — port of orphaned-
        // branch commit 3d465f3's own gate): parity with World.ts:2515's
        // `if (entity.alive && fightingPhase)` — players freeze during
        // countdown/round-over/drafting. The ceiling clamp + void-plane
        // kill below stay OUTSIDE the gate, same shape as the orphan's
        // cut (a body shoved past the bounds still resolves whatever the
        // phase).
        if (is_fighting) {
            // NB: stepPlayer RETURNS jumped-this-frame, not grounded. The grounded
            // state lives in ps.grounded_last_frame (mutated in place). The world
            // orchestrator emits no jump event, so the return is discarded.
            _ = player_mod.stepPlayer(
                &ps,
                state.players[pmi].prev_keys,
                state.players[pmi].current_keys,
                state.players[pmi].aim_x,
                state.players[pmi].aim_y,
                speed_mul,
                grav_mul,
                eff_dt,
                statics_slice,
                one_way_slice,
            );
            state.players[pmi].x = ps.x;
            state.players[pmi].y = ps.y;
            state.players[pmi].vx = ps.vx;
            state.players[pmi].vy = ps.vy;
            state.players[pmi].jetpack_fuel = ps.jetpack_fuel;
            state.players[pmi].flags.has_jetpack_fuel = true;
            state.players[pmi].flags.crouching = ps.crouching != 0;
            state.players[pmi].flags.grounded = ps.grounded_last_frame != 0;
            state.player_movement[pmi].coyote_ms = ps.coyote_ms;
            state.player_movement[pmi].jump_buffer_ms = ps.jump_buffer_ms;
            state.player_movement[pmi].jump_cut_applied = @intCast(ps.jump_cut_applied);
            state.player_movement[pmi].jump_released_since_jump = @intCast(ps.jump_released_since_jump);
            state.player_movement[pmi].grounded_last_frame = @intCast(ps.grounded_last_frame);
            state.player_movement[pmi].jetpack_active = @intCast(ps.jetpack_active);
            state.player_movement[pmi].touching_wall_dir = @intCast(ps.touching_wall_dir);
            state.player_movement[pmi].dash_cooldown_ms = ps.dash_cooldown_ms;
            state.player_movement[pmi].dash_active_ms = ps.dash_active_ms;
            state.player_movement[pmi].dash_recovery_ms = ps.dash_recovery_ms;
            state.player_movement[pmi].air_jumps_used = @intCast(ps.air_jumps_used);
            state.player_movement[pmi].dash_used_in_air = @intCast(ps.dash_used_in_air);

            // Wall Bloom (Ninja) — wall-kick hook (this pass, AOE-queue
            // ability wiring; window OPENED by the "wall-bloom" cast in
            // section 6z below). Mirrors World.ts's own heuristic exactly
            // (World.ts:2422-2456): a Jump-bit rising edge while airborne and
            // touching a wall LAST tick (not this tick's post-step state —
            // same "before" values World.ts's wallDirBeforeStep/
            // groundedBeforeStep read). Single-use: cleared on THIS wall-kick
            // regardless of whether the window was even live (matches TS's
            // unconditional `wallBloomUntilTick: wallBloomLive ? undefined :
            // nextEntity.wallBloomUntilTick` — a no-op clear when already 0).
            if (state.players[pmi].character_id == .sprinter) {
                const jump_bit: u32 = 1 << 4;
                const jump_edge = (state.players[pmi].current_keys & jump_bit) != 0 and
                    (state.players[pmi].prev_keys & jump_bit) == 0;
                if (jump_edge and wall_dir_before_step != 0 and grounded_before_step == 0) {
                    const wall_bloom_live = state.players[pmi].wall_bloom_until_tick > state.header.tick;
                    if (wall_bloom_live) {
                        state.players[pmi].wall_bloom_until_tick = 0;
                        if (state.pending_instant_aoe_count < world_state.MAX_PENDING_INSTANT_AOE) {
                            const wall_x = state.players[pmi].x +
                                @as(f64, @floatFromInt(wall_dir_before_step)) * NINJA_WALL_BLOOM_WALL_OFFSET_PX;
                            state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                                .x = wall_x,
                                .y = state.players[pmi].y,
                                .radius = NINJA_WALL_BLOOM_RADIUS_PX,
                                .damage = NINJA_WALL_BLOOM_DAMAGE,
                                .caster_idx = pmi,
                            };
                            state.pending_instant_aoe_count += 1;
                        }
                    }
                }
            }

            // Shock Ring (Paladin) — landing hook (this pass, AOE-queue
            // ability wiring; hop + window OPENED by the "shock-ring" cast in
            // section 6z below). Mirrors World.ts's own landing check exactly
            // (World.ts:2465-2493): airborne last tick, grounded now.
            // Single-use: cleared on THIS landing regardless of whether the
            // window was even live (same unconditional-clear shape as Wall
            // Bloom above — matches TS's `nextEntity = { ...,
            // shockRingArmedUntilTick: undefined }` sitting INSIDE the
            // `if (...armedUntilTick... > state.tick)` branch, so it only
            // actually fires when live; harmless either way since 0 already
            // reads as "not armed").
            // Hangout: World.ts wraps its whole paladin landing/air-jump
            // hook block `classId === "paladin" && !hangoutMode` (:2936) —
            // no Shock Ring slam queues in the lobby.
            if (state.players[pmi].character_id == .heavy and !g_hangout_mode) {
                const grounded_after_step = ps.grounded_last_frame != 0;
                const just_landed = grounded_before_step == 0 and grounded_after_step;
                if (just_landed) {
                    const shock_ring_live = state.players[pmi].shock_ring_armed_until_tick > state.header.tick;
                    if (shock_ring_live) {
                        state.players[pmi].shock_ring_armed_until_tick = 0;
                        if (state.pending_instant_aoe_count < world_state.MAX_PENDING_INSTANT_AOE) {
                            state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                                .x = state.players[pmi].x,
                                .y = state.players[pmi].y,
                                .radius = KIN_SHOCK_RING_RADIUS_PX,
                                .damage = KIN_SHOCK_RING_DAMAGE,
                                .caster_idx = pmi,
                            };
                            state.pending_instant_aoe_count += 1;
                        }
                    }
                }
            }

            // Razor Route (Ninja, this pass) — dash-through body-cross
            // detection. Mirrors World.ts's "1z2. NINJA MELEE" dash-through
            // section (World.ts:5131-5200) — rising-edge burst detection,
            // per-burst tag debounce, the baseline energy grant, and Razor
            // Route's own velocity boost + "marks Read on cross" byproduct.
            // Deliberately positioned here (post-stepPlayer, same per-player
            // physics loop as Wall Bloom/Shock Ring's own hooks immediately
            // above) rather than inside `stepMeleeSwing`: TS runs this as its
            // OWN pass over the ninja roster, independent of (and running
            // AFTER, in TS's own tick order) the swing FSM, keyed off
            // `dashing`/movement state, not the melee arc — same "read
            // stepPlayer's OUTPUT, not its internals" shape this loop's other
            // two hooks already use. `dashing_now` is the derived Zig
            // equivalent of TS's `attacker.dashing === true`:
            // `player_movement[pmi].dash_active_ms > 0.0` is exactly what
            // `dash_active`/`was_dash_active` already track internally in
            // player.zig, just not as a wire-visible PlayerEntity boolean —
            // the ACTUAL gap the original Razor Route/Ghost Guard deferrals
            // cited never needed a new field, only reading what already
            // exists. `melee_swing[pmi]`'s new dash_through_tagged_mask/
            // was_dashing/razor_route_active_dash fields are the Zig mirror of
            // NinjaMeleeMemory's own fields of the same name/shape.
            if (state.players[pmi].character_id == .sprinter) {
                const dmem = &state.melee_swing[pmi];
                const dashing_now = state.player_movement[pmi].dash_active_ms > 0.0;
                if (dashing_now and !dmem.was_dashing) {
                    dmem.dash_through_tagged_mask = 0; // new dash burst — fresh tags
                    const razor_route_live = state.players[pmi].razor_route_until_tick > state.header.tick;
                    dmem.razor_route_active_dash = razor_route_live;
                    if (razor_route_live) {
                        state.players[pmi].razor_route_until_tick = 0;
                        const dash_speed = @sqrt(
                            state.players[pmi].vx * state.players[pmi].vx +
                                state.players[pmi].vy * state.players[pmi].vy,
                        );
                        if (dash_speed > 1e-3) {
                            state.players[pmi].vx += (state.players[pmi].vx / dash_speed) * NINJA_RAZOR_ROUTE_BOOST_SPEED;
                            state.players[pmi].vy += (state.players[pmi].vy / dash_speed) * NINJA_RAZOR_ROUTE_BOOST_SPEED;
                        }
                    }
                }
                // Hangout: no dash-through tagging/energy/Read-mark in the
                // lobby — World.ts:5588 gates this exact loop
                // `dashingNow && !hangoutMode` (the Razor Route dash-START
                // consume above stays live there, same as TS).
                if (dashing_now and !g_hangout_mode) {
                    const attacker_box = combat.playerHitboxAabb(
                        state.players[pmi].x,
                        state.players[pmi].y,
                        state.players[pmi].flags.crouching,
                        state.players[pmi].character_id,
                    );
                    var dvi: u32 = 0;
                    while (dvi < state.player_count) : (dvi += 1) {
                        if (dvi == pmi) continue;
                        const dbit: u16 = @as(u16, 1) << @as(u4, @intCast(dvi));
                        if ((dmem.dash_through_tagged_mask & dbit) != 0) continue;
                        if (!state.players[dvi].flags.alive) continue;
                        const victim_box = combat.playerHitboxAabb(
                            state.players[dvi].x,
                            state.players[dvi].y,
                            state.players[dvi].flags.crouching,
                            state.players[dvi].character_id,
                        );
                        // AABB overlap — same inline check `stepMeleeSwing`'s
                        // arc-hit-check delegates to `combat.isBodyInMeleeArc`
                        // for, but this is a plain body-cross (no range/arc
                        // gate), matching TS's own `aabbOverlap(attackerAABB,
                        // playerHitboxAABB(victim))`.
                        if (!(attacker_box.x < victim_box.x + victim_box.w and
                            attacker_box.x + attacker_box.w > victim_box.x and
                            attacker_box.y < victim_box.y + victim_box.h and
                            attacker_box.y + attacker_box.h > victim_box.y)) continue;
                        dmem.dash_through_tagged_mask |= dbit;
                        state.players[pmi].energy = @min(
                            NINJA_ENERGY_MAX,
                            state.players[pmi].energy + NINJA_ENERGY_ON_DASH_THROUGH,
                        );
                        emitEvent(state, .dash_through, @intCast(pmi), @intCast(dvi), 0, 0, state.players[pmi].x, state.players[pmi].y);
                        if (dmem.razor_route_active_dash) {
                            const mark_ticks: u32 = @intFromFloat(@ceil(NINJA_RAZOR_ROUTE_READ_MARK_MS / @max(1.0, eff_dt)));
                            state.players[pmi].read_target_id_len = state.players[dvi].id_len;
                            state.players[pmi].read_target_id_bytes = state.players[dvi].id_bytes;
                            state.players[pmi].read_mark_until_tick = state.header.tick + mark_ticks;
                            dmem.razor_route_active_dash = false;
                        }
                    }
                }
                dmem.was_dashing = dashing_now;
            }
        }

        // Ceiling clamp (parity with World.ts computeCeilingClampY): head pushed
        // above the ceiling → shove back under + kill upward velocity.
        if (g_has_ceiling) {
            const min_center_y = g_ceiling_clamp_y + PLAYER_HALF_HEIGHT;
            if (state.players[pmi].y < min_center_y) {
                state.players[pmi].y = min_center_y;
                if (state.players[pmi].vy < 0) state.players[pmi].vy = 0;
            }
        }
        // Void-plane kill (parity with World.ts): fell past the map bottom +
        // KILL_PLANE_MARGIN → force-kill so the death→respawn flow runs. Player
        // is alive here (checked at loop top). Emit hit_confirmed (damage =
        // remaining health) + player_killed like any other death.
        if (g_kill_plane_y > 0 and state.players[pmi].y > g_kill_plane_y) {
            if (g_hangout_mode) {
                // Hangout (World.ts:6397): no combat/death concept in the
                // lobby — the void plane is a generic safety net, so a fall
                // is a SILENT respawn (no events, no health change) rather
                // than a kill. TS respawns via assignSpawnPoints(map, [pid])
                // — a single-id assignment always lands on the map's FIRST
                // spawn point (no "already placed" competitors to spread
                // away from); no spawn points = keep position (TS's
                // `?? { x: p.x, y: p.y }` fallback), zero velocity either
                // way.
                if (g_spawn_point_count > 0) {
                    state.players[pmi].x = g_spawn_points_x[0];
                    state.players[pmi].y = g_spawn_points_y[0];
                }
                state.players[pmi].vx = 0;
                state.players[pmi].vy = 0;
            } else {
                const rem = state.players[pmi].health;
                state.players[pmi].health = 0;
                state.players[pmi].flags.alive = false;
                emitEvent(state, .hit_confirmed, @intCast(pmi), -1, 0, rem, state.players[pmi].x, state.players[pmi].y);
                emitEvent(state, .player_killed, @intCast(pmi), -1, 0, 0, state.players[pmi].x, state.players[pmi].y);
            }
        }
    }

    // 8c. Launch pads — mirror of World.ts §4a / client/src/sim/launchPad.ts.
    //     TICK-ORDER POSITION: directly AFTER the player-physics pass, so
    //     the impulse modifies the player's post-movement velocity and
    //     integrates on the NEXT tick's stepPlayer — the exact invariant the
    //     TS orchestrator establishes by running its pad pass after movement
    //     (TS anchors it to the pickup section §4a; Zig's own pickup pass §7
    //     runs pre-movement, a pre-existing quarantined divergence, so the
    //     shared anchor is "post-movement", not "post-pickups").
    //     Formula + stateless retrigger gate: see launchPad.ts's header.
    //     Pads iterate in host array order (== map.launchPads order ==
    //     event entity_id); players in packed order (packed from sorted ids
    //     by worldStateBridge — same order TS iterates).
    if (is_fighting) {
        var lpi: u32 = 0;
        while (lpi < g_launch_pad_count) : (lpi += 1) {
            const pad = &g_launch_pads[lpi];
            const magnitude = @sqrt(pad.impulse_x * pad.impulse_x +
                pad.impulse_y * pad.impulse_y);
            if (magnitude <= 0) continue; // degenerate authoring — inert pad
            const ux = pad.impulse_x / magnitude;
            const uy = pad.impulse_y / magnitude;
            const retrigger_gate = LAUNCH_RETRIGGER_FRACTION * magnitude;
            const along_cap = LAUNCH_ALONG_CAP_FACTOR * magnitude;
            var lpp: u32 = 0;
            while (lpp < state.player_count) : (lpp += 1) {
                const lp = &state.players[lpp];
                if (!lp.flags.alive) continue;
                // AABB overlap, strict inequalities (TS aabbOverlap parity).
                if (!(lp.x - LAUNCH_PLAYER_HALF_W < pad.x + pad.w / 2 and
                    lp.x + LAUNCH_PLAYER_HALF_W > pad.x - pad.w / 2 and
                    lp.y - LAUNCH_PLAYER_HALF_H < pad.y + pad.h / 2 and
                    lp.y + LAUNCH_PLAYER_HALF_H > pad.y - pad.h / 2)) continue;
                const v_along = lp.vx * ux + lp.vy * uy;
                if (v_along >= retrigger_gate) continue; // launched / moving away
                // ADD with floor + cap; perpendicular velocity preserved.
                const v_perp_x = lp.vx - v_along * ux;
                const v_perp_y = lp.vy - v_along * uy;
                const boosted = @min(v_along + magnitude, along_cap);
                const new_along = @max(magnitude, boosted);
                lp.vx = v_perp_x + new_along * ux;
                lp.vy = v_perp_y + new_along * uy;
                // A pad launch is NOT a jump — consume the variable-jump-
                // height cut so next tick's stepPlayer doesn't halve the
                // rising velocity (parity with World.ts §4a's memory poke;
                // same trick the dash lunge uses in player.ts/player.zig).
                state.player_movement[lpp].jump_cut_applied = 1;
                emitEvent(
                    state,
                    .launch_pad_fired,
                    @intCast(lpp),
                    -1,
                    lpi,
                    magnitude,
                    pad.x,
                    pad.y,
                );
            }
        }
    }

    // Melee rising-edge capture (2026-07-20 base-melee-mechanic gap-closure
    // pass) — host-only stack scratch, mirrors World.ts's own
    // `ninjaSlashEdges`/`paladinEdgeEdges` maps and the EXACT reason they
    // exist (World.ts:1518-1530): section 6 immediately below rolls
    // `prev_keys = current_keys` at the end of EVERY player's own
    // iteration, so by the time section 6a's melee loop runs AFTER section
    // 6 has finished, `prev_keys` no longer holds the pre-tick value for
    // ANYONE — a same-tick Fire press would look like it was already held
    // last tick too, and a swing could never start. Captured here, before
    // section 6 touches prev_keys.
    var melee_fire_rising_edge: [world_state.MAX_PLAYERS]bool = @splat(false);
    {
        const MELEE_FIRE_BIT: u32 = 1 << 6;
        var mfi: u32 = 0;
        while (mfi < state.player_count) : (mfi += 1) {
            const mp = &state.players[mfi];
            melee_fire_rising_edge[mfi] =
                (mp.current_keys & MELEE_FIRE_BIT) != 0 and
                (mp.prev_keys & MELEE_FIRE_BIT) == 0;
        }
    }

    // Shield-key rising-edge capture (R1 row 16 ward-raise cancel,
    // 2026-07-24 wave 2) — same "captured before section 6 rolls
    // prev_keys" contract as `melee_fire_rising_edge` immediately above,
    // for the identical reason. Mirrors World.ts's paladinWardRaiseEdges
    // (its ShieldBit local, 1 << 8); whether the ward actually ENGAGED is
    // judged inside stepMeleeSwing against the section-6-final
    // flags.shield_active.
    var shield_rising_edge: [world_state.MAX_PLAYERS]bool = @splat(false);
    {
        const SHIELD_BIT: u32 = 1 << 8;
        var sri: u32 = 0;
        while (sri < state.player_count) : (sri += 1) {
            const sp = &state.players[sri];
            shield_rising_edge[sri] =
                (sp.current_keys & SHIELD_BIT) != 0 and
                (sp.prev_keys & SHIELD_BIT) == 0;
        }
    }

    // Ability-slot rising-edge capture (2026-07-20, Phase 1 ability-cast
    // dispatch pass) — same "captured before section 6 rolls prev_keys"
    // contract as `melee_fire_rising_edge` immediately above, and for the
    // identical reason. Slot bits did NOT exist anywhere in Zig's input
    // handling before this pass (verified by grepping every existing
    // `1 << N` input-bit constant in this file / combat.zig / player.zig —
    // 0..9 were all spoken for, nothing read 10/11/12) — mirrors TS's own
    // `slotBit = 1 << (10 + slot)` (World.ts:2150) exactly, the SAME
    // "duplicated as a local constant rather than exported" convention
    // `ABILITY_BIT`/`FIRE_BIT`/`MELEE_FIRE_BIT` above already use.
    var ability_slot_rising_edge: [world_state.MAX_PLAYERS][world_state.MAX_ABILITY_SLOTS]bool =
        @splat(@splat(false));
    {
        const SLOT_BIT_BASE: u5 = 10;
        var asi: u32 = 0;
        while (asi < state.player_count) : (asi += 1) {
            const ap = &state.players[asi];
            var slot: usize = 0;
            while (slot < world_state.MAX_ABILITY_SLOTS) : (slot += 1) {
                const slot_bit: u32 = @as(u32, 1) << @as(u5, @intCast(SLOT_BIT_BASE + slot));
                ability_slot_rising_edge[asi][slot] =
                    (ap.current_keys & slot_bit) != 0 and
                    (ap.prev_keys & slot_bit) == 0;
            }
        }
    }

    // 6. Combat — per-player shield drain + parry start (I4 +
    //    I4b). Defaults match `combat_*` exports.
    var pi3: u32 = 0;
    while (pi3 < state.player_count) : (pi3 += 1) {
        const player_ptr = &state.players[pi3];
        // Wizard basic-fire ramping channel (2026-07-20 gap-closure pass —
        // parity port of weapon.ts:243-257 / constants.ts's
        // GEO_CHANNEL_RAMP_MS doc comment). Ticked BEFORE the fire-rate
        // composition below (and before any early-return-shaped gate,
        // matching TS's own "track hold duration even mid-cooldown" note)
        // so holding Fire through a normal cooldown gap still accumulates.
        // `character_id == .balanced` is this codebase's Zig-side mirror of
        // `classIdForArchetype(...) === "wizard"` (cardTypes.ts's
        // ARCHETYPE_CLASS_ID: balanced→wizard).
        // FIRE_BIT mirrors weapon.zig's own (non-pub) `InputBitFire = 1 << 6`
        // — duplicated as a local constant rather than exported, matching
        // this same loop's existing ABILITY_BIT precedent below.
        const FIRE_BIT: u32 = 1 << 6;
        const is_wizard_channel = player_ptr.character_id == .balanced;
        const fire_requested = (player_ptr.current_keys & FIRE_BIT) != 0;
        // Phase-gated (Track Z0c Item B): TS only ever ticks the channel
        // inside stepWeapon, which isn't called outside the fighting
        // phase — a held Fire during countdown must not pre-ramp the
        // wizard's fire rate (hold value freezes, not resets, matching
        // stepWeapon simply not running).
        if (is_fighting) {
            if (is_wizard_channel and fire_requested and player_ptr.flags.alive) {
                player_ptr.channel_hold_ms += eff_dt;
            } else {
                player_ptr.channel_hold_ms = 0;
            }
        }
        // Card shield/parry augments from the host-resolved build. Match the TS
        // orchestrator: maxCharge = SHIELD_MAX_CHARGE_DEFAULT × chargeMul (NOT
        // the stored max), recharge × rechargeMul, parry cooldown × cooldownMul.
        const cfg3 = &state.player_fire_config[pi3];
        const has3 = cfg3.valid != 0;
        combat.tickShield(
            player_ptr,
            player_ptr.current_keys,
            eff_dt,
            combat.SHIELD_MAX_CHARGE_DEFAULT * (if (has3) cfg3.shield_charge_mul else 1.0),
            combat.SHIELD_DRAIN_PER_SECOND,
            combat.SHIELD_RECHARGE_PER_SECOND * (if (has3) cfg3.shield_recharge_mul else 1.0),
        );
        // Emission cast (docs/emission-engine-goal.md — mirror of the TS
        // cast branch in World.stepWithRuntime): the Ability rising edge
        // at full charge fires a radial volley derived from the fire
        // config (weapon_build.emissionFromConfig — parameters already
        // crossed the boundary, no second config), zeroes the charge, and
        // CONSUMES the edge (no parry this press). Below full charge the
        // edge falls through to tryStartParry — bot defensive behavior.
        // Known v1 parity gap vs TS: cast shards don't carry statusScale
        // (freeze ×2) — the projectile ABI has no such field yet; the
        // opt-in wasm world accepts base-duration statuses until a later
        // ABI cut (documented in emission.ts too).
        const ABILITY_BIT: u32 = 1 << 7;
        const ability_edge = (player_ptr.current_keys & ABILITY_BIT) != 0 and
            (player_ptr.prev_keys & ABILITY_BIT) == 0;
        var cast_consumed_edge = false;
        if (ability_edge and
            player_ptr.flags.alive and
            state.header.round_phase == @intFromEnum(round.RoundPhase.fighting) and
            // Hangout no-ops the Emission cast (World.ts:3333's !hangoutMode
            // — charge never fills there, but the guard is explicit per the
            // emission-engine-goal doctrine, not emergent).
            !g_hangout_mode and
            player_ptr.ability_charge >= EMISSION_CHARGE_MAX)
        {
            const em = weapon_build.emissionFromConfig(&state.player_fire_config[pi3]);
            const ecfg = &state.player_fire_config[pi3];
            const e_valid = ecfg.valid != 0;
            var ei2: u32 = 0;
            while (ei2 < em.volley_count) : (ei2 += 1) {
                if (state.projectile_count >= world_state.MAX_PROJECTILES) break;
                const ang = (@as(f64, @floatFromInt(ei2)) /
                    @as(f64, @floatFromInt(em.volley_count))) * 2.0 * std.math.pi;
                const slot: u32 = state.projectile_count;
                state.projectile_count += 1;
                const new_id: u32 = state.header.next_entity_id;
                state.header.next_entity_id += 1;
                state.projectiles[slot] = .{
                    .x = player_ptr.x,
                    .y = player_ptr.y - 30,
                    .vx = trig.lutCos(ang) * em.speed,
                    .vy = trig.lutSin(ang) * em.speed,
                    .radius = em.radius_px,
                    .damage = em.damage_per_shard,
                    .lifetime_ms = weapon_build.EMISSION_LIFETIME_MS,
                    .age_ms = 0,
                    .traveled_px = 0,
                    .origin_x = player_ptr.x,
                    .origin_y = player_ptr.y - 30,
                    .homing_strength = if (e_valid) ecfg.homing_strength else 0,
                    .acceleration_multiplier = 0,
                    .gravity_scale = 0,
                    .range_px = weapon_build.EMISSION_RANGE_PX,
                    .slow_multiplier = if (e_valid) ecfg.slow_multiplier else 1.0,
                    .sticky_fuse_ms = 0,
                    .impact_radius_px = em.impact_radius_px,
                    .id = new_id,
                    .bounces_remaining = if (e_valid) ecfg.bounces else 0,
                    .pierce_remaining = 0,
                    .split_count = 0,
                    .flags = .{
                        .has_owner = true,
                        .has_impact = true,
                        .has_split = false,
                        .has_slow = e_valid and ecfg.slow_multiplier != 1.0,
                        .has_homing = e_valid and ecfg.homing_strength != 0,
                        .has_acceleration = false,
                        .has_gravity_scale = false,
                        .has_range = true,
                        .has_age = true,
                        .has_traveled = true,
                        .has_origin = true,
                        .returning = false,
                        .has_sticky_fuse = false,
                        .has_impact_radius = true,
                    },
                    .pathing = if (e_valid) ecfg.pathing else .straight,
                    .element = if (e_valid) ecfg.element else .crystal,
                    .impact = if (e_valid) ecfg.impact else .none,
                    .shape = if (e_valid) ecfg.shape else .circle,
                    .owner_id_len = player_ptr.id_len,
                    .owner_id_bytes = player_ptr.id_bytes,
                };
            }
            player_ptr.ability_charge = 0;
            cast_consumed_edge = true;
            emitEvent(
                state,
                .emission_cast,
                @intCast(pi3),
                -1,
                0,
                @floatFromInt(em.volley_count),
                player_ptr.x,
                player_ptr.y,
            );
        }

        if (!cast_consumed_edge) {
            _ = combat.tryStartParry(
                player_ptr,
                player_ptr.current_keys,
                player_ptr.prev_keys,
                state.header.tick,
                eff_dt,
                combat.PARRY_ACTIVE_MS,
                combat.PARRY_COOLDOWN_MS_DEFAULT * (if (has3) cfg3.parry_cooldown_mul else 1.0),
            );
        }
        // Gated on is_fighting (Track Z0c Item B — port of 3d465f3's
        // missing gate): parity with World.ts:2766's `else if
        // (nextEntity.alive && fightingPhase)` around stepWeapon —
        // no firing (and no cooldown tick) during countdown/round-over/
        // drafting. Shield/parry above deliberately stay UNGATED (TS's
        // own comment: "Both run regardless of round phase so the
        // shield can recharge between rounds").
        if (is_fighting) {
            // Weapon fire decision + projectile spawn (I21 + I45).
            // Use the host-resolved fire config when valid, else fall
            // back to the starter-pistol base from data/weapons.zig.
            // The host (J0 shim) patches state.player_fire_config[i]
            // each tick from createWeaponBuild(player.cards) so card
            // mutations (multi-shot, damage scale, etc) take effect.
            const fcfg = &state.player_fire_config[pi3];
            const damage_v: f64 = if (fcfg.valid != 0) fcfg.damage else weapons_data.weaponBaseById(.starter_pistol).damage;
            const fire_rate_v: f64 = if (fcfg.valid != 0) fcfg.fire_rate else weapons_data.weaponBaseById(.starter_pistol).fire_rate;
            const proj_speed_base: f64 = if (fcfg.valid != 0) fcfg.projectile_speed else weapons_data.weaponBaseById(.starter_pistol).projectile_speed;
            const proj_speed_mul: f64 = if (fcfg.valid != 0) fcfg.speed_multiplier else 1.0;
            const proj_lifetime_sec: f64 = if (fcfg.valid != 0) fcfg.projectile_lifetime_seconds else weapons_data.weaponBaseById(.starter_pistol).projectile_lifetime_seconds;
            const proj_lifetime_mul: f64 = if (fcfg.valid != 0) fcfg.lifetime_multiplier else 1.0;
            const spread_total: f64 = if (fcfg.valid != 0) fcfg.spread_radians else weapons_data.weaponBaseById(.starter_pistol).spread_radians;
            // Sunlance / Measure / Overclock (Phase 4a, docs/zig-step-world-
            // parity-goal.md — bit-exact port of weapon.ts:336-423's own
            // priority chains). `overclock_active` is read here (ahead of its
            // sibling composition at the cd_after call below) purely because
            // spread's own priority chain needs it in the SAME expression as
            // measure_active — see GEO_MEASURE_SPREAD_MULTIPLIER's own doc
            // comment (world.zig, Phase 4a constants block) for why Measure
            // beats Overclock here specifically.
            const sunlance_active = player_ptr.sunlance_until_tick > state.header.tick;
            const measure_active = player_ptr.measure_until_tick > state.header.tick;
            const overclock_active = player_ptr.overclock_until_tick > state.header.tick;
            // Damage priority: Sunlance > Measure > base — TS also ranks
            // Stolen Fangs above Sunlance here, but Stolen Fangs has no Zig
            // mirror anywhere (pendingLockCharges — unrelated to this pass), so
            // this chain correctly starts at Sunlance (see
            // GEO_SUNLANCE_DAMAGE_MULTIPLIER's own doc comment).
            const damage_amp_v: f64 = if (sunlance_active)
                damage_v * GEO_SUNLANCE_DAMAGE_MULTIPLIER
            else if (measure_active)
                damage_v * GEO_MEASURE_DAMAGE_MULTIPLIER
            else
                damage_v;
            // Spread priority: Measure (forces 0) > Overclock (tightens) > base.
            const spread_amp_total: f64 = if (measure_active)
                spread_total * GEO_MEASURE_SPREAD_MULTIPLIER
            else if (overclock_active)
                spread_total * GEO_OVERCLOCK_SPREAD_MULTIPLIER
            else
                spread_total;
            const proj_count: u32 = if (fcfg.valid != 0) @max(@as(u32, 1), fcfg.projectile_count) else 1;
            const proj_size_mul: f64 = if (fcfg.valid != 0) fcfg.size_multiplier else 1.0;
            const proj_range: f64 = if (fcfg.valid != 0) fcfg.range_px else weapons_data.weaponBaseById(.starter_pistol).projectile_range_px;
            const proj_bounces: u32 = if (fcfg.valid != 0) fcfg.bounces else 0;
            const proj_pierce: u32 = if (fcfg.valid != 0) fcfg.pierce_count else 0;
            const proj_splits: u32 = if (fcfg.valid != 0) fcfg.split_count else 0;
            const proj_homing: f64 = if (fcfg.valid != 0) fcfg.homing_strength else 0;
            const proj_accel: f64 = if (fcfg.valid != 0) fcfg.acceleration_multiplier else 0;
            const proj_gravity: f64 = if (fcfg.valid != 0) fcfg.gravity_scale else 0;
            const proj_slow: f64 = if (fcfg.valid != 0) fcfg.slow_multiplier else 1.0;
            const proj_impact_radius: f64 = if (fcfg.valid != 0) fcfg.impact_radius_px else 0;
            const proj_shape = if (fcfg.valid != 0) fcfg.shape else weapons_data.weaponBaseById(.starter_pistol).projectile_shape;
            const proj_element = if (fcfg.valid != 0) fcfg.element else weapons_data.weaponBaseById(.starter_pistol).projectile_element;
            const proj_pathing = if (fcfg.valid != 0) fcfg.pathing else weapons_data.weaponBaseById(.starter_pistol).projectile_pathing;
            const proj_impact_kind = if (fcfg.valid != 0) fcfg.impact else .none;
            // Passive Tithe leech (Track Z1c "six-axes axis payloads" —
            // ResolvedFireConfig.leech_fraction's own doc comment):
            // build-resolved, stamped onto the fired shot exactly like
            // weapon.ts:514/577-579's `build.leechFraction ?? 0` stamp.
            const proj_leech: f64 = if (fcfg.valid != 0) fcfg.leech_fraction else 0;
            // Syzygist haste (2026-07-20 gap-closure pass — parity with
            // weapon.ts:318-322): fire-rate multiplier while the window is
            // live, reading the per-entity haste_multiplier set by TS's
            // applyHasteToAlly (Zig never computes it, only carries it
            // through — same contract as PlayerEntity.haste_multiplier's own
            // doc comment). This field already existed on PlayerEntity
            // (world_state.zig) but was unread at this site before this pass.
            const haste_active = player_ptr.flags.has_haste and
                player_ptr.haste_until_tick > state.header.tick;
            const haste_fire_rate_mul: f64 = if (haste_active) player_ptr.haste_multiplier else 1.0;
            // Wizard basic-fire ramping channel (2026-07-20 gap-closure pass —
            // parity with weapon.ts:330-334): ramps 1.0x → the ceiling over
            // GEO_CHANNEL_RAMP_MS of continuous hold (channel_hold_ms, ticked
            // at the top of this loop). `is_wizard_channel` keeps this at
            // exactly 1 for every other class (channel_hold_ms is always 0
            // for them anyway).
            const channel_ramp_frac: f64 = if (is_wizard_channel)
                @min(1.0, player_ptr.channel_hold_ms / GEO_CHANNEL_RAMP_MS)
            else
                0.0;
            const channel_fire_rate_mul: f64 = 1.0 +
                (GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX - 1.0) * channel_ramp_frac;
            // Overclock (Phase 4a, docs/zig-step-world-parity-goal.md —
            // constants.ts's GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER,
            // weapon.ts:339-342/558-565): fire-rate multiplier while the
            // window is live, composing alongside haste/channel-ramp above at
            // the SAME cd_after call below — matches weapon.ts's own
            // multiplicative chain exactly (`hasteFireRateMul`/
            // `channelFireRateMul`/`overclockActive ? GEO_OVERCLOCK_FIRE_RATE_
            // MULTIPLIER : 1` are all peers in ONE `Math.max(MIN_FIRE_RATE, ...)`
            // product). A cast THIS tick cannot buff a shot fired THIS SAME
            // tick — section 6 (this loop) runs before section 6z (ability
            // dispatch, where the window is opened) every tick, see
            // `sunlance_until_tick`'s own doc comment (world_state.zig) for the
            // full one-tick-lag reasoning, matching TS's identical ordering.
            // `overclock_active` itself is computed above, alongside
            // sunlance_active/measure_active, for the spread-priority chain.
            const overclock_fire_rate_mul: f64 = if (overclock_active) GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER else 1.0;
            const cd_after = weapon.cooldownFromFireRate(
                fire_rate_v * chaos_profile.fire_rate_multiplier *
                    haste_fire_rate_mul * channel_fire_rate_mul * overclock_fire_rate_mul,
                1.0,
            );
            var fire_decision: weapon.FireDecision = undefined;
            weapon.weapon_tick_fire_with_keys(
                player_ptr,
                player_ptr.current_keys,
                eff_dt,
                cd_after,
                &fire_decision,
            );
            if (fire_decision.fired == 1) {
                // Muzzle offset + alternating-hand throws (Track Z0b Item B —
                // port of orphaned-branch commit 888345c; previously spawned
                // dead-center on the player with a center-derived angle, the
                // audit's 10.84px-vs-47.32px per-shot divergence). Parity with
                // weapon.ts:368-376: hand toggles ONCE per fire event, not per
                // pellet — a multi-shot spread's pellets all share one muzzle
                // origin — and it toggles OUTSIDE the disableProjectiles gate
                // (TS toggles before its own `if (!chaos.disableProjectiles)`
                // spawn loop, so slappers-only rounds keep the parity bit
                // moving in lock-step too).
                const throw_hand: u8 = (player_ptr.throw_hand_parity ^ 1) & 1;
                player_ptr.throw_hand_parity = throw_hand;
                const muzzle = weapon.playerMuzzlePosition(
                    player_ptr.x,
                    player_ptr.y,
                    player_ptr.aim_x,
                    player_ptr.aim_y,
                    throw_hand,
                );
                // Fire angle derives from the OFFSET muzzle point toward aim
                // (weapon.ts:376's `lutAtan2(aim.y - muzzle.y, aim.x -
                // muzzle.x)`) — NOT from the player center; the angular gap
                // between the two is exactly what compounded over travel
                // distance in the audit.
                const adx = player_ptr.aim_x - muzzle.x;
                const ady = player_ptr.aim_y - muzzle.y;
                const aim_angle: f64 = if (adx == 0 and ady == 0) 0 else trig.lutAtan2(ady, adx);
                const speed = proj_speed_base * proj_speed_mul;
                const lifetime_ms = @max(
                    50.0,
                    proj_lifetime_sec * 1000.0 * proj_lifetime_mul,
                );
                const radius_v: f64 = @max(2.0, 7.0 * proj_size_mul);
                const spawn_projectiles = chaos_profile.disable_projectiles == 0;

                // Multi-shot spread fan: distribute proj_count
                // projectiles evenly across spread_amp_total radians (Measure/
                // Overclock's own priority chain applied — see their doc
                // comment above) centred on the MUZZLE-derived aim_angle.
                // Single-shot (count == 1) fires straight regardless (offset
                // always 0), same "can't observe spread with one shot" shape
                // weapon.ts itself has. `spawn_projectiles` gates ONLY the
                // spawns (slappers-only chaos) — the hand toggle above already
                // ran, matching TS's ordering.
                // Delivery branch (Track Z1c item 1): a raycast-resolved
                // build resolves same-tick hitscan instead of spawning
                // traveling ProjectileEntitys — mirrors weapon.ts's
                // `isHitscan` branch (`build.delivery === "raycast"`).
                // Gated on `fcfg.valid` (an invalid/fallback config keeps
                // the pre-existing projectile-spawn behavior — see
                // `weapons_data.WeaponBase`'s doc comment: the class-blind
                // fallback base has no `delivery` field at all yet, a
                // separate, smaller, deliberately-untouched gap).
                const is_hitscan = fcfg.valid != 0 and fcfg.delivery == 1;
                var shot_i: u32 = 0;
                while (spawn_projectiles and shot_i < proj_count) : (shot_i += 1) {
                    const offset: f64 = if (proj_count <= 1)
                        0
                    else blk: {
                        const t: f64 = @as(f64, @floatFromInt(shot_i)) /
                            @as(f64, @floatFromInt(proj_count - 1));
                        break :blk -spread_amp_total * 0.5 + t * spread_amp_total;
                    };
                    const ang = aim_angle + offset;

                    if (is_hitscan) {
                        resolveHitscanFire(
                            state,
                            pi3,
                            muzzle.x,
                            muzzle.y,
                            ang,
                            proj_range,
                            radius_v,
                            proj_pierce,
                            damage_amp_v,
                            proj_element,
                            chaos_profile,
                            eff_dt,
                            is_fighting,
                            proj_leech,
                            proj_impact_kind,
                            proj_impact_radius,
                            proj_slow,
                        );
                        emitEvent(
                            state,
                            .shot_fired,
                            @intCast(pi3),
                            -1,
                            0,
                            ang,
                            player_ptr.x,
                            player_ptr.y,
                        );
                        continue;
                    }

                    if (state.projectile_count >= world_state.MAX_PROJECTILES) break;
                    const slot: u32 = state.projectile_count;
                    state.projectile_count += 1;
                    const new_id: u32 = state.header.next_entity_id;
                    state.header.next_entity_id += 1;
                    state.projectiles[slot] = .{
                        .x = muzzle.x,
                        .y = muzzle.y,
                        .vx = trig.lutCos(ang) * speed,
                        .vy = trig.lutSin(ang) * speed,
                        .radius = radius_v,
                        .damage = damage_amp_v,
                        .lifetime_ms = lifetime_ms,
                        .age_ms = 0,
                        .traveled_px = 0,
                        .origin_x = muzzle.x,
                        .origin_y = muzzle.y,
                        .homing_strength = proj_homing,
                        .acceleration_multiplier = proj_accel,
                        .gravity_scale = proj_gravity,
                        .range_px = proj_range,
                        .slow_multiplier = proj_slow,
                        .sticky_fuse_ms = 0,
                        .impact_radius_px = proj_impact_radius,
                        .id = new_id,
                        .bounces_remaining = proj_bounces,
                        .pierce_remaining = proj_pierce,
                        .split_count = proj_splits,
                        .flags = .{
                            .has_owner = true,
                            .has_impact = true,
                            .has_split = proj_splits > 0,
                            .has_slow = proj_slow != 1.0,
                            .has_homing = proj_homing != 0,
                            .has_acceleration = proj_accel != 0,
                            .has_gravity_scale = proj_gravity != 0,
                            .has_range = true,
                            .has_age = true,
                            .has_traveled = true,
                            .has_origin = true,
                            .returning = false,
                            .has_sticky_fuse = false,
                            .has_impact_radius = proj_impact_radius > 0,
                            .has_leech_fraction = proj_leech > 0,
                        },
                        .pathing = proj_pathing,
                        .element = proj_element,
                        .impact = proj_impact_kind,
                        .shape = proj_shape,
                        .owner_id_len = player_ptr.id_len,
                        .owner_id_bytes = player_ptr.id_bytes,
                        .leech_fraction = @floatCast(proj_leech),
                    };
                    emitEvent(
                        state,
                        .shot_fired,
                        @intCast(pi3),
                        -1,
                        new_id,
                        ang,
                        player_ptr.x,
                        player_ptr.y,
                    );
                }

                // Fire recoil — kick the shooter opposite the MUZZLE-derived
                // aim angle (Track Z0c Item A; parity with weapon.ts:589-607).
                // Runs OUTSIDE the spawn loop and outside `spawn_projectiles`
                // (slappers-only rounds still kick, matching TS's "cooldown/
                // recoil still apply" comment) and after the spawns (order is
                // observationally irrelevant — spawns read position, recoil
                // writes velocity — but kept TS-shaped). Composition mirrors
                // weapon.ts:600-605 term for term: the baked build product
                // (fcfg.recoil_impulse — see its own world_state.zig doc
                // comment for what's inside) × chaos × Recoil Step's rider
                // window, ÷ the class chassis recoil control. Fallback for
                // valid==0 is the bare starter-pistol base (projectile recoil
                // multiplier 1), same shape as every sibling fallback above.
                //
                // MELEE-CLASS GATE (found via the paladin melee smoke tests,
                // not assumed): TS routes ninja/paladin AROUND stepWeapon
                // entirely (World.ts:2744's class branch — Fire drives the
                // melee FSM, never the ranged shot), so those classes NEVER
                // take fire recoil in TS. Zig's own fire section still ranged-
                // fires for them (a PRE-EXISTING divergence this pass neither
                // introduced nor widens — narrowing it means porting the whole
                // class branch, separate work); the kick at least must match
                // TS exactly, so it applies only to the classes that reach
                // stepWeapon there (wizard/balanced, priest/shielded).
                const is_melee_class = player_ptr.character_id == .sprinter or
                    player_ptr.character_id == .heavy;
                if (!is_melee_class) {
                    const recoil_resolved: f64 = if (fcfg.valid != 0)
                        fcfg.recoil_impulse
                    else
                        weapons_data.weaponBaseById(.starter_pistol).recoil_impulse;
                    const recoil_step_active =
                        player_ptr.recoil_step_until_tick > state.header.tick;
                    const recoil_strength = (recoil_resolved *
                        chaos_profile.recoil_multiplier *
                        (if (recoil_step_active) GEO_RECOIL_STEP_RECOIL_MULTIPLIER else 1.0)) /
                        recoilControlForArchetype(player_ptr.character_id);
                    player_ptr.vx -= trig.lutCos(aim_angle) * recoil_strength;
                    player_ptr.vy -= trig.lutSin(aim_angle) * recoil_strength * 0.45;
                }
            }
        }

        // Roll current → prev for the next tick's edge detection.
        player_ptr.prev_keys = player_ptr.current_keys;
    }

    // 6z. Ability-cast dispatch (Phase 1, docs/zig-step-world-parity-goal.md
    //     "the next unblock") — runs after section 6's per-player loop has
    //     finished for EVERY player (shield/emission already this-tick-
    //     final) and BEFORE section 6a's melee loop, so a window opened
    //     here (Judgment Line's mark, Unbroken Seal, Undercut, Read Mark,
    //     Second Wind, Edge Storm) is already visible to THIS SAME tick's
    //     melee consumption — matching World.ts's own per-player-loop
    //     ordering, where the ability-slot loop (World.ts:2149) runs well
    //     before the NINJA/PALADIN MELEE sections (World.ts:4029+/4412+).
    //     `stepAbilityDispatch` itself gates on fighting-phase + alive, so
    //     no outer phase guard is needed here (matches how section 6b's
    //     AOE resolver and stepMeleeSwing structure their own guards).
    {
        var adi: u32 = 0;
        while (adi < state.player_count) : (adi += 1) {
            stepAbilityDispatch(state, adi, eff_dt, ability_slot_rising_edge[adi]);
        }
    }

    // 6a. Melee — Ninja Slash + Paladin Kindled Edge (2026-07-20 base-
    //     melee-mechanic gap-closure pass; see stepMeleeSwing's own doc
    //     comment above for the full scope/mitigation/placement reasoning).
    //     Runs after section 6's per-player loop has finished for EVERY
    //     player (so shield state is already this-tick-final, same
    //     ordering guarantee section 6b relies on) and before section 6b.
    //     Fighting-phase only. Hangout (Track E1d): the swing FSM still
    //     runs here (phase is pinned "fighting" in that mode), matching
    //     TS — the hangout carve-out lives INSIDE stepMeleeSwing, at the
    //     player arc hit-check (World.ts:5725/:6148 mirror).
    if (is_fighting) {
        var mai: u32 = 0;
        while (mai < state.player_count) : (mai += 1) {
            stepMeleeSwing(state, mai, eff_dt, melee_fire_rising_edge[mai], shield_rising_edge[mai]);
        }
    }

    // 6b. Instant AOE resolution (2026-07-20 gap-closure pass — deferred-
    //     write primitive port of World.ts's `pendingInstantAoe`/
    //     `resolveInstantAoeCasts`; see resolveInstantAoeCasts's own doc
    //     comment for the full mitigation accounting). MUST run after
    //     section 6's per-player loop directly above (every player's own
    //     per-tick state — shield/parry/fire — is only final once that
    //     loop has finished for EVERY player). This drain now mirrors
    //     World.ts's FIRST `resolveInstantAoeCasts` call (World.ts:4957,
    //     right after the per-player + melee passes) — the Z0c Item B
    //     reorder moved the whole combat block ahead of projectile motion,
    //     so Paper Double's death/expiry burst is no longer discoverable
    //     here; it gets the SAME second, later drain TS has (see section
    //     6y + its 6y-drain, after section 4 below).
    // Hangout: casts still QUEUE (abilities are live in the lobby — Jake's
    // 2026-07-18 live-playtest ruling, abilitySlots.test.ts), but the
    // vs-player resolution never runs — World.ts:5313 gates this drain
    // `fightingPhase && !hangoutMode`. The queue still empties (TS's
    // pendingInstantAoe is a per-tick local — unresolved casts are
    // DROPPED, not deferred). TS's hangout-only vs-destructible alternate
    // (:5330) remains unported — see g_hangout_mode's recorded-cuts list.
    if (state.pending_instant_aoe_count > 0) {
        if (!g_hangout_mode) {
            resolveInstantAoeCasts(
                state,
                state.pending_instant_aoe[0..state.pending_instant_aoe_count],
                state.header.tick,
                eff_dt,
            );
        }
        state.pending_instant_aoe_count = 0;
    }

    // 2a. Fire-hazard chaos modifier (I33): spawn fire patches at
    //     random map positions on the configured interval.
    if (chaos_profile.fire_hazard_active != 0 and
        chaos_profile.fire_hazard_interval_ms > 0 and
        state.fire_count < world_state.MAX_FIRE)
    {
        const cur_timer: f64 = @floatFromInt(state.header.fire_hazard_timer_ms);
        const next_timer = cur_timer + eff_dt;
        if (next_timer >= chaos_profile.fire_hazard_interval_ms) {
            state.header.fire_hazard_timer_ms = 0;
            // Use the rng_state for jitter; advance it.
            state.header.rng_state +%= 0x6d2b79f5;
            const rx_raw = state.header.rng_state ^ (state.header.rng_state >> 15);
            const ry_raw = state.header.rng_state ^ (state.header.rng_state >> 7);
            // Map to a rough -800..+800 / -400..+400 range. Caller
            // can clamp via map AABB later.
            const fx: f64 = @as(f64, @floatFromInt(rx_raw)) /
                @as(f64, @floatFromInt(@as(u32, 0xFFFFFFFF))) * 1600.0 - 800.0;
            const fy: f64 = @as(f64, @floatFromInt(ry_raw)) /
                @as(f64, @floatFromInt(@as(u32, 0xFFFFFFFF))) * 800.0 - 400.0;
            const slot = state.fire_count;
            state.fire_count += 1;
            const new_id: u32 = state.header.next_entity_id;
            state.header.next_entity_id += 1;
            state.fires[slot] = .{
                .x = fx,
                .y = fy,
                .radius = 36.0,
                .remaining_ms = 1800.0,
                .damage_per_second = 14.0,
                .id = new_id,
                .has_owner = 0,
                .owner_id_len = 0,
                .owner_id_bytes = @splat(0),
            };
        } else {
            state.header.fire_hazard_timer_ms = @intFromFloat(next_timer);
        }
    }

    // 2. Fire patches (I10): tick lifetime in place + apply DPS
    //    damage to overlapping non-owner alive players.
    //    Player AABB is approximated as 30×56 centered on (x,y), scaled
    //    per class since Track Z1a item 2 (parity with fire.ts:77, which
    //    reads the class-scaled playerHitboxAABB since cohesion P1.4 —
    //    same "scale the existing approximation, don't silently swap the
    //    base box" call as section 4's projectile check).
    const PLAYER_HALF_W: f64 = 15.0;
    const PLAYER_HALF_H: f64 = 28.0;
    var fi: u32 = 0;
    while (fi < state.fire_count) : (fi += 1) {
        const patch_ptr = &state.fires[fi];
        if (patch_ptr.remaining_ms <= 0) continue;
        const damage_this_tick = patch_ptr.damage_per_second * (eff_dt / 1000.0);
        // Hangout player immunity (World.ts:7030's !hangoutMode) — patches
        // still spawn + tick their lifetime (fireEntityTick below runs
        // unconditionally, same as TS's stepFirePatches), but never touch a
        // player. Recorded nuance: TS still FORWARDS stepFirePatches'
        // cosmetic hit-confirmed event in hangout while suppressing the
        // damage; Zig emits at the damage site, so the wasm stream drops
        // that cosmetic event too (see g_hangout_mode's recorded-cuts list).
        var ph: u32 = if (g_hangout_mode) state.player_count else 0;
        while (ph < state.player_count) : (ph += 1) {
            if (!state.players[ph].flags.alive) continue;
            // Skip owner self-damage.
            if (patch_ptr.has_owner != 0 and
                state.players[ph].id_len == patch_ptr.owner_id_len and
                std.mem.eql(u8, state.players[ph].id_bytes[0..patch_ptr.owner_id_len], patch_ptr.owner_id_bytes[0..patch_ptr.owner_id_len]))
            {
                continue;
            }
            const fire_hit_scale = combat.combatHitboxScale(state.players[ph].character_id);
            if (fire.fireEntityHitsPlayerAABB(
                patch_ptr,
                state.players[ph].x - PLAYER_HALF_W * fire_hit_scale,
                state.players[ph].y - PLAYER_HALF_H * fire_hit_scale,
                PLAYER_HALF_W * 2.0 * fire_hit_scale,
                PLAYER_HALF_H * 2.0 * fire_hit_scale,
            )) {
                // Shield-first absorption (I38) — fire DPS drains
                // shield before health if shield active + has charge.
                var dmg_to_apply = damage_this_tick;
                const pp = &state.players[ph];
                if (pp.flags.shield_active and
                    pp.flags.has_shield_charge and
                    pp.shield_charge > 0)
                {
                    pp.shield_charge -= dmg_to_apply;
                    if (pp.shield_charge <= 0) {
                        const overflow = -pp.shield_charge;
                        pp.shield_charge = 0;
                        pp.flags.shield_active = false;
                        emitEvent(
                            state,
                            .shield_popped,
                            @intCast(ph),
                            -1,
                            patch_ptr.id,
                            0,
                            pp.x,
                            pp.y,
                        );
                        dmg_to_apply = overflow;
                    } else {
                        dmg_to_apply = 0;
                    }
                }
                if (dmg_to_apply > 0) {
                    pp.health -= dmg_to_apply;
                    // Parity with World.ts: fire-patch damage emits
                    // hit_confirmed (no attacker — environmental), which
                    // ALSO feeds the emission-charge fill (step 10). Without
                    // this, TS fills the victim's taken-side charge for fire
                    // ticks and the wasm world silently doesn't.
                    emitEvent(
                        state,
                        .hit_confirmed,
                        @intCast(ph),
                        -1,
                        patch_ptr.id,
                        dmg_to_apply,
                        pp.x,
                        pp.y,
                    );
                    if (pp.health <= 0) {
                        pp.health = 0;
                        pp.flags.alive = false;
                        // Kill attribution (2026-07-17, parity with
                        // World.ts + fire.ts): the patch carries its
                        // igniter as owner — credit the kill (tally +
                        // player_idx_b for the TS event converter).
                        // Patches never damage their owner, so this is
                        // never a self-kill.
                        const igniter_idx: i32 = if (patch_ptr.has_owner != 0)
                            playerIdxById(
                                state,
                                patch_ptr.owner_id_bytes[0..patch_ptr.owner_id_len],
                            )
                        else
                            -1;
                        creditKill(state, igniter_idx, @intCast(ph));
                        emitEvent(
                            state,
                            .player_killed,
                            @intCast(ph),
                            igniter_idx,
                            patch_ptr.id,
                            0,
                            pp.x,
                            pp.y,
                        );
                    }
                }
            }
        }
        _ = fire.fireEntityTick(patch_ptr, eff_dt);
    }

    // 2z. Shrink-zone storm (Track Z0b Item C — port of orphaned-branch
    //     commit 9aeabaa; parity with client/src/sim/suddenDeath.ts's
    //     computeStormZone + stepSuddenDeathStorm, the ONE sim concern
    //     that had zero Zig code at all). Two mutually-exclusive zones,
    //     sudden death wins ties:
    //       - True sudden death (header.sudden_death_active — a game-point
    //         tie, Z0a's trigger): shrinks the WHOLE round,
    //         SCALE_START(1.0) → SCALE_END(0.6) as the clock runs.
    //       - Soft endgame zone (every round, unconditionally): only
    //         active in the final ENDGAME_ZONE_TRIGGER_MS(15s), eases from
    //         full coverage to ENDGAME_ZONE_SCALE_END(0.75) —
    //         anti-timeout-camping pressure without the hard punish.
    //     Both damage every alive player outside a circle centered on the
    //     map (half-diagonal base radius, so scale=1.0 covers every corner
    //     — nobody takes damage the instant a zone activates). Gated the
    //     same way fire-hazard is: fighting phase + REAL map size
    //     (fail-closed if the host never called world_state_set_arena_size
    //     — a Zig-only test that never wired the arena gets an inert
    //     storm, not a wrong one).
    //
    //     DAMAGE OWNERSHIP (the Z0a deferral, decided WITH evidence this
    //     cut): storm damage now lives HERE on the wasm path. Checked
    //     directly — on the full step_world path (client
    //     applyWasmWorldStepFullSync / server serverWasmHost.step), TS's
    //     stepWithRuntime never runs, so World.ts's own storm block
    //     (World.ts §3d) never executes there and serverWasmHost's
    //     mergeUnpacked only passes `suddenDeathActive` through — the
    //     wasm-mode path SKIPPED storm damage entirely (not
    //     double-applied). Moving the application here closes that hole
    //     with no double-hit anywhere: pure-TS path → TS applies, wasm
    //     path → this section applies.
    //
    //     Parity notes vs TS, both deliberate:
    //       - chaos damage_multiplier applies (World.ts:6578 scales storm
    //         damage by chaosProfile.damageMultiplier — the branch spec
    //         predated that and skipped it);
    //       - reads the section-0b PRE-step round snapshot, exactly as TS
    //         reads `state.round` at tick entry — section 1 has already
    //         overwritten the header by the time this section runs.
    //     Hangout: skipped ENTIRELY (World.ts:7167's !hangoutMode) — the
    //     lobby pins the round clock, so countdown_remaining_ms reads as
    //     "final seconds" forever and the soft endgame zone would run
    //     permanently at full strength against immune-everywhere-else
    //     visitors.
    if (!g_hangout_mode and
        storm_prestep_phase == @intFromEnum(round.RoundPhase.fighting) and
        g_arena_size_x > 0 and g_arena_size_y > 0)
    {
        var zone_scale: f64 = 0;
        var zone_active = false;
        if (storm_prestep_sudden != 0) {
            const elapsed_ms = round.ROUND_TIME_LIMIT_MS - storm_prestep_countdown;
            const frac = @max(0.0, @min(1.0, elapsed_ms / round.ROUND_TIME_LIMIT_MS));
            zone_scale = round.SUDDEN_DEATH_SCALE_START +
                (round.SUDDEN_DEATH_SCALE_END - round.SUDDEN_DEATH_SCALE_START) * frac;
            zone_active = true;
        } else if (storm_prestep_countdown <= round.ENDGAME_ZONE_TRIGGER_MS) {
            // countdown_remaining_ms IS the remaining round time during
            // `fighting` (suddenDeath.ts's own comment).
            const local_elapsed_ms = round.ENDGAME_ZONE_TRIGGER_MS - storm_prestep_countdown;
            const frac = @max(0.0, @min(1.0, local_elapsed_ms / round.ENDGAME_ZONE_TRIGGER_MS));
            zone_scale = 1.0 + (round.ENDGAME_ZONE_SCALE_END - 1.0) * frac;
            zone_active = true;
        }
        if (zone_active) {
            // Half-diagonal so scale=1.0 comfortably covers every corner —
            // nobody takes storm damage the instant sudden death triggers.
            const base_radius = @sqrt(g_arena_size_x * g_arena_size_x +
                g_arena_size_y * g_arena_size_y) / 2.0;
            const zone_radius = base_radius * zone_scale;
            const zone_cx = g_arena_size_x / 2.0;
            const zone_cy = g_arena_size_y / 2.0;
            const safe_radius_sq = zone_radius * zone_radius;
            // Environmental DoT — no parry/shield mitigation, no owner
            // (same direct-damage drain shape as the fire patches above;
            // World.ts applies the identical chain at its §3d).
            const storm_damage = round.SUDDEN_DEATH_STORM_DPS * (eff_dt / 1000.0) *
                chaos_profile.damage_multiplier;
            var sdi: u32 = 0;
            while (sdi < state.player_count) : (sdi += 1) {
                const sp = &state.players[sdi];
                if (!sp.flags.alive) continue;
                const sdx = sp.x - zone_cx;
                const sdy = sp.y - zone_cy;
                if (sdx * sdx + sdy * sdy <= safe_radius_sq) continue;
                sp.health -= storm_damage;
                emitEvent(state, .hit_confirmed, @intCast(sdi), -1, 0, storm_damage, sp.x, sp.y);
                if (sp.health <= 0) {
                    sp.health = 0;
                    sp.flags.alive = false;
                    // Attacker-less death (cause "storm") — credits nobody
                    // (creditKill no-ops on attacker -1), and the
                    // section-11 fast-respawn stamp catches it like every
                    // other death cause.
                    emitEvent(state, .player_killed, @intCast(sdi), -1, 0, 0, sp.x, sp.y);
                }
            }
        }
    }

    // 2b. Paper Doubles (2026-07-20 gap-closure pass item 3 — parity port
    //     of paperDouble.ts's `stepPaperDoubles`): straight-line kinematic
    //     advance (no platform collision/gravity, per PaperDoubleEntity's
    //     own doc comment) + lifetime countdown. Modeled on section 2's
    //     fire-patch lifetime tick immediately above — ticks remaining_ms
    //     down in place but does NOT remove expired entries here (same
    //     "tick now, compact once at end of tick" split fire patches and
    //     projectiles already use); section 9 below does the actual
    //     removal via the same `remaining_ms > 0` filter. Runs BEFORE
    //     section 4's projectile-resolution loop so a decoy can be hit the
    //     same tick it's still alive (health <= 0 or remaining_ms <= 0
    //     both fall out of the section-9 compaction filter identically —
    //     no separate health check needed here since the collision loop in
    //     section 4 is what drives health down, not this section).
    var pdi: u32 = 0;
    while (pdi < state.paper_double_count) : (pdi += 1) {
        const pd_ptr = &state.paper_doubles[pdi];
        if (pd_ptr.remaining_ms <= 0) continue;
        pd_ptr.x += pd_ptr.vx * (eff_dt / 1000.0);
        pd_ptr.y += pd_ptr.vy * (eff_dt / 1000.0);
        pd_ptr.remaining_ms -= eff_dt;
    }

    // 3. Projectile pre-step lifecycle + motion (I7). Sticky /
    //    lifetime decisions first; for `advance` results the
    //    motion kernel runs via step_projectile_v2 with the REAL
    //    static-AABB cache (terrain collision + bounce). Player
    //    collision is resolved separately in phase 4; homing needs
    //    the player array and is a follow-on (empty players here).
    const proj_statics = state.statics[0..state.static_count];
    const empty_xs: []const f64 = &.{};
    const empty_ys: []const f64 = &.{};
    const empty_alive: []const u8 = &.{};
    var pi: u32 = 0;
    while (pi < state.projectile_count) : (pi += 1) {
        const proj_ptr = &state.projectiles[pi];
        // Split-spawn orchestrator (Track E1) bookkeeping — see the
        // section comment above `queueSplitDeath` for why both exist.
        pending_split_valid[pi] = false;
        projectile_lifetime_pre_step[pi] = proj_ptr.lifetime_ms;
        const result = projectile.projectilePreStep(proj_ptr, eff_dt);
        if (result == .advance) {
            // Bridge ProjectileEntity → ProjectileKinematicsV2 →
            // step → write motion fields back.
            var kine = projectile.ProjectileKinematicsV2{
                .x = proj_ptr.x,
                .y = proj_ptr.y,
                .vx = proj_ptr.vx,
                .vy = proj_ptr.vy,
                .age_ms = if (proj_ptr.flags.has_age) proj_ptr.age_ms else 0.0,
                .lifetime_ms = proj_ptr.lifetime_ms,
                .radius = proj_ptr.radius,
                .gravity_scale = if (proj_ptr.flags.has_gravity_scale) proj_ptr.gravity_scale else 0.0,
                .traveled_px = if (proj_ptr.flags.has_traveled) proj_ptr.traveled_px else 0.0,
                .origin_x = if (proj_ptr.flags.has_origin) proj_ptr.origin_x else proj_ptr.x,
                .origin_y = if (proj_ptr.flags.has_origin) proj_ptr.origin_y else proj_ptr.y,
                .range_px = if (proj_ptr.flags.has_range) proj_ptr.range_px else 0.0,
                .acceleration_multiplier = if (proj_ptr.flags.has_acceleration) proj_ptr.acceleration_multiplier else 0.0,
                .homing_strength = if (proj_ptr.flags.has_homing) proj_ptr.homing_strength else 0.0,
                .id = @floatFromInt(proj_ptr.id),
                .pathing = @intFromEnum(proj_ptr.pathing),
                .returning = if (proj_ptr.flags.returning) 1 else 0,
                .bounces_remaining = @intCast(proj_ptr.bounces_remaining),
            };
            const r = projectile.stepV2(
                &kine,
                eff_dt,
                proj_statics,
                empty_xs,
                empty_ys,
                empty_alive,
                -1, // no owner
            );
            // Write motion-relevant fields back. Lifetime drains
            // by dt_ms regardless of expire flag — the next
            // pre_step picks up expiry.
            proj_ptr.x = kine.x;
            proj_ptr.y = kine.y;
            proj_ptr.vx = kine.vx;
            proj_ptr.vy = kine.vy;
            proj_ptr.lifetime_ms -= eff_dt;
            if (proj_ptr.flags.has_age) proj_ptr.age_ms = kine.age_ms;
            if (proj_ptr.flags.has_traveled) proj_ptr.traveled_px = kine.traveled_px;
            proj_ptr.flags.returning = kine.returning != 0;
            proj_ptr.bounces_remaining = @intCast(kine.bounces_remaining);
            // Terrain hit on a non-bouncing shard → expire it (stopped at the
            // wall). End-of-tick compaction removes lifetime<=0 projectiles.
            // Split-eligible (Track E1): TS's terrain-impact split site
            // (projectile.ts:579/:652) splits at the post-integration
            // position with the post-pathing velocity — exactly what the
            // write-back above just stored. stepV2's own first-tick
            // muzzle-overlap exemption already gated `r.expired`, same as
            // TS's `proj.ageMs !== 0` guard at that site.
            if (r.expired != 0) {
                queueSplitDeath(pi, proj_ptr, projectile_lifetime_pre_step[pi]);
                proj_ptr.lifetime_ms = 0;
            } else if (r.bounced == 0) {
                // TS steps 5 + 6 (projectile.ts:669-715) — boomerang
                // home-return and the range cap. stepV2 never implemented
                // either (it ends at the terrain check), so before Track
                // E1 a ranged-capped shard flew to full lifetime and a
                // returning boomerang orbited its origin forever on the
                // wasm path. Both are split-eligible deaths in TS. The
                // bounce branch is exempt exactly like TS (its early
                // return at :562 skips steps 5/6 on the tick it bounces).
                if (proj_ptr.pathing == .boomerang and proj_ptr.flags.returning) {
                    // kine.origin_x/y carry TS's exact coalescing
                    // (`proj.originX ?? proj.x`, pre-motion x when unset)
                    // — proj_ptr.origin_x is only meaningful under
                    // has_origin, and the bridge above already resolved
                    // that.
                    const bdx = proj_ptr.x - kine.origin_x;
                    const bdy = proj_ptr.y - kine.origin_y;
                    const catch_r = projectile.BOOMERANG_RETURN_RADIUS + proj_ptr.radius;
                    if (bdx * bdx + bdy * bdy < catch_r * catch_r) {
                        queueSplitDeath(pi, proj_ptr, projectile_lifetime_pre_step[pi]);
                        proj_ptr.lifetime_ms = 0;
                    }
                } else if (proj_ptr.pathing != .boomerang and
                    proj_ptr.flags.has_range and
                    proj_ptr.range_px > 0 and
                    proj_ptr.traveled_px >= proj_ptr.range_px)
                {
                    queueSplitDeath(pi, proj_ptr, projectile_lifetime_pre_step[pi]);
                    proj_ptr.lifetime_ms = 0;
                }
            }
        } else if (result == .sticky_expired or result == .lifetime_expired) {
            // TS's pre-motion death sites (projectile.ts:236 sticky
            // fuse-end, :248 lifetime expiry): the shard dies THIS tick,
            // before motion, splitting from its as-is state (a stuck
            // sticky shard has vx=vy=0 — zeroed at the stick site in
            // section 4 below — so its fan takes the speed==0/baseAngle=0
            // shape, same as TS). Before Track E1 these two results were
            // silently unhandled: a shard whose residual lifetime (or
            // sticky fuse) was <= dt froze as a zombie forever — never
            // advanced (pre-step short-circuits), never compacted
            // (lifetime_ms stayed > 0), hit-testing players at its frozen
            // position every tick.
            queueSplitDeath(pi, proj_ptr, projectile_lifetime_pre_step[pi]);
            proj_ptr.lifetime_ms = 0;
        }
    }

    // 4. Per-pair projectile × {destructible, player} resolution
    //    (I11). Destructible HP application + player damage on
    //    overlap (skip owner). Projectile destroy is signalled by
    //    setting lifetime_ms = 0 so the next pre_step expires it.
    var pi2: u32 = 0;
    while (pi2 < state.projectile_count) : (pi2 += 1) {
        const proj_ptr = &state.projectiles[pi2];
        if (proj_ptr.lifetime_ms <= 0) continue;
        // Sticky linger (Track E1): a stuck shard is inert until its fuse
        // ends — TS's stepProjectile early-returns for it (projectile.ts:
        // 225-242) so it never re-collides with ANY candidate pool.
        // Without this skip the frozen shard re-entered the hit chain
        // every tick (re-damaging + re-arming its own fuse at the sticky
        // branch below, so the fuse-end split could never fire).
        if (proj_ptr.flags.has_sticky_fuse and proj_ptr.sticky_fuse_ms > 0) continue;
        var di: u32 = 0;
        while (di < state.destructible_count) : (di += 1) {
            const dest_ptr = &state.destructibles[di];
            const r = destructible.resolveProjectileHit(proj_ptr, dest_ptr);
            if (r == .no_overlap) continue;
            proj_ptr.lifetime_ms = 0;
            // Explosive AOE on break (I12): radial damage to
            // every alive non-owner player within EXPLOSION_RADIUS.
            if (r == .broken) {
                emitEvent(
                    state,
                    .destructible_broken,
                    -1,
                    -1,
                    dest_ptr.id,
                    0,
                    dest_ptr.x,
                    dest_ptr.y,
                );
            }
            // Hangout: dummies break, blasts never hurt (World.ts:6987's
            // !hangoutMode). Recorded nuance: TS still forwards the
            // cosmetic blast hit-confirmed while suppressing the damage;
            // Zig emits at the damage site, so that cosmetic event is
            // dropped here too (g_hangout_mode's recorded-cuts list).
            if (r == .broken and (dest_ptr.flags & 1) != 0 and !g_hangout_mode) {
                var ex_p: u32 = 0;
                while (ex_p < state.player_count) : (ex_p += 1) {
                    if (!state.players[ex_p].flags.alive) continue;
                    if (proj_ptr.flags.has_owner and
                        state.players[ex_p].id_len == proj_ptr.owner_id_len and
                        std.mem.eql(u8, state.players[ex_p].id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
                    {
                        continue;
                    }
                    if (destructible.playerInBlastRadius(
                        dest_ptr.x,
                        dest_ptr.y,
                        destructible.EXPLOSION_RADIUS,
                        state.players[ex_p].x,
                        state.players[ex_p].y,
                        15.0, // PLAYER_HALF_W
                    )) {
                        // Shield-first absorption (I39).
                        var aoe_dmg = destructible.EXPLOSION_DAMAGE;
                        const ape = &state.players[ex_p];
                        if (ape.flags.shield_active and
                            ape.flags.has_shield_charge and
                            ape.shield_charge > 0)
                        {
                            ape.shield_charge -= aoe_dmg;
                            if (ape.shield_charge <= 0) {
                                const overflow = -ape.shield_charge;
                                ape.shield_charge = 0;
                                ape.flags.shield_active = false;
                                emitEvent(state, .shield_popped, @intCast(ex_p), -1, dest_ptr.id, 0, ape.x, ape.y);
                                aoe_dmg = overflow;
                            } else {
                                aoe_dmg = 0;
                            }
                        }
                        if (aoe_dmg > 0) {
                            ape.health -= aoe_dmg;
                            // Parity with World.ts: blast damage emits
                            // hit_confirmed (no attacker on the TS
                            // destructible path either) — feeds the
                            // emission-charge fill (step 10).
                            emitEvent(state, .hit_confirmed, @intCast(ex_p), -1, dest_ptr.id, aoe_dmg, ape.x, ape.y);
                            if (ape.health <= 0) {
                                ape.health = 0;
                                ape.flags.alive = false;
                                // Kill attribution (2026-07-17): the blast
                                // is credited to the triggering projectile's
                                // owner (parity with World.ts / destructible
                                // .ts attackerId). Owner is excluded from
                                // the AOE loop above, so never a self-kill.
                                const blast_idx: i32 = if (proj_ptr.flags.has_owner)
                                    playerIdxById(
                                        state,
                                        proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len],
                                    )
                                else
                                    -1;
                                creditKill(state, blast_idx, @intCast(ex_p));
                                emitEvent(state, .player_killed, @intCast(ex_p), blast_idx, dest_ptr.id, 0, ape.x, ape.y);
                            }
                        }
                    }
                }
            }
            break;
        }
        if (proj_ptr.lifetime_ms <= 0) continue;
        // Paper Double overlap (2026-07-20 gap-closure pass item 3 —
        // parity port of paperDouble.ts's `stepPaperDoubles` projectile
        // loop, ported from its CURRENT swept form — paperDouble.ts:
        // 119-166, fixed 2026-07-20 for a tunneling bug where a fast
        // (700+ px/s) shard could pass through a decoy at an unlucky
        // position with zero damage on a discrete point-in-time check.
        // `prevX/prevY` aren't stored on ProjectileEntity, so (matching
        // the TS fix exactly) they're reconstructed from the projectile's
        // OWN velocity — exact for straight pathing, a close approximation
        // for curved. Same "one projectile, one impact" shape as the
        // destructible loop above: the first LIVE decoy (array order) a
        // projectile overlaps consumes it and the projectile stops
        // checking further decoys. Owner-exclusion mirrors fire.ts's own
        // precedent — a caster's own shot never pops their own decoy.
        var pdi2: u32 = 0;
        while (pdi2 < state.paper_double_count) : (pdi2 += 1) {
            const pd_ptr = &state.paper_doubles[pdi2];
            if (pd_ptr.health <= 0 or pd_ptr.remaining_ms <= 0) continue;
            if (proj_ptr.flags.has_owner and
                pd_ptr.owner_id_len == proj_ptr.owner_id_len and
                std.mem.eql(u8, pd_ptr.owner_id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
            {
                continue;
            }
            const target_aabb: collision_types.AABB = .{
                .x = pd_ptr.x - PAPER_DOUBLE_BODY_HALF_W,
                .y = pd_ptr.y - PAPER_DOUBLE_BODY_HALF_H,
                .w = PAPER_DOUBLE_BODY_HALF_W * 2.0,
                .h = PAPER_DOUBLE_BODY_HALF_H * 2.0,
            };
            var hit = collision_types.circleOverlapsAABB(
                proj_ptr.x,
                proj_ptr.y,
                proj_ptr.radius,
                target_aabb,
            );
            if (!hit) {
                const dt_sec = eff_dt / 1000.0;
                const prev_x = proj_ptr.x - proj_ptr.vx * dt_sec;
                const prev_y = proj_ptr.y - proj_ptr.vy * dt_sec;
                const mover_prev: collision_types.AABB = .{
                    .x = prev_x - proj_ptr.radius,
                    .y = prev_y - proj_ptr.radius,
                    .w = proj_ptr.radius * 2.0,
                    .h = proj_ptr.radius * 2.0,
                };
                var sweep_hit: collision_types.SweepHit = undefined;
                hit = collision_types.sweepAABB(
                    mover_prev,
                    proj_ptr.vx,
                    proj_ptr.vy,
                    dt_sec,
                    &.{target_aabb},
                    &sweep_hit,
                );
            }
            if (!hit) continue;
            pd_ptr.health = @max(0.0, pd_ptr.health - proj_ptr.damage);
            proj_ptr.lifetime_ms = 0;
            break;
        }
        if (proj_ptr.lifetime_ms <= 0) continue;
        // Player overlap: circle vs AABB. Hangout ghosting (World.ts:6770
        // `projectilePlayerIds = hangoutMode ? [] : ...`): projectiles get
        // ZERO player hit candidates in the lobby — they pass straight
        // through avatars and only ever connect with destructibles/decoys/
        // terrain (the loops above). Empty-range start makes every
        // projectile-vs-player damage path structurally unreachable.
        var ph2: u32 = if (g_hangout_mode) state.player_count else 0;
        while (ph2 < state.player_count) : (ph2 += 1) {
            if (!state.players[ph2].flags.alive) continue;
            // Skip owner.
            if (proj_ptr.flags.has_owner and
                state.players[ph2].id_len == proj_ptr.owner_id_len and
                std.mem.eql(u8, state.players[ph2].id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
            {
                continue;
            }
            const px = state.players[ph2].x;
            const py = state.players[ph2].y;
            // Class-scaled combat box (Track Z1a item 2 — parity with TS,
            // whose projectile path reads the class-scaled playerHitboxAABB
            // since cohesion P1.4). The 30×56 BASE box is a pre-existing
            // approximation of TS's real 26×56 (see combat.zig's
            // MELEE_BODY_* doc comment) — deliberately untouched here; this
            // mirrors the SCALING only, the same multiplier TS applies.
            const hit_scale = combat.combatHitboxScale(state.players[ph2].character_id);
            const half_w: f64 = 15.0 * hit_scale;
            const half_h: f64 = 28.0 * hit_scale;
            const closest_x = @max(px - half_w, @min(proj_ptr.x, px + half_w));
            const closest_y = @max(py - half_h, @min(proj_ptr.y, py + half_h));
            const dx = proj_ptr.x - closest_x;
            const dy = proj_ptr.y - closest_y;
            if (dx * dx + dy * dy <= proj_ptr.radius * proj_ptr.radius) {
                // Headshot (Track Z1c item 1 — closes combatHitboxScale-
                // Parity.test.ts's residual #2): mirrors projectile.ts's
                // `applyHitOn`, which bakes HEADSHOT_DAMAGE_MULTIPLIER into
                // the event's damage BEFORE any of resolveRangedHit's own
                // scaling (chaos included) — same ordering here: the
                // headshot multiplier applies to the RAW `proj_ptr.damage`
                // first, then chaos, matching TS's `(proj.damage *
                // HEADSHOT_DAMAGE_MULTIPLIER) * chaosProfile.
                // damageMultiplier` bit for bit. `proj_ptr.y` is the
                // projectile's post-integration position THIS tick — TS's
                // own `hitY` param is exactly that (`applyHitOn(proj,
                // hitPid, x, y, ...)` passes the post-move `x, y`, not a
                // true swept-intersection point), so no separate sweep-hit
                // Y is needed here. Uses THIS site's own `half_h` (not
                // `combat.playerHitboxAabb`) — see `isHeadshotAtHalfHeight`'s
                // own doc comment for why the head band must stay
                // self-consistent with the (non-crouch-aware) box that
                // just confirmed the hit, not the real crouch-aware one.
                const headshot = combat.isHeadshotAtHalfHeight(proj_ptr.y, py, half_h);
                const headshot_dmg: f64 = if (headshot) proj_ptr.damage * combat.HEADSHOT_DAMAGE_MULTIPLIER else proj_ptr.damage;
                // Compose damage multipliers (I36):
                //   headshot × chaos × shooter damage_amp × victim vulnerability
                var final_dmg = headshot_dmg * chaos_profile.damage_multiplier;
                // Shooter lookup by owner_id_bytes — feeds the damage_amp/
                // overcharge/boss buffs below AND is stamped into the
                // hit_confirmed event's player_idx_b so the end-of-step
                // emission-charge fill can credit the attacker (mirrors
                // World.ts's hit-confirmed attackerId — see step 10 below).
                var shooter_idx: i32 = -1;
                if (proj_ptr.flags.has_owner) {
                    var sj: u32 = 0;
                    while (sj < state.player_count) : (sj += 1) {
                        if (state.players[sj].id_len == proj_ptr.owner_id_len and
                            std.mem.eql(u8, state.players[sj].id_bytes[0..proj_ptr.owner_id_len], proj_ptr.owner_id_bytes[0..proj_ptr.owner_id_len]))
                        {
                            shooter_idx = @intCast(sj);
                            break;
                        }
                    }
                    if (shooter_idx >= 0) {
                        const sp = &state.players[@intCast(shooter_idx)];
                        if (sp.flags.has_damage_amp and
                            sp.damage_amp_until_tick > state.header.tick)
                        {
                            final_dmg *= 2.0;
                        }
                        if (sp.flags.has_overcharge and
                            sp.overcharge_until_tick > state.header.tick)
                        {
                            final_dmg *= 1.5;
                        }
                        if (sp.flags.has_boss_mode and
                            sp.boss_mode_until_tick > state.header.tick)
                        {
                            final_dmg *= 2.0;
                        }
                        // Facet Break (Wizard) / Focus Hex (Priest) — Phase
                        // 4b, docs/zig-step-world-parity-goal.md. Mark
                        // lives on the SHOOTER (`sp`, not the victim); a
                        // landed ranged hit against the exact marked
                        // victim is amplified. Same "until_tick check
                        // first" short-circuit shape `stepMeleeSwing`'s own
                        // Judgment Line/Read Mark checks already use — at
                        // tick 0 (mark never cast) `until_tick(0) >
                        // tick(0)` is false, so this never vacuously
                        // matches two players who both still have
                        // zero-length ids (the exact hazard Read Mark's
                        // own smoke-test comment documents for the
                        // owner-skip check above). Mirrors World.ts's
                        // `resolveRangedHit` (facetTargetId/
                        // focusHexTargetId checks, right after the Radiant
                        // status-amp) — this is the generic ranged-hit
                        // site, so (matching TS) the amp applies to ANY
                        // ranged hit from the marking player, not just an
                        // ability projectile.
                        if (sp.facet_mark_until_tick > state.header.tick and
                            sp.facet_target_id_len == state.players[ph2].id_len and
                            std.mem.eql(u8, sp.facet_target_id_bytes[0..sp.facet_target_id_len], state.players[ph2].id_bytes[0..state.players[ph2].id_len]))
                        {
                            final_dmg *= GEO_FACET_BREAK_AMP_MULTIPLIER;
                        }
                        if (sp.focus_hex_mark_until_tick > state.header.tick and
                            sp.focus_hex_target_id_len == state.players[ph2].id_len and
                            std.mem.eql(u8, sp.focus_hex_target_id_bytes[0..sp.focus_hex_target_id_len], state.players[ph2].id_bytes[0..state.players[ph2].id_len]))
                        {
                            final_dmg *= SYZ_FOCUS_HEX_AMP_MULTIPLIER;
                        }
                        // Rally Light (Track Z1a item 3) — attacker-side
                        // amp, port of World.ts:1844's `finalDamage *=
                        // rallyLightDamageMultiplier(attackerEntity, ...)`
                        // in resolveRangedHit (the shared ranged resolver;
                        // this projectile loop is its Zig mirror — hitscan
                        // stays unported, its own Z1 item). Ordered BEFORE
                        // Kindled Resolve, matching TS's :1844/:1845 pair.
                        if (hasRallyLightSource(state, @intCast(shooter_idx), state.header.tick)) {
                            final_dmg *= KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER;
                        }
                        // Kindled Resolve (Paladin, Phase 4a follow-up) —
                        // attacker-side amp, same shooter-buff composition
                        // shape as damage_amp/overcharge/boss_mode above.
                        // TS's own site (World.ts:1815,
                        // `finalDamage *= kindledResolveDamageMultiplier(...)`)
                        // is post-mitigation, not pre- like this block —
                        // this port stays consistent with the PRE-EXISTING
                        // Zig composition order Facet Break/Focus Hex
                        // already established at this exact site (pre-
                        // mitigation), not a new divergence this pass
                        // introduces.
                        if (sp.kindled_resolve_until_tick > state.header.tick) {
                            final_dmg *= KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER;
                        }
                    }
                }
                // Victim buff: vulnerability multiplies incoming
                // damage (default 1.5×).
                if (state.players[ph2].flags.has_vulnerability and
                    state.players[ph2].vulnerability_until_tick > state.header.tick)
                {
                    final_dmg *= 1.5;
                }
                // Hard Aperture (Wizard) — ward shell: halves incoming
                // damage BEFORE parry/shield mitigation, matching
                // World.ts's `resolveRangedHit` positioning (computed into
                // `intoMitigation` ahead of its own `tryDeflectDamage`
                // call). See `EMISSION_WARD_DAMAGE_MULT`'s own doc comment
                // above for why this site (ranged only) is correct and
                // melee/AOE correctly do NOT get an equivalent term.
                if (state.players[ph2].ward_shell_until_tick > state.header.tick) {
                    final_dmg *= EMISSION_WARD_DAMAGE_MULT;
                }
                // Ninja dash i-frames (Track Z1c "ninja dash i-frames" item)
                // — checked AHEAD of Ghost Guard, matching combat.ts's
                // tryDeflectDamage step 0.5 (ahead of step 0.6). Same
                // "consumed, zero damage, no event" shape Ghost Guard's own
                // evasion immediately below already establishes.
                if (isNinjaEvading(state, ph2)) {
                    // Split-eligible consumption (Track E1): TS's split
                    // happens INSIDE stepProjectile at body contact
                    // (projectile.ts:513), BEFORE resolveRangedHit's
                    // mitigation — an evaded hit still fans children in
                    // TS (the suppressed event only skips damage,
                    // World.ts:6854 inserts `result.spawned` regardless).
                    if (splitEligibleOnPlayerHit(proj_ptr)) {
                        queueSplitDeath(pi2, proj_ptr, projectile_lifetime_pre_step[pi2]);
                    }
                    proj_ptr.lifetime_ms = 0;
                    break;
                }
                // Ghost Guard (Ninja, this pass) — banked evasion charge,
                // checked ahead of parry/Self-Lattice/shield below, matching
                // combat.ts's tryDeflectDamage step 0.6 ordering exactly
                // (see stepMeleeSwing's own consumption site for the full
                // "why this doesn't need the dashing substrate" citation).
                // Full evasion: zero damage, no event, the shard is still
                // CONSUMED by this hit resolution (TS's own "doesn't
                // visually pass through the dodging body" v1 simplification)
                // — same `lifetime_ms = 0` + `break` shape the generic
                // full-shield-block branch below already uses.
                if (state.players[ph2].character_id == .sprinter and
                    state.players[ph2].ghost_guard_charge_until_tick > state.header.tick and
                    @sqrt(state.players[ph2].vx * state.players[ph2].vx + state.players[ph2].vy * state.players[ph2].vy) > combat.NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD)
                {
                    state.players[ph2].ghost_guard_charge_until_tick = 0;
                    // Same TS-splits-before-mitigation reasoning as the
                    // i-frames hook above (Track E1).
                    if (splitEligibleOnPlayerHit(proj_ptr)) {
                        queueSplitDeath(pi2, proj_ptr, projectile_lifetime_pre_step[pi2]);
                    }
                    proj_ptr.lifetime_ms = 0;
                    break;
                }
                // Victim's resolved card build (parry cover, directional +
                // mirror shield) — parity with TS tryDeflectDamage.
                const vcfg = &state.player_fire_config[ph2];
                // Parry deflect: active parry window AND the shard's source
                // direction lies within the parry arc (widened by cover mult).
                const parry_arc = combat.PARRY_ARC_RADIANS *
                    (if (vcfg.valid != 0) vcfg.parry_cover_mul else 1.0);
                if (combat.isParryActive(&state.players[ph2], state.header.tick) and
                    combat.isHitInArc(
                        state.players[ph2].x,
                        state.players[ph2].y,
                        state.players[ph2].parry_facing,
                        proj_ptr.x,
                        proj_ptr.y,
                        proj_ptr.vx,
                        proj_ptr.vy,
                        parry_arc,
                    ))
                {
                    emitEvent(
                        state,
                        .parry_deflected,
                        @intCast(ph2),
                        -1,
                        proj_ptr.id,
                        0,
                        state.players[ph2].x,
                        state.players[ph2].y,
                    );
                    // Split at the contact (Track E1): in TS the shard's
                    // own stepProjectile already consumed the hit and
                    // fanned children (projectile.ts:513) before the
                    // deflect override re-inserted the reflected shard
                    // under the same id (World.ts:6867-6879) — a parried
                    // split shard BOTH splits AND reflects. Queue the
                    // snapshot NOW, before the velocity flip below, so
                    // the fan takes the incoming direction like TS's.
                    if (splitEligibleOnPlayerHit(proj_ptr)) {
                        queueSplitDeath(pi2, proj_ptr, projectile_lifetime_pre_step[pi2]);
                    }
                    // REFLECTIVE parry (mirrors client/src/sim/World.ts): rather
                    // than dropping the shard, send it back — now OWNED by the
                    // parrier so it can strike the attacker. Travel/age reset so
                    // it doesn't instantly expire on range/lifetime.
                    proj_ptr.vx = -proj_ptr.vx * 1.15;
                    proj_ptr.vy = -proj_ptr.vy * 1.15;
                    proj_ptr.age_ms = 0;
                    proj_ptr.traveled_px = 0;
                    proj_ptr.origin_x = proj_ptr.x;
                    proj_ptr.origin_y = proj_ptr.y;
                    proj_ptr.flags.has_owner = true;
                    const parrier_len = state.players[ph2].id_len;
                    proj_ptr.owner_id_len = parrier_len;
                    @memcpy(
                        proj_ptr.owner_id_bytes[0..parrier_len],
                        state.players[ph2].id_bytes[0..parrier_len],
                    );
                    break;
                }
                // Self-Lattice (Priest) — Syzygist Ward's flat absorb pool.
                // Checked BEFORE the generic shield step and MUTUALLY
                // EXCLUSIVE with it — matches combat.ts's `trySyzygistWard`,
                // which returns from `tryDeflectDamage` immediately when a
                // live pool exists (even a fully-drained-to-zero-remaining
                // partial block), never falling through to the generic
                // shield/Kindled-Ward branch that same call would otherwise
                // reach. No facing/aim check (cast-and-forget, unlike
                // parry/directional shield above). Reduces `final_dmg`
                // rather than fully suppressing the hit — a partial absorb
                // still lands as a (smaller) real hit, matching TS's
                // `damage: damage - blocked` (never a hard 0-or-nothing
                // block the way the generic shield step is).
                var syz_ward_consumed = false;
                if (state.players[ph2].syz_ward_absorb_until_tick > state.header.tick and
                    state.players[ph2].syz_ward_absorb_remaining > 0)
                {
                    syz_ward_consumed = true;
                    const blocked = @min(final_dmg, state.players[ph2].syz_ward_absorb_remaining);
                    state.players[ph2].syz_ward_absorb_remaining -= blocked;
                    final_dmg -= blocked;
                    if (state.players[ph2].syz_ward_absorb_remaining <= 0) {
                        state.players[ph2].syz_ward_absorb_remaining = 0;
                        state.players[ph2].syz_ward_absorb_until_tick = 0;
                    }
                }
                // Shield pop: if the player's shield is active
                // and absorbs the hit, drop a shield_popped
                // event (and tap the shield charge — full
                // mitigation handled in a follow-on cut once
                // shield-vs-direct-damage is wired into the
                // model).
                var kindled_warded = false;
                shield_block: {
                    if (syz_ward_consumed) break :shield_block;
                    if (!(state.players[ph2].flags.shield_active and
                        state.players[ph2].flags.has_shield_charge and
                        state.players[ph2].shield_charge > 0)) break :shield_block;
                    // Kindled Ward (Paladin) — REPLACES the generic
                    // mitigation below entirely for this class (Track Z1c
                    // "Kindled Ward partial mitigation" item), matching
                    // combat.ts's `tryDeflectDamage` exactly: partial (60%)
                    // if the source (the LIVE projectile position, unlike
                    // hitscan's muzzle-origin proxy) is in the player's own
                    // frontal cone, full damage with NO charge drain if
                    // not. `kindled_warded` gates team peel below (TS:
                    // `if (!mitigation.warded)`).
                    if (state.players[ph2].character_id == .heavy) {
                        const vp = &state.players[ph2];
                        const dx_aim = vp.aim_x - vp.x;
                        const dy_aim = vp.aim_y - vp.y;
                        const facing = if (dx_aim == 0.0 and dy_aim == 0.0) 0.0 else trig.lutAtan2(dy_aim, dx_aim);
                        const in_cone = combat.isSourceInWardCone(vp.x, vp.y, facing, proj_ptr.x, proj_ptr.y);
                        const mit = combat.computeKindledWardMitigation(final_dmg, in_cone);
                        if (mit.applies) {
                            vp.kindling = @min(KINDLING_MAX, vp.kindling + mit.kindling_granted);
                            kindled_warded = true;
                        }
                        final_dmg = mit.damage;
                        break :shield_block; // no charge drain either way — fall through below.
                    }
                    // Ninja/Interstice — LOCKED doctrine: shield never
                    // mitigates (dash i-frames are Ninja's only defense
                    // verb). Fall straight through, byte-identical to
                    // shield_active===false.
                    if (state.players[ph2].character_id == .sprinter) break :shield_block;
                    // Aim shield: only blocks hits arriving within the aim cone;
                    // flank/back shots pass through to damage below.
                    if (vcfg.valid != 0 and vcfg.directional_shield != 0) {
                        const vp = &state.players[ph2];
                        const adx = vp.aim_x - vp.x;
                        const ady = vp.aim_y - vp.y;
                        const aim_facing = if (adx == 0.0 and ady == 0.0)
                            0.0
                        else
                            trig.lutAtan2(ady, adx);
                        if (!combat.isHitInArc(vp.x, vp.y, aim_facing, proj_ptr.x, proj_ptr.y, proj_ptr.vx, proj_ptr.vy, combat.SHIELD_AIM_ARC_RADIANS))
                            break :shield_block; // not covered → take the hit
                    }
                    state.players[ph2].shield_charge -=
                        final_dmg * combat.SHIELD_HIT_DRAIN_MULTIPLIER;
                    if (state.players[ph2].shield_charge <= 0) {
                        state.players[ph2].shield_charge = 0;
                        state.players[ph2].flags.shield_active = false;
                        emitEvent(
                            state,
                            .shield_popped,
                            @intCast(ph2),
                            -1,
                            proj_ptr.id,
                            0,
                            state.players[ph2].x,
                            state.players[ph2].y,
                        );
                    }
                    // Split at the contact (Track E1) — same reasoning as
                    // the parry hook above; TS splits on a shielded hit
                    // whether the shard is then mirrored back or dropped,
                    // and the fan must take the PRE-reflect velocity.
                    if (splitEligibleOnPlayerHit(proj_ptr)) {
                        queueSplitDeath(pi2, proj_ptr, projectile_lifetime_pre_step[pi2]);
                    }
                    // Mirror shield: bounce the shard back at the attacker
                    // (owned by the blocker) instead of expiring it.
                    if (vcfg.valid != 0 and vcfg.mirror_shield != 0) {
                        proj_ptr.vx = -proj_ptr.vx * 1.15;
                        proj_ptr.vy = -proj_ptr.vy * 1.15;
                        proj_ptr.age_ms = 0;
                        proj_ptr.traveled_px = 0;
                        proj_ptr.origin_x = proj_ptr.x;
                        proj_ptr.origin_y = proj_ptr.y;
                        proj_ptr.flags.has_owner = true;
                        const rlen = state.players[ph2].id_len;
                        proj_ptr.owner_id_len = rlen;
                        @memcpy(
                            proj_ptr.owner_id_bytes[0..rlen],
                            state.players[ph2].id_bytes[0..rlen],
                        );
                    } else {
                        proj_ptr.lifetime_ms = 0;
                    }
                    break;
                }
                // Team peel (Track Z1c "team peel" item): extends a nearby
                // warding Paladin ally's Ward to cover this hit, same gate
                // as every other TS damage-resolution site. Gated on
                // `!kindled_warded` (Track Z1c "Kindled Ward partial
                // mitigation" item) — TS: `if (!mitigation.warded)`.
                // Ordered right before the health write, matching
                // World.ts's `resolveRangedHit` (team peel is its last
                // mitigation step before `ev.damage = finalDamage`).
                if (!kindled_warded) {
                    final_dmg = applyTeamPeel(state, ph2, final_dmg, state.header.tick);
                }
                // First-blood wager (Track Z0d): claimed by the round's
                // first attacker-attributed hit that reaches the damage
                // site — the parry/shield/i-frame branches above all
                // `break`/`continue` before here, mirroring TS's
                // "suppressed hits never reach the check" shape
                // (resolveRangedHit's own early returns).
                maybeAwardFirstBlood(state, shooter_idx, @intCast(ph2), is_fighting);
                state.players[ph2].health -= final_dmg;
                emitEvent(
                    state,
                    .hit_confirmed,
                    @intCast(ph2),
                    shooter_idx,
                    proj_ptr.id,
                    final_dmg,
                    state.players[ph2].x,
                    state.players[ph2].y,
                );
                if (state.players[ph2].health <= 0) {
                    state.players[ph2].health = 0;
                    state.players[ph2].flags.alive = false;
                    // Kill attribution (2026-07-17): shooter_idx is the
                    // projectile owner's index (-1 when unowned) — credit
                    // the tally + stamp player_idx_b (parity with
                    // World.ts's killerId: proj.ownerId).
                    creditKill(state, shooter_idx, @intCast(ph2));
                    emitEvent(
                        state,
                        .player_killed,
                        @intCast(ph2),
                        shooter_idx,
                        proj_ptr.id,
                        0,
                        state.players[ph2].x,
                        state.players[ph2].y,
                    );
                }
                // Element on-hit effects (parity with World.ts phase 6d).
                switch (proj_ptr.element) {
                    .fire => {
                        // Bleed Tithe (Priest, this pass) — TS's own
                        // `element === "fire"` burn-on-hit branch
                        // (World.ts:1882-1892): `burnDps = finalDamage *
                        // 0.4`, duration capped at EMISSION_BURN_CAP_MS
                        // (see that constant's own doc comment for why the
                        // `statusScale` term is skipped, not just
                        // forgotten). Writes the SAME `has_burn`/
                        // `burn_until_tick`/`burn_dps`/
                        // `burn_tick_last_applied` fields section 8b's
                        // burn-DoT tick already reads every tick, and
                        // Contagion's own already-shipped burn-COPY (a
                        // separate `.contagion` ability-dispatch arm,
                        // Phase 4e) already proved those 4 fields are real
                        // Zig-side readers, just never written from a
                        // fresh ON-HIT source before this pass — this is
                        // that missing WRITE side.
                        const burn_ticks: u32 = @intFromFloat(@ceil(EMISSION_BURN_CAP_MS / @max(1.0, eff_dt)));
                        state.players[ph2].flags.has_burn = true;
                        state.players[ph2].burn_until_tick = state.header.tick + burn_ticks;
                        state.players[ph2].burn_dps = final_dmg * 0.4;
                        state.players[ph2].burn_tick_last_applied = state.header.tick;
                    },
                    .ice => {
                        // 1-second freeze at 0.5x movement (tick-quantized).
                        const freeze_ticks: u32 = @intFromFloat(@ceil(1000.0 / @max(1.0, eff_dt)));
                        state.players[ph2].flags.has_freeze = true;
                        state.players[ph2].freeze_until_tick = state.header.tick + freeze_ticks;
                        state.players[ph2].freeze_multiplier = 0.5;
                    },
                    .lightning, .electric => {
                        // Chain HALF damage to the nearest OTHER alive player
                        // within 220px — a derived secondary hit.
                        const chain_dmg = final_dmg * 0.5;
                        const hx = state.players[ph2].x;
                        const hy = state.players[ph2].y;
                        var best: i32 = -1;
                        var best_d2: f64 = 220.0 * 220.0;
                        var ci: u32 = 0;
                        while (ci < state.player_count) : (ci += 1) {
                            if (ci == ph2 or !state.players[ci].flags.alive) continue;
                            const cdx = state.players[ci].x - hx;
                            const cdy = state.players[ci].y - hy;
                            const d2 = cdx * cdx + cdy * cdy;
                            if (d2 <= best_d2) {
                                best_d2 = d2;
                                best = @intCast(ci);
                            }
                        }
                        if (best >= 0) {
                            const cb: u32 = @intCast(best);
                            // First-blood (Track Z0d): the chain's
                            // secondary hit runs the same claim TS's
                            // resolveRangedHit re-entry does. In practice
                            // the triggering hit above already claimed it
                            // this tick (same owner) — kept for exact
                            // TS structural parity, not reachability.
                            maybeAwardFirstBlood(state, shooter_idx, best, is_fighting);
                            state.players[cb].health -= chain_dmg;
                            emitEvent(state, .hit_confirmed, best, shooter_idx, proj_ptr.id, chain_dmg, state.players[cb].x, state.players[cb].y);
                            if (state.players[cb].health <= 0) {
                                state.players[cb].health = 0;
                                state.players[cb].flags.alive = false;
                                // Kill attribution (2026-07-17): chain kills
                                // credit the projectile owner (parity with
                                // World.ts's chain-lightning killerId).
                                creditKill(state, shooter_idx, best);
                                emitEvent(state, .player_killed, best, shooter_idx, proj_ptr.id, 0, state.players[cb].x, state.players[cb].y);
                            }
                        }
                    },
                    else => {},
                }
                // Drain axis (Bleed Tithe + the passive Tithe build-leech,
                // Track Z1c "six-axes axis payloads" — six-axes-goal.md
                // Layer 1): a leech-flagged shard heals its owner a
                // fraction of the post-mitigation damage that just landed.
                // Independent of element (TS's own `leechFrac = proj.
                // leechFraction ?? 0` check has no element gate either —
                // it happens to only ever be nonzero on the fire-element
                // Bleed Tithe shard or a passive-Tithe basic-fire shot
                // today, but the mechanic itself is general), so this lives
                // OUTSIDE the switch above rather than inside the `.fire`
                // arm — matches World.ts's own relative ordering (leech
                // runs right after the burn/freeze write, independent of
                // which one fired). Self-damage never leeches (owner-index
                // guard, mirrors TS's `proj.ownerId !== ev.victimId`) —
                // `shooter_idx` is already resolved above (the owner lookup
                // that also feeds damage_amp/overcharge/boss-mode). Cap
                // mirrors World.ts's CURRENT `Math.min(Math.max(
                // maxHealthForPlayer(leechCaster), leechCaster.health),
                // leechCaster.health + finalDamage * leechFrac)` (World.ts:
                // 2077-2084, 2026-07-22 bug fix) — never reduces (a boss-
                // mode body above max is safe) and never overheals past the
                // CHASSIS-AWARE max health (`maxHealthForPlayer`), NOT a
                // flat 100 (the pre-fix formula this replaces silently
                // capped a Kindled leecher's heal well under their real 125,
                // and — now that a build-resolved leech can co-occur with a
                // build-resolved `maxHealthAdd` card on ANY class, including
                // Priest's own 100 base — a flat 100 cap would ALSO clip a
                // Priest wearing a max-health card, not just heavy chassis).
                if (proj_ptr.leech_fraction > 0 and shooter_idx >= 0 and @as(u32, @intCast(shooter_idx)) != ph2) {
                    const healer_idx: usize = @intCast(shooter_idx);
                    const healer = &state.players[healer_idx];
                    if (healer.flags.alive) {
                        const cap = maxHealthForPlayer(healer, &state.player_fire_config[healer_idx]);
                        healer.health = @min(@max(cap, healer.health), healer.health + final_dmg * proj_ptr.leech_fraction);
                    }
                }
                // Pierce-chain: decrement and survive; otherwise
                // sticky → linger then detonate, others → expire.
                if (proj_ptr.impact == .pierce_chain and
                    proj_ptr.pierce_remaining > 0)
                {
                    proj_ptr.pierce_remaining -= 1;
                    continue;
                }
                if (proj_ptr.impact == .sticky) {
                    proj_ptr.sticky_fuse_ms = projectile.STICKY_FUSE_MS;
                    proj_ptr.flags.has_sticky_fuse = true;
                    // Freeze in place (Track E1) — TS's stuck literal sets
                    // vx/vy to 0 (projectile.ts:470-471). Matters for the
                    // fuse-end split: a zero-velocity parent takes the
                    // speed==0 fan (baseAngle 0, child speed floor 180),
                    // which is exactly TS's sticky fuse-end shape.
                    proj_ptr.vx = 0;
                    proj_ptr.vy = 0;
                    proj_ptr.lifetime_ms = @max(
                        proj_ptr.lifetime_ms,
                        projectile.STICKY_FUSE_MS + eff_dt,
                    );
                } else {
                    if (proj_ptr.impact == .slow_field) {
                        // Slow-field impact (I27): apply slow
                        // debuff to the hit player. Default
                        // duration 1500ms + multiplier 0.5
                        // unless the projectile carries an
                        // override.
                        const slow_dur: f64 = 1500.0;
                        const slow_dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                        const slow_ticks: u32 = @intFromFloat(@ceil(slow_dur / slow_dt));
                        state.players[ph2].slowed_until_tick =
                            state.header.tick + slow_ticks;
                        state.players[ph2].slow_multiplier =
                            if (proj_ptr.flags.has_slow) proj_ptr.slow_multiplier else 0.5;
                        state.players[ph2].flags.has_slow = true;
                        emitEvent(
                            state,
                            .none, // no dedicated kind yet
                            @intCast(ph2),
                            -1,
                            proj_ptr.id,
                            slow_dur,
                            state.players[ph2].x,
                            state.players[ph2].y,
                        );
                    }
                    // Generic hit consumption — TS's projectile.ts:513
                    // split site (Track E1). No eligibility guard needed
                    // here: the sticky arm above and the pierce-survive
                    // branch further up already diverted, mirroring TS's
                    // own ordering (sticky :458, pierce :495, split :513).
                    queueSplitDeath(pi2, proj_ptr, projectile_lifetime_pre_step[pi2]);
                    proj_ptr.lifetime_ms = 0;
                }
                break;
            }
        }
    }

    // 4s. Split-child materialisation (Track E item E1 — the split-spawn
    //     orchestrator; see the section comment above `queueSplitDeath`
    //     for the full design). One ordered pass over the slots sections
    //     3/4 marked: compute each parent's fan via
    //     `projectileSplitVelocities` (bit-exact vs TS `spawnSplit`,
    //     threading `header.rng_state` in ascending slot order — TS
    //     consumes its persisted rng cursor in exactly this order, one
    //     parent at a time, World.ts:6785-6858) and insert the children
    //     with the same field inheritance TS's SpawnedChild spec carries
    //     (projectile.ts:922-955). Children join `state.projectiles`
    //     NOW — after all hit resolution, before compaction — so like
    //     TS's `remainingProjectiles` inserts they exist in the end-of-
    //     tick state but neither move nor collide until next tick.
    {
        // Bound at the PRE-pass count: insertions below grow
        // `projectile_count`, and slots >= the section-3 count were
        // never cleared this tick — walking into them would read stale
        // valid flags from an earlier, larger tick.
        const split_scan_count = state.projectile_count;
        var spi: u32 = 0;
        while (spi < split_scan_count) : (spi += 1) {
            if (!pending_split_valid[spi]) continue;
            pending_split_valid[spi] = false;
            const parent = &pending_split_parents[spi];
            // Always offer the FULL SPLIT_MAX buffer: the fan fn advances
            // rng once per EMITTED child, and TS (which has no world
            // capacity cap at all) always emits min(splitCount, 8) —
            // a smaller buffer here would desync the rng stream.
            var fan: [projectile.SPLIT_MAX]projectile.SplitVelocity = undefined;
            const fan_res = projectile.projectileSplitVelocities(
                parent,
                state.header.rng_state,
                fan[0..],
            );
            state.header.rng_state = fan_res.rng_state;
            // Child field inheritance — mirrors spawnSplit's spec literal
            // (projectile.ts:922-955) field for field. parent.lifetime_ms
            // already carries the TS parent's pre-decrement value (see
            // queueSplitDeath).
            const child_radius = @max(
                projectile.SPLIT_RADIUS_MIN,
                parent.radius * projectile.SPLIT_RADIUS_SCALE,
            );
            const child_damage = parent.damage * projectile.SPLIT_DAMAGE_SCALE;
            const child_lifetime = @max(
                projectile.SPLIT_MIN_LIFETIME_MS,
                parent.lifetime_ms * projectile.SPLIT_LIFETIME_SCALE,
            );
            const child_impact: world_state.ProjectileImpact =
                if (parent.impact == .sticky) .sticky else .none;
            const child_impact_radius =
                (if (parent.flags.has_impact_radius) parent.impact_radius_px else 0.0) *
                projectile.SPLIT_IMPACT_RADIUS_SCALE;
            const child_range: f64 =
                if (parent.flags.has_range) parent.range_px * projectile.SPLIT_RANGE_SCALE else 0.0;
            var ci: u32 = 0;
            while (ci < fan_res.count) : (ci += 1) {
                // Id advances for EVERY computed child (TS allocates one
                // per child unconditionally — it has no capacity cap);
                // only the insertion respects the Zig-side defensive
                // MAX_PROJECTILES cap, same drop-on-full discipline as
                // the other spawn sites.
                const new_id: u32 = state.header.next_entity_id;
                state.header.next_entity_id += 1;
                if (state.projectile_count >= world_state.MAX_PROJECTILES) continue;
                const slot: u32 = state.projectile_count;
                state.projectile_count += 1;
                state.projectiles[slot] = .{
                    .x = parent.x,
                    .y = parent.y,
                    .vx = fan[ci].vx,
                    .vy = fan[ci].vy,
                    .radius = child_radius,
                    .damage = child_damage,
                    .lifetime_ms = child_lifetime,
                    .age_ms = 0,
                    .traveled_px = 0,
                    .origin_x = parent.x,
                    .origin_y = parent.y,
                    .homing_strength = 0,
                    .acceleration_multiplier = 0,
                    .gravity_scale = 0,
                    .range_px = child_range,
                    .slow_multiplier = parent.slow_multiplier,
                    .sticky_fuse_ms = 0,
                    .impact_radius_px = child_impact_radius,
                    .id = new_id,
                    .bounces_remaining = 0,
                    .pierce_remaining = 0,
                    .split_count = 0, // no infinite cascade (TS :944)
                    .flags = .{
                        .has_owner = parent.flags.has_owner,
                        .has_impact = true,
                        .has_split = false,
                        .has_slow = parent.flags.has_slow,
                        .has_homing = false,
                        .has_acceleration = false,
                        .has_gravity_scale = false,
                        .has_range = parent.flags.has_range,
                        .has_age = true,
                        .has_traveled = true,
                        .has_origin = true,
                        .returning = false,
                        .has_sticky_fuse = false,
                        .has_impact_radius = child_impact_radius > 0,
                    },
                    .pathing = .straight, // children never cascade pathing (TS :938)
                    .element = parent.element,
                    .impact = child_impact,
                    .shape = parent.shape,
                    .owner_id_len = parent.owner_id_len,
                    .owner_id_bytes = parent.owner_id_bytes,
                };
            }
        }
    }

    // 6y. Paper Double death/expiry burst detection (parity port of
    //     paperDouble.ts's own `bursts` list feeding World.ts's SECOND,
    //     LATER `resolveInstantAoeCasts` call, World.ts:6113-6115,
    //     "discovered too late in tick order to land in the SAME
    //     pendingInstantAoe batch"). The Z0c Item B reorder made Zig's
    //     shape here IDENTICAL to TS's (the pre-reorder "mirror image /
    //     single drain suffices" note is history): the combat block + the
    //     6b drain now run BEFORE paper-double stepping (2b) and the
    //     projectile-hit pass (4), so a death discovered by this scan
    //     lands in its OWN second drain directly below (the 6y-drain),
    //     exactly like TS — it cannot wait for next tick's 6b, because
    //     section 9's compaction removes the dead double at the end of
    //     THIS tick.
    //
    //     A paper double found here with `health <= 0 or remaining_ms <=
    //     0` is GUARANTEED to have died THIS tick, never a stale prior-tick
    //     entry: section 9's end-of-tick compaction (below) removes every
    //     dead entry before the NEXT tick's section 2b could ever observe
    //     it again — so this single scan can neither double-count a death
    //     nor miss one. Melee-killed decoys are NOT covered here (melee-
    //     vs-Paper-Double damage remains unwired — a real, now more
    //     visible gap now that decoys can exist at all post this pass; see
    //     stepMeleeSwing's own "deliberately NOT ported" list above) — the
    //     two death paths this DOES cover (projectile kill, lifetime
    //     expiry) are exactly the two `stepPaperDoubles`-equivalent paths
    //     already built in commit 6aa0dc9.
    {
        var pdb: u32 = 0;
        while (pdb < state.paper_double_count) : (pdb += 1) {
            const pd = &state.paper_doubles[pdb];
            if (pd.health > 0 and pd.remaining_ms > 0) continue; // still alive
            const owner_idx = playerIdxById(state, pd.owner_id_bytes[0..pd.owner_id_len]);
            if (owner_idx < 0) continue; // owner no longer in the roster — matches resolveInstantAoeCasts's own `if (!caster) continue`
            if (state.pending_instant_aoe_count >= world_state.MAX_PENDING_INSTANT_AOE) continue;
            state.pending_instant_aoe[state.pending_instant_aoe_count] = .{
                .x = pd.x,
                .y = pd.y,
                .radius = NINJA_PAPER_DOUBLE_BURST_RADIUS_PX,
                .damage = NINJA_PAPER_DOUBLE_BURST_DAMAGE,
                .caster_idx = @intCast(owner_idx),
                .has_fooled = 1,
                .fooled_duration_ms = NINJA_FOOLED_DURATION_MS,
            };
            state.pending_instant_aoe_count += 1;
        }
    }

    // 6y-drain. SECOND instant-AOE resolve (Track Z0c Item B) — mirrors
    // World.ts's own second `resolveInstantAoeCasts` call (World.ts:6580),
    // which exists there for exactly the reason it now exists here: Paper
    // Double bursts are discovered AFTER the main drain already ran (the
    // reorder moved section 6b's drain up with the combat block, so 6y's
    // pushes would otherwise sit un-resolved until next tick's drain —
    // and section 9's compaction would have removed the dead doubles by
    // then). Same call shape as 6b's drain above. Hangout: same gate as
    // 6b too — World.ts:7148 (`paperDoubleBursts.length > 0 &&
    // !hangoutMode`) suppresses the burst RESOLUTION only; detection above
    // stays live, and the queue still empties.
    if (state.pending_instant_aoe_count > 0) {
        if (!g_hangout_mode) {
            resolveInstantAoeCasts(
                state,
                state.pending_instant_aoe[0..state.pending_instant_aoe_count],
                state.header.tick,
                eff_dt,
            );
        }
        state.pending_instant_aoe_count = 0;
    }

    // 5. Satellites — orbit advance + fire decision (I8). Owner
    //    lookup walks the players array matching owner_id_bytes;
    //    target lookup picks the closest non-owner alive player.
    var si: u32 = 0;
    while (si < state.satellite_count) : (si += 1) {
        const sat_ptr = &state.satellites[si];
        // Find owner index by id_bytes match.
        var owner_x: f64 = 0;
        var owner_y: f64 = 0;
        var owner_idx: i32 = -1;
        var oj: u32 = 0;
        while (oj < state.player_count) : (oj += 1) {
            if (state.players[oj].id_len == sat_ptr.owner_id_len and
                std.mem.eql(u8, state.players[oj].id_bytes[0..sat_ptr.owner_id_len], sat_ptr.owner_id_bytes[0..sat_ptr.owner_id_len]))
            {
                owner_x = state.players[oj].x;
                owner_y = state.players[oj].y;
                owner_idx = @intCast(oj);
                break;
            }
        }
        // Closest non-owner alive player.
        var target_x: f64 = 0;
        var target_y: f64 = 0;
        var has_target: u8 = 0;
        var best_dist_sq: f64 = std.math.inf(f64);
        var ti: u32 = 0;
        while (ti < state.player_count) : (ti += 1) {
            if (@as(i32, @intCast(ti)) == owner_idx) continue;
            if (!state.players[ti].flags.alive) continue;
            const dx = state.players[ti].x - owner_x;
            const dy = state.players[ti].y - owner_y;
            const d2 = dx * dx + dy * dy;
            if (d2 < best_dist_sq) {
                best_dist_sq = d2;
                target_x = state.players[ti].x;
                target_y = state.players[ti].y;
                has_target = 1;
            }
        }
        const can_fire: u8 = if (state.header.round_phase ==
            @intFromEnum(round.RoundPhase.fighting)) 1 else 0;
        const sat_out = satellite.satelliteTickWorld(
            sat_ptr,
            owner_x,
            owner_y,
            target_x,
            target_y,
            has_target,
            can_fire,
            eff_dt,
        );
        // Satellite projectile spawn (I22). Fire at the position
        // satellite_tick_world reported with the same starter-
        // pistol base stats as I21.
        if (sat_out.wants_fire == 1 and
            state.projectile_count < world_state.MAX_PROJECTILES and
            chaos_profile.disable_projectiles == 0)
        {
            const sat_weapon = weapons_data.weaponBaseById(.starter_pistol);
            const sat_speed = sat_weapon.projectile_speed *
                sat_weapon.projectile_speed_multiplier;
            const slot: u32 = state.projectile_count;
            state.projectile_count += 1;
            const new_id: u32 = state.header.next_entity_id;
            state.header.next_entity_id += 1;
            state.projectiles[slot] = .{
                .x = sat_out.fire_x,
                .y = sat_out.fire_y,
                .vx = trig.lutCos(sat_out.fire_aim_angle) * sat_speed,
                .vy = trig.lutSin(sat_out.fire_aim_angle) * sat_speed,
                .radius = @max(2.0, 7.0 * sat_weapon.projectile_size_multiplier),
                .damage = sat_weapon.damage,
                .lifetime_ms = @max(
                    50.0,
                    sat_weapon.projectile_lifetime_seconds * 1000.0 *
                        sat_weapon.projectile_lifetime_multiplier,
                ),
                .age_ms = 0,
                .traveled_px = 0,
                .origin_x = sat_out.fire_x,
                .origin_y = sat_out.fire_y,
                .homing_strength = 0,
                .acceleration_multiplier = 0,
                .gravity_scale = 0,
                .range_px = sat_weapon.projectile_range_px,
                .slow_multiplier = 1,
                .sticky_fuse_ms = 0,
                .impact_radius_px = 0,
                .id = new_id,
                .bounces_remaining = 0,
                .pierce_remaining = 0,
                .split_count = 0,
                .flags = .{
                    .has_owner = true,
                    .has_impact = false,
                    .has_split = false,
                    .has_slow = false,
                    .has_homing = false,
                    .has_acceleration = false,
                    .has_gravity_scale = false,
                    .has_range = true,
                    .has_age = true,
                    .has_traveled = true,
                    .has_origin = true,
                    .returning = false,
                    .has_sticky_fuse = false,
                    .has_impact_radius = false,
                },
                .pathing = sat_weapon.projectile_pathing,
                .element = sat_weapon.projectile_element,
                .impact = .none,
                .shape = sat_weapon.projectile_shape,
                .owner_id_len = sat_ptr.owner_id_len,
                .owner_id_bytes = sat_ptr.owner_id_bytes,
            };
            emitEvent(
                state,
                .shot_fired,
                -1,
                -1,
                new_id,
                sat_out.fire_aim_angle,
                sat_out.fire_x,
                sat_out.fire_y,
            );
        }
    }

    // 7. Pickups (I13): for each ACTIVE pickup, check overlap
    //    against every alive player. On overlap apply the
    //    pickup's effect (health-shard heals, shield-cell adds
    //    shield_charge, others are flagged for buff durations
    //    handled TS-side until H8e ships) and deactivate the
    //    pickup. Respawn schedule is TS-driven for now.
    var ui: u32 = 0;
    while (ui < state.pickup_count) : (ui += 1) {
        const pickup_ptr = &state.pickups[ui];
        // Respawn check (I26): if inactive but respawn_at_tick is
        // in the past, re-activate. respawn_at_tick == 0 means
        // "no scheduled respawn", so skip.
        if ((pickup_ptr.flags & 1) == 0) {
            if (pickup_ptr.respawn_at_tick > 0 and
                state.header.tick >= pickup_ptr.respawn_at_tick)
            {
                pickup_ptr.flags |= 1;
                pickup_ptr.respawn_at_tick = 0;
            }
            continue;
        }
        var pp: u32 = 0;
        while (pp < state.player_count) : (pp += 1) {
            if (!state.players[pp].flags.alive) continue;
            const dx = state.players[pp].x - pickup_ptr.x;
            const dy = state.players[pp].y - pickup_ptr.y;
            const total_r = pickup_ptr.radius + 18.0; // player half-width
            if (dx * dx + dy * dy <= total_r * total_r) {
                // Apply effect inline. Numeric pickups heal /
                // restore directly; buff pickups set the matching
                // *_until_tick field + flag bit so the player's
                // existing buff machinery picks them up.
                const duration_ms: f64 = if ((pickup_ptr.flags & 2) != 0)
                    pickup_ptr.duration_ms
                else
                    0;
                const dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                const duration_ticks: u32 = @intFromFloat(@ceil(duration_ms / dt));
                const expiry_tick: u32 = state.header.tick + duration_ticks;
                switch (pickup_ptr.kind) {
                    .health_shard => {
                        state.players[pp].health = @min(
                            100.0,
                            state.players[pp].health + pickup_ptr.amount,
                        );
                    },
                    .shield_cell => {
                        if (state.players[pp].flags.has_shield_charge) {
                            state.players[pp].shield_charge = @min(
                                state.players[pp].shield_max_charge,
                                state.players[pp].shield_charge + pickup_ptr.amount,
                            );
                        }
                    },
                    .overcharge_core => {
                        state.players[pp].overcharge_until_tick = expiry_tick;
                        state.players[pp].flags.has_overcharge = true;
                    },
                    .damage_amp => {
                        state.players[pp].damage_amp_until_tick = expiry_tick;
                        state.players[pp].flags.has_damage_amp = true;
                    },
                    .speed_boost => {
                        state.players[pp].speed_boost_until_tick = expiry_tick;
                        state.players[pp].flags.has_speed_boost = true;
                    },
                    .melee_mode => {
                        state.players[pp].melee_mode_until_tick = expiry_tick;
                        state.players[pp].flags.has_melee_mode = true;
                    },
                    .slow_trap => {
                        state.players[pp].slow_debuff_until_tick = expiry_tick;
                        state.players[pp].flags.has_slow_debuff = true;
                    },
                    .vulnerability_trap => {
                        state.players[pp].vulnerability_until_tick = expiry_tick;
                        state.players[pp].flags.has_vulnerability = true;
                    },
                    .block_jammer => {
                        state.players[pp].block_jammer_until_tick = expiry_tick;
                        state.players[pp].flags.has_block_jammer = true;
                    },
                    .boss_core => {
                        state.players[pp].boss_mode_until_tick = expiry_tick;
                        state.players[pp].flags.has_boss_mode = true;
                    },
                    .card_cache => {
                        // Card draft offer — orchestrator emits
                        // event externally; no inline effect.
                    },
                }
                emitEvent(
                    state,
                    .pickup_taken,
                    @intCast(pp),
                    -1,
                    pickup_ptr.id,
                    @floatFromInt(@intFromEnum(pickup_ptr.kind)),
                    pickup_ptr.x,
                    pickup_ptr.y,
                );
                pickup_ptr.flags &= ~@as(u32, 1); // deactivate
                // Schedule respawn: respawn_ms after current
                // tick. respawn_ms field is bit 2 of flags; if
                // unset, use a default 12s.
                const respawn_ms: f64 = if ((pickup_ptr.flags & 4) != 0)
                    pickup_ptr.respawn_ms
                else
                    12_000.0;
                const respawn_dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                const respawn_ticks: u32 = @intFromFloat(@ceil(respawn_ms / respawn_dt));
                pickup_ptr.respawn_at_tick = state.header.tick + respawn_ticks;
                break;
            }
        }
    }

    // 8b. Burn DoT (I32). Players with has_burn + burn_until_tick
    //     > tick take burn_dps every ~1 second (timed via
    //     burn_tick_last_applied).
    var bi: u32 = 0;
    while (bi < state.player_count) : (bi += 1) {
        const pp = &state.players[bi];
        if (!pp.flags.alive) continue;
        if (!pp.flags.has_burn) continue;
        if (pp.burn_until_tick <= state.header.tick) {
            pp.flags.has_burn = false;
            continue;
        }
        // Tick at 1s cadence.
        const tick_dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
        const ticks_per_second: u32 = @intFromFloat(@ceil(1000.0 / tick_dt));
        const last = pp.burn_tick_last_applied;
        if (state.header.tick - last >= ticks_per_second) {
            pp.health -= pp.burn_dps;
            pp.burn_tick_last_applied = state.header.tick;
            if (pp.health <= 0) {
                pp.health = 0;
                pp.flags.alive = false;
                emitEvent(state, .player_killed, @intCast(bi), -1, 0, 0, pp.x, pp.y);
            }
        }
    }

    // 8b'. Borrowed Time debt resolution (Track Z1a item 3 — port of
    //      World.ts's debt block in the element-status pass, :6018-6041):
    //      the flat, unconditional drain lands ONCE at debt_until_tick —
    //      health floored at 0, `alive` never flipped (TS's own "never
    //      lethal by construction" contract: every Borrowed Time cast
    //      heals strictly more than it later drains). A player who died
    //      before the debt came due just has the bookkeeping cleared —
    //      never a drain on a corpse. 0 = no pending debt (the same
    //      sentinel the bridge decodes to `undefined`).
    var dbi: u32 = 0;
    while (dbi < state.player_count) : (dbi += 1) {
        const dp = &state.players[dbi];
        if (dp.debt_until_tick == 0 or dp.debt_until_tick > state.header.tick) continue;
        if (dp.flags.alive) {
            dp.health = @max(0.0, dp.health - dp.debt_amount);
        }
        dp.debt_until_tick = 0;
        dp.debt_amount = 0;
    }

    // 1. Round phase machine + winner detection (I6). RELOCATED to run
    //    LAST (Track Z0c Item B — port of 3d465f3's structural fix #1):
    //    TS's stepRound is the final sim step of its tick, so winner
    //    detection there sees THIS tick's combat; Zig used to run this
    //    FIRST, making every round/match-end decision lag one tick behind
    //    the deaths that caused it. Everything upstream of here reads the
    //    tick-ENTRY phase (the `is_fighting` const at the top), exactly
    //    like TS's own `fightingPhase` const.
    //    When the round resolves with a real winner (sudden-death
    //    last-alive or force-resolve — see detectRoundWinner), increment
    //    that player's score and signal the phase machine so it
    //    transitions fighting → round_over; a draw (`ended` with winner
    //    -1) still transitions but credits nobody.
    //    HANGOUT: the whole section is skipped — World.ts:7407 passes the
    //    round state straight through unchanged ("never steps the round
    //    machine at all — no countdown/round-over/drafting transitions,
    //    ever"): no winner detection, no score/rng mutation, no countdown
    //    decrement, no draft rolls, no round events, no round respawns.
    if (!g_hangout_mode) {
        const resolution = detectRoundWinner(state, eff_dt);
        const winner_idx = resolution.winner_idx;
        if (winner_idx >= 0 and
            state.header.round_phase == @intFromEnum(round.RoundPhase.fighting))
        {
            const idx: u32 = @intCast(winner_idx);
            state.players[idx].score += 1;
            emitEvent(
                state,
                .round_end,
                winner_idx,
                -1,
                0,
                @floatFromInt(state.players[idx].score),
                0,
                0,
            );
            // Match-end check (I9): if this player hit target_score,
            // mark match winner. orchestrator stops advancing past
            // round_over once match_winner_idx is set.
            if (state.header.target_score > 0 and
                state.players[idx].score >= state.header.target_score)
            {
                state.header.match_winner_idx = winner_idx;
            }
        }
        // Prev-phase snapshot (Phase 2, docs/zig-step-world-parity-goal.md):
        // captured BEFORE `roundStepPhase` overwrites `state.header.round_phase`
        // below — needed to tell "arrived at countdown FROM drafting" apart
        // from any other arrival, and to gate `allDraftersResolved` (only
        // meaningful while CURRENTLY in drafting).
        const prev_phase = state.header.round_phase;
        const drafting_all_resolved =
            prev_phase == @intFromEnum(round.RoundPhase.drafting) and
            draft.allDraftersResolved(state);
        const phase_result = round.roundStepPhase(
            state.header.round_phase,
            state.header.countdown_remaining_ms,
            eff_dt,
            // `ended` (not `winner_idx >= 0`): a sudden-death mutual KO ends
            // the round as a DRAW — the phase must still leave `fighting`
            // even though nobody is credited (round.ts scores only when
            // `winner !== null` but transitions on any non-undefined verdict).
            resolution.ended,
            drafting_all_resolved,
        );
        // Auto-pick stragglers BEFORE committing the new phase below: this
        // runs `draft.applyCardPick` (via `autoPickStragglers`), which itself
        // gates on `state.header.round_phase == drafting` — it must still see
        // the OLD (drafting) phase here, not the new (countdown) one the very
        // next line is about to write. Same reasoning as capturing `prev_phase`
        // above: side effects that need to observe "we were just in drafting"
        // must run before the phase write, not after.
        if (phase_result.transitioned == 1 and
            phase_result.new_phase == @intFromEnum(round.RoundPhase.countdown) and
            prev_phase == @intFromEnum(round.RoundPhase.drafting) and
            !drafting_all_resolved)
        {
            // Window expired with picks outstanding: auto-pick the FIRST
            // offer for every unpicked drafter (round.ts's own expiry branch).
            draft.autoPickStragglers(state);
        }

        state.header.round_phase = phase_result.new_phase;
        state.header.countdown_remaining_ms =
            phase_result.new_countdown_remaining_ms;
        if (phase_result.transitioned == 1 and
            phase_result.new_phase == @intFromEnum(round.RoundPhase.round_over))
        {
            // Persist THIS round's winner (real index or -1 = draw) so it's
            // still readable `ROUND_OVER_HOLD_MS` later when drafting rolls
            // offers and needs it for catch-up role classification — see
            // `WorldStateHeader.round_winner_idx`'s own doc comment for why a
            // fresh local `winner_idx` isn't enough (this tick's value would
            // otherwise be lost by the time drafting starts).
            state.header.round_winner_idx = winner_idx;
        }
        if (phase_result.transitioned == 1 and
            phase_result.new_phase == @intFromEnum(round.RoundPhase.fighting))
        {
            // New round's fighting phase begins: kill tally starts empty
            // (parity with round.ts's countdown → fighting reset — same
            // lifecycle as firstBloodPlayerId on the TS side).
            var ki: u32 = 0;
            while (ki < state.player_count) : (ki += 1) {
                state.players[ki].round_kills = 0;
            }
            // Sudden-death trigger (Track Z0a port of orphaned-branch commit
            // 02b74f5 — parity with round.ts): re-evaluated exactly on the
            // countdown → fighting transition, using the scores as they stand
            // heading into the new round. This is the first time step_world
            // DECIDES the trigger independently (previously the flag was
            // TS-set-only, and the pack path wiped it every tick anyway —
            // see writeScoresIntoMemory's bug history).
            state.header.sudden_death_active =
                if (isSuddenDeathRound(state)) 1 else 0;
            // First-blood wager resets with the kill tally (Track Z0d —
            // round.ts's countdown → fighting branch clears BOTH
            // `firstBloodPlayerId` and `roundKills` in the same block).
            state.header.first_blood_idx_plus1 = 0;
        }
        if (phase_result.transitioned == 1 and
            phase_result.new_phase == @intFromEnum(round.RoundPhase.drafting))
        {
            // round_over → drafting (Phase 2): roll DRAFT_OFFER_COUNT offers
            // per roster player. See `draft.zig`'s `rollOffersForRound` for
            // the full candidate-pool-filter + weighted-sample + pity-floor
            // port of `enterDrafting`.
            draft.rollOffersForRound(state);
        }
        if (phase_result.transitioned == 1 and
            phase_result.new_phase == @intFromEnum(round.RoundPhase.countdown))
        {
            // Wipe drafting bookkeeping so the next round starts clean (no-op
            // the very first time countdown is ever reached, before any round
            // has run — player_draft_state is already zero-valued then). Runs
            // AFTER the auto-pick block above (which needed the pre-clear
            // offers/picked_slot state to still be readable).
            draft.clearDraftState(state);

            // Sudden death clears on countdown entry (round.ts sets
            // `next.suddenDeathActive = undefined` at BOTH →countdown
            // transitions — round-over→countdown and drafting→countdown; the
            // countdown→fighting transition above re-decides it fresh). Not in
            // the 02b74f5 branch spec, which only wrote the flag at the
            // fighting transition — but without this, a stale `true` survives
            // the countdown phase where TS reads cleared, a needless
            // divergence window.
            state.header.sudden_death_active = 0;

            // First-blood clears at BOTH →countdown transitions too (round.ts
            // sets `next.firstBloodPlayerId = undefined` in the round-over→
            // countdown legacy fallback AND the drafting→countdown branch;
            // the boost must never leak across rounds). Same belt-and-braces
            // shape as the sudden-death clear immediately above — the
            // countdown→fighting block re-clears it anyway.
            state.header.first_blood_idx_plus1 = 0;

            // Round winner clears at the →countdown transition too (round.ts
            // sets `next.winnerPlayerId = null` in BOTH →countdown branches).
            // Track Z2: round_winner_idx is now BRIDGED (packed from
            // state.round.winnerPlayerId / unpacked back), so a stale index
            // here would survive onto the wire where TS reads null.
            state.header.round_winner_idx = -1;

            state.header.round_index += 1;
            // Reset transient entities for the new round (I28).
            // Players keep their score + buff durations; everything
            // else clears so the next round starts clean.
            state.projectile_count = 0;
            state.fire_count = 0;
            state.satellite_count = 0;
            // Respawn ALL players for the new round (Track Z0b Item A —
            // upgraded from the old heal-in-place approximation to the full
            // World.ts `respawnAll` port: every player runs the SAME
            // respawnPlayerAt reset as the mid-round fast respawn, at their
            // assignSpawnPoints seat — max health honors class chassis +
            // maxHealthAdd cards instead of the old flat 100, positions move
            // to the spawn seals instead of staying wherever the bell rang,
            // and any pending mid-round respawn stamp is consumed. NOTE:
            // slow deliberately survives now (TS's respawnPlayerAt clears
            // burn/freeze/parry but NOT slowedUntilTick — the old Zig clear
            // here was a divergence, not a feature).
            var ri: u32 = 0;
            while (ri < state.player_count) : (ri += 1) {
                const seat = assignedSpawnPoint(state, ri);
                respawnPlayerAt(
                    &state.players[ri],
                    &state.player_fire_config[ri],
                    seat.x,
                    seat.y,
                );
            }
        }
    } // end of the !g_hangout_mode round-machine block (section 1)

    // 9. End-of-tick compaction (I29). Walk projectiles + fire
    //    patches; copy live entries down so the active prefix
    //    stays packed. Without this the arrays grow until the
    //    next round restart (I28) wipes them.
    var write_idx: u32 = 0;
    var read_idx: u32 = 0;
    while (read_idx < state.projectile_count) : (read_idx += 1) {
        if (state.projectiles[read_idx].lifetime_ms > 0) {
            if (write_idx != read_idx) {
                state.projectiles[write_idx] = state.projectiles[read_idx];
            }
            write_idx += 1;
        }
    }
    state.projectile_count = write_idx;

    var fwrite: u32 = 0;
    var fread: u32 = 0;
    while (fread < state.fire_count) : (fread += 1) {
        if (state.fires[fread].remaining_ms > 0) {
            if (fwrite != fread) {
                state.fires[fwrite] = state.fires[fread];
            }
            fwrite += 1;
        }
    }
    state.fire_count = fwrite;

    // Paper Double compaction (2026-07-20 gap-closure pass item 3) — same
    // "tick now, compact once at end of tick" split as fires/projectiles
    // above. A decoy is dead once EITHER its health (section 4's collision
    // loop) or its remaining_ms (section 2b's lifetime tick) hits 0 — a
    // decoy that's already dead going into this tick (health <= 0 from a
    // prior tick, defensively) is also swept up, matching section 2b/4's
    // own `health <= 0 or remaining_ms <= 0` skip-guards.
    var pdwrite: u32 = 0;
    var pdread: u32 = 0;
    while (pdread < state.paper_double_count) : (pdread += 1) {
        const alive_pd = state.paper_doubles[pdread].health > 0 and
            state.paper_doubles[pdread].remaining_ms > 0;
        if (alive_pd) {
            if (pdwrite != pdread) {
                state.paper_doubles[pdwrite] = state.paper_doubles[pdread];
            }
            pdwrite += 1;
        }
    }
    state.paper_double_count = pdwrite;

    // 10. Emission charge fill (P0 — docs/emission-engine-goal.md; mirror of
    //     World.ts's post-pass over this tick's hit-confirmed events).
    //     player_idx_a = victim (taken fill, killing blow included — charge
    //     persists through death by doctrine); player_idx_b = attacker when
    //     the source resolved one (dealt fill, never for self-hits).
    //     Parried/shielded hits never emit hit_confirmed, so refused damage
    //     cannot charge meters. Charge mutates ONLY here, at cast, and at
    //     player insertion (goal-doc invariant).
    //     Hangout: never fills (World.ts:7312's !hangoutMode) — no
    //     player-vs-player combat event can exist there anyway (every
    //     damage site is gated), but the guard is explicit per the
    //     goal-doc invariant. TS's hangout-only destructible-damage charge
    //     source (the dedicated block below World.ts:7312) is unported —
    //     see g_hangout_mode's recorded-cuts list.
    const pc_i32: i32 = @intCast(state.player_count);
    var ei: u32 = if (g_hangout_mode) state.event_count else 0;
    while (ei < state.event_count) : (ei += 1) {
        const ev = &state.events[ei];
        if (ev.kind != @intFromEnum(world_state.SimEventKind.hit_confirmed)) continue;
        if (ev.scalar <= 0) continue;
        if (ev.player_idx_a >= 0 and ev.player_idx_a < pc_i32) {
            const vp = &state.players[@intCast(ev.player_idx_a)];
            vp.ability_charge = @min(
                EMISSION_CHARGE_MAX,
                vp.ability_charge + ev.scalar * EMISSION_FILL_PER_DAMAGE_TAKEN,
            );
        }
        if (ev.player_idx_b >= 0 and
            ev.player_idx_b < pc_i32 and
            ev.player_idx_b != ev.player_idx_a)
        {
            const ap = &state.players[@intCast(ev.player_idx_b)];
            ap.ability_charge = @min(
                EMISSION_CHARGE_MAX,
                ap.ability_charge + ev.scalar * EMISSION_FILL_PER_DAMAGE_DEALT,
            );
        }
    }

    // 11. Mid-round fast respawn (Track Z0b Item A — port of World.ts's
    //     block of the same name; Jake ruled "A" 2026-07-17, reverting the
    //     venue-era bench-until-bell): a death stamps `respawn_at_tick`
    //     (RESPAWN_DELAY_MS out, in ticks); when it comes due during the
    //     FIGHTING phase the player re-forms at their assignSpawnPoints
    //     seat. Never in sudden death — last one standing is the money
    //     moment. Runs at the very end of the tick (after every damage
    //     section), diffing against the section-0a alive snapshot — one
    //     stamp site catches every death cause, same as TS. TS runs its
    //     copy after its round machine and reads the JUST-stepped phase;
    //     since the Z0c Item B reorder the round machine runs late here
    //     too (just before compaction, still ahead of this block), so the
    //     phase read below is the same JUST-stepped value TS's
    //     `roundNow.phase` holds for this tick's decision — the reorder
    //     made this note's old "machine ran at the top" caveat moot.
    //     Hangout: skipped (World.ts:7478's !hangoutMode) — players are
    //     damage-immune there, and a void fall already respawned silently
    //     at the kill-plane site, so no death can need this pass.
    if (!g_hangout_mode) {
        const in_fighting =
            state.header.round_phase == @intFromEnum(round.RoundPhase.fighting);
        // TS: Math.ceil(RESPAWN_DELAY_MS / Math.max(1, effDtMs)).
        const delay_ticks: u32 =
            @intFromFloat(@ceil(RESPAWN_DELAY_MS / @max(1.0, eff_dt)));
        var rsi: u32 = 0;
        while (rsi < state.player_count) : (rsi += 1) {
            const p = &state.players[rsi];
            if (was_alive[rsi] and !p.flags.alive and p.respawn_at_tick == 0) {
                p.respawn_at_tick = state.header.tick + delay_ticks;
                continue;
            }
            if (!p.flags.alive and
                p.respawn_at_tick != 0 and
                state.header.tick >= p.respawn_at_tick and
                in_fighting and
                state.header.sudden_death_active == 0)
            {
                const seat = assignedSpawnPoint(state, rsi);
                respawnPlayerAt(
                    &state.players[rsi],
                    &state.player_fire_config[rsi],
                    seat.x,
                    seat.y,
                );
            }
        }
    }

    return 0;
}

pub export fn step_world(
    state_ptr: *world_state.WorldState,
    dt_ms: f64,
) i32 {
    return stepWorld(state_ptr, dt_ms);
}

/// Bulk-write the static AABB cache (I30). Hosts call this once
/// per match (after the map loads) so step_world has the full
/// terrain to feed into stepPlayer + step_projectile_v2.
///
/// Returns the count actually written (clamped at MAX_STATICS).
pub export fn world_state_set_statics(
    state_ptr: *world_state.WorldState,
    aabbs_ptr: [*]const collision_types.AABB,
    one_way_ptr: [*]const u8,
    count: u32,
) u32 {
    const clamped = @min(count, world_state.MAX_STATICS);
    var i: u32 = 0;
    while (i < clamped) : (i += 1) {
        state_ptr.statics[i] = aabbs_ptr[i];
        state_ptr.one_way[i] = one_way_ptr[i];
    }
    state_ptr.static_count = clamped;
    return clamped;
}

/// Set the match target_score (I9 was set on pack; this lets the
/// host change it mid-match without re-packing).
pub export fn world_state_set_target_score(
    state_ptr: *world_state.WorldState,
    target: u32,
) void {
    state_ptr.header.target_score = target;
    state_ptr.header.match_winner_idx = -1;
}

/// Host entry (Track Z2 — the drafting bridge): apply one player's draft
/// pick into the live wasm-side state, between the host's pack and this
/// tick's `step_world` call. Thin wrapper over `draft.applyCardPick`
/// (`auto_picked=false` — the auto path is `stepWorld`'s own expiry
/// block); returns 1 if the pick landed, 0 on any of applyCardPick's
/// no-op gates (wrong phase, bad indices, empty offer slot, already
/// picked). NOTE for callers: the `draft_resolved` event this emits is
/// wiped by `stepWorld`'s own `event_count = 0` reset at the top of the
/// step — the HOST synthesizes the TS-side draft-resolved event for
/// picks it queued (it knows player + card already); only the expiry
/// auto-picks surface through the wasm event stream.
pub export fn world_apply_card_pick(
    state_ptr: *world_state.WorldState,
    player_idx: u32,
    offer_slot: u32,
) u32 {
    if (offer_slot > 255) return 0;
    return if (draft.applyCardPick(state_ptr, player_idx, @intCast(offer_slot), false)) 1 else 0;
}

/// Parity-test entry (Track Z2): roll this round's draft offers for every
/// roster player — `draft.rollOffersForRound` exactly as `stepWorld`'s
/// round_over → drafting transition calls it, but host-invokable on a
/// hand-seeded state so the TS-vs-Zig offer-roll parity suite can compare
/// the deterministic parts precisely (draft.zig's own testing doctrine)
/// without driving a whole round through the phase machine first.
pub export fn world_draft_roll_offers(state_ptr: *world_state.WorldState) void {
    draft.rollOffersForRound(state_ptr);
}
