//! Static spatial grid — bit-exact port of `buildSpatialGrid` +
//! `queryGrid` from `client/src/sim/collision.ts`. Phase F2b.
//!
//! TS uses `Map<int, number[]>` for cell buckets which is GC-heavy
//! and unavailable in wasm-freestanding. Zig version uses fixed
//! static arrays sized for the worst case (256 cells × 16 entries
//! per cell). The "seen" set for query dedup is a bitset.
//!
//! Iteration order is identical to TS:
//!   - build: iterate AABBs 0..N, push to each (r, c) bucket
//!   - query: iterate (r, c) in row-major order, then bucket
//!     entries in insertion order, dedupe via bitset
//! → matches TS `Map.get(key)` insertion-order iteration exactly.

const std = @import("std");
const collision = @import("collision.zig");

pub const SPATIAL_CELL_SIZE: f64 = 128.0;
pub const MAX_CELLS_X: usize = 16;
pub const MAX_CELLS_Y: usize = 16;
pub const MAX_CELLS: usize = MAX_CELLS_X * MAX_CELLS_Y;
pub const MAX_PER_CELL: usize = 16;
pub const MAX_AABBS: usize = 256;
pub const SEEN_WORDS: usize = (MAX_AABBS + 63) / 64;

/// Module-global grid. Single match instance — the host calls
/// `build_spatial_grid` once per match, then queries hot-path.
var g_cell_counts: [MAX_CELLS]u32 = @splat(0);
var g_cell_buckets: [MAX_CELLS][MAX_PER_CELL]u32 = undefined;
var g_cell_size: f64 = SPATIAL_CELL_SIZE;
var g_cols: u32 = 0;
var g_rows: u32 = 0;
var g_seen: [SEEN_WORDS]u64 = @splat(0);

inline fn cellKey(col: u32, row: u32, cols: u32) u32 {
    return row * cols + col;
}

fn floorIntFromF64(v: f64) i64 {
    return @intFromFloat(@floor(v));
}

/// Build the grid from the given AABBs. Replaces previous grid.
/// Matches `buildSpatialGrid(aabbs, worldWidth, worldHeight, cellSize)`.
pub fn buildSpatialGrid(
    aabbs: []const collision.AABB,
    world_width: f64,
    world_height: f64,
    cell_size: f64,
) void {
    const cs = cell_size;
    const cols_raw: i64 = @intFromFloat(@ceil(world_width / cs));
    const rows_raw: i64 = @intFromFloat(@ceil(world_height / cs));
    // Match TS: cols = ceil(W/cs) + 1
    const cols: u32 = @intCast(@max(1, cols_raw + 1));
    const rows: u32 = @intCast(@max(1, rows_raw + 1));

    g_cell_size = cs;
    g_cols = cols;
    g_rows = rows;

    // Reset only the cells we'll touch — saves work for sparse grids.
    const total_cells: usize = @intCast(@as(usize, cols) * @as(usize, rows));
    var i: usize = 0;
    while (i < total_cells and i < MAX_CELLS) : (i += 1) {
        g_cell_counts[i] = 0;
    }

    var ai: usize = 0;
    while (ai < aabbs.len and ai < MAX_AABBS) : (ai += 1) {
        const a = aabbs[ai];
        const min_col_raw: i64 = floorIntFromF64(a.x / cs);
        const max_col_raw: i64 = floorIntFromF64((a.x + a.w) / cs);
        const min_row_raw: i64 = floorIntFromF64(a.y / cs);
        const max_row_raw: i64 = floorIntFromF64((a.y + a.h) / cs);

        const min_col: u32 = @intCast(@max(0, min_col_raw));
        const max_col_clamped: i64 = @min(@as(i64, @intCast(cols - 1)), max_col_raw);
        const max_col: u32 = @intCast(@max(0, max_col_clamped));
        const min_row: u32 = @intCast(@max(0, min_row_raw));
        const max_row_clamped: i64 = @min(@as(i64, @intCast(rows - 1)), max_row_raw);
        const max_row: u32 = @intCast(@max(0, max_row_clamped));

        var r: u32 = min_row;
        while (r <= max_row) : (r += 1) {
            var c: u32 = min_col;
            while (c <= max_col) : (c += 1) {
                const key: usize = @intCast(cellKey(c, r, cols));
                if (key >= MAX_CELLS) continue;
                const count = g_cell_counts[key];
                if (count >= MAX_PER_CELL) continue; // overflow — drop
                g_cell_buckets[key][count] = @intCast(ai);
                g_cell_counts[key] = count + 1;
            }
        }
    }
}

