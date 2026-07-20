//! Phase 2 (docs/zig-step-world-parity-goal.md) — draft/offer-roll system.
//! Ports `client/src/sim/round.ts`'s `enterDrafting` + pick-resolution
//! bookkeeping, and `client/src/sim/draftWeights.ts` (role classification,
//! weighted sampling). Consumed by `world.zig`'s `stepWorld` at the
//! round_over → drafting and drafting → countdown phase boundaries — see
//! `round.zig`'s own updated header comment for how the phase machine
//! itself now routes through this module.
//!
//! Kept as its own file (not folded into round.zig or world.zig) for the
//! same reason TS keeps `enterDrafting` in round.ts but the WEIGHTING
//! logic in a separate draftWeights.ts: this module owns "roll a fair set
//! of offers, land a pick," round.zig owns "when does a phase change,"
//! world.zig owns "orchestrate a whole tick." Depends on
//! `data/cards_gen.zig` (card table) and `rng.zig` (seeded draws) —
//! world_state.zig stays free of both (see `PlayerDraftState`'s own doc
//! comment for why the STORAGE lives there anyway: it's plain byte layout,
//! not logic).

const std = @import("std");
const world_state = @import("world_state.zig");
const gen = @import("data/cards_gen.zig");
const rng = @import("rng.zig");
const weapon_build = @import("weapon_build.zig");

const MAX_CARDS = gen.cards.len;

/// Draft seat role for one player in one roll — mirrors draftWeights.ts's
/// `DraftRole` exactly.
pub const DraftRole = enum { standard, catch_up, winner };

/// Classify a player's draft role from the round winner index. Bit-exact
/// port of draftWeights.ts's `classifyDraftRole`: `round_winner_idx < 0`
/// (draw OR — never actually reached here, see `PlayerDraftState`'s own
/// doc comment — "not yet decided") mirrors TS's `winnerPlayerId == null`
/// check treating BOTH null and undefined as "no winner, standard for
/// everyone."
pub fn classifyDraftRole(player_idx: u32, round_winner_idx: i32) DraftRole {
    if (round_winner_idx < 0) return .standard;
    if (@as(i32, @intCast(player_idx)) == round_winner_idx) return .winner;
    return .catch_up;
}

/// Relative pick weight for a card under a draft role. Bit-exact port of
/// draftWeights.ts's `weightForCard`: standard/winner seats are uniform
/// weight 1; catch_up seats boost impact/utility/element/ability-bucket
/// cards (+2) and higher rarities (+1 uncommon, +2 rare/legendary) so
/// losing seats sample punchier offers without denying the winner anything.
fn weightForCard(meta: gen.CardMeta, role: DraftRole) f64 {
    if (role != .catch_up) return 1;
    var w: f64 = 1;
    if (meta.buckets.impact or meta.buckets.utility or
        meta.buckets.element or meta.buckets.ability) w += 2;
    if (meta.rarity == .uncommon) w += 1;
    if (meta.rarity == .rare or meta.rarity == .legendary) w += 2;
    return w;
}

const PickWeightedResult = struct { state: u32, index: u8 };

/// Weighted pick over `candidates` (card-table indices) with parallel
/// `weights`. Bit-exact port of draftWeights.ts's `pickWeighted` — SAME
/// shape, not a different-but-similar algorithm: sum the (floor-0)
/// weights, draw one `nextFloat`, cut the cumulative-weight line at
/// `f * total`, walk the list subtracting each weight until the running
/// remainder goes `<= 0`. A weight-0 (or all-zero-total) pool falls back
/// to `candidates[0]` while STILL consuming one `nextFloat` draw — matching
/// TS's own `[n] = nextFloat(state); return [n, items[0]]` fallback
/// exactly, so the RNG cursor always advances by exactly one draw per call
/// regardless of which branch fires (replay-determinism requires this: a
/// caller threading the cursor through must see the same advancement
/// whether or not the fallback path was taken).
fn pickWeighted(state: u32, candidates: []const u8, weights: []const f64) PickWeightedResult {
    std.debug.assert(candidates.len > 0);
    std.debug.assert(candidates.len == weights.len);
    var total: f64 = 0;
    for (weights) |w| total += @max(0.0, w);

    const nf = rng.nextFloat(state);
    if (total <= 0) {
        return .{ .state = nf.state, .index = candidates[0] };
    }
    var r = nf.value * total;
    for (candidates, weights) |c, w| {
        r -= @max(0.0, w);
        if (r <= 0) return .{ .state = nf.state, .index = c };
    }
    return .{ .state = nf.state, .index = candidates[candidates.len - 1] };
}

