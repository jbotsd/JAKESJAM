// GPU vertical-crop transcode for highlight clips.
//
// WHY SERVER-SIDE: the browser can't hardware-encode on this stack — Linux
// Chromium's MediaRecorder H.264 is OpenH264 SOFTWARE encode (no NVENC path,
// no VAAPI on NVIDIA), and running two realtime encodes starved the game's
// main thread. So the client uploads ONE full-res landscape mezzanine plus a
// crop-focus trace, and the vertical 720x1280 deliverable is produced here
// with ffmpeg h264_nvenc — the 4080's dedicated encode ASIC, ~zero CPU and
// far better rate-distortion than realtime OpenH264.
//
// The 9:16 window is full-height, so only the crop X pans. The trace is
// rendered into an ffmpeg sendcmd file that drives `crop x` over time —
// the same camera-operator pan the in-browser crop used to draw per frame.

import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

export type FocusTracePoint = {
  /** Milliseconds from segment start (video timeline). */
  t: number;
  /** Crop-window centre X in uploaded-video pixels. */
  x: number;
};

const FFMPEG = process.env.JJ_FFMPEG ?? "ffmpeg";
const TRANSCODE_TIMEOUT_MS = 60_000;
/** Deliverable size — TikTok-native. */
const DEST_W = 720;
const DEST_H = 1280;

function even(n: number): number {
  const v = Math.max(2, Math.floor(n));
  return v % 2 === 0 ? v : v - 1;
}

/** Parse + sanitize a client-supplied trace: finite numbers, time-ordered,
 *  capped point count (the client decimates, but never trust the wire). */
export function parseFocusTrace(raw: string): FocusTracePoint[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2000) return null;
  const out: FocusTracePoint[] = [];
  for (const p of parsed) {
    if (typeof p !== "object" || p === null) return null;
    const t = (p as { t?: unknown }).t;
    const x = (p as { x?: unknown }).x;
    if (typeof t !== "number" || typeof x !== "number") return null;
    if (!Number.isFinite(t) || !Number.isFinite(x) || t < 0) return null;
    out.push({ t, x });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Build the sendcmd file body panning `crop x` along the trace. */
export function buildSendcmd(
  trace: FocusTracePoint[],
  srcW: number,
  cropW: number,
): string {
  const maxX = Math.max(0, srcW - cropW);
  const lines: string[] = [];
  let lastT = -1;
  for (const p of trace) {
    const tSec = p.t / 1000;
    if (tSec <= lastT) continue; // sendcmd requires strictly increasing times
    lastT = tSec;
    const x = Math.round(Math.min(maxX, Math.max(0, p.x - cropW / 2)));
    lines.push(`${tSec.toFixed(3)} crop x ${x};`);
  }
  return lines.join("\n") + "\n";
}

async function runFfmpeg(args: string[]): Promise<boolean> {
  const proc = Bun.spawn([FFMPEG, "-hide_banner", "-loglevel", "error", ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), TRANSCODE_TIMEOUT_MS);
  const code = await proc.exited;
  clearTimeout(timer);
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    console.warn(`[clips] ffmpeg exit ${code}: ${err.slice(0, 400)}`);
  }
  return code === 0;
}

/**
 * Produce the vertical 720x1280 deliverable from an uploaded landscape clip.
 * Tries NVENC first, falls back to libx264 veryfast (still better quality
 * than the realtime in-browser encode, just costs CPU). Returns true when
 * `dstPath` exists and is non-trivial.
 */
export async function transcodeVertical(opts: {
  srcPath: string;
  dstPath: string;
  trace: FocusTracePoint[];
  srcW: number;
  srcH: number;
}): Promise<boolean> {
  const { srcPath, dstPath, trace, srcW, srcH } = opts;
  if (srcW < 16 || srcH < 16) return false;
  // Full-height 9:16 window; X pans along the trace.
  const cropW = even(Math.min(srcW, (srcH * DEST_W) / DEST_H));
  const cropH = even(srcH);
  const initialX = Math.round(
    Math.min(srcW - cropW, Math.max(0, (trace[0]?.x ?? srcW / 2) - cropW / 2)),
  );

  const cmdPath = resolve(tmpdir(), `jj-crop-${randomUUID()}.cmd`);
  await Bun.write(cmdPath, buildSendcmd(trace, srcW, cropW));

  const filter = (label: string) =>
    `sendcmd=f=${cmdPath},crop=${cropW}:${cropH}:${initialX}:0,` +
    `scale=${DEST_W}:${DEST_H}:flags=lanczos${label}`;

  try {
    const nvenc = await runFfmpeg([
      "-y",
      "-i", srcPath,
      "-vf", filter(""),
      "-c:v", "h264_nvenc",
      "-preset", "p5",
      "-rc", "vbr",
      "-cq", "22",
      "-b:v", "0",
      "-maxrate", "14M",
      "-bufsize", "20M",
      "-movflags", "+faststart",
      "-an",
      dstPath,
    ]);
    if (nvenc && (await Bun.file(dstPath).size) > 10_000) return true;

    console.warn("[clips] nvenc transcode failed — falling back to libx264");
    const x264 = await runFfmpeg([
      "-y",
      "-i", srcPath,
      "-vf", filter(""),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "21",
      "-movflags", "+faststart",
      "-an",
      dstPath,
    ]);
    return x264 && (await Bun.file(dstPath).size) > 10_000;
  } finally {
    await unlink(cmdPath).catch(() => {});
  }
}
