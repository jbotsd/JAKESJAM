// Codegen: TS card/weapon data → sim/src/data/cards_gen.zig.
//
// cards.ts stays the SINGLE source of truth (the UI reads it for names/icons);
// this emits the sim-relevant modifier table into Zig so the Zig orchestrator
// resolves builds in-sim (no host-side createWeaponBuild). Re-run on card
// changes: `bun run sim/tools/gen_card_data.ts`. Field order + semantics mirror
// weaponBuild.ts createWeaponBuild/applyCard/mergeProjectileModifier.

import { crystalRoundsCards } from "../../client/src/sim/data/cards.ts";
import { starterWeapon } from "../../client/src/sim/data/weapons.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHAPE = ["circle", "triangle", "square", "hexagon", "orb", "x", "bar"];
const ELEMENT = ["crystal", "neutral", "fire", "ice", "lightning", "void", "radiant", "electric", "toxic", "sticky", "explosive"];
const PATHING = ["straight", "gravity", "bounce", "boomerang", "homing", "anti-homing", "float", "accelerate"];
const IMPACT = ["none", "explosive", "sticky", "pierce-chain", "slow-field"];
// Mirrors cardTypes.ts's WeaponDelivery union — index 0 ("projectile") is
// the default/no-op delivery, matching weapons.ts's starterWeapon.delivery.
const DELIVERY = ["projectile", "raycast", "continuous-beam", "area-pulse"];
// Mirrors cardTypes.ts's CardDefinition["rarity"] union — index used as the
// Zig-side rarity byte.
const RARITY = ["common", "uncommon", "rare", "legendary", "cursed"];
// Mirrors draftWeights.ts's CATCH_UP_BUCKETS exactly. weightForCard only
// ever asks "does this card have ANY bucket in this set" — never which one —
// so it's precomputed here as a single bool rather than emitting the full
// bucket array (a 7-entry union) into Zig.
const CATCH_UP_BUCKETS = new Set(["impact", "utility", "element"]);
const idx = (arr: string[], v: string | undefined): number | null =>
  v === undefined ? null : Math.max(0, arr.indexOf(v));

const f = (n: number | undefined, dflt: number): string =>
  (n ?? dflt).toString().includes(".") || !Number.isFinite(n ?? dflt)
    ? `${n ?? dflt}`
    : `${n ?? dflt}.0`;
const optF = (n: number | undefined): string => (n === undefined ? "null" : f(n, 0));
const optI = (n: number | null): string => (n === null ? "null" : `${n}`);

// Mirrors weaponBuild.ts's cardHasVisibleSignature/ensureVisibleCardSignature
// EXACTLY (kept as a separate static pass here rather than importing those —
// they're private to weaponBuild.ts and operate on a live ResolvedWeaponBuild
// accumulator, not a single static card). Safe to precompute per-card at
// codegen time because the runtime function's inputs are ONLY this card's own
// modifier + category + icon (no cross-card or RNG state) for every field
// EXCEPT the "element === neutral" check, which never fires in practice —
// starterWeapon's default projectile element is "crystal", and no card in
// cards.ts ever sets element to "neutral" — so that branch is dead code
// against current data and is deliberately NOT baked here.
function cardHasVisibleSignature(mod: NonNullable<(typeof crystalRoundsCards)[number]["modifier"]>): boolean {
  const p = mod.projectile;
  if (mod.delivery) return true;
  if (mod.orbitingSatellites) return true;
  if (mod.mirrorShield || mod.directionalShield || mod.stolenFangs) return true;
  if (mod.projectileCountAdd || mod.projectileBounceAdd) return true;
  if (mod.projectileSplitAdd || mod.projectileHomingStrengthAdd) return true;
  if (mod.airJumpsAdd || mod.dashChargesAdd) return true;
  if (mod.gravityMultiplier !== undefined && mod.gravityMultiplier !== 1) return true;
  if (mod.jumpMultiplier !== undefined && mod.jumpMultiplier !== 1) return true;
  if (mod.wallJumpMultiplier !== undefined && mod.wallJumpMultiplier !== 1) return true;
  if (mod.wallSlideMultiplier !== undefined && mod.wallSlideMultiplier !== 1) return true;
  if (mod.moveSpeedMultiplier !== undefined && mod.moveSpeedMultiplier !== 1) return true;
  if (mod.parryCoverMultiplier !== undefined && mod.parryCoverMultiplier !== 1) return true;
  if (mod.maxHealthAdd) return true;
  if (p?.shape || p?.pathing || p?.element || p?.impact) return true;
  if (p?.bounces || p?.count || p?.splitCount || p?.pierceCount) return true;
  if (p?.sizeMultiplier !== undefined && p.sizeMultiplier !== 1) return true;
  if (p?.gravityScale !== undefined && p.gravityScale !== 1) return true;
  if (p?.lifetimeMultiplier !== undefined && p.lifetimeMultiplier !== 1) return true;
  if (p?.speedMultiplier !== undefined && p.speedMultiplier !== 1) return true;
  if (mod.projectileSpeedMultiplier !== undefined && mod.projectileSpeedMultiplier !== 1) return true;
  return false;
}

