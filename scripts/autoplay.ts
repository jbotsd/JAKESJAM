// Autoplay harness — an automated pilot that plays a WHOLE scripted game
// and records it (Jake, 2026-07-17: "automated bot that can move around,
// play effectively, whole scripted game, record it, light on resources").
//
//   bun scripts/autoplay.ts                 # light mode (default)
//   bun scripts/autoplay.ts --heavy         # content-testing mode
//   bun scripts/autoplay.ts --minutes 10    # longer session cap
//   bun scripts/autoplay.ts --url http://localhost:8088
//
// The full loop it drives (the real player journey, not a shortcut):
//   splash deep-link → VENUE LOBBY → walk to the bell (position-steered,
//   hops cover pylons) → queue → starter draft pick → admitted at the bell
//   → ARENA: seek/aim/fire/dodge pilot vs whoever is in the world, drafts
//   between rounds → match results → done. WebM lands in
//   tests/e2e/.artifacts/autoplay/.
//
// LIGHT (default): headless, 960×540, ?quality=potato (game's own lowest
// render tier: 0.75× scale, 30fps cap, baked rigs, fx off), music+sfx
// muted, clips consent off. ~1 chromium tab of load.
// HEAVY (--heavy): 1280×720 + quality=standard — for eyeballing new
// content (cards, maps, vfx) at representative fidelity.
//
// The pilot drives TRUSTED inputs (Playwright keyboard/mouse over CDP) at
// ~5Hz decisions — same event path as a human, so input bugs aren't
// bypassed. It is deliberately server-agnostic: point --url anywhere.

import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// ── args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const HEAVY = flag("heavy");
const BASE_URL = opt("url", "http://localhost:8088");
const MAX_MINUTES = Number(opt("minutes", HEAVY ? "10" : "6"));
const QUALITY = opt("quality", HEAVY ? "standard" : "potato");
const VIEW = HEAVY ? { width: 1280, height: 720 } : { width: 960, height: 540 };
const OUT_DIR = "tests/e2e/.artifacts/autoplay";
const BELL_X = 2250; // vessel-nexus bell totem (resolveVenueTotems)

type GameHandle = {
  __jakesjam_game__?: {
    scene: {
      isActive(k: string): boolean;
      getScene(k: string): unknown;
    };
  };
};

// ── page-side probes (single evaluate each — keep CDP chatter low) ─────
function probeArena(page: Page) {
  return page.evaluate(() => {
    type P = { x: number; y: number; alive: boolean; health: number; abilityCharge?: number };
    type Scene = {
      loop: { getRenderState(): { players: Record<string, P>; round: { phase: string } } | null } | null;
      localPlayerId: string;
      cameras: { main: { worldView: { x: number; y: number; width: number; height: number } } };
    };
    const g = (window as unknown as GameHandle).__jakesjam_game__;
    if (!g) return null;
    const inArena = g.scene.isActive("OnlineMatchScene");
    const scene = g.scene.getScene(
      inArena ? "OnlineMatchScene" : "HangoutScene",
    ) as Scene | null;
    const state = scene?.loop?.getRenderState();
    if (!scene || !state) return { inArena, phase: null, me: null, enemy: null, draftOpen: false, ended: false };
    const me = state.players[scene.localPlayerId] ?? null;
    // Nearest living enemy, projected into SCREEN space for real mouse aim.
    let enemy: { sx: number; sy: number; dist: number } | null = null;
    if (me) {
      const wv = scene.cameras.main.worldView;
      for (const [pid, p] of Object.entries(state.players)) {
        if (pid === scene.localPlayerId || !p.alive) continue;
        const dist = Math.hypot(p.x - me.x, p.y - me.y);
        if (!enemy || dist < enemy.dist) {
          enemy = {
            sx: ((p.x - wv.x) / wv.width) * window.innerWidth,
            sy: ((p.y - wv.y) / wv.height) * window.innerHeight,
            dist,
          };
        }
      }
    }
    const visible = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      // Overlay roots live in the DOM from scene-create — only a computed
      // visible display counts as "shown".
      return el !== null && getComputedStyle(el).display !== "none";
    };
    return {
      inArena,
      phase: state.round.phase,
      me: me
        ? { x: me.x, alive: me.alive, health: me.health, charge: me.abilityCharge ?? 0 }
        : null,
      enemy,
      draftOpen: visible("[data-card-draft]"),
      ended: visible("[data-match-results]"),
    };
  });
}

