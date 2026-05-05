# Game QA & Playtest Discipline

The bar: *every PR ships with at least one test that would have
caught the bug it fixes.* Bugs that escape are the test you didn't
write, not the test that flaked.

## Why this skill exists

Games have qualitatively different failure modes from web apps:

- **Soft failures**: framerate drops, jitter, animation pops, audio
  glitches. Won't throw; won't fail a typecheck; only a human
  notices. Requires sustained-input + visual smoke testing.
- **State-machine corruption**: round phase stuck, projectile
  count climbing forever, score never updating. Manifests after
  N rounds, not in a 1-tick test. Requires long-horizon canaries.
- **Determinism breaks**: client + server diverge → snap/reconcile
  visible jitter. Requires bit-exact parity tests.
- **Multi-client interactions**: race conditions only present when
  N≥2 players on one host. Requires multi-context Playwright.
- **Render-only artifacts**: rig streaks, ghost sprites, particle
  pool not draining. Doesn't crash; looks broken. Requires
  pixel-level visual regression OR human eyeballs on first/last
  recorded video frames.

Five independent test layers cover this surface. Skipping any
layer leaves a class of bugs invisible.

## The five layers

### 1. Pure unit tests (`bun test`)
- Per-function correctness. RNG mulberry32 step, hash mix, AABB
  overlap, fire-rate cooldown.
- Always deterministic. Same seed in → same answer out.
- Runtime budget: < 200ms per file, full suite < 1 minute.
- **Belongs here**: anything synchronous + pure.

### 2. Cross-host parity (`bun test`, marked `Parity`)
- Same input through TS impl + wasm impl → bit-equal output.
- Catches the ULP-level drift that breaks lockstep / determinism.
- Required on EVERY math kernel that runs on both sides.
- Use `.toBe()` for strict equality; `.toBeCloseTo(_, 8)` only if
  the maths can't be made bit-exact (rare).
- **Belongs here**: any function ported between TS + Zig.

### 3. Long-horizon canary (`bun test`, slow)
- Drive 100-600 ticks of canned-but-realistic input through the
  full sim. Assert end-state invariants: tick advanced exactly
  N, no NaN anywhere, all timed buffs expired, projectile_count
  drained to 0 if all expired.
- Catches state-machine corruption + leak-class bugs.
- **Belongs here**: anything that mutates entity arrays over
  time.

### 4. Browser smoke (`playwright test`)
- Boot the deployed game. Click into a match. Drive a scripted
  input sequence. Assert no console errors + visible state.
- Use `probeScreenshotColor` for pixel landmarks (HP bar fill,
  platform colour, projectile tint).
- Capture artifacts every test: video + first/last frame
  (ffmpeg select frame 0 + N-1 — never intermediates) +
  console.json + colour-probe.json + state-hash sample.
- **Belongs here**: anything user-visible that depends on
  multiple subsystems composing correctly.

### 5. Bot soak (`playwright test`, multi-minute)
- Autonomous bot drives realistic random input for ≥60s, often
  in N≥2 parallel browser contexts.
- LCG-seeded RNG so failures are reproducible.
- The point is volume: catches the regression that fires on the
  47th projectile spawn or the 4th round transition.
- **Belongs here**: regressions that surface only after sustained
  play.

## What KOLs recommend

**John Carmack, ".plan files / id Software postmortems"**:
> "If you don't have automated testing, your game is one
> compile away from being broken in a way nobody notices for a
> month. The fastest unit test is the one you didn't have to
> write because the function is pure."

(Carmack's argument for *purity at the boundaries*: the more
tightly you contain side effects, the more you can assert
without spinning up a full game session.)

**Mike Acton, "Data-Oriented Design and C++" (CppCon 2014)**:
> "Where there is one, there are many. If you write a test for
> one player, you need to write a test for sixteen."

(Acton's bias toward batch-shaped tests: one player walking is
not the test surface; sixteen players in a contested arena is.)

**Steve Theodore, "Things I Wish They Taught at Game Dev School"**:
> "QA isn't 'find the bugs', it's 'design the experiments.' Every
> test has a hypothesis: this combination of inputs reproduces
> this defect. If your test doesn't name what it's trying to
> falsify, it's not a test, it's a sanity check."

**Ben Hanke, "Untitled Goose Game" GDC retrospective**:
> "We had a script that played the game randomly for 8 hours.
> Every crash was a stack trace + the input log that led to it.
> You can't write that test by hand. Bots find what humans miss."

## Recipes

### Recipe 1 — pinning a bug as a test

When a user reports a bug:

1. **Reproduce locally**. Don't proceed without it.
2. **Reduce the input to the smallest sequence that triggers it.**
3. **Write the test FIRST**, watch it fail. Three layers:
   - Unit test if it's a pure function: feed the broken input
     directly.
   - Long-horizon canary if it surfaces after N ticks.
   - Browser smoke if it's renderer / netcode / scene
     composition.
4. **Fix the code**. Watch the test go green.
5. **Commit both the fix and the test together.** A fix without
   a test is a stencil for the next regression.

