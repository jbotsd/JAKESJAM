// World client — io-style direct join, no Convex round-trip.
//
// Posts the chosen playerId to the bun server's /world-token endpoint
// and gets back a signed token + WS path. The client then opens
// `${gameServerHttpUrl}/ws/world?token=...` to enter the singleton world.
//
// VITE_GAME_SERVER_URL controls which server we hit (wss:// in prod,
// ws://localhost:8088 in dev). The HTTP origin is derived by swapping
// ws→http / wss→https.

type WorldSummary = {
  matchId: string;
  mapId: string;
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  roundIndex: number;
  countdownRemainingMs: number;
  players: number;
  targetScore: number;
  joinable: boolean;
  chaosModifierIds: string[];
};

export type WorldAssignment = {
  /** WebSocket URL ready to be passed to WsTransport. */
  wsUrl: string;
  /** Token used in the WS URL. Surfaced for debugging only. */
  token: string;
};

export async function fetchWorldAssignment(playerId: string): Promise<WorldAssignment> {
  const wsBase = readGameServerWsBase();
  const httpBase = wsToHttp(wsBase);
  const res = await fetch(`${httpBase}/world-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) {
    throw new Error(`world-token failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as { token: string; wsPath: string };
  const wsUrl = new URL(json.wsPath, wsBase);
  wsUrl.searchParams.set("token", json.token);
  return { wsUrl: wsUrl.toString(), token: json.token };
}

/**
 * Lightweight summary fetcher used by MatchStatusBadge. Hits the bun
 * server's `/world/summary` endpoint directly — no Convex involvement.
 * Returns `null` if the world hasn't booted yet OR the request fails
 * (the badge treats both as "world idle").
 */
export async function fetchWorldSummary(): Promise<WorldSummary | null> {
  // Let network errors propagate so MatchStatusBadge can distinguish
  // "server unreachable" (fetch throws) from "world idle" (200/404 with no
  // active match). HTTP error responses that aren't network failures are
  // treated as "not live yet" and return null.
  const httpBase = wsToHttp(readGameServerWsBase());
  const res = await fetch(`${httpBase}/world/summary`, { method: "GET" });
  if (!res.ok) return null;
  return (await res.json() as WorldSummary | null) ?? null;
}

/**
 * Per-room summary fetcher. Same endpoint shape as the world variant
 * so MatchStatusBadge can use them interchangeably.
 */
export async function fetchMatchSummary(matchId: string): ReturnType<typeof fetchWorldSummary> {
  const httpBase = wsToHttp(readGameServerWsBase());
  const url = new URL(`${httpBase}/match/summary`);
  url.searchParams.set("matchId", matchId);
  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) return null;
  return (await res.json() as WorldSummary | null) ?? null;
}

function readGameServerWsBase(): string {
  // VITE_GAME_SERVER_URL points at the WS endpoint (ends with /ws). For
  // io we strip the trailing /ws and treat what remains as the base.
  // If it's the full origin already, we use it as-is.
  const raw = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ?? "ws://localhost:8088/ws";
  // Drop trailing /ws or /ws/world if present so URL composition is clean.
  return raw.replace(/\/ws(\/world)?$/, "");
}

function wsToHttp(wsBase: string): string {
  if (wsBase.startsWith("wss://")) return "https://" + wsBase.slice(6);
  if (wsBase.startsWith("ws://")) return "http://" + wsBase.slice(5);
  return wsBase;
}
