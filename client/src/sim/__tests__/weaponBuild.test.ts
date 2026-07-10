// Card resolver: composes a base WeaponDefinition with a card hand into a
// ResolvedWeaponBuild. The server (authoritative damage) and client (predicted
// fire rate / spread / projectile shape) MUST agree byte-for-byte, so the
// stack/clamp/bucket-tracking math is locked here.

import { describe, test, expect } from "bun:test";
import {
  createWeaponBuild,
  clampBuild,
  neutralTTK,
  neutralTTKBuild,
  effectiveTTKBuild,
  orthogonalScale,
  mergeProjectileModifier,
  TTK_FLOOR_S,
} from "../data/weaponBuild.js";
import type { ProjectileModifier } from "../data/cardTypes.js";
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

  test("two damage 1.5× cards stack, then TTK floor clamp softens overstack", () => {
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
    // Raw stack is 2.25×, but clampBuild enforces effective TTK ≥ ~1.55s so
    // damage (and/or fireRate) may be scaled down. Must still be ABOVE base.
    expect(build.damage).toBeGreaterThan(starterWeapon.damage);
    expect(build.damage).toBeLessThanOrEqual(starterWeapon.damage * 2.25 + 0.01);
    expect(neutralTTKBuild(build)).toBeGreaterThanOrEqual(1.5);
    expect(build.cards).toHaveLength(2);
  });

  test("unique cards only apply once; maxStacks is honored", () => {
    const unique: CardDefinition = {
      id: "once-only",
      name: "Once",
      category: "projectile",
      rarity: "rare",
      description: "unique",
      unique: true,
      modifier: { damageMultiplier: 1.2 },
    };
    const stacked: CardDefinition = {
      id: "twice-ok",
      name: "Twice",
      category: "projectile",
      rarity: "common",
      description: "max 2",
      maxStacks: 2,
      modifier: { projectileCountAdd: 1 },
    };
    const build = createWeaponBuild(starterWeapon, [unique, unique, stacked, stacked, stacked]);
    expect(build.cards.filter((c) => c.id === "once-only")).toHaveLength(1);
    expect(build.cards.filter((c) => c.id === "twice-ok")).toHaveLength(2);
    expect(build.projectile.count).toBe(starterWeapon.projectile.count + 2);
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

  test("no 3-card combo breaches arena TTK floor (~1.55s effective)", () => {
    // docs/arena-balance-feel-goal.md: stacked cards ≥ ~1.55s effective TTK
    // (pellet-aware). createWeaponBuild → clampBuild is the shipped path.
    const CARDS = crystalRoundsCards;
    const violations: string[] = [];
    let worst = Infinity;

    for (let i = 0; i < CARDS.length; i++) {
      for (let j = i + 1; j < CARDS.length; j++) {
        for (let k = j + 1; k < CARDS.length; k++) {
          const combo = [CARDS[i]!, CARDS[j]!, CARDS[k]!];
          const build = createWeaponBuild(starterWeapon, combo);
          const ttk = effectiveTTKBuild(build);
          if (ttk < worst) worst = ttk;
          if (ttk < TTK_FLOOR_S - 0.02) {
            violations.push(
              `${combo.map((c) => c.id).join("+")} → effTTK=${ttk.toFixed(3)}s`,
            );
          }
        }
      }
    }

    expect(worst, `worst effective TTK ${worst}`).toBeGreaterThanOrEqual(TTK_FLOOR_S - 0.02);
    expect(violations.length, violations.slice(0, 3).join("; ")).toBe(0);
  });

  test("delivery card sets delivery and maps projectile identity", () => {
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
    // applyDeliveryFeel: hyper-speed shard identity
    expect(build.projectile.speedMultiplier).toBeGreaterThanOrEqual(3.0);
    expect(build.projectile.count).toBe(1);

    const beam = createWeaponBuild(starterWeapon, [
      {
        id: "test-beam",
        name: "Beam",
        category: "weapon",
        rarity: "rare",
        description: "beam",
        buckets: ["delivery"],
        modifier: { delivery: "continuous-beam", fireRateMultiplier: 1.5 },
      },
    ]);
    expect(beam.delivery).toBe("continuous-beam");
    expect(beam.fireRate).toBeGreaterThanOrEqual(8);
  });

  describe("deep orthogonality — stacks never erase each other", () => {
    const find = (id: string): CardDefinition => {
      const c = crystalRoundsCards.find((c) => c.id === id);
      if (!c) throw new Error(`missing card: ${id}`);
      return c;
    };

    test("orthogonalScale keeps grow+shrink both readable", () => {
      // Heavy 1.22 * Needle 0.86 = ~1.05 mush under pure multiply.
      const pure = 1.22 * 0.86;
      const ortho = orthogonalScale(1.22, 0.86);
      expect(ortho).toBeGreaterThan(pure); // less cancellation
      expect(ortho).toBeGreaterThan(1.05);
      expect(ortho).toBeLessThan(1.22); // still smaller than pure grow
    });

    test("element crystal never overwrites void", () => {
      const base: ProjectileModifier = {
        shape: "circle",
        count: 1,
        rangePx: 400,
        speedMultiplier: 1,
        sizeMultiplier: 1,
        recoilMultiplier: 1,
        pathing: "straight",
        element: "void",
        impact: "none",
        lifetimeMultiplier: 1,
        gravityScale: 0,
        homingStrength: 0,
        accelerationMultiplier: 1,
        bounces: 0,
        impactRadiusPx: 0,
        pierceCount: 0,
        splitCount: 0,
        slowMultiplier: 1,
      };
      const merged = mergeProjectileModifier(base, { element: "crystal", sizeMultiplier: 1.1 });
      expect(merged.element).toBe("void");
      expect(merged.sizeMultiplier).toBeCloseTo(1.1, 5);
    });

    test("shape: first distinctive shape survives a later weak shape", () => {
      const triangle = find("triangle-rounds");
      const circle = find("circle-rounds");
      const build = createWeaponBuild(starterWeapon, [triangle, circle]);
      expect(build.projectile.shape).toBe("triangle");
    });

    test("homing pathing survives bounce card after", () => {
      const seek = find("seeker-facets");
      const bounce = find("bouncy-prism");
      // Order: seeker first, then bounce — bounce must not wipe homing
      const build = createWeaponBuild(starterWeapon, [seek, bounce]);
      expect(build.projectile.pathing).toBe("homing");
      // Bounces still apply (geometry gift)
      expect(build.projectile.bounces).toBeGreaterThan(0);
    });

    test("Heavy Coolant + Needle keep size away from mush ~1", () => {
      const heavy = find("heavy-coolant");
      const needle = find("needle-compressor");
      const build = createWeaponBuild(starterWeapon, [heavy, needle]);
      // Pure product: 1.22 * 0.86 ≈ 1.05. Orthogonal must stay clearly big OR
      // clearly not mush — at least 8% away from 1.0 in the grow direction.
      expect(build.projectile.sizeMultiplier).toBeGreaterThan(1.08);
    });

    test("spread: absolute set never shrinks a wider prior fan", () => {
      const wide: CardDefinition = {
        id: "wide-set",
        name: "Wide",
        category: "projectile",
        rarity: "common",
        description: "test",
        modifier: { spreadRadians: 0.5 },
      };
      const narrow: CardDefinition = {
        id: "narrow-set",
        name: "Narrow",
        category: "projectile",
        rarity: "common",
        description: "test",
        modifier: { spreadRadians: 0.1 },
      };
      const build = createWeaponBuild(starterWeapon, [wide, narrow]);
      expect(build.spreadRadians).toBeGreaterThanOrEqual(0.5);
    });
  });

  // Balance audit: these three were trap picks (crystal-volley = zero stat
  // change; x-rounds = strictly boring next to its uncommon peers;
  // dual-splitter = strictly dominated by +1 Projectile). Locks in the fix
  // so a future edit can't silently re-flatten them back to traps.
  describe("trap-card fixes have real, non-zero effect", () => {
    const find = (id: string): CardDefinition => {
      const c = crystalRoundsCards.find((c) => c.id === id);
      if (!c) throw new Error(`missing card: ${id}`);
      return c;
    };

    test("crystal-volley is no longer a pure-identity pick", () => {
      const base = createWeaponBuild(starterWeapon, []);
      const withCard = createWeaponBuild(starterWeapon, [find("crystal-volley")]);
      expect(withCard.damage).toBeGreaterThan(base.damage);
      expect(withCard.projectile.speedMultiplier).toBeGreaterThan(
        base.projectile.speedMultiplier,
      );
    });

    test("x-rounds now beats its uncommon peer's damage-only baseline", () => {
      const base = createWeaponBuild(starterWeapon, []);
      const build = createWeaponBuild(starterWeapon, [find("x-rounds")]);
      // Was +6%; must now be a real step up (>=+10%) and also grants
      // recoil control, not damage alone.
      expect(build.damage).toBeGreaterThanOrEqual(base.damage * 1.1 - 1e-6);
      expect(build.recoilImpulse).toBeLessThan(base.recoilImpulse);
    });

    test("dual-splitter no longer strictly loses to +1 Projectile", () => {
      const oneMore = createWeaponBuild(starterWeapon, [find("one-more-shard")]);
      const dual = createWeaponBuild(starterWeapon, [find("dual-splitter")]);
      // Both add exactly 1 projectile — dual-splitter must now win on at
      // least one axis (fire rate) to justify its higher essence cost,
      // where before it strictly lost on every axis.
      expect(dual.projectile.count).toBe(oneMore.projectile.count);
      expect(dual.fireRate).toBeGreaterThan(oneMore.fireRate);
    });
  });
});
