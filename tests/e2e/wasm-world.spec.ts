// V8 — proves ?wasm-world=1 boots step_world in real browsers
// against the deployed game. Catches the regression where the
// shim compiles fine in tests but fails to actually load / call
// step_world in production (build-pipeline issue, Vite tree-shake,
// fetch path, etc).

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

test("?wasm-world=1 enables step_world without crashes", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?wasm-world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  // Boot logs land within ~1.5s; wait long enough to be sure.
  await page.waitForTimeout(2500);
  await ensureWrite(
    join(testInfo.outputDir, "boot.console.json"),
    JSON.stringify(log.get(), null, 2),
  );

  const allEntries = log.get();

  // The shim emits one info line on enable. Absence here = the
  // J0 wiring is broken.
  const enableLog = allEntries.find((e) =>
    /\[wasm-world\]\s+enabled/.test(e.text),
  );
  expect(
    enableLog,
    `Expected [wasm-world] enabled console log within 2.5s. Last 30 entries:\n${
      allEntries
        .slice(-30)
        .map((e) => `  [${e.type}] ${e.text}`)
        .join("\n")
    }`,
  ).toBeDefined();

  // Confirm no JS errors during boot.
  const errors = allEntries.filter(
    (e) => e.type === "error" || e.type === "pageerror",
  );
  expect(
    errors,
    `Console errors during ?wasm-world=1 boot:\n${errors
      .map((e) => `  [${e.type}] ${e.text}`)
      .join("\n")}`,
  ).toEqual([]);
});
