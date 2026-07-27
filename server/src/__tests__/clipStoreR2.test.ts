// Integration coverage for the R2 mirror/serve wiring added to
// clipStore.ts (handleClipUpload / serveClip). See r2Clips.test.ts for
// unit coverage of the r2Clips.ts module itself.
//
// Critical property under test: R2 is a no-op — byte-for-byte identical
// upload/serve behavior — until all required env vars are present, and
// even once "configured", an R2 outage must never break a player's
// upload or make an already-served clip disappear (local disk stays the
// fallback until Jake's separate later cleanup step removes it).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleClipUpload, serveClip } from "../clipStore.ts";
import { __resetR2ForTests, __setR2ClientForTest, type ClipsR2Client } from "../r2Clips.ts";

const ORIGIN = "https://example-tunnel.ts.net";

const R2_ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_CLIP_DOMAIN",
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

function uploadRequest(content: string, filename: string): Request {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "video/webm" }), filename);
  return new Request("http://localhost/clips/upload", { method: "POST", body: form });
}

/** mediaUrl is `${origin}/v/${filename}` — pull the raw filename back out. */
function filenameFromMediaUrl(mediaUrl: string): string {
  return mediaUrl.slice(mediaUrl.lastIndexOf("/v/") + "/v/".length);
}

describe("R2 fully unconfigured — regression (no env vars, no injected client)", () => {
  test("upload + serve behave exactly as local-disk-only (200, no redirect)", async () => {
    const result = await handleClipUpload(uploadRequest("plain-local-clip", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filename = filenameFromMediaUrl(result.mediaUrl);

    const res = await serveClip(filename);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("location")).toBeNull();
  });
});

describe("R2 fully configured with a working mocked client", () => {
  function fakeClient(): { client: ClipsR2Client; calls: string[] } {
    const calls: string[] = [];
    const client: ClipsR2Client = {
      write: async (path) => {
        calls.push(path);
        return 1;
      },
      exists: async () => true,
      size: async () => 1,
      delete: async () => {},
    };
    return { client, calls };
  }

  test("upload mirrors to R2 and serveClip then redirects to the public domain", async () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "jakesjam-clips";
    process.env.R2_PUBLIC_CLIP_DOMAIN = "clips.elyad.io";
    const { client, calls } = fakeClient();
    __setR2ClientForTest(client);

    const result = await handleClipUpload(uploadRequest("mirrored-clip", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filename = filenameFromMediaUrl(result.mediaUrl);
    expect(calls).toEqual([filename]);

    const res = await serveClip(filename);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe(`https://clips.elyad.io/${filename}`);
  });
});

describe("R2 write configured but no public domain connected yet", () => {
  test("upload still mirrors (marker written) but serveClip stays local — nothing to redirect to", async () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "jakesjam-clips";
    // R2_PUBLIC_CLIP_DOMAIN intentionally left unset.
    const calls: string[] = [];
    __setR2ClientForTest({
      write: async (path) => {
        calls.push(path);
        return 1;
      },
      exists: async () => true,
      size: async () => 1,
      delete: async () => {},
    });

    const result = await handleClipUpload(uploadRequest("no-domain-yet", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filename = filenameFromMediaUrl(result.mediaUrl);
    expect(calls).toEqual([filename]); // mirror still happened

    const res = await serveClip(filename);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200); // no domain to redirect to yet — local serving
  });
});

describe("R2 outage resilience", () => {
  test("a throwing R2 client never fails the upload, and the clip keeps serving locally", async () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_BUCKET = "jakesjam-clips";
    process.env.R2_PUBLIC_CLIP_DOMAIN = "clips.elyad.io";
    __setR2ClientForTest({
      write: async () => {
        throw new Error("simulated R2 outage");
      },
      exists: async () => false,
      size: async () => 0,
      delete: async () => {},
    });

    const result = await handleClipUpload(uploadRequest("outage-clip", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true); // local write still succeeded
    if (!result.ok) return;
    const filename = filenameFromMediaUrl(result.mediaUrl);

    const res = await serveClip(filename);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200); // no marker was written — safe fallback to local
    expect(res!.headers.get("location")).toBeNull();
  });
});
