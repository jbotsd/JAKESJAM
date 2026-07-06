// Segment-based clip capture off the game canvas. Feeds a highlight trigger
// (see highlightRules.ts) into a video clip and uploads it to the server's
// /clips/upload endpoint, which stores it at a static path ready for the
// future TikTok PULL_FROM_URL step.
//
// WHY SEGMENTS, NOT A SLICED ROLLING BUFFER: an earlier version kept one
// never-stopped MediaRecorder and sliced an arbitrary sub-range of its
// ondataavailable chunks into the "clip." That produced a genuinely CORRUPT
// file — WebM/Matroska only writes its finalizing metadata (Cues, duration)
// when .stop() fires, and a mid-stream slice has neither a valid init
// segment (unless it happens to start at chunk 0) nor a valid close. ffprobe
// confirmed this: "File ended prematurely," duration/frame-rate unreadable.
//
// This version keeps exactly ONE MediaRecorder session "in flight" at a
// time and always calls .stop() on it before treating its output as a real
// file — every clip is therefore a complete, independently valid WebM.
// Lookback is whatever of the current segment preceded the trigger (0 up to
// SEGMENT_MS) rather than a precise fixed window — a real but acceptable
// v1 tradeoff; corruption is not.
//
// OFF BY DEFAULT — this records the player's own gameplay to a server. It is
// only ever constructed behind an explicit opt-in (see OnlineMatchScene), and
// real product use needs a visible consent toggle before defaulting to on.
// This module does not add that UI; it's the capture mechanism only.
//
// FORMAT: TikTok is a 9:16 VERTICAL platform. Capturing the raw landscape
// game canvas produces a small, pillarboxed clip in the feed — the content
// itself reads as unwatchable regardless of file validity. This crops a
// centered vertical strip out of the landscape canvas every frame onto an
// offscreen destination canvas, and captures THAT. No per-frame focus
// tracking is needed: OnlineMatchScene.followLocalPlayer already calls
// `camera.centerOn(localPlayer)` every tick, so the local player already
// sits at the horizontal center of the source canvas — a centered crop
// keeps them centered in the vertical output for free.

/** TikTok-native vertical output resolution. */
const DEST_WIDTH = 720;
const DEST_HEIGHT = 1280;
/** Normal segment length — also the max lookback a trigger can capture. */
const SEGMENT_MS = 10_000;
/** Extra time recorded AFTER a trigger so the aftermath (death cam, VFX
 *  settle) is included; a segment is EXTENDED (never cut short) to cover it. */
const LOOKAHEAD_MS = 3_000;
/** Hard ceiling so a trigger landing right before a natural rotation can't
 *  keep extending a single segment indefinitely. */
const MAX_SEGMENT_MS = 20_000;
/** Explicit bitrate — MediaRecorder's implicit default can be low enough to
 *  look noticeably blocky on fast-moving gameplay. */
const VIDEO_BITS_PER_SECOND = 5_000_000;

export type ClipRecorderDeps = {
  /** Where to upload finished clips. Relative path — resolved against the
   *  page's own origin so it works under any tunnel/host domain. */
  uploadPath?: string;
  onUploaded?: (url: string) => void;
  onError?: (err: unknown) => void;
};

function pickSupportedMimeType(): string | null {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export class ClipRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private currentChunks: Blob[] = [];
  private segmentStartedAtMs = 0;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFinishAtMs: number | null = null;
  private stopped = true;
  private mimeType: string | null = null;
  private readonly sourceCanvas: HTMLCanvasElement;
  private readonly destCanvas: HTMLCanvasElement;
  private readonly destCtx: CanvasRenderingContext2D | null;
  private drawRafId: number | null = null;
  private readonly deps: ClipRecorderDeps;

  constructor(canvas: HTMLCanvasElement, deps: ClipRecorderDeps = {}) {
    this.sourceCanvas = canvas;
    this.destCanvas = document.createElement("canvas");
    this.destCanvas.width = DEST_WIDTH;
    this.destCanvas.height = DEST_HEIGHT;
    this.destCtx = this.destCanvas.getContext("2d");
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
    if (!this.destCtx) {
      this.deps.onError?.(new Error("2D context unavailable for vertical-crop canvas"));
      return;
    }
    this.mimeType = mimeType;
    this.stopped = false;
    // Capture the CROPPED destination canvas, not the raw landscape source.
    this.stream = this.destCanvas.captureStream(30);
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
    this.recorder?.stop();
    this.recorder = null;
    this.stream = null;
    this.currentChunks = [];
  }

  private startDrawLoop(): void {
    const draw = () => {
      if (this.stopped) return;
      this.drawCroppedFrame();
      this.drawRafId = requestAnimationFrame(draw);
    };
    this.drawRafId = requestAnimationFrame(draw);
  }

  /** Draw a centered 9:16 vertical strip of the source canvas onto the
   *  destination canvas. Centered horizontally is sufficient — the camera
   *  already keeps the local player there (see the file header comment). */
  private drawCroppedFrame(): void {
    if (!this.destCtx) return;
    const sw = this.sourceCanvas.width;
    const sh = this.sourceCanvas.height;
    if (sw === 0 || sh === 0) return;
    let cropW = sh * (DEST_WIDTH / DEST_HEIGHT);
    let cropH = sh;
    if (cropW > sw) {
      // Source is already narrower than a 9:16 slice needs (e.g. portrait
      // mobile) — crop by width instead so cropW/H never exceed the source.
      cropW = sw;
      cropH = sw * (DEST_HEIGHT / DEST_WIDTH);
    }
    const cropX = (sw - cropW) / 2;
    const cropY = (sh - cropH) / 2;
    this.destCtx.drawImage(this.sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, DEST_WIDTH, DEST_HEIGHT);
  }

  /** Call when a highlight fires. Extends (never shortens) the current
   *  segment's planned end so the trigger's own segment stays intact and
   *  keeps recording through the lookahead window. */
  trigger(nowMs: number = performance.now()): void {
    if (this.stopped || !this.recorder) return;
    const finishAt = nowMs + LOOKAHEAD_MS;
    this.pendingFinishAtMs = this.pendingFinishAtMs === null ? finishAt : Math.max(this.pendingFinishAtMs, finishAt);
    this.scheduleRotation();
  }

  private beginSegment(): void {
    if (this.stopped || !this.stream || !this.mimeType) return;
    this.currentChunks = [];
    this.segmentStartedAtMs = performance.now();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch (err) {
      this.deps.onError?.(err);
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.currentChunks.push(e.data);
    };
    recorder.onstop = () => this.onSegmentComplete();
    recorder.start();
    this.recorder = recorder;
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
      if (this.recorder?.state === "recording") this.recorder.stop();
    }, delay);
  }

  private onSegmentComplete(): void {
    const endedAtMs = performance.now();
    const shouldUpload = !this.stopped && this.pendingFinishAtMs !== null && endedAtMs >= this.pendingFinishAtMs;
    if (shouldUpload && this.mimeType) {
      this.pendingFinishAtMs = null;
      const blob = new Blob(this.currentChunks, { type: this.mimeType });
      void this.upload(blob);
    }
    if (!this.stopped) this.beginSegment();
  }

  private async upload(blob: Blob): Promise<void> {
    try {
      const form = new FormData();
      const ext = blob.type.includes("webm") ? "webm" : "mp4";
      form.append("file", blob, `clip.${ext}`);
      const res = await fetch(this.deps.uploadPath ?? "/clips/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`clip upload failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      this.deps.onUploaded?.(url);
    } catch (err) {
      this.deps.onError?.(err);
    }
  }
}
