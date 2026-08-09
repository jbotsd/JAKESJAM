// Server-authoritative arena spectator director.
// Pure: WorldState + SimEvents + prior DirectorState → next pose.
// MatchHost steps this every tick and piggybacks the pose on snapshots so
// stream/broadcast clients all frame the same fight (esports "observer cam").
//
// Design goals (perfect arena spectator):
//  1. Prefer live duels (close + aggression) over empty map panning
//  2. Hold a kill beat ~1s without thrashing to the next fight
//  3. Pull wide when action is spread / quiet (read the whole vault)
//  4. Sticky subjects + min dwell so the hand never feels epileptic
//  5. Deterministic given state+events+prior — no Math.random

import type { PlayerEntity, PlayerId, SimEvent, WorldState } from "./types.js";

export type SpectatorMode = "overview" | "duel" | "kill" | "chaos";

/** Wire + runtime pose. Compact for snapshot piggyback. */
export type SpectatorCamPose = {
  x: number;
  y: number;
  /** Absolute Phaser zoom target (1 = native; desktop play is ~1.4). */
  z: number;
  mode: SpectatorMode;
  /** Optional sticky focus ids for client juice / debug HUD. */
  a?: string;
  b?: string;
};

export type DirectorState = {
  /** Smoothed centre (world px). */
  x: number;
  y: number;
  z: number;
  mode: SpectatorMode;
  focusA: string | null;
  focusB: string | null;
  /** Ticks remaining before mode may freely switch (except kill override). */
  dwellTicks: number;
  /** Kill hold: world point + ticks left. */
  killX: number;
  killY: number;
  killTicks: number;
  ready: boolean;
  /** Consecutive ticks the FRAMED subject(s) have been ~motionless.
   *  Footage finding S2 (docs/clip-sheets/study-2026-08-05-jul31-replay.md,
   *  HIGH): the director framed an idle bot alone for 6-8 s at a stretch.
   *  `pairScore` does weight speed, but closeness (x1.6) plus low HP can
   *  clear the duel threshold with ZERO movement, and the single-survivor
   *  branch frames a player regardless of motion — so nothing capped how
   *  long a still subject could hold the camera. */
  idleTicks: number;
};

export const DIRECTOR_VIEW_W = 1920;
export const DIRECTOR_VIEW_H = 1080;
/** Base crop for a single duel (tighter than overview). */
export const DIRECTOR_BASE_ZOOM = 1.22;
export const DIRECTOR_MIN_ZOOM = 0.72;
export const DIRECTOR_MAX_ZOOM = 1.55;
/** Soft map pad so framing never hugs walls. */
export const DIRECTOR_MAP_PAD = 80;

const TICK_HZ = 60;
const KILL_HOLD_TICKS = Math.round(1.15 * TICK_HZ);
const MIN_DWELL_TICKS = Math.round(1.6 * TICK_HZ);
const DUEL_RANGE = 780;
const CHAOS_CLUSTER = 920;
const PAIR_SCORE_CLOSE = 520;
/** Speed (px/s) below which a framed subject counts as motionless. Generous
 *  — this is "is anything happening", not "is it perfectly still". */
const IDLE_SPEED = 26;
/** How long the camera may hold a motionless subject before it must cut
 *  (footage S2). 1.5 s: longer than the natural pauses between exchanges,
 *  well under the 6-8 s dwells that were filmed, and above MIN_DWELL_TICKS
 *  so it can never fight ordinary mode stickiness. */
const IDLE_DWELL_CAP = Math.round(1.5 * TICK_HZ);

export function createDirectorState(): DirectorState {
  return {
    x: 1500,
    y: 550,
    z: DIRECTOR_BASE_ZOOM,
    mode: "overview",
    focusA: null,
    focusB: null,
    dwellTicks: 0,
    killX: 0,
    killY: 0,
    killTicks: 0,
    ready: false,
    idleTicks: 0,
  };
}

type Alive = { id: string; x: number; y: number; vx: number; vy: number; hp: number };

