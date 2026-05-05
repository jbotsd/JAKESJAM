// H8b gate — wasm weapon_base_by_id matches the TS-side
// starterWeapon definition in client/src/sim/data/weapons.ts.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { starterWeapon } from "../../data/weapons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

type WeaponExports = {
  weapon_base_by_id: (id: number, out_ptr: number) => void;
  weapon_count: () => number;
  sizeof_weapon_base: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as WeaponExports;

const OUT_PTR = sim.statePtr;

describe("weapon data parity (Phase H8b)", () => {
  test("count matches TS weapons table length", () => {
    expect(ex.weapon_count()).toBe(1);
    expect(ex.sizeof_weapon_base()).toBeGreaterThan(0);
  });

  test("starter pistol fields match starterWeapon", () => {
    ex.weapon_base_by_id(0, OUT_PTR);
    const view = new DataView(ex.memory.buffer);
    let off = OUT_PTR;
    const damage = view.getFloat64(off, true);
    off += 8;
    const fireRate = view.getFloat64(off, true);
    off += 8;
    const projSpeed = view.getFloat64(off, true);
    off += 8;
    const projLifetimeSec = view.getFloat64(off, true);
    off += 8;
    const spreadRad = view.getFloat64(off, true);
    off += 8;
    const recoil = view.getFloat64(off, true);
    off += 8;
    const knockback = view.getFloat64(off, true);
    off += 8;
    expect(damage).toBe(starterWeapon.damage);
    expect(fireRate).toBe(starterWeapon.fireRate);
    expect(projSpeed).toBe(starterWeapon.projectileSpeed);
    expect(projLifetimeSec).toBe(starterWeapon.projectileLifetimeSeconds);
    expect(spreadRad).toBe(starterWeapon.spreadRadians);
    expect(recoil).toBe(starterWeapon.recoilImpulse);
    expect(knockback).toBe(starterWeapon.knockbackImpulse);
  });

  test("out-of-range id falls back to starter without error", () => {
    ex.weapon_base_by_id(999, OUT_PTR);
    const view = new DataView(ex.memory.buffer);
    expect(view.getFloat64(OUT_PTR, true)).toBe(starterWeapon.damage);
  });
});
