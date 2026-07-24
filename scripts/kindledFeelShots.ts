// Kindled feel-loop tape (slash-feel-ledger, wave 1) — deterministic
// rig-anchored filmstrips through the live-Phaser construct harness.
// Capture discipline: single-shots with explicit waits (no bursts);
// harnessRigFrame rebuilds the rig per requested frame so captures are
// independent of screenshot latency.
//
//   (dev server must be up: cd client && bun run dev)
//   BASE_URL=http://127.0.0.1:5173 bun run scripts/kindledFeelShots.ts

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/d9fd0248-ff4f-49ff-85d4-ab426f99cd6a/scratchpad/kindled-feel";
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

// Kindled full-body melee sentence — the exact phase boundaries from
// meleeTiming (anticipation ends 0.38, cut ends 0.61, follow 0.88).
const MELEE_TS = [0.0, 0.12, 0.25, 0.34, 0.38, 0.44, 0.5, 0.56, 0.61, 0.7, 0.8, 0.9, 0.99];
for (const t of MELEE_TS) {
  await rigFrame("paladin", "melee", t);
  await page.waitForTimeout(90);
  await canvas.screenshot({
    path: `${OUT}/${TAG}-melee-${String(Math.round(t * 100)).padStart(3, "0")}.png`,
  });
}

// Bash sentence (harness action "bash" — present once the bash render
// lands; skipped silently if the harness predates it).
const hasBash = await page.evaluate(
  () => (window as unknown as { __harnessHasBash?: boolean }).__harnessHasBash === true,
);
if (hasBash) {
  for (const t of MELEE_TS) {
    await rigFrame("paladin", "bash", t);
    await page.waitForTimeout(90);
    await canvas.screenshot({
      path: `${OUT}/${TAG}-bash-${String(Math.round(t * 100)).padStart(3, "0")}.png`,
    });
  }
}

// Idle / locomotion stances (harness actions "idle"/"run" — present once
// the braced-idle work lands; skipped silently before that).
const hasIdle = await page.evaluate(
  () => (window as unknown as { __harnessHasIdle?: boolean }).__harnessHasIdle === true,
);
if (hasIdle) {
  for (const [action, t] of [["idle", 0.5], ["run", 0.5]] as const) {
    await rigFrame("paladin", action, t);
    await page.waitForTimeout(120);
    await canvas.screenshot({ path: `${OUT}/${TAG}-${action}.png` });
  }
}

// Ward-brace stance (K11 — gamut "Ward raise/hold": braced set, knees
// bent, slab planted). Skipped silently on harnesses predating it.
const hasWard = await page.evaluate(
  () => (window as unknown as { __harnessHasWard?: boolean }).__harnessHasWard === true,
);
if (hasWard) {
  await rigFrame("paladin", "ward", 0.5);
  await page.waitForTimeout(120);
  await canvas.screenshot({ path: `${OUT}/${TAG}-ward.png` });
}

// Victim-channel chord (R1 rows 3-8 — the gamut's "hurt" row; K8 wave 2).
// "hurt" = ordinary Kindled contact, "hurt-kill" = kill tier (225ms victim
// hold + 67ms full-white). t runs over the harness's 700ms chord envelope:
// 0.00 impact frame (full-silhouette white + 12px flinch + 1.35/0.7 squash),
// 0.07 in-hold vibration, 0.14 flash decay / hold end (hit tier),
// 0.22 squash spring-back, 0.32 kill-hold end, 0.50 + 0.85 settle/quiet.
const hasHurt = await page.evaluate(
  () => (window as unknown as { __harnessHasHurt?: boolean }).__harnessHasHurt === true,
);
if (hasHurt) {
  const HURT_TS = [0.0, 0.07, 0.14, 0.22, 0.32, 0.5, 0.85];
  for (const action of ["hurt", "hurt-kill"] as const) {
    for (const t of HURT_TS) {
      await rigFrame("paladin", action, t);
      await page.waitForTimeout(90);
      await canvas.screenshot({
        path: `${OUT}/${TAG}-${action}-${String(Math.round(t * 100)).padStart(3, "0")}.png`,
      });
    }
  }
}

await browser.close();
if (errors.length) {
  console.log("PAGE ERRORS (port bug!):\n" + errors.slice(0, 20).join("\n"));
  process.exit(1);
}
console.log(`ok — wrote frames to ${OUT} (tag=${TAG})`);
