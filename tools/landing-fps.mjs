// Client frame budget on the LANDING — the venue, since Doors 1.1.
//
// The server side is measured (soak /health perf). The client side never
// was, and the venue is now the first thing every visitor renders: crowd,
// loadout table, rig, VFX, HUD. A landing that stutters is a worse first
// impression than a landing that is plain.
//
// Samples requestAnimationFrame deltas in-page — the real presented
// cadence, not a synthetic loop. Reports p50/p95/worst and the share of
// genuinely missed frames (>20ms; see the threshold's own note).
//
// READ THE CAVEAT: headless Chromium rasterises in SOFTWARE. These
// numbers are a RELATIVE comparison between viewports and quality tiers,
// not an absolute claim about a real machine with a GPU. A 1080p figure
// here says "this is the heaviest case", not "this is what players get".
//
//   bun tools/landing-fps.mjs --url http://localhost:8288 [--seconds 12]

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = opt("url", "http://localhost:8288");
const SECONDS = Number(opt("seconds", "12"));

const CASES = [
  { name: "desktop/auto", w: 1920, h: 1080, q: "" },
  { name: "short-desktop", w: 1280, h: 700, q: "" },
  { name: "phone/auto", w: 393, h: 852, q: "" },
  { name: "phone/potato", w: 393, h: 852, q: "potato" },
];

const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
for (const c of CASES) {
  const ctx = await b.newContext({ viewport: { width: c.w, height: c.h } });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("jakesjam.identSeen", "1"));
  await p.goto(`${BASE}/?gate=off${c.q ? `&quality=${c.q}` : ""}`, { waitUntil: "load" });
  await p.waitForSelector("canvas:not(.ident-shader)", { timeout: 30_000 });
  await p.waitForTimeout(8_000); // settle: connect + first draws

  const stats = await p.evaluate((secs) => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const end = last + secs * 1000;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else {
        const s = deltas.slice(1).sort((a, b) => a - b);
        const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
        resolve({
          frames: s.length,
          p50: at(0.5), p95: at(0.95), worst: s[s.length - 1],
          // >20ms, not >16.67ms. At a 60Hz vsync the deltas cluster a
          // hair ABOVE 16.67 by definition, so the tighter threshold
          // marks a locked, perfectly smooth 60fps as "62% dropped" —
          // a scary number that means nothing. 20ms is the first delta
          // that cannot be explained by vsync jitter.
          dropped: s.filter((d) => d > 20).length,
        });
      }
    };
    requestAnimationFrame(tick);
  }), SECONDS);

  const pct = ((stats.dropped / stats.frames) * 100).toFixed(0);
  console.log(
    `${c.name.padEnd(15)} p50 ${stats.p50.toFixed(1)}ms  p95 ${stats.p95.toFixed(1)}ms  ` +
      `worst ${stats.worst.toFixed(0)}ms  over-budget ${pct}%  (${stats.frames} frames)`,
  );
  await ctx.close();
}
await b.close();
