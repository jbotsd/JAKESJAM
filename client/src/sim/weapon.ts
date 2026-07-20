// Weapon firing — fire-rate gating, recoil, projectile spawn. Resolves the
// player's card hand into a ResolvedWeaponBuild and uses build stats (damage,
// rate, speed, lifetime, spread, recoil, multi-shot count, projectile shape /
// pathing / element) instead of hardcoded constants. Pure: depends only on
// the player snapshot, the input bit, the aim, and dt.

import { crystalRoundsCards } from "./data/cards.js";
import {
  NEUTRAL_CHAOS_PROFILE,
  projectileShapes,
  type ChaosProfile,
} from "./data/chaosModifiers.js";
import type {
  CardDefinition,
  ResolvedWeaponBuild,
} from "./data/cardTypes.js";
import { classIdForArchetype } from "./data/cardTypes.js";
import { baseWeaponForClass } from "./data/weapons.js";
import { createWeaponBuild, findCardsById } from "./data/weaponBuild.js";
import { spawnProjectile, type ProjectileSpawnParams } from "./projectile.js";
import {
  STOLEN_FANGS_HOMING_STRENGTH,
  STOLEN_FANGS_DAMAGE_MULTIPLIER,
  ABILITY_TITHE_LEECH_FRACTION,
  GEO_SUNLANCE_DAMAGE_MULTIPLIER,
  GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER,
  GEO_OVERCLOCK_SPREAD_MULTIPLIER,
  GEO_MEASURE_SPREAD_MULTIPLIER,
  GEO_MEASURE_DAMAGE_MULTIPLIER,
  GEO_RECOIL_STEP_RECOIL_MULTIPLIER,
  GEO_CHANNEL_RAMP_MS,
  GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX,
} from "./constants.js";
import { nextInt } from "./rng.js";
import { lutAtan2, lutCos, lutSin } from "./trig.js";
import type { EntityId, PlayerEntity, PlayerId, ProjectileEntity, Vec2 } from "./types.js";

/** Default fire cadence floor when fireRate is zero or missing. */
const MIN_FIRE_RATE = 0.35;

/**
 * Cached resolved build per player. Avoids re-resolving the card hand every
 * tick. Keyed by `${weaponId}|${cardsKey}` so the cache invalidates whenever
 * the weapon or hand changes. The sim caller is single-threaded and the cache
 * lives in module scope for simplicity; this is an internal optimization with
 * no observable effect on output (resolution is deterministic).
 */
const buildCache = new Map<string, ResolvedWeaponBuild>();

function buildKey(player: PlayerEntity): string {
  return `${player.characterId}|${player.weaponId}|${player.cards.join(",")}`;
}

/**
 * The Shielded character's innate ability: the aim-directional dash + shield
 * (dashCharges + directionalShield, both otherwise only granted by the Dash
 * Bash card) is available from the start of the match — vanilla, no card
 * required. Applied after card resolution so a Shielded player who ALSO
 * picks up Dash Bash just stacks extra charges rather than double-counting
 * the base grant (Math.max, not addition).
 */
function applyCharacterInnateAbility(
  player: PlayerEntity,
  build: ResolvedWeaponBuild,
): ResolvedWeaponBuild {
  if (player.characterId !== "shielded") return build;
  return {
    ...build,
    dashCharges: Math.max(build.dashCharges, 1),
    directionalShield: true,
  };
}

/** Identity fast path: keyed on the `cards` ARRAY REFERENCE, which is stable
 *  between drafts (per-tick entity spreads copy the reference, not the
 *  array; a draft pick allocates a new array = correct invalidation), then
 *  by characterId → weaponId so distinct archetypes sharing an array can't
 *  collide. Fully allocation-free on the hit path — resolvePlayerBuild is
 *  called several times per player per tick and buildKey's `cards.join`
 *  string was pure churn. Snapshot decodes allocate fresh arrays (~20Hz),
 *  which miss here and fall through to the string-keyed cache below. */
const buildIdentityCache = new WeakMap<
  readonly string[],
  Map<string, Map<string, ResolvedWeaponBuild>>
>();

function identityCacheGet(player: PlayerEntity): ResolvedWeaponBuild | undefined {
  return buildIdentityCache.get(player.cards)?.get(player.characterId)?.get(player.weaponId);
}

