// Parry + shield combat helpers, ported from MatchScene's offline path so the
// new netcode runs the same gameplay. All functions are pure — they take in a
// PlayerEntity (and current/previous input bits, projectile data, dt, tick),
// and return new state. No DOM, no Date.now(), no Math.random().
//
// Mirrors the rules from client/src/game/scenes/MatchScene.ts:
//   - Parry: rising-edge trigger on InputBit.Ability, gated by cooldown.
//     Active for PARRY_ACTIVE_MS, then a PARRY_COOLDOWN_MS_DEFAULT lockout.
//     Hits whose source direction sits within ±arc/2 of the captured facing
//     are deflected (zero damage, projectile destroyed by the caller).
//   - Shield: held InputBit.Shield drains shieldCharge while a charge is
//     available. When inactive, the charge slowly recharges. A successful
//     block costs `damage * 1.8` charge and reduces the incoming damage to 0
//     until the charge runs out.
//
// MatchScene reference symbols: shieldActive, shieldCharge, temporaryShieldMs,
// parryActiveMs, parryCooldownMs, getParryArcRadians, isParryCovering,
// damagePlayer, clearTemporaryCombatEffects.

import { Tick } from "./types.js";
import { lutAtan2 } from "./trig.js";
import type {
  EntityId,
  InputBitfield,
  PlayerEntity,
  ProjectileEntity,
} from "./types.js";
import { classIdForArchetype } from "./data/cardTypes.js";

// ----- Constants -------------------------------------------------------------

/** Length of the parry "active" window once triggered. */
export const PARRY_ACTIVE_MS = 420;
/**
 * Default lockout (ms) before a fresh parry can be triggered. MatchScene's
 * offline path uses 4300ms scaled by per-build multipliers; the sim ships a
 * tighter default until card-driven multipliers are wired through here.
 */
export const PARRY_COOLDOWN_MS_DEFAULT = 1800;
/** Half-cone width is half of this — i.e. ±30° around `parryFacing`. */
export const PARRY_ARC_RADIANS = Math.PI / 3;
/** Aim-shield block arc — a broad 120° frontal cone (wider than the 60° parry
 *  since a held shield is a wall, not a flick). */
export const SHIELD_AIM_ARC_RADIANS = (2 * Math.PI) / 3;
/** Default starting / max shield charge. */
export const SHIELD_MAX_CHARGE_DEFAULT = 100;
/** Charge drained per second while shieldActive is true and not blocking a hit. */
export const SHIELD_DRAIN_PER_SECOND = 35;
/** Charge recharged per second while the shield is idle. */
export const SHIELD_RECHARGE_PER_SECOND = 14;
/** Charge cost = damage * this multiplier when a hit is shield-blocked. */
export const SHIELD_HIT_DRAIN_MULTIPLIER = 1.8;

/** Ghost Guard (Interstice catalog v1, defense role, 2026-07-18): the
 *  banked-charge velocity floor a player's own current speed must clear for
 *  "if moving" (class-ability-catalogs-v1.md) to read true — a light jog,
 *  not literally any nonzero drift, so a standing-still player with a
 *  banked charge still eats the hit (matching the doc's binary "if moving"
 *  flavor without being so strict it almost never fires). Well under
 *  player.ts's maxGroundSpeed (362, ninja ×1.14≈413) — first-draft/
 *  playtest-pending like every number this session. */
export const NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD = 60;

// ── KINDLED WARD (2026-07-18, docs/classes-goal.md Paladin/Kindred verb —
// class-overhaul-workboard.md chunks 2.2/2.3) ───────────────────────────────
// Paladin's frontal directional block. Reuses the EXISTING held-shield
// plumbing every class already has (input bit, `tickShield`'s shieldActive/
// shieldCharge drain-while-held/regen-while-idle economy) — "existing
// shield/parry tech" per classes-goal.md's own Paladin section — but
// REPLACES step 2's mitigation math entirely for classId==='paladin' (see
// the branch inside tryDeflectDamage below): no other chassis's behavior
// changes by one bit, and Paladin's OWN behavior is unchanged for any tick
// they never hold Shield (shieldActive stays false exactly as tickShield
// already computes it — this file doesn't touch tickShield at all).
//
// What's actually NEW here (not just "existing tech, paladin-flavored"):
//   - Mitigation is PARTIAL (WARD_MITIGATION_FRACTION), never the generic
//     shield's 100% block — Ward is a real trade (health for Kindling),
//     not a free wall. This is the load-bearing difference from both the
//     generic omnidirectional shield AND the timed parry (which fully
//     negates a covered hit).
//   - The frontal-cone check is MANDATORY for Paladin (no `directionalShield`
//     opt-in flag the way Priest's innate ability works) — "directional
//     block, frontal only" is chassis-sacred per classes-goal.md's non-
//     obsolescence table, not a build choice.
//   - A landed, in-cone hit grants Kindling (KINDLING_PER_DAMAGE_BLOCKED)
//     proportional to the damage actually absorbed — the generic shield
//     grants nothing on block.
//   - Works for null-projectile hits too (melee arc, dash-bash lance) via
//     the new `attackerPos` option below — the existing `directionalShield`
//     sub-branch this is adjacent to explicitly skips direction-checking
//     when `projectile === null` (see step 2's un-touched code path further
//     down), so without this addition Ward could never judge a melee hit's
//     direction. Purely additive: existing callers that don't pass
//     `attackerPos` just can't have a Ward hit resolve (fails closed, see
//     below) — no change to any existing behavior.
/** Half the frontal cone Ward covers, doubled: matches the existing aim-
 *  shield's SHIELD_AIM_ARC_RADIANS (120°) exactly — "a shield-board is a
 *  wall" reasoning carries over unchanged from Priest's innate directional
 *  shield (weapon.ts's `applyCharacterInnateAbility`). Kept as its own
 *  named constant (not a bare re-export) so a future balance pass can
 *  retune Ward without touching Priest's unrelated cone. First-draft. */
