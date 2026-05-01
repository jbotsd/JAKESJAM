# JAKESJAM — Netcode Architecture

This doc is the source of truth for online multiplayer. It supersedes the "Future Prediction and Reconciliation Direction" section of `technical-design.md` once we start implementation.

## TL;DR

**Architecture:** Dedicated authoritative game server, written in TypeScript, running on **Bun** (which uses **uWebSockets** under the hood for its native `Bun.serve` WebSocket implementation). Clients run client-side prediction + reconciliation against authoritative snapshots from the server. This is exactly the architecture the top of the .io genre ships on (agar.io, surviv.io, krunker.io), with one runtime swap (Bun instead of Node) for performance and DX.

- **Client:** Phaser + Vite, deployed on Vercel (static)
- **Game server:** Bun + `Bun.serve` WebSocket, deployed on Fly.io (multi-region, persistent VM)
- **Lobby / profiles / matchmaking / results:** Convex
- **Shared simulation:** A `sim/` package imported by both client (for prediction) and server (for authority)

## How The Best .io Games Actually Do It

The honest reference, drawn from public talks, source leaks, and reverse-engineered protocols of the genre leaders:

| Game | Server | Protocol | Tick | Hosting |
|---|---|---|---|---|
| agar.io | Node.js + uWebSockets | Binary WebSocket | 25 Hz | Bare metal, regional |
| diep.io | Node.js (same author) | Binary WebSocket | 30 Hz | Bare metal, regional |
| surviv.io | Node.js + uWebSockets.js | Binary WebSocket | 30 Hz | DigitalOcean / OVH |
| krunker.io | Node.js (Yendis) | Binary WebSocket | 30 Hz | Multi-region VPS |
| shellshock.io | Node.js | Binary WebSocket | 30 Hz | Multi-region VPS |
| zombsroyale.io | Node.js | Binary WebSocket | 20 Hz | Multi-region VPS |

**Common architecture across the top of the genre:**

1. **Authoritative dedicated server.** Not P2P. The server is the only source of truth for positions, hits, and damage. Clients send inputs, receive snapshots.
2. **Node.js + uWebSockets.js.** Not socket.io — too heavy. uWebSockets is a C++ lib that handles 100k+ concurrent connections per box. Built by the same engineer who created agar.io for exactly this use case.
3. **Binary protocol over WebSocket.** Custom encoders or MessagePack/FlatBuffers. JSON is too fat at 30Hz × N players.
4. **20–30 Hz server tick rate.** Not 60. Bandwidth scales linearly with tick rate; 30Hz is the sweet spot for fast shooters.
5. **Delta compression + AOI culling.** Each client only receives entities within their visible area, and only the *changed* fields since their last acknowledged snapshot.
6. **Client-side prediction + reconciliation + entity interpolation.** The Gambetta pattern, exactly. Local player is predicted, remote players are interpolated 100ms in the past, on snapshot arrival the client rewinds and replays unacked inputs.
7. **Multi-region bare-metal hosting.** Not serverless. Latency-sensitive code runs on DigitalOcean / OVH / Hetzner droplets, never on Vercel/Lambda/Cloudflare Workers. Matchmaking routes you to nearest region.
8. **Lobby/profile/leaderboard on a separate stack** (HTTP service + Postgres/Redis) that has nothing to do with the game server.

## How JAKESJAM Maps Onto This

We adopt all eight choices, with three substitutions appropriate to a 2026 jam-scale TypeScript stack:

| .io standard | JAKESJAM | Why |
|---|---|---|
| Node.js + uWebSockets.js | **Bun + `Bun.serve`** | Bun's native WebSocket *is* uWebSockets (same C++ engine), with first-class TypeScript and a faster startup/dev loop. Same throughput, better DX. |
| Custom binary encoder | **MessagePack** initially | 80% of the wire savings of FlatBuffers with 5% of the work. Swap in a custom encoder later if profiling demands it. |
| Bare-metal regional VPS | **Fly.io** | Persistent stateful VMs, multi-region (sydney/sjc/fra), generous free tier, first-class Bun support. ~$5/mo per region after the free tier. |
| Multi-region matchmaking | **Region picked by client RTT probe, recorded on the match doc** | Cheap version of routing-to-nearest until we actually need a global matchmaker. |
| Postgres/Redis for lobby | **Convex** | Already in the stack, reactive queries are perfect for lobby UI. |

