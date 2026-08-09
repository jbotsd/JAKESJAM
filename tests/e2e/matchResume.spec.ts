// Doors 1.7 — a refresh mid-match must put you back in the match, not on
// the splash.
//
// The unit tests in client/src/shell/__tests__/matchResume.test.ts cover
// the marker's rules. This covers the thing they cannot: that the BOOT
// PATH actually consults the marker and lands the player back on a live
// surface. That was the entire bug — the server's 10 s reconnect grace was
// real and reachable, and nothing ever tried it.
//
// Needs a local host (the resume window is 8 s, so a slow public round
// trip would make this flaky by construction):
//   PORT=8288 SERVE_CLIENT_DIR=$PWD/client/dist bun --cwd server src/index.ts
//   E2E_BASE_URL=http://localhost:8288 bunx playwright test matchResume

import { test, expect } from "@playwright/test";
import { attachConsole } from "./visualHarness";

/** Phaser appends its own bare <canvas>; the splash also renders an
 *  `ident-shader` canvas, so a plain `canvas` locator resolves to two and
 *  waits on the wrong (aria-hidden, never-visible) one. */
const GAME_CANVAS = "canvas:not(.ident-shader)";

/**
 * Skip the boot-time ident on a fresh browser profile. A first visit plays
 * the intro and parks on "CLICK TO INITIATE", which is Doors 1.1's problem,
 * not 1.7's — these tests are about what boot does with the resume marker,
 * so start from the returning-visitor state.
 */
async function asReturningVisitor(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("jakesjam.identSeen", "1");
    } catch {
      /* hardened browser — the ident just plays */
    }
  });
}

/**
 * Is the player on a live surface? ShellController hides the splash
 * (`[data-splash]`) whenever matchMode leaves "none", so a visible splash
 * IS the bug this item fixes: the boot path dumped a mid-match reloader
 * back onto it.
 */
async function onSplash(page: import("@playwright/test").Page): Promise<boolean> {
  return await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-splash]");
    // Absent splash cannot be "showing the splash".
    return el ? !el.hidden : false;
  });
}

async function resumeMarker(
  page: import("@playwright/test").Page,
): Promise<{ place?: string; at?: number } | null> {
  return await page.evaluate(() => {
    const raw = sessionStorage.getItem("jakesjam.inMatch");
    return raw ? (JSON.parse(raw) as { place?: string; at?: number }) : null;
  });
}

test.describe("Doors 1.7 — refresh mid-match", () => {
  test("a reload in the venue resumes the venue instead of the splash", async ({ page }) => {
    const console_ = attachConsole(page);
    await asReturningVisitor(page);

    // gate=off keeps the email gate out of the boot path — it is a
    // separate item (Doors 1.2) and its own Jake decision.
    await page.goto("/?world=1&gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });

    // Wait for the marker rather than a fixed sleep: it is written the
    // instant joinWorld runs, so its presence IS "we are in a match".
    await expect
      .poll(async () => (await resumeMarker(page))?.place, { timeout: 30_000 })
      .toBe("venue");

    expect(await onSplash(page)).toBe(false);

    await page.reload();
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });

    // The assertion that matters: after a bare reload the player is back on
    // a live surface. Before this fix the splash was showing every time.
    await expect
      .poll(async () => await onSplash(page), { timeout: 20_000 })
      .toBe(false);

    // And the marker survived, so the heartbeat re-armed on the new page.
    await expect
      .poll(async () => (await resumeMarker(page))?.place, { timeout: 10_000 })
      .toBe("venue");

    const errors = console_
      .get()
      .filter((e) => e.type === "pageerror")
      .map((e) => e.text);
    expect(errors).toEqual([]);
  });

  test("a deliberate exit is not resumed by a later reload", async ({ page }) => {
    await asReturningVisitor(page);
    await page.goto("/?world=1&gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    await expect
      .poll(async () => (await resumeMarker(page))?.place, { timeout: 30_000 })
      .toBe("venue");

    // Drive the REAL exit path, not a simulated one. Deleting the key by
    // hand looked equivalent and was not: the 2 s heartbeat simply wrote
    // it back, and the test failed for a reason the product does not have.
    // `disarmMatchResume` stops the heartbeat BEFORE clearing, which is
    // exactly the ordering this exercises.
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("jakesjam:back-to-splash")),
    );
    await expect
      .poll(async () => await resumeMarker(page), { timeout: 10_000 })
      .toBeNull();

    // `?splash=1` deliberately, not a bare URL: Doors 1.1 made the VENUE
    // the default landing, so "no splash" stopped meaning "did not resume"
    // and this assertion would be reporting on 1.1 instead of on 1.7. The
    // escape hatch gives a surface where the two outcomes differ again.
    await page.goto("/?splash=1&gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    // Give boot the same budget the resume path would have had.
    await page.waitForTimeout(3_000);
    expect(await onSplash(page)).toBe(true);
  });

  test("a stale marker is not resumed", async ({ page }) => {
    await asReturningVisitor(page);
    // `?splash=1` for the same reason as the test above (Doors 1.1).
    await page.goto("/?splash=1&gate=off");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    // Older than RESUME_WINDOW_MS (8 s) — the run is gone; boot must not
    // pretend otherwise.
    await page.evaluate(() => {
      sessionStorage.setItem(
        "jakesjam.inMatch",
        JSON.stringify({ place: "arena", at: Date.now() - 60_000 }),
      );
    });
    await page.reload();
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    await page.waitForTimeout(3_000);
    expect(await onSplash(page)).toBe(true);
  });
});
