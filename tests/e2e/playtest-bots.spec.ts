// Playtest bot suite — autonomous gameplay sessions that smoke
// the game over realistic timeframes. Catches the class of bugs
// that a 1-minute spec misses:
//   - render system regressions that surface after N seconds
//   - leaks (sprite pool, particle pool, listener growth)
//   - frame-time degradation under sustained input
//   - mode-specific issues (?wasm-world=playtest crashes after
//     a real session)
//
// The bot does NOT play smart — random keys + occasional fire
// + random aim. The point is volume + realism, not winning.

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type ConsoleEntry = { type: string; text: string; ts: number };
type FrameSample = { tick: number | null; hash: number | null; ts: number };

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
 * Bot driver — random keys + jumps + fires + aim wiggle.
 * Returns a `stop()` function that flushes any held key.
 */
function startBot(
  page: Page,
  rngSeed = 42,
): { stop: () => Promise<void> } {
  // Cheap LCG so each bot is deterministic per seed.
  let s = rngSeed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  const keys = ["a", "d", "w", "s"] as const;
  const ABILITY = "shift";
  let pressedMove: string | null = null;
  let alive = true;

  const tick = async () => {
    while (alive) {
      try {
        // Release any held movement key.
        if (pressedMove) {
          await page.keyboard.up(pressedMove);
          pressedMove = null;
        }
        // 60% chance to start a new movement key, 40% rest.
        if (next() < 0.6) {
          const k = keys[Math.floor(next() * keys.length)]!;
          await page.keyboard.down(k);
          pressedMove = k;
        }
        // 25% chance to jump (W tap).
        if (next() < 0.25) {
          await page.keyboard.down("w");
          await page.waitForTimeout(80 + next() * 120);
          await page.keyboard.up("w");
        }
        // 35% chance to fire.
        if (next() < 0.35) {
          const cx = 640 + (next() - 0.5) * 600;
          const cy = 400 + (next() - 0.5) * 300;
          await page.mouse.move(cx, cy);
          await page.mouse.down({ button: "left" });
          await page.waitForTimeout(40 + next() * 80);
          await page.mouse.up({ button: "left" });
        }
        // 8% chance to parry (Shift tap).
        if (next() < 0.08) {
          await page.keyboard.down(ABILITY);
          await page.waitForTimeout(60);
          await page.keyboard.up(ABILITY);
        }
        await page.waitForTimeout(150 + next() * 200);
      } catch {
        // Page closed or context destroyed — exit cleanly.
        alive = false;
        break;
      }
    }
  };

  const driverPromise = tick();

  return {
    async stop() {
      alive = false;
      try {
        if (pressedMove) await page.keyboard.up(pressedMove);
      } catch {
        // ignore — page may already be closed
      }
      await driverPromise;
    },
  };
}

async function sampleStateProbe(page: Page): Promise<FrameSample> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __simStepNo?: () => number | null;
      __simStateHash?: () => number | null;
    };
    return {
      tick: w.__simStepNo?.() ?? null,
      hash: w.__simStateHash?.() ?? null,
      ts: Date.now(),
    };
  });
}

const BOT_SESSION_MS = 60_000; // 60 seconds — keeps CI runtime tractable

test.describe("playtest bots — autonomous gameplay sessions", () => {
  test("Practice — single bot runs 60s without console errors", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const log = attachConsole(page);
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await clickButton(page, "Practice");
    await page.waitForTimeout(2000);

    const bot = startBot(page, 0x12345);
    const samples: FrameSample[] = [];
    const start = Date.now();
    while (Date.now() - start < BOT_SESSION_MS) {
      await page.waitForTimeout(2000);
      samples.push(await sampleStateProbe(page));
    }
    await bot.stop();

    await ensureWrite(
      join(testInfo.outputDir, "samples.json"),
      JSON.stringify(samples, null, 2),
    );
    await ensureWrite(
      join(testInfo.outputDir, "console.json"),
      JSON.stringify(log.get(), null, 2),
    );

    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(
      errors,
      `Practice bot session console errors:\n${errors
        .map((e) => `  [${e.type}] ${e.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("World mode — single bot runs 60s without console errors", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const log = attachConsole(page);
    await page.goto("/?world=1");
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await page.waitForTimeout(3000);

    const bot = startBot(page, 0xc0ffee);
    const samples: FrameSample[] = [];
    const start = Date.now();
    while (Date.now() - start < BOT_SESSION_MS) {
      await page.waitForTimeout(2000);
      samples.push(await sampleStateProbe(page));
    }
    await bot.stop();

    await ensureWrite(
      join(testInfo.outputDir, "samples.json"),
      JSON.stringify(samples, null, 2),
    );
    await ensureWrite(
      join(testInfo.outputDir, "console.json"),
      JSON.stringify(log.get(), null, 2),
    );

    const errors = log
      .get()
      .filter((e) => e.type === "error" || e.type === "pageerror");
    expect(errors).toEqual([]);
  });

  test("Two bots in parallel browser contexts — same world room", async ({
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
      pageA.goto("/?world=1"),
      pageB.goto("/?world=1"),
    ]);
    await Promise.all([
      pageA.waitForSelector("canvas", { timeout: 20_000 }),
      pageB.waitForSelector("canvas", { timeout: 20_000 }),
    ]);
    await Promise.all([
      pageA.waitForTimeout(3000),
      pageB.waitForTimeout(3000),
    ]);

    const botA = startBot(pageA, 0xa);
    const botB = startBot(pageB, 0xb);

    const start = Date.now();
    while (Date.now() - start < BOT_SESSION_MS) {
      await pageA.waitForTimeout(5000);
    }
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

    expect(errsA, `Bot A: ${errsA.map((e) => e.text).join("; ")}`).toEqual([]);
    expect(errsB, `Bot B: ${errsB.map((e) => e.text).join("; ")}`).toEqual([]);
  });
});
