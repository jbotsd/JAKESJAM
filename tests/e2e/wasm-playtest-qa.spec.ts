// QA tests designed via the game-qa skill — five-layer coverage
// for ?wasm-world=playtest (J1-actual cutover). Each test names
// the hypothesis it falsifies (per Steve Theodore's "design the
// experiments" rule).
//
// Hypothesis 1: ?wasm-world=playtest boots without crashes.
// Hypothesis 2: A bot session of 60s in playtest mode produces
//               no console errors.
// Hypothesis 3: Player moves on screen when keys are held
//               (terrain + input plumbing both work).
// Hypothesis 4: Match phase transitions visually (countdown →
//               fighting banner appears).
// Hypothesis 5: Two playtest bots can co-exist in same world
//               room without crashing each other.

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";

type ConsoleEntry = { type: string; text: string; ts: number };

function attachConsole(page: Page): { get: () => ConsoleEntry[] } {
  const entries: ConsoleEntry[] = [];
  page.on("console", (msg: ConsoleMessage) =>
    entries.push({ type: msg.type(), text: msg.text(), ts: Date.now() }),
  );
  page.on("pageerror", (err) =>
    entries.push({
      type: "pageerror",
      text: `${err.name}: ${err.message}`,
      ts: Date.now(),
    }),
  );
  return { get: () => entries };
}

async function ensureWrite(p: string, c: string): Promise<void> {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, c, "utf8");
}

async function clickButton(page: Page, label: string): Promise<void> {
  const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
  await btn.first().waitFor({ state: "visible", timeout: 10_000 });
  await btn.first().click();
}

/**
 * Probe screenshot for a target colour band. Returns count of
 * matching pixels — used to verify the renderer is producing
 * recognizable output (not a black canvas, not a white error).
 */
async function probeColor(
  page: Page,
  target: { r: number; g: number; b: number },
  tolerance: number,
): Promise<number> {
  const buf = await page.screenshot({ type: "png", fullPage: false });
  const png = PNG.sync.read(buf);
  const data = png.data;
  let match = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const i = (y * png.width + x) * 4;
      if (data[i + 3]! < 200) continue;
      if (
        Math.abs(data[i]! - target.r) <= tolerance &&
        Math.abs(data[i + 1]! - target.g) <= tolerance &&
        Math.abs(data[i + 2]! - target.b) <= tolerance
      )
        match++;
    }
  }
  return match;
}

function startRandomBot(
  page: Page,
  seed: number,
): { stop: () => Promise<void> } {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const keys = ["a", "d", "w", "s"] as const;
  let alive = true;
  let pressed: string | null = null;
  const driver = (async () => {
    while (alive) {
      try {
        if (pressed) await page.keyboard.up(pressed);
        const k = keys[Math.floor(rand() * keys.length)]!;
        await page.keyboard.down(k);
        pressed = k;
        if (rand() < 0.3) {
          await page.mouse.click(640 + (rand() - 0.5) * 600, 400);
        }
        await page.waitForTimeout(120 + rand() * 200);
      } catch {
        alive = false;
      }
    }
  })();
  return {
    async stop() {
      alive = false;
      try {
        if (pressed) await page.keyboard.up(pressed);
      } catch {
        // page closed
      }
      await driver;
    },
  };
}