function identityCacheSet(player: PlayerEntity, build: ResolvedWeaponBuild): void {
  let byChar = buildIdentityCache.get(player.cards);
  if (!byChar) {
    byChar = new Map();
    buildIdentityCache.set(player.cards, byChar);
  }
  let byWeapon = byChar.get(player.characterId);
  if (!byWeapon) {
    byWeapon = new Map();
    byChar.set(player.characterId, byWeapon);
  }
  byWeapon.set(player.weaponId, build);
}

export function resolvePlayerBuild(player: PlayerEntity): ResolvedWeaponBuild {
  const fast = identityCacheGet(player);
  if (fast) return fast;
  const key = buildKey(player);
  const cached = buildCache.get(key);
  if (cached) {
    identityCacheSet(player, cached);
    return cached;
  }
  // For now the only weapon SLOT is starter-pistol (player.weaponId never
  // varies). When more weapons exist this will look up the WeaponDefinition
  // by player.weaponId too.
  const cards: CardDefinition[] = findCardsById(crystalRoundsCards, player.cards);
  // Class-expression resolution (docs/classes-goal.md C3): classIdForArchetype
  // is a pure function of characterId, which the build cache above already
  // partitions on — no cache-key change needed, distinct archetypes already
  // can't collide.
  const classId = classIdForArchetype(player.characterId);
  // baseWeaponForClass (docs/classes-goal.md "Priest / Syzygist" baseline):
  // class-blind for every chassis except Priest, which starts from the
  // detuned priestStarterWeapon instead of starterWeapon.
  const withInnate = applyCharacterInnateAbility(
    player,
    createWeaponBuild(baseWeaponForClass(classId), cards, classId),
  );
  // BASELINE: the dash-bash power-slide (right-click) is a core move for EVERYONE,
  // exactly like the parry it replaced — grant at least one dash charge so
  // every character can slide/parry/bash from match start. Cards + the
  // Shielded innate stack MORE on top (extra air-dashes). Applied here, after
  // createWeaponBuild, so it never touches the Zig createWeaponBuild parity.
  const build: ResolvedWeaponBuild = {
    ...withInnate,
    dashCharges: Math.max(withInnate.dashCharges, 1),
  };
  buildCache.set(key, build);
  identityCacheSet(player, build);
  return build;
}

/**
 * A single hitscan pellet's fire-time trace request — everything
 * `resolveHitscanShot` + `resolveRangedHit` (World.ts) need to resolve a
 * same-tick, no-`ProjectileEntity` hit. Emitted instead of a real
 * `ProjectileEntity` when the resolved build's `delivery === "raycast"`
 * (2026-07-20 — see `docs/`-adjacent weapons.ts's own delivery doc comment).
 * `stepWeaponNative` has no visibility into other players or the collision
 * cache (by design — see this file's own header, "depends only on the
 * player snapshot, the input bit, the aim, and dt"), so it can't resolve the
 * trace itself; World.ts (which already owns every other synchronous hit
 * resolution — melee, dash-bash, the projectile drain) does the actual
 * ray-trace + mitigation right where it already calls `stepWeapon`.
 */
export type HitscanPelletSpec = {
  ownerId: PlayerId;
  originX: number;
  originY: number;
  aimAngle: number;
  rangePx: number;
  damage: number;
  element: ProjectileEntity["element"];
  tendril?: boolean;
  leechFraction?: number;
  /**
   * Same `radius` a traveling projectile from this build would carry
   * (`Math.max(2, 7 * build.projectile.sizeMultiplier)`, computed once below
   * and shared with the projectile branch) — NOT a fast-projectile trick,
   * just the bullet's real caliber. A literal zero-width ray is stricter
   * than a traveling projectile's swept circle (`projectile.ts` inflates its
   * AABB by `proj.radius` on every axis), so without this a shot that
   * would've grazed a target's edge as a projectile silently whiffs as a
   * hitscan trace instead — confirmed via a 2px near-miss on a real
   * regression (`abilitySlots.test.ts`'s Crimson Tithe leech case). Giving
   * the ray the same thickness the build's own sizeMultiplier already
   * implies keeps size-modifier cards (circle-rounds etc.) meaningful for
   * the hitscan weapon too, instead of silently doing nothing.
   */
  radius: number;
};

