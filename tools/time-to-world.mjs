// North-star instrument: URL → IN THE WORLD.
//
// The row above "first shot" is really "how long before the game exists
// around you". Defined here as: the local player has an entity in the
// authoritative state. Not "canvas appeared", not "socket opened" —
// those both happen while you are still nobody.
//
// Deliberately NOT measuring first-shot: the default chassis is hitscan
// and creates no projectile, so that metric needs a damage-based signal
// (the other session's timeToDummyHit spec).
//
//   bun tools/time-to-world.mjs --url http://localhost:8288 [--runs 3]

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = opt("url", "http://localhost:8288");
const RUNS = Number(opt("runs", "3"));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

async function once(returning) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (returning) {
    await page.addInitScript(() => {
      localStorage.setItem("jakesjam.identSeen", "1");
      localStorage.setItem("jakesjam.playerName", "PROBE");
      localStorage.setItem("jakesjam-ftue-controls-shown", "1");
    });
  }
  const t0 = Date.now();
  await page.goto(`${BASE}/?gate=off`, { waitUntil: "commit" });
  let inWorld = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const ok = await page
      .evaluate(() => {
        const id = window.__localPlayerId?.();
        const ps = window.__simPlayers?.();
        return !!(id && ps && ps.some((p) => p.id === id));
      })
      .catch(() => false);
    if (ok) { inWorld = Date.now() - t0; break; }
    await page.waitForTimeout(100);
  }
  await ctx.close();
  return inWorld;
}

for (const mode of ["first visit", "returning"]) {
  const times = [];
  for (let i = 0; i < RUNS; i += 1) times.push(await once(mode === "returning"));
  const ok = times.filter((t) => t !== null);
  console.log(
    `${mode.padEnd(12)} ${ok.length}/${RUNS}  ` +
      (ok.length ? `${ok.map((t) => (t / 1000).toFixed(1) + "s").join(", ")}  (median ${(ok.sort((a,b)=>a-b)[Math.floor(ok.length/2)]/1000).toFixed(1)}s)` : "never reached the world"),
  );
}
await browser.close();
