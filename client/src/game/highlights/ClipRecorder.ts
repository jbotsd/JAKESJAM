// Segment-based clip capture off the game canvas. Feeds a highlight trigger
// (see highlightRules.ts) into video clips and uploads them to the server's
// /clips/upload endpoint.
//
// WHY SEGMENTS, NOT A SLICED ROLLING BUFFER: an earlier version kept one
// never-stopped MediaRecorder and sliced an arbitrary sub-range of its
// ondataavailable chunks into the "clip." That produced a genuinely CORRUPT
// file — WebM/Matroska only writes its finalizing metadata (Cues, duration)
// when .stop() fires, and a mid-stream slice has neither a valid init
// segment (unless it happens to start at chunk 0) nor a valid close. ffprobe
// confirmed this: "File ended prematurely," duration/frame-rate unreadable.
//
// This version keeps exactly ONE MediaRecorder session per pipeline "in
// flight" at a time and always calls .stop() before treating its output as a
// real file — every clip is therefore a complete, independently valid WebM.
// Lookback is whatever of the current segment preceded the trigger (0 up to
// SEGMENT_MS) rather than a precise fixed window — a real but acceptable
// v1 tradeoff; corruption is not.
//
// OFF BY DEFAULT — this records the player's own gameplay to a server. It is
// only ever constructed behind an explicit opt-in (clipConsent.ts).
//
// TWO OUTPUTS PER TRIGGER (v2, after the first real-footage review):
//   1. VERTICAL 720x1280 — a 9:16 crop whose window TRACKS THE FIGHT PAIR
//      via deps.getFocus (screen-space: midpoint of local + nearest enemy,
//      same envelope law as ActionCamera). v1 static center lost the player
//      under ActionCamera look-ahead; v2 player-only still cropped the
//      victim out of multi-kills. Fight-pair focus keeps both in frame.
//      The window is smoothed (exp lerp) so it pans like a camera operator
//      instead of jittering with every velocity change, and clamped to the
//      source bounds.
//   2. ORIGINAL landscape (scaled to 1280 wide) — the full view, kept
//      because the crop is lossy by nature: review, devlogs, YouTube.
//
// FPS: captureStream(30) + 5Mbps, paced draw loop. (v2 ran 60fps/8Mbps ×2
// pipelines — Linux Chromium encodes H.264 in SOFTWARE (OpenH264), the
// encoder only achieved ~22fps, and the load stalled the game's own rAF
// loop: gameplay stuttered whenever clips were recording. 30fps that the
// encoder actually sustains beats 60fps it can't.)
//
// v4 (Phase 3): where WebCodecs exists the whole chain moves OFF the main
// thread — per frame the main thread does only `new VideoFrame(canvas)`
// (GPU-side copy) + a transfer to clipEncoderWorker.ts (WebCodecs encode in
// latencyMode 'quality' + mediabunny MP4 mux). No 2D mezzanine canvas, no
// captureStream, no MediaRecorder. MediaRecorder remains as the fallback
// for browsers without WebCodecs and as the escape hatch if the worker
// errors mid-session.

/**
 * Fixed broadcast output box (clip-goal D4/B1). The live source canvas is
 * whatever size the browser window happens to be — the studied clips
 * reproduced the ORIGINAL baseline's exact failure mode (1824×1026,
 * 1920×937, etc. — never quite 16:9, never exactly 1920×1080), because the
 * old mezzanine canvas just scaled proportionally FROM whatever the source
 * was. ReplayScene's render mode fixes this for offline renders by pinning
 * its OWN canvas before any camera math runs (CL.A); ClipRecorder can't do
 * that — resizing `this.sourceCanvas` would resize the live player's actual
 * game window. Instead every captured frame is composited (cover-cropped,
 * never distorted/letterboxed) onto a fixed BROADCAST_WIDTH×HEIGHT canvas
 * BEFORE encoding (see composeBroadcastFrame) — same destination box
 * regardless of the live window's shape.
 */
const BROADCAST_WIDTH = 1920;
const BROADCAST_HEIGHT = 1080;
/** Persistent identity mark (clip-goal D4/B11 — "the file sells nothing
 *  once separated from its share page"). Stamped into the SAME composited
 *  frame the crop above produces — corner, dim, house language (Space
 *  Mono), ≤4% of 1080 tall like CL.D's own ceiling for the render pipeline's
 *  watermark. Text and scrim are pre-rendered ONCE (buildWatermark) and
 *  blitted per frame — a cheap draw, not a re-rasterized glyph run. */
