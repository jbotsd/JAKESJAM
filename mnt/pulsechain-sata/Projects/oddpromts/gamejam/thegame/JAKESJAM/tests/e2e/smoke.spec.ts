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

/**
 * Sample the active Phaser canvas. Returns the count of pixels whose RGB is
 * within `tolerance` of the target color, plus a small histogram of the
 * dominant non-bg colors for diagnosis.
 */
async function probeCanvasColors(
  page: Page,
  target: { r: number; g: number; b: number },
  tolerance: number,
): Promise<{ matchPixels: number; sampledPixels: number; topColors: string[] }> {
  return await page.evaluate(
    ({ tr, tg, tb, tol }) => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) return { matchPixels: 0, sampledPixels: 0, topColors: [] };
      // Sample a downscaled snapshot for speed.
      const SAMPLE_W = 320;
      const SAMPLE_H = Math.round((canvas.height / canvas.width) * SAMPLE_W);
      const off = document.createElement("canvas");
      off.width = SAMPLE_W;
      off.height = SAMPLE_H;
      const ctx = off.getContext("2d");
      if (!ctx) return { matchPixels: 0, sampledPixels: 0, topColors: [] };
      ctx.drawImage(canvas, 0, 0, SAMPLE_W, SAMPLE_H);
      const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      let match = 0;
      const buckets = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        if (a < 200) continue;
        if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
          match++;
        }
        // Bucket dominant non-bg colors for diagnostics.
        const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      const topColors = [...buckets.entries()]
        .sort((a, r) => r[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `rgb(${k}) × ${v}`);
      return { matchPixels: match, sampledPixels: data.length / 4, topColors };
    },
    { tr: target.r, tg: target.g, tb: target.b, tol: tolerance },
  );
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

  // jadeIsles theme: platformLimeHi = 0x9DE642 = rgb(157, 230, 66)
  const probe = await probeCanvasColors(page, { r: 157, g: 230, b: 66 }, 30);
  await writeFile(
    join(testInfo.outputDir, "color-probe.json"),
    JSON.stringify(probe, null, 2),
    "utf8",
  );
  // At 1280×800 sampled to 320×Y, expect at least ~50 lime pixels if any
  // platforms are visible. Failure = "no terrain" reproduces deterministically.
  expect(
    probe.matchPixels,
    `Expected lime platform pixels in canvas. Got ${probe.matchPixels}/${probe.sampledPixels} matching rgb(157,230,66)±30. Top non-bg colors:\n${probe.topColors.join("\n")}`,
  ).toBeGreaterThan(50);
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
