# GOAL — JAKESJAM North Star (the game-design done-done)

**Status:** North star for *what JAKESJAM is to play*. The furthest-horizon goal; every
system goal (`escalation-engine`, `emission-engine`, `six-axes`, `classes`) is a component
that must converge here. Its sibling `END_PRODUCT_GOAL.md` owns the *vessel* — how the game
runs, looks, smooths, and shares across every device; **this** owns the *game inside it*.
**Reasoning behind every claim:** `design-axioms.md` (the levers), `axiom-deviations-audit.md`
(where we currently diverge), `axiom-true-redesign-vision.md` (the mirror this goal makes a
target). **Last written:** 2026-07-18.

---

## Mission

A URL-click puts you in a fight in five seconds. Five rounds later you are piloting a build
that reads like a *sentence you composed* — and a stranger watching your clip understands
every moment of it without a word of explanation.

The bet, stated once and held: **depth by combination of a few orthogonal parts, not depth by
the count of systems.** JAKESJAM wins not by having the most mechanics but by the most
*meaning per mechanic* — few loops, deeply interacting; one build language, four lenses; and
a screen where the fight is always the loudest thing on it.

**Done =** the game reaches the axiom-true end-state below — one economy, ≤4 braked loops, one
orthogonal build language refracted through four class lenses, every mechanic emitting a
legible event, complexity revealed at the newcomer's pace, difficulty read off resources — and
the work that remains is *tuning*, not new systems.

---

## What this is not

| Not this | Why |
|----------|-----|
| A platform/render goal | That's `END_PRODUCT_GOAL.md`. This is the *design* — the felt experience, not the pixels-per-second |
| A demand to delete the class system | Classes are the axioms' **strongest** application — four orthogonal lenses = discrete infinity done right. Kept. What folds is the *machinery*, not the lenses (see the redesign vision, corrected) |
| A feature list | Every item is an *outcome with an acceptance test*, in the `END_PRODUCT_GOAL` style — a thing a player or spectator experiences |
| A freeze on ambition | The ambition moves from *more systems* to *more mastery, legibility, and world-coherence* out of fewer parts |

---

## The end-state — seven outcomes, each with a test

