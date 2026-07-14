// A small, standalone combat-sim composition for the Pretennoia tutorial
// scene. Reuses the exact primitives World.ts is built from (stepPlayer,
// stepWeapon, stepProjectile, combat.ts's parry/shield mitigation) WITHOUT
// World.ts's round/score/draft/chaos/pickup/destructible/satellite/sudden-
// death machinery — none of that applies to a scripted two-slot duel with no
// win condition. Deliberately NOT a reuse of World.stepWithRuntime: that
// falls back to stepRound() with a hardcoded 3-kill/90s timer with no way to
// disable it, so a scripted fight landing "too many" hits would trigger a
// real round-over/draft-UI transition mid-choreography.
//
// Output is a genuine WorldState, so EntityRenderCoordinator and
// SimEventRouter (already scene-agnostic, built for OnlineMatchScene) render
// projectiles/hits/parry-flashes for free — no new rendering code needed.
//
// Deliberately omitted: World.ts's dash-BASH melee block (the BASH_* damage
// constants are module-private there) — this scene only needs the PARRY half
// of the dash-bash move (deflecting incoming projectiles), which
// combat.tryDeflectDamage's dash branch already provides standalone.

import { getChaosProfile } from "./data/chaosModifiers.js";
import {
  stepPlayer,
  freshPlayerMovementMemory,
  mirrorMovementMemoryOntoEntity,
  JETPACK_MAX_FUEL,
  KILL_PLANE_MARGIN_PX,
  type PlayerMovementMemory,
} from "./player.js";
import { stepProjectile, makeHitSweepScratch, fillHitSweepScratch, type HitSweepScratch } from "./projectile.js";
import { stepWeapon, resolvePlayerBuild } from "./weapon.js";
import {
  tickShield,
  tryDeflectDamage,
  tryStartParry,
  SHIELD_MAX_CHARGE_DEFAULT,
  SHIELD_RECHARGE_PER_SECOND,
  PARRY_COOLDOWN_MS_DEFAULT,
} from "./combat.js";
import { buildStaticCache, type StaticCollisionCache } from "./collision.js";
import { EntityId, PlayerId, Tick, InputSeq } from "./types.js";
import type {
  InputBitfield,
  MapDefinition,
  PlayerSpawnInfo,
  ProjectileEntity,
  SimEvent,
  Vec2,
  WorldState,
} from "./types.js";

const FireBit = 1 << 6;
// Bit constants duplicated from net/protocol.ts — sim must not depend on
// net/ (same convention combat.ts documents).
const LeftBit = 1 << 0;
const RightBit = 1 << 1;

// ── MOMENTUM (showcase-only movement feel) ──────────────────────────────
// Sustained running BUILDS speed: hold a direction and over ~0.7s the max
// ground speed rises from base (330) toward base × MOMENTUM_TOP_MULT, and
// since stepPlayer's speed clamp applies airborne too, a jump taken at
// full momentum carries the earned speed — run-ups genuinely extend jumps.
// Decays fast when not driving, so it's an earned state, not a toggle.
// Deliberately scoped to this module (never World.ts): global movement
// physics is Zig-mirrored for wasm parity; this composition is TS-only.
const MOMENTUM_BUILD_MS = 700;
const MOMENTUM_DECAY_MS = 260;
const MOMENTUM_TOP_MULT = 1.32;

/** Underside of the map's ceiling, mirroring World.ts's computeCeilingClampY. */
function computeCeilingClampY(map: MapDefinition): number | null {
  let bottom: number | null = null;
  for (const p of map.platforms) {
    const top = p.position.y - p.size.y / 2;
    const isCeiling = p.kind === "wall" && p.size.x >= map.size.x * 0.5 && top <= 8;
    if (isCeiling) {
      const b = p.position.y + p.size.y / 2;
      bottom = bottom === null ? b : Math.max(bottom, b);
    }
  }
  return bottom;
}

const PLAYER_HALF_HEIGHT = 28;