export type FireResult = {
  player: PlayerEntity;
  projectiles: ProjectileEntity[];
  /** Raycast-delivery pellets this shot fired — see `HitscanPelletSpec`'s own
   *  doc comment. Empty for every non-raycast build (the overwhelming
   *  majority today), so existing callers that never read this field see no
   *  behavior change. */
  hitscanPellets: HitscanPelletSpec[];
  fired: boolean;
  /**
   * Number of orbiting satellites this player's resolved build expects.
   * The World tick uses this on `fired === true` to spawn any missing
   * satellites (first-fire activation). Always >= 0.
   */
  desiredSatelliteCount: number;
  /**
   * Updated rng cursor. Only advanced when `random-shapes` chaos rolled a
   * shape (or another future chaos hook draws). Caller threads back into
   * `WorldState.rngState`.
   */
  rngState: number;
  /**
   * Which hand threw this shot (0 = lead, 1 = back). Alternates each shot.
   * The muzzle is offset to this hand; the World stamps it into the
   * shot-fired event so the rig throws with the SAME hand — the shard leaves
   * the exact hand. `undefined` when nothing fired.
   */
  throwHand?: 0 | 1;
};

export type StepWeaponOptions = {
  chaos?: ChaosProfile;
  /** Initial RNG cursor for any chaos-driven random draws this tick. */
  rngState?: number;
  /** Current sim tick — used for tick-windowed fire buffs (Crimson Tithe's
   *  leech window, six-axes Layer 2). Optional/additive: omitted means "no
   *  tick-windowed buffs apply" (offline/legacy callers). */
  currentTick?: number;
};

/**
 * Try to fire the player's weapon this tick. Returns the new player state
 * (cooldown ticked, recoil applied if fired) and any projectiles to insert
 * into the world.
 *
 * `fireRequested` should be the value of the Fire input bit on this tick.
 * `nextEntityId` is a callback that returns the next free entity id; the world
 * is responsible for keeping its own id counter consistent.
 *
 * Chaos profile (when supplied) scales damage/firerate/recoil multiplicatively
 * over the resolved build, and gates projectile spawn for `slappers-only`.
 * `random-shapes` rerolls each spawned shard's shape from the projectileShapes
 * table using the seeded RNG.
 */
export type StepWeaponFn = (
  player: PlayerEntity,
  fireRequested: boolean,
  aim: Vec2,
  dtMs: number,
  nextEntityId: () => EntityId,
  options?: StepWeaponOptions,
) => FireResult;

let stepWeaponBackend: StepWeaponFn | null = null;

/**
 * Swap the stepWeapon impl. Pass `null` to revert. NOOP today —
 * the seam exists for future wasm-backed routing of the muzzle/
 * recoil/cooldown math through Zig. Mirrors the
 * `setStepProjectileBackend` / `setStepPlayerBackend` pattern.
 */
export function setStepWeaponBackend(fn: StepWeaponFn | null): void {
  stepWeaponBackend = fn;
}

export function stepWeapon(
  player: PlayerEntity,
  fireRequested: boolean,
  aim: Vec2,
  dtMs: number,
  nextEntityId: () => EntityId,
  options: StepWeaponOptions = {},
): FireResult {
  if (stepWeaponBackend !== null) {
    return stepWeaponBackend(player, fireRequested, aim, dtMs, nextEntityId, options);
  }
  return stepWeaponNative(player, fireRequested, aim, dtMs, nextEntityId, options);
}

