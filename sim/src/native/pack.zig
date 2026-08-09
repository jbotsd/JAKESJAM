//! gospel N2.7 — reader for the native asset pack.
//!
//! Format is written by `sim/tools/pack_assets.ts` (`bun run pack:assets`)
//! and documented there. This side is deliberately tiny: parse an index,
//! hand back slices INTO the caller's buffer. No allocation, no copying,
//! no decoding — raylib's loaders take bytes, so the pack's job ends at
//! "here are the right bytes".
//!
//! Offline means offline: nothing here can fetch anything, which is the
//! actual requirement behind the row.

const std = @import("std");

pub const MAGIC = "JJPK";
pub const VERSION: u32 = 1;
const ENTRY_BYTES: usize = 96;
const NAME_BYTES: usize = 64;
const HEADER_BYTES: usize = 12;

pub const Kind = enum(u32) { font = 0, sfx = 1, music = 2, _ };

pub const Entry = struct {
    name: []const u8,
    kind: Kind,
    bytes: []const u8,
    /// FNV-1a recorded at pack time.
    hash: u32,
};

pub const Error = error{
    BadMagic,
    BadVersion,
    Truncated,
    /// Content does not match the hash recorded in the index. Distinct
    /// from Truncated on purpose: a short file is a bad copy, a hash
    /// mismatch is a CHANGED file, and those want different reactions.
    HashMismatch,
};

/// FNV-1a, 32-bit — must match the packer's exactly or every entry fails.
pub fn fnv1a(bytes: []const u8) u32 {
    var h: u32 = 0x811c9dc5;
    for (bytes) |b| {
        h ^= b;
        h = h *% 0x01000193;
    }
    return h;
}

pub const Pack = struct {
    buf: []const u8,
    count: u32,

    pub fn open(buf: []const u8) Error!Pack {
        if (buf.len < HEADER_BYTES) return Error.Truncated;
        if (!std.mem.eql(u8, buf[0..4], MAGIC)) return Error.BadMagic;
        const version = std.mem.readInt(u32, buf[4..8], .little);
        if (version != VERSION) return Error.BadVersion;
        const count = std.mem.readInt(u32, buf[8..12], .little);
        if (buf.len < HEADER_BYTES + @as(usize, count) * ENTRY_BYTES) return Error.Truncated;
        return .{ .buf = buf, .count = count };
    }

    pub fn at(self: Pack, index: u32) Error!Entry {
        if (index >= self.count) return Error.Truncated;
        const base = HEADER_BYTES + @as(usize, index) * ENTRY_BYTES;
        const raw_name = self.buf[base .. base + NAME_BYTES];
        const name_len = std.mem.indexOfScalar(u8, raw_name, 0) orelse NAME_BYTES;
        const kind_raw = std.mem.readInt(u32, self.buf[base + 64 ..][0..4], .little);
        const offset = std.mem.readInt(u32, self.buf[base + 68 ..][0..4], .little);
        const size = std.mem.readInt(u32, self.buf[base + 72 ..][0..4], .little);
        const hash = std.mem.readInt(u32, self.buf[base + 76 ..][0..4], .little);
        if (@as(usize, offset) + @as(usize, size) > self.buf.len) return Error.Truncated;
        return .{
            .name = raw_name[0..name_len],
            .kind = @enumFromInt(kind_raw),
            .bytes = self.buf[offset .. offset + size],
            .hash = hash,
        };
    }

    /// Fetch by name. Linear scan: 13 entries today and a few dozen ever,
    /// so a map would be more code and more allocation for no measurable
    /// win.
    pub fn get(self: Pack, name: []const u8) Error!?Entry {
        var i: u32 = 0;
        while (i < self.count) : (i += 1) {
            const e = try self.at(i);
            if (std.mem.eql(u8, e.name, name)) return e;
        }
        return null;
    }

    /// Check every entry's content against its recorded hash.
    ///
    /// Worth running once at boot rather than trusting the file: a pack
    /// is exactly the kind of artefact that gets half-copied by a bad
    /// deploy, and "the SFX sounds wrong" is a miserable way to discover
    /// it. Returns the first bad entry's index.
    pub fn verifyAll(self: Pack) Error!void {
        var i: u32 = 0;
        while (i < self.count) : (i += 1) {
            const e = try self.at(i);
            if (fnv1a(e.bytes) != e.hash) return Error.HashMismatch;
        }
    }
};

