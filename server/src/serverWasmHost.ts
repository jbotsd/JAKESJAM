// Phase B3 prep — server-side analog of client's `wasmHost`.
// Owns the wasm sim instance loaded via Bun's WebAssembly +
// statics cache + per-tick input stash + step. Mirrors the
// public surface of `client/src/sim/wasm/wasmHost.ts` so a future
// B3-actual cut can swap `matchHost.stepWithRuntime(...)` for
// `serverWasmHost.step(...)` cleanly.
//
// This file is the FOUNDATION cut. It does NOT yet replace
// `stepWithRuntime` in matchHost — that's a separate change
// gated on a 30-min multi-client playtest. Adding the host
// skeleton now lets the test suite + a future flag-driven
// rollout proceed with zero risk to the live server.
//
// Reuses the already-shipped `loadServerSim` loader from
// `wasmRuntime.ts` (which installs the trig LUT for parity).

import type { PlayerId, WorldState } from "@sim/types.ts";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
  type WasmSimEvent,
} from "@sim/wasm/worldStateBridge.ts";
import { loadServerSim } from "./wasmRuntime.ts";
import {
  resolveFireConfigsViaZig,
  type FireConfigResolverExports,
} from "@sim/wasm/fireConfigShared.ts";

/** Same shape as client `StaticAABB`. */
export type StaticAABB = { x: number; y: number; w: number; h: number };

export type PlayerInputBits = {
  keys: number;
  prevKeys: number;
  aimX: number;
  aimY: number;
};

export type WasmStepResult = {
  state: WorldState;
  events: WasmSimEvent[];
  matchComplete: boolean;
};

/**
 * Wasm exports the server actually uses (subset of SimExports).
 * Typed loosely so the cast below stays compact.
 */
type WorldExports = {
  step_world: (state_ptr: number, dt_ms: number) => number;
  world_state_set_statics: (
    state_ptr: number,
    aabbs_ptr: number,
    one_way_ptr: number,
    count: number,
  ) => number;
  offset_player_fire_config?: () => number;
  sizeof_resolved_fire_config?: () => number;
  world_state_set_arena_bounds?: (
    ceiling_y: number,
    has_ceiling: number,
    kill_plane_y: number,
  ) => void;
  world_state_set_map_size?: (width: number, height: number) => void;
  world_state_set_target_score?: (statePtr: number, target: number) => void;
  resolve_player_fire_config?: (
    state_ptr: number,
    player_index: number,
    indices_ptr: number,
    count: number,
  ) => void;
  memory: WebAssembly.Memory;
};

class ServerWasmHost {
  private statePtr: number | null = null;
  private stateLen: number | null = null;
  private ex: WorldExports | null = null;
  private cachedStatics: { aabbs: StaticAABB[]; oneWay: number[] } | null = null;
  private cachedInputs: ReadonlyMap<string, PlayerInputBits> | null = null;
  private cachedArenaBounds: {
    ceilingY: number;
    hasCeiling: number;
    killPlaneY: number;
  } | null = null;
  private cachedMapSize: { width: number; height: number } | null = null;
  private cachedTargetScore: number | null = null;
  private preloadPromise: Promise<void> | null = null;
  private resolvedReady = false;
  private readyResolvers: Array<() => void> = [];
  private readyError: unknown = null;

