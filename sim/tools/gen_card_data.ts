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
import { starterWeapon, baseWeaponForClass } from "../../client/src/sim/data/weapons.ts";
import type { ClassId, WeaponCardModifier } from "../../client/src/sim/data/cardTypes.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHAPE = ["circle", "triangle", "square", "hexagon", "orb", "x", "bar"];
const ELEMENT = ["crystal", "neutral", "fire", "ice", "lightning", "void", "radiant", "electric", "toxic", "sticky", "explosive"];
const PATHING = ["straight", "gravity", "bounce", "boomerang", "homing", "anti-homing", "float", "accelerate"];
const IMPACT = ["none", "explosive", "sticky", "pierce-chain", "slow-field"];
// Mirrors cardTypes.ts's WeaponDelivery union — index 0 ("projectile") is
// the neutral no-op value a card's OWN `delivery` field defaults to when
// unset (CardMod.delivery stays `null` for every card that doesn't touch
// it). NOT necessarily starterWeapon.delivery itself any more — true
// hitscan (2026-07-20) moved that to "raycast" (index 1); StarterBase.delivery
// below carries the actual base weapon value independently.
const DELIVERY = ["projectile", "raycast", "continuous-beam", "area-pulse"];
// Mirrors cardTypes.ts's ClassId union exactly (dev-id vocabulary, never the
// display persona name).
const CLASS_ID = ["wizard", "ninja", "paladin", "priest"];
// Mirrors cardTypes.ts's CardDefinition.rarity union exactly.
const RARITY = ["common", "uncommon", "rare", "legendary", "cursed"];
// Mirrors cardTypes.ts's WeaponBucket union exactly — one bool per bucket,
// packed into CardMeta.buckets (draftWeights.ts's weightForCard reads
// buckets to decide the catch-up impact/utility/element/ability boost; the
// draft/offer-roll port (docs/zig-step-world-parity-goal.md Phase 2) is the
// first Zig consumer, hence added here rather than earlier — no prior Zig
// pass needed bucket membership).
const BUCKET = ["delivery", "shape", "trajectory", "quantity", "impact", "element", "utility", "ability"];
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
// (reload/magazine/ammo) never cross the sim boundary and are skipped.
// Recoil DOES cross now (Track Z0c Item A — the fire-recoil substrate):
// `recoil_mul` mirrors the top-level `modifier.recoilMultiplier` fold
// (weaponBuild.ts:278) and `proj_recoil_mul` mirrors the per-projectile
// `projectile.recoilMultiplier` merge (weaponBuild.ts:428) — both feed
// weapon_build.zig's resolved `recoil_impulse`, the number world.zig's fire
// section kicks the shooter with.
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
  return modLiteral(card, card.modifier);
}

