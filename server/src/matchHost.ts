// One MatchHost per active match. Owns the World, the tick loop, and the set
// of connected client WebSockets. Inputs flow in via routeMessage; snapshots
// flow out via the broadcast loop.

import type { ServerWebSocket } from "bun";
import { SNAPSHOT_INTERVAL_TICKS, STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime, type WorldRuntime } from "@sim/World.ts";
import { boxworksWorld } from "@sim/data/boxworks.ts";
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
import { convexClient, type ConvexId } from "./convexClient.ts";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type PlayerLobbyInfo,
} from "./protocol.ts";

export type MatchSocketData = {
  matchId: string;
  playerId: string;
  authedAt: number;
};

// Boxworks is built once in `@sim/data/boxworks.ts` and shared verbatim with
// the client so authoritative collision matches client prediction. The cast
// strips Boxworks's wider pickup-kind union back down to the baseline sim
// type — `World.create` only copies `pickup.kind` through, so any string is
// safe at runtime.
const BOXWORKS_MAP: MapDefinition = boxworksWorld as MapDefinition;

// ---- Lag compensation -----------------------------------------------------
// Standard "rewind opponents" technique. When the server processes a fire
// input that was generated at client tick T, the shooter saw opponents where
// the server had them at T (server-side time, accounting for one-way latency
// and the client's interpolation buffer). We rewind every OTHER player to
// their tick-T position for the spawn frame so the shot lands where the
// shooter aimed. The shooter's own position is NOT rewound — they fire from
// where they are now, which is what their predicted client also did.
//
// Anti-cheat clamp: anything more than ~250 ms of lookback is suspect, so
// hard-cap. 250 ms / 16.67 ms/tick ≈ 15 ticks.
const LAG_COMP_MAX_MS = 250;
const LAG_COMP_MAX_TICKS = Math.ceil(LAG_COMP_MAX_MS / STEP_MS);
// History capacity. Two "ticks of headroom" past the cap so interpolation
// between adjacent samples never falls off the end, and there is room for
// the just-pushed entry plus a few stragglers if the loop falls behind.
const POSITION_HISTORY_CAPACITY = 32;

const FIRE_BIT = 1 << 6;

/**
 * How long to keep a disconnected player's entity alive in the world while we
 * wait for them to reconnect. After this window expires the entity, score
 * entry, and bookkeeping are all evicted.
 */
export const RECONNECT_GRACE_MS = 10_000;

type PositionSample = {
  tick: Tick;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
};

type RewindPlan = {
  /** The firing player whose lookback drove the rewind. Their position is
   *  not shifted; only opponents'. */
  shooter: PlayerId;
  /** Lookback in ticks (already clamped to LAG_COMP_MAX_TICKS). */
  lookbackTicks: number;
  /** Lookback in ms (lookbackTicks * STEP_MS). */
  lookbackMs: number;
  /** The historical tick we rewound opponents to. */
  targetTick: Tick;
  /** Per-opponent (dx, dy) shift from real -> rewound, used to invert
   *  the swap on the post-step state. */
  shifts: Map<PlayerId, { dx: number; dy: number }>;
  /** All players who fired this tick, with their individual lookbacks.
   *  Used only for diagnostic logging. */
  shooters: Array<{ playerId: PlayerId; lookbackTicks: number; lookbackMs: number }>;
  /** State copy with opponent positions pre-shifted, ready for stepWithRuntime. */
  stateForStep: WorldState;
};

export class MatchHost {
  readonly matchId: string;
  private state: WorldState;
  private readonly runtime: WorldRuntime;
  private readonly clients = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  private readonly playerInfo = new Map<PlayerId, PlayerLobbyInfo>();
  private readonly pendingInputs = new Map<PlayerId, InputFrame>();
  private readonly lastProcessedInputSeq = new Map<PlayerId, InputSeq>();
  /** Rolling per-player position history used for lag compensation. Each
   *  entry is a snapshot taken at the END of a tick; the array is ordered
   *  oldest -> newest and capped at POSITION_HISTORY_CAPACITY. */
  private readonly playerPositionHistory = new Map<PlayerId, PositionSample[]>();
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
  /** Set true the first time a `matchComplete` post to Convex is *initiated*.
   *  Prevents duplicate writes (in addition to the idempotent server-side
   *  mutation). One flag per host == one write per match lifetime. */
  private matchCompletePosted = false;

