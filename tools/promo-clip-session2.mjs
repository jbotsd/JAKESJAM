// Promo-clip capture session #2 — same rig as promo-clip-session.mjs but
// tuned to let the game's OWN HighlightTracker (client/src/game/highlights/
// highlightRules.ts) fire the clip trigger organically off real
// multi-kill / chain-kill / parry-kill ground truth, instead of forcing a
// capture on every single kill. We keep window.__clipsTrigger() only as a
// fallback for the rare case where we can positively confirm (from
// __simPlayers score deltas) that a real highlight condition was met but
// didn't see the corresponding "[clips] highlight:" console line.
//
// Strategy to actually earn real highlights against 2 server AI bots:
//   - multi-kill (2 kills by me within 6s): keep continuous aggressive
//     engage+fire so any near-simultaneous bot deaths land close together.
//   - parry-kill (kill within 2s of a successful parry): periodically bump
//     parryToken while a bot is in range and likely mid-attack.
//   - chain-kill (lightning weapon splash-kills a second nearby player):
//     opportunistic only — prefer a "Lightning" draft card if offered, but
//     don't restructure the whole session around it (needs bots clustered).
//
// Does NOT boot or touch the server.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { healthy } from "./probeKit.mjs";

const BASE = process.env.PROBE_BASE ?? "http://localhost:8088";
const OUT_DIR = "/tmp/claude-1000/-home-jimothy/230c0343-c50b-4b15-bcce-8a7728a73e8b/scratchpad/promo-session2";
mkdirSync(OUT_DIR, { recursive: true });

if (!(await healthy(BASE))) {
  console.error(`promo-session2: ${BASE}/health not OK — refusing to start`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[PAGEERROR]", String(e).slice(0, 300)));

const realHighlights = []; // { tMs, label, playerId }
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("[clips] highlight:")) {
    const tMs = Date.now() - startedAt;
    console.log(`[page] ${t}`);
    realHighlights.push({ tMs, text: t });
  } else if (t.includes("[clips] uploaded")) {
    console.log(`[page] ${t}`);
  }
});

await page.addInitScript(([key, val]) => {
  localStorage.setItem(key, val);
}, ["jakesjam.playerId", "player_promo2"]);

console.log(`[session2] joining ${BASE}/?world=1&clips=1 ...`);
await page.goto(`${BASE}/?world=1&clips=1`, { waitUntil: "load" });

const players = () => page.evaluate(() => window.__simPlayers?.() ?? null);
const phase = () => page.evaluate(() => window.__simPhase?.() ?? null);
const localId = () => page.evaluate(() => window.__localPlayerId?.() ?? null);
const setGoal = (goal) => page.evaluate((g) => window.__setBotInput?.(g), goal);
const triggerClip = () => page.evaluate(() => window.__clipsTrigger?.());

const pickDraft = () =>
  page.evaluate(() => {
    const root = document.querySelector("[data-card-draft]");
    if (!root) return false;
    if (getComputedStyle(root).display === "none") return false;
    const rarities = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
    const tags = [...root.querySelectorAll("div")].filter((d) =>
      rarities.includes((d.textContent ?? "").trim()),
    );
    if (tags.length === 0) return false;
    // Prefer a card whose card container mentions Lightning (chain-kill bait).
    let chosen = null;
    for (const tag of tags) {
      const card = tag.parentElement;
      if (card && /lightning/i.test(card.textContent ?? "")) {
        chosen = card;
        break;
      }
    }
    if (!chosen) chosen = tags[0].parentElement;
    if (!chosen) return false;
    chosen.click();
    return true;
  });

let myId = null;
const startedAt = Date.now();
for (let i = 0; i < 60; i++) {
  const ps = await players();
  const ph = await phase();
  myId = await localId();
  if (ps && myId && ps.some((p) => p.id === myId) && ps.length >= 2) {
    console.log(`[session2] joined as ${myId}; phase=${ph}; players=${ps.length}`);
    if (ph === "fighting") break;
  }
  await page.waitForTimeout(1000);
}
if (!myId) {
  console.error("[session2] never got a local player id — aborting");
  await ctx.close();
  await browser.close();
  process.exit(1);
}

const events = [];
const log = (msg) => {
  console.log(`[session2] ${msg}`);
  events.push({ tMs: Date.now() - startedAt, msg });
};

let clipsFired = 0; // manual fallback triggers only
const MAX_MANUAL = 3;
const MIN_GAP_MS = 25_000;
let lastClipAt = 0;