// ── SHIELD (the "warder" thrall tier) ───────────────────────────────────
// A directional shield, not a damage sponge — the whole point (per the
// Jackal/Hydra design research this is built from) is that it turns
// "shoot it more" into "read its facing and act on that": a hit landing
// inside the shield's frontal arc is fully absorbed, a hit from behind/
// flank always lands. Absorbing enough frontal hits cracks it open for a
// short punish window before it re-seals — reward sustained frontal
// pressure OR a flank, never neither. Facing is read fresh off the
// entity's live aimX/aimY each hit (it already tracks the hero via its
// director) — no separate facing state needs to be persisted.
export const SHIELD_FRONTAL_ARC_RAD = (130 * Math.PI) / 180; // ~130°, Jackal-shield-narrow
const SHIELD_CRACK_THRESHOLD = 3; // frontal hits absorbed before it cracks
const SHIELD_CRACK_WINDOW_MS = 950; // vulnerable while cracked

export type ShieldState = { hitStacks: number; crackedMs: number };

export type TutorialDuelRuntime = {
  prevKeys: Map<PlayerId, InputBitfield>;
  movement: Map<PlayerId, PlayerMovementMemory>;
  nextEntityId: number;
  map: MapDefinition;
  collisionCache: StaticCollisionCache;
  scratchHitSweep: HitSweepScratch;
  scratchDeflectedProjectiles: Map<EntityId, PlayerId>;
  ceilingClampY: number | null;
  /** Per-entity momentum accumulator (0-1) — see MOMENTUM_* constants. */
  momentum: Map<PlayerId, number>;
  /** Presence in this map marks an entity as shield-bearing — see the
   *  SHIELD_* constants above. */
  shields: Map<PlayerId, ShieldState>;
};

export function createTutorialDuelRuntime(map: MapDefinition): TutorialDuelRuntime {
  return {
    prevKeys: new Map(),
    movement: new Map(),
    nextEntityId: 1,
    map,
    collisionCache: buildStaticCache(map.platforms, Math.max(1, map.size.x), Math.max(1, map.size.y)),
    scratchHitSweep: makeHitSweepScratch(),
    scratchDeflectedProjectiles: new Map(),
    ceilingClampY: computeCeilingClampY(map),
    momentum: new Map(),
    shields: new Map(),
  };
}

/** Fresh two-slot duel state — a real fighting-phase WorldState that never
 *  advances round phase (no countdown/drafting/round-over machinery exists
 *  in this module at all, so there's nothing to accidentally trigger). */
