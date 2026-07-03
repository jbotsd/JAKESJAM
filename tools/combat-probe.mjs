// Combat probe — "a way to look at combat".
//
// Boots the game server (unless one is already on :8088), joins the live
// world with two scripted players, walks them into range, and runs a
// combat choreography: exchange fire → shield under pressure → parry.
// Everything is recorded:
//
//   .combat-probe/videos/  — full 1280x720 webm per player (watch these)
//   .combat-probe/frames/  — ffmpeg-extracted stills (for agents / quick scan)
//   .combat-probe/report.json — health timeline + shield/parry observations
//
// The probe FAILS (exit 1) if no damage lands in 45s of contact — that
// means core combat is broken, not just unobserved.
//
// Usage:
//   bun tools/combat-probe.mjs           # headless, records video
//
// Player state is read via the window.__simPlayers() debug hook
// (client/src/debug/wasmStateProbe.ts), so assertions run against the
// actual predicted WorldState, not pixels.

import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { autoPickDraft, ensureServer, extractFrames, joinWorld, lastPlayerSample } from "./probeKit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".combat-probe");
const VIDEO_DIR = join(OUT, "videos");
const FRAME_DIR = join(OUT, "frames");
const BASE = process.env.PROBE_BASE ?? "http://localhost:8088";

// System-load sanity: on a saturated box (DAW, provers, builds) the probe's
// control loop stalls and results get flaky. Warn loudly so nobody chases
// game bugs that are actually host-load artifacts.
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
const load1 = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const loadRatio = load1 / cpus().length;
if (loadRatio > 0.8) {
  console.warn(
    `[probe] WARNING: system load ${load1.toFixed(1)} on ${cpus().length} cores ` +
      `(${Math.round(loadRatio * 100)}%). Timing-sensitive observations ` +
      `(parry windows, TTK) may be unreliable on this run.`,
  );
}

mkdirSync(VIDEO_DIR, { recursive: true });
// Fresh frames every run — stale beats from a prior run poison analysis.
import { rmSync } from "node:fs";
rmSync(FRAME_DIR, { recursive: true, force: true });
mkdirSync(FRAME_DIR, { recursive: true });

const serverProc = await ensureServer(ROOT, BASE);

const P1 = "probeA";
const P2 = "probeB";

const browser = await chromium.launch({ headless: true });

console.log("[probe] joining world with two players...");
const a = await joinWorld(browser, BASE, P1, "p", { video: VIDEO_DIR });
// No video on B: two parallel encoders saturate the CPU and stall the
// control loop (observed: 10-17s evaluate gaps that wedged held keys).
const b = await joinWorld(browser, BASE, P2, "p");

const players = (page) => page.evaluate(() => window.__simPlayers?.() ?? null);
const phase = (page) => page.evaluate(() => window.__simPhase?.() ?? null);
/** One round-trip for everything the loop needs. */
const sample = (page) =>
  page.evaluate(() => ({
    players: window.__simPlayers?.() ?? null,
    phase: window.__simPhase?.() ?? null,
    rigs: window.__rigDebug?.() ?? null,
  }));

// Wait until both players are in the sim and the round is live.
for (let i = 0; i < 60; i++) {
  const ps = await players(a.page);
  const ph = await phase(a.page);
  if (ps && ps.length >= 2 && ph === "fighting") break;
  await a.page.waitForTimeout(1000);
}
{
  const ps = await players(a.page);
  const ph = await phase(a.page);
  if (!ps || ps.length < 2 || ph !== "fighting") {
    console.error(`combat-probe: never reached fighting with 2 players (phase=${ph}, players=${ps?.length})`);
    await browser.close();
    serverProc?.kill();
    process.exit(1);
  }
}
console.log("[probe] fighting phase, both players in. Beginning choreography.");

const me = (list, id) => list.find((p) => p.id === id);
const foe = (list, id) => list.find((p) => p.id !== id);

const timeline = [];
const seen = { shield: false, parry: false, damage: false, kill: false, draft: false };
const started = Date.now();
let beatShots = 0;

async function snapshotBeat(tag) {
  const path = join(FRAME_DIR, `beat-${String(beatShots).padStart(2, "0")}-${tag}.png`);
  beatShots += 1;
  try {
    await a.page.screenshot({ path, timeout: 5000 });
  } catch {
    /* font-load stall — video still has the frame */
  }
}