/// Does `player_idx` already hold card `card_idx` (any copy)? Scans the
/// player's ordered hand (`PlayerCardIds`) up to `card_count` — mirrors
/// TS's `owned = new Set(player.cards)` membership check.
fn ownsCard(state: *const world_state.WorldState, player_idx: u32, card_idx: u8) bool {
    const n = state.players[player_idx].card_count;
    const hand = &state.player_card_ids[player_idx].indices;
    var i: u8 = 0;
    while (i < n) : (i += 1) {
        if (hand[i] == card_idx) return true;
    }
    return false;
}

/// How many copies of `card_idx` does `player_idx` already hold? Mirrors
/// TS's `copies` map (`Map<string, number>` built from `player.cards`).
fn copiesOfCard(state: *const world_state.WorldState, player_idx: u32, card_idx: u8) u8 {
    const n = state.players[player_idx].card_count;
    const hand = &state.player_card_ids[player_idx].indices;
    var count: u8 = 0;
    var i: u8 = 0;
    while (i < n) : (i += 1) {
        if (hand[i] == card_idx) count += 1;
    }
    return count;
}

/// Count non-empty ability-rack slots. Mirrors TS's `resolvePlayerBuild
/// (player).actives.length` — reads Zig's already-resolved
/// `EquippedActives` directly rather than re-deriving from the card hand,
/// same "EquippedActives is the authoritative resolved-slots view"
/// convention Phase 1 established (see `PlayerCardIds`'s own doc comment
/// for why this stays consistent given the append-only invariant).
fn heldActivesCount(state: *const world_state.WorldState, player_idx: u32) u32 {
    const slots = &state.player_equipped_actives[player_idx].slot_kind;
    var count: u32 = 0;
    for (slots) |s| {
        if (s != world_state.ABILITY_KIND_NONE) count += 1;
    }
    return count;
}

/// archetype (PlayerEntity.character_id) → ClassId. Mirrors
/// cardTypes.ts's `classIdForArchetype`/`ARCHETYPE_CLASS_ID` exactly
/// (balanced→wizard, heavy→paladin, sprinter→ninja, shielded→priest).
/// Every OTHER Zig call site that needs this mapping inlines a raw
/// `character_id == .X` check instead of a shared helper (world.zig's
/// Wizard-ramp/Paladin-shield/etc. gates) — this is the first site that
/// needs to go the OTHER direction (archetype → a `cards_gen.ClassId`
/// value to compare against `CardMeta.class_id`), so a real conversion
/// function earns its keep here rather than another inline triple-branch.
fn classIdForArchetype(character_id: world_state.CharacterArchetype) gen.ClassId {
    return switch (character_id) {
        .balanced => .wizard,
        .heavy => .paladin,
        .sprinter => .ninja,
        .shielded => .priest,
    };
}

/// Build the candidate pool (card-table indices) for one player: excludes
/// already-owned `unique` cards, cards at `maxStacks`, ability cards once
/// the rack is full, and off-class ability/passive cards. Bit-exact port
/// of `enterDrafting`'s `candidatePool` filter chain — same 4 gates, same
/// order (order doesn't affect the RESULT set here, all 4 are independent
/// predicates, but kept in TS's own order for readability/diffability).
/// Writes into `out` (caller-owned, sized `MAX_CARDS`) and returns the
/// count written.
///
/// `pub`, unlike this file's other internal helpers: the load-bearing
/// property here is DETERMINISTIC (a filter predicate, no RNG involved) —
/// exposed so tests can assert the exact candidate SET directly (a
/// hand-seeded `WorldState` in, an exact index membership check out)
/// rather than only observing it indirectly through sampled offers, per
/// this phase's own "test the deterministic parts precisely" testing
/// strategy.
pub fn buildCandidatePool(
    state: *const world_state.WorldState,
    player_idx: u32,
    out: *[MAX_CARDS]u8,
) usize {
    const player_class = classIdForArchetype(state.players[player_idx].character_id);
    const held_actives = heldActivesCount(state, player_idx);
    var n: usize = 0;
    var idx: usize = 0;
    while (idx < gen.cards.len) : (idx += 1) {
        const meta = gen.cards[idx].meta;
        const card_idx: u8 = @intCast(idx);
        if (meta.unique and ownsCard(state, player_idx, card_idx)) continue;
        if (meta.max_stacks != 0 and
            copiesOfCard(state, player_idx, card_idx) >= meta.max_stacks) continue;
        if (meta.active != null and held_actives >= world_state.MAX_ABILITY_SLOTS) continue;
        if (meta.class_id != null and meta.class_id.? != player_class) continue;
        out[n] = card_idx;
        n += 1;
    }
    return n;
}

