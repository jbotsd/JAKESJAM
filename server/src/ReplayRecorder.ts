// ReplayRecorder — minimal input-only deterministic replay capture.
//
// Per skills/replay-spectator SKILL.md:
//   "Record inputs + RNG seed + protocol version. Never record WorldState
//    snapshots as the source of truth. Playback re-runs the sim."
//
// JAKESJAM's sim is deterministic by construction (`game-sim-determinism`),
// so a tiny header + the input stream is sufficient to reproduce a match
// exactly. The full design has chunks, keyframes, and a dedicated
// ReplayScene; this file is the SMALLEST CHANGE that captures everything
// needed to enable that downstream work without committing to the full
// playback infrastructure today.
//
// Wire size for a 5-minute 2-player match @ 60Hz = ~36k frames × ~12B each
// ≈ 432KB raw msgpack. We keep the encoded blob in memory until match end,
// then expose it via `serialize()` for upload. No fire-and-forget Convex
// write is wired here yet — that's the playback work item.

import { encode as msgpackEncode } from "@msgpack/msgpack";
import type {
  InputFrame,
  PlayerId,
  PlayerSpawnInfo,
  Tick,
} from "@sim/types.ts";
import { PROTOCOL_VERSION } from "@net/protocol.ts";

/**
 * Schema version for the replay file format itself. Distinct from
 * `PROTOCOL_VERSION` — bump when the on-disk shape (header / chunk layout)
 * changes, even if PROTOCOL_VERSION hasn't.
 */
export const REPLAY_FORMAT_VERSION = 1;

export type ReplayHeader = {
  formatVersion: number;
  protocolVersion: number;
  matchId: string;
  mapId: string;
  rngSeed: number;
  startedAtMs: number;
  /** Filled in at serialize-time from the highest tick seen. */
  totalTicks: number;
  /** Snapshot of the lobby at recording start. */
  players: Array<{
    playerId: string;
    characterId: string;
    name: string;
    color: string;
    weaponId: string;
  }>;
  /** Chaos modifiers selected for this match. Empty array if none. */
  chaosModifierIds: readonly string[];
};

export type ReplayInputEntry = {
  /** Wall-clock or sim tick at which this frame was applied authoritatively.
   *  We record the SERVER TICK (state.tick at the moment we stamped it),
   *  NOT the client-stamped input.tick — playback feeds inputs in server-tick
   *  order so the replay sim observes the same per-tick batching the live
   *  match did. */
  atTick: number;
  playerId: string;
  /** The raw InputFrame as accepted by the host. */
  frame: InputFrame;
};

/**
 * In-memory recording buffer. Small footprint (~12 bytes per input × ~3.6k
 * inputs/min/player) so we don't worry about chunking until file size is a
 * production concern.
 */
export class ReplayRecorder {
  private readonly header: ReplayHeader;
  private readonly inputs: ReplayInputEntry[] = [];
  /** Highest atTick seen — used to fill `header.totalTicks` at serialize. */
  private maxTick = 0;
  /** Set true on `serialize` so subsequent `record` calls are silently ignored
   *  (the recorder is single-shot per match). */
  private finalized = false;

  constructor(args: {
    matchId: string;
    mapId: string;
    rngSeed: number;
    players: PlayerSpawnInfo[];
    chaosModifierIds?: readonly string[];
    startedAtMs?: number;
  }) {
    this.header = {
      formatVersion: REPLAY_FORMAT_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      matchId: args.matchId,
      mapId: args.mapId,
      rngSeed: args.rngSeed,
      startedAtMs: args.startedAtMs ?? Date.now(),
      totalTicks: 0,
      players: args.players.map((p) => ({
        playerId: p.playerId,
        characterId: p.characterId,
        name: p.name ?? p.playerId,
        color: p.color ?? "#ffffff",
        weaponId: p.weaponId,
      })),
      chaosModifierIds: args.chaosModifierIds ?? [],
    };
  }

