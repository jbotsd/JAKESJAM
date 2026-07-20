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

/// Per-tick step. Mutates `state` in place. Returns 0 on success;
/// reserved non-zero values for future error reporting.
/// Decide a round winner during fighting phase. Returns:
///   * winner index ≥ 0 if exactly one player alive (KO)
///   * winner index ≥ 0 if time-out / bot-shootout force-resolve —
///     most round_kills wins, then alive-health tiebreaks (see
///     timeoutWinnerIdx; kill-tally rule 2026-07-17)
///   * -1 if no winner yet (or a time-out draw: zero kills + nobody alive)
/// Grace after ALL humans die before the bot-shootout guard ends the round
/// (parity with round.ts NO_HUMAN_SURVIVOR_END_MS).
const NO_HUMAN_SURVIVOR_END_MS: f64 = 6000;

/// Emission Engine charge economy (parity with constants.ts —
/// EMISSION_CHARGE_MAX / EMISSION_FILL_PER_DAMAGE_DEALT /
/// EMISSION_FILL_PER_DAMAGE_TAKEN; docs/emission-engine-goal.md).
/// The TS state hash mixes ability_charge — these must move in
/// lock-step with constants.ts or reconcile hashes diverge.
const EMISSION_CHARGE_MAX: f64 = 100;
const EMISSION_FILL_PER_DAMAGE_DEALT: f64 = 0.5;
const EMISSION_FILL_PER_DAMAGE_TAKEN: f64 = 0.2;

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
    if (attacker_idx < 0 or attacker_idx == victim_idx) return;
    state.players[@intCast(attacker_idx)].round_kills += 1;
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

