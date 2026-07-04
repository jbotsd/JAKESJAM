// Parry + shield helpers, ported from the offline MatchScene path.
// Verifies the rising-edge trigger, cooldown gating, arc check, charge drain
// and recharge, and the deflect/shield/passthrough mitigation chain.

import { describe, expect, test } from "bun:test";
import { EntityId, InputSeq, PlayerId, Tick } from "../types.js";
import {
  PARRY_ACTIVE_MS,
  PARRY_ARC_RADIANS,
  PARRY_COOLDOWN_MS_DEFAULT,
  SHIELD_DRAIN_PER_SECOND,
  SHIELD_HIT_DRAIN_MULTIPLIER,
  SHIELD_MAX_CHARGE_DEFAULT,
  SHIELD_RECHARGE_PER_SECOND,
  isHitInParryArc,
  isParryActive,
  tickShield,
  tryDeflectDamage,
  tryStartParry,
} from "../combat.js";
import type { PlayerEntity, ProjectileEntity } from "../types.js";

const DT_MS = 1000 / 60;
const ABILITY = 1 << 7;
const SHIELD = 1 << 8;

function mkPlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100, // facing +x by default
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

function mkProjectile(overrides: Partial<ProjectileEntity> = {}): ProjectileEntity {
  return {
    id: EntityId(1),
    ownerId: PlayerId("enemy"),
    x: 50,
    y: 0,
    vx: -300,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 25,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ...overrides,
  };
}

describe("tryStartParry", () => {
  test("rising-edge triggers parry, sets active+cooldown windows and facing", () => {
    const p = mkPlayer({ aimX: 100, aimY: 0 });
    const r = tryStartParry(p, ABILITY, 0, Tick(10), { dtMs: DT_MS });
    expect(r.started).toBe(true);
    expect(r.player.parryActiveUntilTick).toBeGreaterThan(10);
    expect(r.player.parryCooldownUntilTick).toBeGreaterThan(10);
    expect(r.player.parryFacing).toBeCloseTo(0, 5);
    // active < cooldown (cooldown is much longer than the active window)
    expect(r.player.parryActiveUntilTick!).toBeLessThan(
      r.player.parryCooldownUntilTick!,
    );
  });

  test("does not trigger on held input (no rising edge)", () => {
    const p = mkPlayer();
    const r = tryStartParry(p, ABILITY, ABILITY, Tick(10), { dtMs: DT_MS });
    expect(r.started).toBe(false);
    expect(r.player).toBe(p);
  });

  test("blocked while cooldown is active", () => {
    const p = mkPlayer({ parryCooldownUntilTick: Tick(100) });
    const r = tryStartParry(p, ABILITY, 0, Tick(50), { dtMs: DT_MS });
    expect(r.started).toBe(false);
  });

  test("dead players cannot parry", () => {
    const p = mkPlayer({ alive: false, health: 0 });
    const r = tryStartParry(p, ABILITY, 0, Tick(10), { dtMs: DT_MS });
    expect(r.started).toBe(false);
  });

  test("active window length matches PARRY_ACTIVE_MS at default dt", () => {
    const p = mkPlayer();
    const r = tryStartParry(p, ABILITY, 0, Tick(0), { dtMs: DT_MS });
    const expectedTicks = Tick(Math.ceil(PARRY_ACTIVE_MS / DT_MS));
    expect(r.player.parryActiveUntilTick).toBe(expectedTicks);
  });

  test("cooldown window length matches PARRY_COOLDOWN_MS_DEFAULT", () => {
    const p = mkPlayer();
    const r = tryStartParry(p, ABILITY, 0, Tick(0), { dtMs: DT_MS });
    const expectedTicks = Math.ceil(PARRY_COOLDOWN_MS_DEFAULT / DT_MS);
    expect(r.player.parryCooldownUntilTick).toBe(Tick(expectedTicks));
  });
});

describe("isParryActive", () => {
  test("returns true while tick < parryActiveUntilTick", () => {
    const p = mkPlayer({ parryActiveUntilTick: Tick(50) });
    expect(isParryActive(p, Tick(49))).toBe(true);
    expect(isParryActive(p, Tick(50))).toBe(false);
  });

  test("returns false when field is missing", () => {
    expect(isParryActive(mkPlayer(), Tick(0))).toBe(false);
  });
});

