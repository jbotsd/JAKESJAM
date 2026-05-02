// Wire protocol — must be byte-identical to client/src/net/protocol.ts.
// Messages are MessagePack-encoded with a 1-byte version prefix.
// See docs/netcode-architecture.md "Message Protocol".

import { decode, encode } from "@msgpack/msgpack";
import type { InputSeq, SimEvent, Tick, WorldState } from "@sim/types.ts";
import type { DeltaPayload } from "./snapshotDelta.ts";

export const PROTOCOL_VERSION = 1;

// ---------------- Client → Server ----------------

export type ClientHello = {
  t: "hello";
  playerId: string;
  matchId: string;
  protocolVersion: number;
};

export type Input = {
  t: "in";
  seq: InputSeq;
  tick: Tick;
  keys: number;
  aimX: number;
  aimY: number;
  dt: number;
};

export type Ack = {
  t: "ack";
  lastSnapshotTick: Tick;
};

export type Ping = {
  t: "ping";
  clientTime: number;
};

/**
 * Client → Server: commit a draft card pick. Sent when the local player
 * clicks a card in the rogue-lite picker overlay during the `drafting`
 * round phase. Server validates that (a) the round is still in the same
 * `roundIndex` (so a stale click after a round flip is ignored) and (b)
 * the cardId was one of the offers rolled for this player. On success,
 * the card lands in `player.cards` AND in `state.round.draftingPicked`,
 * which is what unlocks the drafting → countdown transition in `stepRound`.
 *
 * Additive: older clients that don't know about this message simply never
 * send it; auto-pick on draft-window expiry is the safety net.
 */
export type CardPick = {
  t: "card-pick";
  roundIndex: number;
  cardId: string;
};

export type ClientMessage = ClientHello | Input | Ack | Ping | CardPick;

// ---------------- Server → Client ----------------

export type PlayerLobbyInfo = {
  playerId: string;
  characterId: string;
  color: string;
  name: string;
};

export type ServerHello = {
  t: "hello";
  matchId: string;
  startTick: Tick;
  rngSeed: number;
  mapId: string;
  yourPlayerId: string;
  allPlayers: PlayerLobbyInfo[];
};

/**
 * Full-state snapshot. Sent on first contact (baseline === null) or when the
 * client's ack falls outside the server's baseline ring.
 */
export type FullSnapshot = {
  t: "snap";
  tick: Tick;
  lastProcessedInputSeq: Record<string, InputSeq>;
  baseline: null;
  state: WorldState;
  events: SimEvent[];
};

/**
 * Delta snapshot. The client must look up `baseline` tick in its local ring
 * and call `applyDelta(baselineState, delta)` to reconstruct the full state.
 * If the client has evicted that tick, it should send `ack { lastSnapshotTick: 0 }`
 * to signal the server to drop back to a FullSnapshot.
 */
export type DeltaSnapshot = {
  t: "snap";
  tick: Tick;
  lastProcessedInputSeq: Record<string, InputSeq>;
  baseline: Tick; // non-null discriminates from FullSnapshot
  delta: DeltaPayload;
  events: SimEvent[];
};

/** Union of both snapshot variants. Discriminated by `baseline === null`. */
export type Snapshot = FullSnapshot | DeltaSnapshot;

export type Pong = {
  t: "pong";
  clientTime: number;
  serverTime: number;
};

export type Disconnect = {
  t: "bye";
  reason:
    | "opponent-left"
    | "match-ended"
    | "protocol-mismatch"
    | "auth-failed"
    | "server-shutdown";
};

export type ServerMessage = ServerHello | Snapshot | Pong | Disconnect;

// ---------------- Codec ----------------

export function encodeMessage(message: ClientMessage | ServerMessage): Uint8Array {
  const payload = encode(message);
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = PROTOCOL_VERSION;
  out.set(payload, 1);
  return out;
}

export function decodeMessage<T = ClientMessage | ServerMessage>(
  buffer: ArrayBuffer | Uint8Array,
): { version: number; message: T } | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 2) return null;
  const version = bytes[0]!;
  const body = bytes.subarray(1);
  try {
    const message = decode(body) as T;
    return { version, message };
  } catch {
    return null;
  }
}
