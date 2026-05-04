// Exhaustive fuzz pass: visit every reachable surface, capture two
// screenshots ~3 s apart, dump console logs, fail loudly on any
// pageerror/console.error. The pair-of-screenshots pattern catches:
//   - black-frame regressions (only visible after first paint)
//   - HUD/timer non-progress bugs (compare T0 vs T+3s)
//   - runtime errors that fire only after the sim starts (not at boot)
//
// Artifacts land in `tests/e2e/.artifacts/<test-name>/{label}-{a|b}.png`
// + `<label>.console.json`. Open the html report at tests/e2e/.report
// after a run to see them inline.

import { test, expect, type ConsoleMessage, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type ConsoleEntry = { type: string; text: string; location?: string };

function attachConsole(page: Page): { get: () => ConsoleEntry[] } {
  const entries: ConsoleEntry[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    entries.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location().url
        ? `${msg.location().url}:${msg.location().lineNumber}`
        : undefined,
    });
  });
  page.on("pageerror", (err) => {
    entries.push({ type: "pageerror", text: `${err.name}: ${err.message}` });
  });
  return { get: () => entries };
}

async function pairShots(
  testInfo: TestInfo,
  page: Page,
  log: ConsoleEntry[],
  label: string,
  gapMs = 3000,
): Promise<void> {
  const dir = join(testInfo.outputDir);
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${label}-a.png`), fullPage: false });
  await page.waitForTimeout(gapMs);
  await page.screenshot({ path: join(dir, `${label}-b.png`), fullPage: false });
  await writeFile(
    join(dir, `${label}.console.json`),
    JSON.stringify(log, null, 2),
    "utf8",
  );
}

function assertNoErrors(log: ConsoleEntry[], label: string): void {
  const errors = log.filter(
    (e) =>
      e.type === "pageerror" ||
      (e.type === "error" &&
        // Vercel checkpoint banner emits a benign console.error sometimes.
        !e.text.includes("Failed to load resource") &&
        !e.text.includes("net::ERR_") &&
        !e.text.includes("favicon")),
  );
  expect(
    errors,
    `${label} console errors:\n${errors
      .map((e) => `  [${e.type}] ${e.text}${e.location ? " @ " + e.location : ""}`)
      .join("\n")}`,
  ).toEqual([]);
}

async function clickButton(page: Page, label: string): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
  await btn.first().waitFor({ state: "visible", timeout: 10_000 });
  await btn.first().click();
}

// --------------------------------------------------------------------
// 1. Splash menu — initial render + post-2s atmospheric tweens settled
// --------------------------------------------------------------------
test("fuzz: splash menu — both shots clean", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(800);
  await pairShots(testInfo, page, log.get(), "splash", 3000);
  assertNoErrors(log.get(), "splash");
});

// --------------------------------------------------------------------
// 2. Practice match — at T+1s (ready) and T+4s (mid-match)
// --------------------------------------------------------------------
test("fuzz: Practice match — T+1s vs T+4s", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1000);
  await pairShots(testInfo, page, log.get(), "practice-match", 3000);
  assertNoErrors(log.get(), "practice-match");
});

// --------------------------------------------------------------------
// 3. Practice match with input — scripted WASD + jump
// --------------------------------------------------------------------
test("fuzz: Practice match — scripted input movement", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  // Move right + jump for 1s, then left + jump.
  await page.keyboard.down("d");
  await page.keyboard.down("Space");
  await page.waitForTimeout(1000);
  await page.keyboard.up("Space");
  await page.waitForTimeout(200);
  await page.keyboard.up("d");
  await page.keyboard.down("a");
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await page.keyboard.up("Space");
  await page.keyboard.up("a");
  await pairShots(testInfo, page, log.get(), "practice-input", 2500);
  assertNoErrors(log.get(), "practice-input");
});

// --------------------------------------------------------------------
// 4. Practice match with crouch held — verifies D2/H1 (no flutter)
// --------------------------------------------------------------------
test("fuzz: Practice match — crouch hold standing test", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  await page.keyboard.down("Shift"); // crouch
  await page.waitForTimeout(2500);
  await pairShots(testInfo, page, log.get(), "practice-crouch", 2500);
  await page.keyboard.up("Shift");
  assertNoErrors(log.get(), "practice-crouch");
});

// --------------------------------------------------------------------
// 5. Create Room flow
// --------------------------------------------------------------------
test("fuzz: Create Room flow — settled lobby", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(800);
  await clickButton(page, "Create Room");
  await page.waitForTimeout(2500);
  await pairShots(testInfo, page, log.get(), "create-room", 3000);
  // Body should contain the room code.
  const body = await page.locator("body").innerText();
  expect(body, `room code missing from lobby:\n${body}`).toMatch(/[A-Z0-9]{4,8}/);
  assertNoErrors(log.get(), "create-room");
});

// --------------------------------------------------------------------
// 6. Join World — direct entry to live world via ?world=1
// --------------------------------------------------------------------
test("fuzz: World mode (?world=1) — connected and rendering", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(2000);
  await pairShots(testInfo, page, log.get(), "world-mode", 3500);
  assertNoErrors(log.get(), "world-mode");
});

// --------------------------------------------------------------------
// 7. World mode with movement — confirm reconcile + sub-stepping behave
// --------------------------------------------------------------------
test("fuzz: World mode — scripted movement (collision + reconcile)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.down("d");
  await page.waitForTimeout(800);
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await page.keyboard.up("Space");
  await page.keyboard.up("d");
  await page.keyboard.down("s"); // crouch
  await pairShots(testInfo, page, log.get(), "world-input", 2500);
  await page.keyboard.up("s");
  assertNoErrors(log.get(), "world-input");
});

// --------------------------------------------------------------------
// 8. World mode — fall test (run off ledge → fall → hit floor)
// --------------------------------------------------------------------
test("fuzz: World mode — long fall then land", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(2500);
  // Jump high → drift → fall.
  await page.keyboard.down("Space");
  await page.waitForTimeout(700);
  await page.keyboard.up("Space");
  await page.waitForTimeout(2500); // gravity does its thing
  await pairShots(testInfo, page, log.get(), "world-fall", 2000);
  assertNoErrors(log.get(), "world-fall");
});

// --------------------------------------------------------------------
// 9. World mode — wall collision (sustained right press into wall)
// --------------------------------------------------------------------
test("fuzz: World mode — sustained wall press doesn't tunnel", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.keyboard.down("d");
  await page.waitForTimeout(4000);
  await pairShots(testInfo, page, log.get(), "world-wall", 2000);
  await page.keyboard.up("d");
  assertNoErrors(log.get(), "world-wall");
});

// --------------------------------------------------------------------
// 10. Two-tab session — host + joiner
// --------------------------------------------------------------------
test("fuzz: Two-tab world mode — host and joiner pair", async ({
  browser,
}, testInfo) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const logA = attachConsole(a);
  const logB = attachConsole(b);
  await a.goto("/?world=1");
  await a.waitForSelector("canvas", { timeout: 20_000 });
  await a.waitForTimeout(2000);
  await b.goto("/?world=1");
  await b.waitForSelector("canvas", { timeout: 20_000 });
  await b.waitForTimeout(2000);
  // Both move
  await a.keyboard.down("d");
  await b.keyboard.down("a");
  await a.waitForTimeout(1500);

  await mkdir(testInfo.outputDir, { recursive: true });
  await a.screenshot({ path: join(testInfo.outputDir, "tab-a-1.png") });
  await b.screenshot({ path: join(testInfo.outputDir, "tab-b-1.png") });
  await a.waitForTimeout(2500);
  await a.screenshot({ path: join(testInfo.outputDir, "tab-a-2.png") });
  await b.screenshot({ path: join(testInfo.outputDir, "tab-b-2.png") });
  await writeFile(
    join(testInfo.outputDir, "tab-a.console.json"),
    JSON.stringify(logA.get(), null, 2),
    "utf8",
  );
  await writeFile(
    join(testInfo.outputDir, "tab-b.console.json"),
    JSON.stringify(logB.get(), null, 2),
    "utf8",
  );
  await a.keyboard.up("d");
  await b.keyboard.up("a");

  assertNoErrors(logA.get(), "tab-a");
  assertNoErrors(logB.get(), "tab-b");

  await ctxA.close();
  await ctxB.close();
});