// Emit ONE CardMod literal for an arbitrary effective modifier — either the
// card's class-blind `modifier` (cardModLiteral above) or one of its
// `classModifiers` per-class overrides (classModsLiteral below). The
// visible-signature bump machinery runs against the SAME modifier the TS
// runtime would hand `applyCard` for that resolution (weaponBuild.ts:
// `ensureVisibleCardSignature(build, card, modifier)` receives the
// EFFECTIVE modifier, so a low-signature override like stolen-fangs'
// priest `{ leechFraction: 0.08 }` gets the cosmetic bump even though the
// class-blind modifier wouldn't).
function modLiteral(
  card: (typeof crystalRoundsCards)[number],
  mod: WeaponCardModifier,
): string {
  const p = mod.projectile;
  const bump = visibleSignatureBump(card, mod);
  const parts: string[] = [];
  const add = (name: string, val: string, isDefault: string) => {
    if (val !== isDefault) parts.push(`.${name} = ${val}`);
  };
  add("damage_mul", f(mod.damageMultiplier, 1), "1.0");
  add("fire_rate_mul", f(mod.fireRateMultiplier, 1), "1.0");
  add("recoil_mul", f(mod.recoilMultiplier, 1), "1.0");
  add("projectile_speed_mul", f(mod.projectileSpeedMultiplier, 1), "1.0");
  add("spread_radians_add", f(mod.spreadRadiansAdd, 0), "0.0");
  add("spread_radians_set", optF(mod.spreadRadians), "null");
  add("max_health_add", f(mod.maxHealthAdd, 0), "0.0");
  // Passive Tithe leech (Track E1 classModifiers port) — mirrors applyCard's
  // `leechFraction` max-fold (weaponBuild.ts:361) + clampBuild's
  // `roundTo(clamp(0, 0.5), 3)` tail. Only stolen-fangs' priest override
  // sets it today, but it's a first-class CardMod field so any future card
  // (class-blind or class-gated) crosses without a host-side patch.
  add("leech_fraction", f(mod.leechFraction, 0), "0.0");
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
    // ensureVisibleCardSignature's cosmetic bump (see visibleSignatureBump
    // above) crosses on its OWN channel now (proj_*_bump), no longer folded
    // into proj_size_mul/proj_speed_mul/proj_shape: TS composes the REAL
    // projectile multipliers via `orthogonalScale` (mixed grow/shrink =
    // log-blend, not product) and the bump via PLAIN multiplication
    // (weaponBuild.ts:426-433), and the shape bump is a DIRECT overwrite
    // (`build.projectile.shape = icon`) where the real p.shape goes through
    // `preferShape`. One baked product literal can't honor both algebras
    // once the running value isn't 1 (multi-card hands; paladin's 1.15
    // base size) — Track E1's true-merge-semantics port needs them split.
    // Exactly one channel is ever live per card: a card with a set shape or
    // a non-1 sizeMultiplier HAS a visible signature, so its bump is null.
    add("proj_speed_mul", f(p?.speedMultiplier, 1), "1.0");
    add("proj_size_mul", f(p?.sizeMultiplier, 1), "1.0");
    add("proj_speed_bump", f(bump?.speedMultiplier, 1), "1.0");
    add("proj_size_bump", f(bump?.sizeMultiplier, 1), "1.0");
    add("proj_shape_bump", optI(idx(SHAPE, bump?.shape)), "null");
    add("proj_recoil_mul", f(p?.recoilMultiplier, 1), "1.0");
    add("proj_lifetime_mul", f(p?.lifetimeMultiplier, 1), "1.0");
    add("proj_shape", optI(idx(SHAPE, p?.shape)), "null");
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
  const buckets = card.buckets ?? [];
  const bucketParts: string[] = [];
  for (const b of buckets) {
    assertKnown(BUCKET, b, "bucket", card.id);
    bucketParts.push(`.${zigIdent(b)} = true`);
  }
  if (bucketParts.length > 0) {
    parts.push(`.buckets = .{ ${bucketParts.join(", ")} }`);
  }
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

// classModifiers (cardTypes.ts:455 — "REPLACES `modifier` wholesale" for a
// class with an authored entry; absent classes fall back to the class-blind
// `modifier`, mirroring weaponBuild.ts's `effectiveCardModifier` exactly).
// Track E1 (gospel-goal.md): this is the codegen port that retires
// fireConfigShared.ts's `patchClassModifierGapFields` stopgap — each
// authored override becomes a full CardMod literal of its own, run through
// the SAME modLiteral pipeline (visible-signature bump included) as the
// class-blind modifier.
function classModsLiteral(card: (typeof crystalRoundsCards)[number]): string | null {
  const cm = card.classModifiers;
  if (!cm) return null;
  const parts: string[] = [];
  for (const cls of Object.keys(cm)) {
    assertKnown(CLASS_ID, cls, "classModifiers class", card.id);
  }
  // Emit in CLASS_ID declaration order (stable output regardless of the
  // authored object-key order in cards.ts).
  for (const cls of CLASS_ID) {
    const override = cm[cls as ClassId];
    if (!override) continue;
    parts.push(`.${zigIdent(cls)} = ${modLiteral(card, override)}`);
  }
  return parts.length ? `.{ ${parts.join(", ")} }` : null;
}

function cardLiteral(card: (typeof crystalRoundsCards)[number]): string {
  const cm = classModsLiteral(card);
  const cmPart = cm ? `, .class_mods = ${cm}` : "";
  return `    .{ .id = "${card.id}", .mod = ${cardModLiteral(card)}, .meta = ${cardMetaLiteral(card)}${cmPart} },`;
}

// One BaseWeapon literal (weapons.ts WeaponDefinition → the sim-relevant
// subset — the exact field set the old class-blind `StarterBase` carried).
// Used for `starter_base` AND the per-class starter overrides (Track E1:
// priest's tendril rework + paladin's heavy bolt cross to Zig now, closing
// the "per-class starter STAT overrides remain an unported, recorded gap"
// note weapon_build.zig's base_delivery seed carried).
function baseLiteral(w: typeof starterWeapon): string {
  const wp = w.projectile;
  return `.{
    .delivery = ${idx(DELIVERY, w.delivery)},
    .damage = ${f(w.damage, 0)},
    .fire_rate = ${f(w.fireRate, 0)},
    .projectile_speed = ${f(w.projectileSpeed, 0)},
    .projectile_lifetime_seconds = ${f(w.projectileLifetimeSeconds, 0)},
    .spread_radians = ${f(w.spreadRadians, 0)},
    .recoil_impulse = ${f(w.recoilImpulse, 0)},
    .p_shape = ${idx(SHAPE, wp.shape)},
    .p_count = ${f(wp.count, 0)},
    .p_range_px = ${f(wp.rangePx, 0)},
    .p_speed_mul = ${f(wp.speedMultiplier, 1)},
    .p_size_mul = ${f(wp.sizeMultiplier, 1)},
    .p_recoil_mul = ${f(wp.recoilMultiplier, 1)},
    .p_pathing = ${idx(PATHING, wp.pathing)},
    .p_element = ${idx(ELEMENT, wp.element)},
    .p_impact = ${idx(IMPACT, wp.impact)},
    .p_lifetime_mul = ${f(wp.lifetimeMultiplier, 1)},
    .p_gravity_scale = ${f(wp.gravityScale, 0)},
    .p_homing_strength = ${f(wp.homingStrength, 0)},
    .p_acceleration_mul = ${f(wp.accelerationMultiplier, 0)},
    .p_bounces = ${f(wp.bounces, 0)},
    .p_impact_radius = ${f(wp.impactRadiusPx, 0)},
    .p_pierce_count = ${f(wp.pierceCount, 0)},
    .p_split_count = ${f(wp.splitCount, 0)},
    .p_slow_mul = ${f(wp.slowMultiplier, 1)},
}`;
}

// Object IDENTITY with starterWeapon (not stat equality) decides null —
// mirroring weapons.ts's CLASS_BASE_WEAPON fallback exactly
// (classExpression.test.ts asserts wizard/ninja share the OBJECT).
const classBaseRows = CLASS_ID.map((cls) => {
  const w = baseWeaponForClass(cls as ClassId);
  if (w === starterWeapon) return `    null, // ${cls}: shares starter_base`;
  return `    ${baseLiteral(w).split("\n").join("\n    ")}, // ${cls}`;
}).join("\n");
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
    recoil_mul: f64 = 1,
    projectile_speed_mul: f64 = 1,
    spread_radians_add: f64 = 0,
    spread_radians_set: ?f64 = null,
    max_health_add: f64 = 0,
    /// Passive Tithe leech (weaponBuild.ts applyCard:361 max-fold; clamped
    /// + rounded to 3dp in clampBuild). Crosses to
    /// ResolvedFireConfig.leech_fraction via weapon_build.zig — the field
    /// the host-side patchLeechFraction stopgap used to write (retired,
    /// Track E1 classModifiers port).
    leech_fraction: f64 = 0,
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
    /// ensureVisibleCardSignature's cosmetic factors (weaponBuild.ts:426-433)
    /// — PLAIN-multiplied in TS, unlike proj_speed_mul/proj_size_mul's
    /// orthogonalScale fold, so they cross on their own channel. Exactly one
    /// of (real multiplier, bump) is ever non-default per card — a non-1
    /// real multiplier IS a visible signature, which suppresses the bump.
    proj_speed_bump: f64 = 1,
    proj_size_bump: f64 = 1,
    /// The bump's icon-shape overwrite — a DIRECT set in TS
    /// (\`build.projectile.shape = icon\`), unlike proj_shape's preferShape
    /// merge. Same one-channel-per-card exclusivity as the factors above.
    proj_shape_bump: ?u8 = null,
    proj_recoil_mul: f64 = 1,
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

/// Mirrors cardTypes.ts's WeaponBucket union — one bool per bucket, a
/// card may belong to several (e.g. \`["shape", "trajectory"]\`). Only
/// consumer today (Phase 2, docs/zig-step-world-parity-goal.md): the
/// draft/offer-roll's catch-up weighting (draftWeights.ts's
/// \`weightForCard\`) boosts impact/utility/element/ability-bucket cards
/// for non-winner seats. A packed bool struct, not a \`[]const WeaponBucket\`
/// slice, because CardMeta (unlike ProjectileEntity et al.) is a plain
/// (non-\`extern\`) struct living entirely Zig-side (see CardMeta's own doc
/// comment) — a fixed 1-byte bitset is simpler than a slice here and needs
/// no backing array.
pub const CardBuckets = packed struct(u8) {
    delivery: bool = false,
    shape: bool = false,
    trajectory: bool = false,
    quantity: bool = false,
    impact: bool = false,
    element: bool = false,
    utility: bool = false,
    ability: bool = false,
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
    /// Weapon-bucket membership (cardTypes.ts's CardDefinition.buckets ??
    /// []) — every real card in cards.ts sets at least one bucket, but the
    /// default here is the honest empty-set, same "never relied upon"
    /// caveat as \`rarity\`'s default above.
    buckets: CardBuckets = .{},
    /// The ability this card grants, if any (cardTypes.ts's
    /// CardDefinition.active). null = this card has no active — either a
    /// pure weapon-stat card, or (today) not yet authored. Resolution of
    /// WHAT an active does is explicitly out of scope here; this only
    /// carries kind + cooldown/duration identity.
    active: ?CardActive = null,
};

/// Per-class CardMod overrides (cardTypes.ts's \`classModifiers\` — Track E1
/// classModifiers port). Semantics mirror weaponBuild.ts's
/// \`effectiveCardModifier\` EXACTLY: an authored entry REPLACES the
/// class-blind \`CardEntry.mod\` WHOLESALE for that class; a class with no
/// entry falls back to \`mod\` — total and silent-by-design, never a merge
/// and never another class's reading. Each override literal ran through the
/// same codegen pipeline as \`mod\` (visible-signature bump included), so
/// resolving with it is byte-equivalent to TS resolving the same override.
pub const ClassMods = struct {
${CLASS_ID.map((v) => `    ${zigIdent(v)}: ?CardMod = null,`).join("\n")}

    pub fn forClass(self: *const ClassMods, class_id: ClassId) ?CardMod {
        return switch (class_id) {
${CLASS_ID.map((v) => `            .${zigIdent(v)} => self.${zigIdent(v)},`).join("\n")}
        };
    }
};

pub const CardEntry = struct {
    id: []const u8,
    mod: CardMod,
    meta: CardMeta,
    /// Per-class wholesale overrides of \`mod\` — see ClassMods. All-null for
    /// every card without an authored \`classModifiers\` in cards.ts.
    class_mods: ClassMods = .{},
};

/// weaponBuild.ts \`effectiveCardModifier\`: the modifier THIS class resolves
/// the card with — the class's wholesale override when authored, else the
/// class-blind \`mod\`. \`class_id == null\` = class-blind resolution,
/// byte-identical to the pre-class-era behavior.
pub fn effectiveCardMod(entry: *const CardEntry, class_id: ?ClassId) CardMod {
    if (class_id) |c| {
        if (entry.class_mods.forClass(c)) |m| return m;
    }
    return entry.mod;
}

/// One class's starter-weapon base stats (weapons.ts WeaponDefinition,
/// sim-relevant subset — the exact field set the old class-blind
/// \`StarterBase\` struct-of-consts carried, now a value type so the
/// class-gated starter weapons cross too).
pub const BaseWeapon = struct {
    delivery: u8,
    damage: f64,
    fire_rate: f64,
    projectile_speed: f64,
    projectile_lifetime_seconds: f64,
    spread_radians: f64,
    recoil_impulse: f64,
    p_shape: u8,
    p_count: f64,
    p_range_px: f64,
    p_speed_mul: f64,
    p_size_mul: f64,
    p_recoil_mul: f64,
    p_pathing: u8,
    p_element: u8,
    p_impact: u8,
    p_lifetime_mul: f64,
    p_gravity_scale: f64,
    p_homing_strength: f64,
    p_acceleration_mul: f64,
    p_bounces: f64,
    p_impact_radius: f64,
    p_pierce_count: f64,
    p_split_count: f64,
    p_slow_mul: f64,
};

/// weapons.ts \`starterWeapon\` — the wizard/ninja/class-blind base.
pub const starter_base: BaseWeapon = ${baseLiteral(starterWeapon)};

/// weapons.ts CLASS_BASE_WEAPON (via \`baseWeaponForClass\`): full per-class
/// starter-STAT overrides, indexed by @intFromEnum(ClassId). null = the
/// class shares \`starter_base\` (wizard/ninja — deliberately the SAME
/// object in TS; classExpression.test.ts asserts object identity). Track
/// E1 classModifiers port: closes the "per-class starter STAT overrides
/// remain an unported, recorded gap" residual — priest's homing-tendril
/// rework and paladin's heavier bolt now resolve in-sim, delivery seed
/// included (the old \`base_delivery\` class switch in weapon_build.zig is
/// subsumed by these literals' own \`.delivery\`).
pub const class_bases = [${CLASS_ID.length}]?BaseWeapon{
${classBaseRows}
};

/// weapons.ts \`baseWeaponForClass\`: the class's authored starter override,
/// else the shared \`starter_base\` (null / no entry = class-blind).
pub fn baseWeaponForClass(class_id: ?ClassId) BaseWeapon {
    if (class_id) |c| {
        if (class_bases[@intFromEnum(c)]) |b| return b;
    }
    return starter_base;
}

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
const withClassMods = crystalRoundsCards.filter((c) => c.classModifiers).length;
console.log(
  `cards_gen.zig: ${crystalRoundsCards.length} cards (${withMod} with modifier, ${withActive} with active, ${withClassMods} with classModifiers)`,
);
