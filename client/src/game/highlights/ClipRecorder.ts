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
  private readonly canvas: HTMLCanvasElement;
  private readonly deps: ClipRecorderDeps;

  constructor(canvas: HTMLCanvasElement, deps: ClipRecorderDeps = {}) {
    this.canvas = canvas;
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
    this.mimeType = mimeType;
    this.stopped = false;
    this.stream = this.canvas.captureStream(30);
    this.beginSegment();
  }

  stop(): void {
    this.stopped = true;
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
    this.pendingFinishAtMs = null;
    // onstop will fire but `this.stopped` guards it from starting a new
    // segment; the in-flight one is simply discarded (not uploaded).
    this.recorder?.stop();
    this.recorder = null;
    this.stream = null;
    this.currentChunks = [];
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
