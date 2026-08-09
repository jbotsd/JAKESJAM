//! gospel N-AIM / E4 — the aim-intent dialect, in the core.
//!
//! E4's shape: "input semantics (mouse exact / touch assisted / stick
//! assisted+snap) become a sim-level input dialect so every platform shell
//! feeds the same aim contract." This is that dialect. The BROWSER already
//! implements the assisted variant in `client/src/game/input/
//! touchAimAssist.ts`; porting it here is the "do it once" move — the
//! raylib shell and any future gamepad path resolve aim through the same
//! code rather than growing a second, slightly-different assist.
//!
//! THE CONTRACT, stated because it was implicit and cost a night: a shell
//! submits a WORLD-SPACE aim point. How it gets there is the shell's
//! business (a mouse goes through the camera; a stick goes through this).
//! The sim never sees screen coordinates. An e2e that assumed the camera
//! centres the player aimed 174px high for hours precisely because that
//! conversion was nobody's documented job — see the venue 2.5 entry in
//! gospel-goal.md.
//!
//! Scope: `exact` and `assisted` ship here. `snap` (gamepad) is named in
//! the enum but deliberately unimplemented — it arrives with the gamepad
//! work, and a guessed implementation now would be a second thing to keep
//! in parity for no current consumer.

const std = @import("std");
const world_state = @import("world_state.zig");

pub const AimDialect = enum(u8) {
    /// Mouse. The shell's world point IS the aim; no transform.
    exact = 0,
    /// Touch. Soft cone assist toward the nearest living enemy.
    assisted = 1,
    /// Gamepad. Assist plus target snap — NOT implemented yet; resolving
    /// with this today behaves as `assisted` rather than silently doing
    /// nothing, so a shell that asks for it is merely un-upgraded, not
    /// broken.
    snap = 2,
};

pub const ASSIST_RANGE_PX: f64 = 900;
/// cos(20°) — outside this cone the assist contributes nothing.
pub const CONE_COS: f64 = 0.9396926207859084;
pub const MAX_BLEND: f64 = 0.6;

pub const Vec2 = struct { x: f64, y: f64 };

/// Blend `stick` toward the nearest living enemy inside the assist cone.
/// Returns `stick` unchanged when nothing is eligible.
///
/// Transcribed in the SAME order as the TS, including the `dist < 1` guard
/// and the strict `>` on the cosine: nearest-to-crosshair wins rather than
/// nearest-by-distance, so the player's stick intent is the tiebreaker,
/// and a reordering would silently pick a different target.
pub fn assistAim(
    state: *const world_state.WorldState,
    local_index: u32,
    origin: Vec2,
    stick: Vec2,
) Vec2 {
    const len = @sqrt(stick.x * stick.x + stick.y * stick.y);
    if (len < 1e-6) return stick;
    const dx = stick.x / len;
    const dy = stick.y / len;

    var best_cos = CONE_COS;
    var best_tx: f64 = 0;
    var best_ty: f64 = 0;
    var found = false;

    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (i == local_index) continue;
        const p = &state.players[i];
        if (!p.flags.alive or p.health <= 0) continue;
        const ox = p.x - origin.x;
        const oy = p.y - origin.y;
        const dist = @sqrt(ox * ox + oy * oy);
        if (dist < 1 or dist > ASSIST_RANGE_PX) continue;
        const cos = (ox * dx + oy * dy) / dist;
        if (cos > best_cos) {
            best_cos = cos;
            best_tx = ox / dist;
            best_ty = oy / dist;
            found = true;
        }
    }
    if (!found) return stick;

    const t = ((best_cos - CONE_COS) / (1 - CONE_COS)) * MAX_BLEND;
    const bx = dx + (best_tx - dx) * t;
    const by = dy + (best_ty - dy) * t;
    const blen = @sqrt(bx * bx + by * by);
    if (blen < 1e-6) return stick;
    return .{ .x = bx / blen, .y = by / blen };
}

/// Resolve a shell's raw aim into the world point the sim will use.
///
/// `exact` returns the shell's point untouched — the whole mouse path.
/// `assisted`/`snap` treat the point as a DIRECTION from the origin and
/// project it back out at `reach`, which is what the touch path does
/// today (AIM_REACH in OnlineMatchScene).
pub fn resolveAim(
    dialect: AimDialect,
    state: *const world_state.WorldState,
    local_index: u32,
    origin: Vec2,
    raw: Vec2,
    reach: f64,
) Vec2 {
    switch (dialect) {
        .exact => return raw,
        .assisted, .snap => {
            const dir = assistAim(state, local_index, origin, raw);
            return .{ .x = origin.x + dir.x * reach, .y = origin.y + dir.y * reach };
        },
    }
}

// ── Parity exports ───────────────────────────────────────────────────────

/// Writes the assisted direction into `out` as [x, y].
pub export fn aim_assist_dir(
    state_ptr: *const world_state.WorldState,
    local_index: u32,
    origin_x: f64,
    origin_y: f64,
    stick_x: f64,
    stick_y: f64,
    out: [*]f64,
) void {
    const d = assistAim(
        state_ptr,
        local_index,
        .{ .x = origin_x, .y = origin_y },
        .{ .x = stick_x, .y = stick_y },
    );
    out[0] = d.x;
    out[1] = d.y;
}

/// Writes the resolved world aim into `out` as [x, y].
pub export fn aim_resolve(
    state_ptr: *const world_state.WorldState,
    dialect_raw: u8,
    local_index: u32,
    origin_x: f64,
    origin_y: f64,
    raw_x: f64,
    raw_y: f64,
    reach: f64,
    out: [*]f64,
) void {
    const dialect: AimDialect = @enumFromInt(if (dialect_raw <= 2) dialect_raw else 0);
    const a = resolveAim(
        dialect,
        state_ptr,
        local_index,
        .{ .x = origin_x, .y = origin_y },
        .{ .x = raw_x, .y = raw_y },
        reach,
    );
    out[0] = a.x;
    out[1] = a.y;
}
