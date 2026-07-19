# JAKESJAM — Design Axioms (generative, not restrictive)

**Status:** Canonical reasoning layer. Where the other docs say *what JAKESJAM is*
(`jakesjam-design-pillars.md`), *how a specific system works* (`escalation-engine-goal.md`,
`six-axes-goal.md`, `emission-engine-goal.md`), and *what UI form is allowed*
(`ui-axioms.md`), this doc says **how to reason about the game's substance** — mechanics,
feel, balance, pacing, economy.

**What "non-restrictive" means here.** Older doctrine leans on prohibition — "NEVER do X",
"kills a PR on sight", anti-pattern walls. Those protect against known failures, and they
stay. But a prohibition only tells you where the cliff is; it doesn't tell you where the
open field is. **Each axiom below names a lever, explains the mechanism that makes it work,
and shows the design space it opens.** Turn the lever deliberately. When an axiom seems to
forbid something, read the mechanism — the "don't" is always a consequence of a "because",
and understanding the because usually reveals a *third option* the prohibition hid.

**Grounding.** Distilled from the game-design corpus in the knowledge base (Adams,
*Fundamentals of Game Design*; Adams & Dormans, *Game Mechanics: Advanced Game Design*;
Adams, *Fundamentals of RPG / Shooter Game Design* — books #46–49 in `BOOK_EXTRACTIONS.md`,
retrievable via `qdrant-find`). Each axiom cites the mechanism, not the authority.

---

## How to use this doc

For any design decision — a new card, a tuning number, a feel pass, a mode — ask which
axioms bear on it, then reason **from the mechanism forward** to options, not from a rule
backward to compliance. If a proposal violates an axiom, that's not a veto; it's a prompt:
*which lever am I actually turning, and is the tradeoff the one I want?*

---

## I. Feel — every mechanic can carry sensation

### A1. Feel is a rhythm you author, not a polish you add later.
**Lever:** the input→feedback loop of a single action (aim, fire, hit, cast). **Mechanism:**
players read competence and impact off the *immediate* response — recoil↔handling cadence,
hit confirmation, the weight of a kill. A mechanic with a clear response teaches itself; one
without feels broken even when it's correct. **JAKESJAM:** the Emission's seal-flash + camera
punch, weapon shuriken throw, the six-axes reads (crimson leech thread, ward rings, execute)
— these aren't decoration, they *are* the mechanic's legibility. **Opens:** any new
system earns its own sensory signature by default; the question is never "should this have
feel" but "what is this action's rhythm."

### A2. Ship the missing feature, never the broken one.
**Lever:** completeness gate. **Mechanism:** an *absent* feature reads as a decision; a
*broken* one reads as incompetence and poisons trust in everything around it. **JAKESJAM:**
better to cut an ability card from the pool than ship it half-wired. **Opens:** permission to
cut aggressively and ship a tight thing — subtraction is a design move, not a retreat.

---

## II. Feedback & Economy — the snowball is a dial, not a fate

This is JAKESJAM's most load-bearing theory, because the Escalation Engine and the Six Axes
are *stacking systems* — exactly where feedback loops decide whether the game stays alive.

### A3. Positive feedback is a *finisher*; every self-improving loop needs a brake.
**Lever:** the loop that turns a lead into a bigger lead (kills → charge → casts → kills;
stacked build → faster clears → more picks). **Mechanism:** positive feedback's *good* job is
ending an already-decided game fast; its *failure* is amplifying early luck into an unearned
runaway. A dynamic engine with no counter-force always collapses into a dominant line.
**JAKESJAM:** the round-end draft's catch-up weights (`draftWeights.ts`) ARE the brake — richer
offers for non-winners is *relative negative feedback* fed by the score difference, the
textbook counter to leader-snowball. The design-pillars rule "never silence the winner's
draft" is the *same* insight from the other side: don't brake by denial, brake by lifting
the trailer. **Opens:** any new escalation is safe to add as long as you can name its brake.
Ask of every stacking mechanic: *what difference-fed force pulls the leader back?*