export function createTutorialDuelState(spawns: PlayerSpawnInfo[], positions: Map<string, Vec2>): WorldState {
  const players: WorldState["players"] = {};
  const scores: WorldState["round"]["scores"] = {};
  for (const spawn of spawns) {
    const pos = positions.get(spawn.playerId as string) ?? { x: 0, y: 0 };
    players[spawn.playerId] = {
      id: spawn.playerId,
      characterId: spawn.characterId,
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      aimX: pos.x + 160,
      aimY: pos.y,
      health: 100,
      shieldActive: false,
      crouching: false,
      alive: true,
      weaponId: spawn.weaponId,
      cards: [],
      fireCooldownMs: 0,
      ammo: 0,
      abilityCharge: 0,
      lastProcessedInputSeq: InputSeq(0),
      jetpackFuel: JETPACK_MAX_FUEL,
    };
    scores[spawn.playerId] = 0;
  }
  return {
    tick: Tick(0),
    rngState: 1,
    players,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores,
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

export type TutorialDuelInput = { keys: InputBitfield; aimX: number; aimY: number };

export type TutorialDuelStepResult = { state: WorldState; events: SimEvent[] };

/**
 * Per-tick pipeline, trimmed from World.stepWithRuntime: movement, weapon
 * fire, parry/shield, projectile flight + hit/mitigation, ceiling clamp,
 * void-plane kill. Round phase is always "fighting" and never advances — the
 * caller (TutorialDummyDirector / the scene's own logic) decides when a
 * "duel" is won/lost by watching health, not by round machinery.
 */
export function stepTutorialDuel(
  state: WorldState,
  runtime: TutorialDuelRuntime,
  inputsByPlayer: Record<string, TutorialDuelInput | null>,
  dtMs: number,
): TutorialDuelStepResult {
  const events: SimEvent[] = [];
  const chaosProfile = getChaosProfile(undefined); // neutral — no chaos modifiers in the tutorial
  const allocId = (): EntityId => {
    const id = EntityId(runtime.nextEntityId);
    runtime.nextEntityId += 1;
    return id;
  };

  const players: WorldState["players"] = {};
  const nextProjectiles: WorldState["projectiles"] = { ...state.projectiles };

  // 1. Movement + fire + parry/shield, mirroring World.ts's per-player pass.
  for (const [pid_, entity] of Object.entries(state.players)) {
    const pid = pid_ as PlayerId;
    const input = inputsByPlayer[pid] ?? null;
    const prevKeys = runtime.prevKeys.get(pid) ?? 0;
    const currKeys = input ? input.keys : 0;
    const aimX = input?.aimX ?? entity.aimX;
    const aimY = input?.aimY ?? entity.aimY;

    let mem = runtime.movement.get(pid);
    if (!mem) {
      mem = freshPlayerMovementMemory();
      runtime.movement.set(pid, mem);
    }

    const build = resolvePlayerBuild(entity);
    // Momentum: build while actively driving a direction, decay otherwise.
    const driving = (currKeys & (LeftBit | RightBit)) !== 0 && entity.alive;
    let mo = runtime.momentum.get(pid) ?? 0;
    mo = driving
      ? Math.min(1, mo + dtMs / MOMENTUM_BUILD_MS)
      : Math.max(0, mo - dtMs / MOMENTUM_DECAY_MS);
    runtime.momentum.set(pid, mo);
    const momentumMul = 1 + (MOMENTUM_TOP_MULT - 1) * mo;
    // Shield crack window ticks down toward "sealed again" every frame,
    // win or lose — it's a punish window, not a state the player can stall
    // out indefinitely by just not shooting.
    const shield = runtime.shields.get(pid);
    if (shield && shield.crackedMs > 0) {
      shield.crackedMs = Math.max(0, shield.crackedMs - dtMs);
    }
    let nextEntity = entity;
    if (entity.alive) {
      const moveResult = stepPlayer(entity, prevKeys, currKeys, aimX, aimY, mem, runtime.map.platforms, dtMs, {
        speedMultiplier: build.moveSpeedMultiplier * momentumMul,
        gravityMultiplier: chaosProfile.gravityMultiplier * build.gravityMultiplier,
        jumpMultiplier: build.jumpMultiplier,
        wallJumpMultiplier: build.wallJumpMultiplier,
        wallSlideMultiplier: build.wallSlideMultiplier,
        airJumps: build.airJumps,
        dashCharges: build.dashCharges,
        dashCooldownMultiplier: build.dashCooldownMultiplier,
        collisionCache: runtime.collisionCache,
      });
      nextEntity = mirrorMovementMemoryOntoEntity(
        moveResult.player,
        moveResult.memory,
        build.dashCharges,
        build.dashCooldownMultiplier,
      );
      runtime.movement.set(pid, moveResult.memory);
    }

    if (nextEntity.alive) {
      const fireResult = stepWeapon(
        nextEntity,
        (currKeys & FireBit) !== 0,
        { x: aimX, y: aimY },
        dtMs,
        allocId,
        { chaos: chaosProfile },
      );
      nextEntity = fireResult.player;
      if (fireResult.fired) {
        events.push({ t: "shot-fired", playerId: pid, x: nextEntity.x, y: nextEntity.y, hand: fireResult.throwHand });
        for (const p of fireResult.projectiles) nextProjectiles[p.id] = p;
      }
    }

    {
      const parryResult = tryStartParry(nextEntity, currKeys, prevKeys, state.tick, {
        dtMs,
        cooldownMs: PARRY_COOLDOWN_MS_DEFAULT * build.parryCooldownMultiplier,
      });
      nextEntity = parryResult.player;
    }
    nextEntity = tickShield(nextEntity, currKeys, {
      dtMs,
      maxCharge: SHIELD_MAX_CHARGE_DEFAULT * build.shieldChargeMultiplier,
      rechargePerSecond: SHIELD_RECHARGE_PER_SECOND * build.shieldRechargeMultiplier,
    });

    if (input) runtime.prevKeys.set(pid, currKeys);
    players[pid] = nextEntity;
  }

  const sortedPlayerIds = (Object.keys(players) as PlayerId[]).sort();

  // 2. Ceiling clamp.
  if (runtime.ceilingClampY !== null) {
    const minCenterY = runtime.ceilingClampY + PLAYER_HALF_HEIGHT;
    for (const pid of sortedPlayerIds) {
      const p = players[pid]!;
      if (p.y < minCenterY) players[pid] = { ...p, y: minCenterY, vy: Math.max(p.vy, 0) };
    }
  }

  // 3. Void-plane kill check.
  if (runtime.map.size.y > 0 || runtime.map.size.x > 0) {
    const killY = runtime.map.size.y + KILL_PLANE_MARGIN_PX;
    const killMinX = -KILL_PLANE_MARGIN_PX;
    const killMaxX = runtime.map.size.x + KILL_PLANE_MARGIN_PX;
    for (const pid of sortedPlayerIds) {
      const p = players[pid]!;
      if (!p.alive) continue;
      const fell = (runtime.map.size.y > 0 && p.y > killY) || (runtime.map.size.x > 0 && (p.x < killMinX || p.x > killMaxX));
      if (!fell) continue;
      events.push({ t: "hit-confirmed", victimId: pid, damage: p.health, sourceProjectileId: null, attackerId: null });
      events.push({ t: "player-killed", victimId: pid, killerId: null, cause: "void" });
      players[pid] = { ...p, health: 0, alive: false };
    }
  }

  // 4. Projectiles: motion + hit + parry/shield mitigation, mirroring
  //    World.ts's projectile pass (elements/chain/split omitted — the
  //    starter pistol carries none of those and no cards exist here).
  const nextTick = Tick(state.tick + 1);
  let rngState = state.rngState;
  const deflected = runtime.scratchDeflectedProjectiles;
  deflected.clear();
  fillHitSweepScratch(runtime.scratchHitSweep, players, sortedPlayerIds);
  const projCtx = {
    platforms: runtime.map.platforms,
    players,
    dtMs,
    tick: nextTick,
    rngState,
    collisionCache: runtime.collisionCache,
    sortedPlayerIds,
    hitScratch: runtime.scratchHitSweep,
  };

  const remainingProjectiles: WorldState["projectiles"] = {};
  const sortedProjectileIds = Object.keys(nextProjectiles).map((id) => EntityId(Number(id))).sort((a, b) => a - b);

  for (const id of sortedProjectileIds) {
    const proj = nextProjectiles[id]!;
    projCtx.rngState = rngState;
    const result = stepProjectile(proj, projCtx);
    rngState = result.rngState;

    for (const ev of result.events) {
      if (ev.t === "hit-confirmed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        if (victim.alive) {
          const victimBuild = resolvePlayerBuild(victim);
          const sourceProj: Pick<ProjectileEntity, "id" | "x" | "y" | "vx" | "vy" | "damage"> | null =
            ev.sourceProjectileId !== null ? remainingProjectiles[ev.sourceProjectileId] ?? proj : null;
          const mitigation = tryDeflectDamage(victim, sourceProj, ev.damage, nextTick, {
            mirrorShield: victimBuild.mirrorShield,
            directionalShield: victimBuild.directionalShield,
            parryCoverMultiplier: victimBuild.parryCoverMultiplier,
          });
          let postPlayer = mitigation.player;
          if (mitigation.deflected) {
            events.push({ t: "parry-deflected", playerId: ev.victimId, projectileId: ev.sourceProjectileId });
            if (ev.sourceProjectileId !== null) deflected.set(ev.sourceProjectileId, ev.victimId);
            players[ev.victimId] = postPlayer;
            continue;
          }
          if (mitigation.shielded) {
            if (mitigation.shieldReflected && ev.sourceProjectileId !== null) {
              deflected.set(ev.sourceProjectileId, ev.victimId);
              events.push({ t: "parry-deflected", playerId: ev.victimId, projectileId: ev.sourceProjectileId });
            }
            if (mitigation.shieldPopped) {
              events.push({ t: "shield-popped", playerId: ev.victimId, remainingCharge: postPlayer.shieldCharge ?? 0 });
            }
            players[ev.victimId] = postPlayer;
            continue;
          }
          // Directional shield ("warder" tier): a frontal hit while sealed
          // is fully absorbed and stacks toward a crack, not chip damage.
          // Facing is read live off the entity's own aim (it always tracks
          // the hero, so "front" = the direction it's currently looking).
          // Real TS-only math here (this module is deliberately never Zig-
          // mirrored, unlike player.ts's movement — see the file header).
          const shield = runtime.shields.get(ev.victimId);
          if (shield && shield.crackedMs <= 0 && sourceProj) {
            const aimDx = postPlayer.aimX - postPlayer.x;
            const aimDy = postPlayer.aimY - postPlayer.y;
            const aimLen = Math.sqrt(aimDx * aimDx + aimDy * aimDy) || 1;
            const inLen = Math.sqrt(sourceProj.vx * sourceProj.vx + sourceProj.vy * sourceProj.vy) || 1;
            // -dot(incomingDir, aimDir): 1.0 = shot arriving dead-on from
            // the front (traveling straight INTO the facing direction),
            // falls off toward flanks/behind.
            const frontality = -((sourceProj.vx / inLen) * (aimDx / aimLen) + (sourceProj.vy / inLen) * (aimDy / aimLen));
            if (frontality > Math.cos(SHIELD_FRONTAL_ARC_RAD / 2)) {
              shield.hitStacks += 1;
              if (shield.hitStacks >= SHIELD_CRACK_THRESHOLD) {
                shield.hitStacks = 0;
                shield.crackedMs = SHIELD_CRACK_WINDOW_MS;
                events.push({ t: "shield-popped", playerId: ev.victimId, remainingCharge: 0 });
              }
              players[ev.victimId] = postPlayer; // absorbed — no health change
              continue; // matches the deflected/shielded pattern above: raw hit-confirmed suppressed
            }
          }
          const newHealth = Math.max(0, postPlayer.health - mitigation.damage);
          const wasAlive = postPlayer.alive;
          const nextVictim = { ...postPlayer, health: newHealth, alive: newHealth > 0 };
          if (wasAlive && newHealth === 0) {
            events.push({ t: "player-killed", victimId: ev.victimId, killerId: proj.ownerId, cause: "projectile" });
          }
          players[ev.victimId] = nextVictim;
        }
      }
      events.push(ev);
    }

    for (const child of result.spawned) {
      const childId = EntityId(runtime.nextEntityId);
      runtime.nextEntityId += 1;
      remainingProjectiles[childId] = { ...child.spec, id: childId };
    }

    const parrier = deflected.get(id);
    if (parrier !== undefined) {
      const deflector = players[parrier];
      const rx = deflector ? deflector.x : proj.x;
      const ry = deflector ? deflector.y : proj.y;
      remainingProjectiles[id] = {
        ...proj,
        x: rx,
        y: ry,
        vx: -proj.vx * 1.15,
        vy: -proj.vy * 1.15,
        ownerId: parrier,
        ageMs: 0,
        traveledPx: 0,
        originX: rx,
        originY: ry,
        returning: undefined,
      };
      continue;
    }

    if (result.expired || result.projectile === null) continue;
    remainingProjectiles[id] = result.projectile;
  }

  return {
    state: {
      ...state,
      tick: nextTick,
      rngState,
      players,
      projectiles: remainingProjectiles,
    },
    events,
  };
}
