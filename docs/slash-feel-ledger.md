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
