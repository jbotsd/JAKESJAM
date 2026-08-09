// Composite viewport sweep — L7 ("sizing on fleek") for a whole session
// rather than one change at a time.
//
// Every UI change tonight was checked in isolation and passed. That is
// not the same as checking them TOGETHER: the Settings panel grew a
// Controls section, the venue grew a legend and an encounter glyph, the
// splash strip changed shape, and two transient strips now share the
// bottom of the screen. Individually fine, collectively unverified.
//
// Checks the two surfaces that actually gained content, at every
// canonical viewport (docs/ui-axioms.md § "The canonical viewport
// pass"), and fails on the two things a screenshot alone will not tell
// you: a collapsed canvas and horizontal overflow.
//
//   bun tools/viewport-sweep.mjs --url http://localhost:8288

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = opt("url", "http://localhost:8288");
const OUT = "tests/e2e/.artifacts/sweep";

const VIEWPORTS = [
  { name: "phone", width: 393, height: 852 },
  { name: "phone-landscape", width: 852, height: 393 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "short-desktop", width: 1280, height: 700 },
  { name: "desktop", width: 1920, height: 1080 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
let failures = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await page.addInitScript(() => localStorage.setItem("jakesjam.identSeen", "1"));

  // 1. The venue landing, with the FTUE legend up.
  await page.goto(`${BASE}/?gate=off`, { waitUntil: "load" });
  await page.waitForSelector("canvas:not(.ident-shader)", { timeout: 30_000 });
  await page.waitForTimeout(7_000);
  const overflowVenue = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const box = await page.locator("canvas:not(.ident-shader)").first().boundingBox();
  await page.screenshot({ path: `${OUT}/${vp.name}-venue.png` });

  // 2. Settings, which grew the Controls reference.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("jakesjam:shell-goto", { detail: { place: "settings" } }),
    ),
  );
  await page.waitForTimeout(900);
  const settings = await page.evaluate(() => {
    const el = document.querySelector("[data-options]");
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return {
      // A panel taller than the viewport is fine IF it scrolls; one that
      // overflows the viewport WIDTH is never fine.
      widthOverflow: Math.max(0, r.right - document.documentElement.clientWidth),
      scrollable: el.scrollHeight > el.clientHeight,
      controls: document.querySelectorAll("[data-controls-ref] dt").length,
    };
  });
  await page.screenshot({ path: `${OUT}/${vp.name}-settings.png` });

  const bad = [];
  if (!box || box.height < 200) bad.push("canvas collapsed");
  if (overflowVenue > 1) bad.push(`venue h-overflow ${overflowVenue}px`);
  if (!settings) bad.push("settings did not open");
  else {
    if (settings.widthOverflow > 1) bad.push(`settings h-overflow ${settings.widthOverflow}px`);
    if (settings.controls !== 8) bad.push(`controls rows ${settings.controls} (want 8)`);
  }
  if (errs.length) bad.push(`pageerror: ${errs[0]}`);

  if (bad.length) failures += 1;
  console.log(
    `${vp.name.padEnd(16)} ${bad.length ? "FAIL  " + bad.join("; ") : "ok"}`,
  );
  await ctx.close();
}

await browser.close();
console.log(`\n[sweep] ${VIEWPORTS.length - failures}/${VIEWPORTS.length} viewports clean → ${OUT}/`);
process.exit(failures === 0 ? 0 : 1);
