# Axiom Deviations Audit — combat / class / ability / card systems

**What this is.** A comb of the new combat systems (`classes-goal.md`,
`class-ability-catalogs-v1.md`, `card-pool-v2.md`) against `docs/design-axioms.md`,
looking for **deviations** — places where the design contradicts a mechanism the
axioms establish. A deviation is not a verdict; it's a prompt: *is this the tradeoff
we mean, or a leak?* Each entry names the axiom, where it deviates, the mechanism at
stake, the risk, and fix **directions** (options, not mandates — the system owners
decide). Alignments are affirmed at the end so sound design isn't second-guessed.

**Reviewed as of 2026-07-17 doc lock.** These are design-doc deviations, not code
bugs; nothing here blocks the in-flight build — they're calls to make before the
numbers set.

---

## Deviations

### D1 — A5 (loop budget): the combat stack likely exceeds the learnability ceiling.
**Axiom:** keep 2–4 *major* feedback loops a player must hold; past ~4 the system is
noise to them (you understand your loops, they don't).
**Where:** a live round now asks the player to simultaneously track — chassis base
(M1 / defense verb / movement / E-Emission) **+** one of four *distinct* class resource
economies (mana / energy / Kindling / Devotion, each its own 0–100 pool) **+** the 3-slot
rack rotation with cooldowns **+** the Resonance window (cast a *different* ability into a
live 1.5–2.5s window to consume it) **+** the Emission charge **+** the between-round
draft (specs) — on top of the pre-existing macro loops (chaos reroll, first-blood,
sudden-death shrink).
**Mechanism at stake:** this is well past four *major* loops. Individually each is sound;
the **stack** is the risk. And it collides head-on with A12 (the representative player
clicks a URL and must be fighting in five seconds) — a newcomer meets all of this at once.
**Risk:** the game reads as deep to its designers and as noise to its audience; the .io
"click and play" promise breaks; retention dies at the loadout screen, not in the fight.
**Fix directions (pick, don't stack):**
- **Fold loops.** Strongest lever: is the Emission charge a *separate* resource from the
  class pool, or should E draw from the same 0–100 pool the rack does? One meter the player
  learns once beats two they juggle. Same question for Resonance — can it be an *implicit*
  reward (a visible "combo" flourish) rather than a loop the player actively times?
- **Background the automatic ones.** A loop the player doesn't *decide* isn't a loop they
  must hold — make resource regen and resonance detection legible-but-passive so the
  *decisions* stay ≤4 (which rack, which target, when to E, when to draft).
- **Gate exposure by round.** If the depth is intentional (it's a defensible bet), the
  newcomer's round 1 can surface fewer loops (rack pre-filled, resonance hint off) and
  reveal the rest as they escalate — the draft curve already does this for cards.

### D2 — A7 (orthogonal balance): the rack has omit-pain but no *balance* guarantee, so it can collapse to one meta rack.
**Axiom:** every element needs a unique reason to exist; differentiate in *kind*, not
magnitude; customization without real opportunity cost collapses the choice space into one
optimal build.
**Where:** "pick any 3 of 10, pure freedom, no cost beyond the slot cap" (`classes-goal.md`
§ Rotation). The only opportunity cost is the 3-slot ceiling.
**Mechanism at stake:** the slot cap *is* real mutual exclusivity — good, and better than
a free-for-all. But the design then **asserts** the payoff ("two ninjas with different
racks play as different specializations") without **guaranteeing** the condition that makes
it true: the ten abilities must be orthogonal enough that no single rack strictly dominates.
If they rank by strength instead of differing in kind, everyone converges on the one best
three and the "specialization = which 3" freedom is cosmetic. This is A7's core failure
mode — a dominant option doesn't have to *win*, it just has to mean *you never need another
idea*.
**Sub-flag (concrete):** **Measure** (Geometrician #8) is described in the catalog's own
text as "cosmetic-heavy, small mechanical help." That's a candidate dominated pick — if
nobody racks it over Overclock, it isn't a choice, it's filler (A7: an element without a
unique compelling reason isn't a choice). Every catalog should be swept for its Measure.
**Risk:** the headline feature (deep pick-and-choose specialization) degrades to a solved
meta rack per class; the other seven abilities become museum pieces.
**Fix directions:**
- **Add an orthogonal-balance acceptance test to the class definition-of-done:** no rack
  strictly dominates another; every ability is the *best pick* in at least one rack context
  or matchup. This is the same "no useless cards; cap the always-win, don't hide the draft"
  discipline the escalation engine already holds — extend it to the catalog.
- **Design intransitivity in on purpose:** if a rock-paper-scissors exists across racks
  (rush beats planted, planted beats zone, zone beats rush), the meta *rotates* instead of
  *solving*. The role tags (offense/defense/aoe/single/buff/movement) are the raw material;
  the counters need to be intentional, not hoped-for.
- **Re-home or re-job the filler:** an ability that only ever loses gets a different *kind*
  of job (orthogonal), not a bigger number (magnitude).

### D3 — A3 (self-improving loops need a brake): several within-round ability economies are unbraked.
**Axiom:** positive feedback is a finisher; every self-improving loop needs a
difference-fed brake or it becomes a downward spiral for everyone else.
**Where (in-round, not roster-level):**
- **Syzygist Bleed Tithe** (#1): curse DoT → generates Devotion + lifesteals → fuels more
  curses → more Devotion + lifesteal. Amplified by **Flock Pulse** (#6, scales with your
  entangled count) and **Contagion** (#5, spreads on death) — a positive-*constructive*
  engine. No stated brake.
- **Kindled Retribution Edge** (#2): blocked hit → next edge amps + Kindling refund → more
  blocks/edges → more Kindling. A block-punish loop; brake unclear. **CLOSED 2026-07-19 by
  removal, not by a fix** — the ability was cut from the catalog entirely (docs/class-
  ability-catalogs-v1.md's cut note; Kindled back to 10/10) rather than given the brake this
  section calls for. The brake was never built.
**Mechanism at stake:** the **draft's** catch-up weights are the macro brake (A3 applied
correctly at the roster level — and it's the model to copy). But an *ability* economy that
self-fuels *within a round* has no roster-level brake reaching it fast enough; in FFA a
Syzygist who gets rolling is the "early advantage → runaway" A3 warns against, and
everyone else feels the spiral.
**Risk:** first-blood-snowballs-the-round at the ability layer; the loser of the opening
exchange is mathematically buried before the draft can rebalance.
**Fix directions:**
- **Name each self-fueling ability's brake**, the same way the escalation engine names its
  macro brake: a stopping mechanism (diminishing Devotion-per-tick past N stacks), a slow
  cycle, or a cost that rises with the loop's own output. The extracted Game Mechanics rule
  is explicit: *never ship a self-improving loop without a counter-balancing friction or
  escalation pattern.*
- **Prefer difference-fed brakes:** tie the friction to how far *ahead* the loop's owner is
  (leech falls off against a low-health target; Kindling refund shrinks while you're
  winning), so the brake is invisible when you're even and firm when you're snowballing.

---

## Watch list (minor / tuning-era, not structural)

- **A14 (reward steers) — Hard Aperture** (Geometrician #6, a defensive hold that breaks on
  firing): in an aggression-first game, a strong not-fighting button mildly rewards
  turtling. Keep it a *tool*, not a *strategy* — if the optimal line is "hold the gate and
  wait," the reward is pointed the wrong way. Watch in tuning.
- **RPG "disclose before you commit" — loadout legibility:** the rack locks pre-bell, so the
  loadout must show each ability's actual *reading* (what it does + its feel), not just its
  name, before the player commits — otherwise they pick blind and learn by regret. "Full
  catalog visible day one" covers availability; confirm it covers *comprehension at commit*.

---

## Alignments — affirmed (do not second-guess these)

- **A13 (two audiences, don't average) — done well.** Recommended racks as one-tap apply
  (immersion / casual) **and** free pick + role-filter chips (optimizer) served as *distinct*
  layers, never a muddy compromise. Textbook A13. The soft-warn-never-block on an all-one-role
  rack is the right touch (a clue, not a wall).
- **A7 (discrete infinity) — the card pool nails the half the catalog is missing.** "A card
  earns its slot with four honest readings, not a fifth flavor of +damage"; "same mechanic
  refracted through the chassis verb, not a different card in disguise"; "catalog >> slots —
  if the catalog is still ≤3 you haven't designed enough tradeoffs." That *is* value-scales-
  with-combinations and omit-pain. D2's ask is to extend this same rigor from the card pool
  to the ability catalog's *balance*, where it's currently asserted rather than enforced.
- **A8 (fairness is perceived) — designed for.** Chassis identity non-obsolescence (each
  class keeps its sacred verb — Ward / slash+wave / parry+projectile / status) keeps the
  asymmetry legible; players can read *why* a class is different, which is what makes
  asymmetry feel fair instead of rigged.
- **A2 (ship missing, not broken) — the workboard obeys it.** Tiered build (ship the Wizard
  chassis with real depth first, gate Paladin/Priest behind it) is missing-not-broken
  discipline, not scope creep.
- **A14 (reward steers) — mostly aligned.** Overclock "ends early if you stop shooting,"
  Bleed Tithe "Devotion on tick," Second Wind "energy dump if you hit within 1.5s" — the
  resource economies pay for *engaging the fight*, which is the behavior the game wants.

---

## Per-class sweep — all four catalogs, ability by ability (2026-07-18)

The D2/D3 entries above named *examples*; this is the full comb of every catalog in
`class-ability-catalogs-v1.md`. Two findings here were **missed** by the representative
pass — flagged **[NEW]**.

### Geometrician (wizard)
- **D2 filler:** **Measure (#8)** — the catalog's own "cosmetic-heavy, small mechanical
  help"; dominated by Overclock (#7) as a buff pick. **Recoil Step (#10)** likely dominated
  by Slip Node (#9) — a small hop vs a 280px blink; needs an orthogonal reason (kite-specific
  payoff) or it's a second filler.
- **D3 brake:** **Return Glass (#5)** — parry → mana refund → more casts is a mild resource
  loop; watch, not urgent.
- **A14 watch:** **Hard Aperture (#6)** — a strong not-fighting hold in an aggression-first
  game (already on the watch list).
- **Verdict:** mostly orthogonal; one confirmed filler, one suspect, one mild loop.

### Interstice (ninja) — the cleanest catalog
- **D2:** no obvious filler — all ten differ in kind (two offense = execute vs sustain, two
  single = burst vs setup, two aoe = omni vs positional, two movement = decoy vs chase).
- **D3:** **Second Wind (#8)** and **Read Mark (#4)** self-fuel, but **both are hit-gated**
  (must connect to pay out) — that IS the difference-fed brake. Correct by construction.
- **Verdict:** closest to axiom-true. Affirm — use it as the template for the others.

### Kindled (paladin) — two structural gaps [NEW]
- **[NEW] Coverage-lock violation:** the file's own lock requires **≥2 primary tags per
  role**, but Kindled's catalog has **buff ×1 (Rally Light) and movement ×1 (Plant Charge)**.
  As tagged, two roles miss the floor — either add a second each or mark real multi-role tags.
- **[NEW] Solo-dead abilities (A8 / coverage):** **Aegis Share (#8)** and **Rally Light (#9)**
  are team-only (allies in ward shadow / allies in aura) with **no solo fallback noted** — in
  FFA solo they're near-dead picks. The Syzygist catalog was careful to give every team tool a
  solo fallback; Kindled was not. Fix: give Aegis/Rally a solo clause, or accept Kindled as a
  team-leaning class explicitly.
- **D3 brake:** **Retribution Edge (#2)** — block → amp + Kindling refund → more; the
  block-punish loop from the original audit. Needs a brake.
- **Verdict:** orthogonally fine, but the coverage floor and solo-viability need a pass.
- **Proposed fix (2026-07-18, Jake flagged "paladin doesn't have the same amount of abilities"):**
  close the roster to full coverage + solo-viability, grounded in heaven-tank / hold-the-board:
  - **Add a 2nd buff (solo) — "Kindled Resolve":** spend Kindling → self light-hardening
    (stagger-resist + small self-damage-amp). Gives the paladin a solo buff (Rally Light is
    team-only). buff → 2.
  - **Add a 2nd movement — "Bulwark Step":** short board-*facing* shuffle-reposition that keeps
    the Ward up (move without dropping the board) — orthogonal to Plant Charge's committed
    charge. movement → 2.
  - **Solo clauses for Aegis Share (#8) + Rally Light (#9)** (the Syzygist model): no allies →
    Aegis still feeds Kindling, Rally still self-buffs at reduced value. No dead solo picks.
  This closes Kindled to the ≥2-per-role floor + no-solo-dead, matching Syzygist, and is the
  **prerequisite for the paladin graphical centerpiece** (`presentation-overhaul-goal.md` P1 —
  you can't world-class-render an incomplete roster). Also note the **build** gap: Kindled is
  Tier 2 (gated) and ~60% the wizard's code depth — the roster must reach wizard-parity in
  *build*, not just doc, before the VFX pass fully lands.
- **RESOLVED (2026-07-18, coverage-floor + solo-viability fast-follow):** both structural gaps
  are shipped. Coverage: Kindled Resolve (buff #2, self-only, spends Kindling — the first Kindling
  SPEND site in the sim, previously a pure-generation resource) and Bulwark Step (movement #2, an
  input-facing shuffle, not aim-directed — orthogonal in trigger KIND to Plant Charge's aimed
  charge, per A7) land the catalog at 12/12, buff and movement both ≥2. Solo-dead: Aegis Share now
  searches for an ally inside the same radius it widens at cast time; none found → a flat Kindling
  tick to the caster instead of the previous no-op (window still opens either way — additive, the
  team behavior is unchanged). Rally Light turned out to have ALREADY shipped its own solo clause
  before this pass (`hasRallyLightSource` in World.ts checks the caster's own field first — a solo
  cast always benefits itself at full strength, not just allies) — code-verified via
  `kindledCatalog.test.ts`'s existing "solo-safe, no teamId needed" tests, which already covered
  and passed this; only Aegis Share needed new work. Retribution Edge's D3 brake (block → amp +
  Kindling refund loop, above) is explicitly **out of scope** for this fast-follow — untouched.
  See `docs/class-ability-catalogs-v1.md`'s Kindled table (now 12 rows) and constants.ts's
  KIN_KINDLED_RESOLVE_*/KIN_BULWARK_STEP_*/KIN_AEGIS_SHARE_SOLO_KINDLING_FEED header comments for
  the full numbers/reasoning.
- **CLOSED (2026-07-19, by removal, not by a fix):** Retribution Edge's D3 brake was never
  built — instead, Jake directed the ability cut from the catalog entirely, alongside
  Consecrated Field (cut for role redundancy against Shock Ring, an unrelated D2-adjacent
  reason — see `docs/class-ability-catalogs-v1.md`'s cut note). Kindled is back to 10/10
  (offense and aoe now 1-per-role each, an accepted consequence of this specific cut — buff
  and movement, the roles the 2026-07-18 fast-follow actually fixed, are untouched and stay
  at ≥2). This line item is closed; there is no more open D3 debt for Kindled.

### Syzygist (priest) — the D3 hotspot
- **D3 (compounding engine):** **Bleed Tithe (#1) + Contagion (#5) + Flock Pulse (#6)** don't
  just each self-fuel — they **amplify each other** (curse generates Devotion + lifesteal →
  Contagion spreads the curses → Flock Pulse scales with the curse count → more Devotion).
  Three mutually-reinforcing positive-constructive loops with no stated brake is the single
  worst A3 hotspot in the game. Fix: one shared stopping mechanism (diminishing Devotion /
  Flock scaling past N entangled) brakes all three at once.
- **Solo-viability — done right (affirm):** Borrowed Time / Glass Ward / Haste Gift all carry
  explicit solo fallbacks; Self-Lattice is a *deliberately* weak known soft spot (A8-legible).
  This is the model Kindled should copy.
- **[shares Kindled's] Coverage:** buff ×1 (Haste Gift), movement ×1 (Drift Step) — same
  ≥2-per-role gap.
- **Verdict:** solo design is exemplary; the triple-loop engine is the priority brake.

### Cross-class summary
| Class | D2 filler | D3 brake needed | Coverage / solo |
|-------|-----------|-----------------|-----------------|
| Geometrician | Measure (confirmed), Recoil Step (suspect) | Return Glass (mild) | OK |
| Interstice | — (clean) | hit-gated = self-braked | OK |
| Kindled | Aegis/Rally solo-dead — **RESOLVED 2026-07-18** | Retribution Edge — **CLOSED 2026-07-19 by removal (cut from catalog, not braked)** | **RESOLVED 2026-07-18: buff/movement now ×2; Aegis Share has a solo Kindling fallback; Rally Light was already solo-safe. Catalog is 10/10 as of the 2026-07-19 cut (offense/aoe now ×1 each, intentional)** |
| Syzygist | — | **Bleed+Contagion+Flock (compounding — priority)** | solo done right; buff×1, movement×1 |

**So: yes, now all four are combed** — and the sweep earned two findings the example-pass
missed (Kindled's coverage-floor miss and its solo-dead abilities), plus located the priority
brake (Syzygist's triple-loop) and the template class (Interstice).

---

## Game-wide sweep (beyond the class system, 2026-07-18)

Combed the rest of the game against the axioms; verified against docs/code:

- **Map generation — ALIGNED (A10 / shooter escape rule).** `map-design.md` enforces
  circulation loops, no dead ends, and reachability audits (`unreachablePlatforms`,
  perch checks). The "never trap a player, ≥2 approaches" rule is honored.
- **Chaos modifiers — ALIGNED (A6).** The seven modifiers are symmetric rule-changes
  that hit everyone equally and reroll each round — frequent, low-per-instance,
  emergence-not-dice. Textbook.
- **Bots — mild deviation (A11 / A12).** Fixed `slideTier` (nameCursor % 3) + fixed
  `aimErrorPx`; there IS crude newcomer-awareness (`freshAimErrorMul` 2.2 — bots aim
  worse at fresh humans) but no true resource-read DDA. Fix direction: read the human's
  score/health/streak and adapt (difficulty as a *query* over resources you already
  track — see the redesign vision, move 6).
- **First-blood wager — watch (A3).** `FIRST_BLOOD_SPEED_MULTIPLIER = 1.15` is unbraked
  within-round positive feedback (first hit → +15% speed → more hits); braked only at
  the macro level by pity-boss. Modest, but rich-get-richer inside a round.
- **Readability / feel — CONFIRMED deviations (A1 / A13, from `footage-removal-list.md`).**
  The arena backdrop out-shouts the fighters (A1 item), and remote players snap-then-
  freeze on interp starvation (B1). Both are "the read lost to decoration / to jitter" —
  the most *observable* deviations in the whole game.

## Where this points — the redesign vision

Every deviation above (and the three class-system ones) shares one root: **reaching for
depth by ADDITION** where the axioms describe depth by SUBTRACTION. That tension — and what
a JAKESJAM maximally true to the axioms would look like (one economy, four braked loops,
one orthogonal build language, fighters always loudest, complexity revealed at the player's
pace, difficulty read off resources) — is written up in **`docs/axiom-true-redesign-vision.md`**.
It's a mirror to build against, not a plan to execute.

## The one-line read

The systems are individually well-reasoned and several are textbook-correct (A13, A8, A2,
the card pool's A7, map-gen, chaos). The structural deviations are all **stack-level, not
part-level**: too many *loops at once* (D1), a specialization promise not yet
*balance-guaranteed* (D2), and in-round ability engines missing the *brake* the draft
already models at the roster level (D3) — plus the observable feel/readability leaks. None
require a redesign to *fix*; they point at one to *aspire* to.
