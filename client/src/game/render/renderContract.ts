// The render contract (RENDER_OVERHAUL_PLAN Phase 2): pure producers that
// turn WorldState (+ sim events) into plain-data RENDER MODELS, with every
// painter (live Phaser vectors today; baked-atlas, phone, and the headless
// replay renderer later) consuming the same models. A new visual is
// authored ONCE against the contract and appears identically everywhere —
// that's END_PRODUCT_GOAL pillar 6's litmus test.
//
// Rules:
//  - Engine-free: no Phaser imports, no DOM, no scene state. Node-testable.
//  - Zero-alloc steady state: producers fill caller-owned model pools and
//    return a count (the render loop runs 60-240×/s).
//  - Pure: same WorldState (+ clock) → same models, so the headless
//    renderer reproduces frames bit-for-bit from a re-simulated state.
//
// Adoption is incremental, safest layer first: projectiles (pure state
// mapping) now; entities, combat FX and the rig pose follow.

import type {
  DestructibleEntity,
  PlayerId,
  ProjectileShape,
  WorldState,
} from "../../sim/types";

/** Everything a painter needs to draw one projectile. */
export type ProjectileRenderModel = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Velocity heading in radians (shape orientation). */
  angle: number;
  radius: number;
  element: string;
  shape: ProjectileShape;
  pathing: string;
  ownerId: PlayerId | null;
  damage: number;
  impact: string;
  impactRadiusPx: number;
  /** 1 normally; sticky projectiles pulse as their fuse runs down. */
  bodyAlpha: number;
};

function blankProjectile(): ProjectileRenderModel {
  return {
    id: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 5,
    element: "neutral",
    shape: "circle" as ProjectileShape,
    pathing: "linear",
    ownerId: null,
    damage: 0,
    impact: "none",
    impactRadiusPx: 0,
    bodyAlpha: 1,
  };
}

/**
 * Fill `out` with render models for every live projectile. Returns the
 * model count; `out` grows once to peak size and is reused every frame.
 */
export function produceProjectiles(
  state: WorldState,
  out: ProjectileRenderModel[],
): number {
  let n = 0;
  for (const idStr in state.projectiles) {
    const proj = state.projectiles[idStr as unknown as keyof typeof state.projectiles]!;
    if (n >= out.length) out.push(blankProjectile());
    const m = out[n]!;
    n += 1;
    m.id = Number(idStr);
    m.x = proj.x;
    m.y = proj.y;
    m.vx = proj.vx;
    m.vy = proj.vy;
    m.angle = Math.atan2(proj.vy, proj.vx);
    m.radius = proj.radius || 5;
    m.element = proj.element;
    m.shape = proj.shape;
    m.pathing = proj.pathing;
    m.ownerId = proj.ownerId;
    m.damage = proj.damage;
    m.impact = proj.impact ?? "none";
    m.impactRadiusPx = proj.impactRadiusPx ?? 0;
    // Sticky fuse blink: legible threat countdown — faster as it shortens.
    if (proj.stickyFuseMs !== undefined && proj.stickyFuseMs > 0) {
      const hz = proj.stickyFuseMs < 400 ? 18 : 9;
      m.bodyAlpha = 0.55 + 0.45 * Math.abs(Math.sin((proj.stickyFuseMs / 1000) * hz));
    } else {
      m.bodyAlpha = 1;
    }
  }
  return n;
}

// ── Destructibles ─────────────────────────────────────────────────────────
// FireEntity / PickupEntity are already plain engine-free data with zero
// render-side derivation — painters consume them directly and that IS
// contract-conformant. Destructibles carry temporal derivation (damage
// flash), so the bookkeeping lives here, not in any one painter.

const DAMAGE_FLASH_MS = 110;

/** DestructibleEntity + the derived flash flag painters need. */
export type DestructibleRenderModel = {
  entity: DestructibleEntity;
  /** True for DAMAGE_FLASH_MS after a health drop. */
  flashing: boolean;
};

/** Explicit, engine-free flash bookkeeping (one per painter instance). */
export type DestructibleFlashState = {
  prevHealth: Map<number, number>;
  flashUntilMs: Map<number, number>;
  /** Scratch for stale-id sweep — reused, never reallocated. */
  staleScratch: number[];
};

export function makeDestructibleFlashState(): DestructibleFlashState {
  return { prevHealth: new Map(), flashUntilMs: new Map(), staleScratch: [] };
}

function blankDestructibleModel(): DestructibleRenderModel {
  return { entity: null as unknown as DestructibleEntity, flashing: false };
}

/**
 * Fill `out` with destructible models (flash derived from health drops
 * since the previous call). Prunes bookkeeping for despawned ids. Returns
 * the model count.
 */
