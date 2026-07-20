// Codegen: TS card/weapon data → sim/src/data/cards_gen.zig.
//
// cards.ts stays the SINGLE source of truth (the UI reads it for names/icons);
// this emits the sim-relevant modifier table into Zig so the Zig orchestrator
// resolves builds in-sim (no host-side createWeaponBuild). Re-run on card
// changes: `bun run sim/tools/gen_card_data.ts`. Field order + semantics mirror
// weaponBuild.ts createWeaponBuild/applyCard/mergeProjectileModifier.
//
// Every CardEntry also carries a CardMeta (classId/unique/maxStacks/rarity/
// active) — the card's own identity/metadata, orthogonal to CardMod's
// resolved weapon-stat effect. This is what lets the future draft/offer-roll
// and ability-cast resolution logic exist in Zig at all; this file only
// plumbs the data through, it does not consume it (no drafting/casting
// logic lives here or in weapon_build.zig as of this pass).

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
// Mirrors cardTypes.ts's ClassId union exactly (dev-id vocabulary, never the
// display persona name).
const CLASS_ID = ["wizard", "ninja", "paladin", "priest"];
// Mirrors cardTypes.ts's CardDefinition.rarity union exactly.
const RARITY = ["common", "uncommon", "rare", "legendary", "cursed"];
// Mirrors cardTypes.ts's AbilityKind union EXACTLY, in declaration order —
// re-derive this list from the live file on every future edit to that union
// (it has changed several times this session already); a card whose
// active.kind isn't in this list throws at codegen time (see assertKnown)
// rather than silently emitting wrong data.
const ABILITY_KIND = [
  // five class-blind six-axes ability cards
  "crimson-tithe", "shelter-seal", "shadow-step", "veil-of-nought", "severing-answer",
  // Geometrician catalog v1 (wizard)
  "sunlance", "facet-break", "prism-fan", "lattice", "return-glass",
  "hard-aperture", "overclock", "measure", "slip-node", "recoil-step",
  // Kindled catalog v1 (paladin)
  "unbroken-seal", "sunspike", "judgment-line", "bastion-pulse", "aegis-share",
  "plant-charge", "shock-ring", "rally-light", "kindled-resolve", "bulwark-step",
  // Syzygist catalog v1 (priest)
  "bleed-tithe", "severance", "borrowed-time", "focus-hex", "contagion",
  "flock-pulse", "self-lattice", "glass-ward", "haste-gift", "drift-step",
  // Interstice catalog v1 (ninja)
  "undercut", "edge-storm", "needle", "read-mark", "shard-ring",
  "wall-bloom", "ghost-guard", "second-wind", "razor-route", "paper-double",
];
const idx = (arr: string[], v: string | undefined): number | null =>
  v === undefined ? null : Math.max(0, arr.indexOf(v));
// Zig enum member identifiers can't contain hyphens; every string used here
// (classId/rarity/AbilityKind values) is otherwise a plain lowercase word.
const zigIdent = (s: string): string => s.replace(/-/g, "_");
function assertKnown(arr: string[], v: string, label: string, cardId: string): void {
  if (!arr.includes(v)) {
    throw new Error(
      `gen_card_data: card "${cardId}" has unknown ${label} "${v}" — update the ${label} list in gen_card_data.ts to match cardTypes.ts`,
    );
  }
}

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
//
// Cards with NO `modifier` (the 45 pure-ability cards — none of the five
// class-blind six-axes actives nor any of the 40 classId-gated catalog
// actives touch weapon stats) must resolve to a byte-identical no-op here,
// matching weaponBuild.ts's applyCard early return `if (!modifier) return;`
// EXACTLY — so this function short-circuits to the all-defaults `.{}`
// literal before touching `card.modifier` at all, rather than running the
// visible-signature-bump machinery below (which is meaningless with no
// modifier to bump).
function cardModLiteral(card: (typeof crystalRoundsCards)[number]): string {
  if (!card.modifier) return ".{}";
  const mod = card.modifier;
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
  return `.{${body}}`;
}

