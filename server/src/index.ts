// JAKESJAM game server — Bun + uWebSockets (via Bun.serve).
// See docs/netcode-architecture.md.
//
// Two parallel WS paths:
//   GET /ws        — legacy room flow. Requires matchId+token from
//                    Convex matchmaker.getMyMatchToken. One MatchHost
//                    per matchId (MatchRegistry).
//   GET /ws/world  — io flow. Requires only a world token (minted by
//                    POST /world-token). Single process-wide MatchHost
//                    (WorldHost). Players drift in/out continuously.
//
// One HTTP endpoint:
//   POST /world-token   body { playerId } → { token, wsUrl }
//                       Cheap mint — no Convex round-trip required.

import { mintWorldToken, verifyMatchToken, verifyWorldToken } from "./auth.ts";
import { config } from "./config.ts";
import { MatchRegistry } from "./matchRegistry.ts";
import { worldHost } from "./worldHost.ts";
import type { MatchSocketData } from "./matchHost.ts";

const registry = new MatchRegistry();

type SocketKind = "room" | "world";
type SocketData = MatchSocketData & { kind: SocketKind };

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

const server = Bun.serve<SocketData>({
  port: config.port,
  hostname: "0.0.0.0",
  async fetch(req, srv) {
    const url = new URL(req.url);
    console.log(`[req] ${req.method} ${url.pathname} (raw=${req.url}) host=${req.headers.get("host")}`);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          region: config.region,
          matches: registry.size(),
          world: worldHost.summary(),
        }),
        { headers: { "content-type": "application/json", ...corsHeaders } },
      );
    }

    // Dedicated lightweight endpoints for the client status badges.
    // Cheaper than /health (no string formatting of the rooms map).
    if (url.pathname === "/world/summary") {
      return new Response(
        JSON.stringify(worldHost.summary()),
        { headers: { "content-type": "application/json", ...corsHeaders } },
      );
    }
    if (url.pathname === "/match/summary") {
      const id = url.searchParams.get("matchId");
      if (!id) return new Response("bad request", { status: 400, headers: corsHeaders });
      return new Response(
        JSON.stringify(registry.summaryFor(id)),
        { headers: { "content-type": "application/json", ...corsHeaders } },
      );
    }

    // ── World token mint ──────────────────────────────────────────────
    if (url.pathname === "/world-token" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response("bad request", { status: 400, headers: corsHeaders });
      }
      const playerId =
        body && typeof body === "object" && "playerId" in body
          ? String((body as { playerId: unknown }).playerId)
          : "";
      if (!playerId || playerId.length > 64) {
        return new Response("bad playerId", { status: 400, headers: corsHeaders });
      }
      const token = await mintWorldToken(playerId, config.gameServerSecret);
      return new Response(
        JSON.stringify({ token, wsPath: "/ws/world" }),
        { headers: { "content-type": "application/json", ...corsHeaders } },
      );
    }

    // ── World WS upgrade ──────────────────────────────────────────────
    if (url.pathname === "/ws/world") {
      const token = url.searchParams.get("token");
      if (!token) return new Response("bad request", { status: 400 });
      const verified = await verifyWorldToken(token, config.gameServerSecret);
      if (!verified) return new Response("auth failed", { status: 401 });
      const data: SocketData = {
        kind: "world",
        matchId: "world",
        playerId: verified.playerId,
        authedAt: Date.now(),
      };
      const upgraded = srv.upgrade(req, { data });
      return upgraded ? undefined : new Response("upgrade failed", { status: 500 });
    }

    // ── Room WS upgrade (legacy) ──────────────────────────────────────
    if (url.pathname === "/ws") {
      const matchId = url.searchParams.get("matchId");
      const token = url.searchParams.get("token");
      if (!matchId || !token) {
        return new Response("bad request", { status: 400 });
      }
      const verified = await verifyMatchToken(token, config.gameServerSecret);
      if (!verified || verified.matchId !== matchId) {
        return new Response("auth failed", { status: 401 });
      }
      const data: SocketData = {
        kind: "room",
        matchId,
        playerId: verified.playerId,
        authedAt: Date.now(),
      };
      const upgraded = srv.upgrade(req, { data });
      return upgraded ? undefined : new Response("upgrade failed", { status: 500 });
    }

    return new Response("not found", { status: 404 });
  },
  websocket: {
    perMessageDeflate: false,
    maxPayloadLength: 16 * 1024,
    open(ws) {
      if (ws.data.kind === "world") {
        worldHost.attach(ws);
      } else {
        registry.attach(ws);
      }
    },
    message(ws, raw) {
      const buf = raw as Buffer | ArrayBuffer | Uint8Array;
      if (ws.data.kind === "world") {
        worldHost.route(ws, buf);
      } else {
        registry.route(ws, buf);
      }
    },
    close(ws) {
      if (ws.data.kind === "world") {
        worldHost.detach(ws);
      } else {
        registry.detach(ws);
      }
    },
  },
});

console.log(
  `[jakesjam-srv] region=${config.region} listening on :${server.port} (rooms=0 world=ready)`,
);
