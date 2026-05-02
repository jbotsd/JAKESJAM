// Card resolver: composes a base WeaponDefinition with a card hand into a
// ResolvedWeaponBuild. The server (authoritative damage) and client (predicted
// fire rate / spread / projectile shape) MUST agree byte-for-byte, so the
// stack/clamp/bucket-tracking math is locked here.

import { describe, test, expect } from "bun:test";
import { createWeaponBuild, clampBuild, neutralTTK, neutralTTKBuild } from "../data/weaponBuild.js";
import { starterWeapon, weapons } from "../data/weapons.js";
import { crystalRoundsCards } from "../data/cards.js";
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

  // ---- TTK band tests (per combat-balance-ttk/SKILL.md) ----

  test("neutralTTK: all base weapons sit in the 1.8s–3.5s band", () => {
    for (const w of weapons) {
      const ttk = neutralTTK(w);
      expect(ttk, `${w.id} TTK=${ttk.toFixed(2)}s should be ≥1.8s`).toBeGreaterThanOrEqual(1.8);
      expect(ttk, `${w.id} TTK=${ttk.toFixed(2)}s should be ≤3.5s`).toBeLessThanOrEqual(3.5);
    }
  });

  test("no card combo lets the starter weapon breach the 1.5s TTK floor", () => {
    // Test every pair of cards from the full card pool.
    // Three-card combo is O(n³) ≈ 50³ = 125 000 iterations — fast for bun:test.
    const CARDS = crystalRoundsCards;
    const FLOOR_S = 1.5;
    const violations: string[] = [];

    for (let i = 0; i < CARDS.length; i++) {
      for (let j = i + 1; j < CARDS.length; j++) {
        for (let k = j + 1; k < CARDS.length; k++) {
          const combo = [CARDS[i]!, CARDS[j]!, CARDS[k]!];
          const build = createWeaponBuild(starterWeapon, combo);
          const ttk = neutralTTKBuild(build);
          if (ttk < FLOOR_S) {
            violations.push(
              `${combo.map((c) => c.id).join("+")} → TTK=${ttk.toFixed(3)}s`,
            );
          }
        }
      }
    }

    if (violations.length > 0) {
      console.warn(`[TTK] ${violations.length} combos breach 1.5s floor:\n  ${violations.slice(0, 5).join("\n  ")}`);
    }
    // Hard-fail if any combination one-shots inside 1.5s from full HP.
    expect(violations.length).toBe(0);
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
