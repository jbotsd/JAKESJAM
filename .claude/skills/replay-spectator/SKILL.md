---
name: replay-spectator
description: >
  Match replay (record + playback) and live spectator infrastructure
  built on JAKESJAM's deterministic sim. Use when adding replay capture
  to MatchHost, building a "watch friend's match" feature, debugging
  client/server desync via replays, or anything that needs to
  reconstruct a match outside the live run. Triggered by "replay",
  "demo", "spectator", "POV", "rewatch".
version: 1.0.0
---

# Replay & Spectator Systems

## Why this skill exists

JAKESJAM's sim is deterministic by construction (`game-sim-determinism`),
which means replay is *almost free* — but only if the recording and
playback contracts respect what id Software figured out in 1996 and
Glenn Fiedler restated for modern netcode. Get this wrong and you
either ship a 50MB-per-match snapshot recorder or a "replay" feature
that desyncs after 30 seconds. Doom and Quake solved this with
input-only recording. JAKESJAM should solve it the same way.

## The hard line

**Record inputs + RNG seed + protocol version. Never record
WorldState snapshots as the source of truth. Playback re-runs the
sim. If the sim has changed, the replay is broken — and that's a
*feature*, not a bug.**

## What the KOL says

**id Software's Doom .LMP and Quake .DEM** — the foundational pattern.
From the Quake DEM format docs:

> "The recording of a DOOM game consists only of the player input.
> All the rest is random-number dependent but totally deterministic
> and will be recalculated during the playback."
> — Quake DEM format reference, gamers.org

Quake III moved to network-packet-stream replays (`.dm_68`), which
trade compactness for cross-version playability. Both approaches are
valid; the choice depends on whether you ever need to play a replay
on a *different version of the sim*.

**Glenn Fiedler, "Snapshot Compression" / "Snapshot Interpolation"**
(Gaffer on Games). Fiedler's networking series argues:

> "Deterministic lockstep is great when you can get it. When you
> can't (floating-point divergence across compilers/architectures),
> you fall back to snapshot interpolation — but you pay for it in
> bandwidth and rewind cost."
> — Fiedler, "Snapshot Interpolation"

JAKESJAM **can** get deterministic lockstep — sim is pure TS, no
floating-point branchers, runs in V8 on both ends. So we use
**input-replay**, not **snapshot-replay**, for the canonical record.

## How JAKESJAM applies it

Concrete files:

- `server/src/matchHost.ts` — owns the live match. Add a
  `RecordingBuffer` that appends every accepted `InputFrame`
  per player + every chaos roll seed.
- `server/src/protocol.ts` — define `ReplayHeader`, `ReplayChunk`.
- `client/src/sim/World.ts` — `World.create({ seed, mapId })` is
  already pure. Replay playback constructs a fresh `World` and
  feeds it the recorded inputs at the recorded ticks.
- `client/src/sim/rng.ts` — RNG state is part of `WorldState`.
  Recording the initial seed is sufficient.
- `convex/replays.ts` (NEW) — store the replay blob keyed by
  `matchId`. Convex storage, NOT live tables. ~50KB for a typical
  3-round match.
- `client/src/game/scenes/ReplayScene.ts` (NEW) — playback scene
  that wraps `MatchScene` but disables local input and feeds the
  recorded input frames instead.

`PROTOCOL_VERSION` (already in `protocol.ts`) doubles as the replay
compatibility version. A replay's header carries it; if mismatched,
playback refuses with a clear error rather than producing garbage.

## Recipes

### 1. The replay file format

```ts
// server/src/protocol.ts (additions)
export type ReplayHeader = {
  version: 1;
  protocolVersion: number;       // === PROTOCOL_VERSION at record time
  matchId: string;
  mapId: MapId;
  startSeed: number;             // seed for state.rngState
  players: ReadonlyArray<{
    id: PlayerId;
    name: string;
    archetype: CharacterArchetype;
  }>;
  startedAtMs: number;           // wall-clock for UI only
  totalTicks: Tick;
};

export type ReplayChunk = {
  // Inputs grouped by tick range, msgpack-encoded
  startTick: Tick;
  endTick: Tick;
  inputsByPlayer: Record<PlayerId, InputFrame[]>;
  // Out-of-band events the sim consumes:
  chaosRolls: Array<{ atTick: Tick; modifierId: ChaosModifierId }>;
};

export type ReplayFile = {
  header: ReplayHeader;
  chunks: ReplayChunk[];
};
```

Encode with the existing msgpack encoder used in `net/protocol.ts`.
A 5-minute match at 60Hz with 2 players ≈ 36k input frames × ~12B
each ≈ 432KB raw, ~80KB after msgpack + per-message-deflate over
the wire. After Convex storage we keep it as the raw blob.

### 2. Recording inside the match host

```ts
// server/src/matchHost.ts
class MatchHost {
  private recorder = new RecordingBuffer();

  onClientInput(playerId: PlayerId, frame: InputFrame) {
    // Existing: validate, queue for next tick, etc.
    this.queueInput(playerId, frame);
    // New: record
    this.recorder.append(playerId, frame);
  }

  onChaosRoll(modifierId: ChaosModifierId) {
    this.recorder.appendChaos(this.world.tick, modifierId);
  }

  onMatchEnd() {
    const blob = this.recorder.serialize(this.matchHeader());
    void convexClient.mutation(api.replays.save, { matchId, blob });
  }
}
```

Recording is **fire-and-forget**. If Convex is down, we drop the
replay — the live match must not block on storage. Telemetry-grade,
not safety-critical.

### 3. Playback as a fresh sim run