  /**
   * Load + instantiate sim.wasm via the existing `loadServerSim`
   * helper (which also installs the trig LUT). Idempotent.
   */
  preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      const got = await loadServerSim();
      if (!got) {
        const err = new Error(
          "[server-wasm-host] loadServerSim returned null — sim.wasm could not be loaded server-side",
        );
        this.readyError = err;
        throw err;
      }
      this.ex = got.ex as unknown as WorldExports;
      this.statePtr = got.statePtr;
      this.stateLen = got.stateLen;
      if (typeof this.ex.step_world !== "function") {
        const err = new Error(
          "[server-wasm-host] step_world export missing from sim.wasm — rebuild required",
        );
        this.readyError = err;
        throw err;
      }
      this.resolvedReady = true;
      const resolvers = this.readyResolvers.slice();
      this.readyResolvers.length = 0;
      for (const r of resolvers) r();
    })();
    return this.preloadPromise;
  }

  ready(): Promise<void> {
    if (this.resolvedReady) return Promise.resolve();
    if (this.readyError) return Promise.reject(this.readyError);
    void this.preload();
    return new Promise<void>((resolve, reject) => {
      if (this.resolvedReady) {
        resolve();
        return;
      }
      if (this.readyError) {
        reject(this.readyError);
        return;
      }
      this.readyResolvers.push(resolve);
    });
  }

  isReady(): boolean {
    return this.resolvedReady && this.readyError === null;
  }

  /** Buffered + auto-flushed on next step(). */
  setStatics(aabbs: ReadonlyArray<StaticAABB>, oneWay: ReadonlyArray<number>): void {
    this.cachedStatics = {
      aabbs: aabbs.slice(),
      oneWay: oneWay.slice(),
    };
  }

  writeInputs(inputs: ReadonlyMap<string, PlayerInputBits>): void {
    this.cachedInputs = inputs;
  }

  /** Ceiling-clamp + void kill-plane bounds (World.ts computeCeilingClampY +
   *  map.size.y + KILL_PLANE_MARGIN_PX). Set once per match. */
  setArenaBounds(ceilingY: number | null, killPlaneY: number): void {
    this.cachedArenaBounds = {
      ceilingY: ceilingY ?? 0,
      hasCeiling: ceilingY === null ? 0 : 1,
      killPlaneY,
    };
  }

  /** Map's logical size — needed for the fire-hazard chaos modifier's
   *  position roll (parity with World.ts, which uses runtime.map.size
   *  directly). Must match the client's setMapSize call or fire-hazard
   *  patches predict/reconcile at different positions. */
  setMapSize(width: number, height: number): void {
    this.cachedMapSize = { width, height };
  }

  /** Match win-target. 2026-07-14 fix — see the matching client-side
   *  setWorldTargetScore comment: world_state_set_target_score existed as
   *  an export but nothing ever called it, and packWorldState hardcodes
   *  target_score to 0 every pack anyway, so a one-off call would get
   *  wiped by the next tick. Cached and reapplied every tick like arena
   *  bounds / map size. */
  setTargetScore(target: number): void {
    this.cachedTargetScore = target;
  }

  getStaticsSnapshot(): { aabbs: ReadonlyArray<StaticAABB>; oneWay: ReadonlyArray<number> } | null {
    return this.cachedStatics
      ? { aabbs: this.cachedStatics.aabbs, oneWay: this.cachedStatics.oneWay }
      : null;
  }

  getInputsSnapshot(): ReadonlyMap<string, PlayerInputBits> | null {
    return this.cachedInputs;
  }

  /**
   * Run one wasm tick. Pack → write statics → write inputs →
   * step_world → unpack. Same canonical sequence as client's
   * `runWasmStepSync`.
   *
   * Throws if not ready. Caller should `await ready()` first.
   */
  step(state: WorldState, dtMs: number): WasmStepResult {
    if (!this.resolvedReady || !this.ex || this.statePtr === null) {
      throw new Error(
        "[server-wasm-host] step() called before ready. Await serverWasmHost.ready() first.",
      );
    }
    const ex = this.ex;
    const statePtr = this.statePtr;
    const buf = packWorldState(state);
    if (buf.byteLength !== WORLD_STATE_TOTAL_SIZE) {
      throw new Error(
        `[server-wasm-host] packed buffer size mismatch: ${buf.byteLength} vs ${WORLD_STATE_TOTAL_SIZE}`,
      );
    }
    const heap = new Uint8Array(ex.memory.buffer);
    heap.set(buf, statePtr);
    this.writeStaticsIntoMemory();
    this.writeTargetScoreIntoMemory();
    this.writeScoresIntoMemory(state);
    // Card builds + arena bounds — MUST match the client (writeFireConfigsForState
    // + setArenaBounds). Without these the server runs every player's build inert
    // (no card augments) while the client predicts WITH them → desync.
    this.writeFireConfigsIntoMemory(state);
    this.writeArenaBoundsIntoMemory();
    this.writeMapSizeIntoMemory();
    this.writeInputsIntoMemory();
    const rc = ex.step_world(statePtr, dtMs);
    if (rc !== 0) {
      throw new Error(`[server-wasm-host] step_world returned ${rc}`);
    }
    const back = new Uint8Array(
      ex.memory.buffer,
      statePtr,
      WORLD_STATE_TOTAL_SIZE,
    ).slice();
    const unpacked = unpackWorldState(back);
    return {
      state: mergeUnpacked(state, unpacked),
      events: unpacked.events,
      matchComplete: unpacked.matchWinnerIdx >= 0,
    };
  }

  __resetForTests(): void {
    this.statePtr = null;
    this.stateLen = null;
    this.ex = null;
    this.cachedStatics = null;
    this.cachedInputs = null;
    this.preloadPromise = null;
    this.resolvedReady = false;
    this.readyResolvers.length = 0;
    this.readyError = null;
  }

  private writeStaticsIntoMemory(): void {
    if (!this.cachedStatics || !this.ex || this.statePtr === null) return;
    const ex = this.ex;
    // Scratch buffer past the WorldState region.
    const scratchPtr = this.statePtr + WORLD_STATE_TOTAL_SIZE + 64;
    const heap = new Uint8Array(ex.memory.buffer);
    const view = new DataView(ex.memory.buffer, scratchPtr);
    const count = Math.min(this.cachedStatics.aabbs.length, 256);
    const AABB_SIZE_BYTES = 32;
    for (let i = 0; i < count; i++) {
      const a = this.cachedStatics.aabbs[i]!;
      view.setFloat64(i * AABB_SIZE_BYTES + 0, a.x, true);
      view.setFloat64(i * AABB_SIZE_BYTES + 8, a.y, true);
      view.setFloat64(i * AABB_SIZE_BYTES + 16, a.w, true);
      view.setFloat64(i * AABB_SIZE_BYTES + 24, a.h, true);
    }
    const oneWayPtr = scratchPtr + count * AABB_SIZE_BYTES;
    for (let i = 0; i < count; i++) {
      heap[oneWayPtr + i] = this.cachedStatics.oneWay[i] ?? 0;
    }
    ex.world_state_set_statics(this.statePtr, scratchPtr, oneWayPtr, count);
  }

  /** Patch each player's score into linear memory. 2026-07-14 fix — see the
   *  matching client-side writeScoresIntoMemory comment: packPlayer always
   *  writes 0, so without this call every player's score silently resets to
   *  0 every tick, permanently breaking match-end detection and the
   *  sudden-death trigger for the whole match. Must match the client's
   *  equivalent call exactly (same sorted-id ordering) or predict/reconcile
   *  desyncs on score. */
  private writeScoresIntoMemory(state: WorldState): void {
    if (!this.ex || this.statePtr === null) return;
    const view = new DataView(this.ex.memory.buffer);
    const playersStart = this.statePtr + 48 + 8;
    const PLAYER_ENTITY_SIZE = 288;
    const SCORE_OFF = 276;
    const sortedIds = Object.keys(state.players).sort();
    for (let i = 0; i < sortedIds.length; i++) {
      const pid = sortedIds[i]! as PlayerId;
      const score = state.round.scores?.[pid] ?? 0;
      const playerOff = playersStart + i * PLAYER_ENTITY_SIZE;
      view.setUint32(playerOff + SCORE_OFF, score >>> 0, true);
    }
  }

  /** Resolve each player's build + write the ResolvedFireConfig array (shared
   *  bytes with the client) so world.zig applies the SAME card augments. Runs
   *  AFTER pack (pack skips the fire-config region) and before step_world. */
  private writeFireConfigsIntoMemory(state: WorldState): void {
    if (!this.ex || this.statePtr === null) return;
    if (typeof this.ex.resolve_player_fire_config !== "function") return;
    // Build resolution lives in Zig (weapon_build.zig) — hand it card indices.
    resolveFireConfigsViaZig(
      this.ex as unknown as FireConfigResolverExports,
      this.statePtr,
      state,
    );
  }

  private writeArenaBoundsIntoMemory(): void {
    if (!this.cachedArenaBounds || !this.ex) return;
    this.ex.world_state_set_arena_bounds?.(
      this.cachedArenaBounds.ceilingY,
      this.cachedArenaBounds.hasCeiling,
      this.cachedArenaBounds.killPlaneY,
    );
  }

  private writeMapSizeIntoMemory(): void {
    if (!this.cachedMapSize || !this.ex) return;
    this.ex.world_state_set_map_size?.(
      this.cachedMapSize.width,
      this.cachedMapSize.height,
    );
  }

  private writeTargetScoreIntoMemory(): void {
    if (this.cachedTargetScore === null || !this.ex || this.statePtr === null) return;
    this.ex.world_state_set_target_score?.(this.statePtr, this.cachedTargetScore);
  }

  private writeInputsIntoMemory(): void {
    if (!this.cachedInputs || !this.ex || this.statePtr === null) return;
    const view = new DataView(this.ex.memory.buffer);
    const playersStart = this.statePtr + 48 + 8;
    const PLAYER_ENTITY_SIZE = 288;
    const AIMX_OFF = 4 * 8;
    const AIMY_OFF = 5 * 8;
    const CURR_OFF = 268;
    const PREV_OFF = 272;
    const sortedIds = [...this.cachedInputs.keys()].sort();
    for (let i = 0; i < sortedIds.length; i++) {
      const pid = sortedIds[i]!;
      const v = this.cachedInputs.get(pid);
      if (!v) continue;
      const playerOff = playersStart + i * PLAYER_ENTITY_SIZE;
      view.setFloat64(playerOff + AIMX_OFF, v.aimX, true);
      view.setFloat64(playerOff + AIMY_OFF, v.aimY, true);
      view.setUint32(playerOff + CURR_OFF, v.keys >>> 0, true);
      view.setUint32(playerOff + PREV_OFF, v.prevKeys >>> 0, true);
    }
  }
}

