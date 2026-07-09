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
//   1. VERTICAL 720x1280 — a 9:16 crop whose window TRACKS THE LOCAL PLAYER
//      via deps.getFocus (screen-space position fed by the scene each call).
//      The v1 static center-crop assumed the camera kept the player centered
//      — true under the old centerOn() camera, but the ActionCamera
//      deliberately leads AHEAD of the player (look-ahead + action centroid
//      + deadzone), so a fixed center crop lost the player entirely.
//      The window is smoothed (exp lerp) so it pans like a camera operator
//      instead of jittering with every velocity change, and clamped to the
//      source bounds.
//   2. ORIGINAL landscape (scaled to 1280 wide) — the full view, kept
//      because the crop is lossy by nature: review, devlogs, YouTube.
//
// FPS: captureStream(60) + 8Mbps (v1's 30fps/5Mbps read as choppy on
// fast-moving gameplay).

/** TikTok-native vertical output resolution. */
const DEST_WIDTH = 720;
const DEST_HEIGHT = 1280;
/** Original-view output width (height derived from source aspect). */
const ORIGINAL_WIDTH = 1280;
/** Normal segment length — also the max lookback a trigger can capture. */
const SEGMENT_MS = 10_000;
/** Extra time recorded AFTER a trigger so the aftermath (death cam, VFX
 *  settle) is included; a segment is EXTENDED (never cut short) to cover it. */
const LOOKAHEAD_MS = 3_000;
/** Hard ceiling so a trigger landing right before a natural rotation can't
 *  keep extending a single segment indefinitely. */
const MAX_SEGMENT_MS = 20_000;
/** Capture frame rate. The draw loop runs on rAF (display rate); 60 here
 *  lets captureStream propagate every one of those frames. */
const CAPTURE_FPS = 60;
/** Explicit bitrate — MediaRecorder's implicit default can be low enough to
 *  look noticeably blocky on fast-moving gameplay. */
const VIDEO_BITS_PER_SECOND = 8_000_000;
/** Upload floor: a hidden tab stops the rAF draw loop, so captureStream
 *  produces no frames and the recorder emits a header-only blob (the
 *  10-15 BYTE junk files observed in server/.clips). Any real clip at
 *  8Mbps is megabytes; anything under this floor is a dud — drop it. */
const MIN_UPLOAD_BYTES = 100_000;
/** Crop-window smoothing: fraction of the remaining distance covered per
 *  frame (~60Hz). 0.12 ≈ settles in ~0.3s — pans like a camera operator,
 *  never snaps, never jitters with per-frame velocity noise. */
const FOCUS_LERP = 0.12;

export type ClipKind = "vertical" | "original";