function collectAlive(state: WorldState): Alive[] {
  const out: Alive[] = [];
  for (const [id, p] of Object.entries(state.players) as Array<[string, PlayerEntity]>) {
    if (!p?.alive) continue;
    out.push({
      id,
      x: p.x,
      y: p.y,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      hp: p.health ?? 0,
    });
  }
  // Stable order for determinism across hosts.
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Default mapGen arena (3000×1100). Host can pass real map size via opts. */
export type DirectorBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export function defaultDirectorBounds(
  mapW = 3000,
  mapH = 1100,
): DirectorBounds {
  return {
    minX: DIRECTOR_MAP_PAD,
    maxX: mapW - DIRECTOR_MAP_PAD,
    minY: DIRECTOR_MAP_PAD,
    maxY: mapH - DIRECTOR_MAP_PAD,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function expSmooth(cur: number, target: number, k: number, dt: number): number {
  const a = 1 - Math.exp(-k * dt);
  return cur + (target - cur) * a;
}

/** Score a fight pair: closer + lower HP + high relative speed = more watchable. */
function pairScore(a: Alive, b: Alive): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d > DUEL_RANGE * 1.35) return 0;
  const closeness = 1 - clamp(d / DUEL_RANGE, 0, 1);
  const speed =
    Math.hypot(a.vx - b.vx, a.vy - b.vy) / 900 +
    Math.hypot(a.vx, a.vy) / 1400 +
    Math.hypot(b.vx, b.vy) / 1400;
  const blood = (1 - clamp(a.hp / 100, 0, 1)) * 0.35 + (1 - clamp(b.hp / 100, 0, 1)) * 0.35;
  // Soft boost when very close (melee / point blank).
  const pointBlank = d < PAIR_SCORE_CLOSE ? 0.35 : 0;
  return closeness * 1.6 + clamp(speed, 0, 1.2) * 0.55 + blood + pointBlank;
}

function bestPair(alive: Alive[]): { a: Alive; b: Alive; score: number } | null {
  if (alive.length < 2) return null;
  let best: { a: Alive; b: Alive; score: number } | null = null;
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i]!;
      const b = alive[j]!;
      const score = pairScore(a, b);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { a, b, score };
    }
  }
  return best;
}

function clusterCentre(alive: Alive[]): { x: number; y: number; count: number; radius: number } {
  if (alive.length === 0) return { x: 1500, y: 550, count: 0, radius: 0 };
  // Density peak: for each player, count others within CHAOS_CLUSTER, pick densest seed.
  let bestSeed = alive[0]!;
  let bestN = 0;
  for (const seed of alive) {
    let n = 0;
    for (const o of alive) {
      if (Math.hypot(o.x - seed.x, o.y - seed.y) <= CHAOS_CLUSTER) n++;
    }
    if (n > bestN || (n === bestN && seed.id < bestSeed.id)) {
      bestN = n;
      bestSeed = seed;
    }
  }
  let sx = 0;
  let sy = 0;
  let c = 0;
  let maxR = 0;
  for (const o of alive) {
    const d = Math.hypot(o.x - bestSeed.x, o.y - bestSeed.y);
    if (d > CHAOS_CLUSTER) continue;
    sx += o.x;
    sy += o.y;
    c++;
    if (d > maxR) maxR = d;
  }
  if (c === 0) return { x: bestSeed.x, y: bestSeed.y, count: 1, radius: 0 };
  return { x: sx / c, y: sy / c, count: c, radius: maxR };
}

function overviewCentre(alive: Alive[]): { x: number; y: number; halfW: number; halfH: number } {
  if (alive.length === 0) return { x: 1500, y: 550, halfW: 900, halfH: 400 };
  let minX = alive[0]!.x;
  let maxX = alive[0]!.x;
  let minY = alive[0]!.y;
  let maxY = alive[0]!.y;
  for (const p of alive) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Margin so bodies aren't on the crop edge.
  const padX = 220;
  const padY = 180;
  const halfW = (maxX - minX) / 2 + padX;
  const halfH = (maxY - minY) / 2 + padY;
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    halfW: Math.max(halfW, 420),
    halfH: Math.max(halfH, 280),
  };
}