inline fn seenSet(idx: usize) bool {
    if (idx >= MAX_AABBS) return true; // out of range = treat as already seen
    const word: usize = idx >> 6;
    const bit: u6 = @intCast(idx & 63);
    const mask: u64 = @as(u64, 1) << bit;
    if ((g_seen[word] & mask) != 0) return true;
    g_seen[word] |= mask;
    return false;
}

inline fn seenClear() void {
    var i: usize = 0;
    while (i < SEEN_WORDS) : (i += 1) g_seen[i] = 0;
}

/// Query the grid. Writes deduped indices into `out` in TS-Map
/// iteration order. Returns the count written. `out_capacity` must
/// be >= MAX_AABBS or callers must size adequately.
pub fn queryGrid(
    region: collision.AABB,
    out: []u32,
) u32 {
    seenClear();
    var written: u32 = 0;

    const cs = g_cell_size;
    const cols = g_cols;

    const min_col_raw: i64 = floorIntFromF64(region.x / cs);
    const max_col_raw: i64 = floorIntFromF64((region.x + region.w) / cs);
    const min_row_raw: i64 = floorIntFromF64(region.y / cs);
    const max_row_raw: i64 = floorIntFromF64((region.y + region.h) / cs);

    const min_col: u32 = @intCast(@max(0, min_col_raw));
    const max_col: i64 = max_col_raw;
    const min_row: u32 = @intCast(@max(0, min_row_raw));
    const max_row: i64 = max_row_raw;

    if (max_col < @as(i64, @intCast(min_col))) return 0;
    if (max_row < @as(i64, @intCast(min_row))) return 0;
    const max_col_u: u32 = @intCast(max_col);
    const max_row_u: u32 = @intCast(max_row);

    var r: u32 = min_row;
    while (r <= max_row_u) : (r += 1) {
        if (r >= g_rows) break;
        var c: u32 = min_col;
        while (c <= max_col_u) : (c += 1) {
            if (c >= cols) break;
            const key: usize = @intCast(cellKey(c, r, cols));
            if (key >= MAX_CELLS) continue;
            const count = g_cell_counts[key];
            var ki: u32 = 0;
            while (ki < count) : (ki += 1) {
                const idx = g_cell_buckets[key][ki];
                if (!seenSet(@intCast(idx))) {
                    if (written < out.len) {
                        out[written] = idx;
                        written += 1;
                    }
                }
            }
        }
    }
    return written;
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn spatial_build_grid(
    aabbs_ptr: [*]const collision.AABB,
    aabbs_count: u32,
    world_width: f64,
    world_height: f64,
    cell_size: f64,
) void {
    buildSpatialGrid(aabbs_ptr[0..aabbs_count], world_width, world_height, cell_size);
}

pub export fn spatial_query_grid(
    region_x: f64,
    region_y: f64,
    region_w: f64,
    region_h: f64,
    out_ptr: [*]u32,
    out_capacity: u32,
) u32 {
    const region = collision.AABB{ .x = region_x, .y = region_y, .w = region_w, .h = region_h };
    return queryGrid(region, out_ptr[0..out_capacity]);
}

pub export fn spatial_cell_size_default() f64 {
    return SPATIAL_CELL_SIZE;
}

pub export fn spatial_max_aabbs() u32 {
    return MAX_AABBS;
}
