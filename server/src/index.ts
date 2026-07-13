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
import { mintWorldToken, verifyMatchToken, verifyWorldToken, constantTimeEquals } from "./auth.ts";
import { config } from "./config.ts";
import { checkRateLimit, clientKey } from "./rateLimit.ts";
import { MatchRegistry } from "./matchRegistry.ts";
import { WorldHost } from "./worldHost.ts";
import type { MatchSocketData } from "./matchHost.ts";
import { PlayerId } from "@sim/types.ts";
import {
  createPrivateLobby,
  getPrivateLobby,
  heartbeatPrivateLobby,
  joinPrivateLobby,
  leavePrivateLobby,
  setChaosPrivate,
  setMapPrivate,
  setReadyPrivate,
  startPrivateMatch,
} from "./privateLobby.ts";
import {
  applyServerWasmCollision,
  applyServerWasmPlayer,
  loadServerSim,
} from "./wasmRuntime.ts";
import {
  ensurePinnedClipsOnDisk,
  handleClipUpload,
  publicClipOrigin,
  serveClip,
} from "./clipStore.ts";
import {
  clipByteSize,
  clipExistsOnDisk,
  isClipFilename,
  renderClipSharePage,
  requestWantsClipSharePage,
  resolveClipFilename,
} from "./clipSharePage.ts";
import { handleOps } from "./ops.ts";
import { convexClient } from "./convexClient.ts";
import { ingestTelemetryBatch } from "./telemetryStore.ts";
import { listClips } from "./clipStore.ts";
import {
  generatePkcePair,
  generateState,
  requireTikTokConfig,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
} from "./tiktok/auth.ts";
import { postClipFromUrl, getCreatorInfo } from "./tiktok/post.ts";
import { saveToken, getToken, isAccessTokenStale } from "./tiktok/tokenStore.ts";
import { createCheckoutSession, findSku, COSMETIC_CATALOG } from "./stripe/checkout.ts";
import { requireStripeWebhookSecret, verifyStripeSignature, parseCheckoutCompleted } from "./stripe/webhook.ts";
import { grantEntitlement, getEntitlements } from "./stripe/entitlements.ts";
import { sanitizePlayerName } from "@net/playerName.ts";

/** Process boot time — surfaced on /ops/api/status uptime. */
const processStartedAtMs = Date.now();

// In-memory PKCE/state stash for the OAuth handshake — short-lived (a few
// minutes at most, spanning one redirect round-trip), so process memory is
// fine; no need for the persisted store tokenStore.ts uses for tokens
// themselves. Swept lazily on each start() call.
const pendingOAuth = new Map<string, { codeVerifier: string; createdAtMs: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
function sweepPendingOAuth(): void {
  const now = Date.now();
  for (const [state, entry] of pendingOAuth) {
    if (now - entry.createdAtMs > OAUTH_STATE_TTL_MS) pendingOAuth.delete(state);
  }
}

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
  // useful for playtesting a specific arena. Default: Vessel Nexus mega
  // (always-floor + cover) with rotation across Hot Lobby maps when unset.
  mapId: process.env.WORLD_MAP ?? "vessel-nexus",
  rotateMaps: process.env.WORLD_MAP === undefined,
  // AI duelists keeping the Hot Lobby alive. Default 2 (host-public.sh
  // same). Set WORLD_BOTS=0 for deterministic probes / quiet local.
  bots: Number(process.env.WORLD_BOTS ?? 2),
});

type SocketKind = "room" | "world";
type SocketData = MatchSocketData & { kind: SocketKind; name?: string };

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
  "access-control-allow-headers": "content-type,x-admin-secret",
};

const RATE_LIMIT_429 = () =>
  new Response("rate limited — slow down", { status: 429, headers: corsHeaders });

/** Gates single-owner admin actions (see config.adminSecret). Fails closed:
 *  no secret configured means no caller can pass, not "anyone can". */
