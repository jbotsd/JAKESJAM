// bell-probe — does a browser client that walks the venue → bell → arena
// path actually end up as a PLAYER in the world match?
//
// Written 2026-08-09 after a footage run showed the autopilot "ADMITTED to
// the arena" while /health kept reporting humans=0, and the server logged
// "evicted player ... after 10000ms reconnect grace". A raw WebSocket
// straight to /ws/world is provably healthy (opens in ~13ms, streams
// snapshots indefinitely), so this isolates the HANDOFF rather than the
// socket.
//
//   bun tools/bell-probe.mjs [--url http://localhost:8088] [--seconds 75]
//
// Reads PASS if /health ever reports humans >= 1 while the probe is in the
// arena. Prints every websocket open/close and console error on the way.

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = opt("url", "http://localhost:8088");
const SECONDS = Number(opt("seconds", "75"));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const t0 = Date.now();
const at = () => `+${Math.round((Date.now() - t0) / 1000)}s`;

const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 300)));
page.on("websocket", (ws) => {
  const path = ws.url().split("?")[0].replace(BASE.replace(/^http/, "ws"), "");
  console.log(`[ws ${at()}] OPEN ${path}`);
  ws.on("close", () => console.log(`[ws ${at()}] CLOSE ${path}`));
  ws.on("socketerror", (err) => console.log(`[ws ${at()}] ERROR ${path} — ${err}`));
});

// ?fight = the Doors 1.6 fast lane (queued on arrival, no walk to the bell).
const url = `${BASE}/?world=1&gate=off&fight=1&quality=potato`;
console.log(`[probe] ${url}`);
await page.goto(url);

// A real visitor always arrives with a gesture (click/keypress) — headless
// does not. Supply one so a gesture-gated queue can't be mistaken for a bug.
await page.waitForTimeout(3000);
await page.mouse.click(640, 360).catch(() => {});
await page.keyboard.press("Space").catch(() => {});
await page.waitForTimeout(500);
await page.mouse.click(640, 360).catch(() => {});
console.log(`[probe ${at()}] sent user gesture (click + Space)`);

let maxHumans = 0;
const poll = setInterval(async () => {
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    maxHumans = Math.max(maxHumans, h.world.humans);
    const scene = await page.evaluate(() => {
      const g = window.__jakesjam_game__;
      if (!g) return "(no game handle)";
      return ["VenueScene", "OnlineMatchScene", "MatchScene", "LobbyScene", "SplashScene"]
        .filter((k) => { try { return g.scene.isActive(k); } catch { return false; } }).join(",") || "(none active)";
    }).catch(() => "(eval failed)");
    console.log(`${at()} humans=${h.world.humans} bots=${h.world.bots} phase=${h.world.phase} scene=${scene}`);
  } catch { /* transient */ }
}, 5000);

await page.waitForTimeout(SECONDS * 1000);
clearInterval(poll);

console.log("\n--- console errors ---");
if (errs.length === 0) console.log("  (none)");
for (const e of errs.slice(0, 15)) console.log("  " + e);

console.log(`\n[probe] RESULT: max humans seen = ${maxHumans} → ${maxHumans >= 1 ? "PASS (handoff works)" : "FAIL (client never became a server player)"}`);
await browser.close();
process.exitCode = maxHumans >= 1 ? 0 : 1;
