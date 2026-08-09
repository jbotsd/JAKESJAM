// Debug state-probe harness. Exposes deterministic-state observability
// on the global window so Playwright (and any other external tool) can
// pull a stable hash of the current WorldState without forking sim
// internals or depending on Phaser GameObject layout.
//
// The probe is install-once + register-when-active:
//
//   - main.ts calls `installWindowProbe()` at boot to wire the globals.
//   - Each scene that owns a WorldState calls `setActiveStateGetter(fn)`
//     when it starts, and `setActiveStateGetter(null)` when it stops.
//   - When no scene owns state, all probe calls return null.
//
// Globals exposed:
//   window.__simStateHash() : number | null   -- 32-bit FNV1a-mix
//   window.__simStepNo()    : number | null   -- current tick
//   window.__simHasState()  : boolean         -- true if a getter is live
//
// Used by: tests/e2e/gameplay.spec.ts, tests/e2e/long-horizon.spec.ts,
// tests/e2e/multi-client.spec.ts.

import { hashWorldStateLite } from "../sim/hash.js";
import { World } from "../sim/index.js";
import type { InputFrame, PlayerId, WorldState } from "../sim/types.js";

let activeStateGetter: (() => WorldState | null) | null = null;
let activeCameraGetter: (() => { scrollX: number; scrollY: number } | null) | null = null;
let activeRigDebugGetter: (() => RigDebugRow[] | null) | null = null;
let activeNetStatsGetter: (() => Record<string, unknown> | null) | null = null;
let activeLocalPlayerIdGetter: (() => string | null) | null = null;

/** gospel 4.6 — the killfeed's CURRENT visible lines, as plain strings.
 *  Exposed for the same reason the sim probes are: a killfeed is only
 *  observable for a few seconds after a kill, so a screenshot cannot prove
 *  it works and absence cannot prove it does not. */
let activeKillfeedGetter: (() => string[]) | null = null;

export function setKillfeedGetter(fn: (() => string[]) | null): void {
  activeKillfeedGetter = fn;
}

/** Renderer-side truth for probes: where each player rig ACTUALLY is on
 *  screen and whether it's visible. Catches "sim says alive at (x,y) but
 *  nothing rendered" bugs that state sampling alone can't see. */
/** A destructible as the probe reports it — enough to find the nearest
 *  practice dummy and watch its health. */
export type ProbeDestructible = {
  id: string;
  kind: string;
  x: number;
  y: number;
  health: number;
};

export type RigDebugRow = {
  pid: string;
  visible: boolean;
  /** Rig world position as last drawn. */
  x: number;
  y: number;
  /** Matching sim-state position (post-smoothing render state). */
  stateX: number | null;
  stateY: number | null;
  alive: boolean | null;
  danceEnergy: number;
  idleDanceMs: number;
  danceRaise: number;
  /** Victim-channel live state (slash-feel-ledger R1 rows 3-8) — null when
   *  no melee impact chord is speaking on this rig. Additive/optional so
   *  older probe consumers keep reading rows unchanged. */
  impact?: {
    role: "attacker" | "victim";
    chassis: "interstice" | "kindled";
    kill: boolean;
    holdMs: number;
    holdTotalMs: number;
    elapsedMs: number | null;
    flashK: number;
    squashX: number;
    squashY: number;
    flinchX: number;
    flinchY: number;
  } | null;
};

const FNV1A_PRIME_32 = 0x01000193;
const FNV1A_BASIS_32 = 0x811c9dc5;

function mixU32(hash: number, v: number): number {
  return Math.imul(hash ^ (v >>> 0), FNV1A_PRIME_32) >>> 0;
}

function combineHash(state: WorldState): number {
  const lite = hashWorldStateLite(state);
  let h = FNV1A_BASIS_32;
  h = mixU32(h, state.tick | 0);
  // Sort keys so iteration order is stable across V8 versions /
  // map-deletion patterns.
  const playerIds = Object.keys(lite.players).sort();
  for (const pid of playerIds) {
    h = mixU32(h, lite.players[pid as keyof typeof lite.players] ?? 0);
  }
  const projIds = Object.keys(lite.projectiles).sort();
  for (const eid of projIds) {
    h = mixU32(h, lite.projectiles[+eid as keyof typeof lite.projectiles] ?? 0);
  }
  return h >>> 0;
}

export function setActiveStateGetter(
  fn: (() => WorldState | null) | null,
): void {
  activeStateGetter = fn;
}

/** Camera scroll for probes that need world -> screen mapping (combat
 *  probe aims the mouse at another player's rendered position). */
export function setActiveCameraGetter(
  fn: (() => { scrollX: number; scrollY: number } | null) | null,
): void {
  activeCameraGetter = fn;
}

export function setActiveRigDebugGetter(
  fn: (() => RigDebugRow[] | null) | null,
): void {
  activeRigDebugGetter = fn;
}

export function setActiveNetStatsGetter(
  fn: (() => Record<string, unknown> | null) | null,
): void {
  activeNetStatsGetter = fn;
}

/** Ground truth for "which entity does this scene believe is mine" —
 *  window.__localPlayerId(). Diagnostic for identity/rig-binding bugs: if
 *  this doesn't match the entity whose position responds to your own key
 *  presses, the camera/rig/HUD are bound to the wrong player. */
export function setActiveLocalPlayerIdGetter(fn: (() => string | null) | null): void {
  activeLocalPlayerIdGetter = fn;
}

/** Combat-relevant per-player snapshot for probes (combat-probe.mjs,
 *  Playwright specs). Everything needed to assert "damage happened",
 *  "shield is up", "parry fired" from outside the page. */
