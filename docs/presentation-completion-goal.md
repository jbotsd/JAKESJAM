# GOAL — Presentation Complete: all animation, all VFX, dialed-in, locked, human-playtested

**Status:** The definition of DONE for the entire presentation layer — every class, every
construct, every effect. `presentation-overhaul-goal.md` is the *build spec* (how the light-
construct system works); **this** is the *completion contract* (when the whole thing is
finished, dialed-in, locked, and signed off). **Doctrine:** `design-axioms.md` §VII (A16–A20),
`jakesjam-north-star-goal.md` §4/§5, `IDENT-GRAMMAR.md`, `character-sheets-v1.md`.
**Completion gate:** the **automated harness playtest loop** — the autoplay harness drives the
game and records, key frames are extracted at the moment each construct fires, and those frames
are **read semantically** (weight, readability, construct-legibility) to judge and iterate. Play
→ record → read frames → fix everything found → repeat to convergence (the showcase
never-stop-iterating law). This is a tool-verifiable loop an agent runs autonomously; a human
final-glance is welcome but is not the engine. **Last written:** 2026-07-18.

---

## Mission

Presentation is **complete** when every fighter conjures their weapons, shields, and casts from
self-light; every one of those constructs is animated with real weight; every VFX is tuned so
the fight is always the loudest thing on screen; every construct has an audible fingerprint; and
a human has played it, felt it, and locked it. Not "it renders" — **"it reads, it feels, and
nothing about it needs to change."**

**Done =** all three completion layers (Animation · VFX · Audio) meet their *locked* bar for
**every** item in the completion matrix below, driven to convergence by the automated harness
playtest loop — the harness plays each scenario, frames are extracted and read, every issue
found is fixed, repeat until a pass surfaces nothing.

---

## The three completion layers (each has a *dialed* bar and a *locked* bar)

### Layer 1 — Animation (the rig moves with intent)
- **Dialed:** every action has **anticipation → action → follow-through**, and the per-class
  weight contract holds — Kindred *commits* (plant/brace/slow-recover), Interstice *flicks*
  (snap, no drag), Geometrician *charges* (wind/release), Syzygist *weaves* (smooth/tethered).
  Hit-stop + follow on impactful beats. The rig poses *to* its construct (hold the board, throw
  the blade, pour the field) — authored together, never layered blind.
- **Locked:** frame timings signed off; no action reads as floaty, teleporting, or pose-snapping
  (the interp-pop leak from the footage review is gone); a human confirms every action "has
  weight."

### Layer 2 — VFX (the construct reads and doesn't bury the fight)
- **Dialed:** every mechanic has its construct read *at its site* (A16); each class's construct
  language is unmistakable (A17); intensity tuned so **fighters + hitboxes stay the loudest read**
  and the backdrop recedes (A18 — fixes the backdrop-louder-than-fighters leak); all geometry is
  IDENT-GRAMMAR-legal (no Eye/triangle-ring/hexagram) and Kindred carries **no** liturgical
  iconography.
