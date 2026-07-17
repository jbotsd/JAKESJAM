# Map design — research & the generative ruleset

Companion to `docs/game-feel-tuning.md` (movement metrics) and
`client/src/sim/data/mapGen.ts` (the generator that enforces all of
this). Sources: ROUNDS analysis in `docs/rounds-reference/`, plus the
canon of small-arena design — Towerfall (single-screen readability),
Duck Game (sightline discipline), Smash (tier flow + ledge risk),
Spelunky (chunk-validate generation), and Quake arena theory
(circulation loops, no dead ends).

## The laws (validator-enforced, not vibes)

Derived from OUR measured movement (jump apex **134px** measured
2026-07-14 — the analytic 139 over-promises; safe step ≤129px, run
330px/s model / 362 measured, bullet range 780px, and the WALL KIT for
anything taller: wall-kick 173px rise / 427px carry held, same-wall
pogo climb ~200px/s sustained, wall slide capped 175px/s. The jetpack
is DEAD CODE — `player.ts` forces `jetpackActive = false` — no law may
reference it):

1. **Reachability** — every platform must be reachable from the floor
   through jump-sized steps (rise ≤129px, horizontal gap ≤180px while
   rising / ≤300px falling) or wall-kick edges (jump-latch a kickable
   wall near its top, kick within the conservative envelope: ≤160px
   rise / ≤380px carry of the measured 173/427), OR be explicitly a
   *perch* — and a perch is only LAWFUL if a kickable wall surface
   (kind `wall`, or solid platform ≥25px tall) sits inside that same
   kick envelope of it: climb-gated high ground, not stranded scenery.
   The old "jetpack-gated" exemption is dead with the jetpack.
   Checked as a route graph over platform tops (`unreachablePlatforms`)
   plus the perch audit (`perchViolations`). The T1 bug (unreachable
   ledges shipped for weeks) can no longer exist.
2. **Sightlines ≤ 480px unbroken** on the floor band for mega docks
   (`MAX_SIGHTLINE` in mapGen). Cover pylons / lips break snipes so
   engagements stay mid-range (ROUNDS/Duck Game discipline). Enforced
   by scanning shoulder-height bands between platforms/cover.
3. **Circulation** — ≥2 distinct jump-routes from floor to the mid
   tier (no single chokepoint to height). Enforced on the route graph.
4. **Openness band** — SIZE-AWARE since the 2026-07-17 double-height
   dial. Classic scale (< 1600 tall: curated 1100 docks, sealed boxes):
   platform+floor footprint 6–28% of playable AABB (full floor + cover
   sits mid-band). TALL generated arenas (3000×2200): **5–17%**. This is
   a conscious law change, not a silent widening: the full floor alone
   is ≈3.0% of the doubled AABB (it was ≈6.0% at 1100), so the classic
   6% floor would reject every healthy tall map. Measured across seeds
   0–399 with the new dials live, healthy maps span 6.7–16.0% (median
   ≈11.3%); the band adds honest margin each way — min 5% keeps
   bare-skeleton candidates illegal, max 17% (≈0.34 in 1100-equivalent
   "fill") grants the extra headroom to WALL mass, not shelf clutter.
   Below = featureless spam; above = corridor mess.
5. **Spawn fairness** — spawns ≥280px apart on mega docks (≥12 pads,
   target 16), never inside geometry, standing pad under each spawn.
6. **One-way platforms everywhere** except floor/walls/ceiling —
   vertical flow beats vertical blockage (existing house rule, kept).
7. **Tier rhythm** — floor → T1 (~486) → T2 (~360) → perch (~232) on
   a 640-tall arena: each hop costs 122–129px (93% of max jump, per
   the feel doc), perch costs a wall climb by design (law 1). On the
   2200-tall generated arenas the same grammar extends upward: floor
   tiers (T1–nest, 108px hops) → mid band (~y 1160–1780, reached by
   kick-shafts / long ramps) → island field → sky band (upper third),
   and a tall-only law (**upper-half reach**) requires at least one
   standable top in the upper half — 2x height must never ship a
   bottom-heavy arena with an empty sky.

## Hot Lobby mega scale — always floor + recoverable (≤16 vessels)

