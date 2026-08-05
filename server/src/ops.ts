// Operator console — deep backend interface for the server owner.
//
// SERVED ON ITS OWN LISTENER (config.opsPort, default :8089), never on the
// public game port — the Cloudflare tunnel and the router forward only
// :8088, so /ops is unreachable from the internet by construction. The
// listener additionally refuses any non-private source address, so even a
// future port-forward mistake cannot expose it. LAN URL:
//   http://<host-lan-ip>:8089/ops
//
// UI: Elm SPA at ops/console/ (build with ops/console/build.sh).
// Auth: ADMIN_SECRET only (fails closed when unset). Accepts:
//   • header  x-admin-secret: <secret>
//   • header  Authorization: Bearer <secret>
//   • cookie  jakesjam_ops=<secret>  (set by POST /ops/login)
//   • query   ?key=<secret> on first GET /ops (then Set-Cookie redirect)
//
// Routes (all under /ops):
//   GET  /ops                  Elm shell (index.html)
//   GET  /ops/static/*         elm.js, styles.css
//   POST /ops/login            set auth cookie → { ok: true }
//   POST /ops/logout           clear cookie → { ok: true }
//   GET  /ops/api/status       health + world + rooms + clips stats + env
//   GET  /ops/api/clips        full clip inventory
//   GET  /ops/api/clips/file/<name>   one clip, attachment disposition
//   GET  /ops/api/clips/archive       whole inventory as a tar stream
//   POST /ops/api/clips/pin    { filename, note? }
//   POST /ops/api/clips/unpin  { filename }
//   GET  /ops/api/rooms        private lobbies + match registry
//   GET  /ops/api/world        world summary
//
// Not the TikTok player UI — operator-only, secret-gated.

import { resolve, normalize, dirname } from "node:path";
import { telemetrySummary } from "./telemetryStore.ts";
import { fileURLToPath } from "node:url";
import { constantTimeEquals } from "./auth.ts";
import { config } from "./config.ts";
import {
  archiveClipsResponse,
  listClips,
  listPinRecords,
  pinClip,
  serveClip,
  unpinClip,
} from "./clipStore.ts";
import { listPrivateLobbies } from "./privateLobby.ts";
import type { MatchRegistry } from "./matchRegistry.ts";
import type { WorldHost } from "./worldHost.ts";

const COOKIE_NAME = "jakesjam_ops";
const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-admin-secret,authorization",
};

/** Compiled Elm console — sibling of server/ under repo ops/console. */
const OPS_CONSOLE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../ops/console",
);

export type OpsDeps = {
  registry: MatchRegistry;
  worldHost: WorldHost;
  startedAtMs: number;
  port: number;
};

function adminConfigured(): boolean {
  return Boolean(config.adminSecret && config.adminSecret.length > 0);
}

function extractSecret(req: Request, url: URL): string {
  const header = req.headers.get("x-admin-secret") ?? "";
  if (header) return header;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  const q = url.searchParams.get("key") ?? url.searchParams.get("secret") ?? "";
  return q;
}

/** null = authorized; Response = deny. */
export function requireOpsAuth(req: Request, url: URL): Response | null {
  if (!adminConfigured()) {
    return json(
      {
        error: "ADMIN_SECRET not configured — ops surface is closed",
        hint: "export ADMIN_SECRET=$(head -c 32 /dev/urandom | base64) and restart",
      },
      503,
    );
  }
  const provided = extractSecret(req, url);
  if (!provided || !constantTimeEquals(provided, config.adminSecret!)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function cookieHeader(secret: string, maxAgeSec: number): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(secret)}`,
    "Path=/ops",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ].join("; ");
}

function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/ops; HttpOnly; SameSite=Strict; Max-Age=0`;
}

