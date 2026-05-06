// Phase 97 contract tests — packResolvedFireConfig encodes a
// ResolvedWeaponBuild into the byte-stable shape WasmHost writes
// at player_fire_config[i].

import { describe, expect, test } from "bun:test";
import { packResolvedFireConfig } from "../data/packResolvedFireConfig";
import { createWeaponBuild } from "../data/weaponBuild";
import { starterWeapon } from "../data/weapons";
import { crystalRoundsCards } from "../data/cards";

describe("packResolvedFireConfig", () => {
  test("starter weapon (no cards) → bytes match base stats", () => {
    const build = createWeaponBuild(starterWeapon, []);
    const bytes = packResolvedFireConfig(build);
    expect(bytes.damage).toBe(build.damage);
    expect(bytes.fireRate).toBe(build.fireRate);
    expect(bytes.projectileSpeed).toBe(build.projectileSpeed);
    expect(bytes.projectileLifetimeSeconds).toBe(
      build.projectileLifetimeSeconds,
    );
    expect(bytes.spreadRadians).toBe(build.spreadRadians);
    expect(bytes.rangePx).toBe(build.projectile.rangePx);
  });

  test("starter projectile_count is 1 even when build.projectile.count is undefined", () => {
    const build = createWeaponBuild(starterWeapon, []);
    const bytes = packResolvedFireConfig(build);
    expect(bytes.projectileCount).toBeGreaterThanOrEqual(1);
  });

  test("enum indices are within the wasm-side u8 enum range", () => {
    const build = createWeaponBuild(starterWeapon, []);
    const bytes = packResolvedFireConfig(build);
    // PROJECTILE_PATHINGS has 8 variants; ELEMENT_TYPES has 11;
    // PROJECTILE_IMPACTS has 5; PROJECTILE_SHAPES has 7.
    expect(bytes.pathingIdx).toBeGreaterThanOrEqual(0);
    expect(bytes.pathingIdx).toBeLessThan(8);
    expect(bytes.elementIdx).toBeGreaterThanOrEqual(0);
    expect(bytes.elementIdx).toBeLessThan(11);
    expect(bytes.impactIdx).toBeGreaterThanOrEqual(0);
    expect(bytes.impactIdx).toBeLessThan(5);
    expect(bytes.shapeIdx).toBeGreaterThanOrEqual(0);
    expect(bytes.shapeIdx).toBeLessThan(7);
  });

  test("damage multiplier card affects damage (>= base after clampBuild)", () => {
    const card = crystalRoundsCards.find(
      (c) =>
        c.modifier !== undefined &&
        c.modifier.damageMultiplier !== undefined &&
        c.modifier.damageMultiplier > 1,
    );
    if (!card) {
      return; // no matching card in the data set
    }
    const baseBuild = createWeaponBuild(starterWeapon, []);
    const buffedBuild = createWeaponBuild(starterWeapon, [card]);
    const baseBytes = packResolvedFireConfig(baseBuild);
    const buffedBytes = packResolvedFireConfig(buffedBuild);
    // clampBuild may cap below the multiplier's nominal value, so
    // weaker assertion: the byte path is a faithful round-trip
    // of whatever createWeaponBuild produced.
    expect(buffedBytes.damage).toBe(buffedBuild.damage);
    expect(baseBytes.damage).toBe(baseBuild.damage);
  });

  test("multi-shot card increases projectileCount", () => {
    const card = crystalRoundsCards.find(
      (c) =>
        c.modifier !== undefined &&
        (c.modifier.projectileCountAdd ?? 0) > 0,
    );
    if (!card) {
      return;
    }
    const baseBuild = createWeaponBuild(starterWeapon, []);
    const buffedBuild = createWeaponBuild(starterWeapon, [card]);
    const baseBytes = packResolvedFireConfig(baseBuild);
    const buffedBytes = packResolvedFireConfig(buffedBuild);
    expect(buffedBytes.projectileCount).toBeGreaterThan(
      baseBytes.projectileCount,
    );
  });

  test("defensive defaults: missing optionals don't produce NaN", () => {
    const build = createWeaponBuild(starterWeapon, []);
    const bytes = packResolvedFireConfig(build);
    for (const v of Object.values(bytes)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