The other five .io choices (authoritative server, binary protocol, 30Hz tick, delta compression, Gambetta loop, lobby/sim separation) are kept exactly.

The single critical insight: **the server-side simulation and the client-side prediction run the exact same code**. Both import a shared `sim/` package. If they ever diverge, prediction breaks. This is non-negotiable.

## The Loop

### Roles

Every match has one **server** (a Bun process owning the authoritative simulation for that match) and N **clients** (player browsers). For 1v1 N=2, scaling to N=6 for stress. A single Bun VM hosts many concurrent matches; each match has its own World instance and tick interval.

### Tick Rates

| Loop | Rate | Where |
|---|---|---|
| Sim tick | 60 Hz (16.67 ms) | Both server and client |
| Snapshot broadcast | 30 Hz (33.33 ms) | Server → all clients in match |
| Input send | 60 Hz (16.67 ms, batched if needed) | Client → server |
| Render | requestAnimationFrame | Client only |
| Convex heartbeat | 0.5 Hz (2 s) | Client only (lobby presence) |
| Server health ping | 1 Hz | Server → Fly.io health check |

Sim runs at 60 Hz on both sides because the client needs to predict at 60 Hz too. Snapshots at 30 Hz halves bandwidth versus 60 Hz with no perceptible quality loss in practice (Quake 3 ran at 20 Hz).

### Frame-by-frame, server (Bun)

```
each sim tick (60 Hz, setInterval driven):
  drain inputs received from each client (last-input-wins per tick)
  step world (player movement, projectile motion, collisions, damage, destructibles)
  increment world.tick
  collect events emitted this tick

each snapshot tick (30 Hz, every 2nd sim tick):
  for each client:
    compute delta vs that client's last-acked snapshot
    encode Snapshot{tick, lastProcessedInputSeq[clientId], deltaEntities, events} with MessagePack
    ws.send(buffer, /*binary*/ true)
```

### Frame-by-frame, client

```
each sim tick (60 Hz):
  read local input, assign monotonically increasing inputSeq
  apply input to local predicted state (sim.step)
  push input to pendingInputs[]
  send Input{seq, tick, keys, aim} to server (binary WebSocket)

on Snapshot received:
  authoritativeState = applyDelta(authoritativeState, snapshot)
  drop pendingInputs where seq <= snapshot.lastProcessedInputSeq[me]
  rewind: localState = clone(authoritativeState)
  replay: for each remaining input in pendingInputs: sim.step(localState, input)
  for each remote entity: push snapshot into interpolation buffer (rendered at now - 100ms)
  fire SimEvents through EventBus → audio, particles, screen shake
```

### Input Authority Model

- **Movement, jump, crouch, aim direction:** client predicts locally, server re-simulates using the same inputs, server's result wins on disagreement.
- **Fire weapon:** client tells server "I fired at tick T with aim θ", server spawns the projectile authoritatively at tick T (lag compensation — server rewinds to tick T to validate the firing position), client visually spawns a placeholder muzzle flash immediately. The actual projectile entity arrives in the next snapshot.
- **Projectile flight, hits, damage, destructible state, fire/napalm:** server-only authority. Client never predicts these.
- **Pickups:** server-only authority. Client sees pickup vanish on next snapshot, plays collection feedback when health/shield delta arrives.
- **Round state, score, draft trigger:** server decides; on each transition the server writes to Convex via the Convex HTTP API (so spectators and reconnects see it).

This split keeps the predicted surface small (just the local character) and avoids the worst Gambetta failure mode: predicting kills that the server then revokes.

## File Layout

The split is `sim/` (pure, shared) ↔ `net/` (client transport + Gambetta machinery) ↔ `server/` (Bun authoritative loop) ↔ `game/` (Phaser, rendering, input).