### A4. Name your resources first, then the mechanics that move them.
**Lever:** the internal economy — sources (spawn, charge fill), drains (cost, decay),
converters (a card that turns X into Y), traders (shields banking hits into homing shots).
**Mechanism:** you cannot read an economy's health off its rules; you must *run* it. Balance
is found by simulation — strip randomness, read the trend across hundreds of runs, add it
back. **JAKESJAM:** `abilityCharge`, health, shield charge, stolen-fangs locks, cooldowns are
the resource graph; the sim benchmark (scratchpad `sim-bench.ts`) is the "run it" tool.
**Opens:** balance stops being vibes. A new card is a node on the resource graph — you can
predict its effect by where it sits (source? converter? trader?) before playtesting confirms.

### A5. Keep 2–4 *major* feedback loops. Zero gives no emergence; more than four is unlearnable.
**Lever:** loop count. **Mechanism:** emergence — aggregate behavior not derivable from the
parts — needs loops, but *you* understand your loops and players don't; past ~4 majors the
system becomes noise to them. **JAKESJAM:** first-blood wager, the draft escalation, chaos
modifiers, sudden-death shrink — that's the major-loop budget; a fifth systemic loop should
replace, not add. **Opens:** a clean test for "is this too much system?" — count the loops a
*player* must hold, not the ones you enjoy.

### A6. Uncertainty should come from emergence, not dice.
**Lever:** where surprise originates. **Mechanism:** deterministic loops can produce dazzling,
genuinely uncertain behavior where *every player choice stays meaningful*; rare high-impact
randomness makes players feel helpless. Prefer high-frequency low-impact chance (odds even
out, decisions still matter); reserve big swings for *forcing improvisation* or *breaking a
dominant strategy*, and make unavoidable random events hit everyone equally. **JAKESJAM:**
chaos modifiers reroll per round (frequent, textured, symmetric — they hit the whole arena);
the draft offer is seeded and legible. **Opens:** you can make the game feel wild and fresh
without a single unfair coin flip — turn the *system's* knobs, not the RNG's stakes.

---

## III. Depth & Balance — differences in *kind*, not magnitude

### A7. Every element needs a unique reason to exist; differentiate orthogonally.
**Lever:** the axis on which options differ. **Mechanism:** if choices rank on one scale, the
top one is a dominant strategy — it doesn't guarantee you *win*, it guarantees you *never need
another idea*, which quietly kills the whole game. Depth is a ladder you can climb: shadow-cost
the strong option → make the options intransitive (rock-paper-scissors) → make them
*orthogonal* (different in kind) → define victory so multiple kinds are required. **JAKESJAM:**
this is the entire justification for the Six Axes being *orthogonal and composing, never
cancelling* — Drain/Ward/Stride/Sorcery/Mystery/Technique are differences in kind, and "value
scales with combinations, not parts" (discrete infinity) is why a small card pool yields a huge
build space. The pillars rule "no useless cards; cap the always-win, don't hide the draft" is
A7 applied. **Opens:** balancing isn't nerfing numbers toward sameness — it's finding each
element's *orthogonal reason to exist*. A card that's a weaker version of another isn't a
choice, so give it a different job instead of a different number.

### A8. Fairness is *perceived*, not engineered — it's a judgment players pass from outside the rules.
**Lever:** the read of fairness, separate from the math of it. **Mechanism:** fairness lives in
the player's culture, not the ruleset; a mathematically symmetric system can still *feel*
rigged, and a deliberately asymmetric one can feel fair if the player understands why.
**JAKESJAM:** pity-boss and catch-up weights must *look* like a comeback earned, not charity
handed out; the Emission's below-a-kill budget must *read* as "big but not a delete button."
**Opens:** legibility is a balance tool. Sometimes the fix for "this feels unfair" isn't
changing the numbers — it's making the existing fairness visible.

---

## IV. Difficulty & Pacing — the gap is the game

### A9. Perceived difficulty = absolute difficulty − (player power + player experience).
**Lever:** three independent terms. **Mechanism:** players silently get better as they play, so
*flat* objective difficulty feels like it's getting *easier* — a sensation they misread as
"unbalanced." You have three dials, not one. **JAKESJAM:** in a live PvP arena the "experience"
term is the opponent, but the principle governs bot difficulty, the chaos ramp, and how the
build curve should outpace mastery. **Opens:** three levers to tune tension instead of one
blunt "harder/easier"; and a diagnosis for "why does round 5 feel flat" that isn't just
"add enemies."