// CardMeta: the card's own identity/metadata (classId/unique/maxStacks/
// rarity/active) — conceptually distinct from CardMod (the resolved WEAPON
// stat effect) and populated for EVERY card, including the 45 pure-ability
// cards that carry no `modifier` at all. See cards_gen.zig's CardMeta doc
// comment for the full "why a sibling struct, not a CardMod extension"
// reasoning.
function cardMetaLiteral(card: (typeof crystalRoundsCards)[number]): string {
  const parts: string[] = [];
  if (card.classId !== undefined) {
    assertKnown(CLASS_ID, card.classId, "classId", card.id);
    parts.push(`.class_id = .${zigIdent(card.classId)}`);
  }
  if (card.unique) parts.push(`.unique = true`);
  if (card.maxStacks !== undefined) {
    if (card.maxStacks <= 0) {
      throw new Error(
        `gen_card_data: card "${card.id}" has maxStacks=${card.maxStacks} — 0 is reserved as CardMeta.max_stacks' "no explicit cap" sentinel, so a real cap must be >=1`,
      );
    }
    parts.push(`.max_stacks = ${card.maxStacks}`);
  }
  assertKnown(RARITY, card.rarity, "rarity", card.id);
  parts.push(`.rarity = .${zigIdent(card.rarity)}`);
  if (card.active) {
    assertKnown(ABILITY_KIND, card.active.kind, "active.kind", card.id);
    const durationPart =
      card.active.durationMs !== undefined ? `, .duration_ms = ${f(card.active.durationMs, 0)}` : "";
    parts.push(
      `.active = .{ .kind = .${zigIdent(card.active.kind)}, .cooldown_ms = ${f(card.active.cooldownMs, 0)}${durationPart} }`,
    );
  }
  return `.{ ${parts.join(", ")} }`;
}

function cardLiteral(card: (typeof crystalRoundsCards)[number]): string {
  return `    .{ .id = "${card.id}", .mod = ${cardModLiteral(card)}, .meta = ${cardMetaLiteral(card)} },`;
}

const sw = starterWeapon;
const swp = sw.projectile;
// Every card gets an entry now — not just the ones with a `modifier`. The
// 45 pure-ability cards (no modifier) still need a CardMeta (classId/
// unique/maxStacks/rarity/active) to be reachable from Zig; their CardMod
// resolves to the all-defaults no-op via cardModLiteral's early return.
const rows = crystalRoundsCards.map((c) => cardLiteral(c)).join("\n");

// Emit `name = N,` enum bodies, one member per line, in array order — array
// order IS declaration order for CLASS_ID/RARITY (both mirror their TS union
// literally) and ABILITY_KIND (copied from cardTypes.ts's union above).
const enumBody = (arr: string[]): string =>
  arr.map((v, i) => `    ${zigIdent(v)} = ${i},`).join("\n");

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

/// Class-exclusive gate (cardTypes.ts's ClassId — dev-id vocabulary, never
/// the display persona name: wizard/ninja/paladin/priest).
pub const ClassId = enum(u8) {
${enumBody(CLASS_ID)}
};

/// Draft-weighting tier (cardTypes.ts's CardDefinition.rarity union).
pub const Rarity = enum(u8) {
${enumBody(RARITY)}
};

/// Drafted-active identity tag (cardTypes.ts's AbilityKind union) — a plain
/// identity enum, NOT a struct: it tells a future resolver WHICH ability a
/// card grants, carrying no behavior of its own. Re-derive this list from
/// the live cardTypes.ts union on every future edit (gen_card_data.ts's
/// ABILITY_KIND array is the single source for member order/count).
pub const AbilityKind = enum(u8) {
${enumBody(ABILITY_KIND)}
};

/// One drafted active's timing (cardTypes.ts's AbilityActiveSpec). Paired
/// onto a CardMeta only when the card actually has \`active\` — see
/// CardMeta.active below.
pub const CardActive = struct {
    kind: AbilityKind,
    cooldown_ms: f64,
    /// Effect window; null = instant (mirrors AbilityActiveSpec.durationMs
    /// being omitted — "omitted = instant" per its own TS doc comment).
    duration_ms: ?f64 = null,
};