Product default is the always-on **Hot Lobby** (`WorldHost`), not 1v1 cells.
**There is always a continuous solid floor.** Fall off a high plate → land on
ground → climb back via hop-chained tiers (rise ≤129px). No soft-kill pits
between “islands.” Side walls contain play; open sky (partial ceiling only).

| Law extension | Value |
|---------------|--------|
| Default curated | `vessel-nexus` — 3000×1100, **full floor**, theme `voidVessel` |
| Procgen | **3000×2200** (double height, 2026-07-17 "expand make 2x") same laws size-adjusted (`mapGen.ts`); curated maps stay 1100 — authored artifacts, classic bands |
| Floor | **Always** full-width solid `floor` (recoverable ground) |
| Frame | Full-height side walls; **partial** ceiling (open sky center) |
| Cover | Floor-band pylons ~every 420–480px (break snipes ≤480) |
| Tiers | T1–T4 / nest hop-chained from ground; kick-shaft pairs COMMON (std ~2.5, vertical ~4.7 with ≥3 mandatory; chimney kept) + sky spires + vertical island field up to the 2200 sky band |
| Spawn target | **16** pads (validator floor **12**), min separation **280px** |
| Sightline | Floor band ≤ **480px** unbroken |
| Aesthetic | Sci-fi gnostic vessel chrome (`voidVessel` / `crystalDock` / `autogenesHull`) |

1v1 Dock Cell / multi-cell `boxworks` stay sealed-box for classic private rooms.

## Why generated > hand-set for Hot Lobby

Hot Lobby recycles every completed match. Hand-set maps make recycles
repetitive within one session; procgen makes every match a fresh read
of the SAME language (fixed tier heights, fixed step costs, familiar
cover shapes) — variety without re-learning movement. Curated maps
stay where curation wins: `vessel-nexus` (16-pad mega default),
`boxworks-tower` / Spire Dock (vertical chaos), room mode keeps
classic `boxworks` + Dock Cell.

Determinism: the seed rides IN the mapId (`gen:123456`). The server
picks the seed; client and server both expand it through the same
pure function — byte-identical geometry, same guarantee the curated
maps have, zero new wire format.

Generation is **generate → validate → repair-or-reroll (bounded,
deterministic)**: a seed that produces an invalid arena deterministically
advances an internal attempt counter, so `gen:N` always means the same
final map everywhere.

## Diagonals & sky (2026-07-16 extension — Jake: "more diagonals, lots
## of stuff in the sky to jump into, large ramps")

The axis-aligned-shelf vocabulary can only produce warehouses: every
ascent is the same hop-hop-hop staccato, every screen reads as ledger
lines. Three additions fix this, ordered by sim risk:

1. **Diagonal ascent chains** (zero sim risk, shipped as mapGen
   vocabulary): small one-way platforms placed along a slope line,
   each rise ≤129px — a "ramp" spelled in the existing rectangle
   language. Kinetically converts ladder-rhythm into one flowing line;
   tactically creates asymmetric cover (full cover from below, full
   exposure from above — a risk gradient along its length). Renderer
   may later draw a connecting sloped silhouette over the steps
   (render-only; collision stays rectangles).
2. **Sky archipelago band** (zero sim risk, mapGen vocabulary):
   aerial islands chained within the gap laws (≤180px rising /
   ≤300px falling) so the sky is a traversable LAYER, not scatter.
   Sky needs stakes (pickups / sightline dominance / escape routes)
   or it's dead weight. The always-floor law makes aggressive sky
   density safe: falling is tempo loss, never death. A "sky-heavy"
   allocation profile inverts density (sparse floor cover, dense sky)
   to flip a map's character from ground shootouts to air superiority.
3. **Launch pads** (movement-affecting entity, FULL parity discipline
   — TS + Zig + parity tests): diagonal impulse on overlap (pickup
   overlap pattern). A pad at the base of a diagonal chain reads as
   hitting a ramp at speed — 80% of ramp feel with no collision-shape
   change. SHIPPED 2026-07-16: `LaunchPadDefinition` on
   MapDefinition (static geometry, ZERO WorldState bytes — the
   retrigger condition is stateless, see `client/src/sim/launchPad.ts`),
   stepped in `World.stepWithRuntime` §4a with the Zig mirror in
   `sim/src/world.zig` §8c (pads reach wasm via
   `world_state_set_launch_pads`, the arena-bounds pattern). Emitted by
   mapGen at diagonal-chain bases (deco stream, after all prior draws).
   Skyseam's two curated seam-base pads were RETIRED 2026-07-17,
   replaced by TRUE SLOPES (item 4) — pads remain the ramp-feel tool
   on generated maps. Authoring law: never aim
   a pad into solid geometry (collision cancels the launch velocity,
   re-opening the stateless gate → refire chatter).

