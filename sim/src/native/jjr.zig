//! `.jjr` replay reader — gospel-goal N0.2.
//!
//! A replay is `{ header, inputs, rosterEvents }` msgpack (see
//! server/src/ReplayRecorder.ts). It records inputs + RNG seed only, never
//! WorldState, so re-simulating it natively and hashing the result is the
//! port passport: same inputs, same seed, same hashes as the wasm path, or
//! the native build is not the same game.
//!
//! Unknown `formatVersion` is a hard error. A reader that "mostly" parses a
//! future format would hand the passport a subtly wrong input stream and
//! report a divergence that isn't real (or, worse, hide one that is).

const std = @import("std");
const msgpack = @import("msgpack.zig");

pub const FORMAT_VERSION_SUPPORTED: u64 = 1;

pub const Error = msgpack.Error || error{
    UnsupportedFormatVersion,
    MissingField,
    OutOfMemory,
};

pub const Backend = enum { unknown, wasm, ts };

pub const Player = struct {
    player_id: []const u8,
    character_id: []const u8,
    name: []const u8,
    color: []const u8,
    weapon_id: []const u8,
};

/// One recorded input, flattened. `at_tick` is the SERVER tick the frame
/// was applied on — playback batches by it so the re-sim sees the same
/// per-tick grouping the live match did.
pub const Input = struct {
    at_tick: u64,
    player_id: []const u8,
    seq: u64,
    tick: u64,
    keys: u64,
    aim_x: f64,
    aim_y: f64,
    dt_ms: f64,
};

pub const RosterEvent = struct {
    at_tick: u64,
    /// "join" or "leave".
    kind: []const u8,
    player_id: []const u8,
};

pub const Header = struct {
    format_version: u64 = 0,
    protocol_version: u64 = 0,
    match_id: []const u8 = "",
    map_id: []const u8 = "",
    rng_seed: u64 = 0,
    started_at_ms: u64 = 0,
    total_ticks: u64 = 0,
    sim_backend: Backend = .unknown,
    /// >0 means a pinned-wasm match fell back to TS mid-record, so the
    /// replay is not bit-exactly re-simulable by either backend alone.
    /// The passport must refuse such files rather than report divergence.
    backend_fallback_ticks: u64 = 0,
    players: []Player = &.{},
    chaos_modifier_ids: [][]const u8 = &.{},
};

pub const Replay = struct {
    header: Header,
    inputs: []Input,
    roster_events: []RosterEvent,
    /// Owns every slice above. String slices point INTO the caller's file
    /// buffer, which must outlive this.
    arena: std.heap.ArenaAllocator,

    pub fn deinit(self: *Replay) void {
        self.arena.deinit();
    }

    /// True when the recording is a clean single-backend run — the only
    /// kind the N0 passport can hold to bit-identity.
    pub fn isSingleBackend(self: *const Replay) bool {
        return self.backend_fallback_ticks_ok();
    }

    fn backend_fallback_ticks_ok(self: *const Replay) bool {
        return self.header.backend_fallback_ticks == 0;
    }
};

