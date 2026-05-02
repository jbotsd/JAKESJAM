// One MatchHost per active match. Owns the World, the tick loop, and the set
// of connected client WebSockets. Inputs flow in via routeMessage; snapshots
// flow out via the broadcast loop.

import type { ServerWebSocket } from "bun";
import { SNAPSHOT_INTERVAL_TICKS, STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime, type WorldRuntime } from "@sim/World.ts";
import { resolveMap, type MapId } from "@sim/data/maps.ts";
import type {
  InputFrame,
  InputSeq,
  MapDefinition,
  PlayerEntity,
  PlayerId,
  PlayerSpawnInfo,
  SimEvent,
  Tick,
  WorldState,
} from "@sim/types.ts";
import { LagCompensator, type RewindPlan } from "./LagCompensator.ts";
import { TickSlewController } from "./TickSlewController.ts";
import { convexClient, type ConvexId } from "./convexClient.ts";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type PlayerLobbyInfo,
} from "./protocol.ts";
import { InterestGrid, CELL_SIZE_PX, OBSERVE_RADIUS_CELLS } from "./InterestGrid.ts";
import { encodeDelta } from "./snapshotDelta.ts";
import { transferAuthority } from "./authority.ts";

export type MatchSocketData = {
  matchId: string;
  playerId: string;
  authedAt: number;
};

// Maps are looked up from the shared registry at construction time so the
// authoritative collision matches the client's rendered geometry. The
// host doesn't switch maps mid-match — once constructed, `this.map` is
// the world for the lifetime of this MatchHost.

const FIRE_BIT = 1 << 6; // kept locally for the log-diag helper

/**
 * How long to keep a disconnected player's entity alive in the world while we
 * wait for them to reconnect. After this window expires the entity, score
 * entry, and bookkeeping are all evicted.
 */
export const RECONNECT_GRACE_MS = 10_000;


export class MatchHost {
  readonly matchId: string;
  private state: WorldState;
  private readonly runtime: WorldRuntime;
  private readonly clients = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  private readonly playerInfo = new Map<PlayerId, PlayerLobbyInfo>();
  private readonly pendingInputs = new Map<PlayerId, InputFrame>();
  private readonly lastProcessedInputSeq = new Map<PlayerId, InputSeq>();
  private readonly lagComp = new LagCompensator();
  private readonly tickSlew = new TickSlewController();
  /**
   * Wall-clock ms (Date.now) at which each known player's connection dropped.
   * Entries are added on `detachClient`, cleared on a successful re-attach.
   * The tick loop evicts entries older than RECONNECT_GRACE_MS.
   */
  private readonly disconnectedAt = new Map<PlayerId, number>();
  /** Last wall-clock time we received an input from a given player. */
  private readonly lastSeenAt = new Map<PlayerId, number>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly rngSeed: number;
  private startedAt = 0;
  /** Spatial grid for per-recipient snapshot filtering (AOI). Rebuilt each
   *  snapshot tick in broadcastSnapshot before per-client filtering runs. */
  private readonly grid: InterestGrid;
  /** Monotonically-increasing snapshot counter. Used to gate DEBUG_AOI logs
   *  to the first 30 snapshots only. */
  private snapshotCount = 0;

  // ---- Delta snapshot state ------------------------------------------------
  /** Maximum number of baseline snapshots retained per client. */
  private static readonly BASELINE_RING_SIZE = 10;
  /**
   * Per-client ring of recent WorldState snapshots keyed by their tick.
   * Ordered oldest→newest. Used to compute per-client deltas. The stored
   * snapshots are AOI-FILTERED (per-recipient), so deltas are computed
   * against the same filtered baseline the recipient previously saw —
   * see DESIGN ASSUMPTION block in InterestGrid.ts.
   */
  private readonly baselineRing = new Map<PlayerId, Map<Tick, WorldState>>();
  /**
   * Last snapshot tick acked by each client (from their Ack message).
   * 0 = not yet acked / client requesting full snapshot.
   */
  private readonly lastAckedTick = new Map<PlayerId, Tick>();
  /** Set true the first time a `matchComplete` post to Convex is *initiated*.
   *  Prevents duplicate writes (in addition to the idempotent server-side
   *  mutation). One flag per host == one write per match lifetime. */
  private matchCompletePosted = false;

