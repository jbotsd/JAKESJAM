// Wire protocol — must stay byte-identical to server/src/protocol.ts.
// Messages are MessagePack-encoded with a 1-byte version prefix.
// See docs/netcode-architecture.md "Message Protocol".

import { decode, encode } from "@msgpack/msgpack";
import type { InputSeq, SimEvent, Tick, VesselCosmetics, WorldState } from "../sim/types.js";
import type { SpectatorCamPose } from "../sim/spectatorDirector.js";
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

/**
 * Duos-queue intent toggle (classes-goal.md "Venue integration" — the bell
 * gains a team variant). Lobby-only, venue business rather than lobby-sim
 * business (same discipline as `card-pick`: VenueHost intercepts it in
 * `routeLobby` before the message ever reaches the hangout MatchHost's
 * `routeMessage` switch). Flips the sender's "queue as duo" intent; it does
 * NOT by itself join/leave a queue — walking into the bell totem still does
 * that, using whichever intent is current at the moment of the walk-up.
 * No payload: the server tracks intent as a boolean per lobby-connected
 * player, toggled on receipt.
 */
export type DuoToggle = {
  t: "duo-toggle";
};

/**
 * Class ability catalog toggle (docs/classes-goal.md "Loadout station owns
 * the 3 slots" — live playtest finding 2026-07-18, Jake: "this should show
 * all cards for that class when its selected not just three and this
 * should have the concept of selecting them"). Lobby-only, venue business
 * (same interception discipline as `card-pick`/`duo-toggle`: VenueHost
 * handles it in `routeLobby` before the message ever reaches the hangout
 * MatchHost). No `add`/`remove` discriminant — the server flips membership:
 * `cardId` already in the player's loadout picks → removed; otherwise
 * added (rejected silently if the rack's active slots are already full,
 * or `cardId` isn't a catalog card belonging to the player's locked
 * loadout classId). Distinct from `card-pick`, which stays the UNIVERSAL
 * random-offer-and-reroll flow, completely unchanged by this feature.
 */
export type CatalogToggle = {
  t: "catalog-toggle";
  cardId: string;
};

/**
 * Loadout-station class switch (Bug fix, live playtest 2026-07-18 — Jake
 * selected Interstice/ninja in the class row but the ability catalog grid
 * below kept showing Geometrician/wizard's abilities). Lobby-only, venue
 * business — same interception discipline as `catalog-toggle`/`duo-toggle`:
 * VenueHost's `routeLobby` handles it before the message ever reaches the
 * hangout MatchHost. `characterId` is the RAW archetype id the client-side
 * class row picked; it rides client-sanitized (`sanitizeCharacterId`) but
 * the server re-sanitizes on receipt — the wire is never trusted. The
 * server re-derives `classId` (`classIdForArchetype`) for the player's
 * loadout entry, drops any armed catalog pick that no longer belongs to
 * the new class, and immediately re-pushes a fresh `venue-draft` — the
 * whole point being the catalog grid updates WITHOUT leaving and
 * re-entering the totem zone. A pick before ever touching the station
 * simply creates a fresh entry locked to the new class (empty picks).
 */
export type ClassPick = {
  t: "class-pick";
  characterId: string;
};

export type ClientMessage =
  | ClientHello
  | Input
  | Ack
  | Ping
  | CardPick
  | DuoToggle
  | CatalogToggle
  | ClassPick;

// ---------------- Server → Client ----------------

