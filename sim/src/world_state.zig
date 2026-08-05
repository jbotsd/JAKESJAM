//! Phase G1b — WorldState extern struct + entity extern structs.
//!
//! This file is the byte-stable cross-host contract for the FULL
//! sim state. The TS World currently owns the canonical
//! `WorldState` shape (client/src/sim/types.ts ~line 376); this
//! Zig mirror is what `step_world` (Phase I) will mutate in place.
//!
//! Layout discipline:
//!   1. `extern struct` — Zig guarantees no implicit reordering;
//!      tail/inter-field padding is what we must pin.
//!   2. f64 fields up front for natural 8-byte alignment, smaller
//!      fields tail-packed, explicit pad bytes where needed.
//!   3. Strings are fixed-size byte buffers + length prefix. Cards
//!      and weapons are ID byte buffers; the TS↔wasm bridge
//!      (Phase G2) maps them to the canonical TS strings.
//!   4. Optional/additive TS fields become `flags` bitfields + raw
//!      values. Absent in TS == flag bit 0 in Zig.
//!   5. `_reserved` tail bytes give us room to grow without
//!      breaking the byte contract — until we hit zero, future
//!      additions land here.
//!
//! Comptime size assertions enforce the layout TODAY so any
//! regression in a downstream cut fails at compile time, not at
//! the next snapshot codec mismatch.

const std = @import("std");

pub const MAX_PLAYERS: usize = 16;
pub const MAX_STATICS: usize = 256;
pub const MAX_EVENTS_PER_TICK: usize = 64;
pub const MAX_PROJECTILES: usize = 256;
pub const MAX_SATELLITES: usize = 32;
pub const MAX_DESTRUCTIBLES: usize = 64;
pub const MAX_FIRE: usize = 32;
pub const MAX_PICKUPS: usize = 32;
/// Paper Double decoys (2026-07-20 gap-closure pass item 3 — Interstice/
/// ninja catalog v1, docs/card-pool-v2.md "Paper Double"; PaperDoubleEntity
/// at client/src/sim/types.ts). Sized the same as MAX_PLAYERS: the card's
/// own cooldown (9s, NINJA_PAPER_DOUBLE_CD_MS) exceeds its max lifetime
/// (2.5s, NINJA_PAPER_DOUBLE_LIFETIME_MS) by a wide margin, so no single
/// player can ever have more than one live decoy — one slot per player is
/// already generous headroom, matching MAX_SATELLITES/MAX_FIRE's own
/// "generous, not exact" sizing convention in this file.
pub const MAX_PAPER_DOUBLES: usize = MAX_PLAYERS;

/// Deferred-write instant-AOE cast queue bound (2026-07-20 gap-closure
/// pass — port of the PATTERN behind World.ts's `pendingInstantAoe`
/// array, World.ts:1609). Sized generously rather than exactly, matching
/// this file's own MAX_SATELLITES/MAX_FIRE convention: the 5 real push
/// sites this queue exists for (wall-bloom, shock-ring, prism-fan,
/// flock-pulse, shard-ring) are each gated on a DISTINCT per-player
/// trigger (a wall-kick edge, a landing edge, an ability-cast edge) that
/// can fire at most once per player per tick per trigger, and
/// MAX_PLAYERS=16 bounds the roster — so even the pathological case of
/// every player queuing from two independent triggers in the same tick
/// (e.g. a wall-kick AND an ability cast landing on the same tick) tops
/// out at 2 × MAX_PLAYERS = 32. See `PendingInstantAoe`'s own doc comment
/// for why the type lives here but the QUEUE STORAGE (this bound sizes)
/// lives on `WorldState` rather than as function-local scratch.
///
/// UPDATED (AOE-queue ability wiring pass): all 5 sites above are now
/// real push sites (world.zig sections 6z/8), plus a 6th SOURCE sharing
/// this same queue — Paper Double's death/expiry burst (section 6y) —
/// that wasn't part of the original 5-trigger sizing math above. Still
/// safely covered: a burst is gated on "this specific decoy died this
/// tick," and `MAX_PAPER_DOUBLES == MAX_PLAYERS` (at most one live decoy
/// per player, per that constant's own doc comment) bounds it to well
/// under the 32-slot headroom even stacked on top of the original 5
/// triggers' own worst case — not re-derived to an exact new bound, same
/// "generous, not exact" convention this whole file already uses; every
/// real push site additionally bounds-checks against this constant before
/// writing (silently drops on overflow, extremely unlikely to ever
/// trigger in real play) rather than assuming the math above holds
/// forever.
pub const MAX_PENDING_INSTANT_AOE: usize = 32;

pub const PLAYER_ID_BYTES: usize = 32;
pub const WEAPON_ID_BYTES: usize = 24;
pub const CARD_ID_BYTES: usize = 24;
pub const MAX_PLAYER_CARDS: usize = 8;
/// Ability-cast dispatch (Phase 1, docs/zig-step-world-parity-goal.md) — the
/// rack is hard-capped at exactly 3 slots, mirroring cardTypes.ts's own
/// `MAX_ABILITY_SLOTS` (client/src/sim/data/cardTypes.ts:191) and
/// PlayerEntity.slot1/2/3CooldownUntilTick's own 3-slot shape (types.ts:649-
/// 651; the TS-only 4th "slot4CooldownUntilTick" field is dead — no input
/// bit or offer-roll path ever populates a 4th slot, per round.ts's own
/// `heldActives >= MAX_ABILITY_SLOTS` gate — so this Zig port mirrors the
/// LIVE 3-slot contract, not the vestigial 4th field).
pub const MAX_ABILITY_SLOTS: usize = 3;
/// Duos-queue team id (class-overhaul-workboard.md chunk 1.1). Generated
/// ids look like `duo-3` / `bot-duo-7` (server/src/venueHost.ts,
/// worldHost.ts) — well under 24 bytes; sized the same as WEAPON_ID_BYTES,
/// the codebase's existing "medium generated id" bucket.
pub const TEAM_ID_BYTES: usize = 24;

/// Round phase tag — mirrors `RoundState.phase` in
/// `client/src/sim/types.ts`. Wire as a single byte.
pub const RoundPhase = enum(u8) {
    countdown = 0,
    fighting = 1,
    round_over = 2,
    drafting = 3,
};

/// Character archetype — mirrors `CharacterArchetype` in TS.
pub const CharacterArchetype = enum(u8) {
    balanced = 0,
    heavy = 1,
    sprinter = 2,
    shielded = 3,
};

/// Projectile pathing tag — 8 variants per `ProjectilePathing`.
pub const ProjectilePathing = enum(u8) {
    straight = 0,
    gravity = 1,
    bounce = 2,
    boomerang = 3,
    homing = 4,
    anti_homing = 5,
    float = 6,
    accelerate = 7,
};

/// Element tag — mirrors `ElementType` in TS.
pub const ElementType = enum(u8) {
    crystal = 0,
    neutral = 1,
    fire = 2,
    ice = 3,
    lightning = 4,
    void_ = 5,
    radiant = 6,
    electric = 7,
    toxic = 8,
    sticky = 9,
    explosive = 10,
};

/// Impact behaviour tag — mirrors `ProjectileImpact` in TS.
pub const ProjectileImpact = enum(u8) {
    none = 0,
    explosive = 1,
    sticky = 2,
    pierce_chain = 3,
    slow_field = 4,
};

/// Projectile shape tag — mirrors `ProjectileShape` in TS.
pub const ProjectileShape = enum(u8) {
    circle = 0,
    triangle = 1,
    square = 2,
    hexagon = 3,
    orb = 4,
    x = 5,
    bar = 6,
};

pub const DestructibleKind = enum(u8) {
    barrel = 0,
    box = 1,
    mine = 2,
    cube = 3,
};

pub const PickupKind = enum(u8) {
    health_shard = 0,
    shield_cell = 1,
    overcharge_core = 2,
    damage_amp = 3,
    speed_boost = 4,
    melee_mode = 5,
    slow_trap = 6,
    vulnerability_trap = 7,
    block_jammer = 8,
    boss_core = 9,
    card_cache = 10,
};

// -----------------------------------------------------------------
// Bit flags. Booleans are packed into u32 fields where they cluster
// so the boundary stays compact. Extending requires only flipping
// an unused bit, never bumping the struct size.

pub const PlayerFlags = packed struct(u32) {
    alive: bool,
    shield_active: bool,
    crouching: bool,
    grounded: bool,
    has_slow: bool,
    has_burn: bool,
    has_freeze: bool,
    has_shield_charge: bool,
    has_parry_active: bool,
    has_parry_cooldown: bool,
    has_overcharge: bool,
    has_damage_amp: bool,
    has_speed_boost: bool,
    has_melee_mode: bool,
    has_slow_debuff: bool,
    has_vulnerability: bool,
    has_block_jammer: bool,
    has_boss_mode: bool,
    has_jetpack_fuel: bool,
    has_parry_facing: bool,
    /// Duos-queue team identity (class-overhaul-workboard.md chunk 1.1).
    /// Gates team_id_len/team_id_bytes below — absent (bit 0) is an
    /// ordinary FFA combatant.
    has_team_id: bool,
    /// Syzygist status substrate extension (class-overhaul-workboard.md
    /// chunk 3.1) — gates regen_until_tick/regen_hps below. Same "unset vs
    /// tick 0" explicit-flag convention as has_burn/has_freeze (these are
    /// window-tick fields, not always-valid resources like energy/kindling,
    /// which need no flag).
    has_regen: bool,
    /// Gates haste_until_tick/haste_multiplier below. Same convention as
    /// has_regen immediately above.
    has_haste: bool,
    /// Syzygist Ward (class-overhaul-workboard.md chunk 3.3) — gates
    /// syz_ward_absorb_until_tick/syz_ward_absorb_remaining below. Same
    /// "unset vs tick 0" explicit-flag convention as has_regen/has_haste
    /// (an optional WINDOW field, not an always-valid resource like
    /// devotion, which needs no flag).
    has_syz_ward: bool,
    _reserved: u8 = 0,
};

pub const ProjectileFlags = packed struct(u32) {
    has_owner: bool,
    has_impact: bool,
    has_split: bool,
    has_slow: bool,
    has_homing: bool,
    has_acceleration: bool,
    has_gravity_scale: bool,
    has_range: bool,
    has_age: bool,
    has_traveled: bool,
    has_origin: bool,
    returning: bool,
    has_sticky_fuse: bool,
    has_impact_radius: bool,
    /// 2026-07-20 gap-closure pass (client/src/sim/types.ts:1004/1013/1014) —
    /// gate bits for the 3 new optional numeric fields below, same
    /// "unset vs 0" ambiguity every other `has_*` bit on this struct
    /// resolves. Given default values (`= false`) so the two existing
    /// ProjectileEntity struct-literal sites in world.zig (weapon-fire spawn
    /// + emission-cast spawn), which explicitly enumerate every flag field,
    /// keep compiling unchanged — neither spawn site produces these extras
    /// yet (that's a separate, later fire-path port).
    has_status_scale: bool = false,
    has_leech_fraction: bool = false,
    has_execute_below_frac: bool = false,
    /// Pure identity/behavior flags (types.ts:1015/1031/1057/1069) — each
    /// IS its own value, no separate has_* gate, same shape as `returning`
    /// above. Defaulted `= false` for the same "existing spawn sites don't
    /// need editing" reason as the has_* trio above.
    wrap_shots: bool = false,
    enemy_only: bool = false,
    tendril: bool = false,
    ninja_wave: bool = false,
    _reserved: u11 = 0,
};

// -----------------------------------------------------------------
// Entity extern structs. Each starts with the largest fields (f64)
// for natural alignment; smaller fields trail.

