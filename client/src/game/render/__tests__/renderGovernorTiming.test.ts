// RenderGovernor trigger-timing tests (2026-07-27 lag/perf audit item 2 —
// "verify and retune RenderGovernor's rig-downgrade trigger"). Two halves:
//
//   1. `deriveGovernorTiming` — a pure function pulled out of the
//      constructor specifically so the numbers this pass retuned (ultra
//      tier's streak requirement) are asserted directly, not re-derived by
//      hand in the test.
//   2. A behavior test driving the REAL `RenderGovernor.update()` with
//      synthetic timestamps (no real clock, no rendering, no Phaser.Game —
//      a minimal mock satisfying only what `setRenderScaleRuntime` touches)
//      to confirm `deriveGovernorTiming`'s `worstCaseMsToRigDowngrade`
//      actually matches what the class does, end to end: N sustained-bad
//      checks step resolution down, then futility detection restores it
//      and fires the rig downgrade — exactly the mechanism whose timing
//      item 2 tunes for ultra.
//
// `telemetry.ts` is mocked here, DELIBERATELY, not out of caution but
// because running the real one leaks a cross-file side effect (confirmed
// by first trying it unmocked and watching an UNRELATED file go red): the
// real futility branch this test drives into calls the real `record()`,
// which schedules an async flush (`setTimeout`, 5s) whose `takeBatch()`
// calls `buildHash()`, which does `document.querySelector(...)` with no
// guard — fine in a real browser, but `bun test` has no DOM at all, so
// that deferred timer throws 5s later, mid-run, and bun:test blames
// whatever unrelated file happens to be executing at that moment. Mocked
// to harmless no-ops so nothing is scheduled in the first place.
//
// `qualityProfile.ts` is NOT mocked, on purpose, even though this test's
// futility branch calls its real, process-wide, ONE-WAY sticky
// `forceRigDowngrade()` (see that file's own docblock) — mocking it turned
// out to be the more fragile choice (Bun's `mock.module` intercepts by
// resolved path across every consumer in the process, including
// `qualityProfileRigDowngrade.test.ts`'s own direct import, producing
// confusing partial-mock behavior there instead of avoiding the shared
// state). Simpler and more predictable to let the real flag flip for
// real — `qualityProfileRigDowngrade.test.ts` was updated in this same
// pass to assert the order-independent invariant instead of an
// isolation assumption that was only ever true by accident.
//
// Environment note: `bun test` has no DOM (`window`/`document` are
// undefined). `getQualityProfile()` always resolves "standard" here — its
// own try/catch falls back to that tier the moment ANY of
// window/localStorage is missing, which is unconditionally true in this
// process (see qualityProfileRigDowngrade.test.ts's own module-singleton
// note). That's fine for this file: the behavior test below exercises the
// non-ultra (2-futile-step) path, which is just as real a path through the
// same code the ultra path shares — `deriveGovernorTiming`'s pure numbers
// are what actually prove the ultra retune, decoupled from tier detection.
import { describe, test, expect, beforeAll, mock } from "bun:test";
import Phaser from "phaser";
import { isRigDowngraded } from "../qualityProfile.ts";

mock.module("../../../telemetry.ts", () => ({
  crumb: () => {},
  record: () => {},
}));

const { RenderGovernor, deriveGovernorTiming } = await import("../renderGovernor.ts");
const { getRenderScale } = await import("../renderResolution.ts");

beforeAll(() => {
  // Only `backingSize()` (called from `setRenderScaleRuntime`) needs this —
  // tier resolution itself is unaffected either way (see file header note).
  (globalThis as unknown as { window: unknown }).window = {
    innerWidth: 1920,
    innerHeight: 1080,
    location: { search: "" },
  };
});

function makeMockGame(): Phaser.Game {
  return {
    scale: { setZoom: () => {}, resize: () => {} },
    canvas: undefined,
  } as unknown as Phaser.Game;
}

