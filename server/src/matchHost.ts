// One MatchHost per active match. Owns the World, the tick loop, and the set
// of connected client WebSockets. Inputs flow in via routeMessage; snapshots
// flow out via the broadcast loop.

import type { ServerWebSocket } from "bun";
import { SNAPSHOT_INTERVAL_TICKS, STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime, type WorldRuntime } from "@sim/World.ts";
import { KILL_PLANE_MARGIN_PX } from "@sim/player.ts";
import { stepRound, enterDrafting } from "@sim/round.ts";
import { resolveMap, type MapId } from "@sim/data/maps.ts";
import { resolveModeConfig } from "@sim/data/modeConfig.ts";
import {
  createDirectorState,
  defaultDirectorBounds,
  directorToPose,
  stepSpectatorDirector,
  type DirectorState,
  type SpectatorCamPose,
} from "@sim/spectatorDirector.ts";
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
import { LagCompensator, LAG_COMP_MAX_TICKS, type RewindPlan } from "./LagCompensator.ts";

/**
 * Acceptable lookback for client-stamped input ticks. The server will drop
 * any input whose tick is older than `serverTick - this`. Set slightly
 * larger than LAG_COMP_MAX_TICKS so a steady-state lag-comp shooter is
 * never accidentally dropped.
 */
const LAG_COMP_INPUT_TICK_PAST_BOUND = LAG_COMP_MAX_TICKS + 6;
import { TickSlewController } from "./TickSlewController.ts";
import { convexClient, type ConvexId } from "./convexClient.ts";
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type PlayerLobbyInfo,
} from "@net/protocol.ts";
import { InterestGrid, CELL_SIZE_PX, OBSERVE_RADIUS_CELLS } from "./InterestGrid.ts";
import { encodeDelta } from "@net/snapshotDelta.ts";
import { makeHitSweepScratch } from "@sim/projectile.ts";
import { transferAuthority } from "@sim/authority.ts";
import { applyMidMatchJoin, applyRosterLeave } from "@sim/rosterOps.ts";
import { maybeSignalHostClip } from "./hostReplayBuffer.ts";
import { persistReplay } from "./replayStore.ts";
import { enqueueMatchHighlights } from "./clipRenderQueue.ts";
import { config } from "./config.ts";
import { ReplayRecorder } from "./ReplayRecorder.ts";
import { serverWasmHost } from "./serverWasmHost.ts";

/**
 * Phase B3 feature flag. Default OFF again as of 2026-07-06 (direct user
 * call: "the TS version was great but the Zig version is garbage"). Several
 * real bugs got found and fixed downstream of the 2026-07-05 Zig-default
 * flip (WorldRuntime persistence, a liveness backstop, a reconcile runtime
 * wipe, a projectile spawn-inside-geometry grace) — but live play over the
 * real funnel kept surfacing further symptoms under Zig authority that
 * never reproduced under TS, and this session's automated Playwright checks
 * repeatedly passed while the live build was still broken. TS
 * `stepWithRuntime` is authoritative again; Zig work continues, opt-in via
 * `USE_WASM_STEP_WORLD=1`. Do NOT flip this default back without real,
 * extensive human playtesting — scripted checks alone already proved
 * insufficient once this session.
 */
const USE_WASM_STEP_WORLD =
  process.env.USE_WASM_STEP_WORLD === "1" ||
  process.env.USE_WASM_STEP_WORLD === "true";