/// Mirrors `PlayerEntity` in client/src/sim/types.ts.
/// Sized at exactly PLACEHOLDER_PLAYER_BYTES (= 256) — future
/// growth lands in `_reserved`.
pub const PlayerEntity = extern struct {
    // 8-byte fields (28 × 8 = 224 bytes, but we don't fill all of them yet)
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    aim_x: f64,
    aim_y: f64,
    health: f64,
    fire_cooldown_ms: f64,
    ammo: f64,
    ability_charge: f64,
    jetpack_fuel: f64,
    shield_charge: f64,
    shield_max_charge: f64,
    parry_facing: f64,
    burn_dps: f64,
    slow_multiplier: f64,
    freeze_multiplier: f64,

    // Tick-based optional fields. Stored even when unset; the
    // PlayerFlags bit gates "is this active?".
    slowed_until_tick: u32,
    burn_until_tick: u32,
    burn_tick_last_applied: u32,
    freeze_until_tick: u32,
    parry_active_until_tick: u32,
    parry_cooldown_until_tick: u32,
    overcharge_until_tick: u32,
    damage_amp_until_tick: u32,
    speed_boost_until_tick: u32,
    melee_mode_until_tick: u32,
    slow_debuff_until_tick: u32,
    vulnerability_until_tick: u32,
    block_jammer_until_tick: u32,
    boss_mode_until_tick: u32,
    last_processed_input_seq: u32,

    flags: PlayerFlags,
    character_id: CharacterArchetype,
    card_count: u8,
    _pad0: [2]u8 = .{ 0, 0 },

    id_len: u8,
    weapon_id_len: u8,
    _pad1: [6]u8 = .{ 0, 0, 0, 0, 0, 0 },

    id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),
    weapon_id_bytes: [WEAPON_ID_BYTES]u8 = @splat(0),

    /// Per-tick input bitmask for this player (Phase I4). The
    /// orchestrator writes the captured input bits before calling
    /// `step_world`. `prev_keys` holds the previous-tick mask so
    /// edge-detect operations (e.g. parry-on-rising-edge of the
    /// Ability key) work without a host-side memo.
    current_keys: u32,
    prev_keys: u32,

    /// Round-score counter for this player (Phase I5). Increments
    /// when the orchestrator decides this player won the round.
    /// Bridged from / to TS `state.round.scores[playerId]`.
    score: u32,

    /// Per-round kill tally (2026-07-17, parity with TS
    /// `RoundState.roundKills[playerId]`): kills credited to this
    /// player THIS round — attacker known and not the victim
    /// (void/storm/unattributed-burn deaths credit nobody). Reset
    /// when a round's fighting phase begins; drives the time-out
    /// most-kills resolution (world.zig timeoutWinnerIdx). Landed
    /// in the former `_reserved` bytes — struct size unchanged.
    round_kills: u32 = 0,

    /// Ninja class-resource pool (2026-07-18, docs/classes-goal.md MANA
    /// section: "ninja = energy, fast regen, melee hits restore").
    /// UPDATED 2026-07-20 (Phase 1 ability-cast dispatch pass): no longer
    /// "TS-owned only" — `step_world`'s own Ninja Slash hit-resolution
    /// (world.zig's melee section) now mutates this directly, the same
    /// "landed hit restores the rack" grant TS's World.ts always applied
    /// (NINJA_ENERGY_ON_MELEE_HIT per landed hit, plus Second Wind's bonus
    /// top-up while that window is live) — Phase 0's base melee port had
    /// deliberately deferred this exact grant pending an ability-cast
    /// system to hang Second Wind off of; this is that system. Dash-
    /// through and wall-kick energy grants remain TS-owned/un-ported (no
    /// Zig dash-through detection exists yet — see stepMeleeSwing's own
    /// "deliberately NOT ported" list) — only the melee-hit grant crossed
    /// the ownership boundary, not every energy source. f64 after a run of
    /// u32 tail fields forces 4 bytes of alignment padding before it
    /// (284 → 288) — struct grows 288 → 296. Non-ninja players simply
    /// never move this field off 0.
    energy: f64 = 0,

    /// Duos-queue team identity (2026-07-18, class-overhaul-workboard.md
    /// chunk 1.1, docs/classes-goal.md "Venue integration"). Mirrors TS
    /// `PlayerEntity.teamId` exactly — length-prefixed fixed buffer, same
    /// pattern as `id_bytes`/`weapon_id_bytes` above. This is
    /// IDENTITY/ROSTER metadata (same category as character_id/weapon_id),
    /// not ability/window state, so it crosses the ABI unlike Resonance
    /// (six-axes-goal.md "Zig line" excludes only ability state) — any
    /// future Zig-side combat code (friendly-fire / ally-targeting) needs
    /// it visible every tick. `PlayerFlags.has_team_id` gates validity;
    /// absent = ordinary FFA combatant, team_id_bytes reads all zero.
    /// u8 fields need no alignment padding after `energy` (f64, 8-aligned);
    /// struct grows 296 → 321 content bytes, then Zig's implicit tail
    /// padding (extern struct alignment = 8, from the f64 fields) rounds
    /// up to 328 — see the comptime assert below and
    /// worldStateBridge.ts's PLAYER_ENTITY_SIZE.
    team_id_len: u8 = 0,
    team_id_bytes: [TEAM_ID_BYTES]u8 = @splat(0),

    /// Paladin/Kindred class-resource pool (2026-07-18, class-overhaul-
    /// workboard.md chunk 2.3, docs/classes-goal.md MANA section:
    /// "Resource: Kindling from blocked damage... Defense IS the engine").
    /// Originally mutated ONLY by TS `combat.ts`'s Kindled Ward branch of
    /// `tryDeflectDamage` (same TS-owned-resource contract as `energy`
    /// above) — NO LONGER true (Track Z1c "team peel" + "Kindled Ward
    /// partial mitigation" items): `world.zig`'s `applyTeamPeel` (a
    /// warder's own block) and `combat.computeKindledWardMitigation`
    /// (a Paladin's own self-Ward block, consumed at all four damage-
    /// resolution sites) both grant real Kindling in Zig now, mirroring
    /// TS's own two Kindling-granting sites. The `.kindled_resolve`
    /// ABILITY CAST that SPENDS this resource is still TS-only (a
    /// separate, still-open item — see world.zig's ability-dispatch
    /// switch's own `.kindled_resolve` arm comment). Appended after
    /// `team_id_bytes`: that field's own doc comment notes
    /// content ends at byte 321 with 7 bytes of IMPLICIT tail padding
    /// (321 → 328) purely because it used to be the last field. Adding
    /// `kindling` (f64, needs 8-byte alignment) reclaims that padding as
    /// real alignment space instead — Zig places it at offset 328 (321
    /// rounds up to 328), occupying [328, 336). 336 is already an 8-byte
    /// multiple, so there's no further tail padding this time: struct size
    /// grows 328 → 336 exactly (+8, not +7-padding-then-+8 — the old
    /// padding IS the new field's alignment gap). See the comptime assert
    /// below and worldStateBridge.ts's PLAYER_ENTITY_SIZE. Non-paladin
    /// players simply never move this field off 0 — same "additive, zero-
    /// cost for other chassis" contract as `energy`.
    kindling: f64 = 0,

    /// Syzygist status substrate extension (2026-07-18, class-overhaul-
    /// workboard.md chunk 3.1, docs/classes-goal.md Priest/Syzygist:
    /// "extends the existing status-effect substrate... add regen,
    /// haste"). Mirrors TS `PlayerEntity.regenUntilTick`/`regenHps`/
    /// `hasteUntilTick`/`hasteMultiplier` exactly. Unlike `burn_until_tick`/
    /// `freeze_until_tick` above, these are TS-owned/TS-applied (World.ts's
    /// per-tick regen block + speedMul chain, weapon.ts's fire-rate
    /// composition — same "carried through, never computed here" contract
    /// as `energy`/`kindling`, NOT the burn/freeze contract): `step_world`
    /// does not read or mutate these fields. They still need
    /// `PlayerFlags.has_regen`/`has_haste` gates (unlike energy/kindling)
    /// because they're optional WINDOW-tick fields, same "unset vs tick 0"
    /// ambiguity every other `*_until_tick` field on this struct resolves
    /// with an explicit flag.
    ///
    /// Layout: two u32 ticks land at [336, 344) — still 4-byte-aligned
    /// after `kindling`'s f64 (336 is already a multiple of 4), so no gap.
    /// The two f64 rate fields that follow need 8-byte alignment; 344 is
    /// already a multiple of 8, so THEY need no gap either — this is the
    /// one field addition this session that requires zero explicit padding
    /// bytes anywhere. Struct size grows 336 → 360 (+24, no padding). See
    /// the comptime assert below and worldStateBridge.ts's
    /// PLAYER_ENTITY_SIZE.
    regen_until_tick: u32 = 0,
    haste_until_tick: u32 = 0,
    /// Heal-per-second while `regen_until_tick` is live (`has_regen`).
    regen_hps: f64 = 0,
    /// Move-speed + fire-rate multiplier while `haste_until_tick` is live
    /// (`has_haste`).
    haste_multiplier: f64 = 0,

    /// Syzygist Devotion (2026-07-18, class-overhaul-workboard.md chunk
    /// 3.2, docs/classes-goal.md MANA section: "priest = devotion,
    /// generated by buff/heal uptime on others"). Mutated ONLY by TS
    /// World.ts's per-tick Devotion-accrual pass — same TS-owned-resource
    /// contract as `energy`/`kindling`: `step_world` never computes it,
    /// just carries it through. No flag needed (always-valid resource, NOT
    /// an optional window field — same "no gate" contract as
    /// `energy`/`kindling`, not `regen_until_tick`'s). Only priest
    /// (classId) chassis ever move this off 0.
    ///
    /// Layout: `haste_multiplier`'s f64 ends at offset 360, already an
    /// 8-byte multiple, so `devotion` (f64) needs no alignment padding —
    /// struct grows 360 → 368. See the comptime assert below and
    /// worldStateBridge.ts's PLAYER_ENTITY_SIZE.
    devotion: f64 = 0,

    /// Syzygist Ward (2026-07-18, class-overhaul-workboard.md chunk 3.3,
    /// docs/classes-goal.md defense-verb section: "priest = wards, small
    /// absorb barriers, castable on ALLIES"). Mirrors TS
    /// `PlayerEntity.wardAbsorbUntilTick`/`wardAbsorbRemaining` exactly —
    /// same TS-owned/TS-applied contract as `regen_until_tick`/
    /// `regen_hps` above (`step_world` does not compute or consume this;
    /// `combat.ts`'s `trySyzygistWard` does). `PlayerFlags.has_syz_ward`
    /// gates validity, same "unset vs tick 0" ambiguity every other
    /// optional `*_until_tick` field on this struct resolves with an
    /// explicit flag. `wardAbsorbSourceId` (TS-only ability-adjacent
    /// bookkeeping, same category as `facetTargetId`) deliberately has NO
    /// Zig mirror — it never crosses the WASM ABI.
    ///
    /// Layout: `devotion`'s f64 ends at offset 368, already 4-byte-aligned
    /// for the u32 tick that follows (no gap); the f64 remaining-pool field
    /// after IT needs 8-byte alignment, so there's a 4-byte implicit pad
    /// between the two (372 → 376) — the SAME "one leftover u32" shape
    /// `team_id_bytes`→`kindling`'s own transition hit, just smaller.
    /// Struct grows 368 → 384 (+4 content bytes for the u32, +4 bytes
    /// implicit alignment pad, +8 content bytes for the f64 = +16 total).
    /// See the comptime assert below and worldStateBridge.ts's
    /// PLAYER_ENTITY_SIZE.
    syz_ward_absorb_until_tick: u32 = 0,
    /// Absorb pool remaining (`has_syz_ward`). Depleted per-hit by
    /// `combat.ts`'s `trySyzygistWard`, mirrored here as a byte-layout
    /// carry-through only.
    syz_ward_absorb_remaining: f64 = 0,

    /// Wizard basic-fire ramping channel (2026-07-20 gap-closure pass,
    /// constants.ts's GEO_CHANNEL_RAMP_MS doc comment, weapon.ts:243-257).
    /// UNLIKE energy/kindling/devotion above (TS-owned, step_world never
    /// touches), this field IS computed by step_world once this cut lands —
    /// accrues by eff_dt every tick the Fire input bit is held AND
    /// `character_id == .balanced` (== `classIdForArchetype(...) ===
    /// "wizard"`, cardTypes.ts's ARCHETYPE_CLASS_ID map) AND the player is
    /// alive, resets to 0 otherwise (see world.zig's per-player combat
    /// loop). No flag needed — same "always-valid resource, no unset
    /// ambiguity" contract as energy/kindling (0 IS the correct rest
    /// state, not a sentinel), not the `has_*`/`*_until_tick` window-field
    /// contract. Non-wizard players simply never move this field off 0.
    ///
    /// Layout: `syz_ward_absorb_remaining`'s f64 ends at offset 384,
    /// already 8-byte-aligned, so this f64 needs no padding — struct
    /// grows 384 → 392. See the comptime assert below and
    /// worldStateBridge.ts's PLAYER_ENTITY_SIZE (NOTE: that TS constant is
    /// NOT updated by this pass — see this field's own callers in world.zig
    /// and the task-level report for why crossing the wasm ABI for this
    /// field is deliberately deferred; it is read/written by step_world
    /// only, never packed/unpacked by worldStateBridge.ts today).
    channel_hold_ms: f64 = 0,

    // ── Ability-cast dispatch (Phase 1, docs/zig-step-world-parity-goal.md
    //    "the next unblock") ──────────────────────────────────────────────
    // Per-slot cooldown gate — mirrors TS `slot1/2/3CooldownUntilTick`
    // (types.ts:649-651) exactly, just collapsed into one fixed array
    // instead of 3 discrete optional fields (TS's own fields are already a
    // MAX_ABILITY_SLOTS=3 rack, see MAX_ABILITY_SLOTS's own doc comment
    // above) — same "fixed array over discrete numbered fields" shape this
    // file already uses for `slowed_until_tick`-style single window fields
    // vs. this NEW multi-slot case; a `[3]u32` is simpler than 3 separate
    // named fields here because world.zig's dispatch loop is itself
    // generic over `slot` (0..MAX_ABILITY_SLOTS), and indexing a named
    // field per slot would force a switch/ternary at every call site TS
    // itself is forced into (World.ts:2158-2163's own
    // `slot === 0 ? ... : slot === 1 ? ...` chain) — the array sidesteps
    // that entirely. No `has_*` gate needed: 0 is a valid "never on
    // cooldown" rest state, same "always-valid, no unset ambiguity"
    // contract as `channel_hold_ms` above, not the `*_until_tick` window
    // convention (which needs a flag because 0 there could mean either
    // "tick 0" or "unset" — a slot cooldown is always compared with a
    // strict `> tick` gate against a monotonically increasing tick, so 0
    // unambiguously reads as "not on cooldown" from tick 1 onward, and
    // tick 0 itself has no cooldown to gate against).
    slot_cooldown_until_tick: [MAX_ABILITY_SLOTS]u32 = @splat(0),

    // Self-only ability windows for the 6 melee-hook abilities this phase
    // wires end to end (docs/zig-step-world-parity-goal.md Phase 1's own
    // "first real abilities" list). Every field below mirrors an
    // identically-named TS `PlayerEntity` field 1:1 (types.ts:748-757) —
    // plain `u32` ticks, no `has_*` flag, same "0 unambiguously reads as
    // inactive against a monotonic tick counter" reasoning as
    // `slot_cooldown_until_tick` above (every consumption site below gates
    // on `> tick`, and no real match tick is ever 0 by the time an ability
    // could have been cast).
    /// Undercut (Ninja) — non-consuming window; while live, a landed Ninja
    /// Slash arc hit against a victim at/under
    /// `NINJA_UNDERCUT_HEALTH_THRESHOLD` becomes a guaranteed kill.
    undercut_until_tick: u32 = 0,
    /// Edge Storm (Ninja) — charge-bank window; while live AND
    /// `edge_storm_charges_remaining > 0`, the wave-off-swing (world.zig's
    /// melee section) spawns an amplified wave and decrements the charge.
    edge_storm_until_tick: u32 = 0,
    /// Charges remaining in the current Edge Storm window (starts at
    /// `NINJA_EDGE_STORM_CHARGES` on cast, decrements per wave spawned,
    /// window closes early once it hits 0 — mirrors World.ts's
    /// `edgeStormChargesRemaining` exactly). `u32` (not `u8`) purely to
    /// stay consistent with every other small counter on this struct
    /// (`round_kills`, `card_count` is the one `u8` exception and that's
    /// because it long predates this cut) — no alignment cost either way
    /// since it sits in a run of other u32 fields.
    edge_storm_charges_remaining: u32 = 0,
    /// Unbroken Seal (Paladin) — single-use window (not a duration tick
    /// the way the others are "while live, repeatedly"): the NEXT landed
    /// Kindled Edge hit is amplified + staggers the victim, then the
    /// window is explicitly cleared at the consumption site (world.zig's
    /// PALADIN MELEE section), not just left to time out.
    seal_until_tick: u32 = 0,
    /// Second Wind (Ninja) — window; the NEXT landed Ninja Slash hit heals
    /// + grants bonus energy on top of the ordinary per-hit energy grant,
    /// then the window is cleared (single-use, same shape as Seal above).
    second_wind_until_tick: u32 = 0,
    /// Judgment Line (Paladin) — mark window; while live AND
    /// `judgment_target_id_*` matches the victim, a landed Kindled Edge
    /// hit against THAT SPECIFIC victim is amplified (non-consuming — the
    /// mark stays live for every qualifying hit until it times out, unlike
    /// Seal). Paired with `judgment_target_id_len`/`judgment_target_id_bytes`
    /// below.
    judgment_mark_until_tick: u32 = 0,
    /// Read Mark (Ninja) — parallel shape to Judgment Line above, but for
    /// Ninja Slash hits instead of Kindled Edge. Paired with
    /// `read_target_id_len`/`read_target_id_bytes` below.
    read_mark_until_tick: u32 = 0,

    /// Judgment Line's marked victim, stored as a byte-stable id (NOT a
    /// `WorldState.players` array index): unlike `PendingInstantAoe.
    /// caster_idx` (safe as a raw index ONLY because it's pushed and
    /// resolved within the SAME `stepWorld` call, per that field's own doc
    /// comment), a mark must survive MANY ticks — the exact same
    /// multi-tick-lifetime hazard `ProjectileEntity.owner_id_bytes` exists
    /// to avoid ("a projectile can outlive many ticks and the roster is
    /// only guaranteed stable within one"). Mirrors TS `judgmentTargetId`
    /// (a `PlayerId` string, types.ts:748) via the same length-prefixed
    /// fixed buffer convention `id_bytes`/`owner_id_bytes` already use
    /// throughout this file. Zero-length (`judgment_target_id_len == 0`)
    /// reads as "no mark" — every real player id is non-empty, so this is
    /// an unambiguous sentinel, no separate flag needed (same reasoning
    /// `team_id_len == 0` already relies on for `has_team_id`... except
    /// THAT field still carries an explicit flag bit because a team id and
    /// "no cooldown" share the same struct-wide flags convention; here
    /// there is no spare PlayerFlags bit being spent either way, and the
    /// mark is ALWAYS gated by its own `_until_tick > tick` check first, so
    /// the length byte alone is sufficient).
    judgment_target_id_len: u8 = 0,
    _pad_judgment: [3]u8 = .{ 0, 0, 0 },
    judgment_target_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),
    /// Read Mark's marked victim — same byte-stable-id shape as
    /// `judgment_target_id_bytes` above, same sentinel convention.
    read_target_id_len: u8 = 0,
    _pad_read: [3]u8 = .{ 0, 0, 0 },
    read_target_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    // ── AOE-queue ability windows (this pass, docs/zig-step-world-parity-
    //    goal.md Phase 1's second unblock — Wall Bloom/Shock Ring, the two
    //    hook-gated abilities in the "Wall Bloom, Shock Ring, Prism Fan,
    //    Flock Pulse, Shard Ring, Paper Double's burst" AOE-queue group).
    //    Both are single-use windows consumed at a MOVEMENT hook (section
    //    8's per-player physics loop in world.zig — wall-kick edge for Wall
    //    Bloom, landing edge for Shock Ring), not at a melee-hit site like
    //    the 6 Phase 1 abilities above — same "0 unambiguously reads as
    //    inactive against a monotonic tick counter" convention, no `has_*`
    //    flag needed.
    /// Wall Bloom (Ninja) — window opened by the cast; consumed on THIS
    /// player's next wall-kick (world.zig section 8, mirrors World.ts's
    /// `wallBloomUntilTick`, types.ts). Cleared on consumption, not just on
    /// timeout.
    wall_bloom_until_tick: u32 = 0,
    /// Shock Ring (Paladin) — window opened by the cast (alongside a hop
    /// impulse written directly to `vy` at the cast site); consumed on
    /// THIS player's next landing (world.zig section 8, mirrors World.ts's
    /// `shockRingArmedUntilTick`). Cleared on consumption, not just on
    /// timeout.
    shock_ring_armed_until_tick: u32 = 0,

    /// Ward shell (Phase 5, docs/zig-step-world-parity-goal.md wire-contract
    /// cleanup — one of the 2 "accidental field gaps" the original audit
    /// flagged). Mirrors TS `PlayerEntity.wardShellUntilTick` (types.ts,
    /// six-axes-goal.md Layer 1: set at Emission cast when the hand's Ward
    /// axis is charged). Unlike `regenTickLastApplied` — this pass's other
    /// flagged item, RE-VERIFIED and found to be a false positive: it's
    /// pure TS-internal rate-limit bookkeeping for World.ts's own regen
    /// tick, absent from both hash.ts and snapshotDeltaBits.ts, never wire-
    /// visible — this field IS genuinely wire-relevant: hash-mixed
    /// (hash.ts:127) and delta-bit-tracked (snapshotDeltaBits.ts:64), and
    /// it gates a real mitigation-order step ("parry > shell > shield",
    /// World.ts:1672) another player needs to see. Same carry-through-only
    /// contract as `regen_until_tick`/`haste_until_tick` above (`step_world`
    /// does not itself apply EMISSION_WARD_DAMAGE_MULT anywhere in its own
    /// melee/projectile damage math today — this field crosses the ABI
    /// structurally so a value written by the live TS-authoritative path
    /// round-trips correctly; wiring step_world's OWN damage resolution to
    /// read it is a separate, not-yet-scoped follow-up, not silently
    /// assumed done by this field's mere presence). No `has_*` flag needed
    /// — 0 unambiguously reads "no shell" against a monotonic tick, same
    /// convention as every window field on this struct.
    ward_shell_until_tick: u32 = 0,

    /// Phase 4a self-only window buffs (docs/zig-step-world-parity-goal.md
    /// "4a. Self-only window buffs" — Sunlance/Overclock/Measure,
    /// Geometrician catalog v1). Mirror TS `PlayerEntity.sunlanceUntilTick`/
    /// `overclockUntilTick`/`measureUntilTick` (types.ts:719/722/723)
    /// exactly — plain `u32` ticks, no `has_*` flag, same "0 unambiguously
    /// reads inactive against a monotonic tick" convention every other
    /// window field on this struct already uses. Consumed at world.zig's
    /// weapon-fire section (the damage/spread/fire-rate composition chain
    /// mirroring weapon.ts:336-423/558-565) — NOT self-write-only like the
    /// melee-hook windows above; these are read by a DIFFERENT section
    /// (section 6) than the one that opens them (section 6z), so a cast
    /// this tick affects the FOLLOWING tick's fire, matching the real
    /// section-6-before-section-6z tick order (see `stepAbilityDispatch`'s
    /// own ordering doc comment) — TS has the identical one-tick lag
    /// (World.ts's ability-cast switch also runs after that tick's
    /// `stepWeapon` call in its own per-player loop).
    sunlance_until_tick: u32 = 0,
    overclock_until_tick: u32 = 0,
    /// Measure (reworked 2026-07-19 — see types.ts's own field comment for
    /// the "not the original +1-ammo v1" history). Composes with Sunlance
    /// (above) at the SAME damage-priority chain (Sunlance wins if both are
    /// somehow live) and with Overclock (above) at the spread chain (Measure
    /// forces 0, beating Overclock's partial tightening) — see world.zig's
    /// GEO_MEASURE_*/GEO_OVERCLOCK_*/GEO_SUNLANCE_* constants for the exact
    /// priority order, bit-matched against weapon.ts.
    measure_until_tick: u32 = 0,
    // Return Glass / Bastion Pulse (Phase 4a) deliberately have NO field
    // here — both are INSTANT self-shield-charge ticks applied directly to
    // the existing `shield_charge` field at cast time (world.zig's
    // `stepAbilityDispatch`), not timed windows. See
    // GEO_RETURN_GLASS_SHIELD_REFUND/KIN_BASTION_PULSE_SHIELD_REFUND's own
    // doc comments in world.zig.

    /// Phase 4b (docs/zig-step-world-parity-goal.md "4b. Targeting/
    /// marking") — Facet Break (Wizard) mark window; while live AND
    /// `facet_target_id_*` matches the victim, a landed RANGED hit (any
    /// weapon-fire shot, not a melee hook) against THAT SPECIFIC victim is
    /// amplified — non-consuming, same "stays live for every qualifying
    /// hit until it times out" shape as `judgment_mark_until_tick`, just
    /// consumed at the generic ranged-hit-resolution site (world.zig
    /// section 4's per-projectile-vs-player loop) instead of
    /// `stepMeleeSwing`, mirroring World.ts `resolveRangedHit`'s own
    /// post-mitigation amp chain (facetTargetId/facetMarkUntilTick,
    /// types.ts:720-721). Paired with `facet_target_id_len`/
    /// `facet_target_id_bytes` below.
    facet_mark_until_tick: u32 = 0,
    /// Focus Hex (Priest) — parallel shape to Facet Break immediately
    /// above (mirrors World.ts `focusHexTargetId`/`focusHexMarkUntilTick`,
    /// types.ts:457-458), same consumption site, different mark pair and
    /// multiplier (`SYZ_FOCUS_HEX_AMP_MULTIPLIER`, world.zig).
    focus_hex_mark_until_tick: u32 = 0,

    /// Facet Break's marked victim, same byte-stable-id shape as
    /// `judgment_target_id_bytes`/`read_target_id_bytes` above (a mark
    /// must survive many ticks, so a raw `WorldState.players` index is
    /// unsafe — see `judgment_target_id_len`'s own doc comment for the
    /// full reasoning), same zero-length "no mark" sentinel convention.
    facet_target_id_len: u8 = 0,
    _pad_facet: [3]u8 = .{ 0, 0, 0 },
    facet_target_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),
    /// Focus Hex's marked victim — same byte-stable-id shape as
    /// `facet_target_id_bytes` immediately above.
    focus_hex_target_id_len: u8 = 0,
    _pad_focus_hex: [3]u8 = .{ 0, 0, 0 },
    focus_hex_target_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    /// Kindled Resolve (Paladin, docs/zig-step-world-parity-goal.md Phase
    /// 4a follow-up — genuinely absent before this cut, unlike Hard
    /// Aperture/Self-Lattice's sibling fields, which already existed).
    /// Self-only window: while `kindled_resolve_until_tick > tick`, this
    /// player's OUTGOING damage is amplified
    /// (KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER) and incoming stagger/slow
    /// multipliers aimed AT them are softened toward 1
    /// (KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION) — mirrors TS
    /// `PlayerEntity.kindledResolveUntilTick` (types.ts:803), whose own doc
    /// comment says it "never crosses the Zig ABI" — that refers to the
    /// OLD movement-only wasm bridge (worldStateBridge.ts), not this
    /// struct: `step_world` needs its own copy to run the ability itself,
    /// same precedent `sunlance_until_tick`/`overclock_until_tick`/
    /// `measure_until_tick` above already set for other TS-ABI-invisible
    /// window fields. Plain `u32` tick, no `has_*` flag, same "0
    /// unambiguously reads inactive" convention as every sibling window
    /// field on this struct.
    kindled_resolve_until_tick: u32 = 0,

    /// Ghost Guard (Ninja, this pass — docs/zig-step-world-parity-goal.md,
    /// deferred in Phase 4a, corrected finding this pass: the earlier
    /// deferral's "no Zig `dashing` substrate at all" reasoning does NOT
    /// actually gate this ability — verified directly against combat.ts's
    /// `tryDeflectDamage`, Ghost Guard's own branch (step 0.6) has no
    /// `player.dashing` check at all, only a class check + this window +
    /// the victim's OWN current velocity magnitude (see
    /// `combat.NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD`). Banked evasion
    /// charge: while `ghost_guard_charge_until_tick > tick` AND the
    /// (ninja) victim is moving fast enough, the NEXT incoming hit
    /// (melee, ranged, or instant-AOE) is fully evaded and the charge is
    /// consumed — mirrors TS `PlayerEntity.ghostGuardChargeUntilTick`
    /// (types.ts:583). Plain `u32` tick, 0 = inactive, same convention as
    /// every sibling window field on this struct. Consumed at 3 sites:
    /// `stepMeleeSwing`, section 4's projectile-hit loop, and
    /// `resolveInstantAoeCasts` — see each site's own doc comment.
    ghost_guard_charge_until_tick: u32 = 0,

    /// Razor Route (Ninja, this pass — docs/zig-step-world-parity-goal.md,
    /// deferred in Phase 4c, corrected finding this pass: the earlier
    /// deferral's "needs the dash-through body-cross substrate... that's
    /// real, separate, melee-hook-shaped work" reasoning held at the time,
    /// but the substrate itself turns out cheap once actually
    /// investigated — see world.zig section 8's own dash-through detection
    /// block for the full citation). Cast opens this window; consumed by
    /// the NEXT dash's rising edge (`state.player_movement[i].
    /// dash_active_ms > 0.0`, which IS the derived Zig equivalent of TS's
    /// `attacker.dashing === true` — player.zig's own dash-timer memory
    /// already tracks exactly this, just not as a wire-visible
    /// PlayerEntity boolean). Mirrors TS `PlayerEntity.razorRouteUntilTick`
    /// (types.ts:585). Plain `u32` tick, 0 = inactive, same convention as
    /// every sibling window field on this struct.
    razor_route_until_tick: u32 = 0,

    /// Mid-round fast-respawn stamp (Track Z0b Item A — parity with TS
    /// `PlayerEntity.respawnAtTick`, Jake's fast-respawn ruling
    /// 2026-07-17): the tick this dead player re-forms at a spawn seal.
    /// Stamped by `stepWorld`'s end-of-tick death diff (was-alive →
    /// not-alive this tick, no stamp yet) at `tick + ceil(RESPAWN_DELAY_MS
    /// / eff_dt)`; consumed by the same block once due, IF the round phase
    /// is `fighting` and sudden death is NOT active (sudden death keeps
    /// last-one-standing — no re-forming). `0` = no scheduled respawn
    /// (unambiguous: a real stamp is always `tick + delay >= 1`), mirroring
    /// TS's `undefined` — same sentinel convention as
    /// `PickupEntity.respawn_at_tick`. UNLIKE the Zig-only window fields
    /// above, this field IS bridged (worldStateBridge.ts pack/unpackPlayer
    /// read/write offset 620): the full-sync path repacks the whole struct
    /// every tick, so an unbridged stamp would be wiped before it ever came
    /// due.
    respawn_at_tick: u32 = 0,

    /// Alternating-hand shuriken throws (Track Z0b Item B — port of
    /// orphaned-branch commit 888345c; parity with weapon.ts's
    /// `throwHandParity`, types.ts:895): toggled 0/1 on every FIRE EVENT
    /// (once per trigger pull, NOT per pellet — a multi-shot spread's
    /// pellets all share one muzzle origin) so the muzzle position
    /// alternates lead/back hand. Without this, world.zig's fire-spawn
    /// section couldn't know which hand fired last and every shot's spawn
    /// position AND fired angle diverged from TS (the audit measured
    /// 10.84px vs 47.32px same-tick travel). Bridged like
    /// `respawn_at_tick` above (offset 624): the full-sync path repacks
    /// every tick, and TS's own weapon.ts toggles the SAME field on the
    /// TS-authoritative path — both sides must see one shared parity bit.
    /// TS packs `(throwHandParity ?? 1) & 1` — undefined reads as 1, so
    /// the first-ever shot toggles to hand 0 on both sides.
    throw_hand_parity: u8 = 0,
    /// Explicit pad to the next 4-byte boundary (625 → 628) — was the [7]u8
    /// full tail pad until Track Z0c Item A reclaimed its last 4 bytes for
    /// `recoil_step_until_tick` below.
    _pad_throw_hand: [3]u8 = .{ 0, 0, 0 },
    /// Recoil Step's rider window (Track Z0c Item A — closes the
    /// `.recoil_step` Phase 4a deferral now that the recoil substrate
    /// exists): while `recoil_step_until_tick > tick`, this player's OWN
    /// fire self-knockback is scaled by GEO_RECOIL_STEP_RECOIL_MULTIPLIER
    /// at world.zig's fire site. Mirrors TS `PlayerEntity.
    /// recoilStepUntilTick` (types.ts:724). Plain `u32` tick, 0 =
    /// inactive, same convention as every sibling window field — but
    /// UNLIKE those Zig-only windows, this one IS bridged (offset 628,
    /// same reasoning as `respawn_at_tick`: the full-sync path repacks
    /// every tick, and TS's own ability cast opens the SAME window on the
    /// TS-authoritative path — both sides must share one clock).
    recoil_step_until_tick: u32 = 0,

    /// Rally Light aura-source window (Track Z1a item 3 — the ally
    /// substrate port; mirrors TS `PlayerEntity.rallyLightUntilTick`,
    /// World.ts's "rally-light" case). While live, THIS player is an
    /// aura SOURCE: they and every ally within KIN_RALLY_LIGHT_RADIUS_PX
    /// (world.zig's hasRallyLightSource) get the move + ranged/AOE damage
    /// multipliers. Plain `u32` tick, 0 = inactive — and BRIDGED (offset
    /// 632, same reasoning as `recoil_step_until_tick` above: the
    /// full-sync path repacks every tick, and TS's own cast opens the
    /// same window on the TS-authoritative path).
    rally_light_until_tick: u32 = 0,
    /// Aegis Share window (Track Z1a item 3 — mirrors TS
    /// `PlayerEntity.aegisShareUntilTick`, World.ts's "aegis-share"
    /// case): widens THIS player's team-peel warder radius for allies.
    /// CARRIED + cast-writable; its reader (`findTeamPeelWarder`) is the
    /// still-unported team-peel Z1 item — the window crossing the ABI
    /// correctly NOW is what lets that later port consume it without a
    /// second growth cut (and the cast's solo Kindling fallback is live
    /// either way). Bridged at offset 636, same contract as
    /// rally_light_until_tick.
    aegis_share_until_tick: u32 = 0,
    /// Borrowed Time's pending debt (Track Z1a item 3 — mirrors TS
    /// `PlayerEntity.debtUntilTick`/`debtAmount`, types.ts:475): the tick
    /// the flat drain lands (section 8b's debt block), 0 = no pending
    /// debt (a real stamp is always tick+1+delay ≥ 1). Bridged at offset
    /// 640 (with `debt_amount` at 648 after the explicit pad) — an
    /// unbridged debt would be wiped by the next repack and never land.
    debt_until_tick: u32 = 0,
    /// Explicit pad to 8-byte alignment for the f64 below (644 → 648) —
    /// same explicit-pad shape as `_pad_throw_hand` above.
    _pad_debt: [4]u8 = .{ 0, 0, 0, 0 },
    /// The drain `debt_until_tick` applies (health floored at 0, never
    /// alive-flipped — mirrors World.ts's debt-resolution block exactly).
    debt_amount: f64 = 0,
};

