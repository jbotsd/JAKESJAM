---
name: game-netcode
description: >
  Authoritative netcode for JAKESJAM — Bun WebSocket server + msgpack +
  client prediction + snapshot interpolation + lag-compensated hit detection.
  Use when editing client/src/net/ or server/src/ (matchHost, protocol,
  matchRegistry), or anywhere you see: Snapshot, Tick, InputSeq, ServerHello,
  ClientHello, msgpack encode/decode, "lastProcessedInputSeq", "baseline",
  PROTOCOL_VERSION, lag comp / rewind, interpolation buffer, reconciliation,
  ws.send / ws.publish, perMessageDeflate. Skip for sim rules (use
  game-sim-determinism) and Convex matchmaker code (use convex skills).
---

# JAKESJAM Netcode

> **READ FIRST:** `deterministic-netcode-architecture` (companion skill,
> project-agnostic generalisation). This skill is JAKESJAM-specific
> tuning of those rules. The substrate decision (Zig→WASM) is recorded
> in ADR-0006 — `docs/adr/0006-zig-wasm-sim-substrate.md`.

The architecture is **server-authoritative with client-side prediction and snapshot interpolation** — the canonical Glenn Fiedler / Quake 3 model. Convex is **not** in the hot path (per project memory, it's lobby/match metadata only). The hot path is:

```
client input → ws (msgpack) → MatchHost.routeMessage → World.step
                                                       ↓
client world ← interpolationBuffer ← ws (msgpack) ← Snapshot broadcast
```

## The three pillars (don't break these)

1. **Server is authoritative.** It runs the only true `World`. Client predicts forward from the last acked snapshot using the same `@sim/` code, but server state always wins on reconciliation.
2. **Inputs go up, snapshots come down.** Client never tells the server "I'm at x,y" — it sends `{seq, tick, keys, aimX, aimY, dt}`. Server replies with `Snapshot{ tick, lastProcessedInputSeq, state, events }`.
3. **Fixed tick.** `STEP_MS` (≈16.67ms for 60Hz) is the same constant on both sides. Snapshots ship every `SNAPSHOT_INTERVAL_TICKS` (typically 2–3 ticks → 20–30Hz on the wire).

## Wire protocol

- msgpack-encoded with a **1-byte version prefix** (`PROTOCOL_VERSION`). Bump the version when message shapes change; both sides must reject mismatched versions in the hello handshake.
- `client/src/net/protocol.ts` and `server/src/protocol.ts` MUST stay byte-identical. If you change one, change the other in the same commit.
- Inputs are a **bitmask** (`keys: number`) — packing 8 buttons into a byte beats `{up, down, left, right, ...}` objects on both bandwidth and GC.
- Snapshots currently ship full `WorldState`. The codec is structured as a drop-in for delta encoding once the sim stabilises — keep the `baseline: Tick | null` field; senders set `null` for keyframes, receivers reject deltas whose baseline they no longer have.

## Client prediction & reconciliation

- Every input the client sends gets a monotonically increasing `seq`. Client also applies the input **immediately** to its local `World` and stores the input in a ring buffer keyed by `seq`.
- On every snapshot:
  1. Find `lastProcessedInputSeq[myPlayerId]`.
  2. Replay all inputs with `seq > lastProcessedInputSeq` against the snapshot's authoritative state.
  3. The result is the new predicted state. Any visible "snap" means prediction diverged — log it but don't paper over it; root-cause is almost always sim non-determinism (see `game-sim-determinism`).
- Discard inputs older than `lastProcessedInputSeq` from the buffer. The buffer's max size is your worst-case RTT in ticks; ~60 entries (1s @ 60Hz) is plenty.

## Snapshot interpolation (remote entities)

- **Local player is predicted, never interpolated.** Drawing the local player at `now - 100ms` feels like input lag.
- **Remote players are interpolated** ~100ms behind server time — render them between two known snapshots (`client/src/net/interpolationBuffer.ts`). This is the trade Fiedler describes: a fixed visual delay buys you smoothness despite jitter.
- If you only have one snapshot ahead, **extrapolate at most 1 tick** then freeze. Long extrapolation looks like teleporting.

## Lag compensation (hit detection)

- The server already does this in `server/src/matchHost.ts`: when processing a fire input from tick `T`, **rewind every other player's position to tick T** for the spawn frame, then resume.
- Hard-cap rewind at `LAG_COMP_MAX_MS = 250` (≈15 ticks). Anything more is suspect — clamp, don't trust.
- The shooter is **not** rewound. They fire from where they are now (matches their predicted client view).
- Maintain a per-player position ring buffer of `POSITION_HISTORY_CAPACITY = 32` (≈ cap + headroom for interpolation between adjacent samples).

## Bun WebSocket server specifics

- Use Bun's native `Bun.serve({ websocket: { ... } })` — not the `ws` npm package. Bun's binding is ~6× faster on raw throughput.
- **Disable `perMessageDeflate`** for the gameplay socket. msgpack frames are small and frequent; per-message deflate adds CPU and latency for negligible bandwidth savings.
- Topics for fan-out: `ws.subscribe(matchId)` on join, then `server.publish(matchId, encoded)` for the snapshot broadcast. One serialise, N sends.
- Watch `ws.send`'s return value: `-1` means backpressure — don't queue snapshots, drop the oldest pending and send the newest. Old snapshots are useless.
- One `MatchHost` per match per process is fine for prototype scale. Multiple processes need a Convex/Redis matchmaker hand-off (matchmaker writes which Fly machine owns the match; client reconnects there).

## Anti-patterns (don't do these)

- ❌ Sending player position from client to server. Inputs only.
- ❌ Running the sim from `requestAnimationFrame` on the client. Use a fixed-step accumulator (see `game-loop-perf`); rAF is for rendering.
- ❌ `JSON.stringify` on the wire. msgpack only. JSON allocates strings on every frame.
- ❌ `perMessageDeflate: true` for binary frames. Test with it off first.
- ❌ Treating Convex as a snapshot bus. Convex is **lobby/match metadata only** (see `AGENTS.md` "Multiplayer Boundary"). The 60Hz path is direct WS.
- ❌ Trusting client-reported tick or aim past sanity bounds. Server clamps `dt`, validates `tick` is in a recent window, ignores wildly old inputs.
- ❌ Letting `lastProcessedInputSeq` go backwards. It's monotonic per player; treat any regression as a bug or attack.

## Debug toggles to keep around

- A `?fakelag=120` URL param that delays outbound inputs by N ms — invaluable for catching prediction bugs.
- A `?dropPct=5` that drops 5% of outbound packets randomly.
- A server-side `--snapshot-fullstate` flag to disable delta encoding when chasing desync bugs.

## References (KOLs / sources)

- [Glenn Fiedler — Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- [Glenn Fiedler — Deterministic Lockstep (why we don't use it)](https://gafferongames.com/post/deterministic_lockstep/)
- [Glenn Fiedler — Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
- [Game Networking Resources (curated by Fiedler)](https://github.com/gafferongames/GameNetworkingResources)
- [Bun WebSockets — official docs](https://bun.sh/docs/api/websockets)
- [SnapNet — Snapshot Interpolation walkthrough](https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/)