export function produceDestructibles(
  state: WorldState,
  nowMs: number,
  st: DestructibleFlashState,
  out: DestructibleRenderModel[],
): number {
  let n = 0;
  for (const idStr in state.destructibles) {
    const obj = state.destructibles[idStr as unknown as keyof typeof state.destructibles]!;
    const id = Number(idStr);
    const prev = st.prevHealth.get(id);
    if (prev !== undefined && obj.health < prev) {
      st.flashUntilMs.set(id, nowMs + DAMAGE_FLASH_MS);
    }
    st.prevHealth.set(id, obj.health);
    if (n >= out.length) out.push(blankDestructibleModel());
    const m = out[n]!;
    n += 1;
    m.entity = obj;
    m.flashing = (st.flashUntilMs.get(id) ?? 0) > nowMs;
  }
  // Prune despawned ids so the maps can't grow across a long session.
  const stale = st.staleScratch;
  stale.length = 0;
  for (const id of st.prevHealth.keys()) {
    if (!(id in state.destructibles)) stale.push(id);
  }
  for (const id of stale) {
    st.prevHealth.delete(id);
    st.flashUntilMs.delete(id);
  }
  return n;
}

// ── Combat FX (shields + parry arcs) ──────────────────────────────────────

/** Sim constants mirrored for painters: body 26x56 → shield r = 56*0.82. */
export const SHIELD_RADIUS = 46;
/** Mirrors MatchLogic.PARRY_BASE_RANGE. */
export const PARRY_RANGE = 98;
/** 60° parry cone. */
export const PARRY_ARC = Math.PI / 3;

export type CombatFxRenderModel = {
  x: number;
  y: number;
  shieldActive: boolean;
  /** 0..1 block-flash envelope (decays over ~7 frames after an absorb). */
  shieldFlash: number;
  parryActive: boolean;
  /** Parry cone centre direction (radians). */
  parryFacing: number;
};

/** Engine-free block-flash bookkeeping (one per painter instance). */
export type CombatFxState = {
  prevShieldCharge: Map<string, number>;
  blockFlash: Map<string, number>;
  staleScratch: string[];
};

export function makeCombatFxState(): CombatFxState {
  return { prevShieldCharge: new Map(), blockFlash: new Map(), staleScratch: [] };
}

function blankCombatFx(): CombatFxRenderModel {
  return { x: 0, y: 0, shieldActive: false, shieldFlash: 0, parryActive: false, parryFacing: 0 };
}

/**
 * Fill `out` with shield/parry models for every LIVING player. The block
 * flash fires when shieldCharge drops >5 in one frame while shielding
 * (passive hold-drain is ~0.6/frame — a big drop = an absorbed hit) and
 * decays 0.14/call. Dead/departed players are pruned from bookkeeping.
 */
export function produceCombatFx(
  state: WorldState,
  st: CombatFxState,
  out: CombatFxRenderModel[],
): number {
  let n = 0;
  for (const pid in state.players) {
    const player = state.players[pid as PlayerId]!;
    if (!player.alive) continue;
    const charge = player.shieldCharge ?? 0;
    const prev = st.prevShieldCharge.get(pid);
    if (prev !== undefined && prev - charge > 5 && player.shieldActive) {
      st.blockFlash.set(pid, 1);
    }
    st.prevShieldCharge.set(pid, charge);
    let flash = st.blockFlash.get(pid) ?? 0;
    if (n >= out.length) out.push(blankCombatFx());
    const m = out[n]!;
    n += 1;
    m.x = player.x;
    m.y = player.y;
    m.shieldActive = player.shieldActive ?? false;
    m.shieldFlash = flash;
    m.parryActive =
      player.parryActiveUntilTick !== undefined && player.parryActiveUntilTick > state.tick;
    m.parryFacing = player.parryFacing ?? 0;
    if (flash > 0) {
      flash = Math.max(0, flash - 0.14);
      st.blockFlash.set(pid, flash);
    }
  }
  const stale = st.staleScratch;
  stale.length = 0;
  for (const pid of st.prevShieldCharge.keys()) {
    const p = state.players[pid as PlayerId];
    if (!p || !p.alive) stale.push(pid);
  }
  for (const pid of stale) {
    st.prevShieldCharge.delete(pid);
    st.blockFlash.delete(pid);
  }
  return n;
}

// ── Satellites ────────────────────────────────────────────────────────────

/** Resolved orbit position for one satellite (owner lookup + trig done). */
export type SatelliteRenderModel = {
  id: number;
  x: number;
  y: number;
};

function blankSatellite(): SatelliteRenderModel {
  return { id: 0, x: 0, y: 0 };
}

/** Fill `out` with orbit-resolved satellite positions; ownerless (dead
 *  owner) satellites are skipped, matching the previous painter rule. */