function stepWeaponNative(
  player: PlayerEntity,
  fireRequested: boolean,
  aim: Vec2,
  dtMs: number,
  nextEntityId: () => EntityId,
  options: StepWeaponOptions = {},
): FireResult {
  const chaos = options.chaos ?? NEUTRAL_CHAOS_PROFILE;
  let rngState = options.rngState ?? 0;
  const next: PlayerEntity = {
    ...player,
    fireCooldownMs: Math.max(0, player.fireCooldownMs - dtMs),
  };

  // Wizard basic-fire ramping channel (constants.ts's GEO_CHANNEL_RAMP_MS
  // doc comment has the full design rationale — RELOCATED from Priest
  // 2026-07-19, Jake: "the wizards hould have ramping fire rate to feel
  // more glass canony"). Tracked BEFORE the early return below so
  // continuing to hold Fire through a normal cooldown gap (the common case
  // — most ticks land mid-cooldown, not on a fire tick) still accumulates
  // hold duration; a release (or death) drops it back to baseline
  // instantly. Gated on classId so every other archetype's `channelHoldMs`
  // stays permanently `undefined` — zero behavior change for them.
  const isWizardChannel = classIdForArchetype(next.characterId) === "wizard";
  if (isWizardChannel && fireRequested && next.alive) {
    next.channelHoldMs = (next.channelHoldMs ?? 0) + dtMs;
  } else if (next.channelHoldMs !== undefined) {
    next.channelHoldMs = undefined;
  }

  if (!fireRequested || !next.alive || next.fireCooldownMs > 0) {
    const idleBuild = resolvePlayerBuild(next);
    return {
      player: next,
      projectiles: [],
      hitscanPellets: [],
      fired: false,
      desiredSatelliteCount: Math.max(0, idleBuild.orbitingSatellites | 0),
      rngState,
    };
  }

  const build = resolvePlayerBuild(next);

  // Delivery identities (raycast / continuous-beam / area-pulse) are mapped
  // onto projectile parameters in weaponBuild.applyDeliveryFeel — hyper-speed
  // shards, high-rate ticks, wide explosions — so every delivery card FEELS
  // different without a separate hitscan step (keeps client/server parity).
  // Alternate the throwing hand each shot (0 = lead, 1 = back), toggled off
  // the persisted parity so it stays in lock-step across shots. The muzzle is
  // offset to this hand and the hand is threaded out in FireResult so the
  // shot-fired event tells the rig to throw with the SAME hand — the shard
  // then leaves the exact hand.
  const throwHand: 0 | 1 = ((next.throwHandParity ?? 1) ^ 1) as 0 | 1;
  next.throwHandParity = throwHand;
  const muzzle: Vec2 = playerMuzzlePosition(next, aim, throwHand);
  const baseAngle = lutAtan2(aim.y - muzzle.y, aim.x - muzzle.x);

  const speed = build.projectileSpeed * build.projectile.speedMultiplier;
  const lifetimeMs = Math.max(50, build.projectileLifetimeSeconds * 1000 * build.projectile.lifetimeMultiplier);
  const radius = Math.max(2, 7 * build.projectile.sizeMultiplier);
  const projectileCount = Math.max(1, build.projectile.count | 0);
  // Overclock (Geometrician catalog v1, buff role): fire rate up + spread
  // tighter while the window is live — same currentTick-gated pattern as
  // Crimson Tithe's titheActive just below.
  const overclockActive =
    options.currentTick !== undefined &&
    next.overclockUntilTick !== undefined &&
    next.overclockUntilTick > options.currentTick;
  // Measure (Geometrician catalog v1, buff role, reworked 2026-07-19 —
  // constants.ts's GEO_MEASURE_* doc comment): forces spread to 0 while the
  // window is live — takes priority over Overclock's own spread-tightening
  // if somehow both are live (0 already beats any partial multiplier, so
  // this is just "apply the stronger of the two effects", not a real
  // conflict to resolve).
  const measureActive =
    options.currentTick !== undefined &&
    next.measureUntilTick !== undefined &&
    next.measureUntilTick > options.currentTick;
  const totalSpread = measureActive
    ? build.spreadRadians * GEO_MEASURE_SPREAD_MULTIPLIER
    : build.spreadRadians * (overclockActive ? GEO_OVERCLOCK_SPREAD_MULTIPLIER : 1);
  // Syzygist haste (class-overhaul-workboard.md chunk 3.1, buff role): fire
  // rate up while the window is live — same currentTick-gated pattern as
  // Overclock immediately above, but reads the per-entity `hasteMultiplier`
  // (set by World.ts's `applyHasteToAlly`) rather than a fixed constant,
  // since haste's strength varies by cast (e.g. "self half if solo" per
  // docs/class-ability-catalogs-v1.md's Haste Gift). Only affects fire
  // rate here; the move-speed half of haste composes in World.ts's
  // speedMul chain.
  const hasteActive =
    options.currentTick !== undefined &&
    next.hasteUntilTick !== undefined &&
    next.hasteUntilTick > options.currentTick;
  const hasteFireRateMul = hasteActive ? next.hasteMultiplier ?? 1 : 1;
  // Wizard basic-fire ramping channel (constants.ts's GEO_CHANNEL_RAMP_MS
  // doc comment). Same "fixed ceiling, driven by a live duration" compose
  // pattern as hasteFireRateMul/overclockActive immediately above, except
  // the "duration" is continuous-hold time (channelHoldMs, ticked above)
  // rather than a fixed timed window. `isWizardChannel` keeps this at
  // exactly 1 for every other class regardless of channelHoldMs (which is
  // always undefined for them anyway).
  const channelRampFrac = isWizardChannel
    ? Math.min(1, (next.channelHoldMs ?? 0) / GEO_CHANNEL_RAMP_MS)
    : 0;
  const channelFireRateMul =
    1 + (GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX - 1) * channelRampFrac;
  // Damage is left at the build value here; the chaos damageMultiplier is
  // applied post-hit in World.stepWithRuntime so satellites and any other
  // projectile sources get the same scaling without each spawn site reading
  // chaos directly.
  // Stolen Fangs: a banked lock charge converts this whole volley into a
  // homing shot at reduced damage, then spends the charge (once per fire
  // event, not per pellet — a shotgun-style build doesn't get N free charges
  // out of one bank). Expiry is handled centrally in pickup.ts's buff sweep.
  const spendStolenFangsCharge = (next.pendingLockCharges ?? 0) > 0;
  if (spendStolenFangsCharge) {
    next.pendingLockCharges = (next.pendingLockCharges ?? 0) - 1;
  }
  // Crimson Tithe (six-axes Layer 2): while the active window is live, every
  // fired shot leeches — the shard carries leechFraction exactly like a
  // Drain-hand Emission shard, so the hit site, the crimson-thread read, and
  // the emission-leech event are all the SAME machinery (one damage model).
  const titheActive =
    options.currentTick !== undefined &&
    next.titheUntilTick !== undefined &&
    next.titheUntilTick > options.currentTick;
  // Sunlance (Geometrician catalog v1, offense role): v1 = a burst window,
  // not the doc's true charge-hold (cards.ts description notes the
  // deviation) — shots fired while live deal GEO_SUNLANCE_DAMAGE_MULTIPLIER.
  // Stolen Fangs takes priority when both are somehow live (a legendary
  // defense proc outranking a catalog offense window is the existing
  // precedent for this damage-multiplier slot).
  const sunlanceActive =
    options.currentTick !== undefined &&
    next.sunlanceUntilTick !== undefined &&
    next.sunlanceUntilTick > options.currentTick;
  // Measure's damage amp sits BELOW Sunlance's in this priority chain (never
  // stacks with it) — same "pick the strongest applicable multiplier, don't
  // compound them" convention Stolen Fangs > Sunlance already established.
  // Measure is a buff-role support press (a smaller, secondary amp);
  // Sunlance is a dedicated offense-role button and wins if both are
  // somehow live at once.
  const damage = spendStolenFangsCharge
    ? build.damage * STOLEN_FANGS_DAMAGE_MULTIPLIER
    : sunlanceActive
      ? build.damage * GEO_SUNLANCE_DAMAGE_MULTIPLIER
      : measureActive
        ? build.damage * GEO_MEASURE_DAMAGE_MULTIPLIER
        : build.damage;
  // Priest "oozing tendrils" basic fire (constants.ts's SYZ_TENDRIL_* doc
  // comment — the class-blind projectile shape/count/speed/homing identity
  // itself lives entirely in priestStarterWeapon's WeaponDefinition,
  // weapons.ts, resolved through `build` like any other class's basic gun;
  // this flag is the one piece that can't live there). REVISED 2026-07-19
  // (Jake: "shooting projectiles not object avoiding tendrils that pulse
  // attack or healing effects depending" — ally=heal, enemy=curse, dual-
  // target rather than enemy-only): stamps `tendril` (types.ts, a pure
  // identity flag — NOT a targeting/behavior flag, deliberately decoupled
  // so render/heal/avoidance consumers never break independently of each
  // other) on every tendril this class fires. Targeting itself is now the
  // per-tick homing re-target's DEFAULT behavior — `enemyOnly` is
  // deliberately left unset, so `closestNonOwnerPlayer` (projectile.ts)
  // homes on the closest non-owner player of EITHER team, exactly like
  // every other homing shot in the sim (Bleed Tithe, Stolen Fangs) already
  // does; no cast-time findNearestEnemy call is needed here (stepWeapon-
  // Native has no `state.players` to make one with). Every other class's
  // projectiles are left completely untouched (`tendril` stays unset), so
  // this is zero behavior change for them.
  const isPriestTendril = classIdForArchetype(next.characterId) === "priest";
  // Per-shot offset: spread the count evenly across [-totalSpread/2, +totalSpread/2].
  // Single-shot shots ignore spread entirely (consistent with the offline path).
  const projectiles: ProjectileEntity[] = [];
  // Raycast-delivery pellets (2026-07-20, true hitscan) — see
  // `HitscanPelletSpec`'s own doc comment for why the trace itself resolves
  // in World.ts, not here.
  const hitscanPellets: HitscanPelletSpec[] = [];
  const isHitscan = build.delivery === "raycast";
  // `slappers-only` skips projectile spawn entirely; cooldown/recoil still
  // apply so the shooter feels the kick (matches the chaos modifier intent).
  if (!chaos.disableProjectiles) {
    for (let i = 0; i < projectileCount; i += 1) {
      const offset =
        projectileCount === 1
          ? 0
          : -totalSpread / 2 + (totalSpread * i) / (projectileCount - 1);
      const angle = baseAngle + offset;
      // Tithe (docs/card-pool-v2.md "Tithe", card-pool-v2.md "Priest" solo
      // floor): an always-on passive leech from build.leechFraction, layered
      // under the six-axes Crimson Tithe ABILITY window (titheActive) rather
      // than replaced by it — whichever is stronger this shot wins, so a
      // player holding both never sees the passive silently disappear while
      // the timed window is live. Computed once, shared by both the
      // projectile and hitscan branches below.
      const passiveLeechFraction = build.leechFraction ?? 0;
      const leechFraction = titheActive
        ? Math.max(passiveLeechFraction, ABILITY_TITHE_LEECH_FRACTION)
        : passiveLeechFraction > 0
          ? passiveLeechFraction
          : undefined;
      if (isHitscan) {
        hitscanPellets.push({
          ownerId: next.id,
          originX: muzzle.x,
          originY: muzzle.y,
          aimAngle: angle,
          rangePx: build.projectile.rangePx,
          damage,
          element: build.projectile.element,
          tendril: isPriestTendril || undefined,
          leechFraction,
          radius,
        });
        continue;
      }
      let shape: ProjectileEntity["shape"] = simShape(build.projectile.shape);
      if (chaos.randomShapes) {
        const [nextRng, idx] = nextInt(rngState, 0, projectileShapes.length);
        rngState = nextRng;
        shape = projectileShapes[idx]!;
      }
      const params: ProjectileSpawnParams = {
        ownerId: next.id,
        origin: muzzle,
        aimAngle: angle,
        speed,
        damage,
        lifetimeMs,
        radius,
        shape,
        pathing: spendStolenFangsCharge ? "homing" : build.projectile.pathing,
        element: build.projectile.element,
      };
      const projectile = spawnProjectile(nextEntityId(), params);
      projectile.bouncesRemaining = build.projectile.bounces;
      projectile.pierceRemaining = build.projectile.pierceCount;
      // Populate the additive pathing/impact extras the sim's stepProjectile
      // reads. These are optional on the contract but always set here so the
      // wire-protocol path can rely on them.
      projectile.impact = build.projectile.impact;
      projectile.impactRadiusPx = build.projectile.impactRadiusPx;
      projectile.splitCount = build.projectile.splitCount;
      projectile.slowMultiplier = build.projectile.slowMultiplier;
      projectile.homingStrength = spendStolenFangsCharge
        ? STOLEN_FANGS_HOMING_STRENGTH
        : build.projectile.homingStrength;
      projectile.accelerationMultiplier = build.projectile.accelerationMultiplier;
      projectile.gravityScale = build.projectile.gravityScale;
      projectile.rangePx = build.projectile.rangePx;
      if (isPriestTendril) {
        projectile.tendril = true;
      }
      if (leechFraction !== undefined) {
        projectile.leechFraction = leechFraction;
      }
      projectiles.push(projectile);
    }
  }

  // Recoil Step's rider window (Geometrician catalog v1, movement role,
  // reworked 2026-07-19 — constants.ts's GEO_RECOIL_STEP_RECOIL_MULTIPLIER
  // doc comment): a strong reduction on THIS PLAYER'S OWN self-knockback
  // from firing while live — the kite-specific payoff that makes the
  // ability orthogonal to Slip Node's raw gap-cross.
  const recoilStepActive =
    options.currentTick !== undefined &&
    next.recoilStepUntilTick !== undefined &&
    next.recoilStepUntilTick > options.currentTick;
  // Apply recoil — push the player opposite to the aim direction, scaled by
  // the build's recoil, the projectile recoil multiplier, chaos recoil, and
  // Recoil Step's own self-knockback reduction.
  const recoil =
    build.recoilImpulse *
    build.projectile.recoilMultiplier *
    chaos.recoilMultiplier *
    (recoilStepActive ? GEO_RECOIL_STEP_RECOIL_MULTIPLIER : 1);
  next.vx -= lutCos(baseAngle) * recoil;
  next.vy -= lutSin(baseAngle) * recoil * 0.45;

  // Cooldown derived from build.fireRate (shots per second), scaled by the
  // chaos fire-rate multiplier (golden-gun slows it, future buffs raise it),
  // Overclock's window (Geometrician catalog v1), Syzygist haste
  // (class-overhaul-workboard.md chunk 3.1), and — wizard only — the basic-
  // fire ramping channel (constants.ts's GEO_CHANNEL_RAMP_MS) when live.
  const fireRate = Math.max(
    MIN_FIRE_RATE,
    build.fireRate *
      chaos.fireRateMultiplier *
      (overclockActive ? GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER : 1) *
      hasteFireRateMul *
      channelFireRateMul,
  );
  next.fireCooldownMs = 1000 / fireRate;
  // `ammo` decrements once per fire event exactly as before the channel
  // ramp — checked before landing this change: `ammo` gates nothing in
  // this codebase (no read anywhere checks it against 0 to block firing;
  // ammoRegenPerSecond is 0, so it already only ever drains, never
  // refills, for every class) and isn't HUD-rendered. A wizard streaming
  // faster at full ramp drains it faster, same as any other class's high-
  // fire-rate build already would — not a new mechanic, not a regression.
  next.ammo = Math.max(0, next.ammo - 1);

  return {
    player: next,
    projectiles,
    hitscanPellets,
    fired: true,
    desiredSatelliteCount: Math.max(0, build.orbitingSatellites | 0),
    rngState,
    throwHand,
  };
}

