// probe-clip — the shared clip verifier (docs/clip-goal.md CL.0).
//
//   bun scripts/probe-clip.ts <file.mp4> [--ticks 720] [--fps 30]
//
// Every clip-goal pillar proves itself through this gate: a rendered clip
// either passes or the pillar isn't done. Assertions (each row PASS/FAIL,
// exit code 1 if any fail):
//
//   resolution   exactly 1920×1080
//   fps-real     frames/duration within 2% of the target (default 30)
//   fps-meta     nominal (container) fps sane: ≤120 (the baseline clip
//                shipped 57600/1 — some players/socials choke on that)
//   duration     within 1 frame of --ticks/60 s (skipped without --ticks)
//   audio        ≥1 audio stream AND non-silent (mean volume over the
//                middle 50% > −60 dB)
//   bitrate      ≤ 9 Mbps (dark arena content needs nowhere near more)
//   faststart    moov atom before mdat (instant share-page scrubbing)
//   motion       no two consecutive sampled frames (10fps, middle 60%)
//                byte-identical — catches dropped-frame stutter
//   static-span  no run of ≥3s (default) where per-frame pixel-delta stays
//                essentially zero — catches a genuinely static scene (no
//                gameplay action/camera/VFX) that the "motion" check above
//                CANNOT see: real encoder output is quantization-noisy, so
//                two frames of dead air are almost never byte-identical
//                even though nothing is happening (clip-goal STUDY 3, D7).
//                Distinct failure mode, distinct check — "motion" catches
//                dropped-frame stutter, "static-span" catches dead air.
//
// Also usable as a module: `import { probeClip } from "./probe-clip.ts"`.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Prefer the REAL binaries over PATH: this box has (had) stale firejail
 *  symlinks in /usr/local/bin (firecfg blanket run) whose private-tmp makes
 *  /tmp files invisible — ffprobe "No such file or directory" on files that
 *  exist. /usr/bin is always the unwrapped binary on Arch. */
export const FFPROBE = existsSync("/usr/bin/ffprobe") ? "/usr/bin/ffprobe" : "ffprobe";
export const FFMPEG = existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : "ffmpeg";

/** Sampling rate (fps) for the static-span pixel-delta scan. */
export const STATIC_SPAN_SAMPLE_FPS = 10;

/** Per-adjacent-sampled-frame luma delta (0–255 scale) below this is
 *  "essentially zero" — real encoder quantization noise on a genuinely
 *  static scene measures well under 0.1 on this scale; real motion
 *  measures single digits or higher. Wide margin either side. */
export const STATIC_SPAN_DELTA_THRESHOLD = 1.0;

/** Default longest-allowed near-zero-delta run before static-span fails. */
export const STATIC_SPAN_DEFAULT_SECONDS = 3;

export type ProbeCheck = {
  name: string;
  pass: boolean;
  detail: string;
};

export type ProbeResult = {
  file: string;
  checks: ProbeCheck[];
  passed: boolean;
};

async function run(cmd: string[]): Promise<{ out: string; err: string; code: number }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

async function ffprobeJson(file: string): Promise<{
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    nb_read_frames?: string;
  }>;
  format: { duration?: string; bit_rate?: string };
}> {
  const { out, err, code } = await run([
    FFPROBE,
    "-v",
    "error",
    "-count_frames",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file,
  ]);
  const parsed = JSON.parse(out || "{}") as ReturnType<typeof JSON.parse>;
  if (!parsed.streams || !parsed.format) {
    throw new Error(`ffprobe gave no streams for ${file} (exit ${code}): ${err.trim() || "(no stderr)"}`);
  }
  return parsed;
}