async function pickDraftCard(page: Page): Promise<void> {
  const plates = page.locator("[data-card-draft] [data-card-plate]");
  if ((await plates.count()) > 0) {
    await plates.nth(Math.floor(Math.random() * (await plates.count()))).click({ timeout: 2000 }).catch(() => {});
  }
}

// ── main ────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const startedAt = Date.now();
const deadline = startedAt + MAX_MINUTES * 60_000;
const pilotId = `autopilot_${Math.random().toString(36).slice(2, 8)}`;
const errors: string[] = [];

console.log(`[autoplay] ${HEAVY ? "HEAVY" : "light"} — ${VIEW.width}×${VIEW.height} quality=${QUALITY} cap=${MAX_MINUTES}min → ${BASE_URL}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEW,
  recordVideo: { dir: OUT_DIR, size: VIEW },
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 160));
});

await page.addInitScript((id) => {
  localStorage.setItem("jakesjam.playerId", id);
  localStorage.setItem("jakesjam.playerName", "AUTOPILOT");
  localStorage.setItem("jakesjam-ftue-first-draft-shown", "1");
  localStorage.setItem("jakesjam.musicMuted", "true");
  localStorage.setItem("jakesjam.sfxMuted", "true");
  localStorage.setItem("jakesjam.clipsConsent", "0");
  sessionStorage.setItem("jakesjam.sessionSuffix", "auto");
}, pilotId);

await page.goto(`${BASE_URL}/?world=1&gate=off&quality=${QUALITY}`);
await page.waitForSelector("#game-root canvas", { timeout: 30_000 });
await page.waitForFunction(
  () => (window as unknown as GameHandle).__jakesjam_game__?.scene.isActive("HangoutScene") ?? false,
  undefined,
  { timeout: 30_000 },
);
console.log(`[autoplay] in the venue lobby at +${Date.now() - startedAt}ms — walking to the bell`);
await page.waitForTimeout(1500);

// Phase 1: steer to the bell, queue, pick the starter card.
let prevX: number | null = null;
let queuedAt = 0;
while (Date.now() < deadline) {
  const probe = await probeArena(page);
  if (!probe?.me) {
    await page.waitForTimeout(400);
    continue;
  }
  if (probe.draftOpen) {
    await page.keyboard.up("d").catch(() => {});
    await page.keyboard.up("a").catch(() => {});
    await pickDraftCard(page);
    queuedAt = Date.now();
    console.log(`[autoplay] queued + starter pick at +${queuedAt - startedAt}ms — waiting for the bell`);
    break;
  }
  const x = probe.me.x;
  const stalled = prevX !== null && Math.abs(x - prevX) < 12;
  prevX = x;
  const key = x < BELL_X ? "d" : "a";
  await page.keyboard.down(key);
  if (stalled) {
    await page.keyboard.down("w");
    await page.waitForTimeout(220);
    await page.keyboard.up("w");
  }
  await page.waitForTimeout(400);
  await page.keyboard.up(key);
  if (Math.abs(x - BELL_X) < 60) await page.waitForTimeout(600);
}
if (queuedAt === 0) throw new Error("never reached the bell / no starter offer — see video");

// Phase 2: admitted → arena pilot until the match ends (or time cap).
await page.waitForFunction(
  () => (window as unknown as GameHandle).__jakesjam_game__?.scene.isActive("OnlineMatchScene") ?? false,
  undefined,
  { timeout: 200_000 },
);
console.log(`[autoplay] ADMITTED to the arena at +${Date.now() - startedAt}ms — piloting`);

let firing = false;
let strafeDir: "a" | "d" = "d";
let strafeFlipAt = 0;
let arenaPrevX: number | null = null;
let roundsSeen = new Set<string>();
let slotTapAt = 0;
let slotCursor = 0;

while (Date.now() < deadline) {
  const probe = await probeArena(page);
  if (!probe) break;
  if (probe.ended) {
    console.log(`[autoplay] match ended at +${Date.now() - startedAt}ms`);
    await page.waitForTimeout(3000); // results screen on tape
    break;
  }
  if (probe.phase) roundsSeen.add(probe.phase);
  if (probe.draftOpen) {
    if (firing) { await page.mouse.up(); firing = false; }
    await page.keyboard.up(strafeDir).catch(() => {});
    await pickDraftCard(page);
    await page.waitForTimeout(500);
    continue;
  }
  if (probe.phase !== "fighting" || !probe.me?.alive) {
    if (firing) { await page.mouse.up(); firing = false; }
    await page.keyboard.up(strafeDir).catch(() => {});
    await page.waitForTimeout(400);
    continue;
  }
  // FIGHT: aim at the nearest enemy, burst fire, keep mid-range, hop around.
  if (probe.enemy) {
    const sx = Math.max(4, Math.min(VIEW.width - 4, probe.enemy.sx));
    const sy = Math.max(4, Math.min(VIEW.height - 4, probe.enemy.sy));
    await page.mouse.move(sx, sy);
    if (!firing) { await page.mouse.down(); firing = true; }
    // Range discipline: close in when far, back off point-blank.
    const towardEnemy = probe.enemy.sx > VIEW.width / 2 ? "d" : "a";
    const want: "a" | "d" =
      probe.enemy.dist > 520 ? towardEnemy
      : probe.enemy.dist < 170 ? (towardEnemy === "d" ? "a" : "d")
      : strafeDir;
    if (want !== strafeDir || Date.now() > strafeFlipAt) {
      await page.keyboard.up(strafeDir).catch(() => {});
      strafeDir = want === strafeDir ? (strafeDir === "d" ? "a" : "d") : want;
      strafeFlipAt = Date.now() + 1200 + Math.random() * 1500;
      await page.keyboard.down(strafeDir);
    }
  } else if (firing) {
    await page.mouse.up();
    firing = false;
  }
  // Hop when stuck on geometry or just to be a harder target.
  const stalled = arenaPrevX !== null && probe.me && Math.abs(probe.me.x - arenaPrevX) < 8;
  arenaPrevX = probe.me?.x ?? null;
  if (stalled || Math.random() < 0.12) {
    await page.keyboard.down("w");
    await page.waitForTimeout(180);
    await page.keyboard.up("w");
  }
  // Shield bash (RMB, 3s cooldown) when someone is point-blank.
  if (probe.enemy && probe.enemy.dist < 200 && Math.random() < 0.3) {
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(60);
    await page.mouse.up({ button: "right" });
  }
  // EMISSION (six-axes): cast the moment the meter fills — the client only
  // sends the Ability bit at full predicted charge, so tapping E below
  // full is inert by design; gate here anyway to log real casts.
  if (probe.me.charge >= 100) {
    await page.keyboard.press("e").catch(() => {});
    console.log(`[autoplay] EMISSION cast at +${Date.now() - startedAt}ms`);
  }
  // Drafted actives (six-axes): rotate a tap across slots 1-4 every ~3s —
  // sim-validated no-ops for empty/cooling slots, real activations when a
  // drafted ability card is ready.
  if (Date.now() > slotTapAt) {
    slotTapAt = Date.now() + 3000 + Math.random() * 2000;
    slotCursor = (slotCursor % 4) + 1;
    await page.keyboard.press(String(slotCursor)).catch(() => {});
    console.log(`[autoplay] slot ${slotCursor} tap at +${Date.now() - startedAt}ms`);
  }
  await page.waitForTimeout(200); // ~5Hz decisions
}

// ── report ──────────────────────────────────────────────────────────────
if (firing) await page.mouse.up().catch(() => {});
const stats = await page
  .evaluate(() => localStorage.getItem("jakesjam.playerStats"))
  .catch(() => null);
const video = page.video();
await context.close(); // flushes the recording
await browser.close();
const videoPath = video ? await video.path().catch(() => "(unavailable)") : "(none)";

console.log("\n[autoplay] ── session report ─────────────────────────────");
console.log(`  duration : ${Math.round((Date.now() - startedAt) / 1000)}s (cap ${MAX_MINUTES}min)`);
console.log(`  phases   : ${[...roundsSeen].join(", ") || "(none seen)"}`);
console.log(`  record   : ${stats ?? "(no stats blob)"}`);
console.log(`  errors   : ${errors.length === 0 ? "none" : ""}`);
for (const e of errors.slice(0, 10)) console.log(`    - ${e}`);
console.log(`  video    : ${videoPath}`);
if (errors.length > 0) process.exitCode = 1;
