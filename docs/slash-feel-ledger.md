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

- **K3** · Kindled · critique: R1 row 9 untouched (shake still random-only Phaser trauma — the FIRST displaced frame carried no hit direction); K1's controller-path claims (ground dust, trail afterglow, bash plate via the live swing loop) untaped. FIXED: directional camera kick — `CameraJuice.directionalKick` rides ActionCamera.sideSwipe (spring impulse ALONG the hit vector, out 35%/back 65% of the row-9 window) + trauma as the NOISE layer only; params in `cameraKickParams` (K hit 8px/4px/120ms, I 4px/2px/80ms, kill 12px/6px/180ms; roll deliberately omitted — Jake's standing "don't roll the camera"); wired slash-hit/bash-landed/melee-kill for the local pair via a new optional router dep. Harness gains controller-path `bash-swing`/`edge-low` commands. TAPE (`iter3-*`): bash plate + chambered sword + front-foot stomp dust CONFIRMED via the live controller loop; low-exit ground dust CONFIRMED (`iter3-lowdust`); trail afterglow's 112ms tail is SHORTER than headless screenshot latency — inconclusive on tape, code-path verified, LIVE-TAPE. Known artifact noted: ADD-blend glow-filtered layers read dim in headless captures (trust __debugState/live over pixels). Tests: +2 router kick contracts, +1 kick-params rows.
- **K2** · Kindled (channel SHARED w/ Interstice wave) · critique: R1 rows 3-8 entirely missing — hit-stop was a WORLD tween hold (35ms, wrong scope, wrong size), zero victim flash/flinch-direction/squash/vibration, kill hold world-scoped, bash cue phased against the generic hit cue. BUILT the victim channel as a pure Phaser-free planner (`victimChannel.ts`: chassis-parameterized R1 numbers, instant-on flash, ease-out flinch, spring-back squash w/ overshoot, decaying vibration, capped pair holds) + rig application (`applyPairImpact`: attacker 10% drift, victim freeze+vibrate; flash mixes EVERY body color toward white; squash compresses body heights + widens hips/shoulders through the spring chains — ON the rig, not a tint; flinch reuses the offset machinery, now directional/parameterized) + router rewiring (slash-hit/bash-landed own the pair chord off the new event `dirX/dirY` shove vector; paired hit-confirmed skips world stop/random flinch/duplicated cue; melee player-killed upgrades to kill tier w/ victim 1.5x hold, world kill stop skipped for the pair, zoom still kill-exclusive). NEVER-STACK enforced (`max(remaining, fresh)`, 250ms cap). Proof: 12 planner tests + 5 router pair-scope contract tests (rows 3/4/5 scope + audio-phasing + kill tier). HARNESS CAN'T STAGE victim interaction — flash/flinch/squash/vibration marked for LIVE-TAPE; rows 3-8 now implemented-not-yet-taped.
- **K1** · Kindled · baseline tape (13-frame rig filmstrip, `scripts/kindledFeelShots.ts`, tag `base`): B1 no braced idle exists; B2 slab floats over the FACE from load through follow (instrument-vs-icon fail); B3 no pelvis-drive read in silhouette at cut; B4 slab detached from any arm in follow; B5 zero ground response on the low-ending arc (R1 r10); B6 windup mass gathers UP not INTO the body; B7 bash renders as a sword swing (no verb dispatch); B8 no idle/run stance reviews possible in harness; B9 trail dies with the sentence (R1 r12 wants 200% persistence). FIXED ALL: braced idle + planted wide stance (rig `kindledBraceMix`, kindled-v2 grammar) + harness idle/run stance reviews with held weapons; slab brace re-angled low-forward + hard below-shoulder clamp (swing + idle); deeper kindled ground-load (14→17, bash 19); bash fully rendered — `drawKindledBash` slab-led plate w/ drag-ghost smear + speed lines + Ward circuit grammar, rig body-CHECK (`bashKineticChain`/`bashHandPose`/`bashSwordHandPose`, ease-out punch pinned to the sim's 260ms gate, `KINDLED_BASH_CONTACT_T` ±1t proof in `meleeBashPose.test.ts`); ground dust one-shot per swing (blade low-exit + bash stomp + bash-landed victim-feet kick, `spawnGroundDust`, pool-safe); kindled trail afterglow outlives the sentence to t=1.2 (`drawKindledTrailOnly`); bash contact read (seal-burst + dust) on `bash-landed`. Tape: `kindled-feel/iter1-*` (bash chamber/check/idle/run all read on tape). LIVE-TAPE TODO: trail afterglow + ground dust are controller-path (rigReview can't show them); victim channels untouched this iteration.
