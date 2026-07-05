import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getCreatorInfo, postClipFromUrl } from "../post.ts";

describe("TikTok post module (mocked network)", () => {
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

  test("getCreatorInfo sends the bearer token and returns username/avatar for the mandated UI", async () => {
    mockFetch(200, {
      data: {
        creator_avatar_url: "https://p.tiktokcdn.com/avatar.jpg",
        creator_username: "jakesjam",
        creator_nickname: "JAKESJAM",
        privacy_level_options: ["SELF_ONLY"],
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        max_video_post_duration_sec: 60,
      },
    });
    const info = await getCreatorInfo("token-123");
    expect(info.creator_username).toBe("jakesjam");
    expect(info.creator_avatar_url).toContain("avatar.jpg");
    expect(info.max_video_post_duration_sec).toBe(60);
    expect(lastCall!.url).toBe("https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
  });

  test("postClipFromUrl uses PULL_FROM_URL and defaults to SELF_ONLY (unaudited-safe)", async () => {
    mockFetch(200, { data: { publish_id: "pub_abc" } });
    const result = await postClipFromUrl("token-123", {
      videoUrl: "https://verified-domain.tld/clips/a.webm",
      title: "Chain-lightning double",
    });
    expect(result.publish_id).toBe("pub_abc");
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.source_info.source).toBe("PULL_FROM_URL");
    expect(body.source_info.video_url).toBe("https://verified-domain.tld/clips/a.webm");
    expect(body.post_info.privacy_level).toBe("SELF_ONLY");
    expect(body.post_info.title).toBe("Chain-lightning double");
  });

  test("postClipFromUrl allows overriding privacy_level (e.g. post-audit)", async () => {
    mockFetch(200, { data: { publish_id: "pub_xyz" } });
    await postClipFromUrl("token-123", {
      videoUrl: "https://verified-domain.tld/clips/b.webm",
      title: "t",
      privacyLevel: "PUBLIC_TO_EVERYONE",
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
  });

  test("a TikTok API error response throws instead of returning undefined", async () => {
    mockFetch(200, { error: { code: "error", message: "spam_risk_too_many_posts" } });
    await expect(
      postClipFromUrl("token-123", { videoUrl: "https://x.tld/a.webm", title: "t" }),
    ).rejects.toThrow(/spam_risk_too_many_posts/);
  });

  test("a non-ok HTTP response throws", async () => {
    mockFetch(401, { error: { code: "access_token_invalid", message: "token expired" } });
    await expect(getCreatorInfo("stale-token")).rejects.toThrow(/401|token expired/);
  });
});
