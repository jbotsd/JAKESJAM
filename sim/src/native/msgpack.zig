//! Minimal MessagePack pull-decoder — enough to read a `.jjr` replay.
//!
//! gospel-goal N0.2. The replay format was documented as "header + seed +
//! input stream", which is true of its SHAPE but not its ENCODING: a
//! `.jjr` is raw msgpack with no magic bytes and no framing (first byte of
//! every archived file is 0x83 — fixmap(3) — then "header", "inputs",
//! "rosterEvents"). So the native port passport needs a decoder before it
//! can read a single replay.
//!
//! PULL, not tree: `next()` returns one token and array/map tokens carry
//! only their element COUNT, so the caller walks the structure without any
//! allocation. `skipValue()` handles the "wrong key, move on" case. That
//! keeps this usable from the sim's no-allocation world later, and keeps
//! the 21.9 MB archived replay from being materialised twice.
//!
//! Only the subset msgpack-javascript emits for this data is implemented.
//! Anything else is `error.Unsupported` — loud, not silently skipped,
//! because a replay we cannot fully read must never look like one we can.

const std = @import("std");

pub const Error = error{
    /// Ran off the end of the buffer mid-value.
    Truncated,
    /// A valid msgpack type we deliberately do not implement.
    Unsupported,
    /// Value was not the type the caller demanded.
    TypeMismatch,
    /// A map lacked a key the caller required.
    KeyNotFound,
    /// Nesting exceeded the skip guard — a malformed or hostile file.
    TooDeep,
};

pub const Token = union(enum) {
    nil,
    boolean: bool,
    /// Signed integers. Values that fit unsigned arrive as `.uint`.
    int: i64,
    uint: u64,
    float: f64,
    str: []const u8,
    bin: []const u8,
    /// Element count; the elements follow as further tokens.
    array: u32,
    /// Pair count; 2*n further tokens follow (key, value, key, value...).
    map: u32,
};

/// Deepest nesting `skipValue` will walk before giving up.
const MAX_SKIP_DEPTH: u32 = 64;

