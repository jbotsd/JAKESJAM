// Server-native private room lobby — no Convex required.
//
// Lobbies live in process memory keyed by 6-char code. Host creates, others
// join, host starts → matchId + per-player tokens. MatchRegistry reads
// MatchPrep for map/chaos when the first WS client attaches.
//
// A2 (graceful-gliding-flame plan): each room also owns one always-on
// HANGOUT MatchHost — a real-networked, no-combat walking space players
// occupy before the real match starts, mirroring how `worldHost.ts` keeps
// one always-on MatchHost per process. It's spun up at room creation and
// torn down when the real match starts (`startPrivateMatch`) or the room
// empties/expires (`leavePrivateLobby`/`sweep`). Same-process wiring — no
// new network hop, just an in-memory Map alongside `lobbies`.

import type { ServerWebSocket } from "bun";
import { mintMatchToken } from "./auth.ts";
import { MatchHost, type MatchSocketData } from "./matchHost.ts";
import { config } from "./config.ts";
import { PlayerId, type PlayerSpawnInfo, type VesselCosmetics } from "@sim/types.ts";

export type LobbyPlayer = {
  playerId: string;
  name: string;
  color: string;
  characterId: string;
  cosmetics?: VesselCosmetics;
  ready: boolean;
  lastSeenAt: number;
};

export type PrivateLobby = {
  code: string;
  hostPlayerId: string;
  status: "lobby" | "starting" | "in_match";
  mapId: string;
  chaosModifierIds: string[];
  players: Map<string, LobbyPlayer>;
  matchId: string | null;
  /** Tokens issued at start — joiners poll and pick up their token. */
  tokens: Record<string, string> | null;
  createdAt: number;
};

export type MatchPrep = {
  matchId: string;
  mapId: string;
  chaosModifierIds: string[];
  players: Array<{
    playerId: string;
    name: string;
    color: string;
    characterId: string;
    cosmetics?: VesselCosmetics;
  }>;
};

export type LobbySnapshot = {
  code: string;
  hostPlayerId: string;
  status: PrivateLobby["status"];
  mapId: string;
  chaosModifierIds: string[];
  matchId: string | null;
  players: LobbyPlayer[];
  tokens?: Record<string, string>;
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOBBY_TTL_MS = 2 * 60 * 60 * 1000;
const HEARTBEAT_STALE_MS = 45_000;

const lobbies = new Map<string, PrivateLobby>();
const matchPrep = new Map<string, MatchPrep>();

/** One always-on hangout MatchHost per room-with-a-hangout-world (A2). */
const hangoutHosts = new Map<string, MatchHost>();
const HANGOUT_MATCH_PREFIX = "hangout_";

/** The synthetic matchId a room's hangout MatchHost is keyed under on the
 *  wire (`/ws?matchId=...`) — same `/ws` upgrade path real matches use. */
export function hangoutMatchId(code: string): string {
  return `${HANGOUT_MATCH_PREFIX}${code.toUpperCase()}`;
}

export function isHangoutMatchId(matchId: string): boolean {
  return matchId.startsWith(HANGOUT_MATCH_PREFIX);
}

function codeFromHangoutMatchId(matchId: string): string {
  return matchId.slice(HANGOUT_MATCH_PREFIX.length);
}

/**
 * Create (or return the existing) hangout MatchHost for a room. Reuses the
 * exact always-on-instance pattern `worldHost.ts` already proves — one
 * MatchHost, players drift in/out via `addPlayer`/`attachClient`, the tick
 * loop keeps running as long as anyone's connected.
 *
 * The totem SimEvents (`ready-toggled`/`launch-requested`, totem.ts) are
 * wired to their reactions HERE rather than in matchHost.ts, since the
 * reaction (flip a `LobbyPlayer.ready` boolean, or call `startPrivateMatch`)
 * is private-lobby bookkeeping that matchHost.ts has no business knowing
 * about — keeps the generic `onSimEvent` hook decoupled from any one owner.
 */
function ensureHangoutHost(lobby: PrivateLobby): MatchHost {
  const existing = hangoutHosts.get(lobby.code);
  if (existing) return existing;
  const host = new MatchHost(hangoutMatchId(lobby.code), [], [], lobby.mapId, {
    mode: "hangout",
    onSimEvent: (event) => {
      if (event.t === "ready-toggled") {
        try {
          toggleReadyPrivate(lobby.code, event.playerId);
        } catch {
          // Room may have moved on (match started / room gone) between the
          // totem overlap and this callback — nothing to do.
        }
      } else if (event.t === "launch-requested") {
        void tryLaunchFromHangout(lobby.code, event.playerId);
      }
    },
  });
  host.ensureTickLoop();
  hangoutHosts.set(lobby.code, host);
  return host;
}

/** Tear down a room's hangout world — the real match started, or the room
 *  emptied/expired. Idempotent. */
function disposeHangoutHost(code: string): void {
  const host = hangoutHosts.get(code);
  if (!host) return;
  host.dispose();
  hangoutHosts.delete(code);
}

function mintCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return code;
}