/// Mirrors `ProjectileEntity`.
pub const ProjectileEntity = extern struct {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    radius: f64,
    damage: f64,
    lifetime_ms: f64,
    age_ms: f64,
    traveled_px: f64,
    origin_x: f64,
    origin_y: f64,
    homing_strength: f64,
    acceleration_multiplier: f64,
    gravity_scale: f64,
    range_px: f64,
    slow_multiplier: f64,
    sticky_fuse_ms: f64,
    impact_radius_px: f64,

    id: u32,
    bounces_remaining: u32,
    pierce_remaining: u32,
    split_count: u32,

    flags: ProjectileFlags,
    pathing: ProjectilePathing,
    element: ElementType,
    impact: ProjectileImpact,
    shape: ProjectileShape,

    owner_id_len: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },

    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    /// 2026-07-20 gap-closure pass — the 3 remaining ProjectileEntity fields
    /// from client/src/sim/types.ts (statusScale:1004, leechFraction:1013,
    /// executeBelowFrac:1014), gated by has_status_scale/has_leech_fraction/
    /// has_execute_below_frac above (types.ts's wrapShots/enemyOnly/tendril/
    /// ninjaWave are plain booleans, already fully represented by
    /// ProjectileFlags's own new bits — no numeric storage needed for
    /// those 4). owner_id_bytes ends at offset 204 (172 + 32), a multiple
    /// of 4, so three f32 fields (4-byte aligned, no f64 alignment demand)
    /// slot in with zero padding: 204 → 216 exactly — the struct's
    /// documented 216-byte size is UNCHANGED. f32 (not f64) is the only
    /// choice that fits: the tail this replaces was `_reserved: [12]u8`
    /// (12 bytes) and 3×f64 needs 24; 3×f32 needs exactly 12. This is also
    /// not merely a size-saving preference — worldStateBridge.ts's
    /// `PROJECTILE_ENTITY_SIZE = 216` constant (client/src/sim/wasm/
    /// worldStateBridge.ts) is a TS file outside this pass's touch scope,
    /// so growing this struct at all was not an available option here
    /// without also editing that file. Precision tradeoff: these three
    /// TS `number` fields (status multipliers / health fractions, never
    /// raw pixel/velocity magnitudes) round-trip through f32 with ~7
    /// significant decimal digits — ample for values like "×2 status
    /// duration" or "0.15 leech fraction" or "0.2 execute threshold".
    /// _reserved is now fully consumed — any FUTURE ProjectileEntity
    /// addition needs its own struct-growth cut (see PlayerEntity's own
    /// growth-history comments below the comptime asserts for the pattern
    /// this file already follows for that).
    ///
    /// BRIDGED (2026-07-20, docs/zig-step-world-parity-goal.md Phase 5,
    /// wire-contract-cleanup stage): packProjectile/unpackProjectile in
    /// worldStateBridge.ts now read/write these 7 fields (PROJ_FLAG_BITS
    /// bits 14-20 gate/carry them), same treatment homingStrength/
    /// accelerationMultiplier already had. One name drift found while
    /// bridging: TS's `ninjaWave` (referenced in this file's own comment
    /// above) was itself renamed to `ninjaBladeShard` in types.ts on this
    /// same date, before ever crossing to Zig — `ninja_wave` here is still
    /// the pre-rename name; same bit, same semantics, TS's bridge maps
    /// `ninjaBladeShard` onto this field. Also found in the process: TS's
    /// ProjectileEntity has grown an 8th optional field since this struct
    /// was last touched, `kindledThrust` (Sunspike's identity flag,
    /// types.ts:1084, a pure boolean like `tendril`/`wrap_shots` above) —
    /// no Zig-side field or flag bit exists for it yet. Out of scope for
    /// this bridging-only pass (it wasn't one of the 7 fields already
    /// present on the Zig side); ProjectileFlags's own `_reserved: u11`
    /// tail still has room for a bit if a future pass wants to add it,
    /// this struct's byte layout does not need to grow. Flagged here for
    /// whoever does the next ProjectileEntity growth cut.
    status_scale: f32 = 0,
    leech_fraction: f32 = 0,
    execute_below_frac: f32 = 0,
};

