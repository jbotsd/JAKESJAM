//! Mulberry32 — seeded deterministic 32-bit RNG.
//!
//! Bit-exact port of `client/src/sim/rng.ts`. The same `state` produces
//! the same `nextU32` output on Zig (wasm) and TS, which is the
//! foundational determinism guarantee for the whole sim.
//!
//! The TS impl uses `Math.imul` (signed-32 truncating multiply) and
//! `>>> 0` (uint32 coerce). In Zig u32, wrapping ops (`+%`, `*%`) and
//! native `>>` give identical low-32-bit bit patterns.
//!
//! See ADR-0006 and `.claude/skills/wasm-game-sim-zig/SKILL.md`.

/// Advance the RNG state and return the new state. Pure: no side effects.
///
/// Wrapping arithmetic (`+%`, `*%`) matches the JS `>>> 0` / `Math.imul`
/// behaviour bit-for-bit. Checked `+`/`*` would panic in Debug on
/// overflow — the algorithm relies on the modular wrap. See
/// `.claude/skills/zig-code-quality/SKILL.md` "Integer arithmetic".
pub fn nextU32(state: u32) u32 {
    var s: u32 = state +% 0x6d2b79f5;
    s = (s ^ (s >> 15)) *% (s | 1);
    s ^= s +% ((s ^ (s >> 7)) *% (s | 61));
    return s ^ (s >> 14);
}

pub const NextIntResult = struct {
    state: u32,
    value: i32,
};

pub const NextFloatResult = struct {
    state: u32,
    value: f64,
};

/// Returns the new state + a value in [0, 1). Bit-exact port of TS's
/// `nextFloat` (rng.ts): `nextU32(state)` then `n / 0x100000000` — divide
/// by 2^32, NOT 0xFFFFFFFF (2^32-1); the off-by-one matters for parity, see
/// `nextIntFromState`'s own `4294967296.0` constant, which this reuses.
/// Was previously inlined at each call site (e.g. projectile.zig's split
/// jitter) rather than a shared helper; added here as the canonical form
/// once a second call site (the draft/offer-roll's weighted sampling,
/// docs/zig-step-world-parity-goal.md Phase 2) needed the exact same
/// computation — purely additive, existing inlined call sites are
/// untouched.
pub fn nextFloat(state: u32) NextFloatResult {
    const new_state = nextU32(state);
    const value: f64 = @as(f64, @floatFromInt(new_state)) / 4294967296.0;
    return .{ .state = new_state, .value = value };
}

/// Returns the integer in [min, max_exclusive). Matches TS:
///   min + Math.floor(f * (max_exclusive - min))
/// where f = new_state / 0x100000000.
///
/// All arithmetic is widened to i64/f64 internally so callers can pass
/// the full i32 range without triggering Zig's checked-arithmetic panic
/// in Debug. JS does the equivalent via f64 numbers.
pub fn nextIntFromState(state: u32, min: i32, max_exclusive: i32) NextIntResult {
    const new_state = nextU32(state);
    const f: f64 = @as(f64, @floatFromInt(new_state)) / 4294967296.0;
    const range: i64 = @as(i64, max_exclusive) - @as(i64, min);
    const offset: i64 = @intFromFloat(@floor(f * @as(f64, @floatFromInt(range))));
    const value: i32 = @intCast(@as(i64, min) + offset);
    return .{ .state = new_state, .value = value };
}

// ── wasm ABI exports ──────────────────────────────────────────────────────
// Exposed so the host (TS / Bun) can run identical-input parity tests
// against the TS impl. These do not need to be called from inside the
// sim itself — Zig modules call `nextU32` directly.

pub export fn rng_next_u32(state: u32) u32 {
    return nextU32(state);
}

pub export fn rng_next_int(state: u32, min: i32, max_exclusive: i32) i64 {
    const out = nextIntFromState(state, min, max_exclusive);
    // Pack { state: u32, value: i32 } into one i64 so the ABI stays
    // multivalue-free (some wasm hosts trip on i32 multivalue returns).
    // Layout: hi 32 = new state, lo 32 = value (sign-extended).
    const hi: i64 = @as(i64, @as(u32, out.state)) << 32;
    const lo: i64 = @as(i64, out.value) & 0xFFFFFFFF;
    return hi | lo;
}
