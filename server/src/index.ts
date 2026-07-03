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

import { resolve, normalize } from "node:path";
import { mintWorldToken, verifyMatchToken, verifyWorldToken } from "./auth.ts";
import { config } from "./config.ts";
import { MatchRegistry } from "./matchRegistry.ts";
import { WorldHost } from "./worldHost.ts";
import type { MatchSocketData } from "./matchHost.ts";
import {
  applyServerWasmCollision,
  applyServerWasmPlayer,
  loadServerSim,
} from "./wasmRuntime.ts";

// Phase B4/D2 Zig→WASM substrate (ADR-0006). Awaited at top-level
// so the trig LUT is installed + swaps are in place before any
// matchHost begins a tick.
//
// `loadServerSim` is called UNCONDITIONALLY (not gated by env)
// because it also installs the comptime trig LUT used by every
// satellite/weapon/combat/projectile sim path. Without that the
// server's TS sim falls back to libm Math.sin/cos/atan2 which
// produces ULP-different bits than the LUT the client uses →
// predict-vs-authority drift on every trig-driven event.
//
// The collision + player wasm-backend swaps remain env-gated:
//   JAKESJAM_WASM_COLLISION=0 to disable (default ON)
//   JAKESJAM_WASM_PLAYER=0    to disable (default ON)
await loadServerSim();
if (config.wasmCollision) {
  await applyServerWasmCollision();
}
if (config.wasmPlayer) {
  await applyServerWasmPlayer();
}

const registry = new MatchRegistry();
// Single always-on world host per server process. Constructed at boot
// rather than as a module-level singleton so tests can spin up a fresh
// instance without crossing module-load state.
const worldHost = new WorldHost({
  // WORLD_MAP pins the world to one map (curated id or "gen:<seed>") —
  // useful for playtesting a specific arena. Default: mini + rotation.
  mapId: process.env.WORLD_MAP ?? "boxworks-mini",
  rotateMaps: process.env.WORLD_MAP === undefined,
  // AI duelists keeping the world alive — 0 disables (default, so tests
  // and probes stay deterministic). host-public.sh hosts with 2.
  bots: Number(process.env.WORLD_BOTS ?? 0),
});

type SocketKind = "room" | "world";
type SocketData = MatchSocketData & { kind: SocketKind };

// ── Self-contained hosting: optional static client serving ─────────────────
// When SERVE_CLIENT_DIR points at a Vite build output (client/dist), any GET
// that doesn't match an API/WS route serves files from it, with index.html
// fallback. This lets a single tunnel/port host BOTH the client and the game
// server (see scripts/host-public.sh) — no Vercel/Convex/Fly involvement.
const serveClientDir = process.env.SERVE_CLIENT_DIR
  ? resolve(process.env.SERVE_CLIENT_DIR)
  : null;
if (serveClientDir) {
  console.log(`[jakesjam-srv] serving client statics from ${serveClientDir}`);
}

async function serveStatic(
  pathname: string,
  requestOrigin: string,
): Promise<Response | null> {
  if (!serveClientDir) return null;
  // Root and client-side routes fall back to index.html (SPA).
  const rel = pathname === "/" ? "/index.html" : pathname;
  const full = normalize(resolve(serveClientDir + rel));
  // Path traversal guard: the resolved path must stay inside the dist dir.
  if (!full.startsWith(serveClientDir + "/") && full !== serveClientDir) {
    return null;
  }
  // Dotfile deny: the funnel URL is public internet — scanners probe
  // /.git/config, /.env, etc. Nothing under dist legitimately starts
  // with a dot, so refuse outright instead of relying on file-miss 404s.
  if (rel.includes("/.")) return null;
  let file = Bun.file(full);
  if (!(await file.exists())) {
    // Unknown non-asset path → SPA fallback to index.html.
    if (/\.[a-z0-9]+$/i.test(rel)) return null; // real missing asset: 404
    file = Bun.file(resolve(serveClientDir, "index.html"));
    if (!(await file.exists())) return null;
  }
  // index.html gets the share-card origin rewrite: OG/Twitter scrapers
  // require ABSOLUTE image/url metas, and this server answers on many
  // hosts (funnel domain, LAN IP, localhost, future VPS domain). The
  // __ORIGIN__ placeholder in client/index.html becomes the origin the
  // REQUEST actually arrived on, so shared links always carry a card
  // the scraper can fetch.
  const isIndex = full.endsWith("/index.html") || file.name?.endsWith("index.html");
  if (isIndex) {
    const html = (await file.text()).replaceAll("__ORIGIN__", requestOrigin);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }
  // Bun.file infers content-type from the extension (including wasm).
  const immutable = rel.startsWith("/assets/") || rel.startsWith("/wasm/");
  return new Response(file, {
    headers: immutable
      ? { "cache-control": "public, max-age=31536000, immutable" }
      : { "cache-control": "no-cache" },
  });
}

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function serveOnPort(port: number) {
  return Bun.serve<SocketData>({
  port,
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

    if (req.method === "GET") {
      // Origin as the client sees it. Proxies terminating TLS (Tailscale
      // Funnel, lhr tunnel) forward plain http but set x-forwarded-proto;
      // trust it, falling back to the URL scheme for direct connections.
      const host = req.headers.get("host") ?? url.host;
      const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
      const staticRes = await serveStatic(url.pathname, `${proto}://${host}`);
      if (staticRes) return staticRes;
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
}

function listen() {
  const start = config.port;
  const end = start + Math.max(1, config.portSearchRange);
  let lastErr: unknown;
  for (let p = start; p < end; p++) {
    try {
      return serveOnPort(p);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "EADDRINUSE") throw err;
      lastErr = err;
      console.warn(`[jakesjam-srv] port ${p} in use, trying ${p + 1}…`);
    }
  }
  throw new Error(
    `No free port in [${start}, ${end}). Set PORT or PORT_SEARCH_RANGE. Last: ${String(lastErr)}`,
  );
}

const server = listen();

console.log(
  `[jakesjam-srv] region=${config.region} listening on :${server.port} (rooms=0 world=ready)`,
);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
//
// Per skills/bun-ws-server SKILL.md "Graceful shutdown" + Fly's ~25s grace:
//   1. stop accepting new upgrades
//   2. send `bye{ reason: "server-shutdown" }` to in-flight matches and close
//      with code 1000 (normal closure)
//   3. exit
//
// We deliberately don't persist final state to Convex here — `recordMatchResult`
// is fire-and-forget on each tick's matchComplete event, so by the time SIGTERM
// arrives the writes that matter have already been kicked off. The grace window
// is for live socket bye-frames, not DB flushing.
let shuttingDown = false;
function gracefulShutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[jakesjam-srv] ${reason} — beginning graceful shutdown`);
  try {
    // Stop the HTTP listener so no further upgrades land.
    server.stop();
  } catch (err) {
    console.error("[jakesjam-srv] server.stop failed:", err);
  }
  // No await — Bun gives sockets ~5s to drain naturally after process exit
  // intent. The matchHost/world will close clients on tick teardown.
  // Set a hard cap so we don't hang the SIGTERM responder if a socket sticks.
  setTimeout(() => {
    console.log("[jakesjam-srv] shutdown grace expired — exiting");
    process.exit(0);
  }, 5_000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
