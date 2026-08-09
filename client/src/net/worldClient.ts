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
  /** Human players only — bots reported separately (badge honesty). */
  humans: number;
  bots: number;
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

export async function fetchWorldAssignment(
  playerId: string,
  displayName?: string,
  characterId?: string,
): Promise<WorldAssignment> {
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
  if (displayName) wsUrl.searchParams.set("name", displayName.slice(0, 14));
  // Chassis pick (classes-goal.md P1) — rides the ws URL like the name
  // (cosmetic-side channel, not the signed token); the server whitelists it
  // at the upgrade (net/playerCharacter.ts) so a bad value falls back to
  // the default chassis instead of blocking entry.
  if (characterId) wsUrl.searchParams.set("character", characterId);
  return { wsUrl: wsUrl.toString(), token: json.token };
}

/**
 * Venue lobby assignment (venue-sprint2-goal S2.A): same shape as
 * fetchWorldAssignment but against /venue-token → /ws/lobby. One stateless
 * credential grants both halves of the venue; this returns the LOBBY
 * socket URL (the arena side keeps using fetchWorldAssignment unchanged).
 */
export async function fetchVenueLobbyAssignment(
  playerId: string,
  displayName?: string,
  characterId?: string,
  /** Doors 1.6 — arrived through the `?fight` fast lane, so ask the venue
   *  to queue us on arrival instead of making us walk to the bell totem
   *  first. Advisory only: the server runs it through the same toggleQueue
   *  a totem touch does, callsign gate included. */
  fastQueue?: boolean,
): Promise<WorldAssignment> {
  const wsBase = readGameServerWsBase();
  const httpBase = wsToHttp(wsBase);
  const res = await fetch(`${httpBase}/venue-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) {
    throw new Error(`venue-token failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as { token: string; lobbyWsPath: string };
  const wsUrl = new URL(json.lobbyWsPath, wsBase);
  wsUrl.searchParams.set("token", json.token);
  if (displayName) wsUrl.searchParams.set("name", displayName.slice(0, 14));
  // Same chassis side-channel as fetchWorldAssignment above.
  if (characterId) wsUrl.searchParams.set("character", characterId);
  if (fastQueue) wsUrl.searchParams.set("fight", "1");
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

/** Venue-wide presence (lobby + arena) — the splash's live ONLINE /
 *  IN MATCH stat items (Jake, 2026-07-17). Same error contract as
 *  fetchWorldSummary: null = not live / unreachable. */
export type VenueSummary = {
  lobby: { present: number };
  arena: { humans: number };
};

/** Arena liveness for the splash strip (Doors 3.4). `bots` is deliberately
 *  a SEPARATE number from `humans` and must stay that way: the item exists
 *  because the front door showed seven zeros, and the fix must not swing to
 *  the other lie by folding AI into a player count. */
export type WorldLiveness = { humans: number; bots: number };

/** True when a hostname is in a private/local address space per Chromium's
 *  Local Network Access rules (RFC1918, loopback, CGNAT/Tailscale 100.x,
 *  .local/.ts.net). Fetching one of these from a PUBLIC page throws the
 *  scary "access devices on your local network" permission prompt. */
function isPrivateHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    /^(127\.|10\.|192\.168\.|100\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".ts.net")
  );
}