  /**
   * Append an input frame as accepted by the host. Call from MatchHost.tick
   * after the frame has been promoted from `pendingInputs` into the per-tick
   * `inputsByPlayer` record. Order matters — the playback sim assumes the
   * recorded order matches the live order.
   */
  record(serverTick: Tick, playerId: PlayerId, frame: InputFrame): void {
    if (this.finalized) return;
    this.inputs.push({
      atTick: serverTick as number,
      playerId,
      frame,
    });
    if (serverTick > this.maxTick) this.maxTick = serverTick as number;
  }

  /**
   * True iff this recorder has captured at least one input. Used to gate
   * "should we even bother saving?" — empty replays of no-op matches aren't
   * worth uploading.
   */
  hasContent(): boolean {
    return this.inputs.length > 0;
  }

  /** Number of recorded input frames, for diagnostics. */
  size(): number {
    return this.inputs.length;
  }

  /**
   * Produce the encoded replay blob. After this returns, the recorder is
   * finalized and `record()` calls are silently dropped — same shape as
   * Quake's `.dem` close: a replay file is a single shot.
   *
   * Returns the msgpack-encoded `{ header, inputs }` shape ready for upload
   * to a blob store (Convex storage when wired) OR to be passed straight
   * into `playReplay` for an in-process self-test.
   */
  serialize(): Uint8Array {
    if (this.finalized) return msgpackEncode(this.snapshot());
    this.finalized = true;
    this.header.totalTicks = this.maxTick;
    return msgpackEncode(this.snapshot());
  }

  /**
   * Live read-only view of the recording. Used by tests; production code
   * should call `serialize()` and treat the bytes as opaque.
   */
  snapshot(): { header: ReplayHeader; inputs: readonly ReplayInputEntry[] } {
    return { header: this.header, inputs: this.inputs };
  }
}

// ── Playback ─────────────────────────────────────────────────────────────────
//
// `playReplay` is the small companion that proves the recording round-trips:
// given a recorder snapshot + a step function, it re-runs the sim and returns
// the final state. The full ReplayScene playback (cursor + chunked chaos +
// keyframes) is DEFERRED — wire it up once the desktop "watch a friend's
// match" feature ships.

import type { WorldState } from "@sim/types.ts";

/**
 * Replay configuration plug. Caller supplies a step function so this module
 * stays free of the World import (which transitively imports a lot). The
 * production caller is the test in __tests__/replayRecorder.test.ts which
 * imports stepWithRuntime + createRuntime + World.create to produce these.
 */
export type ReplayPlayback = {
  initialState: WorldState;
  step: (
    state: WorldState,
    inputsByPlayer: Record<string, InputFrame | null>,
  ) => WorldState;
};

/**
 * Re-execute the recording. Inputs are batched by `atTick` so each step
 * receives the same {playerId → InputFrame} record the live host would have.
 * Returns the final state — the caller asserts equality against the live run.
 */
export function playReplay(
  snapshot: { header: ReplayHeader; inputs: readonly ReplayInputEntry[] },
  playback: ReplayPlayback,
): WorldState {
  // Group inputs by atTick. Map preserves insertion order, so iterating
  // `inputsByTick.entries()` yields ticks in the order they were recorded
  // — but we explicitly sort numerically because some inputs may have been
  // recorded out-of-order if the future allows simultaneous-tick batching.
  const byTick = new Map<number, ReplayInputEntry[]>();
  for (const entry of snapshot.inputs) {
    let bucket = byTick.get(entry.atTick);
    if (!bucket) {
      bucket = [];
      byTick.set(entry.atTick, bucket);
    }
    bucket.push(entry);
  }
  const ticks = Array.from(byTick.keys()).sort((a, b) => a - b);

  let state = playback.initialState;
  for (const tick of ticks) {
    const entries = byTick.get(tick)!;
    const inputs: Record<string, InputFrame | null> = {};
    for (const entry of entries) {
      inputs[entry.playerId] = entry.frame;
    }
    state = playback.step(state, inputs);
  }
  return state;
}
