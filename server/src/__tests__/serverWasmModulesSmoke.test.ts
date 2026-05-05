// Server-side smoke test for ALL wasm modules. Currently the
// server's existing parity tests cover collision + player + the
// trig LUT install. This adds a comprehensive smoke that loads
// the wasm via `loadServerSim`, then pings every other module's
// primary export with sentinel inputs to confirm:
//   1. Server-side Bun WebAssembly load handles every export.
//   2. The exports return non-NaN, non-zero results where
//      expected.
//   3. Memory views are reachable (not detached).

import { describe, expect, test } from "bun:test";
import { loadServerSim } from "../wasmRuntime.ts";

describe("server wasm modules smoke", () => {
  test("loadServerSim instantiates with every module's exports", async () => {
    const got = await loadServerSim();
    expect(got).not.toBeNull();
    const ex = got!.ex as unknown as Record<string, unknown>;

    // Sample one export per module — if any of these is missing,
    // the wasm artifact is incomplete or the loader broke.
    const required = [
      "rng_next_u32",
      "hash_fnv1a_basis",
      "lut_sin",
      "sweep_against_one_flat",
      "circle_overlaps_aabb",
      "spatial_build_grid",
      "step_player",
      "step_projectile",
      "step_projectile_v2",
      "weapon_muzzle_position",
      "satellite_tick",
      "combat_is_hit_in_parry_arc",
      "destructible_apply_damage",
      "fire_patch_tick",
    ];
    for (const name of required) {
      expect(typeof ex[name]).toBe("function");
    }
  });

  test("hash module: FNV1A basis matches the documented constant", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as { hash_fnv1a_basis(): number };
    expect(ex.hash_fnv1a_basis() >>> 0).toBe(0x811c9dc5);
  });

  test("rng module: same seed → same sequence on the server", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as { rng_next_u32(s: number): number };
    let a = 1234567;
    let b = 1234567;
    for (let i = 0; i < 100; i++) {
      a = ex.rng_next_u32(a) >>> 0;
      b = ex.rng_next_u32(b) >>> 0;
      expect(a).toBe(b);
    }
  });

  test("trig LUT: sin(0) = 0, atan2(0, 1) = 0", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as {
      lut_sin(x: number): number;
      lut_atan2(y: number, x: number): number;
    };
    expect(ex.lut_sin(0)).toBe(0);
    expect(ex.lut_atan2(0, 1)).toBe(0);
  });

  test("weapon module: muzzle reach = 0 returns player position", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as {
      weapon_muzzle_position(
        px: number, py: number, ax: number, ay: number, reach: number,
        outPtr: number,
      ): void;
      memory: WebAssembly.Memory;
    };
    const ptr = got!.statePtr;
    ex.weapon_muzzle_position(100, 200, 300, 400, 0, ptr);
    const dv = new DataView(ex.memory.buffer);
    expect(dv.getFloat64(ptr + 0, true)).toBe(100);
    expect(dv.getFloat64(ptr + 8, true)).toBe(200);
  });

  test("destructible module: hp clamps at 0", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as {
      destructible_apply_damage(hp: number, dmg: number): number;
    };
    expect(ex.destructible_apply_damage(50, 100)).toBe(0);
    expect(ex.destructible_apply_damage(50, 25)).toBe(25);
  });

  test("fire module: damage = dps × dt", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as {
      fire_patch_damage(dps: number, dt: number): number;
    };
    expect(ex.fire_patch_damage(60, 1000)).toBe(60);
    expect(ex.fire_patch_damage(14, 1000 / 60)).toBe(14 * (1000 / 60) / 1000);
  });

  test("combat module: parry arc is π/3", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as {
      combat_parry_arc_radians(): number;
    };
    expect(ex.combat_parry_arc_radians()).toBe(Math.PI / 3);
  });

  test("spatial grid: cell_size_default + max_aabbs", async () => {
    const got = await loadServerSim();
    const ex = got!.ex as unknown as {
      spatial_cell_size_default(): number;
      spatial_max_aabbs(): number;
    };
    expect(ex.spatial_cell_size_default()).toBe(128);
    expect(ex.spatial_max_aabbs()).toBeGreaterThanOrEqual(80);
  });
});
