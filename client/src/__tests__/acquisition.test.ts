// Acquisition attribution — the instrument that answers "did the post work".
//
// This is measurement code, so the failure mode is not a crash: it is a
// number that looks plausible and is wrong. Every test below is aimed at
// one specific way this could quietly lie.

import { describe, expect, test } from "bun:test";
import { classifyRef, cleanUtm, readAcquisition, refHost } from "../acquisition";

describe("refHost — host only, never the path or query", () => {
  test("keeps the host and DISCARDS path and query", () => {
    // The privacy claim in the header is only true if this holds. A
    // referrer like a Google search carries the query terms in the URL.
    const got = refHost("https://www.google.com/search?q=embarrassing+thing");
    expect(got).toBe("google.com");
    expect(got).not.toContain("embarrassing");
    expect(got).not.toContain("?");
    expect(got).not.toContain("/");
  });

  test("strips www. so one platform is one row", () => {
    expect(refHost("https://www.reddit.com/r/webgames/")).toBe("reddit.com");
    expect(refHost("https://reddit.com/r/webgames/")).toBe("reddit.com");
  });

  test("empty and malformed referrers yield '', never a throw", () => {
    expect(refHost("")).toBe("");
    expect(refHost("not a url")).toBe("");
    expect(refHost("android-app://com.reddit.frontpage")).toBe("com.reddit.frontpage");
  });
});

describe("classifyRef — the bucket the campaign question is answered in", () => {
  test("no referrer is direct, not 'other'", () => {
    expect(classifyRef("")).toBe("direct");
  });

  test("our own hosts are self, so navigation is not counted as acquisition", () => {
    expect(classifyRef("elyad.io")).toBe("self");
    expect(classifyRef("play.elyad.io")).toBe("self");
    expect(classifyRef("localhost")).toBe("self");
  });

  test("the social hosts a grassroots campaign actually uses", () => {
    for (const h of [
      "reddit.com", "old.reddit.com", "t.co", "x.com", "l.facebook.com",
      "instagram.com", "tiktok.com", "discord.com", "bsky.app",
      "news.ycombinator.com", "itch.io", "youtube.com",
    ]) {
      expect({ h, g: classifyRef(h) }).toEqual({ h, g: "social" });
    }
  });

  test("search engines, including google ccTLDs", () => {
    for (const h of ["google.com", "google.com.au", "google.de", "duckduckgo.com", "bing.com"]) {
      expect({ h, g: classifyRef(h) }).toEqual({ h, g: "search" });
    }
  });

  test("SUFFIX MATCHING IS ANCHORED — a lookalike host is not social", () => {
    // Without the leading dot in the suffix rule, every one of these would
    // be miscounted as a campaign win. This is the test that makes the
    // "social" number trustworthy rather than merely non-zero.
    expect(classifyRef("notreddit.com")).toBe("other");
    expect(classifyRef("fake-x.com")).toBe("other");
    expect(classifyRef("reddit.com.evil.net")).toBe("other");
    expect(classifyRef("myinstagram.com")).toBe("other");
  });

  test("an unknown host is 'other', not silently social", () => {
    expect(classifyRef("someblog.example")).toBe("other");
  });

  test("the classifier can FAIL — buckets are not all one value", () => {
    // Vacuity guard. If a refactor collapsed the return to a constant,
    // every agreement test above would still pass.
    const seen = new Set(
      ["", "elyad.io", "reddit.com", "google.com", "someblog.example"].map(classifyRef),
    );
    expect(seen.size).toBe(5);
  });
});

describe("cleanUtm — our tag, arriving through a URL a stranger can edit", () => {
  test("keeps ordinary slugs", () => {
    expect(cleanUtm("reddit")).toBe("reddit");
    expect(cleanUtm("fight-night_2")).toBe("fight-night_2");
  });

  test("lowercases so Reddit and reddit are one row", () => {
    expect(cleanUtm("Reddit")).toBe("reddit");
  });

  test("strips anything outside the slug charset", () => {
    expect(cleanUtm("<script>alert(1)</script>")).toBe("scriptalert1script");
    expect(cleanUtm("a b/c?d=e")).toBe("abcde");
  });

  test("truncates — an attacker cannot inflate the store through this field", () => {
    expect(cleanUtm("x".repeat(500))).toHaveLength(40);
  });

  test("absent tags are '', never 'null' or 'undefined' as text", () => {
    expect(cleanUtm(null)).toBe("");
    expect(cleanUtm(undefined)).toBe("");
    expect(cleanUtm("")).toBe("");
  });
});

describe("readAcquisition — what lands on the boot event", () => {
  test("untagged direct visit", () => {
    expect(readAcquisition("", "https://elyad.io/")).toEqual({
      ref: "", refGroup: "direct", src: "direct",
      utmMedium: "", utmCampaign: "", landing: "/",
    });
  });

  test("untagged social visit is attributed by referrer alone", () => {
    const a = readAcquisition("https://www.reddit.com/r/webgames/comments/abc/", "https://elyad.io/");
    expect(a.refGroup).toBe("social");
    expect(a.src).toBe("reddit.com");
    expect(a.ref).toBe("reddit.com");
  });

  test("utm_source WINS over the referrer host", () => {
    // The case this exists for: in-app browsers send no referrer, so an
    // untagged Instagram post is indistinguishable from direct traffic.
    // A tagged link is attributable even with the referrer stripped.
    const a = readAcquisition("", "https://elyad.io/?utm_source=instagram&utm_campaign=fight-night");
    expect(a.src).toBe("instagram");
    expect(a.utmCampaign).toBe("fight-night");
    // Honest about what the browser actually reported:
    expect(a.ref).toBe("");
    expect(a.refGroup).toBe("direct");
  });

  test("records the landing path but NOT the query string", () => {
    const a = readAcquisition("", "https://elyad.io/play?utm_source=x&secret=hunter2");
    expect(a.landing).toBe("/play");
    expect(JSON.stringify(a)).not.toContain("hunter2");
  });

  test("a malformed location keeps the referrer half rather than losing both", () => {
    const a = readAcquisition("https://t.co/abc", "::::not a url::::");
    expect(a.src).toBe("t.co");
    expect(a.refGroup).toBe("social");
    expect(a.landing).toBe("/");
  });
});