### 1. One economy, learned in one fight.
**Outcome:** a new player learns a single combat meter in their first round, and it fuels
everything they press. **Test:** exactly one spendable combat resource per player; a first-timer
can say "this bar fills when I fight and I spend it on my abilities and my ult" after one round.
*(Folds today's abilityCharge + the four class resources + shield + fangs-locks into one pool.)*

### 2. Four major loops, each with a visible brake.
**Outcome:** the game's major loops are countable and learnable, and none runs away.
**Test:** the major loops enumerate to ≤4 (Fight · Escalate · Chaos · Finish); every
self-improving loop — the Syzygist curse engine, block-punish, first-blood — has a named,
*difference-fed* brake (friction that's invisible when even, firm when snowballing); no player
is mathematically buried before the round-end draft can rebalance.

### 3. One build language, four lenses.
**Outcome:** the whole build system is orthogonal composition refracted through the four
classes; two same-class players with different builds play as genuinely different specs.
**Test:** no dominant build/rack exists; every card and ability appears in at least one viable
build; each class keeps its sacred verb (project / cut / hold-the-board / entangle) and refracts
the *same* mechanics into an unmistakably different read; the ≥2-per-role coverage floor holds
for all four catalogs.

### 4. Every mechanic reads at its site.
**Outcome:** a spectator with zero explanation reads every effect the instant it happens.
**Test:** every ability, card effect, and resource change emits a **named sim event** with a
legible placeholder read on the day it ships (the read is part of the mechanic, never deferred
— A16); the fighters and their hitboxes are always the loudest thing on screen; no cast ever
hides the enemy behind it.

### 5. Presentation is an independent layer over the event stream.
**Outcome:** world-class VFX/animation/sound can be built in parallel without touching the sim.
**Test:** the render layer subscribes to sim events only; a polish pass edits `*Vfx` / `*Painter`
/ `*Feel` / SimEventRouter and **never** `sim/*.ts` or `*.zig`; the read ships coupled to the
mechanic, the polish ships later against the same event contract. *(This is what makes "VFX
later" a real promise instead of a coupling trap.)*

### 6. Complexity revealed at the newcomer's pace.
**Outcome:** round 1 is almost the old game; round 5 is unrecognizable — for the player's
*understanding*, not just their build. **Test:** a URL-clicker is fighting within five seconds
with ≤4 things to actively track; each further layer (the draft, the rack, chaos, resonance)
reveals as they escalate, not all on second five (A12 × A15 — hand out the next layer exactly
when they're ready to close the gap).

### 7. Difficulty is a query over resources.
**Outcome:** the game meets each player where they are without a bespoke difficulty engine.
**Test:** bots read the human's score / health / streak and adapt — down for the drowning
newcomer, up for the smurf — because progress is already a resource (A11).

**And the meta-outcome that governs all seven:** *the system count stops growing; the depth
deepens.* **Test:** new work is predominantly balance / feel / legibility tuning (the "95% of a
game's quality is tuning, not innovation" axiom); any proposed new *system* must retire or fold
an existing one to earn its loop-budget rent (A5).

---

## The path (forward-looking — from the addition-heavy present to here)

Not a rip-and-replace. A **convergence** — each existing goal bends toward the north star as it
lands its next phase.

- **Phase N1 — Instrument & decide.** Establish the event contract (§4/§5: every mechanic emits
  a named event; render subscribes) as a build rule *now*, so nothing built henceforth is
  coupled. Make the one-economy call (AX.1) before the class-resource pass hardens. Fix the two
  observable legibility leaks the footage caught (backdrop out-shouting the fighters; interp
  pops) — §4 has no meaning while the fight is unreadable.
- **Phase N2 — Fold & brake.** As the class-resource pass (workboard 1.2) lands, fold toward one
  economy (§1). As each class resource is built (0.3/2.3/3.2), name its brake (§2, AX.3). Run
  the orthogonal-balance acceptance test on every catalog (§3, AX.2).
- **Phase N3 — Reveal & adapt.** Stage the newcomer's disclosure curve (§6). Make bot difficulty
  a resource query (§7). By here the system count is frozen; the loop stops.
- **Phase N4 — Tune to done.** The remaining work is the 95% — balance, feel, read, world-
  coherence — against the seven tests, forever. The playtest gates (six-axes Phase 4 et al.)
  live here.

---

## Acceptance — it's done when

### A. Product (the player / the spectator)
1. A stranger who has never seen JAKESJAM watches a 30s clip and narrates what happened —
   correctly — without help.
2. A URL-clicker is in a fight in five seconds and is not overwhelmed.
3. Asked after five rounds, a player describes their build as a composed thing ("my bounce-drain
   cage," "my ward-punish paladin") — unprompted, in their own words.
4. Two players on the same class play visibly differently and neither feels strictly stronger.
5. Nobody feels buried by a snowball they couldn't have contested.

### B. Engineering
1. One spendable combat resource per player; the major-loop count is ≤4 and each has a test-
   covered brake.
2. Every mechanic emits a named event; the render layer imports zero sim-logic modules.
3. No dominant build; every card/ability appears in a viable build (property test over the pool).
4. `bun test` + typecheck green; no read-less mechanic ships (a lint/checklist gate).

### C. Elegance
- Fewer nouns than the current design, more sentences. Every system that survives earns its
  loop-budget rent; every one that folded made the game *more* expressive, not less.
- The four class lenses, the one build language, the one economy, and the one event stream share
  a single coherent world — no foreign note, nothing bolted on (harmony can't be faked).

---

## Anti-patterns (the addition-depth traps this goal exists to resist)

1. **A new system that doesn't retire an old one.** Every added loop spends a budget the axioms
   say is nearly gone (A5).
2. **A second content matrix beside the build language** — a parallel bar of magnitude-ranked
   mechanics balanced in isolation (the D2 collapse).
3. **A self-improving loop shipped without its brake** (the D3 leak).
4. **A mechanic shipped without a read** — deferring the read, not just the polish (A16).
5. **VFX that reaches into sim logic** — coupling the polish layer to the mechanics (breaks §5).
6. **Front-loading the whole system stack onto the newcomer's second five** (breaks §6).
7. **Confusing "more mechanics" with "more depth."** Depth is combination, not count.

---

## Relationship to other goals

| Goal | Relationship to this north star |
|------|----------------------------------|
| `END_PRODUCT_GOAL.md` | The **vessel** (render/platform/smooth/share). This is the **game inside it**. Together they are "done" |
| `escalation-engine-goal.md` | Its catch-up weights ARE §2's model brake — the one to copy everywhere |
| `six-axes-goal.md` / `emission-engine-goal.md` | The seed of §3's one orthogonal build language; its legibility law IS §4 |
| `classes-goal.md` / `card-pool-v2.md` | The four lenses (§3) — kept; their machinery converges toward §1/§2 per the deviations audit |
| `design-axioms.md` | The levers this goal is built from; every §-test traces to an axiom |

---

## One-line definition of done

**Click a URL, fight in five seconds, and five rounds later pilot a sentence you composed —
deep from the combination of a few orthogonal parts, legible enough that a stranger reads it
cold, and so true to its own world that nothing foreign ever intrudes.**
