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
import { computeStormZone } from "../../sim/suddenDeath.js";
// Ascension denial reads the killer's build element at soul birth —
// identity-cached resolver, so the per-kill cost is a WeakMap hit.
import { resolvePlayerBuild } from "../../sim/weapon.js";
import { resolveEmission } from "../../sim/data/emission.js";

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
  /**
   * True for Priest/Syzygist's "oozing tendril" basic-fire shots
   * specifically — `proj.tendril === true`. `tendril` (types.ts,
   * `ProjectileEntity`) is a dedicated, purely-identity flag stamped ONLY
   * on a Priest tendril (weapon.ts's `isPriestTendril` spawn site), so this
   * is a collision-free signal: a naive `element === "fire"` check would
   * also catch any class stacking a fire-element card (Molten Core), and
   * `element === "fire" && pathing === "homing"` would ALSO catch any class
   * stacking a fire card with a homing card (Seeker Facets /
   * Homing-Cluster) — both real, reachable combos. REVISED 2026-07-19: this
   * used to derive from `element === "fire" && enemyOnly === true`, but the
   * Priest tendril dual-purpose rework (docs/classes-goal.md "ally=heal,
   * enemy=curse") repurposes `enemyOnly`-style targeting so tendrils no
   * longer set it — `tendril` is the SAME identity signal, now carried on
   * its own dedicated field instead of piggybacking on a targeting flag, so
   * this render-layer check keeps working regardless of how targeting
   * evolves. Painters use this to opt a Priest tendril into a bespoke
   * travel-phase body (see ProjectileVfx.ts) without touching any other
   * class's shot.
   */
  tendril: boolean;
  /** True for Interstice's small precision shots — Edge Storm's wave-off-
   * swing AND Needle's shard — `proj.ninjaBladeShard === true` (types.ts,
   * `ProjectileEntity`), the same dedicated-identity-flag shape as
   * `tendril` immediately above. Opts a shot into a bespoke, smaller
   * blade-sliver body + the Interstice cyan tint (ProjectileVfx.ts)
   * instead of the Geometrician's own crystal-dart shape either used to
   * inherit purely from riding `element === "crystal"`. */
  ninjaBladeShard: boolean;
  /** True for Kindled's Sunspike specifically — `proj.kindledThrust ===
   * true` (types.ts). Opts into a solid, symmetric gold spike body
   * (ProjectileVfx.ts's `drawSpikeBody`) instead of inheriting whatever
   * shape/element the caster's own card build resolves to. */
  kindledThrust: boolean;
  /** True when the shard wraps the map rect (six-axes Mystery —
   * `proj.wrapShots === true`). Track L: the wasm bridge round-trips this
   * flag but NO renderer consumed it — the trail teleport-discontinuity
   * break was a pure distance heuristic. Painters now use it to fire the
   * positive exit/entry seam flash at the wrap moment (ProjectileVfx.ts),
   * turning the negative-space trail break into a readable teleport. */
  wrapShots: boolean;
  /** True when the shot leeches on hit (`proj.leechFraction > 0` —
   * weapon.ts Drain-axis / Crimson Tithe stamp). Drives the in-flight
   * crimson accent ring (ProjectileVfx.ts) so a tithe-window volley reads
   * as vampiric BEFORE it lands — the leech thread stays the payoff read. */
  leech: boolean;
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
    tendril: false,
    ninjaBladeShard: false,
    kindledThrust: false,
    wrapShots: false,
    leech: false,
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
    m.tendril = proj.tendril === true;
    m.ninjaBladeShard = proj.ninjaBladeShard === true;
    m.kindledThrust = proj.kindledThrust === true;
    m.wrapShots = proj.wrapShots === true;
    m.leech = (proj.leechFraction ?? 0) > 0;
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
/** ASCENSION DENIED (void-hand kill): the soul's ONLY stage — a short
 *  rise that reverses into an unmaking collapse. Never journeys, never
 *  reaches the motif. */
export const SOUL_DENIED = 3;