/** Returns the cosmetic size/speed/shape bump for a card with no visible
 *  signature of its own, or null if the card already has one. */
function visibleSignatureBump(
  card: (typeof crystalRoundsCards)[number],
  mod: NonNullable<(typeof crystalRoundsCards)[number]["modifier"]>,
): { sizeMultiplier: number; speedMultiplier: number; shape?: string } | null {
  if (cardHasVisibleSignature(mod)) return null;
  const shape = card.visual?.iconShape;
  if (card.category === "defense" || card.category === "utility") {
    return { sizeMultiplier: 1.08, speedMultiplier: 1, shape };
  } else if (mod.fireRateMultiplier && mod.fireRateMultiplier > 1) {
    return { sizeMultiplier: 0.9, speedMultiplier: 1.05, shape };
  } else if (mod.fireRateMultiplier && mod.fireRateMultiplier < 1) {
    return { sizeMultiplier: 1.12, speedMultiplier: 1, shape };
  }
  return { sizeMultiplier: 1.06, speedMultiplier: 1, shape };
}

// The fields that reach ResolvedFireConfig (packResolvedFireConfig) — others
// (reload/recoil/magazine/ammo) never cross the sim boundary and are skipped.
function cardLiteral(card: (typeof crystalRoundsCards)[number]): string {
  const id = card.id;
  const mod = card.modifier!;
  const p = mod.projectile;
  const bump = visibleSignatureBump(card, mod);
  const parts: string[] = [];
  const add = (name: string, val: string, isDefault: string) => {
    if (val !== isDefault) parts.push(`.${name} = ${val}`);
  };
  add("damage_mul", f(mod.damageMultiplier, 1), "1.0");
  add("fire_rate_mul", f(mod.fireRateMultiplier, 1), "1.0");
  add("projectile_speed_mul", f(mod.projectileSpeedMultiplier, 1), "1.0");
  add("spread_radians_add", f(mod.spreadRadiansAdd, 0), "0.0");
  add("spread_radians_set", optF(mod.spreadRadians), "null");
  add("max_health_add", f(mod.maxHealthAdd, 0), "0.0");
  add("move_speed_mul", f(mod.moveSpeedMultiplier, 1), "1.0");
  add("parry_cover_mul", f(mod.parryCoverMultiplier, 1), "1.0");
  add("parry_cooldown_mul", f(mod.parryCooldownMultiplier, 1), "1.0");
  add("gravity_mul", f(mod.gravityMultiplier, 1), "1.0");
  add("shield_charge_mul", f(mod.shieldChargeMultiplier, 1), "1.0");
  add("shield_recharge_mul", f(mod.shieldRechargeMultiplier, 1), "1.0");
  add("jump_mul", f(mod.jumpMultiplier, 1), "1.0");
  add("wall_jump_mul", f(mod.wallJumpMultiplier, 1), "1.0");
  add("wall_slide_mul", f(mod.wallSlideMultiplier, 1), "1.0");
  add("air_jumps_add", f(mod.airJumpsAdd, 0), "0.0");
  add("dash_charges_add", f(mod.dashChargesAdd, 0), "0.0");
  add("dash_cooldown_mul", f(mod.dashCooldownMultiplier, 1), "1.0");
  add("mirror_shield", mod.mirrorShield ? "true" : "false", "false");
  add("directional_shield", mod.directionalShield ? "true" : "false", "false");
  add("delivery", optI(idx(DELIVERY, mod.delivery)), "null");
  add("proj_count_add", f(mod.projectileCountAdd, 0), "0.0");
  add("proj_bounce_add", f(mod.projectileBounceAdd, 0), "0.0");
  add("proj_split_add", f(mod.projectileSplitAdd, 0), "0.0");
  add("proj_homing_add", f(mod.projectileHomingStrengthAdd, 0), "0.0");
  if (p || bump) {
    // sizeMultiplier/speedMultiplier/shape fold in ensureVisibleCardSignature's
    // cosmetic bump (see visibleSignatureBump above) — a card with no visible
    // signature of its own still needs to read as "something changed" in the
    // arena, matching the TS runtime path exactly.
    const sizeMul = (p?.sizeMultiplier ?? 1) * (bump?.sizeMultiplier ?? 1);
    const speedMul = (p?.speedMultiplier ?? 1) * (bump?.speedMultiplier ?? 1);
    const shape = p?.shape ?? bump?.shape;
    add("proj_speed_mul", f(speedMul, 1), "1.0");
    add("proj_size_mul", f(sizeMul, 1), "1.0");
    add("proj_lifetime_mul", f(p?.lifetimeMultiplier, 1), "1.0");
    add("proj_shape", optI(idx(SHAPE, shape)), "null");
    add("proj_element", optI(idx(ELEMENT, p?.element)), "null");
    add("proj_pathing", optI(idx(PATHING, p?.pathing)), "null");
    add("proj_impact", optI(idx(IMPACT, p?.impact)), "null");
    add("proj_count_set", optF(p?.count), "null");
    add("proj_range_px_set", optF(p?.rangePx), "null");
    add("proj_gravity_scale_set", optF(p?.gravityScale), "null");
    add("proj_homing_strength_set", optF(p?.homingStrength), "null");
    add("proj_acceleration_mul_set", optF(p?.accelerationMultiplier), "null");
    add("proj_bounces_set", optF(p?.bounces), "null");
    add("proj_impact_radius_set", optF(p?.impactRadiusPx), "null");
    add("proj_pierce_count_set", optF(p?.pierceCount), "null");
    add("proj_split_count_set", optF(p?.splitCount), "null");
    add("proj_slow_mul_set", optF(p?.slowMultiplier), "null");
  }
  const body = parts.length ? ` ${parts.join(", ")} ` : "";
  const rarityIdx = RARITY.indexOf(card.rarity ?? "common");
  const rarity = rarityIdx < 0 ? 0 : rarityIdx;
  const catchUpEligible = (card.buckets ?? []).some((b) => CATCH_UP_BUCKETS.has(b));
  const unique = card.unique ? "true" : "false";
  const maxStacks = card.maxStacks === undefined ? "null" : `${card.maxStacks}`;
  return `    .{ .id = "${id}", .mod = .{${body}}, .rarity = ${rarity}, .catch_up_eligible = ${catchUpEligible ? "true" : "false"}, .unique = ${unique}, .max_stacks = ${maxStacks} },`;
}

