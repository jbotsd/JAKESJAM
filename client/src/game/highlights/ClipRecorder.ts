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

/** Mezzanine output width (height derived from source aspect, both capped
 *  at the source size). Full-res: the single stream this recorder encodes is
 *  BOTH the landscape deliverable and the master the server NVENC-crops the
 *  vertical from — 1280 here meant a soft upscaled 720p everywhere. */
const MEZZANINE_MAX_WIDTH = 1920;
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
 *  axis), and this stream is the MASTER the server transcodes from — spend
 *  bits: 16Mbps holds the thin-line arena art at 1080p30. */
const VIDEO_BITS_PER_SECOND = 16_000_000;
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

  constructor(canvas: HTMLCanvasElement, deps: ClipRecorderDeps = {}) {
    this.sourceCanvas = canvas;
    this.deps = deps;
  }

  /** Start continuous segmented capture. Safe to call once per match. */
  start(): void {
    if (!this.stopped) return;
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
    // SINGLE pipeline: the landscape mezzanine at native resolution (capped
    // 1920 wide). The vertical is produced server-side from this stream +
    // the focus trace (NVENC) — encoding it here too was the main-thread
    // stall that made gameplay stutter during recording.
    const srcW = this.sourceCanvas.width || 1280;
    const srcH = this.sourceCanvas.height || 720;
    const mezzW = Math.min(MEZZANINE_MAX_WIDTH, srcW);
    const mezzH = Math.max(2, Math.round((mezzW * srcH) / srcW / 2) * 2);
    const original = this.makePipeline("original", mezzW, mezzH);
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
    // DIAGNOSTIC (camera-skew investigation): every clip segment start,
    // timestamped and with the source canvas size at that instant — cheap,
    // and lets you eyeball in DevTools whether [diag:governor]/[diag:resize]
    // lines cluster right around this. Remove once root-caused.
    console.log(
      `[diag:clip] segment begin at t=${this.segmentStartedAtMs.toFixed(0)}ms, source ${this.sourceCanvas.width}x${this.sourceCanvas.height}`,
    );
    this.encoderWorker.postMessage({
      t: "begin",
      width: this.sourceCanvas.width || 1280,
      height: this.sourceCanvas.height || 720,
      bitrate: VIDEO_BITS_PER_SECOND,
    });
    this.scheduleRotation();
  }

  private onWorkerMessage(msg: { t: string; buffer?: ArrayBuffer; width?: number; height?: number; message?: string }): void {
    if (msg.t === "file" && msg.buffer) {
      if (this.workerUploadOnFile) {
        const blob = new Blob([msg.buffer], { type: "video/mp4" });
        const trace = decimateTrace(this.focusTrace);
        if (blob.size >= MIN_UPLOAD_BYTES) {
          void this.upload(blob, trace, msg.width ?? 0, msg.height ?? 0);
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

    if (this.encoderWorker) {
      // Worker path: one GPU-side copy + transfer; encode/mux off-thread.
      // The worker caps encoded width at 1920 like the old mezzanine, so
      // the trace is logged in ENCODED px (the uploaded coordinate space).
      const tMs = performance.now() - this.segEpochMs;
      try {
        const frame = new VideoFrame(this.sourceCanvas, {
          timestamp: Math.max(0, Math.round(tMs * 1000)),
        });
        this.encoderWorker.postMessage({ t: "frame", frame }, [frame as unknown as Transferable]);
      } catch (err) {
        this.deps.onError?.(err);
        return;
      }
      const encodedW = Math.min(1920, sw);
      this.focusTrace.push({
        t: Math.max(0, Math.round(tMs)),
        x: Math.round(this.focusX * (encodedW / sw)),
      });
      return;
    }

    for (const p of this.pipelines) {
      // Full view scaled to the mezzanine canvas. The vertical crop is no
      // longer drawn or encoded here — the smoothed focus is LOGGED and the
      // server NVENC-crops along it (clipTranscode.ts).
      p.ctx.drawImage(this.sourceCanvas, 0, 0, sw, sh, 0, 0, p.canvas.width, p.canvas.height);
      this.focusTrace.push({
        t: Math.max(0, Math.round(performance.now() - this.segmentStartedAtMs)),
        // Trace in MEZZANINE px (the uploaded video's coordinate space).
        x: Math.round(this.focusX * (p.canvas.width / sw)),
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
    for (const p of this.pipelines) {
      p.chunks = [];
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(p.stream, {
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
    const naturalEndAt = this.segmentStartedAtMs + SEGMENT_MS;
    const desiredEndAt =
      this.pendingFinishAtMs !== null ? Math.max(naturalEndAt, this.pendingFinishAtMs) : naturalEndAt;
    const cappedEndAt = Math.min(desiredEndAt, this.segmentStartedAtMs + MAX_SEGMENT_MS);
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
      // Snapshot the trace NOW — beginSegment() below resets it before the
      // async upload reads it.
      const trace = decimateTrace(this.focusTrace);
      // Dud guard: a hidden tab freezes the rAF crop loop → the recorder
      // emits a header-only blob. Uploading those littered server/.clips
      // with 10-15 byte junk files. Drop anything implausibly small.
      if (blob.size >= MIN_UPLOAD_BYTES) {
        void this.upload(blob, trace, p.canvas.width, p.canvas.height);
      } else {
        console.log(`[clips] dropped dud ${p.kind} segment (${blob.size} bytes — tab hidden?)`);
      }
    }
    p.chunks = [];
    this.pendingStops -= 1;
    if (this.pendingStops <= 0 && !this.stopped) this.beginSegment();
  }

  private async upload(
    blob: Blob,
    trace: Array<{ t: number; x: number }>,
    mezzW: number,
    mezzH: number,
  ): Promise<void> {
    try {
      const form = new FormData();
      const ext = blob.type.includes("webm") ? "webm" : "mp4";
      form.append("file", blob, `clip-original.${ext}`);
      // The server produces the vertical from this stream + the trace
      // (NVENC — see server/src/clipTranscode.ts).
      form.append("focusTrace", JSON.stringify(trace));
      form.append("srcW", String(mezzW));
      form.append("srcH", String(mezzH));
      const res = await fetch(this.deps.uploadPath ?? "/clips/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`clip upload failed: ${res.status}`);
      const { url, verticalUrl } = (await res.json()) as {
        url: string;
        verticalUrl?: string;
      };
      this.deps.onUploaded?.(url, "original");
      if (verticalUrl) this.deps.onUploaded?.(verticalUrl, "vertical");
    } catch (err) {
      this.deps.onError?.(err);
    }
  }
}

/** Cap the uploaded trace at ~600 points (30Hz × 20s max segment) — evenly
 *  strided so long segments still cover the whole timeline. */
function decimateTrace(
  trace: Array<{ t: number; x: number }>,
): Array<{ t: number; x: number }> {
  const MAX_POINTS = 600;
  if (trace.length <= MAX_POINTS) return trace.slice();
  const out: Array<{ t: number; x: number }> = [];
  const stride = trace.length / MAX_POINTS;
  for (let i = 0; i < MAX_POINTS; i++) {
    out.push(trace[Math.floor(i * stride)]!);
  }
  return out;
}
