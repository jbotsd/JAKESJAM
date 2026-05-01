// Wire protocol — must be byte-identical to client/src/net/protocol.ts.
// Messages are MessagePack-encoded with a 1-byte version prefix.
// See docs/netcode-architecture.md "Message Protocol".

import { decode, encode } from "@msgpack/msgpack";
import type { InputSeq, SimEvent, Tick, WorldState } from "@sim/types.ts";

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

export type ClientMessage = ClientHello | Input | Ack | Ping;

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

export type Snapshot = {
  t: "snap";
  tick: Tick;
  lastProcessedInputSeq: Record<string, InputSeq>;
  baseline: Tick | null;
  // For the scaffold we ship full world state. deltaCodec replaces this
  // with per-entity diffs once the sim is real. The shape on the wire is
  // already the partial-encoded form so the codec is a drop-in later.
  state: WorldState;
  events: SimEvent[];
};

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
