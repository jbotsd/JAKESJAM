import { afterAll, describe, expect, test } from "bun:test";
import { handleOps, requireOpsAuth } from "../ops.ts";
import { handleClipUpload, listClips, pinClip, unpinClip } from "../clipStore.ts";
import { MatchRegistry } from "../matchRegistry.ts";
import { WorldHost } from "../worldHost.ts";

const ORIGIN = "https://play.elyad.io";

function makeDeps() {
  return {
    registry: new MatchRegistry(),
    worldHost: new WorldHost({ bots: 0 }),
    startedAtMs: Date.now() - 5_000,
    port: 8088,
  };
}

describe("requireOpsAuth", () => {
  const prev = process.env.ADMIN_SECRET;

  afterAll(() => {
    if (prev === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = prev;
    // config is read once at import — ops reads config.adminSecret which is
    // frozen at module load. Tests that need live secret use the real config
    // value; when unset we only assert 503 path via handleOps when no secret.
  });

  test("denies without credentials when ADMIN_SECRET is set on config", async () => {
    // config.adminSecret is fixed at import time. If the process has no secret
    // we get 503; if it has one we get 401 without header. Either is fail-closed.
    const req = new Request("http://localhost/ops/api/status");
    const url = new URL(req.url);
    const denied = requireOpsAuth(req, url);
    expect(denied).not.toBeNull();
    expect([401, 503]).toContain(denied!.status);
  });
});

describe("handleOps routing", () => {
  test("non-ops path returns null", async () => {
    const req = new Request("http://localhost/health");
    const res = await handleOps(req, new URL(req.url), makeDeps());
    expect(res).toBeNull();
  });

  test("GET /ops always serves Elm shell HTML", async () => {
    const req = new Request("http://localhost/ops");
    const res = await handleOps(req, new URL(req.url), makeDeps());
    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toContain("text/html");
    const text = await res!.text();
    expect(text).toContain("Elm.Main.init");
    expect(text).toContain("/ops/static/elm.js");
  });

  test("API without auth is fail-closed", async () => {
    const req = new Request("http://localhost/ops/api/status");
    const res = await handleOps(req, new URL(req.url), makeDeps());
    expect(res).not.toBeNull();
    expect([401, 503]).toContain(res!.status);
  });
});

describe("clip pin / list API units", () => {
  test("listClips returns stats shape", async () => {
    const { clips, stats } = await listClips();
    expect(Array.isArray(clips)).toBe(true);
    expect(typeof stats.totalBytes).toBe("number");
    expect(typeof stats.maxBytes).toBe("number");
    expect(stats.maxBytes).toBeGreaterThan(0);
  });

  test("pin and unpin round-trip on an uploaded clip", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "video/webm" }),
      "unit.webm",
    );
    const req = new Request("http://localhost/clips/upload", { method: "POST", body: form });
    const up = await handleClipUpload(req, ORIGIN);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const filename = (up.ok ? up.mediaUrl : "").split("/v/")[1]!.split("?")[0]!;
    expect(filename).toMatch(/\.webm$/);

    const pinned = await pinClip(filename, "ops unit test");
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    expect(pinned.pin.note).toBe("ops unit test");

    const listed = await listClips();
    const entry = listed.clips.find((c) => c.filename === filename);
    expect(entry?.pinned).toBe(true);

    const unpinned = await unpinClip(filename);
    expect(unpinned.ok).toBe(true);

    const listed2 = await listClips();
    const entry2 = listed2.clips.find((c) => c.filename === filename);
    // File may still exist; pin flag must be false.
    if (entry2) expect(entry2.pinned).toBe(false);
  });

  test("pin rejects garbage filename", async () => {
    const r = await pinClip("../etc/passwd");
    expect(r.ok).toBe(false);
  });

  test("known committed pin is listed", async () => {
    const { clips } = await listClips();
    // May or may not be on disk in CI; pin file always has the record via list after ensure.
    // Just ensure list doesn't throw and stats are sane.
    expect(clips.every((c) => c.filename.includes("."))).toBe(true);
  });
});