/// Remove every index in `exclude[0..exclude_len]` from `pool[0..pool_len]`,
/// writing survivors into `out`. Mirrors TS's
/// `candidatePool.filter(c => !seen.has(c.id))`.
fn excludeIndices(
    pool: []const u8,
    exclude: []const u8,
    out: *[MAX_CARDS]u8,
) usize {
    var n: usize = 0;
    for (pool) |c| {
        var found = false;
        for (exclude) |e| {
            if (e == c) {
                found = true;
                break;
            }
        }
        if (!found) {
            out[n] = c;
            n += 1;
        }
    }
    return n;
}

/// Roll `world_state.DRAFT_OFFER_COUNT` offers for one player and write
/// them into `state.player_draft_state[player_idx]`. Returns the advanced
/// rng cursor. Bit-exact port of `enterDrafting`'s per-player body
/// (candidate pool → bounded weighted-sample loop → ability pity floor).
fn rollOffersForPlayer(
    state: *world_state.WorldState,
    player_idx: u32,
    round_winner_idx: i32,
    rng_state: u32,
) u32 {
    var cursor = rng_state;
    const role = classifyDraftRole(player_idx, round_winner_idx);

    var candidate_pool: [MAX_CARDS]u8 = undefined;
    const candidate_count = buildCandidatePool(state, player_idx, &candidate_pool);

    var offered: [world_state.DRAFT_OFFER_COUNT]u8 = undefined;
    var offered_count: usize = 0;

    if (candidate_count > 0) {
        // Explicit `usize` result type: `@min` of a small comptime-known
        // bound (DRAFT_OFFER_COUNT=3) and a runtime value narrows its
        // result to the SMALLEST type that can hold the comptime operand
        // (here `u2`, max 3) unless the destination type is pinned — left
        // inferred, `target * 8` below would then overflow `u2` at
        // comptime. Not a real bug in the VALUE, purely a Zig result-type
        // inference quirk around `@min`.
        const target: usize = @min(world_state.DRAFT_OFFER_COUNT, candidate_count);
        // Bounded loop: an 8x-target attempt cap (mirrors round.ts's own
        // "the 8x cap keeps a pathologically small pool... from spinning
        // forever" comment) — each iteration advances the rng cursor
        // deterministically whether or not it yields a NEW offer.
        var attempts: usize = 0;
        while (offered_count < target and attempts < target * 8) : (attempts += 1) {
            var remaining: [MAX_CARDS]u8 = undefined;
            const remaining_count = excludeIndices(
                candidate_pool[0..candidate_count],
                offered[0..offered_count],
                &remaining,
            );
            if (remaining_count == 0) break;

            var weights: [MAX_CARDS]f64 = undefined;
            for (remaining[0..remaining_count], 0..) |c, i| {
                weights[i] = weightForCard(gen.cards[c].meta, role);
            }
            const picked = pickWeighted(cursor, remaining[0..remaining_count], weights[0..remaining_count]);
            cursor = picked.state;

            // remaining[] already excludes everything in offered[], so
            // this can never actually fire — kept anyway as the same
            // belt-and-braces duplicate guard TS's own `if
            // (!seen.has(picked.id))` is (a provable no-op there too,
            // given TS's own `remaining` filter immediately above it).
            var already = false;
            for (offered[0..offered_count]) |o| {
                if (o == picked.index) already = true;
            }
            if (!already) {
                offered[offered_count] = picked.index;
                offered_count += 1;
            }
        }

        // Ability pity floor (Jake, 2026-07-17: "don't see new abilities
        // drop any more"): a hand holding ZERO actives is guaranteed at
        // least one ability offer, replacing the LAST rolled offer slot.
        // Same rng cursor — determinism holds.
        if (held_actives_is_zero: {
            break :held_actives_is_zero heldActivesCount(state, player_idx) == 0;
        } and offered_count > 0) {
            var offers_ability = false;
            for (offered[0..offered_count]) |o| {
                if (gen.cards[o].meta.active != null) offers_ability = true;
            }
            if (!offers_ability) {
                var ability_pool: [MAX_CARDS]u8 = undefined;
                var ability_count: usize = 0;
                for (candidate_pool[0..candidate_count]) |c| {
                    if (gen.cards[c].meta.active == null) continue;
                    var already = false;
                    for (offered[0..offered_count]) |o| {
                        if (o == c) already = true;
                    }
                    if (!already) {
                        ability_pool[ability_count] = c;
                        ability_count += 1;
                    }
                }
                if (ability_count > 0) {
                    var weights: [MAX_CARDS]f64 = undefined;
                    for (ability_pool[0..ability_count], 0..) |c, i| {
                        weights[i] = weightForCard(gen.cards[c].meta, role);
                    }
                    const picked = pickWeighted(cursor, ability_pool[0..ability_count], weights[0..ability_count]);
                    cursor = picked.state;
                    offered[offered_count - 1] = picked.index;
                }
            }
        }
    }

    var ds = &state.player_draft_state[player_idx];
    ds.* = .{};
    for (offered[0..offered_count], 0..) |c, i| {
        ds.offers[i] = c + 1; // +1 encoding, see DRAFT_SLOT_NONE's doc comment
    }

    emitEvent(state, .card_offered, @intCast(player_idx), -1, 0, @floatFromInt(offered_count), 0, 0);

    return cursor;
}

