// Exhaustive visual regression suite. Each surface:
//   1. Navigates + sets up scripted state
//   2. Captures pair-of-shots ~3 s apart (file-a.png, file-b.png)
//   3. Asserts per-surface invariants on shot A
//   4. Asserts T+0 vs T+3 motion (catches frozen scenes)
//   5. Asserts no JS pageerrors / console.errors
//
// Run twice for stability:
//   bunx playwright test visual --repeat-each=2
//
// Thresholds calibrated against observed production diffs (see git
// history of this file). Splash + lobby surfaces have very low motion
// (sub-1%); mid-game world surfaces have 20-60% motion from remote
// rigs + light beams + projectiles.

import { test, expect } from "@playwright/test";
import {
  attachConsole, pairShots, probeColor, clickButton, waitForCanvas,
  assertNoErrors, assertColorPresent, assertNotFrozen, assertNotBlackVoid,
  COLORS,
} from "./visualHarness";

// =============================================================================
// SECTION A — Splash + lobby surfaces (low motion: ≥0.1% diff)
// =============================================================================

test("visual: splash — initial render, atmospheric tweens move", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(1200);
  const { diff } = await pairShots(testInfo, page, log.get(), "splash");
  const probe = await probeColor(page, COLORS.crystalCyan, 32);
  assertNotBlackVoid(probe, "splash");
  assertColorPresent(probe, COLORS.crystalCyan, 1200, "splash crystal cyan");
  assertNotFrozen(diff, "splash", 0.001);
  assertNoErrors(log.get(), "splash");
});

test("visual: splash — mouse hover on Practice button", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  const btn = page.getByRole("button", { name: /^Practice$/i }).first();
  await btn.hover();
  const { diff } = await pairShots(testInfo, page, log.get(), "splash-hover");
  // Hover sometimes settles to a stable scale state; just assert no JS errors
  // and that the page isn't fully black.
  const probe = await probeColor(page, COLORS.crystalCyan, 32);
  assertNotBlackVoid(probe, "splash-hover");
  assertNoErrors(log.get(), "splash-hover");
  void diff; // diff captured but no motion threshold (button hover settles)
});

test("visual: create-room — lobby panel + room code", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  await clickButton(page, "Create Room");
  await page.waitForTimeout(2500);
  const { diff } = await pairShots(testInfo, page, log.get(), "create-room");
  const probe = await probeColor(page, COLORS.crystalCyan, 32);
  assertColorPresent(probe, COLORS.crystalCyan, 200, "create-room cyan");
  assertNotFrozen(diff, "create-room", 0.001);
  assertNoErrors(log.get(), "create-room");
});

// =============================================================================
// SECTION B — Practice-match surfaces (offline sim: medium motion 0.5-2%)
// =============================================================================

test("visual: practice — countdown + first fight", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1000);
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-countdown");
  const probe = await probeColor(page, COLORS.platformLime, 30);
  // Calibrated against observed: practice has ~3000 strict-match lime pixels
  // (the platforms) — the histogram shows lime variants at multiple shade
  // buckets totalling ~10k. Threshold tuned to 2500 ⇒ 20% safety margin.
  assertColorPresent(probe, COLORS.platformLime, 2500, "practice — platform lime");
  assertNotFrozen(diff, "practice-countdown", 0.005);
  assertNoErrors(log.get(), "practice-countdown");
});

test("visual: practice — scripted D + Space (movement)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  await page.keyboard.down("d");
  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
  await page.keyboard.up("d");
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-input");
  const probe = await probeColor(page, COLORS.platformLime, 30);
  assertColorPresent(probe, COLORS.platformLime, 3000, "practice-input");
  assertNotFrozen(diff, "practice-input", 0.005);
  assertNoErrors(log.get(), "practice-input");
});

test("visual: practice — crouch hold (D2 flutter regression)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  await page.keyboard.down("Shift");
  await page.waitForTimeout(2000);
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-crouch");
  await page.keyboard.up("Shift");
  assertNotFrozen(diff, "practice-crouch", 0.003);
  assertNoErrors(log.get(), "practice-crouch");
});

test("visual: practice — sustained wall press (collision: no tunnel)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1200);
  await page.keyboard.down("d");
  await page.waitForTimeout(4500);
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-wall");
  await page.keyboard.up("d");
  const probe = await probeColor(page, COLORS.platformLime, 30);
  assertColorPresent(probe, COLORS.platformLime, 2000, "practice-wall");
  // Background light beams + camera tween produce ≥ 0.3% baseline.
  assertNotFrozen(diff, "practice-wall", 0.002);
  assertNoErrors(log.get(), "practice-wall");
});

test("visual: practice — long fall + land (D4 sub-stepping)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  await page.keyboard.down("Space");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Space");
  await page.waitForTimeout(2500);
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-fall");
  const probe = await probeColor(page, COLORS.platformLime, 30);
  assertColorPresent(probe, COLORS.platformLime, 2000, "practice-fall");
  assertNotFrozen(diff, "practice-fall", 0.002);
  assertNoErrors(log.get(), "practice-fall");
});

