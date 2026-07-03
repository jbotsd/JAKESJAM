# Game-feel & scale audit — movement, terrain, weapons

Deep-dive requested 2026-07-03: "how fast should players be, how open
should the terrain be, all to a scale — make the mental model right."
Every number below is derived from the shipped constants
(`sim/src/player.zig`, mirrored in `player.ts`), the arena data
(`boxworks-mini.ts`), and the baseline weapon (`weapons.ts`), then
compared against published/measured values from genre benchmarks
(Celeste, Smash, Duck Game, ROUNDS, Towerfall).

The unit that makes everything comparable: **1 H = one body height =
56 px**. A viewport is 12.9 H wide × 12.9 H tall (1280×720 — the
player is 7.8% of screen height, inside the 5–10% platform-fighter
norm ✓).

## Movement — measured feel metrics

| Metric | Value | Derivation | Benchmark band | Verdict |
| --- | --- | --- | --- | --- |
| Run speed | 330 px/s = **5.9 H/s** | MAX_GROUND_SPEED | 5–7 H/s (Celeste 5.6, Smash run 4–7) | ✓ |
| Arena cross time (mini) | **3.7 s** | 1216 px inner / 330 | 2.5–4 s for a 1v1 brawler | ✓ (upper end) |
| Time to max speed | **122 ms** (~7 frames) | 330 / 2700 accel | 80–150 ms | ✓ crisp |
| Stop time | **92 ms** | 330 / 3600 friction | ≤120 ms | ✓ snappy |
| Air control | **76 %** of ground accel | 2050 / 2700 | 60–90 % | ✓ |
| Jump apex height | 139 px = **2.48 H** | v²/2g = 635²/2·1450 | 2–3 H (Celeste 2.5) | ✓ |
| Time to apex | **438 ms** | v/g | 250–400 ms | ⚠ floaty |
| Default descent time | ~295 ms (was 438 symmetric) | DESCENT_GRAVITY 2175 | fall 1.4–2× faster than rise | ✓ (M1) |
| Full hop airtime | **~730 ms** (was ~880) | rise + fall | 550–750 ms | ✓ (M1) |
| Coyote / jump buffer | 110 / 110 ms | constants | 80–120 ms | ✓ modern |
| Jump-cut multiplier | 0.48 | constant | 0.4–0.6 | ✓ |

**The one real movement flaw was symmetric jump gravity** — fixed by
M1 (see change log). Every benchmark title falls faster than it rises
(Hollow Knight ≈1.4×, Celeste ≈1.6× effective, Smash fast-fallers
≈2×) because a fast descent reads as *weight* and returns control
sooner. The default arc previously floated for a near-second; descent
now runs at 1.5× rise gravity with input fast-fall on top.

## Terrain — reachability audit (boxworks-mini)

Feet on floor sit at y = 608 (floor top). Max jump rise = 139 px.

| Route | Rise needed | Jumpable (≤139)? |
| --- | --- | --- |
| Floor → side ledge (y460, top 451) | **157 px** | ✗ **unreachable** |
| Floor → mid platform (top 349) | 259 px | ✗ (jetpack route — intended) |
| Side ledge → mid platform | 102 px | ✓ |
| Mid → cover pillar top | 29 px | ✓ |

**Finding T1 (FIXED in this pass):** the side ledges — described in
the map source as "at brawl height — give crouchers an angle" — were
18 px taller than the maximum jump. The intended floor → ledge → mid
flow was broken at its first link; the only way up was burning
jetpack fuel. Ledges moved y 460 → **488** (top 479, rise 129 = 93 %
of max jump: reachable, still deliberate). Rule of thumb encoded
here: **standard terrain steps should cost ≤ 90–95 % of max jump
rise; anything above 100 % is a jetpack/route gate and should look
like one.**

## Weapons vs movement — the dodge economy

| Metric | Value | Meaning |
| --- | --- | --- |
| Bullet : runner speed | 650 : 330 = **2.0×** | Very dodgeable; juke-heavy feel (Duck Game ≈3–4×, ROUNDS ≈2–3×) |
| Bullet flight @300 px engagement | **460 ms** | Full reaction window — dodging is a real skill layer ✓ |
| Bullet range | 650×1.2 s = 780 px (61 % arena) | Cross-map spam impossible ✓ |
| Sustained TTK (baseline) | 10 hits @4/s = **2.5 s** | Long for 1v1 (ROUNDS ≈3–5 hits) |

The 2× speed ratio + 460 ms reaction window makes movement the
dominant skill — consistent with the jetpack/parry kit. If fights
feel too attritional at jam scale, the lever is **damage 10 → 15**
(TTK 1.75 s), not projectile speed — raising speed collapses the
dodge economy that the whole movement kit is built around.

## Mental model summary

- One screen ≈ one arena (mini): full information, no camera surprise ✓
- Player = 7.8 % of screen height ✓
- One jump = 2.5 bodies; one terrain step ≤ 93 % of that (after T1) ✓
- One bullet = dodgeable at any range past point-blank ✓
- One round = ~90 s cap, ~2.5 s of sustained hits to kill ⚠ (watch)
- Weight: asymmetric descent restored (M1) — full hop ~730 ms ✓

## Change log

- **T1 applied 2026-07-03**: boxworks-mini side ledges y 460 → 488.
- **M1 applied 2026-07-03**: DESCENT_GRAVITY 2175 (1.5× rise) as the
  no-input default, FAST_FALL_GRAVITY 2150 → 2800 (input-held). One
  cut across player.zig + player.ts, wasm rebuilt, zig + wasm-parity
  + full unit suites green, live-measured ~25% faster descent per px
  of height. Apex height and rise feel unchanged.
- **W1 watch item**: baseline damage 10 → 15 if playtests report
  attrition fatigue; do not touch projectileSpeed.
