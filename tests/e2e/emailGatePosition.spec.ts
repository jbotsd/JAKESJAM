// Doors 1.2 — the email gate's position, verified in a browser.
//
// Two claims worth a real page load. First, that the dark default really
// is dark: after Doors 1.1 made the venue the landing, the gate is the
// only thing left between a stranger and the game, so a flag that
// silently moved it would be a live funnel change nobody authorised.
// Second, that the flip actually works — a dark flag that has never been
// exercised is not a decision made cheap, it is a decision deferred.
//
//   E2E_BASE_URL=http://localhost:8288 bunx playwright test emailGatePosition

import { test, expect } from "@playwright/test";

const GAME_CANVAS = "canvas:not(.ident-shader)";

async function gateVisible(page: import("@playwright/test").Page): Promise<boolean> {
  return (await page.locator(".email-gate").count()) > 0;
}

test.describe("Doors 1.2 — email gate position", () => {
  test("default is unchanged: the gate is still at boot", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => await gateVisible(page), { timeout: 20_000 }).toBe(true);
  });

  test("post-fight: boot is clear, so the venue is the first thing seen", async ({ page }) => {
    await page.goto("/?gate-position=post-fight");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    // Give it well past the point the boot gate would have appeared.
    await page.waitForTimeout(4_000);
    expect(await gateVisible(page)).toBe(false);

    // And the player is actually in the venue, not staring at a held
    // splash — the whole point of moving the ask.
    const onSplash = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-splash]");
      return el ? !el.hidden : false;
    });
    expect(onSplash).toBe(false);
  });

  test("post-fight: finishing a cycle raises the ask", async ({ page }) => {
    await page.goto("/?gate-position=post-fight");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    expect(await gateVisible(page)).toBe(false);

    // Fire the real signal the gate listens for rather than playing a
    // whole match — this spec is about the wiring, and OnlineMatchScene
    // emits exactly this at its results screen.
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("jakesjam:cycle-completed")),
    );
    await expect.poll(async () => await gateVisible(page), { timeout: 10_000 }).toBe(true);
  });

  test("post-fight: a declined ask stays declined across a reload", async ({ page }) => {
    await page.goto("/?gate-position=post-fight");
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("jakesjam:cycle-completed")),
    );
    await expect.poll(async () => await gateVisible(page), { timeout: 10_000 }).toBe(true);

    await page.locator(".email-gate-skip").click();
    await expect.poll(async () => await gateVisible(page), { timeout: 5_000 }).toBe(false);

    // The old skip was per-TAB, so a refresh re-asked the one person who
    // had already said no. It must now survive the reload.
    await page.reload();
    await page.waitForSelector(GAME_CANVAS, { timeout: 30_000 });
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("jakesjam:cycle-completed")),
    );
    await page.waitForTimeout(2_000);
    expect(await gateVisible(page)).toBe(false);
  });
});