if (USE_WASM_STEP_WORLD) {
  // Fire-and-forget preload so the first tick after construction
  // doesn't await. If the load fails, serverWasmHost.isReady()
  // stays false and matchHost falls back to stepWithRuntime per
  // the runtime guard in stepOnce().
  void serverWasmHost.preload().catch((err) => {
    console.warn(
      `[matchHost] B3 wasm step preload failed; falling back to TS: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

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

/**
 * Liveness backstop. `lastSeenAt` is stamped on every inbound message, but
 * until this was added nothing ever ACTED on it — the only way a client's
 * disconnect was ever detected was the WS `close` event firing, which
 * requires a clean TCP FIN/WS close frame. An abruptly-killed client process
 * (observed repeatedly this session from test-runner timeouts) or a tunnel
 * that silently drops a socket produces neither: the connection sits in
 * `this.clients` forever, `disconnectedAt` never gets set, and
 * `evictExpiredDisconnects` never even starts counting for it. Long-running
 * always-on worlds (WorldHost) accumulate these zombies over hours of uptime
 * — each one still occupies a slot the sim packs into wasm memory
 * (MAX_PLAYERS=16), degrading or starving real players once enough zombies
 * pile up. The client sends an input frame every tick regardless of activity
 * (even background-tab-throttled ~1Hz), so genuine silence this long means
 * the connection is actually dead, not just idle.
 */
export const LIVENESS_TIMEOUT_MS = 20_000;
/** How often to actually run the liveness scan — no need to do the
 *  Date.now() + Map walk every tick. */
const LIVENESS_SWEEP_INTERVAL_MS = 5_000;

/**
 * Per bun-ws-server SKILL.md: drop snapshots when the kernel send buffer for a
 * client exceeds this threshold. 256 KB ≈ 25 unfiltered snapshots — anything
 * past that and the client is too far behind to catch up in any meaningful way.
 * Snapshots are self-replacing (tick-stamped); the next one supersedes any
 * dropped one.
 */
const MAX_WS_BUFFERED_BYTES = 256 * 1024;

/**
 * Input queue tuning. The server buffers a QUEUE of input frames per player
 * and consumes exactly one per tick, in seq order. A last-write-wins slot
 * (the old design) silently dropped any input that arrived in the same tick
 * interval as a later one — and then acked the dropped seq as processed, so
 * the client never replayed it either. Every jitter-batched packet pair
 * became permanently lost movement → authoritative position fell behind
 * prediction → reconcile rubber-banding.
 *
 * SOFT_CAP: queue depth drained (drop-oldest + ack) at the top of each tick.
 * Bounds the standing input latency to ~SOFT_CAP ticks when a client bursts
 * (e.g. tab refocus). TickSlewController keeps steady-state depth near the
 * 2-tick target lead, so the cap only bites on pathological bursts.
 *
 * MAX_DEPTH: absolute memory bound applied on push, between ticks.
 */
const INPUT_QUEUE_SOFT_CAP = 5;
const INPUT_QUEUE_MAX_DEPTH = 120;

/**
 * When a tick fires with an empty queue (packet late or lost), re-apply the
 * player's last real input for up to this many consecutive ticks instead of
 * stepping them with null. World.step treats a null input as "all keys
 * released" — a one-tick full stop the client never predicted, guaranteeing
 * a reconcile snap. Holding the last input matches what the client's
 * prediction assumed. The cap exists so a client that genuinely stopped
 * sending (backgrounded tab, dead connection) doesn't keep walking/firing
 * forever off a stale frame.
 */
const INPUT_HOLD_MAX_TICKS = 15;


export class MatchHost {
  readonly matchId: string;
  private state: WorldState;
  private readonly runtime: WorldRuntime;
  private readonly clients = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  private readonly playerInfo = new Map<PlayerId, PlayerLobbyInfo>();
  /** Per-player FIFO of unprocessed input frames, seq-ordered. One frame is
   *  consumed per tick; see INPUT_QUEUE_SOFT_CAP doc for why this must be a
   *  queue and not a single slot. */
  private readonly pendingInputs = new Map<PlayerId, InputFrame[]>();
  private readonly lastProcessedInputSeq = new Map<PlayerId, InputSeq>();
  /** Last real (client-sent) input applied per player — source frame for
   *  input-hold synthesis on empty-queue ticks. */
  private readonly lastAppliedInput = new Map<PlayerId, InputFrame>();
  /** Consecutive ticks a player has been stepped on a held (synthesized)
   *  input. Reset to 0 whenever a real frame is consumed. */
  private readonly heldInputTicks = new Map<PlayerId, number>();
  private readonly lagComp = new LagCompensator();
  private readonly tickSlew = new TickSlewController();
  /** Per-tag once-only console.warn. Prevents log spam when the same internal
   *  error fires every tick (e.g. lag-comp replay throws on a malformed runtime). */
  private readonly warnedTags = new Set<string>();
  private warnOnce(tag: string, message: string): void {
    if (this.warnedTags.has(tag)) return;
    this.warnedTags.add(tag);
    console.warn(message);
  }
  /**
   * Wall-clock ms (Date.now) at which each known player's connection dropped.
   * Entries are added on `detachClient`, cleared on a successful re-attach.
   * The tick loop evicts entries older than RECONNECT_GRACE_MS.
   */
  private readonly disconnectedAt = new Map<PlayerId, number>();
  /** Last wall-clock time we received an input from a given player. */
  private readonly lastSeenAt = new Map<PlayerId, number>();
  /** Throttle for `sweepStaleConnections` — see LIVENESS_SWEEP_INTERVAL_MS. */
  private lastLivenessSweepAt = 0;
  /**
   * Throttle map for the "dropping out-of-window input" log. Keyed by player,
   * value = wall-clock ms of last log. Prevents log spam from a tampered or
   * clock-skewed client. Cleared when the player is evicted.
   */
  private readonly lastInputDropLogAt = new Map<PlayerId, number>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly rngSeed: number;
  private startedAt = 0;
  /** Spatial grid for per-recipient snapshot filtering (AOI). Rebuilt each
   *  snapshot tick in broadcastSnapshot before per-client filtering runs. */
  private readonly grid: InterestGrid;
  /** Sim backend pinned for the whole match (replay fidelity — see ctor). */
  private readonly simBackend: "wasm" | "ts";
  /** Monotonically-increasing snapshot counter. Used to gate DEBUG_AOI logs
   *  to the first 30 snapshots only. */
  private snapshotCount = 0;
  /** Lifetime tally of snapshots skipped because the recipient's WS send
   *  buffer was over MAX_WS_BUFFERED_BYTES. Surfaced via summary() for ops. */
  private snapshotsDroppedForBackpressure = 0;

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
  /**
   * Events accumulated since the last snapshot broadcast. Snapshots go out
   * every SNAPSHOT_INTERVAL_TICKS; sim events fire every tick. Broadcasting
   * only the snapshot-tick's events silently dropped 2/3 of all events at
   * 20Hz (missing shot SFX / hit feedback / kill callouts — observed live).
   */
  private pendingEvents: import("@sim/types.ts").SimEvent[] = [];
  /** Set true the first time a `matchComplete` post to Convex is *initiated*.
   *  Prevents duplicate writes (in addition to the idempotent server-side
   *  mutation). One flag per host == one write per match lifetime. */
  private matchCompletePosted = false;
  /** Human-killer moments for host-rendered highlight clips. */
  private humanKillMoments: Array<{ tick: number; killerId: string }> = [];

  private readonly map: MapDefinition;

  /**
   * Esports-style arena spectator director. Stepped every sim tick from the
   * FULL (unfiltered) world so broadcast/stream clients share one framing.
   * Pose is piggybacked on every snapshot as `cam`.
   */
  private director: DirectorState = createDirectorState();
  private directorBounds = defaultDirectorBounds();
  private latestCam: SpectatorCamPose | null = null;

  /**
   * Per-match input recorder. Captures every accepted input frame keyed by
   * the server-tick it was applied at, plus a header (rngSeed, mapId,
   * players). Sufficient for deterministic playback per replay-spectator
   * SKILL.md. The blob is fetched via `getReplayBlob()` at match end; the
   * Convex storage write is DEFER'd until the playback ReplayScene lands.
   */
  private readonly replayRecorder: ReplayRecorder;

  /** Fired exactly once when the match completes (a player reaches the
   *  target score). WorldHost uses it to recycle the always-on world into
   *  a fresh match; room mode leaves it unset (registry tears down). */
  private readonly onMatchComplete?: () => void;

  constructor(
    matchId: string,
    players: PlayerSpawnInfo[],
    // Now wired from Convex via matching registry / WorldHost. Room/host
    // defaults to [] if no room is available (e.g. IO world).
    chaosModifierIds: string[],
    // A pre-resolved MapDefinition (Arena Forge custom maps — see
    // mapStore.ts/loadCustomMap) bypasses resolveMap() entirely; callers
    // resolve "custom:<code>" to the real object BEFORE constructing this
    // (matchRegistry.ts/worldHost.ts, both already async call sites), since
    // resolveMap() itself must stay synchronous for the client's per-tick
    // sim path and has no way to do a disk read.
    mapId: MapId | string | MapDefinition | undefined = undefined,
    opts: { onMatchComplete?: () => void } = {},
  ) {
    this.onMatchComplete = opts.onMatchComplete;
    this.matchId = matchId;
    this.map = typeof mapId === "object" ? mapId : resolveMap(mapId);
    this.directorBounds = defaultDirectorBounds(
      this.map.size?.x ?? 3000,
      this.map.size?.y ?? 1100,
    );
    this.rngSeed = (Math.random() * 0xffffffff) >>> 0;
    this.state = World.create(
      this.map,
      players,
      this.rngSeed,
      chaosModifierIds,
    );
    this.runtime = createRuntime(this.map);
    // B3: also push the map's static-AABB cache to the wasm host
    // so step_world has terrain. Idempotent; no-op when wasm path
    // is disabled. The host buffers if not yet ready.
    if (USE_WASM_STEP_WORLD) {
      const aabbs = this.map.platforms.map((p) => ({
        x: p.position.x - p.size.x / 2,
        y: p.position.y - p.size.y / 2,
        w: p.size.x,
        h: p.size.y,
      }));
      const oneWay = this.map.platforms.map((p) =>
        p.kind === "platform" ? 1 : 0,
      );
      serverWasmHost.setStatics(aabbs, oneWay);
      // Ceiling clamp + void kill-plane — same values the client feeds its host,
      // so step_world's bounds match on both sides.
      serverWasmHost.setArenaBounds(
        this.runtime.ceilingClampY,
        this.map.size.y > 0 ? this.map.size.y + KILL_PLANE_MARGIN_PX : 0,
      );
      // Fire-hazard chaos modifier positioning needs the real map bounds —
      // must match the client's wasmHost.setMapSize call (2026-07-14).
      serverWasmHost.setMapSize(this.map.size.x, this.map.size.y);
    }
    this.grid = new InterestGrid(this.map.size.x, this.map.size.y, CELL_SIZE_PX);
    // Pin the sim backend for the WHOLE match. The old per-tick
    // `isReady()` re-check meant the backend could switch mid-match when
    // the wasm load finished — invisible live, but it makes the recorded
    // replay non-re-simulable (no single backend reproduces every tick).
    this.simBackend = USE_WASM_STEP_WORLD && serverWasmHost.isReady() ? "wasm" : "ts";
    this.replayRecorder = new ReplayRecorder({
      matchId: this.matchId,
      mapId: this.map.id,
      rngSeed: this.rngSeed,
      players,
      chaosModifierIds,
      simBackend: this.simBackend,
    });
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

  /**
   * Encoded replay blob for this match. Contains the rngSeed + every accepted
   * input frame; sufficient to deterministically re-simulate the match. Bytes
   * are msgpack-encoded — see `ReplayRecorder.serialize` for the schema.
   *
   * Currently called only by tests; production callers (Convex storage upload)
   * will land in the playback feature work item.
   */
  getReplayBlob(): Uint8Array {
    return this.replayRecorder.serialize();
  }

  /** Number of recorded input frames in the replay buffer. Diagnostics only. */
  replaySize(): number {
    return this.replayRecorder.size();
  }

  attachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId as PlayerId;
    const previous = this.clients.get(playerId);
    if (previous && previous !== ws) {
      // Explicit bye BEFORE the close: through proxies (funnel/tunnel) the
      // close frame's reason is often lost and the old tab just sees a raw
      // 1006 — it then auto-reconnects and kicks THIS socket, ping-ponging
      // the session between tabs forever. The in-band bye survives any
      // proxy; the client treats "replaced" as terminal (no reconnect).
      try {
        previous.send(encodeMessage({ t: "bye", reason: "replaced" }));
      } catch { /* socket already dead — close below is enough */ }
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
    // Fresh socket = fresh input pipeline. A page RELOAD keeps the player
    // id (sessionStorage) but restarts the client's seq counter at 1 — the
    // preserved watermark would reject every input as "out of order" and
    // freeze the player (unevictably: each rejected input refreshes
    // liveness). A resumed session's larger seqs still pass a 0 watermark,
    // so resetting is safe for both cases.
    this.lastProcessedInputSeq.set(playerId, 0 as InputSeq);
    this.pendingInputs.delete(playerId);
    this.lastAppliedInput.delete(playerId);
    this.heldInputTicks.delete(playerId);
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
    if (!this.shouldKeepTicking()) {
      this.stop();
    }
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  /** True while the tick loop is running. Bots only think when the world
   *  is actually simulating. */
  isRunning(): boolean {
    return this.interval !== null;
  }

  /** Start the tick loop if it isn't already running. WorldHost calls this
   *  after eager-booting a bot-only world so AI duelists simulate before the
   *  first human connects. */
  ensureTickLoop(): void {
    this.maybeStartLoop();
  }

  /** Keep simulating while anyone is in the world — connected humans, players
   *  in reconnect grace, or server-side bots (who are sim citizens but not
   *  WS clients). */
  private shouldKeepTicking(): boolean {
    return (
      this.clients.size > 0 ||
      this.disconnectedAt.size > 0 ||
      Object.keys(this.state.players).length > 0
    );
  }

  /** Read-only view of the live state for server-side bot brains. The
   *  state object is replaced (not mutated) each tick, so handing out the
   *  reference is safe as long as callers never write to it. */
  getStateSnapshot(): WorldState {
    return this.state;
  }

  /**
   * Server-side input injection for AI players — same validation path as
   * a WS input, minus the socket. Bots are first-class sim citizens: they
   * queue like everyone else and are subject to the same anti-cheat
   * clamps.
   */
  injectInput(playerId: PlayerId, input: import("@net/protocol.ts").Input): void {
    this.applyInput(playerId, input);
  }

  /** Server-side card pick for AI players during drafting. */
  injectCardPick(playerId: PlayerId, roundIndex: number, cardId: string): void {
    this.applyCardPick(playerId, { t: "card-pick", roundIndex, cardId });
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
    snapshotsDroppedForBackpressure: number;
  } {
    const round = this.state.round;
    const targetScore = resolveModeConfig(this.state.chaosModifierIds).targetScore;
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
      snapshotsDroppedForBackpressure: this.snapshotsDroppedForBackpressure,
    };
  }

  /**
   * Insert a new player into the world mid-match. Used when a second client
   * connects to a match that was created with only the first player.
   * Spawns them at one of the map's spawn points.
   */
  addPlayer(spawn: PlayerSpawnInfo): void {
    if (this.playerInfo.has(spawn.playerId)) return;
    // Roster event for the replay: without it a re-sim can't reconstruct
    // mid-match joiners (the header roster is match-start only).
    this.replayRecorder.noteJoin(this.state.tick as number, spawn);
    this.playerInfo.set(spawn.playerId, {
      playerId: spawn.playerId,
      characterId: spawn.characterId,
      color: spawn.color ?? "#ffffff",
      name: spawn.name ?? spawn.playerId,
    });
    this.lastProcessedInputSeq.set(spawn.playerId, 0 as InputSeq);

    // Shared roster op — the replay re-sim must apply the IDENTICAL state
    // surgery (rosterOps.ts), so the live host and playback run one code path.
    this.state = applyMidMatchJoin(this.state, this.map, spawn);
  }

  routeMessage(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    const decoded = decodeMessage<ClientMessage>(
      raw instanceof Buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw,
    );
    if (!decoded) return;
    if (decoded.version !== PROTOCOL_VERSION) {
      console.warn(
        `[matchHost] protocol mismatch from ${ws.data.playerId}: got=${decoded.version} expected=${PROTOCOL_VERSION}`,
      );
      try { ws.close(1002, "protocol-version"); } catch { /* socket already closed */ }
      return;
    }
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
      default: {
        // Exhaustiveness check: TypeScript will error here if a new
        // ClientMessage variant is added to protocol.ts and not handled
        // above. At runtime, log and ignore so a forgiving server still
        // tolerates unknown future variants from older/newer clients.
        const _exhaustive: never = message;
        console.warn(
          `[matchHost] unknown client message type from ${ws.data.playerId}:`,
          (_exhaustive as { t?: string }).t,
        );
        break;
      }
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
    message: import("@net/protocol.ts").CardPick,
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

  private applyInput(playerId: PlayerId, input: import("@net/protocol.ts").Input): void {
    // Refresh liveness regardless — even a duplicate seq proves the client is
    // alive on the wire.
    this.lastSeenAt.set(playerId, Date.now());
    // Dedupe against BOTH the processed watermark and the tail of the queue:
    // seqs already queued but not yet consumed must not be re-enqueued.
    const queued = this.pendingInputs.get(playerId);
    const tailSeq =
      queued && queued.length > 0
        ? queued[queued.length - 1]!.seq
        : (this.lastProcessedInputSeq.get(playerId) ?? 0);
    if (input.seq <= tailSeq) return; // out-of-order or duplicate

    // Anti-cheat / anti-bug input clamping. Per game-netcode SKILL.md:
    //   "Server clamps `dt`, validates `tick` is in a recent window, ignores
    //   wildly old inputs."
    //
    // - dt: clients send STEP_MS (16.67) but a malicious or buggy client could
    //   stamp anything. We accept [1, STEP_MS * 4] — anything outside that is
    //   treated as a single step for the sim's benefit. The sim itself uses a
    //   fixed step internally; dt is informational here.
    // - tick: must be within [serverTick - LAG_COMP_MAX_TICKS - 4,
    //   serverTick + 4]. Outside this window, lag-comp can't honor it anyway,
    //   AND it indicates either clock drift or a tampered client.
    // - keys: bitmask is 9 bits used (InputBit values up to 1<<8). Strip
    //   unknown bits so a client can't smuggle out-of-band signals through
    //   the input frame.
    const KNOWN_KEY_BITS = 0x3ff; // bits 0..9 inclusive (Left..Dash)
    const sanitizedKeys = input.keys & KNOWN_KEY_BITS;
    const sanitizedDt = Math.max(1, Math.min(STEP_MS * 4, Number.isFinite(input.dt) ? input.dt : STEP_MS));

    const serverTick = this.state.tick;
    const TICK_PAST_BOUND = LAG_COMP_INPUT_TICK_PAST_BOUND;
    // Was 4 — too tight. The slew controller TARGETS inputs arriving 2
    // ticks ahead, so ordinary jitter (+ the slow 1ms/tick convergence
    // after join) routinely puts honest clients at +5..+8. Observed live:
    // "dropping out-of-window input ... inputTick=1293 serverTick=1288"
    // — every drop rubber-bands the player. The stamp only feeds lag-comp
    // and this validation (the input queue consumes frames in seq order
    // regardless), so a generous future window is safe. Half a second:
    const TICK_FUTURE_BOUND = 30;
    const minTick = Math.max(0, serverTick - TICK_PAST_BOUND);
    const maxTick = serverTick + TICK_FUTURE_BOUND;
    if (input.tick < minTick || input.tick > maxTick) {
      // Drop the input entirely. Logging is throttled to avoid log spam from
      // a client whose clock is way off — once per second per player is enough.
      const now = Date.now();
      const last = this.lastInputDropLogAt.get(playerId) ?? 0;
      if (now - last >= 1000) {
        this.lastInputDropLogAt.set(playerId, now);
        console.warn(
          `[matchHost ${this.matchId}] dropping out-of-window input from ${playerId}: ` +
            `inputTick=${input.tick} serverTick=${serverTick} ` +
            `window=[${minTick},${maxTick}]`,
        );
      }
      return;
    }

    let queue = this.pendingInputs.get(playerId);
    if (!queue) {
      queue = [];
      this.pendingInputs.set(playerId, queue);
    }
    queue.push({
      seq: input.seq,
      tick: input.tick,
      keys: sanitizedKeys,
      aimX: Number.isFinite(input.aimX) ? input.aimX : 0,
      aimY: Number.isFinite(input.aimY) ? input.aimY : 0,
      dtMs: sanitizedDt,
    });
    // Memory bound between ticks; the tick-side soft-cap drain does the
    // real flow control (and acks what it drops).
    while (queue.length > INPUT_QUEUE_MAX_DEPTH) queue.shift();
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
   * Hard teardown WITHOUT closing client sockets — used by WorldHost when
   * migrating live connections to a replacement host. Clears every map
   * that could otherwise fire timers or broadcast to the moved sockets.
   */
  dispose(): void {
    this.stop();
    this.clients.clear();
    this.disconnectedAt.clear();
    this.pendingInputs.clear();
    this.lastAppliedInput.clear();
    this.heldInputTicks.clear();
    this.baselineRing.clear();
  }

  /**
   * Backstop for connections that go silent without ever firing a WS `close`
   * event (abruptly-killed client process, a tunnel that drops the socket
   * without signaling it). Force-closes anything that hasn't sent a single
   * message in LIVENESS_TIMEOUT_MS; the close() call feeds the EXISTING
   * detach -> disconnectedAt -> evictExpiredDisconnects pipeline, so this is
   * purely "make sure close() eventually fires," not a second cleanup path.
   * detachClient is idempotent (guards on `this.clients.get(playerId) === ws`)
   * so it's safe even if the real close event fires afterward too.
   */
  private sweepStaleConnections(): void {
    const now = Date.now();
    if (now - this.lastLivenessSweepAt < LIVENESS_SWEEP_INTERVAL_MS) return;
    this.lastLivenessSweepAt = now;
    for (const [playerId, ws] of this.clients) {
      if (this.disconnectedAt.has(playerId)) continue; // already being evicted
      const lastSeen = this.lastSeenAt.get(playerId);
      if (lastSeen === undefined) continue; // hasn't had a chance to stamp yet
      if (now - lastSeen <= LIVENESS_TIMEOUT_MS) continue;
      console.warn(
        `[matchHost ${this.matchId}] player ${playerId} silent for ${now - lastSeen}ms — force-closing (liveness backstop)`,
      );
      try {
        ws.close(1000, "liveness timeout");
      } catch {
        // Socket may already be unusable; detachClient below covers cleanup
        // either way since it doesn't depend on close() actually succeeding.
      }
      this.detachClient(ws);
    }
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
      // has no live clients, no pending grace timers, and no sim players.
      if (!this.shouldKeepTicking()) this.stop();
      return;
    }
    const now = Date.now();
    let evicted = false;
    for (const [playerId, disconnectedAt] of this.disconnectedAt) {
      if (now - disconnectedAt <= RECONNECT_GRACE_MS) continue;
      this.replayRecorder.noteLeave(this.state.tick as number, playerId);
      this.disconnectedAt.delete(playerId);
      this.playerInfo.delete(playerId);
      this.lastProcessedInputSeq.delete(playerId);
      this.lastSeenAt.delete(playerId);
      this.lastInputDropLogAt.delete(playerId);
      this.pendingInputs.delete(playerId);
      this.lastAppliedInput.delete(playerId);
      this.heldInputTicks.delete(playerId);
      // Free per-player baseline ring. Without this, long-lived matches with
      // many disconnect/reconnect cycles leak BASELINE_RING_SIZE WorldStates
      // per departed player.
      this.baselineRing.delete(playerId);
      // Shared roster op (rosterOps.ts) — one code path with replay playback.
      // Strips entity + score + drafting bookkeeping and rewrites owned
      // entities to world-owned (stale ownerIds must not linger; a
      // mid-draft leaver must not deadlock the drafting resolution gate).
      this.state = applyRosterLeave(this.state, playerId);
      evicted = true;
      console.log(
        `[matchHost ${this.matchId}] evicted player ${playerId} after ${RECONNECT_GRACE_MS}ms reconnect grace`,
      );
    }
    if (evicted && !this.shouldKeepTicking()) {
      this.stop();
    }
  }

  private tick(): void {
    this.sweepStaleConnections();
    this.evictExpiredDisconnects();

    const inputsByPlayer: Record<PlayerId, InputFrame | null> = {};
    // Iterate ALL known players, not just connected sockets: server-side
    // bots (WorldBots) have no ws client but queue inputs via injectInput —
    // keying on clients silently starved them (bots stood frozen at spawn).
    // Disconnected-grace players get input-hold too (capped at 15 ticks).
    for (const playerId of this.playerInfo.keys()) {
      const queue = this.pendingInputs.get(playerId);

      // Flow control: drain a backed-up queue (client burst, e.g. tab
      // refocus) down to the soft cap. Dropped frames are NOT acked: the
      // watermark only ever advances for inputs actually simulated. The
      // client keeps replaying a dropped input against authoritative state
      // until a LATER consumed seq covers it (the watermark is monotone),
      // so predicted effects — a fired projectile especially — stay alive
      // until the server's own version arrives instead of being erased
      // mid-flight. (Ack-on-drop was the root cause of "my bullets never
      // render at my muzzle": at steady-state queue depth the drain acked
      // fire inputs it never simulated, and the reconcile wiped the
      // predicted projectile every time.)
      if (queue) {
        while (queue.length > INPUT_QUEUE_SOFT_CAP) {
          queue.shift();
        }
      }

      let input = queue && queue.length > 0 ? queue.shift()! : null;
      if (input) {
        this.heldInputTicks.set(playerId, 0);
        this.lastAppliedInput.set(playerId, input);
        // Honest ack: ONLY seqs actually fed into World.step (or explicitly
        // dropped by flow control above) advance the watermark. Anything
        // else stays in the client's replay set.
        this.lastProcessedInputSeq.set(playerId, input.seq);
        // Replay: capture every accepted input frame keyed by the server-tick
        // it was applied at. Quake/Doom .DEM model — header + inputs is enough
        // to deterministically replay the entire match later.
        this.replayRecorder.record(this.state.tick, playerId, input);
      } else {
        // Input-hold: no fresh frame this tick (packet late/lost). Re-apply
        // the last real input, capped at INPUT_HOLD_MAX_TICKS, so the player
        // doesn't full-stop for a tick the client never predicted. The held
        // frame keeps its original seq — the watermark is monotone, so
        // re-setting the same value is a no-op and nothing is falsely acked.
        const held = this.lastAppliedInput.get(playerId);
        const heldFor = this.heldInputTicks.get(playerId) ?? 0;
        if (held && heldFor < INPUT_HOLD_MAX_TICKS) {
          this.heldInputTicks.set(playerId, heldFor + 1);
          input = { ...held, tick: this.state.tick, dtMs: STEP_MS };
          // Record the synthesized frame too — replay playback must step
          // the exact same inputs at the exact same ticks as the live sim.
          this.replayRecorder.record(this.state.tick, playerId, input);
        }
      }
      inputsByPlayer[playerId] = input;
    }

    // ---- Lag compensation: rewind opponents for shooting players ---------
    const rewindPlan = this.lagComp.buildRewindPlan(this.state, inputsByPlayer);
    const stepInputState = rewindPlan ? rewindPlan.stateForStep : this.state;

    // Snapshot a runtime clone BEFORE the authoritative step so the
    // diagnostic replay below starts from the same runtime state, not the
    // post-step one.
    const runtimeSnapshotForDiag = rewindPlan ? snapshotRuntime(this.runtime) : null;
    const preStepState = this.state;

    const result = this.runStep(stepInputState, inputsByPlayer);
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

    // Host-box replay buffer: kill events save a zero-cost NVENC clip when
    // the streaming host runs gpu-screen-recorder (JJ_HOST_REPLAY=1).
    maybeSignalHostClip(events);

    // Host-rendered clips: remember HUMAN kill moments; at replay persist
    // they become full-quality headless renders (clipRenderQueue.ts) — a
    // phone player's highlight is rendered by the 4080, not their phone.
    for (const e of events) {
      if (e.t === "player-killed" && e.killerId && !e.killerId.startsWith("bot_")) {
        this.humanKillMoments.push({ tick: this.state.tick as number, killerId: e.killerId });
      }
    }

    // Arena spectator director — full-world view, every tick, before AOI.
    this.director = stepSpectatorDirector(
      this.director,
      this.state,
      events,
      STEP_MS / 1000,
      this.directorBounds,
    );
    this.latestCam = directorToPose(this.director);

    if (result.matchComplete && !this.matchCompletePosted) {
      this.matchCompletePosted = true;
      // Fire-and-forget: never block the tick loop on a Convex round-trip.
      // The mutation itself is idempotent and the per-host flag above is the
      // throttle (one write per match per server process).
      void this.postMatchResult();
      // World mode: without this, the round machine parks in round-over
      // FOREVER after someone reaches the target score — the always-on
      // world bricks for every future joiner. WorldHost recycles here.
      this.onMatchComplete?.();
    }

    // Push position history AFTER the step so samples reflect the state
    // visible to clients in the next snapshot.
    this.lagComp.recordTick(this.state);

    // Accumulate this tick's events; flush the whole window with the next
    // snapshot so clients receive EVERY event exactly once.
    if (events.length > 0) this.pendingEvents.push(...events);
    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      const flush = this.pendingEvents;
      this.pendingEvents = [];
      this.broadcastSnapshot(flush);
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
  /**
   * Phase B3: pick the active step backend.
   *
   * - Default: TS `stepWithRuntime` (the authoritative path that's
   *   shipped for all of production history).
   * - When `USE_WASM_STEP_WORLD=1` AND `serverWasmHost.isReady()`:
   *   route through `serverWasmHost.step()` (Zig wasm). Falls back
   *   to TS automatically if the wasm preload hasn't completed
   *   yet (returns false from isReady()) or if the wasm step
   *   throws.
   *
   * Returns the same shape as `stepWithRuntime` so call sites
   * don't need to change.
   */
  private runStep(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
  ): { state: WorldState; events: SimEvent[]; matchComplete: boolean } {
    if (this.simBackend === "wasm") {
      try {
        // Build the per-player keys map so wasm sees fresh input.
        const inputsMap = new Map<
          string,
          { keys: number; prevKeys: number; aimX: number; aimY: number }
        >();
        for (const [pid, frame] of Object.entries(inputsByPlayer)) {
          if (!frame) continue;
          const prev = this.runtime.prevKeys.get(pid as PlayerId) ?? 0;
          inputsMap.set(pid, {
            keys: frame.keys,
            prevKeys: prev,
            aimX: frame.aimX,
            aimY: frame.aimY,
          });
          this.runtime.prevKeys.set(pid as PlayerId, frame.keys);
        }
        serverWasmHost.writeInputs(inputsMap);
        const result = serverWasmHost.step(state, STEP_MS);
        // The Zig round machine skips drafting; drive the between-rounds card
        // menu host-side (deterministic, reuses the TS round machine). Physics
        // stays authoritative in Zig. serverWasmHost's own WasmSimEvents are
        // dropped (snapshot broadcast carries the WorldState); the overlay's
        // round/draft events ARE returned so the loser-respawn + draft-resolved
        // pipeline still fires.
        const overlay = this.applyDraftingOverlay(state, result.state);
        return {
          state: overlay.state,
          events: overlay.events,
          matchComplete: result.matchComplete,
        };
      } catch (err) {
        console.warn(
          `[matchHost] wasm step threw; falling back to TS for this tick: ${err instanceof Error ? err.message : String(err)}`,
        );
        // The replay is no longer single-backend — record it so a future
        // replay renderer can flag/refuse instead of silently diverging.
        this.replayRecorder.noteBackendFallback();
      }
    }
    return stepWithRuntime(state, this.runtime, inputsByPlayer, STEP_MS);
  }

  /** Independent RNG cursor for host-driven drafting offers (kept off the sim
   *  rng so offer rolls don't perturb wasm physics determinism). */
  private roundRngCursor = 0x9e3779b9;

  /**
   * Drafting overlay for the wasm path. The Zig round machine advances
   * round-over → countdown (doing the heal/reset) but has no drafting phase.
   * Here we CAPTURE that transition into a card-draft menu and RESOLVE it with
   * the TS round machine, then hand back to Zig at countdown. Physics is
   * untouched — only `state.round` (+ drafted `player.cards`) are overlaid.
   */
  private applyDraftingOverlay(
    prevState: WorldState,
    stepped: WorldState,
  ): { state: WorldState; events: SimEvent[] } {
    const round = stepped.round;
    const targetScore = resolveModeConfig(stepped.chaosModifierIds).targetScore;

    // CAPTURE: the Zig transition round-over → countdown becomes drafting,
    // unless the match just ended or nobody is present to draft.
    if (prevState.round.phase === "round-over" && round.phase === "countdown") {
      const matchOver = Object.values(round.scores).some((s) => s >= targetScore);
      const anyDrafter = Object.keys(stepped.players).length > 0;
      if (matchOver || !anyDrafter) return { state: stepped, events: [] };
      const d = enterDrafting(
        // The Zig transition already bumped roundIndex; undo it so the eventual
        // drafting → countdown bump (in stepRound) lands on the right number.
        { ...round, roundIndex: prevState.round.roundIndex },
        stepped.players,
        stepped.tick,
        this.roundRngCursor,
      );
      this.roundRngCursor = d.rngState;
      return { state: { ...stepped, round: d.state }, events: d.events };
    }

    // RESOLVE: run the TS round machine for the drafting phase (picks are
    // recorded by applyDraftPick into round.draftingPicked). It stays in
    // drafting until all pick or the tick-based window expires, then returns
    // countdown + card patches.
    if (round.phase === "drafting") {
      const r = stepRound({
        state: round,
        players: stepped.players,
        dtMs: STEP_MS,
        targetScore,
        tick: stepped.tick,
        rngState: this.roundRngCursor,
      });
      this.roundRngCursor = r.rngState ?? this.roundRngCursor;
      // Display timer is tick-based (draftingExpiresAtTick) so it's immune to
      // the Zig sim also decrementing countdownRemainingMs during the hold.
      let nextRound = r.state;
      if (nextRound.phase === "drafting" && nextRound.draftingExpiresAtTick !== undefined) {
        const msLeft = Math.max(
          0,
          ((nextRound.draftingExpiresAtTick as number) - (stepped.tick as number)) * STEP_MS,
        );
        nextRound = { ...nextRound, countdownRemainingMs: msLeft };
      }
      let players = stepped.players;
      if (r.playerPatches) {
        players = { ...players };
        for (const [pid, patch] of Object.entries(r.playerPatches)) {
          const p = players[pid as PlayerId];
          if (p) players[pid as PlayerId] = { ...p, ...patch };
        }
      }
      return { state: { ...stepped, round: nextRound, players }, events: r.events };
    }

    return { state: stepped, events: [] };
  }

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
    } catch (err) {
      this.warnOnce(
        "lag-comp-naive-step",
        `[lag-comp] match=${this.matchId} naive-replay step threw: ${err instanceof Error ? err.message : String(err)}`,
      );
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
    // LOCAL replay persist FIRST — it must not sit behind any Convex call:
    // on a self-hosted box with no CONVEX_URL, getMatchSummary() returns
    // null and the early-return below used to silently skip persistence
    // for every world match (found 2026-07-10: four completed matches,
    // zero .jjr files).
    try {
      const bytes = this.replayRecorder.serialize();
      if (bytes.byteLength > 0) {
        const saved = persistReplay(this.matchId, bytes);
        if (saved) {
          console.log(`[matchHost ${this.matchId}] replay persisted: ${saved}`);
          enqueueMatchHighlights(saved, this.humanKillMoments, config.port);
        }
      }
      this.humanKillMoments = [];
    } catch (err) {
      console.warn(
        `[matchHost ${this.matchId}] replay persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      // Fire-and-forget Convex cold copy (local persist already happened
      // above, before any Convex dependency).
      try {
        const bytes = this.replayRecorder.serialize();
        if (bytes.byteLength > 0) {
          void convexClient.saveReplay(matchId, bytes);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[matchHost ${this.matchId}] replay serialize/upload skipped: ${message}`,
        );
      }
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
      // Backpressure handling per bun-ws-server SKILL.md: snapshots are
      // tick-stamped and self-replacing — if the kernel buffer is full we
      // drop THIS snapshot rather than queue it. The next snapshot supersedes
      // it anyway. We still push the baseline so the next delta has a valid
      // starting point IF the client is back to receiving by then; if the
      // client is truly stuck, the next attempt will also fail and we'll keep
      // dropping until the socket either drains or closes.
      const buffered = ws.getBufferedAmount();
      if (buffered > MAX_WS_BUFFERED_BYTES) {
        // Skip send; record stat and continue. We don't push the baseline
        // either: the client never saw this filtered state, so a later delta
        // computed against it would be wrong.
        this.snapshotsDroppedForBackpressure += 1;
        continue;
      }
      const sent = ws.send(payload);
      if (sent === -1) {
        // Socket already closed. Detach handler will follow; nothing to do.
        continue;
      }
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

    const cam = this.latestCam ?? undefined;

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
        ...(cam ? { cam } : {}),
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
      ...(cam ? { cam } : {}),
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
    // Cache is immutable for the match lifetime — share the reference;
    // safe even under concurrent lag-comp replay.
    collisionCache: runtime.collisionCache,
    // Fresh scratch buffers — the lag-comp replay path can run concurrently
    // with the main runtime tick, so they must not share mutable scratch.
    scratchSortedProjectileIds: [],
    scratchDeflectedProjectiles: new Map(),
    scratchHitSweep: makeHitSweepScratch(),
    ceilingClampY: runtime.ceilingClampY,
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
