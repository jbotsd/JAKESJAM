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
import { baseWeaponForClass } from "../../data/weapons";
import type { ClassId } from "../../data/cardTypes";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  resolve_build_test: (i: number, out: number) => void;
  resolve_build_test_class: (i: number, classIdx: number, out: number) => void;
  resolve_build_card_count: () => number;
};

// gen_card_data.ts's CLASS_ID order (mirrors cardTypes.ts's ClassId union).
const WIZARD_CLASS_IDX = 0;
const PALADIN_CLASS_IDX = 2;
const PRIEST_CLASS_IDX = 3;

// gen_card_data.ts emits a CardEntry for EVERY card now (not just the ones
// with a `modifier` — see that file's "Every card gets an entry now" note,
// landed in 110f825), so `resolve_build_test`/`resolve_build_card_count`
// index into cards_gen.zig's FULL, unfiltered `cards` array — this list must
// stay in the exact same (unfiltered) declaration order to keep `cards[i]`
// pointing at the same card as Zig's `gen.cards[i]`. Cards without a
// `modifier` still round-trip correctly here: `createWeaponBuild`'s
// `applyCard` early-returns on a missing modifier (weaponBuild.ts) exactly
// like Zig's `cardModLiteral` short-circuits to the all-defaults `.{}`
// literal, so both sides resolve to the untouched base build for them.
const cards = crystalRoundsCards;
const SCRATCH = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 4096;

// gen.ClassId ordinal for each class-blind→class-aware walk below (mirrors
// gen_card_data.ts's CLASS_ID declaration order — see the constants above).
const CLASS_IDX: Record<ClassId, number> = {
  wizard: WIZARD_CLASS_IDX,
  ninja: 1,
  paladin: PALADIN_CLASS_IDX,
  priest: PRIEST_CLASS_IDX,
};

function zig(i: number, classId?: ClassId): DataView {
  if (classId !== undefined) {
    ex.resolve_build_test_class(i, CLASS_IDX[classId], SCRATCH);
  } else {
    ex.resolve_build_test(i, SCRATCH);
  }
  return new DataView(ex.memory.buffer, SCRATCH, 256);
}
function ts(i: number, classId?: ClassId) {
  return packResolvedFireConfig(
    createWeaponBuild(
      // baseWeaponForClass(classId) — class-gated base weapon (Track Z1c
      // item 1: priest/paladin resolve priestStarterWeapon/
      // paladinStarterWeapon, both `delivery: "projectile"`; wizard/ninja/
      // class-blind all fall back to the shared `starterWeapon` object,
      // matching weapon_build.zig's StarterBase + class-gated base_delivery
      // seed exactly).
      baseWeaponForClass(classId),
      i < 0 ? [] : [cards[i]!],
      classId,
    ),
  );
}

function compare(i: number, label: string, classId?: ClassId) {
  const z = zig(i, classId);
  const t = ts(i, classId);
  const F = (off: number) => z.getFloat64(off, true);
  const U32 = (off: number) => z.getUint32(off, true);
  const U8 = (off: number) => z.getUint8(off);
  const F32 = (off: number) => z.getFloat32(off, true);
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
  expect(F(232), "dashCooldownMul" + ctx).toBeCloseTo(t.dashCooldownMultiplier, 6);
  // Z0c Item A — the fire-recoil substrate: base 95 × card recoil_mul
  // (clamped) × projectile recoil channel, baked to one f64.
  expect(F(240), "recoilImpulse" + ctx).toBeCloseTo(t.recoilImpulse, 6);
  // Track Z1c item 1 — the resolved delivery identity (class-gated seed +
  // card upgrades + wizard-forces-raycast enforcement), now actually
  // returned from `resolveMods` instead of being silently dropped.
  expect(U8(248), "delivery" + ctx).toBe(t.delivery);
  // Track Z1c "six-axes axis payloads" — passive Tithe leech. Safe to
  // assert here for EVERY card/class this file walks (class-blind + wizard
  // only): the one card with a nonzero `leechFraction` (Stolen Fangs) only
  // sets it via `classModifiers.priest`, and no `compare()` call in this
  // file resolves as priest (see the two narrow priest-only tests below,
  // which assert the delivery byte only) — so both sides are 0≡0 for every
  // card table walk here. `resolveByIndices` has no classModifiers data
  // (documented gap, see world_state.zig's leech_fraction doc comment), so
  // this assertion would need loosening the day a priest-class walk is
  // added here.
  expect(F32(252), "leechFraction" + ctx).toBeCloseTo(t.leechFraction, 5);
}