```
client/
  src/
    sim/                          # SHARED — also imported by server/
      World.ts                    # World class: step(state, inputs, dt) → newState
      types.ts                    # WorldState, EntityState, InputFrame, SimEvent
      player.ts
      projectile.ts
      weapon.ts
      destructible.ts
      fire.ts
      pickup.ts
      collision.ts                # deterministic AABB + swept AABB (replaces Phaser physics)
      rng.ts                      # seeded mulberry32
      constants.ts
      index.ts

    net/                          # CLIENT netcode glue
      transport.ts                # interface Transport { send, onMessage, close }
      wsTransport.ts              # WebSocket implementation (binary frames)
      protocol.ts                 # message types, MessagePack encode/decode, version byte
      clientLoop.ts               # predict, send inputs, reconcile on snapshot
      interpolationBuffer.ts      # per-remote-entity ring buffer (render 100ms in past)
      deltaCodec.ts               # apply server deltas to baseline state

    game/
      scenes/
        BootScene.ts
        MainMenuScene.ts
        LobbyScene.ts
        MatchScene.ts             # rendering only — reads from World state, never mutates
        DraftScene.ts
        ResultsScene.ts
      rendering/...               # Phaser graphics
      input/InputCapture.ts       # keyboard/mouse → InputFrame
      ui/...
      data/...                    # cards, weapons, characters, maps, chaos modifiers

server/                            # NEW WORKSPACE — Bun + uWebSockets game server
  src/
    index.ts                      # Bun.serve entrypoint, WebSocket upgrade, match routing
    matchHost.ts                  # one instance per active match, owns World + tick loop
    protocol.ts                   # mirror of client protocol.ts (or import from shared)
    convexClient.ts               # writes match state transitions / final results back to Convex
    config.ts                     # env: PORT, CONVEX_URL, REGION
  package.json
  tsconfig.json
  Dockerfile                      # oven/bun base image

convex/
  schema.ts                       # rooms, matches, matchResults — gameServerUrl added to matches
  rooms.ts, matches.ts            # mutations now record gameServerUrl on match start

vercel.json                       # client static deploy config
fly.toml                          # game server deploy config (multi-region, persistent VM)
```

The `sim/` package physically lives under `client/src/sim/` for now (single TS workspace import path) and is referenced from `server/src/` via a relative tsconfig path. If sim grows large or develops its own dependencies, promote it to its own workspace (`packages/sim/`).

**Hard rules** (enforced once we add ESLint config):

1. Nothing in `sim/` may import from Phaser, the DOM, `convex/react`, `Bun`, `fetch`, or `Math.random()`. It must run in both Bun and the browser unchanged.
2. `sim/World.step(state, inputs, dt)` is deterministic given `(state, inputs, dt, rngSeed)`. No wall-clock reads, no `Date.now()`, no untracked randomness.
3. `game/scenes/MatchScene` reads from `WorldState` and renders. It does not write to it. Online writes go through `net/clientLoop` (which calls `sim.step` for prediction). Offline practice writes through a local in-process loop with no transport.
4. `net/` knows about `sim/` types and `protocol/` messages. It does not know about Phaser.
5. `server/src/` knows about `sim/` and `protocol/`. It does not know about Phaser, Vite, the DOM, or any client-side code.

This is the same separation Valve uses (Source: `cl_dll` ↔ `engine` ↔ `dlls/`). Breaking it is how netcode bugs become unfixable.

## Message Protocol

All messages are MessagePack-encoded with a 1-byte version prefix. Schema lives in `client/src/net/protocol.ts` and is mirrored / imported by `server/src/protocol.ts`. Messages are sent as binary WebSocket frames.

### Client → Server

```ts
type ClientHello = {
  t: 'hello';
  playerId: string;        // matches Convex roomPlayers.playerId
  matchId: string;
  matchToken: string;      // signed token from Convex on match start (auth)
  protocolVersion: number;
};

type Input = {
  t: 'in';
  seq: number;             // monotonically increasing per client
  tick: number;            // client's predicted world tick when this input was generated
  keys: number;            // bitfield: left, right, up, down, jump, crouch, fire, ability, shield
  aimX: number;            // world-space aim point
  aimY: number;
  dt: number;              // ms since last input frame (clamped 8..50)
};

type Ack = {
  t: 'ack';
  lastSnapshotTick: number;   // client tells server "I have everything up to this tick"
};

type Ping = {
  t: 'ping';
  clientTime: number;         // for RTT measurement
};
```

### Server → Client

```ts
type ServerHello = {
  t: 'hello';
  matchId: string;
  startTick: number;
  rngSeed: number;
  mapId: string;
  yourPlayerId: string;
  allPlayers: { playerId: string; characterId: string; color: string; name: string }[];
};

type Snapshot = {
  t: 'snap';
  tick: number;
  lastProcessedInputSeq: Record<string, number>;   // per-client ack of their inputs
  baseline: number | null;                         // tick of snapshot this is delta'd against, null = full
  entities: Partial<EntityState>[];                // only changed fields
  events: SimEvent[];                              // discrete events: shot fired, hit confirmed, pickup taken, round end
};

type Pong = {
  t: 'pong';
  clientTime: number;
  serverTime: number;
};

type Disconnect = {
  t: 'bye';
  reason: 'opponent-left' | 'match-ended' | 'protocol-mismatch' | 'auth-failed' | 'server-shutdown';
};
```

