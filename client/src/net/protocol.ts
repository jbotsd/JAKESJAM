// Wire protocol — must stay byte-identical to server/src/protocol.ts.
// Messages are MessagePack-encoded with a 1-byte version prefix.
// See docs/netcode-architecture.md "Message Protocol".

import { decode, encode } from "@msgpack/msgpack";
import type { InputSeq, SimEvent, Tick, WorldState } from "../sim/types.js";
import type { DeltaPayload } from "./snapshotDelta.js";

// PROTOCOL_VERSION = 3 marks the wasm-orchestrator wire format
// (Phase G3 / J cutover). The bump signals to clients + servers
// that snapshots may carry the raw `WorldState` extern-struct
// bytes from sim.wasm in addition to the legacy `state: WorldState`
// TS object form. Mixed-version peers reject each other in the
// hello handshake.
export const PROTOCOL_VERSION = 3;

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

/**
 * Raw wasm-orchestrator snapshot. Carries the `WorldState` extern
 * struct bytes from `sim.wasm` directly — no msgpack hop, no
 * field-by-field repacking. The receiver runs `unpackWorldState`
 * (`@sim/wasm/worldStateBridge.ts`) to reconstruct the TS shape.
 *
 * Introduced at PROTOCOL_VERSION = 3 (Phase G3). Phase J flips
 * the server emission path to use this for full snapshots. The
 * legacy `FullSnapshot` shape is kept so older replays can still
 * be replayed offline.
 */
export type RawBytesSnapshot = {
  t: "snap-raw";
  tick: Tick;
  lastProcessedInputSeq: Record<string, InputSeq>;
  baseline: null;
  /** WORLD_STATE_TOTAL_SIZE bytes — see worldStateBridge.ts. */
  bytes: Uint8Array;
  events: SimEvent[];
  tickAdjustMs?: number;
};

/** Union of both snapshot variants. Discriminated by `baseline === null`. */
export type Snapshot = FullSnapshot | DeltaSnapshot | RawBytesSnapshot;

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
    // Same player id attached from a newer connection (second tab);
    // terminal on the receiving client — reconnecting would ping-pong.
    | "replaced"
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

/**
 * Required scalar-field shapes per discriminant. msgpack already guarantees
 * the high-level container types, so we only validate the discriminant +
 * the per-variant fields that downstream code dereferences without further
 * checking. Nested objects (state, delta, events) are trusted past msgpack.
 *
 * Direction is intentionally NOT enforced here — both sides share the codec
 * and a misrouted message produces a "no handler for t=X" log at the
 * dispatcher, which is more informative than rejecting at decode time.
 */
const REQUIRED_FIELDS: Record<string, ReadonlyArray<readonly [string, "string" | "number" | "object"]>> = {
  // `t: "hello"` is shared by ClientHello (has protocolVersion) and ServerHello
  // (doesn't — has matchId/startTick/rngSeed/mapId/yourPlayerId). The version
  // byte at buffer[0] already gates protocol compat, so we don't redundantly
  // require any `hello` field here. Each side's handler asserts the variant
  // it expects.
  hello: [],
  in: [["seq", "number"], ["tick", "number"], ["keys", "number"]],
  ack: [["lastSnapshotTick", "number"]],
  ping: [["clientTime", "number"]],
  pong: [["clientTime", "number"], ["serverTime", "number"]],
  "card-pick": [["roundIndex", "number"], ["cardId", "string"]],
  snap: [["tick", "number"]],
  bye: [["reason", "string"]],
};

const warnedUnknown = new Set<string>();

export function decodeMessage<T = ServerMessage | ClientMessage>(
  buffer: ArrayBuffer | Uint8Array,
): { version: number; message: T } | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 2) return null;
  const version = bytes[0]!;
  const body = bytes.subarray(1);
  let message: unknown;
  try {
    message = decode(body);
  } catch (e) {
    console.warn("[protocol] msgpack decode failed", e);
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const t = (message as { t?: unknown }).t;
  if (typeof t !== "string") return null;
  const required = REQUIRED_FIELDS[t];
  if (!required) {
    if (!warnedUnknown.has(t)) {
      warnedUnknown.add(t);
      console.warn(`[protocol] unknown discriminant t=${JSON.stringify(t)}`);
    }
    return null;
  }
  const obj = message as Record<string, unknown>;
  for (const [field, kind] of required) {
    if (typeof obj[field] !== kind) {
      console.warn(`[protocol] message t=${t} missing/invalid field ${field} (expected ${kind})`);
      return null;
    }
  }
  return { version, message: message as T };
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
  Dash: 1 << 9,
} as const;