4. **TRUE SLOPES** (movement collision core, FULL parity discipline —
   SHIPPED 2026-07-17, Jake: "true slops like we have no diagnal set
   peices yet and i want them"; previously deliberately deferred as
   the one piece that touches `stepPlayer`'s Zig-mirrored core). The
   locked grammar — never widen it:
   - **Two blessed grades only**, each direction: **2:1** (run:rise
     2:1, ≈26.565°) and **1:1** (45°). A fixed grammar like the fixed
     tier heights; no arbitrary angles.
   - `SlopeDefinition` on MapDefinition (`slopes?`): `{ id, base
     (bottom corner), run, grade, dir }`; surface line
     `y = base.y − grade_t·dir·(x − base.x)`. Static geometry, ZERO
     WorldState bytes (launch-pad precedent) — both sides derive from
     the mapId; wasm gets them via `world_state_set_slopes`
     (module-level statics in player.zig, host-set like the pads,
     ALSO re-written per call by the step_player backend so stale
     cross-match slopes are impossible).
   - **Collision = foot-point one-way grounding** inside `stepPlayer`
     (client/src/sim/player.ts + sim/src/player.zig, shared
     pseudocode carried in both): rect resolution runs first exactly
     as before, THEN a per-sub-step pass samples the bottom-center
     foot point; within the slope's span and an **8px snap band** of
     the surface it grounds the player ON the line (`y = surface(x) −
     halfHeight`). ONE-WAY, walkable side up only — no slope
     ceilings/undersides: crossing from above requires the foot to
     have been at-or-above the surface at sub-step start (+2px slack,
     the rect one-way discipline); rising through from below never
     grounds. Walk-down glue (hovering ≤8px above) requires ground
     history + vy ≥ 0, so jumps and up-dashes leave cleanly.
   - **Momentum conversion — the point**: while slope-grounded,
     velocity is projected onto the surface tangent PRESERVING
     MAGNITUDE. Running up costs nothing (direction converts, not
     speed); leaving the slope (crest or jump) carries the tangent
     velocity ballistically with no special-casing. Full stride up a
     2:1 crest ≈ 324 vx / −162 vy of free launch; a 940 dash rides
     the ramp at full burst magnitude. Jump while slope-grounded =
     normal jump (JUMP_VELOCITY vertical + current vx) — no
     slope-normal jumps in v1.
   - Tie-breaks: wall latch beats slope grounding within a sub-step
     (walls are vertical, slopes ≤45° — overlap is rare); rect-vs-
     slope goes to whichever grounds HIGHER; slope-vs-slope to the
     higher surface (equal → lowest array index).
   - Sub-stepping: with slopes present the displacement guard also
     bounds L1 (|dx|+|dy|) at 6px/sub-step (< snap band − slack) so a
     45° dash can never tunnel. Slope-less maps keep the EXACT legacy
     sub-step count — every pre-slope trajectory is bit-identical.
   - **Parity constants**: the irrational tangents are f64 LITERALS
     defined byte-identically in collision.ts and player.zig
     (`INV_SQRT5 = 0.4472135954999579`, `TWO_INV_SQRT5 =
     0.8944271909999159`, `INV_SQRT2 = 0.7071067811865476`) — NO
     runtime sqrt; op order is pinned by shared pseudocode both files
     carry, and the wasm transport ships the TS-derived f64s verbatim
     (`deriveSlopeStatics`), so every host reads the same bits by
     construction. Gates: `slopeParity.test.ts` (step_player,
     bit-exact, both grades × both directions),
     `serverWasmHost.test.ts` (step_world executes slopes bit-exact
     vs TS), `slope.test.ts` (determinism, one-way, snap edge, dash,
     prediction path), smoke.zig (native constants + grounding).
   - Validator: slopes contribute a minimal base↔top walk edge to the
     route graph (`unreachablePlatforms`) — nothing else. Generator
     emission of slopes (mapGen vocabulary) is an explicit follow-up,
     deliberately NOT in the first cut.
   - Set pieces (skyseam): `ramp-seam-a` / `ramp-seam-b` — 2:1 ramps
     (run 216, rise 108) from the floor cresting EXACTLY flush with
     each seam's first step (sprint from the wall straight onto the
     seam chain at speed), and `ramp-junction` — a 45° two-tier
     assault ramp (run 216, rise 216) from seam-a-land3's terrace lip
     (T3) straight to the cross-junction deck (T5).

