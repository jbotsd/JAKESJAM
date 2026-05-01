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
  port: Number(process.env.PORT ?? 8080),
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
} as const;
