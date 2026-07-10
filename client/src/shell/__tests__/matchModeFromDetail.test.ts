import { describe, expect, test } from "bun:test";
import {
  createShellState,
  shellSetMatchMode,
  shellVisibility,
  shellTogglePause,
} from "../placeMachine.js";

/** Mirrors main.ts start-match mode resolution (keep in sync). */
function resolveMatchMode(detail: { mode?: string; matchId?: string } | undefined): "practice" | "world" | "private" {
  const detailMode = detail?.mode;
  if (detailMode === "practice") return "practice";
  if (detailMode === "world") return "world";
  if (detail?.matchId) return "private";
  return "private";
}

describe("matchMode from start-match detail", () => {
  test("practice detail resolves to practice and enables pause", () => {
    const mode = resolveMatchMode({ mode: "practice", localPlayerId: "x" } as { mode?: string });
    expect(mode).toBe("practice");
    let s = shellSetMatchMode(createShellState(), mode);
    expect(s.matchMode).toBe("practice");
    s = shellTogglePause(s);
    expect(shellVisibility(s).pause).toBe(true);
  });

  test("missing mode with matchId is private", () => {
    expect(resolveMatchMode({ matchId: "m1" })).toBe("private");
  });

  test("world mode explicit", () => {
    expect(resolveMatchMode({ mode: "world" })).toBe("world");
  });
});