/// Mirrors `SatelliteEntity`.
pub const SatelliteEntity = extern struct {
    angle: f64,
    orbit_radius: f64,
    fire_cooldown_ms: f64,
    lifetime_ms: f64,

    id: u32,
    has_owner: u32, // 0/1; padded to keep 8-byte alignment

    owner_id_len: u8,
    _pad0: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },

    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    _reserved: [16]u8 = @splat(0),
};

/// Mirrors `DestructibleEntity`.
pub const DestructibleEntity = extern struct {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    health: f64,

    id: u32,
    flags: u32, // bit0=explosive, bit1=flammable
    kind: DestructibleKind,
    _pad0: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },

    _reserved: [8]u8 = @splat(0),
};

/// Mirrors `FireEntity`.
pub const FireEntity = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    remaining_ms: f64,
    damage_per_second: f64,

    id: u32,
    has_owner: u32,
    owner_id_len: u8,
    _pad0: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },
    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),
};

/// Mirrors `PaperDoubleEntity` (2026-07-20 gap-closure pass item 3 —
/// client/src/sim/types.ts:1197-1221, client/src/sim/paperDouble.ts). A
/// straight-line kinematic mover (no platform collision/gravity, per
/// types.ts's own header comment) that both self-expires on a clock AND
/// collides with projectiles — same overall shape as `DestructibleEntity`
/// above, cloned field-for-field with that struct's layout discipline
/// (f64s first, id, then a length-prefixed owner id buffer padded to an
/// 8-byte boundary, `_reserved` tail for future growth room). Unlike
/// `FireEntity`'s `has_owner` (world-owned fire patches exist), a decoy
/// ALWAYS has a living owner (types.ts: "never null") — no has_owner flag
/// needed.
///
/// CROSSES the wasm ABI as of Track E1c (gospel-goal.md, the Paper
/// Double bridge): worldStateBridge.ts's packPaperDouble/unpackPaperDouble
/// round-trip this struct field-for-field every full-sync tick. The
/// original 2026-07-20 cut deliberately had NO ABI crossing ("TS-only
/// combat/ability state" per the six-axes Zig line), but that stopped
/// being tenable the moment world.zig's `.paper_double` cast arm + full
/// step/collide/compact pipeline landed: the full-sync hosts repack the
/// whole buffer every tick, so an unbridged decoy — whether TS-spawned or
/// Zig-spawned — was wiped one tick after it appeared (the Z0e/Z1a/Z2
/// wipe-on-repack bug class; wave-1's split-spawn lane had to drive
/// stepWorld natively in tests because of exactly this). Field offsets
/// are pinned by comptime asserts next to the size assert below, and
/// offset_paper_doubles()/sizeof_paper_double_entity() pin the section
/// placement against the TS bridge's own derivation.
pub const PaperDoubleEntity = extern struct {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    health: f64,
    remaining_ms: f64,

    id: u32,
    owner_id_len: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },

    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    _reserved: [8]u8 = @splat(0),
};

/// Deferred-write instant-AOE cast (2026-07-20 gap-closure pass) — port of
/// the PATTERN (not yet any of the abilities) behind World.ts's
/// `PendingInstantAoe` type (World.ts:1589-1608) + `pendingInstantAoe`
/// queue (World.ts:1609) + `resolveInstantAoeCasts` (World.ts:3675-3821).
/// TS's own header comment on this type (World.ts:1580-1588) names the
/// exact hazard it exists to avoid: writing damage into ANOTHER player's
/// entity while still mid-way through the per-player loop risks that
/// write being silently clobbered once that OTHER player's own turn runs
/// later in the same tick. Queuing here and resolving in one dedicated
/// pass strictly AFTER every player's per-tick turn has finished (world.zig
/// section "6b", after section 6's per-player loop, before section 9's
/// end-of-tick compaction) is the fix — same category as the swing-phase/
/// melee-memory structs already in this file (PlayerMovementMemory below):
/// a non-wire-contract, host-only intermediate type that never crosses the
/// wasm ABI (no push-site/ability-cast system exists in Zig yet — see this
/// pass's own report for what's deliberately NOT wired).
///
/// Field set mirrors TS's `PendingInstantAoe` exactly (verified against
/// the type + all 5 real `pendingInstantAoe.push(...)` call sites —
/// wall-bloom, shock-ring, prism-fan, flock-pulse, shard-ring — grepped
/// directly, not guessed): `kind` (TS: string, "carried through only for
/// future debugging/telemetry, never branched on in the resolution pass"
/// per its own doc comment) is DELIBERATELY omitted here — a purely
/// cosmetic field with zero behavioral effect in TS, and no Zig-side
/// debugging harness consumes it yet. `element` is ALSO absent — checked
/// directly: none of the 5 push sites set one, and the TS type has no such
/// field at all, so a Zig element field would be inventing surface TS
/// doesn't have.
///
/// `caster_idx` is a plain array INDEX into `WorldState.players`, not a
/// copy of `PLAYER_ID_BYTES` (contrast `ProjectileEntity.owner_id_bytes`,
/// which DOES need a byte-stable id because a projectile can outlive many
/// ticks and the roster is only guaranteed stable within one). A pending
/// cast is pushed and resolved within the SAME `stepWorld` call, and
/// `WorldState.player_count`/index assignment never changes mid-tick
/// (joins/leaves are host-side, applied between ticks) — so the index is
/// always valid at resolve time, and skips a 32-byte copy × 32 queue slots
/// for no benefit.
///
/// Cone fields (`aim_angle`/`cone_radians`) mirror TS's optional
/// `aimAngle?`/`coneRadians?` pair (Prism Fan only, "both present or both
/// absent" per TS's own comment) via `has_cone` — same "unset vs 0"
/// explicit-flag convention `PlayerFlags` uses throughout this file, since
/// 0 is a valid cone angle. Same shape for `slow_multiplier`/
/// `slow_duration_ms` (`has_slow`; Flock Pulse) and `fooled_duration_ms`
/// (`has_fooled`; Paper Double's burst, TS: `fooledDurationMs?`).
///
/// STORAGE NOTE: unlike `PlayerMovementMemory`/`ResolvedFireConfig` (both
/// WorldState fields precisely because they must SURVIVE across ticks —
/// movement memory carries coyote-time state tick-to-tick, fire config is
/// host-patched once and read many times), this queue's CONTENTS are
/// meaningless before this tick's section 6 runs and drained back to empty
/// by the end of this same tick's section 6b. Even so, the array is still a
/// `WorldState` field (not stepWorld-local stack scratch): `world.zig`'s
/// tests construct a `WorldState` directly and hand-push entries onto it
/// BEFORE calling `stepWorld` (the exact `state.paper_doubles[0] = .{...}`
/// precedent test/smoke.zig already uses for Paper Double) — a
/// function-local array has no seam a test running through the real
/// `stepWorld` entry point could reach. `resolveInstantAoeCasts` resets
/// `pending_instant_aoe_count` to 0 once it has drained the queue every
/// tick, so stale entries never survive past the tick that queued them.
pub const PendingInstantAoe = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    damage: f64,
    aim_angle: f64 = 0,
    cone_radians: f64 = 0,
    slow_multiplier: f64 = 0,
    slow_duration_ms: f64 = 0,
    fooled_duration_ms: f64 = 0,

    /// Index into `WorldState.players` at push time (see doc comment
    /// above for why an index, not an id-byte copy, is safe here).
    caster_idx: u32,
    has_cone: u8 = 0,
    has_slow: u8 = 0,
    /// Stored for forward-compat (Paper Double's burst — a SECOND, later
    /// batch through this same resolver, per this pass's own report) but
    /// NOT applied by `resolveInstantAoeCasts` yet: it would write to a
    /// `fooled_until_tick` field that does not exist on `PlayerEntity`
    /// today (Paper Double's burst debuff is TS-only ability state, same
    /// "additive growth cut needed first" contract as `channel_hold_ms`'s
    /// own doc comment above). A future PlayerEntity growth pass adds the
    /// field + flag; this queue entry already carries the value so that
    /// pass only has to touch the resolver, not every push site again.
    has_fooled: u8 = 0,
    _pad: u8 = 0,
};

/// Per-player movement memory — the host-only fields that the
/// player.zig stepPlayer kernel needs to thread across ticks
/// (coyote time, jump buffer, jump-cut flag, grounded-last-frame,
/// jetpack active). Indexed parallel to `WorldState.players`.
pub const PlayerMovementMemory = extern struct {
    coyote_ms: f64,
    jump_buffer_ms: f64,
    // Deep-movement augment memory (double-jump + dash). f64s first for align.
    dash_cooldown_ms: f64 = 0,
    dash_active_ms: f64 = 0,
    dash_recovery_ms: f64 = 0,
    jump_cut_applied: u8,
    jump_released_since_jump: u8,
    grounded_last_frame: u8,
    jetpack_active: u8,
    /// Wall contact from last tick: -1 left, +1 right, 0 none (SMB wall movement).
    touching_wall_dir: i8 = 0,
    air_jumps_used: i8 = 0,
    dash_used_in_air: i8 = 0,
    _pad: [1]u8 = .{0},
};

/// Swing phase tag for `MeleeSwingMemory.phase` — mirrors the shape of TS's
/// `NinjaSlashPhase`/`PaladinEdgePhase` (both `0 | 1 | 2 | 3` unions,
/// World.ts:357-360/431-435): idle(0, ready) -> windup(1, readable tell)
/// -> active(2, contact-delay-gated hit-check window) -> recovery(3,
/// endlag, no re-swing) -> idle(0).
pub const MeleeSwingPhase = enum(u8) {
    idle = 0,
    windup = 1,
    active = 2,
    recovery = 3,
};

/// Per-player melee swing FSM memory (2026-07-20, base-melee-mechanic
/// gap-closure pass) — Ninja Slash + Paladin Kindled Edge share ONE slot
/// per player (unlike TS's two separate `melee`/`paladinMelee` Maps,
/// World.ts:343-354): a given player is exactly one chassis at a time
/// (`character_id` is singular), so a combined struct is sufficient and
/// simpler than mirroring TS's two-Map split, which exists there mainly
/// because Ninja's memory carries extra dash-through/wave bookkeeping this
/// port deliberately does NOT carry (see world.zig's melee step section
/// doc comment for the full "what's not ported" list) — with those fields
/// gone, nothing left to distinguish the two shapes.
///
/// Host-only, off-wire — same split as `PlayerMovementMemory` immediately
/// below: swing timing never touches WorldState's wire-visible fields
/// directly, only its CONSEQUENCES (health/velocity/events) do, and
/// player.zig's own dash-timer memory is this file's existing precedent
/// for "per-player scratch that's a deterministic function of replayed
/// inputs, so it never needs to cross the wasm ABI to stay in sync between
/// prediction and authority." Indexed parallel to `WorldState.players`,
/// same convention as `player_movement`.
pub const MeleeSwingMemory = extern struct {
    /// ms remaining in the current phase; 0/irrelevant when phase == .idle.
    phase_ms: f64 = 0,
    /// Swing direction captured at windup start (unit vector, attacker's
    /// position toward their aim cursor at that instant) — reused by the
    /// arc hit-check for the WHOLE swing so a target drifting mid-swing
    /// doesn't "steer" the blade. Mirrors NinjaMeleeMemory.aimX/aimY /
    /// PaladinMeleeMemory.aimX/aimY (World.ts:373-377/451-454).
    aim_x: f64 = 1,
    aim_y: f64 = 0,
    /// Melee input buffer (slash-feel-ledger R1 row 1, 2026-07-24): ms
    /// remaining in the buffered-press window; 0 = nothing queued. A Fire
    /// press while mid-swing queues here for MELEE_BUFFER_MS (world.zig)
    /// and fires at phase 0 — the same tick recovery expires. Mirrors
    /// NinjaMeleeMemory.bufferedMs / PaladinMeleeMemory.bufferedMs.
    buffered_ms: f64 = 0,
    /// Cursor point (absolute aim coords, NOT a unit vector) captured at
    /// the buffered press tick — the queued swing fires toward where the
    /// player aimed WHEN THEY PRESSED, resolved against the attacker's
    /// position at fire time. Mirrors bufferedAimX/bufferedAimY.
    buffered_aim_x: f64 = 0,
    buffered_aim_y: f64 = 0,
    /// Victim bitmask already hit by the CURRENT swing's active window —
    /// one bit per player index (MAX_PLAYERS=16 fits a u16 exactly).
    /// Mirrors NinjaMeleeMemory.hitThisSwing / PaladinMeleeMemory.
    /// hitThisSwing (`Set<PlayerId>` in TS) — a bitmask is the natural
    /// extern-struct-safe equivalent for a fixed MAX_PLAYERS roster.
    hit_this_swing_mask: u16 = 0,
    phase: MeleeSwingPhase = .idle,
    /// Chain position (0/1 = ordinary swings, 2 = the current/next swing is
    /// the chain's THIRD BEAT): Kindled's SHIELD BASH (2026-07-24,
    /// slash-feel-ledger design-decision block) — mirrors
    /// PaladinMeleeMemory.chainIndex — or Ninja's own STAB (2026-07-26,
    /// finish-line-goal.md Track F1) — mirrors NinjaMeleeMemory.chainIndex.
    /// Shared field, same "a player is exactly one chassis at a time"
    /// reasoning this struct's own header comment gives for combining the
    /// two FSMs onto one slot; each class advances/resets ITS OWN chain
    /// using ITS OWN gap constant (KIN_BASH_CHAIN_GAP_MS /
    /// NINJA_STAB_CHAIN_GAP_MS) — a player is never both, so there is no
    /// cross-class interference. Advances per STARTED swing at
    /// recovery→idle; resets after the class's own gap constant worth of
    /// idle (chain_gap_ms below) or on death. Reclaims the old _pad byte —
    /// no size change from this field.
    chain_index: u8 = 0,

    /// Razor Route substrate (this pass, docs/zig-step-world-parity-
    /// goal.md) — dash-through body-cross detection, the Zig mirror of
    /// NinjaMeleeMemory's own `dashThroughTagged`/`wasDashing`/
    /// `razorRouteActiveDash` fields (World.ts:403-419), which this
    /// struct's own header comment previously said were deliberately NOT
    /// carried (true when this comment was written — Zig had no melee
    /// mechanic to hang dash-through off yet; ninja melee/dash-through are
    /// independent verbs sharing this per-player memory slot only because
    /// a player is exactly one chassis at a time, same reasoning the
    /// header comment already gives for the swing-FSM fields above).
    /// Consumed/written in world.zig section 8's own dash-through
    /// detection block (right after Wall Bloom/Shock Ring's landing
    /// hooks), not `stepMeleeSwing` — a DIFFERENT per-tick pass than the
    /// swing-FSM fields above, despite sharing this struct.
    /// Victim bitmask already dash-through-tagged during the CURRENT dash
    /// burst — mirrors `hit_this_swing_mask`'s own "one bit per player
    /// index" shape, cleared on the burst's rising edge so a body-cross
    /// fires once per dash per victim, not once per tick of overlap.
    dash_through_tagged_mask: u16 = 0,
    /// Last tick's `dash_active_ms > 0.0`, to detect the dash burst's
    /// rising edge (for clearing `dash_through_tagged_mask`) without
    /// re-deriving ms-precision timer state. Mirrors NinjaMeleeMemory.
    /// wasDashing.
    was_dashing: bool = false,
    /// True for the duration of the CURRENT dash burst if
    /// `razor_route_until_tick` was live the moment this burst started —
    /// the velocity boost + "marks Read on cross" both key off this, not
    /// off `razor_route_until_tick` itself (cleared at burst-start).
    /// Reset false the moment the burst ends OR the first victim is
    /// Read-tagged ("one body, one lie"). Mirrors NinjaMeleeMemory.
    /// razorRouteActiveDash.
    razor_route_active_dash: bool = false,
    /// ms spent idle since the last swing's recovery ended — the chain's
    /// reset clock (see chain_index above; Kindled's bash OR Ninja's STAB,
    /// whichever class this player is). Only meaningful while phase ==
    /// .idle. Mirrors PaladinMeleeMemory.chainGapMs / NinjaMeleeMemory.
    /// chainGapMs.
    chain_gap_ms: f64 = 0,
};

