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

### Ability transfer (both classes)
Class abilities inherit their class's slash grammar — Kindled actives cast
with weight (anticipation + crunch), Interstice actives with snap (smear +
whip) — per the research verb-transfer matrix. A vanilla mouse-click cast
feel is the failure state.

## Research tuning table

*(Inserted when the Slash_Feel_Research_20260724 report lands — per-channel
targets: windup/active/recovery/cancel ms+ticks, hit-stop hit/kill, shake
px·ms·direction, knockback, flash frames, smear counts, sound offsets —
columns: current / Interstice target / Kindled target / sources.)*

## Iteration log

*(One line per iteration: N, class, what the critique flagged, what
changed, tape reference. Appended by the loop agents.)*