export type PlayerLobbyInfo = {
  playerId: string;
  characterId: string;
  color: string;
  name: string;
  cosmetics?: VesselCosmetics;
  /**
   * Duos-queue team assignment (classes-goal.md "Venue integration") —
   * mirrors `PlayerSpawnInfo.teamId` (sim/types.ts) exactly, same additive/
   * optional contract as `cosmetics`: absent = an ordinary FFA combatant,
   * old clients simply never see the field. Reaches the client via
   * `ServerHello.allPlayers` only (never the per-tick snapshot/delta path),
   * so consuming it is a future client concern (Priest's ally-awareness) —
   * this wire hop is the full extent of what this pass does with it.
   */
  teamId?: string;
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
  /**
   * Server arena-spectator director pose (esports observer cam). Optional —
   * older clients ignore. Broadcast clients (`?spectator=1` / F9) follow this
   * instead of the local player.
   */
  cam?: SpectatorCamPose;
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
  /** Server arena-spectator director pose — see FullSnapshot.cam. */
  cam?: SpectatorCamPose;
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

/**
 * Venue lobby status frame (venue-sprint2-goal S2.B) — PUSHED by VenueHost
 * to every lobby socket at ~1Hz and immediately on arena phase edges;
 * never polled. Drives the lobby's diegetic arena feed and the queue
 * totem's bell countdown. `queued` carries player ids so the totem can
 * glow per queued player and the local client knows its own queue state.
 */
export type VenueStatus = {
  t: "venue-status";
  arenaPhase: "countdown" | "fighting" | "round-over" | "drafting";
  roundIndex: number;
  scores: Record<string, number>;
  humans: number;
  bots: number;
  nextBellMs: number;
  /** The FFA bell queue — UNCHANGED shape/semantics (classes-goal.md's
   *  duos call is additive: "FFA bell unchanged"). */
  queued: string[];
  /** The duo bell queue (classes-goal.md "Venue integration") — a player
   *  toggled duo intent on, then walked into the bell totem. Paired up
   *  (or auto-paired with an elastic bot) at the same countdown edge the
   *  FFA queue drains at; see venueHost.ts's `admitDuoQueue`. */
  duoQueued: string[];
};

/**
 * Loadout-station state (venue-sprint2-goal S2.E; separated from the bell
 * queue 2026-07-17 per Jake) — pushed by VenueHost to a lobby socket when
 * that player walks into the LOADOUT STATION totem, re-pushed on the
 * totem's retrigger cadence while they stand there, and again after every
 * `catalog-toggle`/`class-pick`. `picks` is the player's FULL current rack
 * (exactly what `getEntrantCards` will hand the arena) and `classId` is the
 * chassis this loadout entry is currently locked to. No pick = spawn with
 * none — the bell never auto-picks.
 *
 * The UNIVERSAL random-offer-and-reroll flow this frame used to carry
 * (`offers: string[]`, resolved via `card-pick`) was CUT FROM THE STATION
 * ENTIRELY 2026-07-18 (Jake, live playtest — with the catalog grid AND the
 * old "UNIVERSAL OFFER" 3-card section on screen together: "delete this
 * mechanic and gameplay and focus on the other things on this ui ... I
 * mean in the load out picker"). Universal cards are acquired ONLY through
 * the in-match between-round draft now (round.ts's `enterDrafting`,
 * `matchHost.ts`'s `card-pick` handling — a completely separate code path,
 * untouched by this). The `offers` field is removed from the wire rather
 * than always-sent-empty: nothing downstream reads it anymore, so keeping
 * it would just be dead surface pretending to still mean something.
 *
 * `classId` LIVE-updates on a `class-pick` message (Bug fix, live playtest
 * 2026-07-18): a mid-visit class-row click re-derives it immediately
 * instead of waiting for a fresh station visit, and any armed catalog pick
 * that no longer belongs to the new class is dropped from `picks` in the
 * same push.
 */
export type VenueDraft = {
  t: "venue-draft";
  picks: string[];
  classId: string;
};

/**
 * The bell (venue-sprint2-goal S2.F) — pushed once to each queued lobby
 * socket at the arena's countdown-entry edge. The client hands off to the
 * arena scene; the shared world token already grants /ws/world, and the
 * starter pick waits server-side in the admitted map (TTL'd), so the lobby
 * socket may close before or after the arena attach without racing it.
 */
export type VenueAdmitted = {
  t: "venue-admitted";
  arenaWsPath: string;
};

export type ServerMessage =
  | ServerHello
  | Snapshot
  | Pong
  | Disconnect
  | VenueStatus
  | VenueDraft
  | VenueAdmitted;

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
  "duo-toggle": [],
  "catalog-toggle": [["cardId", "string"]],
  "class-pick": [["characterId", "string"]],
  snap: [["tick", "number"]],
  bye: [["reason", "string"]],
  "venue-status": [["arenaPhase", "string"], ["nextBellMs", "number"]],
  "venue-draft": [["picks", "object"], ["classId", "string"]],
  "venue-admitted": [["arenaWsPath", "string"]],
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
// Note (2026-07-18): the ninja melee slash does NOT get a new input bit —
// it reuses Fire (bit 6), the existing universal "primary attack" input.
// World.ts branches on classId at the stepWeapon call site: ninja chassis
// route the Fire rising-edge into the slash FSM instead of stepWeapon; all
// other classes are untouched. See World.ts's "1. Players" fire block.