export type ClipRecorderDeps = {
  /** Where to upload finished clips. Relative path — resolved against the
   *  page's own origin so it works under any tunnel/host domain. */
  uploadPath?: string;
  /** Local player's CURRENT position in SOURCE-CANVAS pixel coordinates.
   *  Called once per drawn frame; return null when unknown (falls back to
   *  the source center). The scene owns the camera math. */
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
  private readonly sourceCanvas: HTMLCanvasElement;
  private drawRafId: number | null = null;
  private readonly deps: ClipRecorderDeps;
  /** Smoothed crop-window center (source-canvas px). NaN = uninitialised —
   *  first frame snaps straight to the target instead of panning in. */
  private focusX = Number.NaN;
  private focusY = Number.NaN;
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
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      this.deps.onError?.(new Error("no supported MediaRecorder mimeType"));
      return;
    }
    const vertical = this.makePipeline("vertical", DEST_WIDTH, DEST_HEIGHT);
    // Original keeps the source aspect, scaled to ORIGINAL_WIDTH so a
    // fullscreen 1440p canvas doesn't demand a 2560-wide realtime encode.
    const srcW = this.sourceCanvas.width || 1280;
    const srcH = this.sourceCanvas.height || 720;
    const origH = Math.max(2, Math.round((ORIGINAL_WIDTH * srcH) / srcW / 2) * 2);
    const original = this.makePipeline("original", ORIGINAL_WIDTH, origH);
    if (!vertical || !original) {
      this.deps.onError?.(new Error("2D context unavailable for clip canvases"));
      return;
    }
    this.pipelines = [vertical, original];
    this.mimeType = mimeType;
    this.stopped = false;
    this.focusX = Number.NaN;
    this.focusY = Number.NaN;
    this.beginSegment();
    this.startDrawLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
    if (this.drawRafId !== null) {
      cancelAnimationFrame(this.drawRafId);
      this.drawRafId = null;
    }
    this.pendingFinishAtMs = null;
    // onstop will fire but `this.stopped` guards it from starting a new
    // segment; the in-flight one is simply discarded (not uploaded).
    for (const p of this.pipelines) {
      p.recorder?.stop();
      p.recorder = null;
      p.chunks = [];
    }
    this.pipelines = [];
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

  private startDrawLoop(): void {
    const draw = () => {
      if (this.stopped) return;
      this.drawFrame();
      this.drawRafId = requestAnimationFrame(draw);
    };
    this.drawRafId = requestAnimationFrame(draw);
  }

  private drawFrame(): void {
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
      this.focusX += (tx - this.focusX) * FOCUS_LERP;
      this.focusY += (ty - this.focusY) * FOCUS_LERP;
    }

    for (const p of this.pipelines) {
      if (p.kind === "vertical") {
        // 9:16 window centered on the smoothed focus, clamped in-bounds.
        let cropW = sh * (DEST_WIDTH / DEST_HEIGHT);
        let cropH = sh;
        if (cropW > sw) {
          cropW = sw;
          cropH = sw * (DEST_HEIGHT / DEST_WIDTH);
        }
        const cropX = Math.max(0, Math.min(sw - cropW, this.focusX - cropW / 2));
        const cropY = Math.max(0, Math.min(sh - cropH, this.focusY - cropH / 2));
        p.ctx.drawImage(this.sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, DEST_WIDTH, DEST_HEIGHT);
      } else {
        // Original: full view scaled to the pipeline canvas.
        p.ctx.drawImage(this.sourceCanvas, 0, 0, sw, sh, 0, 0, p.canvas.width, p.canvas.height);
      }
    }
  }

  /** Call when a highlight fires. Extends (never shortens) the current
   *  segment's planned end so the trigger's own segment stays intact and
   *  keeps recording through the lookahead window. */
  trigger(nowMs: number = performance.now()): void {
    if (this.stopped || this.pipelines.length === 0) return;
    const finishAt = nowMs + LOOKAHEAD_MS;
    this.pendingFinishAtMs = this.pendingFinishAtMs === null ? finishAt : Math.max(this.pendingFinishAtMs, finishAt);
    this.scheduleRotation();
  }

  private beginSegment(): void {
    if (this.stopped || !this.mimeType) return;
    this.segmentStartedAtMs = performance.now();
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
      this.uploadOnStop =
        !this.stopped && this.pendingFinishAtMs !== null && endedAtMs >= this.pendingFinishAtMs;
      if (this.uploadOnStop) this.pendingFinishAtMs = null;
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
        void this.upload(blob, p.kind);
      } else {
        console.log(`[clips] dropped dud ${p.kind} segment (${blob.size} bytes — tab hidden?)`);
      }
    }
    p.chunks = [];
    this.pendingStops -= 1;
    // Restart both pipelines together once the LAST one has flushed, so the
    // next segment's files stay time-aligned.
    if (this.pendingStops <= 0 && !this.stopped) this.beginSegment();
  }

  private async upload(blob: Blob, kind: ClipKind): Promise<void> {
    try {
      const form = new FormData();
      const ext = blob.type.includes("webm") ? "webm" : "mp4";
      form.append("file", blob, `clip-${kind}.${ext}`);
      const res = await fetch(this.deps.uploadPath ?? "/clips/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`clip upload failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      this.deps.onUploaded?.(url, kind);
    } catch (err) {
      this.deps.onError?.(err);
    }
  }
}