function sweep(): void {
  const now = Date.now();
  for (const [code, lobby] of lobbies) {
    if (now - lobby.createdAt > LOBBY_TTL_MS) {
      lobbies.delete(code);
      disposeHangoutHost(code);
      continue;
    }
    for (const [pid, p] of lobby.players) {
      if (now - p.lastSeenAt > HEARTBEAT_STALE_MS && pid !== lobby.hostPlayerId) {
        lobby.players.delete(pid);
      }
    }
  }
}

function snapshot(lobby: PrivateLobby): LobbySnapshot {
  return {
    code: lobby.code,
    hostPlayerId: lobby.hostPlayerId,
    status: lobby.status,
    mapId: lobby.mapId,
    chaosModifierIds: [...lobby.chaosModifierIds],
    matchId: lobby.matchId,
    players: [...lobby.players.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...(lobby.tokens ? { tokens: { ...lobby.tokens } } : {}),
  };
}

function requireLobby(code: string): PrivateLobby {
  sweep();
  const lobby = lobbies.get(code.toUpperCase());
  if (!lobby) throw new Error("Room not found.");
  return lobby;
}

export function createPrivateLobby(args: {
  playerId: string;
  name: string;
  color: string;
  characterId: string;
  mapId?: string;
  chaosModifierIds?: string[];
  cosmetics?: VesselCosmetics;
}): LobbySnapshot {
  sweep();
  let code = mintCode();
  while (lobbies.has(code)) code = mintCode();
  const now = Date.now();
  const lobby: PrivateLobby = {
    code,
    hostPlayerId: args.playerId,
    status: "lobby",
    mapId: args.mapId ?? "vessel-nexus",
    chaosModifierIds: args.chaosModifierIds ?? [],
    players: new Map(),
    matchId: null,
    tokens: null,
    createdAt: now,
  };
  lobby.players.set(args.playerId, {
    playerId: args.playerId,
    name: args.name.slice(0, 24) || "Host",
    color: args.color || "#50e3c2",
    characterId: args.characterId || "balanced",
    cosmetics: args.cosmetics,
    ready: true, // host is ready by default
    lastSeenAt: now,
  });
  lobbies.set(code, lobby);
  ensureHangoutHost(lobby);
  return snapshot(lobby);
}

export function joinPrivateLobby(args: {
  code: string;
  playerId: string;
  name: string;
  color: string;
  characterId: string;
  cosmetics?: VesselCosmetics;
}): LobbySnapshot {
  const lobby = requireLobby(args.code);
  if (lobby.status !== "lobby") throw new Error("Match already started.");
  const now = Date.now();
  const existing = lobby.players.get(args.playerId);
  if (existing) {
    existing.name = args.name.slice(0, 24) || existing.name;
    existing.color = args.color || existing.color;
    existing.characterId = args.characterId || existing.characterId;
    existing.cosmetics = args.cosmetics ?? existing.cosmetics;
    existing.lastSeenAt = now;
  } else {
    if (lobby.players.size >= 16) throw new Error("Room is full (16).");
    lobby.players.set(args.playerId, {
      playerId: args.playerId,
      name: args.name.slice(0, 24) || "Player",
      color: args.color || "#50e3c2",
      characterId: args.characterId || "balanced",
      cosmetics: args.cosmetics,
      ready: false,
      lastSeenAt: now,
    });
  }
  return snapshot(lobby);
}

export function getPrivateLobby(code: string): LobbySnapshot | null {
  try {
    const lobby = requireLobby(code);
    return snapshot(lobby);
  } catch {
    return null;
  }
}

/** Ops / diagnostics — all live private lobbies (no tokens). */
export function listPrivateLobbies(): Array<
  Omit<LobbySnapshot, "tokens"> & { playerCount: number; createdAt: number }
> {
  sweep();
  return [...lobbies.values()]
    .map((lobby) => {
      const snap = snapshot(lobby);
      const { tokens: _t, ...rest } = snap;
      return {
        ...rest,
        playerCount: lobby.players.size,
        createdAt: lobby.createdAt,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function heartbeatPrivateLobby(code: string, playerId: string): LobbySnapshot {
  const lobby = requireLobby(code);
  const p = lobby.players.get(playerId);
  if (!p) throw new Error("Not in room.");
  p.lastSeenAt = Date.now();
  return snapshot(lobby);
}

export function setReadyPrivate(code: string, playerId: string, ready: boolean): LobbySnapshot {
  const lobby = requireLobby(code);
  if (lobby.status !== "lobby") throw new Error("Match already started.");
  const p = lobby.players.get(playerId);
  if (!p) throw new Error("Not in room.");
  p.ready = ready;
  p.lastSeenAt = Date.now();
  return snapshot(lobby);
}

/**
 * A3: the Ready totem's reaction. Flips the CURRENT state rather than
 * setting an explicit value — mirrors a physical toggle switch, since a
 * totem overlap carries no "on/off" intent the way a DOM checkbox click
 * does. Reuses the exact same gating `setReadyPrivate` has (lobby status,
 * membership) so the two entry points behave identically.
 */
export function toggleReadyPrivate(code: string, playerId: string): LobbySnapshot {
  const lobby = requireLobby(code);
  if (lobby.status !== "lobby") throw new Error("Match already started.");
  const p = lobby.players.get(playerId);
  if (!p) throw new Error("Not in room.");
  p.ready = !p.ready;
  p.lastSeenAt = Date.now();
  return snapshot(lobby);
}

export function setMapPrivate(code: string, playerId: string, mapId: string): LobbySnapshot {
  const lobby = requireLobby(code);
  if (lobby.hostPlayerId !== playerId) throw new Error("Only the host can pick the map.");
  if (lobby.status !== "lobby") throw new Error("Match already started.");
  lobby.mapId = mapId.slice(0, 64);
  return snapshot(lobby);
}

export function setChaosPrivate(
  code: string,
  playerId: string,
  chaosModifierIds: string[],
): LobbySnapshot {
  const lobby = requireLobby(code);
  if (lobby.hostPlayerId !== playerId) throw new Error("Only the host can set chaos.");
  if (lobby.status !== "lobby") throw new Error("Match already started.");
  lobby.chaosModifierIds = chaosModifierIds.slice(0, 12);
  return snapshot(lobby);
}

export function leavePrivateLobby(code: string, playerId: string): LobbySnapshot | null {
  const lobby = lobbies.get(code.toUpperCase());
  if (!lobby) return null;
  lobby.players.delete(playerId);
  if (lobby.players.size === 0) {
    lobbies.delete(lobby.code);
    disposeHangoutHost(lobby.code);
    return null;
  }
  if (lobby.hostPlayerId === playerId) {
    // Promote oldest remaining player.
    const next = [...lobby.players.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
    if (next) {
      lobby.hostPlayerId = next.playerId;
      next.ready = true;
    }
  }
  return snapshot(lobby);
}

export async function startPrivateMatch(
  code: string,
  playerId: string,
  secret: string,
): Promise<{
  snapshot: LobbySnapshot;
  matchId: string;
  tokens: Record<string, string>;
}> {
  const lobby = requireLobby(code);
  if (lobby.hostPlayerId !== playerId) throw new Error("Only the host can start.");
  if (lobby.status !== "lobby") throw new Error("Already started.");
  if (lobby.players.size < 1) throw new Error("No players.");

  const matchId = `priv_${lobby.code}_${Date.now().toString(36)}`;
  const players = [...lobby.players.values()];
  const prep: MatchPrep = {
    matchId,
    mapId: lobby.mapId,
    chaosModifierIds: [...lobby.chaosModifierIds],
    players: players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      color: p.color,
      characterId: p.characterId,
      cosmetics: p.cosmetics,
    })),
  };
  matchPrep.set(matchId, prep);

  const tokens: Record<string, string> = {};
  for (const p of players) {
    tokens[p.playerId] = await mintMatchToken(matchId, p.playerId, secret);
  }

  lobby.status = "in_match";
  lobby.matchId = matchId;
  lobby.tokens = tokens;
  // The hangout pre-stage's job is done — the real combat MatchHost takes
  // over via matchRegistry.ts on first WS attach. Tear down the hangout
  // world's tick loop rather than leave it ticking uselessly in the
  // background for the rest of the process lifetime.
  disposeHangoutHost(lobby.code);
  return { snapshot: snapshot(lobby), matchId, tokens };
}

/**
 * A3: the Launch totem's reaction. Gates on the SAME conditions the DOM
 * Start button always has (`LobbyController.syncButtons`: host-only,
 * requires every roster player ready) — a totem overlap has no error UI to
 * surface, so an unmet gate is a silent no-op rather than a thrown error.
 * On success, hands off into the existing, unmodified `startPrivateMatch` →
 * `matchRegistry.ts` → real combat `MatchHost` pipeline.
 */
export async function tryLaunchFromHangout(code: string, playerId: string): Promise<void> {
  const lobby = lobbies.get(code.toUpperCase());
  if (!lobby) return;
  if (lobby.status !== "lobby") return;
  if (lobby.hostPlayerId !== playerId) return;
  const players = [...lobby.players.values()];
  if (players.length < 1 || !players.every((p) => p.ready)) return;
  try {
    await startPrivateMatch(lobby.code, playerId, config.gameServerSecret);
  } catch (err) {
    console.warn(`[privateLobby] hangout launch failed for room ${lobby.code}:`, err);
  }
}

export function getMatchPrep(matchId: string): MatchPrep | null {
  return matchPrep.get(matchId) ?? null;
}

export function clearMatchPrep(matchId: string): void {
  matchPrep.delete(matchId);
}

// ── Hangout world WS wiring (A2/A4) ─────────────────────────────────────
// Mirrors MatchRegistry's attach/route/detach shape so index.ts's websocket
// handlers can branch on `isHangoutMatchId` and call these instead — same
// `/ws?matchId=...&token=...` upgrade path real matches use (mintMatchToken
// happily signs any matchId string, hangout's included).

/**
 * Mint a join token for a room's hangout world. Requires the caller to
 * already be a lobby member (checked against the SAME roster the DOM lobby
 * flow uses) — this is a lobby-scoped credential, not an open one like the
 * io world's token.
 */
export async function mintHangoutToken(
  code: string,
  playerId: string,
  secret: string,
): Promise<{ matchId: string; token: string }> {
  const lobby = requireLobby(code);
  if (!lobby.players.has(playerId)) throw new Error("Not in room.");
  ensureHangoutHost(lobby);
  const matchId = hangoutMatchId(lobby.code);
  const token = await mintMatchToken(matchId, playerId, secret);
  return { matchId, token };
}

/**
 * Attach a WS client to its room's hangout MatchHost. Adds the player to
 * the sim (spawn info sourced from their LobbyPlayer entry — same
 * name/color/character/cosmetics the DOM lobby already shows) if they're
 * not already in it. Returns false if the room/host no longer exists (room
 * expired, or the real match already started and tore the hangout world
 * down) — callers should close the socket in that case.
 */
export function attachHangoutClient(ws: ServerWebSocket<MatchSocketData>): boolean {
  const code = codeFromHangoutMatchId(ws.data.matchId);
  const lobby = lobbies.get(code);
  const host = hangoutHosts.get(code);
  if (!lobby || !host) return false;
  const playerId = PlayerId(ws.data.playerId);
  if (!host.hasPlayer(playerId)) {
    const p = lobby.players.get(ws.data.playerId);
    if (!p) return false; // not a lobby member — reject
    const spawn: PlayerSpawnInfo = {
      playerId,
      characterId: (p.characterId as PlayerSpawnInfo["characterId"]) ?? "balanced",
      name: p.name,
      color: p.color,
      weaponId: "starter-pistol",
      cosmetics: p.cosmetics,
    };
    host.addPlayer(spawn);
  }
  host.attachClient(ws);
  return true;
}

export function routeHangoutMessage(
  ws: ServerWebSocket<MatchSocketData>,
  raw: Buffer | ArrayBuffer | Uint8Array,
): boolean {
  const host = hangoutHosts.get(codeFromHangoutMatchId(ws.data.matchId));
  if (!host) return false;
  host.routeMessage(ws, raw);
  return true;
}

export function detachHangoutClient(ws: ServerWebSocket<MatchSocketData>): void {
  const host = hangoutHosts.get(codeFromHangoutMatchId(ws.data.matchId));
  host?.detachClient(ws);
}
