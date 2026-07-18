import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { persistReplay } from "../replayStore.ts";

describe("test isolation (2026-07-18, perf audit N5 fallout)", () => {
  test("JAKESJAM_REPLAYS_DIR is set to a throwaway dir, not the real server/.replays", () => {
    // Set by server/bunfig.toml's [test] preload (replaysDirIsolation.ts),
    // which MUST run before this module (and replayStore.ts) is ever
    // imported. If this is unset, every persist in this file just wrote
    // into the real production replay store again.
    const dir = process.env.JAKESJAM_REPLAYS_DIR;
    expect(dir).toBeTruthy();
    expect(dir).not.toBe(resolve(process.cwd(), ".replays"));
  });

  test("a persist in this suite never lands in the real server/.replays", () => {
    const before = existsSync("./.replays")
      ? new Set(readdirSync("./.replays"))
      : new Set<string>();
    const path = persistReplay("isolation-canary", new TextEncoder().encode("fake replay bytes"));
    expect(path).not.toBeNull();
    const after = existsSync("./.replays") ? new Set(readdirSync("./.replays")) : new Set<string>();
    expect([...after].filter((f) => !before.has(f))).toEqual([]);
  });
});

describe("persistReplay", () => {
  test("writes bytes to a file and returns the path", () => {
    const path = persistReplay("some-match", new TextEncoder().encode("hello replay"));
    expect(path).not.toBeNull();
    expect(path!.endsWith(".jjr")).toBe(true);
  });

  test("sanitizes matchId for filesystem safety", () => {
    const path = persistReplay("../../etc/passwd", new TextEncoder().encode("x"));
    expect(path).not.toBeNull();
    expect(path).not.toContain("..");
  });
});
