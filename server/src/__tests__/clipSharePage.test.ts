import { describe, expect, test } from "bun:test";
import {
  isClipFilename,
  renderClipSharePage,
  requestWantsClipSharePage,
} from "../clipSharePage.ts";

describe("clipSharePage", () => {
  test("accepts uuid filenames only", () => {
    expect(isClipFilename("6360b024-2fe2-4d6b-983d-3ebaa08d6641.mp4")).toBe(true);
    expect(isClipFilename("../etc/passwd")).toBe(false);
    expect(isClipFilename("nope.txt")).toBe(false);
  });

  test("share page by default; raw/range opt out", () => {
    const file = "6360b024-2fe2-4d6b-983d-3ebaa08d6641.mp4";
    const base = `http://localhost/clips/${file}`;
    // Even */* → page (CDN-safe; no Accept negotiation).
    expect(
      requestWantsClipSharePage(new Request(base, { headers: { accept: "*/*" } }), new URL(base)),
    ).toBe(true);
    expect(
      requestWantsClipSharePage(
        new Request(base + "?raw=1", { headers: { accept: "text/html" } }),
        new URL(base + "?raw=1"),
      ),
    ).toBe(false);
    expect(
      requestWantsClipSharePage(
        new Request(base, { headers: { accept: "*/*", range: "bytes=0-1" } }),
        new URL(base),
      ),
    ).toBe(false);
  });

  test("HTML includes SEO, OG video, share targets, play CTA", () => {
    const html = renderClipSharePage({
      filename: "6360b024-2fe2-4d6b-983d-3ebaa08d6641.mp4",
      origin: "https://play.elyad.io",
      exists: true,
      sizeBytes: 8_000_000,
    });
    expect(html).toContain('property="og:video"');
    expect(html).toContain('property="og:video:url"');
    expect(html).toContain("/v/6360b024-2fe2-4d6b-983d-3ebaa08d6641.mp4");
    expect(html).toContain("canonical\" href=\"https://play.elyad.io/c/6360b024-2fe2-4d6b-983d-3ebaa08d6641\"");
    expect(html).toContain("application/ld+json");
    expect(html).toContain("VideoObject");
    expect(html).toContain("VideoGame");
    expect(html).toContain("Drop into the Arena");
    expect(html).toContain("twitter.com/intent/tweet");
    expect(html).toContain("facebook.com/sharer");
    expect(html).toContain("reddit.com/submit");
    expect(html).toContain("wa.me");
    expect(html).toContain("t.me/share");
    expect(html).toContain("linkedin.com/sharing");
    expect(html).toContain("utm_source=clip");
    expect(html).toContain("elyad.io");
  });

  test("missing clip still markets the game with 404-friendly body", () => {
    const html = renderClipSharePage({
      filename: "00000000-0000-0000-0000-000000000000.mp4",
      origin: "https://play.elyad.io",
      exists: false,
    });
    expect(html).toContain("Clip not found");
    expect(html).toContain("Play free");
    expect(html).toContain("The Arena");
  });
});
