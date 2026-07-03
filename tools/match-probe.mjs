// Full-match lifecycle probe — plays an ENTIRE match with two bots and
// asserts every phase milestone the combat probe doesn't reach:
//
//   fighting → kill → round-over → drafting (auto-pick) → countdown →
//   next round → ... → match complete (target score) → WORLD RECYCLE →
//   fresh match starts with scores reset and both players alive.
//
// Records video (.match-probe/videos) + frames + a milestone report.
// Exits 1 if any milestone is never reached within its budget.
//
// Usage: bun tools/match-probe.mjs   (starts a server if none on :8088)

import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { autoPickDraft, ensureServer, extractFrames, joinWorld } from "./probeKit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".match-probe");
const VIDEO_DIR = join(OUT, "videos");
const FRAME_DIR = join(OUT, "frames");
const BASE = process.env.PROBE_BASE ?? "http://localhost:8088";

rmSync(FRAME_DIR, { recursive: true, force: true });
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync(FRAME_DIR, { recursive: true });

const serverProc = await ensureServer(ROOT, BASE);

const browser = await chromium.launch({ headless: true });

console.log("[probe] joining two bots...");
const a = await joinWorld(browser, BASE, "matchA", "m", { video: VIDEO_DIR });
const b = await joinWorld(browser, BASE, "matchB", "m");

const setGoal = (p, goal) => p.page.evaluate((g) => window.__setBotInput?.(g), goal);
const snap = () =>
  a.page.evaluate(() => ({
    phase: window.__simPhase?.() ?? null,
    players: window.__simPlayers?.() ?? null,
  }));

let shot = 0;
async function beat(tag) {
  const path = join(FRAME_DIR, `m-${String(shot++).padStart(2, "0")}-${tag}.png`);
  try { await a.page.screenshot({ path, timeout: 5000 }); } catch { /* video has it */ }
}

// Milestones, in expected order of first occurrence.
const milestones = {
  fighting: false,
  kill: false,
  roundOver: false,
  drafting: false,
  draftPicked: false,
  nextRound: false,       // roundIndex advanced past 0
  matchComplete: false,   // a score reached the target (3)
  recycled: false,        // scores reset to 0 with both players alive again
  postRecycleFighting: false,
};
const events = [];
const note = (k, extra = "") => {
  if (milestones[k]) return;
  milestones[k] = true;
  events.push({ k, t: Date.now() - t0, extra });
  console.log(`[probe] milestone: ${k} ${extra}`);
  return beat(k);
};

// Both bots: seek + fight continuously. Aim tracking + fire; the round
// machine does the rest (kills → scores → drafting → completion).
await setGoal(a, { moveTowardFoe: true, stopRangePx: 180, aimAtFoe: true, fire: true });
await setGoal(b, { moveTowardFoe: true, stopRangePx: 180, aimAtFoe: true, fire: true });

const t0 = Date.now();
const BUDGET_MS = 5 * 60_000;
let sawMaxScore = 0;
let postCompleteZeroScores = false;

while (Date.now() - t0 < BUDGET_MS) {
  const s = await snap();
  const ps = s.players ?? [];
  const scores = ps.map((p) => p.score ?? 0);
  const maxScore = Math.max(0, ...scores);

  if (s.phase === "fighting") {
    if (!milestones.fighting) await note("fighting");
    if (milestones.matchComplete && postCompleteZeroScores && !milestones.postRecycleFighting) {
      await note("postRecycleFighting");
      break; // full lifecycle proven
    }
  }
  if (ps.some((p) => !p.alive)) await note("kill");
  if (s.phase === "round-over") await note("roundOver");
  if (s.phase === "drafting") {
    await note("drafting");
    const picked = (await autoPickDraft(a.page)) | (await autoPickDraft(b.page));
    if (picked && !milestones.draftPicked) await note("draftPicked");
  }
  if (s.phase === "countdown" && milestones.roundOver && !milestones.nextRound) {
    await note("nextRound");
  }
  if (maxScore >= 3 && !milestones.matchComplete) {
    await note("matchComplete", `scores=${scores.join(",")}`);
  }
  if (milestones.matchComplete && maxScore === 0 && ps.length >= 2 && ps.every((p) => p.alive)) {
    if (!milestones.recycled) await note("recycled");
    postCompleteZeroScores = true;
  }
  sawMaxScore = Math.max(sawMaxScore, maxScore);
  await a.page.waitForTimeout(300);
}

await setGoal(a, null).catch(() => {});
await setGoal(b, null).catch(() => {});
await beat("final");

const vidA = await a.page.video()?.path();
await a.ctx.close();
await b.ctx.close();
await browser.close();
extractFrames(vidA, FRAME_DIR, "vid");
serverProc?.kill();

writeFileSync(join(OUT, "report.json"), JSON.stringify({ milestones, events, sawMaxScore }, null, 1));

console.log("");
console.log("── match probe report ───────────────────────────────");
for (const [k, v] of Object.entries(milestones)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
console.log(`  max score seen : ${sawMaxScore}`);
console.log(`  video          : ${VIDEO_DIR}`);
console.log(`  frames         : ${FRAME_DIR} (${readdirSync(FRAME_DIR).length})`);
console.log("─────────────────────────────────────────────────────");

const missed = Object.entries(milestones).filter(([, v]) => !v).map(([k]) => k);
if (missed.length) {
  console.error(`MATCH PROBE FAIL — never reached: ${missed.join(", ")}`);
  process.exit(1);
}
console.log("MATCH PROBE PASS — full lifecycle verified");