export const WARD_ARC_RADIANS = SHIELD_AIM_ARC_RADIANS;
/** Fraction of incoming damage Ward absorbs on a covered hit. 60% first-
 *  draft: meaningfully tankier than taking a hit raw (roughly doubles
 *  Paladin's effective HP against covered hits — 125hp / (1-0.6) ≈ 312
 *  effective, docs/classes-goal.md Paladin base HP), without reaching the
 *  generic shield's 100% (which would make Ward indistinguishable from
 *  "just hold the other shield button", the exact chassis-non-obsolescence
 *  failure classes-goal.md's table warns against). Tank identity is
 *  delivered via this mitigation fraction, NOT via Kindled Edge's damage
 *  output (see EDGE_DAMAGE's doc comment in World.ts) — "higher effective
 *  toughness via mitigation, not raw damage output" per task doctrine.
 *  First-draft/playtest-pending, like every number in this pass. */
export const WARD_MITIGATION_FRACTION = 0.6;
/** Kindling granted per point of damage Ward actually blocks (i.e. the
 *  absorbed fraction, not the raw incoming damage — the portion that gets
 *  through deals real damage but grants nothing extra). 1:1 first-draft: a
 *  fully-covered ninja SLASH_DAMAGE (22, World.ts) hit blocks 13.2 damage →
 *  13.2 Kindling; ~8 such blocks (KINDLING_MAX/13.2 ≈ 7.6) fill the bar,
 *  landing in the same cadence neighbourhood as ninja's own energy loop
 *  (NINJA_ENERGY_MAX/NINJA_ENERGY_ON_MELEE_HIT = 100/10 = 10 landed hits) —
 *  both classes' resources fill over roughly a real engagement's worth of
 *  sustained contact, not one lucky trade. First-draft/playtest-pending. */
export const KINDLING_PER_DAMAGE_BLOCKED = 1.0;
/** Kindling resource cap. Matches NINJA_ENERGY_MAX's precedent exactly —
 *  same 0..100 scale convention for every class resource on this additive-
 *  field substrate (class-overhaul-workboard.md chunk 1.2's generalization
 *  is explicitly deferred — see PlayerEntity.kindling's doc comment in
 *  types.ts for the reasoning). */
export const KINDLING_MAX = 100;

// ── TEAM PEEL (2026-07-18, class-overhaul-workboard.md chunk 2.4) ──────────
// `isSourceInWardCone` above answers "is the damage SOURCE within the
// ward-holder's own cone" (self-ward). Team peel asks a DIFFERENT
// geometric question: "is a nearby ALLY's BODY within the ward-holder's
// cone" — a Paladin standing between an ally and an attacker extends
// Ward's mitigation to that ally too (docs/classes-goal.md Paladin
// signature: "peel — block for teammates in ward shadow / presence aura").
//
// Geometry (the task brief's own "clean, testable" fallback, explicitly
// preferred over a literal raycast/line-of-sight simulation): a warder
// W peels for a victim V when V's BODY sits within W's frontal cone
// (WARD_ARC_RADIANS, anchored on W's aim — identical arc math to self-
// ward, just testing an ally's position instead of the attack source)
// AND V is within WARD_PEEL_RADIUS_PX of W ("standing next to them").
// This is a pure two-body geometry test with no notion of team
// membership — `World.ts`'s `findTeamPeelWarder` is the one place that
// combines it with `isAlly` (team.ts) to pick an eligible WARDING ALLY;
// this function stays as reusable/testable as `isSourceInWardCone`.
/** "Standing next to them" radius for team peel — a Paladin's Ward covers
 *  an ally within this distance, in cone. Bigger than EDGE_RANGE (84px,
 *  World.ts) — peel is a positioning/formation read ("stand with me"),
 *  not a melee-reach number — but still tight enough that "peel" reads as
 *  deliberate close-formation play, not a map-wide aura. First-draft/
 *  playtest-pending, like every number this session. */
export const WARD_PEEL_RADIUS_PX = 160;