/// Resolved per-player fire config — what `step_world` reads
/// when spawning projectiles instead of the global weapon_base.
/// Host-side TS computes this from `createWeaponBuild` (cards
/// applied) once per tick + patches it into wasm memory.
///
/// Without this, every player fires the bare starter pistol
/// regardless of their card hand → multi-shot doesn't work,
/// damage cards do nothing, build variety is invisible.
pub const ResolvedFireConfig = extern struct {
    damage: f64,
    fire_rate: f64, // shots/sec
    projectile_speed: f64,
    projectile_lifetime_seconds: f64,
    spread_radians: f64,
    range_px: f64,
    homing_strength: f64,
    acceleration_multiplier: f64,
    gravity_scale: f64,
    slow_multiplier: f64,
    impact_radius_px: f64,
    size_multiplier: f64,
    speed_multiplier: f64,
    lifetime_multiplier: f64,
    projectile_count: u32,
    bounces: u32,
    pierce_count: u32,
    split_count: u32,
    shape: ProjectileShape,
    element: ElementType,
    pathing: ProjectilePathing,
    impact: ProjectileImpact,
    /// 1 = config valid + use this; 0 = fall back to starter
    /// pistol base from data/weapons.zig.
    valid: u8,
    _pad: [3]u8 = .{ 0, 0, 0 },
    // ── Card augments (offset 136+). Mirrors ResolvedFireConfigBytes in
    //    client/src/sim/wasm/wasmHost.ts — the host resolves the build TS-side
    //    and writes these so the Zig orchestrator applies the SAME movement /
    //    shield / parry augments as the TS orchestrator (parity for cutover).
    move_speed_mul: f64 = 1,
    gravity_mul: f64 = 1,
    jump_mul: f64 = 1,
    wall_jump_mul: f64 = 1,
    wall_slide_mul: f64 = 1,
    shield_charge_mul: f64 = 1,
    shield_recharge_mul: f64 = 1,
    parry_cover_mul: f64 = 1,
    parry_cooldown_mul: f64 = 1,
    max_health_add: f64 = 0,
    air_jumps: u32 = 0,
    dash_charges: u32 = 0,
    mirror_shield: u8 = 0,
    directional_shield: u8 = 0,
    _pad2: [6]u8 = .{ 0, 0, 0, 0, 0, 0 },
    // Appended — keeps every offset above stable (I25: repurposed Quick Parry
    // from the dead timed-parry cooldown onto the dash-bash slide's cooldown).
    dash_cooldown_mul: f64 = 1,
    /// Fire self-knockback, FULLY card-resolved (Track Z0c Item A — the
    /// recoil substrate the old `.recoil_step` deferral note demanded):
    /// clamped `build.recoilImpulse` (base weapon recoil × every card's
    /// top-level `modifier.recoilMultiplier`, weaponBuild.ts:278/619) ×
    /// `build.projectile.recoilMultiplier` (the second, per-projectile
    /// channel, weaponBuild.ts:428) — ONE baked f64, exactly the product
    /// TS's stepWeapon computes from the build at fire time (weapon.ts:600-
    /// 604). The remaining TS terms are tick-state, NOT build-state, and
    /// deliberately do NOT bake in here: chaos `recoilMultiplier` already
    /// crosses (data/chaos.zig ChaosProfile), Recoil Step's window is a
    /// PlayerEntity tick field, and the chassis `recoilControlMultiplier`
    /// divisor keys off `character_id` (already on PlayerEntity) — all
    /// three compose at world.zig's fire site, mirroring weapon.ts's own
    /// fire-time composition. Appended, keeping every offset above stable.
    recoil_impulse: f64 = 0,
    /// Delivery identity (Track Z1c item 1 — hitscan resolution): 0 =
    /// projectile, 1 = raycast/hitscan, 2 = continuous-beam, 3 =
    /// area-pulse — the SAME enum ordinals `cards_gen.zig`'s `CardMod.
    /// delivery` already uses. `resolveMods` (weapon_build.zig) always
    /// computed this (the wizard-forces-raycast ruling + the delivery-feel
    /// floors both branch on it) but then DROPPED it from the returned
    /// config — so world.zig's fire site could never know a resolved
    /// build was `raycast` and spawned traveling projectiles for every
    /// build, while TS's `stepWeapon` emits same-tick hitscan pellets for
    /// `delivery === "raycast"` (weapon.ts:497's `isHitscan` branch).
    /// Appended (growth pattern), keeping every offset above stable.
    delivery: u8 = 0,
    /// Explicit pad to 4-byte alignment for the f32 below (249 → 252) —
    /// reclaims 3 of the 7 bytes `delivery`'s own cut left as trailing
    /// padding (same "reuse the pad, don't grow the struct" precedent as
    /// `PlayerEntity`'s `ghost_guard_charge_until_tick`/`razor_route_
    /// until_tick` growth-history comments document).
    _pad3: [3]u8 = .{ 0, 0, 0 },
    /// Passive Tithe leech (Track Z1c item — six-axes axis payloads):
    /// `ResolvedWeaponBuild.leechFraction` (weaponBuild.ts — Stolen Fangs'
    /// class-gated Priest reading, card-pool-v2.md "Tithe"), READ at
    /// world.zig's fire sites (both the real-projectile spawn loop and the
    /// hitscan resolve path) and stamped onto the fired shot exactly like
    /// weapon.ts:514/577-579 does, closing the gap that section header
    /// comment (world.zig, "Hitscan resolution") flagged: "`ResolvedFireConfig`
    /// carries no leech field at all yet, so the real-projectile basic-fire
    /// spawn path doesn't apply it either." f32 (not f64): same precision-
    /// tradeoff precedent as `ProjectileEntity.leech_fraction` (this file,
    /// "2026-07-20 gap-closure pass" doc comment) — a 0..0.5-range fraction
    /// round-trips through f32 with ample precision, and f32 is exactly what
    /// fits the 4 bytes `_pad3` gave up above without growing the struct.
    ///
    /// GAP CLOSED (Track E1, the classModifiers codegen port — the "KNOWN
    /// GAP" this comment used to record): `cards_gen.zig` now carries
    /// every card's `classModifiers` as per-class CardMod literals
    /// (`CardEntry.class_mods`, wholesale-replace via `effectiveCardMod`),
    /// and `leech_fraction` is a first-class CardMod field max-folded +
    /// clamped in weapon_build.zig's `resolveMods` — so Stolen Fangs'
    /// Priest-only leech resolves IN-SIM through normal card resolution.
    /// The host-side `patchLeechFraction` stopgap (fireConfigShared.ts)
    /// that used to write this field after every resolve is retired.
    /// Parity: classModifierGapFieldsParity.test.ts + the priest walk in
    /// weaponBuildParity.test.ts.
    leech_fraction: f32 = 0,
};

/// Sentinel for `EquippedActives.slot_kind[N]` meaning "slot N is empty" —
/// out of range for every real `data/cards_gen.zig` `AbilityKind` value
/// (0..44, 45 members total, see that enum's own doc comment), so it can
/// never collide with a real ability. A plain-`u8` sentinel, not a
/// `?AbilityKind` array: Zig gives no defined `extern struct` layout for
/// `Optional` of a non-pointer type (unlike `?*T`, which reuses the null
/// pointer as its own sentinel) — the exact reason every OTHER optional
/// value on an extern struct in this file uses a `has_*` flag or an
/// explicit sentinel instead (see `CardMeta.class_id`'s own doc comment in
/// cards_gen.zig for the contrasting case where `?T` IS fine, because that
/// struct is plain, not `extern`, and never crosses an ABI boundary).
///
/// VALUE IS `0`, NOT the more obvious "past the end" `255` — investigated
/// and deliberately picked after finding a real hazard with `255`: this
/// codebase's own `reset()` export (`root.zig`) and every test's fresh-
/// state helper build a `WorldState` via a raw `@memset(..., 0)` /
/// `std.mem.zeroes` zero-fill, NOT via this struct's `.{}` literal syntax
/// — so a Zig field default like `= @splat(255)` NEVER actually applies at
/// runtime; the byte pattern is just zero either way. Picking `255` as the
/// sentinel would have made every zero-initialized `WorldState` (i.e.
/// EVERY real one — production included) silently read as "every player
/// has AbilityKind value `0` (crimson-tithe) equipped in every slot,"
/// exactly the opposite of "empty," and directly contradicting this
/// phase's own required load-bearing property ("an empty/unequipped slot
/// is provably inert"). `0` sidesteps this entirely: raw storage in
/// `EquippedActives.slot_kind` is `AbilityKind`'s enum value **+ 1**
/// (never the raw `@intFromEnum` value directly) so `0` unambiguously
/// means "empty" under BOTH zero-fill AND explicit initialization, and a
/// real kind (enum values 0..44) is recovered via `raw - 1` at the one
/// call site that reads it (world.zig's dispatch loop).
pub const ABILITY_KIND_NONE: u8 = 0;

/// Per-player resolved ability-slot equipment (Phase 1, docs/zig-step-
/// world-parity-goal.md) — parallel to `players[]`, same architectural
/// role `ResolvedFireConfig`/`player_fire_config` immediately above
/// already establish: "host resolves [X] from cards, patches it into wasm
/// memory each tick; step_world only READS it." `equipped_actives` is that
/// same shape for "which ability is drafted into which of the 3 rack
/// slots" — the fact Phase 1 needed to close per its own report (Phase 0's
/// card-data-model pass explicitly noted "the actual card-id contents
/// never mirror into any Zig struct").
///
/// DELIBERATELY NOT added as fields directly on `PlayerEntity` (the goal
/// doc's own literal suggested shape) — investigated first: TS's
/// `resolvePlayerBuild(player)` re-derives `build.actives` from
/// `player.cards` EVERY tick (World.ts's per-player loop calls it fresh,
/// same as `createWeaponBuild` re-deriving `ResolvedFireConfig` every
/// tick) rather than storing a pre-resolved actives list as persistent
/// roster state — so "which ability is in slot N" is BUILD-RESOLVED,
/// re-computed data, not identity data like `character_id`/`weapon_id`.
/// That's exactly `ResolvedFireConfig`'s own category, not
/// `team_id`/`kindling`'s (persistent identity/resource fields that
/// belong ON `PlayerEntity`). Using a parallel array also sidesteps the
/// `?AbilityKind`-in-`extern-struct` ABI problem entirely (see
/// `ABILITY_KIND_NONE`'s own doc comment) without inventing a new sentinel
/// convention specifically for `PlayerEntity`.
///
/// POPULATION: Phase 2 (the draft/offer-roll system) doesn't exist in Zig
/// yet, so nothing resolves this from real card picks today — same "no
/// live push site yet" state `PendingInstantAoe` shipped in before any
/// ability actually queued into it (Phase 0). Tests hand-seed this array
/// directly, exactly like Phase 0's Paper Double tests hand-seeded
/// `state.paper_doubles[0]` before any spawn-on-cast path existed (see
/// this phase's own test file). A future Phase 2 cut would populate it the
/// same way `weapon_build.resolve_player_fire_config` already resolves
/// `ResolvedFireConfig` from card indices — a small additive export, not a
/// reason to revisit this shape.
pub const EquippedActives = extern struct {
    /// `AbilityKind` (data/cards_gen.zig) as a raw `u8` **+ 1**, or
    /// `ABILITY_KIND_NONE` (`0`) for an empty slot — see
    /// `ABILITY_KIND_NONE`'s own doc comment for why the encoding is
    /// shifted by one instead of using a top-of-range sentinel. Not typed
    /// as `AbilityKind` itself (an enum) to keep this file free of a
    /// `data/cards_gen.zig` import — `world_state.zig` is the byte-layout
    /// foundation every other `sim/src/` module (including
    /// `data/cards_gen.zig` indirectly, via `weapon_build.zig`) already
    /// depends ON; a reverse dependency back onto a `data/` module would
    /// be the first of its kind in this file and buys nothing a raw `u8` +
    /// a documented sentinel/offset doesn't already give `world.zig`'s
    /// dispatch loop (which already imports `data/cards_gen.zig` directly
    /// and does the `@enumFromInt(raw - 1)` conversion at the one call
    /// site that needs it).
    slot_kind: [MAX_ABILITY_SLOTS]u8 = @splat(ABILITY_KIND_NONE),
};

/// Per-player ordered card hand (Phase 2, docs/zig-step-world-parity-
/// goal.md — draft/offer-roll system). Parallel to `players[]`, same
/// architectural role as `EquippedActives` immediately above: host-only
/// (doesn't cross the wasm ABI today — see that struct's own doc comment
/// for the full "why a parallel array" reasoning, which applies here
/// identically), populated by `draft.zig`'s pick-application path, not by
/// anything in this file.
///
/// WHY THIS EXISTS, not just `EquippedActives` alone: `EquippedActives`
/// only carries WHICH ability occupies which of the 3 rack slots — it
/// can't answer "does this player already own card X" (uniqueness/
/// maxStacks gating at the offer roll) or re-derive `ResolvedFireConfig`
/// (`weapon_build.resolveMods`'s card-order-SENSITIVE accumulation: the
/// `proj_*_set`/`delivery` fields are last-card-wins overwrites, not a
/// commutative fold — see `resolveMods`'s own loop). TS's `player.cards`
/// already carries both concerns off one ordered array; this is that
/// array's Zig-side counterpart. `EquippedActives` stays a SEPARATE
/// direct-write array rather than being re-derived from this one every
/// tick (Phase 1's own established shape — see its "POPULATION" doc
/// comment) because nothing here ever reorders or removes: `indices` only
/// ever grows by append, in pick order, so writing a newly-picked ability
/// straight into the next open `EquippedActives` slot at pick time
/// produces the exact same final assignment a from-scratch re-derivation
/// over `indices` would (see `draft.zig`'s `applyCardPick` doc comment).
///
/// Index type: `u8` into `data/cards_gen.zig`'s `cards` table (0..103),
/// the SAME index space `weapon_build.resolveByIndices` already consumes
/// — not a card-id string, for the same "no strings in extern structs,
/// no dynamic allocation" reasons every other Zig-side card reference in
/// this codebase already follows.
pub const PlayerCardIds = extern struct {
    /// Slots `[0..count)` (see `PlayerEntity.card_count`, the existing
    /// authoritative count field this array pairs with — investigated
    /// before adding a redundant second counter here: `card_count` was
    /// already present, already written by the wasm bridge's pack side
    /// (`p.cards.length`), and simply never had a backing array to pair
    /// with until this cut) are valid, in pick order. Slots at/past
    /// `card_count` are stale/unused — never read past it.
    indices: [MAX_PLAYER_CARDS]u8 = @splat(0),
};

/// Offers-per-player DRAFT_OFFER_COUNT — mirrors round.ts's
/// `DRAFT_OFFER_COUNT` exactly (cards offered per player per drafting
/// entry). A distinct constant from `MAX_ABILITY_SLOTS` even though both
/// happen to be 3 today — semantically unrelated (one caps the ability
/// rack, the other caps one offer roll), same "don't collapse two
/// same-valued TS constants into one Zig constant" discipline the rest of
/// this file already follows (e.g. `WEAPON_ID_BYTES`/`TEAM_ID_BYTES` both
/// being 24 but staying separate names).
pub const DRAFT_OFFER_COUNT: usize = 3;

/// Sentinel for `PlayerDraftState.offers[N]`/`picked_slot` meaning "empty"/
/// "not yet picked" — same "+1 encoding, 0 = zero-init-safe empty" shape
/// `ABILITY_KIND_NONE` already established, for the identical reason: a
/// real card-table index (0..103) can legitimately BE 0 (card index 0 is
/// "raycast-prism", a real card), so 0 can't double as "no offer here"
/// without the shift — and every `WorldState` this codebase creates is
/// zero-initialized (`std.mem.zeroes`/`reset()`'s `@memset(..., 0)`, never
/// this struct's own `.{}` literal), so the sentinel must read correctly
/// under a raw zero-fill, not just under explicit initialization.
pub const DRAFT_SLOT_NONE: u8 = 0;

/// Per-player drafting bookkeeping (Phase 2, docs/zig-step-world-parity-
/// goal.md) — parallel to `players[]`, rolled once per round by
/// `draft.zig`'s offer-roll and consumed by `draft.zig`'s pick-application
/// + `allDraftersResolved`. Mirrors TS `RoundState.draftingOffers[pid]` /
/// `draftingPicked[pid]`, collapsed from TS's per-round `Record<PlayerId,
/// ...>` maps into a fixed parallel array (this codebase's universal
/// "fixed max + count/index, never a dynamic map" shape).
pub const PlayerDraftState = extern struct {
    /// Offered card-table indices this round, `+1`-encoded (see
    /// `DRAFT_SLOT_NONE`'s own doc comment) — `DRAFT_SLOT_NONE` (`0`) means
    /// "no offer in this slot" (either not yet rolled this round, or the
    /// candidate pool was smaller than `DRAFT_OFFER_COUNT` when rolled).
    offers: [DRAFT_OFFER_COUNT]u8 = @splat(DRAFT_SLOT_NONE),
    /// Which offer slot was picked, `+1`-encoded: `DRAFT_SLOT_NONE` (`0`)
    /// = not picked yet; `1..DRAFT_OFFER_COUNT` = `offers[picked_slot - 1]`
    /// was picked (real or auto-picked-on-expiry — see the `draft_resolved`
    /// event's `player_idx_b` for the auto-picked flag, `PlayerDraftState`
    /// itself doesn't distinguish the two once landed).
    picked_slot: u8 = DRAFT_SLOT_NONE,
};

