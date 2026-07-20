// Drives the live-Phaser construct harness (client/harness.html) headless and
// screenshots it: a motion filmstrip during the entanglement hold (breathing +
// mote travel + tracking a moving victim) plus one frame each for bind / snap /
// blade / lance. Captures page errors so a runtime port bug surfaces.
//
//   (dev server must be up: bun run --filter client dev  ->  :5173)
//   bun run scripts/constructHarnessShots.ts

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/bdaafd55-35f4-4e8d-8220-c0994e3ca7bc/scratchpad/construct-live";
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
await page.waitForFunction(() => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true, {
  timeout: 20_000,
});
await page.waitForTimeout(400); // let a few constructs spawn

const canvas = page.locator("#harness-root canvas");

const fire = (c: string) =>
  page.evaluate((s) => (window as unknown as { harnessFire: (x: string) => void }).harnessFire(s), c);

// Motion filmstrip during the hold — the real controller drives a breathing
// thread + mote crawl while the victim orbits (mark is on by default).
for (let i = 0; i < 8; i++) {
  await canvas.screenshot({ path: `${OUT}/hold-${String(i).padStart(2, "0")}.png` });
  await page.waitForTimeout(70);
}

// snap — expire the mark; the controller fires the snap on the pair going un-live.
await fire("unmark");
await page.waitForTimeout(80);
await canvas.screenshot({ path: `${OUT}/snap.png` });
await page.waitForTimeout(260);

// bind — re-apply the mark; the controller fires the bind on the catch.
await fire("mark");
await page.waitForTimeout(80);
await canvas.screenshot({ path: `${OUT}/bind.png` });
await page.waitForTimeout(260);

// Drop the entanglement first so these read in isolation (no tether overlap).
await fire("unmark");
await page.waitForTimeout(400); // let the snap fire + the thread clear
// Interstice blade — burst-capture the animated SWEEP (whips through the arc).
// Fire, let the scene's next update consume the command + spawn, THEN sample.
for (let i = 0; i < 18; i++) {
  await page.evaluate(
    ({ kind, t }) => (window as unknown as {
      harnessMeleeFrame: (k: "ninja" | "paladin", p: number) => void;
    }).harnessMeleeFrame(kind, t),
    { kind: "ninja" as const, t: i / 17 },
  );
  await page.waitForTimeout(20);
  await canvas.screenshot({ path: `${OUT}/blade-sweep-${String(i).padStart(2, "0")}.png` });
}
await page.waitForTimeout(200);
await fire("shards");
await page.waitForTimeout(90);
await canvas.screenshot({ path: `${OUT}/geo-shards.png` });
await page.waitForTimeout(240);

// Kindled divine ward — switch demo, then the four reads + the Kindled Edge.
await fire("kindled");
await page.waitForTimeout(120);
await fire("raise");
await page.waitForTimeout(90);
await canvas.screenshot({ path: `${OUT}/ward-raise.png` });
await page.waitForTimeout(260); // let the shell settle to hold
for (let i = 0; i < 3; i++) {
  await canvas.screenshot({ path: `${OUT}/ward-hold-${i}.png` });
  await page.waitForTimeout(80);
}
await fire("absorb");
await page.waitForTimeout(90);
await canvas.screenshot({ path: `${OUT}/ward-absorb.png` });
await page.waitForTimeout(280);
for (let i = 0; i < 22; i++) {
  await page.evaluate(
    ({ kind, t }) => (window as unknown as {
      harnessMeleeFrame: (k: "ninja" | "paladin", p: number) => void;
    }).harnessMeleeFrame(kind, t),
    { kind: "paladin" as const, t: i / 21 },
  );
  await page.waitForTimeout(20);
  await canvas.screenshot({ path: `${OUT}/kindled-edge-${String(i).padStart(2, "0")}.png` });
}
await fire("drop");
await page.waitForTimeout(110);
await canvas.screenshot({ path: `${OUT}/ward-drop.png` });

// Phase 3 primitives (2026-07-20) — nova/blink/dodge are one-shot bursts
// (capture mid-flight, not just the end frame); aura/field are continuous
// toggles (capture a held frame once settled).
for (const kind of ["nova-slash", "nova-ooze", "nova-shatter", "nova-seal"]) {
  await fire(kind);
  await page.waitForTimeout(90);
  await canvas.screenshot({ path: `${OUT}/${kind}.png` });
  await page.waitForTimeout(240);
}

for (const kind of ["blink-trail", "blink-commit"]) {
  await fire(kind);
  await page.waitForTimeout(90);
  await canvas.screenshot({ path: `${OUT}/${kind}.png` });
  await page.waitForTimeout(220);
}

await fire("dodge");
await page.waitForTimeout(70);
await canvas.screenshot({ path: `${OUT}/dodge.png` });
await page.waitForTimeout(160);

for (const kind of ["aura-slash", "aura-ooze", "aura-shatter", "aura-seal"]) {
  await fire(kind); // toggle ON
  await page.waitForTimeout(180); // let it settle into its orbit/pulse
  await canvas.screenshot({ path: `${OUT}/${kind}.png` });
  await fire(kind); // toggle OFF before the next one so they don't stack
  await page.waitForTimeout(60);
}

await fire("field"); // toggle ON
await page.waitForTimeout(120);
await canvas.screenshot({ path: `${OUT}/field.png` });
await fire("field"); // toggle OFF

await browser.close();
if (errors.length) {
  console.log("PAGE ERRORS (port bug!):\n" + errors.slice(0, 20).join("\n"));
  process.exit(1);
}
console.log(`ok — wrote frames to ${OUT}`);