### Vertical (2026-07-17 extension — Jake: the wall kit is GREAT, "add
### way more vertical shit dude and diag or ramps")

Measured wall kit (sim harness 2026-07-14): wall-kick held = 173px
rise, 427px carry; same-wall pogo climb ~200px/s sustained; wall slide
descent cap 175px/s; power-slide kick 72 rise / 220 carry; run-jump
284px flat. Kickable = kind `wall` or any solid platform ≥25px tall
(`GRAB_MIN_H`). The vocabulary that invites it:

1. **Kick-shaft pairs** (`ks-<n>-a/b`) — parallel solid walls, gap
   **200–400** (≤400 guarantees wall-to-wall chains under the 427
   carry; ≥200 avoids the pinch), rising **400–1000** off the floor
   (2026-07-17 tuning; was 300–600), capped with a perch ledge (+28
   over the gap, top−4) and side ledges; mid-climb rest ledge when
   ≥560 tall. The chimney generalized, budgets ×1.6 since the tuning
   pass: standard ~2.5 per map, sky-heavy ~0.75, vertical ~4.7 with
   **≥3 mandatory** (reroll-enforced). A full-height **sky spire**
   variant overhangs the island band (see the tuning-pass section).
   `SHAFT_MAX` is now 400 (was an unmeasured 230).
2. **Sky-band wall fins** (`fin-<n>`, kind `wall`, 24×104–200) — hung
   beside archipelago islands (top 64px above the island, bottom
   hanging below it → one jump-latch from the island). Each gates a
   **fin perch** (`finperch-<n>`) 184px above the band: out of jump
   reach (>129), inside the kick envelope (120 ≤ 160). Wall-bounce
   chains extend INTO the sky — fins also bridge island gaps
   (kick carry 380 ≥ max island gap 256). High enough to never touch
   the floor-band sightline scan.
3. **Long diagonal chains** — 7–10 steps, rises 72–88, gaps 32–40
   (the earliest-crossing arc model gives gentle rises LESS gap:
   maxGapForRise(72) ≈ 44), spanning ≥(steps−1)×128px — Jake's "large
   ramps" in the rectangle grammar. Odds: standard 0.5, sky-heavy 0.3,
   vertical 0.9. Substitution-chain odds raised to 0.5/0.65.
4. **"vertical" profile** → `Shaft Dock #<seed>`: carved from the
   former standard band of `genProfileForSeed` (sky-heavy seeds
   UNCHANGED; ~23% of seeds; some ex-standard seeds reassigned —
   content-update precedent). Adds mandatory shafts, fins, near-always
   long ramp, and a zigzag tier stack above the nest (rise 104).

Reachability model: wall-kick edges jump-latch a wall near its top
(wall top within [t−160, t−24] of a reached surface, bottom ≤120 above
it, face ≤200 away) then kick within the 160/380 envelope. Sustained
pogo climbs are deliberately NOT modeled — a top gated behind a long
climb must qualify as a wall-gated perch (law 1) instead. The model
never over-claims.

Law notes: diagonal chains create sightlines that CROSS tier bands —
the horizontal-band sightline scan does not see them; acceptable for
now (diagonal sightlines are the tactical point), revisit if snipe
complaints emerge. Sky chains are validated with the same route-graph
reachability as everything else.

### 2026-07-17 tuning pass (Jake, verbatim: "58% less horizonals 60%
### more well places verticale structures expand make 2x" + mid-task
### "more verticle islands")

How the three dials mapped to budgets (`mapGen.ts`):

