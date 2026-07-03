// Shared scaffolding for the combat/match probes. One copy of the server
// boot, player join, draft auto-pick, and frame-extraction logic — the two
// probes had drifted copies of all of it (review finding, 2026-07-03).

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function healthy(base) {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Boot a game server for the probe unless one is already answering.
 *  Returns the child process to kill at the end, or null if reusing. */
export async function ensureServer(root, base) {
  if (await healthy(base)) return null;
  if (!existsSync(join(root, "client/dist/index.html"))) {
    console.error("probe: client/dist missing — run `bun run build` first");
    process.exit(1);
  }
  console.log("[probe] starting game server on :8088 ...");
  const proc = spawn("bun", ["src/index.ts"], {
    cwd: join(root, "server"),
    env: {
      ...process.env,
      GAME_SERVER_SECRET: "dev-insecure-secret",
      SERVE_CLIENT_DIR: join(root, "client/dist"),
      PORT: "8088",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 40 && !(await healthy(base)); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await healthy(base))) {
    console.error("probe: server did not become healthy");
    proc.kill();
    process.exit(1);
  }
  return proc;
}

/** Join the world with a pinned player id. suffix keeps ids stable and
 *  distinguishable per probe family. */
export async function joinWorld(browser, base, id, suffix, { video } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(video ? { recordVideo: { dir: video, size: { width: 1280, height: 720 } } } : {}),
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([key, val, suf]) => {
      localStorage.setItem(key, val);
      sessionStorage.setItem("jakesjam.sessionSuffix", suf);
    },
    ["jakesjam.playerId", `player_${id}`, suffix],
  );
  page.on("pageerror", (e) => console.log(`[${id} PAGEERROR]`, String(e).slice(0, 250)));
  await page.goto(`${base}/?world=1`, { waitUntil: "load" });
  return { ctx, page, id: `player_${id}_${suffix}` };
}

/** Click the first card in the draft overlay if it's up. Returns true only
 *  when a card was actually clicked. */
export function autoPickDraft(page) {
  return page.evaluate(() => {
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
}

/** Extract 1fps stills from a recorded video into frameDir as
 *  `${prefix}-%03d.png`. Silent no-op if ffmpeg fails. */
export function extractFrames(videoPath, frameDir, prefix) {
  if (!videoPath) return;
  try {
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-i", videoPath,
      "-vf", "fps=1",
      join(frameDir, `${prefix}-%03d.png`),
    ]);
  } catch (e) {
    console.log(`[probe] ffmpeg extract failed: ${String(e).slice(0, 120)}`);
  }
}

/** Last timeline entry that carries player data — note-only entries
 *  (drafting / players<2) don't have .a/.b and crash naive tail access. */
export function lastPlayerSample(timeline) {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.a && timeline[i]?.b) return timeline[i];
  }
  return null;
}
