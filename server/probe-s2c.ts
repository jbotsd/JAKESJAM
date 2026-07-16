// Live probe — venue-sprint2-goal S2.C evidence (run: bun probe-s2c.ts).
// Asserts against the RUNNING :8088 server:
//   1. nameless /ws/lobby connect → roster name "RECRUIT" (machine name unreachable)
//   2. lobby snapshot state carries 3 practice dummies (destructibles)
//   3. named connect → roster name is the chosen callsign
import { decodeMessage } from "@net/protocol.ts";

const BASE = "http://localhost:8088";

async function lobbyWsUrl(playerId: string, name?: string): Promise<string> {
  const res = await fetch(`${BASE}/venue-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId }),
  });
  const { token, lobbyWsPath } = (await res.json()) as { token: string; lobbyWsPath: string };
  const url = new URL(lobbyWsPath, "ws://localhost:8088");
  url.searchParams.set("token", token);
  if (name) url.searchParams.set("name", name);
  return url.toString();
}

type Frame = { t: string } & Record<string, unknown>;

function collect(wsUrl: string, ms: number): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const frames: Frame[] = [];
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => {
      const decoded = decodeMessage(new Uint8Array(ev.data as ArrayBuffer));
      if (decoded) frames.push(decoded.message as Frame);
    };
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(() => {
      ws.close();
      resolve(frames);
    }, ms);
  });
}

// 1+2: nameless connect
const anonId = `probe_anon_${Math.random().toString(36).slice(2, 8)}`;
const anonFrames = await collect(await lobbyWsUrl(anonId), 2500);
const hello = anonFrames.find((f) => f.t === "hello") as
  | { allPlayers: Array<{ playerId: string; name: string }> }
  | undefined;
if (!hello) throw new Error(`no hello frame (got: ${anonFrames.map((f) => f.t).join(",")})`);
const me = hello.allPlayers.find((p) => p.playerId === anonId);
console.log("frame types:", [...new Set(anonFrames.map((f) => f.t))].join(", "));
console.log(`1. nameless roster name: ${JSON.stringify(me?.name)} (want "RECRUIT")`);
if (me?.name !== "RECRUIT") throw new Error("FAIL: machine/blank name leaked");

// Snapshots are interest-grid filtered (a stationary client only sees
// nearby entities) — the FULL count of 3 is pinned by venueHost.test.ts
// against lobby state; here we prove dummies flow end-to-end into what a
// real client decodes.
const dummyIds = new Set<string>();
let dummyHealth = -1;
for (const f of anonFrames) {
  const destructibles = (f as { state?: { destructibles?: Record<string, { health: number }> } })
    .state?.destructibles;
  for (const [id, d] of Object.entries(destructibles ?? {})) {
    dummyIds.add(id);
    dummyHealth = d.health;
  }
}
console.log(`2. dummies visible in client snapshots: ${dummyIds.size} (interest-filtered; want ≥1), health=${dummyHealth}`);
if (dummyIds.size < 1) throw new Error("FAIL: no practice dummies reached the client");

const status = anonFrames.find((f) => f.t === "venue-status") as
  | { arenaPhase: string; nextBellMs: number }
  | undefined;
console.log(`3. venue-status pushed: phase=${status?.arenaPhase} nextBellMs=${status?.nextBellMs}`);
if (!status) throw new Error("FAIL: no venue-status frame");

// 3: named connect
const namedId = `probe_named_${Math.random().toString(36).slice(2, 8)}`;
const namedFrames = await collect(await lobbyWsUrl(namedId, "VERAPROBE"), 2000);
const hello2 = namedFrames.find((f) => f.t === "hello") as
  | { allPlayers: Array<{ playerId: string; name: string }> }
  | undefined;
const me2 = hello2?.allPlayers.find((p) => p.playerId === namedId);
console.log(`4. named roster name: ${JSON.stringify(me2?.name)} (want "VERAPROBE")`);
if (me2?.name !== "VERAPROBE") throw new Error("FAIL: chosen name did not ride /ws/lobby");

console.log("S2.C LIVE PROBE: ALL PASS");