1. **"58% less horizonals"** → `HORIZ_KEEP = 0.42`. The budget
   horizontals — cover lips, T1/T2/T3 shelves, floaters, chain-fallback
   shelves — are collected instead of emitted (base-stream draws
   untouched, positions identical) and a deco cull pass keeps exactly
   `round(0.42·n)` of them. Diagonal-chain STEPS are ramp vocabulary,
   NOT horizontals — substitution odds unchanged. Nest, chimney
   ledges, shaft caps/sides/rests, islands and fin perches are
   structural, not budgeted. Measured: T1 shelves 4.5 → ≈1.9 per map.
2. **"60% more well places verticale structures"** → kick-shaft + fin
   budgets ×1.6 in EVERY profile (the chimney's base-stream odds are
   pinned by the RNG discipline, so its share of the "columns" dial
   rides on the shaft budget): shafts now rise 400–1000 (floor→mid-band
   connectors, mid-climb rest ledges when ≥560), plus a **SKY SPIRE** —
   a full-height (~1450px) shaft pair whose cap perch overhangs the
   island band 28px above it (floor→sky route by construction; placed
   island-adjacent, early attempts anchor the outermost island facing
   outward). "Well-placed" is enforced two ways: spires/shafts connect
   real bands by construction, and fins PREFER placements whose perch
   is not already inside an existing solid's kick envelope (novel
   route-graph edges over redundant ones; preference, not a budget
   killer). Fin sites are consumable (island, side) pairs, and a second
   fin pass anchors the deepest stack islands of the vertical field.
   Realized per map (400-seed probe): shaft pairs std 1.35→2.5,
   sky-heavy 0.5→0.75, vertical 2.5→4.7 (mandatory ≥3, cap 5); fins
   std 1.4→2.2, sky-heavy 2.5→4.3, vertical 2→2.9.
3. **"expand make 2x"** → 3000×1100 → **3000×2200** (double HEIGHT —
   interpreted as vertical expansion, coherent with dials 1–2; flag if
   full 2x was meant). Consequences handled deliberately: sky band
   moves to the new upper third (`yBand` 604–748, ≡4 mod 8 to match
   FLOOR_TOP's snap offset); entry ramps grow to 12–13 steps (~118px
   each); openness band recalibrated (law 4); new tall-only
   **upper-half reach** law (law 7); sightline law untouched
   (floor-band horizontal); spawns unchanged at ≥280px / 16 pads —
   the pad pool naturally includes mid-band and sky tops now.
4. **"more verticle islands"** (mid-task) → the **vertical island
   field**: stacked island columns (`skycol-<col>-<i>`) descend from
   band islands through the airspace toward the mid band, zigzagging
   at rise 104–128 with guaranteed x-overlap (rising gap 0 — always
   legal; downward is a plain fall), stopping above the tier stack.
   Budgets: sky-heavy 5–7 columns ×2–4 deep (~9.6 islands/map),
   vertical 4–6 ×2–4 (~9.6), standard 2–3 ×2–3 (~4.9). Band island
   targets also rose (std 3–5→4–6, vertical →6–8; sky-heavy 9–12
   unchanged) — islands are the anchoring substrate for fins and
   spires. Sky-heavy additionally CONTRACTS ≥8 band islands
   (reroll-enforced, like the vertical shaft contract).

Convergence after all four dials (probe, seeds 0–399): **0 invalid**,
median attempt 1, p95 ≈ 7, worst 17 of the 60-attempt budget. RNG
discipline: base stream untouched (pin test green — cover-column IDs
renumber because lips no longer tick the shared id counter inline, but
every x/size tuple is byte-identical); the deco stream is reshaped
wholesale by the dials, so every `gen:<seed>` map content-updates at
this landing — same-seed determinism holds absolutely from here on.

## Curated-map audit (same validator)

The validator also runs against every curated map in CI
(`mapGen.test.ts`). Current status: vessel-nexus fully reachable + 16
pads; boxworks-mini and skyseam fully reachable; tower audited under
the wall-gated perch law (2026-07-17): high-left/high-right are LAWFUL
perches (outer walls 78px away — climb-or-fall high ground), but
**crow-nest is a pinned FINDING** — no kickable wall inside the kick
envelope (mid-cover columns top out 446px below it; outer walls 578px
away laterally). Fix in the curated map when touched next: raise the
mid-cover columns or hang a ~24×200 fin (top ≤ y≈430) within ~380px of
the nest.
