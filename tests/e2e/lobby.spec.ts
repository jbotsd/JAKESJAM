import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type ConsoleEntry = { type: string; text: string; location?: string };

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
    entries.push({ type: "pageerror", text: `${err.name}: ${err.message}\n${err.stack ?? ""}` });
  });
  return { get: () => entries };
}

async function clickButton(page: Page, label: string): Promise<void> {
  const btn = page
    .getByRole("button", { name: new RegExp(`^${label}$`, "i") })
    .first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  // Wait until the button is actually enabled — the lobby disables Create
  // Room until the Convex client is connected.
  await btn.evaluate((el) => {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!(el as HTMLButtonElement).disabled) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }, undefined, { timeout: 10_000 } as never);
  await btn.click();
}

async function dump(testInfo: import("@playwright/test").TestInfo, page: Page, log: ConsoleEntry[], label: string) {
  await mkdir(testInfo.outputDir, { recursive: true });
  await page.screenshot({ path: join(testInfo.outputDir, `${label}.png`) });
  await writeFile(join(testInfo.outputDir, `${label}.json`), JSON.stringify(log, null, 2));
}

test("World mode: ?world=1 enters arena and renders terrain", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/?world=1");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(5000);
  await dump(testInfo, page, log.get(), "world-arena");

  const errors = log.get().filter((e) => e.type === "error" || e.type === "pageerror");
  expect(
    errors,
    `World mode JS errors:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
  ).toEqual([]);
});

test("Create Room flow: no JS errors, room code visible", async ({ page }, testInfo) => {
  const log = attachConsole(page);
  await page.goto("/");
  await page.waitForSelector("canvas", { timeout: 20_000 });
  await page.waitForTimeout(1000);
  await clickButton(page, "Create Room");
  await page.waitForTimeout(3500);
  await dump(testInfo, page, log.get(), "create-room");

  const errors = log
    .get()
    .filter((e) => e.type === "error" || e.type === "pageerror");
  expect(
    errors,
    `Lobby JS errors after Create Room:\n${errors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
  ).toEqual([]);

  const body = await page.locator("body").innerText();
  expect(body, "Room code should be visible").toMatch(/[A-Z0-9]{6}/);
});

test("Two-tab 1v1: host creates → joiner joins via code → no JS errors on host", async ({
  browser,
}, testInfo) => {
  // Use TWO independent contexts so each tab has its own sessionStorage
  // (mirrors what happens with two real browser windows on one PC).
  const hostCtx = await browser.newContext();
  const joinCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const join = await joinCtx.newPage();

  const hostLog = attachConsole(host);
  const joinLog = attachConsole(join);

  await host.goto("/");
  await host.waitForSelector("canvas", { timeout: 20_000 });
  // Wait until lobby reports a Convex client ready (status flips off the
  // "Set VITE_CONVEX_URL" / "Connecting…" branches). Up to 8s.
  await host.waitForFunction(
    () => /Create or join a room|Connected/.test(document.body.innerText),
    null,
    { timeout: 10_000 },
  );
  await clickButton(host, "Create Room");
  // Wait for the active-code element to land a real 4–8 char code (not the
  // placeholder "------"). Polls innerText regardless of visibility because
  // the element is in the DOM at all times.
  await host.waitForFunction(
    () => {
      const el = document.querySelector("[data-active-code]");
      const text = el?.textContent?.trim() ?? "";
      return /^[A-Z0-9]{4,8}$/.test(text);
    },
    null,
    { timeout: 10_000 },
  );
  await host.waitForTimeout(500);
  await dump(testInfo, host, hostLog.get(), "01-host-after-create");

  const code = await host.evaluate(() => {
    return document.querySelector("[data-active-code]")?.textContent?.trim() ?? "";
  });
  expect(code, "Room code captured from host UI").toMatch(/^[A-Z0-9]{4,8}$/);

  // Joiner enters via URL param (same path real users use after sharing the link).
  await join.goto(`/?room=${code}`);
  await join.waitForSelector("canvas", { timeout: 20_000 });
  await join.waitForTimeout(3500);
  await dump(testInfo, join, joinLog.get(), "02-joiner-in-room");

  // Snapshot stream on host should now show 2 players.
  await host.waitForTimeout(1500);
  await dump(testInfo, host, hostLog.get(), "03-host-after-join");

  const hostErrors = hostLog
    .get()
    .filter((e) => e.type === "error" || e.type === "pageerror");
  const joinErrors = joinLog
    .get()
    .filter((e) => e.type === "error" || e.type === "pageerror");

  await hostCtx.close();
  await joinCtx.close();

  expect(
    hostErrors,
    `Host JS errors after joiner connected:\n${hostErrors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
  ).toEqual([]);
  expect(
    joinErrors,
    `Joiner JS errors:\n${joinErrors.map((e) => `  [${e.type}] ${e.text}`).join("\n")}`,
  ).toEqual([]);
});