// ── SYZYGIST WARD (2026-07-18, docs/classes-goal.md Priest/Syzygist verb —
// class-overhaul-workboard.md chunk 3.3: "Wards defense verb: small absorb
// barriers, castable on allies"). DIFFERENT SHAPE from Kindled Ward above:
//   - A flat ABSORB POOL, not a mitigation FRACTION — Kindled Ward always
//     lets a fixed % of every covered hit through; Syzygist Ward blocks
//     hits FULLY (up to the pool) until the pool itself runs out, then lets
//     everything through. "Small absorb barriers" reads as a bucket, not a
//     percentage.
//   - NO frontal-cone / facing requirement — Kindled Ward is chassis-sacred
//     "directional block, frontal only, no opt-out" (classes-goal.md's
//     non-obsolescence table); Syzygist Ward is explicitly "cast-and-forget
//     ... no aim/facing required after cast" (the low-aim design
//     direction). This mitigation step never reads `player.aimX/aimY` or
//     any attacker position at all.
//   - Opened by a CAST (applyWardToAlly, World.ts — the same isAlly-gated
//     cross-player-write shape as applyRegenToAlly/applyHasteToAlly), not a
//     held input — `wardAbsorbUntilTick`/`wardAbsorbRemaining` are windowed
//     resource state, not an input-driven boolean like `shieldActive`.
/**
 * Syzygist Ward mitigation — a flat absorb pool, no facing check. Called
 * from `tryDeflectDamage` BEFORE the generic shield step (priest chassis
 * never rides `shieldActive`, so this never competes with it in practice,
 * but the ordering keeps every classId-specific defense verb resolved
 * before the class-agnostic fallback, matching Kindled Ward's own position
 * in the chain). Returns `null` when there's no live pool to consume (fails
 * through to the next mitigation step, same "player unchanged" contract as
 * every other step here).
 */
function trySyzygistWard(
  player: PlayerEntity,
  damage: number,
  tick: Tick,
): { player: PlayerEntity; damage: number; blocked: number; broke: boolean } | null {
  if (classIdForArchetype(player.characterId) !== "priest") return null;
  if (player.wardAbsorbUntilTick === undefined || player.wardAbsorbUntilTick <= tick) {
    return null;
  }
  const remaining = player.wardAbsorbRemaining ?? 0;
  if (remaining <= 0) return null;
  const blocked = Math.min(damage, remaining);
  const newRemaining = remaining - blocked;
  const broke = newRemaining <= 0;
  return {
    player: broke
      ? {
          ...player,
          wardAbsorbUntilTick: undefined,
          wardAbsorbRemaining: undefined,
          wardAbsorbSourceId: undefined,
        }
      : { ...player, wardAbsorbRemaining: newRemaining },
    damage: damage - blocked,
    blocked,
    broke,
  };
}

/**
 * True iff `victim`'s position sits within `warder`'s frontal Ward cone
 * (WARD_ARC_RADIANS, anchored on `warder`'s own aim) AND within
 * `radiusPx` of `warder`. Pure two-body geometry, no team/Ward-active
 * checks — callers (World.ts's `findTeamPeelWarder`) are responsible for
 * confirming the warder is actually holding Ward and is an ally of the
 * victim before treating this as "peel applies." `radiusPx` defaults to
 * `WARD_PEEL_RADIUS_PX`; Aegis Share (Kindred catalog v1) widens it for a
 * warder with that window live.
 */
export function isAllyBodyInWardCone(
  warder: Pick<PlayerEntity, "x" | "y" | "aimX" | "aimY">,
  victim: Pick<PlayerEntity, "x" | "y">,
  radiusPx: number = WARD_PEEL_RADIUS_PX,
): boolean {
  const dxAim = warder.aimX - warder.x;
  const dyAim = warder.aimY - warder.y;
  const facing = dxAim === 0 && dyAim === 0 ? 0 : lutAtan2(dyAim, dxAim);
  const dx = victim.x - warder.x;
  const dy = victim.y - warder.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radiusPx || dist < 1e-3) return false;
  const angleToVictim = lutAtan2(dy, dx);
  const delta = wrapAngle(angleToVictim - facing);
  return Math.abs(delta) <= WARD_ARC_RADIANS / 2;
}

/**
 * Mitigation math for a peeled hit — the SAME fraction/rate as self-ward
 * (WARD_MITIGATION_FRACTION, KINDLING_PER_DAMAGE_BLOCKED): peel is not a
 * separate, weaker shield-adjacent mechanic, it's Ward extended to cover a
 * second body. Kindling from a peeled hit is granted to the WARDER (their
 * block, their resource), never the victim — mirrors self-ward's "your
 * block, your Kindling" rule exactly (see World.ts's `findTeamPeelWarder`
 * call site for where the warder's entity is actually updated).
 */
export function computeTeamPeelMitigation(damage: number): {
  mitigatedDamage: number;
  damageBlocked: number;
  kindlingGranted: number;
} {
  const blocked = damage * WARD_MITIGATION_FRACTION;
  return {
    mitigatedDamage: damage - blocked,
    damageBlocked: blocked,
    kindlingGranted: blocked * KINDLING_PER_DAMAGE_BLOCKED,
  };
}

// Bit constants — duplicated from net/protocol.ts to keep sim/ self-contained
// (sim must not depend on net/). InputBitfield layout is locked in types.ts.
const Bit = {
  Ability: 1 << 7,
  Shield: 1 << 8,
} as const;

// ----- Parry -----------------------------------------------------------------

