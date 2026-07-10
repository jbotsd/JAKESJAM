// Server-native private room lobby — no Convex required.
//
// Lobbies live in process memory keyed by 6-char code. Host creates, others
// join, host starts → matchId + per-player tokens. MatchRegistry reads
// MatchPrep for map/chaos when the first WS client attaches.

import { mintMatchToken } from "./auth.ts";

export type LobbyPlayer = {
  playerId: string;
  name: string;
  color: string;
  characterId: string;
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
    ready: true, // host is ready by default
    lastSeenAt: now,
  });
  lobbies.set(code, lobby);
  return snapshot(lobby);
}

export function joinPrivateLobby(args: {
  code: string;
  playerId: string;
  name: string;
  color: string;
  characterId: string;
}): LobbySnapshot {
  const lobby = requireLobby(args.code);
  if (lobby.status !== "lobby") throw new Error("Match already started.");
  const now = Date.now();
  const existing = lobby.players.get(args.playerId);
  if (existing) {
    existing.name = args.name.slice(0, 24) || existing.name;
    existing.color = args.color || existing.color;
    existing.characterId = args.characterId || existing.characterId;
    existing.lastSeenAt = now;
  } else {
    if (lobby.players.size >= 16) throw new Error("Room is full (16).");
    lobby.players.set(args.playerId, {
      playerId: args.playerId,
      name: args.name.slice(0, 24) || "Player",
      color: args.color || "#50e3c2",
      characterId: args.characterId || "balanced",
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
  return { snapshot: snapshot(lobby), matchId, tokens };
}

export function getMatchPrep(matchId: string): MatchPrep | null {
  return matchPrep.get(matchId) ?? null;
}

export function clearMatchPrep(matchId: string): void {
  matchPrep.delete(matchId);
}
