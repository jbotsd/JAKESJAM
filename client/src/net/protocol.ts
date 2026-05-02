// Wire protocol — must stay byte-identical to server/src/protocol.ts.
// Messages are MessagePack-encoded with a 1-byte version prefix.
// See docs/netcode-architecture.md "Message Protocol".

import { decode, encode } from "@msgpack/msgpack";
import type { InputSeq, SimEvent, Tick, WorldState } from "../sim/types.js";
import type { DeltaPayload } from "./snapshotDelta.js";

export const PROTOCOL_VERSION = 2;

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
  /**
   * Server-driven tick slew hint for this recipient.
   * +ve = client should slow down (inputs arriving early / client running fast).
   * -ve = client should speed up (inputs arriving late / client running slow).
   * Capped server-side to ±MAX_SLEW_MS_PER_TICK (1 ms). Omitted when 0.
   */
  tickAdjustMs?: number;
};

/**
 * Delta snapshot. Look up `baseline` tick in the local ring and call
 * `applyDelta(baselineState, delta)` to reconstruct the full state.
 * If the baseline tick isn't in the ring, send `ack { lastSnapshotTick: 0 }`
 * to request a full snapshot.
 */
export type DeltaSnapshot = {
  t: "snap";
  tick: Tick;
  lastProcessedInputSeq: Record<string, InputSeq>;
  baseline: Tick; // non-null discriminates from FullSnapshot
  delta: DeltaPayload;
  events: SimEvent[];
  /**
   * Server-driven tick slew hint for this recipient.
   * +ve = client should slow down (inputs arriving early / client running fast).
   * -ve = client should speed up (inputs arriving late / client running slow).
   * Capped server-side to ±MAX_SLEW_MS_PER_TICK (1 ms). Omitted when 0.
   */
  tickAdjustMs?: number;
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

export function decodeMessage<T = ServerMessage | ClientMessage>(
  buffer: ArrayBuffer | Uint8Array,
): { version: number; message: T } | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 2) return null;
  const version = bytes[0]!;
  const body = bytes.subarray(1);
  try {
    const message = decode(body);
    if (
      typeof message !== "object" ||
      message === null ||
      typeof (message as { t?: unknown }).t !== "string"
    ) {
      return null;
    }
    return { version, message: message as T };
  } catch {
    return null;
  }
}

// ---------------- Input bitfield helpers ----------------
// Bit layout matches docs/dev-stream-sim.md → InputBitfield.

export const InputBit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Fire: 1 << 6,
  Ability: 1 << 7,
  Shield: 1 << 8,
} as const;