// ── Choreography loop ────────────────────────────────────────────────
// Control runs IN-PAGE via the bot driver (__setBotInput): the probe only
// flips goal flags, so host load can't wedge keys or miss combat windows.
// approach → B shields → B parries → slugfest (fire until damage/kill).
let stage = "approach";
let stageStarted = Date.now();
const setStage = (s) => {
  console.log(`[probe] stage: ${s}`);
  stage = s;
  stageStarted = Date.now();
};

const setGoal = (page, goal) => page.evaluate((g) => window.__setBotInput?.(g), goal);

let rigProblem = null;
let rigBadStreak = 0;
let parryTokenCounter = 0;

// Initial goals: both walk in and track aim.
await setGoal(a.page, { moveTowardFoe: true, stopRangePx: 200, aimAtFoe: true });
await setGoal(b.page, { moveTowardFoe: true, stopRangePx: 200, aimAtFoe: true });

while (Date.now() - started < 90_000) {
  const snap = await sample(a.page);
  const list = snap.players;
  const ph = snap.phase;

  // Renderer-truth check: an alive player whose rig is hidden, or drawn far
  // from its sim position, is a rendering bug — but only when it PERSISTS.
  // The rig position is captured at draw time and the sim position at
  // sample time; on a loaded host those are many frames apart, so a single
  // divergent sample is timing skew, not a bug. Require 3 consecutive.
  if (snap.rigs) {
    let bad = null;
    for (const r of snap.rigs) {
      if (r.alive && !r.visible) {
        bad = `rig hidden while alive: ${r.pid}`;
      } else if (
        r.alive &&
        r.stateX !== null &&
        Math.hypot(r.x - r.stateX, r.y - (r.stateY ?? r.y)) > 200
      ) {
        bad = `rig ${r.pid} drawn ${Math.round(Math.hypot(r.x - r.stateX, r.y - r.stateY))}px from sim position`;
      }
    }
    rigBadStreak = bad ? rigBadStreak + 1 : 0;
    if (bad && rigBadStreak >= 3) rigProblem = `${bad} (persisted ${rigBadStreak} samples)`;
  }

  if (ph === "drafting") {
    const pickedA = await autoPickDraft(a.page);
    const pickedB = await autoPickDraft(b.page);
    if (pickedA || pickedB) {
      seen.draft = true;
      console.log("[probe] drafting — auto-picked cards");
      await snapshotBeat("draft");
    }
    timeline.push({ tMs: Date.now() - started, stage, phase: ph, note: "drafting" });
    await a.page.waitForTimeout(400);
    continue;
  }

  if (!list || list.length < 2) {
    timeline.push({ tMs: Date.now() - started, stage, phase: ph, note: `players=${list?.length ?? "null"}` });
    await a.page.waitForTimeout(250);
    continue;
  }
  const A = me(list, a.id) ?? foe(list, b.id);
  const B = me(list, b.id) ?? foe(list, a.id);
  if (!A || !B) {
    timeline.push({ tMs: Date.now() - started, stage, phase: ph, note: "id-miss" });
    await a.page.waitForTimeout(250);
    continue;
  }

  timeline.push({
    tMs: Date.now() - started,
    stage,
    phase: ph,
    a: { x: Math.round(A.x), health: A.health, shield: A.shieldActive, parry: A.parryActive, alive: A.alive },
    b: { x: Math.round(B.x), health: B.health, shield: B.shieldActive, parry: B.parryActive, alive: B.alive },
  });
  if (A.shieldActive || B.shieldActive) seen.shield = true;
  if (A.parryActive || B.parryActive) seen.parry = true;
  if (A.health < 100 || B.health < 100) seen.damage = true;
  if (!A.alive || !B.alive) {
    if (!seen.kill) {
      seen.kill = true;
      console.log("[probe] kill registered");
      await snapshotBeat("kill");
    }
  }

  const dist = Math.abs(B.x - A.x);

  if (stage === "approach") {
    if (dist <= 260) {
      await snapshotBeat("in-range");
      // Freeze both in place for the shield/parry observations.
      await setGoal(a.page, { aimAtFoe: true });
      await setGoal(b.page, { aimAtFoe: true, shield: true });
      setStage("shield");
    } else if (Date.now() - stageStarted > 30_000) {
      console.log("[probe] approach timed out; proceeding at current range");
      await setGoal(a.page, { aimAtFoe: true });
      await setGoal(b.page, { aimAtFoe: true, shield: true });
      setStage("shield");
    }
  } else if (stage === "shield") {
    if (seen.shield || Date.now() - stageStarted > 6000) {
      await snapshotBeat("shield-up");
      parryTokenCounter += 1;
      await setGoal(b.page, { aimAtFoe: true, parryToken: parryTokenCounter });
      setStage("parry");
    }
  } else if (stage === "parry") {
    // The 420ms parry window can fall entirely between outer samples on a
    // loaded host — poll in-page at 40ms where the event loop is local.
    if (!seen.parry) {
      const sawParry = await b.page.evaluate(async () => {
        const until = Date.now() + 1200;
        while (Date.now() < until) {
          const ps = window.__simPlayers?.() ?? [];
          if (ps.some((pl) => pl.parryActive)) return true;
          await new Promise((r) => setTimeout(r, 40));
        }
        return false;
      });
      if (sawParry) seen.parry = true;
    }
    if (seen.parry) {
      await snapshotBeat("parry");
      await setGoal(a.page, { moveTowardFoe: true, stopRangePx: 180, aimAtFoe: true, fire: true });
      await setGoal(b.page, { moveTowardFoe: true, stopRangePx: 180, aimAtFoe: true, fire: true });
      setStage("slugfest");
    } else if (Date.now() - stageStarted > 4000) {
      // Re-tap: another rising edge in case the first fell in a cooldown.
      parryTokenCounter += 1;
      await setGoal(b.page, { aimAtFoe: true, parryToken: parryTokenCounter });
      stageStarted = Date.now();
      if (parryTokenCounter > 4) {
        console.log("[probe] parry never observed after 4 attempts");
        await setGoal(a.page, { moveTowardFoe: true, stopRangePx: 180, aimAtFoe: true, fire: true });
        await setGoal(b.page, { moveTowardFoe: true, stopRangePx: 180, aimAtFoe: true, fire: true });
        setStage("slugfest");
      }
    }
  } else if (stage === "slugfest") {
    if ((seen.kill || seen.damage) && Date.now() - stageStarted > 4000) {
      await snapshotBeat("damage-landed");
      break;
    }
  }

  await a.page.waitForTimeout(150);
}

