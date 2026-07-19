// Card / weapon definition types. Pure data, runtime-agnostic. Imported by
// both client (UI + offline match) and server (authoritative weapon stats).
//
// These types were originally in client/src/game/types/game.ts. They live in
// sim/ now so that both prediction (client) and authority (server) resolve
// the exact same weapon build from a player's card hand.

import type {
  CharacterArchetype,
  ElementType,
  ProjectilePathing,
  ProjectileShape,
} from "../types.js";

export type CardId = string;
export type WeaponId = string;

// ── Class-expression infrastructure (docs/classes-goal.md, card-pool-v2.md) ─
// A card's mechanical effect (`modifier`) is class-blind by default — every
// chassis reads it identically, exactly today's flat-pool behavior. This is
// the hook a class's SPEC layer plugs into when its per-class expression is
// actually built: `classModifiers[classId]` REPLACES `modifier` wholesale
// for that class only (never merges with it — a card has one active reading
// per class, not a base-plus-diff). Absent = that class hasn't been
// authored yet; resolution falls back to the class-blind `modifier`
// (today's behavior), never to another class's reading and never to a
// placeholder. See `effectiveCardModifier` in weaponBuild.ts for the one
// place this map is read.
//
// `ClassId` is the dev-id vocabulary from docs/classes-goal.md § Naming
// (wizard/ninja/paladin/priest — code/docs/sigil lookup, never the display
// persona name). `client/src/game/types/game.ts` re-exports this exact type
// so the display layer and the sim layer share one definition.
export type ClassId = "wizard" | "ninja" | "paladin" | "priest";

/** archetype (sim/wire id, PlayerEntity.characterId) → class dev-id. Mirrors
 *  the authoritative display table in client/src/game/data/characters.ts
 *  (balanced→wizard, heavy→paladin, sprinter→ninja, shielded→priest) — kept
 *  as a tiny standalone map rather than importing that table because sim/
 *  must not depend on game/ (cards.ts's own header comment: "must compile
 *  inside the Bun runtime", no Phaser/DOM/client imports). Keep both tables
 *  in sync if a fifth chassis is ever added. */
const ARCHETYPE_CLASS_ID: Record<CharacterArchetype, ClassId> = {
  balanced: "wizard",
  heavy: "paladin",
  sprinter: "ninja",
  shielded: "priest",
};

/** Total, pure lookup — unknown archetypes (shouldn't happen; the union is
 *  closed) fall back to wizard, the class-blind default chassis. */
export function classIdForArchetype(characterId: CharacterArchetype): ClassId {
  return ARCHETYPE_CLASS_ID[characterId] ?? "wizard";
}

export type WeaponDelivery = "projectile" | "raycast" | "continuous-beam" | "area-pulse";

export type ImpactBehavior =
  | "none"
  | "explosive"
  | "sticky"
  | "pierce-chain"
  | "slow-field";

export type WeaponBucket =
  | "delivery"
  | "shape"
  | "trajectory"
  | "quantity"
  | "impact"
  | "element"
  | "utility"
  | "ability";

export type ProjectileModifier = {
  shape: ProjectileShape;
  count: number;
  rangePx: number;
  speedMultiplier: number;
  sizeMultiplier: number;
  recoilMultiplier: number;
  pathing: ProjectilePathing;
  element: ElementType;
  impact: ImpactBehavior;
  lifetimeMultiplier: number;
  gravityScale: number;
  homingStrength: number;
  accelerationMultiplier: number;
  bounces: number;
  impactRadiusPx: number;
  pierceCount: number;
  splitCount: number;
  slowMultiplier: number;
};

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  weaponClass: "baseline" | "beam" | "pulse" | "satellite";
  delivery: WeaponDelivery;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadSeconds: number;
  projectileSpeed: number;
  projectileLifetimeSeconds: number;
  spreadRadians: number;
  recoilImpulse: number;
  knockbackImpulse: number;
  projectile: ProjectileModifier;
};