function zoomToFit(halfW: number, halfH: number): number {
  const zx = DIRECTOR_VIEW_W / (2 * Math.max(1, halfW));
  const zy = DIRECTOR_VIEW_H / (2 * Math.max(1, halfH));
  return clamp(Math.min(zx, zy), DIRECTOR_MIN_ZOOM, DIRECTOR_MAX_ZOOM);
}

function applyKillEvents(
  dir: DirectorState,
  events: ReadonlyArray<SimEvent>,
  state: WorldState,
): DirectorState {
  let next = dir;
  for (const e of events) {
    if (e.t !== "player-killed" && e.t !== "first-blood") continue;
    let x = dir.x;
    let y = dir.y;
    if (e.t === "player-killed") {
      const victim = state.players[e.victimId as PlayerId];
      const killer = e.killerId ? state.players[e.killerId as PlayerId] : null;
      if (victim) {
        x = victim.x;
        y = victim.y;
      }
      // Prefer mid-point of kill exchange when both bodies exist.
      if (victim && killer) {
        x = (victim.x + killer.x) / 2;
        y = (victim.y + killer.y) / 2;
      }
    } else if (e.t === "first-blood") {
      const p = state.players[e.playerId as PlayerId];
      if (p) {
        x = p.x;
        y = p.y;
      }
    }
    next = {
      ...next,
      killX: x,
      killY: y,
      killTicks: KILL_HOLD_TICKS,
      mode: "kill",
      dwellTicks: KILL_HOLD_TICKS,
    };
  }
  // Hit spikes lightly extend kill interest if already in a fight.
  for (const e of events) {
    if (e.t !== "hit-confirmed") continue;
    if (next.killTicks > 0) {
      next = { ...next, killTicks: Math.min(KILL_HOLD_TICKS, next.killTicks + 8) };
    }
  }
  return next;
}

/**
 * Advance director by one sim tick. `dtSec` is usually STEP_MS/1000.
 * Events are the events produced THIS tick (or flushed window — mild hold bias is fine).
 */
