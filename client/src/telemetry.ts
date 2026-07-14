// Sovereign telemetry — the no-bug-report pipeline (docs/TELEMETRY.md).
//
// Everything here honors the privacy contract by CONSTRUCTION:
//   - same-origin POST only (relative /telemetry, like /clips/upload)
//   - session id = crypto.randomUUID() held in module memory — never
//     persisted, never correlated across sessions
//   - device facts limited to the tier-debugging set the game already
//     derives (renderer string, tier, screen, DPR, touch/desktop)
//   - offline/failed batches are DROPPED, not hoarded in storage
//
// Capture: window.onerror, unhandledrejection, WebGL context loss, plus
// breadcrumbs pushed by the engine (connects, closes, governor steps,
// scene changes). Errors ship with the last BREADCRUMB_MAX crumbs.

type CrumbKind = "net" | "perf" | "scene" | "error" | "boot" | "clip";

export type TelemetryEvent = {
  /** Event kind — the server indexes on this. */
  kind: "error" | "context-loss" | "net" | "perf" | "boot";
  /** Short machine signature for dedupe (message + top app frame). */
  sig: string;
  message: string;
  stack?: string;
  /** Breadcrumb ring at capture time (errors only). */
  crumbs?: string[];
  /** Extra structured facts (shape-checked server-side, size-capped). */
  data?: Record<string, string | number | boolean>;
};

const BREADCRUMB_MAX = 40;
const BATCH_MAX_BYTES = 32 * 1024;
const BATCH_MIN_INTERVAL_MS = 5_000;
/** Per-session client-side cap — a crash loop must not become a firehose. */
const MAX_EVENTS_PER_SESSION = 120;
/** Same error signature repeating: send the first few, then count locally. */
const MAX_PER_SIGNATURE = 5;

const sessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Math.random().toString(36).slice(2)}`;

const crumbs: string[] = [];
const queue: TelemetryEvent[] = [];
const sigCounts = new Map<string, number>();
let seq = 0;
let sentCount = 0;
let lastFlushAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let bootAtMs = 0;

/** Engine lifecycle breadcrumb — one short line, ring-buffered. */
export function crumb(kind: CrumbKind, text: string): void {
  const t = ((performance.now() - bootAtMs) / 1000).toFixed(1);
  crumbs.push(`${t}s ${kind}: ${text}`);
  if (crumbs.length > BREADCRUMB_MAX) crumbs.shift();
}

/** Queue a telemetry event (batched; drops when session caps are hit). */
export function record(ev: TelemetryEvent): void {
  const perSig = (sigCounts.get(ev.sig) ?? 0) + 1;
  sigCounts.set(ev.sig, perSig);
  if (perSig > MAX_PER_SIGNATURE || sentCount + queue.length >= MAX_EVENTS_PER_SESSION) {
    return; // counted locally, not shipped — the first occurrences carry the info
  }
  queue.push(ev);
  scheduleFlush();
}

/** Convenience: record an error-kind event with the crumb ring attached. */
export function recordError(source: string, message: string, stack?: string): void {
  // Browser-extension noise (wallets fighting over window.ethereum, etc.)
  // is not ours to fix and burns the per-session event budget.
  if (stack?.includes("chrome-extension://") || stack?.includes("moz-extension://")) {
    return;
  }
  crumb("error", message.slice(0, 120));
  record({
    kind: "error",
    sig: signature(message, stack),
    message: message.slice(0, 500),
    stack: stack?.slice(0, 4_000),
    crumbs: [...crumbs],
    data: { source },
  });
}

/** message + first app stack frame — stable across reloads of one build. */
function signature(message: string, stack?: string): string {
  const frame = stack?.split("\n").find((l) => l.includes("/assets/")) ?? "";
  const raw = `${message.slice(0, 160)}|${frame.trim().slice(0, 160)}`;
  // Tiny FNV-1a — no crypto needed, just a short stable bucket key.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  const wait = Math.max(0, BATCH_MIN_INTERVAL_MS - (performance.now() - lastFlushAt));
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush(false);
  }, wait);
}

function takeBatch(): { body: string; count: number } | null {
  if (queue.length === 0) return null;
  const events: Array<TelemetryEvent & { seq: number }> = [];
  let size = 200; // envelope overhead
  while (queue.length > 0) {
    const ev = { ...queue[0]!, seq: seq++ };
    const evSize = JSON.stringify(ev).length;
    if (events.length > 0 && size + evSize > BATCH_MAX_BYTES) break;
    queue.shift();
    events.push(ev);
    size += evSize;
    if (size > BATCH_MAX_BYTES) break;
  }
  return {
    body: JSON.stringify({ v: 1, session: sessionId, build: buildHash(), events }),
    count: events.length,
  };
}

async function flush(pagehide: boolean): Promise<void> {
  const batch = takeBatch();
  if (!batch) return;
  lastFlushAt = performance.now();
  // sentCount only advances on CONFIRMED delivery — a failed/offline/
  // rejected attempt must not silently spend the per-session event budget
  // (MAX_EVENTS_PER_SESSION), or a network blip / server hiccup permanently
  // silences the rest of the session's error reporting despite nothing
  // ever having reached the server.
  try {
    if (pagehide && "sendBeacon" in navigator) {
      const queued = navigator.sendBeacon(
        "/telemetry",
        new Blob([batch.body], { type: "application/json" }),
      );
      if (queued) sentCount += batch.count;
      return;
    }
    const res = await fetch("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: batch.body,
      keepalive: pagehide,
    });
    if (res.ok) sentCount += batch.count;
  } catch {
    // Offline or server down: DROP (privacy contract — never hoard in storage).
  }
  if (queue.length > 0) scheduleFlush();
}

function buildHash(): string {
  // The bundle filename carries the content hash (e.g. index-J-Kn9S1i.js).
  const src = (document.querySelector("script[src*='/assets/']") as HTMLScriptElement | null)?.src;
  const m = src?.match(/index-([\w-]+)\.js/);
  return m?.[1] ?? "dev";
}

/** Install global capture + the boot event. Call ONCE, as early as possible. */
export function installTelemetry(deps: {
  tier: string;
  rendererString: string;
  touch: boolean;
}): void {
  if (installed) return;
  // Automation hygiene: headless/driven browsers (screenshot runs, e2e
  // probes) must not pollute the error pipeline with software-GL noise.
  if (typeof navigator !== "undefined" && navigator.webdriver) return;
  installed = true;
  bootAtMs = performance.now();

  window.addEventListener("error", (e) => {
    recordError("window.onerror", String(e.message ?? e.error ?? "unknown"), e.error?.stack);
  });
  // Handled-but-logged failures: most game errors surface via
  // console.error (net failures, upload errors, WebGL warnings) rather
  // than throwing — "I saw an error on my phone" must be catchable. The
  // per-signature cap keeps a log-spam loop from becoming a firehose.
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    origError(...args);
    try {
      const msg = args
        .map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")
        .slice(0, 300);
      const stack = args.find((a): a is Error => a instanceof Error)?.stack;
      recordError("console.error", msg, stack);
    } catch {
      // Never let telemetry break logging.
    }
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]): void => {
    origWarn(...args);
    try {
      crumb("error", `warn: ${args.map(String).join(" ").slice(0, 140)}`);
    } catch {
      // ignore
    }
  };
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    recordError(
      "unhandledrejection",
      r instanceof Error ? r.message : String(r ?? "unknown"),
      r instanceof Error ? r.stack : undefined,
    );
  });
  // Ship whatever is pending when the tab hides/leaves (mobile lifecycle).
  window.addEventListener("pagehide", () => void flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });

  record({
    kind: "boot",
    sig: "boot",
    message: "boot",
    data: {
      tier: deps.tier,
      renderer: deps.rendererString.slice(0, 120),
      touch: deps.touch,
      w: window.screen.width,
      h: window.screen.height,
      dpr: window.devicePixelRatio,
    },
  });
}

/** Watch a canvas for WebGL context loss (Phaser hands us its canvas). */
export function watchContextLoss(canvas: HTMLCanvasElement): void {
  canvas.addEventListener("webglcontextlost", () => {
    record({
      kind: "context-loss",
      sig: "ctx-lost",
      message: "webgl context lost",
      crumbs: [...crumbs],
    });
    void flush(true); // context loss often precedes a dead tab — ship now
  });
  canvas.addEventListener("webglcontextrestored", () => crumb("perf", "webgl context restored"));
}
