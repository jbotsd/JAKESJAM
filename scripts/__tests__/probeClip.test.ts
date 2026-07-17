// probe-clip verifier self-test (clip-goal CL.0).
//
// Two directions, both required:
//   1. A KNOWN-GOOD synthetic clip (1920×1080@30, sine audio, faststart)
//      passes EVERY check — the gate can actually open.
//   2. The studied baseline clip (dff7f450…) fails EXACTLY the checks its
//      indexed defects predict (B1 resolution, B2 fps/duration, B3 audio,
//      B4 bitrate) and passes faststart — the gate maps to reality.

import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeClip, FFMPEG } from "../probe-clip.ts";

const BASELINE = new URL(
  "../../server/.clips/dff7f450-55dc-4316-8df7-654ebf4e2ccb.mp4",
  import.meta.url,
).pathname;

let goodClip = "";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-clip-test-"));
  goodClip = join(dir, "good.mp4");
  const proc = Bun.spawn(
    [
      FFMPEG,
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=30:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
      goodClip,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg synthetic clip failed: ${await new Response(proc.stderr).text()}`);
});

describe("probe-clip verifier (CL.0)", () => {
  test("known-good synthetic clip passes every check", async () => {
    const result = await probeClip(goodClip, { ticks: 120, targetFps: 30 });
    const failed = result.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(result.passed).toBe(true);
  }, 60_000);

  test("baseline clip fails exactly its indexed defects (B1-B4) and passes faststart", async () => {
    if (!(await Bun.file(BASELINE).exists())) {
      console.warn("baseline clip absent on this machine — skipping reality-mapping test");
      return;
    }
    const result = await probeClip(BASELINE, { ticks: 720, targetFps: 30 });
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c.pass]));
    expect(byName["resolution"]).toBe(false); // B1 1896×950
    expect(byName["fps-real"]).toBe(false); // B2 21.6fps
    expect(byName["fps-meta"]).toBe(false); // B2 57600/1
    expect(byName["duration"]).toBe(false); // B2 9.96s of 12s
    expect(byName["audio"]).toBe(false); // B3 silent
    expect(byName["bitrate"]).toBe(false); // B4 10.8Mbps
    expect(byName["faststart"]).toBe(true); // already correct in prod
    expect(result.passed).toBe(false);
  }, 120_000);
});
