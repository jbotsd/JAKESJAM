import { describe, expect, test } from "bun:test";
import { ClipSession } from "../clipSession.js";

describe("ClipSession", () => {
  test("adds entries newest-first", () => {
    const s = new ClipSession(10);
    s.add({ url: "/a.webm", kind: "vertical", atMs: 1 });
    s.add({ url: "/b.webm", kind: "vertical", atMs: 2 });
    expect(s.list().map((e) => e.url)).toEqual(["/b.webm", "/a.webm"]);
  });

  test("caps list length by max", () => {
    const s = new ClipSession(3);
    for (let i = 0; i < 5; i++) {
      s.add({ url: `/${i}.webm`, kind: "vertical", atMs: i });
    }
    expect(s.list().length).toBe(3);
    expect(s.list()[0]!.url).toBe("/4.webm");
  });

  test("pairs vertical + original by pairId", () => {
    const s = new ClipSession();
    s.add({ url: "/v.webm", kind: "vertical", pairId: "p1", label: "Multi-kill" });
    s.add({ url: "/o.webm", kind: "original", pairId: "p1" });
    const pairs = s.pairs();
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.vertical?.url).toBe("/v.webm");
    expect(pairs[0]!.original?.url).toBe("/o.webm");
    expect(pairs[0]!.label).toBe("Multi-kill");
  });

  test("primaryShareUrl prefers vertical", () => {
    const s = new ClipSession();
    s.add({ url: "/o.webm", kind: "original", pairId: "x" });
    s.add({ url: "/v.webm", kind: "vertical", pairId: "x" });
    expect(s.primaryShareUrl()).toBe("/v.webm");
  });

  test("empty primaryShareUrl is null", () => {
    expect(new ClipSession().primaryShareUrl()).toBeNull();
  });
});
