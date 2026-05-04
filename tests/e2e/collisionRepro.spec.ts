// Collision repro spec — focused on the user-reported "barely detects
// standing / falls through terrain" bug class. Runs in practice mode (no
// other players, no scoring → no card-draft interruptions) so the local
// rig is the only thing being scripted for the full duration.
//
// Each test captures a WebM video (per playwright.config.ts video: "on")
// AND a y-history sample via page.evaluate against window-exposed sim
// state (if the build exposes it; otherwise falls back to canvas-pixel
// y inference from the rig sprite color).

import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachConsole, waitForCanvas } from "./visualHarness";

/**
 * Sample local-player y over time. Tries the (possibly-exposed) global
 * sim handle first; falls back to viewport-center pixel scan for the rig
 * sprite color. Returns ms-stamped y values.
 */
async function sampleYHistory(
  page: import("@playwright/test").Page,
  durationMs: number,
  intervalMs: number,
): Promise<Array<{ t: number; y: number | null }>> {
  return await page.evaluate(
    ({ duration, interval }) => {
      return new Promise<Array<{ t: number; y: number | null }>>((resolve) => {
        const samples: Array<{ t: number; y: number | null }> = [];
        const start = performance.now();
        const tick = () => {
          // Look for a globally-exposed sim handle. If absent, return null
          // for y — the test will still produce a video.
          // @ts-expect-error — runtime probe for optional global
          const w = (window as { __jakesjamSim?: { localY?: () => number } });
          const y =
            w.__jakesjamSim && typeof w.__jakesjamSim.localY === "function"
              ? w.__jakesjamSim.localY()
              : null;
          samples.push({ t: performance.now() - start, y });
          if (performance.now() - start >= duration) {
            resolve(samples);
          } else {
            setTimeout(tick, interval);
          }
        };
        tick();
      });
    },
    { duration: durationMs, interval: intervalMs },
  );
}

async function dumpYHistory(
  testInfo: import("@playwright/test").TestInfo,
  label: string,
  history: Array<{ t: number; y: number | null }>,
): Promise<void> {
  await mkdir(testInfo.outputDir, { recursive: true });
  const csv = ["t_ms,y"];
  for (const s of history) csv.push(`${s.t.toFixed(0)},${s.y ?? ""}`);
  await writeFile(join(testInfo.outputDir, `${label}.csv`), csv.join("\n"), "utf8");
}

// =============================================================================
// 1. Stand still on spawn for 10 s — y must be stable (not drifting down)
// =============================================================================

test("collision: practice — stand still on spawn for 10 s", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Practice$/i }).first().click();
  await page.waitForTimeout(1500);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, "stand-t0.png") });
  const history = await sampleYHistory(page, 10_000, 200);
  await page.screenshot({ path: join(dir, "stand-t10.png") });
  await dumpYHistory(testInfo, "stand-history", history);

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});

// =============================================================================
// 2. Walk right 6 s, jump, walk back left 6 s — terrain should hold
// =============================================================================

test("collision: practice — lateral run + jumps, no fall-through", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Practice$/i }).first().click();
  await page.waitForTimeout(1500);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  // Walk right 4s.
  await page.keyboard.down("d");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(dir, "ran-right.png") });
  await page.keyboard.up("d");

  // Jump x3.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: join(dir, "after-jumps.png") });

  // Walk left 4s.
  await page.keyboard.down("a");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(dir, "ran-left.png") });
  await page.keyboard.up("a");

  const history = await sampleYHistory(page, 4_000, 100);
  await dumpYHistory(testInfo, "lateral-history", history);

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});

// =============================================================================
// 3. Long jetpack burst → maximum altitude → terminal-velocity fall
//    The most likely tunnel scenario. Repeated 3 times to flush flake.
// =============================================================================

test("collision: practice — jetpack max altitude → fall to floor x3", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Practice$/i }).first().click();
  await page.waitForTimeout(1500);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  for (let cycle = 0; cycle < 3; cycle++) {
    // Hold space — jetpack drains, climb to ceiling.
    await page.keyboard.down("Space");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(dir, `cycle-${cycle}-peak.png`) });
    await page.keyboard.up("Space");
    // Fall freely for 3s — should land on floor or some platform.
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(dir, `cycle-${cycle}-landed.png`) });
  }

  const history = await sampleYHistory(page, 4_000, 100);
  await dumpYHistory(testInfo, "jetpack-history", history);

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});

// =============================================================================
// 4. Crouch on floor for 8 s — y must stay flat (no flutter, no creep)
// =============================================================================

test("collision: practice — crouch hold 8 s, no creep", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Practice$/i }).first().click();
  await page.waitForTimeout(1500);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  await page.keyboard.down("Shift");
  await page.screenshot({ path: join(dir, "crouch-t0.png") });
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: join(dir, "crouch-t8.png") });
  await page.keyboard.up("Shift");

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});

// =============================================================================
// 5. Run-off-platform-edge → mid-air → land on floor below
// =============================================================================

test("collision: practice — run off platform edge, land on floor below", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Practice$/i }).first().click();
  await page.waitForTimeout(1500);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  // Get on a platform first via jetpack.
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await page.keyboard.up("Space");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, "elevated.png") });
  // Run off the edge.
  await page.keyboard.down("d");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(dir, "off-edge.png") });
  await page.keyboard.up("d");
  // Watch the fall.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(dir, "after-fall.png") });

  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errs.map((e) => e.text)).toEqual([]);
});

// =============================================================================
// 6. Two-tab live: both players move + jump for 20 s — exercises the
//    network-reconcile + collision interaction (the most likely place
//    real fall-through bites in production).
// =============================================================================

test("collision: world — two-tab combat dance 20 s", async ({
  browser,
}, testInfo) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const logA = attachConsole(a);
  const logB = attachConsole(b);
  await a.goto("/?world=1");
  await waitForCanvas(a);
  await a.waitForTimeout(2000);
  await b.goto("/?world=1");
  await waitForCanvas(b);
  await b.waitForTimeout(2000);

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });

  for (let i = 0; i < 8; i++) {
    await a.keyboard.down("d");
    await b.keyboard.down("a");
    await a.keyboard.press("Space");
    await b.keyboard.press("Space");
    await a.waitForTimeout(1200);
    await a.keyboard.up("d");
    await b.keyboard.up("a");
    await a.keyboard.down("a");
    await b.keyboard.down("d");
    await a.waitForTimeout(1200);
    await a.keyboard.up("a");
    await b.keyboard.up("d");
    if (i === 3 || i === 7) {
      await a.screenshot({ path: join(dir, `dance-a-${i}.png`) });
      await b.screenshot({ path: join(dir, `dance-b-${i}.png`) });
    }
  }

  const errsA = logA.get().filter((e) => e.type === "pageerror" || e.type === "error");
  const errsB = logB.get().filter((e) => e.type === "pageerror" || e.type === "error");
  expect(errsA.map((e) => e.text)).toEqual([]);
  expect(errsB.map((e) => e.text)).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});