describe("isHitInParryArc", () => {
  test("projectile in front (aim direction) is inside the arc", () => {
    const p = mkPlayer({ x: 0, y: 0 });
    const proj = mkProjectile({ x: 50, y: 0 }); // straight ahead
    expect(isHitInParryArc(p, 0, proj)).toBe(true);
  });

  test("projectile behind the player is outside the arc", () => {
    const p = mkPlayer({ x: 0, y: 0 });
    const proj = mkProjectile({ x: -50, y: 0 });
    expect(isHitInParryArc(p, 0, proj)).toBe(false);
  });

  test("projectile at the arc edge is inside (≤ half-cone)", () => {
    const p = mkPlayer({ x: 0, y: 0 });
    const half = PARRY_ARC_RADIANS / 2;
    const proj = mkProjectile({
      x: Math.cos(half) * 50,
      y: Math.sin(half) * 50,
    });
    expect(isHitInParryArc(p, 0, proj)).toBe(true);
  });

  test("projectile just past the arc edge is outside", () => {
    const p = mkPlayer({ x: 0, y: 0 });
    const beyond = PARRY_ARC_RADIANS / 2 + 0.05;
    const proj = mkProjectile({
      x: Math.cos(beyond) * 50,
      y: Math.sin(beyond) * 50,
    });
    expect(isHitInParryArc(p, 0, proj)).toBe(false);
  });
});

describe("tickShield", () => {
  test("active shield drains charge", () => {
    const p = mkPlayer({ shieldCharge: SHIELD_MAX_CHARGE_DEFAULT });
    const r = tickShield(p, SHIELD, { dtMs: 1000 });
    expect(r.shieldActive).toBe(true);
    expect(r.shieldCharge).toBeCloseTo(SHIELD_MAX_CHARGE_DEFAULT - SHIELD_DRAIN_PER_SECOND, 5);
  });

  test("idle shield recharges toward max", () => {
    const p = mkPlayer({ shieldCharge: 50 });
    const r = tickShield(p, 0, { dtMs: 1000 });
    expect(r.shieldActive).toBe(false);
    expect(r.shieldCharge).toBeCloseTo(50 + SHIELD_RECHARGE_PER_SECOND, 5);
  });

  test("recharge clamps at max", () => {
    const p = mkPlayer({ shieldCharge: 99 });
    const r = tickShield(p, 0, { dtMs: 1000 });
    expect(r.shieldCharge).toBe(SHIELD_MAX_CHARGE_DEFAULT);
  });

  test("shield deactivates when charge runs out mid-drain", () => {
    const p = mkPlayer({ shieldCharge: 1, shieldActive: true });
    const r = tickShield(p, SHIELD, { dtMs: 1000 });
    expect(r.shieldActive).toBe(false);
    expect(r.shieldCharge).toBe(0);
  });

  test("shield can't activate with zero charge", () => {
    const p = mkPlayer({ shieldCharge: 0 });
    const r = tickShield(p, SHIELD, { dtMs: 1000 });
    expect(r.shieldActive).toBe(false);
    // Still recharges while held but not active.
    expect(r.shieldCharge).toBeCloseTo(SHIELD_RECHARGE_PER_SECOND, 5);
  });

  test("dead player has shield force-cleared", () => {
    const p = mkPlayer({ alive: false, shieldActive: true, shieldCharge: 50 });
    const r = tickShield(p, SHIELD, { dtMs: 1000 });
    expect(r.shieldActive).toBe(false);
  });
});