### A10. Pacing is a wave: demand, then rest **and** replenish.
**Lever:** the spacing of intensity. **Mechanism:** two draining challenges back-to-back with no
recovery is exhausting; a lull that follows a spike *and* refills the player is the rhythm that
makes the next spike land. **JAKESJAM:** the round → hold → draft → countdown loop is this wave
at the macro scale (the draft is the rest-and-replenish beat), and fast respawn keeps the micro
scale from flatlining into dead air. **Opens:** reframes the showcase rule "player stationary >1s
= bug" — stillness isn't the enemy, *unearned* stillness is. A lull that pays out (draft, a
breath after a kill) is the rhythm; a lull with nothing driving out of it is the defect. Design
the payout, not the prohibition.

### A11. Adaptive difficulty falls out of measuring progress as a *resource*, not a *journey*.
**Lever:** how "progress" is represented. **Mechanism:** space-based progress (fixed level layout)
is the same every run; state-based progress (a resource total the system reads) lets difficulty
auto-tune and vary itself for free — and, tuned only ever *harder* and kept optional/subtle,
avoids the trap that making a game *easier* automatically requires guessing *why* the player
failed (which the machine can't). **JAKESJAM:** scores, charge, and build state are already
resources — DDA for bots or a solo mode can read them directly. **Opens:** dynamic difficulty
without a bespoke difficulty system — it's a query over resources you already track.

---

## V. Readability & the Player — build for the audience, not the mirror

### A12. You are almost never your own player.
**Lever:** whose enjoyment you're optimizing. **Mechanism:** "I'd play this" is a sample size of
one and usually wrong; ~95% of a game's quality is avoiding elementary errors and tuning — the
invisible plumbing — not the visionary spark. **JAKESJAM:** the .io-newcomer who clicks a URL is
the representative player; the design owns their five-second onboarding, not the designer's taste
for depth. **Opens:** the universal feature filter — *does this increase the representative
player's enjoyment? If not, justify it or cut it.* A generative test you can run on anything.

### A13. Two audiences, two interfaces — don't average them.
**Lever:** the optimizer↔immersion-seeker split (see-the-numbers vs. inhabit-the-world).
**Mechanism:** a compromise UI satisfies neither; hiding rules in software is what lets players
stop reasoning about a rulebook and start inhabiting a world — but it *costs* you their ability
to optimize, so you owe them clues instead of trial-and-error. **JAKESJAM:** the action bar and
nameplate reads serve the optimizer (exact cooldowns, status arcs); the crystal-tech world and
juice serve the immersion-seeker — kept as *distinct* layers, not a muddy middle. **Opens:**
when a UI feels wrong, ask which audience it's for; the fix is often to pick one per surface,
not to split the difference.

---

## VI. Reward & Progression — the reward schedule *is* the behavior design

### A14. Reward is a steering wheel, not a thank-you.
**Lever:** what you attach reward to. **Mechanism:** whatever pays out is what players do —
*including the path you didn't intend*. Never let the highest reward-per-effort route be the one
you don't want played. And reward large / punish small: hope motivates more than fear, and a
game that keeps smacking players down feels abusive. **JAKESJAM:** charge fills from
participation (dealing/taking damage) precisely to steer players *toward the fight*; the draft
rewards everyone to keep the whole roster escalating. **Opens:** to change behavior, move the
reward — don't add a rule against the behavior you're accidentally paying for.

### A15. The gap between current ability and the next challenge *is* the content's reason to exist.
**Lever:** the deliberately-set shortfall. **Mechanism:** growth systems work because the
challenge is placed *above* current power by design; that enforced gap is what converts optional
play into directed effort. Close it too easily → content feels pointless; make it un-closeable →
grind wall. **JAKESJAM:** the build curve must keep opening a gap the next round's draft can just
close — round five looks nothing like round one *because* each round set a reachable gap.
**Opens:** a tuning target for progression — not "how much power per round" in the abstract, but
"is the gap reachable-but-not-trivial this round."

---

## VII. Presentation — VFX / animation / sound (what the literature actually says)

The game-design corpus does not treat effects as polish; it treats them as the
*mechanism by which a mechanic becomes real to the player*. Applied to the new
class / ability / card system, five axioms:

### A16. The read IS the feedback loop — a silent/invisible effect reads as broken.
**Lever:** the on-cast and on-hit change. **Mechanism (Shooter book, verbatim):** *"Shooting
is only meaningful if a visible change occurs on hit — that change is the reward signal that
closes the feedback loop. Fire a weapon and nothing legibly changes = no feedback = the act
feels dead no matter how good the gun model is."* Heuristic: **never let an action resolve
without a legible change — visual, audio, or both; silent hits read as broken.**
**JAKESJAM consequence — this reframes the deferred VFX pass:** you can defer *polish*, you
cannot defer *the read*. Every one of the ~40 class abilities, every card effect, every
resource tick must ship with a placeholder read *at the moment it lands* — even an ugly one —
or the mechanic plays as broken in playtest and you'll misjudge its balance. The card-pool
doc's "every card notes its intended visual read" is right; the literature adds: that read is
load-bearing for *feel and balance now*, not just beauty *later*.

### A17. The class is the lens the effect refracts through — one mechanic, four coherent reads.
**Lever:** presentation consistency across chassis. **Mechanism:** *consistency beats realism*
(Game Mechanics) — players forgive unreality but not arbitrariness; and immersion shatters on a
single foreign note (Four Immersions). **JAKESJAM:** the card pool's "one card, four readings —
a nova through a blade is a spin-slash, through a board a quake" is exactly this. The VFX/SFX
must *show* the refraction: the same underlying mechanic must read as unmistakably Geometrician
(crystal geometry), Interstice (blade + wave), Kindled (settled light + weight), Syzygist
(cool-white entanglement) — coherent *within* each lens, never a fireball on the geometrician
or a WoW-rogue flourish on the ninja. Discrete infinity applied to presentation: few effects,
each refracted four ways.

### A18. Readability caps spectacle — the fighter and the hitbox stay the loudest thing on screen.
**Lever:** visual priority. **Mechanism:** VFX never hides gameplay (Adams readability; JAKESJAM
ui-axioms). **JAKESJAM — this is the stacking system's specific danger:** 4×10 abilities +
Emission + cards + resonance + chaos all firing is a *noise* risk, and the footage review
already caught the backdrop out-shouting the fighters *before* the class VFX even landed. Hard
constraint on the VFX pass: **more abilities must not mean more screen chaos.** The bodies and
the hitboxes are always the loudest read; ability VFX is subordinate scenery to that. A cast
you can't see the enemy *through* is a bug, not a spectacle.

### A19. Sound is the second legibility channel — use it to offload the eye.
**Lever:** audio as a parallel read. **Mechanism:** "silent = broken" cuts both ways — audio
*teaches* and *tracks* state without the player looking. **JAKESJAM:** when five effects fire at
once and the screen can't carry every read (A18), audio carries what the eye can't — a player
should *hear* "a ward went up," "a curse landed," "resonance chained" and know the state without
parsing the visual chaos. Give every class and signature ability an audible fingerprint; audio
is where the legibility budget the screen ran out of gets spent. (Ties the existing
`audio-engine.md` / `audio-memeology.md` work to the class system.)

### A20. Resonance needs its own read or it can't be learned.
**Lever:** the combo flourish. **Mechanism:** a mechanic with no feedback can't be learned (A16)
— and the timing-window kind especially. **JAKESJAM:** if Resonance (chain unlike abilities in a
window) ships without a distinct visual + audio trigger, players can't feel the timing and it
becomes invisible depth nobody uses. The read is *also* how AX.1 gets satisfied: a resonance you
*see and hear* land is an implicit felt combo, not a stopwatch you consciously manage — the
flourish is what turns a tracked loop into a background reward.

---

## Relationship to the rest of the doctrine

| Doc | Owns | This doc's relation |
|-----|------|---------------------|
| `jakesjam-design-pillars.md` | What JAKESJAM *is* (the 5 pillars, what it's not) | Pillars are the identity; axioms are the reasoning that generates decisions consistent with them |
| `escalation-engine-goal.md` | The universal round-end draft | A3/A7/A14 are its theoretical spine (snowball brake, orthogonal depth, reward-steering) |
| `six-axes-goal.md` / `emission-engine-goal.md` | The stacking ability system | A7 (orthogonal-not-magnitude, discrete infinity) is its justification |
| `arena-balance-feel-goal.md` / `game-feel-tuning.md` | Feel targets + numbers | A1/A9/A10 are the *why* behind those numbers |
| `ui-axioms.md` | UI *form* (geometry, colour, buttons) | Different layer — form vs. substance. A13 is where they touch |

**These axioms are not a fence; they're a map of the levers.** When one seems to forbid, the
mechanism it cites is the real content — and the mechanism almost always opens a door the
prohibition would have kept shut.
