# Class overhaul — remaining work, broken into closable chunks

**Purpose:** a work-breakdown for parallel execution — sized so each chunk
is a self-contained brief a fresh agent (or a different AI entirely) can
pick up without needing this whole session's context. Dependencies are
marked explicitly. Canon: `docs/classes-goal.md`, `docs/character-sheets-
v1.md`, `docs/class-ability-catalogs-v1.md`, `docs/six-axes-goal.md`,
`docs/card-pool-v2.md`. Design reasoning: `docs/design-axioms.md` (the
generative levers) + `docs/axiom-deviations-audit.md` (where this system
currently deviates from them — READ IT, it binds the chunks below). Read
those before touching any chunk below — this doc is the map, not the spec.

**State as of 2026-07-18 (end-of-session update):** Tiers 0, 1, and 3 are
now DONE — Resonance (0.1), Emission class-awareness (0.2), Priest solo
floor (0.3), bot loadout awareness (0.4), team identity in the sim (1.1),
the loadout station's live catalog-browse UI (1.3), and all of Priest's
kit (3.1-3.4: Devotion, Ward, full 10-ability catalog) shipped and are
live. Tier 2 (Paladin) is fully done including the 2.6/2.7 fast-follow
notes below. Ninja/Interstice now has the full 10-of-10 catalog — Paper
Double (the decoy) shipped as its own fast-follow once its blocking
dependency (a new decoy entity type, `PaperDoubleEntity`/`state.
paperDoubles`) was actually built; the core ability (spawn/move/
damageable/expire/burst) is live, the Resonance-tier "Fooled" debuff and
the window-gated position-swap variant are both recorded v1 deferrals (see
cardTypes.ts's own updated header comment) — even though this catalog was
never its own workboard tier. The AOE role tag across all 4 classes was
reworked into real area effects (was projectile-burst spam). 1.2 (unified
resource pass) was deliberately NOT done — Kindling/Devotion/energy stay
separate `PlayerEntity` fields; see combat.ts/constants.ts doc comments
for why generalizing now was judged premature. **Remaining real work is
now defined by `docs/axiom-deviations-audit.md`'s D1/D2/D3 findings, not
by tiers below** — that audit supersedes this doc's Tier 4 for anything
it also covers (4.2/4.3 are done; 4.1 Ninja VFX and 4.4 balance pass are
still open, but D2/D3's specific fixes are higher-priority and more
concrete than either).

---

## Axiom deviations — cross-cutting constraints on the chunks below

From `docs/axiom-deviations-audit.md` (combed 2026-07-18 against
`design-axioms.md`). These are **stack-level design leaks**, not bugs — none
block the build, but every chunk they name must close its slice or the leak
ships. Each is a *constraint to satisfy*, not a new feature.

### AX.1 — Fold the loop count (binds 0.2, 1.2, 1.3) — A5
The player already juggles chassis base + rack rotation + Resonance window +
Emission charge + the draft + chaos/first-blood/sudden-death. That is well past
the ~4 *major* loops a player can hold, and it collides with the five-second
onboarding promise (A12). **Constraint:** when building the class resource pass
(1.2), decide whether the Emission charge is a *separate* meter from the class
0–100 pool or the **same** one — one meter learned once beats two juggled;
default to folding unless a doc reason says otherwise. When wiring Resonance
(0.1) and the loadout (1.3), keep the *decisions* a player makes per fight ≤4
(which rack / which target / when to E / when to draft) — make regen and
resonance detection legible-but-passive, not another timer to manage. **Accept
when:** a first-time player in round 1 is asked to actively track ≤4 things.

### AX.2 — Guarantee the rack can't collapse to one meta (binds 0.5, 1.3) — A7
"Pick any 3 of 10, pure freedom" only *asserts* that two same-chassis racks play
differently; nothing yet *enforces* it. **The per-class sweep is DONE — see the
per-class table in `axiom-deviations-audit.md`.** Concrete results to act on:
- **Geometrician:** re-job **Measure (#8)** (confirmed filler) and check **Recoil Step
  (#10)** vs Slip Node — give each an orthogonal reason or cut.
- **Kindled [NEW]:** coverage-lock **miss** — only **buff ×1, movement ×1** (spec requires
  ≥2 per role); and **Aegis Share (#8) + Rally Light (#9) are solo-dead** in FFA (team-only,
  no solo fallback). Add second buff/movement + solo clauses, or declare Kindled team-leaning.
- **Interstice:** clean — no filler. **Use it as the template.**
- **Syzygist:** solo design is the model (every team tool has a fallback); shares the
  buff×1/movement×1 coverage gap.
**Constraint:** add to 0.5 an **orthogonal-balance acceptance test** — no rack strictly
dominates; every ability is the best pick in *some* context; ≥2 per role actually met.
Design intransitivity in (rush > planted > zone > rush) so the meta *rotates*, not *solves*.
**Accept when:** ≥3 viable non-dominated racks per class, every ability appears in one, and
the ≥2-per-role floor holds for all four.

### AX.3 — Every self-fueling ability needs a difference-fed brake (binds 0.3, 0.5, 1.2, 2.x/3.x resources) — A3
The draft's catch-up weights brake the *roster* snowball (the model to copy), but
several *in-round* ability economies self-fuel with no brake the roster reaches
in time: **Bleed Tithe** (curse → Devotion + lifesteal → more curses), amplified
by Flock Pulse + Contagion; **Retribution Edge** (block → amp + Kindling → more).
In FFA this buries whoever loses the opening exchange before the draft can
rebalance. **The per-class sweep is DONE — priority order:**
- **Syzygist [HOTSPOT]:** **Bleed Tithe (#1) + Contagion (#5) + Flock Pulse (#6)** don't just
  each self-fuel — they *amplify each other* (curse → Devotion+lifesteal → Contagion spreads
  → Flock scales with count → more Devotion). One shared stopping mechanism (diminishing
  Devotion / Flock scaling past N entangled) brakes all three at once — do this in 0.3 / 3.2.
- **Kindled:** **Retribution Edge (#2)** block→amp+Kindling loop — brake in 2.3.
- **Geometrician:** **Return Glass (#5)** mild mana loop — low priority.
- **Interstice:** Second Wind / Read Mark self-fuel but are **hit-gated = already braked** — no
  action; this is the pattern to copy (gate the payout on landing a hit).
**Constraint:** when building each resource (0.3, 1.2, 2.3, 3.2), name each self-improving
loop's brake — a stopping mechanism, a slow cycle, or a cost rising with the loop's own
output — and prefer **difference-fed** brakes (leech falls off vs. low-health targets;
refunds shrink while you're ahead). **Accept when:** no ability's economy compounds
unboundedly within a single round.

---

## Tier 0 — buildable RIGHT NOW, zero dependencies

These don't wait on P2, duos, or anything else in flight. Best chunks to
hand off immediately.

### 0.1 — Resonance system (class-agnostic, high value)
**Confirmed fully unbuilt** (`grep -rn "resonance" client/src server/src`
returns nothing but an unrelated audio comment). This is the "chain
unlike abilities for a bonus" system from `docs/classes-goal.md`'s
Rotation section — testable RIGHT NOW against Wizard's existing 15
abilities (5 six-axes + 10 Geometrician catalog), no other class needed.
Scope: per-ability "resonance window" state (~2s) on cast, a DIFFERENT
ability cast inside the window consumes it for a bonus (empowered effect
/ partial CD refund / emission-flavored rider — pick one v1 shape and
document it), sim-authoritative (predicted, wire-visible), TS+Zig parity
if it crosses the ABI (check whether ability state already crosses it via
the six-axes work — likely yes). This is the single best isolated chunk
in the whole board.

### 0.2 — E-key ultimate = Emission, verify/complete
The locked ruling: charged ultimate IS the composed Emission through the
equipped card hand (`docs/classes-goal.md` §"E-KEY RULING"). `emission.ts`
already exists and is wasm-parity-tested — but does it currently read
`classId` / compose class-flavored casts, or is it still the pre-class-era
"one emergent shape" only? **Investigate first, then close whatever gap
is found.** If it's already class-aware because of this session's
`classModifiers` infrastructure, this may be mostly documentation/testing
work, not new code. If it's genuinely unaware, wire it through — additive
only, respect the "no bespoke per-category shapes" doctrine in
`emission.ts`'s own header.

### 0.3 — Priest's solo floor (curses + lifesteal)
`docs/classes-goal.md`: Priest's FFA-viability floor is curses + lifesteal
— this does NOT require teammates, unlike the rest of the kit. The status-
effect substrate (burn/freeze/slow) already exists; a debuff-flavored
"curse" card and a lifesteal passive are buildable against Priest's
baseline (detuned Wizard bolt, itself near-free via `classModifiers`) without
waiting for the Duos queue or a heal/buff verb. Small, real, unblocks
nothing else but ships something.

### 0.4 — Bot loadout tables
Flagged as an open item in `class-ability-catalogs-v1.md`. Bots today
don't know how to use drafted/catalog abilities at all — they fight with
whatever the old card-pool AI logic does. Scope: teach `worldBots.ts` to
recognize equipped ability slots and press them with basic heuristics
(off cooldown + a target in range = press). Class-agnostic infrastructure;
useful the moment ANY class has abilities (Wizard already does).

### 0.5 — Sim balance/tuning pass on what's already shipped
Every number in `card-pool-v2.md` and the ability catalogs is explicitly
first-draft. The 7 Wizard cards + 10 Geometrician abilities are live
enough to tune for real (bot-vs-bot sims, `resimReplay.ts` tooling if it
still exists, or scripted measurement like this session's movement-harness
work). Not urgent, but genuinely closable without any dependency.

---

## Tier 1 — unblocks multiple later chunks (do these next)

### 1.1 — Team identity threading into the sim
**The real prerequisite chunk.** The Duos queue (in flight) was
deliberately scoped to stop at "protocol field added, not consumed" —
sim-authoritative team logic was explicitly out of that agent's scope.
But BOTH Paladin's team-peel (chunk 2.4) and Priest's ally-targeting
(chunks 3.3/3.4) need the sim itself to know who's on whose team. Scope:
take whatever `teamId`-shaped field the duos-queue chunk added to the
wire protocol and thread it into `PlayerEntity`/`WorldState` (additive,
same discipline as `roundKills`), Zig-mirrored if it crosses the ABI.
Do NOT build friendly-fire rules or team scoring here — just "the sim can
answer `isAlly(a, b)`." **Read the duos-queue agent's final report before
starting — it will say exactly how far the field already reaches.**

### 1.2 — Class resource system, unified pass
Four resources exist only as scattered per-class specs right now (mana,
energy — build via P2, resolve — needs Kindling from Paladin, devotion —
needs Priest). Worth a chunk that generalizes: one resource-pool
abstraction on `PlayerEntity` (already partially the `abilityCharge`
field per canon), with class-flavored regen sources as data, not four
independent bespoke implementations. If P2's energy work already did this
generically, this chunk becomes "confirm and extend," not "build from
scratch" — check before assuming greenfield.

### 1.3 — Loadout station multi-pick UI
Today's station picks ONE card per visit (confirmed in this session's own
screenshots/reports). The class era needs it to eventually support
picking from a 10-ability catalog into 3 rack slots, not just one starter
card. Scope: extend `CardDraftOverlay`/`HangoutScene`'s station flow to
support multi-slot selection — UI-heavy, sim-light, low collision risk
with anything else on this board.

---

## Tier 2 — Paladin / Kindled (P3), gated on P2 landing

Do not start until P2 (Ninja melee core) is confirmed shipped and
verified — Paladin's melee explicitly reuses that primitive per canon
("P3 reuses P2's melee core"). Building in parallel duplicates work.

### 2.1 — Kindled Edge (melee reuse)
Adapt P2's arc-hit-detection with Paladin's numbers (tighter arc, harder
hit, per `docs/classes-goal.md`). Should be a thin layer over the P2
primitive, not a reimplementation — if it isn't thin, something about P2
wasn't built generically enough; flag that rather than forking silently.

### 2.2 — Kindled Ward (shield-board)
Directional block, frontal only, generates Kindling on absorb. New
mechanic — hold-input gated block angle/direction detection, damage
mitigation while held, distinct from the existing parry (`combat.ts`'s
`tryDeflectDamage` — study it, this is adjacent but not identical: parry
is a timed window, ward is a sustained directional hold). Parity-critical
if it crosses into hit resolution — treat with P2-grade discipline.

### 2.3 — Kindling resource
Blocked-damage-generates-resource. Depends on 2.2 existing and ideally
on 1.2's unified resource pass landing first.

### 2.4 — Team peel (block for allies in ward shadow)
**Depends on 1.1 (team identity in sim).** Detect an ally standing in the
ward's frontal cone, extend mitigation to them. Solo-useless without 1.1;
don't attempt without it.

### 2.5 — Ultimate: Unveiling
Depends on 0.2 (E-key/Emission system) being complete — Kindled's
ultimate is the Kindled kit transfigured through the emission composer,
same mechanism every class uses.

### 2.6 — Wire Paladin's cards + catalog — DONE (2026-07-18 fast-follow)
Kindled's 10-ability catalog is now complete: the original pass shipped 7
(Unbroken Seal, Sunspike, Judgment Line, Consecrated Field, Bastion Pulse,
Aegis Share, Plant Charge); this fast-follow added the 3 it deferred
(Retribution Edge, Shock Ring, Rally Light — see cardTypes.ts's AbilityKind
header comment). The 3 draft-pool exclusives (Crater, Retort, Bastion,
card-pool-v2.md #26-28) are wired too. Universal-card "Paladin:" expressions:
7 of the doc's "11" now exist (seeker-facets, cluster-bomb, molten-core,
frost-prism, crystal-plating, spring-heel from earlier chunks + double-jump/
Second Wind's "stomp-jump" from this fast-follow) — the remaining ~4 were
outside this chunk's assigned scope (Second Wind was the one specifically
handed off) and stay open for a future pass. Rally Light needed no
cross-player write in the end (read-only continuous aura — see
constants.ts's KIN_RALLY_LIGHT_* comment); Retribution Edge/Shock Ring/
Crater are self-only. Full test coverage in kindledCatalog.test.ts.

### 2.7 — Heaven-tank VFX pass — PARTIAL (2026-07-18 fast-follow)
Gold-forward per the locked DI-Crusader-feel/Autogenes-source reframe.
`ward-absorbed` (self-block) and `team-peel-absorbed` (peel — flashes at
the WARDER, distinct from self-ward's blocker-position flash) now get a
real gold flash (`RenderLayer.spawnExplosionBlastBig`, house gold
`0xc9a84c`) + a small local shake, wired through `SimEventRouter`/
`OnlineMatchScene.spawnWardAbsorbFlash`. No audio: no ripped "shield-board
catches a hit" asset exists in this project (hard rule — never synthesize),
so both stay visual-only. `syz-ward-absorbed` (Syzygist, cool-white) is
still untouched — out of scope for this Paladin-only pass, left for a
future Syzygist VFX chunk. Kindled Edge/Ward/Unveiling's OWN juice (block
thunk, edge scrape, ult flood) is still unbuilt beyond this absorb-flash
slice — a fuller pass remains open.

---

## Tier 3 — Priest / Syzygist (P4), gated on Duos queue + 1.1

Priest never ships into pure FFA (locked call). Chunk 0.3 (solo floor)
can start now; everything else waits on the Duos queue confirming and
1.1 landing.

### 3.1 — Status substrate extension (buffs, not just debuffs)
Existing substrate: burn/freeze/slow (all debuffs). Priest needs regen,
haste, and generic buff application on ALLIES — new `PlayerEntity` fields,
Zig-mirrored if wire-visible (it will be). This is real parity-grade sim
work, comparable in care-level to P2 though smaller in surface area.

### 3.2 — Devotion resource
Generated by buff/heal uptime ON OTHERS (not self) — needs to count
"how many other players currently carry my effects," a genuinely new
kind of resource-generation rule (not hit-based like energy/resolve).
Depends on 3.1 existing (can't count buff-uptime before buffs exist).

### 3.3 — Wards defense verb
Small absorb barriers, castable on allies. Depends on 1.1 (targeting an
ally requires the sim to know who's an ally) and 3.1 (barrier-as-buff
substrate).

### 3.4 — Wire Priest's cards + catalog
The 3 exclusives (Borrowed Time, Contagion, Flock), universal card
"Priest:" expressions, and Syzygist's 10-ability catalog (Bleed Tithe,
Severance, Borrowed Time, Focus Hex, Contagion, Flock Pulse, Self-Lattice,
Glass Ward, Haste Gift, Drift Step). Depends on 3.1-3.3.

### 3.5 — Color-slot decision + cool-white VFX pass
Open question flagged in `docs/character-sheets-v1.md`: Syzygist's
cool-white vs. the doctrine's reserved violet ("future void/defense")
slot — needs a explicit call before any art starts. Flag for a human
decision, don't just pick one silently.

---

## Tier 4 — cross-cutting polish (any time, low priority)

- **4.1 Ninja/Interstice VFX pass** — hit-stop, scrape SFX, wave visual.
  P2 was explicitly told sim-first/minimal-render; this is the fast-follow
  render pass once the verb is confirmed feeling right.
- **4.2 Nameplate status legibility** — spectator-visible tells for the
  new window-bearing buffs (flagged as a known gap by the Geometrician
  catalog chunk — action-bar cooldowns are covered, nameplate chips
  aren't).
- **4.3 Action-bar glyph art** — the 10 Geometrician abilities render with
  a generic fallback dot glyph today; bespoke iconography is cosmetic
  polish, do last.
- **4.4 Full sim numbers pass across all four classes** — once everything
  above ships, a real balance/tuning session against actual play data,
  not first-draft guesses.

---

## Suggested split for tandem work

If running two AIs/agents in parallel from here: one takes **Tier 0**
top-to-bottom (all independent, no coordination needed), the other takes
**Tier 1** (unblocks the most later work). Do not start Tier 2 until P2
is confirmed shipped; do not start Tier 3 beyond 0.3 until the Duos queue
is confirmed shipped AND 1.1 lands. Every chunk should get the same
treatment this session established: full test suites, both typechecks,
Zig build+test where sim/src is touched, classId-gating proven with a
test (not just claimed), and an honest report of what got skipped and why
rather than padded/faked progress.