pub const Decoder = struct {
    buf: []const u8,
    pos: usize = 0,

    pub fn init(buf: []const u8) Decoder {
        return .{ .buf = buf };
    }

    pub fn atEnd(self: *const Decoder) bool {
        return self.pos >= self.buf.len;
    }

    fn take(self: *Decoder, n: usize) Error![]const u8 {
        if (self.pos + n > self.buf.len) return Error.Truncated;
        const out = self.buf[self.pos .. self.pos + n];
        self.pos += n;
        return out;
    }

    fn takeByte(self: *Decoder) Error!u8 {
        if (self.pos >= self.buf.len) return Error.Truncated;
        const b = self.buf[self.pos];
        self.pos += 1;
        return b;
    }

    fn takeInt(self: *Decoder, comptime T: type) Error!T {
        const n = @divExact(@typeInfo(T).int.bits, 8);
        const bytes = try self.take(n);
        // msgpack is big-endian on the wire, always.
        return std.mem.readInt(T, bytes[0..n], .big);
    }

    /// Read the next value's token. For `array`/`map` the elements are NOT
    /// consumed — the caller reads (or skips) them.
    pub fn next(self: *Decoder) Error!Token {
        const c = try self.takeByte();
        return switch (c) {
            // positive fixint
            0x00...0x7f => Token{ .uint = c },
            // fixmap
            0x80...0x8f => Token{ .map = c & 0x0f },
            // fixarray
            0x90...0x9f => Token{ .array = c & 0x0f },
            // fixstr
            0xa0...0xbf => Token{ .str = try self.take(c & 0x1f) },
            0xc0 => Token.nil,
            0xc1 => Error.Unsupported, // never valid
            0xc2 => Token{ .boolean = false },
            0xc3 => Token{ .boolean = true },
            0xc4 => Token{ .bin = try self.take(try self.takeInt(u8)) },
            0xc5 => Token{ .bin = try self.take(try self.takeInt(u16)) },
            0xc6 => Token{ .bin = try self.take(try self.takeInt(u32)) },
            0xc7, 0xc8, 0xc9 => Error.Unsupported, // ext
            0xca => Token{ .float = @floatCast(@as(f32, @bitCast(try self.takeInt(u32)))) },
            0xcb => Token{ .float = @bitCast(try self.takeInt(u64)) },
            0xcc => Token{ .uint = try self.takeInt(u8) },
            0xcd => Token{ .uint = try self.takeInt(u16) },
            0xce => Token{ .uint = try self.takeInt(u32) },
            0xcf => Token{ .uint = try self.takeInt(u64) },
            0xd0 => Token{ .int = try self.takeInt(i8) },
            0xd1 => Token{ .int = try self.takeInt(i16) },
            0xd2 => Token{ .int = try self.takeInt(i32) },
            0xd3 => Token{ .int = try self.takeInt(i64) },
            0xd4...0xd8 => Error.Unsupported, // fixext
            0xd9 => Token{ .str = try self.take(try self.takeInt(u8)) },
            0xda => Token{ .str = try self.take(try self.takeInt(u16)) },
            0xdb => Token{ .str = try self.take(try self.takeInt(u32)) },
            0xdc => Token{ .array = try self.takeInt(u16) },
            0xdd => Token{ .array = try self.takeInt(u32) },
            0xde => Token{ .map = try self.takeInt(u16) },
            0xdf => Token{ .map = try self.takeInt(u32) },
            // negative fixint
            0xe0...0xff => Token{ .int = @as(i64, @as(i8, @bitCast(c))) },
        };
    }

    /// Consume one complete value, including all of a container's children.
    pub fn skipValue(self: *Decoder) Error!void {
        try self.skipValueDepth(0);
    }

    fn skipValueDepth(self: *Decoder, depth: u32) Error!void {
        if (depth > MAX_SKIP_DEPTH) return Error.TooDeep;
        switch (try self.next()) {
            .array => |n| {
                var i: u32 = 0;
                while (i < n) : (i += 1) try self.skipValueDepth(depth + 1);
            },
            .map => |n| {
                var i: u32 = 0;
                while (i < n) : (i += 1) {
                    try self.skipValueDepth(depth + 1); // key
                    try self.skipValueDepth(depth + 1); // value
                }
            },
            else => {},
        }
    }

    // ── typed readers ────────────────────────────────────────────────────

    pub fn readMapLen(self: *Decoder) Error!u32 {
        return switch (try self.next()) {
            .map => |n| n,
            else => Error.TypeMismatch,
        };
    }

    pub fn readArrayLen(self: *Decoder) Error!u32 {
        return switch (try self.next()) {
            .array => |n| n,
            else => Error.TypeMismatch,
        };
    }

    pub fn readStr(self: *Decoder) Error![]const u8 {
        return switch (try self.next()) {
            .str => |s| s,
            else => Error.TypeMismatch,
        };
    }

    /// Numbers arrive as uint, int or float depending on magnitude and on
    /// whether the JS encoder saw an integral value — msgpack-javascript
    /// emits ints for integral Numbers, so a "float" field can land as any
    /// of the three. Accept all and converge on f64.
    pub fn readF64(self: *Decoder) Error!f64 {
        return switch (try self.next()) {
            .float => |f| f,
            .uint => |u| @floatFromInt(u),
            .int => |i| @floatFromInt(i),
            else => Error.TypeMismatch,
        };
    }

    pub fn readU64(self: *Decoder) Error!u64 {
        return switch (try self.next()) {
            .uint => |u| u,
            .int => |i| if (i >= 0) @intCast(i) else Error.TypeMismatch,
            // A whole-valued float is still a whole value. Reject anything
            // with a fractional part rather than silently truncating.
            .float => |f| if (f >= 0 and @floor(f) == f) @intFromFloat(f) else Error.TypeMismatch,
            else => Error.TypeMismatch,
        };
    }

    pub fn readBool(self: *Decoder) Error!bool {
        return switch (try self.next()) {
            .boolean => |b| b,
            else => Error.TypeMismatch,
        };
    }
};

// ── tests ────────────────────────────────────────────────────────────────