/// Parse `bytes` (a whole .jjr file). String fields alias `bytes`.
pub fn parse(gpa: std.mem.Allocator, bytes: []const u8) Error!Replay {
    var arena = std.heap.ArenaAllocator.init(gpa);
    errdefer arena.deinit();
    const a = arena.allocator();

    var d = msgpack.Decoder.init(bytes);
    var header: Header = .{};
    // 0.15.2's std.ArrayList is the UNMANAGED flavour: no .init(a), and the
    // allocator is passed per call.
    var inputs: std.ArrayList(Input) = .empty;
    var roster: std.ArrayList(RosterEvent) = .empty;
    var saw_header = false;

    const top_len = try d.readMapLen();
    var i: u32 = 0;
    while (i < top_len) : (i += 1) {
        const key = try d.readStr();
        if (std.mem.eql(u8, key, "header")) {
            header = try parseHeader(a, &d);
            saw_header = true;
        } else if (std.mem.eql(u8, key, "inputs")) {
            const n = try d.readArrayLen();
            try inputs.ensureTotalCapacity(a, n);
            var j: u32 = 0;
            while (j < n) : (j += 1) inputs.appendAssumeCapacity(try parseInput(&d));
        } else if (std.mem.eql(u8, key, "rosterEvents")) {
            const n = try d.readArrayLen();
            try roster.ensureTotalCapacity(a, n);
            var j: u32 = 0;
            while (j < n) : (j += 1) roster.appendAssumeCapacity(try parseRosterEvent(&d));
        } else {
            // Forward-compatible for ADDED top-level keys; the version gate
            // below is what actually protects us from format changes.
            try d.skipValue();
        }
    }

    if (!saw_header) return Error.MissingField;
    if (header.format_version != FORMAT_VERSION_SUPPORTED) {
        return Error.UnsupportedFormatVersion;
    }

    return .{
        .header = header,
        .inputs = try inputs.toOwnedSlice(a),
        .roster_events = try roster.toOwnedSlice(a),
        .arena = arena,
    };
}

fn parseHeader(a: std.mem.Allocator, d: *msgpack.Decoder) Error!Header {
    var h: Header = .{};
    const n = try d.readMapLen();
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const key = try d.readStr();
        if (std.mem.eql(u8, key, "formatVersion")) {
            h.format_version = try d.readU64();
        } else if (std.mem.eql(u8, key, "protocolVersion")) {
            h.protocol_version = try d.readU64();
        } else if (std.mem.eql(u8, key, "matchId")) {
            h.match_id = try d.readStr();
        } else if (std.mem.eql(u8, key, "mapId")) {
            h.map_id = try d.readStr();
        } else if (std.mem.eql(u8, key, "rngSeed")) {
            h.rng_seed = try d.readU64();
        } else if (std.mem.eql(u8, key, "startedAtMs")) {
            h.started_at_ms = try d.readU64();
        } else if (std.mem.eql(u8, key, "totalTicks")) {
            h.total_ticks = try d.readU64();
        } else if (std.mem.eql(u8, key, "backendFallbackTicks")) {
            h.backend_fallback_ticks = try d.readU64();
        } else if (std.mem.eql(u8, key, "simBackend")) {
            // Optional and nullable — absent on pre-field replays.
            switch (try d.next()) {
                .str => |s| h.sim_backend = if (std.mem.eql(u8, s, "wasm"))
                    .wasm
                else if (std.mem.eql(u8, s, "ts"))
                    .ts
                else
                    .unknown,
                .nil => h.sim_backend = .unknown,
                else => return Error.TypeMismatch,
            }
        } else if (std.mem.eql(u8, key, "players")) {
            const pn = try d.readArrayLen();
            const list = try a.alloc(Player, pn);
            var j: u32 = 0;
            while (j < pn) : (j += 1) list[j] = try parsePlayer(d);
            h.players = list;
        } else if (std.mem.eql(u8, key, "chaosModifierIds")) {
            const cn = try d.readArrayLen();
            const list = try a.alloc([]const u8, cn);
            var j: u32 = 0;
            while (j < cn) : (j += 1) list[j] = try d.readStr();
            h.chaos_modifier_ids = list;
        } else {
            try d.skipValue();
        }
    }
    return h;
}

fn parsePlayer(d: *msgpack.Decoder) Error!Player {
    var p: Player = .{
        .player_id = "",
        .character_id = "",
        .name = "",
        .color = "",
        .weapon_id = "",
    };
    const n = try d.readMapLen();
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const key = try d.readStr();
        if (std.mem.eql(u8, key, "playerId")) {
            p.player_id = try d.readStr();
        } else if (std.mem.eql(u8, key, "characterId")) {
            p.character_id = try d.readStr();
        } else if (std.mem.eql(u8, key, "name")) {
            p.name = try d.readStr();
        } else if (std.mem.eql(u8, key, "color")) {
            p.color = try d.readStr();
        } else if (std.mem.eql(u8, key, "weaponId")) {
            p.weapon_id = try d.readStr();
        } else {
            try d.skipValue();
        }
    }
    return p;
}