async function serveOpsStatic(pathname: string): Promise<Response | null> {
  // /ops/static/elm.js → ops/console/elm.js
  const rel = pathname.slice("/ops/static/".length);
  if (!rel || rel.includes("..") || rel.includes("/")) {
    // allow single-segment only
    if (rel.includes("..") || rel.includes("/")) return null;
  }
  const allowed = new Set(["elm.js", "styles.css", "index.html"]);
  if (!allowed.has(rel)) return null;
  const full = normalize(resolve(OPS_CONSOLE_DIR, rel));
  if (!full.startsWith(OPS_CONSOLE_DIR + "/") && full !== OPS_CONSOLE_DIR) {
    return null;
  }
  const file = Bun.file(full);
  if (!(await file.exists())) return null;
  const type =
    rel.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : rel.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8";
  return new Response(file, {
    headers: {
      "content-type": type,
      "cache-control": rel === "elm.js" || rel === "styles.css"
        ? "no-cache"
        : "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

async function serveOpsShell(): Promise<Response> {
  const file = Bun.file(resolve(OPS_CONSOLE_DIR, "index.html"));
  if (!(await file.exists())) {
    return new Response(
      "Ops console not built — run ops/console/build.sh",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response(file, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/**
 * Handle any /ops* request. Returns null if pathname is not under /ops
 * (caller continues normal routing).
 */
export async function handleOps(
  req: Request,
  url: URL,
  deps: OpsDeps,
): Promise<Response | null> {
  if (url.pathname !== "/ops" && !url.pathname.startsWith("/ops/")) {
    return null;
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Static Elm assets (no auth — JS is useless without cookie/API).
  if (url.pathname.startsWith("/ops/static/") && req.method === "GET") {
    const res = await serveOpsStatic(url.pathname);
    return res ?? json({ error: "not found" }, 404);
  }

  // Login — JSON for Elm; form POST still works for non-JS clients.
  if (url.pathname === "/ops/login" && req.method === "POST") {
    if (!adminConfigured()) {
      return json({ error: "ADMIN_SECRET not set on this process." }, 503);
    }
    let secret = "";
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        const body = (await req.json()) as { secret?: string };
        secret = String(body.secret ?? "");
      } catch {
        secret = "";
      }
    } else {
      try {
        const form = await req.formData();
        secret = String(form.get("secret") ?? "");
      } catch {
        secret = "";
      }
    }
    if (!secret || !constantTimeEquals(secret, config.adminSecret!)) {
      return json({ error: "unauthorized" }, 401);
    }
    return json(
      { ok: true },
      200,
      { "set-cookie": cookieHeader(secret, 60 * 60 * 24 * 14) },
    );
  }

  if (url.pathname === "/ops/logout" && (req.method === "POST" || req.method === "GET")) {
    if (req.method === "GET") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/ops",
          "set-cookie": clearCookieHeader(),
          ...corsHeaders,
        },
      });
    }
    return json({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
  }

  // Bootstrap: /ops?key=SECRET → set cookie and strip query from URL.
  if (url.pathname === "/ops" && req.method === "GET" && url.searchParams.has("key")) {
    const key = url.searchParams.get("key") ?? "";
    if (adminConfigured() && key && constantTimeEquals(key, config.adminSecret!)) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/ops",
          "set-cookie": cookieHeader(key, 60 * 60 * 24 * 14),
        },
      });
    }
  }

  // Elm shell — always served; app probes API for auth state.
  if (url.pathname === "/ops" && req.method === "GET") {
    return serveOpsShell();
  }

  // All API routes require auth.
  const denied = requireOpsAuth(req, url);
  if (denied) return denied;

  if (url.pathname === "/ops/api/status" && req.method === "GET") {
    return json(await buildStatus(deps));
  }

  if (url.pathname === "/ops/api/clips" && req.method === "GET") {
    const { clips, stats } = await listClips();
    const pins = await listPinRecords();
    return json({ clips, stats, pins });
  }

  // Per-clip download (2026-08-02, LAN console). serveClip owns the strict
  // filename validation (UUID + webm/mp4 only, traversal-proof) and the
  // kept/-fallback; the only change here is attachment disposition so the
  // browser saves instead of playing.
  if (url.pathname.startsWith("/ops/api/clips/file/") && req.method === "GET") {
    const filename = decodeURIComponent(url.pathname.slice("/ops/api/clips/file/".length));
    const res = await serveClip(filename, { preferDisk: true });
    if (!res) return json({ error: "not found" }, 404);
    const headers = new Headers(res.headers);
    headers.set("content-disposition", `attachment; filename="${filename}"`);
    return new Response(res.body, { status: res.status, headers });
  }

  // Whole-inventory tar stream — the console's "Download all" button.
  if (url.pathname === "/ops/api/clips/archive" && req.method === "GET") {
    return archiveClipsResponse();
  }

  if (url.pathname === "/ops/api/clips/pin" && req.method === "POST") {
    let body: { filename?: string; note?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const result = await pinClip(String(body.filename ?? ""), body.note);
    if (!result.ok) return json({ error: result.message }, 400);
    return json({ ok: true, pin: result.pin });
  }

  if (url.pathname === "/ops/api/clips/unpin" && req.method === "POST") {
    let body: { filename?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const result = await unpinClip(String(body.filename ?? ""));
    if (!result.ok) return json({ error: result.message }, 400);
    return json({ ok: true });
  }

  if (url.pathname === "/ops/api/rooms" && req.method === "GET") {
    return json({
      privateLobbies: listPrivateLobbies(),
      matches: deps.registry.summaries(),
      matchCount: deps.registry.size(),
    });
  }

  if (url.pathname === "/ops/api/world" && req.method === "GET") {
    return json({ world: deps.worldHost.summary() });
  }

  // Sovereign telemetry: top error signatures (docs/TELEMETRY.md).
  if (url.pathname === "/ops/api/telemetry/summary" && req.method === "GET") {
    const limit = Math.min(200, Number(url.searchParams.get("limit")) || 50);
    return json(telemetrySummary(limit));
  }

  if (url.pathname.startsWith("/ops/api/")) {
    return json({ error: "not found", path: url.pathname }, 404);
  }

  return json({ error: "not found" }, 404);
}

/** Loopback, RFC1918, link-local, or IPv6 ULA — anything plausibly LAN. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  if (a === "::1") return true;
  if (a.includes(":")) {
    const low = a.toLowerCase();
    return low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd");
  }
  const parts = a.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const o1 = parts[0] ?? -1;
  const o2 = parts[1] ?? -1;
  return (
    o1 === 127 ||
    o1 === 10 ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) ||
    (o1 === 192 && o2 === 168) ||
    (o1 === 169 && o2 === 254)
  );
}

/**
 * Start the LAN-only ops listener. Failure to bind must not take down the
 * game server — logs loudly and returns null instead (game > console).
 */
export function startOpsServer(deps: OpsDeps): ReturnType<typeof Bun.serve> | null {
  try {
    const server = Bun.serve({
      port: config.opsPort,
      hostname: "0.0.0.0",
      async fetch(req, srv) {
        const remote = srv.requestIP(req);
        if (!remote || !isPrivateAddress(remote.address)) {
          // Silent 404 — do not advertise the surface to non-LAN callers.
          return new Response("not found", { status: 404 });
        }
        const url = new URL(req.url);
        if (url.pathname === "/") {
          return new Response(null, { status: 302, headers: { location: "/ops" } });
        }
        const res = await handleOps(req, url, deps);
        return res ?? json({ error: "not found" }, 404);
      },
    });
    console.log(`[jakesjam-srv] ops console (LAN-only) on :${server.port}/ops`);
    return server;
  } catch (err) {
    console.error(
      `[jakesjam-srv] ops listener failed to bind :${config.opsPort} — ` +
        `console unavailable this run (game server unaffected):`,
      err,
    );
    return null;
  }
}

async function buildStatus(deps: OpsDeps) {
  const { clips, stats } = await listClips();
  const uptimeSec = Math.floor((Date.now() - deps.startedAtMs) / 1000);
  return {
    ok: true,
    region: config.region,
    port: deps.port,
    uptimeSec,
    startedAt: new Date(deps.startedAtMs).toISOString(),
    world: deps.worldHost.summary(),
    matches: deps.registry.summaries(),
    matchCount: deps.registry.size(),
    privateLobbies: listPrivateLobbies(),
    clips: {
      stats,
      recent: clips.slice(0, 8).map((c) => ({
        filename: c.filename,
        sizeBytes: c.sizeBytes,
        pinned: c.pinned,
        mtimeMs: c.mtimeMs,
        path: c.path,
      })),
    },
    env: {
      adminSecretConfigured: adminConfigured(),
      publicUrl: process.env.PUBLIC_URL ?? null,
      worldMap: process.env.WORLD_MAP ?? null,
      worldBots: process.env.WORLD_BOTS ?? "2",
      serveClientDir: process.env.SERVE_CLIENT_DIR ? true : false,
      wasmCollision: config.wasmCollision,
      wasmPlayer: config.wasmPlayer,
      convexUrl: config.convexUrl ? true : false,
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
  };
}