export type WeaponCardModifier = {
  delivery?: WeaponDelivery;
  projectile?: Partial<ProjectileModifier>;
  projectileCountAdd?: number;
  projectileBounceAdd?: number;
  projectileSplitAdd?: number;
  projectileHomingStrengthAdd?: number;
  spreadRadiansAdd?: number;
  damageMultiplier?: number;
  fireRateMultiplier?: number;
  projectileSpeedMultiplier?: number;
  reloadMultiplier?: number;
  magazineSizeAdd?: number;
  spreadRadians?: number;
  recoilMultiplier?: number;
  /** Tithe (docs/card-pool-v2.md "Tithe"): fraction of post-mitigation
   *  damage a damaging hit heals back to the shooter. Read at projectile
   *  spawn (weapon.ts) and stamped onto `ProjectileEntity.leechFraction`,
   *  the SAME field the six-axes Crimson Tithe ability window already uses
   *  (types.ts) — World.ts's hit resolution already knows how to pay out a
   *  leech-flagged shard (self-heal, capped, self-damage excluded), so this
   *  card only needs to populate the existing field, never touch World.ts. */
  leechFraction?: number;
  knockbackMultiplier?: number;
  ammoRegenPerSecond?: number;
  overchargeMultiplier?: number;
  orbitingSatellites?: number;
  mirrorShield?: boolean;
  maxHealthAdd?: number;
  moveSpeedMultiplier?: number;
  parryCoverMultiplier?: number;
  parryCooldownMultiplier?: number;
  // ── Movement augments (ride the existing speed/gravity step params) ──────
  /** <1 = floatier (glide), >1 = heavier/snappier fall. Multiplies gravity. */
  gravityMultiplier?: number;
  // ── Deep movement augments (cross the wasm boundary via PlayerStep) ──────
  /** Scales the ground/coyote jump launch velocity. */
  jumpMultiplier?: number;
  /** Scales the wall-jump launch velocity. */
  wallJumpMultiplier?: number;
  /** Scales the wall-slide cap (<1 = grippier/slower slide, >1 = looser). */
  wallSlideMultiplier?: number;
  /** Extra mid-air jumps granted (1 = double jump, 2 = triple, …). Additive. */
  airJumpsAdd?: number;
  /** Dash charges granted: enables the Dash input and this many AIR dashes
   *  before landing (ground dash is always available on cooldown). Additive. */
  dashChargesAdd?: number;
  /** Scales the dash-bash slide's cooldown (<1 = sooner). Floor-clamped in
   *  weaponBuild.ts and stepPlayer so the recovery-endlag window can never be
   *  squeezed out by stacking — Quick Parry (repurposed from the now-dead
   *  timed-parry cooldown onto this). */
  dashCooldownMultiplier?: number;
  // ── Shield augments ──────────────────────────────────────────────────────
  /** Scales the shield's max charge (bigger bar = longer block). */
  shieldChargeMultiplier?: number;
  /** Scales how fast the shield recharges when not held. */
  shieldRechargeMultiplier?: number;
  /** Aim shield: the held shield only blocks hits arriving within the AIM arc
   *  (must face the threat) — in exchange for a stronger benefit on the card. */
  directionalShield?: boolean;
  /** Stolen Fangs: absorbing ANY shielded hit banks a lock charge (cap 2,
   *  expires after a few seconds unspent). The next fired shot(s) consume a
   *  charge and become homing at reduced damage. See sim/World.ts and
   *  sim/weapon.ts for the grant/consume logic. */
  stolenFangs?: boolean;
};

// ── Drafted actives (six-axes-goal.md Layer 2) ─────────────────────────────
// Ability cards ARE actives: drafted through the same round-end picker,
// they land on the action bar in pick order (keys 1-3), cooldown-gated.
// `kind` is a closed union — deriveAxisProfile maps kind → axis (doctrine
// #1: one derivation, no hand-authored axis tags).

/** Hard slot cap: three keys (1-3), five non-Sorcery axes — the draft
 *  chooses identity under scarcity (docs/classes-goal.md "Rotation system":
 *  rack slots keys 1-3, exactly 3, never 4 — soft lock 2026-07-17; restated
 *  docs/six-axes-goal.md doctrine #6). Enforced at offer-roll time
 *  (round.ts), never by silently failing a pick. */
export const MAX_ABILITY_SLOTS = 3;

