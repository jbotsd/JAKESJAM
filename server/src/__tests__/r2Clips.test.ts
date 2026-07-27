import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetR2ForTests,
  __setR2ClientForTest,
  contentTypeForExt,
  getPublicClipUrl,
  hasR2Marker,
  r2ArchiveConfigured,
  r2ClipsConfigured,
  r2ServingConfigured,
  uploadClipToR2,
  writeR2Marker,
  type ClipsR2Client,
} from "../r2Clips.ts";

const R2_ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_CLIP_DOMAIN",
  "R2_ARCHIVE_BUCKET",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of R2_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetR2ForTests();
});

afterEach(() => {
  for (const k of R2_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetR2ForTests();
});

describe("feature flag — off by default (no env vars set)", () => {
  test("r2ClipsConfigured is false with nothing set", () => {
    expect(r2ClipsConfigured()).toBe(false);
  });

  test("r2ServingConfigured is false with nothing set", () => {
    expect(r2ServingConfigured()).toBe(false);
  });

  test("r2ArchiveConfigured is false with nothing set", () => {
    expect(r2ArchiveConfigured()).toBe(false);
  });

  test("getPublicClipUrl returns null without a domain", () => {
    expect(getPublicClipUrl("abc.mp4")).toBeNull();
  });

  test("uploadClipToR2 reports not-configured and never throws", async () => {
    const result = await uploadClipToR2("abc.mp4", new Blob(["x"]), "video/mp4");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not configured");
  });
});

describe("feature flag — requires ALL FOUR write-path vars", () => {
  test("missing just one of the four still leaves it disabled", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    // R2_BUCKET intentionally unset
    expect(r2ClipsConfigured()).toBe(false);
  });

  test("all four present flips it on", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "jakesjam-clips";
    expect(r2ClipsConfigured()).toBe(true);
    // Serving still off — no public domain connected yet.
    expect(r2ServingConfigured()).toBe(false);
  });

  test("serving additionally needs R2_PUBLIC_CLIP_DOMAIN", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "jakesjam-clips";
    process.env.R2_PUBLIC_CLIP_DOMAIN = "clips.elyad.io";
    expect(r2ServingConfigured()).toBe(true);
  });

  test("archive bucket is independent of the public R2_BUCKET var", () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_ARCHIVE_BUCKET = "jakesjam-clips-archive";
    expect(r2ArchiveConfigured()).toBe(true);
    expect(r2ClipsConfigured()).toBe(false); // R2_BUCKET still unset
  });
});

describe("getPublicClipUrl", () => {
  test("builds https URL from a bare domain", () => {
    process.env.R2_PUBLIC_CLIP_DOMAIN = "clips.elyad.io";
    expect(getPublicClipUrl("abc123.mp4")).toBe("https://clips.elyad.io/abc123.mp4");
  });

  test("tolerates a domain already written with scheme + trailing slash", () => {
    process.env.R2_PUBLIC_CLIP_DOMAIN = "https://clips.elyad.io/";
    expect(getPublicClipUrl("abc123.mp4")).toBe("https://clips.elyad.io/abc123.mp4");
  });
});

describe("contentTypeForExt", () => {
  test("mp4 -> video/mp4", () => {
    expect(contentTypeForExt("mp4")).toBe("video/mp4");
    expect(contentTypeForExt("MP4")).toBe("video/mp4");
  });
  test("webm (and anything else) -> video/webm", () => {
    expect(contentTypeForExt("webm")).toBe("video/webm");
  });
});

describe("uploadClipToR2 with an injected client", () => {
  test("success path calls client.write with the given key/data/type", async () => {
    const calls: Array<{ path: string; type?: string }> = [];
    const fake: ClipsR2Client = {
      write: async (path, _data, options) => {
        calls.push({ path, type: options?.type });
        return 123;
      },
      exists: async () => true,
      size: async () => 123,
      delete: async () => {},
    };
    __setR2ClientForTest(fake);
    const result = await uploadClipToR2("clip123.mp4", new Blob(["hello"]), "video/mp4");
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ path: "clip123.mp4", type: "video/mp4" }]);
  });

  test("a throwing client never throws out — returns ok:false with the message", async () => {
    const fake: ClipsR2Client = {
      write: async () => {
        throw new Error("R2 connection refused");
      },
      exists: async () => false,
      size: async () => 0,
      delete: async () => {},
    };
    __setR2ClientForTest(fake);
    const result = await uploadClipToR2("clip123.mp4", new Blob(["hello"]), "video/mp4");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("R2 connection refused");
  });

  test("explicit null override still reports not-configured (distinct from unset)", async () => {
    __setR2ClientForTest(null);
    const result = await uploadClipToR2("clip.mp4", new Blob(["x"]), "video/mp4");
    expect(result.ok).toBe(false);
  });
});

describe("R2 marker sidecar (drives serveClip's redirect decision)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jakesjam-r2-marker-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("hasR2Marker is false before any marker is written", async () => {
    expect(await hasR2Marker(dir, "abc123")).toBe(false);
  });

  test("writeR2Marker then hasR2Marker round-trips true", async () => {
    await writeR2Marker(dir, "abc123", { bucket: "jakesjam-clips", key: "abc123.mp4" });
    expect(await hasR2Marker(dir, "abc123")).toBe(true);
    // A different id in the same dir is unaffected.
    expect(await hasR2Marker(dir, "other-id")).toBe(false);
  });
});