/// SimEvent kind tag (Phase I18). Mirrors the discriminated
/// `SimEvent` union in client/src/sim/types.ts but flat: each
/// event carries an i32 tag + 4 generic numeric payload slots
/// (player_idx_a, player_idx_b, entity_id, scalar) which the
/// caller decodes per kind.
pub const SimEventKind = enum(u32) {
    none = 0,
    shot_fired = 1,
    hit_confirmed = 2,
    destructible_broken = 3,
    pickup_taken = 4,
    round_end = 5,
    player_killed = 6,
    parry_deflected = 7,
    shield_popped = 8,
    explosion = 9,
    fire_hit = 10,
    /// Launch pad fired (world.zig §8c / TS launchPad.ts). Additive tag —
    /// player_idx_a = launched player, entity_id = pad INDEX in the host's
    /// pad array (pads are static map data, not WorldState entities).
    launch_pad_fired = 11,
    /// Emission cast (world.zig §6 cast branch / TS World.ts cast —
    /// docs/emission-engine-goal.md). player_idx_a = caster, scalar =
    /// volley count, x/y = cast origin. Element is NOT carried — the TS
    /// event converter resolves it from the caster's build.
    emission_cast = 12,
    /// Draft offers rolled for one player (Phase 2, docs/zig-step-world-
    /// parity-goal.md — draft/offer-roll system). player_idx_a = the
    /// player, scalar = how many offers were rolled (0..DRAFT_OFFER_COUNT
    /// — 0 when the candidate pool was empty). Mirrors TS's `card-offered`
    /// event, thinned the same way `emission_cast` already is: the full
    /// offer CONTENTS are readable directly from
    /// `WorldState.player_draft_state[player_idx_a].offers`, not
    /// duplicated into the event payload (there's no room for 3 card
    /// indices in this flat 4-slot-payload shape anyway).
    card_offered = 13,
    /// One player's draft pick resolved (Phase 2). player_idx_a = the
    /// player, player_idx_b = 1 if auto-picked-on-expiry else 0, scalar =
    /// the picked card's table index (`data/cards_gen.zig`'s `cards[N]`).
    /// Mirrors TS's `draft-resolved` event (`{playerId, cardId,
    /// autoPicked}`).
    draft_resolved = 14,
    /// Ninja dash burst body-crossed another player (world.zig section 8's
    /// dash-through detection block, this pass — docs/zig-step-world-
    /// parity-goal.md, Razor Route substrate). player_idx_a = the dashing
    /// player, player_idx_b = the crossed victim. Mirrors TS's
    /// "dash-through" event ({attackerId, victimId}). Not yet bridged to a
    /// TS-side decoder (this session's scope is sim/ only, client/ is
    /// owned by a concurrent session) — same KNOWN GAP shape as every
    /// PLAYER_ENTITY_SIZE staleness note in this file.
    dash_through = 15,
    /// First-blood wager claimed (Track Z0d — mirrors TS's
    /// `{ t: "first-blood", playerId }`, emitted by World.ts:6807 at its
    /// end-of-tick commit; here it fires at the claiming hit itself since
    /// the header IS the round state — no deferred commit step exists).
    /// player_idx_a = the claiming player, x/y = their position at claim.
    first_blood = 16,
    /// Team peel absorbed a hit (Track Z1c "team peel" item — mirrors TS's
    /// `{ t: "team-peel-absorbed", victimId, warderId, damageBlocked,
    /// kindlingGranted }`). player_idx_a = the victim who WOULD have taken
    /// the raw hit, player_idx_b = the warding Paladin ally who absorbed
    /// it, scalar = damage blocked, x/y = victim's position. `kindling
    /// Granted` is NOT carried separately — it always equals `damage
    /// Blocked` exactly (KINDLING_PER_DAMAGE_BLOCKED is a fixed 1.0
    /// multiplier, combat.zig), so the TS decoder derives it from the one
    /// scalar slot rather than needing a second payload field, same
    /// "thinned event" contract `emission_cast`/`card_offered` above
    /// already use.
    team_peel_absorbed = 17,
};

pub const SimEvent = extern struct {
    kind: u32,
    player_idx_a: i32,
    player_idx_b: i32,
    entity_id: u32,
    scalar: f64,
    x: f64,
    y: f64,
};

/// Mirrors `PickupEntity`.
pub const PickupEntity = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    amount: f64,
    duration_ms: f64,
    respawn_ms: f64,

    id: u32,
    respawn_at_tick: u32,
    flags: u32, // bit0=active, bit1=has_duration, bit2=has_respawn
    kind: PickupKind,
    _pad0: [3]u8 = .{ 0, 0, 0 },
};

// -----------------------------------------------------------------
// Sanity: each entity comes out at the size we promised in G1a so
// the WorldState total stays fixed.

pub const PLAYER_ENTITY_BYTES: usize = @sizeOf(PlayerEntity);
pub const PROJECTILE_ENTITY_BYTES: usize = @sizeOf(ProjectileEntity);
pub const SATELLITE_ENTITY_BYTES: usize = @sizeOf(SatelliteEntity);
pub const DESTRUCTIBLE_ENTITY_BYTES: usize = @sizeOf(DestructibleEntity);
pub const FIRE_ENTITY_BYTES: usize = @sizeOf(FireEntity);
pub const PICKUP_ENTITY_BYTES: usize = @sizeOf(PickupEntity);
pub const PAPER_DOUBLE_ENTITY_BYTES: usize = @sizeOf(PaperDoubleEntity);
pub const PENDING_INSTANT_AOE_BYTES: usize = @sizeOf(PendingInstantAoe);

/// Header — packed up front so the host can cheaply read tick /
/// rng_state without dereferencing a full WorldState.
/// 40 bytes after I2 added countdown_remaining_ms (f64). Layout
/// is u32×7 + u8×8 (round_phase + 3 pad + 4 trail pad) + f64.
/// Order is u32s first, then alignment fix-up, then the f64 to
/// keep natural 8-byte alignment without internal padding.
pub const WorldStateHeader = extern struct {
    tick: u32,
    rng_state: u32,
    round_phase: u8,
    /// True sudden death (Track Z0a port of orphaned-branch commit 02b74f5,
    /// 2026-07-14): a game-point tie shrinks the WHOLE round. Steals one of
    /// the 3 header pad bytes rather than growing the struct — parity with
    /// World.ts's `round.suddenDeathActive`. `stepWorld` DECIDES the trigger
    /// at the countdown → fighting transition (see `isSuddenDeathRound` in
    /// world.zig) and clears it on countdown entry (round.ts clears at both
    /// →countdown transitions). The storm-DAMAGE consumer is NOT ported yet —
    /// TS's World.ts still applies shrink-zone damage on the wasm path — so
    /// today this flag only round-trips out to `round.suddenDeathActive`.
    sudden_death_active: u8 = 0,
    _pad0: [2]u8 = .{ 0, 0 },
    next_entity_id: u32,
    map_id: u32,
    /// Bitmask of active chaos modifier ids (Phase I3). Bit N
    /// corresponds to `data/chaos.zig::ChaosModifierId` value N.
    /// Resolves into a `ChaosProfile` each tick via
    /// `chaosProfileFromMask`.
    chaos_mask: u32,
    fire_hazard_timer_ms: u32,
    round_index: u32,
    /// Round wins required to win the match (Phase I9). 0 disables
    /// match-end detection (orchestrator stays in fighting/round-
    /// over loop forever).
    target_score: u32,
    /// Match winner index (Phase I9). -1 = no match winner yet,
    /// ≥ 0 = player array index that hit target_score.
    match_winner_idx: i32,
    /// THIS ROUND's winner index (Phase 2, docs/zig-step-world-parity-
    /// goal.md — draft/offer-roll system). Written exactly once per round,
    /// at the fighting → round_over transition, from the same `winner_idx`
    /// value `stepWorld` already computed for score-crediting that tick
    /// (world.zig section 1) — captures BOTH a real winner (≥0) and a draw
    /// (-1; either a mutual-KO or a zero-kill time-out with nobody alive,
    /// see `timeoutWinnerIdx`'s own doc comment) exactly as
    /// `detectRoundWinner` resolved it, so it's still readable
    /// `ROUND_OVER_HOLD_MS` later when drafting rolls offers — mirrors TS
    /// `RoundState.winnerPlayerId` (`PlayerId | null`), which `enterDrafting`
    /// reads via `next.winnerPlayerId ?? null` for `classifyDraftRole`.
    /// Distinct from `match_winner_idx` above: that one is set once for the
    /// whole MATCH and stays -1 for every round before the decider; this
    /// one is set every round and is genuinely ambiguous between "no
    /// winner yet this tick" and "round resolved as a draw" at the value
    /// level — same collapse `detectRoundWinner`'s own return already
    /// makes, disambiguated only by WHEN it's read (never read except
    /// during round_over/drafting, i.e. only after a real resolution has
    /// happened).
    round_winner_idx: i32 = -1,
    /// First-blood wager claim (Track Z0d — mirrors TS
    /// `RoundState.firstBloodPlayerId`, round.ts/types.ts): 0 = unclaimed
    /// this round, N = sorted-player-index N-1 holds first blood and gets
    /// `round.FIRST_BLOOD_SPEED_MULTIPLIER` on movement for the rest of the
    /// round (world.zig section 8's speed product reads it; the section-4
    /// ranged-hit sites write it; the round machine clears it at
    /// countdown→fighting and →countdown, round.ts's own lifecycle).
    /// PLUS-ONE encoding, deliberately diverging from `round_winner_idx`'s
    /// -1 sentinel immediately above: `std.mem.zeroes(WorldState)`-built
    /// states (every Zig unit test, plus the module's fresh state buffer)
    /// must read as UNCLAIMED — an i32 whose zero value means "player 0
    /// holds it" would silently hand player 0 a 1.15x move boost in every
    /// zeroed harness, a far sharper hazard than round_winner_idx's
    /// mislabeled draft role. Occupies the 4-byte implicit alignment pad
    /// the trailing f64 forced after round_winner_idx (44→48), so
    /// HEADER size stays 56 — no wire growth.
    first_blood_idx_plus1: u32 = 0,
    countdown_remaining_ms: f64,
};

pub const WorldState = extern struct {
    header: WorldStateHeader,

    player_count: u32,
    _pad_after_player_count: [4]u8 = .{ 0, 0, 0, 0 },
    players: [MAX_PLAYERS]PlayerEntity,

    projectile_count: u32,
    _pad_after_projectile_count: [4]u8 = .{ 0, 0, 0, 0 },
    projectiles: [MAX_PROJECTILES]ProjectileEntity,

    satellite_count: u32,
    _pad_after_satellite_count: [4]u8 = .{ 0, 0, 0, 0 },
    satellites: [MAX_SATELLITES]SatelliteEntity,

    destructible_count: u32,
    _pad_after_destructible_count: [4]u8 = .{ 0, 0, 0, 0 },
    destructibles: [MAX_DESTRUCTIBLES]DestructibleEntity,

    fire_count: u32,
    _pad_after_fire_count: [4]u8 = .{ 0, 0, 0, 0 },
    fires: [MAX_FIRE]FireEntity,

    pickup_count: u32,
    _pad_after_pickup_count: [4]u8 = .{ 0, 0, 0, 0 },
    pickups: [MAX_PICKUPS]PickupEntity,

    /// Paper Double decoys (2026-07-20 gap-closure pass item 3). Spawned
    /// by world.zig's `.paper_double` cast arm (section 6z), fully
    /// stepped/collided/compacted by stepWorld every tick, and BRIDGED
    /// across the full-sync repack as of Track E1c — see
    /// PaperDoubleEntity's own doc comment for the ABI-crossing history.
    paper_double_count: u32,
    _pad_after_paper_double_count: [4]u8 = .{ 0, 0, 0, 0 },
    paper_doubles: [MAX_PAPER_DOUBLES]PaperDoubleEntity,

    /// Parallel to `players[]` — index N is movement memory for
    /// players[N]. Used by player.stepPlayer (Phase I14+).
    player_movement: [MAX_PLAYERS]PlayerMovementMemory,

    /// Parallel to `players[]` — index N is melee swing FSM memory for
    /// players[N] (2026-07-20 base-melee-mechanic gap-closure pass). Used
    /// by world.zig's melee step section; see `MeleeSwingMemory`'s own doc
    /// comment for the host-only/off-wire contract.
    melee_swing: [MAX_PLAYERS]MeleeSwingMemory,

    /// Parallel to `players[]` — resolved fire config from
    /// applied cards. Host writes this each tick from
    /// `createWeaponBuild`. Without `valid=1`, step_world
    /// falls back to the starter pistol base.
    player_fire_config: [MAX_PLAYERS]ResolvedFireConfig,

    /// Parallel to `players[]` — resolved ability-slot equipment (Phase 1,
    /// docs/zig-step-world-parity-goal.md). See `EquippedActives`'s own
    /// doc comment for the full "why a parallel array, not PlayerEntity
    /// fields" reasoning. POPULATED as of Phase 2 (`draft.zig`'s
    /// `applyCardPick`) — the "nothing populates this from real drafts
    /// yet" caveat from Phase 1 no longer applies.
    player_equipped_actives: [MAX_PLAYERS]EquippedActives,

    /// Parallel to `players[]` — the player's full ordered card hand
    /// (Phase 2). See `PlayerCardIds`'s own doc comment.
    player_card_ids: [MAX_PLAYERS]PlayerCardIds,

    /// Parallel to `players[]` — per-round drafting bookkeeping (Phase 2).
    /// See `PlayerDraftState`'s own doc comment. Rolled fresh by
    /// `draft.zig`'s `rollOffersForRound` at every round_over → drafting
    /// transition; cleared back to `.{}` at every drafting → countdown
    /// transition (`stepWorld`'s own countdown-arrival reset block) so a
    /// round's stale offers/picks never leak into the next round's
    /// `allDraftersResolved` check.
    player_draft_state: [MAX_PLAYERS]PlayerDraftState,

    /// Static-AABB cache (I15). Caller bakes the map's platforms
    /// into this array before the first step_world call; static
    /// across the match. Used by player.stepPlayer +
    /// projectile.stepV2 for terrain collision.
    static_count: u32,
    _pad_after_static_count: [4]u8 = .{ 0, 0, 0, 0 },
    statics: [MAX_STATICS]@import("collision.zig").AABB,
    /// Parallel to `statics[]` — 1 if the corresponding AABB is a
    /// one-way platform (player can jump up through it; projectiles
    /// pass freely from below).
    one_way: [MAX_STATICS]u8,
    _pad_after_one_way: [4]u8 = .{ 0, 0, 0, 0 },

    /// Deferred-write instant-AOE cast queue (2026-07-20 gap-closure pass —
    /// see `PendingInstantAoe`'s own doc comment for the full "why a
    /// WorldState field, not stepWorld-local scratch" reasoning). Per-tick
    /// like `events` immediately below — world.zig's new "6b" section
    /// resolves whatever is queued here (nothing, today — no ability-cast
    /// system pushes into it yet) and resets the count back to 0 before
    /// section 9's end-of-tick compaction runs, every tick.
    pending_instant_aoe_count: u32,
    _pad_after_pending_instant_aoe_count: [4]u8 = .{ 0, 0, 0, 0 },
    pending_instant_aoe: [MAX_PENDING_INSTANT_AOE]PendingInstantAoe,

    /// Per-tick events buffer (I18). step_world resets event_count
    /// to 0 at the start of every tick and pushes events as it
    /// runs. The host drains this by reading
    /// events[0..event_count] after each step_world call.
    event_count: u32,
    _pad_after_event_count: [4]u8 = .{ 0, 0, 0, 0 },
    events: [MAX_EVENTS_PER_TICK]SimEvent,
};

// -----------------------------------------------------------------
// Comptime size assertions. Keep them tight — every change here
// goes through a deliberate cut so callers stay in sync.