export type AbilityKind =
  | "crimson-tithe"
  | "shelter-seal"
  | "shadow-step"
  | "veil-of-nought"
  | "severing-answer"
  // ── Geometrician catalog v1 (docs/class-ability-catalogs-v1.md) ─────────
  // classId-gated to wizard at the offer roll (round.ts enterDrafting) —
  // these ten are NOT class-blind like the five above. See cards.ts for the
  // CardDefinitions and World.ts's ability-activation switch for the v1
  // sim effects (each reuses six-axes substrate; doc-fidelity gaps are
  // recorded deferrals, not silent stubs).
  | "sunlance"
  | "facet-break"
  | "prism-fan"
  | "lattice"
  | "return-glass"
  | "hard-aperture"
  | "overclock"
  | "measure"
  | "slip-node"
  | "recoil-step"
  // ── Kindred catalog v1 (docs/class-ability-catalogs-v1.md) ──────────────
  // classId-gated to paladin at the offer roll (round.ts enterDrafting) —
  // same discipline as the Geometrician ten above. All 10 of the doc's 10
  // (grew to 12 via the coverage-floor fast-follow further down this
  // union, then cut back to 10 on 2026-07-19 — see that note below)
  // are wired as of the class-overhaul-workboard.md chunk 2.6 fast-follow
  // (2026-07-18) — the original pass shipped 7; Retribution Edge, Shock
  // Ring, and Rally Light (deferred that pass for "timing/hop-slam
  // complexity" and "cross-player buff-aura machinery" respectively) are
  // now wired too. Retribution Edge/Shock Ring stay self-only (their own
  // window-buff fields, TS-only, never cross the ABI, same "the Zig line"
  // precedent as sealUntilTick/aegisShareUntilTick). Rally Light needed NO
  // cross-player write at all in the end — it's a read-only continuous aura
  // check (every reader only ever reads a nearby live source and multiplies
  // its OWN output), so it doesn't use the pendingSyzygistCasts deferred-
  // queue shape syzygistCatalog's ally-targeted buffs need — see
  // constants.ts's KIN_RALLY_LIGHT_* header comment for the full reasoning.
  | "unbroken-seal"
  | "sunspike"
  | "judgment-line"
  | "bastion-pulse"
  | "aegis-share"
  | "plant-charge"
  | "shock-ring"
  | "rally-light"
  // Kindred coverage-floor + solo-viability fast-follow (docs/axiom-
  // deviations-audit.md "Kindred (paladin) — two structural gaps",
  // 2026-07-18): the catalog's 2nd buff and 2nd movement, closing the
  // ≥2-per-role floor every other catalog already met (docs/classes-
  // goal.md's coverage lock). Grows Kindred to 12/12 (still inside the
  // locked 8-12 catalog-size range) rather than replacing two of the
  // existing 10 — see constants.ts's KIN_KINDLED_RESOLVE_*/KIN_BULWARK_
  // STEP_* header comments for the full "why ADD, not replace" reasoning.
  | "kindled-resolve"
  | "bulwark-step"
  // NOTE 2026-07-19: back down to 10/10. Retribution Edge (offense) and
  // Consecrated Field (aoe) were cut, not deferred — a genuine permanent
  // removal, unlike the "recorded deferral" pattern elsewhere in this
  // union. Retribution Edge carried an unaddressed self-fueling-loop
  // brake gap (docs/axiom-deviations-audit.md); Consecrated Field was
  // role-redundant with Shock Ring (both "AOE zone near yourself"). See
  // docs/class-ability-catalogs-v1.md's cut note. offense/aoe are now
  // 1-per-role by design, not a re-opened coverage gap.
  // Crater (docs/card-pool-v2.md #26, exclusive: Paladin) was also removed
  // 2026-07-19, alongside its sibling exclusives Retort/Bastion (never
  // AbilityKind entries — Retort/Bastion had no `active`, so no cast
  // switch case) — see cards.ts's cut note just above the old crater/
  // retort/bastion card definitions for the full reasoning (they leaked
  // into the loadout station's 10-card catalog as 13, a bug, not a
  // feature).
  // ── Syzygist catalog v1 (docs/class-ability-catalogs-v1.md) ─────────────
  // classId-gated to priest at the offer roll (round.ts enterDrafting) —
  // same discipline as the Geometrician/Kindred blocks above. All 10 of the
  // doc's 10 are wired this pass (class-overhaul-workboard.md chunk 3.4) —
  // unlike Kindred's 7/10, every ability here reuses ONE of a small set of
  // shared low-aim auto-target helpers (World.ts's findNearestAlly/
  // findNearestEnemy, SYZ_ALLY_SEARCH_RANGE_PX/SYZ_ENEMY_SEARCH_RANGE_PX),
  // so there was no per-ability aim-cone tuning left to defer.
  | "bleed-tithe"
  | "severance"
  | "borrowed-time"
  | "focus-hex"
  | "contagion"
  | "flock-pulse"
  | "self-lattice"
  | "glass-ward"
  | "haste-gift"
  | "drift-step"
  // ── Interstice catalog v1 (docs/class-ability-catalogs-v1.md) ───────────
  // classId-gated to ninja at the offer roll (round.ts enterDrafting) —
  // same discipline as the Geometrician/Kindred/Syzygist blocks above. All
  // 10 of the doc's 10 are now wired (class-overhaul-workboard.md ninja-
  // catalog chunk shipped 9, "paper-double" (movement) followed as its own
  // fast-follow pass once its blocking dependency — a new decoy/summon
  // ENTITY type in WorldState — was actually built).
  //
  // Former deferral note (preserved, not deleted — the discipline this
  // codebase already applies to every "why was this deferred" paragraph):
  // "paper-double... needs a new decoy/summon ENTITY type in WorldState
  // (own hitbox/health/input-echo AI + a resonance-gated swap), a
  // genuinely new ABI-crossing entity concept none of the other 36 catalog
  // abilities shipped this session needed — every one of them reuses a
  // self-window-buff / mark / projectile-spawn shape an existing verb
  // already proves out." That entity type now exists —
  // `PaperDoubleEntity`/`state.paperDoubles` (types.ts) + `paperDouble.ts`'s
  // spawn/step/collision logic, wired into World.ts's activation switch and
  // both classes' melee arc-hit-check sections. The "resonance-gated swap"
  // half of the original deferral is STILL a v1 gap — see this ability's
  // own case comment in World.ts (`"paper-double"`) and cardTypes.ts's
  // sibling doc trail below: v1 always spawns fresh, never swaps positions
  // with a live decoy. The `Fooled` status debuff from the card's
  // "Resonance:" line is ALSO deferred — it's a victim-side amp any
  // attacker's ability can exploit ("abilities cast into Fooled gain
  // +25%"), which would need threading into every ability damage site in
  // this file (melee arc hits ×2, the pendingInstantAoe resolution pass,
  // the generic projectile hit-confirm pass) rather than one caster-side
  // check like Facet Break's own `facetTargetId`/`facetMarkUntilTick`
  // precedent — a genuinely bigger surface than the core decoy loop this
  // pass shipped, so it's recorded here rather than guessed at silently.
  | "undercut"
  | "edge-storm"
  | "needle"
  | "read-mark"
  | "shard-ring"
  | "wall-bloom"
  | "ghost-guard"
  | "second-wind"
  | "razor-route"
  | "paper-double";