export async function fetchVenueSummary(): Promise<VenueSummary | null> {
  const httpBase = wsToHttp(readGameServerWsBase());
  // Ambient polling must never be the thing that triggers the browser's
  // local-network permission prompt (seen live 2026-07-17): if the page is
  // public but the resolved base is private (stale ?server= override, LAN
  // dev leftovers), skip quietly — presence is a nicety, not worth a
  // permission dialog. Deliberate gameplay connections are unaffected.
  try {
    const pageHost = browserLocation()?.hostname ?? "";
    const baseHost = new URL(httpBase).hostname;
    if (!isPrivateHost(pageHost) && isPrivateHost(baseHost)) return null;
  } catch {
    return null;
  }
  try {
    const res = await fetch(`${httpBase}/venue/summary`, { method: "GET" });
    if (!res.ok) return null;
    return ((await res.json()) as VenueSummary | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Arena liveness for the splash strip (Doors 3.4) — humans AND bots.
 *
 * Reads `/health` rather than `/venue/summary` because the summary carries
 * no bot count and adding one is a server change; `/health` has published
 * `world.humans` / `world.bots` all along. Same private-host guard and the
 * same null-on-anything-wrong contract as fetchVenueSummary: a splash
 * decoration must never trigger the browser's local-network permission
 * prompt, and must never throw into the boot path.
 */
export async function fetchWorldLiveness(): Promise<WorldLiveness | null> {
  const httpBase = wsToHttp(readGameServerWsBase());
  try {
    const pageHost = browserLocation()?.hostname ?? "";
    const baseHost = new URL(httpBase).hostname;
    if (!isPrivateHost(pageHost) && isPrivateHost(baseHost)) return null;
  } catch {
    return null;
  }
  try {
    const res = await fetch(`${httpBase}/health`, { method: "GET" });
    if (!res.ok) return null;
    const body = (await res.json()) as { world?: { humans?: number; bots?: number } } | null;
    const world = body?.world;
    if (!world) return null;
    return { humans: world.humans ?? 0, bots: world.bots ?? 0 };
  } catch {
    return null;
  }
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

/**
 * Signal that this player clicked "Rematch" on the match-results overlay.
 * Once every currently-connected player has signaled, the server recycles
 * the world immediately instead of waiting out the full results-hold
 * timer (worldHost.markRematchReady) — this is what makes the Rematch
 * button do something instead of just hiding the overlay. Best-effort:
 * swallow failures, since the anti-stall timer is still the fallback.
 */
export async function postRematchReady(playerId: string): Promise<void> {
  const httpBase = wsToHttp(readGameServerWsBase());
  try {
    await fetch(`${httpBase}/world/rematch-ready`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
  } catch {
    // Best-effort — the resultsHoldMs ceiling still recycles eventually.
  }
}

/**
 * Runtime game-server override via `?server=<ws-url>` query param —
 * mirrors the `?convex=` param in LobbyController. Lets a share link
 * point an already-deployed client at a self-hosted server (e.g. a
 * home PC behind a Cloudflare tunnel) without a rebuild:
 *   https://<client>/?server=wss://xyz.trycloudflare.com/ws
 */
export function readGameServerUrlOverride(): string | null {
  const loc = browserLocation();
  if (!loc) return null;
  return new URLSearchParams(loc.search).get("server");
}

/**
 * `window.location` via globalThis so this module stays importable from
 * the server workspace's typecheck (no DOM lib there). Returns null in
 * non-browser contexts.
 */
type BrowserLocation = {
  protocol: string;
  hostname: string;
  host: string;
  port: string;
  search: string;
};
function browserLocation(): BrowserLocation | null {
  return (globalThis as { location?: BrowserLocation }).location ?? null;
}

function readGameServerWsBase(): string {
  // Precedence: runtime ?server= param, then build-time
  // VITE_GAME_SERVER_URL, then same-origin (self-contained hosting: the
  // Bun server serves the client statics itself — SERVE_CLIENT_DIR /
  // scripts/host-public.sh), then local dev default. The value points at
  // the WS endpoint (ends with /ws). For io we strip the trailing /ws
  // and treat what remains as the base. If it's the full origin
  // already, we use it as-is.
  const raw =
    readGameServerUrlOverride() ??
    (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ??
    sameOriginWsBase() ??
    "ws://localhost:8088/ws";
  // Drop trailing /ws or /ws/world if present so URL composition is clean.
  return raw.replace(/\/ws(\/world)?$/, "");
}

/**
 * When the page is served from a real origin that isn't the Vite dev
 * server, assume the game server IS that origin (self-contained hosting).
 * Vite dev (:5173) and file:// (standalone build) keep the localhost
 * default so local workflows are unchanged.
 */
function sameOriginWsBase(): string | null {
  const loc = browserLocation();
  if (!loc) return null;
  const { protocol, host } = loc;
  if (!protocol.startsWith("http")) return null;
  // Vite dev serves the page but is NEVER the game server — detect it via
  // the injected DEV flag instead of hostname/port guessing (which broke
  // for `vite --host` LAN access and the 5174+ fallback ports).
  if (import.meta.env.DEV) return null;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}`;
}

function wsToHttp(wsBase: string): string {
  if (wsBase.startsWith("wss://")) return "https://" + wsBase.slice(6);
  if (wsBase.startsWith("ws://")) return "http://" + wsBase.slice(5);
  return wsBase;
}