fn detectRoundWinner(state: *const world_state.WorldState) i32 {
    if (state.header.round_phase != @intFromEnum(round.RoundPhase.fighting))
        return -1;
    var alive_count: u32 = 0;
    var alive_idx: i32 = -1;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.players[i].flags.alive) {
            alive_count += 1;
            alive_idx = @intCast(i);
        }
    }
    if (alive_count == 1) return alive_idx; // KO
    // Bot-shootout guard (parity with round.ts): humans present but ALL dead,
    // and the round has run ≥ NO_HUMAN_SURVIVOR_END_MS → force-resolve so the
    // lobby isn't stuck watching bots duel. Computed fresh each tick, so a live
    // human (alive_humans>0) cancels it.
    if (state.player_count > 0) {
        var humans: u32 = 0;
        var alive_humans: u32 = 0;
        var h: u32 = 0;
        while (h < state.player_count) : (h += 1) {
            if (!isBotPlayer(&state.players[h])) {
                humans += 1;
                if (state.players[h].flags.alive) alive_humans += 1;
            }
        }
        const elapsed = round.ROUND_TIME_LIMIT_MS - state.header.countdown_remaining_ms;
        if (humans > 0 and alive_humans == 0 and elapsed >= NO_HUMAN_SURVIVOR_END_MS) {
            return timeoutWinnerIdx(state);
        }
    }
    // Time-out path (kill-tally rule 2026-07-17): most round_kills wins,
    // then alive-health tiebreaks — see timeoutWinnerIdx. -1 = draw.
    if (state.header.countdown_remaining_ms <= 0 and state.player_count > 0) {
        return timeoutWinnerIdx(state);
    }
    return -1;
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
///   - Ninja dash-evasion / Ghost Guard i-frames (combat.ts steps 0.5/0.6)
///   - Syzygist Ward (already flagged TS-owned/TS-applied on its own field
///     comment, world_state.zig's syz_ward_absorb_until_tick)
///   - Paladin Kindled Ward's partial-mitigation branch (combat.ts's
///     `classIdForArchetype(...) === "paladin"` shield branch)
///   - Team-peel (World.ts's `applyTeamPeel`/`findTeamPeelWarder`)
///   - rallyLightDamageMultiplier / kindledResolveDamageMultiplier /
///     fooledDamageMultiplier (all read TS-only *UntilTick fields with no
///     Zig mirror: kindledResolveUntilTick, fooledUntilTick, and a
///     team-based "rally light source" lookup)
///   - applyKindledResolveStaggerResist on the slow-multiplier stacking
///     below (same TS-only field as its sibling above)
/// Victim `has_vulnerability` is ALSO correctly absent here — checked
/// directly against TS: `resolveInstantAoeCasts` never reads
/// vulnerabilityUntilTick at all (unlike the projectile-hit path in
/// section 4 above, which does) — porting it here would be inventing
/// behavior TS itself doesn't have for this code path.
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

            // Status-only entries (cast.damage <= 0 — none of the 5 live
            // push sites emit one today, but TS keeps the branch, so this
            // does too) still need the real shield check evaluated with a
            // nominal 1 damage, exactly like TS's own `nominalDamage`
            // trick — only `cast.damage` (the real amount) ever reaches
            // health below.
            const nominal: f64 = if (cast.damage > 0) cast.damage else 1.0;

            // Generic shield block (see the doc comment above for exactly
            // which mitigation steps this does and doesn't cover). Full
            // block, no overflow carry — matches combat.ts's shield branch
            // exactly (always `damage: 0` on block, never a partial-charge
            // remainder).
            if (victim.flags.shield_active and
                victim.flags.has_shield_charge and
                victim.shield_charge > 0)
            {
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
                const final_dmg = cast.damage;
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
            // the lower (more punishing) multiplier" stacking policy as
            // TS (Kindled Resolve's stagger-RESIST step ahead of this
            // comparison is the one stubbed piece — see doc comment
            // above).
            if (cast.has_slow != 0) {
                const dt: f64 = if (eff_dt > 0) eff_dt else 1.0;
                const ticks_duration: u32 = @intFromFloat(@ceil(cast.slow_duration_ms / dt));
                const new_until = tick + ticks_duration;
                const prev_until: u32 = if (victim.flags.has_slow) victim.slowed_until_tick else 0;
                const prev_mul: f64 = if (victim.flags.has_slow) victim.slow_multiplier else 1.0;
                victim.slowed_until_tick = @max(prev_until, new_until);
                victim.slow_multiplier = @min(prev_mul, cast.slow_multiplier);
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
//     for; every OTHER energy grant (dash-through, wall-kick) stays
//     TS-owned/un-ported.
//   - Destructible arc hits — World.ts's own comment marks this path
//     hangout-mode-only (Zig models real matches, not the venue-lobby
//     hangout mode — no Zig analog exists to hang this off of).
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
//   - Dash-through body-cross / ninja evasion i-frames / Ghost Guard — all
//     key off a `dashing` boolean that has NO Zig PlayerEntity mirror at
//     all (`PlayerMovementMemory` tracks dash TIMERS, not a wire-visible
//     dashing flag) — same "stubbed, no field to hang it on" contract
//     `resolveInstantAoeCasts`'s own MITIGATION comment documents above.
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
// Kindled Ward (a PARTIAL mitigation, not the generic 100% block) and
// Syzygist Ward are both real TS mitigation branches for a null-projectile
// hit but have NO Zig implementation anywhere yet (not in section 4's
// projectile path, not in resolveInstantAoeCasts) — this port stays
// consistent with that pre-existing gap rather than becoming the first
// path to invent paladin/priest-aware mitigation math.
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
const SLASH_RANGE: f64 = 78.0;
const SLASH_ARC_RADIANS: f64 = (5.0 * std.math.pi) / 9.0;
const SLASH_DAMAGE: f64 = 22.0;
const SLASH_KNOCKBACK: f64 = 260.0;
const SLASH_KNOCK_UP: f64 = 60.0;
const SLASH_WINDUP_MS: f64 = 120.0;
const SLASH_ACTIVE_MS: f64 = 90.0;
const SLASH_RECOVERY_MS: f64 = 220.0;
const SLASH_CONTACT_DELAY_MS: f64 = 44.0;

const EDGE_RANGE: f64 = 84.0;
const EDGE_ARC_RADIANS: f64 = (7.0 * std.math.pi) / 18.0;
const EDGE_DAMAGE: f64 = 32.0;
const EDGE_KNOCKBACK: f64 = 420.0;
const EDGE_KNOCK_UP: f64 = 110.0;
const EDGE_WINDUP_MS: f64 = 200.0;
const EDGE_ACTIVE_MS: f64 = 110.0;
const EDGE_RECOVERY_MS: f64 = 340.0;
const EDGE_CONTACT_DELAY_MS: f64 = 100.0;

// ── Ability-cast dispatch (Phase 1, docs/zig-step-world-parity-goal.md
//    "the next unblock") — constants for the 6 melee-hook abilities wired
//    this pass. Bit-exact port of the matching World.ts/constants.ts
//    values (re-verified live, not from the goal doc's own citations —
//    doctrine #1/#6).
// Ninja — Undercut (constants.ts:1031).
const NINJA_UNDERCUT_HEALTH_THRESHOLD: f64 = 15.0;
// Ninja — Read Mark (constants.ts:1058-1059).
const NINJA_READ_MARK_RANGE_PX: f64 = 340.0;
const NINJA_READ_MARK_AMP_MULTIPLIER: f64 = 1.28;
// Ninja — Second Wind (constants.ts:1091-1092) + the baseline per-hit
// energy grant it tops up (World.ts:576/582 NINJA_ENERGY_MAX/
// NINJA_ENERGY_ON_MELEE_HIT — see this pass's own report for why the
// baseline grant is now in scope alongside Second Wind).
const NINJA_ENERGY_MAX: f64 = 100.0;
const NINJA_ENERGY_ON_MELEE_HIT: f64 = 10.0;
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

/// Nearest ALIVE other player within `range_px`, ignoring the caster —
/// Read Mark's own targeting shape (World.ts's `findNearestEnemy` call at
/// its cast site: omnidirectional, no cone). Team-awareness (`isAlly`) is
/// DELIBERATELY not checked: Phase 3 (ally-targeting substrate) doesn't
/// exist in Zig yet — docs/zig-step-world-parity-goal.md's own Phase 1
/// section names the missing `isAlly`/`findNearestAlly` substrate as a
/// Phase 3 dependency for ALLY-targeted abilities, and the same missing
/// piece means an ENEMY-search can't exclude teammates either today. A
/// real, named, deferred gap (a duo match could see this mark a
/// teammate), not a silent one — step_world has no team-aware match mode
/// exercised anywhere in this test suite yet (Phase 0/1 coverage is all
/// FFA), so this is "correctness over completeness" per this goal doc's
/// own doctrine, not a guess.
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
/// catch-all exists anywhere in this switch. 12 arms carry a real
/// cast-time effect: the original 6 melee-hook abilities (this phase's own
/// "first real abilities" list — see `stepMeleeSwing` for their
/// CONSUMPTION half) plus 6 more from the AOE-queue group (Prism Fan/
/// Shard Ring/Flock Pulse push straight onto `PendingInstantAoe` from
/// this switch; Wall Bloom/Shock Ring only OPEN a window here, consumed
/// at a movement hook in section 8 below — see `stepWorld`'s own section-8
/// comment; Paper Double spawns a `PaperDoubleEntity` directly, whose
/// death/expiry burst is pushed separately, see section 6b's burst-
/// detection block); the other 33 are explicit, individually-commented
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
            .sunlance => {}, // Phase 4 — not yet ported
            .facet_break => {}, // Phase 4 — not yet ported
            .lattice => {}, // Phase 4 — not yet ported
            .return_glass => {}, // Phase 4 — not yet ported
            .hard_aperture => {}, // Phase 4 — not yet ported
            .overclock => {}, // Phase 4 — not yet ported
            .measure => {}, // Phase 4 — not yet ported
            .slip_node => {}, // Phase 4 — not yet ported
            .recoil_step => {}, // Phase 4 — not yet ported
            .sunspike => {}, // Phase 4 — not yet ported
            .bastion_pulse => {}, // Phase 4 — not yet ported
            .aegis_share => {}, // Phase 4 — not yet ported
            .plant_charge => {}, // Phase 4 — not yet ported
            .rally_light => {}, // Phase 4 — not yet ported
            .kindled_resolve => {}, // Phase 4 — not yet ported
            .bulwark_step => {}, // Phase 4 — not yet ported
            .bleed_tithe => {}, // Phase 4 — not yet ported
            .severance => {}, // Phase 4 — not yet ported
            .borrowed_time => {}, // Phase 4 — not yet ported
            .focus_hex => {}, // Phase 4 — not yet ported
            .contagion => {}, // Phase 4 — not yet ported
            .self_lattice => {}, // Phase 4 — not yet ported
            .glass_ward => {}, // Phase 4 — not yet ported
            .haste_gift => {}, // Phase 4 — not yet ported
            .drift_step => {}, // Phase 4 — not yet ported
            .needle => {}, // Phase 4 — not yet ported
            .ghost_guard => {}, // Phase 4 — not yet ported
            .razor_route => {}, // Phase 4 — not yet ported
        }

        if (!activated) continue; // a press that does nothing burns no cooldown

        const cd_ticks: u32 = @intFromFloat(@ceil(active_spec.cooldown_ms / @max(1.0, eff_dt)));
        attacker.slot_cooldown_until_tick[slot] = state.header.tick + cd_ticks;
    }
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
) void {
    const attacker = &state.players[attacker_idx];
    if (!attacker.flags.alive) return;
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

    if (mem.phase == .idle) {
        // Re-trigger only accepted from idle — a Fire press while
        // mem.phase != .idle is simply never read as a new swing (this
        // branch isn't reached), satisfying "gate re-swinging during
        // windup/active/recovery" by construction, same as TS's own FSM.
        if (fire_rising_edge) {
            const dx = attacker.aim_x - attacker.x;
            const dy = attacker.aim_y - attacker.y;
            const len = @sqrt(dx * dx + dy * dy);
            mem.phase = .windup;
            mem.phase_ms = windup_ms;
            mem.aim_x = if (len > 1e-3) dx / len else 1.0;
            mem.aim_y = if (len > 1e-3) dy / len else 0.0;
            mem.hit_this_swing_mask = 0;
        }
    } else {
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
                },
                .idle => unreachable,
            }
        }
    }

    // ---- Contact-delay gate: the arc goes live at the start of `active`,
    //      but only DAMAGES from `contact_delay_ms` into that window
    //      onward (the blade visually crosses the aim radius partway
    //      through the swing, not on the very first active tick). Mirrors
    //      World.ts's `hasReachedSlashContact`/equivalent Edge check
    //      exactly, including the "elapsed" accounting across the tick
    //      that just transitioned OUT of active (`wasActive`). ----
    const is_active_now = mem.phase == .active;
    const active_elapsed_after: f64 = if (is_active_now)
        active_ms - mem.phase_ms
    else if (was_active)
        @min(active_ms, active_elapsed_before + eff_dt)
    else
        0;
    const reached_contact = (was_active or is_active_now) and active_elapsed_after >= contact_delay_ms;
    if (!reached_contact) return;

    // ---- Arc hit-check (from the contact-delay tick onward, every
    //      victim in the cone — not "first hit only") ----
    const aim_angle = trig.lutAtan2(mem.aim_y, mem.aim_x);
    const half_arc = arc / 2.0;

    var vi: u32 = 0;
    while (vi < state.player_count) : (vi += 1) {
        if (vi == attacker_idx) continue;
        const bit: u16 = @as(u16, 1) << @as(u4, @intCast(vi));
        if ((mem.hit_this_swing_mask & bit) != 0) continue;
        const victim = &state.players[vi];
        if (!victim.flags.alive) continue;
        const box = combat.playerHitboxAabb(victim.x, victim.y, victim.flags.crouching);
        if (!combat.isBodyInMeleeArc(attacker.x, attacker.y, aim_angle, half_arc, range, victim.x, victim.y, box)) {
            continue;
        }
        mem.hit_this_swing_mask |= bit;

        // Knockback lands on every arc hit regardless of the mitigation
        // below (TS: `post` always gets the knockback velocity unless
        // `mit.evaded` — dash-i-frame evasion has no Zig analog here, see
        // this section's own doc comment, so knockback unconditionally
        // applies once a swing connects).
        victim.vx = mem.aim_x * knockback;
        victim.vy = mem.aim_y * knockback - knock_up;

        // Generic shield mitigation only — see this section's own doc
        // comment for why parry/directional-facing/Kindled-Ward/Syzygist-
        // Ward are all correctly absent here.
        if (victim.flags.shield_active and victim.flags.has_shield_charge and victim.shield_charge > 0) {
            victim.shield_charge -= damage * combat.SHIELD_HIT_DRAIN_MULTIPLIER;
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
        //    fooled_until_tick field on PlayerEntity yet), rallyLight/
        //    kindledResolve damage multipliers (Rally Light/Kindled
        //    Resolve are both Phase 4 abilities, unreachable — nothing can
        //    equip them today, so their multiplier is unconditionally 1
        //    either way), and team peel (Phase 3 ally substrate). Every one
        //    of these is a TRUE no-op today given nothing upstream can
        //    populate the state they'd read, not a silent shortcut.
        var final_damage = damage;
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

        const new_health = @max(0.0, victim.health - final_damage);
        const was_alive = victim.flags.alive;
        victim.health = new_health;
        victim.flags.alive = new_health > 0;
        if (stagger_victim) {
            const stagger_ticks: u32 = @intFromFloat(@ceil(KIN_SEAL_STAGGER_MS / @max(1.0, eff_dt)));
            victim.slowed_until_tick = state.header.tick + stagger_ticks;
            victim.slow_multiplier = KIN_SEAL_STAGGER_MULTIPLIER;
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

pub fn stepWorld(state: *world_state.WorldState, dt_ms: f64) i32 {
    state.event_count = 0;
    state.header.tick += 1;

    // 0. Resolve the chaos profile for this tick + apply
    //    timeScale to dt (I20). All downstream per-module
    //    calls use `eff_dt` so movement, projectile flight, and
    //    cooldown decrement run at the chaos-scaled tempo.
    const chaos_profile = chaos.chaosProfileFromMask(state.header.chaos_mask);
    const eff_dt = dt_ms * chaos_profile.time_scale;

    // 1. Round phase machine + winner detection (I6). When a
    //    winner emerges (KO or time-out), increment that player's
    //    score and signal the phase machine so it transitions
    //    fighting → round_over even before the time-out.
    const winner_idx = detectRoundWinner(state);
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
    const phase_result = round.roundStepPhase(
        state.header.round_phase,
        state.header.countdown_remaining_ms,
        eff_dt,
        winner_idx >= 0,
    );
    state.header.round_phase = phase_result.new_phase;
    state.header.countdown_remaining_ms =
        phase_result.new_countdown_remaining_ms;
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
    }
    if (phase_result.transitioned == 1 and
        phase_result.new_phase == @intFromEnum(round.RoundPhase.countdown))
    {
        state.header.round_index += 1;
        // Reset transient entities for the new round (I28).
        // Players keep their score + buff durations; everything
        // else clears so the next round starts clean.
        state.projectile_count = 0;
        state.fire_count = 0;
        state.satellite_count = 0;
        // Heal alive players to full + clear timed buffs that
        // shouldn't carry across rounds (slow, burn, freeze).
        // Buff pickups (overcharge, damage_amp etc) DO carry per
        // the offline TS behavior.
        var ri: u32 = 0;
        while (ri < state.player_count) : (ri += 1) {
            state.players[ri].health = 100.0;
            state.players[ri].flags.alive = true;
            state.players[ri].flags.has_slow = false;
            state.players[ri].flags.has_burn = false;
            state.players[ri].flags.has_freeze = false;
        }
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
    //    Player AABB is approximated as 30×56 centered on (x,y).
    const PLAYER_HALF_W: f64 = 15.0;
    const PLAYER_HALF_H: f64 = 28.0;
    var fi: u32 = 0;
    while (fi < state.fire_count) : (fi += 1) {
        const patch_ptr = &state.fires[fi];
        if (patch_ptr.remaining_ms <= 0) continue;
        const damage_this_tick = patch_ptr.damage_per_second * (eff_dt / 1000.0);
        var ph: u32 = 0;
        while (ph < state.player_count) : (ph += 1) {
            if (!state.players[ph].flags.alive) continue;
            // Skip owner self-damage.
            if (patch_ptr.has_owner != 0 and
                state.players[ph].id_len == patch_ptr.owner_id_len and
                std.mem.eql(u8, state.players[ph].id_bytes[0..patch_ptr.owner_id_len], patch_ptr.owner_id_bytes[0..patch_ptr.owner_id_len]))
            {
                continue;
            }
            if (fire.fireEntityHitsPlayerAABB(
                patch_ptr,
                state.players[ph].x - PLAYER_HALF_W,
                state.players[ph].y - PLAYER_HALF_H,
                PLAYER_HALF_W * 2.0,
                PLAYER_HALF_H * 2.0,
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
            if (r.expired != 0) proj_ptr.lifetime_ms = 0;
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
            if (r == .broken and (dest_ptr.flags & 1) != 0) {
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
        // Player overlap: circle vs AABB.
        var ph2: u32 = 0;
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
            const half_w: f64 = 15.0;
            const half_h: f64 = 28.0;
            const closest_x = @max(px - half_w, @min(proj_ptr.x, px + half_w));
            const closest_y = @max(py - half_h, @min(proj_ptr.y, py + half_h));
            const dx = proj_ptr.x - closest_x;
            const dy = proj_ptr.y - closest_y;
            if (dx * dx + dy * dy <= proj_ptr.radius * proj_ptr.radius) {
                // Compose damage multipliers (I36):
                //   chaos × shooter damage_amp × victim vulnerability
                var final_dmg = proj_ptr.damage * chaos_profile.damage_multiplier;
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
                    }
                }
                // Victim buff: vulnerability multiplies incoming
                // damage (default 1.5×).
                if (state.players[ph2].flags.has_vulnerability and
                    state.players[ph2].vulnerability_until_tick > state.header.tick)
                {
                    final_dmg *= 1.5;
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
                // Shield pop: if the player's shield is active
                // and absorbs the hit, drop a shield_popped
                // event (and tap the shield charge — full
                // mitigation handled in a follow-on cut once
                // shield-vs-direct-damage is wired into the
                // model).
                shield_block: {
                    if (!(state.players[ph2].flags.shield_active and
                        state.players[ph2].flags.has_shield_charge and
                        state.players[ph2].shield_charge > 0)) break :shield_block;
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
                    proj_ptr.lifetime_ms = 0;
                }
                break;
            }
        }
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
            .dash_charges = if (has_cfg) @intCast(fcfg.dash_charges) else 0,
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
        if (state.players[pmi].character_id == .heavy) {
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
            const rem = state.players[pmi].health;
            state.players[pmi].health = 0;
            state.players[pmi].flags.alive = false;
            emitEvent(state, .hit_confirmed, @intCast(pmi), -1, 0, rem, state.players[pmi].x, state.players[pmi].y);
            emitEvent(state, .player_killed, @intCast(pmi), -1, 0, 0, state.players[pmi].x, state.players[pmi].y);
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
    if (state.header.round_phase == @intFromEnum(round.RoundPhase.fighting)) {
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
        if (is_wizard_channel and fire_requested and player_ptr.flags.alive) {
            player_ptr.channel_hold_ms += eff_dt;
        } else {
            player_ptr.channel_hold_ms = 0;
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
        // Overclock (constants.ts's GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER,
        // weapon.ts:290-296) is a DEFERRED gap, not a trivial add like
        // haste above: unlike haste_multiplier, `overclockUntilTick` (TS
        // types.ts:722) has NO Zig PlayerEntity mirror at all today — wiring
        // it here would mean growing PlayerEntity by another u32+flag bit,
        // which is exactly the "large port" the task scoping this pass
        // asked NOT to scope-creep into. Left unread here; a future cut
        // should add overclock_until_tick + PlayerFlags.has_overclock
        // following the same growth-history-comment pattern as
        // channel_hold_ms above, then read it here.
        const cd_after = weapon.cooldownFromFireRate(
            fire_rate_v * chaos_profile.fire_rate_multiplier *
                haste_fire_rate_mul * channel_fire_rate_mul,
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
        if (fire_decision.fired == 1 and
            chaos_profile.disable_projectiles == 0)
        {
            const dx = player_ptr.aim_x - player_ptr.x;
            const dy = player_ptr.aim_y - player_ptr.y;
            const aim_angle: f64 = if (dx == 0 and dy == 0) 0 else trig.lutAtan2(dy, dx);
            const speed = proj_speed_base * proj_speed_mul;
            const lifetime_ms = @max(
                50.0,
                proj_lifetime_sec * 1000.0 * proj_lifetime_mul,
            );
            const radius_v: f64 = @max(2.0, 7.0 * proj_size_mul);

            // Multi-shot spread fan: distribute proj_count
            // projectiles evenly across spread_total radians centred
            // on aim_angle. Single-shot (count == 1) fires straight.
            var shot_i: u32 = 0;
            while (shot_i < proj_count) : (shot_i += 1) {
                if (state.projectile_count >= world_state.MAX_PROJECTILES) break;
                const offset: f64 = if (proj_count <= 1)
                    0
                else blk: {
                    const t: f64 = @as(f64, @floatFromInt(shot_i)) /
                        @as(f64, @floatFromInt(proj_count - 1));
                    break :blk -spread_total * 0.5 + t * spread_total;
                };
                const ang = aim_angle + offset;
                const slot: u32 = state.projectile_count;
                state.projectile_count += 1;
                const new_id: u32 = state.header.next_entity_id;
                state.header.next_entity_id += 1;
                state.projectiles[slot] = .{
                    .x = player_ptr.x,
                    .y = player_ptr.y,
                    .vx = trig.lutCos(ang) * speed,
                    .vy = trig.lutSin(ang) * speed,
                    .radius = radius_v,
                    .damage = damage_v,
                    .lifetime_ms = lifetime_ms,
                    .age_ms = 0,
                    .traveled_px = 0,
                    .origin_x = player_ptr.x,
                    .origin_y = player_ptr.y,
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
                    },
                    .pathing = proj_pathing,
                    .element = proj_element,
                    .impact = proj_impact_kind,
                    .shape = proj_shape,
                    .owner_id_len = player_ptr.id_len,
                    .owner_id_bytes = player_ptr.id_bytes,
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
    //     Fighting-phase only — Zig has no hangout-mode analog to carve out
    //     the way World.ts does (see stepMeleeSwing's doc comment).
    if (state.header.round_phase == @intFromEnum(round.RoundPhase.fighting)) {
        var mai: u32 = 0;
        while (mai < state.player_count) : (mai += 1) {
            stepMeleeSwing(state, mai, eff_dt, melee_fire_rising_edge[mai]);
        }
    }

    // 6y. Paper Double death/expiry burst detection (this pass — parity
    //     port of paperDouble.ts's own `bursts` list feeding World.ts's
    //     SECOND, LATER `resolveInstantAoeCasts` call, World.ts:6113-6115,
    //     "discovered too late in tick order to land in the SAME
    //     pendingInstantAoe batch"). Zig's tick order is the MIRROR IMAGE
    //     of TS's here, not the same shape: paper-double stepping
    //     (lifetime countdown in section "2b", projectile-collision health
    //     zeroing in section 4) runs EARLY in stepWorld — well BEFORE this
    //     point — while the AOE resolver (section 6b, directly below) runs
    //     LATE. So every this-tick paper-double death has ALREADY happened
    //     by the time this scan runs, and pushing here lands in the SAME
    //     single 6b resolve pass below — traced and confirmed Zig needs NO
    //     second resolver call, unlike TS (see this pass's own report for
    //     the full ordering trace).
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

    // 6b. Instant AOE resolution (2026-07-20 gap-closure pass — deferred-
    //     write primitive port of World.ts's `pendingInstantAoe`/
    //     `resolveInstantAoeCasts`; see resolveInstantAoeCasts's own doc
    //     comment for the full mitigation accounting). MUST run after
    //     section 6's per-player loop directly above (every player's own
    //     per-tick state — shield/parry/fire — is only final once that
    //     loop has finished for EVERY player) and before section 9's
    //     end-of-tick compaction below. UPDATED (this pass): all 5 cast-
    //     time/hook push sites (wall-bloom, shock-ring, prism-fan,
    //     flock-pulse, shard-ring — section 6z below, plus the wall-kick/
    //     landing hooks in section 8 above) and Paper Double's death/
    //     expiry burst (section 6y directly above) are now real. This one
    //     call drains ALL of them together every tick — see section 6y's
    //     own doc comment for why Paper Double's burst doesn't need (and
    //     doesn't get) a second resolver call the way TS's does.
    if (state.pending_instant_aoe_count > 0) {
        resolveInstantAoeCasts(
            state,
            state.pending_instant_aoe[0..state.pending_instant_aoe_count],
            state.header.tick,
            eff_dt,
        );
        state.pending_instant_aoe_count = 0;
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
    const pc_i32: i32 = @intCast(state.player_count);
    var ei: u32 = 0;
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