export type TryStartParryOptions = {
  /** Override the default cooldown (e.g. card-driven). Defaults to PARRY_COOLDOWN_MS_DEFAULT. */
  cooldownMs?: number;
  /** Override the active window. Defaults to PARRY_ACTIVE_MS. */
  activeMs?: number;
  /** Tick length in ms; needed to convert ms → ticks. */
  dtMs: number;
};

export type TryStartParryResult = {
  player: PlayerEntity;
  started: boolean;
};

/**
 * Rising-edge trigger on InputBit.Ability. If the player is alive and the
 * cooldown has expired, sets `parryActiveUntilTick` and `parryCooldownUntilTick`
 * and snapshots the aim angle into `parryFacing`. Otherwise returns the player
 * unchanged.
 */
export function tryStartParry(
  player: PlayerEntity,
  currKeys: InputBitfield,
  prevKeys: InputBitfield,
  tick: Tick,
  options: TryStartParryOptions,
): TryStartParryResult {
  if (!player.alive) {
    return { player, started: false };
  }
  const pressed = (currKeys & Bit.Ability) !== 0;
  const wasPressed = (prevKeys & Bit.Ability) !== 0;
  if (!pressed || wasPressed) {
    return { player, started: false };
  }
  const cooldownUntil = player.parryCooldownUntilTick ?? 0;
  if (cooldownUntil > tick) {
    return { player, started: false };
  }
  const activeMs = options.activeMs ?? PARRY_ACTIVE_MS;
  const cooldownMs = options.cooldownMs ?? PARRY_COOLDOWN_MS_DEFAULT;
  const dt = options.dtMs > 0 ? options.dtMs : 1;
  const activeTicks = Math.max(1, Math.ceil(activeMs / dt));
  const cooldownTicks = Math.max(1, Math.ceil(cooldownMs / dt));

  // Capture the aim direction (radians) at trigger time so a moving aim
  // doesn't change which side is covered mid-parry.
  const dx = player.aimX - player.x;
  const dy = player.aimY - player.y;
  const facing = dx === 0 && dy === 0 ? 0 : lutAtan2(dy, dx);

  return {
    player: {
      ...player,
      parryActiveUntilTick: Tick(tick + activeTicks),
      parryCooldownUntilTick: Tick(tick + cooldownTicks),
      parryFacing: facing,
    },
    started: true,
  };
}

/** True if the player has an active parry window covering this tick. */
export function isParryActive(player: PlayerEntity, tick: Tick): boolean {
  return (
    player.parryActiveUntilTick !== undefined &&
    player.parryActiveUntilTick > tick
  );
}

// ----- Shield ----------------------------------------------------------------

export type TickShieldOptions = {
  dtMs: number;
  /** Override max charge (e.g. shielded archetype). Defaults to SHIELD_MAX_CHARGE_DEFAULT. */
  maxCharge?: number;
  /** Override drain per second. Defaults to SHIELD_DRAIN_PER_SECOND. */
  drainPerSecond?: number;
  /** Override recharge per second. Defaults to SHIELD_RECHARGE_PER_SECOND. */
  rechargePerSecond?: number;
};

/**
 * Held-shield update. Mirrors MatchScene.updateShield: while the shield key is
 * held and charge remains, set shieldActive=true and drain charge; otherwise
 * deactivate and recharge.
 */
export function tickShield(
  player: PlayerEntity,
  currKeys: InputBitfield,
  options: TickShieldOptions,
): PlayerEntity {
  if (!player.alive) {
    return player.shieldActive
      ? { ...player, shieldActive: false }
      : player;
  }
  const dtSec = options.dtMs / 1000;
  const maxCharge = options.maxCharge ?? player.shieldMaxCharge ?? SHIELD_MAX_CHARGE_DEFAULT;
  const drainRate = options.drainPerSecond ?? SHIELD_DRAIN_PER_SECOND;
  const rechargeRate = options.rechargePerSecond ?? SHIELD_RECHARGE_PER_SECOND;

  // Default to a full bar when the field is missing entirely. New players
  // start with a full shield available.
  const currentCharge = player.shieldCharge ?? maxCharge;

  const wantsShield = (currKeys & Bit.Shield) !== 0;
  if (wantsShield && currentCharge > 0) {
    const drained = Math.max(0, currentCharge - drainRate * dtSec);
    return {
      ...player,
      shieldActive: drained > 0,
      shieldCharge: drained,
      shieldMaxCharge: maxCharge,
    };
  }

  // Not shielding (or out of charge): deactivate and recharge toward max.
  const recharged = Math.min(maxCharge, currentCharge + rechargeRate * dtSec);
  return {
    ...player,
    shieldActive: false,
    shieldCharge: recharged,
    shieldMaxCharge: maxCharge,
  };
}

// ----- Damage mitigation -----------------------------------------------------

