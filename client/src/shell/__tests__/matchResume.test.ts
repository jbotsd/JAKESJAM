// Doors 1.7 — refresh-mid-match recovery.
//
// The bug these guard: a reload during a match landed on the splash and
// forfeited the run, because nothing on the boot path tried to use the
// server's 10 s reconnect grace. The rules that matter are (a) resume only
// inside the window, and (b) NEVER resume after a deliberate exit.

import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearInMatch,
  noteInMatch,
  resumableMatch,
  startResumeHeartbeat,
  RESUME_WINDOW_MS,
  SERVER_RECONNECT_GRACE_MS,
} from "../matchResume.ts";

// Minimal sessionStorage stand-in — the module must not care which impl
// it gets, only that it round-trips strings and can throw.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = storage;

beforeEach(() => storage.clear());

describe("matchResume", () => {
  test("no marker means the normal splash path", () => {
    expect(resumableMatch(1_000_000)).toBeNull();
  });

  test("a fresh marker resumes the surface it recorded", () => {
    noteInMatch("arena", 1_000_000);
    expect(resumableMatch(1_000_000)).toBe("arena");
    noteInMatch("venue", 1_000_000);
    expect(resumableMatch(1_000_100)).toBe("venue");
  });

  test("resume expires at the window edge", () => {
    noteInMatch("arena", 1_000_000);
    expect(resumableMatch(1_000_000 + RESUME_WINDOW_MS)).toBe("arena");
    expect(resumableMatch(1_000_000 + RESUME_WINDOW_MS + 1)).toBeNull();
  });

  test("the resume window stays under the server's reconnect grace", () => {
    // If this ever inverts, the client would confidently try to resume a
    // run the server has already evicted — the player lands mid-fight as a
    // stranger instead of being told the honest thing.
    expect(RESUME_WINDOW_MS).toBeLessThan(SERVER_RECONNECT_GRACE_MS);
  });

  test("a deliberate exit is never resumed", () => {
    noteInMatch("arena", 1_000_000);
    clearInMatch();
    expect(resumableMatch(1_000_000)).toBeNull();
  });

  test("a backwards clock is not trusted", () => {
    // Suspend/resume or an NTP step can move the clock behind the mark.
    noteInMatch("arena", 1_000_000);
    expect(resumableMatch(999_000)).toBeNull();
  });

  test("a corrupt or foreign marker is ignored, not thrown on", () => {
    storage.setItem("jakesjam.inMatch", "not json");
    expect(resumableMatch(1_000_000)).toBeNull();
    storage.setItem("jakesjam.inMatch", JSON.stringify({ place: "moon", at: 1_000_000 }));
    expect(resumableMatch(1_000_000)).toBeNull();
    storage.setItem("jakesjam.inMatch", JSON.stringify({ place: "arena" }));
    expect(resumableMatch(1_000_000)).toBeNull();
  });

  test("the heartbeat marks immediately and stops cleanly", () => {
    const listeners: string[] = [];
    const scope = {
      addEventListener: ((type: string) => listeners.push(type)) as never,
      removeEventListener: ((type: string) => {
        const i = listeners.indexOf(type);
        if (i >= 0) listeners.splice(i, 1);
      }) as never,
    };
    const stop = startResumeHeartbeat("arena", scope);
    // Marked without waiting for the first interval — a reload one tick
    // after entering the arena must still resume.
    expect(resumableMatch()).toBe("arena");
    // pagehide covers the clean-reload case the interval would miss.
    expect(listeners).toContain("pagehide");
    stop();
    expect(listeners).not.toContain("pagehide");
  });
});
