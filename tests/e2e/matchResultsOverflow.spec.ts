// clusterA-05 (docs/mobile-experience.md, "QA sweep (2026-07-28, wave 1)" →
// "Left for wave 2"): the class-tag chip added 2026-07-27 (bd6b51f,
// MatchResultsOverlay.ts / matchResultsClassTag.ts) genuinely overflows a
// 393px-wide row when paired with a long callsign — the 2026-07-09 sweep
// only ever fixed the STAGE's own min-width (see mobile-experience.md), it
// never gave the ROW's name column a shrink/truncate story, and the chip
// regressed that.
//
// This is a REAL-BROWSER measurement test (not bun:test — bun:test has no
// layout engine, see playerStats.test.ts's "bun:test provides a
// happy-dom-less environment" comment; getBoundingClientRect needs actual
// CSS layout). It follows the same "direct-import overlay check" convention
// wave 1's own fix pass used for CardDraftOverlay (checkTimerBar.ts/
// checkHorizScroll.ts, both thrown away per that commit's own message) —
// except this one is committed, since wave 2 was asked for a persisted
// measurement test rather than a throwaway one. It boots its own throwaway
// vite dev server (never touches the shared :8088 world server, never
// touches the committed dist/ this house's live funnel actually serves) so
// it can run in total isolation from the rest of the e2e suite's baseURL
// convention (prod jakesjam.vercel.app).
//
// Run: bunx playwright test tests/e2e/matchResultsOverflow.spec.ts --reporter=list

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Root package.json is "type": "module" — no __dirname in ESM scope.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(__dirname, "..", "..", "client");
// Distinct from the app's normal dev port (5173) so this never collides with
// a real dev server someone already has running locally.
const PORT = 5183;
const BASE = `http://127.0.0.1:${PORT}`;
const HARNESS_URL = `${BASE}/src/game/ui/__tests__/matchResultsOverflowHarness.html`;

let viteProcess: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite dev server never came up at ${url}: ${String(lastErr)}`);
}

test.beforeAll(async () => {
  viteProcess = spawn(
    "bunx",
    ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: CLIENT_DIR, stdio: "pipe" },
  );
  await waitForServer(HARNESS_URL, 30_000);
});

test.afterAll(() => {
  viteProcess?.kill();
});

test("MatchResultsOverlay: long callsign + class-tag chip stay inside the 393px row", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true);
  expect(pageErrors, `harness page errors:\n${pageErrors.join("\n")}`).toEqual([]);

  const rowSel = '[data-match-results-row="p1"]';
  await page.waitForSelector(rowSel, { state: "visible" });

  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, "clusterA-05-long-callsign-393x852.png") });

  const measurements = await page.evaluate((sel) => {
    const row = document.querySelector<HTMLElement>(sel)!;
    const header = row.querySelector<HTMLElement>("[data-match-results-header]")!;
    const nameRow = row.querySelector<HTMLElement>("[data-match-results-name-row]")!;
    const nameEl = row.querySelector<HTMLElement>("[data-match-results-name]")!;
    const scoreEl = row.querySelector<HTMLElement>("[data-match-results-score]")!;
    const rowRect = row.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const nameRowRect = nameRow.getBoundingClientRect();
    const nameRect = nameEl.getBoundingClientRect();
    const scoreRect = scoreEl.getBoundingClientRect();
    const nameStyle = getComputedStyle(nameEl);
    return {
      viewportWidth: window.innerWidth,
      rowRight: rowRect.right,
      rowWidth: rowRect.width,
      headerRight: headerRect.right,
      nameRowRight: nameRowRect.right,
      nameRight: nameRect.right,
      scoreLeft: scoreRect.left,
      scoreRight: scoreRect.right,
      nameScrollWidth: nameEl.scrollWidth,
      nameClientWidth: nameEl.clientWidth,
      nameTextOverflow: nameStyle.textOverflow,
      nameWhiteSpace: nameStyle.whiteSpace,
      nameOverflow: nameStyle.overflow,
    };
  }, rowSel);

  // 1. Nothing in the row spills past the 393px viewport — the literal
  //    overflow the finding reports.
  expect(
    measurements.rowRight,
    `row right edge ${measurements.rowRight} exceeds the 393px viewport`,
  ).toBeLessThanOrEqual(measurements.viewportWidth + 0.5);
  expect(measurements.headerRight).toBeLessThanOrEqual(measurements.viewportWidth + 0.5);
  expect(measurements.nameRowRight).toBeLessThanOrEqual(measurements.viewportWidth + 0.5);
  expect(measurements.nameRight).toBeLessThanOrEqual(measurements.viewportWidth + 0.5);

  // 2. The name column never pushes into/past the score — the two pieces of
  //    information this row exists to show both stay legible.
  expect(
    measurements.nameRight,
    `name element (right=${measurements.nameRight}) overlaps the score (left=${measurements.scoreLeft})`,
  ).toBeLessThanOrEqual(measurements.scoreLeft + 0.5);

  // 3. The fix mechanism is actually engaged, not just "happens to fit this
  //    once": the long callsign's full text is WIDER than the box it's
  //    rendered in (scrollWidth > clientWidth) confirms ellipsis truncation
  //    genuinely kicked in — a name short enough to fit would show
  //    scrollWidth === clientWidth and this assertion would rightly fail,
  //    which is the point (proves the fixture's long name is actually
  //    exercising the clamp, not coincidentally fitting).
  expect(
    measurements.nameScrollWidth,
    `expected the long callsign to overflow its own box (scrollWidth ${measurements.nameScrollWidth} vs clientWidth ${measurements.nameClientWidth}) — otherwise this test isn't exercising truncation at all`,
  ).toBeGreaterThan(measurements.nameClientWidth);
  expect(measurements.nameTextOverflow).toBe("ellipsis");
  expect(measurements.nameWhiteSpace).toBe("nowrap");
  expect(measurements.nameOverflow).toBe("hidden");

  await context.close();
});