describe("Zig build resolver ≡ TS createWeaponBuild → ResolvedFireConfig", () => {
  test("card table count matches", () => {
    expect(ex.resolve_build_card_count()).toBe(cards.length);
  });
  test("base (no cards) matches starter pistol", () => compare(-1, "base"));
  test("every card resolves identically", () => {
    for (let i = 0; i < cards.length; i++) compare(i, cards[i]!.id);
  });

  // THE GEOMETRICIAN RULING (2026-07-24): wizard is ALWAYS raycast — the
  // wizard-forces-raycast rule lives in BOTH resolvers (createWeaponBuild's
  // post-card-loop enforcement ≡ weapon_build.zig resolveMods' pre-
  // delivery-feel branch), so a class-AWARE walk must stay byte-identical
  // too: every card whose `delivery: "projectile"` used to flip the feel
  // numbers (speed/lifetime/range) now resolves through the raycast feel
  // floors on both sides.
  //
  // Cards with an authored `classModifiers.wizard` are skipped: Zig carries
  // no classModifiers data at all (gen_card_data.ts emits only the class-
  // blind `modifier`; a pre-existing, documented gap orthogonal to the
  // delivery rule), so TS-wizard resolution legitimately diverges from Zig
  // for those few cards on OTHER fields (e.g. seeker-facets' wizard damage
  // tax). The delivery rule itself is still fully exercised — every
  // Category-A travel-time card except seeker-facets is class-blind.
  test("every class-blind card resolves identically AS WIZARD (forced-raycast parity)", () => {
    for (let i = 0; i < cards.length; i++) {
      if (cards[i]!.classModifiers?.wizard) continue;
      compare(i, `${cards[i]!.id} (wizard)`, "wizard");
    }
  });
  test("base (no cards) matches as wizard too", () => compare(-1, "base (wizard)", "wizard"));

  // Track Z1c item 1 — class-gated BASE DELIVERY: priest/paladin resolve
  // from priestStarterWeapon/paladinStarterWeapon, both explicit
  // `delivery: "projectile"` overrides (weapons.ts), not the shared
  // starterWeapon's raycast — mirroring weapon_build.zig's `base_delivery`
  // switch (`.priest, .paladin => 0, else => B.delivery`) exactly.
  //
  // Deliberately NARROW (delivery byte only, not a full `compare()` walk):
  // priestStarterWeapon/paladinStarterWeapon also carry distinct STAT
  // overrides (priest's tendril damage/speed/homing, paladin's heavier
  // bolt) that weapon_build.zig's `StarterBase` does NOT mirror — Zig
  // still resolves every class from the ONE class-blind `StarterBase`
  // regardless of `class_id`, so a full-struct priest/paladin walk would
  // fail on `damage`/`projectileSpeed`/etc for every card, not prove
  // anything about delivery. That gap is real, pre-existing (predates
  // this cut — see weapon_build.zig's `base_delivery` doc comment: "the
  // per-class starter STAT overrides... remain an unported, recorded
  // gap"), and out of THIS item's delivery-routing scope; recorded here so
  // the next reader doesn't mistake the narrow scope for an oversight.
  test("priest resolves the PROJECTILE delivery ordinal (class-gated base, not the shared raycast starter)", () => {
    const PROJECTILE = 0;
    const zigDelivery = zig(-1, "priest").getUint8(248);
    const tsDelivery = ts(-1, "priest").delivery;
    expect(tsDelivery, "TS priestStarterWeapon.delivery").toBe(PROJECTILE);
    expect(zigDelivery, "Zig class-gated base_delivery (priest)").toBe(PROJECTILE);
  });
  test("paladin resolves the PROJECTILE delivery ordinal (class-gated base, not the shared raycast starter)", () => {
    const PROJECTILE = 0;
    const zigDelivery = zig(-1, "paladin").getUint8(248);
    const tsDelivery = ts(-1, "paladin").delivery;
    expect(tsDelivery, "TS paladinStarterWeapon.delivery").toBe(PROJECTILE);
    expect(zigDelivery, "Zig class-gated base_delivery (paladin)").toBe(PROJECTILE);
  });
  test("ninja/class-blind still resolve the RAYCAST delivery ordinal (unaffected by the priest/paladin gate)", () => {
    const RAYCAST = 1;
    expect(ts(-1, "ninja").delivery, "TS ninja (shares starterWeapon)").toBe(RAYCAST);
    expect(zig(-1, "ninja").getUint8(248), "Zig ninja base_delivery").toBe(RAYCAST);
    expect(ts(-1).delivery, "TS class-blind").toBe(RAYCAST);
    expect(zig(-1).getUint8(248), "Zig class-blind base_delivery").toBe(RAYCAST);
  });
});