/// A card's own identity/metadata — classId/unique/maxStacks/rarity/active.
/// Deliberately a SIBLING struct to CardMod, not an extension of it: CardMod
/// is "the resolved WEAPON stat effect" (damage/speed/spread/... multipliers
/// that fold additively/multiplicatively across a whole hand via
/// weapon_build.zig's resolveMods loop); CardMeta is per-card identity that
/// never folds — it's read once per card, not accumulated across a hand.
/// Cramming classId/active into CardMod would force every hand-resolution
/// call site to start ignoring fields that make no sense to accumulate,
/// which is exactly the kind of accidental-coupling CardMod's own doc
/// comment ("the resolved weapon stat effect") warns against.
pub const CardMeta = struct {
    /// Class-EXCLUSIVE gate (cardTypes.ts's CardDefinition.classId) — null
    /// means universal (every six-axes class-blind card, and every
    /// universal weapon-stat card). Mirrors CardMod's own \`?u8\`-family
    /// "genuinely absent" convention (this file's established idiom for
    /// optional TS fields), rather than world_state.zig's has_-bool-gate
    /// pattern — that pattern exists because world_state.zig's structs are
    /// \`extern\` (crossing the wasm ABI boundary), where Zig's tagged
    /// optionals aren't layout-stable. CardMeta/CardEntry never cross that
    /// boundary (weapon_build.zig consumes them Zig-side only), so a plain
    /// \`?ClassId\` is both idiomatic and consistent with CardMod's own
    /// sibling fields in this exact file.
    class_id: ?ClassId = null,
    /// Can only ever be held once (cardTypes.ts's CardDefinition.unique) —
    /// enforced at the offer-roll and apply-time gates (round.ts / weaponBuild.ts),
    /// not here; this struct only carries the fact.
    unique: bool = false,
    /// Explicit stacking cap (cardTypes.ts's CardDefinition.maxStacks).
    /// 0 = no explicit cap (the TS field is simply absent — stacking is
    /// then gated ONLY by \`unique\`, or fully unlimited if unique is also
    /// false). Every real maxStacks value in cards.ts is >=1 (see
    /// gen_card_data.ts's assertKnown-adjacent guard), so 0 is an
    /// unambiguous "unset" sentinel — chosen over \`?u8\` to keep this one
    /// field a plain int (every OTHER CardMeta field already needed either
    /// a bool or an optional-of-a-non-trivial-type; this is the one place a
    /// sentinel reads clearer than an extra optional wrapper).
    max_stacks: u8 = 0,
    /// Draft-weighting tier (cardTypes.ts's CardDefinition.rarity) — always
    /// explicitly set by the generator (every CardDefinition has a required
    /// rarity); the default below is never relied upon, only present so
    /// CardMeta stays a valid zero-initializable struct like CardMod.
    rarity: Rarity = .common,
    /// The ability this card grants, if any (cardTypes.ts's
    /// CardDefinition.active). null = this card has no active — either a
    /// pure weapon-stat card, or (today) not yet authored. Resolution of
    /// WHAT an active does is explicitly out of scope here; this only
    /// carries kind + cooldown/duration identity.
    active: ?CardActive = null,
};

pub const CardEntry = struct { id: []const u8, mod: CardMod, meta: CardMeta };

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

pub fn cardMeta(id: []const u8) ?CardMeta {
    for (cards) |c| {
        if (std.mem.eql(u8, c.id, id)) return c.meta;
    }
    return null;
}

const std = @import("std");
`;

writeFileSync(resolve(import.meta.dir, "../src/data/cards_gen.zig"), out);
const withMod = crystalRoundsCards.filter((c) => c.modifier).length;
const withActive = crystalRoundsCards.filter((c) => c.active).length;
console.log(
  `cards_gen.zig: ${crystalRoundsCards.length} cards (${withMod} with modifier, ${withActive} with active)`,
);
