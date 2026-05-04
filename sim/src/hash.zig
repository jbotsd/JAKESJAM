//! FNV1a-32 hash primitives — bit-exact port of
//! `client/src/sim/hash.ts`. Used for per-entity snapshot reconcile
//! in the netcode loop. Cross-host bit-equality is the whole point;
//! a hash mismatch directly drives reconcile decisions.
//!
//! Note: this is a NON-STANDARD FNV1a variant — each byte mix XORs
//! in `FNV1A_BASIS_32 >> 16`. Match the TS impl exactly.
//!
//! See ADR-0006 and `.claude/skills/zig-code-quality/SKILL.md`.

const FNV1A_PRIME_32: u32 = 0x01000193;
const FNV1A_BASIS_32: u32 = 0x811c9dc5;
const FNV1A_BASIS_HI16: u32 = FNV1A_BASIS_32 >> 16;

pub const FNV1A_BASIS = FNV1A_BASIS_32;

/// Mix one byte into a running FNV1a-32 hash. Wrapping multiply
/// matches `Math.imul` on the JS side bit-for-bit.
pub fn fnv1aMix(hash: u32, byte: u32) u32 {
    return ((hash ^ (byte & 0xff)) *% FNV1A_PRIME_32) ^ FNV1A_BASIS_HI16;
}

/// Mix a 32-bit integer (all four bytes, little-endian) into the
/// hash. Fixed byte order ⇒ platform-independent result.
pub fn mixU32(hash: u32, v: u32) u32 {
    var h = hash;
    h = fnv1aMix(h, v & 0xff);
    h = fnv1aMix(h, (v >> 8) & 0xff);
    h = fnv1aMix(h, (v >> 16) & 0xff);
    h = fnv1aMix(h, (v >> 24) & 0xff);
    return h;
}

/// Quantise a float to a fixed grid then truncate to i32. Matches
/// `Math.round(value / grid) | 0`.
pub fn quantise(value: f64, grid: f64) i32 {
    const rounded = @round(value / grid);
    return @intFromFloat(rounded);
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn hash_fnv1a_basis() u32 {
    return FNV1A_BASIS_32;
}

pub export fn hash_fnv1a_mix(hash: u32, byte: u32) u32 {
    return fnv1aMix(hash, byte);
}

pub export fn hash_mix_u32(hash: u32, v: u32) u32 {
    return mixU32(hash, v);
}

pub export fn hash_quantise(value: f64, grid: f64) i32 {
    return quantise(value, grid);
}