export function produceSatellites(
  state: WorldState,
  out: SatelliteRenderModel[],
): number {
  let n = 0;
  for (const idStr in state.satellites) {
    const sat = state.satellites[idStr as unknown as keyof typeof state.satellites]!;
    const owner = sat.ownerId !== null ? state.players[sat.ownerId] : undefined;
    if (!owner) continue;
    if (n >= out.length) out.push(blankSatellite());
    const m = out[n]!;
    n += 1;
    m.id = Number(idStr);
    m.x = owner.x + Math.cos(sat.angle) * sat.orbitRadius;
    m.y = owner.y + Math.sin(sat.angle) * sat.orbitRadius;
  }
  return n;
}

// ── Death FX (the soul returns to the center motif) ──────────────────────
//
// A `player-killed` event births a SOUL at the corpse: a brief release
// (rise + corpse dissolve), a curved journey to the arena's center motif,
// and an absorption pulse when it arrives. Event-driven by necessity —
// dead players are skipped by state scans and pruned at round transitions,
// so the moment of death must be captured from the event stream.
//
// Deterministic BY CONSTRUCTION: the path is a pure function of (death
// position, per-soul seed derived from tick+victim id, accumulated age).
// No Math.random — two renders of the same replay slice trace identical
// souls (SESSION_GOAL_DEATH_TELEMETRY pillar 1, test 2).

/** Soul lifecycle stage. */
export const SOUL_RELEASE = 0;
export const SOUL_JOURNEY = 1;
export const SOUL_ABSORB = 2;

const RELEASE_MS = 620;
const JOURNEY_MS = 1650;
const ABSORB_MS = 620;
const SOUL_TOTAL_MS = RELEASE_MS + JOURNEY_MS + ABSORB_MS;
/** Rise during release (px). */
const RELEASE_RISE_PX = 44;
/** Trail ring size — positions sampled every producer call. */
const TRAIL_N = 12;
/** Max simultaneous souls (pool size); oldest is recycled beyond this. */
const SOUL_POOL = 16;

export type SoulRenderModel = {
  /** Soul position (world px). */
  x: number;
  y: number;
  /** Core radius (px). */
  r: number;
  /** Master alpha 0..1. */
  alpha: number;
  stage: number;
  /** 0..1 progress within the current stage. */
  progress: number;
  /** Deterministic per-soul phase seed (radians-ish). */
  seed: number;
  /** Corpse dissolve origin + 0..1 envelope (death point, first ~900ms). */
  originX: number;
  originY: number;
  dissolveT: number;
  /** Absorption: 0..1 pulse envelope at the motif; fires once per soul. */
  absorbT: number;
  motifX: number;
  motifY: number;
  /** Recent path ring (oldest→newest wrap at trailHead). */
  trailX: number[];
  trailY: number[];
  trailHead: number;
  trailLen: number;
};

type Soul = {
  active: boolean;
  x0: number;
  y0: number;
  seed: number;
  ageMs: number;
  trailX: number[];
  trailY: number[];
  trailHead: number;
  trailLen: number;
  sampleAccum: number;
};

export type DeathFxState = {
  souls: Soul[];
  /** Center motif world position (CosmicArenaLayer's motifX/motifY). */
  motifX: number;
  motifY: number;
};

export function makeDeathFxState(): DeathFxState {
  const souls: Soul[] = [];
  for (let i = 0; i < SOUL_POOL; i++) {
    souls.push({
      active: false,
      x0: 0,
      y0: 0,
      seed: 0,
      ageMs: 0,
      trailX: new Array(TRAIL_N).fill(0),
      trailY: new Array(TRAIL_N).fill(0),
      trailHead: 0,
      trailLen: 0,
      sampleAccum: 0,
    });
  }
  return { souls, motifX: 0, motifY: 0 };
}

/** Point the souls at the arena's center motif (map.size * 0.5). */
export function setDeathFxTarget(st: DeathFxState, x: number, y: number): void {
  st.motifX = x;
  st.motifY = y;
}

/** Feed this frame's sim events; births a soul per `player-killed`.
 *  The victim is still present in `state` (alive=false) at event time. */
