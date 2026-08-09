// Doors 1.1 — lobby-first landing.
//
// The old front door was click-to-initiate → 27.9 s ident → splash →
// callsign → walk → bell: five gates before a stranger saw a fight,
// against a north star of "in a live fight in under 15 seconds". A bare
// URL now lands in the venue; the splash is somewhere you go BACK to.
//
// These prove the three things that can silently regress: the default
// landing, the escape hatches that must still reach the old door, and
// that the landing is not broken at any canonical viewport (L7
// sizing-on-fleek — this changes what every first-time visitor sees).
//
//   PORT=8288 SERVE_CLIENT_DIR=$PWD/client/dist bun --cwd server src/index.ts
//   E2E_BASE_URL=http://localhost:8288 bunx playwright test lobbyFirst

import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { attachConsole } from "./visualHarness";

const GAME_CANVAS = "canvas:not(.ident-shader)";
const SHOTS = "tests/e2e/.artifacts/lobby-first";

/** The canonical viewport pass (L7), as written down in
 *  `docs/ui-axioms.md` § "The canonical viewport pass" — FIVE, not four.
 *  Phone landscape joined the set on 2026-08-09 when the rule was finally
 *  put in text and the doc and the tests were found disagreeing about it;
 *  short desktop is in because it is the one that actually caught the
 *  Doors 0.5 fold bug. If this list and that table ever diverge again,
 *  the table wins and this is the bug. */
const VIEWPORTS = [
  { name: "phone", width: 393, height: 852 },
  { name: "phone-landscape", width: 852, height: 393 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "short-desktop", width: 1280, height: 700 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

async function onSplash(page: import("@playwright/test").Page): Promise<boolean> {
  return await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-splash]");
    return el ? !el.hidden : false;
  });
}

/** The boot ceremony's two DOM pieces. Present = the visitor is being
 *  made to wait through something. */
async function ceremonyPresent(page: import("@playwright/test").Page): Promise<boolean> {
  return await page.evaluate(
    () =>
      !!document.querySelector("[data-boot-gate]") ||
      !!document.querySelector("[data-boot-ident]"),
  );
}

test.describe("Doors 1.1 — lobby-first landing", () => {
  test("a bare URL lands in the venue, with no gate and no ident", async ({ page }) => {
    const console_ = attachConsole(page);
    await page.goto("/?gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });

    // No click-to-initiate, no 27.9 s anthem standing between the visitor
    // and the game.
    expect(await ceremonyPresent(page)).toBe(false);

    // And we are actually on a live surface, not merely past the splash.
    await expect
      .poll(async () => await onSplash(page), { timeout: 20_000 })
      .toBe(false);
    await expect
      .poll(
        async () =>
          await page.evaluate(() => sessionStorage.getItem("jakesjam.inMatch") !== null),
        { timeout: 20_000 },
      )
      .toBe(true);

    const errors = console_.get().filter((e) => e.type === "pageerror");
    expect(errors.map((e) => e.text)).toEqual([]);
  });

  test("?splash=1 still reaches the old front door", async ({ page }) => {
    await page.goto("/?splash=1&gate=off");
    // The ceremony is a choice again, so it must still be there when asked
    // for — deleting the rite was never the goal.
    await expect
      .poll(async () => await ceremonyPresent(page), { timeout: 20_000 })
      .toBe(true);
    expect(await onSplash(page)).toBe(true);
  });

  test("the lobbyFirst=off kill switch restores the splash landing", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("jakesjam.lobbyFirst", "off"));
    await page.goto("/?gate=off");
    await expect
      .poll(async () => await onSplash(page), { timeout: 20_000 })
      .toBe(true);
  });

  test("the landing survives every canonical viewport", async ({ page }, testInfo) => {
    await mkdir(SHOTS, { recursive: true });
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?gate=off");
      await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
      await expect
        .poll(async () => await onSplash(page), { timeout: 20_000 })
        .toBe(false);

      // Let the venue actually connect and draw before capturing. The
      // "Connecting to hangout..." status is Phaser canvas text, not DOM,
      // so there is nothing to wait on — and a screenshot taken the
      // instant the splash hides shows a black void, which is a picture
      // of the loading state, not of the landing.
      await page.waitForTimeout(6_000);

      // The canvas must actually fill the viewport — a landing that boots
      // into a 0-height or overflowing canvas is not a landing.
      const box = await page.locator(GAME_CANVAS).first().boundingBox();
      expect(box, `${vp.name}: no canvas box`).not.toBeNull();
      expect(box!.height, `${vp.name}: canvas collapsed`).toBeGreaterThan(200);

      // No horizontal scroll — the 100vw + scrollbar trap.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${vp.name}: horizontal overflow`).toBeLessThanOrEqual(1);

      await page.screenshot({ path: join(SHOTS, `${vp.name}.png`), fullPage: false });
      testInfo.attach(`${vp.name}`, { path: join(SHOTS, `${vp.name}.png`), contentType: "image/png" });
    }
  });
});