fn parseInput(d: *msgpack.Decoder) Error!Input {
    var in: Input = .{
        .at_tick = 0,
        .player_id = "",
        .seq = 0,
        .tick = 0,
        .keys = 0,
        .aim_x = 0,
        .aim_y = 0,
        .dt_ms = 0,
    };
    const n = try d.readMapLen();
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const key = try d.readStr();
        if (std.mem.eql(u8, key, "atTick")) {
            in.at_tick = try d.readU64();
        } else if (std.mem.eql(u8, key, "playerId")) {
            in.player_id = try d.readStr();
        } else if (std.mem.eql(u8, key, "frame")) {
            const fn_ = try d.readMapLen();
            var j: u32 = 0;
            while (j < fn_) : (j += 1) {
                const fk = try d.readStr();
                if (std.mem.eql(u8, fk, "seq")) {
                    in.seq = try d.readU64();
                } else if (std.mem.eql(u8, fk, "tick")) {
                    in.tick = try d.readU64();
                } else if (std.mem.eql(u8, fk, "keys")) {
                    in.keys = try d.readU64();
                } else if (std.mem.eql(u8, fk, "aimX")) {
                    in.aim_x = try d.readF64();
                } else if (std.mem.eql(u8, fk, "aimY")) {
                    in.aim_y = try d.readF64();
                } else if (std.mem.eql(u8, fk, "dtMs")) {
                    in.dt_ms = try d.readF64();
                } else {
                    try d.skipValue();
                }
            }
        } else {
            try d.skipValue();
        }
    }
    return in;
}

fn parseRosterEvent(d: *msgpack.Decoder) Error!RosterEvent {
    var e: RosterEvent = .{ .at_tick = 0, .kind = "", .player_id = "" };
    const n = try d.readMapLen();
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const key = try d.readStr();
        if (std.mem.eql(u8, key, "atTick")) {
            e.at_tick = try d.readU64();
        } else if (std.mem.eql(u8, key, "t")) {
            e.kind = try d.readStr();
        } else if (std.mem.eql(u8, key, "playerId")) {
            e.player_id = try d.readStr();
        } else if (std.mem.eql(u8, key, "spawn")) {
            // A join carries the full spawn; we only need its id here.
            const sn = try d.readMapLen();
            var j: u32 = 0;
            while (j < sn) : (j += 1) {
                const sk = try d.readStr();
                if (std.mem.eql(u8, sk, "playerId")) {
                    e.player_id = try d.readStr();
                } else {
                    try d.skipValue();
                }
            }
        } else {
            try d.skipValue();
        }
    }
    return e;
}

// ── tests ────────────────────────────────────────────────────────────────

const testing = std.testing;