// Identity-stable merge — same shape as client side. Imported as a
// type-only thing (the actual merge logic lives in
// worldStateBridge already? no; the client has it inline in
// worldWasmBackend). Inline here to keep the server self-contained.
type UnpackedWorldState = ReturnType<typeof unpackWorldState>;

function mergeUnpacked(
  state: WorldState,
  unpacked: UnpackedWorldState,
): WorldState {
  return {
    ...state,
    tick: unpacked.tick,
    rngState: unpacked.rngState,
    round: {
      ...state.round,
      phase: unpacked.round.phase,
      countdownRemainingMs: unpacked.round.countdownRemainingMs,
      roundIndex: unpacked.round.roundIndex,
      // Pass-through, not Zig-decided (2026-07-14) — see the matching
      // comment in client/src/sim/wasm/worldWasmBackend.ts's mergeUnpacked.
      suddenDeathActive: unpacked.round.suddenDeathActive,
      scores: { ...state.round.scores, ...unpacked.scores },
    },
    players: stableMergeRecord(state.players, unpacked.players),
    firePatches: stableMergeRecord(state.firePatches, unpacked.firePatches),
    destructibles: stableMergeRecord(state.destructibles, unpacked.destructibles),
    projectiles: stableMergeRecord(state.projectiles, unpacked.projectiles),
    satellites: stableMergeRecord(state.satellites, unpacked.satellites),
    pickups: stableMergeRecord(state.pickups, unpacked.pickups),
  };
}

function stableMergeRecord<K extends string | number, V>(
  prev: Record<K, V>,
  next: Record<K, V>,
): Record<K, V> {
  const out: Record<K, V> = {} as Record<K, V>;
  for (const k in next) {
    const a = prev[k];
    const b = next[k];
    if (a !== undefined && shallowEqual(a, b)) {
      out[k] = a;
    } else {
      out[k] = b;
    }
  }
  return out;
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (av !== bv) return false;
  }
  return true;
}

/** Page-singleton (server is single-process per Fly machine). */
export const serverWasmHost = new ServerWasmHost();
export type { ServerWasmHost };
