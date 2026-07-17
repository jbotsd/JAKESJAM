// Comprehensive exports-manifest smoke test. Loads sim.wasm and
// confirms every named export is callable. Catches the class of
// regressions where a Zig refactor accidentally drops an `export`
// or renames it. Doesn't validate output correctness — that's
// what the per-module parity tests do.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

// The names below are the contract. If a Zig refactor renames or
// removes any of these without updating the test, this fails. New
// exports get added here as they ship.
const REQUIRED_EXPORTS: ReadonlyArray<string> = [
  // sim core
  "alloc_state", "free_state", "state_size", "current_tick", "reset", "step",
  // rng
  "rng_next_u32", "rng_next_int",
  // hash
  "hash_fnv1a_basis", "hash_fnv1a_mix", "hash_mix_u32", "hash_quantise",
  // trig LUT
  "lut_sin", "lut_cos", "lut_atan2",
  "lut_sin_table_ptr", "lut_atan_table_ptr", "lut_table_size",
  // collision: sweep + slide
  "sweep_against_one_flat", "sweep_aabb_many", "sweep_aabb_cached",
  "resolve_move", "resolve_move_cached",
  // collision: circles
  "circle_overlaps_aabb", "circle_hits_any", "circle_bounce",
  // spatial grid
  "spatial_build_grid", "spatial_query_grid",
  "spatial_cell_size_default", "spatial_max_aabbs",
  // player
  "step_player",
  // true slopes (module-level statics, launch-pad pattern)
  "world_state_set_slopes",
  // projectile motion + helpers
  "step_projectile",
  "projectile_apply_float", "projectile_apply_accelerate",
  "projectile_rotate_velocity_toward",
  "projectile_closest_non_owner_player",
  "projectile_boomerang_should_return",
  "projectile_boomerang_turn_rate",
  "projectile_homing_turn_rate_default",
  "projectile_bounce_resolve",
  "projectile_anti_homing_target",
  // weapon
  "weapon_muzzle_position", "weapon_recoil",
  "weapon_tick_cooldown", "weapon_spread_offset",
  "weapon_cooldown_from_fire_rate",
  // satellite
  "satellite_tick",
  "satellite_orbit_rad_per_sec", "satellite_fire_cooldown_ms",
  // combat
  "combat_wrap_angle", "combat_is_hit_in_parry_arc",
  "combat_shield_drain", "combat_parry_arc_radians",
  // destructible
  "destructible_apply_damage", "destructible_player_in_blast",
  "destructible_center_to_aabb",
  // fire
  "fire_patch_tick", "fire_patch_damage", "fire_patch_hits_player",
  // sizeof helpers
  "sizeof_aabb", "sizeof_sweep_hit", "sizeof_resolve_move_out",
  "sizeof_player_step",
  "sizeof_projectile_kinematics", "sizeof_projectile_step_result",
  "sizeof_circle_bounce", "sizeof_bounce_resolve",
  "sizeof_satellite_tick_input", "sizeof_satellite_tick_output",
  "sizeof_muzzle_position", "sizeof_recoil_impulse",
  "sizeof_fire_patch_tick_result",
];

describe("wasm exports manifest", () => {
  test("every required export exists and is callable", () => {
    const got = sim.exports as unknown as Record<string, unknown>;
    const missing: string[] = [];
    const notCallable: string[] = [];
    for (const name of REQUIRED_EXPORTS) {
      const v = got[name];
      if (v === undefined) {
        missing.push(name);
        continue;
      }
      if (typeof v !== "function") notCallable.push(name);
    }
    if (missing.length > 0) {
      console.error(`Missing exports:\n  ${missing.join("\n  ")}`);
    }
    if (notCallable.length > 0) {
      console.error(`Non-callable exports:\n  ${notCallable.join("\n  ")}`);
    }
    expect(missing).toEqual([]);
    expect(notCallable).toEqual([]);
  });

  test("memory + state buffer survive boot", () => {
    expect(sim.exports.memory).toBeDefined();
    expect(sim.statePtr).toBeGreaterThanOrEqual(0);
    expect(sim.stateLen).toBeGreaterThan(0);
  });

  test("sizeof_* exports return non-zero", () => {
    const ex = sim.exports as unknown as Record<string, () => number>;
    const sizes = [
      ex.sizeof_aabb!(),
      ex.sizeof_sweep_hit!(),
      ex.sizeof_resolve_move_out!(),
      ex.sizeof_player_step!(),
      ex.sizeof_projectile_kinematics!(),
      ex.sizeof_projectile_step_result!(),
    ];
    for (const s of sizes) expect(s).toBeGreaterThan(0);
  });

  test("trig LUT install pointers are valid offsets into wasm memory", () => {
    const sinPtr = sim.exports.lut_sin_table_ptr();
    const atanPtr = sim.exports.lut_atan_table_ptr();
    const tableSize = sim.exports.lut_table_size();
    expect(sinPtr).toBeGreaterThan(0);
    expect(atanPtr).toBeGreaterThan(0);
    expect(tableSize).toBe(1024);
    // Tables must be readable.
    const sinView = new Float64Array(sim.exports.memory.buffer, sinPtr, tableSize);
    expect(sinView[0]).toBe(0); // sin(0) = 0
    expect(sinView[tableSize - 1]).toBeGreaterThan(0.99); // sin(~π/2) ≈ 1
  });
});