function requireAdmin(req: Request): Response | null {
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!config.adminSecret || !provided || !constantTimeEquals(provided, config.adminSecret)) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }
  return null;
}

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

    const ip = clientKey(req, srv);
    // Global ceiling — bounds aggregate flooding from one source without
    // touching legitimate traffic (world/summary polling is ~20/min/client).
    if (!checkRateLimit(`global:${ip}`, 600, 60_000)) return RATE_LIMIT_429();

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

    // ── Operator console (ADMIN_SECRET) ───────────────────────────────
    // Deep backend UI + JSON API for the host owner — clips pin/unpin,
    // world/rooms status, env flags. Never part of the player SPA.
    {
      const opsRes = await handleOps(req, url, {
        registry,
        worldHost,
        startedAtMs: processStartedAtMs,
        port: srv.port ?? config.port,
      });
      if (opsRes) return opsRes;
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

    // ── Sovereign telemetry ingest (docs/TELEMETRY.md) ──────────────────
    // PRIVACY: rate-limit key is the client-chosen session UUID, NOT the
    // ip — the remote address must never enter the telemetry path. The IP
    // ceiling below (global 600/60s) still bounds raw abuse.
    if (url.pathname === "/telemetry" && req.method === "POST") {
      if ((Number(req.headers.get("content-length")) || 0) > 48 * 1024) {
        return new Response("payload too large", { status: 413, headers: corsHeaders });
      }
      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        return new Response("bad json", { status: 400, headers: corsHeaders });
      }
      const session =
        typeof (payload as { session?: unknown })?.session === "string"
          ? ((payload as { session: string }).session.slice(0, 64))
          : "anon";
      if (!checkRateLimit(`telem:${session}`, 20, 60_000)) return RATE_LIMIT_429();
      const stored = ingestTelemetryBatch(payload);
      return new Response(JSON.stringify({ stored }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // ── Devlog funnel: email signup (the video CTA — "drop your email
    // and you're playing in about eight seconds"). Writes to the Convex
    // `signups` table via convexClient; the list is the asset.
    if (url.pathname === "/api/signup" && req.method === "POST") {
      if (!checkRateLimit(`signup:${ip}`, 6, 10 * 60_000)) return RATE_LIMIT_429();
      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        return new Response("bad json", { status: 400, headers: corsHeaders });
      }
      const email =
        typeof (payload as { email?: unknown })?.email === "string"
          ? (payload as { email: string }).email.trim().toLowerCase()
          : "";
      const source =
        typeof (payload as { source?: unknown })?.source === "string"
          ? (payload as { source: string }).source.slice(0, 32)
          : "unknown";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_email" }), {
          status: 400,
          headers: { "content-type": "application/json", ...corsHeaders },
        });
      }
      const ok = await convexClient.recordSignup(email, source);
      return new Response(JSON.stringify({ ok }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // ── Recent clips feed (public) — the Clips gallery's server side.
    // Clips are already public-by-URL share pages; this lists the newest
    // so every player (especially phones, whose highlights are rendered
    // by the HOST) can find their clip. Cheap + cacheable.
    if (url.pathname === "/clips/recent" && req.method === "GET") {
      const { clips } = await listClips();
      const recent = clips
        .filter((c) => c.ext === "mp4" || c.ext === "webm")
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 24)
        .map((c) => ({ id: c.id, url: `/c/${c.id}`, mediaUrl: `/v/${c.id}.${c.ext}`, mtimeMs: c.mtimeMs }));
      return new Response(JSON.stringify({ clips: recent }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=30",
          ...corsHeaders,
        },
      });
    }

    // ── Highlight clips (client/src/game/highlights/ClipRecorder.ts) ───
    // Upload lands the file under server/.clips/; the returned URL is what
    // a future TikTok Content Posting API PULL_FROM_URL call would use.
    if (url.pathname === "/clips/upload" && req.method === "POST") {
      // No player-identity auth is worth adding here (clip capture is a
      // client-local highlight, not a privileged action) — but the endpoint
      // is unauthenticated and internet-reachable, so cap upload frequency
      // per source. The storage-side quota (clipStore.ts) bounds total disk.
      // 12 per 5min: each highlight trigger now uploads TWO files
      // (vertical + original), so this allows ~6 triggers per window.
      if (!checkRateLimit(`clip:${ip}`, 12, 5 * 60_000)) return RATE_LIMIT_429();
      // Brand domain for share URLs — never randel.*.ts.net (Tailscale funnel).
      const origin = publicClipOrigin(req, url);
      const result = await handleClipUpload(req, origin);
      if (!result.ok) {
        return new Response(result.message, { status: result.status, headers: corsHeaders });
      }
      // `url` is the human/SEO share page; `mediaUrl` is raw bytes for embeds/TikTok.
      // vertical* fields are present when the server-side NVENC crop ran.
      return new Response(
        JSON.stringify({
          url: result.url,
          mediaUrl: result.mediaUrl,
          verticalUrl: result.verticalUrl,
          verticalMediaUrl: result.verticalMediaUrl,
        }),
        { headers: { "content-type": "application/json", ...corsHeaders } },
      );
    }

    // Pretty share page: /c/<uuid> (preferred, no .mp4) and /c/<uuid>.mp4 (legacy)
    // HEAD supported so Facebook crawler probes don't 404.
    if (
      (url.pathname.startsWith("/c/") || url.pathname.startsWith("/watch/")) &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      const prefix = url.pathname.startsWith("/c/") ? "/c/" : "/watch/";
      const slug = url.pathname.slice(prefix.length).split("/")[0] ?? "";
      const resolved = await resolveClipFilename(slug);
      // Still render a 404 marketing page when slug looks like a clip id.
      if (resolved || isClipFilename(slug) || /^[a-f0-9-]{36}$/i.test(slug)) {
        const origin = publicClipOrigin(req, url);
        const filename = resolved ?? (isClipFilename(slug) ? slug : `${slug}.mp4`);
        const exists = resolved !== null;
        const sizeBytes = exists ? await clipByteSize(filename) : null;
        // Canonical: /c/<uuid> without extension — 301 legacy .mp4 share URLs.
        if (exists && isClipFilename(slug)) {
          const idOnly = slug.replace(/\.(webm|mp4)$/i, "");
          return new Response(null, {
            status: 301,
            headers: {
              location: `${origin}/c/${idOnly}`,
              "cache-control": "public, max-age=3600",
              ...corsHeaders,
            },
          });
        }
        if (req.method === "HEAD") {
          return new Response(null, {
            status: exists ? 200 : 404,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "public, max-age=60, must-revalidate",
              ...corsHeaders,
            },
          });
        }
        const html = renderClipSharePage({
          filename,
          origin,
          exists,
          sizeBytes,
        });
        return new Response(html, {
          status: exists ? 200 : 404,
          headers: {
            "content-type": "text/html; charset=utf-8",
            // Short TTL so FB rescrape picks up OG changes quickly
            "cache-control": "public, max-age=60, must-revalidate",
            "cdn-cache-control": "max-age=60",
            ...corsHeaders,
          },
        });
      }
    }

    // Minimal embed player (twitter:player / og:video text/html)
    if (url.pathname.startsWith("/embed/") && req.method === "GET") {
      const slug = url.pathname.slice("/embed/".length).split("/")[0] ?? "";
      const resolved = await resolveClipFilename(slug);
      if (resolved) {
        const origin = publicClipOrigin(req, url);
        const media = `${origin}/v/${resolved}`;
        const mime = resolved.endsWith(".mp4") ? "video/mp4" : "video/webm";
        const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>JAKESJAM clip</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;background:#000}
video{width:100%;height:100%;object-fit:contain;display:block}</style>
</head><body>
<video controls playsinline autoplay muted loop preload="auto">
<source src="${media}" type="${mime}"/>
</video></body></html>`;
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
            // Allow embedding in Twitter/FB player iframes
            "content-security-policy": "frame-ancestors *",
            ...corsHeaders,
          },
        });
      }
      return new Response("not found", { status: 404, headers: corsHeaders });
    }

    // Always-raw video stream for og:video / <video> / TikTok — never HTML.
    // Replay files for the replay player / headless renderer. Same-box +
    // player-facing "watch this match" both read here. `latest` resolves to
    // the newest .jjr. Filenames are sanitized (no traversal); replays are
    // inputs-only (no chat/PII) so public-read is acceptable like clips.
    if (url.pathname.startsWith("/replays/") && req.method === "GET") {
      const raw = url.pathname.slice("/replays/".length).split("?")[0] ?? "";
      const { readdirSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const dir = resolve(import.meta.dir, "..", ".replays");
      let name = raw;
      try {
        if (raw === "latest") {
          const files = readdirSync(dir).filter((f) => f.endsWith(".jjr")).sort();
          name = files[files.length - 1] ?? "";
        }
      } catch {
        name = "";
      }
      if (!name || !/^[a-zA-Z0-9_-]+\.jjr$/.test(name)) {
        return new Response("not found", { status: 404 });
      }
      const file = Bun.file(resolve(dir, name));
      if (!(await file.exists())) {
        return new Response("not found", { status: 404 });
      }
      return new Response(file, {
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/octet-stream",
          "x-replay-name": name,
          "cache-control": "no-store",
        },
      });
    }

    // Paths: /v/<file> (preferred) and /media/<file> (alias).
    if (
      (url.pathname.startsWith("/v/") || url.pathname.startsWith("/media/")) &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      const prefix = url.pathname.startsWith("/v/") ? "/v/" : "/media/";
      const filename = url.pathname.slice(prefix.length).split("?")[0] ?? "";
      const res = await serveClip(filename);
      if (res) {
        if (req.method === "HEAD") {
          return new Response(null, { status: 200, headers: res.headers });
        }
        return res;
      }
      return new Response("not found", { status: 404, headers: corsHeaders });
    }

    // oEmbed for Discord/Slack/etc.
    if (url.pathname === "/oembed" && req.method === "GET") {
      const target = url.searchParams.get("url") ?? "";
      let id = "";
      try {
        const u = new URL(target);
        const parts = u.pathname.split("/").filter(Boolean);
        // /c/<uuid> or /c/<uuid>.mp4
        if (parts[0] === "c" && parts[1]) id = parts[1];
      } catch {
        /* bad url */
      }
      const resolved = id ? await resolveClipFilename(id) : null;
      if (!resolved) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json", ...corsHeaders },
        });
      }
      const origin = publicClipOrigin(req, url);
      const idOnly = resolved.replace(/\.(webm|mp4)$/i, "");
      const pageUrl = `${origin}/c/${idOnly}`;
      const mediaUrl = `${origin}/v/${resolved}`;
      const thumb = `${origin}/og-image.png`;
      return new Response(
        JSON.stringify({
          version: "1.0",
          type: "video",
          provider_name: "JAKESJAM",
          provider_url: origin,
          title: "JAKESJAM highlight — crystal arena clip",
          html: `<video src="${mediaUrl}" controls playsinline style="max-width:100%;height:auto" width="360" height="640"></video>`,
          width: 360,
          height: 640,
          thumbnail_url: thumb,
          thumbnail_width: 1200,
          thumbnail_height: 630,
          // Some consumers also read these:
          url: pageUrl,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
            ...corsHeaders,
          },
        },
      );
    }

    // GET /clips/* — never HTML under the .mp4 path (CF caches by extension and
    // poisoned play.elyad.io/clips/*.mp4 as video/mp4 for a year). Humans get a
    // 302 → /c/<uuid> share page. Bytes only for ?raw=1 / Range / download.
    if (url.pathname.startsWith("/clips/") && (req.method === "GET" || req.method === "HEAD")) {
      const filename = url.pathname.slice("/clips/".length).split("?")[0] ?? "";
      if (isClipFilename(filename) && requestWantsClipSharePage(req, url)) {
        const origin = publicClipOrigin(req, url);
        const idOnly = filename.replace(/\.(webm|mp4)$/i, "");
        return new Response(null, {
          status: 302,
          headers: {
            location: `${origin}/c/${idOnly}`,
            "cache-control": "no-store, no-cache, must-revalidate",
            "cdn-cache-control": "no-store",
            "cloudflare-cdn-cache-control": "no-store",
            ...corsHeaders,
          },
        });
      }
      const res = await serveClip(filename);
      if (res) {
        if (req.method === "HEAD") {
          return new Response(null, { status: 200, headers: res.headers });
        }
        return res;
      }
      return new Response("not found", { status: 404, headers: corsHeaders });
    }

    // ── TikTok Content Posting API integration ──────────────────────────
    // Requires TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REDIRECT_URI
    // (a registered TikTok Developer app) — see server/src/tiktok/. These
    // routes are mechanically complete but cannot be exercised end-to-end
    // without those real credentials, which only the account owner can obtain.
    if (url.pathname === "/tiktok/oauth/start" && req.method === "GET") {
      // One-time account-linking action for the server owner only — a
      // stolen/guessed openId would otherwise let anyone re-link or post as
      // Jake's TikTok account (see /tiktok/post below). Gate both.
      const denied = requireAdmin(req);
      if (denied) return denied;
      try {
        const cfg = requireTikTokConfig();
        sweepPendingOAuth();
        const state = generateState();
        const { codeVerifier, codeChallenge } = generatePkcePair();
        pendingOAuth.set(state, { codeVerifier, createdAtMs: Date.now() });
        const authorizeUrl = buildAuthorizeUrl(cfg, { state, codeChallenge });
        return new Response(null, { status: 302, headers: { location: authorizeUrl, ...corsHeaders } });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }
    if (url.pathname === "/tiktok/oauth/callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        return new Response("missing code/state", { status: 400, headers: corsHeaders });
      }
      const pending = pendingOAuth.get(state);
      if (!pending) {
        return new Response("unknown or expired state — restart /tiktok/oauth/start", {
          status: 400,
          headers: corsHeaders,
        });
      }
      pendingOAuth.delete(state);
      try {
        const cfg = requireTikTokConfig();
        const token = await exchangeCodeForToken(cfg, code, pending.codeVerifier);
        await saveToken(token.open_id, token);
        return new Response(
          JSON.stringify({ ok: true, openId: token.open_id }),
          { headers: { "content-type": "application/json", ...corsHeaders } },
        );
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }
    if (url.pathname === "/tiktok/post" && req.method === "POST") {
      // openId is not a secret (TikTok returns it in the plain oauth
      // callback response) — without this gate, anyone who learned it could
      // post arbitrary videos to Jake's real TikTok account.
      const denied = requireAdmin(req);
      if (denied) return denied;
      let body: { openId?: string; videoUrl?: string; title?: string };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return new Response("bad request", { status: 400, headers: corsHeaders });
      }
      if (!body.openId || !body.videoUrl || !body.title) {
        return new Response("missing openId/videoUrl/title", { status: 400, headers: corsHeaders });
      }
      try {
        const cfg = requireTikTokConfig();
        let stored = await getToken(body.openId);
        if (!stored) {
          return new Response("no stored token for this openId — run /tiktok/oauth/start first", {
            status: 401,
            headers: corsHeaders,
          });
        }
        if (isAccessTokenStale(stored)) {
          const refreshed = await refreshAccessToken(cfg, stored.refresh_token);
          await saveToken(body.openId, refreshed);
          stored = { ...refreshed, obtainedAtMs: Date.now() };
        }
        // TikTok's review requires the UI to show creator_username +
        // creator_avatar_url before every post — callers of this endpoint own
        // that confirmation step; this call just re-fetches it for the caller.
        const creator = await getCreatorInfo(stored.access_token);
        const result = await postClipFromUrl(stored.access_token, {
          videoUrl: body.videoUrl,
          title: body.title,
        });
        return new Response(
          JSON.stringify({ ok: true, publishId: result.publish_id, creator }),
          { headers: { "content-type": "application/json", ...corsHeaders } },
        );
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    // ── Cosmetics store (Stripe Checkout) ───────────────────────────────
    // Requires STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (a real Stripe
    // account) — see server/src/stripe/. Same credential-gated boundary as
    // the TikTok integration above: mechanically complete, untestable live
    // without the account owner's own keys.
    if (url.pathname === "/store/catalog" && req.method === "GET") {
      return new Response(JSON.stringify(COSMETIC_CATALOG), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }
    if (url.pathname === "/store/checkout" && req.method === "POST") {
      // Unauthenticated (anyone can request a session for any playerId) —
      // rate-limit so a script can't hammer the Stripe API on Jake's account.
      if (!checkRateLimit(`checkout:${ip}`, 10, 60_000)) return RATE_LIMIT_429();
      let body: { playerId?: string; skuId?: string };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return new Response("bad request", { status: 400, headers: corsHeaders });
      }
      if (!body.playerId || !body.skuId) {
        return new Response("missing playerId/skuId", { status: 400, headers: corsHeaders });
      }
      const sku = findSku(body.skuId);
      if (!sku) return new Response("unknown skuId", { status: 404, headers: corsHeaders });
      try {
        const origin = `${url.protocol}//${req.headers.get("host") ?? url.host}`;
        const session = await createCheckoutSession({
          sku,
          playerId: body.playerId,
          successUrl: `${origin}/?purchase=success`,
          cancelUrl: `${origin}/?purchase=cancelled`,
        });
        return new Response(JSON.stringify({ checkoutUrl: session.url }), {
          headers: { "content-type": "application/json", ...corsHeaders },
        });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), {
          status: 500,
          headers: corsHeaders,
        });
      }
    }
    if (url.pathname === "/store/webhook" && req.method === "POST") {
      // MUST verify against the raw body text — parsing first and
      // re-serializing would not reproduce the bytes Stripe signed.
      const rawBody = await req.text();
      try {
        const secret = requireStripeWebhookSecret();
        const result = verifyStripeSignature(rawBody, req.headers.get("stripe-signature"), secret);
        if (!result.ok) {
          return new Response(`signature verification failed: ${result.reason}`, {
            status: 400,
            headers: corsHeaders,
          });
        }
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), {
          status: 500,
          headers: corsHeaders,
        });
      }
      const completed = parseCheckoutCompleted(rawBody);
      if (completed) {
        await grantEntitlement(completed.playerId, completed.skuId);
      }
      // 200 for anything else too (other event types) — Stripe retries
      // non-2xx responses, and there's nothing to do for events this store
      // doesn't act on.
      return new Response(JSON.stringify({ received: true }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }
    if (url.pathname === "/store/entitlements" && req.method === "GET") {
      const playerId = url.searchParams.get("playerId");
      if (!playerId) return new Response("missing playerId", { status: 400, headers: corsHeaders });
      const owned = await getEntitlements(playerId);
      return new Response(JSON.stringify({ owned }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // ── Private room lobby (server-native, no Convex) ────────────────
    // Vessel-style private rooms for self-hosted Hot Lobby stack.
    const privateJson = async (fn: () => unknown) => {
      try {
        const body = await fn();
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", ...corsHeaders },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { "content-type": "application/json", ...corsHeaders },
        });
      }
    };
    const readJsonBody = async (): Promise<Record<string, unknown>> => {
      try {
        const b = await req.json();
        return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };

    if (url.pathname === "/private/create" && req.method === "POST") {
      if (!checkRateLimit(`privcreate:${ip}`, 10, 60_000)) return RATE_LIMIT_429();
      const body = await readJsonBody();
      return privateJson(() =>
        createPrivateLobby({
          playerId: String(body.playerId ?? ""),
          name: String(body.name ?? "Host"),
          color: String(body.color ?? "#50e3c2"),
          characterId: String(body.characterId ?? "balanced"),
          mapId: body.mapId ? String(body.mapId) : undefined,
          chaosModifierIds: Array.isArray(body.chaosModifierIds)
            ? body.chaosModifierIds.map(String)
            : undefined,
        }),
      );
    }
    if (url.pathname === "/private/join" && req.method === "POST") {
      if (!checkRateLimit(`privjoin:${ip}`, 20, 60_000)) return RATE_LIMIT_429();
      const body = await readJsonBody();
      return privateJson(() =>
        joinPrivateLobby({
          code: String(body.code ?? ""),
          playerId: String(body.playerId ?? ""),
          name: String(body.name ?? "Player"),
          color: String(body.color ?? "#50e3c2"),
          characterId: String(body.characterId ?? "balanced"),
        }),
      );
    }
    if (url.pathname.startsWith("/private/") && req.method === "GET") {
      const code = url.pathname.slice("/private/".length).split("/")[0] ?? "";
      if (!code || code.includes("create") || code.includes("join")) {
        return new Response("not found", { status: 404, headers: corsHeaders });
      }
      const snap = getPrivateLobby(code);
      if (!snap) {
        return new Response(JSON.stringify({ error: "Room not found." }), {
          status: 404,
          headers: { "content-type": "application/json", ...corsHeaders },
        });
      }
      return new Response(JSON.stringify(snap), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }
    if (url.pathname === "/private/ready" && req.method === "POST") {
      const body = await readJsonBody();
      return privateJson(() =>
        setReadyPrivate(String(body.code ?? ""), String(body.playerId ?? ""), Boolean(body.ready)),
      );
    }
    if (url.pathname === "/private/map" && req.method === "POST") {
      const body = await readJsonBody();
      return privateJson(() =>
        setMapPrivate(String(body.code ?? ""), String(body.playerId ?? ""), String(body.mapId ?? "")),
      );
    }
    if (url.pathname === "/private/chaos" && req.method === "POST") {
      const body = await readJsonBody();
      return privateJson(() =>
        setChaosPrivate(
          String(body.code ?? ""),
          String(body.playerId ?? ""),
          Array.isArray(body.chaosModifierIds) ? body.chaosModifierIds.map(String) : [],
        ),
      );
    }
    if (url.pathname === "/private/heartbeat" && req.method === "POST") {
      const body = await readJsonBody();
      return privateJson(() =>
        heartbeatPrivateLobby(String(body.code ?? ""), String(body.playerId ?? "")),
      );
    }
    if (url.pathname === "/private/leave" && req.method === "POST") {
      const body = await readJsonBody();
      return privateJson(() =>
        leavePrivateLobby(String(body.code ?? ""), String(body.playerId ?? "")),
      );
    }
    if (url.pathname === "/private/start" && req.method === "POST") {
      if (!checkRateLimit(`privstart:${ip}`, 10, 60_000)) return RATE_LIMIT_429();
      const body = await readJsonBody();
      return privateJson(async () => {
        const result = await startPrivateMatch(
          String(body.code ?? ""),
          String(body.playerId ?? ""),
          config.gameServerSecret,
        );
        return {
          ...result.snapshot,
          matchId: result.matchId,
          tokens: result.tokens,
        };
      });
    }

    // ── World rematch-ready ─────────────────────────────────────────────
    // Hot Lobby's results overlay Rematch button — see worldHost.markRematchReady.
    // Not rate-limited: one call per player per match-end, same low-frequency
    // shape as /private/ready.
    if (url.pathname === "/world/rematch-ready" && req.method === "POST") {
      const body = await readJsonBody();
      const playerId = String(body.playerId ?? "");
      if (!playerId) {
        return new Response("bad playerId", { status: 400, headers: corsHeaders });
      }
      worldHost.markRematchReady(PlayerId(playerId));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    // ── World token mint ──────────────────────────────────────────────
    if (url.pathname === "/world-token" && req.method === "POST") {
      if (!checkRateLimit(`worldtoken:${ip}`, 20, 60_000)) return RATE_LIMIT_429();
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
      if (!checkRateLimit(`wsconnect:${ip}`, 30, 5 * 60_000)) {
        return new Response("rate limited", { status: 429 });
      }
      const token = url.searchParams.get("token");
      if (!token) return new Response("bad request", { status: 400 });
      const verified = await verifyWorldToken(token, config.gameServerSecret);
      if (!verified) return new Response("auth failed", { status: 401 });
      // Chosen display name rides the ws URL (not the signed token — it's
      // cosmetic). This server-side pass is AUTHORITATIVE — the client's
      // copy (net/playerName.ts, same function) is UX only and must never
      // be trusted; a request can hit this endpoint directly, bypassing
      // the browser's input entirely.
      const rawName = url.searchParams.get("name") ?? "";
      const data: SocketData = {
        kind: "world",
        matchId: "world",
        playerId: verified.playerId,
        name: sanitizePlayerName(rawName),
        authedAt: Date.now(),
      };
      const upgraded = srv.upgrade(req, { data });
      return upgraded ? undefined : new Response("upgrade failed", { status: 500 });
    }

    // ── Room WS upgrade (legacy) ──────────────────────────────────────
    if (url.pathname === "/ws") {
      if (!checkRateLimit(`wsconnect:${ip}`, 30, 5 * 60_000)) {
        return new Response("rate limited", { status: 429 });
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
    // Measured (client/bench/snapshotDelta.bench.ts, worst case: 16 players
    // / ~900 projectiles): an 85KB msgpack snapshot delta deflates to 22KB
    // (74% egress cut) for ~0.9ms/msg — and typical snapshots are a few KB
    // where the cost is tens of µs. On a home-uplink-hosted server the
    // uncompressed worst case (~7MB/s at 4 clients) would saturate the
    // link; deflated it's comfortable. Browsers negotiate this
    // automatically; clients that don't offer it just get uncompressed.
    perMessageDeflate: true,
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

// Keep user-flagged highlight reels on disk (server/clip-pins.json).
void ensurePinnedClipsOnDisk().then(() => {
  console.log("[jakesjam-srv] pinned clips ensured under .clips/kept/");
});

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