export type DeflectResult = {
  /** Updated player (e.g. shield charge drained). */
  player: PlayerEntity;
  /** Final damage to apply (may be 0 if mitigated). */
  damage: number;
  /** True if the parry deflected the projectile (caller should destroy/bounce it). */
  deflected: boolean;
  /** True if the shield absorbed (some of) the damage. */
  shielded: boolean;
  /** True if the shield charge ran out as a result of this hit. */
  shieldPopped: boolean;
  /** True if a MIRROR shield absorbed the hit AND should bounce the shard back
   *  at the attacker (caller reflects it, like a parry). */
  shieldReflected: boolean;
  /**
   * True if a ninja's dash i-frames evaded the hit entirely (docs/
   * classes-goal.md: "ninja = evasion — dash i-frames — never blocks, only
   * isn't there"). Zero damage, distinct from `deflected` (parry/dash-bash
   * self-parry): evasion is NOT a counter — the caller must NOT reflect the
   * projectile or play the parry-deflect CLANG, just suppress the hit.
   * 2026-07-18, ninja melee verb.
   */
  evaded: boolean;
  /**
   * True when Kindled Ward (Paladin only, 2026-07-18) partially mitigated
   * this hit. Distinct from `shielded` (which always means damage went
   * fully to 0) — a warded hit still carries nonzero `damage`; the caller
   * applies it exactly like an unmitigated hit (health, hit-confirmed,
   * kill-check all run normally), it's just smaller. `player` already
   * carries the granted Kindling; `wardDamageBlocked`/`wardKindlingGranted`
   * are exposed separately so a caller can emit a `ward-absorbed` event
   * without recomputing the math.
   */
  warded: boolean;
  /** Raw damage Ward absorbed this hit (0 when `warded` is false). */
  wardDamageBlocked: number;
  /** Kindling granted for this hit (0 when `warded` is false). */
  wardKindlingGranted: number;
  /**
   * True when Syzygist Ward (Priest only, 2026-07-18 — a flat absorb POOL,
   * distinct from Kindled Ward's mitigation FRACTION above) blocked some or
   * all of this hit. Deliberately OPTIONAL/absent-means-false, unlike every
   * other field on this type (which every return site sets explicitly) —
   * only `trySyzygistWard`'s own call site sets these three; every
   * pre-existing return in `tryDeflectDamage` (parry/evasion/dash-slide/
   * Kindled-Ward/generic-shield/pass-through) is intentionally left
   * untouched rather than retrofitted with three more always-false fields,
   * to minimize touch surface on this heavily-tested mitigation chain. Read
   * as falsy (`?? false` / `?? 0`) at every call site, same as any other
   * optional PlayerEntity-style field in this codebase.
   */
  syzWarded?: boolean;
  /** Raw damage Syzygist Ward absorbed this hit (absent/0 when `syzWarded`
   *  is falsy). */
  syzWardDamageBlocked?: number;
  /** True when this hit exhausted the Ward pool (fields cleared this hit). */
  syzWardBroke?: boolean;
};

export type DeflectOptions = {
  /** Blocked shield hits reflect the projectile back at the attacker. */
  mirrorShield?: boolean;
  /** Aim shield: the shield only blocks hits within the AIM arc. */
  directionalShield?: boolean;
  /** Widens the PARRY arc (Wide Parry card). 1 = default 60°. */
  parryCoverMultiplier?: number;
  /** Void Fracture: the shot punches through a passively HELD shield
   *  untouched (no absorb, no charge drain) — the counter-pick to the
   *  turtle meta. Does NOT bypass the timed parry or the dash-bash slide's
   *  active block/reflect — those are a skilled READ, not passive
   *  attrition, and stay a hard counter to void same as anything else. */
  voidPiercing?: boolean;
  /**
   * Attacker/source world position for null-projectile hits (melee arc,
   * dash-bash lance) — Kindled Ward's frontal-cone check needs SOME source
   * position to judge "did this arrive from the front", and unlike a
   * projectile there's no `.x`/`.y` to read off `projectile` when it's
   * null. Purely additive/opt-in: every existing call site that doesn't
   * pass this gets exactly today's behavior (Ward simply can't verify
   * direction for that hit and fails closed — no mitigation, see the Ward
   * branch below). Parry / dash-bash-power-slide above are UNCHANGED —
   * they still require `projectile !== null` exactly as before, so this
   * option touches nothing except the new Ward branch.
   */
  attackerPos?: { x: number; y: number };
};

/**
 * Mitigation chain — call BEFORE subtracting health on a hit-confirmed event.
 *
 * Order:
 *   1. Active parry covering the projectile's incoming direction → deflect.
 *      Zero damage, returns `deflected: true`. Caller should destroy or bounce
 *      the projectile and emit a `parry-deflected` event.
 *   2. Active shield with positive charge → absorb the hit. Charge drains by
 *      `damage * SHIELD_HIT_DRAIN_MULTIPLIER`. Damage clamped to 0. If the
 *      drain takes the charge to 0, `shieldPopped` is true.
 *   3. Otherwise the damage passes through unchanged.
 */