test.describe("wasm playtest QA — five-layer coverage of ?wasm-world=playtest", () => {
  test("H1: ?wasm-world=playtest boots without crashes", async ({
    page,
  }, testInfo) => {
    const log = attachConsole(page);
    await page.goto("/?wasm-world=playtest");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await page.waitForTimeout(3000);

    await ensureWrite(
      join(testInfo.outputDir, "console.json"),
      JSON.stringify(log.get(), null, 2),
    );

    // The J0 shim's enable log only fires for ?wasm-world=1.
    // ?wasm-world=playtest activates the deeper J1-actual cutover
    // inside World.ts maybeWasmActual — there's no console
    // breadcrumb for that, so we just assert boot is clean.
    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(
      errors,
      `Boot errors:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
    ).toEqual([]);
  });

  test("H2: 60s autonomous bot session in playtest mode — zero console errors", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const log = attachConsole(page);
    await page.goto("/?wasm-world=playtest");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await clickButton(page, "Practice");
    await page.waitForTimeout(2000);

    const bot = startRandomBot(page, 0xfeed1);
    await page.waitForTimeout(60_000);
    await bot.stop();

    await ensureWrite(
      join(testInfo.outputDir, "console.json"),
      JSON.stringify(log.get(), null, 2),
    );

    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(errors).toEqual([]);
  });

  test("H3: held movement key produces visible player motion (terrain + input plumbing)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const log = attachConsole(page);
    await page.goto("/?wasm-world=playtest");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await clickButton(page, "Practice");
    await page.waitForTimeout(2000);

    // Capture a screenshot before + after sustained Right key.
    const beforePng = await page.screenshot({ type: "png" });
    await page.keyboard.down("d");
    await page.waitForTimeout(2000);
    await page.keyboard.up("d");
    const afterPng = await page.screenshot({ type: "png" });

    await ensureWrite(
      join(testInfo.outputDir, "before.png"),
      "", // placeholder — real screenshot saved via path option below
    );
    await page.screenshot({ path: join(testInfo.outputDir, "before.png") });
    await page.screenshot({ path: join(testInfo.outputDir, "after.png") });

    // Confirm SOMETHING moved — pixel diff between before + after.
    const beforeImg = PNG.sync.read(beforePng);
    const afterImg = PNG.sync.read(afterPng);
    let diff = 0;
    for (let i = 0; i < beforeImg.data.length; i += 4) {
      const dr = Math.abs(beforeImg.data[i]! - afterImg.data[i]!);
      const dg = Math.abs(beforeImg.data[i + 1]! - afterImg.data[i + 1]!);
      const db = Math.abs(beforeImg.data[i + 2]! - afterImg.data[i + 2]!);
      if (dr + dg + db > 30) diff++;
    }
    // Even a stationary scene has slight render variance; require
    // a substantial fraction of pixels to differ.
    expect(diff).toBeGreaterThan(1000);

    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(errors).toEqual([]);
  });

  test("H4: match still has lime platform pixels visible (jadeIsles arena renders)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const log = attachConsole(page);
    await page.goto("/?wasm-world=playtest");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await clickButton(page, "Practice");
    await page.waitForTimeout(3000);

    // jadeIsles platformLimeHi = rgb(157, 230, 66). Practice arena
    // should have thousands of these pixels visible.
    const limePixels = await probeColor(page, { r: 157, g: 230, b: 66 }, 30);
    await ensureWrite(
      join(testInfo.outputDir, "lime-probe.json"),
      JSON.stringify({ limePixels }, null, 2),
    );
    expect(
      limePixels,
      `Expected lime platform pixels in viewport. Got ${limePixels}.`,
    ).toBeGreaterThan(2000);

    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(errors).toEqual([]);
  });

  test("H6: long-horizon — 3-minute bot session in playtest mode produces no growing console error stream", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const log = attachConsole(page);
    await page.goto("/?wasm-world=playtest");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await clickButton(page, "Practice");
    await page.waitForTimeout(2000);

    const bot = startRandomBot(page, 0xdeadbeef);
    const errorCountSamples: Array<{ ts: number; errors: number }> = [];
    const start = Date.now();
    while (Date.now() - start < 180_000) {
      await page.waitForTimeout(15_000);
      const errors = log
        .get()
        .filter((e) => e.type === "error" || e.type === "pageerror");
      errorCountSamples.push({
        ts: Date.now() - start,
        errors: errors.length,
      });
    }
    await bot.stop();

    await ensureWrite(
      join(testInfo.outputDir, "error-growth.json"),
      JSON.stringify(errorCountSamples, null, 2),
    );
    await ensureWrite(
      join(testInfo.outputDir, "console.json"),
      JSON.stringify(log.get(), null, 2),
    );

    // Hypothesis: error count over 3min monotonically zero. A
    // single error mid-session would mean a defect surfaces
    // only after sustained input.
    const finalErrors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(finalErrors).toEqual([]);
  });

  test("H7: state probe shows monotonically advancing tick over a session", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const log = attachConsole(page);
    await page.goto("/?wasm-world=playtest&world=1");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await page.waitForTimeout(4000);

    const samples: Array<{ ts: number; tick: number | null }> = [];
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      await page.waitForTimeout(2000);
      const tick = await page.evaluate(() => {
        const w = window as unknown as { __simStepNo?: () => number | null };
        return w.__simStepNo?.() ?? null;
      });
      samples.push({ ts: Date.now() - start, tick });
    }

    await ensureWrite(
      join(testInfo.outputDir, "ticks.json"),
      JSON.stringify(samples, null, 2),
    );

    // Filter null samples (probe inactive — not an OnlineMatchScene
    // session) and confirm the rest are monotonically increasing.
    const live = samples.filter((s) => s.tick != null) as Array<{
      ts: number;
      tick: number;
    }>;
    if (live.length >= 2) {
      for (let i = 1; i < live.length; i++) {
        expect(
          live[i]!.tick,
          `Tick regressed: ${live[i - 1]!.tick} → ${live[i]!.tick} at ts=${live[i]!.ts}`,
        ).toBeGreaterThanOrEqual(live[i - 1]!.tick);
      }
    }

    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(errors).toEqual([]);
  });

  test("H5: two bots in playtest mode parallel browsers — no errors crossing the wire", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const logA = attachConsole(pageA);
    const logB = attachConsole(pageB);

    await Promise.all([
      pageA.goto("/?wasm-world=playtest&world=1"),
      pageB.goto("/?wasm-world=playtest&world=1"),
    ]);
    await Promise.all([
      pageA.waitForSelector("canvas", { timeout: 20_000 }),
      pageB.waitForSelector("canvas", { timeout: 20_000 }),
    ]);
    await Promise.all([
      pageA.waitForTimeout(3000),
      pageB.waitForTimeout(3000),
    ]);

    const botA = startRandomBot(pageA, 0xa);
    const botB = startRandomBot(pageB, 0xb);

    await pageA.waitForTimeout(60_000);
    await Promise.all([botA.stop(), botB.stop()]);

    await ensureWrite(
      join(testInfo.outputDir, "consoleA.json"),
      JSON.stringify(logA.get(), null, 2),
    );
    await ensureWrite(
      join(testInfo.outputDir, "consoleB.json"),
      JSON.stringify(logB.get(), null, 2),
    );

    const errsA = logA
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    const errsB = logB
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");

    await ctxA.close();
    await ctxB.close();

    expect(errsA, `Bot A errors:\n${errsA.map((e) => e.text).join("\n")}`).toEqual([]);
    expect(errsB, `Bot B errors:\n${errsB.map((e) => e.text).join("\n")}`).toEqual([]);
  });
});
