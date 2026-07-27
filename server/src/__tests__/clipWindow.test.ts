// Clip trim discipline (clip-goal CL.C) — the window law, pinned.
//
// The studied baseline's worst frame was its LAST: a full-screen
// "ROUND 1 — TO BOT·GIZMO" banner over the star's 0-score roster. The
// invariant these tests enforce: a highlight window NEVER contains a
// round-over edge whose winner isn't the star, leads in ~1.5s before the
// first kill (not 9s of standing around), and holds ~2s after the last.

import { describe, test, expect } from "bun:test";
import {
  computeClipWindows,
  CLIP_PRE_TICKS,
  CLIP_POST_TICKS,
  CLIP_MAX_TICKS,
  type RoundMark,
} from "../clipWindow.ts";
import { MatchHost } from "../matchHost.ts";
import { PlayerId, type PlayerSpawnInfo, type RoundState } from "@sim/types.ts";

const kill = (tick: number, killerId = "p_star", victimId = "bot_x") => ({ tick, killerId, victimId });

describe("computeClipWindows (CL.C)", () => {
  test("single kill: IN = kill − PRE, OUT = kill + POST", () => {
    const [w] = computeClipWindows([kill(1000)], []);
    expect(w).toBeDefined();
    expect(w!.fromTick).toBe(1000 - CLIP_PRE_TICKS);
    expect(w!.fromTick + w!.ticks).toBe(1000 + CLIP_POST_TICKS);
    expect(w!.followId).toBe("p_star");
    expect(w!.killTicks).toEqual([CLIP_PRE_TICKS]);
  });

  test("STUDY 3 D1/CL.E: killVictims is parallel to killTicks (same length/order) so the render-side camera never has to guess", () => {
    const [w] = computeClipWindows([kill(1000, "p_star", "bot_piston")], []);
    expect(w!.killVictims).toEqual(["bot_piston"]);
    expect(w!.killVictims.length).toBe(w!.killTicks.length);
  });

  test("cluster: window spans first−PRE … last+POST; star = last kill's killer", () => {
    const kills = [kill(1000, "p_a", "bot_1"), kill(1200, "p_a", "bot_2"), kill(1400, "p_b", "bot_3")];
    const [w] = computeClipWindows(kills, []);
    expect(w!.fromTick).toBe(1000 - CLIP_PRE_TICKS);
    expect(w!.fromTick + w!.ticks).toBe(1400 + CLIP_POST_TICKS);
    expect(w!.followId).toBe("p_b");
    expect(w!.killTicks.length).toBe(3);
    expect(w!.killVictims).toEqual(["bot_1", "bot_2", "bot_3"]);
  });

  test("LAW: foreign round-over after the last kill shrinks the window", () => {
    const marks: RoundMark[] = [
      { tick: 1450, kind: "round-over", winnerId: "bot_gizmo" },
    ];
    const [w] = computeClipWindows([kill(1400)], marks);
    const out = w!.fromTick + w!.ticks;
    expect(out).toBeLessThan(1450); // banner never reaches the frame
    expect(out).toBeGreaterThan(1400); // but the kill impact still lands
  });

  test("the star's OWN round-over rides — victory banner is the beat", () => {
    const marks: RoundMark[] = [{ tick: 1450, kind: "round-over", winnerId: "p_star" }];
    const [w] = computeClipWindows([kill(1400)], marks);
    expect(w!.fromTick + w!.ticks).toBe(1400 + CLIP_POST_TICKS);
  });

  test("between-round chrome before the cluster: lead-in clamps to the fighting edge", () => {
    const marks: RoundMark[] = [
      { tick: 950, kind: "round-over", winnerId: "bot_x" },
      { tick: 990, kind: "fighting" },
    ];
    const [w] = computeClipWindows([kill(1010)], marks);
    expect(w!.fromTick).toBe(990); // not 1010−90=920 (inside the old round)
  });

  test("lead-in never precedes the fight the first kill belongs to", () => {
    const marks: RoundMark[] = [{ tick: 1000, kind: "fighting" }];
    const [w] = computeClipWindows([kill(1030)], marks);
    expect(w!.fromTick).toBe(1000);
  });

  test("length cap is END-anchored: sheds lead-up, keeps the biggest beat", () => {
    // One chained cluster (gaps ≤ MAX) whose total span exceeds the cap.
    const kills = [kill(1000), kill(1650), kill(2300)];
    const [w] = computeClipWindows(kills, []);
    const out = w!.fromTick + w!.ticks;
    expect(out).toBe(2300 + CLIP_POST_TICKS); // tail kept
    expect(w!.ticks).toBeLessThanOrEqual(CLIP_MAX_TICKS);
    // killTicks only lists kills INSIDE the window (1000 AND 1650 were
    // shed with the lead-up) and all are in-range relative offsets.
    expect(w!.killTicks.every((t) => t >= 0 && t < w!.ticks)).toBe(true);
    expect(w!.killTicks.length).toBe(1);
  });

  test("CL.C regression (STUDY 3, 2026-07-27): the END-anchored cap must not leave a huge dead lead-in before the SURVIVING first kill", () => {
    // Same sparse, widely-spread cluster as above. Before this fix, the raw
    // end-anchored cap alone left `from` far from the one kill that
    // actually survives inside the window — the window's OWN first visible
    // kill sat hundreds of ticks in with nothing happening before it
    // (`0e21238e`: ~6.8s of dead lead-in instead of the ~1.5s law). The
    // re-anchor step must tighten `from` so the surviving first kill sits
    // within CLIP_PRE_TICKS of the window start, same as any other window.
    const kills = [kill(1000), kill(1650), kill(2300)];
    const [w] = computeClipWindows(kills, []);
    expect(w!.killTicks.length).toBe(1);
    expect(w!.killTicks[0]).toBe(CLIP_PRE_TICKS);
    expect(w!.ticks).toBe(CLIP_PRE_TICKS + CLIP_POST_TICKS);
  });

  test("CL.C regression: re-anchoring never re-admits a kill the cap already shed, and never shrinks below what a single surviving kill needs", () => {
    // Four kills, one cluster (every gap ≤ CLIP_MAX_TICKS so they merge):
    // a tight early trio, then a lone kill 700 ticks later. After the cap
    // sheds the trio, re-anchoring must land on the LAST kill alone, not
    // accidentally resurrect any of the shed trio just because they're now
    // "close enough" to the new anchor.
    const kills = [kill(1000), kill(1050), kill(1100), kill(1800)];
    const [w] = computeClipWindows(kills, []);
    expect(w!.killTicks.length).toBe(1);
    expect(w!.killTicks[0]).toBe(CLIP_PRE_TICKS);
  });

  test("totalTicks clamps the tail (replay simply ends)", () => {
    const [w] = computeClipWindows([kill(1000)], [], { totalTicks: 1050 });
    expect(w!.fromTick + w!.ticks).toBe(1050);
  });

  test("distinct clusters produce distinct windows, capped by maxWindows", () => {
    const kills = [kill(1000), kill(5000), kill(9000), kill(13000)];
    const ws = computeClipWindows(kills, [], { maxWindows: 3 });
    expect(ws.length).toBe(3);
    expect(new Set(ws.map((w) => w.fromTick)).size).toBe(3);
  });

  test("PROPERTY: no window ever contains a foreign round-over tick", () => {
    // Sweep round-over positions across the whole window neighbourhood.
    for (let markTick = 900; markTick <= 1600; markTick += 7) {
      const marks: RoundMark[] = [
        { tick: markTick, kind: "round-over", winnerId: "bot_foreign" },
        { tick: markTick + 40, kind: "fighting" },
      ];
      const kills = [kill(1100), kill(1350)];
      // Kills only happen while fighting — skip mark positions that would
      // contradict that physical reality (inside the cluster span).
      if (markTick >= 1100 && markTick <= 1350) continue;
      for (const w of computeClipWindows(kills, marks)) {
        const inWindow = markTick >= w.fromTick && markTick < w.fromTick + w.ticks;
        expect(inWindow).toBe(false);
      }
    }
  });

  test("MatchHost records round marks at the real phase-edge site", () => {
    const spawn: PlayerSpawnInfo = {
      playerId: PlayerId("p_a"),
      characterId: "balanced",
      name: "A",
      color: "#fff",
      weaponId: "starter-pistol",
    };
    const host = new MatchHost("clipmarks", [spawn], [], "boxworks-mini");
    type Internals = {
      stop(): void;
      tick(): void;
      state: { round: RoundState; tick: number };
      roundMarks: RoundMark[];
    };
    const hi = host as unknown as Internals;
    hi.stop();
    // drafting (empty offers) → resolves → countdown: no mark for countdown.
    hi.state = {
      ...hi.state,
      round: { ...hi.state.round, phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} } as RoundState,
    };
    hi.tick();
    expect(hi.state.round.phase).toBe("countdown");
    // countdown expires → fighting: a "fighting" mark records.
    hi.state = {
      ...hi.state,
      round: { ...hi.state.round, countdownRemainingMs: 1 } as RoundState,
    };
    hi.tick();
    expect(hi.state.round.phase).toBe("fighting");
    const fighting = hi.roundMarks.find((m) => m.kind === "fighting");
    expect(fighting).toBeDefined();
    host.dispose();
  });

  test("no kills → no windows; a window that would lose its kill is dropped entirely", () => {
    expect(computeClipWindows([], [])).toEqual([]);
    // Foreign round-over immediately on the kill: clamping the banner out
    // would also clamp out the kill impact — no honest window remains, so
    // NOTHING renders (never a kill-less \"highlight\").
    const marks: RoundMark[] = [{ tick: 1001, kind: "round-over", winnerId: "bot_x" }];
    expect(computeClipWindows([kill(1000)], marks)).toEqual([]);
  });
});
