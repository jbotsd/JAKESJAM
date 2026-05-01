// Card resolver: composes a base WeaponDefinition with a card hand into a
// ResolvedWeaponBuild. The server (authoritative damage) and client (predicted
// fire rate / spread / projectile shape) MUST agree byte-for-byte, so the
// stack/clamp/bucket-tracking math is locked here.

import { describe, test, expect } from "bun:test";
import { createWeaponBuild, clampBuild } from "../data/weaponBuild.js";
import { starterWeapon } from "../data/weapons.js";
import type { CardDefinition } from "../data/cardTypes.js";

describe("createWeaponBuild", () => {
  test("createWeaponBuild(starter, []) returns base stats unchanged", () => {
    const build = createWeaponBuild(starterWeapon, []);
    expect(build.id).toBe(starterWeapon.id);
    expect(build.name).toBe(starterWeapon.name);
    expect(build.delivery).toBe(starterWeapon.delivery);
    expect(build.damage).toBe(starterWeapon.damage);
    expect(build.fireRate).toBe(starterWeapon.fireRate);
    expect(build.magazineSize).toBe(starterWeapon.magazineSize);
    expect(build.projectileSpeed).toBe(starterWeapon.projectileSpeed);
    expect(build.projectile.count).toBe(starterWeapon.projectile.count);
    expect(build.projectile.shape).toBe(starterWeapon.projectile.shape);
    expect(build.cards).toEqual([]);
    expect(build.occupiedBuckets).toEqual([]);
  });

  test("two damage 1.5× cards stack multiplicatively → 2.25× base damage", () => {
    const damageCard = (id: string): CardDefinition => ({
      id,
      name: id,
      category: "projectile",
      rarity: "common",
      description: "test damage card",
      modifier: { damageMultiplier: 1.5 },
    });
    const build = createWeaponBuild(starterWeapon, [
      damageCard("dmg-a"),
      damageCard("dmg-b"),
    ]);
    // 10 base × 1.5 × 1.5 = 22.5, then roundTo(22.5, 2) = 22.5
    expect(build.damage).toBeCloseTo(starterWeapon.damage * 1.5 * 1.5, 5);
    expect(build.damage).toBe(22.5);
    expect(build.cards).toHaveLength(2);
  });

  test("two projectileCountAdd:1 cards stack additively → starter count + 2", () => {
    const countCard = (id: string): CardDefinition => ({
      id,
      name: id,
      category: "projectile",
      rarity: "common",
      description: "test count card",
      modifier: { projectileCountAdd: 1 },
    });
    const build = createWeaponBuild(starterWeapon, [
      countCard("c1"),
      countCard("c2"),
    ]);
    expect(build.projectile.count).toBe(starterWeapon.projectile.count + 2);
  });

  test("clampBuild enforces fire-rate floor of 0.35", () => {
    // Apply an absurd fire-rate multiplier and verify the floor kicks in.
    const slowCard: CardDefinition = {
      id: "ultra-slow",
      name: "Ultra Slow",
      category: "tradeoff",
      rarity: "rare",
      description: "trash fire rate for testing",
      modifier: { fireRateMultiplier: 0.001 },
    };
    const build = createWeaponBuild(starterWeapon, [slowCard]);
    expect(build.fireRate).toBe(0.35);

    // Direct clamp call: fireRate well above 0.35 is preserved.
    const direct = createWeaponBuild(starterWeapon, []);
    direct.fireRate = 0.1;
    clampBuild(direct);
    expect(direct.fireRate).toBe(0.35);
  });

  test("delivery card sets delivery and adds 'delivery' to occupiedBuckets", () => {
    const raycastCard: CardDefinition = {
      id: "test-raycast",
      name: "Test Raycast",
      category: "weapon",
      rarity: "rare",
      description: "switch to raycast",
      buckets: ["delivery"],
      modifier: { delivery: "raycast" },
    };
    const build = createWeaponBuild(starterWeapon, [raycastCard]);
    expect(build.delivery).toBe("raycast");
    expect(build.occupiedBuckets).toContain("delivery");
    expect(build.occupiedBuckets).toHaveLength(1);
  });
});