```ts
// client/src/game/scenes/ReplayScene.ts
class ReplayScene extends Phaser.Scene {
  create({ replay }: { replay: ReplayFile }) {
    if (replay.header.protocolVersion !== PROTOCOL_VERSION) {
      this.scene.start('ReplayIncompatibleScene', { replay });
      return;
    }

    this.world = World.create({
      seed: replay.header.startSeed,
      mapId: replay.header.mapId,
      players: replay.header.players,
    });
    this.inputCursor = new ReplayInputCursor(replay.chunks);
    this.chaosCursor = new ReplayChaosCursor(replay.chunks);
  }

  update(_time: number, deltaMs: number) {
    const inputs = this.inputCursor.frameAt(this.world.tick);
    const chaos = this.chaosCursor.eventAt(this.world.tick);
    if (chaos) this.world.queueChaos(chaos.modifierId);
    this.world = World.step(this.world, inputs, FIXED_STEP_MS).state;
    this.renderer.draw(this.world);
  }
}
```

The replay never touches `client/src/net/`. No prediction, no
reconciliation, no transport. Pure sim + pure render. This is
exactly Doom's playback model.

### 4. Spectator = replay with delay

Live spectator is the same code path with a sliding 2-second buffer:

```ts
// server/src/matchHost.ts — outbound spectator stream
publishSpectatorChunk() {
  const chunk = this.recorder.takeChunk(this.world.tick - DELAY_TICKS);
  this.server.publish(`spec:${this.matchId}`, encode(chunk));
}
```

Spectator client subscribes to the topic, accumulates chunks, runs
the same `ReplayScene` logic with a 2s delay. No new code path.

### 5. Replay scrubbing — the Quake `seekto` problem

You cannot scrub inside an input-replay; you must re-simulate from
the start. Solution: capture **keyframe snapshots** every 10s into
the replay file as *non-canonical* hints.

```ts
type ReplayKeyframe = {
  atTick: Tick;
  worldState: WorldState;        // full snapshot
};

type ReplayFile = {
  header: ReplayHeader;
  chunks: ReplayChunk[];
  keyframes: ReplayKeyframe[];   // optional, for scrubbing only
};
```

When the user scrubs to T, find the latest keyframe ≤ T, hydrate
the World from it, fast-forward inputs from keyframe.atTick to T.
Worst-case fast-forward: 600 ticks at 10s keyframe spacing — runs
in ~50ms in V8, instant for the user.

If a keyframe is corrupted or missing, fall back to scrub-from-zero.

### 6. Replays as the desync debugger

The same recording is the killer feature for debugging
client/server divergence. When `game-sim-determinism` flags a
divergence, the client uploads its local input log. The server
replays both: server's log of what it accepted vs client's log of
what it sent. Diff the InputFrames.

```ts
// server/src/__tests__/replay-replay.test.ts
test('server replay matches its own live result', () => {
  const live = runMatchLive(scriptedInputs);
  const recorded = recordMatch(scriptedInputs);
  const replayed = playReplay(recorded);
  expect(replayed.finalState).toEqual(live.finalState);
});
```

Add this to the existing `sim-tests` regimen.

## Anti-patterns

- **Recording WorldState snapshots as canonical.** Bandwidth
  explodes, file size explodes, and you've coupled the replay
  format to the sim's internal representation forever.
- **Letting Math.random() into the sim.** The replay desyncs the
  moment a chaos roll, draft offer, or projectile spread uses
  non-seeded RNG. See `game-sim-determinism`.
- **Storing replays in Convex live tables.** They're cold blobs.
  Use Convex storage (`ctx.storage.store`), not a doc table.
- **Replay playback that imports `client/src/net/`.** Net code
  doesn't exist in replay land. There's no server, no prediction.
  Wire up `ReplayScene` directly to the sim.
- **Trying to play a replay across protocol versions.** Reject
  with a clear error. Promising "best-effort cross-version
  playback" is a forever bug source.
- **Blocking match end on Convex replay save.** Players want to
  see "GG" and a results screen, not a spinner. Save async.
- **Forgetting chaos rolls in the recording.** Chaos modifier
  selection is non-input-derived state — it must be in the
  replay file or playback will roll a different modifier.

## Pre-flight checklist

- [ ] `ReplayHeader.protocolVersion` checked on playback; refuses
      cross-version.
- [ ] Recording is fire-and-forget — never blocks the match host.
- [ ] Recording captures: player IDs, names, archetypes, map,
      seed, all input frames per player, all chaos rolls.
- [ ] Playback runs entirely from `client/src/sim/` + render — no
      net imports.
- [ ] Spectator stream uses the same chunk format with a fixed
      delay.
- [ ] Keyframes (every 10s) included as optional scrubbing aids.
- [ ] At least one regression test runs a recorded match through
      `playReplay` and asserts equal final state.
- [ ] Convex replay storage uses the storage API, not a live
      table.
- [ ] No `Math.random()` in the sim. RNG goes through
      `state.rngState` and is reproducible from `startSeed`.

## Source

- Quake .DEM format reference (gamers.org):
  https://www.gamers.org/dEngine/quake/Qdem/dem-1.0.2-3.html
- Quake III demo file specification:
  http://www.elho.net/games/q3/q3dspecs.htm
- Glenn Fiedler, "Snapshot Interpolation":
  https://gafferongames.com/post/snapshot_interpolation/
- Glenn Fiedler, "Snapshot Compression":
  https://gafferongames.com/post/snapshot_compression/
- Glenn Fiedler, "State Synchronization":
  https://gafferongames.com/post/state_synchronization/