/// Roll offers for every roster player (index order — the natural
/// deterministic iteration order for a fixed array, substituting for TS's
/// `Object.keys(players).sort()`; see this module's own header comment for
/// why an index-order stream, not a byte-identical-to-TS's-id-sorted
/// stream, is the right determinism bar here). Threads
/// `state.header.rng_state` through every player sequentially, same as
/// `enterDrafting` threads `cursor` through `draftingIds`, and writes the
/// final cursor back once at the end.
pub fn rollOffersForRound(state: *world_state.WorldState) void {
    var cursor = state.header.rng_state;
    const round_winner_idx = state.header.round_winner_idx;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        cursor = rollOffersForPlayer(state, i, round_winner_idx, cursor);
    }
    state.header.rng_state = cursor;
}

/// Apply one player's draft pick: `offer_slot` (0..DRAFT_OFFER_COUNT) into
/// `state.player_draft_state[player_idx].offers`. Lands the card into the
/// player's ordered hand (`PlayerCardIds`) — the uniqueness/maxStacks
/// source of truth for future rolls — and, for an ability card, into the
/// NEXT OPEN `EquippedActives` slot.
///
/// "Slots fill in draft order and never reorder" (docs/six-axes-goal.md's
/// locked doctrine, re-verified live against weaponBuild.ts's
/// `createWeaponBuild` for this pass — `build.actives.push(...)` while
/// iterating `cards` in stored order, capped at MAX_ABILITY_SLOTS): ported
/// here as "write into the first empty slot," NOT as "re-derive the whole
/// rack from the hand every pick." These are only equivalent because
/// nothing in this system ever removes or reorders a card once picked
/// (verified: no card-removal mechanism exists anywhere in round.ts or
/// weaponBuild.ts) — given that invariant, appending to the next open slot
/// at pick time produces the IDENTICAL final assignment a from-scratch
/// re-derivation over the full ordered hand would, for a fraction of the
/// cost (no scan over the whole hand on every tick, matching Phase 1's own
/// established "EquippedActives is a direct-write array" shape — see that
/// struct's own doc comment).
///
/// Also re-resolves `player_fire_config[player_idx]` from the updated hand
/// (`weapon_build.resolveByIndices`) so a passive/modifier pick's stat
/// change is live immediately — closing the SAME loop for weapon stats
/// that EquippedActives closes for abilities (both readable by
/// `step_world`'s very next tick, not waiting on a host round-trip).
///
/// Returns `false` (no-op) if: not in drafting phase, invalid
/// player/slot index, the slot has no real offer, or this player already
/// picked this round — mirrors the server's real `applyCardPick` gate
/// shape (idempotent against a duplicate/late pick).
pub fn applyCardPick(
    state: *world_state.WorldState,
    player_idx: u32,
    offer_slot: u8,
    auto_picked: bool,
) bool {
    if (state.header.round_phase != @intFromEnum(world_state.RoundPhase.drafting)) return false;
    if (player_idx >= state.player_count) return false;
    if (offer_slot >= world_state.DRAFT_OFFER_COUNT) return false;

    var ds = &state.player_draft_state[player_idx];
    if (ds.picked_slot != world_state.DRAFT_SLOT_NONE) return false; // already picked

    const raw = ds.offers[offer_slot];
    if (raw == world_state.DRAFT_SLOT_NONE) return false; // no real offer here
    const card_idx = raw - 1;

    const player = &state.players[player_idx];
    if (player.card_count < world_state.MAX_PLAYER_CARDS) {
        state.player_card_ids[player_idx].indices[player.card_count] = card_idx;
        player.card_count += 1;
    }

    if (gen.cards[card_idx].meta.active) |active| {
        const equipped = &state.player_equipped_actives[player_idx];
        for (&equipped.slot_kind) |*slot| {
            if (slot.* == world_state.ABILITY_KIND_NONE) {
                slot.* = @intFromEnum(active.kind) + 1;
                break;
            }
        }
    }

    const hand_count = state.players[player_idx].card_count;
    state.player_fire_config[player_idx] = weapon_build.resolveByIndices(
        state.player_card_ids[player_idx].indices[0..hand_count],
    );

    ds.picked_slot = offer_slot + 1;

    emitEvent(
        state,
        .draft_resolved,
        @intCast(player_idx),
        if (auto_picked) 1 else 0,
        0,
        @floatFromInt(card_idx),
        0,
        0,
    );

    return true;
}