const WATERMARK_TEXT = "JAKESJAM · play.elyad.io";
const WATERMARK_HEIGHT_PX = 30;
const WATERMARK_PAD_X = 14;
const WATERMARK_MARGIN_PX = 18;
/**
 * Closing fade (clip-goal D4/B5-sibling): the "ends on raw mid-fight dead
 * air with zero banner/fade/hold" regression — a hard cut is worse than the
 * ORIGINAL studied baseline's wrong-banner ending. computeSegmentEndAtMs
 * (above) already stops extending the segment shortly after a trigger's own
 * lookahead instead of riding to an arbitrary boundary; this adds the
 * missing visual resolution on top of that: the last FADE_MS of any
 * trigger-covered segment ease to black in composeBroadcastFrame, so an
 * uploaded clip always closes on a deliberate beat instead of a freeze-frame
 * mid-swing. Never fully opaque (0.92 ceiling) — a hint of the final frame
 * still reads through, closer to a broadcast fade than a blackout.
 */
const CLOSING_FADE_MS = 500;
const CLOSING_FADE_MAX_ALPHA = 0.92;
/** Normal segment length — also the max lookback a trigger can capture. */
const SEGMENT_MS = 10_000;
/** Extra time recorded AFTER a trigger so the aftermath (death cam, VFX
 *  settle) is included; a segment is EXTENDED (never cut short) to cover it. */
const LOOKAHEAD_MS = 3_000;
/** Hard ceiling so a trigger landing right before a natural rotation can't
 *  keep extending a single segment indefinitely. */
const MAX_SEGMENT_MS = 20_000;
/** Capture frame rate. Was 60 — but on Linux Chromium MediaRecorder H.264
 *  falls back to OpenH264 SOFTWARE encoding, and two 60fps/8Mbps encodes
 *  starved the main thread to ~22fps (dips to 8fps) — the encoder never
 *  achieved 60 anyway and the stalls made the GAME stutter while clips were
 *  recording. 30fps halves encode + drawImage cost; the paced draw loop
 *  below feeds it exactly 30. */
const CAPTURE_FPS = 30;
/** Explicit bitrate — MediaRecorder's implicit default can be low enough to
 *  look noticeably blocky on fast-moving gameplay. Bitrate is nearly free
 *  CPU-wise for a realtime software encoder (pixels×fps is the expensive
 *  axis).
 *  clip-goal D4/B4: this was 16Mbps, well over probe-clip's ≤9Mbps ceiling
 *  (measured 8.5-9.9Mbps on real ClipRecorder.ts output — the studied dark
 *  arena content looks identical at a much lower rate, per ReplayScene's own
 *  CLIP_BITRATE finding). Matched to that same 7.5Mbps choice for house
 *  consistency rather than importing it — this is a genuinely different
 *  capture path (live realtime vs. offline render) and shouldn't share a
 *  private constant across files. */
const VIDEO_BITS_PER_SECOND = 7_500_000;
/** Draw-loop pacing interval. rAF fires at display rate; we only pay the
 *  two drawImage calls when this much time has passed since the last draw. */
const DRAW_INTERVAL_MS = 1000 / CAPTURE_FPS;
/** Upload floor: a hidden tab stops the rAF draw loop, so captureStream
 *  produces no frames and the recorder emits a header-only blob (the
 *  10-15 BYTE junk files observed in server/.clips). Any real clip at
 *  8Mbps is megabytes; anything under this floor is a dud — drop it. */
const MIN_UPLOAD_BYTES = 100_000;
/** Crop-window smoothing time constant. Time-based (1 − e^(−dt/τ)) so the
 *  pan speed is identical at 30Hz, 60Hz, or a janky 22Hz — the old per-frame
 *  0.12 factor panned at half speed whenever the frame rate halved.
 *  τ=130ms ≈ settles in ~0.4s: pans like a camera operator, never snaps. */
const FOCUS_TAU_MS = 130;

/**
 * Pure segment-end math, extracted for unit testing (clip-goal D4/B5-sibling:
 * "ends on raw mid-fight dead air with zero banner/fade/hold" — a worse
 * ending than the original studied baseline's wrong-banner problem).
 *
 * BUG THIS FIXES: the old formula was `max(naturalEndAt, pendingFinishAtMs)`
 * — so a trigger firing EARLY in a segment (say t=1s of a 10s segment) still
 * rode all the way to the arbitrary 10s natural-rotation boundary instead of
 * wrapping up shortly after its own lookahead, because `naturalEndAt` (10s)
 * is bigger than `pendingFinishAtMs` (~4s). That natural boundary exists only
 * to bound the CONTINUOUS rolling buffer when nothing has happened yet — once
 * a highlight actually fires, the goal is "end soon after the beat" (the same
 * trim-discipline spirit as CL.C's window law), not "keep recording until the
 * next arbitrary clock tick" and cut whatever unrelated moment is on screen
 * then. A pending trigger now governs the end ON ITS OWN; MAX_SEGMENT_MS
 * still caps runaway extension from repeated late triggers.
 */