export type ProbePlayer = {
  id: string;
  x: number;
  y: number;
  health: number;
  alive: boolean;
  shieldActive: boolean;
  shieldCharge: number | undefined;
  parryActive: boolean;
  weaponId: string;
  score: number;
  fireCooldownMs: number;
  ammo: number;
  cards: string[];
  pendingLockCharges: number | undefined;
};

type ProbeWindow = {
  __simStateHash?: () => number | null;
  __simStepNo?: () => number | null;
  __simHasState?: () => boolean;
  __simSampleHashes?: (count: number, intervalMs: number) => Promise<number[]>;
  __simPlayers?: () => ProbePlayer[] | null;
  __simDestructibles?: () => ProbeDestructible[] | null;
  __simPhase?: () => string | null;
  __simProjectiles?: () =>
    | {
        id: number;
        x: number;
        y: number;
        ownerId: string | null;
        pathing: string | undefined;
        homingStrength: number | undefined;
        damage: number;
      }[]
    | null;
  __simCamera?: () => { scrollX: number; scrollY: number } | null;
  __simRound?: () => {
    phase: string;
    remainingMs: number;
    winner: string | null;
    roundIndex: number;
  } | null;
  __rigDebug?: () => RigDebugRow[] | null;
  __localPlayerId?: () => string | null;
  __killfeedLines?: () => string[] | null;
  __netStats?: () => Record<string, unknown> | null;
};

export function installWindowProbe(): void {
  const w = window as unknown as ProbeWindow;
  w.__simStateHash = () => {
    const s = activeStateGetter?.();
    if (!s) return null;
    return combineHash(s);
  };
  w.__simStepNo = () => {
    const s = activeStateGetter?.();
    return s ? (s.tick | 0) : null;
  };
  w.__simHasState = () => activeStateGetter?.() != null;
  // venue-goal Pillar 2.5 needs "load -> dummy-hit-possible" measured, and
  // its Evidence Ledger notes no dummy/hit metric is captured anywhere. A
  // hit is only observable as a destructible's health falling, so the probe
  // has to expose destructibles for the e2e to time it. Same read-only,
  // no-identity shape as __simPlayers.
  w.__simDestructibles = () => {
    const s = activeStateGetter?.();
    if (!s) return null;
    return Object.values(s.destructibles ?? {}).map((d) => ({
      id: String(d.id),
      kind: String((d as { kind?: string }).kind ?? "box"),
      x: d.x,
      y: d.y,
      health: d.health,
    }));
  };
  w.__simPlayers = () => {
    const s = activeStateGetter?.();
    if (!s) return null;
    return Object.values(s.players).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      health: p.health,
      alive: p.alive,
      shieldActive: p.shieldActive,
      shieldCharge: p.shieldCharge,
      parryActive:
        p.parryActiveUntilTick !== undefined &&
        p.parryActiveUntilTick > s.tick,
      weaponId: p.weaponId,
      score: s.round.scores[p.id] ?? 0,
      fireCooldownMs: p.fireCooldownMs,
      ammo: p.ammo,
      cards: p.cards,
      pendingLockCharges: p.pendingLockCharges,
    }));
  };
  w.__simPhase = () => {
    const s = activeStateGetter?.();
    return s ? s.round.phase : null;
  };
  w.__simProjectiles = () => {
    const s = activeStateGetter?.();
    if (!s) return null;
    return Object.values(s.projectiles).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      ownerId: p.ownerId,
      pathing: p.pathing,
      homingStrength: p.homingStrength,
      damage: p.damage,
    }));
  };
  w.__simCamera = () => activeCameraGetter?.() ?? null;
  // Debug: run one World.step in-page on an arbitrary state — lets an
  // external probe compare the BUNDLED sim's behavior against the same
  // step executed in bun with identical inputs (desync bisection).
  (w as Record<string, unknown>).__simStepDebug = (
    stateJson: string,
    inputJson: string,
  ): string => {
    const st = JSON.parse(stateJson) as WorldState;
    const input = JSON.parse(inputJson) as InputFrame & { playerId: string };
    const inputs: Record<PlayerId, InputFrame | null> = {};
    inputs[input.playerId as PlayerId] = input;
    const r = World.step(st, inputs, 1000 / 60);
    return JSON.stringify({
      phase: r.state.round.phase,
      winner: r.state.round.winnerPlayerId,
      alive: Object.values(r.state.players).filter((p) => p.alive).length,
      events: r.events.map((e) => e.t),
    });
  };
  w.__simRound = () => {
    const s = activeStateGetter?.();
    if (!s) return null;
    return {
      phase: s.round.phase,
      remainingMs: s.round.countdownRemainingMs,
      winner: s.round.winnerPlayerId,
      roundIndex: s.round.roundIndex,
    };
  };
  w.__rigDebug = () => activeRigDebugGetter?.() ?? null;
  w.__netStats = () => activeNetStatsGetter?.() ?? null;
  w.__localPlayerId = () => activeLocalPlayerIdGetter?.() ?? null;
  // null = no feed has registered yet (wrong scene, or never constructed);
  // [] = a feed exists and currently shows nothing. Collapsing those two
  // into [] made the first live check unreadable.
  w.__killfeedLines = () => (activeKillfeedGetter ? activeKillfeedGetter() : null);
  w.__simSampleHashes = async (count, intervalMs) => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const s = activeStateGetter?.();
      if (s) out.push(combineHash(s));
      else out.push(0);
      if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    return out;
  };
}