### Recipe 2 — random-input bot harness (the "Goose test")

```ts
function startBot(page: Page, seed: number) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const keys = ['a', 'd', 'w', 's'] as const;
  let alive = true, pressed: string | null = null;
  (async () => {
    while (alive) {
      if (pressed) await page.keyboard.up(pressed);
      pressed = keys[Math.floor(rand() * keys.length)]!;
      await page.keyboard.down(pressed);
      if (rand() < 0.25) {
        await page.keyboard.down('w');
        await page.waitForTimeout(80);
        await page.keyboard.up('w');
      }
      if (rand() < 0.35) {
        await page.mouse.click(640 + (rand()-0.5)*400, 400 + (rand()-0.5)*200);
      }
      await page.waitForTimeout(150 + rand() * 200);
    }
  })();
  return { stop: async () => { alive = false; if (pressed) await page.keyboard.up(pressed); }};
}
```

LCG-seeded so each failure is reproducible from the seed.

### Recipe 3 — long-horizon Bun canary

```ts
test("600 ticks of mixed entity churn — no NaN, expected end-state", async () => {
  let state = buildLongHorizonFixture();
  for (let i = 0; i < 600; i++) {
    state = await applyWasmWorldStep(state, 1000/60);
  }
  expect(state.tick).toBe(Tick(600));
  expect(isNaNAnywhere(state)).toBeNull();
  // ... per-entity end-state asserts
});
```

Drive the sim with realistic-volume initial state (50+
projectiles, 20+ destructibles, 10+ fire patches). The point
is to expose any per-tick growth or stale state.

### Recipe 4 — multi-context bot pair

```ts
test("two bots — same world room, 60s, no errors", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  // ... navigate both to ?world=1, attach console listeners
  const botA = startBot(pageA, 0xa);
  const botB = startBot(pageB, 0xb);
  await new Promise(r => setTimeout(r, 60_000));
  await Promise.all([botA.stop(), botB.stop()]);
  // assert no errors from either side
});
```

Catches multi-player race conditions impossible to reach with
one tab.

### Recipe 5 — visual evidence per session

Every browser-layer test SHOULD save:
- `before.png` (pre-action splash baseline)
- `after.png` (final state)
- `video.webm` (full session — Playwright `video: "on"`)
- `frames/first.png` + `frames/last.png` (ffmpeg sparse extract,
  per `image-buffer discipline`)
- `console.json` (every console + pageerror, timestamped)
- `samples.json` (window.__simStepNo + __simStateHash sampled
  every 2s)
- `color-probe.json` (dominant colour buckets — verifies HUD,
  platforms, etc still render)

Failures triage in <5 min when artifacts answer "what was on
screen?" without re-running the test.

## Anti-patterns

- ❌ **Testing happy path only.** "My render works" is not a
  test; "the render survives 60s of random input + recovers from
  a deliberate edge fall" is.
- ❌ **No artifact retention.** A failure with no video and no
  console capture is a failure you'll re-run blind.
- ❌ **Time-dependent assertions without seeded RNG.** "20% of
  the time the test fails" is not flakiness, it's missing a seed.
- ❌ **One giant test.** A 600-tick canary is fine. A 600-tick
  canary that asserts 30 things is hard to triage. One canary
  per behavioral slice.
- ❌ **Skipping layer 4-5 because layer 1-3 pass.** Unit tests
  prove the function works; smoke + bot tests prove the FUNCTIONS
  COMPOSE. Both classes of bug exist.
- ❌ **Leaving wasm parity tests un-installed (LUT install).**
  TS lutAtan2 falls back to libm without `installLutTables`;
  result: last-ULP divergence false positives. ALWAYS install
  the wasm LUT in TS-side parity tests before computing
  expected values.

## Pre-flight checklist

For every PR that touches game code:

- [ ] Layer 1: did I add a unit test for any new pure function?
- [ ] Layer 2: did I add a parity test for any TS↔wasm port?
- [ ] Layer 3: does the long-horizon canary cover the new code
      path?
- [ ] Layer 4: did the affected feature get a Playwright smoke
      gate?
- [ ] Layer 5: did the bot soak suite exercise this scenario for
      ≥60s?
- [ ] Did I add a regression test for any bug fix in this PR?
- [ ] Are artifact paths retained in CI for ≥14 days?
- [ ] Did I run all five layers locally before pushing?

## Sources

- John Carmack, ".plan files" archive (https://github.com/ESWAT/john-carmack-plan-archive).
- Mike Acton, "Data-Oriented Design and C++" — CppCon 2014:
  https://www.youtube.com/watch?v=rX0ItVEVjHc
- Steve Theodore, "Things I Wish They Taught at Game Dev School"
  GDC 2017.
- Ben Hanke / House House, "Building the world of Untitled Goose
  Game" — GDC 2020.
- Mike Cohn, *Succeeding with Agile*, Chapter on the Test
  Pyramid.
- Glenn Fiedler, "Deterministic Lockstep" + "Snapshot
  Interpolation" — gafferongames.com.