export function noteDeathEvents(
  state: WorldState,
  events: ReadonlyArray<{ t: string; victimId?: string }>,
  st: DeathFxState,
): void {
  for (const e of events) {
    if (e.t !== "player-killed" || !e.victimId) continue;
    const victim = state.players[e.victimId as PlayerId];
    if (!victim) continue;
    let soul = st.souls.find((s) => !s.active);
    if (!soul) {
      // Pool exhausted: recycle the oldest — a 17th simultaneous death is
      // a mayhem frame where one missing soul is invisible.
      soul = st.souls.reduce((a, b) => (a.ageMs >= b.ageMs ? a : b));
    }
    soul.active = true;
    soul.x0 = victim.x;
    soul.y0 = victim.y;
    // Deterministic seed: tick + a tiny id hash. Same replay → same soul.
    let h = 0;
    for (let i = 0; i < e.victimId.length; i++) h = (h * 31 + e.victimId.charCodeAt(i)) | 0;
    soul.seed = ((state.tick + (h >>> 0)) % 1024) / 1024 * Math.PI * 2;
    soul.ageMs = 0;
    soul.trailLen = 0;
    soul.trailHead = 0;
    soul.sampleAccum = 0;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function blankSoul(): SoulRenderModel {
  return {
    x: 0,
    y: 0,
    r: 0,
    alpha: 0,
    stage: 0,
    progress: 0,
    seed: 0,
    originX: 0,
    originY: 0,
    dissolveT: 0,
    absorbT: 0,
    motifX: 0,
    motifY: 0,
    trailX: new Array(TRAIL_N).fill(0),
    trailY: new Array(TRAIL_N).fill(0),
    trailHead: 0,
    trailLen: 0,
  };
}

/**
 * Advance every active soul by `deltaMs` and fill `out` with render models.
 * Pure per-frame advancement: position is a closed-form function of age, so
 * variable frame rates change SAMPLING, never the path itself.
 */
export function produceDeathFx(
  _state: WorldState,
  deltaMs: number,
  st: DeathFxState,
  out: SoulRenderModel[],
): number {
  let n = 0;
  for (const soul of st.souls) {
    if (!soul.active) continue;
    soul.ageMs += deltaMs;
    if (soul.ageMs >= SOUL_TOTAL_MS) {
      soul.active = false;
      continue;
    }
    const age = soul.ageMs;
    // Release end point (top of the rise) is the journey's start.
    const riseX = soul.x0;
    const riseY = soul.y0 - RELEASE_RISE_PX;

    let x: number;
    let y: number;
    let r: number;
    let alpha: number;
    let stage: number;
    let progress: number;
    let absorbT = 0;

    if (age < RELEASE_MS) {
      stage = SOUL_RELEASE;
      progress = age / RELEASE_MS;
      const p = easeOutCubic(progress);
      x = soul.x0;
      y = soul.y0 - RELEASE_RISE_PX * p;
      r = 3.5 + 5.5 * p;
      alpha = Math.min(1, progress * 2.2);
    } else if (age < RELEASE_MS + JOURNEY_MS) {
      stage = SOUL_JOURNEY;
      progress = (age - RELEASE_MS) / JOURNEY_MS;
      const p = easeInOutCubic(progress);
      const dx = st.motifX - riseX;
      const dy = st.motifY - riseY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Perpendicular bow — side chosen by the seed, scaled by distance.
      const px = -dy / dist;
      const py = dx / dist;
      const bowSide = soul.seed < Math.PI ? 1 : -1;
      const bow = bowSide * Math.min(220, dist * 0.28);
      const arc = Math.sin(Math.PI * p) * bow;
      // Fine shimmer riding the path (fades at both ends).
      const shimmer = Math.sin(p * Math.PI * 6 + soul.seed) * 7 * Math.sin(Math.PI * p);
      x = riseX + dx * p + px * (arc + shimmer);
      y = riseY + dy * p + py * (arc + shimmer);
      r = 9;
      alpha = 1;
    } else {
      stage = SOUL_ABSORB;
      progress = (age - RELEASE_MS - JOURNEY_MS) / ABSORB_MS;
      const p = easeOutCubic(progress);
      x = st.motifX;
      y = st.motifY;
      r = 9 * (1 - p);
      alpha = 1 - p * 0.85;
      absorbT = progress;
    }

    // Trail: sample ~every 30ms of soul time (deterministic in replay).
    soul.sampleAccum += deltaMs;
    while (soul.sampleAccum >= 30) {
      soul.sampleAccum -= 30;
      soul.trailX[soul.trailHead] = x;
      soul.trailY[soul.trailHead] = y;
      soul.trailHead = (soul.trailHead + 1) % TRAIL_N;
      if (soul.trailLen < TRAIL_N) soul.trailLen += 1;
    }

    if (n >= out.length) out.push(blankSoul());
    const m = out[n]!;
    n += 1;
    m.x = x;
    m.y = y;
    m.r = r;
    m.alpha = alpha;
    m.stage = stage;
    m.progress = progress;
    m.seed = soul.seed;
    m.originX = soul.x0;
    m.originY = soul.y0;
    m.dissolveT = Math.min(1, age / 900);
    m.absorbT = absorbT;
    m.motifX = st.motifX;
    m.motifY = st.motifY;
    for (let i = 0; i < TRAIL_N; i++) {
      m.trailX[i] = soul.trailX[i]!;
      m.trailY[i] = soul.trailY[i]!;
    }
    m.trailHead = soul.trailHead;
    m.trailLen = soul.trailLen;
  }
  return n;
}
