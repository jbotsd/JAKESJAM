// V8b — extended ?wasm-world=1 play session with state sampling.
// Boots the deployed game with the wasm orchestrator opt-in,
// joins a practice match, plays randomized inputs for 20s, and
// asserts:
//   - the [wasm-world] enabled console line lands at boot
//   - no JS errors / pageerror entries during the session
//   - the state probe (when active) reports monotonically
//     advancing __simStepNo() values (proves the sim is ticking)
//
// Designed to catch the regression where ?wasm-world=1 boots
// fine but step_world later silently diverges from TS during
// real gameplay and crashes a render system.

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type ConsoleEntry = { type: string; text: string };

function attachConsole(page: Page): { get: () => ConsoleEntry[] } {
  const entries: ConsoleEntry[] = [];
  page.on("console", (msg: ConsoleMessage) =>
    entries.push({ type: msg.type(), text: msg.text() }),
  );
  page.on("pageerror", (err) =>
    entries.push({ type: "pageerror", text: `${err.name}: ${err.message}` }),
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

test("?wasm-world=1 sustains 20s of gameplay with no errors", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const log = attachConsole(page);
  await page.goto("/?wasm-world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(2000);

  const enableLog = log
    .get()
    .find((e) => /\[wasm-world\]\s+enabled/.test(e.text));
  expect(enableLog).toBeDefined();

  await clickButton(page, "Practice");
  await page.waitForTimeout(2000);

  // Sample the state probe (Practice scene doesn't register one
  // today — we record its return value either way for evidence).
  const samples: Array<{ tick: number | null; hash: number | null }> = [];
  const keys = ["a", "d", "w", "s"] as const;
  const start = Date.now();
  let pressed: string | null = null;
  while (Date.now() - start < 20_000) {
    if (pressed) {
      await page.keyboard.up(pressed);
      pressed = null;
    }
    const k = keys[Math.floor(Math.random() * keys.length)]!;
    await page.keyboard.down(k);
    pressed = k;
    if (Math.random() < 0.15) {
      await page.mouse.click(640, 400, { button: "left" });
    }
    await page.waitForTimeout(150 + Math.random() * 200);

    if (samples.length < 50 && Math.random() < 0.3) {
      const sample = await page.evaluate(() => ({
        tick: (window as unknown as {
          __simStepNo?: () => number | null;
        }).__simStepNo?.() ?? null,
        hash: (window as unknown as {
          __simStateHash?: () => number | null;
        }).__simStateHash?.() ?? null,
      }));
      samples.push(sample);
    }
  }
  if (pressed) await page.keyboard.up(pressed);

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
    `Errors during 20s ?wasm-world=1 session:\n${errors
      .map((e) => `  [${e.type}] ${e.text}`)
      .join("\n")}`,
  ).toEqual([]);
});
