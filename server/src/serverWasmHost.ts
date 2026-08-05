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

import type {
  LaunchPadDefinition,
  PlayerId,
  SlopeDefinition,
  WorldState,
} from "@sim/types.ts";
import { deriveSlopeStatics, MAX_SLOPES, type SlopeStatic } from "@sim/collision.ts";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
  PLAYER_ENTITY_SIZE,
  HEADER_SIZE,
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
  /** Queued draft picks that landed in Zig this step (Track Z2 — the
   *  drafting bridge). The caller (matchHost) folds these into the TS
   *  state: appends the card id to `player.cards` and synthesizes the
   *  draft-resolved event (Zig's own event for a host-applied pick is
   *  wiped by stepWorld's event-buffer reset — see world.zig's
   *  world_apply_card_pick doc comment). */
  appliedPicks: QueuedCardPick[];
};

/** One host-queued draft pick (Track Z2). `cardId` rides along opaquely —
 *  serverWasmHost never interprets it; matchHost queued it after
 *  validating against the surfaced offers and needs it back to fold the
 *  applied pick into the TS-side hand. */
export type QueuedCardPick = {
  playerId: PlayerId;
  offerSlot: number;
  cardId: string;
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
  world_state_set_arena_size?: (width: number, height: number) => void;
  world_state_set_arena_bounds?: (
    ceiling_y: number,
    has_ceiling: number,
    kill_plane_y: number,
  ) => void;
  world_state_set_target_score?: (state_ptr: number, target: number) => void;
  /** Optional — older sim.wasm builds predate launch pads. Flat f64
   *  array, 6 per pad: [x, y, w, h, impulse_x, impulse_y]. */
  world_state_set_launch_pads?: (pads_ptr: number, count: number) => number;
  /** Optional — older sim.wasm builds predate slopes. Flat f64 array,
   *  7 per slope (deriveSlopeStatics bits):
   *  [span_min_x, span_max_x, base_x, base_y, dy_dx, tx, ty]. */
  world_state_set_slopes?: (slopes_ptr: number, count: number) => number;
  /** Optional — older sim.wasm builds predate spawn points (Track Z0b
   *  Item A). Flat f64 array, 2 per point: [x, y], map.spawns order. */
  world_state_set_spawn_points?: (points_ptr: number, count: number) => number;
  /** Track Z2 — apply one queued draft pick post-pack, pre-step (see
   *  world.zig's doc comment). Returns 1 if the pick landed. */
  world_apply_card_pick?: (
    state_ptr: number,
    player_idx: number,
    offer_slot: number,
  ) => number;
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
  private cachedLaunchPads: LaunchPadDefinition[] | null = null;
  private cachedSlopes: SlopeStatic[] | null = null;
  private cachedSpawnPoints: { x: number; y: number }[] | null = null;
  private cachedArenaSize: { x: number; y: number } | null = null;
  private cachedTargetScore: number | null = null;
  /** Draft picks queued since the last step (Track Z2) — applied into the
   *  wasm state between pack and step_world, then drained. */
  private pendingCardPicks: QueuedCardPick[] = [];
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

  /** Queue a validated draft pick for the next step (Track Z2 — the
   *  drafting bridge). Applied into wasm memory AFTER the next pack (so
   *  the pack can't wipe it) and BEFORE step_world (so an all-picked
   *  draft resolves that very tick, matching TS's stepRound cadence).
   *  Zig's applyCardPick gates idempotency (phase/slot/already-picked);
   *  entries that don't land are silently dropped from the applied list. */
  queueCardPick(playerId: PlayerId, offerSlot: number, cardId: string): void {
    this.pendingCardPicks.push({ playerId, offerSlot, cardId });
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

  /** Raw arena width/height (map.size — world.zig module-level, Track Z0b
   *  Item C): consumed by the shrink-zone storm's center/half-diagonal
   *  math (and pre-existing consumer findCollisionFreeLanding's bounds
   *  check). Fail-closed — an unset size leaves the storm inert. */
  setArenaSize(width: number, height: number): void {
    this.cachedArenaSize = { x: width, y: height };
  }

  /** Static launch pads (map.launchPads, world.zig §8c — module-level like
   *  the arena bounds, zero WorldState bytes). Set once per match; pad
   *  ARRAY ORDER is the wire identity (event entity_id = index). Empty
   *  array clears the previous match's pads. */
  setLaunchPads(pads: ReadonlyArray<LaunchPadDefinition>): void {
    this.cachedLaunchPads = pads.slice();
  }

  /** True slopes (map.slopes, player.zig module-level — zero WorldState
   *  bytes, launch-pad pattern). Derived here via deriveSlopeStatics
   *  (single TS derivation site) so wasm consumes the exact f64 bits the
   *  TS slope pass reads. Set once per match; empty array clears. */
  setSlopes(slopes: ReadonlyArray<SlopeDefinition>): void {
    this.cachedSlopes = deriveSlopeStatics(slopes);
  }

  /** Spawn points (map.spawns, world.zig module-level — Track Z0b Item A:
   *  the Zig assignSpawnPoints port seats mid-round fast respawns +
   *  round-boundary respawns from the same list the TS respawn path
   *  reads). Point ORDER is load-bearing (strict-`>` tiebreak). Callers
   *  pass TS's own no-spawns fallback (map center) — see matchHost. */
  setSpawnPoints(points: ReadonlyArray<{ x: number; y: number }>): void {
    this.cachedSpawnPoints = points.map((p) => ({ x: p.x, y: p.y }));
  }

  /** Match win-target. Track Z0a port of orphaned-branch commit 02b74f5 —
   *  see the matching client-side setWorldTargetScore comment:
   *  world_state_set_target_score existed as an export but nothing ever
   *  called it, and packWorldState hardcodes target_score to 0 every pack
   *  anyway, so a one-off call would get wiped by the next tick. Cached and
   *  reapplied every tick like arena bounds / launch pads / slopes. */
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
    // Target score + per-player scores — patched after EVERY pack because
    // packWorldState/packPlayer hardcode both to 0 (Track Z0a / 02b74f5:
    // without these two calls, step_world's own score increments got wiped
    // by the next tick's pack and match-end detection + the sudden-death
    // trigger were permanently inert on the wasm path).
    this.writeTargetScoreIntoMemory();
    this.writeScoresIntoMemory(state);
    // Card builds + arena bounds — MUST match the client (writeFireConfigsForState
    // + setArenaBounds). Without these the server runs every player's build inert
    // (no card augments) while the client predicts WITH them → desync.
    this.writeFireConfigsIntoMemory(state);
    // Queued draft picks (Track Z2) — after the loadout delivery above
    // (applyCardPick re-resolves the picker's fire config from the
    // just-delivered hand) and before step_world (an all-picked draft
    // resolves this very tick).
    const appliedPicks = this.applyQueuedCardPicks(state);
    this.writeArenaBoundsIntoMemory();
    this.writeArenaSizeIntoMemory();
    this.writeLaunchPadsIntoMemory();
    this.writeSlopesIntoMemory();
    this.writeSpawnPointsIntoMemory();
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
      appliedPicks,
    };
  }

  /** Drain the pick queue into the packed wasm state (Track Z2). Player
   *  ids resolve to entity slots by the SAME localeCompare sort
   *  packWorldState uses, so the pick lands on the slot packPlayer wrote. */
  private applyQueuedCardPicks(state: WorldState): QueuedCardPick[] {
    if (this.pendingCardPicks.length === 0) return [];
    const queue = this.pendingCardPicks;
    this.pendingCardPicks = [];
    if (!this.ex || this.statePtr === null) return [];
    if (typeof this.ex.world_apply_card_pick !== "function") return [];
    const sortedIds = Object.keys(state.players).sort((a, b) =>
      a.localeCompare(b),
    );
    const applied: QueuedCardPick[] = [];
    for (const pick of queue) {
      const idx = sortedIds.indexOf(pick.playerId);
      if (idx < 0) continue;
      if (this.ex.world_apply_card_pick(this.statePtr, idx, pick.offerSlot) === 1) {
        applied.push(pick);
      }
    }
    return applied;
  }

  __resetForTests(): void {
    this.statePtr = null;
    this.stateLen = null;
    this.ex = null;
    this.cachedStatics = null;
    this.cachedInputs = null;
    this.cachedLaunchPads = null;
    this.cachedSlopes = null;
    this.cachedSpawnPoints = null;
    this.cachedArenaSize = null;
    this.cachedTargetScore = null;
    this.pendingCardPicks = [];
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

  private writeTargetScoreIntoMemory(): void {
    if (this.cachedTargetScore === null || !this.ex || this.statePtr === null)
      return;
    this.ex.world_state_set_target_score?.(this.statePtr, this.cachedTargetScore);
  }

  private writeArenaSizeIntoMemory(): void {
    if (!this.cachedArenaSize || !this.ex) return;
    this.ex.world_state_set_arena_size?.(
      this.cachedArenaSize.x,
      this.cachedArenaSize.y,
    );
  }

  /** Patch each player's score into linear memory. Track Z0a port of
   *  orphaned-branch commit 02b74f5 — see the matching client-side
   *  writeScoresIntoMemory comment: packPlayer always writes 0, so without
   *  this call every player's score silently resets to 0 every tick,
   *  permanently breaking match-end detection and the sudden-death trigger
   *  for the whole match. Must match the client's equivalent call exactly
   *  (same pack-order sort) or predict/reconcile desyncs on score. */
  private writeScoresIntoMemory(state: WorldState): void {
    if (!this.ex || this.statePtr === null) return;
    const view = new DataView(this.ex.memory.buffer);
    const playersStart = this.statePtr + HEADER_SIZE + 8;
    // PlayerEntity.score offset within the 632-byte entity — same constant
    // unpackWorldState's score-extraction loop reads (offset 276, directly
    // after current_keys/prev_keys at +268/+272).
    const SCORE_OFF = 276;
    // Sort MUST match packWorldState's player ordering (localeCompare) so
    // index i lands on the same entity slot packPlayer wrote.
    const sortedIds = Object.keys(state.players).sort((a, b) =>
      a.localeCompare(b),
    );
    for (let i = 0; i < sortedIds.length; i++) {
      const pid = sortedIds[i]! as PlayerId;
      const score = state.round.scores?.[pid] ?? 0;
      const playerOff = playersStart + i * PLAYER_ENTITY_SIZE;
      view.setUint32(playerOff + SCORE_OFF, score >>> 0, true);
    }
  }

  /** Launch pads (world.zig §8c). Scratch sits past the max statics region
   *  (256×32 AABB + 256 one_way = 8448 bytes, 8-aligned past scratchPtr) so
   *  the statics and pad writes can never trample each other. 6 f64 per
   *  pad, order = map order (mirrors the client backend's write). */
  private writeLaunchPadsIntoMemory(): void {
    if (!this.cachedLaunchPads || !this.ex || this.statePtr === null) return;
    if (typeof this.ex.world_state_set_launch_pads !== "function") return;
    const scratchPtr = this.statePtr + WORLD_STATE_TOTAL_SIZE + 64;
    const padScratchPtr = scratchPtr + 256 * 32 + 256;
    const view = new DataView(this.ex.memory.buffer, padScratchPtr);
    const count = Math.min(this.cachedLaunchPads.length, 16);
    for (let i = 0; i < count; i++) {
      const pad = this.cachedLaunchPads[i]!;
      view.setFloat64(i * 48 + 0, pad.position.x, true);
      view.setFloat64(i * 48 + 8, pad.position.y, true);
      view.setFloat64(i * 48 + 16, pad.size.x, true);
      view.setFloat64(i * 48 + 24, pad.size.y, true);
      view.setFloat64(i * 48 + 32, pad.impulse.x, true);
      view.setFloat64(i * 48 + 40, pad.impulse.y, true);
    }
    this.ex.world_state_set_launch_pads(padScratchPtr, count);
  }

  /** True slopes (player.zig module-level). Scratch sits past the pad
   *  region (16×48 = 768 bytes past the pad scratch) — statics, pads and
   *  slopes never trample each other. 7 f64 per slope, exact
   *  deriveSlopeStatics bits, map array order. Count 0 clears. */
  private writeSlopesIntoMemory(): void {
    if (!this.cachedSlopes || !this.ex || this.statePtr === null) return;
    if (typeof this.ex.world_state_set_slopes !== "function") return;
    const scratchPtr = this.statePtr + WORLD_STATE_TOTAL_SIZE + 64;
    const slopeScratchPtr = scratchPtr + 256 * 32 + 256 + 16 * 48;
    const view = new DataView(this.ex.memory.buffer, slopeScratchPtr);
    const count = Math.min(this.cachedSlopes.length, MAX_SLOPES);
    for (let i = 0; i < count; i++) {
      const s = this.cachedSlopes[i]!;
      view.setFloat64(i * 56 + 0, s.spanMinX, true);
      view.setFloat64(i * 56 + 8, s.spanMaxX, true);
      view.setFloat64(i * 56 + 16, s.baseX, true);
      view.setFloat64(i * 56 + 24, s.baseY, true);
      view.setFloat64(i * 56 + 32, s.dyDx, true);
      view.setFloat64(i * 56 + 40, s.tx, true);
      view.setFloat64(i * 56 + 48, s.ty, true);
    }
    this.ex.world_state_set_slopes(slopeScratchPtr, count);
  }

  /** Spawn points (world.zig module-level, Track Z0b Item A). Scratch sits
   *  past the max slope region (32×56 = 1792 bytes past the slope scratch)
   *  — statics, pads, slopes and spawns never trample each other. 2 f64
   *  per point, map.spawns order (mirrors the client backend's write).
   *  Count 0 clears (Zig then falls back to respawn-in-place). */
  private writeSpawnPointsIntoMemory(): void {
    if (!this.cachedSpawnPoints || !this.ex || this.statePtr === null) return;
    if (typeof this.ex.world_state_set_spawn_points !== "function") return;
    const scratchPtr = this.statePtr + WORLD_STATE_TOTAL_SIZE + 64;
    const spawnScratchPtr = scratchPtr + 256 * 32 + 256 + 16 * 48 + MAX_SLOPES * 56;
    const view = new DataView(this.ex.memory.buffer, spawnScratchPtr);
    const count = Math.min(this.cachedSpawnPoints.length, 16);
    for (let i = 0; i < count; i++) {
      const p = this.cachedSpawnPoints[i]!;
      view.setFloat64(i * 16 + 0, p.x, true);
      view.setFloat64(i * 16 + 8, p.y, true);
    }
    this.ex.world_state_set_spawn_points(spawnScratchPtr, count);
  }

  private writeInputsIntoMemory(): void {
    if (!this.cachedInputs || !this.ex || this.statePtr === null) return;
    const view = new DataView(this.ex.memory.buffer);
    const playersStart = this.statePtr + HEADER_SIZE + 8;
    // PLAYER_ENTITY_SIZE / HEADER_SIZE now imported from worldStateBridge.ts
    // (2026-07-18) — this used to shadow-declare local copies, which
    // silently desynced (and would have corrupted every input write past
    // player index 0) the moment the shared constants grew (288 → 296 →
    // ... → 512 for PLAYER_ENTITY_SIZE, 48 → 56 for HEADER_SIZE). Exactly
    // the "duplicated magic number" trap this codebase's own doctrine
    // warns about elsewhere.
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
      // Zig decides the sudden-death trigger at the countdown → fighting
      // transition (Track Z0a / 02b74f5) — mirror its verdict out, incl.
      // the explicit-undefined clear (round.ts optional-field convention).
      suddenDeathActive: unpacked.round.suddenDeathActive,
      // First-blood wager (Track Z0d): Zig owns the claim on this path —
      // same mirror-out + explicit-undefined clear as suddenDeathActive.
      firstBloodPlayerId: unpacked.round.firstBloodPlayerId,
      // Round winner (Track Z2): Zig's round machine owns the verdict on
      // this path — mirror it out like the two fields above.
      winnerPlayerId: unpacked.round.winnerPlayerId,
      scores: { ...state.round.scores, ...unpacked.scores },
    },
    players: stableMergeRecord(
      state.players,
      preservePlayerCards(state.players, unpacked.players),
    ),
    firePatches: stableMergeRecord(state.firePatches, unpacked.firePatches),
    destructibles: stableMergeRecord(state.destructibles, unpacked.destructibles),
    projectiles: stableMergeRecord(state.projectiles, unpacked.projectiles),
    satellites: stableMergeRecord(state.satellites, unpacked.satellites),
    pickups: stableMergeRecord(state.pickups, unpacked.pickups),
    // Paper Doubles (Track E1c — the Paper Double bridge): carried like
    // every entity collection above — without this, the next pack wiped
    // every live decoy one tick after it spawned. Mirrors the client
    // backend's mergeUnpacked exactly.
    paperDoubles: stableMergeRecord(
      state.paperDoubles ?? {},
      unpacked.paperDoubles,
    ),
    // Zig's post-step spawn-id cursor (Track E1c): carried so the next
    // pack writes the REAL cursor back instead of the derived floor (see
    // WorldState.nextEntityId's doc comment in types.ts). Mirrors the
    // client backend exactly.
    nextEntityId: unpacked.nextEntityId,
    // Zig's movement memory rides the state object between packs (Track
    // Z0e) — REPLACED wholesale each tick (Zig's own post-step truth,
    // keyed by id). Mirrors the client backend's mergeUnpacked exactly.
    movementMemory: unpacked.movementMemory,
    // Same contract for the melee swing FSM (Track Z1a — Z0e's sibling):
    // without this, the next pack resets every swing to idle and melee
    // can never mature past windup on the wasm path. Mirrors the client
    // backend's mergeUnpacked exactly.
    meleeSwingMemory: unpacked.meleeSwingMemory,
    // And for draft bookkeeping (Track Z2): without this, the next pack
    // wipes every rolled offer and landed pick — the wasm drafting phase
    // could never hold a draft open. Mirrors the client backend exactly.
    draftMemory: unpacked.draftMemory,
  };
}

/**
 * Re-seat the HOST's own card ids onto each unpacked player (Track Z1b).
 * The pack encodes `cards` count-only, so unpackPlayer returns placeholder
 * empty strings — before this helper the merge replaced every stepped
 * player's hand with those placeholders, destroying the real card ids one
 * tick after any wasm step (next tick's `resolveFireConfigsViaZig` saw an
 * empty hand: bare pistol, no actives, broken draft gates). Mirrors the
 * client backend's helper exactly.
 */
function preservePlayerCards(
  prev: WorldState["players"],
  next: WorldState["players"],
): WorldState["players"] {
  const out = {} as WorldState["players"];
  for (const k in next) {
    const pid = k as keyof WorldState["players"];
    const prior = prev[pid];
    out[pid] = prior ? { ...next[pid]!, cards: prior.cards } : next[pid]!;
  }
  return out;
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
