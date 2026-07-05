import { describe, expect, test } from "bun:test";
import { saveToken, getToken, isAccessTokenStale, type StoredToken } from "../tokenStore.ts";

const SAMPLE = {
  access_token: "at",
  refresh_token: "rt",
  expires_in: 86400,
  refresh_expires_in: 31536000,
  open_id: "test-open-id",
  scope: "video.publish",
  token_type: "Bearer",
};

describe("tokenStore", () => {
  test("round-trips a saved token", async () => {
    await saveToken("test-open-id", SAMPLE);
    const stored = await getToken("test-open-id");
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe("at");
    expect(stored!.refresh_token).toBe("rt");
  });

  test("unknown open_id returns null, not a throw", async () => {
    const stored = await getToken("never-seen-this-id");
    expect(stored).toBeNull();
  });

  test("stamps obtainedAtMs on save", async () => {
    const before = Date.now();
    await saveToken("stamped-id", SAMPLE);
    const stored = await getToken("stamped-id");
    expect(stored!.obtainedAtMs).toBeGreaterThanOrEqual(before);
  });
});

describe("isAccessTokenStale", () => {
  function tokenAt(obtainedAtMs: number, expiresInSec: number): StoredToken {
    return { ...SAMPLE, obtainedAtMs, expires_in: expiresInSec };
  }

  test("a token that's well within its lifetime is not stale", () => {
    const t = tokenAt(0, 86400); // 24h
    expect(isAccessTokenStale(t, 1000)).toBe(false);
  });

  test("a token past its expiry IS stale", () => {
    const t = tokenAt(0, 100);
    expect(isAccessTokenStale(t, 200_000)).toBe(true);
  });

  test("a token within the refresh margin (5min) of expiring is stale", () => {
    const expiresInSec = 3600;
    const t = tokenAt(0, expiresInSec);
    const nearExpiry = expiresInSec * 1000 - 60_000; // 1 minute before expiry
    expect(isAccessTokenStale(t, nearExpiry)).toBe(true);
  });
});
