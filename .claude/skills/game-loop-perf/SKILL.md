---
name: game-loop-perf
description: >
  Frame-budget and GC discipline for JAKESJAM's hot paths. Use when working
  on the game loop, sim step, render sync, particle systems, or anywhere
  perf matters: requestAnimationFrame, setInterval, fixed timestep,
  accumulator, allocation, garbage collection, jank, jitter, stutter, FPS,
  frame time, object pool, ring buffer, TypedArray, SoA/AoS, hot loop, V8
  hidden classes, profiling, DevTools Performance panel. Trigger on words
  like "slow", "drops frames", "stutter", "GC pause", "memory growing".
---

# Game Loop & Hot-Path Performance

60 FPS = **16.67 ms** total frame budget. Realistic split for JAKESJAM:

- Sim step (client prediction): ≤ 4 ms
- Render sync (Phaser GameObject updates): ≤ 4 ms
- Phaser internal render: ≤ 6 ms
- Headroom for GC, network, audio: ≤ 2 ms

A single 5 ms GC pause at 60 Hz drops a frame. The whole goal is to **never allocate during a tick**.

## Fixed timestep (Fiedler's "Fix Your Timestep")

Render at the display's refresh rate; step the sim at a fixed rate independent of it. The accumulator pattern:

```ts
let acc = 0;
const STEP_MS = 1000 / 60;

function frame(now: number) {
  const dt = Math.min(now - last, 250); // clamp the spiral of death
  last = now;
  acc += dt;
  while (acc >= STEP_MS) {
    world.step(STEP_MS);
    acc -= STEP_MS;
  }
  const alpha = acc / STEP_MS;        // for visual interpolation
  render(world.state, alpha);
  requestAnimationFrame(frame);
}
```

Why this matters here: server uses the same `STEP_MS`. Client prediction is only consistent with the server if both step the same size. If you ever pass a variable `dt` to `world.step`, **prediction will drift**.

Clamp the dt input (250 ms above) so a hidden tab waking up doesn't try to simulate a minute of game time.

## Allocation discipline (the real win)

What allocates per frame and how to kill it:

| Pattern | Why bad | Fix |
|---|---|---|
| `const v = { x, y }` in update | object allocation | scratch object or `Float32Array` slot |
| `arr.map(...)` / `arr.filter(...)` | new array + closures | classic `for (let i = 0; i < n; i++)` |
| `arr.forEach(cb)` | closure allocation per call site over hot data | `for` loop |
| `[...arr]` / `arr.slice()` | copy | iterate in place; use a fixed scratch array |
| `JSON.parse/stringify` on net frames | strings everywhere | msgpack with reused buffer |
| `new Vector2()` for math | allocation | reuse a module-scoped `_scratch` Vector2 |
| `Map<id, …>` keyed by entity in a tight loop | hash overhead | dense array indexed by entity id (SoA) |
| `setInterval` for sim | drift + can't sync to render | accumulator above |

## Object pools (the right way)

Required for: projectiles, particles, hit results, damage numbers, spawn flashes, anything that fires more than once per frame.

```ts
class Pool<T> {
  private free: T[] = [];
  constructor(private make: () => T, private reset: (t: T) => void, prealloc = 64) {
    for (let i = 0; i < prealloc; i++) this.free.push(make());
  }
  acquire(): T { return this.free.pop() ?? this.make(); }
  release(t: T): void { this.reset(t); this.free.push(t); }
}
```

Rules:
- **`reset` must zero everything.** The pool's whole point is preventing stale state across acquires.
- **Pre-allocate to peak.** `prealloc` should be your worst-case in-flight count. Pool growth is fine, pool shrink isn't worth it.
- Don't pool tiny things (numbers, single sprites) — overhead exceeds benefit.

## Structure-of-arrays for entity-heavy systems

For systems with hundreds of entities (projectiles, particles, debris):

```ts
const N = 4096;
const posX = new Float32Array(N);
const posY = new Float32Array(N);
const velX = new Float32Array(N);
const velY = new Float32Array(N);
const alive = new Uint8Array(N);
```

CPU cache loads contiguous floats per system. Iteration is `for (let i = 0; i < N; i++)` over `posX[i] += velX[i] * dt`. This is exactly how bitECS (and Phaser 4 internally) lays things out.

For player/sim entities (count < ~50) the AoS object form is fine — readability wins over the marginal cache benefit.

## Profiling — what to actually do

- **Chrome DevTools → Performance → Record** for ~5 seconds of gameplay. Look for:
  - **Yellow GC bars in the timeline** — every one is a hitch. Click into the call tree to find the allocator.
  - **Long Task warnings** (>50 ms) — usually first frame after asset load or scene transition.
  - **Scripting time vs Rendering time** ratio. Scripting > 8 ms per frame → look at sim or render-sync.
- **`performance.measure`** around `world.step` and around the snapshot-render sync. Log p50/p95 every 5 s. Numbers beat vibes.
- **Don't trust Lighthouse** for game perf — it measures load, not steady-state frames. The Performance panel is the truth.
- Run with `--enable-precise-memory-info` and watch `performance.memory.usedJSHeapSize`. Steady-state should be flat. Sawtooth = you're allocating per frame; the slope is the rate.

## Anti-patterns (don't do these)

- ❌ `requestAnimationFrame` driving `world.step` directly with a variable dt. Drifts vs. server.
- ❌ Closures inside `update`/`step` (e.g. `players.forEach(p => …)` referencing locals). The closure allocates.
- ❌ Polling `performance.now()` repeatedly inside a frame. Sample once at the top.
- ❌ Spawning a new `Phaser.GameObjects.Sprite` per projectile. Pool them.
- ❌ Treating GC as "the runtime's problem". On 60 Hz games it is your problem.
- ❌ Optimising before measuring. Take a profile first; the bottleneck is rarely where you guess.

## References (KOLs / sources)

- [Glenn Fiedler — Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/)
- [Robert Nystrom — Game Loop pattern](https://gameprogrammingpatterns.com/game-loop.html)
- [web.dev — Static Memory JavaScript with Object Pools (V8 team)](https://web.dev/speed-static-mem-pools/)
- [Aleksandr Hovhannisyan — Performant Game Loops in JavaScript](https://www.aleksandrhovhannisyan.com/blog/javascript-game-loop/)
- [Phaser Performance Optimization Guide](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide)