/**
 * Where the projectile spawns from on the player rig. Approximate match to
 * the rig's actual hand position, kept simple here since the sim doesn't
 * know about visual rig pose (crouching offset etc. — close enough for
 * hitscan).
 */
/**
 * Muzzle = the exact THROWING HAND at release, for the ALTERNATING
 * shuriken-throw rig (ProceduralPlayerRig). The hands sit at SHOULDER height
 * — the rig's `chest` is at `ground - ~78*sy` (`ground` ≈ player.y), and the
 * shoulders track the chest — so at the rig's standard visual scale
 * (PLAYER_VISUAL_SCALE 0.78 × sizeScale ≈ 0.78 Balanced) the shoulder is
 * ~60px above player.y, NOT the ~34 the old hip charge-point math gave (that
 * geometry was deleted with the charge stance). At release the hand extends
 * ~ARM_REACH(40)×0.78 ≈ 31 toward aim.
 *
 * `hand` (0 = lead, 1 = back) offsets perpendicular to aim toward that hand,
 * matching the rig's `shoulderLead/Back = chest ± perp*7*s` split (perp =
 * (-aimUnit.y, aimUnit.x); lead is the +perp side). So each shot leaves from
 * the precise hand the rig is throwing with. Still a fixed approximation for
 * one scale (the sim can't see per-character sizeScale).
 */
const MUZZLE_ANCHOR_UP = 60;
const MUZZLE_REACH = 31;
const MUZZLE_HAND_SPREAD = 6;
function playerMuzzlePosition(player: PlayerEntity, aim: Vec2, hand: 0 | 1 = 0): Vec2 {
  const cx = player.x;
  const cy = player.y - MUZZLE_ANCHOR_UP;
  const dx = aim.x - cx;
  const dy = aim.y - cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular to aim, toward the throwing hand (lead = +perp side).
  const side = hand === 0 ? 1 : -1;
  const px = -uy;
  const py = ux;
  return {
    x: cx + ux * MUZZLE_REACH + px * side * MUZZLE_HAND_SPREAD,
    y: cy + uy * MUZZLE_REACH + py * side * MUZZLE_HAND_SPREAD,
  };
}

/**
 * The sim's ProjectileEntity now accepts the wider card-data shape union, so
 * this is currently a 1:1 pass-through. Kept as a function to centralize the
 * mapping if the sim ever needs to collapse novel shapes back to a smaller set
 * for the wire protocol.
 */
function simShape(shape: ResolvedWeaponBuild["projectile"]["shape"]): ProjectileEntity["shape"] {
  return shape;
}
