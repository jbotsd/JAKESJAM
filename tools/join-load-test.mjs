// Join-path load test — Track P4 ("a join-path load test before any
// public moment").
//
// Asks one question: when N people click the link at once, how many get
// in, and how long does it take? It exercises the REAL join contract —
// POST /world-token, then WS /ws/world?token= — and waits for the first
// server frame, because an open socket is not the same as being in the
// world.
//
// THE RATE LIMITS ARE PART OF THE ANSWER. The server allows 20 token
// mints per minute and 30 WS connects per 5 minutes PER IP
// (server/src/index.ts). From one machine every virtual client shares an
// IP, so a naive run measures the limiter rather than the server and
// reports a scary failure rate that real traffic would never see. This
// counts 429s separately and says so. For a genuine capacity number the
// load has to come from multiple source IPs.
//
//   bun tools/join-load-test.mjs --url http://localhost:8288 \
//       --clients 16 --ramp-ms 3000 --hold-ms 15000
//
// NEVER point it at :8088 without meaning to — it is a load test.

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BASE = opt("url", "http://localhost:8288");
const CLIENTS = Number(opt("clients", "16"));
const RAMP_MS = Number(opt("ramp-ms", "3000"));
const HOLD_MS = Number(opt("hold-ms", "15000"));

if (BASE.includes(":8088") && !args.includes("--i-mean-it")) {
  console.error("Refusing to load-test :8088 (the live host). Pass --i-mean-it if that is genuinely the intent.");
  process.exit(2);
}

const wsBase = BASE.replace(/^http/, "ws");
const results = [];

async function joinOne(i) {
  const playerId = `load_${Date.now().toString(36)}_${i}`;
  const t0 = performance.now();
  const r = { i, playerId, mintMs: null, helloMs: null, outcome: "unknown" };

  let token;
  try {
    const res = await fetch(`${BASE}/world-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    r.mintMs = performance.now() - t0;
    if (res.status === 429) {
      r.outcome = "rate-limited-mint";
      return r;
    }
    if (!res.ok) {
      r.outcome = `mint-${res.status}`;
      return r;
    }
    ({ token } = await res.json());
  } catch (err) {
    r.outcome = `mint-threw:${String(err).slice(0, 40)}`;
    return r;
  }

  await new Promise((resolve) => {
    let settled = false;
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      r.outcome = outcome;
      resolve(); // NOTE: does NOT close the socket — see below
    };
    const ws = new WebSocket(
      `${wsBase}/ws/world?token=${encodeURIComponent(token)}&name=LOAD${i}`,
    );
    r.ws = ws;
    // "In the world" = the server sent us something, not merely that the
    // socket opened. An accepted-then-silent socket is the failure mode
    // worth catching.
    ws.onmessage = () => {
      if (r.helloMs === null) r.helloMs = performance.now() - t0;
      r.frames = (r.frames ?? 0) + 1;
      done("joined");
    };
    ws.onerror = () => done("ws-error");
    ws.onclose = (e) => {
      r.closedEarly = !settled ? false : true;
      done(e.code === 1006 ? "ws-1006" : `ws-close-${e.code}`);
    };
    setTimeout(() => done("timeout-no-frame"), 20_000);
  });

  // The socket stays OPEN deliberately. The first version closed it the
  // instant a frame arrived, so by the time the hold finished every
  // client had long since left and the server honestly reported humans=0
  // — a load test that measures nothing but its own teardown. Sustained
  // concurrency is the thing being tested.
  return r;
}

console.log(`[load] ${CLIENTS} clients → ${BASE}, ramp ${RAMP_MS}ms, hold ${HOLD_MS}ms`);
const started = [];
for (let i = 0; i < CLIENTS; i += 1) {
  started.push(joinOne(i));
  await Bun.sleep(Math.round(RAMP_MS / Math.max(1, CLIENTS - 1)));
}
results.push(...(await Promise.all(started)));

// Let the world tick with everyone attached before reporting — a join
// that succeeds and then drops a second later is not a join.
await Bun.sleep(HOLD_MS);

const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
const stillOpen = results.filter((r) => r.ws && r.ws.readyState === 1).length;
const framesTotal = results.reduce((n, r) => n + (r.frames ?? 0), 0);
for (const r of results) { try { r.ws?.close(); } catch { /* already gone */ } }

const by = (o) => results.filter((r) => r.outcome === o).length;
const joined = results.filter((r) => r.outcome === "joined");
const times = joined.map((r) => r.helloMs).sort((a, b) => a - b);
const pct = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))] : NaN);

console.log(`\n[load] outcomes`);
for (const o of [...new Set(results.map((r) => r.outcome))].sort()) {
  console.log(`  ${o.padEnd(24)} ${by(o)}`);
}
console.log(`\n[load] joined ${joined.length}/${CLIENTS}`);
if (times.length) {
  console.log(
    `[load] time-to-first-frame  p50 ${pct(0.5).toFixed(0)}ms  p95 ${pct(0.95).toFixed(0)}ms  max ${times[times.length - 1].toFixed(0)}ms`,
  );
}
const rl = by("rate-limited-mint");
if (rl > 0) {
  console.log(
    `[load] NOTE: ${rl} were rate-limited at the mint (20/min/IP). From one machine that is the LIMITER, not the server — real traffic arrives on different IPs.`,
  );
}
console.log(`[load] sockets still open after ${HOLD_MS}ms hold: ${stillOpen}/${CLIENTS}  (frames received: ${framesTotal})`);
if (health?.world) {
  console.log(`[load] server after hold: humans=${health.world.humans} bots=${health.world.bots} phase=${health.world.phase}`);
}
if (health?.sim) {
  console.log(`[load] sim: authority=${health.sim.authority} fallbackTicks=${health.sim.wasmFallbackTicks}`);
}