/** Walk top-level MP4 boxes; true when moov precedes mdat. */
async function moovBeforeMdat(file: string): Promise<boolean | null> {
  const f = Bun.file(file);
  const size = f.size;
  let offset = 0;
  let moovAt = -1;
  let mdatAt = -1;
  // Top-level boxes only — headers are tiny, read 16 bytes per hop.
  while (offset + 16 <= size && (moovAt < 0 || mdatAt < 0)) {
    const head = new DataView(await f.slice(offset, offset + 16).arrayBuffer());
    let boxSize = head.getUint32(0);
    const type = String.fromCharCode(
      head.getUint8(4),
      head.getUint8(5),
      head.getUint8(6),
      head.getUint8(7),
    );
    if (boxSize === 1) {
      // 64-bit largesize
      boxSize = Number(head.getBigUint64(8));
    } else if (boxSize === 0) {
      boxSize = size - offset; // box extends to EOF
    }
    if (type === "moov" && moovAt < 0) moovAt = offset;
    if (type === "mdat" && mdatAt < 0) mdatAt = offset;
    if (boxSize <= 0) return null; // corrupt — don't loop forever
    offset += boxSize;
  }
  if (moovAt < 0 || mdatAt < 0) return null;
  return moovAt < mdatAt;
}

/** Mean volume (dB) over the middle 50% of the clip, or null if no audio. */
async function meanVolumeDb(file: string, durationS: number): Promise<number | null> {
  const start = durationS * 0.25;
  const span = durationS * 0.5;
  const { err } = await run([
    FFMPEG,
    "-v",
    "info",
    "-ss",
    start.toFixed(3),
    "-t",
    span.toFixed(3),
    "-i",
    file,
    "-map",
    "0:a:0",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const m = err.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? Number(m[1]) : null;
}

/** Consecutive-identical-frame count over the middle 60%, sampled at 10fps. */
async function staticFramePairs(
  file: string,
  durationS: number,
): Promise<{ pairs: number; sampled: number }> {
  const dir = mkdtempSync(join(tmpdir(), "probe-clip-"));
  try {
    const start = durationS * 0.2;
    const span = durationS * 0.6;
    await run([
      FFMPEG,
      "-v",
      "error",
      "-ss",
      start.toFixed(3),
      "-t",
      span.toFixed(3),
      "-i",
      file,
      "-vf",
      "fps=10",
      join(dir, "f-%04d.png"),
    ]);
    const files = readdirSync(dir).sort();
    let pairs = 0;
    let prevHash = "";
    for (const name of files) {
      const bytes = await Bun.file(join(dir, name)).arrayBuffer();
      const hash = new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
      if (prevHash !== "" && hash === prevHash) pairs += 1;
      prevHash = hash;
    }
    return { pairs, sampled: files.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Per-adjacent-sampled-frame average luma delta (0–255 scale) across the
 *  WHOLE clip, via ffmpeg `tblend=all_mode=difference` + `signalstats`:
 *  blend each sampled frame against the previous one and read the mean
 *  brightness of the resulting difference image. Unlike `staticFramePairs`
 *  (byte-identity of the encoded PNG), this measures actual pixel-level
 *  change, so it sees through encoder quantization noise that makes two
 *  frames of a static scene differ in bytes without differing in content. */
async function motionDeltas(file: string, sampleFps: number): Promise<number[]> {
  const { out } = await run([
    FFMPEG,
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `fps=${sampleFps},tblend=all_mode=difference,signalstats,metadata=print:file=-`,
    "-f",
    "null",
    "-",
  ]);
  const deltas: number[] = [];
  for (const m of out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)) {
    deltas.push(Number(m[1]));
  }
  return deltas;
}

/** Longest run of consecutive near-zero deltas, expressed in seconds. */
function longestStaticRunSeconds(deltas: number[], sampleFps: number, threshold: number): number {
  let longest = 0;
  let current = 0;
  for (const d of deltas) {
    if (d <= threshold) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest / sampleFps;
}

export async function probeClip(
  file: string,
  opts: {
    ticks?: number;
    targetFps?: number;
    slowmoFrames?: number;
    staticSpanSeconds?: number;
  } = {},
): Promise<ProbeResult> {
  const targetFps = opts.targetFps ?? 30;
  const checks: ProbeCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  const info = await ffprobeJson(file);
  const v = info.streams.find((s) => s.codec_type === "video");
  const a = info.streams.filter((s) => s.codec_type === "audio");
  const durationS = Number(info.format.duration ?? 0);
  const bitrate = Number(info.format.bit_rate ?? 0);
  const frames = Number(v?.nb_read_frames ?? 0);

  // resolution
  add(
    "resolution",
    v?.width === 1920 && v?.height === 1080,
    `${v?.width}×${v?.height} (want 1920×1080)`,
  );

  // fps-real
  const realFps = durationS > 0 ? frames / durationS : 0;
  add(
    "fps-real",
    Math.abs(realFps - targetFps) / targetFps <= 0.02,
    `${realFps.toFixed(2)}fps real (${frames} frames / ${durationS.toFixed(2)}s, want ${targetFps}±2%)`,
  );

  // fps-meta
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  const nominal = den ? num / den : 0;
  add("fps-meta", nominal > 0 && nominal <= 120, `nominal ${v?.r_frame_rate} = ${nominal.toFixed(1)}fps (want ≤120)`);

  // duration vs ticks (+ the deterministic slow-mo stretch, clip-goal CL.E:
  // the final-kill dilation adds exactly N extra frames)
  if (opts.ticks !== undefined) {
    const want = opts.ticks / 60 + (opts.slowmoFrames ?? 0) / targetFps;
    const frameDur = 1 / targetFps;
    add(
      "duration",
      Math.abs(durationS - want) <= frameDur + 1e-6,
      `${durationS.toFixed(3)}s (want ${want.toFixed(3)}s ±${frameDur.toFixed(3)}s)`,
    );
  } else {
    add("duration", true, `${durationS.toFixed(3)}s (no --ticks given — informational)`);
  }

  // audio present + non-silent
  if (a.length === 0) {
    add("audio", false, "no audio stream");
  } else {
    const mean = await meanVolumeDb(file, durationS);
    add(
      "audio",
      mean !== null && mean > -60,
      `${a.length} stream(s) [${a[0]!.codec_name}], mean ${mean === null ? "unreadable" : `${mean.toFixed(1)}dB`} over middle 50% (want > −60dB)`,
    );
  }

  // bitrate
  add("bitrate", bitrate > 0 && bitrate <= 9_000_000, `${(bitrate / 1e6).toFixed(2)}Mbps (want ≤9)`);

  // faststart
  const fast = await moovBeforeMdat(file);
  add(
    "faststart",
    fast === true,
    fast === null ? "could not locate moov/mdat" : fast ? "moov before mdat" : "mdat before moov",
  );

  // motion (dropped-frame stutter — byte-identical consecutive frames)
  const { pairs, sampled } = await staticFramePairs(file, durationS);
  add(
    "motion",
    sampled >= 5 && pairs === 0,
    `${pairs} identical consecutive pair(s) across ${sampled} sampled frames (want 0)`,
  );

  // static-span (dead air — sustained near-zero pixel-delta; catches what
  // byte-identity above cannot: a genuinely static scene whose frames are
  // never byte-identical because of encoder quantization noise, D7)
  const staticSpanWant = opts.staticSpanSeconds ?? STATIC_SPAN_DEFAULT_SECONDS;
  const deltas = await motionDeltas(file, STATIC_SPAN_SAMPLE_FPS);
  if (deltas.length < 3) {
    add("static-span", true, `${deltas.length} sampled delta(s) — too short a clip to assess`);
  } else {
    const longestRunS = longestStaticRunSeconds(deltas, STATIC_SPAN_SAMPLE_FPS, STATIC_SPAN_DELTA_THRESHOLD);
    add(
      "static-span",
      longestRunS < staticSpanWant,
      `${longestRunS.toFixed(2)}s longest near-zero pixel-delta run across ${deltas.length} sampled deltas (want <${staticSpanWant}s)`,
    );
  }

  return { file, checks, passed: checks.every((c) => c.pass) };
}

// ── CLI ─────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error(
      "usage: bun scripts/probe-clip.ts <file.mp4> [--ticks 720] [--fps 30] [--static-span-seconds 3]",
    );
    process.exit(2);
  }
  const optOf = (name: string): number | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined;
  };
  const result = await probeClip(file, {
    ticks: optOf("ticks"),
    targetFps: optOf("fps"),
    slowmoFrames: optOf("slowmo"),
    staticSpanSeconds: optOf("static-span-seconds"),
  });
  console.log(`\nprobe-clip — ${result.file}`);
  console.log("─".repeat(72));
  for (const c of result.checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(12)} ${c.detail}`);
  }
  console.log("─".repeat(72));
  console.log(result.passed ? "  ALL PASS" : "  FAILED");
  process.exit(result.passed ? 0 : 1);
}