- **Locked:** intensities, colors, and lifetimes frozen; a **locked effect does not change
  without a written playtest reason** (same law as six-axes "shapes are the design; numbers move
  in playtest, then lock"); no cast ever hides an enemy behind it (human-confirmed).

### Layer 3 — Audio (the second legibility channel)
- **Dialed:** every construct has an audible fingerprint (A19) — ward *raise* hum, absorb *chime*,
  edge *shear*, cast *report*, resonance *chord* — so state is trackable by ear when the screen
  is full. All SFX are ripped canonical recordings, never synthesized (house hard rule).
- **Locked:** mix balanced; a player blind-tests "I can hear what's happening" and passes.

---

## The completion matrix — "all of them" (every item must hit all three layers)

### Cross-class (shared constructs)
| Item | Anim | VFX | Audio |
|------|:----:|:---:|:-----:|
| Locomotion (idle / run / jump / fall / land / dash) — per class | ☐ | ☐ | ☐ |
| Emission cast (all element variants: fire/ice/lightning/void/radiant/crystal/etc.) | ☐ | ☐ | ☐ |
| Six-axes reads (leech thread / ward rings / execute / wrap-seam / veil / counter) | ☐ | ☐ | ☐ |
| Card effects — the ~31 cards, each refracted 4 ways | ☐ | ☐ | ☐ |
| Death FX + ascension denial (void kill) | ☐ | ☐ | ☐ |
| Hit / impact reactions (light / medium / heavy / headshot) | ☐ | ☐ | ☐ |
| Status tells (burn / freeze / slow) + nameplate reads | ☐ | ☐ | ☐ |
| Chaos-modifier visual tells (the 7) | ☐ | ☐ | ☐ |
| Resonance chain flourish (visual + audio) | ☐ | ☐ | ☐ |

### Per class — sacred verb + defense + movement + E + all 10 catalog abilities + weapon construct
| Class | Weapon construct | Sacred verb | Defense verb | Movement | E/Emission | 10 catalog abilities |
|-------|------------------|-------------|--------------|----------|------------|----------------------|
| **Geometrician** | Crystal lance/prism | project | parry+refract | Slip Node/Recoil Step | composed cast | ☐ ×10 |
| **Interstice** | Twin light-blades + wave | dual-blade slash | Ghost Guard evade | dash/Razor/Paper | composed cast | ☐ ×10 |
| **Kindred** | Kindled Edge (dense) | overhead/edge | **Kindled Ward (the centerpiece — raise/hold/absorb/drop)** | Plant/Bulwark Step | composed cast | ☐ ×10 (**roster must be complete first — see prereq**) |
| **Syzygist** | Cool-white thread/motes | status/entangle | Self-/Glass Ward | Drift Step | composed cast | ☐ ×10 |

**Each cell = all three layers (anim/VFX/audio) at the *locked* bar.** The Kindred divine shield
is the flagship (`presentation-overhaul-goal.md` § centerpiece) and its four reads
(raise/hold/absorb/drop, with absorb *feeding* the paladin) are individually gated.

---

## Prerequisites (completion cannot start on an incomplete class)

- **Paladin roster parity.** Kindred is under-covered (buff ×1, movement ×1), has 2 solo-dead
  abilities, and is ~60% the wizard's build depth. Close it (add Kindled Resolve + Bulwark Step,
  solo-clause Aegis/Rally — `axiom-deviations-audit.md` § Kindred) and build to wizard-parity
  *before* its presentation is locked. You cannot lock the render of a class that isn't built.
- **Event contract complete.** Every mechanic emits a named event (§5) so every read has a hook.
- **The two observable leaks fixed** (footage review): backdrop-louder-than-fighters (A18),
  interp-pops (Layer-1 weight). Presentation can't be "locked" over a broken read.

---

## Acceptance — it's done when

### A. The automated harness playtest loop (the engine)
This is how the presentation is judged and iterated — the same loop this session used to catch
the backdrop/interp/damage-number leaks. It runs autonomously to convergence:

1. **Drive the scenario.** The autoplay harness (`scripts/autoplay.ts`, extended to force each
   class + each ability + the ward + Emission + cards) plays real matches and records the tape.
   It already presses E and slots 1–4; extend it to exercise every matrix row.
2. **Extract key frames.** Pull frames at the *moment each construct fires* (the harness logs
   ability/cast timestamps — ffmpeg `-ss` at those marks), plus a coarse sweep, plus burst
   frames (8 consecutive) at impact/dash for weight + pop analysis. mpdecimate for stutter.
3. **Read the frames semantically.** An agent (vision) judges each frame against the layer bars:
   *does the ward read as a wall of divine light? is the fighter the loudest thing? does the
   dash have weight or snap? is any construct read-less? does anything bury the enemy?* This is
   a real judgment a vision agent makes — it found real defects this session.
4. **Fix everything found — the whole list, not the top item** (screenshot-iteration law: list
   EVERY improvement, do ALL, never cherry-pick).
5. **Repeat until a full pass surfaces nothing** (the showcase never-stop-iterating law: re-watch
   the latest footage FIRST, rate vs best-in-world, fix the weakest point, repeat). K consecutive
   clean passes = converged.