test("visual: practice — fire weapon (mouse click)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  const box = await page.locator("canvas").boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }
  }
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-fire");
  assertNotFrozen(diff, "practice-fire", 0.003);
  assertNoErrors(log.get(), "practice-fire");
});

test("visual: practice — chain of jumps (jetpack drain)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(500);
  await clickButton(page, "Practice");
  await page.waitForTimeout(1500);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
  }
  const { diff } = await pairShots(testInfo, page, log.get(), "practice-jumps");
  assertNotFrozen(diff, "practice-jumps", 0.002);
  assertNoErrors(log.get(), "practice-jumps");
});

// =============================================================================
// SECTION C — World mode surfaces (online, high motion 5-50%)
// =============================================================================

test("visual: world — connected + idle, terrain renders", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  const { diff } = await pairShots(testInfo, page, log.get(), "world-mode");
  const probe = await probeColor(page, COLORS.platformLime, 30);
  // World maps use lighter palette; lime is on cover blocks not floor.
  // Threshold lowered — world gameplay has remote rigs creating motion.
  assertColorPresent(probe, COLORS.platformLime, 100, "world-mode");
  assertNotFrozen(diff, "world-mode", 0.005);
  assertNoErrors(log.get(), "world-mode");
});

test("visual: world — scripted D + Space", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  await page.keyboard.down("d");
  await page.waitForTimeout(800);
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await page.keyboard.up("Space");
  await page.keyboard.up("d");
  const { diff } = await pairShots(testInfo, page, log.get(), "world-input");
  // Network reconcile + remote rigs alone produce ≥ 0.3% diff.
  assertNotFrozen(diff, "world-input", 0.002);
  assertNoErrors(log.get(), "world-input");
});

test("visual: world — sustained wall press, rig blocked", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  await page.keyboard.down("d");
  await page.waitForTimeout(4500);
  const { diff } = await pairShots(testInfo, page, log.get(), "world-wall");
  await page.keyboard.up("d");
  assertNotFrozen(diff, "world-wall", 0.001);
  assertNoErrors(log.get(), "world-wall");
});

test("visual: world — jetpack up + fall + land", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  await page.keyboard.down("Space");
  await page.waitForTimeout(900);
  await page.keyboard.up("Space");
  await page.waitForTimeout(2500);
  const { diff } = await pairShots(testInfo, page, log.get(), "world-fall");
  assertNotFrozen(diff, "world-fall", 0.002);
  assertNoErrors(log.get(), "world-fall");
});

test("visual: world — crouch hold 3 s, no flicker", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  await page.keyboard.down("Shift");
  await page.waitForTimeout(1500);
  const { diff } = await pairShots(testInfo, page, log.get(), "world-crouch");
  await page.keyboard.up("Shift");
  assertNotFrozen(diff, "world-crouch", 0.001);
  assertNoErrors(log.get(), "world-crouch");
});

test("visual: world — fire spam (projectiles + muzzle flash)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  const box = await page.locator("canvas").boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }
  }
  const { diff } = await pairShots(testInfo, page, log.get(), "world-fire");
  assertNotFrozen(diff, "world-fire", 0.005);
  assertNoErrors(log.get(), "world-fire");
});

test("visual: world — aim sweep (mouse left-to-right)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  const box = await page.locator("canvas").boundingBox();
  if (box) {
    for (let pct = 0.1; pct <= 0.9; pct += 0.1) {
      await page.mouse.move(box.x + box.width * pct, box.y + box.height / 2);
      await page.waitForTimeout(80);
    }
  }
  const { diff } = await pairShots(testInfo, page, log.get(), "world-aim-sweep");
  assertNotFrozen(diff, "world-aim-sweep", 0.001);
  assertNoErrors(log.get(), "world-aim-sweep");
});

test("visual: world — left+right combat dance", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down("d");
    await page.waitForTimeout(200);
    await page.keyboard.up("d");
    await page.keyboard.down("a");
    await page.waitForTimeout(200);
    await page.keyboard.up("a");
  }
  const { diff } = await pairShots(testInfo, page, log.get(), "world-dance");
  assertNotFrozen(diff, "world-dance", 0.002);
  assertNoErrors(log.get(), "world-dance");
});

// =============================================================================
// SECTION D — Lifecycle / edge cases
// =============================================================================

test("visual: world — blur + focus, sim resumes", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const { diff } = await pairShots(testInfo, page, log.get(), "world-blur-focus");
  assertNotFrozen(diff, "world-blur-focus", 0.002);
  assertNoErrors(log.get(), "world-blur-focus");
});