export function tryDeflectDamage(
  player: PlayerEntity,
  projectile: Pick<ProjectileEntity, "id" | "x" | "y" | "vx" | "vy" | "damage"> | null,
  damage: number,
  tick: Tick,
  options: DeflectOptions = {},
): DeflectResult {
  if (damage <= 0 || !player.alive) {
    return {
      player,
      damage,
      deflected: false,
      shielded: false,
      shieldPopped: false,
      shieldReflected: false,
      evaded: false,
      warded: false,
      wardDamageBlocked: 0,
      wardKindlingGranted: 0,
    };
  }

  // 0.5. NINJA EVASION (docs/classes-goal.md defense verb: "ninja =
  //      evasion — dash i-frames — never blocks, only isn't there"). Ahead
  //      of parry/shield: a dodge means the hit never reaches the body, so
  //      it pre-empts every other mitigation path, not just adds to them.
  //      Omnidirectional (unlike parry/dash-bash-self-parry's frontal arc)
  //      — "wasn't there" doesn't have a blind side. Applies to ANY damage
  //      source routed through this function (projectiles here, plus
  //      dash-bash and the ninja's own melee arc in World.ts, both of which
  //      pass `projectile: null`) — a dashing ninja is untouchable by every
  //      damage path that already funnels through tryDeflectDamage. Known
  //      gap: burn DoT / void-plane / chain-lightning / AOE-leech apply
  //      damage directly in World.ts without going through this function,
  //      so i-frames don't cover those (flagged in the ninja-verb report).
  if (player.dashing === true && classIdForArchetype(player.characterId) === "ninja") {
    return {
      player,
      damage: 0,
      deflected: false,
      shielded: false,
      shieldPopped: false,
      shieldReflected: false,
      evaded: true,
      warded: false,
      wardDamageBlocked: 0,
      wardKindlingGranted: 0,
    };
  }

  // 0.6. GHOST GUARD (Interstice catalog v1, defense role, 2026-07-18): a
  //      BANKED charge, distinct from the always-on dash i-frames above —
  //      "one incoming hit becomes a near-miss... if moving; 1 charge"
  //      (class-ability-catalogs-v1.md). Checked AFTER dash i-frames (which
  //      already grant free evasion while `dashing`) so this only ever
  //      fires on a hit dash i-frames did NOT already cover — a genuinely
  //      separate defensive resource, not a redundant check. "If moving":
  //      the player's OWN current velocity magnitude must clear
  //      NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD — a banked charge does
  //      nothing for a truly stationary player, matching the doc's flavor
  //      (this reacts to motion already happening, not a stationary panic
  //      button). Omnidirectional, same as dash i-frames — applies to ANY
  //      damage source routed through this function, with the SAME known
  //      gap that block's own comment discloses (burn DoT / void-plane /
  //      chain-lightning / AOE-leech apply damage directly in World.ts,
  //      bypassing this function entirely).
  if (
    player.ghostGuardChargeUntilTick !== undefined &&
    player.ghostGuardChargeUntilTick > tick &&
    classIdForArchetype(player.characterId) === "ninja" &&
    Math.hypot(player.vx, player.vy) > NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD
  ) {
    return {
      player: { ...player, ghostGuardChargeUntilTick: undefined },
      damage: 0,
      deflected: false,
      shielded: false,
      shieldPopped: false,
      shieldReflected: false,
      evaded: true,
      warded: false,
      wardDamageBlocked: 0,
      wardKindlingGranted: 0,
    };
  }

  // 1. Parry — only if the source direction is within ±arc/2 of the captured
  //    facing. We approximate the source direction from the projectile's
  //    velocity vector (it's flying *into* the player), or from its position
  //    relative to the player when velocity is unavailable.
  if (isParryActive(player, tick) && projectile !== null) {
    const facing = player.parryFacing ?? 0;
    const parryArc = PARRY_ARC_RADIANS * (options.parryCoverMultiplier ?? 1);
    if (isHitInParryArc(player, facing, projectile, parryArc)) {
      return {
        player,
        damage: 0,
        deflected: true,
        shielded: false,
        shieldPopped: false,
        shieldReflected: false,
        evaded: false,
        warded: false,
        wardDamageBlocked: 0,
        wardKindlingGranted: 0,
      };
    }
  }

  // 1.5. DASH-BASH POWER-SLIDE (the right-click move) — a directional launch that
  //      PARRIES on the way in: a shot arriving within the frontal arc of the
  //      slide is DEFLECTED (0 damage AND the shard is reflected back at the
  //      attacker, exactly like the timed parry) — the parry, kept, but bolted
  //      onto the launch. At no shield-charge cost (the dash's own 520ms
  //      cooldown + air-charge gating bound it). Directional, NOT full invuln —
  //      a hit from the flank/back still lands. Guard direction is the slide's
  //      travel velocity (friction+gravity are suspended during the burst, so
  //      velocity == the aim-directional launch vector). Reuses the shield's
  //      120° frontal cone, widened by Wide Parry (parryCoverMultiplier) —
  //      Wide Parry lost its original target (the timed parry is now
  //      human-unreachable, subsumed by this slide) so it was repurposed
  //      onto the slide's arc instead of left dead. Clamped so a maxed-out
  //      stack can never reach a full 360° block.
  if (player.dashing === true && projectile !== null) {
    const facing =
      player.vx === 0 && player.vy === 0 ? 0 : lutAtan2(player.vy, player.vx);
    const slideArc = Math.min(
      2 * Math.PI - 0.01,
      SHIELD_AIM_ARC_RADIANS * (options.parryCoverMultiplier ?? 1),
    );
    if (isHitInParryArc(player, facing, projectile, slideArc)) {
      return {
        player,
        damage: 0,
        deflected: true, // parry-style: World.ts reflects the shard at the attacker
        shielded: false,
        shieldPopped: false,
        shieldReflected: false,
        evaded: false,
        warded: false,
        wardDamageBlocked: 0,
        wardKindlingGranted: 0,
      };
    }
  }

  // 1.7. SYZYGIST WARD — a flat absorb pool, checked ahead of the generic
  //      shield step so a priest's cast-and-forget barrier resolves before
  //      the class-agnostic fallback (mirrors where Kindled Ward sits in
  //      this same chain, just gated on classId/fields instead of
  //      shieldActive). No facing/aim check — see trySyzygistWard's own doc
  //      comment. Void Fracture does NOT punch through this (unlike the
  //      generic shield/Kindled Ward below) — Void Fracture's doc scope is
  //      explicitly "the counter-pick to the turtle meta" (a HELD, passive
  //      shield); Syzygist Ward is a spent CAST, not passive attrition, so
  //      it stays a hard block same as the timed parry/dash-bash slide
  //      above (both already explicitly exempted from voidPiercing).
  const syzWard = trySyzygistWard(player, damage, tick);
  if (syzWard !== null) {
    return {
      player: syzWard.player,
      damage: syzWard.damage,
      deflected: false,
      shielded: false,
      shieldPopped: false,
      shieldReflected: false,
      evaded: false,
      warded: false,
      wardDamageBlocked: 0,
      wardKindlingGranted: 0,
      syzWarded: true,
      syzWardDamageBlocked: syzWard.blocked,
      syzWardBroke: syzWard.broke,
    };
  }

  // 2. Shield / Kindled Ward — drain charge by damage * multiplier and zero
  //    the damage (generic shield), OR partially mitigate + grant Kindling
  //    (Paladin's Ward — see the WARD_* constants' doc comments above).
  //    Void Fracture punches straight through this step for EITHER: pass-
  //    through damage, shield/ward left completely untouched (not even
  //    drained) — the counter-pick applies uniformly, same as it always has.
  if (player.shieldActive && options.voidPiercing) {
    return {
      player,
      damage,
      deflected: false,
      shielded: false,
      shieldPopped: false,
      shieldReflected: false,
      evaded: false,
      warded: false,
      wardDamageBlocked: 0,
      wardKindlingGranted: 0,
    };
  }
  if (player.shieldActive) {
    // Kindled Ward (Paladin only) — REPLACES the generic shield's mitigation
    // math entirely for this classId; the generic branch below is never
    // reached for a paladin. Every other chassis falls straight through to
    // the untouched generic code (byte-identical — this is the only new
    // branch point in the whole function).
    if (classIdForArchetype(player.characterId) === "paladin") {
      const dxAim = player.aimX - player.x;
      const dyAim = player.aimY - player.y;
      const facing = dxAim === 0 && dyAim === 0 ? 0 : lutAtan2(dyAim, dxAim);
      const inCone = isSourceInWardCone(player, facing, projectile, options.attackerPos);
      if (!inCone) {
        // Outside the frontal cone (or direction unknown — fails closed):
        // Ward never applies from the flank/back. Full damage, no Kindling,
        // shield/ward charge untouched — an unwarded hit costs nothing to
        // the bar either way.
        return {
          player,
          damage,
          deflected: false,
          shielded: false,
          shieldPopped: false,
          shieldReflected: false,
          evaded: false,
          warded: false,
          wardDamageBlocked: 0,
          wardKindlingGranted: 0,
        };
      }
      const blocked = damage * WARD_MITIGATION_FRACTION;
      const mitigatedDamage = damage - blocked;
      const kindlingGranted = blocked * KINDLING_PER_DAMAGE_BLOCKED;
      const kindling = Math.min(
        KINDLING_MAX,
        (player.kindling ?? 0) + kindlingGranted,
      );
      let wardedPlayer: PlayerEntity = { ...player, kindling };
      // (Retribution Edge's self-block → "ready" window used to be applied
      // here — class-overhaul-workboard.md chunk 2.6 fast-follow. Removed
      // 2026-07-19 along with the ability itself; see docs/class-ability-
      // catalogs-v1.md's cut note. Retort — docs/card-pool-v2.md #27, a
      // shield-board spec that used to bank a fraction of `blocked` right
      // here — was cut the same day alongside its sibling exclusives
      // Crater/Bastion; see cards.ts's cut note above their old
      // definitions.)
      // No extra shieldCharge drain beyond tickShield's own passive per-
      // second cost of holding Ward — the partial damage getting through IS
      // the per-hit cost (unlike the generic shield's 100%-block-but-
      // charge-drains-per-hit economy). See the WARD_* doc comments above.
      return {
        player: wardedPlayer,
        damage: mitigatedDamage,
        deflected: false,
        shielded: false,
        shieldPopped: false,
        shieldReflected: false,
        evaded: false,
        warded: true,
        wardDamageBlocked: blocked,
        wardKindlingGranted: kindlingGranted,
      };
    }
    // Ninja/Interstice — LOCKED doctrine (docs/character-sheets-v1.md's
    // DI-Tempest/WoW-Rogue table, Defense row: "Dash i-frames only — never
    // block"; docs/classes-goal.md: "dash i-frames — never blocks, only
    // isn't there"). Shield is chassis-null for this class: held Shift
    // still drains/recharges the charge economy via tickShield (untouched,
    // class-agnostic — see that function's own doc comment), but it must
    // never mitigate a single point of damage. Deliberately the simplest
    // possible branch — no partial-mitigation math, no resource grant, just
    // fall straight through to full, unmitigated damage, byte-identical to
    // what a player with shieldActive===false would take. Every other
    // chassis (wizard/priest fallback to generic shield below, paladin to
    // its own branch above) is completely unaffected by this addition.
    if (classIdForArchetype(player.characterId) === "ninja") {
      return {
        player,
        damage,
        deflected: false,
        shielded: false,
        shieldPopped: false,
        shieldReflected: false,
        evaded: false,
        warded: false,
        wardDamageBlocked: 0,
        wardKindlingGranted: 0,
      };
    }
    const currentCharge = player.shieldCharge ?? 0;
    if (currentCharge > 0) {
      // Aim shield: only blocks hits arriving within the AIM arc. A shot from
      // the flank/back gets through, so the player must face the threat.
      if (options.directionalShield && projectile !== null) {
        const dx = player.aimX - player.x;
        const dy = player.aimY - player.y;
        const facing = dx === 0 && dy === 0 ? 0 : lutAtan2(dy, dx);
        if (!isHitInParryArc(player, facing, projectile, SHIELD_AIM_ARC_RADIANS)) {
          return {
            player,
            damage,
            deflected: false,
            shielded: false,
            shieldPopped: false,
            shieldReflected: false,
            evaded: false,
            warded: false,
            wardDamageBlocked: 0,
            wardKindlingGranted: 0,
          };
        }
      }
      const drained = Math.max(0, currentCharge - damage * SHIELD_HIT_DRAIN_MULTIPLIER);
      const popped = drained <= 0;
      return {
        player: {
          ...player,
          shieldCharge: drained,
          shieldActive: !popped,
        },
        damage: 0,
        deflected: false,
        shielded: true,
        shieldPopped: popped,
        evaded: false,
        // Mirror shield bounces the shard back at the attacker.
        shieldReflected: options.mirrorShield === true,
        warded: false,
        wardDamageBlocked: 0,
        wardKindlingGranted: 0,
      };
    }
  }

  // 3. Pass-through.
  return {
    player,
    damage,
    deflected: false,
    shielded: false,
    shieldPopped: false,
    shieldReflected: false,
    evaded: false,
    warded: false,
    wardDamageBlocked: 0,
    wardKindlingGranted: 0,
  };
}