const RELEASE_MS = 620;
const JOURNEY_MS = 1650;
const ABSORB_MS = 620;
const SOUL_TOTAL_MS = RELEASE_MS + JOURNEY_MS + ABSORB_MS;
/** Denied souls live briefly: rise ~35% of the window, then the collapse. */
const DENIED_TOTAL_MS = 760;
const DENIED_RISE_FRAC = 0.35;
const DENIED_RISE_PX = 18;
/** Rise during release (px). */
const RELEASE_RISE_PX = 44;
/** Trail ring size — positions sampled every producer call. */
const TRAIL_N = 12;
/** Max simultaneous souls (pool size); oldest is recycled beyond this. */
const SOUL_POOL = 16;
/** Reward shards per death (Doom-style shiny pour-out, damage-homing). */
const SHARDS_PER_DEATH = 9;
const SHARD_POOL = 48;
/** Free-flight time before homing locks on. */
const SHARD_HOLD_MS = 260;
const SHARD_MAX_MS = 2_600;
const SHARD_ARRIVE_PX = 26;
const SHARD_PING_MS = 300;
const SHARD_GRAVITY = 480;
/** Spawn-in "digital gnostic upload" duration. */
const UPLOAD_MS = 1_150;
const UPLOAD_POOL = 12;

export type SoulRenderModel = {
  /** Victim the soul belongs to. */
  pid: string;
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
  /** TECHNIQUE EXECUTE (six-axes Layer 1): the killing hit carried the
   *  execute raise (`player-killed.executed`) — the painter adds a single
   *  clean severance shear at the unmake moment. Unlike `denied` this is
   *  event-threaded, not snapshot-derived: the raise depends on the
   *  victim's transient pre-hit health, which no snapshot retains. */
  executed: boolean;
};

type Soul = {
  active: boolean;
  /** Victim the soul belongs to (death-cam looks itself up by this). */
  pid: string;
  x0: number;
  y0: number;
  seed: number;
  ageMs: number;
  trailX: number[];
  trailY: number[];
  trailHead: number;
  trailLen: number;
  sampleAccum: number;
  /** ASCENSION DENIAL (emission-engine-goal P2 / the war-crimes arc):
   *  true when the killer's resolved build element was void — the soul is
   *  UNMADE instead of released: a brief rise that reverses into a void-
   *  tinted collapse, no journey, no motif absorption. The gnostic war
   *  crime made legible in one frame of grammar the game already taught. */
  denied: boolean;
  /** Technique execute — threaded from `player-killed.executed` (see
   *  SoulRenderModel.executed). */
  executed: boolean;
};

type Shard = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetId: string;
  ageMs: number;
  seed: number;
  size: number;
  /** ageMs when the shard reached its target; -1 while in flight. */
  arrivedAtMs: number;
  /** Target died/left — fade out instead of homing. */
  targetLost: boolean;
};

type Upload = {
  active: boolean;
  pid: string;
  ageMs: number;
  seed: number;
};

export type DeathFxState = {
  souls: Soul[];
  shards: Shard[];
  uploads: Upload[];
  /** Damage ledger victim → attacker → total (fed by hit-confirmed). */
  damage: Map<string, Map<string, number>>;
  /** alive-flag memory for spawn-in detection. */
  prevAlive: Map<string, boolean>;
  staleScratch: string[];
  /** Center motif world position (CosmicArenaLayer's motifX/motifY). */
  motifX: number;
  motifY: number;
};

export function makeDeathFxState(): DeathFxState {
  const souls: Soul[] = [];
  for (let i = 0; i < SOUL_POOL; i++) {
    souls.push({
      active: false,
      pid: "",
      x0: 0,
      y0: 0,
      seed: 0,
      ageMs: 0,
      trailX: new Array(TRAIL_N).fill(0),
      trailY: new Array(TRAIL_N).fill(0),
      trailHead: 0,
      trailLen: 0,
      sampleAccum: 0,
      denied: false,
      executed: false,
    });
  }
  const shards: Shard[] = [];
  for (let i = 0; i < SHARD_POOL; i++) {
    shards.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      targetId: "",
      ageMs: 0,
      seed: 0,
      size: 1,
      arrivedAtMs: -1,
      targetLost: false,
    });
  }
  const uploads: Upload[] = [];
  for (let i = 0; i < UPLOAD_POOL; i++) {
    uploads.push({ active: false, pid: "", ageMs: 0, seed: 0 });
  }
  return {
    souls,
    shards,
    uploads,
    damage: new Map(),
    prevAlive: new Map(),
    staleScratch: [],
    motifX: 0,
    motifY: 0,
  };
}

/** Point the souls at the arena's center motif (map.size * 0.5). */
export function setDeathFxTarget(st: DeathFxState, x: number, y: number): void {
  st.motifX = x;
  st.motifY = y;
}

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Feed this frame's sim events. `hit-confirmed` accumulates the damage
 * ledger; `player-killed` births a soul + a burst of damage-proportional
 * reward shards homing to the contributors; `round-end` clears the ledger.
 * The victim is still present in `state` (alive=false) at event time.
 */
export function noteDeathEvents(
  state: WorldState,
  events: ReadonlyArray<{
    t: string;
    victimId?: string;
    killerId?: string | null;
    attackerId?: string | null;
    damage?: number;
    executed?: boolean;
  }>,
  st: DeathFxState,
): void {
  for (const e of events) {
    if (e.t === "round-end") {
      st.damage.clear();
      continue;
    }
    if (e.t === "hit-confirmed" && e.victimId && e.attackerId && e.attackerId !== e.victimId) {
      let ledger = st.damage.get(e.victimId);
      if (!ledger) {
        ledger = new Map();
        st.damage.set(e.victimId, ledger);
      }
      ledger.set(e.attackerId, (ledger.get(e.attackerId) ?? 0) + (e.damage ?? 0));
      continue;
    }
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
    soul.pid = e.victimId;
    soul.x0 = victim.x;
    soul.y0 = victim.y;
    // Deterministic seed: tick + a tiny id hash. Same replay → same soul.
    soul.seed = (((state.tick + idHash(e.victimId)) % 1024) / 1024) * Math.PI * 2;
    soul.ageMs = 0;
    soul.trailLen = 0;
    soul.trailHead = 0;
    soul.sampleAccum = 0;
    // TECHNIQUE EXECUTE: sim-authoritative flag on the kill event itself
    // (single-derivation doctrine's event-side sibling — the sim already
    // decided the raise fired; the renderer only repeats the verdict).
    soul.executed = e.executed === true;
    // ASCENSION DENIAL: a killer whose hand charges the Mystery axis
    // UNMAKES the victim's soul (emission-engine-goal P2). Derived through
    // resolveEmission's mystery section so the renderer and the sim share
    // ONE derivation (six-axes-goal.md doctrine #1 — today that means the
    // killer's resolved element is void). Read from the killer's snapshot
    // entry at event time — deterministic, and identical in replay-rendered
    // clips (same code path). Environmental kills (killerId null) always
    // ascend.
    soul.denied = false;
    if (e.killerId && e.killerId !== e.victimId) {
      const killer = state.players[e.killerId as PlayerId];
      // cards-array guard: render-side code must not throw on a minimal
      // snapshot (tests / partial reconciles) — no cards, no denial.
      if (killer && Array.isArray(killer.cards)) {
        soul.denied = resolveEmission(resolvePlayerBuild(killer)).mystery
          .denyAscension;
      }
    }

    // ── Reward shards: pour out, then lock onto the damagers ──
    const ledger = st.damage.get(e.victimId);
    // (attacker, cumulative-weight) list; fallback = 100% to the killer.
    const entries: Array<[string, number]> = [];
    let total = 0;
    if (ledger) {
      for (const [aid, dmg] of ledger) {
        if (dmg <= 0) continue;
        const alive = state.players[aid as PlayerId]?.alive;
        if (!alive) continue;
        total += dmg;
        entries.push([aid, total]);
      }
    }
    if (entries.length === 0 && e.killerId && e.killerId !== e.victimId) {
      entries.push([e.killerId, 1]);
      total = 1;
    }
    st.damage.delete(e.victimId);
    if (entries.length === 0) continue; // pure environmental death: soul only
    for (let k = 0; k < SHARDS_PER_DEATH; k++) {
      let shard = st.shards.find((sh) => !sh.active);
      if (!shard) shard = st.shards.reduce((a, b) => (a.ageMs >= b.ageMs ? a : b));
      // Deterministic slot → attacker by cumulative damage share.
      const slot = ((k + 0.5) / SHARDS_PER_DEATH) * total;
      let target = entries[entries.length - 1]![0];
      for (const [aid, cum] of entries) {
        if (slot <= cum) {
          target = aid;
          break;
        }
      }
      const a = soul.seed + (k * Math.PI * 2) / SHARDS_PER_DEATH + Math.sin(soul.seed * 5 + k) * 0.45;
      const speed = 250 + ((k * 53) % 150);
      shard.active = true;
      shard.x = victim.x;
      shard.y = victim.y - 14;
      shard.vx = Math.cos(a) * speed;
      shard.vy = Math.sin(a) * speed - 150;
      shard.targetId = target;
      shard.ageMs = 0;
      shard.seed = soul.seed + k;
      shard.size = 0.75 + ((k * 29) % 10) / 14;
      shard.arrivedAtMs = -1;
      shard.targetLost = false;
    }
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
    pid: "",
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
    executed: false,
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
    if (soul.ageMs >= (soul.denied ? DENIED_TOTAL_MS : SOUL_TOTAL_MS)) {
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

    if (soul.denied) {
      // ASCENSION DENIED: one short stage. The soul starts to rise the way
      // every player has learned souls rise — then the rise REVERSES, the
      // light is dragged back below the death point and crushed out. It
      // never journeys, never reaches the motif, no absorption bloom fires.
      // Closed-form like every other stage (replay-identical).
      stage = SOUL_DENIED;
      progress = age / DENIED_TOTAL_MS;
      const riseP = Math.min(1, progress / DENIED_RISE_FRAC);
      const fallP =
        progress <= DENIED_RISE_FRAC
          ? 0
          : (progress - DENIED_RISE_FRAC) / (1 - DENIED_RISE_FRAC);
      x = soul.x0 + Math.sin(progress * Math.PI * 9 + soul.seed) * 3 * fallP;
      y =
        soul.y0 -
        DENIED_RISE_PX * easeOutCubic(riseP) +
        (DENIED_RISE_PX + 14) * easeInOutCubic(fallP);
      r = (4 + 5 * easeOutCubic(riseP)) * (1 - fallP * 0.85);
      alpha = Math.min(1, progress * 3) * (1 - fallP * fallP);
    } else if (age < RELEASE_MS) {
      stage = SOUL_RELEASE;
      progress = age / RELEASE_MS;
      const p = easeOutCubic(progress);
      x = soul.x0;
      y = soul.y0 - RELEASE_RISE_PX * p;
      r = 4 + 7 * p;
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
      r = 11;
      alpha = 1;
    } else {
      stage = SOUL_ABSORB;
      progress = (age - RELEASE_MS - JOURNEY_MS) / ABSORB_MS;
      const p = easeOutCubic(progress);
      x = st.motifX;
      y = st.motifY;
      r = 11 * (1 - p);
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
    m.pid = soul.pid;
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
    m.executed = soul.executed;
    for (let i = 0; i < TRAIL_N; i++) {
      m.trailX[i] = soul.trailX[i]!;
      m.trailY[i] = soul.trailY[i]!;
    }
    m.trailHead = soul.trailHead;
    m.trailLen = soul.trailLen;
  }
  return n;
}

// ── Reward shards + spawn-in uploads (producers) ──────────────────────────

export type ShardRenderModel = {
  x: number;
  y: number;
  /** Visual scale 0.75..1.45. */
  size: number;
  alpha: number;
  /** Sparkle phase (radians) — painter glints on it. */
  glint: number;
  /** >0 while pinging at the target (0..1 envelope). */
  arriveT: number;
  targetX: number;
  targetY: number;
};

function blankShard(): ShardRenderModel {
  return { x: 0, y: 0, size: 1, alpha: 1, glint: 0, arriveT: 0, targetX: 0, targetY: 0 };
}

/**
 * Integrate shard flight: explosive free flight (gravity), then a homing
 * lock onto the target's LIVE position (state lookup — deterministic in
 * replay because the state evolution is). Arrival pings, loss fades.
 */
export function produceDeathShards(
  state: WorldState,
  deltaMs: number,
  st: DeathFxState,
  out: ShardRenderModel[],
): number {
  let n = 0;
  const dt = Math.min(0.05, deltaMs / 1000);
  for (const sh of st.shards) {
    if (!sh.active) continue;
    sh.ageMs += deltaMs;
    if (sh.ageMs >= SHARD_MAX_MS) {
      sh.active = false;
      continue;
    }
    const target = state.players[sh.targetId as PlayerId];
    if (!target || !target.alive) sh.targetLost = true;

    let arriveT = 0;
    if (sh.arrivedAtMs >= 0) {
      const p = (sh.ageMs - sh.arrivedAtMs) / SHARD_PING_MS;
      if (p >= 1) {
        sh.active = false;
        continue;
      }
      arriveT = p;
      if (target) {
        sh.x = target.x;
        sh.y = target.y;
      }
    } else if (sh.targetLost) {
      // No home to fly to: drift and fade.
      sh.vy += SHARD_GRAVITY * dt * 0.4;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
    } else if (sh.ageMs < SHARD_HOLD_MS) {
      sh.vy += SHARD_GRAVITY * dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
    } else if (target) {
      // Homing: steer hard toward the live target, speed ramping with age.
      const dx = target.x - sh.x;
      const dy = target.y - sh.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < SHARD_ARRIVE_PX) {
        sh.arrivedAtMs = sh.ageMs;
      } else {
        const chase = 1400 + (sh.ageMs - SHARD_HOLD_MS) * 3;
        sh.vx += (dx / dist) * chase * dt;
        sh.vy += (dy / dist) * chase * dt;
        const sp = Math.sqrt(sh.vx * sh.vx + sh.vy * sh.vy) || 1;
        const max = 950;
        if (sp > max) {
          sh.vx = (sh.vx / sp) * max;
          sh.vy = (sh.vy / sp) * max;
        }
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
      }
    }

    if (n >= out.length) out.push(blankShard());
    const m = out[n]!;
    n += 1;
    m.x = sh.x;
    m.y = sh.y;
    m.size = sh.size;
    m.alpha = sh.targetLost ? Math.max(0, 1 - (sh.ageMs - SHARD_HOLD_MS) / 500) : 1;
    m.glint = sh.seed + sh.ageMs / 90;
    m.arriveT = arriveT;
    m.targetX = target?.x ?? sh.x;
    m.targetY = target?.y ?? sh.y;
  }
  return n;
}

export type UploadRenderModel = {
  x: number;
  y: number;
  /** 0..1 through the upload. */
  progress: number;
  seed: number;
};

function blankUpload(): UploadRenderModel {
  return { x: 0, y: 0, progress: 0, seed: 0 };
}

/**
 * Spawn-in: the "digital gnostic upload" — spirit streams into the vessel.
 * State-driven (alive false→true, or a new player appearing alive), so it
 * fires for round respawns, match start, and mid-match joins — and appears
 * in replays with no event plumbing.
 */
export function produceSpawnFx(
  state: WorldState,
  deltaMs: number,
  st: DeathFxState,
  out: UploadRenderModel[],
): number {
  // Detect spawn-ins.
  for (const pid in state.players) {
    const p = state.players[pid as PlayerId]!;
    const prev = st.prevAlive.get(pid);
    if (p.alive && prev !== true) {
      let up = st.uploads.find((u) => !u.active);
      if (!up) up = st.uploads.reduce((a, b) => (a.ageMs >= b.ageMs ? a : b));
      up.active = true;
      up.pid = pid;
      up.ageMs = 0;
      up.seed = (((state.tick + idHash(pid)) % 1024) / 1024) * Math.PI * 2;
    }
    st.prevAlive.set(pid, p.alive);
  }
  // Prune departed players from the alive memory.
  const stale = st.staleScratch;
  stale.length = 0;
  for (const pid of st.prevAlive.keys()) {
    if (!(pid in state.players)) stale.push(pid);
  }
  for (const pid of stale) st.prevAlive.delete(pid);

  let n = 0;
  for (const up of st.uploads) {
    if (!up.active) continue;
    up.ageMs += deltaMs;
    const p = state.players[up.pid as PlayerId];
    if (up.ageMs >= UPLOAD_MS || !p || !p.alive) {
      up.active = false;
      continue;
    }
    if (n >= out.length) out.push(blankUpload());
    const m = out[n]!;
    n += 1;
    m.x = p.x;
    m.y = p.y;
    m.progress = up.ageMs / UPLOAD_MS;
    m.seed = up.seed;
  }
  return n;
}

// ── Storm zone (the shrinking safe circle) ──────────────────────────────
//
// Jake, 2026-07-11: "the big circle... invisible... you just start dying
// with no explanation." computeStormZone (sim/suddenDeath.ts) is the SAME
// pure geometry that damages players — this producer wraps it as a render
// model so the boundary drawn is bit-identical to the one that hurts you,
// in every context (live, phone, replay clips).

export type StormZoneRenderModel = {
  active: boolean;
  centerX: number;
  centerY: number;
  radius: number;
  /** 1.0 = full arena (safe) → shrinks toward the mechanic's end scale. */
  scale: number;
  kind: "endgame" | "sudden-death";
};

export function makeStormZoneModel(): StormZoneRenderModel {
  return { active: false, centerX: 0, centerY: 0, radius: 0, scale: 1, kind: "endgame" };
}

/** Fills `out` in place (single model, no pool — one zone exists at most). */
export function produceStormZone(
  state: WorldState,
  mapSize: { x: number; y: number },
  out: StormZoneRenderModel,
): void {
  const zone = computeStormZone(state.round, mapSize);
  out.active = zone !== null;
  if (zone) {
    out.centerX = zone.centerX;
    out.centerY = zone.centerY;
    out.radius = zone.radius;
    out.scale = zone.scale;
    out.kind = zone.kind;
  }
}
