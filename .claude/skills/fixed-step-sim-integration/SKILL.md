---
name: fixed-step-sim-integration
description: >
  Substrate-agnostic recipe for making a shared client/server simulation
  produce bit-identical output for the same inputs across rollback,
  replay, and cross-platform runs. Codifies the fixed-step accumulator,
  tick-numbered inputs, the float-vs-fixed-point decision, and the
  asymmetry that makes air physics diverge before ground does. Use when
  client and server "feel out of sync", positions drift after rollback,
  or rewinds produce different outcomes for the same inputs.
  PROJECT-AGNOSTIC.
version: 1.0.0
---

# Fixed-step sim integration

## Why this skill exists

You have a deterministic shared sim (Zig→WASM, Rust→WASM, fixed-point TS, whatever). On paper it should produce identical output for the same inputs on client and server. In practice:

- Jumping feels jittery, ground movement is fine.
- Long arcs (projectiles, falls, vehicle drifts) end at slightly different positions on client and server.
- Rolling back and replaying the same inputs sometimes produces a different state than running them forward.
- Players on different machines see ghosts, hits-that-shouldn't-have-been, or "phantom" positions.

These all share a root cause: **the sim is being stepped at different rates, or with different `dt` values, or with non-tick-deterministic inputs, between the two sides** — even if the *code* is identical.

The fix has been the same since Quake 3: **fixed-step integration, tick-tagged inputs, and (sometimes) fixed-point arithmetic.**

## The hard rules

1. **Sim time advances in fixed slices.** Never `step(varying_dt)`. Always `step(STEP_MS)` where `STEP_MS` is a constant compiled into both sides.
2. **The accumulator pattern decouples sim time from render time.** Render runs at whatever FPS the device hits; sim runs at exactly N Hz.
3. **Inputs are tagged by integer tick number, never by wall clock.** Rollback replays input `I` at tick `T` — both sides see the same `(I, T)` pair regardless of arrival time.
4. **The sim never reads `Date.now()`, `performance.now()`, `Math.random()`, or any non-input source of entropy.** All randomness comes from a seeded PRNG; the seed is part of the snapshot.

Violate any of these and you have a determinism bug that *will* manifest as in-air drift, projectile divergence, or "I shot him in the head" disputes.

## The fixed-step accumulator (Glenn Fiedler, *Fix Your Timestep!*)

```
const STEP_MS = 1000 / 60;   // 60 Hz sim. Never changes.
let accumulator = 0;
let lastWallClock = now();

function frame() {
  const wall = now();
  accumulator += wall - lastWallClock;
  lastWallClock = wall;

  // Step the sim 0..N times this frame, in fixed slices.
  while (accumulator >= STEP_MS) {
    sim.step(STEP_MS);          // <-- always exact STEP_MS, never the residue
    accumulator -= STEP_MS;
  }

  // Render uses interpolation factor for smooth visuals between sim ticks.
  const alpha = accumulator / STEP_MS;   // [0,1)
  render(sim.state, alpha);
}
```

Key invariants:
- The same number of `step()` calls = the same simulated time. Wall-clock variance disappears.
- `alpha` is for *visual* interpolation between the last two sim states only. Sim never reads it.
- When the client rolls back to tick `T_acked` and replays, it calls `step(STEP_MS)` exactly `(currentTick - T_acked)` times — same count the server ran. Bit-identical (assuming determinism rules below).

Source: https://gafferongames.com/post/fix_your_timestep/

## Tick-tagged inputs (the rollback safety net)

```
ClientInput {
  tick:  u32,           // sim tick this input was generated AT
  seq:   u32,           // monotonic per-client; server uses this for ack
  state: InputState,    // bitmask of pressed buttons + analog axes
}
```

The client buffers its inputs locally, indexed by `tick`. Server receives them, applies the input *for tick T* when it runs `step()` for tick T. On rollback, the client replays its own buffered inputs in the same order, by tick.

**Why this matters specifically for jumps:** a jump-press that arrives at the server "between" two ticks doesn't get rounded to one or the other based on arrival time. It gets applied at the tick the *client* generated it. Both sides resolve the apex of the jump using the same inputs, in the same order, at the same simulated dt. No drift.

**Anti-pattern**: applying input "the next time the server steps" without tagging. This makes server resolution depend on packet jitter — fine for ground movement (no integration), catastrophic for air physics (gravity integrates the divergence).

## Float vs fixed-point — when to draw the line

Float is fine for most games **if** you stick to a single CPU instruction set, force consistent rounding mode, and avoid transcendentals (sin/cos/sqrt drift between Intel and AMD historically). Mobile/cross-platform broadens this risk.

| Constraint | Float OK? | Fixed-point recommended? |
|---|---|---|
| Same architecture, single-platform (e.g. browser-only, x64-only) | ✅ | overkill |
| Cross-platform (browser + native + mobile) | ⚠️ audit transcendentals | recommended |
| Rollback netcode (fighting games, RTS, lockstep) | ❌ | required |
| Replays must reproduce months later | ❌ | required |
| Heavy ballistic physics (Rocket League, golf) | ⚠️ | recommended |

Practical fixed-point: **Q32.32** (64-bit signed, 32 fractional bits) covers most game-physics ranges. Q16.16 is tight on velocity but cheaper. Zig/Rust make this ergonomic with first-class integer types and saturating arithmetic. Replace `sin/cos/sqrt` with lookup tables or polynomial approximations and you have a sim that produces literally bit-identical output across every machine that ever runs it.