// ── tests ────────────────────────────────────────────────────────────────
// Build a pack in memory with the same layout the TS writer produces, so
// these do not need the real 8 MB file on disk.

fn writeTestPack(buf: []u8, names: []const []const u8, payloads: []const []const u8) usize {
    @memset(buf, 0);
    @memcpy(buf[0..4], MAGIC);
    std.mem.writeInt(u32, buf[4..8], VERSION, .little);
    std.mem.writeInt(u32, buf[8..12], @intCast(names.len), .little);
    var cursor = HEADER_BYTES + names.len * ENTRY_BYTES;
    for (names, 0..) |n, i| {
        cursor = (cursor + 7) & ~@as(usize, 7);
        const base = HEADER_BYTES + i * ENTRY_BYTES;
        @memcpy(buf[base .. base + n.len], n);
        std.mem.writeInt(u32, buf[base + 64 ..][0..4], 1, .little);
        std.mem.writeInt(u32, buf[base + 68 ..][0..4], @intCast(cursor), .little);
        std.mem.writeInt(u32, buf[base + 72 ..][0..4], @intCast(payloads[i].len), .little);
        std.mem.writeInt(u32, buf[base + 76 ..][0..4], fnv1a(payloads[i]), .little);
        @memcpy(buf[cursor .. cursor + payloads[i].len], payloads[i]);
        cursor += payloads[i].len;
    }
    return cursor;
}

test "pack: round-trips names, kinds and bytes" {
    var buf: [1024]u8 = undefined;
    const n = writeTestPack(&buf, &.{ "sfx/a.wav", "sfx/b.wav" }, &.{ "hello", "world!!" });
    const p = try Pack.open(buf[0..n]);
    try std.testing.expectEqual(@as(u32, 2), p.count);
    const a = (try p.get("sfx/a.wav")).?;
    try std.testing.expectEqualStrings("hello", a.bytes);
    const b = (try p.get("sfx/b.wav")).?;
    try std.testing.expectEqualStrings("world!!", b.bytes);
    try std.testing.expectEqual(Kind.sfx, a.kind);
}

test "pack: a missing name is null, not an error" {
    var buf: [1024]u8 = undefined;
    const n = writeTestPack(&buf, &.{"sfx/a.wav"}, &.{"hello"});
    const p = try Pack.open(buf[0..n]);
    try std.testing.expect((try p.get("sfx/nope.wav")) == null);
}

test "pack: verifyAll passes clean and CATCHES a flipped byte" {
    var buf: [1024]u8 = undefined;
    const n = writeTestPack(&buf, &.{"sfx/a.wav"}, &.{"hello"});
    var p = try Pack.open(buf[0..n]);
    try p.verifyAll();

    // Corrupt one payload byte — the half-copied-deploy case.
    const e = (try p.get("sfx/a.wav")).?;
    const off = @intFromPtr(e.bytes.ptr) - @intFromPtr(&buf);
    buf[off] ^= 0xFF;
    p = try Pack.open(buf[0..n]);
    try std.testing.expectError(Error.HashMismatch, p.verifyAll());
}

test "pack: bad magic and bad version are distinct errors" {
    var buf: [1024]u8 = undefined;
    const n = writeTestPack(&buf, &.{"sfx/a.wav"}, &.{"hello"});
    buf[0] = 'X';
    try std.testing.expectError(Error.BadMagic, Pack.open(buf[0..n]));
    buf[0] = 'J';
    std.mem.writeInt(u32, buf[4..8], 99, .little);
    try std.testing.expectError(Error.BadVersion, Pack.open(buf[0..n]));
}

test "pack: a truncated file is refused rather than read past the end" {
    var buf: [1024]u8 = undefined;
    const n = writeTestPack(&buf, &.{"sfx/a.wav"}, &.{"hello"});
    try std.testing.expectError(Error.Truncated, Pack.open(buf[0..8]));
    // Index claims an entry the file does not contain.
    try std.testing.expectError(Error.Truncated, Pack.open(buf[0..HEADER_BYTES]));
    _ = n;
}
