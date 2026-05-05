---
name: deterministic-netcode-architecture
description: >
  Substrate-agnostic architecture for server-authoritative multiplayer
  games with client-side prediction, snapshot-delta wire format, and
  per-entity reconciliation. Codifies the five-layer model and the
  determinism contract that any sim core (Zig→WASM, Rust→WASM,
  fixed-point TS) must satisfy. Use when designing or refactoring
  the netcode of any real-time multiplayer game. PROJECT-AGNOSTIC.
version: 1.0.0
---

# Deterministic netcode architecture

## Why this skill exists

Every multiplayer game eventually faces the same four problems:

1. Players need their own input to feel *immediate* (no server
   round-trip lag).
2. Players need to see *each other accurately* (no rubber-banding).
3. Servers need to be authoritative (no client-side cheats).
4. The server's compute and the client's compute need to *agree*
   (no desync).

The Gambetta + Fiedler architecture solves the first three. The
fourth is solved by the **determinism contract**, which is what
people get wrong. This skill codifies the architecture and the
contract so a project can adopt them as a unit.

## The hard line

**Five layers, top to bottom: render, predict+reconcile, snapshot
delta codec, shared sim, transport. The sim is byte-deterministic
across hosts. The hash-based per-entity reconcile only works
*because* the sim is deterministic. Don't compromise on either —
they collapse together.**

## What the KOLs say

