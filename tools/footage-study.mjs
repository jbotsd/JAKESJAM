// Footage study harness — Track P2.
//
// Drives the host's own headless ReplayScene render URL, samples frames,
// and reports DEAD RUNS (stretches where almost nothing moves). Same
// question the 2026-08-05 study asked, asked cheaply enough to re-ask
// after every fix: is anything on screen standing still?
//
// The standing rule is "stationary > 1 s = bug", so the sampler runs at
// 2 Hz and flags runs of consecutive low-motion samples. It writes every
// sampled frame full-res, because the 2026-07-13 lesson was that
// thumbnails misattribute — you diagnose from the real frame or not at
// all.
//
//   bun tools/footage-study.mjs --url http://localhost:8388 \
//       --replay world-<id>.jjr --from 40000 --ticks 1800 --seconds 45
//
// Output: <out>/f####.png plus a motion table on stdout.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BASE = opt("url", "http://localhost:8388");
const REPLAY = opt("replay", "latest");
const FROM = Number(opt("from", "40000"));
const TICKS = Number(opt("ticks", "1800"));
const SECONDS = Number(opt("seconds", "45"));
const EVERY_MS = Number(opt("every", "500"));
const OUT = opt("out", "docs/clip-sheets/study-frames");
/** Mean per-pixel luma delta below this = "nothing happened". */
const STILL = Number(opt("still", "1.0"));

await mkdir(OUT, { recursive: true });

// `gate=off` matters: this harness screenshots the PAGE, and the email
// gate is a full-bleed DOM overlay, so without it every sample is a
// picture of the signup form and the motion metric reads a flat 0.00.
// (The production render pipeline captures the canvas, so its own URL
// omitting gate=off is not the same bug — verified separately.)
// `follow` matters as much as gate=off. The production pipeline always
// passes one (clipRenderQueue builds it from a kill moment); without it
// the render camera has no subject and frames empty geometry, which the
// motion metric then reports as a dead run that is really "nobody told
// the camera who to watch". Pass --follow <playerId>.
const FOLLOW = opt("follow", "");
// Empty = the build's own tier. Forcing `potato` changes what the rig
// LOOKS like, so a study that judges visuals must not silently pin it.
const QUALITY = opt("quality", "");
const url =
  `${BASE}/?replay=${encodeURIComponent(REPLAY)}&render=1` +
  `&from=${FROM}&ticks=${TICKS}&rs=1&gate=off` +
  (QUALITY ? `&quality=${encodeURIComponent(QUALITY)}` : "") +
  (FOLLOW ? `&follow=${encodeURIComponent(FOLLOW)}` : "");
console.log(`[study] ${url}`);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--window-size=1920,1080", "--hide-scrollbars", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "load", timeout: 60_000 });

// Let the scene boot and fast-forward to `from` before sampling — the
// first seconds are seek, not gameplay, and would read as a fake dead run.
await page.waitForTimeout(8_000);

const frames = [];
const t0 = Date.now();
let i = 0;
let stoppedEarly = false;
while (Date.now() - t0 < SECONDS * 1000) {
  // Stop when the render finishes. Sampling past the end freezes on the
  // last frame and manufactures a dead run out of nothing — the first
  // version of this tool reported exactly that and it was pure artifact.
  // ReplayScene publishes its state on window.__replayRender; anything
  // other than an in-progress status means there is nothing left to watch.
  const status = await page
    .evaluate(() => (window.__replayRender ?? {}).status ?? null)
    .catch(() => null);
  if (status !== null && status !== "rendering" && status !== "playing" && status !== "loading") {
    stoppedEarly = true;
    console.log(`[study] render reported "${status}" — stopping at ${i} frames`);
    break;
  }

  const buf = await page.screenshot({ type: "png" });
  const name = `${OUT}/f${String(i).padStart(4, "0")}.png`;
  await writeFile(name, buf);
  frames.push({ i, name, png: PNG.sync.read(buf) });
  i += 1;
  await page.waitForTimeout(EVERY_MS);
}
if (!stoppedEarly && SECONDS * 60 > TICKS) {
  console.log(
    `[study] NOTE: sampled ${SECONDS}s of a ${(TICKS / 60).toFixed(0)}s window — ` +
      `any dead run at the very end is the render having finished, not the game standing still.`,
  );
}
await browser.close();

// Mean absolute luma delta between consecutive frames, sampled on a grid
// (full-pixel diff on 1920x1080 x N frames is needlessly slow and the
// answer is identical at this granularity).
function delta(a, b) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < a.height; y += 4) {
    for (let x = 0; x < a.width; x += 4) {
      const o = (a.width * y + x) << 2;
      const la = 0.299 * a.data[o] + 0.587 * a.data[o + 1] + 0.114 * a.data[o + 2];
      const lb = 0.299 * b.data[o] + 0.587 * b.data[o + 1] + 0.114 * b.data[o + 2];
      sum += Math.abs(la - lb);
      n += 1;
    }
  }
  return sum / n;
}

const motion = [];
for (let k = 1; k < frames.length; k += 1) {
  motion.push({ i: k, d: delta(frames[k - 1].png, frames[k].png) });
}

console.log("\nframe  Δluma  moving?");
for (const m of motion) {
  console.log(
    `${String(m.i).padStart(4)}  ${m.d.toFixed(2).padStart(6)}  ${m.d < STILL ? "STILL" : ""}`,
  );
}

// Dead runs: >= 2 consecutive still samples at 2 Hz means >= 1 s frozen.
const runs = [];
let start = null;
for (const m of motion) {
  if (m.d < STILL) {
    if (start === null) start = m.i;
  } else if (start !== null) {
    if (m.i - start >= 2) runs.push([start, m.i - 1]);
    start = null;
  }
}
if (start !== null && motion.length - start >= 2) runs.push([start, motion.length]);

console.log(`\n[study] frames=${frames.length} samples=${motion.length} still<${STILL}`);
const avg = motion.reduce((s, m) => s + m.d, 0) / (motion.length || 1);
console.log(`[study] mean Δluma = ${avg.toFixed(2)}`);
if (runs.length === 0) {
  console.log("[study] NO DEAD RUNS — nothing stood still for >= 1 s");
} else {
  for (const [a, b] of runs) {
    console.log(
      `[study] DEAD RUN frames ${a}..${b}  (${(((b - a + 1) * EVERY_MS) / 1000).toFixed(1)}s) → ${OUT}/f${String(a).padStart(4, "0")}.png`,
    );
  }
}
if (errs.length) console.log(`[study] page errors: ${errs.length}\n  ${errs.slice(0, 3).join("\n  ")}`);
