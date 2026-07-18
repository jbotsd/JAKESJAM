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

  // Balance audit: crystal-volley was a trap pick (zero stat change).
  // dual-splitter's old "strictly dominated by +1 Projectile" fix and
  // x-rounds' old "strictly boring, needs a damage bump" fix are SUPERSEDED
  // by the 2026-07-18 design-axioms.md A7 split-cluster/shape-card rework
  // below — dual-splitter is cut outright (redundant with one-more-shard
  // even after the fire-rate patch), and x-rounds is redesigned onto a
  // SIZE identity instead of a bigger damage number. Locks in the fix so a
  // future edit can't silently re-flatten crystal-volley back to a trap.
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
  });

  // 2026-07-18 split-cluster + shape-card rework (design-axioms.md A7 —
  // Jake's live playtest note: shape cards were "small dmg/speed/knockback
  // tradeoffs" with no real identity, and 11 of 65 universal cards competed
  // on the exact same "more pellets, less damage" lever). Locks in the new
  // orthogonal identities so a future edit can't silently flatten them back
  // into reskins of each other.
  describe("shape cards (circle/triangle/square/x/i-rounds) now own distinct physics axes", () => {
    const find = (id: string): CardDefinition => {
      const c = crystalRoundsCards.find((c) => c.id === id);
      if (!c) throw new Error(`missing card: ${id}`);
      return c;
    };
    const base = () => createWeaponBuild(starterWeapon, []);

    test("circle-rounds owns RANGE (short) — a real distance cut, not a speed nudge", () => {
      const b = createWeaponBuild(starterWeapon, [find("circle-rounds")]);
      expect(b.projectile.rangePx).toBeLessThan(starterWeapon.projectile.rangePx);
    });

    test("triangle-rounds owns RANGE (long) — reaches farther and persists longer, not more damage", () => {
      const b = createWeaponBuild(starterWeapon, [find("triangle-rounds")]);
      expect(b.projectile.rangePx).toBeGreaterThan(starterWeapon.projectile.rangePx);
      expect(b.projectile.lifetimeMultiplier).toBeGreaterThan(1);
      // No damage bonus — reach is the whole point, not a bundled dmg trade.
      expect(b.damage).toBe(base().damage);
    });

    test("square-rounds owns KNOCKBACK-FEEL, sharpened above its old value", () => {
      const b = createWeaponBuild(starterWeapon, [find("square-rounds")]);
      expect(b.knockbackImpulse).toBeGreaterThan(base().knockbackImpulse * 1.18);
    });

    test("x-rounds owns SIZE (hitbox), not damage+recoil — supersedes the old trap-fix assertion", () => {
      const b = createWeaponBuild(starterWeapon, [find("x-rounds")]);
      expect(b.projectile.sizeMultiplier).toBeGreaterThan(base().projectile.sizeMultiplier * 1.4);
      // The old fix's damage/recoil claim no longer applies — size is the axis now.
      expect(b.damage).toBe(base().damage);
    });

    test("i-rounds owns SPEED-PROFILE via the accelerate pathing — genuinely new to the pool", () => {
      const b = createWeaponBuild(starterWeapon, [find("i-rounds")]);
      expect(b.projectile.pathing).toBe("accelerate");
      expect(b.projectile.accelerationMultiplier).toBeGreaterThan(0);
      // Launches slower than baseline — the ramp is the payoff, not the start.
      expect(b.projectileSpeed).toBeLessThan(starterWeapon.projectileSpeed);
    });
  });

  describe("split-cluster audit: cut cards are gone, kept cards own distinct axes", () => {
    test("dual-splitter, needle-hose, magnet-spray are cut — redundant with a surviving sibling", () => {
      expect(crystalRoundsCards.find((c) => c.id === "dual-splitter")).toBeUndefined();
      expect(crystalRoundsCards.find((c) => c.id === "needle-hose")).toBeUndefined();
      expect(crystalRoundsCards.find((c) => c.id === "magnet-spray")).toBeUndefined();
    });

    test("triple-fan now owns bounce+fan (corners), distinct from wide-barrage's raw width", () => {
      const find = (id: string): CardDefinition => {
        const c = crystalRoundsCards.find((c) => c.id === id);
        if (!c) throw new Error(`missing card: ${id}`);
        return c;
      };
      const b = createWeaponBuild(starterWeapon, [find("triple-fan")]);
      expect(b.projectile.pathing).toBe("bounce");
      expect(b.projectile.bounces).toBeGreaterThan(0);
    });

    test("five-shard-spray now owns size+speed (micro-fragments), distinct from shard-bloom's range cut", () => {
      const find = (id: string): CardDefinition => {
        const c = crystalRoundsCards.find((c) => c.id === id);
        if (!c) throw new Error(`missing card: ${id}`);
        return c;
      };
      const b = createWeaponBuild(starterWeapon, [find("five-shard-spray")]);
      const base = createWeaponBuild(starterWeapon, []);
      expect(b.projectile.sizeMultiplier).toBeLessThan(base.projectile.sizeMultiplier);
      expect(b.projectileSpeed).toBeGreaterThan(base.projectileSpeed);
    });
  });

  describe("new physics-axis cards (2026-07-18): deadfall-mortar (gravity) and falling-star (decel)", () => {
    const find = (id: string): CardDefinition => {
      const c = crystalRoundsCards.find((c) => c.id === id);
      if (!c) throw new Error(`missing card: ${id}`);
      return c;
    };

    test("deadfall-mortar is a steeper arc + explosive payload than arc-shards", () => {
      const mortar = createWeaponBuild(starterWeapon, [find("deadfall-mortar")]);
      const arc = createWeaponBuild(starterWeapon, [find("arc-shards")]);
      expect(mortar.projectile.pathing).toBe("gravity");
      expect(mortar.projectile.gravityScale).toBeGreaterThan(arc.projectile.gravityScale);
      expect(mortar.projectile.impact).toBe("explosive");
    });

    test("falling-star decelerates (mirror image of i-rounds' accelerate)", () => {
      const b = createWeaponBuild(starterWeapon, [find("falling-star")]);
      expect(b.projectile.pathing).toBe("accelerate");
      expect(b.projectile.accelerationMultiplier).toBeLessThan(0);
      // Launches well above baseline — the burst is front-loaded.
      expect(b.projectileSpeed).toBeGreaterThan(starterWeapon.projectileSpeed);
    });
  });
});
