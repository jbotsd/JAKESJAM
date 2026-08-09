// Doors 1.8 — the class picker is ONE presentation, and it survives the
// four canonical viewports (L7 sizing-on-fleek).
//
// The bare <select> it replaced could not overflow; a row of 150 px tiles
// can, so this is exactly the change that rule exists for.
//
// The surface under test is SETTINGS, not the private-room form. Writing
// this spec is what exposed the gap: swapping the room form's <select> for
// tiles gave "one presentation" but left the choice inside a panel that is
// hidden by default — the click failed with "element is not visible",
// which is 1.8's second half ("surfaced on the main path") failing out
// loud. Settings is two keystrokes from anywhere, so that is where the
// picker had to go.
//
//   PORT=8288 SERVE_CLIENT_DIR=$PWD/client/dist bun --cwd server src/index.ts
//   E2E_BASE_URL=http://localhost:8288 bunx playwright test classPicker

import { test, expect } from "@playwright/test";

/** Same four as lobbyFirst.spec.ts — short-desktop is in the set because it
 *  is the one that actually caught the Doors 0.5 fold bug. */
const VIEWPORTS = [
  { name: "phone", width: 393, height: 852 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "short-desktop", width: 1280, height: 700 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

async function asReturningVisitor(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("jakesjam.identSeen", "1");
    } catch {
      /* hardened browser — the ident just plays */
    }
  });
}

/** Put the page in the state a player is in when Settings is open.
 *
 *  Two dead ends are worth recording so nobody repeats them. Setting
 *  `[data-options].hidden = false` alone leaves the splash in flow, which
 *  pushes the panel off-screen — the click then fails with "element is
 *  outside of the viewport", not a real bug. And clicking the actual
 *  `[data-menu-options]` control does not work from a cold splash either;
 *  it is not visible there, so every test failed instead of one.
 *
 *  What the shell itself does (ShellController.apply -> shellVisibility) is
 *  reveal the settings layer AND hide its siblings, so that is what this
 *  reproduces. The route to Settings is another item's business; these
 *  tests are about the picker.
 */
async function openSettings(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForSelector("[data-options]", { state: "attached", timeout: 30_000 });
  await page.evaluate(() => {
    for (const sel of ["[data-splash]", "[data-lobby-panel]", "[data-shell-pause]"]) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) el.hidden = true;
    }
    const panel = document.querySelector<HTMLElement>("[data-options]");
    if (panel) panel.hidden = false;
  });
  await page.locator("[data-options]").waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("Doors 1.8 — one class presentation", () => {
  test("the picker renders four tiles and persists a pick", async ({ page }) => {
    await asReturningVisitor(page);
    await page.goto("/?splash=1&gate=off");
    await openSettings(page);

    const picker = page.locator("[data-settings-character-picker] [data-class-row]");
    await picker.waitFor({ state: "visible", timeout: 30_000 });

    const tiles = page.locator("[data-settings-character-picker] [data-class-tile]");
    await expect(tiles).toHaveCount(4);

    // The locked persona names, not the dev archetype ids — the whole
    // reason the bare <select> was a legibility problem.
    await expect(tiles.filter({ hasText: "GEOMETRICIAN" })).toHaveCount(1);
    await expect(tiles.filter({ hasText: "INTERSTICE" })).toHaveCount(1);
    await expect(tiles.filter({ hasText: "KINDLED" })).toHaveCount(1);
    await expect(tiles.filter({ hasText: "SYZYGIST" })).toHaveCount(1);

    // Pick a non-default class and confirm it persisted to the ONE key both
    // this surface and the venue station read.
    await page.locator('[data-settings-character-picker] [data-class-tile="heavy"]').click();
    await expect
      .poll(async () =>
        page.evaluate(() => localStorage.getItem("jakesjam.playerCharacter")),
      )
      .toBe("heavy");
    await expect(
      page.locator('[data-settings-character-picker] [data-class-tile="heavy"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a pick made elsewhere repaints this picker (two views, one value)", async ({ page }) => {
    await asReturningVisitor(page);
    await page.goto("/?splash=1&gate=off");
    await openSettings(page);
    await page
      .locator("[data-settings-character-picker] [data-class-row]")
      .waitFor({ state: "visible", timeout: 30_000 });

    // The venue loadout station announces its writes with this event; the
    // settings view must not go stale within a session.
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("jakesjam:class-change", {
          detail: { characterId: "sprinter" },
        }),
      ),
    );
    await expect(
      page.locator('[data-settings-character-picker] [data-class-tile="sprinter"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  for (const vp of VIEWPORTS) {
    test(`no horizontal overflow at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }, testInfo) => {
      await asReturningVisitor(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?splash=1&gate=off");
      await openSettings(page);

      const row = page.locator("[data-settings-character-picker] [data-class-row]");
      await row.waitFor({ state: "visible", timeout: 30_000 });

      // Tiles wrap (flex-wrap), so the ROW must never be wider than its
      // container, and the page must never scroll sideways. Beware
      // 100vw+scrollbar: compare against clientWidth, not innerWidth.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          docScroll: doc.scrollWidth,
          docClient: doc.clientWidth,
        };
      });
      expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient + 1);

      await testInfo.attach(`class-picker-${vp.name}.png`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: "image/png",
      });
    });
  }
});
