# Slash-feel ledger — the 2×50 iteration loops' goal state

*Created 2026-07-24. This is the acceptance document for the Kindled and
Interstice melee-juice loops (50 iterations each, sequential, single-writer
on LightConstruct/meleeTiming/ConstructVfxController). Every iteration:
tape in the live-Phaser harness → frame-indexed critique against THIS
ledger + the research tuning table below → fix EVERYTHING listed, never
cherry-pick → re-tape. Jake's words are the ground truth; the channel
translations and numbers are proxies for them — when they conflict, his
words win.*

## Jake's direction (verbatim, 2026-07-24)

> kindlinded meety wieghty BIG crunchy attack, still smooth on retrig
> FEELs like it should and with insterstace HACKY AND FUCKEN SLASHHY AND
> STABBY MORE SO

> kindled also has a shield do not fort that like 1 out of 3 swings
> should be a shield bash

> or like think about the game play of it all rihgt

(Read: the ~1-in-3 bash is a sketch, not a spec — design the shield into
the melee GRAMMAR from gameplay first, then make it feel right.)

## Translation into feel channels (correct me if misread)

### Kindled — meaty · weighty · BIG · crunchy · smooth on retrig
- **Weight in the swing:** visible mass-gathering anticipation, heavy arc
  that reads as momentum (never floaty), pronounced follow-through.
- **BIG:** arc presence — wide smear, large blade body, the swing owns
  its screen space.
- **Crunch at contact:** the impact is one chord — strong hit-stop
  (bigger on kill), directional low-frequency camera punch, chunky debris,
  victim deformation, bass-forward contact layer. Contact must feel like
  something BROKE against something.
- **HARD CONSTRAINT — smooth on retrig:** crunchy ≠ clunky. A queued
  re-swing flows: follow-through blends into the next anticipation (no
  pose reset, no dead frames), input buffered so mashing never eats a
  swing, hit-stop never STACKS into sludge under rapid retriggers. The
  rhythm is heavy-but-liquid.