describe("tryDeflectDamage", () => {
  test("active parry covering the source angle deflects (zero damage)", () => {
    const p = mkPlayer({
      x: 0,
      y: 0,
      parryActiveUntilTick: Tick(100),
      parryFacing: 0,
    });
    const proj = mkProjectile({ x: 50, y: 0 }); // in front
    const r = tryDeflectDamage(p, proj, proj.damage, Tick(50));
    expect(r.deflected).toBe(true);
    expect(r.damage).toBe(0);
  });

  test("parry from the wrong side does not deflect", () => {
    const p = mkPlayer({
      x: 0,
      y: 0,
      parryActiveUntilTick: Tick(100),
      parryFacing: 0,
    });
    const proj = mkProjectile({ x: -50, y: 0 }); // behind
    const r = tryDeflectDamage(p, proj, proj.damage, Tick(50));
    expect(r.deflected).toBe(false);
    // No shield active either → passthrough.
    expect(r.damage).toBe(proj.damage);
  });

  test("active shield with charge absorbs the hit and drains charge", () => {
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100 });
    const proj = mkProjectile({ damage: 25 });
    const r = tryDeflectDamage(p, proj, proj.damage, Tick(0));
    expect(r.shielded).toBe(true);
    expect(r.damage).toBe(0);
    expect(r.player.shieldCharge).toBeCloseTo(
      100 - 25 * SHIELD_HIT_DRAIN_MULTIPLIER,
      5,
    );
    expect(r.player.shieldActive).toBe(true);
  });

  test("shield popping deactivates and signals shieldPopped", () => {
    const p = mkPlayer({ shieldActive: true, shieldCharge: 5 });
    const proj = mkProjectile({ damage: 50 }); // way more than charge
    const r = tryDeflectDamage(p, proj, proj.damage, Tick(0));
    expect(r.shielded).toBe(true);
    expect(r.shieldPopped).toBe(true);
    expect(r.player.shieldActive).toBe(false);
    expect(r.player.shieldCharge).toBe(0);
  });

  test("no parry, no shield → damage passes through unchanged", () => {
    const p = mkPlayer();
    const proj = mkProjectile({ damage: 17 });
    const r = tryDeflectDamage(p, proj, 17, Tick(0));
    expect(r.deflected).toBe(false);
    expect(r.shielded).toBe(false);
    expect(r.damage).toBe(17);
  });

  test("parry takes priority over shield", () => {
    const p = mkPlayer({
      shieldActive: true,
      shieldCharge: 100,
      parryActiveUntilTick: Tick(100),
      parryFacing: 0,
    });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, proj.damage, Tick(50));
    expect(r.deflected).toBe(true);
    expect(r.shielded).toBe(false);
    // Shield charge untouched.
    expect(r.player.shieldCharge).toBe(100);
  });

  test("zero damage hits return early (no charge cost)", () => {
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100 });
    const r = tryDeflectDamage(p, mkProjectile(), 0, Tick(0));
    expect(r.damage).toBe(0);
    expect(r.shielded).toBe(false);
    expect(r.player.shieldCharge).toBe(100);
  });
});

describe("shield augments — mirror + directional (aim) shield", () => {
  test("mirror shield: a blocked hit reflects (shieldReflected) and zeroes damage", () => {
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100 });
    const proj = mkProjectile();
    const r = tryDeflectDamage(p, proj, 25, Tick(0), { mirrorShield: true });
    expect(r.shielded).toBe(true);
    expect(r.shieldReflected).toBe(true);
    expect(r.damage).toBe(0);
  });

  test("plain shield blocks but does NOT reflect", () => {
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100 });
    const r = tryDeflectDamage(p, mkProjectile(), 25, Tick(0));
    expect(r.shielded).toBe(true);
    expect(r.shieldReflected).toBe(false);
  });

  test("aim shield blocks a hit from the AIM direction", () => {
    // Aim +x (default); projectile at x=+50 → within the frontal arc.
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100, aimX: 100, aimY: 0 });
    const r = tryDeflectDamage(p, mkProjectile({ x: 50, y: 0 }), 25, Tick(0), {
      directionalShield: true,
    });
    expect(r.shielded).toBe(true);
    expect(r.damage).toBe(0);
  });

  test("aim shield does NOT block a hit from behind (outside the arc)", () => {
    // Aim +x, but the shot comes from -x (behind) → passes through.
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100, aimX: 100, aimY: 0 });
    const r = tryDeflectDamage(p, mkProjectile({ x: -50, y: 0, vx: 300 }), 25, Tick(0), {
      directionalShield: true,
    });
    expect(r.shielded).toBe(false);
    expect(r.damage).toBe(25);
  });

  test("omnidirectional shield DOES block a hit from behind", () => {
    const p = mkPlayer({ shieldActive: true, shieldCharge: 100, aimX: 100, aimY: 0 });
    const r = tryDeflectDamage(p, mkProjectile({ x: -50, y: 0, vx: 300 }), 25, Tick(0));
    expect(r.shielded).toBe(true);
    expect(r.damage).toBe(0);
  });
});