comptime {
    // 48 → 56 (Phase 2, docs/zig-step-world-parity-goal.md, draft/offer-roll
    // system): +4 content bytes for `round_winner_idx` (i32) — 40 was
    // already 4-byte-aligned (no gap before it), but the trailing f64
    // (`countdown_remaining_ms`) needs 8-byte alignment and 44 isn't a
    // multiple of 8, so Zig inserts 4 bytes of implicit padding before it
    // (44 → 48), same "one leftover i32 forces a padding gap" shape
    // `PlayerEntity.syz_ward_absorb_until_tick`'s own doc comment already
    // hit. See `round_winner_idx`'s own doc comment for what it carries.
    // 56 → 56 (Track Z0d, first-blood wager): `first_blood_idx_plus1`
    // (u32) RECLAIMS that 44→48 implicit padding gap as real content — the
    // header size and every downstream offset are unchanged, so this is
    // not a wire bump. See its own doc comment for the plus-one encoding.
    std.debug.assert(@sizeOf(WorldStateHeader) == 56);
    std.debug.assert(@offsetOf(WorldStateHeader, "first_blood_idx_plus1") == 44);
    std.debug.assert(@offsetOf(WorldStateHeader, "countdown_remaining_ms") == 48);

    // Each entity is 8-byte-aligned and tail-packed with explicit
    // _reserved bytes. These numbers are the wire contract — change
    // them only in a protocol-version bump.
    // 296 → 328 (2026-07-18, class-overhaul-workboard.md chunk 1.1): +25
    // content bytes (team_id_len + team_id_bytes[24]) rounded up to the
    // next 8-byte multiple by the struct's own alignment (7 bytes implicit
    // tail padding). See PlayerEntity.team_id_bytes's doc comment.
    // 328 → 336 (2026-07-18, class-overhaul-workboard.md chunk 2.3): +8
    // bytes for PlayerEntity.kindling (f64) — reclaims the 7 bytes of
    // tail padding above as real alignment space rather than adding a
    // fresh 8-byte-aligned pad on top. See PlayerEntity.kindling's doc
    // comment.
    // 336 → 360 (2026-07-18, class-overhaul-workboard.md chunk 3.1): +24
    // bytes for PlayerEntity.regen_until_tick/haste_until_tick (u32 ×2) +
    // regen_hps/haste_multiplier (f64 ×2) — no padding needed anywhere
    // (336 and 344 are both already aligned for what follows them). See
    // PlayerEntity.regen_until_tick's doc comment.
    // 360 → 368 (2026-07-18, class-overhaul-workboard.md chunk 3.2): +8
    // bytes for PlayerEntity.devotion (f64) — 360 already 8-byte-aligned,
    // no padding. See PlayerEntity.devotion's doc comment.
    // 368 → 384 (2026-07-18, class-overhaul-workboard.md chunk 3.3): +16
    // bytes for PlayerEntity.syz_ward_absorb_until_tick (u32) +
    // syz_ward_absorb_remaining (f64) — 4 bytes of implicit alignment
    // padding between the two (372 → 376) since a lone u32 precedes an f64.
    // See PlayerEntity.syz_ward_absorb_until_tick's doc comment.
    // 384 → 392 (2026-07-20, gap-closure pass item 2, weapon.ts:243-257 /
    // constants.ts GEO_CHANNEL_RAMP_MS): +8 bytes for
    // PlayerEntity.channel_hold_ms (f64) — 384 already 8-byte-aligned, no
    // padding. See PlayerEntity.channel_hold_ms's doc comment. KNOWN GAP:
    // worldStateBridge.ts's PLAYER_ENTITY_SIZE constant is still 384 as of
    // this cut (TS files are out of scope for this Zig-only pass) — a
    // follow-up TS cut MUST bump it to 392 and extend pack/unpackPlayer
    // before step_world's wasm export path can be exercised through that
    // bridge with this field populated. Zig-internal tests (this file's
    // comptime assert + world.zig's own native calls) are unaffected since
    // they read @sizeOf(PlayerEntity) directly, never the stale TS literal.
    // 392 → 504 (2026-07-20, Phase 1 ability-cast dispatch pass): +112
    // bytes, zero implicit padding anywhere in the addition (verified via
    // a temporary `@compileLog(@sizeOf(PlayerEntity))` before locking this
    // assert, same "don't trust hand math alone" discipline the growth-
    // history notes below already ask for). Layout, in declaration order:
    //   slot_cooldown_until_tick [3]u32   392 → 404  (12, no gap: 392 8-aligned)
    //   undercut_until_tick       u32     404 → 408  (4)
    //   edge_storm_until_tick     u32     408 → 412  (4)
    //   edge_storm_charges_remaining u32  412 → 416  (4)
    //   seal_until_tick           u32     416 → 420  (4)
    //   second_wind_until_tick    u32     420 → 424  (4)
    //   judgment_mark_until_tick  u32     424 → 428  (4)
    //   read_mark_until_tick      u32     428 → 432  (4)
    //   judgment_target_id_len    u8      432 → 433  (1)
    //   _pad_judgment             [3]u8   433 → 436  (3, explicit — same
    //                                       "len byte + explicit pad to the
    //                                       next 4-byte boundary" shape
    //                                       owner_id_len/_pad0 already use
    //                                       on ProjectileEntity/PaperDoubleEntity)
    //   judgment_target_id_bytes  [32]u8  436 → 468  (32)
    //   read_target_id_len        u8      468 → 469  (1)
    //   _pad_read                 [3]u8   469 → 472  (3)
    //   read_target_id_bytes      [32]u8  472 → 504  (32)
    // 504 is already an 8-byte multiple (63×8), so no further implicit
    // tail padding — struct grows 392 → 504 exactly. See
    // slot_cooldown_until_tick's own doc comment for the field-shape
    // reasoning. KNOWN GAP, same shape as the 384→392 note directly above:
    // worldStateBridge.ts's PLAYER_ENTITY_SIZE is untouched by this
    // Zig-only pass (already stale at 384 before this cut; still out of
    // scope here) — Zig-internal tests read @sizeOf(PlayerEntity) directly
    // and are unaffected.
    // 504 → 512 (this pass, AOE-queue ability wiring — Wall Bloom/Shock
    // Ring's own windows, the 2 hook-gated abilities in that group): +8
    // bytes for wall_bloom_until_tick (u32) + shock_ring_armed_until_tick
    // (u32) — 504 already 8-byte-aligned, no padding, 512 stays an 8-byte
    // multiple. Same "plain u32 tick, 0 = inactive, no has_* flag" shape
    // as every sibling window field above. KNOWN GAP, same shape as the
    // notes directly above: worldStateBridge.ts's PLAYER_ENTITY_SIZE is
    // untouched by this Zig-only pass — Zig-internal tests read
    // @sizeOf(PlayerEntity) directly and are unaffected.
    // 512 → 520 (Phase 5, docs/zig-step-world-parity-goal.md wire-contract
    // cleanup): +4 content bytes for ward_shell_until_tick (u32) — 512 is
    // already 8-byte-aligned so the field itself needs no leading pad, but
    // being a single trailing u32 leaves the struct at 516, not a multiple
    // of 8, so Zig inserts 4 bytes of implicit tail padding (516 → 520).
    // See ward_shell_until_tick's own doc comment for what it carries and
    // why its sibling `regenTickLastApplied` (the original audit's OTHER
    // flagged gap) is deliberately NOT added — verified as TS-internal-only,
    // never wire-visible, not a real gap.
    // 520 → 528 (Phase 4a, docs/zig-step-world-parity-goal.md "self-only
    // window buffs" — Sunlance/Overclock/Measure): +12 content bytes for
    // sunlance_until_tick/overclock_until_tick/measure_until_tick (u32 ×3),
    // landing at [516, 528) — 516 is already 4-byte-aligned (no leading
    // gap) and 528 is already an 8-byte multiple (66×8), so this addition
    // actually RECLAIMS the 4 bytes of implicit tail padding
    // ward_shell_until_tick's own cut left behind (516 → 520) as real
    // content space instead of adding a fresh pad on top — net growth is
    // +8, not +12, same "reclaim the old pad" shape
    // `team_id_bytes` → `kindling`'s growth-history note already
    // established. Verified via a temporary `@compileLog(@sizeOf(
    // PlayerEntity))` before locking this assert (confirmed 528), same
    // "don't trust hand math alone" discipline every growth-history note
    // above this one already follows. Return Glass / Bastion Pulse (this
    // same phase) need NO field — see their own doc comment right above
    // this struct's closing brace. KNOWN GAP, same shape as every note
    // above: worldStateBridge.ts's PLAYER_ENTITY_SIZE is untouched by this
    // Zig-only pass — Zig-internal tests read @sizeOf(PlayerEntity)
    // directly and are unaffected.
    // 528 → 608 (Phase 4b, docs/zig-step-world-parity-goal.md "4b.
    // Targeting/marking" — Facet Break/Focus Hex): +80 content bytes, zero
    // implicit padding anywhere in the addition (verified via a temporary
    // `@compileLog(@sizeOf(PlayerEntity))` before locking this assert,
    // same "don't trust hand math alone" discipline every growth-history
    // note above this one already follows — confirmed 608). Layout, in
    // declaration order:
    //   facet_mark_until_tick      u32     528 → 532  (4, no gap: 528 is
    //                                       already 8-aligned from the
    //                                       Phase 4a cut directly above)
    //   focus_hex_mark_until_tick  u32     532 → 536  (4)
    //   facet_target_id_len        u8      536 → 537  (1)
    //   _pad_facet                 [3]u8   537 → 540  (3, explicit — same
    //                                       "len byte + explicit pad to the
    //                                       next 4-byte boundary" shape
    //                                       judgment_target_id_len/
    //                                       _pad_judgment already use)
    //   facet_target_id_bytes      [32]u8  540 → 572  (32)
    //   focus_hex_target_id_len    u8      572 → 573  (1)
    //   _pad_focus_hex             [3]u8   573 → 576  (3)
    //   focus_hex_target_id_bytes  [32]u8  576 → 608  (32)
    // 608 is already an 8-byte multiple (76×8), so no further implicit
    // tail padding — struct grows 528 → 608 exactly, same "read Judgment
    // Line/Read Mark's own pair shape and repeat it twice" reasoning
    // Facet Break/Focus Hex's own doc comments give (right above this
    // struct's closing brace). Read Mark itself needs NO new field here —
    // its marking half already landed in Phase 1 (judgment/read pairs
    // above), only its melee-consumption half was outstanding, and that
    // was ALSO already wired (world.zig's `.read_mark` dispatch arm
    // predates this cut). KNOWN GAP, same shape as every note above:
    // worldStateBridge.ts's PLAYER_ENTITY_SIZE is untouched by this
    // Zig-only pass — Zig-internal tests read @sizeOf(PlayerEntity)
    // directly and are unaffected.
    // 608 → 616 (Phase 4a follow-up, this pass — Kindled Resolve):
    // +4 content bytes for `kindled_resolve_until_tick` (u32), landing at
    // [608, 612) (608 is already 4-byte-aligned), plus 4 bytes of implicit
    // tail padding to reach 616 (77×8) — this field pair has no sibling to
    // reclaim old padding from this time, unlike several growth steps
    // above. Verified via a temporary `@compileLog(@sizeOf(PlayerEntity))`
    // before locking this assert (confirmed 616), same "don't trust hand
    // math alone" discipline every growth-history note above already
    // follows. This is a REAL, NEW field gap (not a duplicate under a
    // different name — grepped `kindled_resolve` across sim/src/ before
    // adding it, confirmed zero prior existence), unlike Hard
    // Aperture/Self-Lattice's sibling abilities in this same follow-up
    // pass, whose fields already existed from earlier phases. KNOWN GAP,
    // same shape as every note above: worldStateBridge.ts's
    // PLAYER_ENTITY_SIZE is untouched by this Zig-only pass (this session's
    // scope is sim/ only, client/ is owned by a concurrent session) —
    // Zig-internal tests read @sizeOf(PlayerEntity) directly and are
    // unaffected; a future pass with client/ in scope needs to bump
    // PLAYER_ENTITY_SIZE 608 → 616 and worldStateLayout.test.ts's matching
    // literal, same close-out shape commit e669173 already used once for
    // an identical sim-only-scoping gap.
    // 616 → 616 (this pass, Ghost Guard): +4 content bytes for
    // `ghost_guard_charge_until_tick` (u32), landing exactly in the 4 bytes
    // of implicit tail padding `kindled_resolve_until_tick`'s own cut left
    // behind ([612, 616) — see that field's growth-history note two steps
    // above) — net growth is ZERO, same "reclaim the old pad" shape
    // `sunlance_until_tick`'s own growth-history note already established
    // once before. Verified via a temporary `@compileLog(@sizeOf(
    // PlayerEntity))` before locking this assert (confirmed still 616),
    // same "don't trust hand math alone" discipline every growth-history
    // note above already follows. No wasm-bridge follow-up needed for this
    // field specifically (struct size is unchanged), unlike every KNOWN
    // GAP noted above.
    // 616 → 624 (this pass, Razor Route): +4 content bytes for
    // `razor_route_until_tick` (u32), landing at [616, 620) (616 is already
    // 4-byte-aligned — no leading gap needed), plus 4 bytes of implicit
    // tail padding to reach 624 (78×8) — this field pair has no sibling pad
    // left to reclaim this time (Ghost Guard's own cut immediately above
    // already consumed the last one). Verified via a temporary
    // `@compileLog(@sizeOf(PlayerEntity))` before locking this assert
    // (confirmed 624), same "don't trust hand math alone" discipline every
    // growth-history note above already follows. KNOWN GAP, same shape as
    // every note above: worldStateBridge.ts's PLAYER_ENTITY_SIZE is
    // untouched by this Zig-only pass (this session's scope is sim/ only,
    // client/ is owned by a concurrent session) — Zig-internal tests read
    // @sizeOf(PlayerEntity) directly and are unaffected; a future pass with
    // client/ in scope needs to bump PLAYER_ENTITY_SIZE 616 → 624 and
    // worldStateLayout.test.ts's matching literal.
    // 624 → 624 (Track Z0b Item A, fast-respawn round semantics): +4
    // content bytes for `respawn_at_tick` (u32), landing exactly in the 4
    // bytes of implicit tail padding Razor Route's own cut left behind
    // ([620, 624) — see the 616 → 624 note immediately above) — net
    // growth ZERO, same "reclaim the old pad" shape Ghost Guard's note
    // above already used. worldStateBridge.ts's PLAYER_ENTITY_SIZE stays
    // 624; its pack/unpackPlayer codecs DID grow a skip-then-read tail
    // for the u32 at offset 620 (this field is wire-bridged, unlike the
    // Zig-only window fields — see respawn_at_tick's own doc comment).
    // 624 → 632 (Track Z0b Item B, muzzle-geometry port of 888345c): +1
    // content byte for `throw_hand_parity` (u8) at [624, 625) + 7 bytes of
    // EXPLICIT tail padding (`_pad_throw_hand`, [625, 632)) — the orphan
    // branch's own cut stole a then-existing `_reserved` byte next to
    // `score` (struct size unchanged there), but that landing zone was
    // consumed long ago (round_kills), so THIS port grows the struct
    // instead: 632 = 79×8. worldStateBridge.ts's PLAYER_ENTITY_SIZE bumped
    // 624 → 632 in the same cut (pack/unpackPlayer write/read the byte at
    // offset 624 — wire-bridged like respawn_at_tick, see both fields' own
    // doc comments), plus worldStateLayout.test.ts's matching literal.
    // 632 → 632 (Track Z0c Item A, recoil_step deferral close-out): +4
    // content bytes for `recoil_step_until_tick` (u32), landing exactly in
    // the last 4 bytes of the muzzle port's explicit `_pad_throw_hand`
    // ([628, 632) — the [7]u8 shrank to [3]u8) — net growth ZERO, same
    // "reclaim the old pad" shape respawn_at_tick's note above used.
    // Wire-bridged like respawn_at_tick/throw_hand_parity (see its own
    // doc comment); worldStateBridge.ts's codec tail reads/writes the u32
    // at offset 628 in the same cut.
    // 632 → 656 (Track Z1a item 3, ally substrate + the four
    // ally-targeted abilities): +4 content bytes each for
    // `rally_light_until_tick` (632), `aegis_share_until_tick` (636) and
    // `debt_until_tick` (640), +4 bytes EXPLICIT pad (`_pad_debt`,
    // [644, 648)) so `debt_amount` (f64) lands 8-aligned at [648, 656).
    // 656 = 82×8, no implicit tail pad. All four fields are wire-bridged
    // (same reasoning as respawn_at_tick: the full-sync path repacks
    // every tick, and TS's own casts open the same windows on the
    // TS-authoritative path); worldStateBridge.ts's PLAYER_ENTITY_SIZE
    // bumped 632 → 656 in the same cut, plus worldStateLayout.test.ts's
    // matching literal.
    std.debug.assert(@sizeOf(PlayerEntity) == 656);
    // Bridged-field offset locks for the codec notes above: packPlayer/
    // unpackPlayer hardcode a skip from the end of the syz-ward pair
    // (relative offset 384) to reach these fields at 620/624/628 (and the
    // Z1a ally-substrate tail at 632/636/640/648) — if a future growth
    // cut moves them, this trips before the bridge silently drifts.
    std.debug.assert(@offsetOf(PlayerEntity, "respawn_at_tick") == 620);
    std.debug.assert(@offsetOf(PlayerEntity, "throw_hand_parity") == 624);
    std.debug.assert(@offsetOf(PlayerEntity, "recoil_step_until_tick") == 628);
    std.debug.assert(@offsetOf(PlayerEntity, "rally_light_until_tick") == 632);
    std.debug.assert(@offsetOf(PlayerEntity, "aegis_share_until_tick") == 636);
    std.debug.assert(@offsetOf(PlayerEntity, "debt_until_tick") == 640);
    std.debug.assert(@offsetOf(PlayerEntity, "debt_amount") == 648);
    // Track Z1b — the [384, 620) ability-window tail is now BRIDGED
    // (packed AND unpacked field-by-field by worldStateBridge.ts; the old
    // `off += 236` skip is gone). Before this cut the full-sync hosts'
    // every-tick repack zero-filled the whole span, so EVERY Phase-4
    // ability window (sunlance/overclock/measure, marks, kindled resolve,
    // ghost guard, razor route, seal, second wind, edge storm, ...) was
    // one-tick-only under live wasm authority — same wipe-on-repack bug
    // class as Z0e's movement memory. Every bridged offset is pinned here
    // so a future growth cut trips loudly at `zig build` before the TS
    // codec silently drifts.
    std.debug.assert(@offsetOf(PlayerEntity, "channel_hold_ms") == 384);
    std.debug.assert(@offsetOf(PlayerEntity, "slot_cooldown_until_tick") == 392);
    std.debug.assert(@offsetOf(PlayerEntity, "undercut_until_tick") == 404);
    std.debug.assert(@offsetOf(PlayerEntity, "edge_storm_until_tick") == 408);
    std.debug.assert(@offsetOf(PlayerEntity, "edge_storm_charges_remaining") == 412);
    std.debug.assert(@offsetOf(PlayerEntity, "seal_until_tick") == 416);
    std.debug.assert(@offsetOf(PlayerEntity, "second_wind_until_tick") == 420);
    std.debug.assert(@offsetOf(PlayerEntity, "judgment_mark_until_tick") == 424);
    std.debug.assert(@offsetOf(PlayerEntity, "read_mark_until_tick") == 428);
    std.debug.assert(@offsetOf(PlayerEntity, "judgment_target_id_len") == 432);
    std.debug.assert(@offsetOf(PlayerEntity, "judgment_target_id_bytes") == 436);
    std.debug.assert(@offsetOf(PlayerEntity, "read_target_id_len") == 468);
    std.debug.assert(@offsetOf(PlayerEntity, "read_target_id_bytes") == 472);
    std.debug.assert(@offsetOf(PlayerEntity, "wall_bloom_until_tick") == 504);
    std.debug.assert(@offsetOf(PlayerEntity, "shock_ring_armed_until_tick") == 508);
    std.debug.assert(@offsetOf(PlayerEntity, "ward_shell_until_tick") == 512);
    std.debug.assert(@offsetOf(PlayerEntity, "sunlance_until_tick") == 516);
    std.debug.assert(@offsetOf(PlayerEntity, "overclock_until_tick") == 520);
    std.debug.assert(@offsetOf(PlayerEntity, "measure_until_tick") == 524);
    std.debug.assert(@offsetOf(PlayerEntity, "facet_mark_until_tick") == 528);
    std.debug.assert(@offsetOf(PlayerEntity, "focus_hex_mark_until_tick") == 532);
    std.debug.assert(@offsetOf(PlayerEntity, "facet_target_id_len") == 536);
    std.debug.assert(@offsetOf(PlayerEntity, "facet_target_id_bytes") == 540);
    std.debug.assert(@offsetOf(PlayerEntity, "focus_hex_target_id_len") == 572);
    std.debug.assert(@offsetOf(PlayerEntity, "focus_hex_target_id_bytes") == 576);
    std.debug.assert(@offsetOf(PlayerEntity, "kindled_resolve_until_tick") == 608);
    std.debug.assert(@offsetOf(PlayerEntity, "ghost_guard_charge_until_tick") == 612);
    std.debug.assert(@offsetOf(PlayerEntity, "razor_route_until_tick") == 616);
    // EquippedActives (Phase 1): [3]u8 = 3 bytes, no padding (u8 array
    // needs no alignment beyond 1). Doesn't cross the wasm ABI today (see
    // its own doc comment) — pure internal regression-catching, same role
    // PendingInstantAoe's assert plays.
    std.debug.assert(@sizeOf(EquippedActives) == 3);
    // PlayerCardIds (Phase 2): [8]u8 = 8 bytes, no padding. Same
    // "internal regression-catching, doesn't cross the wasm ABI today"
    // role as EquippedActives's assert immediately above.
    std.debug.assert(@sizeOf(PlayerCardIds) == MAX_PLAYER_CARDS);
    // PlayerDraftState (Phase 2): [3]u8 (offers) + 1 u8 (picked_slot) = 4
    // bytes, no padding (all u8 fields). Same role as the two asserts
    // immediately above.
    std.debug.assert(@sizeOf(PlayerDraftState) == DRAFT_OFFER_COUNT + 1);
    // ProjectileEntity: SIZE UNCHANGED at 216 despite 3 new numeric fields
    // (2026-07-20 gap-closure pass item 1) — status_scale/leech_fraction/
    // execute_below_frac (f32 ×3 = 12 bytes) exactly fill what used to be
    // `_reserved: [12]u8`. See ProjectileEntity.status_scale's doc comment
    // for the full byte-math + the f32-vs-f64 tradeoff. worldStateBridge.ts's
    // PROJECTILE_ENTITY_SIZE (216) stays correct as-is; only its
    // packProjectile/unpackProjectile codec bodies are stale (don't yet
    // read/write these 3 fields or the 7 new ProjectileFlags bits) — same
    // "TS follow-up needed, out of scope here" note as PlayerEntity above.
    std.debug.assert(@sizeOf(ProjectileEntity) == 216);
    std.debug.assert(@sizeOf(SatelliteEntity) == 96);
    std.debug.assert(@sizeOf(DestructibleEntity) == 64);
    std.debug.assert(@sizeOf(FireEntity) == 88);
    std.debug.assert(@sizeOf(PickupEntity) == 64);
    // PaperDoubleEntity (2026-07-20 gap-closure pass item 3): 6×f64 (48) +
    // id u32 (4) + owner_id_len u8 (1) + 3 bytes pad to the next 8-byte
    // boundary (56) + owner_id_bytes[32] (88) + _reserved[8] (96) — 96 is
    // already 8-byte-aligned, no further tail padding. See
    // PaperDoubleEntity's own doc comment for the DestructibleEntity-
    // pattern rationale.
    std.debug.assert(@sizeOf(PaperDoubleEntity) == 96);
    // Track E1c (gospel-goal.md, the Paper Double bridge) — bridged-field
    // offset locks for worldStateBridge.ts's packPaperDouble/
    // unpackPaperDouble codec, same role as the PlayerEntity offset locks
    // above: the TS side hardcodes these relative offsets, so a future
    // growth cut that moves any of them trips loudly at `zig build`
    // before the codec silently drifts. The stale "does NOT cross the
    // WASM ABI" note in PaperDoubleEntity's own doc comment is CLOSED by
    // that cut — decoys are full pack/unpack citizens now (they had to
    // be: the full-sync hosts repack the whole buffer every tick, so an
    // unbridged decoy was wiped one tick after it spawned, the same
    // wipe-on-repack bug class as Z0e/Z1a/Z2).
    std.debug.assert(@offsetOf(PaperDoubleEntity, "x") == 0);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "y") == 8);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "vx") == 16);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "vy") == 24);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "health") == 32);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "remaining_ms") == 40);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "id") == 48);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "owner_id_len") == 52);
    std.debug.assert(@offsetOf(PaperDoubleEntity, "owner_id_bytes") == 56);
    // The paper-double section keeps the same "u32 count + 4 pad + array"
    // preamble shape every other entity section uses — the TS bridge
    // derives the array offset as count-word + 8, so pin that shape here
    // (the count word's own absolute position is pinned at runtime by the
    // offset_paper_doubles() export vs the bridge's derived constant,
    // paperDoubleBridge.test.ts gate A).
    std.debug.assert(@offsetOf(WorldState, "paper_doubles") ==
        @offsetOf(WorldState, "paper_double_count") + 8);
    // Track E1c — header.next_entity_id is BRIDGED as of the same cut
    // (packWorldState used to write a placeholder 0 here every repack,
    // which reset the spawn-id cursor world.zig's spawn sites increment —
    // wasm-assigned entity ids restarted from 0 after every full-sync
    // repack and could collide with live entity ids). The TS codec
    // hardcodes byte offset 12 in the header; pin it like the
    // PlayerEntity locks above.
    std.debug.assert(@offsetOf(WorldStateHeader, "next_entity_id") == 12);
    // PendingInstantAoe (2026-07-20 gap-closure pass — deferred-write AOE
    // primitive): 9×f64 (72) + caster_idx u32 (4) + 3×u8 flags + 1×u8 pad
    // (4) = 80, already 8-byte-aligned, no tail padding. Doesn't cross the
    // wasm ABI (see its own doc comment) so this assert is pure internal
    // regression-catching, same role PlayerMovementMemory's assert plays.
    std.debug.assert(@sizeOf(PendingInstantAoe) == 80);
    std.debug.assert(@sizeOf(PlayerMovementMemory) == 48);
    // MeleeSwingMemory (2026-07-20 base-melee-mechanic gap-closure pass):
    // 3×f64 (24) + hit_this_swing_mask u16 (2) + phase u8 (1) + _pad u8 (1)
    // = 28 content bytes; extern struct alignment is 8 (from the f64
    // fields), so the total rounds up to 32 (4 bytes implicit tail
    // padding). Doesn't cross the wasm ABI (host-only, see its own doc
    // comment) so this assert is pure internal regression-catching, same
    // role PlayerMovementMemory's assert plays.
    // 32 → 32 (this pass, Razor Route substrate): +2 content bytes for
    // dash_through_tagged_mask (u16, lands right after the existing _pad
    // at offset 28, no leading gap needed) + 1 (was_dashing bool) + 1
    // (razor_route_active_dash bool) = 4 bytes total, landing EXACTLY in
    // the 4 bytes of implicit tail padding the struct already had — net
    // growth is ZERO, same "reclaim the old pad" shape PlayerEntity's own
    // Ghost Guard cut used moments ago.
    // 32 → 56 (2026-07-24, melee input buffer — slash-feel-ledger R1 row
    // 1): +3 f64s (buffered_ms / buffered_aim_x / buffered_aim_y) inserted
    // after aim_y, so every f64 stays 8-aligned and the trailing
    // mask/phase/dash block shifts from offset 24 to offset 48 intact.
    // 56 → 64 (2026-07-24, shield-bash chain — ledger design-decision
    // block): chain_index u8 reclaims the old _pad byte at offset 51 (no
    // growth), chain_gap_ms f64 appends at offset 56 (+8). 7×f64 (56) +
    // u16 + u8 + u8 + u16 + 2×bool (8) = 64, 8-aligned, no tail padding.
    // worldStateBridge.ts's MELEE_SWING_MEMORY_SIZE bumped in the same
    // cuts (meleeSwingMemoryBridge.test.ts gate A pins the two together).
    std.debug.assert(@sizeOf(MeleeSwingMemory) == 64);
    std.debug.assert(@sizeOf(SimEvent) == 40);
    // 240 → 248 (Track Z0c Item A, fire-recoil substrate): +8 for the
    // appended `recoil_impulse` f64 at [240, 248) — 240 is 8-aligned, no
    // padding anywhere. worldStateBridge.ts's RESOLVED_FIRE_CONFIG_SIZE
    // bumped 240 → 248 in the same cut.
    // 248 → 256 (Track Z1c item 1, hitscan resolution): +1 for the
    // appended `delivery` u8 at 248 + 7 pad — worldStateBridge.ts's
    // RESOLVED_FIRE_CONFIG_SIZE bumped 248 → 256 in the same cut.
    // 256 → 256 (Track Z1c "six-axes axis payloads" — leech): no growth,
    // `leech_fraction` (f32) reclaims 4 of `delivery`'s own 7 trailing pad
    // bytes at [252, 256) — see that field's own doc comment.
    std.debug.assert(@sizeOf(ResolvedFireConfig) == 256);
    std.debug.assert(@offsetOf(ResolvedFireConfig, "delivery") == 248);
    std.debug.assert(@offsetOf(ResolvedFireConfig, "leech_fraction") == 252);
}