async function fireClipFallback(reason) {
  if (clipsFired >= MAX_MANUAL) return;
  const now = Date.now();
  if (now - lastClipAt < MIN_GAP_MS) return;
  await triggerClip();
  clipsFired += 1;
  lastClipAt = now;
  log(`FALLBACK CLIP TRIGGERED (#${clipsFired}): ${reason}`);
}

// Continuous aggressive engage — never reset unnecessarily, keep pressure on
// so bot deaths cluster and parry windows come up naturally under fire.
await setGoal({ moveTowardFoe: true, stopRangePx: 130, aimAtFoe: true, fire: true });
log("engaging continuously: moveTowardFoe + aimAtFoe + fire");

let myKillTimestamps = []; // wall-clock ms of my own confirmed kills (score deltas)
let prevAliveById = new Map();
let prevScoreById = new Map();
let parryTokenCounter = 0;
let lastParryBumpAt = 0;
const PARRY_BUMP_INTERVAL_MS = 3500;

const SESSION_MS = 4 * 60_000; // budget-conscious per coordinator guidance

while (Date.now() - startedAt < SESSION_MS) {
  const ph = await phase();
  if (ph === "drafting") {
    const picked = await pickDraft();
    if (picked) log("auto-picked draft card (preferring Lightning if offered)");
    await page.waitForTimeout(400);
    continue;
  }

  const list = await players();
  if (!list) {
    await page.waitForTimeout(250);
    continue;
  }
  const me = list.find((p) => p.id === myId);
  const foes = list.filter((p) => p.id !== myId);

  // Re-assert engage goal (cheap; keeps it alive across round/respawn resets)
  // without spamming it every tick (every ~1.2s is plenty).
  if (Date.now() - lastParryBumpAt > 1200) {
    await setGoal({ moveTowardFoe: true, stopRangePx: 130, aimAtFoe: true, fire: true });
  }

  // Opportunistic parry: bump the token periodically while a foe is close
  // (likely shooting back), to try to catch a real parry-deflect. The bot
  // driver briefly asserts the Ability bit on each new token (rising edge).
  const nearFoe = foes.some((f) => f.alive && me && Math.hypot(f.x - me.x, f.y - me.y) < 260);
  if (nearFoe && Date.now() - lastParryBumpAt > PARRY_BUMP_INTERVAL_MS) {
    parryTokenCounter += 1;
    lastParryBumpAt = Date.now();
    await setGoal({ moveTowardFoe: true, stopRangePx: 130, aimAtFoe: true, fire: true, parryToken: parryTokenCounter });
  }

  for (const f of foes) {
    const wasAlive = prevAliveById.get(f.id);
    if (wasAlive === true && f.alive === false) {
      log(`foe died: ${f.id}`);
    }
    prevAliveById.set(f.id, f.alive);
  }

  if (me) {
    const prevScore = prevScoreById.get(me.id) ?? 0;
    if (me.score > prevScore) {
      const now = Date.now();
      myKillTimestamps.push(now);
      myKillTimestamps = myKillTimestamps.filter((t) => now - t <= 6000);
      log(`my score increased ${prevScore} -> ${me.score} (kills in last 6s: ${myKillTimestamps.length})`);
      // Fallback: if we independently confirm a real multi-kill condition
      // (2+ of my kills within 6s) but never saw the console highlight line
      // for it, force a capture so the moment isn't lost.
      const sawMultiKillLine = realHighlights.some(
        (h) => h.text.includes("Multi-kill") && Math.abs(h.tMs - (now - startedAt)) < 4000,
      );
      if (myKillTimestamps.length >= 2 && !sawMultiKillLine) {
        await fireClipFallback(`confirmed multi-kill (${myKillTimestamps.length} kills/6s) with no matching console line`);
      }
    }
    prevScoreById.set(me.id, me.score);
  }

  await page.waitForTimeout(300);
}

log(`session2 done: manualFallbackClips=${clipsFired}, realHighlightsSeen=${realHighlights.length}`);
await setGoal(null).catch(() => {});
await page.waitForTimeout(4000);

const videoPath = await page.video()?.path();
await ctx.close();
await browser.close();

writeFileSync(
  join(OUT_DIR, "session-log.json"),
  JSON.stringify({ clipsFired, realHighlights, events, videoPath }, null, 2),
);
console.log(`[session2] full video: ${videoPath}`);
console.log(`[session2] log: ${join(OUT_DIR, "session-log.json")}`);
console.log(`[session2] manual fallback clips fired: ${clipsFired}`);
console.log(`[session2] REAL highlight console lines seen: ${realHighlights.length}`);
for (const h of realHighlights) console.log(`  t=${h.tMs}ms  ${h.text}`);
