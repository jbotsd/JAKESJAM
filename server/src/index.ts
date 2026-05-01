// JAKESJAM game server — Bun + uWebSockets (via Bun.serve).
// See docs/netcode-architecture.md.

import { verifyMatchToken } from "./auth.ts";
import { config } from "./config.ts";
import { MatchRegistry } from "./matchRegistry.ts";
import type { MatchSocketData } from "./matchHost.ts";

const registry = new MatchRegistry();

const server = Bun.serve<MatchSocketData>({
  port: config.port,
  hostname: "0.0.0.0",
  async fetch(req, srv) {
    const url = new URL(req.url);
    console.log(`[req] ${req.method} ${url.pathname} (raw=${req.url}) host=${req.headers.get("host")}`);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, region: config.region, matches: registry.size() }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname !== "/ws") {
      return new Response("not found", { status: 404 });
    }

    const matchId = url.searchParams.get("matchId");
    const token = url.searchParams.get("token");
    if (!matchId || !token) {
      return new Response("bad request", { status: 400 });
    }

    const verified = await verifyMatchToken(token, config.gameServerSecret);
    if (!verified || verified.matchId !== matchId) {
      return new Response("auth failed", { status: 401 });
    }

    const data: MatchSocketData = {
      matchId,
      playerId: verified.playerId,
      authedAt: Date.now(),
    };
    const upgraded = srv.upgrade(req, { data });
    return upgraded ? undefined : new Response("upgrade failed", { status: 500 });
  },
  websocket: {
    perMessageDeflate: false,
    maxPayloadLength: 16 * 1024,
    open(ws) {
      registry.attach(ws);
    },
    message(ws, raw) {
      registry.route(ws, raw as Buffer | ArrayBuffer | Uint8Array);
    },
    close(ws) {
      registry.detach(ws);
    },
  },
});

console.log(
  `[jakesjam-srv] region=${config.region} listening on :${server.port} (matches=0)`,
);
