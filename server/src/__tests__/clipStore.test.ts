import { describe, expect, test } from "bun:test";
import { handleClipUpload, serveClip } from "../clipStore.ts";

const ORIGIN = "https://example-tunnel.ts.net";

function uploadRequest(fileContent: string, filename: string): Request {
  const form = new FormData();
  form.append("file", new Blob([fileContent], { type: "video/webm" }), filename);
  return new Request("http://localhost/clips/upload", { method: "POST", body: form });
}

describe("clipStore", () => {
  test("uploads a clip and returns an absolute URL on the request's own origin", async () => {
    const result = await handleClipUpload(uploadRequest("fake-webm-bytes", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url.startsWith(`${ORIGIN}/clips/`)).toBe(true);
    expect(result.url.endsWith(".webm")).toBe(true);
  });

  test("uploaded clip is immediately servable at the returned path", async () => {
    const result = await handleClipUpload(uploadRequest("hello clip", "clip.webm"), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const filename = result.url.split("/clips/")[1]!;
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
});