6. **Human final-glance (optional, not the engine).** Jake can spot-check a converged class and
   veto, but the harness loop is what *does the work* and *finds the issues*.

### B. The per-matrix-cell tests the loop checks each pass
- **Read test (A16):** no construct is read-less — every mechanic shows a change the frame proves.
- **Legibility test (A18):** the fighter + hitboxes are the loudest read; no cast hides an enemy;
  the backdrop recedes.
- **Lens test (A17):** each class's constructs are namable from the frame alone.
- **Weight test (Layer 1):** burst frames show anticipation→action→follow-through; no pose-snap,
  no teleport, no float (mpdecimate near-dup rate at the static-overlay floor).
- **Audio test (A19):** a blind listen tracks state (harness records audio; check the mix).

### C. Engineering (the harness + build stay honest)
1. Zero sim-logic edits in the presentation work (render/event modules only — §5).
2. A checklist/lint gate catches any mechanic that ships without a construct read (A16).
3. Every matrix cell has an owner and a state; none is silently skipped; the harness *covers*
   every row (a row the harness never triggers is not "passed," it's un-tested — log it).
4. Constructs run inside the particle budget and bake for Pi/phone (`END_PRODUCT_GOAL` §3).
5. `bun test` + typecheck green.

### D. Locked
- Every dialed number (intensity/color/lifetime/frame-timing) is **frozen** once the harness loop
  converges; changing one requires a written reason (a new harness finding, or a human veto). The
  matrix is 100% at the locked bar. **The presentation stops being a moving target.**

---

## How this goal closes — the harness loop runs to convergence (autonomous)

**This goal is tool-verifiable and an agent can drive it to done.** The autoplay harness plays,
records, and logs cast timestamps; frames are extracted at those marks; a vision agent reads them
against the layer bars; every issue found is fixed; repeat. The loop *is* the playtest — it's how
this session found the backdrop, interp, and damage-number defects, applied to the whole matrix.
Convergence = K consecutive full passes surface nothing new (the showcase never-stop-iterating
law with a stop condition). A human final-glance can veto a converged cell, but is not required
to reach it. The harness is not a substitute for judgment — it is the *vehicle* for judgment at
scale: it puts the frame in front of the eye that judges, over and over, until nothing's left.

---

## Anti-patterns

1. **Claiming a cell done without the harness loop having read its frames.** "It compiles" or
   "it runs" is not "it reads and feels right" — the frame must be extracted and judged. A row
   the harness never triggered is un-tested, not passed.
2. **Cherry-picking the frame-read list** — fix EVERY issue a pass finds, not just the worst one
   (screenshot-iteration law).
3. **Locking a class that isn't built** (paladin parity prereq).
3. **A read deferred to "later"** — the read ships with the mechanic; only polish defers (A16).
4. **Spectacle over legibility** — a locked effect that buries the fight (A18).
5. **Unlocking without a playtest reason** — the matrix is frozen; changes are earned by play.
6. **Synthesized SFX** (house hard rule — rip the real thing).
7. **Any forbidden geometry or liturgical iconography** (IDENT-GRAMMAR / Kindred char-sheet).

---

## Relationship to other goals

| Goal | Relationship |
|------|--------------|
| `presentation-overhaul-goal.md` | The build spec; this is its completion contract |
| `jakesjam-north-star-goal.md` | §4 (read at site) + §5 (independent layer) reach *locked* here |
| `design-axioms.md` §VII | A16–A20 are the per-layer bars |
| `axiom-deviations-audit.md` | The paladin-roster prereq lives there |
| `END_PRODUCT_GOAL.md` | The Pi/phone bake + smoothness this must satisfy |
| `six-axes-goal.md` Phase 4 | Sibling playtest gate — but *that* one is human-gated (product questions); *this* one is harness-driven (visual convergence). Different gates for different judgments |

---

## One-line definition of done

**Every construct animated with weight, every VFX dialed so the fight stays loudest, every
effect audible, every class signed off by a human at the controls — and then frozen, because
there is nothing left that needs to change.**