**Versioning:** the version prefix lets us hard-disconnect old clients on protocol breakage rather than letting them desync silently. Bump it on any non-additive change.

## WebSocket Transport (Bun side)

Bun's `Bun.serve({ websocket: { ... } })` exposes the uWebSockets engine with a clean TS API. Reference shape:

```ts
Bun.serve({
  port: env.PORT ?? 8080,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const matchId = url.searchParams.get('matchId');
      const matchToken = url.searchParams.get('token');
      const playerId = url.searchParams.get('playerId');
      if (!matchId || !matchToken || !playerId) return new Response('bad request', { status: 400 });
      const ok = server.upgrade(req, { data: { matchId, matchToken, playerId } });
      return ok ? undefined : new Response('upgrade failed', { status: 500 });
    }
    if (url.pathname === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
  websocket: {
    perMessageDeflate: false,           // hot-loop binary; compression hurts more than it helps
    maxPayloadLength: 16 * 1024,
    open(ws) { matchRegistry.attach(ws); },
    message(ws, raw) { matchRegistry.route(ws, raw); },
    close(ws) { matchRegistry.detach(ws); },
  },
});
```

Per-match game loop runs in `setInterval(() => matchHost.tick(), 1000/60)`. Bun's timer resolution is sufficient. Snapshots are sent every 2nd tick.

**Binary frames only.** Do not enable `perMessageDeflate`. Inputs and snapshots are tiny and compress poorly per-message; deflate adds CPU and latency for negative gain.

## Convex Integration (Lobby + Matchmaking + Results)

Convex's job is everything that *isn't* the 60Hz simulation. It owns:

- Room lifecycle (create / join / ready / leave)
- Player profile (name, color, character, cards owned)
- Match document (matchId, mapId, players, scores, state transitions)
- **Game server URL** assignment when a match starts
- Match result persistence

### Schema additions

Add to `matches`:

```ts
matches: defineTable({
  // ... existing fields ...
  gameServerUrl: v.optional(v.string()),    // e.g. "wss://syd.jakesjam-srv.fly.dev/ws"
  matchToken: v.optional(v.string()),       // short-lived signed token, used in WS upgrade
  region: v.optional(v.string()),           // "syd" | "sjc" | "fra" — picked by host's RTT probe
});
```

**Drop** `matchPlayerSnapshots` and the `submitPlayerSnapshot` mutation. Per-frame state never touches Convex now.

### Match start handshake

```
1. Lobby UI: host picks region (or auto-picks lowest-RTT). Host clicks "Start Match".
2. Convex matches.startMatch():
   - inserts match doc with status=loading
   - mints matchToken (HMAC of matchId+playerIds, signed with CONVEX_GAME_SERVER_SECRET)
   - sets gameServerUrl = matchmakerLookup(region)
3. Clients see match doc via reactive query. Each client opens
   wss://<gameServerUrl>?matchId=...&token=...&playerId=...
4. Server validates token (HMAC check against shared secret), upgrades, attaches to match.
5. Once all clients connected (or timeout), server sends ServerHello + first Snapshot. Sim begins.
6. Server writes match progress events back to Convex:
   - status transitions (loading → active → draft → complete)
   - round-end deltas (scores)
   - final result on match end
   These writes happen via the Convex HTTP API (server-side), throttled to <1Hz.
```

**Why HMAC tokens:** the game server has no Convex auth context. The token proves "Convex assigned this player to this match". The shared secret lives in Fly.io secrets and Convex env vars.

### Convex writes from the server

The server writes to Convex via its HTTP API (not the React/JS client SDK):