const sw = starterWeapon;
const swp = sw.projectile;
const rows = crystalRoundsCards
  .filter((c) => c.modifier)
  .map((c) => cardLiteral(c))
  .join("\n");

const out = `// GENERATED by sim/tools/gen_card_data.ts — DO NOT EDIT.
// Source of truth: client/src/sim/data/cards.ts + weapons.ts.
// Mirrors weaponBuild.ts createWeaponBuild/applyCard/mergeProjectileModifier.

pub const CardMod = struct {
    damage_mul: f64 = 1,
    fire_rate_mul: f64 = 1,
    projectile_speed_mul: f64 = 1,
    spread_radians_add: f64 = 0,
    spread_radians_set: ?f64 = null,
    max_health_add: f64 = 0,
    move_speed_mul: f64 = 1,
    parry_cover_mul: f64 = 1,
    parry_cooldown_mul: f64 = 1,
    gravity_mul: f64 = 1,
    shield_charge_mul: f64 = 1,
    shield_recharge_mul: f64 = 1,
    jump_mul: f64 = 1,
    wall_jump_mul: f64 = 1,
    wall_slide_mul: f64 = 1,
    air_jumps_add: f64 = 0,
    dash_charges_add: f64 = 0,
    dash_cooldown_mul: f64 = 1,
    mirror_shield: bool = false,
    directional_shield: bool = false,
    delivery: ?u8 = null,
    proj_count_add: f64 = 0,
    proj_bounce_add: f64 = 0,
    proj_split_add: f64 = 0,
    proj_homing_add: f64 = 0,
    proj_speed_mul: f64 = 1,
    proj_size_mul: f64 = 1,
    proj_lifetime_mul: f64 = 1,
    proj_shape: ?u8 = null,
    proj_element: ?u8 = null,
    proj_pathing: ?u8 = null,
    proj_impact: ?u8 = null,
    proj_count_set: ?f64 = null,
    proj_range_px_set: ?f64 = null,
    proj_gravity_scale_set: ?f64 = null,
    proj_homing_strength_set: ?f64 = null,
    proj_acceleration_mul_set: ?f64 = null,
    proj_bounces_set: ?f64 = null,
    proj_impact_radius_set: ?f64 = null,
    proj_pierce_count_set: ?f64 = null,
    proj_split_count_set: ?f64 = null,
    proj_slow_mul_set: ?f64 = null,
};

/// unique/max_stacks/rarity/catch_up_eligible mirror cardTypes.ts's
/// CardDefinition draft-relevant metadata (see draftWeights.ts). buckets
/// itself isn't emitted — weightForCard only ever tests set-membership
/// against CATCH_UP_BUCKETS, so that test is precomputed here as a bool.
pub const CardEntry = struct {
    id: []const u8,
    mod: CardMod,
    rarity: u8 = 0,
    catch_up_eligible: bool = false,
    unique: bool = false,
    max_stacks: ?u32 = null,
};

/// Starter-pistol base (the only weapon) — mirrors weapons.ts.
pub const StarterBase = struct {
    pub const damage: f64 = ${f(sw.damage, 0)};
    pub const fire_rate: f64 = ${f(sw.fireRate, 0)};
    pub const projectile_speed: f64 = ${f(sw.projectileSpeed, 0)};
    pub const projectile_lifetime_seconds: f64 = ${f(sw.projectileLifetimeSeconds, 0)};
    pub const spread_radians: f64 = ${f(sw.spreadRadians, 0)};
    pub const p_shape: u8 = ${idx(SHAPE, swp.shape)};
    pub const p_count: f64 = ${f(swp.count, 0)};
    pub const p_range_px: f64 = ${f(swp.rangePx, 0)};
    pub const p_speed_mul: f64 = ${f(swp.speedMultiplier, 1)};
    pub const p_size_mul: f64 = ${f(swp.sizeMultiplier, 1)};
    pub const p_pathing: u8 = ${idx(PATHING, swp.pathing)};
    pub const p_element: u8 = ${idx(ELEMENT, swp.element)};
    pub const p_impact: u8 = ${idx(IMPACT, swp.impact)};
    pub const p_lifetime_mul: f64 = ${f(swp.lifetimeMultiplier, 1)};
    pub const p_gravity_scale: f64 = ${f(swp.gravityScale, 0)};
    pub const p_homing_strength: f64 = ${f(swp.homingStrength, 0)};
    pub const p_acceleration_mul: f64 = ${f(swp.accelerationMultiplier, 0)};
    pub const p_bounces: f64 = ${f(swp.bounces, 0)};
    pub const p_impact_radius: f64 = ${f(swp.impactRadiusPx, 0)};
    pub const p_pierce_count: f64 = ${f(swp.pierceCount, 0)};
    pub const p_split_count: f64 = ${f(swp.splitCount, 0)};
    pub const p_slow_mul: f64 = ${f(swp.slowMultiplier, 1)};
};

pub const cards = [_]CardEntry{
${rows}
};

pub fn cardMod(id: []const u8) ?CardMod {
    for (cards) |c| {
        if (std.mem.eql(u8, c.id, id)) return c.mod;
    }
    return null;
}

const std = @import("std");
`;

writeFileSync(resolve(import.meta.dir, "../src/data/cards_gen.zig"), out);
console.log(`cards_gen.zig: ${crystalRoundsCards.filter((c) => c.modifier).length} cards`);