describe("deriveGovernorTiming — the numbers item 2 retuned", () => {
  test("ultra tier: 2026-07-27 retune is 2x the base streak, not the old 3x", () => {
    const t = deriveGovernorTiming("ultra", 0);
    expect(t.downStreakNeeded).toBe(6); // DOWN_STREAK(3) * ULTRA_DOWN_STREAK_MULT(2)
    expect(t.futileStepsToRestore).toBe(1);
    // (6 * 1 + 1) checks * 2000ms/check = 14000ms, down from the old 3x's
    // (9 * 1 + 1) * 2000 = 20000ms — a real ~30% cut, not a blind guess.
    expect(t.worstCaseMsToRigDowngrade).toBe(14_000);
  });

  test("non-ultra tiers are untouched by the ultra-specific retune", () => {
    const standard = deriveGovernorTiming("standard", 0);
    expect(standard.downStreakNeeded).toBe(3);
    expect(standard.futileStepsToRestore).toBe(2);
    expect(standard.worstCaseMsToRigDowngrade).toBe(14_000); // (3*2+1)*2000

    const phone = deriveGovernorTiming("phone", 60);
    expect(phone.downStreakNeeded).toBe(3);
    expect(phone.futileStepsToRestore).toBe(2);
    expect(phone.targetDtMs).toBeCloseTo(1000 / 60, 5);

    const potato = deriveGovernorTiming("potato", 30);
    expect(potato.downStreakNeeded).toBe(3);
    expect(potato.floor).toBeCloseTo(0.35, 5); // FLOOR_POTATO, not the shared 0.5 FLOOR
  });
});

describe("RenderGovernor.update() — real class, synthetic clock, sustained bad dt", () => {
  test("steps resolution down `downStreakNeeded` checks apart, then restores + logs the rig-downgrade signal at exactly the predicted check", () => {
    const timing = deriveGovernorTiming("standard", 0); // matches this env's resolved tier
    const game = makeMockGame();
    const governor = new RenderGovernor(game);

    const startScale = getRenderScale();
    const BAD_DT = 30; // ms — inside the 24-37ms range the real 2026-07-11 4080 log showed
    const CHECK_MS = 2_000;

    const scaleReadingsAfterEachCheck: number[] = [];
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    const totalChecks = timing.downStreakNeeded * timing.futileStepsToRestore + 1;
    try {
      for (let i = 0; i < totalChecks; i++) {
        governor.update(i * CHECK_MS, BAD_DT);
        scaleReadingsAfterEachCheck.push(getRenderScale());
      }
    } finally {
      console.log = originalLog;
    }

    // First downStreakNeeded checks: no change until the last one of that
    // run, which steps resolution DOWN for the first time.
    for (let i = 0; i < timing.downStreakNeeded - 1; i++) {
      expect(scaleReadingsAfterEachCheck[i]).toBe(startScale);
    }
    const afterFirstStep = scaleReadingsAfterEachCheck[timing.downStreakNeeded - 1]!;
    expect(afterFirstStep).toBeLessThan(startScale);

    // The LAST check (index totalChecks-1, the one `worstCaseMsToRigDowngrade`
    // predicts) is where futility is detected on the final futile step and
    // the governor restores resolution + fires the rig-downgrade signal —
    // never before it.
    const finalScale = scaleReadingsAfterEachCheck[totalChecks - 1]!;
    expect(finalScale).toBeGreaterThan(afterFirstStep);
    const restoreLoggedBefore = logs.some((l) => l.includes("resolution-insensitive"));
    expect(logs.some((l) => l.includes("resolution-insensitive"))).toBe(true);
    // Real, process-wide, one-way flag (see this file's header note) — this
    // is the one place in the whole run that's allowed to flip it true.
    expect(isRigDowngraded()).toBe(true);

    // Re-run the same sequence but stop one check short of the predicted
    // total — the restore/rig-downgrade log must NOT have fired yet. Fresh
    // governor instance (the class has no reset method, by design).
    const earlyGame = makeMockGame();
    const earlyGovernor = new RenderGovernor(earlyGame);
    const earlyLogs: string[] = [];
    console.log = (...args: unknown[]) => {
      earlyLogs.push(args.map(String).join(" "));
    };
    try {
      for (let i = 0; i < totalChecks - 1; i++) {
        earlyGovernor.update(i * CHECK_MS, BAD_DT);
      }
    } finally {
      console.log = originalLog;
    }
    expect(earlyLogs.some((l) => l.includes("resolution-insensitive"))).toBe(false);
    expect(restoreLoggedBefore).toBe(true); // sanity: the earlier assertion actually ran
  });
});
