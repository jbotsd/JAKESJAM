// render-replay — drive the host's own ReplayScene offline renderer manually.
//
// clipRenderQueue.ts only fires on a HUMAN's kill moments at match end. When
// you just want footage out of a replay that already exists, this is the same
// pipeline with the trigger replaced by an argument.
//
//   bun tools/render-replay.mjs --replay world-<id>.jjr --from 600 --ticks 1200
//   bun tools/render-replay.mjs --replay ... --windows 600,2400,4200 --ticks 1200
//
// Renders at 1920x1080 with real audio, uploads through /clips/upload exactly
// as the automatic path does, and prints the resulting clip URL/id.
//
// Sim runs at 60 ticks/sec, so ticks = seconds * 60. Keep windows under ~45s:
// the study on 2026-08-05 found /clips/upload 413s above roughly that size.
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = opt("port", "8088");
const REPLAY = opt("replay", "");
const TICKS = opt("ticks", "1200");
const FOLLOW = opt("follow", "first");
const WINDOWS = opt("windows", opt("from", "600")).split(",").map((s) => s.trim()).filter(Boolean);

if (!REPLAY) { console.error("--replay <file.jjr> required"); process.exit(2); }

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

for (const from of WINDOWS) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const url = `http://127.0.0.1:${PORT}/?replay=${encodeURIComponent(REPLAY)}` +
    `&render=1&from=${from}&ticks=${TICKS}&follow=${encodeURIComponent(FOLLOW)}&rs=1`;
  console.log(`\n[render] from=${from} ticks=${TICKS}`);
  console.log(`[render] ${url}`);

  const t0 = Date.now();
  await page.goto(url);
  let last = "";
  let result = null;
  // Generous: a 20s window is ~600 frames to render then encode then upload.
  for (let i = 0; i < 600; i++) {
    const st = await page.evaluate(() => {
      const r = window.__replayRender;
      return r ? { status: r.status, url: r.url, frames: r.frames, bytes: r.bytes, message: r.message } : { status: "boot" };
    }).catch(() => ({ status: "gone" }));
    if (st.status !== last) {
      console.log(`  +${Math.round((Date.now() - t0) / 1000)}s ${st.status}${st.frames ? ` frames=${st.frames}` : ""}`);
      last = st.status;
    }
    if (st.status === "done" || st.status === "error") { result = st; break; }
    await page.waitForTimeout(1000);
  }
  if (!result) console.log("  TIMED OUT");
  else if (result.status === "error") console.log(`  ERROR: ${result.message}`);
  else console.log(`  DONE ${result.url} (${result.frames} frames, ${(result.bytes / 1048576).toFixed(1)} MB)`);
  await ctx.close();
}

await browser.close();
