import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import {
  generatePkcePair,
  generateState,
  requireTikTokConfig,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  type TikTokAuthConfig,
} from "../auth.ts";

const CONFIG: TikTokAuthConfig = {
  clientKey: "test_client_key",
  clientSecret: "test_client_secret",
  redirectUri: "https://example.tld/callback",
};

describe("PKCE", () => {
  test("code_verifier and code_challenge are base64url (no +, /, or =)", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier).not.toMatch(/[+/=]/);
    expect(codeChallenge).not.toMatch(/[+/=]/);
  });

  test("code_challenge is exactly S256(code_verifier), base64url-encoded", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const expected = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(codeChallenge).toBe(expected);
  });

  test("two calls produce different verifiers (not deterministic/reused)", () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  test("generateState produces a non-empty, URL-safe token", () => {
    const s = generateState();
    expect(s.length).toBeGreaterThan(10);
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe("requireTikTokConfig", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  test("throws a listing all missing vars when none are set", () => {
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    delete process.env.TIKTOK_REDIRECT_URI;
    expect(() => requireTikTokConfig()).toThrow(/TIKTOK_CLIENT_KEY.*TIKTOK_CLIENT_SECRET.*TIKTOK_REDIRECT_URI/s);
  });

  test("throws naming only the specific missing var", () => {
    process.env.TIKTOK_CLIENT_KEY = "k";
    process.env.TIKTOK_CLIENT_SECRET = "s";
    delete process.env.TIKTOK_REDIRECT_URI;
    expect(() => requireTikTokConfig()).toThrow("TIKTOK_REDIRECT_URI");
    expect(() => requireTikTokConfig()).not.toThrow("TIKTOK_CLIENT_KEY");
  });

  test("returns the config when all three are set", () => {
    process.env.TIKTOK_CLIENT_KEY = "k";
    process.env.TIKTOK_CLIENT_SECRET = "s";
    process.env.TIKTOK_REDIRECT_URI = "https://example.tld/cb";
    expect(requireTikTokConfig()).toEqual({
      clientKey: "k",
      clientSecret: "s",
      redirectUri: "https://example.tld/cb",
    });
  });
});

describe("buildAuthorizeUrl", () => {
  test("includes every required OAuth+PKCE param, correctly encoded", () => {
    const url = new URL(
      buildAuthorizeUrl(CONFIG, { state: "abc123", codeChallenge: "chal-lenge" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe(CONFIG.clientKey);
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("code_challenge")).toBe("chal-lenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("video.publish");
  });

  test("scope is overridable", () => {
    const url = new URL(
      buildAuthorizeUrl(CONFIG, { state: "s", codeChallenge: "c", scope: "user.info.basic" }),
    );
    expect(url.searchParams.get("scope")).toBe("user.info.basic");
  });
});

describe("token exchange + refresh (mocked network)", () => {
  const originalFetch = globalThis.fetch;
  let lastCall: { url: string; init: RequestInit } | null = null;

  beforeEach(() => {
    lastCall = null;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: unknown) {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      lastCall = { url: String(url), init };
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  }

  test("exchangeCodeForToken posts the correct grant_type + PKCE verifier", async () => {
    mockFetch(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 86400,
      refresh_expires_in: 31536000,
      open_id: "oid",
      scope: "video.publish",
      token_type: "Bearer",
    });
    const result = await exchangeCodeForToken(CONFIG, "auth-code", "verifier-xyz");
    expect(result.access_token).toBe("at");
    expect(result.refresh_token).toBe("rt");
    expect(lastCall!.url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    const sentBody = new URLSearchParams(lastCall!.init.body as string);
    expect(sentBody.get("grant_type")).toBe("authorization_code");
    expect(sentBody.get("code")).toBe("auth-code");
    expect(sentBody.get("code_verifier")).toBe("verifier-xyz");
    expect(sentBody.get("client_key")).toBe(CONFIG.clientKey);
    expect(sentBody.get("client_secret")).toBe(CONFIG.clientSecret);
  });

  test("exchangeCodeForToken throws with status + body on a non-ok response", async () => {
    mockFetch(400, { error: "invalid_grant" });
    await expect(exchangeCodeForToken(CONFIG, "bad-code", "v")).rejects.toThrow(/400/);
  });

  test("refreshAccessToken posts grant_type=refresh_token with the refresh token", async () => {
    mockFetch(200, {
      access_token: "new-at",
      refresh_token: "new-rt",
      expires_in: 86400,
      refresh_expires_in: 31536000,
      open_id: "oid",
      scope: "video.publish",
      token_type: "Bearer",
    });
    const result = await refreshAccessToken(CONFIG, "old-refresh-token");
    expect(result.access_token).toBe("new-at");
    const sentBody = new URLSearchParams(lastCall!.init.body as string);
    expect(sentBody.get("grant_type")).toBe("refresh_token");
    expect(sentBody.get("refresh_token")).toBe("old-refresh-token");
  });
});