- **THE SHIELD IS IN THE CHAIN (gameplay-first, then feel):** Kindled
  fights sword AND slab — the shield must be part of the melee grammar,
  not a separate button's cosmetics. Jake's sketch: ~1 swing in 3 is a
  SHIELD BASH; his follow-up: design it from the gameplay. Iteration 1
  of the Kindled loop PROPOSES the design before touching feel.
  Candidates to weigh: (a) fixed cadence — swing·swing·BASH as the chain
  finisher; (b) contextual bash (held-direction / point-blank range
  gates it); (c) economy-coupled — bash spends/feeds Kindling, ties into
  Ward's block-to-power identity. DESIGN HOOK: the banked balance
  finding says perfectly-played melee LOSES the point-blank DPS trade —
  the bash is the natural answer if its payoff is CONTROL, not DPS
  (knockback/stagger that breaks the enemy's return fire), which also
  keeps it from power-creeping the damage table. Whatever wins: bash =
  the chain's blunt punctuation — slab leads, shortest reach, biggest
  knockback, deepest hit-stop, bass THUD vs the blade's shear, gold
  circuit-slab smear (chassis-axioms: gold is Kindled's earned color).
  Sim implications are real (chain-position state in the melee FSM, TS +
  Zig mirror + parity test — melee FSM lives on both sides since Z1a
  bridged its memory) — the loop owns that work, not just pixels.

### Interstice — hacky · slashy · STABBY · more so
- **Snap:** minimal windup, whip-crack active window, fast recovery, high
  cancel freedom — the hand is always ahead of the eye.
- **Hacky/slashy:** aggressive alternating arcs with sharp hard-edged
  smears; air-cut whoosh even on whiff; the combo reads as relentless
  cutting, not polite swings.
- **STABBY (new verb):** the grammar gains linear THRUSTS, not only arcs —
  quick forward dagger stabs in the chain (e.g. arc-arc-STAB cadence or
  momentum-gated stabs). "Stabby" is currently missing entirely from the
  arc-based system — this is an addition, not a retune.
- **Contact:** light-fast feedback — short hit-stop, high-frequency
  small-amplitude shake, sparks not chunks, kill-confirm still lands a
  real punctuation mark.

### FULL ANIMATION GAMUT (Jake, 2026-07-24: "not just the slash but the
### full suite and gammut of the antimation too")

The loops grade the WHOLE BODY, not blade VFX layered over a neutral rig.
Every iteration's critique walks the full animation suite per class
against the class fantasy (ProceduralPlayerRig is the instrument — its
spring chains, drunken-master lag, headbang machinery are the house
style; chassis-design-axioms.md is canon):

- **Idle / held:** weapons AT REST in the hands (held layer exists);
  Kindled = the grounded BRACED stance from kindled-v2.jpg (sword + slab
  held ready, weight planted — the long-gated braced-idle pose ships in
  this loop); Interstice = coiled, forward, blades low — "already moving".
- **Locomotion with weapons:** run/sprint carries the loadout — Kindled's
  mass reads in the gait (the 0.88 speed is real now, the body should
  own it); Interstice darts.
- **Swing = BODY-DRIVEN (the gated rig-anchored work ships in these
  loops):** arm winds up, torso coils, blade follows the HAND through the
  arc, chest/pelvis drive through contact, follow-through in the spine —
  never a crescent floating over a neutral body. Kindled: shoulder-and-
  hip heave. Interstice: wrist-led whip.
- **Bash:** a body CHECK — slab shoulder-leads, weight transfers through
  the front foot, recoil through the frame on contact.
- **Ward raise/hold:** braced set, knees bent, slab planted — an
  instrument being USED, not an icon displayed.
- **Dash/blink/ability casts:** class-charactered gestures (weight vs
  snap) per the verb-transfer matrix below.
- **Hurt/flinch/death:** the victim channel rows (R1 6-8) land ON the rig
  — directional flinch through the spring chain, squash in the body, not
  a sprite tint.

A perfect blade over a dead body is a FAILED iteration.

### Ability transfer (both classes)
Class abilities inherit their class's slash grammar — Kindled actives cast
with weight (anticipation + crunch), Interstice actives with snap (smear +
whip) — per the research verb-transfer matrix. A vanilla mouse-click cast
feel is the failure state.

## Shield-bash design decision (wave 1, 2026-07-24)

**DECIDED: candidate (a) — fixed cadence. Swing · swing · BASH, the chain's
blunt finisher.** Reasoning, gameplay-first per Jake's override:

- **Payoff is CONTROL, not DPS** (the banked balance hook): perfectly-played
  melee loses the point-blank DPS trade, so the third beat trades damage for
  the biggest knockback in the game + a brief stagger — the bash buys SPACE
  and breaks return fire without touching the damage table (bash damage 14,
  well under half an Edge hit's 32).
- **Why not contextual (b):** melee is already point-blank — a range gate
  inside melee range is illegible, and an auto-triggering bash removes
  authorship. A fixed chain position is plannable (hold the bash for the
  ledge; back off to reset the chain) and countable by the defender (the
  third beat is the shove — Ward/parry it), which makes it real grammar,
  not cosmetics.
- **Why not economy-coupled (c):** Kindling comes exclusively from Ward
  absorbing damage ("Defense IS the engine", classes-goal.md). A bash that
  FEEDS Kindling breaks that exclusivity; one that SPENDS it makes the
  shield verb unavailable exactly when a fresh melee engage needs it. The
  two economies stay uncoupled.
- **Chain rules (sim, TS + Zig mirrored):** chain position advances per
  STARTED swing (whiffs count — the cadence is rhythm, not hit-confirm);
  resets after 350ms of idle gap following recovery (aligned with the
  render combo window's 1000ms start-to-start against the 650ms cycle) and
  on death, so a cold engage always opens with blades and the bash is
  earned by sustained commitment. Buffered retrigs (R1 row 1) keep the
  chain alive by construction.
- **Bash numbers:** damage 14; knockback 760 px/s + 260 up (> dash-bash's
  660/240 — the game's biggest); shortest reach (62px vs Edge's 84) with a
  wider 100° slab arc (blunt, not edged); slab leads — contact gate 60ms
  into active vs Edge's 100ms; victim stagger 300ms at 0.55 speed
  (reusing slowedUntilTick — no new status system; Unbroken Seal's
  stronger 900ms/0.25 stagger takes precedence when both would apply, and
  Kindled Resolve's stagger resist softens either).
- **Events:** `slash-started` carries `verb: "bash"` on the third swing so
  the render leads with the slab from windup; a landed bash emits
  `bash-landed` (distinct from `slash-hit`) so the contact chord gets its
  own bass-THUD register.

## Cancel-window precedence decision (wave 2b, 2026-07-24 — R1 row 16)

**DECIDED: a QUEUED SWING WINS over a pending cancel.** Kindled dash/ward
may cancel the final 40% of Edge recovery (from 204ms/12t of the 340ms
in), but `bufferedMs > 0` suppresses the cancel entirely. Reasoning,
gameplay-first:

- **Row 1 is a promise.** "Mashing never eats a swing" is absolute — a
  buffered press that a simultaneous defensive flick could silently void
  would resurface the exact dropped-input feel the buffer was built to
  kill. The buffer holds only 100ms, so a queued press is always the
  player's MOST RECENT attack intent, not stale state.
- **No cycle-compression tech by construction.** If the cancel outranked
  the buffer, cancel→instantly-firing-buffered-swing would start the next
  swing up to 136ms early — a mandatory APM tech that compresses the
  650ms cycle, power-creeps melee DPS sideways, and makes the
  swing·swing·BASH beat uncountable for the defender. With swing-wins,
  the only way to swing is ON the rhythm; the bash stays parryable by
  count.
- **The cancel is an escape hatch, not a combo verb.** Dash/ward express
  "I'm done swinging"; a buffered press expresses "I'm still swinging."
  The FSM believes whichever intent is actually pending. Crucially the
  DASH ITSELF is never suppressed — movement is independent of the melee
  FSM; only the recovery-pose cancel is. A panicking masher keeps full
  dash mobility, they just carry the follow-through pose into the burst.
- **Triggers are rising edges landing inside the tail.** A dash begun
  earlier in recovery or a shield held since before the swing never
  cancels, and the ward must actually ENGAGE (a dead-battery press buys
  nothing) — the cancel rewards a deliberate defensive DECISION made in
  the tail, not held state.
- **A cancel still ADVANCES the chain.** The swing's beat happened;
  canceling its tail is not a chain reset (Dead Cells
  roll-doesn't-reset-combo [24][25]). Ward-cancel into Kindling absorb
  into the held bash beat is the intended defense-is-the-engine loop.

Sim implementation is TS + Zig mirrored (`KIN_CANCEL_TAIL_FRACTION`,
World.ts 1z3 cancel block ↔ world.zig stepMeleeSwing) with a
tick-identical parity gate (meleeSwingMemoryBridge gate E) + a
window-edge/precedence suite (cancelWindow.test.ts). **Parity bug found
by the gate:** the full-Zig path never had TS `resolvePlayerBuild`'s
baseline dash-charge floor (`max(dashCharges, 1)` — dash-bash is a core
move for everyone), so card-less players could never dash in
`step_world`: dash-bash, Razor Route, and this cancel were all silently
dead there. Fixed at the section-8 player-step read (world.zig), keeping
the raw fire-config bytes pure card resolution per
orchestratorAugmentParity's pinned contract.

## Research tuning table (R1, verbatim from the report)

*Source: `~/Documents/Slash_Feel_Research_20260724/research_report_20260724_slash_feel.md`
(10,927 words, 92 sources; [N] = that report's bibliography). The report's
R3 sequencing is BINDING: step 1 = melee input buffer, step 2 = Interstice
contact-frame alignment — BOTH before any hit-stop retune, because every
channel keys off the contact tick. R4 there defines the tape-verifiable
measurement contract the iteration critiques use. 1t = 16.67ms @60Hz.
"(est.)" rows are the report's marked estimates, not sourced numbers.*

| # | Channel | Current (repo) | Interstice target | Kindled target | Sources |
|---|---------|----------------|-------------------|----------------|---------|
| 1 | Melee input buffer | none found (slash edge consumed only in idle phase of swing FSM) | 100ms (6t) edge buffer: press during active/recovery queues, fires at phase 0 | same 100ms (6t) | SF6 4-8f [18]; Smash Ult 9f [11]; For Honor universal 100ms [52]; survey buffering norms [2] |
| 2 | Contact-frame alignment (render vs sim vs audio) | K aligned (300ms = 300ms); I misaligned: render contact ~40ms vs sim gate 82ms after edge (verify on tape) | render contact tick = sim contact tick ±1t; contact SFX ≤2t early, never >2t late; re-derive render sentence: 0.334 x sentence = 82ms → sentence ≈ 245ms, or re-author contact fraction to 0.68 of a 120ms sentence's cut | keep aligned (300ms/18t); same audio window | ITU 45ms lead/125ms lag [84]; contact-frame placement [80]; 1-2f early for perception [79]; sound coherence as top-3 feature [3] |
| 3 | Hit-stop on hit (render-only, pair-scoped) | 35ms (2.1t) both, world-scope tween hold | 50ms (3t) attacker+victim | 100ms (6t) attacker+victim | GGXrd 7f/10f [3]; Final Fight 6f [58]; GGST 11-15f [16]; norm 3-12f [71]; Sakurai damage scaling [4]; MH weight identity [50][51] |
| 4 | Hit-stop on kill | 80ms (4.8t) | 117ms (7t), victim rig holds 1.5x (175ms/10.5t) | 150ms (9t), victim holds 1.5x (225ms/13.5t); global cap 250ms (15t) | Smash cap 30f [8]; Melee electric victim-only 1.5x [8]; GGST CH 31f+35f slowdown [16]; Sakurai cap doctrine [4] |
| 5 | Hit-stop behavior during hold | static hold (tweens.timeScale) | victim vibrates ±1.5px horizontal (grounded) / vertical (air), decaying; attacker keeps ~10% drift; hitbox/hurtbox never move; 4t blend into damage pose | same, vibration ±2.5px | Sakurai 8 techniques [5]; Famitsu column [4]; Smash vibration [57] |
| 6 | Victim white-flash | none on player rigs (thrall 110ms; parry 240ms) | 33ms (2t) full white + 33ms (2t) decay, per hit | 50ms (3t) + 50ms (3t) decay; kill: 67ms (4t) then dissolve | Nijman 1-2f [2]; SNK 1f [67]; SFA3 1f [74]; most-pervasive highlight [3]; Feel defaults [65][66] |
| 7 | Victim reaction pose | none (knockback velocity only) | same-frame directional flinch, zero cross-fade, 4px offset along hit vector, ease-out 100-150ms | same, 7px offset, ease-out 150-200ms | Massoud zero-crossfade/directional [73]; OFDP instant switch [3]; Sakurai 4f damage-pose blend [4] |
| 8 | Victim squash (est.) | none | scale (1.25, 0.8) for 50ms (3t), spring back 100ms (6t) | scale (1.35, 0.7) for 67ms (4t), spring back 133ms (8t) | 12 principles squash-on-impact [68]; tutorial recipe 1.3/0.7 50ms [69]; volume preservation [68] |
| 9 | Screenshake (est. px; directional-first) | random-only Phaser shake: hit 80ms @0.008 (~10px), heavy 120ms @0.01, kill 180ms @0.012 | hit: 4px kick along hit vector + 2px noise, 80ms (5t), trauma-squared decay | hit: 8px kick + 4px noise, 120ms (7t); kill (both): 12px kick + 6px noise + ±1.5 deg roll, 180ms (11t) | directional > random [2][41][71][72]; trauma^2 + Perlin [62][63]; 2D translation+rotation [62]; GGXrd axis matching [3] |
| 10 | Attacker recoil/translation | kinetic chain forward drive (I 15px, K 9.5px chest-through) — keep | keep; add 2px camera-opposite kick on whiff (est.) | keep; ground-contact dust when arc ends low | GoW forward translation tenet [43]; HK strike recoil [30]; Vlambeer recoil [59][60] |
| 11 | Knockback (sim; balance-owned) | I 260px/s + 60 up; K 420px/s + 110 up | keep; visual decay must read as impulse-then-decay, control visibly returning | keep | Smash 0.03 launch / 0.051 per-frame decay [9]; hitstun 0.4x [10] |
| 12 | Smear / afterimage (est. counts) | I: instant-arc + streak cones, no tip ghosts; K: 9 tip ghosts | 4-6 tip ghosts, blade stretches ~1.3x along velocity in cut window; trail persists 150% of active window (~68ms) | keep 9-10 ghosts; trail persists 200% of active (~220ms); thicker core, mesh-deform read | Xrd every-frame keys + deform + scale smears [55]; smear frames [56]; trail outlives attack [72]; persistence readability [2] |
| 13 | Sound layer stack | canonical single cues (whoosh + contact exist; layering not verified in repo) | whoosh @cut start; contact layer (high-mid crack) @contact tick; whiff = whoosh only; 3rd-combo-hit adds sweetener | whoosh (lower pitch, longer) @cut start; contact = crack + low-mid thud + sub tail; kill layer @contact+0-50ms (both classes) | Song 3-component stack [72]; For Honor attacker/victim split [76]; MK1 category mixing [78]; 2-4 layers by frequency band [79]; low freq = weight [83]; Melee 2f precision [81] |
| 14 | Sound timing tolerance | unmeasured | fire on contact tick; ≤2t (33ms) early; >2t late = defect; never >6t | same | ITU 45/125ms asymmetry [84]; EBU +40/-60 [84]; 1-2f early guidance [79][80] |
| 15 | Combo window & climax | render 60t (1000ms), alternating dir, 3rd = both blades | keep 1000ms; 3rd hit: +1t hit-stop (67ms), flash tier up, sweetener layer | keep; K has no 3rd-climax — its every hit is the climax | Dead Cells 3rd-hit crit [22]; DC combo-continuation [24][25] |
| 16 | Cancel windows | none: recovery is a straitjacket | dash/roll may cancel recovery from 50% in (55ms/3.3t after active ends); attack may NOT cancel attack | dash/ward may cancel final 40% of recovery (from 204ms/12t in) | DC roll-doesn't-reset-combo [24][25]; Bayonetta dodge offset [48]; Motion Twin forgiveness thesis [26]; hitstop-as-cancel-window [57][18] |
| 17 | Kill-only channels | killFeel exists (flash + zoom-punch + bloom) | zoom stays kill/execute-exclusive; 1.03-1.06x punch (est.); debris persists (permanence) | same; K kill adds ground shock ring | zoom-as-kill-tell [3][66]; permanence [59][2]; kill-tier budgets (repo) |
| 18 | Debris directionality | hit VFX at site; no directional policy verified | tight directional spray continuing cut line (sharp-weapon read) | wider directional wedge + ground response | strike-vector debris [71]; BlazBlue sharp-vs-blunt patterns [3] |

## Iteration log

*(One line per iteration: N, class, what the critique flagged, what
changed, tape reference. Appended by the loop agents.)*

- **I13** · Interstice · **full-gamut re-verification pass (wave-3 item 3) — no regression from Kindled's later shared-rig fixes.** Re-taped the complete idle/locomotion/melee/hurt/hurt-kill filmstrip (`intersticeFeelShots.ts`, tag `wave3`) AND Kindled's own (`kindledFeelShots.ts`, tag `wave3`) against a clean dev-server harness, specifically checking whether K11 (ward-brace), K12 (whiff-kick + netcode sawtooth fix), or this wave's I11/I12 changes leaked across the files the two loops share (`ProceduralPlayerRig.ts`, `CameraJuice.ts`, `victimChannel.ts`). Zero page errors on either capture. Interstice: coiled idle still hunched-forward/knees-loaded/blades-low; melee contact frame (t≈0.334) still shows full horizontal blade extension with the tip-ghost fan and body driving through; hurt-kill still shows the full-silhouette white flash (K6's fix) + visible squash compression. Kindled: ward-brace still reads braced/knees-bent/slab-planted (not a decal); bash contact frame still shows the slab-led check with the sword yielded low-behind. Code-audit confirms `whiffKickParams` (`victimChannel.ts`) kept Interstice's 2px/70ms/zero-noise values exactly as K12 shipped them. The I12 pool changes below were also exercised continuously through four separate ~5min extended-session live tapes without any visual artifact on a single melee-kill screenshot.

- **I12** · Interstice · **extended-session pool-stress test (wave-3 item 2) — found and closed a REAL "ambient starves a kill-tier read" gap in the universal kill blast; the live-tape process itself then surfaced two further sizing bugs while chasing the fix, both closed.** New tooling: `scripts/intersticeExtendedSessionTape.ts` (fork of `intersticeLiveTape.ts` with the early-exit-after-1-kill removed so it actually stress-tests session length; own :8090, `boxworks-mini`, `WORLD_BOT_FLOOR=0 WORLD_BOTS=2`). **Root finding:** `RenderLayer.spawnExplosionBlast` — the ONE VFX every `player-killed` event in the game (both classes) depends on for "someone died here" (`SimEventRouter`'s `spawnBlastAtPlayer(..., 36, 50)`) — drew from the `blastCircle`/`spark` pools with ZERO reserve, the exact "ambient starves a kill-tier read" class K10 fixed for `bolt`, just never extended to these two (a kill's "big" path draws up to 10 blastCircle + 28 spark across two nested bloom+spark calls, `spawnExplosionBlastBig` being called from inside `spawnExplosionBlast` itself). Threaded a `tier: "ambient" | "kill"` param through `acquireBlastCircle`/`acquireSpark` (mirroring `acquireBolt`) and its full call chain (`SimEventRouter` → `OnlineMatchScene.spawnBlastAtPlayer` → `RenderLayer.spawnExplosionBlast`/`spawnExplosionBlastBig`/`spawnBloomLayers`/`spawnBlastSparks`). **Iteration 1** (flat reserve 10/16): live tape caught headless Playwright's SwiftShader renderer auto-detecting as `"potato"` quality tier (`qualityProfile.ts`'s `detectTier()`, which quarters pool sizes) — blastCircle's base-32 pool scales to just 8 there, so the flat 10 reserve EXCEEDED the entire potato pool, permanently starving ambient blasts on weak hardware instead of only under real pressure. **Iteration 2** (flat 4/12, safely under potato's floor): a SECOND, different bug — under sustained real combat on a busy, long-lived :8090 world (confirmed across two independent fresh-server ~5min runs, `wave3-stress3`/`wave3-stress4`, each with 20-40+ real kills), even a fixed small reserve gets exhausted by GENUINE concurrent kill-tier demand (multiple real kills landing close enough together to compete for the same tiny reserve) — a narrower failure than ambient starvation, but still a starved kill-tier read. **Also fixed alongside this:** `warnExhausted`'s once-per-pool-EVER suppression meant the near-instant, far-more-common ambient warning always fired first and permanently silenced any LATER, more alarming kill-tier exhaustion warning for that same pool; `warned` is now keyed `${name}:${tier}` so each fires independently — this is precisely how iteration 2's bug was even visible in the console (`"...on a KILL-TIER acquire — the reserve itself is empty, a real read was starved"`, distinct from the routine ambient line). **Iteration 3 (final):** replaced the flat reserves with a PROPORTION of the pool's actual scaled size, computed once at construction (`blastCircleKillReserve`/`sparkKillReserve` instance fields via a new `reserveFraction()` helper, mirroring how `scaled()` already scales pool SIZE) — this stays safely under the pool at every tier by construction while giving more absolute headroom on higher tiers. The two pools get DIFFERENT fractions, reasoned from their actual ambient-demand profile: blastCircle's only ambient consumer is the low-frequency explosion blast itself, so it reserves the MAJORITY (50%: standard/ultra 16, potato 4); spark is ALSO `StatusVfxController`'s high-frequency ambient DoT-tick pool, so it reserves less (30%: standard/ultra 38, potato 10) to avoid degrading that much busier path. Proof: 2 rewritten `ParticlePool.test.ts` kill-tier-reserve tests + 1 new independent-warning-key regression test + 1 new `RenderLayer.test.ts` test proving the tier threads all the way from `spawnExplosionBlast` down to the pool acquire calls — all deliberately drain-until-null rather than hardcoding the exact reserve size, so they stay valid across future retuning (60 total tests passing). **HONEST FINAL VERDICT:** the structural, PERMANENT guarantee this fix delivers — an ambient spawn can never be the one that starves a kill-tier read — is unit-proven and holds regardless of load (this is what the wave brief actually asked for: "no ambient spawn should ever be able to starve a kill-tier read"). It does NOT mean pool-exhaustion warnings vanish under adversarial load: `wave3-stress3`/`wave3-stress4` (fixed-reserve builds, aggressive 170ms-interval mashing matching K12's own established driving rhythm, sustained combat in a small 3-combatant arena) both still logged the reserve itself exhausting under back-to-back REAL kills. This residual — multiple genuine kills overlapping within one blast's ~300ms tween lifetime outrunning even a generous reserve — is the same bounded, already-accepted class of limitation as `BOLT_KILL_RESERVE`'s own "a future kill-debris upgrade has headroom" caveat and I5's own conclusion that past a certain point pool sizing is the quality dial, not an open bug; not chased with a 5th live-tape round given diminishing returns, per that same precedent.

- **I11** · Interstice · **pose-continuity CLOSED (wave-2's own open item — "idle→swing pose-continuity is UNVERIFIED, not confirmed clean") + new `__rigDebug` hand-position/stage exposure.** Built the instrumentation I10's own note asked for: `debugInfo()` (`ProceduralPlayerRig.ts`) now exposes `melee.stage` (anticipation/cut/followThrough/recovery, the same names `meleeStage()` uses) and `melee.handLead`/`handBack` (the live world-space hand positions `getHandWorld()` already tracked internally, now on the debug surface) — flows through to `RigDebugRow`/`__rigDebug()` via `OnlineMatchScene`'s existing pass-through, no wiring changes needed there. **The actual proof sidesteps both of I10's documented dead ends** (harness rigFrame() inits springs AT target = no real transition; live-tape video frames can't isolate a clean transition in continuous combat) with a third method: a new permanent bun test (`meleeRetrigContinuity.test.ts`, Phaser-free per house rule) drives the REAL production functions — `springState`/`springTo` (the actual per-frame spring integrator) and `meleeHandPose`/`meleeOffhandPose`/`meleeKineticChain` (the actual authored pose targets) — through one continuous idle→windup→active→recovery→idle cycle INCLUDING a retrig at t≈0.88 (`meleeTiming.ts`'s own documented worst-case legitimate retrig point), dir flipped per `ConstructVfxController`'s real alternating-combo rule. **VERDICT: no pop at either transition.** Baseline (the swing's own fastest legitimate per-frame motion, the cut-phase whip, untouched by retrig): lead 9.32px / back 2.55px per 16.67ms frame. Cold-start (idle→windup): NEVER exceeds baseline (0.94-1.00x across the first 3 frames, decaying to 0.36x by frame 5) — the anticipation-phase spring (10Hz/0.88 damping, already-shipped values) fully absorbs the idle-target→windup-target jump. Retrig (recovery→next windup, active/guard hand roles swapped): peaks at 1.20x baseline for 2-3 frames then decays below baseline by frame 4 — comfortably inside the 1.5x bound the test pins (the back hand's ratios look larger in relative terms, 1.3-1.89x, but its own baseline is tiny — 2.55px — so its absolute peak, 4.82px, stays well under the lead hand's own established 9-11px natural peak). Recovery settles cleanly to the idle target (within 1.5px, no residual wobble/double-bounce). Root cause of the clean result: the SAME anticipation-phase spring that handles cold-start also absorbs the retrig role-swap's target jump — I10's suspicion that the compress-the-lag spring design was "already-tuned, intentional" is now analytically proven, not assumed. Live corroboration: the `wave3` gamut re-tape (I13, above) shows idle/melee/hurt filmstrips reading exactly as I5-I10 documented, no visible pop on any frame.

- **I10** · Interstice · **full-gamut filmstrip pass (idle/run/melee sentence) + pose-snap check.** Harness strips (`i5base-*`/`i6-*`, port :5199 dev server): coiled idle reads hunched-forward/knees-loaded/blades-low; run carries a forward-leaning COM (comShift is raw-velocity-driven, so the 1.14 speed multiplier already "spends itself" through the shared formula with no class-specific code needed — verified, no change); melee sentence at t=0/0.15/0.334(contact)/0.42/0.62/0.8/0.99 all read clean — t=0.334 shows the blade at full horizontal extension with tip-ghosts fanning and the body driving through, no dead frames end-to-end. Checked "blade-low ready pose transitions cleanly into swing" (gamut row) via video-frame extraction (ffmpeg on the live-i4 tape at a slash-started epoch, ±100ms alignment per K10's own caveat): inconclusive on tape — my combat is point-blank/continuous flurries, no isolated clean idle→swing transition ever occurs in real play to sample, and the harness's independent per-call rig instantiation can't stand in as evidence (its "spring state" inits AT the target on frame 1, so two separately-scrubbed harness stills are not a valid before/after — a methodological dead end, noted so a future wave doesn't repeat it). Left AS-IS: the arm-position spring (10Hz/0.88damp during anticipation) plus the blade cone's deliberate "instant floor" head-start are BOTH already-tuned, intentional compress-the-lag design (I1/I2 comments cite Owlboy/Hollow Knight directly) — no evidence of an actual snap-read bug, just an unverifiable-on-tape question. WAVE-3 (render) note below.
- **I9** · Interstice · **retrig rhythm under real network latency, 3 independent tapes.** `intersticeLiveTape.ts` (new, mirrors kindledLiveTape.ts's K10 approach exactly: own :8090, `boxworks-mini`, `WORLD_BOT_FLOOR=0 WORLD_BOTS=2`, unique per-run playerId, blur-strip, raw event hook). `slash-started` inter-swing intervals across live-i2/i3/i4 (126/98/126 swings, ~100-240s sessions each): median 317-333ms, p10 243-259ms, min 178-208ms — consistently FASTER than Kindled's own K12-measured 643ms floor (expected: Interstice's true sim FSM cycle is 215ms vs Kindled's much longer one), and reproducible across all 3 independent runs (no session showed a stall, wedge, or sawtooth — kills/hits counted continuously with no multi-second freezes). Kindled's K6/K7 reconcile fix HOLDS at Interstice's faster cadence; no NEW latency-adjacent artifact found.
- **I8** · Interstice · **off-hand follow-through legibility (twin-blade fantasy).** Harness filmstrip critique (`i5base-melee-062.png`, t≈0.62 follow-through): the off-hand dagger fades to alpha 0.08 for the ENTIRE follow-through stage (93-196ms of every 245ms swing, ~40% of the sentence) — functionally invisible at gameplay scale, undercutting "twin daggers" for a class whose whole identity is two blades. FIXED (`LightConstruct.ts` `drawBladeSwing`'s `offFade`): floor 0.08→0.14 (cut-window target, follow-through plateau, and recovery-ramp start all updated together so there's no discontinuity at the stage boundaries) — only alpha changed, not the angle separation that already guards against the scissors-read (I-earlier's own documented fix). Re-taped (`i6-*`): off-hand reads as a dim-but-present blade through follow-through, no scissors-crossing regression. No unit test pinned this (private inline literal) — safe, visual-only tune.
- **I7** · Interstice · **on-camera melee-kill tape + victim-channel numeric confirmation, live.** Same `intersticeLiveTape.ts` run (item I9): 5-10 on-camera melee-chain kills per session across 3 runs (`live-i2/i3/i4-mykill-0N.png` + raw event detector: `player-killed.killerId===me` + same-batch `slash-hit.attackerId===me`). Screenshots read well at gameplay scale (visible white-flash pop, squash, blast/ring VFX on real kills — `live-i4-mykill-04.png` shows a clean double-kill with both victims' impact chords legible). Numeric trace (`__rigDebug().impact`, 270 victim-role interstice-chassis samples in live-i4 alone) CONFIRMS all R1 rows 3-8 at spec on REAL contacts: pair hold 50ms (hit) / 175.5ms (kill = 117×1.5) exactly; squash exactly (1.25, 0.8) during the hold, spring-back after; flashK ramps 1→0 over the coded 33+33ms window; flinch fires same-frame, directional, decaying. (A first-pass screenshot-based read of a non-flashing victim turned out to be a methodology dead end — 400ms polling can't catch a <70ms flash window, so "the flash looked head-only" in a couple of stills was mistimed capture, not a bug; the trace numbers are the ground truth here, matching Kindled's own K7/K8 lesson that live screenshots verify GROSS/persistent VFX, not sub-100ms amplitude.)
- **I6** · Interstice · **contact-clock (R1 row 2) measurement precision fix + verdict.** The obvious tape method — correlate raw sim events against the rAF trace by timestamp — doesn't work: the raw `onEvents` batch-hook wrapper spreads the sim event LAST, so the event's own `t` (its TYPE tag, e.g. `"slash-hit"`) clobbers the perf-now stamp, and the surviving `epoch`/Date.now() fallback is only good to ~100ms (K10's own finding) — useless against a ±16.67ms/1-tick contract. FIX: hook the `jakesjam:presentation-event` evidence bus instead (dispatched synchronously, in true per-event dispatch order, as the FIRST line of `SimEventRouter.dispatch()`, carrying a clean uncorrupted `atMs=performance.now()`) and read `__rigDebug()`'s melee clock at that exact same JS tick. **VERDICT:** analytically the authored render contact (0.15+(0.42-0.15)×0.68 = 0.3336 of BLADE_SWING_MS=245ms = 81.7ms) sits 0.3ms from the sim's 82ms gate — already unit-tested ±1t in `meleeStage.test.ts` (I1). Live tape (73 samples across live-i2/i3/i4) shows a bimodal spread (37-44ms cluster + 67-102ms cluster, gap in between) that cross-checks EXACTLY against the tape's own rAF frame interval (median ~39ms, i.e. the headless SwiftShader+video-recording context renders at ~25-26fps, not 60): the low cluster is one stale tape-render-frame below the high cluster, which itself sits within ~1 tick of 82ms. Conclusion: contact-frame alignment is analytically exact and unit-proven; the live tape corroborates within the tape environment's own known frame-rate ceiling (same TAPE-FIDELITY caveat class as K10's), no evidence of a live desync. `scripts/analyzeContactClock.ts` added as a reusable summarizer for future waves.
- **I5** · Interstice · **live-tape infrastructure (mirrors Kindled's K10) + pool-exhaustion fix.** `scripts/intersticeLiveTape.ts`: own :8090 server, `WORLD_MAP=boxworks-mini WORLD_BOT_FLOOR=0 WORLD_BOTS=2` (K10's own map-floor lesson), sprinter/Interstice chassis, unique per-run playerId, blur-strip, on-camera melee-chain-kill detector. First live run's console sentinel caught bolt/spark/blastCircle/ring/shard ALL exhausted mid-brawl even AFTER K10's own +50% Kindled-era bump — confirms the wave-2 brief's prediction that Interstice's faster real contact density (sustained multi-round play, up to 10 kills/~50+ hits per ~4min session) stresses the SAME shared pools harder than Kindled's slower cadence did, and surfaces a pool never seen exhausted on the Kindled tape (`shard`). FIXED (`ParticlePool.ts`): spark 96→128, shard 32→48, ring 24→32, bolt 16→24, blastCircle 24→32 (+2 `ParticlePool.test.ts` reserve-math updates for the new bolt total). Re-taped: STILL saw occasional exhaustion under a full 240s/multi-round session — traced this to organic load (verified no leak: every `pool.acquire*` in `LightConstruct.ts` is release-paired 20/20; `ProjectileVfx.ts`'s apparent 15-acquire/2-release imbalance is a false alarm, all routed through a private `tweenRelease()` helper), not a bug — a fixed pool WILL eventually trip its once-per-pool warn flag given enough sustained multi-class combat density, by design ("a smaller pool IS the particle-count dial"). Left at the new sizes rather than chasing further; noted as an open item below.
- **K12** · Kindled · **WHIFF FEEL (R1 row 10) + retrig rhythm verified under real latency + tape-harness truthing.** (a) WHIFF KICK: `whiffKickParams` (victimChannel.ts — Kindled 3px/100ms, Interstice 2px/70ms, ZERO noise; far under the row-9 contact kick: a whiff is weight, not violence) + a router whiff watch: the LOCAL player's slash-started arms a deadline at the SIM's own contact gate (Edge 300ms / bash 260ms / Interstice 82ms) + 100ms snapshot slack; any same-swing contact (slash-hit, bash-landed, or a melee parry — a parried blade STOPPED on something) disarms; deadline passing in silence = the swing hit AIR → the camera kicks OPPOSITE the swing aim (a kick INTO the swing would read as contact, exactly the lie a whiff must not tell). Generation-counter guarded — a retrig supersedes, sustained mashing can never stack kicks. New optional `resolveAimDir` router dep off the live render state; 6 router contract tests. Kindled's K1 low-exit ground dust remains the row's other half. (b) RETRIG RHYTHM (K10c tape, 87 live swings under the driver's sustained 170ms mash): swing-start intervals mean 730ms / sd 62ms / MIN 643ms against the 683ms cycle (spread = snapshot arrival jitter; K5 already proved exact 41-tick server spacing) — the row-1 buffer never double-fires and never eats a swing, and the verb string is an unbroken swing·swing·BASH grammar with exactly one legitimate 350ms-gap chain reset. Smooth-on-retrig CONFIRMED under real latency on the fixed reconcile. (c) TAPE HARNESS truthing: unique per-run playerId (a reused id inside the server's reconnect grace AUTO-enters the arena, and the tape's forced venue-admitted then RESTARTS the live scene into a wedge — the three consecutive "arena handoff never happened" failures); joinArena now tolerates the already-in-arena path; the K10 quality-tier pin is now OPT-IN via QUALITY_TIER (K10d taught the correction: pinning "standard" inside a SwiftShader+screencast context starves the whole sim loop — 26 probe cycles in 300s, a fictional tape; unpinned potato is the CONSERVATIVE under-read, and Jake's own desktop clips are the true standard-tier footage source).
- **K11** · Kindled · **WARD-RAISE BODY BRACE (gamut row "Ward raise/hold") — the last never-built gamut row.** Critique: holding Shield only drew the circuit-slab VFX at the off-hand (`drawWardSlab` frame-diffing `shieldActive`) — the BODY never changed: upright neutral idle behind a plate decal, the exact "instrument being USED, not an icon displayed" failure the gamut names, and the only suite row with zero rig read. BUILT: `wardBracePose` (meleeTiming.ts, pure/tested — 8 tests): slab hand punches forward-square along aim at chest height (reach 21→34px, 0.08 high-bias guarding the chest/visor line; drawWardSlab anchors at this same back hand so the plate PLANTS between fighter and threat), sword pulls to the low-rear guard ON the bash's own chamber line (asserted within 0.15rad/4px of `bashSwordHandPose(0.35)` — ward→bash reads as the stance exploding, no pose reset), knees bend 7px with the meleeGroundLoad falloff shape (0.82 chest/0.68 head — a squat-set, not an elevator drop), feet plant ±6px (wider than braced idle's ±3.5), COM leans 4px INTO the shield. Rig carries a smoothed `wardBraceK` clock (60ms raise / 110ms drop taus — the plate SETS then relaxes), gated off whenever another sentence owns the body (swing/bash/ability/dash/wall/victory/airborne). Plumbing: `pose.shieldHeld` (additive) threaded from `player.shieldActive` in BOTH scenes; harness gains the "ward" stance action (+ its slab draw at the braced hand) and kindledFeelShots tapes it. Strips (`iter11-*`): ward reads braced/low/planted vs idle's upright hover; hurt-kill chord + melee/bash/idle/run unregressed (every K11 delta gates on `wardBraceK`, which only `shieldHeld` raises).
- **K10** · Kindled · **ON-CAMERA MELEE-KILL TAPE (the wave-2b blocker) + rows 17/18 ROOT CAUSE FOUND AND FIXED.** Sidestepped the pursuit-pathing problem entirely: own :8090 server pinned `WORLD_MAP=boxworks-mini` (flat 1280×640 brawl cell — pursuit needs no pathing; sub-finding: the elastic `WORLD_BOT_FLOOR` area-scales to ZERO bots on the mini map, so use `WORLD_BOT_FLOOR=0 WORLD_BOTS=2`). Tape upgraded (kindledLiveTape.ts): raw events carry `epoch` (wall-clock → video-frame alignment ±100ms), live detector for the exact target condition (player-killed `killerId`=me + same-batch slash-hit/bash-landed `attackerId`=me — precisely the shock-ring gate), exit requires ≥1 such kill. Result: 5 on-camera melee-chain kills across `live-k10`/`live-k10c` (camera follows the local player — in frame by construction). **Rows 3-8 kill chord CONFIRMED live on the full pipeline:** victim chords sample elapsedMs 0→300+ across ~26 rendered frames — hold exactly 225ms, flashK 1.00 through ~66ms, squash exactly (1.35, 0.70), flinch directional per kill (−10.3/+7.6/−12px); attacker kill-hold ticks 150→13ms; the white/squashed corpse VISIBLE across the kill frames (K7's render-through-chord fix proven on camera at last). **ROWS 17/18 ROOT CAUSE: ParticlePool starvation, not amplitude.** The bolt pool was 4 Graphics shared by 15 melee-era spawn sites at 300-500ms lifetimes — a console sentinel added to the tape caught bolt+spark+blastCircle+ring+glow ALL exhausted mid-brawl, and the shock ring (spawned LAST in the event pass) lost the pool lottery on every real kill — which is why it read in harness strips (empty pool) yet had never rendered a live frame. FIXED: bolt 4→16, spark 64→96, ring 16→24, blastCircle 16→24, plus `acquireBolt("kill")` — ambient acquires may not touch the last 2 bolts, kill-tier spawns may (kill permanence must never lose to ambient dust/ward chatter); spawnKillShockRing takes the reserve; +2 pool contract tests pin it. POST-FIX TAPE (`live-k10c` kill 1, frame-indexed): broken-plate ring + directional chip debris READ on real footage — chips clearly continue the cut line through ~+250ms, feet-region luminance holds ~+45% over the quiet floor with peak-white chips (YMAX 234/255) through +165ms; the first ~100ms belongs to the blast+smear, the ring speaks in the 100-250ms window — the intended "energy travels the floor AFTER the hit" sequencing. NETCODE CHECK (wave-3 priority 3): server-log drops sit 1-3 ticks past the window edge, brief + self-healing — wave 2b's reconcile fix HOLDS, no regression. TAPE-FIDELITY: `jj_quality_tier` pinned "standard" in the tape (a headless probe can land potato → quartered pools + baked rigs + 0.75 renderScale — the tape must grade what Jake's desktop actually renders).
- **K9** · Kindled · full-gamut filmstrip pass + rows 17/18 amplitude retune. Gamut strips (`k8-melee/bash/idle/run/hurt*`): braced idle, mass-carrying run, high-chamber windup → wide gold cut → low follow-through + exit dust, slab-led bash check, and the new hurt chords all read; NO regressions from the full-silhouette flash change (resting frames identical). New harness commands `debris-edge`/`debris-bash`/`kill-ring` stage the row 17/18 primitives directly — first strips showed both DYING before they spoke: the (1-t)² fade killed the debris at half-flight (the directional read is the whole point of row 18) and the shock ring's hairline strokes never slammed. RETUNED from the strips: debris — linear chip fade, chips 3.2/4.6px (was 2.6/3.8), edge travel 92px, glow fill 0.75, only the cut-streak keeps the sharp decay; ring — linear fade, glow 9px/core 3px strokes, white-hot front pass for the first 40%, radius to 14+74t. Post-retune strips: broken-plate ground ellipse + chips clearly structured at 30/120/260ms. RESIDUAL: absolute brightness in headless captures under-reads ADD-blend layers (K3's known artifact) — final row 17/18 brightness call needs a live on-camera melee kill, which needs the pursuit fix (see K8's next-wave note).
- **K8** · Kindled · verification tape (`live-k8`) + harness closure. Netcode: the K7 tightening collapsed the wedge sawtooth from +240 to +31 ticks (one past the window edge — drops now brief and self-healing; a live browser without headless main-thread stalls should sit inside the window). Tape limitation surfaced honestly: every melee contact this run was bot-vs-bot AND off-camera (`live-k8-raw.json`: zero contacts involving me — the pursuit driver can't navigate the vault map's platforms to reach the bot brawl; K5's contact tapes ran flatter ground), and off-screen culled rigs freeze mid-chord, so the rAF trace shows only zombie chords. So the amplitude verification moved to the DETERMINISTIC harness: new `hurt`/`hurt-kill` rig-review actions drive `applyPairImpact` exactly as the router does (closes K2's "harness can't stage victim interaction" limitation, permanently). Filmstrips (`k8-hurt-*`, `k8-hurt-kill-*`): t=0 the ENTIRE silhouette is white (casing included — the K6 fix renders), still white at 49ms, decayed by 98ms (hit tier); kill tier holds white deeper into the chord with the 1.35/0.7 squash visibly compressing the body. NEXT-WAVE pursuit fix needed for a true on-camera netplay contact tape: driver needs drop-through/pathing, or stage the tape on a flat map rotation.
- **K7** · Kindled · verification tape (`live-k7`, own :8090 server: 37 hits / 3 bashes / 14 kills, 4667 rAF samples) after K6's fixes: flinch lands 12.0px exactly on the live shove vector; **R1 row 4 wiring CONFIRMED live for the first time** — victim kill holds sample at exactly 225ms (K) / 175.5ms (I). TWO deeper finds. (a) The input-wedge is SELF-AMPLIFYING: with acks frozen, every reconcile replays authTick + a queue growing ~3/snapshot, so the predicted tick advances ~2x real time (taped: 117 input ticks per 60 server ticks) — the K6 resync fired only at queue cap 240, leaving a 4s sawtooth; tightened to 60 (1s of unacked = server processing none of it) + accumulator zeroed on rebase. (b) **ROW-4 KILLER FINDING: `updatePlayerRig` hid the rig the instant `alive` flipped false — the victim-side kill chord (225ms hold + 67ms full-white + squash) had NEVER rendered a live frame** (every killed victim's rig sat frozen at elapsedMs=0 in the trace); at 12fps that IS Jake's "victim present one frame, gone the next". FIXED: a rig still speaking its impact chord renders through it (the white, vibrating, squashed corpse IS the kill presentation; hides the frame the chord ends; non-melee deaths hide instantly as before). Attacker-side gamut spot-check on stills: chambered gold Edge mid-swing, slab plate, planted front foot all read at viewport scale.
- **K6** · Kindled · **first REAL-VIEWPORT critique** (Jake's own clip `54d20118` frames 48-58 + own baseline tape `live-k6`): B1 (row 6, CRITICAL) victim flash INVISIBLE at gameplay zoom — root cause in code, not amplitude: the rig's dark casing (limb outlines at `outerW+3.5`, hood, torso outline, boots — the MAJORITY of a ~45px fighter's pixels) never flashed, swallowing the white inner strokes; B2 (row 6) the hit-confirmed radial blast orb (r=22) centered on the victim OCCLUDED the body flash for exactly its in-window; B3 (row 7) flinch 7px under the motion floor (it is the only body translation during the frozen hold). FIXED ALL: full-silhouette flash (mutable `outlineDark`/`outlineDark2` mixed toward white on the same flash clock — SNK/SFA3 full-silhouette discipline); melee pair chords skip the orb entirely (ranged unchanged; both pinned in the router contract tests); Kindled flinch 7→12px. Rows 17+18 BUILT the same pass: `spawnKillShockRing` (flattened broken-plate gold ground ellipse + ground chips at the victim's feet — instrument-not-icon, segments never a closed halo; gated to REAL melee-chain kills by requiring the killing blow's own slash-hit/bash-landed in the same events batch, so universal dash-bash kills don't borrow it) and `spawnMeleeDebris` (Edge = tight ±14° chip spray CONTINUING the cut line + a through-streak at the contact point; bash = wider ±39° slower chunkier wedge; both strictly along the sim's own dirX/dirY shove vector, faceted crystal chips, pooled single-graphics redraw). TAPE BLOCKER FOUND AND FIXED (commit be4341d): K5's netcode fix was insufficient — offset sat at 236-239 ticks for 3+ minutes = exactly PENDING_INPUTS_MAX_DEPTH; with acks frozen the reconcile replays the whole queue every snapshot, re-pinning predicted tick at authTick+240, so the slew NEVER wins; wedge resync drops a still-saturated-after-ack-drop queue and rebases onto the authoritative snapshot.
- **K5** · Kindled · **FIRST LIVE TAPE of the victim channel** (wave-2 priority 1): own worktree server :8090 (never :8088), real world join as Kindled vs GEO+KIN bots, driven via `scripts/kindledLiveTape.ts` (rebuilt around `__setBotInput` + a new in-page rAF sampler over `__rigDebug().impact` — victim-channel state now on the debug surface via `rig.debugInfo().impact`/`RigDebugRow.impact`; capture discipline: numbers over pixels for the sub-100ms windows, 25fps video + contact stills for amplitude). **Blockers found and fixed to even get a tape:** (a) headless Phaser BLUR stops the client sim loop with no FOCUS ever coming — zero inputs sent, player wedged at spawn (tape strips the blur seam; flagged for showcase kiosks); (b) REAL NETCODE BUG: `matchHost.applyInput` dropped out-of-window inputs BEFORE `tickSlew.recordInput`, so a client past +30 ticks got zero slew samples → zero hints → PERMANENTLY wedged, standing at spawn while liveness kept refreshing (this is almost certainly the showcase "player stationary >1s" bug) — fixed: sample-before-reject + a recovery-mode slew clamp (1ms → 3ms/snapshot past 10 ticks mean error, matching the client's own drain cap); (c) pursuit driver needed jump (botDriver `hopWhenStuck`) and a melee-class bot to actually reach contact. **Tape findings (8 contact chords, 198 rAF samples, `live9-*` in kindled-feel/):** rows 3/5/6/7/8 CONFIRMED live at spec — pair hold exactly 100ms both roles (world clock untouched), flash hits 1.00 full-white and reads clearly on a purple victim at game scale, squash lands exactly (1.35, 0.70), flinch rides the real shove vector (dirX −0.79..1 across chords) and is what moves the body during the freeze (knockback is zeroed by the hold — the flinch IS the freeze-window motion, keep 7px); bash cadence verified live (slash-started ticks 6121/6162/6203-bash/6244/6285/6326-bash — swing·swing·BASH at 41-tick intervals, buffered retrigs, zero dead frames); bash contact chord on video frames 48-51: slab-led check, victim white-mix + hold 2-3 frames, gold seal-burst + ground ring persisting ~150ms (row 12 afterglow CONFIRMED live at the contact site), 760/260 launch dominates the aftermath. **Retune from tape:** vibration ±2.5 → ±3.5px (Kindled only) — the hold read as a static freeze; the buzz was sub-legible at ~0.9 world→screen arena zoom while every other channel read at spec. **Still open:** row 4 kill-tier hold never sampled live (my 6 deaths were 5 projectile + 1 dash-bash `cause:"bash"` — correctly NOT pair-scoped; unit tests still pin 150/225); rows 17 (no kill shock ring exists — confirmed absent on tape) and 18 (bash contact burst is radial orb + ring, NO directional wedge continuing the shove — confirmed gap on frame 49-51). "14 HEADSHOT" near bash contacts investigated: spark's projectiles headshotting ME (14.4 dmg, sourceProjectileId set) — not a melee-label bug.
- **K4** · Kindled · full-gamut verification re-tape (`iter4-*`, 13-frame melee + 13-frame bash + idle/run) after K2's rig-internal changes (mutable colors, squash-in-the-body, pair-freeze plumbing): no regressions — braced idle intact, bash contact frame (t=0.46) reads slab-first with the sword visibly yielding, bash recovery settles clean, run carries the loadout. WAVE-1 CLOSE. Remaining for wave 2 (Kindled side): LIVE-TAPE the victim channel end-to-end in a real match (rows 3-8 numbers are implemented+unit-proven but never seen on a real victim; retune amplitudes there, not in the harness); rows 13/14 (audio layer split — blocked on canonical recordings, no-synthesis rule); row 16 cancel windows (sim+Zig, untouched); row 17's K-kill ground shock ring; bash plate scale check at real gameplay zoom; Interstice contact alignment (R3 step 2) is the OTHER loop's binding first step.
- **K3** · Kindled · critique: R1 row 9 untouched (shake still random-only Phaser trauma — the FIRST displaced frame carried no hit direction); K1's controller-path claims (ground dust, trail afterglow, bash plate via the live swing loop) untaped. FIXED: directional camera kick — `CameraJuice.directionalKick` rides ActionCamera.sideSwipe (spring impulse ALONG the hit vector, out 35%/back 65% of the row-9 window) + trauma as the NOISE layer only; params in `cameraKickParams` (K hit 8px/4px/120ms, I 4px/2px/80ms, kill 12px/6px/180ms; roll deliberately omitted — Jake's standing "don't roll the camera"); wired slash-hit/bash-landed/melee-kill for the local pair via a new optional router dep. Harness gains controller-path `bash-swing`/`edge-low` commands. TAPE (`iter3-*`): bash plate + chambered sword + front-foot stomp dust CONFIRMED via the live controller loop; low-exit ground dust CONFIRMED (`iter3-lowdust`); trail afterglow's 112ms tail is SHORTER than headless screenshot latency — inconclusive on tape, code-path verified, LIVE-TAPE. Known artifact noted: ADD-blend glow-filtered layers read dim in headless captures (trust __debugState/live over pixels). Tests: +2 router kick contracts, +1 kick-params rows.
- **K2** · Kindled (channel SHARED w/ Interstice wave) · critique: R1 rows 3-8 entirely missing — hit-stop was a WORLD tween hold (35ms, wrong scope, wrong size), zero victim flash/flinch-direction/squash/vibration, kill hold world-scoped, bash cue phased against the generic hit cue. BUILT the victim channel as a pure Phaser-free planner (`victimChannel.ts`: chassis-parameterized R1 numbers, instant-on flash, ease-out flinch, spring-back squash w/ overshoot, decaying vibration, capped pair holds) + rig application (`applyPairImpact`: attacker 10% drift, victim freeze+vibrate; flash mixes EVERY body color toward white; squash compresses body heights + widens hips/shoulders through the spring chains — ON the rig, not a tint; flinch reuses the offset machinery, now directional/parameterized) + router rewiring (slash-hit/bash-landed own the pair chord off the new event `dirX/dirY` shove vector; paired hit-confirmed skips world stop/random flinch/duplicated cue; melee player-killed upgrades to kill tier w/ victim 1.5x hold, world kill stop skipped for the pair, zoom still kill-exclusive). NEVER-STACK enforced (`max(remaining, fresh)`, 250ms cap). Proof: 12 planner tests + 5 router pair-scope contract tests (rows 3/4/5 scope + audio-phasing + kill tier). HARNESS CAN'T STAGE victim interaction — flash/flinch/squash/vibration marked for LIVE-TAPE; rows 3-8 now implemented-not-yet-taped.
- **K1** · Kindled · baseline tape (13-frame rig filmstrip, `scripts/kindledFeelShots.ts`, tag `base`): B1 no braced idle exists; B2 slab floats over the FACE from load through follow (instrument-vs-icon fail); B3 no pelvis-drive read in silhouette at cut; B4 slab detached from any arm in follow; B5 zero ground response on the low-ending arc (R1 r10); B6 windup mass gathers UP not INTO the body; B7 bash renders as a sword swing (no verb dispatch); B8 no idle/run stance reviews possible in harness; B9 trail dies with the sentence (R1 r12 wants 200% persistence). FIXED ALL: braced idle + planted wide stance (rig `kindledBraceMix`, kindled-v2 grammar) + harness idle/run stance reviews with held weapons; slab brace re-angled low-forward + hard below-shoulder clamp (swing + idle); deeper kindled ground-load (14→17, bash 19); bash fully rendered — `drawKindledBash` slab-led plate w/ drag-ghost smear + speed lines + Ward circuit grammar, rig body-CHECK (`bashKineticChain`/`bashHandPose`/`bashSwordHandPose`, ease-out punch pinned to the sim's 260ms gate, `KINDLED_BASH_CONTACT_T` ±1t proof in `meleeBashPose.test.ts`); ground dust one-shot per swing (blade low-exit + bash stomp + bash-landed victim-feet kick, `spawnGroundDust`, pool-safe); kindled trail afterglow outlives the sentence to t=1.2 (`drawKindledTrailOnly`); bash contact read (seal-burst + dust) on `bash-landed`. Tape: `kindled-feel/iter1-*` (bash chamber/check/idle/run all read on tape). LIVE-TAPE TODO: trail afterglow + ground dust are controller-path (rigReview can't show them); victim channels untouched this iteration.

## Wave-3 queue (Interstice wave 2, 2026-07-24) — RESOLVED by wave 3 (I11-I13)

**No sim changes required this wave** — every fix landed (I5-I10) was render-only
(`ParticlePool.ts` sizing, `LightConstruct.ts` off-hand alpha), consistent with
the wave-2 scope fence. Open items for a future RENDER wave (not sim):

- **Pool sizing under extended multi-round sessions.** Even after I5's bump
  (spark 96→128, shard 32→48, ring 24→32, bolt 16→24, blastCircle 24→32), a
  full ~240s/multi-round live session still tripped the once-per-pool
  exhaustion warning on all five. Confirmed NOT a leak (every acquire in
  `LightConstruct.ts` is release-paired 20/20; `ProjectileVfx.ts` routes
  through a private `tweenRelease()` helper). This looks like organic,
  session-length-proportional load from dense multi-class combat (shared
  pools serve ranged + melee VFX for every player in the match) rather than
  something a single sizing pass fixes — a future wave could investigate
  either a smarter reclaim policy (e.g. a soft LRU/force-release-oldest on
  ambient-tier exhaustion instead of skip-the-spawn) or accept the current
  budgets as the quality dial and move on.
  **RESOLVED (I12):** the actual load-bearing gap wasn't these five pools'
  raw SIZE, it was that the universal `player-killed` blast (`blastCircle`/
  `spark`, via `RenderLayer.spawnExplosionBlast`) had ZERO kill-tier reserve
  at all — the one true "ambient can starve a kill read" bug in this list.
  Fixed with a proportional (scaled-pool-percentage) reserve; ambient
  exhaustion on the OTHER pools (shard/ring/glow, and blastCircle/spark
  under extreme concurrent-kill load) remains the accepted quality dial
  this bullet already named — not revisited further, per its own
  conclusion.
- **Idle→swing pose-continuity ("no pose-snap") is UNVERIFIED, not confirmed
  clean.** I10 tried two methods and both were inconclusive: (a) comparing
  two independently-scrubbed harness stills is invalid (each harness
  `rigFrame()` call inits its arm springs AT the target, so there's no real
  transition to observe); (b) extracting live-tape video frames around a
  `slash-started` epoch (±100ms alignment) never caught a clean isolated
  transition because real combat is point-blank/continuous. A future wave
  wanting a real answer should either expose the rig's live hand-target
  positions on `__rigDebug()` (mirroring how I4 exposed the melee-sentence
  clock) so a rAF trace can be sampled around a real swing-start, or add a
  driver mode that isolates single swings with real idle gaps between them.
  **RESOLVED (I11):** exposed exactly the `__rigDebug()` hand-position
  fields this bullet asked for, but the actual proof came from a THIRD
  method (a permanent bun test driving the real spring + pose functions
  through a full idle→windup→retrig→idle cycle) that sidesteps both dead
  ends above — verdict CLEAN, no pose-snap at either transition.
- **Bimodal contact-clock read in the headless tape (I6) is a tape-fidelity
  artifact, not a bug** (cross-verified against the tape's own ~26fps rAF
  interval) — noted here only so a future wave doesn't re-litigate it: the
  fix, if one is ever wanted, is a real desktop-browser capture at 60Hz+,
  not more headless tuning. (Untouched this wave — out of scope for I11/I12.)

## Interstice loop — render-side work COMPLETE (wave 3, 2026-07-24)

Mirroring Kindled's own render-side close-out (K12): every render-side item
the slash-feel-ledger tracked for Interstice is now built, tape-verified, and
unit-tested — I1-I3 (contact-frame alignment + hacky/slashy pass), I4 (melee
clock exposure), I5 (pool sizing v1 + live-tape infra), I6 (contact-clock
analytic proof), I7 (kill-tier victim-channel confirmation), I8 (off-hand
legibility), I9 (retrig rhythm under real latency), I10 (full-gamut pass +
pose-continuity flagged open), I11 (pose-continuity closed), I12 (universal
kill-blast pool reserve), I13 (full-gamut re-verification, no shared-rig
regression). The FULL ANIMATION GAMUT checklist (idle/locomotion/melee/
hurt/hurt-kill) reads clean on both classes sharing the rig substrate.

**The only work remaining for either class loop is:**
1. **The STAB verb** (Interstice's queued new melee thrust attack) — a real
   sim addition, gated on Z1c fully clearing `sim/src/**`/`client/src/sim/**`
   (six-axes payloads, team peel, dash i-frames, ward mitigation). Wave 4.
2. **Audio wiring** (R1 rows 13/14, the layered whoosh/contact/kill sound
   stack for both classes) — blocked on Jake's picks; no-synthesis rule
   means this cannot proceed without his canonical recordings.

No further render-only iteration is queued against either rig unless a
regression surfaces (e.g. from the STAB verb's own render half, once wave 4
starts) or Jake's own playtest flags something this ledger's tooling missed.