  private readonly map: MapDefinition;

  constructor(
    matchId: string,
    players: PlayerSpawnInfo[],
    // TODO(chaos-pipe): the room's selected chaos modifier ids should flow
    // here once the matchmaker carries them. Today we stub an empty list so
    // the netcode path runs the no-chaos baseline; the sim already supports
    // any subset via World.create's optional 4th arg.
    chaosModifierIds: string[] = [],
    mapId: MapId | string | undefined = undefined,
  ) {
    this.matchId = matchId;
    this.map = resolveMap(mapId);
    this.rngSeed = (Math.random() * 0xffffffff) >>> 0;
    this.state = World.create(
      this.map,
      players,
      this.rngSeed,
      chaosModifierIds,
    );
    this.runtime = createRuntime(this.map);
    this.grid = new InterestGrid(this.map.size.x, this.map.size.y, CELL_SIZE_PX);
    for (const spawn of players) {
      this.playerInfo.set(spawn.playerId, {
        playerId: spawn.playerId,
        characterId: spawn.characterId,
        color: spawn.color ?? "#ffffff",
        name: spawn.name ?? spawn.playerId,
      });
      this.lastProcessedInputSeq.set(spawn.playerId, 0 as InputSeq);
    }
  }

  attachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId as PlayerId;
    const previous = this.clients.get(playerId);
    if (previous && previous !== ws) {
      previous.close(1000, "replaced");
    }
    this.clients.set(playerId, ws);
    // Reconnect path: clear any pending grace-window timer so the eviction
    // tick won't drop their entity, and refresh their last-seen.
    if (this.disconnectedAt.has(playerId)) {
      this.disconnectedAt.delete(playerId);
      console.log(
        `[matchHost ${this.matchId}] player ${playerId} reconnected within grace window`,
      );
    }
    this.lastSeenAt.set(playerId, Date.now());
    this.sendHello(ws);
    this.maybeStartLoop();
  }

  detachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId as PlayerId;
    if (this.clients.get(playerId) === ws) {
      this.clients.delete(playerId);
      // We deliberately keep the player's entity, score, input-seq state, and
      // playerInfo entry intact so a quick reconnect can resume seamlessly.
      // The grace-window check in `tick` ultimately evicts them if they
      // don't come back within RECONNECT_GRACE_MS.
      if (this.playerInfo.has(playerId)) {
        this.disconnectedAt.set(playerId, Date.now());
      }
    }
    // NOTE: previously this stopped the loop when clients hit zero. We now
    // keep the loop running while there are pending grace windows so the
    // eviction sweep can fire. Once all disconnects have expired (or there
    // are no players left at all) `tick` itself calls `stop()`, and the
    // registry tears the host down via hasClients()+hasPendingDisconnects().
    if (this.clients.size === 0 && this.disconnectedAt.size === 0) {
      this.stop();
    }
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  /** True while at least one player is in their reconnect grace window. */
  hasPendingDisconnects(): boolean {
    return this.disconnectedAt.size > 0;
  }

  hasPlayer(playerId: PlayerId): boolean {
    return this.playerInfo.has(playerId);
  }

  /**
   * Public read-only snapshot for HTTP `/health` consumers. Tiny by
   * design — only the fields a status badge needs. Joinability is
   * permissive: any phase that isn't `round-over` accepts late joins,
   * which matches the io world's "drift in/out" semantic.
   */
  summary(): {
    matchId: string;
    mapId: string;
    phase: WorldState["round"]["phase"];
    roundIndex: number;
    countdownRemainingMs: number;
    players: number;
    targetScore: number;
    joinable: boolean;
    chaosModifierIds: string[];
  } {
    const round = this.state.round;
    const targetScore = Math.max(...Object.values(round.scores), 0) >= 0 ? 3 : 3;
    return {
      matchId: this.matchId,
      mapId: this.map.id,
      phase: round.phase,
      roundIndex: round.roundIndex,
      countdownRemainingMs: round.countdownRemainingMs,
      players: Object.keys(this.state.players).length,
      targetScore,
      joinable: round.phase !== "round-over",
      chaosModifierIds: this.state.chaosModifierIds ?? [],
    };
  }

  /**
   * Insert a new player into the world mid-match. Used when a second client
   * connects to a match that was created with only the first player.
   * Spawns them at one of the map's spawn points.
   */
  addPlayer(spawn: PlayerSpawnInfo): void {
    if (this.playerInfo.has(spawn.playerId)) return;
    this.playerInfo.set(spawn.playerId, {
      playerId: spawn.playerId,
      characterId: spawn.characterId,
      color: spawn.color ?? "#ffffff",
      name: spawn.name ?? spawn.playerId,
    });
    this.lastProcessedInputSeq.set(spawn.playerId, 0 as InputSeq);

    const existingCount = Object.keys(this.state.players).length;
    const spawnPoint =
      this.map.spawns[existingCount % Math.max(1, this.map.spawns.length)] ??
      { x: 0, y: 0 };
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [spawn.playerId]: {
          id: spawn.playerId,
          characterId: spawn.characterId,
          x: spawnPoint.x,
          y: spawnPoint.y,
          vx: 0,
          vy: 0,
          aimX: spawnPoint.x + 160,
          aimY: spawnPoint.y,
          health: 100,
          shieldActive: false,
          crouching: false,
          alive: true,
          weaponId: spawn.weaponId,
          cards: [],
          fireCooldownMs: 0,
          ammo: 0,
          abilityCharge: 0,
          lastProcessedInputSeq: 0,
        },
      },
      round: {
        ...this.state.round,
        scores: {
          ...this.state.round.scores,
          [spawn.playerId]: 0,
        },
      },
    };
  }

  routeMessage(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    const decoded = decodeMessage<ClientMessage>(
      raw instanceof Buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw,
    );
    if (!decoded) return;
    const { message } = decoded;
    switch (message.t) {
      case "in":
        this.applyInput(ws.data.playerId as PlayerId, message);
        break;
      case "ack":
        this.recordAck(ws.data.playerId as PlayerId, message.lastSnapshotTick);
        break;
      case "ping":
        ws.send(
          encodeMessage({
            t: "pong",
            clientTime: message.clientTime,
            serverTime: this.now(),
          }),
        );
        break;
      case "card-pick":
        this.applyCardPick(ws.data.playerId as PlayerId, message);
        break;
      case "hello":
        // Hello is implicit on connect; ignore extras.
        break;
    }
  }

  /**
   * Apply a draft-phase card pick from a client. Validates that
   *  - the round is still in `drafting` AND on the same `roundIndex` the
   *    client thinks it's picking for (prevents a stale click after the
   *    round flipped over);
   *  - the player exists (dead players ARE allowed to pick — the loser is
   *    usually mid-respawn at draft time and would otherwise miss their
   *    chance entirely);
   *  - `cardId` is one of the offers rolled for this player.
   *
   * On success, mirrors the patch into BOTH `player.cards` and
   * `state.round.draftingPicked[playerId]`. The latter is what `stepRound`
   * diffs against to advance from drafting → countdown when all
   * participating players have committed.
   *
   * The matching `draft-resolved` SimEvent is emitted by `stepRound` on
   * the next tick — we don't push it here. Single source of truth for the
   * event is the sim, not the network layer.
   */
  private applyCardPick(
    playerId: PlayerId,
    message: import("./protocol.ts").CardPick,
  ): void {
    const round = this.state.round;
    if (round.phase !== "drafting") return;
    if (round.roundIndex !== message.roundIndex) return;
    const player = this.state.players[playerId];
    if (!player) return;

    const offers = round.draftingOffers?.[playerId];
    if (!offers || !offers.includes(message.cardId)) return;

    const alreadyPicked = round.draftingPicked?.[playerId];
    if (alreadyPicked !== undefined) return; // ignore double-clicks

    const nextCards = [...player.cards, message.cardId];
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [playerId]: { ...player, cards: nextCards },
      },
      round: {
        ...round,
        draftingPicked: {
          ...(round.draftingPicked ?? {}),
          [playerId]: message.cardId,
        },
      },
    };
  }

  private applyInput(playerId: PlayerId, input: import("./protocol.ts").Input): void {
    const last = this.lastProcessedInputSeq.get(playerId) ?? 0;
    // Refresh liveness regardless — even a duplicate seq proves the client is
    // alive on the wire.
    this.lastSeenAt.set(playerId, Date.now());
    if (input.seq <= last) return; // out-of-order or duplicate
    this.pendingInputs.set(playerId, {
      seq: input.seq,
      tick: input.tick,
      keys: input.keys,
      aimX: input.aimX,
      aimY: input.aimY,
      dtMs: input.dt,
    });
    // Record slew sample: server tick vs. the tick the client stamped this input.
    this.tickSlew.recordInput(playerId, {
      serverTick: this.state.tick,
      inputTick: input.tick,
    });
  }

  private maybeStartLoop(): void {
    if (this.interval) return;
    this.startedAt = this.now();
    this.interval = setInterval(() => this.tick(), STEP_MS);
  }

  private stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  /**
   * Walk the disconnect map and evict any player whose grace window has
   * elapsed. Removes them from `state.players` (so the sim no longer renders
   * them), drops their score entry, and clears all bookkeeping. Called once
   * per tick from the top of `tick()`.
   */
  private evictExpiredDisconnects(): void {
    if (this.disconnectedAt.size === 0) {
      // Nothing to do; also use this opportunity to wind down a host that
      // has no live clients and no pending grace timers.
      if (this.clients.size === 0) this.stop();
      return;
    }
    const now = Date.now();
    let evicted = false;
    for (const [playerId, disconnectedAt] of this.disconnectedAt) {
      if (now - disconnectedAt <= RECONNECT_GRACE_MS) continue;
      this.disconnectedAt.delete(playerId);
      this.playerInfo.delete(playerId);
      this.lastProcessedInputSeq.delete(playerId);
      this.lastSeenAt.delete(playerId);
      this.pendingInputs.delete(playerId);
      // Strip the entity + score from the world state. We rebuild the maps
      // immutably to stay consistent with how addPlayer mutates state.
      const nextPlayers = { ...this.state.players };
      delete nextPlayers[playerId];
      const nextScores = { ...this.state.round.scores };
      delete nextScores[playerId];
      // Rewrite in-flight entities owned by the evicted player to world-owned
      // (null) so stale ownerId references don't linger in the sim.
      // Scrub drafting bookkeeping for the evicted player. Without this,
      // a player who disconnected mid-drafting keeps their entry in
      // draftingOffers / draftingPicked. Combined with the resolution
      // gate keyed off draftingOffers keys, that would deadlock the
      // world: their offers stay, their pick never lands, drafting
      // never resolves.
      const nextDraftingOffers = this.state.round.draftingOffers
        ? { ...this.state.round.draftingOffers }
        : undefined;
      if (nextDraftingOffers) delete nextDraftingOffers[playerId];
      const nextDraftingPicked = this.state.round.draftingPicked
        ? { ...this.state.round.draftingPicked }
        : undefined;
      if (nextDraftingPicked) delete nextDraftingPicked[playerId];
      const stateAfterPlayerEviction = {
        ...this.state,
        players: nextPlayers,
        round: {
          ...this.state.round,
          scores: nextScores,
          draftingOffers: nextDraftingOffers,
          draftingPicked: nextDraftingPicked,
        },
      };
      this.state = transferAuthority(stateAfterPlayerEviction, playerId, null);
      evicted = true;
      console.log(
        `[matchHost ${this.matchId}] evicted player ${playerId} after ${RECONNECT_GRACE_MS}ms reconnect grace`,
      );
    }
    if (evicted && this.clients.size === 0 && this.disconnectedAt.size === 0) {
      this.stop();
    }
  }

  private tick(): void {
    this.evictExpiredDisconnects();

    const inputsByPlayer: Record<PlayerId, InputFrame | null> = {};
    for (const playerId of this.clients.keys()) {
      const input = this.pendingInputs.get(playerId) ?? null;
      inputsByPlayer[playerId] = input;
      if (input) this.lastProcessedInputSeq.set(playerId, input.seq);
    }
    this.pendingInputs.clear();

    // ---- Lag compensation: rewind opponents for shooting players ---------
    const rewindPlan = this.lagComp.buildRewindPlan(this.state, inputsByPlayer);
    const stepInputState = rewindPlan ? rewindPlan.stateForStep : this.state;

    // Snapshot a runtime clone BEFORE the authoritative step so the
    // diagnostic replay below starts from the same runtime state, not the
    // post-step one.
    const runtimeSnapshotForDiag = rewindPlan ? snapshotRuntime(this.runtime) : null;
    const preStepState = this.state;

    const result = stepWithRuntime(stepInputState, this.runtime, inputsByPlayer, STEP_MS);
    let nextState = result.state;
    const events = result.events;

    if (rewindPlan && runtimeSnapshotForDiag) {
      // Restore opponents' future-going positions: they were stepped from a
      // rewound starting position, so subtract the shift vector to put them
      // back on their real trajectory. Velocities are unchanged by the
      // rewind (we only shifted x/y; integration over one tick produces
      // approximately the same delta from either start, modulo platform
      // collision edge cases inside the rewind window).
      nextState = this.lagComp.unshiftAfterStep(nextState, rewindPlan);
      // Diagnostics: replay the same tick WITHOUT the rewind on a clean
      // runtime clone and compare hit-confirmed events for the shooter(s).
      // This is purely an observation; the authoritative result is the
      // rewound one above.
      this.logLagCompOutcomeChange(rewindPlan, events, inputsByPlayer, preStepState, runtimeSnapshotForDiag);
    }

    this.state = nextState;

    if (result.matchComplete && !this.matchCompletePosted) {
      this.matchCompletePosted = true;
      // Fire-and-forget: never block the tick loop on a Convex round-trip.
      // The mutation itself is idempotent and the per-host flag above is the
      // throttle (one write per match per server process).
      void this.postMatchResult();
    }

    // Push position history AFTER the step so samples reflect the state
    // visible to clients in the next snapshot.
    this.lagComp.recordTick(this.state);

    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.broadcastSnapshot(events);
    }
  }

  /**
   * Replay this tick on a throwaway runtime + state without the rewind, and
   * log when a shot's hit/no-hit outcome differs from the authoritative
   * result. This is observability only — never mutates `this.state`.
   *
   * Cost: one extra step() per tick that contains a fire input. Acceptable
   * for a 2-player match at 60 Hz; if this becomes hot we can drop it
   * behind a debug flag.
   */
  private logLagCompOutcomeChange(
    plan: RewindPlan,
    rewoundEvents: SimEvent[],
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
    preStepState: WorldState,
    naiveRuntime: WorldRuntime,
  ): void {
    let naiveResult;
    try {
      naiveResult = stepWithRuntime(preStepState, naiveRuntime, inputsByPlayer, STEP_MS);
    } catch {
      return;
    }
    const rewoundHits = collectHitsByShooter(preStepState.players, rewoundEvents);
    const naiveHits = collectHitsByShooter(preStepState.players, naiveResult.events);
    for (const shooter of plan.shooters) {
      const rewound = rewoundHits.get(shooter.playerId) ?? new Set<PlayerId>();
      const naive = naiveHits.get(shooter.playerId) ?? new Set<PlayerId>();
      const gained: PlayerId[] = [];
      const lost: PlayerId[] = [];
      for (const v of rewound) if (!naive.has(v)) gained.push(v);
      for (const v of naive) if (!rewound.has(v)) lost.push(v);
      if (gained.length === 0 && lost.length === 0) continue;
      console.log(
        `[lag-comp] match=${this.matchId} shooter=${shooter.playerId} ` +
          `serverTick=${preStepState.tick} fireInputTick=${preStepState.tick - shooter.lookbackTicks} ` +
          `lookbackMs=${shooter.lookbackMs.toFixed(1)} ` +
          `hits-gained=${JSON.stringify(gained)} hits-lost=${JSON.stringify(lost)}`,
      );
    }
  }

  /**
   * Resolve the match's roomId via Convex, compute winner + scores from the
   * current world state, and call `recordMatchResult`. Errors are swallowed
   * (logged in convexClient) so a Convex outage never crashes the sim.
   */
  private async postMatchResult(): Promise<void> {
    try {
      const matchId = this.matchId as ConvexId;
      const summary = await convexClient.getMatchSummary(matchId);
      if (!summary) {
        console.warn(
          `[matchHost ${this.matchId}] cannot post result — match summary unavailable (Convex unreachable or match deleted).`,
        );
        return;
      }
      const scores = this.state.round.scores;
      const finalScores: Record<string, number> = { ...scores };
      const winnerPlayerId = pickWinner(scores);
      const roundsPlayed = this.state.round.roundIndex + 1;
      await convexClient.recordMatchResult({
        matchId,
        roomId: summary.roomId,
        winnerPlayerId,
        finalScores,
        roundsPlayed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[matchHost ${this.matchId}] postMatchResult crashed: ${message}`,
      );
    }
  }

  private broadcastSnapshot(events: import("@sim/types.ts").SimEvent[]): void {
    const tick = this.state.tick;
    const lastProcessed: Record<string, InputSeq> = {};
    for (const [pid, seq] of this.lastProcessedInputSeq) lastProcessed[pid] = seq;

    // Rebuild the spatial grid once per snapshot tick. All per-recipient
    // observe() calls below share this rebuilt state.
    this.grid.rebuild(this.state);
    this.snapshotCount += 1;
    const debugAoi = process.env.DEBUG_AOI === "1" && this.snapshotCount <= 30;

    for (const [recipientId, ws] of this.clients) {
      // 1. AOI filter: produce the per-recipient view of the world.
      const filteredState = this.buildFilteredSnap(this.state, recipientId, debugAoi);
      // 2. Delta-encode against the recipient's last filtered baseline,
      //    or fall back to a full snap if no baseline is available.
      const payload = this.buildSnapshotPayload(
        recipientId,
        tick,
        lastProcessed,
        events,
        filteredState,
      );
      ws.send(payload);
      // 3. Store the filtered state as the next baseline. Storing filtered
      //    (not full-world) is critical — see InterestGrid.ts DESIGN
      //    ASSUMPTION block.
      this.pushBaseline(recipientId, tick, filteredState);
    }
  }

  /**
   * Build the encoded snapshot (full or delta) for a single client. The
   * caller has already AOI-filtered `currentState` — this method only
   * decides full-vs-delta + does the encoding.
   */
  private buildSnapshotPayload(
    playerId: PlayerId,
    tick: Tick,
    lastProcessed: Record<string, InputSeq>,
    events: import("@sim/types.ts").SimEvent[],
    currentState: WorldState,
  ): Uint8Array {
    const ackedTick = this.lastAckedTick.get(playerId) ?? (0 as Tick);
    const ring = this.baselineRing.get(playerId);

    // Attempt to find the best baseline: most recent acked tick still in ring.
    let baselineTick: Tick | null = null;
    let baselineState: WorldState | null = null;
    if (ackedTick > 0 && ring && ring.size > 0) {
      // Walk ring ticks in descending order, pick highest tick <= ackedTick.
      let bestTick = -1 as Tick;
      for (const t of ring.keys()) {
        if (t <= ackedTick && t > bestTick) {
          bestTick = t;
        }
      }
      if (bestTick >= 0) {
        const s = ring.get(bestTick);
        if (s) {
          baselineTick = bestTick;
          baselineState = s;
        }
      }
    }

    // Compute per-client tick slew hint. Only included in the wire message
    // when non-zero so we don't waste bytes on steady-state traffic.
    const tickAdjustMs = this.tickSlew.computeAdjustMs(playerId);

    if (baselineState === null || baselineTick === null) {
      // Full snapshot path
      return encodeMessage({
        t: "snap",
        tick,
        lastProcessedInputSeq: lastProcessed,
        baseline: null,
        state: currentState,
        events,
        ...(tickAdjustMs !== 0 ? { tickAdjustMs } : {}),
      });
    }

    // Delta snapshot path — diff against the recipient's last filtered baseline.
    const delta = encodeDelta(baselineState, currentState);
    return encodeMessage({
      t: "snap",
      tick,
      lastProcessedInputSeq: lastProcessed,
      baseline: baselineTick,
      delta,
      events,
      ...(tickAdjustMs !== 0 ? { tickAdjustMs } : {}),
    });
  }

  /**
   * Record the acked tick for a client and trim the ring of any entries
   * strictly older than the acked tick (they can never be picked as a
   * baseline again once surpassed).
   */
  private recordAck(playerId: PlayerId, ackedTick: Tick): void {
    this.lastAckedTick.set(playerId, ackedTick);
    if (ackedTick === 0) return; // client requesting full snapshot — nothing to trim

    const ring = this.baselineRing.get(playerId);
    if (!ring) return;
    for (const t of ring.keys()) {
      if (t < ackedTick) ring.delete(t);
    }
  }

  /**
   * Add the current (already-AOI-filtered) state to a client's baseline ring,
   * evicting the oldest entry if the ring is full.
   */
  private pushBaseline(playerId: PlayerId, tick: Tick, state: WorldState): void {
    let ring = this.baselineRing.get(playerId);
    if (!ring) {
      ring = new Map<Tick, WorldState>();
      this.baselineRing.set(playerId, ring);
    }
    ring.set(tick, state);
    if (ring.size > MatchHost.BASELINE_RING_SIZE) {
      // Evict the oldest tick
      const oldest = ring.keys().next().value as Tick | undefined;
      if (oldest !== undefined) ring.delete(oldest);
    }
  }

  /**
   * Build a WorldState copy filtered to only the entities visible to
   * `recipientId`. High-cardinality collections (projectiles, destructibles,
   * firePatches, pickups, satellites) are filtered by AOI. Players are always
   * included in full (v1 — player count is low; see InterestGrid.ts module doc
   * for the upgrade path). The recipient's own player entry is guaranteed to be
   * present even if their position hasn't been processed this tick.
   *
   * This method does NOT perform delta encoding — it produces a full filtered
   * WorldState ready for the delta encoder to diff against a per-client
   * baseline. See the DESIGN ASSUMPTION comment in InterestGrid.ts.
   */
  private buildFilteredSnap(
    state: WorldState,
    recipientId: PlayerId,
    debugAoi: boolean,
  ): WorldState {
    const player = state.players[recipientId];
    // If the recipient player entity is missing (race between connect and first
    // tick), fall back to world-center so they still get a useful snapshot.
    const observerX = player?.x ?? (this.map.size.x / 2);
    const observerY = player?.y ?? (this.map.size.y / 2);

    const cells = this.grid.cellsAround(observerX, observerY, OBSERVE_RADIUS_CELLS);
    const obs = this.grid.observed(cells);

    // Filter the four high-cardinality collections.
    const projectilesBefore = Object.keys(state.projectiles).length;
    const destructiblesBefore = Object.keys(state.destructibles).length;
    const firePatchesBefore = Object.keys(state.firePatches).length;
    const pickupsBefore = Object.keys(state.pickups).length;
    const satellitesBefore = Object.keys(state.satellites).length;

    const projectiles = filterRecord(state.projectiles, obs.projectileIds);
    const destructibles = filterRecord(state.destructibles, obs.destructibleIds);
    const firePatches = filterRecord(state.firePatches, obs.firePatchIds);
    const pickups = filterRecord(state.pickups, obs.pickupIds);
    const satellites = filterRecord(state.satellites, obs.satelliteIds);

    if (debugAoi) {
      const totalBefore =
        projectilesBefore + destructiblesBefore + firePatchesBefore +
        pickupsBefore + satellitesBefore;
      const totalAfter =
        Object.keys(projectiles).length + Object.keys(destructibles).length +
        Object.keys(firePatches).length + Object.keys(pickups).length +
        Object.keys(satellites).length;
      console.log(
        `[aoi] snap#${this.snapshotCount} match=${this.matchId} ` +
          `recipient=${recipientId} before=${totalBefore} after=${totalAfter} ` +
          `(proj:${projectilesBefore}→${Object.keys(projectiles).length} ` +
          `dest:${destructiblesBefore}→${Object.keys(destructibles).length} ` +
          `fire:${firePatchesBefore}→${Object.keys(firePatches).length} ` +
          `pick:${pickupsBefore}→${Object.keys(pickups).length} ` +
          `sat:${satellitesBefore}→${Object.keys(satellites).length})`,
      );
    }

    return {
      ...state,
      // v1: all players included — players are few, important for targeting.
      projectiles,
      destructibles,
      firePatches,
      pickups,
      satellites,
    };
  }

  private sendHello(ws: ServerWebSocket<MatchSocketData>): void {
    ws.send(
      encodeMessage({
        t: "hello",
        matchId: this.matchId,
        startTick: this.state.tick,
        rngSeed: this.rngSeed,
        mapId: this.map.id,
        yourPlayerId: ws.data.playerId,
        allPlayers: Array.from(this.playerInfo.values()),
      }),
    );
  }

  private now(): number {
    return Date.now() - this.startedAt;
  }
}

