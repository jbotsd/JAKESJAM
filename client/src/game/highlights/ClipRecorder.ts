// Rolling-buffer clip capture off the game canvas. Feeds a highlight trigger
// (see highlightRules.ts) into a trailing-window video clip and uploads it to
// the server's /clips/upload endpoint, which stores it at a static path ready
// for the future TikTok PULL_FROM_URL step.
//
// OFF BY DEFAULT — this records the player's own gameplay to a server. It is
// only ever constructed behind an explicit opt-in (see OnlineMatchScene), and
// real product use needs a visible consent toggle before defaulting to on.
// This module does not add that UI; it's the capture mechanism only.

const CHUNK_MS = 1000;
/** Seconds of footage kept before a trigger, once one fires. */
const LOOKBACK_MS = 8_000;
/** Extra seconds recorded AFTER a trigger before the clip is finalized, so the
 *  kill's immediate aftermath (death cam, VFX settle) is included. */
const LOOKAHEAD_MS = 3_000;
/** Ring buffer depth — must comfortably exceed LOOKBACK_MS / CHUNK_MS. */
const MAX_CHUNKS = 30;

type Chunk = { blob: Blob; atMs: number };

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
  private recorder: MediaRecorder | null = null;
  private ring: Chunk[] = [];
  private pendingFinishAt: number | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly deps: ClipRecorderDeps;

  constructor(canvas: HTMLCanvasElement, deps: ClipRecorderDeps = {}) {
    this.canvas = canvas;
    this.deps = deps;
  }

  /** Start continuous rolling capture. Safe to call once per match. */
  start(): void {
    if (this.recorder) return;
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      this.deps.onError?.(new Error("no supported MediaRecorder mimeType"));
      return;
    }
    const stream = this.canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      this.ring.push({ blob: e.data, atMs: performance.now() });
      while (this.ring.length > MAX_CHUNKS) this.ring.shift();
      if (this.pendingFinishAt !== null && performance.now() >= this.pendingFinishAt) {
        this.finalizeClip();
      }
    };
    recorder.start(CHUNK_MS);
    this.recorder = recorder;
  }

  stop(): void {
    this.recorder?.stop();
    this.recorder = null;
    this.ring = [];
  }

  /** Call when a highlight fires. If one is already pending, the newer
   *  trigger just extends the window rather than starting a second clip. */
  trigger(nowMs: number = performance.now()): void {
    const finishAt = nowMs + LOOKAHEAD_MS;
    this.pendingFinishAt = this.pendingFinishAt === null ? finishAt : Math.max(this.pendingFinishAt, finishAt);
  }

  private finalizeClip(): void {
    const finishAt = this.pendingFinishAt;
    this.pendingFinishAt = null;
    if (finishAt === null) return;
    const windowStart = finishAt - LOOKAHEAD_MS - LOOKBACK_MS;
    const chunks = this.ring.filter((c) => c.atMs >= windowStart);
    if (chunks.length === 0) return;
    const blob = new Blob(
      chunks.map((c) => c.blob),
      { type: chunks[0]!.blob.type },
    );
    void this.upload(blob);
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