test "positive fixint and fixstr" {
    var d = Decoder.init(&[_]u8{ 0x07, 0xa3, 'a', 'b', 'c' });
    try std.testing.expectEqual(@as(u64, 7), try d.readU64());
    try std.testing.expectEqualStrings("abc", try d.readStr());
    try std.testing.expect(d.atEnd());
}

test "negative fixint and int8" {
    var d = Decoder.init(&[_]u8{ 0xff, 0xd0, 0x9c });
    try std.testing.expectEqual(Token{ .int = -1 }, try d.next());
    try std.testing.expectEqual(Token{ .int = -100 }, try d.next());
}

test "uint widths are big-endian" {
    var d = Decoder.init(&[_]u8{ 0xcd, 0x01, 0x00, 0xce, 0x00, 0x01, 0x00, 0x00 });
    try std.testing.expectEqual(@as(u64, 256), try d.readU64());
    try std.testing.expectEqual(@as(u64, 65536), try d.readU64());
}

test "float32 and float64" {
    // 1.5f32 = 0x3fc00000 ; 1.5f64 = 0x3ff8000000000000
    var d = Decoder.init(&[_]u8{
        0xca, 0x3f, 0xc0, 0x00, 0x00,
        0xcb, 0x3f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    });
    try std.testing.expectEqual(@as(f64, 1.5), try d.readF64());
    try std.testing.expectEqual(@as(f64, 1.5), try d.readF64());
}

test "readF64 accepts integer-encoded numbers" {
    // msgpack-javascript encodes an integral Number as an int, so a field
    // the TS type calls `number` can arrive as uint/int/float.
    var d = Decoder.init(&[_]u8{ 0x2a, 0xd0, 0xd6 });
    try std.testing.expectEqual(@as(f64, 42), try d.readF64());
    try std.testing.expectEqual(@as(f64, -42), try d.readF64());
}

test "readU64 rejects a fractional float" {
    var d = Decoder.init(&[_]u8{ 0xcb, 0x3f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });
    try std.testing.expectError(Error.TypeMismatch, d.readU64());
}

test "skipValue walks nested containers" {
    // { "a": [1, {"b": 2}], "c": 3 } — skip the whole first value.
    var d = Decoder.init(&[_]u8{
        0x82, 0xa1, 'a', 0x92, 0x01, 0x81, 0xa1, 'b', 0x02, 0xa1, 'c', 0x03,
    });
    try std.testing.expectEqual(@as(u32, 2), try d.readMapLen());
    try std.testing.expectEqualStrings("a", try d.readStr());
    try d.skipValue();
    try std.testing.expectEqualStrings("c", try d.readStr());
    try std.testing.expectEqual(@as(u64, 3), try d.readU64());
    try std.testing.expect(d.atEnd());
}

test "truncation is an error, not a silent short read" {
    var d = Decoder.init(&[_]u8{ 0xa3, 'a' });
    try std.testing.expectError(Error.Truncated, d.next());
}

test "unsupported ext types fail loud" {
    var d = Decoder.init(&[_]u8{0xd4});
    try std.testing.expectError(Error.Unsupported, d.next());
}

test "real .jjr prefix decodes as the expected shape" {
    // First bytes of every archived replay: fixmap(3) { "header": fixmap(10)
    // { "formatVersion": 1, "protocolVersion": 3, ...
    const prefix = [_]u8{
        0x83, 0xa6, 'h', 'e', 'a', 'd', 'e', 'r',
        0x8a, 0xad, 'f', 'o', 'r', 'm', 'a', 't', 'V', 'e', 'r', 's', 'i', 'o', 'n',
        0x01,
    };
    var d = Decoder.init(&prefix);
    try std.testing.expectEqual(@as(u32, 3), try d.readMapLen());
    try std.testing.expectEqualStrings("header", try d.readStr());
    try std.testing.expectEqual(@as(u32, 10), try d.readMapLen());
    try std.testing.expectEqualStrings("formatVersion", try d.readStr());
    try std.testing.expectEqual(@as(u64, 1), try d.readU64());
}
