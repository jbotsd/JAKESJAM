// V2 gate — proves window.__simStateHash / __simStepNo / __simHasState
// are wired up. Without this gate the V1, V3, V6 evidence suites would
// silently degrade to "always null" and we'd never notice.
//
// The probe is a SCENE-OWNED getter: globals exist after main.ts boots
// (installWindowProbe runs unconditionally), but they only return
// meaningful values once a match scene is live and has registered its
// state getter. So we click into Practice → wait for a sim tick → read.
//
// We use ?netcode=new because the wasm-driven scene is OnlineMatchScene
// which is the substrate the V phase suite verifies. The Practice scene
// in offline mode does not own a WorldState in the new-netcode sense.

import { test, expect } from "@playwright/test";

test("window.__simStateHash and __simStepNo install at boot", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });

  const probeShape = await page.evaluate(() => ({
    hashIsFn: typeof (window as unknown as { __simStateHash?: unknown }).__simStateHash === "function",
    stepIsFn: typeof (window as unknown as { __simStepNo?: unknown }).__simStepNo === "function",
    hasStateIsFn: typeof (window as unknown as { __simHasState?: unknown }).__simHasState === "function",
    sampleIsFn: typeof (window as unknown as { __simSampleHashes?: unknown }).__simSampleHashes === "function",
  }));

  expect(probeShape).toEqual({
    hashIsFn: true,
    stepIsFn: true,
    hasStateIsFn: true,
    sampleIsFn: true,
  });

  // No scene owns state yet → all reads are null/false.
  const preMatch = await page.evaluate(() => ({
    hash: (window as unknown as { __simStateHash: () => number | null }).__simStateHash(),
    step: (window as unknown as { __simStepNo: () => number | null }).__simStepNo(),
    has: (window as unknown as { __simHasState: () => boolean }).__simHasState(),
  }));

  expect(preMatch.hash).toBeNull();
  expect(preMatch.step).toBeNull();
  expect(preMatch.has).toBe(false);
});
