// Reproducer: scripted sequence that historically triggered "fall through
// terrain". Captures screenshots at each phase so we can SEE what the
// production deploy is doing.

import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { attachConsole, waitForCanvas } from "./visualHarness";

test("repro: stand on platform, jump, run, fall", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  const dir = testInfo.outputDir;
  await mkdir(dir, { recursive: true });
  await page.goto("/?world=1");
  await waitForCanvas(page);
  await page.waitForTimeout(2500);

  await page.screenshot({ path: join(dir, "01-spawn.png") });

  // Sit perfectly still 4 s — the "barely detects standing" scenario.
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(dir, "02-idle-4s.png") });

  // Walk right for 2 s.
  await page.keyboard.down("d");
  await page.waitForTimeout(2000);
  await page.keyboard.up("d");
  await page.screenshot({ path: join(dir, "03-walked-right.png") });

  // Jump.
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(dir, "04-mid-jump.png") });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(dir, "05-post-land.png") });

  // Run off the right edge.
  await page.keyboard.down("d");
  await page.waitForTimeout(3500);
  await page.keyboard.up("d");
  await page.screenshot({ path: join(dir, "06-far-right.png") });

  // Crouch on whatever surface we're on.
  await page.keyboard.down("Shift");
  await page.waitForTimeout(2500);
  await page.keyboard.up("Shift");
  await page.screenshot({ path: join(dir, "07-crouch.png") });

  // Spam jumps.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(dir, "08-jumps-then-land.png") });

  // Capture local-player y-history via canvas snapshot at end.
  const errs = log.get().filter((e) => e.type === "pageerror" || e.type === "error");
  console.log("--- repro JS errors:", errs.length, errs.map((e) => e.text));
});
