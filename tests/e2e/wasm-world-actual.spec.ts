// V8c — confirms ?wasm-world=2 (full wasm orchestrator replacing
// TS) boots without crashes against deployed prod. Pairs with V8
// (?wasm-world=1 boot smoke) and V8b (20s gameplay session).
//
// What this catches that V8 doesn't: the J1-actual cutover wires
// the wasm result INTO the netcode loop's stepWithRuntime path.
// If the wasm orchestrator throws or returns malformed state,
// the renderer crashes within the first second of gameplay.

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

test("?wasm-world=2 boots full orchestrator + Practice without crashes", async ({
  page,
}, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?wasm-world=2");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(2500);

  // J0 [wasm-world] enabled log gates the shim. wasm-world=2 is
  // a STRONGER mode, but the shim's enable check matches both
  // (=1 and =2 both turn it on; =2 also activates J1-actual in
  // World.ts).
  const allEntries = log.get();
  await ensureWrite(
    join(testInfo.outputDir, "boot.console.json"),
    JSON.stringify(allEntries, null, 2),
  );

  // Click into Practice — verify the netcode loop running with
  // the wasm orchestrator doesn't immediately crash.
  const practiceBtn = page.getByRole("button", { name: /^Practice$/i });
  await practiceBtn.first().waitFor({ state: "visible", timeout: 10_000 });
  await practiceBtn.first().click();
  await page.waitForTimeout(3000);

  await ensureWrite(
    join(testInfo.outputDir, "post-practice.console.json"),
    JSON.stringify(log.get(), null, 2),
  );

  const errors = log
    .get()
    .filter((e) => e.type === "error" || e.type === "pageerror");
  expect(
    errors,
    `?wasm-world=2 errors during 5s session:\n${errors
      .map((e) => `  [${e.type}] ${e.text}`)
      .join("\n")}`,
  ).toEqual([]);
});
