# Deferred refactor follow-ups

Forward-looking plan for the four work items deferred from the
exhaustive fix-up landed in commits `b3bcbf2`..`7fc0a2b`. Each item
includes: why it was deferred, the skill rules that apply, the
concrete approach, the risk profile, the verification path, and a
PR-pacing strategy.

---

## D1 — copy-on-write for `state.projectiles` / `state.satellites`

### Skills applied
- `game-loop-perf` (allocation discipline, GC stutter)
- `game-sim-determinism` (no logic change, byte-parity must hold)
- `sim-tests` (parity test is the safety net)

### Why deferred
At `client/src/sim/World.ts:271, 274`, every fighting tick clones the
entire projectile and satellite records via spread:

```ts
let nextProjectiles: WorldState["projectiles"] = { ...state.projectiles };
let nextSatellites: WorldState["satellites"] = { ...(state.satellites ?? {}) };
```

For a typical match (≤ 50 projectiles, ≤ 8 satellites) this is one
small allocation per tick — an order of magnitude smaller than the
per-tick `Object.keys().map().sort()` we already eliminated in Phase D.
The risk side is bigger: every mutation site has to flip from direct
record assignment to a helper call; missing one would silently
mutate the input `state` and break determinism (a desync bug class
that's hard to surface).

### Approach

Replace the eager spread with a **copy-on-write wrapper**. Two
ways, ranked by safety:

**Option A — explicit helper (recommended).** Tiny module-local
class with three methods:

```ts
class CowRecord<K extends string | number, V> {
  private readonly source: Record<K, V>;
  private mutated: Record<K, V> | null = null;
  constructor(source: Record<K, V>) { this.source = source; }
  get(k: K): V | undefined { return (this.mutated ?? this.source)[k]; }
  set(k: K, v: V): void {
    if (!this.mutated) this.mutated = { ...this.source };
    this.mutated[k] = v;
  }
  delete(k: K): void {
    if (!this.mutated) this.mutated = { ...this.source };
    delete this.mutated[k];
  }
  view(): Record<K, V> { return this.mutated ?? this.source; }
  has(k: K): boolean { return k in (this.mutated ?? this.source); }
  /** Iterate over keys in current (post-mutation) view. */
  *keys(): IterableIterator<K> {
    for (const k in (this.mutated ?? this.source)) yield k as K;
  }
  isMutated(): boolean { return this.mutated !== null; }
}
```

Mutation sites become:
- `nextProjectiles[p.id] = p;` → `nextProjectiles.set(p.id, p);`
- `delete nextProjectiles[id];` → `nextProjectiles.delete(id);`
- Iteration loops use `nextProjectiles.view()` once at the top.

`StepResult.state.projectiles` reads `nextProjectiles.view()` at
return time — if no mutations happened that tick, it's a pointer
to the original (zero-allocation tick).

**Option B — track a boolean flag inline.** Skip the wrapper, just
add `let projectilesCloned = false;` and a helper closure that
clones the first time it sees a write. Less abstraction, more
manual discipline at every site.

### Critical mutation sites to migrate

`World.ts` lines 350, 367, 505 (projectiles); 357, 503 (satellites).
The `nextSatellites = satStep.satellites` assignment at line 503 is
the trickiest — it currently *replaces* the whole record. Either:
- Have the satellite step return only the *delta* (added / removed),
  drive that through the CoW wrapper.
- Keep the wholesale replacement and accept that `satStep` always
  forces a CoW promotion.

The simpler version is the second.

### Risk + verification

- **Risk:** silently mutating the input `state.projectiles` (e.g. a
  forgotten direct `record[id] = p` instead of `wrapper.set(id, p)`)
  breaks the determinism test the next time it diffs two World runs.
- **Test gates** (must all pass before merging):
  1. `bun test client/src/sim/__tests__/world-determinism.test.ts`
     — same seed, same inputs, byte-equal end state.
  2. `bun test client/src/sim/__tests__/snapshotDelta.test.ts` — encode/
     decode round-trip on snapshots that include projectiles + sats.
  3. New micro-test: 600-tick run with no projectiles emitted
     (`view() === state.projectiles` reference equality at the end).
- **Manual:** profile a 60-second hot-fight session in Chrome
  DevTools → Memory; allocations attributed to `World.step` should
  drop measurably.

### Time + pacing

≈ 1.5 hours, **single PR**. Don't split — the wrapper's value is
applying it at every mutation site at once.

---

## E1 — the `RenderHost` collapse (re-evaluation)

### Skills applied
- `improve-codebase-architecture` (deletion test, deep-vs-shallow)
- `phaser4-game` (scene boundary discipline)

### Why deferred
The original audit flagged `RenderHost` as a pure pass-through and
recommended inlining its callers. Closer reading showed it owns:

1. The async Convex match-assignment fetch
   (`fetchMatchAssignment`, `client/src/net/RenderHost.ts:108-112`).
2. WS URL construction (`buildGameServerWsUrl`, line 117).
3. Transport instantiation (`new WsTransport(...)`, line 119).
4. `ClientLoop` construction with full callback wiring (line 120).
5. Empty-stats fallback (line 45-54).
6. Lifecycle (start / stop / destroy, lines 86-97).

By the deletion test: removing `RenderHost` would push items 1-4
into `OnlineMatchScene.create()`. That's a Phaser scene reaching
into Convex + transport + matchmaker — the exact coupling
`phaser4-game` calls "scene reaching outside its lane".

### Recommended action

**Don't collapse the class.** Instead, do these two cosmetic moves:

1. **Move the empty-stats fallback into `ClientLoop`.** Today
   `RenderHost.getRenderSnapshot()` falls back to `EMPTY_STATS` when
   `loop` is null. That fallback is ClientLoop's concern — let
   `ClientLoop.getNetStats()` return the same defaults pre-connect
   so RenderHost becomes thinner.

2. **Rename `RenderHost` → `MatchSession`** to signal it owns the
   *connect → tick → disconnect* lifecycle, not just rendering. The
   current name suggests "thing that renders" but it doesn't render
   anything; the scene does. Renaming is one rg+sed pass + two
   import sites.

After those two moves, the class has 4 distinct responsibilities,
none of which are pass-through, and the name matches the role.

### Risk + verification

- Renaming + a function move are syntactic. Typecheck passes ⇒ done.
- No new test needed; existing flow tests cover the connect path.

### Time + pacing

≈ 30 min, single PR. Keep separate from any other refactor — the
rename is grep-greppable, easy to revert if anything looks weird.

### File this as an ADR

The audit was *wrong* about RenderHost; future audits should not
re-suggest the collapse. Write `docs/adr/0001-renderhost-stays.md`
with the deletion-test reasoning so the architecture-review skill
has prior art to consult.

---

## E3 (rest) — `ClientLoop` further partition

### Skills applied
- `improve-codebase-architecture` (deepening, narrow seams)
- `game-netcode` (protect the input → snapshot → reconcile contract)
- `sim-tests` (regression net for snapshot-apply path)
- `ts-pocock` (typed messages at every seam boundary)

### Why deferred
Phase E3 already extracted `ReconnectSupervisor` (129 LOC) and
`RenderSmoother` (139 LOC) — `clientLoop.ts` is now 775 LOC. The
remaining cohesive seams (transport, snapshot apply, tick driver)
are knit tightly into the predicted/authoritative state pair, the
input-seq buffer, and the per-entity reconcile path. Splitting them
without a comprehensive snapshot-apply regression test is a real
desync risk.

### Approach (3 PRs)

#### E3a — `TickDriver` (smallest, safest)
Owns: `setInterval`, accumulator, `tick()`, `stepOnce()`, `slewMsBudget`,
`pendingInputs`, `nextInputSeq`. ≈ 150 LOC.

**Public seam:**
```ts
interface TickDriver {
  start(initialPredicted: WorldState): void;
  stop(): void;
  setLocalInput(input: LocalInput): void;
  /** Called by SnapshotApplier after reconcile. Replaces the predicted
   *  state and drops acked inputs. */
  applyAuthoritative(state: WorldState, ackedSeq: InputSeq): void;
  /** Fired inside stepOnce, gives consumer a chance to send the input. */
  onInputProduced(cb: (input: InputFrame) => void): void;
  applySlewHint(deltaMs: number): void;
  getNetStats(): Pick<NetStats, "pendingInputs" | "slewMsAvg">;
  getPredictedState(): WorldState | null;
}
```

ClientLoop's `tick()` and `stepOnce()` move verbatim. The transport-
send for input becomes `onInputProduced(input → transport.send(...))`.

**Risk:** medium. The input-send timing must remain identical.
**Test:** the existing per-snapshot reconcile tests cover this.

#### E3b — `SnapshotApplier`
Owns: snapshot ring, full vs delta routing, hash-guided reconcile,
authoritative state, `applyDelta` invocation, smoothing handoff.
≈ 250 LOC.

**Public seam:**
```ts
interface SnapshotApplier {
  /** Called when the transport hands us a snap message. */
  apply(message: Snapshot, predicted: WorldState | null): {
    /** New predicted state after rewind+replay. */
    nextPredicted: WorldState;
    /** Authoritative state for hooks like onAuthoritativeApplied. */
    authoritative: WorldState;
    ackedSeqByPlayer: Record<PlayerId, InputSeq>;
    events: SimEvent[];
    skippedEntities: number;
    /** Smoothing inputs — caller passes into RenderSmoother. */
    prevRenderedXY: { x: number; y: number } | null;
    newPredictedXY: { x: number; y: number };
  };
  /** Last snapshot tick — for ack messages. */
  lastSnapshotTick(): Tick;
}
```

The `pendingInputs` replay is the trickiest piece — it currently runs
`World.step` per input inside `applySnapshot`. Either:
- The applier takes a `pendingInputs: readonly InputFrame[]` param.
- Or the applier calls back into the tick driver's replay routine.

Prefer the param approach — keeps the applier pure(-ish) of driver
state.

**Risk:** highest of the three. The reconcile path is the heart of
multiplayer correctness. **Don't merge without:**
1. New unit test: feed a known WorldState + canned snapshot → assert
   the new predicted state byte-equals the pre-refactor output.
2. A 30-second multiplayer playtest with `?fakelag=120` (per
   `game-netcode` debug toggle) showing identical reconcile behavior.

#### E3c — `Transport` wrapper that owns hello + ping
Owns: hello handshake, ping/pong, RTT tracking, `outstandingPings`,
`rttSamples`. ≈ 100 LOC.

**Public seam:**
```ts
interface ConnectionDriver {
  send(message: ClientMessage): void;
  onMessage(cb: (message: ServerMessage) => void): void;
  /** RTT-aware stats. */
  getNetStats(): Pick<NetStats, "rttMs" | "snapRateHz" | "transportState">;
}
```

ClientLoop wraps the existing `Transport` + adds the hello/ping
behavior on top. The reconnect-supervisor + connection-driver pair
become the only `Transport`-aware code.

**Risk:** low. Hello/ping are stateless message types.

### Final shape

After all three PRs, `clientLoop.ts` becomes a ≈ 200-LOC facade
that wires:
```
ConnectionDriver  ──▶  ClientLoop  ──▶  TickDriver
   ▲                      │                │
   │                      ▼                ▼
ReconnectSup.       SnapshotApplier   RenderSmoother
                          │                ▲
                          └──── feeds ─────┘
```

### Time + pacing

- E3a: ≈ 4 hours, single PR.
- E3b: ≈ 6 hours + thorough regression. Single PR but slow merge.
- E3c: ≈ 2 hours, single PR.

Total: ≈ 1.5 days, three PRs over a week (each one needs a
multiplayer playtest before the next).

---

## E4 (rest) — full `MatchSceneBase` unification

### Skills applied
- `phaser4-game` (scene boundary, pool drain, seam between sim
  loop and Phaser tick)
- `improve-codebase-architecture` (deepening; the deletion test
  is brutal here — removing the duplicate concentrates complexity
  in one well-named base)
- `game-feel-juice` (pool-drain on round-end, kill stack — both
  scenes need the same hookup)
- `ts-pocock` (typed scene-init contract via discriminated union)

### Why deferred
`MatchScene.ts` is 2886 LOC; `OnlineMatchScene.ts` is 1639 LOC.
≈ 80 % overlap by responsibility but the two were grown
independently — duplicate fields, duplicate `case` arms in the
SimEvent dispatcher, duplicate HUD wiring, duplicate ParticlePool
plumbing. The platform-tracker fix in `7fc0a2b` already proved the
duplication tax: today's terrain-doubling fix had to land twice.

The full unification is the highest-ROI architectural change in
the codebase but it's also the single change with the largest
blast radius: nearly every Phaser-side feature touches one of
these scenes.

### Approach (5 PRs over a week)

#### E4-1 — extract `MatchSceneBase` skeleton + `arenaGraphics`
**Scope:** abstract class with the platform layer (already extracted
in `7fc0a2b`), arena Graphics, light beams. Both scenes inherit and
remove the duplicated fields. ≈ 300 LOC moved.

**Risk:** low. The arena render is already a one-shot hook.

#### E4-2 — pull HUD + ParticlePool wiring up
**Scope:**
- `protected readonly hudSystem: HudSystem`
- `protected readonly particlePool: ParticlePool`
- The `case "round-end"` arm of `handleSimEvents` runs
  `particlePool.drainActive(this)` once on the base.
- HUD `update()` cadence moves to `update()` in the base; both
  scenes provide the snapshot via an abstract `getRenderState()`.

**Risk:** medium. Touches the per-frame render path.
**Test:** Playwright pixel probe (existing infrastructure) on
`MatchScene` (Practice) before/after — HUD positions and particle
counts must match.

#### E4-3 — sim/source abstraction (the keystone)
**Scope:** define an abstract method:

```ts
protected abstract getSimState(): WorldState | null;
```

- `MatchScene` provides it from its local `World` instance.
- `OnlineMatchScene` provides it from `RenderHost.getRenderSnapshot().world`.

The base's `update()` calls `this.getSimState()` once per frame and
hands it to the rig manager + HUD + render layer. `MatchScene.update`
becomes a thin wrapper that drives the local `World.step` first,
then calls `super.update()`. `OnlineMatchScene.update` becomes a
thin wrapper that calls `RenderHost.setLocalInput` first, then
`super.update()`.

**Risk:** highest of the five. `MatchScene` and `OnlineMatchScene`
have grown subtly different render-sync semantics (one steps then
renders; one renders the latest snapshot). Need a careful audit
that the `update()` order on each subclass matches its prior
behavior.
**Test:** focused playtest of both modes side-by-side; use the
`damage-numbers` particle (visible per-frame phenomenon) as a
canary.

#### E4-4 — typed `MatchSceneInit` discriminated union
**Scope:** replace today's two separate init types with:

```ts
export type MatchSceneInit =
  | { mode: "practice"; localPlayerId: PlayerId; mapId: MapId }
  | { mode: "online-room"; localPlayerId: PlayerId; matchId: string; convexUrl: string }
  | { mode: "online-world"; localPlayerId: PlayerId; gameServerUrl: string }
  | { mode: "replay"; localPlayerId: PlayerId; replay: ReplayFile };
```

The base's `init(data)` switches on `data.mode` and constructs the
right `getSimState()` provider. Eliminates the parallel
`MatchSceneInit` and `OnlineMatchSceneInit` types.

**Risk:** low. It's a typing refactor; the runtime behavior is
already in the constructors.
**Test:** typecheck + scene-boot smoke (Playwright "click Practice"
+ "join World").

#### E4-5 — delete the now-empty subclasses (or keep as factories)
**Scope:** with E4-1 through E4-4 done, `MatchScene` and
`OnlineMatchScene` are ≤ 100 LOC each — mostly init-data validation
and the abstract-method overrides. Two options:
- **Delete them.** Replace with a single `MatchScene` that takes
  the discriminated union and dispatches internally.
- **Keep them as thin factories.** Each is a 30-LOC class that
  exists for `scene.start("MatchScene")` vs `"OnlineMatchScene"`
  string-key compatibility with the lobby.

Recommended: keep as thin factories. The string-key API is wired
through `LobbyController` and breaking it adds churn without
benefit.

### Risk + verification

- **Tests at every stage:**
  - `bun test client/src/sim/__tests__/...` always green.
  - Playwright probes specific to scene behavior (existing pattern
    in `tests/e2e/lobby.spec.ts`).
  - Manual playtest after E4-2 and E4-3 — the visual juice
    integration is hard to assert in a unit test.
- **Don't merge E4-3 on a Friday.** It's the one with most surface
  area for subtle regressions.

### Time + pacing

- E4-1: ≈ 2 hours.
- E4-2: ≈ 4 hours.
- E4-3: ≈ 8 hours + careful playtest. The keystone PR.
- E4-4: ≈ 2 hours.
- E4-5: ≈ 1 hour (delete + adjust factory if kept).

Total: ≈ 1.5 days of focused work, paced as 5 PRs over a week. Each
PR is independently revertable.

---

## Cross-cutting recommendations

### ADRs to write

The audit produced two cases where future audits could re-suggest
already-considered options. Lock them in:

1. `docs/adr/0001-renderhost-stays.md` — RenderHost owns connect
   lifecycle, not pass-through.
2. `docs/adr/0002-protocol-and-snapshotdelta-canonical-on-client.md`
   — both files live in `client/src/net/` because client uses Vite
   (no `@sim` alias in vite.config.ts) and bundler can resolve
   `../sim/...js` style imports cleanly. Server uses `@net/*` alias.

### CI gates to add

- Per `ts-pocock`: a CI step that greps `client/src/sim`,
  `client/src/net`, `server/src` for `as any` and fails if found
  outside `__tests__/`.
- Per `game-sim-determinism`: grep `client/src/sim` for
  `Math.random` / `Date.now` / `performance.now` / `phaser` / `convex`
  imports and fail if any appear.
- Per `game-loop-perf`: a benchmark target running 600 ticks of
  canned inputs and asserting `World.step` p95 < 4 ms wall-clock.

### Review tooling

After E3 + E4 land, the project has clean enough seams that the
architecture-review skill becomes useful for shaping any new feature
PR. Until then, audit-driven feedback risks re-discovering pre-known
duplication.

---

## Summary of effort

| Item | Time | PRs | Risk |
|---|---|---|---|
| D1 | 1.5 hr | 1 | medium (determinism) |
| E1 | 0.5 hr | 1 | low |
| E3a | 4 hr | 1 | medium |
| E3b | 6 hr | 1 | high (reconcile) |
| E3c | 2 hr | 1 | low |
| E4-1 | 2 hr | 1 | low |
| E4-2 | 4 hr | 1 | medium |
| E4-3 | 8 hr | 1 | highest (sim/render seam) |
| E4-4 | 2 hr | 1 | low |
| E4-5 | 1 hr | 1 | low |

**Total:** ≈ 31 hours of engineering, **10 PRs**, comfortably
paced over **2-3 weeks** of part-time work alongside feature
development.

The recommended order:
1. **E1** (cosmetic, fast) → prevents future audit churn.
2. **D1** (perf, isolated) → measurable win, single PR.
3. **E4-1, E4-2** (architecture, lowest E4 risk) → gets the
   bug-doubling tax down further.
4. **E3a, E3c** (small ClientLoop seams) → sets up E3b.
5. **E4-3, E4-4, E4-5** (the sim/render keystone) → big payoff.
6. **E3b** (the reconcile keystone) → last because it touches the
   highest-risk surface.
