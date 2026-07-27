// Real-WS-client broadcastSnapshot scaling probe (2026-07-27 lag/perf audit,
// phase-2 item 1).
//
// The prior pass's server-tick probe (serverTickPerfProbe.ts) measured
// tick() cost with 0 human clients ever attached — bots don't go through
// `this.clients` at all, so `broadcastSnapshot`'s AOI-filter + encodeDelta +
// ws.send loop (matchHost.ts's `broadcastSnapshot`, ~1833) never once ran
// in that data. This probe closes that specific gap with the cheapest tool
// that actually exercises it: a Bun-native `WebSocket` client (same
// technique server/probe-s2c.ts already uses for the venue lobby) speaking
// the real wire protocol against a REAL, unmodified game server process —
// no browser, no GPU, no Playwright. Safe to run even on a loaded box.
//
// Protocol: POST /world-token {playerId} -> {token, wsPath}, then
// `ws://host:port/ws/world?token=...`. Opening the socket alone spawns a
// real player entity (WorldHost.attach -> spawnFor) and puts it in
// `this.clients`, so it starts receiving every broadcastSnapshot tick
// exactly like a real browser client would. Each synthetic client sends a
// near-zero-rate keepalive `in` (input) frame every 4s — well under the
// 20s LIVENESS_TIMEOUT_MS backstop — so it stays attached without adding
// meaningful `applyInput` cost of its own; the thing being measured is the
// OUTBOUND broadcast loop, not inbound input processing.
//
// One FRESH isolated server process per client count (own port, own
// process) — not one server with clients added incrementally — so each
// N's tickTimingStats() ring buffer is uncontaminated by a different N's
// ticks (the buffer is 3600 samples / 60s at 60Hz; sequential phases in one
// process would bleed into each other).
//
// Run: `bun scripts/broadcastSnapshotClientScalingProbe.ts [secondsPerPhase]`
// (default 25s/phase — 4 phases, ~2min total wall time).

import { spawn } from "node:child_process";
import { encodeMessage, decodeMessage, type ClientMessage } from "../client/src/net/protocol.ts";

const ROOT = "/mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM";
const SECONDS_PER_PHASE = Number(process.argv[2] ?? "25");
const CLIENT_COUNTS = [0, 2, 4, 8];
const BASE_PORT = 8130; // well clear of :8088 (live) and the 8097-8099 latency-probe ports

async function healthy(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitHealthy(base: string, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await healthy(base)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function bootServer(port: number, spikeLog: boolean): ReturnType<typeof spawn> {
  return spawn("bun", ["src/index.ts"], {
    cwd: `${ROOT}/server`,
    env: {
      ...process.env,
      GAME_SERVER_SECRET: "dev-insecure-secret",
      SERVE_CLIENT_DIR: `${ROOT}/client/dist`,
      PORT: String(port),
      ...(spikeLog ? { JJ_TICK_SPIKE_LOG: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

type SyntheticClient = { stop: () => void; snapshotsReceived: () => number };

async function connectSyntheticClient(base: string, playerId: string): Promise<SyntheticClient> {
  const tokenRes = await fetch(`${base}/world-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  const { token, wsPath } = (await tokenRes.json()) as { token: string; wsPath: string };
  const wsUrl = new URL(wsPath, base.replace(/^http/, "ws"));
  wsUrl.searchParams.set("token", token);
  wsUrl.searchParams.set("name", "PROBE");

  const ws = new WebSocket(wsUrl.toString());
  ws.binaryType = "arraybuffer";
  let snapshots = 0;
  let seq = 1;
  ws.onmessage = (ev) => {
    const decoded = decodeMessage(new Uint8Array(ev.data as ArrayBuffer));
    if (decoded && (decoded.message as { t: string }).t === "snap") snapshots += 1;
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`ws open failed for ${playerId}`));
    setTimeout(() => reject(new Error(`ws open timeout for ${playerId}`)), 8000);
  }).catch((err) => console.warn(`[probe] ${String(err)}`));

  const keepalive = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const msg: ClientMessage = { t: "in", seq: seq++ as never, tick: 0 as never, keys: 0, aimX: 0, aimY: 0, dt: 1 / 60 };
    try {
      ws.send(encodeMessage(msg));
    } catch {
      /* socket may have closed between the readyState check and send */
    }
  }, 4000);

  return {
    stop: () => {
      clearInterval(keepalive);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
    snapshotsReceived: () => snapshots,
  };
}

type PhaseResult = {
  n: number;
  stats: { count: number; meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number } | null;
  world: unknown;
  spikeLines: string[];
};

async function measureN(n: number, index: number): Promise<PhaseResult> {
  const port = BASE_PORT + index;
  const base = `http://localhost:${port}`;
  console.log(`\n[probe] === N=${n} clients — booting isolated server on :${port} ===`);
  const proc = bootServer(port, true);
  const spikeLines: string[] = [];
  proc.stdout?.on("data", (d) => {
    const text = String(d);
    for (const line of text.split("\n")) {
      if (line.includes("[tick-spike]")) spikeLines.push(line.trim());
    }
  });
  proc.stderr?.on("data", () => {});

  if (!(await waitHealthy(base))) {
    console.error(`[probe] N=${n}: server never became healthy — skipping`);
    proc.kill();
    return { n, stats: null, world: null, spikeLines: [] };
  }

  const clients: SyntheticClient[] = [];
  for (let i = 0; i < n; i++) {
    clients.push(await connectSyntheticClient(base, `probe_scale_${n}_${i}_${Math.random().toString(36).slice(2, 6)}`));
  }
  if (n > 0) {
    // Let the world register the new attaches (spawnFor + first snapshots)
    // before the measurement window starts.
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`[probe] N=${n}: ${n} client(s) attached, measuring for ${SECONDS_PER_PHASE}s...`);
  await new Promise((r) => setTimeout(r, SECONDS_PER_PHASE * 1000));

  const health = (await fetch(`${base}/health`).then((r) => r.json())) as {
    world: unknown;
    perf: PhaseResult["stats"];
  };
  const totalSnaps = clients.reduce((a, c) => a + c.snapshotsReceived(), 0);
  console.log(`[probe] N=${n}: snapshots received across all clients = ${totalSnaps}`);
  console.log(`[probe] N=${n}: tickTimingStats = ${JSON.stringify(health.perf)}`);
  console.log(`[probe] N=${n}: tick-spike log lines (dt>5ms) = ${spikeLines.length}`);

  for (const c of clients) c.stop();
  proc.kill();
  await new Promise((r) => setTimeout(r, 800));

  return { n, stats: health.perf, world: health.world, spikeLines };
}

const results: PhaseResult[] = [];
for (let i = 0; i < CLIENT_COUNTS.length; i++) {
  results.push(await measureN(CLIENT_COUNTS[i]!, i));
}

console.log("\n=== SUMMARY: tick timing (ms) vs. attached real-WS client count ===");
console.log(
  ["N", "count", "meanMs", "p50Ms", "p95Ms", "p99Ms", "maxMs", "spikes>5ms"].join("\t"),
);
for (const r of results) {
  const s = r.stats;
  console.log(
    [
      r.n,
      s?.count ?? "-",
      s?.meanMs.toFixed(3) ?? "-",
      s?.p50Ms.toFixed(3) ?? "-",
      s?.p95Ms.toFixed(3) ?? "-",
      s?.p99Ms.toFixed(3) ?? "-",
      s?.maxMs.toFixed(3) ?? "-",
      r.spikeLines.length,
    ].join("\t"),
  );
}

process.exit(0);