Sources:
- https://gafferongames.com/post/floating_point_determinism/
- https://www.snopekgames.com/tutorial/2021/getting-started-sg-physics-2d-and-deterministic-physics-godot/

## Why air physics diverge before ground physics

This asymmetry is *the* most common diagnostic for "is my sim actually deterministic":

| | Ground | Air |
|---|---|---|
| `vx` model | direct: `vx = input * SPEED` | input + acceleration |
| `vy` model | clamped to floor (resolved every tick) | `vy += g * dt` (integrated) |
| Error per tick | 0 (re-anchored by floor collision) | tiny float drift, accumulates |
| Path dependence | low — resamples to same state | high — one bad tick changes the whole arc |
| Visible symptom | none — collision absorbs it | "kicks", "snaps", "rubber-bands" |

Implication: **if your game feels good on the ground but bad in the air, your sim is probably non-deterministic, not your smoothing.** Render smoothing (`prediction-error-smoothing`) hides the symptom; this skill kills the cause.

Quake 3's `pmove_fixed 1; pmove_msec 8` shipped specifically because pmove was being called at render rate, so jump physics integrated against whatever residual `dt` was left and jump height became FPS-dependent. Forcing 8 ms slices made jumps deterministic.

## The pmove pattern (identical sim on both sides)

The architectural rule everyone re-discovers:

> **Compile the same sim code into both client and server.** Not "sim that follows the same spec" — the literal same source, the literal same binary if you can.

- Quake 3: `bg_pmove.c` linked into both `cgame` (client) and `game` (server) DLLs.
- Overwatch: replicated movement runs in the same C++ code path on client (predicted) and server (authoritative).
- Modern WASM-shared-sim: ship one `sim.wasm` artifact, instantiate in browser (Phaser/Pixi/whatever) and on the server (Node/Bun/native).
- Lockstep RTS: each client runs the entire sim; only inputs are synchronized.

If client and server simulate via different code paths *that happen to implement the same rules*, you will spend the rest of your project tracking down the divergences. Just compile once.

## Anti-patterns

- ❌ **Variable-dt sim step.** Even if you use fixed timestep on the server, if the client steps with `dt = wallclock_delta`, you've lost determinism.
- ❌ **`Date.now()` / `performance.now()` inside sim.** All time comes from `tick * STEP_MS`.
- ❌ **`Math.random()` inside sim.** Use a seeded PRNG (xorshift, PCG, splitmix); seed lives in the snapshot.
- ❌ **`for-of Map`/`Set` iteration order assumed stable.** Sort keys explicitly before iterating in any order-sensitive code path.
- ❌ **Floating-point transcendentals in the sim hot path.** If you must, swap for a precomputed LUT — bit-identical across platforms.
- ❌ **Two implementations of the same rule** (one in TS for the client, one in Go for the server). Either share via WASM, or accept that you *have* a divergence project, not a netcode project.
- ❌ **Stepping more or fewer ticks during reconcile than the server did.** Rollback replay count must equal `currentServerTick - lastAckedTick`, exactly.
- ❌ **Reading render `dt` into the sim accumulator.** Render `dt` drives the *outer* loop; sim slices are constant.

## Pre-flight checklist

- [ ] `STEP_MS` is a single constant compiled into both sides.
- [ ] Sim never sees a `dt` other than `STEP_MS`.
- [ ] Inputs carry `tick: u32`. Server applies input I when stepping its corresponding tick.
- [ ] PRNG is seeded; seed is part of the snapshot or match init.
- [ ] No `Date.now()`, `performance.now()`, `Math.random()`, or env-derived value reachable from sim code. Verified by grep.
- [ ] Map/Set iteration replaced with sorted-key iteration where order matters.
- [ ] Tests run two parallel sim instances with the same input stream and assert bit-identical state every tick (`world-determinism.test.ts`-style).
- [ ] CI has a long-running sim parity test (10000+ ticks) — short tests miss accumulator-residue bugs.
- [ ] Cross-platform parity test (if applicable): same input stream → same output on at least two architectures.

## Sister skills

- `deterministic-netcode-architecture` — the layer model that depends on a deterministic sim.
- `prediction-error-smoothing` — fixes the *visible symptom* of small remaining divergences without papering over root cause.
- `wasm-game-sim-zig` (project-specific) — concrete recipe for shipping one WASM sim into both client and server.

## Source

- Glenn Fiedler, *Fix Your Timestep!*: https://gafferongames.com/post/fix_your_timestep/
- Glenn Fiedler, *Floating Point Determinism*: https://gafferongames.com/post/floating_point_determinism/
- Snopek Games, *SG Physics 2D / Deterministic Physics in Godot*: https://www.snopekgames.com/tutorial/2021/getting-started-sg-physics-2d-and-deterministic-physics-godot/
- yal.cc, *Preparing your game for deterministic netcode*: https://yal.cc/preparing-your-game-for-deterministic-netcode/
- id-Software/Quake-III-Arena, `bg_pmove.c`: https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c
- Forum thread on `pmove_fixed` / `pmove_msec`: https://forum.fpsclassico.com/viewtopic.php?t=138
- Cone, *It IS Rocket Science!* (GDC 2018): https://ubm-twvideo01.s3.amazonaws.com/o1/vault/gdc2018/presentations/Cone_Jared_It_Is_Rocket.pdf
- Edgegap, *Overwatch Netcode deep dive*: https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback
