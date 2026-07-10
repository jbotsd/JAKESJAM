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
