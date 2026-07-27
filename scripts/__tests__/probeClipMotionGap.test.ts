// probe-clip motion/static-span self-test (clip-goal STUDY 3, finding D7).
//
// D7: the "motion" check (byte-identity of 10fps-sampled PNGs) passes even
// when a clip is perceptually static for seconds at a time, because real
// encoder output is quantization-noisy — two frames of genuinely static
// footage are almost never byte-identical, so "motion" never sees them as
// duplicates. That is a DIFFERENT failure mode from dropped-frame stutter
// (where the same rendered content is genuinely repeated verbatim), and
// needs its own check ("static-span", added alongside "motion" in
// scripts/probe-clip.ts) rather than a fix to the existing one.
//
// All three fixtures here are synthetic (ffmpeg lavfi sources), never a
// real game clip — the point is to pin the MECHANISM, not re-litigate any
// specific studied footage:
//
//   - moving.mp4   continuous testsrc2 animation, realistic lossy encode.
//                  Proves neither check false-positives on normal motion.
//   - stutter.mp4  testsrc2 resampled 30fps -> 3fps -> 30fps (each unique
//                  frame held for ~333ms) and encoded LOSSLESS (-qp 0) so
//                  the held frames decode back out byte-identical — a
//                  clean, deterministic stand-in for dropped-frame stutter.
//                  Proves "motion" catches it (real duplicate bytes) while
//                  "static-span" does NOT fire (each hold is ~0.33s, far
//                  under the 3s default threshold — drops are brief and
//                  isolated between real motion, not a sustained dead spot).
//   - static.mp4   a flat color field with genuine per-frame temporal noise
//                  (simulating a still, ~static scene) encoded with a
//                  REALISTIC lossy preset — the same preset/CRF ballpark a
//                  production render actually uses. Lossy compression
//                  washes the noise down to sub-visible quantization-scale
//                  deltas, which is exactly D7's failure mode: "motion"
//                  passes (no byte-identical pairs — the noise keeps every
//                  frame's bytes unique) while "static-span" correctly
//                  fails (the pixel-delta signal stays near zero for the
//                  whole clip).

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeClip, FFMPEG } from "../probe-clip.ts";

let dir = "";
let movingClip = "";
let stutterClip = "";
let staticClip = "";

async function encode(args: string[], out: string) {
  const proc = Bun.spawn([FFMPEG, "-v", "error", "-y", ...args, out], { stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`ffmpeg fixture build failed (${out}): ${await new Response(proc.stderr).text()}`);
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "probe-clip-motion-gap-"));
  movingClip = join(dir, "moving.mp4");
  stutterClip = join(dir, "stutter.mp4");
  staticClip = join(dir, "static.mp4");

  await encode(
    [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    ],
    movingClip,
  );

  // Downsample to 3 unique frames/sec then back up to 30fps by duplication
  // (each unique frame held ~333ms), then encode LOSSLESS so the held
  // frames survive decode as genuine byte-identical duplicates — isolating
  // the "motion" check's exact mechanism from encoder noise.
  await encode(
    [
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4",
      "-vf", "fps=3,fps=30",
      "-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-pix_fmt", "yuv420p",
    ],
    stutterClip,
  );

  // Flat field + real per-frame temporal noise, encoded with an ordinary
  // lossy preset — the noise is genuine content-level variation, but at
  // this amplitude a realistic encoder quantizes nearly all of it away,
  // which is exactly what makes real "dead air" footage defeat byte-
  // identity checks.
  await encode(
    [
      "-f", "lavfi", "-i", "color=c=gray:size=640x360:rate=30:duration=4,noise=alls=4:allf=t",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    ],
    staticClip,
  );
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("probe-clip motion vs static-span (STUDY 3, D7)", () => {
  test("normal motion: neither check false-positives", async () => {
    const result = await probeClip(movingClip, {});
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["motion"]!.pass).toBe(true);
    expect(byName["static-span"]!.pass).toBe(true);
  }, 30_000);

  test("dropped-frame stutter: 'motion' catches it, 'static-span' stays quiet", async () => {
    const result = await probeClip(stutterClip, {});
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["motion"]!.pass).toBe(false);
    expect(byName["motion"]!.detail).toMatch(/^[1-9]\d* identical consecutive pair/);
    // The held frames are brief (~0.33s each) and separated by real motion —
    // never a sustained dead spot, so static-span must NOT fire here. This
    // is the crux of D7: the two checks target different failure modes.
    expect(byName["static-span"]!.pass).toBe(true);
  }, 30_000);

  test("genuinely static span: 'static-span' catches it even though 'motion' passes", async () => {
    const result = await probeClip(staticClip, { staticSpanSeconds: 3 });
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    // This is D7 exactly: quantization noise keeps every sampled frame's
    // bytes unique, so the byte-identity check has nothing to catch.
    expect(byName["motion"]!.pass).toBe(true);
    expect(byName["static-span"]!.pass).toBe(false);
    expect(byName["static-span"]!.detail).toMatch(/^\d+\.\d\ds longest near-zero pixel-delta run/);
  }, 30_000);

  test("static-span threshold is tunable via staticSpanSeconds", async () => {
    // The same static footage passes when given a longer allowance than its
    // actual static run — proves the check measures a real run length
    // rather than hard-failing any static content outright.
    const result = await probeClip(staticClip, { staticSpanSeconds: 30 });
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["static-span"]!.pass).toBe(true);
  }, 30_000);
});
