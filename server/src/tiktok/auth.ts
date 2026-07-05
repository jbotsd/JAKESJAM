// TikTok OAuth 2.0 with PKCE — the auth half of the Content Posting API
// integration. Mechanically complete per TikTok's published docs, but CANNOT
// be exercised against the real API without a registered TikTok Developer
// app (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET) and a verified redirect
// domain — that's an external, credential-gated step only the account owner
// can do. Every pure function here (PKCE generation, URL building) is unit
// tested against the documented contract; the network calls are tested with
// a mocked fetch, not a live account.
//
// See the research brief, section 3, for the full mechanics writeup.

import { randomBytes, createHash } from "node:crypto";

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE code_verifier + its S256 code_challenge, per RFC 7636. */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

export type TikTokAuthConfig = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
};

/** Reads TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REDIRECT_URI from
 *  the environment. Throws with an actionable message if any are missing —
 *  this is the credential boundary the research brief flagged, made loud
 *  and explicit rather than a silent no-op. */
export function requireTikTokConfig(): TikTokAuthConfig {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  const missing = [
    !clientKey && "TIKTOK_CLIENT_KEY",
    !clientSecret && "TIKTOK_CLIENT_SECRET",
    !redirectUri && "TIKTOK_REDIRECT_URI",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `TikTok integration not configured — missing env var(s): ${missing.join(", ")}. ` +
        "Register an app at developers.tiktok.com, verify the redirect domain, and set these.",
    );
  }
  return { clientKey: clientKey!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

/**
 * Build the URL to redirect a creator to for the authorization step. `scope`
 * defaults to `video.publish` (the only scope the Content Posting API needs).
 */
export function buildAuthorizeUrl(
  config: TikTokAuthConfig,
  opts: { state: string; codeChallenge: string; scope?: string },
): string {
  const params = new URLSearchParams({
    client_key: config.clientKey,
    scope: opts.scope ?? "video.publish",
    response_type: "code",
    redirect_uri: config.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type TikTokTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
};

/** Exchange the authorization code for access + refresh tokens. */
export async function exchangeCodeForToken(
  config: TikTokAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<TikTokTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`TikTok token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TikTokTokenResponse;
}

/** Refresh an expired access token. Refresh tokens are valid for 365 days;
 *  access tokens for 24 hours — call this whenever a stored token is stale. */
export async function refreshAccessToken(
  config: TikTokAuthConfig,
  refreshToken: string,
): Promise<TikTokTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`TikTok token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TikTokTokenResponse;
}
