// Interstice feel-loop tape (slash-feel-ledger, wave 1 — the I-iterations) —
// deterministic rig-anchored filmstrips through the live-Phaser construct
// harness. Clone of kindledFeelShots.ts's capture discipline: single-shots
// with explicit waits (no bursts); harnessRigFrame rebuilds the rig per
// requested frame so captures are independent of screenshot latency.
//
//   (dev server must be up: cd client && bun run dev)
//   BASE_URL=http://127.0.0.1:5173 bun run scripts/intersticeFeelShots.ts

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/d9fd0248-ff4f-49ff-85d4-ab426f99cd6a/scratchpad/interstice-feel";
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const TAG = process.env.TAG ?? "base";

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
await page.waitForTimeout(300);

const canvas = page.locator("#harness-root canvas");

const rigFrame = (classId: string, action: string, t: number) =>
  page.evaluate(
    ({ classId, action, t }) =>
      (window as unknown as {
        harnessRigFrame: (c: string, a: string, t: number) => void;
      }).harnessRigFrame(classId as never, action as never, t),
    { classId, action, t },
  );

// Interstice full-body melee sentence — the exact phase boundaries from
// meleeTiming (anticipation ends 0.15, cut ends 0.42, follow 0.80), with
// extra samples inside the 66ms cut window (the whip is the whole read)
// and one at the contact fraction itself (0.334 — the sim-gate tick, I1).
const MELEE_TS = [0.0, 0.08, 0.15, 0.22, 0.28, 0.334, 0.38, 0.42, 0.5, 0.62, 0.8, 0.9, 0.99];
for (const t of MELEE_TS) {
  await rigFrame("ninja", "melee", t);
  await page.waitForTimeout(90);
  await canvas.screenshot({
    path: `${OUT}/${TAG}-melee-${String(Math.round(t * 100)).padStart(3, "0")}.png`,
  });
}

// Idle / locomotion stances — the gamut's "coiled, forward, blades low —
// already moving" rows.
for (const [action, t] of [["idle", 0.5], ["run", 0.5]] as const) {
  await rigFrame("ninja", action, t);
  await page.waitForTimeout(120);
  await canvas.screenshot({ path: `${OUT}/${TAG}-${action}.png` });
}

// Victim-channel chord at INTERSTICE numbers (R1 rows 3-8 I-column: 50ms
// pair stop, 117ms kill + 1.5x victim hold, 33+33ms flash, 4px flinch,
// 1.25/0.8 squash). t runs over the harness's 700ms chord envelope, with
// the early samples packed tight — the Interstice chord is over by ~150ms
// (0.21 of the envelope), far earlier than Kindled's.
const HURT_TS = [0.0, 0.04, 0.07, 0.1, 0.14, 0.21, 0.32, 0.5];
for (const action of ["hurt", "hurt-kill"] as const) {
  for (const t of HURT_TS) {
    await rigFrame("ninja", action, t);
    await page.waitForTimeout(90);
    await canvas.screenshot({
      path: `${OUT}/${TAG}-${action}-${String(Math.round(t * 100)).padStart(3, "0")}.png`,
    });
  }
}

await browser.close();
if (errors.length) {
  console.log("PAGE ERRORS (port bug!):\n" + errors.slice(0, 20).join("\n"));
  process.exit(1);
}
console.log(`ok — wrote frames to ${OUT} (tag=${TAG})`);