**Glenn Fiedler, "Snapshot Interpolation"** ([Gaffer on Games](https://gafferongames.com/post/snapshot_interpolation/)):

> "Snapshot interpolation is the most general solution to networked
> physics. The client renders a fixed amount of time in the past and
> interpolates between snapshots."

**Gabriel Gambetta, "Client-Side Prediction and Server Reconciliation"** ([gabrielgambetta.com](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)):

> "When the client receives an update, it discards all the
> processed inputs and re-applies the unprocessed ones to the new
> authoritative state."

**Glenn Fiedler, "Deterministic Lockstep"** ([Gaffer on Games](https://gafferongames.com/post/deterministic_lockstep/)):

> "If your simulation is not deterministic, lockstep cannot work.
> Even floating-point ops are not deterministic across CPU
> architectures, compilers, and optimization levels — let alone
> across host runtimes."

The lockstep model isn't what most games ship (snapshot interpolation
+ prediction is). But the determinism rule from lockstep applies to
ANY architecture that wants client + server agreement.

## The five layers

```
┌──────────────────────────────────────────────────────────┐
│ RENDER                                                    │
│   Scene graph, sprites, particles, HUD, audio.            │
│   Reads from the predicted state. Owns visual smoothing.  │
├──────────────────────────────────────────────────────────┤
│ PREDICT + RECONCILE                                       │
│   Local input → local sim step (predict).                 │
│   Server snapshot → rewind + replay unacked inputs.       │
│   Per-entity hash compare; only diverged entities rebuild.│
├──────────────────────────────────────────────────────────┤
│ SNAPSHOT DELTA CODEC                                      │
│   Encode/decode WorldState diffs. Bitfield-per-field.     │
│   Baseline ring (~10 ticks). Full snap on baseline miss. │
├──────────────────────────────────────────────────────────┤
│ SHARED SIM (the determinism boundary)                     │
│   World.step(state, inputs, dt) → new state + events.     │
│   Pure, deterministic, single-threaded, no I/O.           │
├──────────────────────────────────────────────────────────┤
│ TRANSPORT                                                 │
│   WebSocket / WebRTC / UDP. Binary frames (msgpack).      │
│   1-byte protocol version prefix, version-checked.        │
└──────────────────────────────────────────────────────────┘
```

The sim layer is the substrate decision (Zig→WASM, Rust→WASM,
fixed-point TS, native float TS, etc). Everything else is
substrate-neutral.

## The determinism contract

The sim layer MUST satisfy:

1. **Pure**: no `Math.random`, no `Date.now()`, no `performance.now()`,
   no DOM/file/network I/O.
2. **Seeded RNG only**: a single RNG cursor lives on `WorldState`,
   threaded through every system. Seed broadcast in the connect
   handshake.
3. **Fixed step**: time is `tick * STEP_MS`, never wall clock.
   `World.step` takes a `dt` parameter for compatibility but should
   treat it as the constant `STEP_MS`. Variable dt = drift.
4. **Stable iteration order**: `for (entry in record)` is OK in V8
   when keys are inserted in order, but explicit `sort` whenever
   ordering affects sim outcome (e.g. resolving multiple hits in a
   single tick).
5. **No async**: `World.step` is synchronous. No `await`, no
   microtasks. Deterministic event ordering depends on it.
6. **No floats across host runtimes** unless the substrate
   guarantees IEEE 754 reproducibility. Native TS `number` does
   NOT (V8 vs JSC differ on `Math.sin` etc). WASM does (per spec).
   Fixed-point integers do (always).

Substrates that satisfy the rules:

| Substrate | Property |
|---|---|
| WASM (Zig/Rust/AssemblyScript) | IEEE 754 bit-exact across all wasm hosts per spec |
| Fixed-point integers (Q16.16, Q24.8, etc) in any language | Integer math is bit-exact |
| Same-process / same-runtime sim only (single-player) | Determinism trivially holds |

Substrates that DO NOT:

| Substrate | Why |
|---|---|
| Native TypeScript `number` | V8 vs JSC `Math.sin`/`cos`/`atan2`/`sqrt` use different libm; drift is observable |
| Native C++ `float` across compilers | Per [Fiedler](https://gafferongames.com/post/floating_point_determinism/), arch + compiler + flags vary |

## Wire protocol shape

Six message types, all msgpack-encoded with a 1-byte version prefix:

| Direction | Type | Purpose |
|---|---|---|
| C → S | `hello` | matchId + playerId + protocolVersion |
| C → S | `in` | seq + tick + keys (bitfield) + aimX + aimY |
| C → S | `ack` | lastSnapshotTick (lets server free baseline ring) |
| C → S | `card-pick` | drafting commit |
| S → C | `hello` | matchId + startTick + rngSeed + mapId + allPlayers |
| S → C | `snap` | tick + lastProcessedInputSeq + (full state OR delta against baseline) + events |
| S → C | `bye` | terminal close with reason |
| C↔S | `ping` / `pong` | RTT measurement |

**Snapshot deltas** are the bandwidth tax. Per-entity, per-field
bitfield: encode only changed fields. Baseline ring of ~10 ticks
on the server; client acks the latest snap tick it has so the
server knows which baseline is safe to use. If the client's ack is
older than the ring (e.g. after long pause), server falls back to
a full snapshot.

**Protocol version byte** at every frame's `[0]` index. Bump on
shape change; reject mismatched versions in `decodeMessage`. Both
sides import from a single canonical `protocol.ts` (or whatever
file format your substrate uses) — drift between client and
server protocol files is silent breakage at runtime.

## Prediction loop

```
Per render frame:
  1. Capture input → InputFrame { seq, tick, keys, aimX, aimY }.
  2. Push to pending queue.
  3. Apply input to predicted state via World.step.
  4. Render predicted state.

Per server snapshot (~60 Hz):
  5. Look up lastProcessedInputSeq[localPlayerId].
  6. Drop pending inputs ≤ that seq.
  7. Per-entity hash compare predicted vs authoritative:
     - Hashes match → keep predicted entity (no rebuild).
     - Hashes differ → replace with authoritative.
  8. Replay remaining pending inputs against the patched state.
  9. Capture smoothing offset (oldRendered - newPredicted) for
     local player. Decay to zero over ~100ms.
```

The local player ALWAYS gets the authoritative state as its
starting point, because smoothing depends on the residual delta.
Remote players get interpolated from the snapshot timestamps;
they never run prediction client-side.

## Lag compensation (server-side)

When the server processes a `fire` input from tick T, it rewinds
every other player's position to tick T (using a per-player
position ring of ~32 entries), runs the hit detection, then
restores positions. The shooter is *not* rewound — they fire from
where they are now (matching their predicted client view).

Cap rewind at `LAG_COMP_MAX_MS = 250` (~15 ticks at 60 Hz).
Anything beyond is clamped, not extended — extreme rewinds are
either an attack or a network anomaly.

## Anti-patterns

- ❌ **Sending player position client → server.** Inputs only.
  Server is authoritative on position by construction.
- ❌ **Treating `Math.random` in the sim as "good enough".** It
  causes server/client divergence within a few ticks.
- ❌ **Reusing a `Uint8Array` view of WASM memory across calls.**
  See `wasm-ts-bridge`. Memory grows; views detach.
- ❌ **Per-message-deflate on the gameplay socket.** msgpack
  frames are small + frequent; deflate adds CPU + latency.
- ❌ **Smoothing the local player past 100 ms.** Rendering
  significantly behind input feels like input lag.
- ❌ **Smoothing the local player at zero ms (snap).** Visible
  pop on every reconcile.
- ❌ **One server tick per render frame.** Sim must be
  fixed-step independent of render.
- ❌ **Trusting client-reported tick or aim past sanity bounds.**
  Server clamps `dt`, validates `tick` is within a recent window,
  ignores wildly old inputs.
- ❌ **Two protocol files** (one client, one server). Drift is
  silent breakage.

## Pre-flight checklist

- [ ] Sim layer satisfies all 6 rules in §"The determinism contract".
- [ ] Single canonical `protocol.ts` (or equivalent) imported by
      both sides via path alias.
- [ ] Wire frames have a 1-byte protocol version prefix; decoder
      rejects mismatches.
- [ ] Snapshot delta uses bitfield-per-field encoding with a
      baseline ring on the server.
- [ ] Client maintains a pending-input ring and replays unacked
      inputs on every snapshot.
- [ ] Per-entity reconcile hashes predicted vs authoritative;
      only diverged entities rebuild.
- [ ] Local player render uses smoothing offset over ~100 ms;
      snap threshold for >30 px deltas (teleport, respawn).
- [ ] Remote players interpolated ~100 ms behind, NEVER predicted.
- [ ] Server-side lag-comp clamped at 250 ms.
- [ ] Single deterministic RNG cursor on WorldState; seed
      broadcast at connect.

## Sister skills

- `zig-wasm-build` — toolchain for the sim substrate.
- `wasm-ts-bridge` — host-boundary patterns.
- `wasm-game-sim-zig` — design rules inside the sim itself.
- `game-sim-determinism` — substrate-neutral sim purity rules
  (overlaps with §"The determinism contract" — read both).
- `game-netcode` — project-tuned variant for JAKESJAM specifically;
  this skill is the project-agnostic generalisation.
- `prediction-error-smoothing` — render-layer recipe for hiding the
  reconcile snap visually (Source `cl_smoothtime`-equivalent).
- `fixed-step-sim-integration` — accumulator pattern, tick-tagged
  inputs, float-vs-fixed-point decision; root cause for why air
  physics drifts before ground does.

## Source

- [Glenn Fiedler — Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- [Glenn Fiedler — Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/)
- [Glenn Fiedler — Floating-Point Determinism](https://gafferongames.com/post/floating_point_determinism/)
- [Gabriel Gambetta — Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- [SnapNet — Netcode Architectures Part 3: Snapshot Interpolation](https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/)
- [Bugnet — How to Debug Multiplayer Desync Issues](https://bugnet.io/blog/how-to-debug-multiplayer-desync-issues-in-games)
- [Game Networking Resources (curated by Fiedler)](https://github.com/gafferongames/GameNetworkingResources)