export function computeSegmentEndAtMs(
  segmentStartedAtMs: number,
  pendingFinishAtMs: number | null,
): number {
  const naturalEndAt = segmentStartedAtMs + SEGMENT_MS;
  const desiredEndAt = pendingFinishAtMs !== null ? pendingFinishAtMs : naturalEndAt;
  return Math.min(desiredEndAt, segmentStartedAtMs + MAX_SEGMENT_MS);
}

/**
 * Pure closing-fade math (clip-goal D4/B5-sibling), extracted for unit
 * testing: 0 while more than CLOSING_FADE_MS remains before the segment's
 * scheduled end, ramping linearly to CLOSING_FADE_MAX_ALPHA exactly at
 * (and past) the deadline. `msLeft` is signed — negative (already past the
 * deadline, e.g. a stalled main thread skipped a frame) clamps to the same
 * max alpha rather than overshooting or going negative.
 */
export function computeClosingFadeAlpha(msLeft: number): number {
  if (msLeft >= CLOSING_FADE_MS) return 0;
  return Math.min(1, Math.max(0, 1 - msLeft / CLOSING_FADE_MS)) * CLOSING_FADE_MAX_ALPHA;
}

export type CoverRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * Pure "object-fit: cover" crop math (clip-goal D4/B1), extracted for unit
 * testing: given a source box and a destination box of DIFFERENT aspect
 * ratio, returns the centered source sub-rect that fills the destination
 * with no distortion and no letterbox bars (the overflow is cropped, never
 * squashed — matching how a real broadcast camera reframes rather than
 * stretches). Equal-aspect source/destination returns the full source rect
 * (a pure upscale/downscale, no crop needed).
 */
export function computeCoverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CoverRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, srcW), sh: Math.max(1, srcH) };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    // Source is WIDER than the destination box — crop the left/right edges,
    // keep full height.
    const sh = srcH;
    const sw = sh * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh };
  }
  // Source is TALLER than (or exactly matches) the destination box — crop
  // the top/bottom edges, keep full width.
  const sw = srcW;
  const sh = sw / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw, sh };
}

export type ClipKind = "vertical" | "original";

export type ClipRecorderDeps = {
  /** Where to upload finished clips. Relative path — resolved against the
   *  page's own origin so it works under any tunnel/host domain. */
  uploadPath?: string;
  /** Fight-pair centre in SOURCE-CANVAS pixel coordinates (player + nearest
   *  enemy midpoint when engaged). Called once per drawn frame; return null
   *  when unknown (falls back to the source center). The scene owns the math. */
  getFocus?: () => { x: number; y: number } | null;
  onUploaded?: (url: string, kind: ClipKind) => void;
  onError?: (err: unknown) => void;
};