/** Catalog role tag (docs/classes-goal.md "Ability role range" — exactly
 *  six locked roles, no seventh "utility" catch-all). Only meaningful on
 *  classId-gated catalog ability cards (below); the five class-blind
 *  six-axes ability cards predate the role/catalog system and stay
 *  untagged. */
export type AbilityRole =
  | "defense"
  | "offense"
  | "buff"
  | "aoe"
  | "single"
  | "movement";

export type AbilityActiveSpec = {
  kind: AbilityKind;
  cooldownMs: number;
  /** Effect window; omitted = instant. */
  durationMs?: number;
};

/** One action-bar slot, resolved from the hand in pick order. */
export type ResolvedActive = {
  cardId: CardId;
  kind: AbilityKind;
  cooldownMs: number;
  durationMs: number;
  /** Catalog role tag, carried through from `CardDefinition.role` (see
   *  above). Undefined for the five class-blind six-axes ability cards,
   *  which predate the role/catalog system — callers that key behavior off
   *  role (e.g. worldBots.ts's target-required heuristic) must treat
   *  undefined as "unknown, assume target-required" rather than crash. */
  role?: AbilityRole;
};

// Visual hints used by UI overlays. Pure data, no Phaser refs — shapes /
// colors are interpreted by the renderer.
export type CardVisualDefinition = {
  iconShape: ProjectileShape;
  glowColor: string;
  particleColor: string;
};

