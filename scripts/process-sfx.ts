// SFX pack pipeline: Bitwig exports → game-ready sample pack + manifest.
//
//   bun scripts/process-sfx.ts ~/Music/binipe-sfx/
//
// Input: WAVs named <cue>-01.wav, <cue>-02.wav ... (any count per cue).
// Cue names = ProceduralAudio cues: shoot, hit, explosion, shield-up,
// shield-hit, shield-break, parry, dash, jump, land, pickup, card, fire.
// Output: client/public/audio/sfx/<cue>-NN.m4a + manifest.json.
//
// Per-file: trim lead/tail silence, loudnorm to the cue's target, encode.
// Re-runnable — drop new exports in and run again.

import { mkdirSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const TARGETS_LUFS: Record<string, number> = {
  shoot: -15,
  hit: -14,
  explosion: -12,
  parry: -12,
  "shield-break": -13,
  "shield-hit": -16,
  "shield-up": -18,
  dash: -20,
  jump: -20,
  land: -19,
  pickup: -18,
  card: -18,
  fire: -18,
};
const DEFAULT_LUFS = -16;

const inDir = process.argv[2];
if (!inDir) {
  console.error("usage: bun scripts/process-sfx.ts <dir-of-wavs>");
  process.exit(1);
}
const OUT_DIR = resolve(import.meta.dir, "..", "client/public/audio/sfx");
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(inDir).filter((f) => /^[a-z-]+-\d+\.(wav|flac|aiff?)$/i.test(f));
if (files.length === 0) {
  console.error(`no <cue>-NN.wav files in ${inDir}`);
  process.exit(1);
}

const counts = new Map<string, number>();
for (const f of files.sort()) {
  const m = basename(f).match(/^([a-z-]+)-(\d+)\.\w+$/i)!;
  const cue = m[1]!.toLowerCase();
  const n = (counts.get(cue) ?? 0) + 1;
  counts.set(cue, n);
  const out = resolve(OUT_DIR, `${cue}-${String(n).padStart(2, "0")}.m4a`);
  const lufs = TARGETS_LUFS[cue] ?? DEFAULT_LUFS;
  const p = Bun.spawnSync([
    "ffmpeg",
    "-y",
    "-i",
    resolve(inDir, f),
    "-af",
    [
      "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.01",
      `loudnorm=I=${lufs}:TP=-1.0:LRA=7`,
      "areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.02,areverse",
    ].join(","),
    "-ar",
    "48000",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    out,
  ]);
  if (p.exitCode !== 0) {
    console.error(`✗ ${f}: ${new TextDecoder().decode(p.stderr).slice(-200)}`);
    counts.set(cue, n - 1);
    continue;
  }
  console.log(`✓ ${cue}-${String(n).padStart(2, "0")}.m4a`);
}

const manifest = Object.fromEntries([...counts.entries()].filter(([, n]) => n > 0));
await Bun.write(resolve(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${JSON.stringify(manifest)}`);
console.log(`done → ${OUT_DIR} (bun run build + refresh to hear them)`);
