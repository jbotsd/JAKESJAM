// Host-rendered clips — pillar 4's end state, automated (SESSION_GOAL
// task #16, Jake: "the host renders the clip and that is what gets used").
//
// A phone captures a phone-resolution mezzanine; the HOST has a 4080 and a
// deterministic replay of the same match. So: matchHost records the kill
// moments of HUMAN players during play; when the match's replay persists,
// each moment becomes a render job; this queue drives a headless Chromium
// through the EXISTING ReplayScene offline renderer (?replay=&render=1),
// which uploads through the normal /clips/upload pipeline (share page +
// NVENC vertical) at full desktop quality — the device that played never
// encodes anything.
//
// Serialized (one Chromium at a time — it shares the GPU with the live
// world), bounded queue, hard per-job timeout, off-switch JJ_RENDER_CLIPS=0.

import { basename } from "node:path";

const ENABLED = process.env.JJ_RENDER_CLIPS !== "0";
const MAX_QUEUE = 12;
/** Per-job wall clock: render + encode + upload of a ~12s clip. */
const JOB_TIMEOUT_MS = 6 * 60_000;
const CDP_PORT = 9231;
/** 9s of lead-up, 3s of aftermath — 720 ticks @60Hz → 360 frames @30fps. */
const PRE_TICKS = 540;
const CLIP_TICKS = 720;
/** Renders per match cap — a 12-kill stomp shouldn't camp the GPU. */
const MAX_PER_MATCH = 3;

export type RenderJob = {
  replayFile: string;
  fromTick: number;
  ticks: number;
  followId: string;
  label: string;
};

const queue: RenderJob[] = [];
let running = false;
let chromiumPath: string | null | undefined;

async function findChromium(): Promise<string | null> {
  if (chromiumPath !== undefined) return chromiumPath;
  for (const candidate of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const proc = Bun.spawn(["which", candidate], { stdout: "pipe", stderr: "ignore" });
      const out = (await new Response(proc.stdout).text()).trim();
      if (out) {
        chromiumPath = out;
        return out;
      }
    } catch {
      // keep looking
    }
  }
  chromiumPath = null;
  return null;
}

/**
 * Turn a match's kill moments into render jobs. Call once per match after
 * its replay persisted. `kills` = human-killer moments in tick order.
 */
export function enqueueMatchHighlights(
  replayPath: string,
  kills: Array<{ tick: number; killerId: string }>,
  port: number,
): void {
  if (!ENABLED || kills.length === 0) return;
  const file = basename(replayPath);
  // Best-spread selection: dedupe kills within one clip window, keep the
  // LAST kill of each cluster (multi-kills end on the biggest moment).
  const moments: Array<{ tick: number; killerId: string }> = [];
  for (const k of kills) {
    const prev = moments[moments.length - 1];
    if (prev && k.tick - prev.tick < CLIP_TICKS) moments[moments.length - 1] = k;
    else moments.push(k);
  }
  for (const m of moments.slice(0, MAX_PER_MATCH)) {
    if (queue.length >= MAX_QUEUE) {
      console.warn(`[clip-render] queue full — dropping ${file}@${m.tick}`);
      break;
    }
    queue.push({
      replayFile: file,
      fromTick: Math.max(0, m.tick - PRE_TICKS),
      ticks: CLIP_TICKS,
      followId: m.killerId,
      label: `${m.killerId}@${m.tick}`,
    });
  }
  console.log(`[clip-render] queued ${Math.min(moments.length, MAX_PER_MATCH)} job(s) from ${file}`);
  void pump(port);
}

async function pump(port: number): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        await runJob(job, port);
      } catch (err) {
        console.warn(
          `[clip-render] job ${job.label} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    running = false;
  }
}

/** Drive one headless render via CDP; resolves when the page reports the
 *  upload finished (window.__replayRender.status). */
async function runJob(job: RenderJob, port: number): Promise<void> {
  const chromium = await findChromium();
  if (!chromium) {
    console.warn("[clip-render] no chromium binary — host renders disabled");
    queue.length = 0;
    return;
  }
  const url =
    `http://127.0.0.1:${port}/?replay=${encodeURIComponent(job.replayFile)}` +
    `&render=1&from=${job.fromTick}&ticks=${job.ticks}` +
    `&follow=${encodeURIComponent(job.followId)}&rs=1`;
  console.log(`[clip-render] rendering ${job.label} …`);
  const proc = Bun.spawn(
    [
      // nice 15: the render must NEVER contend with the 60Hz sim tick —
      // a highlight can wait; a live multiplayer frame cannot.
      "nice",
      "-n",
      "15",
      chromium,
      "--headless=new",
      "--no-sandbox",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--disable-vulkan-surface",
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1920,1080",
      "--hide-scrollbars",
      "--mute-audio",
      url,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const startedAt = Date.now();
  try {
    // Attach CDP and poll the page's render status.
    await Bun.sleep(3_000);
    const targets = (await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
    ).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error("cdp ws failed"));
    });
    let msgId = 0;
    const evalStatus = (): Promise<string> =>
      new Promise((res) => {
        const id = ++msgId;
        const onMsg = (e: MessageEvent): void => {
          const m = JSON.parse(String(e.data)) as {
            id?: number;
            result?: { result?: { value?: string } };
          };
          if (m.id === id) {
            ws.removeEventListener("message", onMsg);
            res(m.result?.result?.value ?? "");
          }
        };
        ws.addEventListener("message", onMsg);
        ws.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: {
              expression: "window.__replayRender ? window.__replayRender.status : 'boot'",
              returnByValue: true,
            },
          }),
        );
      });
    for (;;) {
      if (Date.now() - startedAt > JOB_TIMEOUT_MS) throw new Error("job timeout");
      const status = await Promise.race([
        evalStatus(),
        Bun.sleep(10_000).then(() => "cdp-timeout"),
      ]);
      if (status === "uploaded") {
        console.log(`[clip-render] ${job.label} uploaded (${Math.round((Date.now() - startedAt) / 1000)}s)`);
        return;
      }
      if (status === "error") throw new Error("page reported render error");
      await Bun.sleep(4_000);
    }
  } finally {
    proc.kill();
  }
}
