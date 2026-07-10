// Server-native private room client (no Convex). Talks to bun /private/*.

import { readGameServerUrlOverride } from "../../net/worldClient.js";

export type PrivateLobbyPlayer = {
  playerId: string;
  name: string;
  color: string;
  characterId: string;
  ready: boolean;
  lastSeenAt: number;
};

export type PrivateLobbySnapshot = {
  code: string;
  hostPlayerId: string;
  status: "lobby" | "starting" | "in_match";
  mapId: string;
  chaosModifierIds: string[];
  matchId: string | null;
  players: PrivateLobbyPlayer[];
  /** Present only on start response. */
  tokens?: Record<string, string>;
};

function httpBase(): string {
  const override =
    readGameServerUrlOverride() ??
    (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ??
    null;
  if (override) {
    return override.replace(/^ws/i, "http").replace(/\/$/, "");
  }
  // Same origin when served from bun statics (SERVE_CLIENT_DIR).
  return window.location.origin;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${httpBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `private room ${path} failed (${res.status})`);
  }
  if (json && typeof json === "object" && "error" in json && json.error) {
    throw new Error(String(json.error));
  }
  return json;
}

export class PrivateRoomClient {
  create(args: {
    playerId: string;
    name: string;
    color: string;
    characterId: string;
    mapId?: string;
    chaosModifierIds?: string[];
  }): Promise<PrivateLobbySnapshot> {
    return post("/private/create", args);
  }

  join(args: {
    code: string;
    playerId: string;
    name: string;
    color: string;
    characterId: string;
  }): Promise<PrivateLobbySnapshot> {
    return post("/private/join", args);
  }

  get(code: string): Promise<PrivateLobbySnapshot | null> {
    return fetch(`${httpBase()}/private/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`room fetch failed (${res.status})`);
        return (await res.json()) as PrivateLobbySnapshot;
      });
  }

  ready(code: string, playerId: string, ready: boolean): Promise<PrivateLobbySnapshot> {
    return post("/private/ready", { code, playerId, ready });
  }

  setMap(code: string, playerId: string, mapId: string): Promise<PrivateLobbySnapshot> {
    return post("/private/map", { code, playerId, mapId });
  }

  setChaos(
    code: string,
    playerId: string,
    chaosModifierIds: string[],
  ): Promise<PrivateLobbySnapshot> {
    return post("/private/chaos", { code, playerId, chaosModifierIds });
  }

  heartbeat(code: string, playerId: string): Promise<PrivateLobbySnapshot> {
    return post("/private/heartbeat", { code, playerId });
  }

  leave(code: string, playerId: string): Promise<PrivateLobbySnapshot | null> {
    return post("/private/leave", { code, playerId });
  }

  start(code: string, playerId: string): Promise<PrivateLobbySnapshot> {
    return post("/private/start", { code, playerId });
  }

  buildWsUrl(matchId: string, token: string): string {
    const base =
      readGameServerUrlOverride() ??
      (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ??
      (() => {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}`;
      })();
    const url = new URL("/ws", base.replace(/^http/i, "ws"));
    url.searchParams.set("matchId", matchId);
    url.searchParams.set("token", token);
    return url.toString();
  }
}
