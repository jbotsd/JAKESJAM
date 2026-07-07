// Promo-clip capture session — drives ONE real player against the persistent
// pub world's server-side AI bots (WORLD_BOTS=2), using the in-page combat
// driver (window.__setBotInput) for reliable engagement timing — see
// tools/combat-probe.mjs's header comment: raw CDP keyboard/mouse events
// stall/wedge on a loaded host, so control is moved in-page exactly like the
// existing combat probe does. Forces highlight captures via
// window.__clipsTrigger() right after kills/big moments (read via
// window.__simPlayers()), instead of waiting on rare organic highlight RNG.
//
// Does NOT boot or touch the server — assumes :8088 is already live (the
// self-hosted pub world). Never calls ensureServer's spawn path in practice
// since the server is already healthy.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { healthy } from "./probeKit.mjs";

const BASE = process.env.PROBE_BASE ?? "http://localhost:8088";
const OUT_DIR = "/tmp/claude-1000/-home-jimothy/230c0343-c50b-4b15-bcce-8a7728a73e8b/scratchpad/promo-session";
mkdirSync(OUT_DIR, { recursive: true });

if (!(await healthy(BASE))) {
  console.error(`promo-session: ${BASE}/health not OK — refusing to start (this script must not boot the server)`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[PAGEERROR]", String(e).slice(0, 300)));
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[clips]")) console.log("[page]", t);
});

await page.addInitScript(([key, val]) => {
  localStorage.setItem(key, val);
}, ["jakesjam.playerId", "player_promo1"]);

console.log(`[session] joining ${BASE}/?world=1&clips=1 ...`);
await page.goto(`${BASE}/?world=1&clips=1`, { waitUntil: "load" });

const players = () => page.evaluate(() => window.__simPlayers?.() ?? null);
const phase = () => page.evaluate(() => window.__simPhase?.() ?? null);
const localId = () => page.evaluate(() => window.__localPlayerId?.() ?? null);
const setGoal = (goal) => page.evaluate((g) => window.__setBotInput?.(g), goal);
const triggerClip = () => page.evaluate(() => window.__clipsTrigger?.());

// Wait for the world to boot and our player to be present + fighting.
let myId = null;
for (let i = 0; i < 60; i++) {
  const ps = await players();
  const ph = await phase();
  myId = await localId();
  if (ps && myId && ps.some((p) => p.id === myId) && ps.length >= 2) {
    console.log(`[session] joined as ${myId}; phase=${ph}; players=${ps.length}`);
    if (ph === "fighting") break;
  }
  await page.waitForTimeout(1000);
}
if (!myId) {
  console.error("[session] never got a local player id — aborting");
  await ctx.close();
  await browser.close();
  process.exit(1);
}

const events = [];
const log = (msg) => {
  console.log(`[session] ${msg}`);
  events.push({ tMs: Date.now() - startedAt, msg });
};

const startedAt = Date.now();
let clipsFired = 0;
const MAX_CLIPS = 5;
const MIN_GAP_MS = 25_000; // pace well under the 6/5min cap
let lastClipAt = 0;

async function fireClip(reason) {
  if (clipsFired >= MAX_CLIPS) return;
  const now = Date.now();
  if (now - lastClipAt < MIN_GAP_MS) return;
  await triggerClip();
  clipsFired += 1;
  lastClipAt = now;
  log(`CLIP TRIGGERED (#${clipsFired}): ${reason}`);
}

// Aggressive engage-and-fire goal the whole session; we just watch state and
// time forced clip triggers around kills / near-death survivals.
await setGoal({ moveTowardFoe: true, stopRangePx: 140, aimAtFoe: true, fire: true });
log("engaging: moveTowardFoe + aimAtFoe + fire");

let prevAliveById = new Map();
let prevScoreById = new Map();
let myLowHealthStreak = 0;
const SESSION_MS = 6 * 60_000; // 6 minutes of live play

while (Date.now() - startedAt < SESSION_MS && clipsFired < MAX_CLIPS) {
  const ph = await phase();
  if (ph === "drafting") {
    // Auto-pick first card so the match keeps progressing.
    const picked = await page.evaluate(() => {
      const root = document.querySelector("[data-card-draft]");
      if (!root) return false;
      if (getComputedStyle(root).display === "none") return false;
      const rarities = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
      const tag = [...root.querySelectorAll("div")].find((d) =>
        rarities.includes((d.textContent ?? "").trim()),
      );
      const card = tag?.parentElement;
      if (!card) return false;
      card.click();
      return true;
    });
    if (picked) log("auto-picked draft card");
    await page.waitForTimeout(400);
    continue;
  }

  const list = await players();
  if (!list) {
    await page.waitForTimeout(300);
    continue;
  }
  const me = list.find((p) => p.id === myId);
  const foes = list.filter((p) => p.id !== myId);

  // Re-assert the engage goal periodically (round transitions can reset it).
  await setGoal({ moveTowardFoe: true, stopRangePx: 140, aimAtFoe: true, fire: true });

  // Detect a foe death since last sample -> my kill (score-based confirm).
  for (const f of foes) {
    const wasAlive = prevAliveById.get(f.id);
    if (wasAlive === true && f.alive === false) {
      await fireClip(`kill on ${f.id}`);
    }
    prevAliveById.set(f.id, f.alive);
  }
  if (me) {
    const prevScore = prevScoreById.get(me.id) ?? 0;
    if (me.score > prevScore) {
      await fireClip(`my score increased ${prevScore} -> ${me.score}`);
    }
    prevScoreById.set(me.id, me.score);

    // Clutch-survival moment: I dip under 25 HP but am still alive after
    // having been in that danger zone for a bit (a close call worth a clip).
    if (me.alive && me.health > 0 && me.health <= 25) {
      myLowHealthStreak += 1;
      if (myLowHealthStreak === 6) { // ~1.8s of sustained danger
        await fireClip(`clutch low-health moment (hp=${me.health})`);
      }
    } else {
      myLowHealthStreak = 0;
    }

    if (!me.alive) {
      log(`I died (will respawn) — score=${me.score}`);
    }
  }

  await page.waitForTimeout(300);
}

log(`session done: clipsFired=${clipsFired}`);
await setGoal(null).catch(() => {});
await page.waitForTimeout(4000); // let the last pending segment finish/upload

const videoPath = await page.video()?.path();
await ctx.close();
await browser.close();

writeFileSync(join(OUT_DIR, "session-log.json"), JSON.stringify({ clipsFired, events, videoPath }, null, 2));
console.log(`[session] full video: ${videoPath}`);
console.log(`[session] log: ${join(OUT_DIR, "session-log.json")}`);
console.log(`[session] clips fired: ${clipsFired}`);