function pickSupportedMimeType(): string | null {
  // Order = encode THROUGHPUT, not compression quality. Measured on the
  // first real footage: VP9 realtime software encode at 720x1280 couldn't
  // keep up — clips came out ~12fps regardless of the captureStream cap.
  // H.264 uses the platform hardware encoder in Chrome (full frame rate,
  // and .mp4 is what TikTok wants anyway); VP8 encodes several times
  // faster than VP9 as the software fallback.
  const candidates = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4",
    "video/webm;codecs=h264",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

/** clip-goal D4/B3: the live game's real mixed audio output, when
 *  ProceduralAudio has stood up the evidence tap (see shouldTapEvidenceAudio
 *  in ProceduralAudio.ts — on by default whenever clip capture is on). Read
 *  fresh every time rather than cached once: the tap doesn't exist until the
 *  AudioContext is unlocked by a user gesture, which can happen AFTER
 *  ClipRecorder.start(), so later callers (segment/rotation boundaries) get
 *  a real chance to pick it up once play begins. House audio rule: this is
 *  the game engine's own output, never a synthesized/stock substitute. */
function evidenceAudioTrack(): MediaStreamTrack | null {
  if (typeof window === "undefined") return null;
  const stream = (window as Window & { __jakesjam_evidence_audio_stream__?: MediaStream })
    .__jakesjam_evidence_audio_stream__;
  return stream?.getAudioTracks()[0] ?? null;
}

/** One capture chain: offscreen dest canvas → captureStream → MediaRecorder.
 *  The owning ClipRecorder rotates all pipelines on the same shared timer so
 *  the vertical + original files cover the same moment. */
type Pipeline = {
  kind: ClipKind;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  stream: MediaStream;
  recorder: MediaRecorder | null;
  chunks: Blob[];
};

export class ClipRecorder {
  private pipelines: Pipeline[] = [];
  private segmentStartedAtMs = 0;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFinishAtMs: number | null = null;
  private stopped = true;
  private mimeType: string | null = null;
  /** WebCodecs worker path (v4). Null = MediaRecorder fallback. */
  private encoderWorker: Worker | null = null;
  /** Worker-path segment epoch for VideoFrame timestamps. */
  private segEpochMs = 0;
  /** Whether the CURRENT segment should upload when its file arrives. */
  private workerUploadOnFile = false;
  /** Set when the worker errors — start() must not retry it this session. */
  private workerPathFailed = false;
  private readonly sourceCanvas: HTMLCanvasElement;
  private lastDrawAtMs = 0;
  private readonly deps: ClipRecorderDeps;
  /** Fixed BROADCAST_WIDTH×HEIGHT composite canvas (clip-goal D4/B1/B11) —
   *  every captured frame is drawn here (cover-cropped from the live source
   *  + watermark stamped) BEFORE it reaches either encode path. Built once
   *  in start(); see composeBroadcastFrame. */
  private broadcastCanvas: HTMLCanvasElement | null = null;
  private broadcastCtx: CanvasRenderingContext2D | null = null;
  /** Pre-rendered watermark bitmap (built once — see buildWatermark). Null
   *  only if canvas 2D context creation fails; frames still encode without
   *  it rather than dropping capture entirely. */
  private watermark: HTMLCanvasElement | null = null;
  /** When the CURRENT segment is scheduled to stop (set by scheduleRotation
   *  — see computeSegmentEndAtMs). Used only to drive the closing fade
   *  below; the actual stop is still the real setTimeout in
   *  scheduleRotation, this is just that same deadline read back. */
  private scheduledEndAtMs: number | null = null;
  /** Smoothed crop-window center (source-canvas px). NaN = uninitialised —
   *  first frame snaps straight to the target instead of panning in. */
  private focusX = Number.NaN;
  private focusY = Number.NaN;
  /** Per-segment crop-focus trace (video-timeline ms → mezzanine px).
   *  Uploaded with the segment; the server NVENC-crops the vertical along
   *  it (clipTranscode.ts) — the browser no longer encodes a second stream. */
  private focusTrace: Array<{ t: number; x: number }> = [];
  /** Recorders whose onstop hasn't fired yet during this rotation. */
  private pendingStops = 0;
  /** Whether the segment being stopped should upload once all stops land. */
  private uploadOnStop = false;
  /** Worker-path live audio (clip-goal D4/B3): the MediaStreamTrackProcessor
   *  reader pumping AudioData frames to the encoder worker for the whole
   *  session's life (NOT per-segment — see ensureWorkerAudioTap). Null until
   *  a track is available and the tap is stood up. */
  private audioReader: ReadableStreamDefaultReader<AudioData> | null = null;
  /** Whether the worker has an audio track for the CURRENT segment — decides
   *  the `audio:` flag on each segment's `begin` message. */
  private workerHasAudio = false;

  /** Worker path only: stand up the live-audio pump once a track exists.
   *  Retried at the top of every segment (beginWorkerSegment) rather than
   *  once at start(), because ProceduralAudio's evidence tap doesn't exist
   *  until the AudioContext is unlocked by a user gesture — which can land
   *  after ClipRecorder.start() but almost always lands within one 10s
   *  segment of match start. Idempotent: no-ops once a reader exists. */
  private ensureWorkerAudioTap(): void {
    if (this.audioReader) {
      this.workerHasAudio = true;
      return;
    }
    if (typeof MediaStreamTrackProcessor === "undefined") return;
    const track = evidenceAudioTrack();
    if (!track) return;
    try {
      const processor = new MediaStreamTrackProcessor<AudioData>({ track });
      this.audioReader = processor.readable.getReader();
      this.workerHasAudio = true;
      void this.pumpAudioFrames(this.audioReader);
    } catch (err) {
      this.deps.onError?.(err);
    }
  }

  /** Continuously forwards live AudioData frames to the encoder worker.
   *  Runs for the whole session (see ensureWorkerAudioTap) — the worker
   *  itself gates whether a frame lands anywhere (no audio track declared
   *  for the current segment → it just closes the frame, mirroring how
   *  handleFrame already drops video frames with no active `source`). */
  private async pumpAudioFrames(reader: ReadableStreamDefaultReader<AudioData>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        if (!this.encoderWorker) {
          value.close();
          continue;
        }
        try {
          this.encoderWorker.postMessage({ t: "audioFrame", frame: value }, [
            value as unknown as Transferable,
          ]);
        } catch (err) {
          value.close();
          this.deps.onError?.(err);
        }
      }
    } catch {
      // reader.cancel() (stop()) rejects the in-flight read — expected.
    }
  }

  /** Builds the fixed BROADCAST_WIDTH×HEIGHT composite canvas + watermark
   *  once. Idempotent — safe to call from both start() entry points (worker
   *  path and MediaRecorder fallback both need it). */
  private ensureBroadcastCanvas(): void {
    if (this.broadcastCanvas) return;
    const canvas = document.createElement("canvas");
    canvas.width = BROADCAST_WIDTH;
    canvas.height = BROADCAST_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      this.deps.onError?.(new Error("2D context unavailable for broadcast canvas"));
      return;
    }
    this.broadcastCanvas = canvas;
    this.broadcastCtx = ctx;
    this.watermark = this.buildWatermark();
  }

  /** Pre-renders the "JAKESJAM · play.elyad.io" mark once (text metrics +
   *  a legibility scrim behind it) so per-frame compositing is a single
   *  cheap drawImage blit rather than re-rasterizing glyphs 30×/sec. */
  private buildWatermark(): HTMLCanvasElement | null {
    const fontPx = Math.round(WATERMARK_HEIGHT_PX * 0.56);
    const font = `600 ${fontPx}px "Space Mono", ui-monospace, monospace`;
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return null;
    probe.font = font;
    const width = Math.ceil(probe.measureText(WATERMARK_TEXT).width) + WATERMARK_PAD_X * 2;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = WATERMARK_HEIGHT_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = font;
    ctx.textBaseline = "middle";
    // Quiet scrim so ink-colored text stays legible over bright AND dark
    // game backgrounds alike (ui-axioms.md: instrument-ink quiet, never
    // fights the action for attention).
    ctx.fillStyle = "rgba(10, 9, 14, 0.42)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(230, 224, 208, 0.85)";
    ctx.fillText(WATERMARK_TEXT, WATERMARK_PAD_X, canvas.height / 2 + 1);
    return canvas;
  }

  /** Composites the CURRENT live frame onto the fixed broadcast canvas:
   *  cover-crop from whatever the live window's shape happens to be (B1),
   *  then stamp the watermark (B11). Returns null only when the source
   *  canvas has no pixels yet (0×0, e.g. before first layout) or the 2D
   *  context failed to construct. This is the ONE place either capture
   *  path reads frame pixels from — both get the fix for free. */
  private composeBroadcastFrame(): HTMLCanvasElement | null {
    if (!this.broadcastCanvas || !this.broadcastCtx) return null;
    const sw = this.sourceCanvas.width;
    const sh = this.sourceCanvas.height;
    if (sw === 0 || sh === 0) return null;
    const rect = computeCoverRect(sw, sh, BROADCAST_WIDTH, BROADCAST_HEIGHT);
    this.broadcastCtx.drawImage(
      this.sourceCanvas,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      0,
      0,
      BROADCAST_WIDTH,
      BROADCAST_HEIGHT,
    );
    if (this.watermark) {
      const x = BROADCAST_WIDTH - this.watermark.width - WATERMARK_MARGIN_PX;
      const y = BROADCAST_HEIGHT - this.watermark.height - WATERMARK_MARGIN_PX;
      this.broadcastCtx.drawImage(this.watermark, x, y);
    }
    // Closing fade (clip-goal D4/B5-sibling — see CLOSING_FADE_MS's own
    // comment): only when a trigger is actually driving this segment toward
    // its end — an un-triggered segment rotating naturally is discarded
    // unread, so fading it would be wasted work for zero visual benefit.
    if (this.pendingFinishAtMs !== null && this.scheduledEndAtMs !== null) {
      const alpha = computeClosingFadeAlpha(this.scheduledEndAtMs - performance.now());
      if (alpha > 0) {
        this.broadcastCtx.fillStyle = `rgba(4, 4, 8, ${alpha})`;
        this.broadcastCtx.fillRect(0, 0, BROADCAST_WIDTH, BROADCAST_HEIGHT);
      }
    }
    return this.broadcastCanvas;
  }

  constructor(canvas: HTMLCanvasElement, deps: ClipRecorderDeps = {}) {
    this.sourceCanvas = canvas;
    this.deps = deps;
  }

  /** Start continuous segmented capture. Safe to call once per match. */
  start(): void {
    if (!this.stopped) return;
    this.ensureBroadcastCanvas();
    if (
      typeof VideoEncoder !== "undefined" &&
      !this.workerPathFailed &&
      this.tryStartWorkerPath()
    ) {
      return;
    }
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      this.deps.onError?.(new Error("no supported MediaRecorder mimeType"));
      return;
    }
    // SINGLE pipeline: the broadcast-fixed composite (clip-goal D4/B1 — see
    // BROADCAST_WIDTH/HEIGHT and composeBroadcastFrame), always exactly
    // 1920×1080 regardless of the live window's actual shape. The vertical
    // is produced server-side from this stream + the focus trace (NVENC) —
    // encoding it here too was the main-thread stall that made gameplay
    // stutter during recording.
    const original = this.makePipeline("original", BROADCAST_WIDTH, BROADCAST_HEIGHT);
    if (!original) {
      this.deps.onError?.(new Error("2D context unavailable for clip canvas"));
      return;
    }
    this.pipelines = [original];
    this.mimeType = mimeType;
    this.stopped = false;
    this.focusX = Number.NaN;
    this.focusY = Number.NaN;
    this.lastDrawAtMs = 0;
    this.beginSegment();
    // No internal rAF loop: the host drives capture via captureFrame() from
    // Phaser's POST_RENDER hook — see the preserveDrawingBuffer note below.
  }

  stop(): void {
    this.stopped = true;
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
    this.pendingFinishAtMs = null;
    if (this.audioReader) {
      void this.audioReader.cancel().catch(() => {});
      this.audioReader = null;
    }
    this.workerHasAudio = false;
    if (this.encoderWorker) {
      this.encoderWorker.postMessage({ t: "cancel" });
      this.encoderWorker.terminate();
      this.encoderWorker = null;
    }
    // onstop will fire but `this.stopped` guards it from starting a new
    // segment; the in-flight one is simply discarded (not uploaded).
    for (const p of this.pipelines) {
      p.recorder?.stop();
      p.recorder = null;
      p.chunks = [];
    }
    this.pipelines = [];
  }

  // ── WebCodecs worker path (v4) ───────────────────────────────────────

  /** Returns true when the worker path started (WebCodecs available). */
  private tryStartWorkerPath(): boolean {
    try {
      this.encoderWorker = new Worker(new URL("./clipEncoderWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      return false;
    }
    this.encoderWorker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data);
    // A module worker that fails to LOAD (import error, CSP, bundling)
    // never posts a message — onerror is the only signal.
    this.encoderWorker.onerror = (e: ErrorEvent) =>
      this.onWorkerMessage({ t: "error", message: `worker load/runtime error: ${e.message}` });
    this.stopped = false;
    this.focusX = Number.NaN;
    this.focusY = Number.NaN;
    this.lastDrawAtMs = 0;
    this.beginWorkerSegment();
    console.log("[clips] WebCodecs worker capture active (off-main-thread encode)");
    return true;
  }

  private beginWorkerSegment(): void {
    if (this.stopped || !this.encoderWorker) return;
    this.segmentStartedAtMs = performance.now();
    this.segEpochMs = this.segmentStartedAtMs;
    this.focusTrace = [];
    // clip-goal D4/B3: retried every segment — see ensureWorkerAudioTap's
    // own comment for why this can't just run once in tryStartWorkerPath.
    this.ensureWorkerAudioTap();
    // DIAGNOSTIC (camera-skew investigation): every clip segment start,
    // timestamped and with the source canvas size at that instant — cheap,
    // and lets you eyeball in DevTools whether [diag:governor]/[diag:resize]
    // lines cluster right around this. Remove once root-caused.
    console.log(
      `[diag:clip] segment begin at t=${this.segmentStartedAtMs.toFixed(0)}ms, source ${this.sourceCanvas.width}x${this.sourceCanvas.height}`,
    );
    // width/height are always the fixed broadcast box now (clip-goal
    // D4/B1) — every frame posted to the worker is already composited onto
    // BROADCAST_WIDTH×HEIGHT (see composeBroadcastFrame), never the raw
    // (variable-shaped) source canvas.
    this.encoderWorker.postMessage({
      t: "begin",
      width: BROADCAST_WIDTH,
      height: BROADCAST_HEIGHT,
      bitrate: VIDEO_BITS_PER_SECOND,
      audio: this.workerHasAudio,
    });
    this.scheduleRotation();
  }

  private onWorkerMessage(msg: { t: string; buffer?: ArrayBuffer; width?: number; height?: number; message?: string }): void {
    if (msg.t === "file" && msg.buffer) {
      if (this.workerUploadOnFile) {
        const blob = new Blob([msg.buffer], { type: "video/mp4" });
        if (blob.size >= MIN_UPLOAD_BYTES) {
          void this.upload(blob, msg.width, msg.height);
        } else {
          console.log(`[clips] dropped dud worker segment (${blob.size} bytes — tab hidden?)`);
        }
      }
      if (!this.stopped) this.beginWorkerSegment();
      return;
    }
    if (msg.t === "error") {
      // Worker path is dead for this session — fall back to MediaRecorder.
      console.warn(`[clips] encoder worker failed (${msg.message}) — falling back to MediaRecorder`);
      this.workerPathFailed = true;
      this.encoderWorker?.terminate();
      this.encoderWorker = null;
      if (!this.stopped) {
        this.stopped = true;
        if (this.rotateTimer !== null) {
          clearTimeout(this.rotateTimer);
          this.rotateTimer = null;
        }
        this.start();
      }
    }
  }

  private makePipeline(kind: ClipKind, w: number, h: number): Pipeline | null {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return {
      kind,
      canvas,
      ctx,
      stream: canvas.captureStream(CAPTURE_FPS),
      recorder: null,
      chunks: [],
    };
  }

  /** Drive one capture tick. MUST be called synchronously in the same task
   *  as the WebGL draw (Phaser POST_RENDER) — that guarantee is what lets
   *  the game run with preserveDrawingBuffer:false: the drawing buffer is
   *  only cleared after the task that drew it yields to the compositor.
   *  Paced internally to CAPTURE_FPS — drawing (and feeding the encoder) at
   *  full display rate doubled the encode load for frames the 30fps stream
   *  would drop anyway. A hidden tab stops Phaser's loop → no frames → the
   *  dud-guard drops the header-only blob, same as the old rAF loop. */
  captureFrame(nowMs: number = performance.now()): void {
    if (this.stopped) return;
    if (nowMs - this.lastDrawAtMs < DRAW_INTERVAL_MS - 1) return;
    this.drawFrame(nowMs - (this.lastDrawAtMs || nowMs));
    this.lastDrawAtMs = nowMs;
  }

  private drawFrame(frameDtMs: number): void {
    const sw = this.sourceCanvas.width;
    const sh = this.sourceCanvas.height;
    if (sw === 0 || sh === 0) return;

    // Focus target: the local player's screen position (scene-fed), else
    // the source center. Smoothed so the crop pans, never jitters.
    const focus = this.deps.getFocus?.() ?? null;
    const tx = focus ? Math.max(0, Math.min(sw, focus.x)) : sw / 2;
    const ty = focus ? Math.max(0, Math.min(sh, focus.y)) : sh / 2;
    if (Number.isNaN(this.focusX)) {
      this.focusX = tx;
      this.focusY = ty;
    } else {
      const a = 1 - Math.exp(-Math.max(1, frameDtMs) / FOCUS_TAU_MS);
      this.focusX += (tx - this.focusX) * a;
      this.focusY += (ty - this.focusY) * a;
    }

    // Every captured frame goes through the SAME broadcast composite
    // (clip-goal D4/B1/B11: fixed 1920×1080 cover-crop + watermark stamp)
    // before either encode path ever sees it.
    const composed = this.composeBroadcastFrame();
    if (!composed) return;
    // Trace mapping accounts for the cover-crop's offset/scale, not just a
    // plain ratio — focusTrace is currently dead weight downstream (the
    // vertical NVENC crop it fed was dropped 2026-07-15), kept correct
    // anyway rather than left silently wrong.
    const rect = computeCoverRect(sw, sh, BROADCAST_WIDTH, BROADCAST_HEIGHT);
    const traceX = Math.round(((this.focusX - rect.sx) * BROADCAST_WIDTH) / rect.sw);

    if (this.encoderWorker) {
      // Worker path: one GPU-side copy + transfer; encode/mux off-thread.
      const tMs = performance.now() - this.segEpochMs;
      try {
        const frame = new VideoFrame(composed, {
          timestamp: Math.max(0, Math.round(tMs * 1000)),
        });
        this.encoderWorker.postMessage({ t: "frame", frame }, [frame as unknown as Transferable]);
      } catch (err) {
        this.deps.onError?.(err);
        return;
      }
      this.focusTrace.push({ t: Math.max(0, Math.round(tMs)), x: traceX });
      return;
    }

    for (const p of this.pipelines) {
      // p.canvas is ALSO exactly BROADCAST_WIDTH×HEIGHT (see start()) — a
      // straight 1:1 blit, no further scaling.
      p.ctx.drawImage(composed, 0, 0);
      this.focusTrace.push({
        t: Math.max(0, Math.round(performance.now() - this.segmentStartedAtMs)),
        x: traceX,
      });
    }
  }

  /** Call when a highlight fires. Extends (never shortens) the current
   *  segment's planned end so the trigger's own segment stays intact and
   *  keeps recording through the lookahead window. */
  trigger(nowMs: number = performance.now()): void {
    // Active = worker path OR at least one MediaRecorder pipeline.
    if (this.stopped || (this.pipelines.length === 0 && !this.encoderWorker)) return;
    const finishAt = nowMs + LOOKAHEAD_MS;
    this.pendingFinishAtMs = this.pendingFinishAtMs === null ? finishAt : Math.max(this.pendingFinishAtMs, finishAt);
    this.scheduleRotation();
  }

  private beginSegment(): void {
    if (this.stopped || !this.mimeType) return;
    this.segmentStartedAtMs = performance.now();
    this.focusTrace = [];
    // clip-goal D4/B3: MediaRecorder muxes multi-track streams natively, so
    // the fallback path just needs the live audio track ADDED to the video
    // stream it already captures — no manual timestamp bookkeeping needed
    // (unlike the worker path's per-frame AudioData pump). Read fresh per
    // segment: the tap may not have existed yet at start() (see
    // evidenceAudioTrack's own comment).
    const audioTrack = evidenceAudioTrack();
    for (const p of this.pipelines) {
      p.chunks = [];
      const recordStream = audioTrack
        ? new MediaStream([...p.stream.getVideoTracks(), audioTrack])
        : p.stream;
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(recordStream, {
          mimeType: this.mimeType,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        });
      } catch (err) {
        this.deps.onError?.(err);
        return;
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) p.chunks.push(e.data);
      };
      recorder.onstop = () => this.onPipelineStopped(p);
      recorder.start();
      p.recorder = recorder;
    }
    this.scheduleRotation();
  }

  /** (Re)schedule when the CURRENT segment should be stopped: the natural
   *  SEGMENT_MS boundary, extended to cover any pending trigger's lookahead,
   *  but never past MAX_SEGMENT_MS from this segment's own start. */
  private scheduleRotation(): void {
    if (this.rotateTimer !== null) clearTimeout(this.rotateTimer);
    const cappedEndAt = computeSegmentEndAtMs(this.segmentStartedAtMs, this.pendingFinishAtMs);
    this.scheduledEndAtMs = cappedEndAt;
    const delay = Math.max(0, cappedEndAt - performance.now());
    this.rotateTimer = setTimeout(() => {
      const endedAtMs = performance.now();
      const shouldUpload =
        !this.stopped && this.pendingFinishAtMs !== null && endedAtMs >= this.pendingFinishAtMs;
      if (shouldUpload) this.pendingFinishAtMs = null;
      if (this.encoderWorker) {
        // Worker path: finish the segment; the 'file' reply uploads (when
        // covered by a trigger) and begins the next segment.
        this.workerUploadOnFile = shouldUpload;
        this.encoderWorker.postMessage({ t: "finish" });
        return;
      }
      this.uploadOnStop = shouldUpload;
      this.pendingStops = 0;
      for (const p of this.pipelines) {
        if (p.recorder?.state === "recording") {
          this.pendingStops += 1;
          p.recorder.stop();
        }
      }
      // Nothing was recording (shouldn't happen mid-run) — just restart.
      if (this.pendingStops === 0 && !this.stopped) this.beginSegment();
    }, delay);
  }

  private onPipelineStopped(p: Pipeline): void {
    if (this.uploadOnStop && this.mimeType) {
      const blob = new Blob(p.chunks, { type: this.mimeType });
      // Dud guard: a hidden tab freezes the rAF crop loop → the recorder
      // emits a header-only blob. Uploading those littered server/.clips
      // with 10-15 byte junk files. Drop anything implausibly small.
      if (blob.size >= MIN_UPLOAD_BYTES) {
        void this.upload(blob, p.canvas.width, p.canvas.height);
      } else {
        console.log(`[clips] dropped dud ${p.kind} segment (${blob.size} bytes — tab hidden?)`);
      }
    }
    p.chunks = [];
    this.pendingStops -= 1;
    if (this.pendingStops <= 0 && !this.stopped) this.beginSegment();
  }

  private async upload(blob: Blob, width?: number, height?: number): Promise<void> {
    try {
      const form = new FormData();
      const ext = blob.type.includes("webm") ? "webm" : "mp4";
      form.append("file", blob, `clip-original.${ext}`);
      // Aspect-ratio fix (2026-07-20), now largely moot: width/height used
      // to vary with whatever the live window's shape was (a narrower/
      // taller browser caused giant unnecessary letterbox bars on the share
      // page, which assumed 1920x1080). clip-goal D4/B1 fixed the root
      // cause — every encoded frame is now composited onto the fixed
      // BROADCAST_WIDTH×HEIGHT box (composeBroadcastFrame), so these are
      // always exactly 1920x1080. Still sent explicitly rather than
      // omitted: correct and stated beats correct-by-server-default.
      if (width && height) {
        form.append("width", String(width));
        form.append("height", String(height));
      }
      const res = await fetch(this.deps.uploadPath ?? "/clips/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`clip upload failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      this.deps.onUploaded?.(url, "original");
    } catch (err) {
      this.deps.onError?.(err);
    }
  }
}