/**
 * Kindled Ward's frontal-cone test. `projectile` (when non-null) supplies
 * source position exactly like `isHitInParryArc`; `attackerPos` is the
 * fallback for melee/bash hits that pass `projectile: null`
 * (DeflectOptions.attackerPos's doc comment explains why). Returns false
 * (fails closed — no free mitigation) when NEITHER is available, which
 * cannot currently happen for any wired-up call site but keeps the
 * function total rather than throwing on a hypothetical future caller
 * that forgets to pass either.
 */
function isSourceInWardCone(
  player: Pick<PlayerEntity, "x" | "y">,
  facing: number,
  projectile: Pick<ProjectileEntity, "x" | "y" | "vx" | "vy"> | null,
  attackerPos: { x: number; y: number } | undefined,
): boolean {
  // Source position: the projectile's own x/y when present, else the
  // caller-supplied attacker position for null-projectile (melee/bash)
  // hits. Same "degenerate → fail closed" contract either way.
  const source = projectile ?? attackerPos;
  if (!source) return false;
  const dx = source.x - player.x;
  const dy = source.y - player.y;
  if (dx === 0 && dy === 0) return false; // degenerate — fail closed
  const sourceAngle = lutAtan2(dy, dx);
  const delta = wrapAngle(sourceAngle - facing);
  return Math.abs(delta) <= WARD_ARC_RADIANS / 2;
}

