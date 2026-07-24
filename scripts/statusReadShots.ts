// Drives the live-Phaser construct harness (client/harness.html) headless and
// screenshots the Track-L STATUS READS (StatusVfxController: mark windows,
// self-windows, event one-shots) — the real planners + painters + pools, no
// live match scene or server needed. Two frames per read (cadence beat +
// follow-through) so the pooled transients are actually caught mid-life.
//
//   (dev server must be up: bun run --filter client dev  ->  :5173)
//   bun run scripts/statusReadShots.ts

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/d9fd0248-ff4f-49ff-85d4-ab426f99cd6a/scratchpad/status-reads";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 405 }, deviceScaleFactor: 2 });

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/harness.html`, { waitUntil: "load" });
await page.waitForFunction(
  () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
  { timeout: 20_000 },
);
await page.waitForTimeout(400);

const canvas = page.locator("#harness-root canvas");
const fire = (c: string) =>
  page.evaluate((s) => (window as unknown as { harnessFire: (x: string) => void }).harnessFire(s), c);

// Quiet the entanglement demo so the status reads are the loudest thing.
await fire("unmark");
await page.waitForTimeout(300);

// Sustained windows/marks: fire, let two cadence beats land, shoot twice.
const sustained = [
  "st-facet",
  "st-judgment",
  "st-read",
  "st-counter",
  "st-seal",
  "st-tithe",
  "st-measure",
  "st-surge",
  "st-vuln",
  "st-jam",
  "st-fooled",
  "st-aegis",
  "st-fangs",
  "st-resonance",
];
for (const name of sustained) {
  await fire("st-clear");
  await page.waitForTimeout(250);
  await fire(name);
  await page.waitForTimeout(420);
  await canvas.screenshot({ path: `${OUT}/${name}-a.png` });
  await page.waitForTimeout(180);
  await canvas.screenshot({ path: `${OUT}/${name}-b.png` });
}

// One-shot events: fire and catch the transient early in its life.
const oneShots = ["st-refund", "st-amped", "st-pierced", "st-contagion", "st-resglyph"];
for (const name of oneShots) {
  await fire("st-clear");
  await page.waitForTimeout(250);
  await fire(name);
  await page.waitForTimeout(70);
  await canvas.screenshot({ path: `${OUT}/${name}-a.png` });
  await page.waitForTimeout(90);
  await canvas.screenshot({ path: `${OUT}/${name}-b.png` });
}

await browser.close();
if (errors.length > 0) {
  console.error("PAGE ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`wrote ${sustained.length * 2 + oneShots.length * 2} frames to ${OUT}`);