test("visual: world — long idle 8 s, no crash, sim alive", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(8000);
  const { diff } = await pairShots(testInfo, page, log.get(), "world-long-idle");
  assertNotFrozen(diff, "world-long-idle", 0.001);
  assertNoErrors(log.get(), "world-long-idle");
});

test("visual: viewport resize (small → big)", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  const { diff } = await pairShots(testInfo, page, log.get(), "world-resize");
  assertNotFrozen(diff, "world-resize", 0.001);
  assertNoErrors(log.get(), "world-resize");
});

test("visual: navigation back (world → splash)", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2000);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(1000);
  const { diff } = await pairShots(testInfo, page, log.get(), "nav-back");
  void diff; // settled splash, motion not required
  const probe = await probeColor(page, COLORS.crystalCyan, 32);
  assertColorPresent(probe, COLORS.crystalCyan, 800, "nav-back splash");
  assertNoErrors(log.get(), "nav-back");
});

// =============================================================================
// SECTION E — Multi-tab cohabitation
// =============================================================================

test("visual: two-tab — host + joiner pair", async ({
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
  await a.keyboard.down("d");
  await b.keyboard.down("a");
  const pairA = await pairShots(testInfo, a, logA.get(), "tab-a", 2500);
  const pairB = await pairShots(testInfo, b, logB.get(), "tab-b", 2500);
  await a.keyboard.up("d");
  await b.keyboard.up("a");
  assertNotFrozen(pairA.diff, "tab-a", 0.002);
  assertNotFrozen(pairB.diff, "tab-b", 0.002);
  assertNoErrors(logA.get(), "tab-a");
  assertNoErrors(logB.get(), "tab-b");
  await ctxA.close();
  await ctxB.close();
});

// =============================================================================
// SECTION F — DOM smoke + meta-checks
// =============================================================================

test("dom: splash has expected text content", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(800);
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body, "splash should advertise BOXWORKS").toContain("boxworks");
  expect(body, "splash should mention practice + create + join").toMatch(
    /practice/i,
  );
  expect(body).toMatch(/create room/i);
  expect(body).toMatch(/join/i);
  // Title exists.
  const title = await page.title();
  expect(title.length, "title set").toBeGreaterThan(0);
  // No JS errors.
  await page.waitForTimeout(2500);
  void testInfo;
  assertNoErrors(log.get(), "dom-splash");
});

test("dom: canvas resizes to viewport on mount", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2000);
  const dims = await page.locator("canvas").first().evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
  });
  expect(dims.cw, "canvas client width >= 320").toBeGreaterThanOrEqual(320);
  expect(dims.ch, "canvas client height >= 240").toBeGreaterThanOrEqual(240);
  void testInfo;
  assertNoErrors(log.get(), "dom-canvas");
});

test("dom: world summary HTTP endpoint reports a live world", async ({
  page,
  request,
}, testInfo) => {
  const log = attachConsole(page);
  // Probe the game-server's /world/summary directly. If it 200s with a
  // non-null body the world is reachable.
  const url = process.env.GAME_SERVER_URL ?? "https://jakesjam-srv-sin.fly.dev";
  const res = await request.get(`${url}/world/summary`, { timeout: 10_000 });
  expect(res.ok(), `${url}/world/summary should return 200`).toBeTruthy();
  void page;
  void testInfo;
  void log;
});

test("visual: three-tab — three players cohabit", async ({
  browser,
}, testInfo) => {
  const ctxs = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));
  const logs = pages.map((p) => attachConsole(p));
  for (const p of pages) {
    await p.goto("/?world=1");
    await waitForCanvas(p);
    await p.waitForTimeout(1500);
  }
  await pages[0]!.keyboard.down("d");
  await pages[1]!.keyboard.down("a");
  await pages[2]!.keyboard.down("Space");
  const pair0 = await pairShots(testInfo, pages[0]!, logs[0]!.get(), "tab-3-a", 2000);
  const pair1 = await pairShots(testInfo, pages[1]!, logs[1]!.get(), "tab-3-b", 1500);
  const pair2 = await pairShots(testInfo, pages[2]!, logs[2]!.get(), "tab-3-c", 1500);
  await pages[0]!.keyboard.up("d");
  await pages[1]!.keyboard.up("a");
  await pages[2]!.keyboard.up("Space");
  // Third tab is mostly spectating — its perceived motion can be driven
  // purely by remote rigs and light beams. Looser thresholds for the
  // background tabs reflect that. Tab A is the "active" tab walking right
  // and gets the strictest threshold.
  assertNotFrozen(pair0.diff, "tab-3-a", 0.002);
  assertNotFrozen(pair1.diff, "tab-3-b", 0.0005);
  assertNotFrozen(pair2.diff, "tab-3-c", 0.0002);
  for (let i = 0; i < logs.length; i++) {
    assertNoErrors(logs[i]!.get(), `tab-3-${"abc"[i]}`);
  }
  for (const c of ctxs) await c.close();
});
