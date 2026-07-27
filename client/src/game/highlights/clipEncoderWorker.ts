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
//        audioFrame {frame: AudioData}     — LIVE audio (ClipRecorder, clip-
//                                            goal D4/B3), transferred, one
//                                            per real-time chunk; distinct
//                                            from `audio` below, which is
//                                            ReplayScene's one-shot offline
//                                            render (CL.B)
//        audio  {sampleRate, channels}     — offline OfflineAudioContext
//                                            render, whole track at once
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
  /** Announce an audio track — either an offline replay render (clip-goal
   *  CL.B, one `audio` message with the whole rendered track at `finish`)
   *  or ClipRecorder's live capture (clip-goal D4/B3, a stream of
   *  `audioFrame` messages as they arrive). Either way, tracks must be
   *  registered before Output.start(). */
  audio?: boolean;
};
type FrameMsg = { t: "frame"; frame: VideoFrame };
/** Planar f32 PCM from an OfflineAudioContext render — one channel per
 *  entry, all the same length, scheduled from timestamp 0. */
type AudioMsg = { t: "audio"; sampleRate: number; channels: Float32Array[] };
/** One live audio chunk (clip-goal D4/B3 — ClipRecorder's real-time path,
 *  via MediaStreamTrackProcessor). Mirrors FrameMsg's video handling
 *  exactly: transferred, closed here, dropped harmlessly if no audio track
 *  is open for the current segment. */
type AudioFrameMsg = { t: "audioFrame"; frame: AudioData };
type InMsg = BeginMsg | FrameMsg | AudioMsg | AudioFrameMsg | { t: "finish" } | { t: "cancel" };

let output: Output | null = null;
let source: VideoSampleSource | null = null;
let audioSource: AudioSampleSource | null = null;
let encodedW = 0;
let encodedH = 0;
/** First live AudioData timestamp (microseconds, its own capture-time
 *  clock) seen THIS segment — subtracted from every subsequent frame so the
 *  audio track's zero lines up with the segment's video-frame zero (which
 *  is performance.now()-based, a totally different clock). Reset on every
 *  `begin`. Loose (±one chunk) sync is fine here — MediaRecorder's own
 *  native muxing needs none of this; only the WebCodecs worker path does. */
let audioSegmentZeroUs: number | null = null;
/** Serialize async handling — messages must apply in arrival order. */
let chain: Promise<void> = Promise.resolve();

function fail(err: unknown): void {
  output = null;
  source = null;
  postMessage({ t: "error", message: err instanceof Error ? err.message : String(err) });
}

async function handleBegin(msg: BeginMsg): Promise<void> {
  audioSegmentZeroUs = null;
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

/** Live audio path (clip-goal D4/B3 — ClipRecorder's real-time capture).
 *  Mirrors handleFrame's video handling: the audio track only exists once
 *  `begin` declared one (msg.audio), so a frame arriving with no
 *  `audioSource` (segment boundary race, or MediaRecorder fallback active)
 *  is just closed, never queued or thrown. Rebases each segment's FIRST
 *  live AudioData timestamp to 0 so it lines up with the video clock (see
 *  audioSegmentZeroUs's own comment) — loose (±one chunk) sync is the
 *  documented, accepted tolerance for a real-time capture. */
async function handleAudioFrame(msg: AudioFrameMsg): Promise<void> {
  const frame = msg.frame;
  if (!audioSource) {
    frame.close();
    return;
  }
  if (audioSegmentZeroUs === null) audioSegmentZeroUs = frame.timestamp;
  const sample = new AudioSample(frame);
  try {
    sample.setTimestamp(Math.max(0, (frame.timestamp - audioSegmentZeroUs) / 1_000_000));
    await audioSource.add(sample);
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
        case "audioFrame":
          return handleAudioFrame(msg);
        case "finish":
          return handleFinish();
        case "cancel":
          return handleCancel();
      }
    })
    .catch((err) => {
      if (msg.t === "frame") (msg as FrameMsg).frame.close();
      else if (msg.t === "audioFrame") (msg as AudioFrameMsg).frame.close();
      fail(err);
    });
};
