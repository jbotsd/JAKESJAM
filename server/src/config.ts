// Env parsing. Throws fast if required vars are missing in production.

const PROD = process.env.NODE_ENV === "production";

function required(name: string, devDefault: string): string {
  const value = process.env[name];
  if (!value) {
    if (PROD) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return devDefault;
  }
  return value;
}

// Dev fallback must match the Convex matchmaker fallback (convex/matchmaker.ts)
// so local-without-env-vars works for both processes out of the box.
const DEV_GAME_SERVER_SECRET = "dev-insecure-secret";

export const config = {
  // Dev default 8088 (8080 commonly clashes with SearXNG / proxies).
  // Prod (Fly) sets PORT=8080 via fly.toml — see deploy config.
  port: Number(process.env.PORT ?? 8088),
  // Auto-heal: if the desired port is taken, server tries the next N ports.
  portSearchRange: Number(process.env.PORT_SEARCH_RANGE ?? 10),
  region: process.env.REGION ?? "local",
  // Shared secret used to validate per-player WS auth tokens minted by Convex.
  // Must match Convex env var GAME_SERVER_SECRET. Set with:
  //   flyctl secrets set GAME_SERVER_SECRET=...
  //   npx convex env set GAME_SERVER_SECRET ...
  gameServerSecret: required("GAME_SERVER_SECRET", DEV_GAME_SERVER_SECRET),
  // Convex deployment URL — used for writing match state transitions back
  // (final match result, status -> complete). Optional in dev: if missing,
  // the convex client logs a warning once and silently skips writes.
  // Set with: flyctl secrets set CONVEX_URL=https://<deployment>.convex.cloud
  convexUrl: process.env.CONVEX_URL ?? null,
  // Convex admin/deploy key. Required to call mutations from a non-browser
  // context. Optional in dev — calls fall back to unauthenticated, which
  // works against a `npx convex dev --local` deployment.
  // Accepts either CONVEX_DEPLOY_KEY (preferred) or CONVEX_ADMIN_TOKEN
  // (legacy alias) for backward compat.
  convexDeployKey:
    process.env.CONVEX_DEPLOY_KEY ?? process.env.CONVEX_ADMIN_TOKEN ?? null,

  // Gates single-owner admin actions (TikTok OAuth start + post-as-Jake)
  // that must never be reachable by anonymous players. Unset by default —
  // those endpoints fail closed (401) until an operator sets this, rather
  // than defaulting to an open admin surface. Set with:
  //   ADMIN_SECRET=$(head -c 32 /dev/urandom | base64) bun run host:public
  adminSecret: process.env.ADMIN_SECRET ?? null,

  // Phase F3 — Zig→WASM substrate defaults to ON. The wasm `.wasm`
  // is bundled in the server image and routed by `wasmRuntime.ts`.
  // Both sides (client + server) run bit-identical collision +
  // player physics by default, eliminating the float-drift
  // reconcile churn that caused the "barely detects standing"
  // jitter.
  //
  // Emergency disable: flyctl secrets set JAKESJAM_WASM_COLLISION=0
  // Same for JAKESJAM_WASM_PLAYER=0.
  //
  // ADR-0006, docs/zig-wasm-migration.md.
  wasmCollision: process.env.JAKESJAM_WASM_COLLISION !== "0",
  wasmPlayer: process.env.JAKESJAM_WASM_PLAYER !== "0",

  // Performance audit N1 (2026-07-18): the lag-comp outcome-diagnostic
  // (matchHost.logLagCompOutcomeChange) runs a full second stepWithRuntime
  // PLUS a runtime clone on every tick with any rewind — purely to console.log
  // a hit-gained/lost comparison. Roughly doubles authoritative sim cost
  // during real combat. Default OFF; opt in for lag-comp debugging only.
  lagCompDiag: process.env.JAKESJAM_LAG_COMP_DIAG === "1",
} as const;