/// Hand-rolled minimal replay: {header:{formatVersion:1,...}, inputs:[1],
/// rosterEvents:[]}. Written as raw bytes so the test does not depend on an
/// encoder we do not have — and so the fixture is checkable against the
/// `od` dump of a real archived file.
fn buildTinyReplay(gpa: std.mem.Allocator, buf: *std.ArrayList(u8), format_version: u8) !void {
    const put = struct {
        fn s(g: std.mem.Allocator, b: *std.ArrayList(u8), bytes: []const u8) !void {
            try b.appendSlice(g, bytes);
        }
        fn b1(g: std.mem.Allocator, b: *std.ArrayList(u8), byte: u8) !void {
            try b.append(g, byte);
        }
    };

    try put.s(gpa, buf, &[_]u8{ 0x83, 0xa6 }); // fixmap(3), fixstr(6)
    try put.s(gpa, buf, "header");
    try put.s(gpa, buf, &[_]u8{ 0x84, 0xad }); // fixmap(4), fixstr(13)
    try put.s(gpa, buf, "formatVersion");
    try put.b1(gpa, buf, format_version);
    try put.b1(gpa, buf, 0xa7);
    try put.s(gpa, buf, "rngSeed");
    try put.s(gpa, buf, &[_]u8{ 0xcd, 0x30, 0x39 }); // uint16 12345
    try put.b1(gpa, buf, 0xa5);
    try put.s(gpa, buf, "mapId");
    try put.b1(gpa, buf, 0xa3);
    try put.s(gpa, buf, "box");
    try put.b1(gpa, buf, 0xa7);
    try put.s(gpa, buf, "players");
    try put.s(gpa, buf, &[_]u8{ 0x91, 0x81, 0xa8 }); // array(1), map(1), fixstr(8)
    try put.s(gpa, buf, "playerId");
    try put.b1(gpa, buf, 0xa2);
    try put.s(gpa, buf, "p1");

    try put.b1(gpa, buf, 0xa6);
    try put.s(gpa, buf, "inputs");
    try put.s(gpa, buf, &[_]u8{ 0x91, 0x83, 0xa6 }); // array(1), map(3), fixstr(6)
    try put.s(gpa, buf, "atTick");
    try put.b1(gpa, buf, 0x2a); // 42
    try put.b1(gpa, buf, 0xa8);
    try put.s(gpa, buf, "playerId");
    try put.b1(gpa, buf, 0xa2);
    try put.s(gpa, buf, "p1");
    try put.b1(gpa, buf, 0xa5);
    try put.s(gpa, buf, "frame");
    try put.s(gpa, buf, &[_]u8{ 0x83, 0xa4 }); // map(3), fixstr(4)
    try put.s(gpa, buf, "keys");
    try put.b1(gpa, buf, 0x05);
    try put.b1(gpa, buf, 0xa4);
    try put.s(gpa, buf, "aimX");
    try put.s(gpa, buf, &[_]u8{ 0xcb, 0x3f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 }); // 1.5
    try put.b1(gpa, buf, 0xa4);
    try put.s(gpa, buf, "dtMs");
    try put.b1(gpa, buf, 0x10); // 16

    try put.b1(gpa, buf, 0xac);
    try put.s(gpa, buf, "rosterEvents");
    try put.b1(gpa, buf, 0x90); // array(0)
}

test "parses a minimal replay" {
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(testing.allocator);
    try buildTinyReplay(testing.allocator, &buf, 1);

    var r = try parse(testing.allocator, buf.items);
    defer r.deinit();

    try testing.expectEqual(@as(u64, 1), r.header.format_version);
    try testing.expectEqual(@as(u64, 12345), r.header.rng_seed);
    try testing.expectEqualStrings("box", r.header.map_id);
    try testing.expectEqual(@as(usize, 1), r.header.players.len);
    try testing.expectEqualStrings("p1", r.header.players[0].player_id);

    try testing.expectEqual(@as(usize, 1), r.inputs.len);
    try testing.expectEqual(@as(u64, 42), r.inputs[0].at_tick);
    try testing.expectEqual(@as(u64, 5), r.inputs[0].keys);
    try testing.expectEqual(@as(f64, 1.5), r.inputs[0].aim_x);
    try testing.expectEqual(@as(f64, 16), r.inputs[0].dt_ms);
    try testing.expectEqual(@as(usize, 0), r.roster_events.len);
    try testing.expect(r.isSingleBackend());
}

test "an unknown formatVersion is refused, not best-guessed" {
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(testing.allocator);
    try buildTinyReplay(testing.allocator, &buf, 2);
    try testing.expectError(Error.UnsupportedFormatVersion, parse(testing.allocator, buf.items));
}

test "a truncated file is an error, not a partial replay" {
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(testing.allocator);
    try buildTinyReplay(testing.allocator, &buf, 1);
    const cut = buf.items[0 .. buf.items.len / 2];
    try testing.expectError(msgpack.Error.Truncated, parse(testing.allocator, cut));
}
