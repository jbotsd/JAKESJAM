import { describe, expect, test } from "bun:test";
import { handleClipUpload, publicClipOrigin, serveClip } from "../clipStore.ts";

const ORIGIN = "https://example-tunnel.ts.net";

function uploadRequest(fileContent: string, filename: string): Request {
  const form = new FormData();
  form.append("file", new Blob([fileContent], { type: "video/webm" }), filename);
  return new Request("http://localhost/clips/upload", { method: "POST", body: form });
}

describe("publicClipOrigin", () => {
  test("PUBLIC_URL wins over Tailscale Host", () => {
    const prev = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = "https://play.elyad.io";
    try {
      const req = new Request("https://randel.taile8fa30.ts.net/clips/upload", {
        headers: { host: "randel.taile8fa30.ts.net" },
      });
      const origin = publicClipOrigin(req, new URL("https://randel.taile8fa30.ts.net/clips/upload"));
      expect(origin).toBe("https://play.elyad.io");
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = prev;
    }
  });

  test("ts.net host without PUBLIC_URL still brands to play.elyad.io", () => {
    const prev = process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL;
    try {
      const req = new Request("https://randel.example.ts.net/clips/upload", {
        headers: { host: "randel.example.ts.net" },
      });
      const origin = publicClipOrigin(req, new URL("https://randel.example.ts.net/x"));
      expect(origin).toBe("https://play.elyad.io");
    } finally {
      if (prev !== undefined) process.env.PUBLIC_URL = prev;
    }
  });

  test("localhost stays local for dev", () => {
    const prev = process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL;
    try {
      const req = new Request("http://localhost:8088/clips/upload", {
        headers: { host: "localhost:8088" },
      });
      const origin = publicClipOrigin(req, new URL("http://localhost:8088/clips/upload"));
      expect(origin).toBe("http://localhost:8088");
    } finally {
      if (prev !== undefined) process.env.PUBLIC_URL = prev;
    }
  });
});

describe("clipStore", () => {
  test("uploads a clip and returns share page + media URLs", async () => {
    const result = await handleClipUpload(uploadRequest("fake-webm-bytes", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url.startsWith(`${ORIGIN}/c/`)).toBe(true);
    // No media extension on share URL — FB treats *.mp4 as bare video.
    expect(result.url.endsWith(".webm")).toBe(false);
    expect(result.url.endsWith(".mp4")).toBe(false);
    expect(result.mediaUrl.startsWith(`${ORIGIN}/v/`)).toBe(true);
  });

  test("uploaded clip is immediately servable at the media path", async () => {
    const result = await handleClipUpload(uploadRequest("hello clip", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filename = result.mediaUrl.split("/v/")[1]!.split("?")[0]!;
    const res = await serveClip(filename);
    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toBe("video/webm");
    const body = await res!.text();
    expect(body).toBe("hello clip");
  });

  test("missing file field is rejected", async () => {
    const form = new FormData();
    const req = new Request("http://localhost/clips/upload", { method: "POST", body: form });
    const result = await handleClipUpload(req, ORIGIN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("non-multipart body is rejected, not thrown", async () => {
    const req = new Request("http://localhost/clips/upload", {
      method: "POST",
      body: "not a form",
      headers: { "content-type": "text/plain" },
    });
    const result = await handleClipUpload(req, ORIGIN);
    expect(result.ok).toBe(false);
  });

  test("path traversal in the requested filename is rejected", async () => {
    const res = await serveClip("../../etc/passwd");
    expect(res).toBeNull();
  });

  test("unknown extension is rejected even with a plausible-looking name", async () => {
    const res = await serveClip("00000000-0000-0000-0000-000000000000.exe");
    expect(res).toBeNull();
  });

  test("nonexistent (but well-formed) filename returns null, not a throw", async () => {
    const res = await serveClip("00000000-0000-0000-0000-000000000000.webm");
    expect(res).toBeNull();
  });

  test("oversized clip is rejected with 413", async () => {
    const big = new Uint8Array(41 * 1024 * 1024); // > MAX_CLIP_BYTES
    const form = new FormData();
    form.append("file", new Blob([big], { type: "video/webm" }), "big.webm");
    const req = new Request("http://localhost/clips/upload", { method: "POST", body: form });
    const result = await handleClipUpload(req, ORIGIN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(413);
  });

  test("pinned highlight reel is listed in clip-pins.json", async () => {
    const raw = await Bun.file(
      new URL("../../clip-pins.json", import.meta.url),
    ).text();
    const data = JSON.parse(raw) as { pins: Array<{ id: string; ext: string }> };
    const pin = data.pins.find((p) => p.id === "837b0742-9faa-4fb2-bd1b-653e504b40cb");
    expect(pin?.ext).toBe("mp4");
  });
});
