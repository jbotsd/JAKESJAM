// H8a gate — wasm chaos_profile_from_mask produces the same
// ChaosProfile as the TS-side `getChaosProfile` in
// `client/src/sim/data/chaosModifiers.ts`.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  CHAOS_MODIFIER_IDS,
  getChaosProfile,
  type ChaosModifierId,
} from "../../data/chaosModifiers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

type ChaosExports = {
  chaos_profile_from_mask: (mask: number, out_ptr: number) => void;
  sizeof_chaos_profile: () => number;
  chaos_modifier_count: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as ChaosExports;

const SIZEOF = ex.sizeof_chaos_profile();
const OUT_PTR = sim.statePtr;

function readProfile(): {
  gravity_multiplier: number;
  time_scale: number;
  damage_multiplier: number;
  fire_rate_multiplier: number;
  recoil_multiplier: number;
  fire_hazard_interval_ms: number;
  disable_projectiles: number;
  random_shapes: number;
  fire_hazard_active: number;
} {
  const view = new DataView(ex.memory.buffer);
  let off = OUT_PTR;
  const gravity_multiplier = view.getFloat64(off, true);
  off += 8;
  const time_scale = view.getFloat64(off, true);
  off += 8;
  const damage_multiplier = view.getFloat64(off, true);
  off += 8;
  const fire_rate_multiplier = view.getFloat64(off, true);
  off += 8;
  const recoil_multiplier = view.getFloat64(off, true);
  off += 8;
  const fire_hazard_interval_ms = view.getFloat64(off, true);
  off += 8;
  const disable_projectiles = view.getUint8(off);
  off += 1;
  const random_shapes = view.getUint8(off);
  off += 1;
  const fire_hazard_active = view.getUint8(off);
  return {
    gravity_multiplier,
    time_scale,
    damage_multiplier,
    fire_rate_multiplier,
    recoil_multiplier,
    fire_hazard_interval_ms,
    disable_projectiles,
    random_shapes,
    fire_hazard_active,
  };
}

function maskOf(...ids: ChaosModifierId[]): number {
  let mask = 0;
  for (const id of ids) {
    const idx = (CHAOS_MODIFIER_IDS as readonly string[]).indexOf(id);
    if (idx < 0) throw new Error(`unknown id ${id}`);
    mask |= 1 << idx;
  }
  return mask;
}

describe("chaos data parity (Phase H8a)", () => {
  test("constants match TS", () => {
    expect(SIZEOF).toBe(56);
    expect(ex.chaos_modifier_count()).toBe(CHAOS_MODIFIER_IDS.length);
  });

  test("empty mask → NEUTRAL profile", () => {
    ex.chaos_profile_from_mask(0, OUT_PTR);
    const p = readProfile();
    expect(p.gravity_multiplier).toBe(1);
    expect(p.time_scale).toBe(1);
    expect(p.damage_multiplier).toBe(1);
    expect(p.fire_rate_multiplier).toBe(1);
    expect(p.recoil_multiplier).toBe(1);
    expect(p.disable_projectiles).toBe(0);
    expect(p.random_shapes).toBe(0);
    expect(p.fire_hazard_active).toBe(0);
  });

  test("low-gravity → 0.46 multiplier", () => {
    ex.chaos_profile_from_mask(maskOf("low-gravity"), OUT_PTR);
    expect(readProfile().gravity_multiplier).toBe(0.46);
  });

  test("golden-gun composes damage * fire-rate * recoil", () => {
    ex.chaos_profile_from_mask(maskOf("golden-gun"), OUT_PTR);
    const p = readProfile();
    expect(p.damage_multiplier).toBe(9);
    expect(p.fire_rate_multiplier).toBe(0.28);
    expect(p.recoil_multiplier).toBe(1.8);
  });

  test("slappers-only sets disable_projectiles + recoil", () => {
    ex.chaos_profile_from_mask(maskOf("slappers-only"), OUT_PTR);
    const p = readProfile();
    expect(p.disable_projectiles).toBe(1);
    expect(p.recoil_multiplier).toBe(2.8);
  });

  test("fire-hazard sets active=1 + interval=2400", () => {
    ex.chaos_profile_from_mask(maskOf("fire-hazard"), OUT_PTR);
    const p = readProfile();
    expect(p.fire_hazard_active).toBe(1);
    expect(p.fire_hazard_interval_ms).toBe(2400);
  });

  test("multiple modifiers compose multiplicatively + OR booleans", () => {
    ex.chaos_profile_from_mask(
      maskOf("low-gravity", "golden-gun", "max-recoil"),
      OUT_PTR,
    );
    const p = readProfile();
    expect(p.gravity_multiplier).toBe(0.46);
    expect(p.damage_multiplier).toBe(9);
    // golden-gun 1.8 × max-recoil 3.6 = 6.48
    expect(p.recoil_multiplier).toBeCloseTo(6.48, 6);
  });

  test("matches TS getChaosProfile across all single-modifier masks", () => {
    for (const id of CHAOS_MODIFIER_IDS) {
      ex.chaos_profile_from_mask(maskOf(id), OUT_PTR);
      const wasm = readProfile();
      const ts = getChaosProfile([id]);
      expect(wasm.gravity_multiplier).toBe(ts.gravityMultiplier);
      expect(wasm.time_scale).toBe(ts.timeScale);
      expect(wasm.damage_multiplier).toBe(ts.damageMultiplier);
      expect(wasm.fire_rate_multiplier).toBe(ts.fireRateMultiplier);
      expect(wasm.recoil_multiplier).toBe(ts.recoilMultiplier);
      expect(Boolean(wasm.disable_projectiles)).toBe(ts.disableProjectiles);
      expect(Boolean(wasm.random_shapes)).toBe(ts.randomShapes);
      expect(Boolean(wasm.fire_hazard_active)).toBe(ts.fireHazardActive);
    }
  });
});
