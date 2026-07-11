// Announcer pipeline: one continuous WAV → mastered per-line m4a files.
//
//   bun scripts/process-announcer.ts ~/Music/announcer_raw.wav
//
// 1. ffmpeg silencedetect finds the gaps; LONG gaps (>2.2s) separate LINES,
//    short gaps separate TAKES of the same line.
// 2. Groups map to keys by script order (docs/ANNOUNCER_SCRIPT.md).
// 3. Best take per line = highest mean RMS that does NOT clip.
// 4. Master: highpass 85Hz, gentle compression, loudnorm -16 LUFS, a short
//    arena tail, 30ms fade-out → client/public/audio/announcer/<key>.m4a.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const KEYS = [
  "kill",
  "double-kill",
  "triple-kill",
  "multi-kill",
  "first-blood",
  "fight",
  "round-over",
  "victory",
  "eliminated",
  "soul-reclaimed",
  "sudden-death",
  "welcome",
  // optional extras — consumed if present in the recording
  "draft",
  "killing-spree",
  "unstoppable",
];
// The diatribe is matched by DURATION, not order: any group whose best
// take runs longer than 12s becomes lore-intro (docs/ANNOUNCER_SCRIPT.md).
const LORE_KEY = "lore-intro";
const LORE_MIN_S = 12;

const LINE_GAP_S = 2.2; // silence longer than this = next line
const NOISE_DB = -38; // silencedetect threshold
const MIN_TAKE_S = 0.25;

const input = process.argv[2];
if (!input) {
  console.error("usage: bun scripts/process-announcer.ts <raw.wav>");
  process.exit(1);
}
const OUT_DIR = resolve(import.meta.dir, "..", "client/public/audio/announcer");
mkdirSync(OUT_DIR, { recursive: true });

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if ((await p.exited) !== 0 && !err.includes("silencedetect")) {
    throw new Error(`${cmd[0]} failed: ${err.slice(0, 400)}`);
  }
  return out + err;
}

// ── 1. Find speech segments between silences ──
const det = await run([
  "ffmpeg",
  "-i",
  input,
  "-af",
  `silencedetect=noise=${NOISE_DB}dB:d=0.35`,
  "-f",
  "null",
  "-",
]);
const starts = [...det.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
const ends = [...det.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
const durMatch = det.match(/Duration: (\d+):(\d+):([\d.]+)/);
const totalS = durMatch
  ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
  : 0;

type Seg = { a: number; b: number };
const segs: Seg[] = [];
let cursor = 0;
for (let i = 0; i < starts.length; i++) {
  if (starts[i]! - cursor >= MIN_TAKE_S) segs.push({ a: cursor, b: starts[i]! });
  cursor = ends[i] ?? starts[i]!;
}
if (totalS - cursor >= MIN_TAKE_S) segs.push({ a: cursor, b: totalS });
console.log(`found ${segs.length} speech segments`);

// ── 2. Group takes into lines by long gaps ──
const groups: Seg[][] = [];
for (const s of segs) {
  const last = groups[groups.length - 1];
  if (!last || s.a - last[last.length - 1]!.b >= LINE_GAP_S) groups.push([s]);
  else last.push(s);
}
console.log(`grouped into ${groups.length} lines (script defines ${KEYS.length} incl. optional)`);
if (groups.length < 12) {
  console.error("fewer than the 12 required lines — check gaps/levels and re-run");
}

// ── 3+4. Pick the best take per line, master, encode ──
async function takeStats(a: number, b: number): Promise<{ rms: number; peak: number }> {
  const out = await run([
    "ffmpeg",
    "-ss",
    String(a),
    "-to",
    String(b),
    "-i",
    input,
    "-af",
    "astats=metadata=0:measure_overall=RMS_level+Peak_level:measure_perchannel=none",
    "-f",
    "null",
    "-",
  ]);
  const rms = Number(out.match(/RMS level dB:\s*(-?[\d.]+)/)?.[1] ?? -99);
  const peak = Number(out.match(/Peak level dB:\s*(-?[\d.]+)/)?.[1] ?? -99);
  return { rms, peak };
}

// Pull the diatribe group (longest single take > LORE_MIN_S) out first so
// the sequential key mapping stays aligned whether or not extras exist.
let loreGroup: Seg[] | null = null;
for (let g = groups.length - 1; g >= 0; g--) {
  if (groups[g]!.some((t) => t.b - t.a >= LORE_MIN_S)) {
    loreGroup = groups.splice(g, 1)[0]!;
    break;
  }
}

for (let g = 0; g < Math.min(groups.length, KEYS.length); g++) {
  const key = KEYS[g]!;
  const takes = groups[g]!;
  let best = takes[0]!;
  let bestScore = -Infinity;
  for (const t of takes) {
    const { rms, peak } = await takeStats(t.a, t.b);
    const score = peak > -0.5 ? rms - 20 : rms; // clipped takes are punished
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  const out = resolve(OUT_DIR, `${key}.m4a`);
  await run([
    "ffmpeg",
    "-y",
    "-ss",
    String(Math.max(0, best.a - 0.06)),
    "-to",
    String(best.b + 0.12),
    "-i",
    input,
    "-af",
    [
      "highpass=f=85",
      "acompressor=threshold=-18dB:ratio=3:attack=8:release=120:makeup=4",
      "aecho=0.7:0.45:70|110:0.18|0.10", // short arena tail
      "loudnorm=I=-16:TP=-1.2:LRA=9",
    ].join(","),
    "-ar",
    "48000",
    "-c:a",
    "aac",
    "-b:a",
    "112k",
    out,
  ]);
  console.log(`✓ ${key}.m4a  (take ${takes.indexOf(best) + 1}/${takes.length}, ${(best.b - best.a).toFixed(2)}s)`);
}
if (loreGroup) {
  const t = loreGroup.reduce((a, b) => (b.b - b.a > a.b - a.a ? b : a));
  const out = resolve(OUT_DIR, `${LORE_KEY}.m4a`);
  await run([
    "ffmpeg", "-y",
    "-ss", String(Math.max(0, t.a - 0.1)),
    "-to", String(t.b + 0.6),
    "-i", input,
    "-af",
    [
      "highpass=f=75",
      "acompressor=threshold=-20dB:ratio=2.5:attack=12:release=180:makeup=3",
      "aecho=0.72:0.5:90|150:0.22|0.12", // roomier tail for the monologue
      "loudnorm=I=-17:TP=-1.5:LRA=11",
    ].join(","),
    "-ar", "48000", "-c:a", "aac", "-b:a", "128k",
    out,
  ]);
  console.log(`✓ ${LORE_KEY}.m4a (${(t.b - t.a).toFixed(1)}s)`);
} else {
  console.log("no lore-intro found (no take ≥ 12s) — record it after a long silence");
}
console.log(`done → ${OUT_DIR}`);