  constructor(
    matchId: string,
    players: PlayerSpawnInfo[],
    // TODO(chaos-pipe): the room's selected chaos modifier ids should flow
    // here once the matchmaker carries them. Today we stub an empty list so
    // the netcode path runs the no-chaos baseline; the sim already supports
    // any subset via World.create's optional 4th arg.
    chaosModifierIds: string[] = [],
  ) {
    this.matchId = matchId;
    this.rngSeed = (Math.random() * 0xffffffff) >>> 0;
    this.state = World.create(
      BOXWORKS_MAP,
      players,
      this.rngSeed,
      chaosModifierIds,
    );
    this.runtime = createRuntime(BOXWORKS_MAP);
    for (const spawn of players) {
      this.playerInfo.set(spawn.playerId, {
        playerId: spawn.playerId,
        characterId: spawn.characterId,
        color: spawn.color ?? "#ffffff",
        name: spawn.name ?? spawn.playerId,
      });
      this.lastProcessedInputSeq.set(spawn.playerId, 0);
    }
  }

  attachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId;
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
    const playerId = ws.data.playerId;
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
    this.lastProcessedInputSeq.set(spawn.playerId, 0);

    const existingCount = Object.keys(this.state.players).length;
    const spawnPoint =
      BOXWORKS_MAP.spawns[existingCount % Math.max(1, BOXWORKS_MAP.spawns.length)] ??
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
        this.applyInput(ws.data.playerId, message);
        break;
      case "ack":
        // TODO(deltaCodec): drop snapshots in the per-client baseline ring up
        // through message.lastSnapshotTick. Until delta encoding is in we
        // simply trust last-seen and move on.
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
      case "hello":
        // Hello is implicit on connect; ignore extras.
        break;
    }
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
      this.state = {
        ...this.state,
        players: nextPlayers,
        round: { ...this.state.round, scores: nextScores },
      };
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
    // Build (a) the state we feed to the sim (with opponents shifted to
    // their historical positions for the shooter with the largest lookback)
    // and (b) the per-opponent shift vectors so we can undo the rewind on
    // the resulting state. We also run a "no-comp" parallel step to detect
    // shots whose hit/no-hit outcome flipped because of the rewind, purely
    // for diagnostics.
    const rewindPlan = this.buildRewindPlan(inputsByPlayer);
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
      nextState = this.unshiftOpponents(nextState, rewindPlan);
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
    // visible to clients in the next snapshot. Lookups subtract from the
    // most recent sample's tick.
    this.recordPositionHistory();

    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.broadcastSnapshot(events);
    }
  }

  // ---- Lag compensation helpers -----------------------------------------

  /**
   * Inspect this tick's pending inputs. If any player is firing AND their
   * input.tick is older than the current server tick, build a rewind plan:
   *  - `stateForStep`: a copy of `this.state` with each opponent swapped to
   *    their historical position at the chosen lookback tick.
   *  - `shifts`: per-opponent (dx, dy) so we can invert the swap on the
   *    resulting state after stepWithRuntime returns.
   *  - `lookbackTicks` / `shooters`: bookkeeping for diagnostics.
   *
   * Multi-shooter ticks pick the largest lookback (the player most affected
   * by latency wins; in a duel the other player IS the shooter so this
   * collapses to "the only firing player's lookback"). For >2 player matches
   * with simultaneous fire we accept the approximation rather than running
   * the step N times.
   */
  private buildRewindPlan(
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
  ): RewindPlan | null {
    const serverTick = this.state.tick;
    let bestShooter: PlayerId | null = null;
    let bestLookback = 0;
    const shooters: Array<{ playerId: PlayerId; lookbackTicks: number; lookbackMs: number }> = [];

    for (const [pid, input] of Object.entries(inputsByPlayer)) {
      if (!input) continue;
      if ((input.keys & FIRE_BIT) === 0) continue;
      const rawDelta = serverTick - input.tick;
      const lookbackTicks = Math.max(0, Math.min(LAG_COMP_MAX_TICKS, rawDelta));
      shooters.push({ playerId: pid, lookbackTicks, lookbackMs: lookbackTicks * STEP_MS });
      if (lookbackTicks > bestLookback) {
        bestLookback = lookbackTicks;
        bestShooter = pid;
      }
    }

    if (bestShooter === null || bestLookback === 0) return null;

    const targetTick = serverTick - bestLookback;
    const shifts = new Map<PlayerId, { dx: number; dy: number }>();
    const rewoundPlayers: WorldState["players"] = { ...this.state.players };
    for (const [pid, entity] of Object.entries(this.state.players)) {
      if (pid === bestShooter) continue;
      const sample = this.getPlayerAtTick(pid, targetTick);
      if (!sample) continue;
      const dx = sample.x - entity.x;
      const dy = sample.y - entity.y;
      if (dx === 0 && dy === 0) continue;
      shifts.set(pid, { dx, dy });
      rewoundPlayers[pid] = { ...entity, x: sample.x, y: sample.y };
    }

    if (shifts.size === 0) return null;

    return {
      shooter: bestShooter,
      lookbackTicks: bestLookback,
      lookbackMs: bestLookback * STEP_MS,
      targetTick,
      shifts,
      shooters,
      stateForStep: { ...this.state, players: rewoundPlayers },
    };
  }

  /**
   * Invert the rewind plan's shift on the post-step state. The sim's
   * movement integration started each opponent from the rewound position,
   * so its output position is `(rewound + delta)`; we want `(real + delta)`.
   * Subtracting the original shift vector restores that. We leave health,
   * cooldowns, lastProcessedInputSeq etc. untouched — those are not affected
   * by the rewind.
   */
  private unshiftOpponents(state: WorldState, plan: RewindPlan): WorldState {
    const players: WorldState["players"] = { ...state.players };
    for (const [pid, shift] of plan.shifts) {
      const entity = players[pid];
      if (!entity) continue;
      players[pid] = { ...entity, x: entity.x - shift.dx, y: entity.y - shift.dy };
    }
    return { ...state, players };
  }

  /**
   * Returns the player's position at the given tick by linear interpolation
   * between the two surrounding history samples. Falls back to clamping at
   * the oldest/newest sample if `tick` lies outside the buffered range.
   * Returns null if there is no history at all (e.g. just-joined player).
   */
  private getPlayerAtTick(playerId: PlayerId, tick: Tick): PositionSample | null {
    const history = this.playerPositionHistory.get(playerId);
    if (!history || history.length === 0) return null;
    // Clamp to bounds.
    const first = history[0]!;
    const last = history[history.length - 1]!;
    if (tick <= first.tick) return first;
    if (tick >= last.tick) return last;
    // Find the bracketing pair. Linear scan is fine — capacity is 32.
    for (let i = history.length - 1; i > 0; i -= 1) {
      const hi = history[i]!;
      const lo = history[i - 1]!;
      if (tick >= lo.tick && tick <= hi.tick) {
        const span = hi.tick - lo.tick;
        if (span <= 0) return hi;
        const t = (tick - lo.tick) / span;
        return {
          tick,
          x: lo.x + (hi.x - lo.x) * t,
          y: lo.y + (hi.y - lo.y) * t,
          vx: lo.vx + (hi.vx - lo.vx) * t,
          vy: lo.vy + (hi.vy - lo.vy) * t,
          // Treat alive as the lo sample's value: a player who died between
          // lo and hi shouldn't be hittable at the target tick if we picked
          // the post-death sample, but pre-death they were hittable.
          alive: lo.alive,
        };
      }
    }
    return last;
  }

  /**
   * Push one sample per known player onto the history ring. Called at the
   * end of every tick AFTER state is committed.
   */
  private recordPositionHistory(): void {
    const tick = this.state.tick;
    for (const [pid, entity] of Object.entries(this.state.players)) {
      let history = this.playerPositionHistory.get(pid);
      if (!history) {
        history = [];
        this.playerPositionHistory.set(pid, history);
      }
      history.push({
        tick,
        x: entity.x,
        y: entity.y,
        vx: entity.vx,
        vy: entity.vy,
        alive: entity.alive,
      });
      if (history.length > POSITION_HISTORY_CAPACITY) {
        history.splice(0, history.length - POSITION_HISTORY_CAPACITY);
      }
    }
    // Drop history for players that have left the match entirely.
    for (const pid of this.playerPositionHistory.keys()) {
      if (!this.state.players[pid]) {
        this.playerPositionHistory.delete(pid);
      }
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
    const lastProcessed: Record<string, InputSeq> = {};
    for (const [pid, seq] of this.lastProcessedInputSeq) lastProcessed[pid] = seq;

    const payload = encodeMessage({
      t: "snap",
      tick: this.state.tick,
      lastProcessedInputSeq: lastProcessed,
      baseline: null,
      state: this.state,
      events,
    });
    for (const ws of this.clients.values()) {
      ws.send(payload);
    }
  }

  private sendHello(ws: ServerWebSocket<MatchSocketData>): void {
    ws.send(
      encodeMessage({
        t: "hello",
        matchId: this.matchId,
        startTick: this.state.tick,
        rngSeed: this.rngSeed,
        mapId: BOXWORKS_MAP.id,
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
 * Pick the highest-scoring player. Returns null on a tie (or empty scores) —
 * the schema treats null as a draw and recordMatchResult coerces it to "".
 * Iteration is in sorted-id order to keep ties deterministic.
 */
function pickWinner(scores: Record<PlayerId, number>): PlayerId | null {
  const ids = Object.keys(scores).sort();
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
