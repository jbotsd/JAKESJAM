// Clip encoder worker — WebCodecs + mediabunny, entirely off the main
// thread (RENDER_OVERHAUL_PLAN Phase 3, remote-player capture).
//
// The main thread's only per-captured-frame cost is `new VideoFrame(canvas)`
// (a GPU-side texture copy) + a transfer here. Encoding (WebCodecs in
// latencyMode 'quality' — pull-based, never drops frames to wall clock) and
// MP4 muxing (mediabunny) happen in this worker. On Linux/NVIDIA Chromium
// the encode is still software (VAAPI blocked upstream) — but it no longer
// contends with the game loop, which was the original sin of the
// MediaRecorder path (main-thread OpenH264 starving rAF).
//
// Protocol (all messages {t: ...}):
//   in:  begin  {width, height, bitrate}   — start a segment
//        frame  {frame: VideoFrame}        — transferred; closed here
//        finish {}                         — finalize → out: file
//        cancel {}                         — drop the in-flight segment
//   out: file   {buffer: ArrayBuffer, width, height} (buffer transferred)
//        error  {message}                  — recorder falls back to
//                                            MediaRecorder for the session

import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSource,
} from "mediabunny";

/** Cap the encoded width like the old mezzanine (supersampled canvases at
 *  renderScale > 1 would otherwise upload 2880px masters). */
const MAX_WIDTH = 1920;

type BeginMsg = {
  t: "begin";
  width: number;
  height: number;
  bitrate: number;
  /** Announce an audio track (offline replay renders, clip-goal CL.B) —
   *  tracks must be registered before Output.start(), but the rendered
   *  PCM only exists at the end, so begin declares and finish delivers. */
  audio?: boolean;
};
type FrameMsg = { t: "frame"; frame: VideoFrame };
/** Planar f32 PCM from an OfflineAudioContext render — one channel per
 *  entry, all the same length, scheduled from timestamp 0. */
type AudioMsg = { t: "audio"; sampleRate: number; channels: Float32Array[] };
type InMsg = BeginMsg | FrameMsg | AudioMsg | { t: "finish" } | { t: "cancel" };

let output: Output | null = null;
let source: VideoSampleSource | null = null;
let audioSource: AudioSampleSource | null = null;
let encodedW = 0;
let encodedH = 0;
/** Serialize async handling — messages must apply in arrival order. */
let chain: Promise<void> = Promise.resolve();

function fail(err: unknown): void {
  output = null;
  source = null;
  postMessage({ t: "error", message: err instanceof Error ? err.message : String(err) });
}

async function handleBegin(msg: BeginMsg): Promise<void> {
  const scale = msg.width > MAX_WIDTH ? MAX_WIDTH / msg.width : 1;
  // avc requires EVEN dimensions (a 1920x937 canvas is a real case — window
  // height is whatever it is). Always normalize through the transform.
  encodedW = Math.max(2, Math.round((msg.width * scale) / 2) * 2);
  encodedH = Math.max(2, Math.round((msg.height * scale) / 2) * 2);
  output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  source = new VideoSampleSource({
    codec: "avc",
    bitrate: msg.bitrate,
    latencyMode: "quality",
    keyFrameInterval: 2,
    // Every frame is normalized to the even encoded box — this also absorbs
    // governor renderScale resizes mid-segment (passThrough lets changed
    // frames reach the transform instead of throwing).
    sizeChangeBehavior: "passThrough",
    transform: { width: encodedW, height: encodedH, fit: "fill" },
  });
  output.addVideoTrack(source);
  if (msg.audio) {
    // AAC when the encoder exists (Chrome proper), Opus otherwise —
    // headless/Linux Chromium ships no mp4a.40.2 ENCODER (decode ≠ encode),
    // and Opus-in-MP4 plays everywhere modern. Verified live 2026-07-17:
    // the AAC config rejects at first sample on this box's chromium.
    let codec: "aac" | "opus" = "aac";
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2",
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
      if (!support.supported) codec = "opus";
    } catch {
      codec = "opus";
    }
    audioSource = new AudioSampleSource({ codec, bitrate: 128_000 });
    output.addAudioTrack(audioSource);
  }
  await output.start();
}

async function handleAudio(msg: AudioMsg): Promise<void> {
  if (!audioSource || msg.channels.length === 0) return;
  // One AudioSample carrying the whole rendered track, planar f32,
  // starting at 0 — the OfflineAudioContext timeline IS the clip timeline.
  const frames = msg.channels[0]!.length;
  const data = new Float32Array(frames * msg.channels.length);
  msg.channels.forEach((ch, i) => data.set(ch, i * frames));
  const sample = new AudioSample({
    data,
    format: "f32-planar",
    numberOfChannels: msg.channels.length,
    sampleRate: msg.sampleRate,
    timestamp: 0,
  });
  try {
    await audioSource.add(sample);
  } finally {
    sample.close();
  }
}

async function handleFrame(msg: FrameMsg): Promise<void> {
  const frame = msg.frame;
  if (!source) {
    frame.close();
    return;
  }
  const sample = new VideoSample(frame);
  try {
    await source.add(sample);
  } finally {
    sample.close();
    frame.close();
  }
}

async function handleFinish(): Promise<void> {
  if (!output) return;
  const out = output;
  output = null;
  source = null;
  audioSource = null;
  await out.finalize();
  const buffer = (out.target as BufferTarget).buffer;
  if (buffer) {
    postMessage({ t: "file", buffer, width: encodedW, height: encodedH }, { transfer: [buffer] });
  } else {
    postMessage({ t: "error", message: "finalize produced no buffer" });
  }
}

async function handleCancel(): Promise<void> {
  if (!output) return;
  const out = output;
  output = null;
  source = null;
  audioSource = null;
  await out.cancel();
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  chain = chain
    .then(() => {
      switch (msg.t) {
        case "begin":
          return handleBegin(msg);
        case "frame":
          return handleFrame(msg);
        case "audio":
          return handleAudio(msg);
        case "finish":
          return handleFinish();
        case "cancel":
          return handleCancel();
      }
    })
    .catch((err) => {
      if (msg.t === "frame") (msg as FrameMsg).frame.close();
      fail(err);
    });
};
