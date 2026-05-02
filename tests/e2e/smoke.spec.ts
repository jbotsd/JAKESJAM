import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
};

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

async function saveArtifacts(
  testInfo: import("@playwright/test").TestInfo,
  page: Page,
  log: ConsoleEntry[],
  label: string,
): Promise<void> {
  const outDir = join(testInfo.outputDir);
  await mkdir(outDir, { recursive: true });
  await page.screenshot({ path: join(outDir, `${label}.png`), fullPage: false });
  await writeFile(
    join(outDir, `${label}.console.json`),
    JSON.stringify(log, null, 2),
    "utf8",
  );
}

async function clickButton(page: Page, label: string): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
  await btn.first().waitFor({ state: "visible", timeout: 10_000 });
  await btn.first().click();
}

test("splash menu loads with no errors", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await saveArtifacts(testInfo, page, log.get(), "splash");

  const errors = log.get().filter((e) => e.type === "error" || e.type === "pageerror");
  expect(
    errors,
    `Splash console errors:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
  ).toEqual([]);
});

test("Practice mode: renderArena fires with platforms > 0 and no errors", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await saveArtifacts(testInfo, page, log.get(), "01-splash");

  await clickButton(page, "Practice");
  await page.waitForTimeout(4000);
  await saveArtifacts(testInfo, page, log.get(), "02-in-match");

  const arenaLog = log.get().find((e) => e.text.includes("renderArena: requested"));
  expect(arenaLog, "renderArena console line must appear after entering Practice").toBeTruthy();
  const platformsMatch = arenaLog ? arenaLog.text.match(/platforms=(\d+)/) : null;
  const platforms = platformsMatch ? parseInt(platformsMatch[1]!, 10) : 0;
  expect(
    platforms,
    `arena should have platforms; got log="${arenaLog?.text ?? "<missing>"}"`,
  ).toBeGreaterThan(0);

  const errors = log.get().filter((e) => e.type === "error" || e.type === "pageerror");
  expect(
    errors,
    `In-match console errors:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
  ).toEqual([]);
});

test("Practice match: no slow-frame log spam over 5s", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await clickButton(page, "Practice");
  await page.waitForTimeout(2000);
  const before = log.get().length;
  await page.waitForTimeout(5000);
  const after = log.get();
  await saveArtifacts(testInfo, page, after, "03-after-warmup");
  const newEntries = after.slice(before);
  const stutter = newEntries.filter((e) =>
    /slow frame|stutter|GC pause|frame budget|exceeded budget/i.test(e.text),
  );
  expect(stutter, "no stutter logs in 5s warmup").toEqual([]);
});