export type StatModifier = {
  stat: string;
  value: number;
  multiplier?: boolean;
};

export type CardDefinition = {
  id: CardId;
  name: string;
  category: "weapon" | "projectile" | "movement" | "defense" | "utility" | "tradeoff" | "ability";
  rarity: "common" | "uncommon" | "rare" | "legendary" | "cursed";
  description: string;
  flavorText?: string;
  buckets?: WeaponBucket[];
  essenceCost?: number;
  modifier?: WeaponCardModifier;
  /** Drafted active (six-axes Layer 2). A card may carry both a modifier
   *  AND an active — every ability card also deepens its axis in the
   *  Emission (goal doctrine #7: no active-only cards in spirit; the axis
   *  coupling rides deriveAxisProfile off `active.kind`). */
  active?: AbilityActiveSpec;
  /** Per-class expression overrides (docs/classes-goal.md C3, card-pool-v2.md
   *  "Per-class expression" sections). When the resolving player's class has
   *  an entry here, it REPLACES `modifier` for that card; classes with no
   *  entry fall back to `modifier` (today's class-blind behavior — never a
   *  placeholder, never another class's reading). See `classIdForArchetype`
   *  + `effectiveCardModifier` (weaponBuild.ts). Keyed by dev-id `ClassId`,
   *  not archetype — a card is authored once per CLASS, not per body. */
  classModifiers?: Partial<Record<ClassId, WeaponCardModifier>>;
  /** Class-EXCLUSIVE gating (docs/class-ability-catalogs-v1.md — the
   *  catalog layer, distinct from `classModifiers`' per-class EXPRESSION of
   *  a universal card). When set, only players of this class are ever
   *  offered or may hold this card — enforced once, at the offer roll
   *  (round.ts enterDrafting), the single gate point, same discipline as
   *  the MAX_ABILITY_SLOTS cap. Absent = universal (every existing card,
   *  including the five class-blind six-axes ability cards, is unaffected). */
  classId?: ClassId;
  /** Catalog role tag — see `AbilityRole`. Set on classId-gated catalog
   *  ability cards; absent on universal cards. */
  role?: AbilityRole;

  // ROUNDS-style: Explicit benefits and penalties for tradeoffs
  benefits?: StatModifier[];
  penalties?: StatModifier[];
  
  visual?: CardVisualDefinition;
  unique?: boolean;
  maxStacks?: number;
};

export type ResolvedWeaponBuild = {
  id: WeaponId;
  name: string;
  delivery: WeaponDelivery;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadSeconds: number;
  projectileSpeed: number;
  projectileLifetimeSeconds: number;
  spreadRadians: number;
  recoilImpulse: number;
  knockbackImpulse: number;
  projectile: ProjectileModifier;
  ammoRegenPerSecond: number;
  overchargeMultiplier: number;
  orbitingSatellites: number;
  mirrorShield: boolean;
  maxHealthAdd: number;
  moveSpeedMultiplier: number;
  parryCoverMultiplier: number;
  parryCooldownMultiplier: number;
  gravityMultiplier: number;
  shieldChargeMultiplier: number;
  shieldRechargeMultiplier: number;
  directionalShield: boolean;
  stolenFangs: boolean;
  jumpMultiplier: number;
  wallJumpMultiplier: number;
  wallSlideMultiplier: number;
  airJumps: number;
  dashCharges: number;
  dashCooldownMultiplier: number;
  /** Tithe passive accumulation — see WeaponCardModifier.leechFraction. 0 =
   *  no passive lifesteal (today's behavior for every build without a Tithe
   *  card, byte-identical to pre-Tithe resolution). */
  leechFraction: number;
  cards: CardDefinition[];
  occupiedBuckets: WeaponBucket[];
  /** Drafted actives in pick order — action-bar slots 1..N (≤
   *  MAX_ABILITY_SLOTS; the offer roll stops offering ability cards when
   *  the hand holds three). */
  actives: ResolvedActive[];
};
