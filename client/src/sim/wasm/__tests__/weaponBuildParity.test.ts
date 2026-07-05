// Cutover-to-100%-Zig gate — the Zig in-sim build resolver (weapon_build.zig,
// fed by codegen'd cards_gen.zig) must produce byte-identical ResolvedFireConfig
// to the TS createWeaponBuild → packResolvedFireConfig pipeline, for EVERY card.
// If this holds, the host-side writeFireConfigs can be retired.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { WORLD_STATE_TOTAL_SIZE } from "../worldStateBridge";
import { createWeaponBuild } from "../../data/weaponBuild";
import { packResolvedFireConfig } from "../../data/packResolvedFireConfig";
import { crystalRoundsCards } from "../../data/cards";
import { starterWeapon } from "../../data/weapons";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  resolve_build_test: (i: number, out: number) => void;
  resolve_build_card_count: () => number;
};

const cards = crystalRoundsCards.filter((c) => c.modifier);
const SCRATCH = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 4096;

function zig(i: number): DataView {
  ex.resolve_build_test(i, SCRATCH);
  return new DataView(ex.memory.buffer, SCRATCH, 232);
}
function ts(i: number) {
  return packResolvedFireConfig(
    createWeaponBuild(starterWeapon, i < 0 ? [] : [cards[i]!]),
  );
}

function compare(i: number, label: string) {
  const z = zig(i);
  const t = ts(i);
  const F = (off: number) => z.getFloat64(off, true);
  const U32 = (off: number) => z.getUint32(off, true);
  const U8 = (off: number) => z.getUint8(off);
  const ctx = ` [${label}]`;
  expect(F(0), "damage" + ctx).toBeCloseTo(t.damage, 6);
  expect(F(8), "fireRate" + ctx).toBeCloseTo(t.fireRate, 6);
  expect(F(16), "projSpeed" + ctx).toBeCloseTo(t.projectileSpeed, 6);
  expect(F(24), "projLifetime" + ctx).toBeCloseTo(t.projectileLifetimeSeconds, 6);
  expect(F(32), "spread" + ctx).toBeCloseTo(t.spreadRadians, 6);
  expect(F(40), "rangePx" + ctx).toBeCloseTo(t.rangePx, 6);
  expect(F(48), "homing" + ctx).toBeCloseTo(t.homingStrength, 6);
  expect(F(56), "accel" + ctx).toBeCloseTo(t.accelerationMultiplier, 6);
  expect(F(64), "gravityScale" + ctx).toBeCloseTo(t.gravityScale, 6);
  expect(F(72), "slow" + ctx).toBeCloseTo(t.slowMultiplier, 6);
  expect(F(80), "impactRadius" + ctx).toBeCloseTo(t.impactRadiusPx, 6);
  expect(F(88), "size" + ctx).toBeCloseTo(t.sizeMultiplier, 6);
  expect(F(96), "speed" + ctx).toBeCloseTo(t.speedMultiplier, 6);
  expect(F(104), "lifetime" + ctx).toBeCloseTo(t.lifetimeMultiplier, 6);
  expect(U32(112), "count" + ctx).toBe(t.projectileCount);
  expect(U32(116), "bounces" + ctx).toBe(t.bounces);
  expect(U32(120), "pierce" + ctx).toBe(t.pierceCount);
  expect(U32(124), "split" + ctx).toBe(t.splitCount);
  expect(U8(128), "shape" + ctx).toBe(t.shapeIdx);
  expect(U8(129), "element" + ctx).toBe(t.elementIdx);
  expect(U8(130), "pathing" + ctx).toBe(t.pathingIdx);
  expect(U8(131), "impact" + ctx).toBe(t.impactIdx);
  expect(U8(132), "valid" + ctx).toBe(1);
  // Augments (offset 136+).
  expect(F(136), "moveSpeedMul" + ctx).toBeCloseTo(t.moveSpeedMultiplier, 6);
  expect(F(144), "gravityMul" + ctx).toBeCloseTo(t.gravityMultiplier, 6);
  expect(F(152), "jumpMul" + ctx).toBeCloseTo(t.jumpMultiplier, 6);
  expect(F(160), "wallJumpMul" + ctx).toBeCloseTo(t.wallJumpMultiplier, 6);
  expect(F(168), "wallSlideMul" + ctx).toBeCloseTo(t.wallSlideMultiplier, 6);
  expect(F(176), "shieldChargeMul" + ctx).toBeCloseTo(t.shieldChargeMultiplier, 6);
  expect(F(184), "shieldRechargeMul" + ctx).toBeCloseTo(t.shieldRechargeMultiplier, 6);
  expect(F(192), "parryCoverMul" + ctx).toBeCloseTo(t.parryCoverMultiplier, 6);
  expect(F(200), "parryCooldownMul" + ctx).toBeCloseTo(t.parryCooldownMultiplier, 6);
  expect(F(208), "maxHealthAdd" + ctx).toBeCloseTo(t.maxHealthAdd, 6);
  expect(U32(216), "airJumps" + ctx).toBe(t.airJumps);
  expect(U32(220), "dashCharges" + ctx).toBe(t.dashCharges);
  expect(U8(224), "mirror" + ctx).toBe(t.mirrorShield ? 1 : 0);
  expect(U8(225), "directional" + ctx).toBe(t.directionalShield ? 1 : 0);
}

describe("Zig build resolver ≡ TS createWeaponBuild → ResolvedFireConfig", () => {
  test("card table count matches", () => {
    expect(ex.resolve_build_card_count()).toBe(cards.length);
  });
  test("base (no cards) matches starter pistol", () => compare(-1, "base"));
  test("every card resolves identically", () => {
    for (let i = 0; i < cards.length; i++) compare(i, cards[i]!.id);
  });
});