// -----------------------------------------------------------------
// Wasm exports — let the host (TS bridge) pre-allocate the right
// amount of memory and assert at runtime that its struct mirror
// matches what Zig built. The doc-sync gate
// (`exportsDocSync.test.ts`) keeps `docs/zig-wasm-exports.md` in
// step with these.

pub export fn sizeof_world_state() u32 {
    return @intCast(@sizeOf(WorldState));
}

pub export fn sizeof_world_state_header() u32 {
    return @intCast(@sizeOf(WorldStateHeader));
}

pub export fn sizeof_player_entity() u32 {
    return @intCast(@sizeOf(PlayerEntity));
}

pub export fn sizeof_projectile_entity() u32 {
    return @intCast(@sizeOf(ProjectileEntity));
}

pub export fn sizeof_satellite_entity() u32 {
    return @intCast(@sizeOf(SatelliteEntity));
}

pub export fn sizeof_destructible_entity() u32 {
    return @intCast(@sizeOf(DestructibleEntity));
}

pub export fn sizeof_fire_entity() u32 {
    return @intCast(@sizeOf(FireEntity));
}

pub export fn sizeof_pickup_entity() u32 {
    return @intCast(@sizeOf(PickupEntity));
}

pub export fn sizeof_player_movement_memory() u32 {
    return @intCast(@sizeOf(PlayerMovementMemory));
}

pub export fn sizeof_resolved_fire_config() u32 {
    return @intCast(@sizeOf(ResolvedFireConfig));
}

/// Byte offset of `player_fire_config[0]` from the start of
/// `WorldState`. Host writes resolved fire configs directly into
/// wasm memory at this offset before each step_world call.
pub export fn offset_player_fire_config() u32 {
    return @intCast(@offsetOf(WorldState, "player_fire_config"));
}

/// Byte offset of `player_movement[0]` from the start of `WorldState`
/// (Track Z0e). The TS bridge packs/unpacks this parallel array every
/// full-sync tick — coyote/jump-buffer/grounded/dash memory must SURVIVE
/// the repack or stepPlayer runs permanently amnesiac (air-acceleration
/// on the ground, no ground friction, ground jumps impossible). The
/// bridge computes its own offset from the layout constants; this export
/// exists so a layout test can assert the two derivations agree before
/// any behavioral test has the chance to fail confusingly.
pub export fn offset_player_movement() u32 {
    return @intCast(@offsetOf(WorldState, "player_movement"));
}

/// Byte offset of `melee_swing[0]` from the start of `WorldState` (Track
/// Z1a — Z0e's sibling). The TS bridge packs/unpacks this parallel array
/// every full-sync tick — the swing FSM must SURVIVE the repack or melee
/// resets to idle before every step (a windup can never mature into an
/// active window; ninja/paladin melee never lands under live wasm
/// authority). Same layout-pinning contract as offset_player_movement
/// above — meleeSwingMemoryBridge.test.ts asserts the two derivations
/// agree.
pub export fn offset_melee_swing() u32 {
    return @intCast(@offsetOf(WorldState, "melee_swing"));
}

/// @sizeOf pin for the bridge's MELEE_SWING_MEMORY_SIZE stride (Track
/// Z1a) — same contract as sizeof_player_movement_memory above.
pub export fn sizeof_melee_swing_memory() u32 {
    return @intCast(@sizeOf(MeleeSwingMemory));
}

/// Byte offset of `player_draft_state[0]` from the start of `WorldState`
/// (Track Z2 — the drafting bridge). The full-sync hosts repack the whole
/// buffer every tick, so mid-draft offers/picks must round-trip through
/// the pack like player_movement/melee_swing before them —
/// draftMemoryBridge assertions pin this against the TS-side derivation.
pub export fn offset_player_draft_state() u32 {
    return @intCast(@offsetOf(WorldState, "player_draft_state"));
}

/// @sizeOf pin for the bridge's PLAYER_DRAFT_STATE_SIZE stride (Track
/// Z2) — same contract as sizeof_melee_swing_memory above.
pub export fn sizeof_player_draft_state() u32 {
    return @intCast(@sizeOf(PlayerDraftState));
}

/// Byte offset of `paper_doubles[0]` from the start of `WorldState`
/// (Track E1c — the Paper Double bridge). The full-sync hosts repack the
/// whole buffer every tick, so live decoys must round-trip through the
/// pack like every other entity collection — before this bridge, the
/// pack left the section zero-filled and every live decoy was wiped one
/// tick after it spawned (the Z0e/Z1a/Z2 wipe-on-repack bug class). The
/// bridge derives its own offset from the layout constants; this export
/// exists so paperDoubleBridge.test.ts gate A can assert the two
/// derivations agree, same contract as offset_melee_swing above.
pub export fn offset_paper_doubles() u32 {
    return @intCast(@offsetOf(WorldState, "paper_doubles"));
}

/// @sizeOf pin for the bridge's PAPER_DOUBLE_ENTITY_SIZE stride (Track
/// E1c) — same contract as sizeof_melee_swing_memory above.
pub export fn sizeof_paper_double_entity() u32 {
    return @intCast(@sizeOf(PaperDoubleEntity));
}

pub export fn world_state_max_paper_doubles() u32 {
    return @intCast(MAX_PAPER_DOUBLES);
}

pub export fn world_state_max_players() u32 {
    return @intCast(MAX_PLAYERS);
}

pub export fn world_state_max_projectiles() u32 {
    return @intCast(MAX_PROJECTILES);
}

pub export fn world_state_max_satellites() u32 {
    return @intCast(MAX_SATELLITES);
}

pub export fn world_state_max_destructibles() u32 {
    return @intCast(MAX_DESTRUCTIBLES);
}

pub export fn world_state_max_fire() u32 {
    return @intCast(MAX_FIRE);
}

pub export fn world_state_max_pickups() u32 {
    return @intCast(MAX_PICKUPS);
}

pub export fn world_state_max_statics() u32 {
    return @intCast(MAX_STATICS);
}

pub export fn world_state_max_events_per_tick() u32 {
    return @intCast(MAX_EVENTS_PER_TICK);
}

pub export fn sizeof_sim_event() u32 {
    return @intCast(@sizeOf(SimEvent));
}
