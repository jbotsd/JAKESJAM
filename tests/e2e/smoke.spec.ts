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

test("Practice match: canvas contains platform-wood pixels (hangingWood theme.lo)", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await clickButton(page, "Practice");
  await page.waitForTimeout(4500);
  await saveArtifacts(testInfo, page, log.get(), "in-match");

  // Practice's map (boxworks-practice.ts) is hardcoded to arenaTheme
  // "hangingWood", not "jadeIsles" — this test used to check for jadeIsles'
  // lime, which stopped matching once Practice's map moved to hangingWood.
  // hangingWood's wash/shade color (platformWoodLo = 0x5C3414 = rgb(92, 52,
  // 20)) is the dominant rendered tone — confirmed empirically: the
  // formerly-failing run's own logged top color buckets (rgb(80,48,16),
  // rgb(96,64,32), rgb(96,48,16), rgb(64,32,16)) are all within this
  // tolerance of platformWoodLo, together comfortably over the threshold.
  // (platformWoodHi, 0x9B5A28, barely renders in-frame — most of a
  // platform's visible area is the lo/shade face, not the hi highlight.)
  const probe = await probeScreenshotColor(page, { r: 92, g: 52, b: 20 }, 30);
  await writeFile(
    join(testInfo.outputDir, "color-probe.json"),
    JSON.stringify(probe, null, 2),
    "utf8",
  );
  expect(
    probe.matchPixels,
    `Expected wood platform pixels in viewport. Got ${probe.matchPixels}/${probe.sampledPixels} matching rgb(92,52,20)±30. Top non-bg colors:\n${probe.topColors.join("\n")}`,
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

test("wasm sim is actually running in production", async ({ page }, testInfo) => {
  // Catches the regression where wasm artifact 404s, fails to load,
  // or doesn't get linked into the build. Without this gate, the page
  // could render fine while silently running the TS-only fallback —
  // exactly the bug we hit in v0.37 (commit 99ffa73).
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  // Boot logs land within ~1s. Wait long enough to be sure.
  await page.waitForTimeout(2500);
  await saveArtifacts(testInfo, page, log.get(), "wasm-boot");

  const allEntries = log.get();
  const wasmReady = allEntries.find((e) =>
    /\[wasm-sim\]\s+ready/i.test(e.text),
  );
  const collisionApplied = allEntries.find((e) =>
    /\[wasm-collision\]\s+swap applied/i.test(e.text),
  );
  const playerApplied = allEntries.find((e) =>
    /\[wasm-player\]\s+swap applied/i.test(e.text),
  );

  expect(
    wasmReady,
    `Expected [wasm-sim] ready console log within 2.5s. Got:\n${
      allEntries.map((e) => `  [${e.type}] ${e.text}`).join("\n")
    }`,
  ).toBeDefined();

  expect(
    collisionApplied,
    "Expected [wasm-collision] swap applied console log",
  ).toBeDefined();

  expect(
    playerApplied,
    "Expected [wasm-player] swap applied console log",
  ).toBeDefined();

  // Also confirm the wasm asset itself is reachable (200 OK).
  const wasmResp = await page.request.fetch("/wasm/sim.wasm");
  expect(wasmResp.status()).toBe(200);
  expect(wasmResp.headers()["content-type"]).toBe("application/wasm");
});