/**
 * Shallow-clone a WorldRuntime so a diagnostic step can run without
 * mutating the authoritative one. The map values are immutable in practice
 * (stepPlayer copies its memory before mutating, prevKeys is numbers), so
 * shallow-cloning the outer Maps is enough.
 */
function snapshotRuntime(runtime: WorldRuntime): WorldRuntime {
  return {
    prevKeys: new Map(runtime.prevKeys),
    movement: new Map(runtime.movement),
    nextEntityId: runtime.nextEntityId,
    map: runtime.map,
  };
}

/**
 * Group hit-confirmed events by shooter (the projectile owner). Used by the
 * lag-comp diagnostic to compare "with rewind" vs "without rewind" outcomes.
 *
 * Snapshot of `players` at step-start tells us each projectile owner via the
 * shooter mapping, but `hit-confirmed` does not carry the shooter id, so we
 * derive it through the projectile id when present. Hits without a source
 * projectile (e.g. environment damage) are ignored.
 */
function collectHitsByShooter(
  players: Record<PlayerId, PlayerEntity>,
  events: SimEvent[],
): Map<PlayerId, Set<PlayerId>> {
  // Map projectile id -> shooter is unavailable here without re-running
  // weapon resolution. Instead we approximate: any "hit-confirmed" event in
  // the same step as a "shot-fired" by player X is attributed to X. This is
  // fine for the duel use case (one shooter per tick) and is only used to
  // gate a single console.log; correctness of the authoritative simulation
  // does not depend on it.
  const shootersThisTick = new Set<PlayerId>();
  for (const ev of events) {
    if (ev.t === "shot-fired") shootersThisTick.add(ev.playerId);
  }
  const out = new Map<PlayerId, Set<PlayerId>>();
  for (const ev of events) {
    if (ev.t !== "hit-confirmed") continue;
    // Attribute the hit to every shooter who fired this tick. In a 1v1 that
    // is unambiguous; in larger matches the diagnostic becomes lossier but
    // still useful as a "did anything change" signal.
    for (const shooter of shootersThisTick) {
      if (shooter === ev.victimId) continue;
      let bucket = out.get(shooter);
      if (!bucket) {
        bucket = new Set();
        out.set(shooter, bucket);
      }
      bucket.add(ev.victimId);
    }
  }
  // `players` is unused at present but is part of the signature so we can
  // refine attribution (e.g. by aim direction) without changing call sites.
  void players;
  return out;
}

