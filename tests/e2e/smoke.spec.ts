import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

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

/**
 * Sample the page screenshot (PNG bytes via Playwright) for a target color.
 * Reading screenshot bytes side-steps the WebGL preserveDrawingBuffer=false
 * default that makes drawImage(canvas) return an all-black surface.
 *
 * Returns count of pixels whose RGB is within `tolerance` of `target`, plus
 * a histogram of dominant non-near-black colors so a failing test surfaces
 * what's actually on screen.
 */
async function probeScreenshotColor(
  page: Page,
  target: { r: number; g: number; b: number },
  tolerance: number,
): Promise<{ matchPixels: number; sampledPixels: number; topColors: string[] }> {
  const buf = await page.screenshot({ type: "png", fullPage: false });
  const png = PNG.sync.read(buf);
  const data = png.data;
  const w = png.width;
  const h = png.height;
  let match = 0;
  const buckets = new Map<string, number>();
  let sampled = 0;
  // Stride sampling — every 3rd pixel — to keep this fast at 1280×800.
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 200) continue;
      sampled++;
      if (
        Math.abs(r - target.r) <= tolerance &&
        Math.abs(g - target.g) <= tolerance &&
        Math.abs(b - target.b) <= tolerance
      ) {
        match++;
      }
      if (r + g + b < 60) continue;
      const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const topColors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `rgb(${k}) × ${v}`);
  return { matchPixels: match, sampledPixels: sampled, topColors };
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

test("Practice match: canvas contains platform-lime pixels (jadeIsles theme.hi)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await clickButton(page, "Practice");
  await page.waitForTimeout(4500);
  await saveArtifacts(testInfo, page, log.get(), "in-match");

  // jadeIsles theme: platformLimeHi = 0x9DE642 = rgb(157, 230, 66).
  // Note: HUD HP bar uses a similar lime — match has to subtract that
  // baseline. The HP bar is ≤ ~250×16 = 4000 px in the splash baseline;
  // platforms cover thousands+ when visible, so a >5000 threshold is
  // a clear "platforms drew" signal.
  const probe = await probeScreenshotColor(page, { r: 157, g: 230, b: 66 }, 30);
  await writeFile(
    join(testInfo.outputDir, "color-probe.json"),
    JSON.stringify(probe, null, 2),
    "utf8",
  );
  expect(
    probe.matchPixels,
    `Expected lime platform pixels in viewport. Got ${probe.matchPixels}/${probe.sampledPixels} matching rgb(157,230,66)±30. Top non-bg colors:\n${probe.topColors.join("\n")}`,
  ).toBeGreaterThan(3000);
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
  await saveArtifacts(testInfo, page, after, "after-warmup");
  const newEntries = after.slice(before);
  const stutter = newEntries.filter((e) =>
    /slow frame|stutter|GC pause|frame budget|exceeded budget/i.test(e.text),
  );
  expect(stutter, "no stutter logs in 5s warmup").toEqual([]);
});