```ts
// server/src/convexClient.ts
const url = `${env.CONVEX_URL}/api/mutation`;
await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CONVEX_GAME_SERVER_TOKEN}` },
  body: JSON.stringify({ path: 'matches:setStatus', args: { matchId, status: 'active' } }),
});
```

Throttle to <1 Hz per match. Server-of-record for round/match state is **the Bun process**; Convex is the persistence sink. If a Convex write fails, log and retry — do not block the sim.

## Hosting

### Client (Vercel)

Static build of `client/dist`. Single env var: `VITE_CONVEX_URL`. Optional: `VITE_GAME_SERVER_REGION_FALLBACK` for a default region if RTT probe fails.

`vercel.json`:
```json
{
  "buildCommand": "npm run build --workspace client",
  "outputDirectory": "client/dist",
  "framework": null
}
```

### Game server (Fly.io)

Bun on a `shared-cpu-1x` (256 MB) VM is enough for dozens of concurrent 1v1 matches. Multi-region by deploying the same app to multiple regions; clients pick by RTT.

`fly.toml` (per-region pattern):
```toml
app = "jakesjam-srv-syd"
primary_region = "syd"

[build]
  dockerfile = "../server/Dockerfile"

[env]
  PORT = "8080"
  REGION = "syd"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false      # stateful — don't auto-stop
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  path = "/health"
  interval = "10s"
  timeout = "2s"
```

`server/Dockerfile`:
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb tsconfig.json ./
COPY src ./src
COPY ../client/src/sim ./sim          # bring shared sim in at build time
RUN bun install --frozen-lockfile
EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
```

Secrets via `flyctl secrets set CONVEX_URL=... CONVEX_GAME_SERVER_TOKEN=...`.

### Region strategy

Start with **syd** only (you're in AU, so this is the lowest-latency baseline for our own playtests). Add **sjc** when we get NA testers, **fra** for EU. Cost: ~$1.94/mo per VM if always-on, free if usage stays under the Fly.io free tier.

## Determinism

Determinism in `sim/` is a strong "should", not a "must". The server's snapshots are authoritative either way, but agreement makes prediction tighter and reduces visible reconciliation snaps.

Concrete rules:

- All randomness goes through `sim/rng.ts` (mulberry32 or similar, seeded). Seed broadcast in `ServerHello`, restored from `WorldState.rngState`.
- Fixed-step physics: never multiply by a wall-clock dt. Sim takes a fixed `STEP_MS = 1000/60` and we accumulate real time into integer step counts.
- Floating-point determinism across Bun and browsers is *not* guaranteed for trig/sqrt. Accept small drift, let snapshots correct it.
- Iterate entities in sorted order (by `EntityId`), never raw `Object.values()` order.

## Two-Dev Split (Owners)

| Stream | Owner | Touchpoints |
|---|---|---|
| **Sim & gameplay** — `sim/` package extraction, deterministic collision, gameplay backlog (projectile modifiers, destructibles, fire, cards, characters) | Dev A | Defines `sim/types.ts` (the contract). See `dev-stream-sim.md`. |
| **Netcode & infra** — `server/` workspace, `client/src/net/`, Convex schema changes (matchmaker URL, drop snapshots), Vercel + Fly.io deploys, MessagePack protocol | Dev B | Imports `sim/types.ts` and `sim/World`. Cannot start in earnest until `sim/types.ts` is published; works against the contract stub in the meantime. |

**Critical path:** Dev A finalizes `sim/types.ts` first (half a day max), Dev B unblocks. After that, both run in parallel until integration in `MatchScene`.

**Shared file conflicts to expect:**
- `MatchScene.ts` will be heavily refactored as the read-only renderer in this transition. Dev A owns the refactor; Dev B integrates against the post-refactor shape.
- `package.json` (root) adds the `server` workspace + Bun scripts — coordinate one PR (Dev B).
- `convex/schema.ts` adds `gameServerUrl` to matches and removes `matchPlayerSnapshots` — coordinate so any sim-side reference to the old field gets dropped first.

## What This Replaces

This doc obsoletes:

- `technical-design.md` § "Future Prediction and Reconciliation Direction" — was directional, this is concrete.
- `technical-design.md` § "Future Java Server Trigger" — we're going dedicated server now, in TypeScript on Bun. Java was reserved as a hypothetical; that hypothesis is closed.
- The `matchPlayerSnapshots` Convex table — wrong tool for the job.
- Milestone 4's "low-frequency Convex snapshot sync" deliverable — replaced by WebSocket sync; Convex keeps lobby/match-state/results only.
- Milestone 8's two-window Convex snapshot stress test — replaced by a server load test against the Bun process.

Update those docs once this is implemented and proven in a 1v1 playtest.