/**
 * Return a new record containing only the entries whose numeric key is in
 * `ids`. Keys in WorldState entity maps are branded EntityId (number) stored
 * as string object keys at runtime. We compare by converting the string key
 * to a number and checking the Set.
 */
function filterRecord<V extends { id: import("@sim/types.ts").EntityId }>(
  record: Record<import("@sim/types.ts").EntityId, V>,
  ids: Set<import("@sim/types.ts").EntityId>,
): Record<import("@sim/types.ts").EntityId, V> {
  const out: Record<import("@sim/types.ts").EntityId, V> = {} as Record<
    import("@sim/types.ts").EntityId,
    V
  >;
  for (const [keyStr, entity] of Object.entries(record) as [string, V][]) {
    const id = Number(keyStr) as import("@sim/types.ts").EntityId;
    if (ids.has(id)) {
      out[id] = entity;
    }
  }
  return out;
}

/**
 * Pick the highest-scoring player. Returns null on a tie (or empty scores) —
 * the schema treats null as a draw and recordMatchResult coerces it to "".
 * Iteration is in sorted-id order to keep ties deterministic.
 */
function pickWinner(scores: Record<PlayerId, number>): PlayerId | null {
  // Object.keys widens the branded key to string; re-brand at the boundary.
  const ids = (Object.keys(scores) as PlayerId[]).sort();
  let bestId: PlayerId | null = null;
  let bestScore = -Infinity;
  let tied = false;
  for (const id of ids) {
    const score = scores[id]!;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  if (bestId === null || tied) return null;
  return bestId;
}
