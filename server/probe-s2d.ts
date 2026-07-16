// Live probe — venue-sprint2-goal S2.D evidence (run: bun probe-s2d.ts).
// Connects a NEW player to the live /ws/world mid-cycle and watches:
//   1. hello + snapshots flow immediately (spectator-pending)
//   2. own entity ABSENT from snapshots while phase != countdown
//   3. entity appears, and the phase AT THAT MOMENT is "countdown"
import { decodeMessage, encodeMessage } from "@net/protocol.ts";

const BASE = "http://localhost:8088";

async function worldWsUrl(playerId: string, name: string): Promise<string> {
  const tokenRes = await fetch(`${BASE}/world-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  const { token, wsPath } = (await tokenRes.json()) as { token: string; wsPath: string };
  const u = new URL(wsPath, "ws://localhost:8088");
  u.searchParams.set("token", token);
  u.searchParams.set("name", name);
  return u.toString();
}

// Liveness refreshes ONLY on input frames (applyInput) — a real client
// pumps inputs continuously even while entity-less, so the probe must too.
function keepAlive(ws: WebSocket): () => void {
  let seq = 1;
  const pinger = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        encodeMessage({ t: "in", seq: seq++, tick: 0, keys: 0, aimX: 0, aimY: 0, dt: 16.67 } as never),
      );
    }
  }, 2000);
  return () => clearInterval(pinger);
}

// A keeper socket boots the (possibly lazily-rebooted) world and holds it
// alive; we then wait for the fight to start before running the gate probe.
const keeper = new WebSocket(await worldWsUrl(`probe_keeper_${Math.random().toString(36).slice(2, 8)}`, "KEEPER"));
keeper.binaryType = "arraybuffer";
const stopKeeper = keepAlive(keeper);
let phaseNow = "";
for (let i = 0; i < 60; i += 1) {
  const s = (await (await fetch(`${BASE}/world/summary`)).json()) as { phase: string } | null;
  phaseNow = s?.phase ?? "null";
  if (phaseNow === "fighting") break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`arena phase at gate-probe connect: ${phaseNow}`);
if (phaseNow !== "fighting") throw new Error("world never reached fighting for the probe");

const playerId = `probe_gate_${Math.random().toString(36).slice(2, 8)}`;
const url = new URL(await worldWsUrl(playerId, "GATEPROBE"));

let helloAt = -1;
let snapCount = 0;
let sawAbsentDuringFight = false;
let insertedAtPhase: string | null = null;
const startedAt = Date.now();

await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(url.toString());
  ws.binaryType = "arraybuffer";
  // Stay live: the host sweeps silent sockets after LIVENESS_TIMEOUT_MS
  // (20s) — a real client pumps inputs; a probe must at least ping.
  const stopPing = keepAlive(ws);
  const timeout = setTimeout(() => {
    stopPing();
    ws.close();
    reject(new Error("gave up after 150s without insertion"));
  }, 150_000);
  ws.onmessage = (ev) => {
    const decoded = decodeMessage(new Uint8Array(ev.data as ArrayBuffer));
    if (!decoded) return;
    const msg = decoded.message as {
      t: string;
      state?: { players?: Record<string, unknown>; round?: { phase: string } };
    };
    if (msg.t === "hello" && helloAt < 0) helloAt = Date.now() - startedAt;
    if (msg.t === "snap" && msg.state) {
      snapCount += 1;
      const phase = msg.state.round?.phase ?? "?";
      const present = msg.state.players ? playerId in msg.state.players : false;
      if (!present && phase !== "countdown") sawAbsentDuringFight = true;
      if (present && insertedAtPhase === null) {
        insertedAtPhase = phase;
        clearTimeout(timeout);
        stopPing();
        ws.close();
        resolve();
      }
    }
  };
  ws.onerror = () => reject(new Error("ws error"));
});

stopKeeper();
keeper.close();
console.log(`1. hello at +${helloAt}ms; snapshots flowed: ${snapCount}`);
console.log(`2. entity absent during non-countdown phases: ${sawAbsentDuringFight}`);
console.log(`3. entity appeared at phase: ${insertedAtPhase} after ${Math.round((Date.now() - startedAt) / 1000)}s`);
if (helloAt < 0 || snapCount === 0) throw new Error("FAIL: no hello/snapshots (not spectator-attached)");
if (!sawAbsentDuringFight) throw new Error("FAIL: mid-fight joiner had an entity before the bell");
if (insertedAtPhase !== "countdown") throw new Error(`FAIL: inserted at ${insertedAtPhase}, not countdown`);
console.log("S2.D LIVE PROBE: ALL PASS");