export function stepSpectatorDirector(
  prev: DirectorState,
  state: WorldState,
  events: ReadonlyArray<SimEvent>,
  dtSec = 1 / 60,
  bounds: DirectorBounds = defaultDirectorBounds(),
): DirectorState {
  let dir = applyKillEvents(prev, events, state);
  if (dir.dwellTicks > 0) dir = { ...dir, dwellTicks: dir.dwellTicks - 1 };
  if (dir.killTicks > 0) dir = { ...dir, killTicks: dir.killTicks - 1 };

  const alive = collectAlive(state);
  const pair = bestPair(alive);
  const cluster = clusterCentre(alive);
  const overview = overviewCentre(alive);

  // Desired mode (kill overrides while hold active).
  let wantMode: SpectatorMode = "overview";
  let tx = overview.x;
  let ty = overview.y;
  let halfW = overview.halfW;
  let halfH = overview.halfH;
  let focusA: string | null = null;
  let focusB: string | null = null;

  if (dir.killTicks > 0) {
    wantMode = "kill";
    tx = dir.killX;
    ty = dir.killY;
    halfW = 380;
    halfH = 260;
    focusA = dir.focusA;
    focusB = dir.focusB;
  } else if (pair && pair.score >= 0.85) {
    wantMode = "duel";
    tx = (pair.a.x + pair.b.x) / 2;
    ty = (pair.a.y + pair.b.y) / 2;
    // Lead a bit toward the more aggressive / lower HP fighter's velocity.
    const lead = 0.12;
    tx += ((pair.a.vx + pair.b.vx) / 2) * lead;
    ty += ((pair.a.vy + pair.b.vy) / 2) * lead * 0.55;
    const spanX = Math.abs(pair.a.x - pair.b.x) / 2 + 280;
    const spanY = Math.abs(pair.a.y - pair.b.y) / 2 + 220;
    halfW = Math.max(spanX, 340);
    halfH = Math.max(spanY, 240);
    focusA = pair.a.id;
    focusB = pair.b.id;
  } else if (cluster.count >= 3 && cluster.radius < CHAOS_CLUSTER) {
    wantMode = "chaos";
    tx = cluster.x;
    ty = cluster.y;
    halfW = Math.max(cluster.radius + 300, 520);
    halfH = Math.max(cluster.radius * 0.7 + 240, 320);
    focusA = null;
    focusB = null;
  } else if (alive.length === 1) {
    wantMode = "duel";
    tx = alive[0]!.x + alive[0]!.vx * 0.1;
    ty = alive[0]!.y + alive[0]!.vy * 0.06;
    halfW = 420;
    halfH = 300;
    focusA = alive[0]!.id;
    focusB = null;
  }

  // FOOTAGE S2 — the idle dwell cap. Measure the subject(s) this frame
  // WOULD hold; if the camera has been sitting on stillness past the cap,
  // cut. A kill hold is exempt: that beat is the one time a motionless
  // frame is the point.
  const framedSpeed = (() => {
    const ids = [focusA, focusB].filter((id): id is string => id !== null);
    if (ids.length > 0) {
      let sum = 0;
      for (const id of ids) {
        const p = alive.find((q) => q.id === id);
        if (p) sum += Math.hypot(p.vx, p.vy);
      }
      return sum;
    }
    // No focus (overview/chaos): measure whether ANYTHING in the match is
    // moving. Reporting "infinitely lively" here instead made the cap
    // oscillate — it cut to overview, immediately forgot the room was
    // still, re-picked the same motionless subject, and cut again every
    // 1.5 s. A metronome is not better direction than a stare.
    let max = 0;
    for (const p of alive) max = Math.max(max, Math.hypot(p.vx, p.vy));
    return max;
  })();
  let nextIdle = framedSpeed < IDLE_SPEED ? dir.idleTicks + 1 : 0;
  // Set when the cap re-aims at a different SUBJECT. The normal dwell is
  // keyed on MODE, and a cut from "duel on a statue" to "duel on the
  // runner" does not change the mode — so without this the very next frame
  // re-picked the statue (pairScore rewards closeness + low HP over motion)
  // and the cut lasted a single frame.
  let capForcedDwell = false;
  if (wantMode !== "kill" && nextIdle > IDLE_DWELL_CAP) {
    // Prefer cutting to whoever is actually doing something; if nobody is,
    // a wide shot is the honest frame — and it reads as a deliberate
    // establishing beat instead of a stare.
    const liveliest = alive.reduce<Alive | null>((best, p) => {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp < IDLE_SPEED) return best;
      if (!best || sp > Math.hypot(best.vx, best.vy)) return p;
      return best;
    }, null);
    if (liveliest && liveliest.id !== focusA) {
      wantMode = "duel";
      tx = liveliest.x + liveliest.vx * 0.1;
      ty = liveliest.y + liveliest.vy * 0.06;
      halfW = 420;
      halfH = 300;
      focusA = liveliest.id;
      focusB = null;
      // Real action found — the cap did its job, start the clock over.
      nextIdle = 0;
      capForcedDwell = true;
    } else {
      wantMode = "overview";
      tx = overview.x;
      ty = overview.y;
      halfW = overview.halfW;
      halfH = overview.halfH;
      focusA = null;
      focusB = null;
      // Deliberately NOT resetting nextIdle: nothing is happening, so HOLD
      // the wide shot instead of bouncing back to a still subject.
    }
    // Clear the sticky dwell so the cut actually happens this frame.
    dir = { ...dir, dwellTicks: 0 };
  }

  // SUBJECT stickiness (footage S2's other half). The dwell above protects
  // the MODE, not the subject, so "duel on the runner" -> "duel on the
  // statue" was never blocked: pairScore rewards closeness and low HP over
  // motion, so the frame after any cut the camera drifted straight back to
  // whoever was standing closest to a wounded neighbour. Rule: while a dwell
  // is active, never trade a MOVING subject for a still one.
  if (
    dir.ready &&
    dir.dwellTicks > 0 &&
    wantMode === "duel" &&
    dir.mode === "duel" &&
    dir.focusA &&
    focusA !== dir.focusA
  ) {
    const held = alive.find((p) => p.id === dir.focusA);
    const proposedSpeed = focusA
      ? (() => {
          const p = alive.find((q) => q.id === focusA);
          return p ? Math.hypot(p.vx, p.vy) : 0;
        })()
      : 0;
    if (held && Math.hypot(held.vx, held.vy) >= IDLE_SPEED && proposedSpeed < IDLE_SPEED) {
      const b = dir.focusB ? alive.find((p) => p.id === dir.focusB) : undefined;
      focusA = held.id;
      focusB = b ? b.id : null;
      tx = b ? (held.x + b.x) / 2 : held.x + held.vx * 0.1;
      ty = b ? (held.y + b.y) / 2 : held.y + held.vy * 0.06;
      halfW = b ? Math.max(Math.abs(held.x - b.x) / 2 + 280, 340) : 420;
      halfH = b ? Math.max(Math.abs(held.y - b.y) / 2 + 220, 240) : 300;
      nextIdle = 0;
    }
  }

  // Mode stickiness: don't switch mid-dwell unless kill or clearly better duel.
  if (dir.ready && dir.dwellTicks > 0 && wantMode !== "kill" && dir.mode !== "kill") {
    if (wantMode !== dir.mode) {
      // Keep previous mode framing; recompute from sticky foci if duel.
      wantMode = dir.mode;
      if (dir.mode === "duel" && dir.focusA) {
        const a = alive.find((p) => p.id === dir.focusA);
        const b = dir.focusB ? alive.find((p) => p.id === dir.focusB) : undefined;
        if (a && b) {
          tx = (a.x + b.x) / 2;
          ty = (a.y + b.y) / 2;
          halfW = Math.max(Math.abs(a.x - b.x) / 2 + 280, 340);
          halfH = Math.max(Math.abs(a.y - b.y) / 2 + 220, 240);
          focusA = a.id;
          focusB = b.id;
        } else if (a) {
          tx = a.x;
          ty = a.y;
          focusA = a.id;
          focusB = null;
        }
      } else if (dir.mode === "chaos") {
        tx = cluster.x;
        ty = cluster.y;
        halfW = Math.max(cluster.radius + 300, 520);
        halfH = Math.max(cluster.radius * 0.7 + 240, 320);
      } else {
        tx = overview.x;
        ty = overview.y;
        halfW = overview.halfW;
        halfH = overview.halfH;
      }
    }
  }

  let nextDwell = dir.dwellTicks;
  if (!dir.ready || (wantMode !== dir.mode && dir.dwellTicks <= 0)) {
    nextDwell = MIN_DWELL_TICKS;
  }
  // A subject-only cut needs its own dwell, or it lasts one frame (above).
  if (capForcedDwell) nextDwell = MIN_DWELL_TICKS;

  const wantZ = zoomToFit(halfW, halfH);
  // Snap on first frame; thereafter exp-smooth (cinematic hand).
  let x: number;
  let y: number;
  let z: number;
  if (!dir.ready) {
    x = tx;
    y = ty;
    z = wantZ;
  } else {
    // Kill pops: faster snap-in so the beat lands.
    const kPos = wantMode === "kill" ? 7.5 : wantMode === "duel" ? 4.2 : 3.1;
    const kZoom = wantMode === "kill" ? 4.0 : 2.4;
    x = expSmooth(dir.x, tx, kPos, dtSec);
    y = expSmooth(dir.y, ty, kPos, dtSec);
    z = expSmooth(dir.z, wantZ, kZoom, dtSec);
  }

  x = clamp(x, bounds.minX, bounds.maxX);
  y = clamp(y, bounds.minY, bounds.maxY);
  z = clamp(z, DIRECTOR_MIN_ZOOM, DIRECTOR_MAX_ZOOM);

  return {
    x,
    y,
    z,
    mode: wantMode,
    focusA,
    focusB,
    dwellTicks: nextDwell,
    killX: dir.killX,
    killY: dir.killY,
    killTicks: dir.killTicks,
    ready: true,
    idleTicks: nextIdle,
  };
}

export function directorToPose(dir: DirectorState): SpectatorCamPose {
  const pose: SpectatorCamPose = {
    x: Math.round(dir.x * 10) / 10,
    y: Math.round(dir.y * 10) / 10,
    z: Math.round(dir.z * 1000) / 1000,
    mode: dir.mode,
  };
  if (dir.focusA) pose.a = dir.focusA;
  if (dir.focusB) pose.b = dir.focusB;
  return pose;
}