/// True when every roster player has resolved their pick this round
/// (`picked_slot != DRAFT_SLOT_NONE`) — bit-exact port of
/// `stepRound`'s drafting-case `allPicked` gate, INCLUDING its own real
/// (if slightly wasteful) TS quirk: a player who was offered NOTHING
/// (empty candidate pool) can never pick, so they block early resolution
/// forever — the round then always waits the full DRAFT_WINDOW_MS in that
/// case, same as TS (`draftingIds.every(id => previousPicked[id] !==
/// undefined)` can never become true while such a player remains counted).
/// `player_count == 0` returns `true` (nobody to wait for) — the closest
/// Zig analog to TS's `noDraftersLeft` safety net (no live-eviction
/// concept exists in step_world's fixed-roster model, so that specific
/// TS branch has no direct port; this preserves its SAFETY property: never
/// hang the phase machine waiting on an empty roster).
pub fn allDraftersResolved(state: *const world_state.WorldState) bool {
    if (state.player_count == 0) return true;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.player_draft_state[i].picked_slot == world_state.DRAFT_SLOT_NONE) return false;
    }
    return true;
}

/// Auto-pick the FIRST (leftmost) offer for every unpicked drafter — bit-
/// exact port of `stepRound`'s expiry branch
/// (`if (expired && !allPicked) { ... offers[pid]?.[0] ... }`). A player
/// with no real offers (`offers[0] == DRAFT_SLOT_NONE`) is left unpicked,
/// same as TS's `if (cardId === undefined) continue;`. Call this exactly
/// once, at the tick the drafting window expires with picks outstanding
/// (world.zig's own drafting → countdown arrival block) — BEFORE
/// `player_draft_state` is cleared for the next round.
pub fn autoPickStragglers(state: *world_state.WorldState) void {
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.player_draft_state[i].picked_slot != world_state.DRAFT_SLOT_NONE) continue;
        _ = applyCardPick(state, i, 0, true);
    }
}

/// Clear every player's drafting bookkeeping back to the zero/`.{}`
/// default — call once at the drafting → countdown transition so a
/// round's stale offers/picks never leak into the next round's
/// `allDraftersResolved` check. Mirrors `stepRound`'s own
/// `next.draftingExpiresAtTick = undefined; next.draftingPicked =
/// undefined; next.draftingOffers = undefined;` reset.
pub fn clearDraftState(state: *world_state.WorldState) void {
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        state.player_draft_state[i] = .{};
    }
}

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