/**
 * Test whether the incoming projectile sits within the parry arc anchored on
 * `parryFacing`. The "source direction" is the vector from the player back
 * toward the shard (i.e. the shard is *that way*), so we compare it against
 * the captured facing.
 */
export function isHitInParryArc(
  player: PlayerEntity,
  facing: number,
  projectile: Pick<ProjectileEntity, "x" | "y" | "vx" | "vy">,
  arcRadians: number = PARRY_ARC_RADIANS,
): boolean {
  // Direction to the projectile from the player. If the shard is in the same
  // half-plane as the parry facing, it's a candidate for deflection.
  const dx = projectile.x - player.x;
  const dy = projectile.y - player.y;
  const sourceAngle = dx === 0 && dy === 0
    ? // Degenerate — use opposite of velocity if available.
      lutAtan2(-projectile.vy, -projectile.vx)
    : lutAtan2(dy, dx);
  const delta = wrapAngle(sourceAngle - facing);
  return Math.abs(delta) <= arcRadians / 2;
}

function wrapAngle(angle: number): number {
  const TWO_PI = Math.PI * 2;
  let a = angle;
  while (a < -Math.PI) a += TWO_PI;
  while (a >= Math.PI) a -= TWO_PI;
  return a;
}

// Re-export the entity id type for callers that build SimEvents around the
// helpers in this file without importing types directly.
export type { EntityId };
