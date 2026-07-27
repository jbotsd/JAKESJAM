// Highlight camera (clip-goal CL.E) — the beat vocabulary, pinned.

import { describe, test, expect } from "bun:test";
import {
  HIGHLIGHT_BASE_ZOOM,
  SLOWMO_EXTRA_FRAMES,
  SLOWMO_SPAN_TICKS,
  killBeatEnvelope,
  makeHighlightCamState,
  resolveEngagedVictimId,
  slowMoTickRange,
  stepHighlightCamera,
} from "../highlightCamera.js";

const VIEW_W = 1920;
const VIEW_H = 1080;

function settle(
  star: { x: number; y: number },
  victim: { x: number; y: number } | null,
  punch = 0,
  finalPunch = false,
  frames = 240,
) {
  let s = makeHighlightCamState(star.x, star.y);
  for (let i = 0; i < frames; i++) {
    s = stepHighlightCamera(s, { star, victim, punch, finalPunch }, VIEW_W, VIEW_H);
  }
  return s;
}

describe("highlight camera (CL.E)", () => {
  test("B6 reproduced then pinned: star and one-screen-width victim BOTH project on screen", () => {
    // The studied baseline: star far left, kill landing ~1200px right —
    // victim clipped off-frame. The settled camera must keep both inside.
    const star = { x: 700, y: 900 };
    const victim = { x: 1900, y: 900 };
    const s = settle(star, victim);
    const halfW = VIEW_W / (2 * s.zoom);
    expect(Math.abs(star.x - s.x)).toBeLessThan(halfW);
    expect(Math.abs(victim.x - s.x)).toBeLessThan(halfW);
  });

  test("impossible separation: the star wins the frame", () => {
    const star = { x: 500, y: 900 };
    const victim = { x: 4000, y: 900 };
    const s = settle(star, victim);
    const halfW = VIEW_W / (2 * s.zoom);
    expect(Math.abs(star.x - s.x)).toBeLessThan(halfW);
  });

  test("vertical bias: an upper-platform victim re-frames the camera upward", () => {
    const star = { x: 1000, y: 950 };
    const solo = settle(star, null);
    const withHigh = settle(star, { x: 1250, y: 500 });
    expect(solo.y - withHigh.y).toBeGreaterThan(100); // moved ≥100px toward the victim
  });

  test("punch-in: kill beat raises zoom ≥1.12×; final kill ≥1.2×; returns to base", () => {
    const star = { x: 1000, y: 900 };
    const punched = settle(star, null, 1, false);
    expect(punched.zoom).toBeGreaterThanOrEqual(HIGHLIGHT_BASE_ZOOM * 1.12);
    const finalPunched = settle(star, null, 1, true);
    expect(finalPunched.zoom).toBeGreaterThanOrEqual(HIGHLIGHT_BASE_ZOOM * 1.2);
    const released = settle(star, null, 0, false);
    expect(released.zoom).toBeCloseTo(HIGHLIGHT_BASE_ZOOM, 1);
  });

  test("beat envelope: eases in within 300ms of the kill frame, gone by 1.5s", () => {
    const kills = [100];
    expect(killBeatEnvelope(99, kills).punch).toBe(0);
    expect(killBeatEnvelope(100 + 8, kills).punch).toBe(1); // <300ms after
    expect(killBeatEnvelope(100 + 44, kills).punch).toBe(0); // 1.47s after
    expect(killBeatEnvelope(100 + 8, kills).finalPunch).toBe(true); // only kill = final
    // Multi-kill: earlier kill is not final, last is.
    const multi = [50, 100];
    expect(killBeatEnvelope(58, multi).finalPunch).toBe(false);
    expect(killBeatEnvelope(108, multi).finalPunch).toBe(true);
  });

  test("NO CUTS: per-frame movement is bounded across a worst-case target jump", () => {
    const star = { x: 500, y: 900 };
    let s = makeHighlightCamState(star.x, star.y);
    // Teleport the target relationship wildly; the camera must chase, never jump.
    const far = { x: 2600, y: 300 };
    for (let i = 0; i < 120; i++) {
      const prev = s;
      s = stepHighlightCamera(
        s,
        { star: i < 60 ? star : far, victim: null, punch: 0, finalPunch: false },
        VIEW_W,
        VIEW_H,
      );
      const move = Math.hypot(s.x - prev.x, s.y - prev.y);
      expect(move).toBeLessThan(400); // < ~21% of a screen width per frame
      expect(Math.abs(s.zoom - prev.zoom)).toBeLessThan(0.2);
    }
  });

  test("slow-mo schedule: 30 ticks leading the final kill, +15 frames, clamped to the window", () => {
    const r = slowMoTickRange([90, 150], 210)!;
    expect(r.start).toBe(144); // last kill 150 − 6 lead
    expect(r.end).toBe(144 + SLOWMO_SPAN_TICKS);
    expect(SLOWMO_EXTRA_FRAMES).toBe(15);
    // Window shorter than the span: clamped, never past the end.
    const clamped = slowMoTickRange([200], 210)!;
    expect(clamped.end).toBe(210);
    expect(slowMoTickRange([], 210)).toBeNull();
  });

  // clip-goal STUDY 3, D1/CL.E: the old ReplayScene resolved "engaged
  // victim" by proximity ("nearest living opponent") — live verification
  // (a real human-credited kill re-rendered through the fixed pipeline)
  // found this locks onto the star ALONE for the whole clip whenever the
  // true victim is far away on screen, which is routine for a ranged
  // hitscan kill. resolveEngagedVictimId picks the credited kill's victim
  // BY IDENTITY instead of guessing.
  describe("resolveEngagedVictimId (STUDY 3 D1/CL.E)", () => {
    test("picks the nearest kill's victim by tick distance", () => {
      const killTicks = [90, 300];
      const killVictims = ["bot_a", "bot_b"];
      expect(resolveEngagedVictimId(85, killTicks, killVictims)).toBe("bot_a");
      expect(resolveEngagedVictimId(90, killTicks, killVictims)).toBe("bot_a");
      expect(resolveEngagedVictimId(195, killTicks, killVictims)).toBe("bot_a"); // exact tie (105 vs 105) — first wins
      expect(resolveEngagedVictimId(205, killTicks, killVictims)).toBe("bot_b"); // now bot_b is closer (95 vs 115)
      expect(resolveEngagedVictimId(300, killTicks, killVictims)).toBe("bot_b");
    });

    test("returns the victim regardless of distance from the star — the whole point", () => {
      // The exact reproduced bug: a real off-screen bystander victim (far
      // from the star) must still resolve by identity, not vanish because
      // a proximity search would never have found them.
      expect(resolveEngagedVictimId(90, [90], ["bot_piston_far_away"])).toBe("bot_piston_far_away");
    });

    test("no kill data (older job / realtime playback): returns null so the caller falls back", () => {
      expect(resolveEngagedVictimId(90, [], [])).toBeNull();
    });

    test("mismatched array lengths (malformed data): returns null rather than misreading", () => {
      expect(resolveEngagedVictimId(90, [90, 150], ["only_one"])).toBeNull();
    });
  });
});
