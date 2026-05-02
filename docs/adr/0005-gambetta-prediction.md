# ADR-0005: Client-side prediction + server reconciliation (Gambetta / Fiedler)

## Status
Accepted

## Context
The server runs a 60 Hz authoritative `World` (from `client/src/sim/World.ts`) that responds to inputs by applying physics, collisions, and combat deterministically. Over a network, clients can't wait for server acks before showing movement — input lag becomes unplayable. We need a "Quake 3 / Glenn Fiedler" style stack: client prediction, lag compensation for shooting, and snapshot interpolation for remote entities.

## Decision
**Server is authoritative. Clients send inputs only, apply them locally, and replay on every snapshot.**

Per `game-netcode` SKILL.md, the wire protocol is:

```
client input → ws (msgpack) → MatchHost.routeMessage → World.step
                                                       ↓
client world ← interpolationBuffer ← ws (msgpack) ← Snapshot broadcast
```

### Input flow (local prediction)
- Client applies its own input **immediately** to its local `World` (`client/src/net/clientLoop.ts`), not after network ack.
- Every input gets a monotonically increasing `seq`, stored in a ring buffer keyed by `seq`.
- On every snapshot:
  1. Find `lastProcessedInputSeq[myPlayerId]`.
  2. Replay all inputs with `seq > lastProcessedInputSeq` against the snapshot's authoritative state.
  3. The result is the new predicted state. Any "snap" means prediction diverged — root cause is almost always sim non-determinism (`game-sim-determinism` skill).

### Lag compensation (server-side)
Per `server/src/matchHost.ts`:
- When processing a fire input from tick `T`, **rewind every other player's position to tick `T`** for the spawn frame, then resume.
- Hard-cap rewind at `LAG_COMP_MAX_MS = 250` (≈15 ticks). The shooter is **not** rewound.
- Maintain a per-player position ring buffer of `POSITION_HISTORY_CAPACITY = 32`.

### Snapshot interpolation (remote entities)
- **Local player is predicted, never interpolated.** Drawing the local player at `now - 100ms` feels like input lag.
- **Remote players are interpolated** ~100ms behind server time via `client/src/net/interpolationBuffer.ts`.
- If only one snapshot ahead, **extrapolate at most 1 tick** then freeze.

### Slew control (optional)
The server can send `tickAdjustMs` in snapshots. The client maintains `slewMsBudget` and injects/drain `±1 ms` per tick call (per `client/src/net/clientLoop.ts`) to slow/speed up the loop to match server's wall-clock budget.

## Consequences
- **Input-lag floor = local frame**. Prediction lets the character move instantly; remote players show a ~100 ms visual delay.
- **Prediction snaps surface determinism bugs**. Any visible "teleport" usually means `simWorld.step` ran differently on client vs server — a strong signal to check `game-sim-determinism` invariants.
- **Rollback would be a heavier rewrite** — tracking all pending inputs and rewinding on mismatch — not chosen for prototype scale. Prediction + interpolation is simpler and sufficient for 2–6 players.
- **Remote entities are smoother** because interpolation hides network jitter. A fixed visual delay buys smoothness without sacrificing responsiveness.
- **Server reconciliation is fast**. Rewinding only a subset of entities per tick (see `client/src/net/clientLoop.ts` hash-guided partial reconcile) means the replay step is narrow, not full-sim.

## Verification after change
```bash
bun run typecheck        # ts-pocock / branded IDs / exhaustive unions
bun run --filter client test   # sim tests must pass
```
Run a manual 1v1 match and confirm:
- Local player moves instantly on keypress.
- Remote players glide smoothly (not teleported) on network stalls.
- A "snap" only happens on rare prediction drift (logged once every ~5 seconds).