await setGoal(a.page, null).catch(() => {});
await setGoal(b.page, null).catch(() => {});
await snapshotBeat("final");

// ── Collect videos ───────────────────────────────────────────────────
const vidA = await a.page.video()?.path();
const vidB = await b.page.video()?.path();
await a.ctx.close();
await b.ctx.close();
await browser.close();

// ── ffmpeg sparse-frame extraction (1 fps) ───────────────────────────
for (const [tag, vid] of [["p1", vidA], ["p2", vidB]]) {
  extractFrames(vid, FRAME_DIR, tag);
}

const last = lastPlayerSample(timeline);
const report = {
  hostLoadRatio: Math.round(loadRatio * 100) / 100,
  ranMs: Date.now() - started,
  observed: seen,
  finalHealth: last ? { a: last.a.health, b: last.b.health } : null,
  samples: timeline.length,
  timeline,
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));

serverProc?.kill();

console.log("");
console.log("── combat probe report ──────────────────────────────");
console.log(`  damage landed : ${seen.damage}`);
console.log(`  kill seen     : ${seen.kill}`);
console.log(`  shield seen   : ${seen.shield}`);
console.log(`  parry seen    : ${seen.parry}`);
console.log(`  draft handled : ${seen.draft}`);
console.log(`  final health  : A=${last?.a?.health ?? "?"} B=${last?.b?.health ?? "?"}`);
console.log(`  videos        : ${VIDEO_DIR}`);
console.log(`  frames        : ${FRAME_DIR} (${readdirSync(FRAME_DIR).length} files)`);
console.log(`  report        : ${join(OUT, "report.json")}`);
console.log("─────────────────────────────────────────────────────");

if (rigProblem) {
  console.error(`COMBAT PROBE FAIL (render): ${rigProblem}`);
  process.exit(1);
}
if (!seen.damage) {
  console.error("COMBAT PROBE FAIL: no damage landed — core combat is broken or players never engaged.");
  process.exit(1);
}
console.log("COMBAT PROBE PASS");
