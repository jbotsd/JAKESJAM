# Card Pool v2 — the ~30 for the class era

**Status:** Design draft (authoring pass, 2026-07-17). Companion to
`docs/classes-goal.md` (the chassis + C1-C4 contract — this doc IS the C1
deliverable), `docs/emission-engine-goal.md` (composition law; card
mechanics defer to it on conflict), `docs/six-axes-goal.md` (the keys-1-4
rack surface). Movement numbers referenced throughout are the MEASURED
canon: jump apex 134px, run 362px/s, dash 940px/s, wall-kick 173px rise /
427px carry, slopes 2:1 and 45° only, launch pads at diagonal-chain bases.

---

## Pool philosophy (read before the cards)

**Depth over count.** Thirty-one cards, every one expressing per-chassis —
~120 effective identities through the Emission Engine's composition law
(C1). A card earns its slot by having FOUR honest readings, not by being a
fifth flavor of "+damage." Any card whose Wizard/Ninja/Paladin/Priest lines
collapse into the same sentence four times was cut (see appendix).

**One card, four readings.** Universal cards state all four class
expressions explicitly. The class expression is never a different card in
disguise — it is the SAME mechanic refracted through the chassis verb
(a nova through a blade is a spin-slash; through a board it is a quake).

**Rebirth, not port (C2).** Beloved lineages return — bounce, homing,
split, elements, shape-rounds, drain — renamed, re-statted, per-class
expressed. Lineage is noted in each Concept line. No card ports untouched;
the five shipped actives (Crimson Tithe et al.) are superseded by this
pool, their concepts absorbed where they earned it.

**Slot-type vocabulary.**
- **ability** — fills one of the keys-1-3 rack slots (exactly 3 slots;
  catalog is larger — pick and choose; see `docs/classes-goal.md`). Costs class resource
  (mana/energy/resolve/devotion, one 0-100 pool per canon) AND a cooldown
  in the 3-9s register. Leaves a resonance window (1.5-2.5s); casting a
  *different* ability into any live window consumes it for the listed bonus.
- **spec** — mutates an existing slot or chassis verb. Attached at draft
  time to a declared legal target (primary and/or a filled ability slot);
  sticky for the run. No cost, no cooldown — specs are what the resource
  and clock act *through*.
- **passive** — body/economy. Always on.

**Offer weighting (for the draft's offer logic).** Round 1-3 offers weight
**ability** cards heavily while rack slots are empty (an empty rack is a
mute rotation); **spec** cards weight up as slots fill (a spec with no
target is a dead offer — never offer a slot-targeted spec to an empty
rack); **passives** run flat all game as the safe floor pick. The 10/11/10
ability/spec/passive spread below exists to make that curve satisfiable.

**Tone (C4).** Names plain and punchy, lore spent sparingly, never
transgressive. Effects balance insidious ↔ epic, weighted per class:
priest unsettling-benevolent, ninja insidious-precise, paladin
epic-liturgical, wizard technical-awesome. Every card carries a visual
read for the deferred VFX pass; all visual reads obey IDENT-GRAMMAR (no
Eye-of-Providence composition, no triangle-capping-ring geometry, no
hexagram/pentagram, accidental composites included).

**Numbers disclaimer.** Every damage/duration/CD/mana value here is a
FIRST DRAFT calibrated against the measured registers (baseline hit
~10-15, TTK ~2.5s sustained, hp 85/100/100/125, emission budget 70, no
100-0 ever). Playtest will move them. **The SHAPES are the design** — if a
number moves, the reading it serves must survive the move.

---

## Table of contents

| # | Card | Rarity | Slot type | Scope |
|---|------|--------|-----------|-------|
| 1 | Shard Nova | common | ability | universal |
| 2 | Echo Bolt | common | ability | universal |
| 3 | Backdraft | common | ability | universal |
| 4 | Sky Hook | uncommon | ability | universal |
| 5 | Snare Glyph | uncommon | ability | universal |
| 6 | Undertow | uncommon | ability | universal |
| 7 | Ricochet | common | spec | universal |
| 8 | Splinterhead | uncommon | spec | universal |
| 9 | Grudge | rare | spec | universal |
| 10 | Cinder | uncommon | spec | universal |
| 11 | Hoarfrost | uncommon | spec | universal |
| 12 | Stormseed | rare | spec | universal |
| 13 | Long Echo | uncommon | spec | universal |
| 14 | Plating | common | passive | universal |
| 15 | Fleet Soles | common | passive | universal |
| 16 | Spring Heel | common | passive | universal |
| 17 | Second Wind | rare | passive | universal |
| 18 | Deep Well | common | passive | universal |
| 19 | Tithe | rare | passive | universal |
| 20 | Sunlance | rare | ability | exclusive: Wizard |
| 21 | Overchannel | uncommon | spec | exclusive: Wizard |
| 22 | Refraction | uncommon | passive | exclusive: Wizard |
| 23 | Paper Double | rare | ability | exclusive: Ninja |
| 24 | Undercut | rare | spec | exclusive: Ninja |
| 25 | Slipstream | uncommon | passive | exclusive: Ninja |
| 26 | Borrowed Time | rare | ability | exclusive: Priest |
| 27 | Contagion | rare | spec | exclusive: Priest |
| 28 | Flock | uncommon | passive | exclusive: Priest |

**Composition:** 28 cards — 19 universal / 9 exclusive (3 per class:
Wizard/Ninja/Priest). Paladin's own 3 exclusives — Crater (rare, ability),
Retort (uncommon, spec), Bastion (uncommon, passive), formerly #26-28 —
were built, then cut entirely 2026-07-19: they were classId:"paladin"-
gated the same way as the real 10-ability Kindred rack catalog
(docs/class-ability-catalogs-v1.md), so they leaked into the loadout
station's own full-catalog query as 3 extra cards, showing 13 total
instead of a true 10 (a live-playtest bug Jake caught, not a "bonus picks"
feature — no other class gets one). See the cut Paladin section below.
8 common / 11 uncommon / 9 rare; 9 ability / 10 spec / 9 passive.

---

## Universal abilities

### Shard Nova  [common]  [universal]
**Concept:** The panic ring — reborn from Shard Bloom. Point-blank burst
everyone understands in one frame.
**Effect:** 360° burst around the caster: 18 damage, 110px radius, 260px/s
outward knockback. Cost 25, CD 5s.
**Per-class expression:**
- Wizard: a ring of crystal shards snapped outward from the vessel — the
  textbook cast.
- Ninja: a full-circle blade spin; the nova counts as a melee hit (feeds
  energy regen on connect).
- Paladin: a board-slam quake — the ring travels along the ground and is
  larger vs grounded targets (130px), weaker vs airborne (90px).
- Priest: a repelling chime — 12 damage only, but allies inside are
  cleansed of one debuff (solo: cleanses self).
**Resonance:** Leaves *Rung* (2.0s) on everyone struck. Cast into any live
window: radius +40% and refunds 15 resource.
**Slot type:** ability.
**Insidious↔epic reading:** Honest epic — the room-clearer with no fine
print. The pool's baseline "fair" card.
**Visual read:** One crisp expanding faceted ring, class-tinted rim,
single pulse then gone. Silhouette = a perfect circle; readable from any
distance at any speed.

### Echo Bolt  [common]  [universal]
**Concept:** The shot that comes back — reborn from Boomerang Prism.
**Effect:** Bolt flies 340px then hairpins home: 12 damage outbound, 12 on
return (same victim twice = second hit 8). Returns through walls it
cleared going out. Cost 20, CD 4s.
**Per-class expression:**
- Wizard: a glass bolt that visibly refracts at the turnaround point.
- Ninja: a thrown short-blade; catching the return restores 5 energy
  (aggression feeds the rack).
- Paladin: a hurled weight — slower, 1.3× size, 14 damage per leg; the
  return leg shoves (140px/s).
- Priest: a passed blessing — heals allies it crosses for 6 per leg,
  harms enemies 10 per leg (solo: it's just a slow mean bolt).
**Resonance:** Leaves *Marked* (2.5s) on outbound victims. Cast into a
live window: the bolt forks into two on the return leg.
**Slot type:** ability.
**Insidious↔epic reading:** Quietly insidious — a poke that lies about
being over. Punishes the chase reflex.
**Visual read:** A bright bolt with a legible hairpin turn; the trail
folds back along itself so the double-threat reads before it lands.

### Backdraft  [common]  [universal]
**Concept:** The shove — knockback identity reborn from Square Rounds
("mass over manners").
**Effect:** 90° cone, 150px: 8 damage + 420px/s impulse (beats run 362 —
enough to push someone off a commit, under dash 940 so it never outruns a
reaction). Cost 20, CD 5s.
**Per-class expression:**
- Wizard: a flat force clap — pure geometry.
- Ninja: a palm strike; the equal-and-opposite reaction hops the ninja
  120px backward (disengage both directions at once).
- Paladin: a board check — impulse 500px/s and a 0.3s stagger at point
  blank (≤60px).
- Priest: a repentance gust — enemies shoved; allies caught in the cone
  are nudged 80px *away from the nearest enemy* and healed 4.
**Resonance:** Leaves *Staggered* (1.5s). Cast into a live window: shove
distance +50%.
**Slot type:** ability.
**Insidious↔epic reading:** Insidious in map language — the pit does the
killing; this card just files the paperwork.
**Visual read:** A flat rectangular pressure wave (the square lineage
tell), dust lines along the floor, victims' motion trails visibly bend.

### Sky Hook  [uncommon]  [universal]
**Concept:** Movement as a spell — a thread to a surface.
**Effect:** Fire a filament at aim; if it finds terrain within 320px, pull
yourself there (arrival speed capped 620px/s — between run 362 and dash
940; momentum carries on release). Grants vertical reach above the 134px
jump apex and between wall-kick chains (173/427) — an ability-gated route
tool, not a free pass. Cost 25, CD 7s.
**Per-class expression:**
- Wizard: a line of light, clean arc, textbook traversal.
- Ninja: a true grapple — may also hook an ENEMY within 240px, pulling the
  ninja *to them* (melee delivery; never yanks the victim).
- Paladin: a heavy chain — self-pull only 260px, but aimed at an enemy it
  drags THEM 140px toward the board instead.
- Priest: a raptor thread — may target an ALLY, pulling the priest to
  them (peel/heal delivery). Solo: terrain only.
**Resonance:** Leaves *Tethered* (2.0s) on self. Cast into a live window:
range +120px and CD −2s.
**Slot type:** ability.
**Insidious↔epic reading:** Technical-epic — the arena's geometry becomes
part of your rotation.
**Visual read:** A single taut luminous filament, then gone; the body
follows in one clean arc. The line itself is the telegraph.

### Snare Glyph  [uncommon]  [universal]
**Concept:** The trap — rotations extended across time.
**Effect:** Place a 130px floor glyph (0.6s arm, 8s life, max 2 armed).
Trigger: 14 damage + heavy slow (0.35× move, 1.2s). Cost 30, CD 8s.
**Per-class expression:**
- Wizard: an etched rune circle — visible, honest area denial.
- Ninja: a tripwire — the glyph renders to enemies only within 160px
  (insidious-precise; spectators and the owner always see it).
- Paladin: consecrated ground — a triggered glyph also grants the paladin
  10 resolve (the trap tithes to the engine).
- Priest: a false font — shimmers like a pickup to enemies; trigger deals
  10 + *Weaken* (−15% damage dealt, 2s) instead of the slow.
**Resonance:** A trap trigger COUNTS as an ability cast: it leaves
*Snared* (2.0s) on the victim, openable by your other abilities — the trap
is a rotation you planted earlier.
**Slot type:** ability.
**Insidious↔epic reading:** The most insidious universal in the pool —
kept fair by the arm delay and the max-2 cap.
**Visual read:** Thin light seams etched in the floor; triggering snaps a
brief cage of light upward. The priest's false-font shimmer is a distinct
(wrong) pickup color on close read — deception with a tell.

### Undertow  [uncommon]  [universal]
**Concept:** Thick air — reborn from Slow Field + Zero-G Floaters, fused
into one zone verb.
**Effect:** Lob an orb; on land, a 150px zone for 3s: enemies inside move
at 0.55×, enemy projectiles crossing it slow to 0.7×. No damage. Cost 35,
CD 8s.
**Per-class expression:**
- Wizard: crystal fog — projectile drag doubled (0.5×) inside.
- Ninja: smoke — homing/seeker effects lose lock while their target is
  inside.
- Paladin: the weight of law — enemies inside also deal −10% damage.
- Priest: a slow hymn — allies inside move +10% instead of slowed.
**Resonance:** Doesn't leave a window (a zone is not a cast on a target —
justified: zones already bend time). Instead, resonance windows held by
enemies INSIDE the zone decay 0.5s slower — the zone is resonance
support, thickening your rotation clock.
**Slot type:** ability.
**Insidious↔epic reading:** Unsettling — the air itself takes a side.
Zero damage keeps it benevolent-shaped; the kills it causes are yours.
**Visual read:** A heavy translucent dome of slow drifting motes;
everything inside is visibly *late* — trails stretch, shots wade.

---

## Universal specs

### Ricochet  [common]  [universal]
**Concept:** Reborn from Bouncy Prism / +1 Bounce — walls are just more
aim.
**Effect:** Attach to primary or a filled ability slot: its projectiles
gain +2 wall bounces; damage +8% after the first bounce (brighter after
each bounce — the lineage tell). Waves/arcs rebound once at mirrored
angle.
**Per-class expression:**
- Wizard: classic ricochet shots — corridor ownership.
- Ninja: the slash wave rebounds off its first wall, coming back through
  the doorway they thought was safe.
- Paladin: slam/shock effects skip once off walls (Shock Ring's slam
  folds back into the room — the example used to be Crater's ring until
  that card was cut 2026-07-19).
- Priest: bolts bounce; a bounced bolt crossing an ally transfers a
  4-point heal in passing.
**Resonance:** None — a geometry card, deliberately clean of the clock
(commons should leave the resonance grammar uncluttered). Its rotation
value is indirect: bounce angles make window follow-ups land.
**Slot type:** spec.
**Insidious↔epic reading:** Neutral-technical — the arena is the
co-author.
**Visual read:** Hard angular deflections, trail brightening per bounce.
The brightening IS the damage read.

### Splinterhead  [uncommon]  [universal]
**Concept:** Reborn from Cluster Bomb — impact has children.
**Effect:** Attach to primary or a filled ability slot: first impact
splits 3 child shards (5 damage each, 240px range, 40° fan).
**Per-class expression:**
- Wizard: crystal children in a clean fan.
- Ninja: the wave shatters into needles on its first wall or victim.
- Paladin: slam impacts throw stone chips — his melee arc gains a ranged
  echo.
- Priest: a thorn burst; children that touch allies become 3-point heal
  motes instead of shards.
**Resonance:** Children inherit the parent ability's resonance tag at
half window (1.0s) — splinters spread the clock thinner but wider.
**Slot type:** spec.
**Insidious↔epic reading:** Epic firework, insidious arithmetic — the
stray child kills more than the parent.
**Visual read:** One clean pop into three dimmer traces; parent stays
brightest so the hierarchy reads.

### Grudge  [rare]  [universal]
**Concept:** Reborn from Seeker Facets — it remembers the slight.
**Effect:** Attach to primary or a filled ability slot: projectiles gain
capped-turn homing (≈4.4 rad/s — assists, never auto-wins), −10% damage.
**Per-class expression:**
- Wizard: shots curve toward the nearest foe.
- Ninja: the slash wave bends mid-flight toward its victim.
- Paladin: (melee can't home) — arc forgiveness instead: enemies within
  40px of the swing's edge count as hit.
- Priest: bolts seek enemies AND heals seek allies — dual homing, the
  full shepherd read.
**Resonance:** Homing attacks striking a target who holds YOUR live
window turn +30% harder — the grudge deepens inside the window.
**Slot type:** spec.
**Insidious↔epic reading:** Insidious-patient — the shot that will not
let it go.
**Visual read:** The trail writes a visible curve; a faint tag-line links
shot to current target so the assist is honest.

### Cinder  [uncommon]  [universal]
**Concept:** Fire element reborn from Molten Core.
**Effect:** Attach to primary or a filled ability slot: hits ignite —
burn 3/s for 2s (re-application refreshes, never stacks).
**Per-class expression:**
- Wizard: fire shots, molten trails — zone control with heat.
- Ninja: a burning edge — the wave leaves a 1s flame line on the ground
  along its path.
- Paladin: the brand — burning enemies take +10% from paladin melee.
- Priest: fever — burn on enemies also reduces healing they receive by
  30% (the unsettling-benevolent inversion: the priest decides who gets
  to be healed).
**Resonance:** Casting into a window held by a BURNING target adds a
6-damage flare on consumption.
**Slot type:** spec.
**Insidious↔epic reading:** Epic on the wizard, insidious on the priest —
the same flame, two sermons.
**Visual read:** Ember tail; victims smolder at the silhouette rim. The
priest's fever burn is paler — visibly *wrong* fire.

### Hoarfrost  [uncommon]  [universal]
**Concept:** Ice element reborn from Frost Prism.
**Effect:** Attach to primary or a filled ability slot: hits chill —
0.8× move for 1.2s; three chill applications within 2.5s = brittle-freeze
(0.5s, no actions; hard cap once per target per 6s).
**Per-class expression:**
- Wizard: freezing facets — lock movement, then finish.
- Ninja: cold edge — chilled victims' resource regen pauses 1.5s
  (insidious-precise: freeze the rotation, not just the feet).
- Paladin: frost brand — chilled enemies deal −10% damage.
- Priest: cold comfort — chills enemies; allies struck instead gain a
  5-point frost ward (their defense verb, briefly, from your gun).
**Resonance:** Consuming a window on a chilled target deep-freezes 0.5s
regardless of stack count (the rotation IS the third stack).
**Slot type:** spec.
**Insidious↔epic reading:** Balanced — clean epic control on wizard,
regen-theft insidiousness on ninja.
**Visual read:** Crystalline rime creeping over the victim's silhouette;
brittle-freeze reads as a full ice-crust flash.

### Stormseed  [rare]  [universal]
**Concept:** Lightning element reborn from Voltaic Spark — the crystal
kept the storm.
**Effect:** Attach to primary or a filled ability slot: hits arc to one
extra target within 200px for 60% damage (one arc per hit, no chains of
chains).
**Per-class expression:**
- Wizard: chain lightning, textbook and terrifying.
- Ninja: static edge — melee hits bank a charge; the next wave arcs
  twice instead of once.
- Paladin: thunder oath — blocked hits (shield-board) discharge 8 damage
  to the nearest attacker within 160px: his DEFENSE arcs.
- Priest: nerve jolt — the arc also carries a 4-point heal to the
  nearest ally within 200px (one bolt, two congregations).
**Resonance:** The arc carries the parent ability's resonance tag to its
secondary target — windows spread down the wire.
**Slot type:** spec.
**Insidious↔epic reading:** Technical-awesome — the paladin's blocked-hit
discharge is the epic-liturgical version of "no."
**Visual read:** One jagged bright arc between bodies, a beat after the
primary hit — the delay makes cause-and-effect legible.

### Long Echo  [uncommon]  [universal]
**Concept:** The metronome — a spec on the Resonance system itself.
**Effect:** All your resonance windows last +0.8s (2.0 → 2.8 typical) and
consumed bonuses are +15% stronger.
**Per-class expression:**
- Wizard: landing a primary hit during a live window extends it +0.3s —
  the cast-weave loop made literal.
- Ninja: each melee hit during a window extends it +0.2s (max +1.0s) —
  the string holds the note.
- Paladin: a block during a window extends it +0.4s — patience is
  rhythm.
- Priest: each buff/heal tick on an ally holding your window extends it
  +0.2s — uptime is rhythm.
**Resonance:** This IS the resonance card — it modifies the clock rather
than riding it.
**Slot type:** spec (targets the player's resonance grammar, not a slot).
**Insidious↔epic reading:** Pure technical — invisible to victims, huge
to pilots. The card that separates rotation players from button players.
**Visual read:** Window rings on targets render visibly wider with a
trailing afterimage — the extended clock is drawn, not implied.

---

## Universal passives

### Plating  [common]  [universal]
**Concept:** Body — reborn from Crystal Plating. More of you to fight
for.
**Effect:** +20 max health, −3% move speed.
**Per-class expression:**
- Wizard: 100 → 120 — the comfortable middle thickens.
- Ninja: 85 → 105 — buys a mistake, visibly bulkier (the small-silhouette
  read dulls slightly: a real cost).
- Paladin: 125 → 145 — the wall gets taller.
- Priest: 100 → 120 — harder to punish for watching allies instead of
  the crosshair.
**Resonance:** None — body card; passives keep the clock clean.
**Slot type:** passive.
**Insidious↔epic reading:** Honest epic bulk. The floor pick that is
never a trap.
**Visual read:** Faceted crystal plates on the rig + a longer health
bar. Armored looks armored.

### Fleet Soles  [common]  [universal]
**Concept:** Speed — reborn from Sprint Coils.
**Effect:** +8% run speed (362 → ~391 measured; still far under bullet
speeds, dodge economy intact).
**Per-class expression:**
- Wizard: repositioning between weaves comes free-er.
- Ninja: on the 1.14× chassis this stacks to the fastest thing in the
  arena — the class fantasy, sharpened.
- Paladin: 0.88× chassis relief — the wall arrives sooner than expected
  (the surprise IS the value).
- Priest: keeps pace with the protected; positioning is his real weapon.
**Resonance:** None — body card.
**Slot type:** passive.
**Insidious↔epic reading:** Neutral. Speed is whatever you spend it on.
**Visual read:** Heel light-trails; footfall ticks brighten. Fast reads
fast.

### Spring Heel  [common]  [universal]
**Concept:** Vertical reach — reborn from Spring Heel (the name survives;
nothing else does).
**Effect:** +10% jump velocity (apex 134 → ~162px) and +10% wall-kick
(rise 173 → ~190). Opens routes above the ≤93%-of-apex terrain-step norm;
never closes any (extra apex only ever adds reachability).
**Per-class expression:**
- Wizard: high perches become weave platforms.
- Ninja: wall-kick chains compound — a two-kick route becomes a
  one-kick route.
- Paladin: the slam class gets to pick higher places to arrive from.
- Priest: the overwatch position — see the whole flock.
**Resonance:** None — body card.
**Slot type:** passive.
**Insidious↔epic reading:** Neutral-technical; the map is the payoff.
**Visual read:** Coiled light at the ankles on launch; the taller arc
itself is the read.

### Second Wind  [rare]  [universal]
**Concept:** The air jump — reborn from Second Wind ("who said one?").
**Effect:** +1 air jump (full 134px-class apex, refreshed on landing or
wall contact).
**Per-class expression:**
- Wizard: a glyph flickers underfoot at the second jump.
- Ninja: a mid-air flip — combined with wall-kicks (173/427) the ninja
  simply stops touching the ground.
- Paladin: the stomp-jump — his air jump deals 6 damage in a 70px ring
  beneath him (arriving twice).
- Priest: a wing-flicker; the air jump also cleanses one slow from self.
**Resonance:** None — movement body card.
**Slot type:** passive.
**Insidious↔epic reading:** Epic mobility, honestly bought at rare.
**Visual read:** A class-tinted burst underfoot at the second jump —
the "no ground" moment must be visible to the shooter tracking you.

### Deep Well  [common]  [universal]
**Concept:** The bigger pool — resource economy in one clean line.
**Effect:** +25 max resource (100 → 125) and +10% class-flavored regen.
**Per-class expression:**
- Wizard: mana 125; the weave-restore tick is 10% richer.
- Ninja: energy 125; melee-hit restoration +10%.
- Paladin: resolve 125; blocked damage converts +10% better.
- Priest: devotion 125; buff/heal uptime generation +10% (solo trickle
  included).
**Resonance:** None directly — but more pool = more casts = more windows;
this is the economy card FOR rotation players.
**Slot type:** passive.
**Insidious↔epic reading:** Neutral-technical; the accountant's pick.
**Visual read:** The rig's core gem burns visibly deeper/brighter — an
enemy can read "this one has reserves."

### Tithe  [rare]  [universal]
**Concept:** Drain reborn — the lineage of Crimson Tithe and Stolen
Fangs, folded into one always-on law.
**Effect:** Your damaging hits heal you for 8% of post-mitigation damage
dealt (self-damage and secondary children never tithe).
**Per-class expression:**
- Wizard: shots sip — sustain for the patient weaver.
- Ninja: blade hits tithe 12%, wave hits 6% — the knife is thirstier
  than the echo (get close, insidious-precise).
- Paladin: melee tithes 8% AND blocked damage returns 4% as healing —
  the wall drinks from both directions.
- Priest: 50% of your tithe flows onward to the nearest injured ally
  within 200px — the dark-cleric solo floor that becomes teams-native
  generosity.
**Resonance:** None — a hit-site law, not a cast. (Justified: drain on
the resonance clock was tested on paper and made every window a heal
check; the always-on shape reads cleaner.)
**Slot type:** passive.
**Insidious↔epic reading:** Insidious by lineage — softened to
unsettling-benevolent on the priest, where taking IS giving.
**Visual read:** A thin crimson thread from victim to caster, one smooth
sag (never lightning-jitter — that's Stormseed's read), plus a small
pickup cue at the caster.

---

## Wizard exclusives — technical-awesome

### Sunlance  [rare]  [exclusive: Wizard]
**Concept:** The held line — reborn from Raycast Prism with Continuous
Refractor's patience. Light does not wait for permission; the wizard
makes it.
**Effect:** Hold to charge up to 1.2s; release a hitscan lance: 16 → 34
damage by charge. At full charge it pierces 2 and leaves a 0.6s
afterimage beam doing 4 damage to anyone crossing it. Mana 45, CD 9s.
**Resonance:** Leaves *Lit* (2.5s). Cast into a live window: charge time
halves (0.6s to full) — the rotation buys the wizard his moment.
**Slot type:** ability.
**Insidious↔epic reading:** The technical-awesome pinnacle — a duel-
deciding geometry proof. The charge hold is the counterplay window.
**Visual read:** A gathering point of light at the hand (charge state
readable at range), then a single ruled line across the arena for one
frame, afterglow seam persisting. Hitscan = zero travel; nothing else in
the pool draws a straight line this long.

### Overchannel  [uncommon]  [exclusive: Wizard]
**Concept:** Reborn from Overcharge — wait, then nonsense.
**Effect:** Spec on primary: hold to charge up to 0.8s → +80% damage,
+40% projectile size, +40% recoil. Charged hits restore DOUBLE the
weave-mana tick (the class engine, amplified).
**Resonance:** A charged hit extends any live window on its victim
+0.5s — the big shot buys time to spend it.
**Slot type:** spec.
**Insidious↔epic reading:** Epic-technical — telegraphed power, honestly
purchased with vulnerability frames.
**Visual read:** The held shard grows over-bright with a camera-tick at
full charge; the release is a visibly fatter, slower-cadence bolt.

### Refraction  [uncommon]  [exclusive: Wizard]
**Concept:** The parry made generative — pride card for the "Return Unto
Sender" doctrine.
**Effect:** A successful parry refunds 20 mana and your next primary
within 2s fires twice (second bolt at 50% damage).
**Resonance:** A successful parry OPENS a resonance window on the wizard
(self-window, 2.0s) — defense joins the rotation as a first-class cast.
**Slot type:** passive.
**Insidious↔epic reading:** Epic duel grammar — the highest-skill moment
in the class pays out in every currency at once.
**Visual read:** The parry flash splits into a brief prism fan; the
doubled shot visibly twins mid-flight. Spectators learn the parry was
*perfect* from the fan alone.

---

## Ninja exclusives — insidious-precise

**Tactile bar (all ninja exclusives + chassis verbs):** contact first,
hit-stop + scrape on payoff, no weather/shadow cast language. See
`docs/character-sheets-v1.md` § Ninja tactile ability contract. Rogue
*handfeel*, not rogue costume.

### Paper Double  [rare]  [exclusive: Ninja]
**Concept:** The decoy — deception with an honest tell.
**Effect:** Spawn a copy sprinting your last input vector at exactly run
speed 362 (it cannot attack). Lives 2.5s or 20 damage. On death/expiry it
bursts: 10 damage, 90px. Energy 40, CD 9s.
**Resonance:** The burst leaves *Fooled* (2.0s) on those it catches;
abilities cast into *Fooled* gain +25%. Cast Paper Double INTO a live
window: you and the double swap positions at cast instead (max
displacement ≈ 900px — bounded by the double's legs, comparable to one
940 dash, never a free cross-map blink).
**Slot type:** ability.
**Insidious↔epic reading:** Peak insidious-precise — the class's whole
argument in one card.
**Visual read (tactile):** Identical **runner** — same mass silhouette,
feet on ground, no muzzle light, thin foot-scuff trail only (honest
close-read tells; panic-distance invisible). Damageable hull, not a
ghost. Burst = paper-white body pop with a short hit-stop for anyone
caught, not a smoke bomb. Swap = two bodies trade places with a hard
foot-plant frame, never a blink glyph.

### Undercut  [rare]  [exclusive: Ninja]
**Concept:** The execute — Technique-axis lineage (execute-below-15%)
reborn as the ninja's finishing law.
**Effect:** Spec on the slash verb: arc and wave hits FINISH enemies
below 15% max health. Never triggers above the line; no damage change
otherwise.
**Resonance:** Executing a target who holds your live window refunds 30
energy and 2s off every rack cooldown — the kill IS the rotation reset.
**Slot type:** spec.
**Insidious↔epic reading:** Insidious mercy — it only ever shortens an
ending that had already begun.
**Visual read (tactile):** Threshold hairline underscore (ninja-only).
Execute = **one clean horizontal cut through the victim** with hard
hit-stop and blade-scrape — Eviscerate weight, zero floating skull /
poison / shadow burst chrome. Clip-or-it-didn't-happen.

### Slipstream  [uncommon]  [exclusive: Ninja]
**Concept:** Movement is the engine — the wall kit feeds the rack.
**Effect:** Wall-kicks (the real 173px rise / 427px carry — unchanged)
grant 12 energy. Dashing THROUGH an enemy (940px/s dash crossing their
hitbox) grants 15 energy and tags them *Read* (1.5s): your next melee hit
on a *Read* target deals +20%.
**Resonance:** *Read* is a resonance-grade window only the ninja's own
casts can consume (an extension of the ability-sourced window rule —
flagged as such; if playtest says windows must stay ability-only, *Read*
degrades to the damage tag alone).
**Slot type:** passive.
**Insidious↔epic reading:** Insidious-precise economy — being untouchable
is literally how the ninja affords being lethal.
**Visual read (tactile):** Dash-through is a **body-cross** — brief
contact frame, nick slash-mark (*Read*) on the victim, energy tick you
can hear. Wall-kick = foot plant + camera micro-dip + energy tick. No
wind ribbon as the class brand; trail is thin crystal grit, not storm.

---

## Paladin exclusives — CUT 2026-07-19

Paladin used to have 3 exclusives here — Crater [rare, ability], Retort
[uncommon, spec], Bastion [uncommon, passive] — same "epic-settled /
self-lit" register as the rest of the kit (leap-slam verdict, block-to-
counter answer, standing-law aura). All 3 were actually **built**
(client/src/sim/data/cards.ts, classId:"paladin"-gated exactly like the
real 10-ability Kindred rack catalog, docs/class-ability-catalogs-v1.md),
which is exactly the bug: `catalogForClass("paladin")` — the loadout
station's own full-catalog query — doesn't distinguish "rack ability" from
"draft-pool exclusive," so it surfaced all 13 in one undifferentiated
grid instead of the true 10 every other class shows. Jake, live playtest:
cut all 3 rather than build the missing distinction — no class gets a
"bonus picks" mechanic the others don't have. Genuine removal, not a
deferral: the card definitions, their AbilityKind/type-union entries, all
sim effects (World.ts's applyBastionAura/crater case/crater landing hook,
combat.ts's Retort bank), constants.ts's KIN_CRATER_*/KIN_RETORT_*/
KIN_BASTION_* (aura) group, and every test referencing them are gone, not
commented out. Wizard/Ninja/Priest's own exclusives below are unaffected
— they were never wired as a second parallel system the way Paladin's
were (most, like Overchannel/Refraction/Slipstream/Flock, were never
built at all; the ones that were — Sunlance, Paper Double, Undercut,
Borrowed Time, Contagion — were folded directly into their class's
10-ability catalog rather than added on top of it).

---

## Priest exclusives — unsettling-benevolent

### Borrowed Time  [rare]  [exclusive: Priest]
**Concept:** A gift with a meter running.
**Effect:** Target ally within 320px (or self): heal 30 instantly; over
the next 6s, 15 of it drains back out UNLESS the target lands a hit every
2s (aggression keeps the gift). Solo/self: heal 15, drain-back 8.
Devotion 40, CD 8s.
**Resonance:** Leaves *Indebted* (2.5s) on the target — priest windows
live on FRIENDLY bodies. Priest abilities cast into *Indebted* refund 20
devotion. Enemy-facing casts can't consume it (the debt is between
friends).
**Slot type:** ability.
**Insidious↔epic reading:** The unsettling-benevolent thesis statement —
healing that asks something of you.
**Visual read:** An hourglass thread of light from priest to target; the
drain-back visibly runs the thread in REVERSE. Everyone can see whether
the gift is being earned.

### Contagion  [rare]  [exclusive: Priest]
**Concept:** The word spreads.
**Effect:** Spec on the debuff verb: your debuffs (Weaken, chill, burn,
Snare tags — whatever the build applies) jump to the nearest enemy
within 180px when their victim dies or the debuff expires. One jump per
application, ever.
**Resonance:** Resonance windows YOU placed on an enemy jump with the
debuff — the rotation spreads itself to the next body. (Balance watch:
this is the pool's compounding-est line; the one-jump cap is
load-bearing.)
**Slot type:** spec.
**Insidious↔epic reading:** The most insidious card in the pool — kept
inside C4 by touching only what the priest already lawfully applied.
**Visual read:** A pale seam of light crawls from body to body; arrival
blooms softly on the new victim. The crawl is slow enough to watch —
dread, made legible.

### Flock  [uncommon]  [exclusive: Priest]
**Concept:** The congregation, counted.
**Effect:** Each distinct player currently carrying any effect of yours
(buff, heal-over-time, ward, debuff) grants +1.2 devotion/s (cap 4
sources). The solo trickle floor (1.0/s) always applies. Wards you cast
(the class defense verb) are +10% stronger.
**Resonance:** None — an economy law. (Justified: Flock makes MORE casts
possible; it doesn't need to also touch the windows those casts make.)
**Slot type:** passive.
**Insidious↔epic reading:** Benevolent arithmetic with an unsettling
undertone — enemies you curse are congregation too.
**Visual read:** Small orbiting motes around the priest, one per active
source — the congregation count is readable at a glance, by anyone.

---

## Appendix — cut candidates (considered and rejected; do not re-invent)

1. **Aegis for All** (universal shield card) — defense is a CLASS
   property now ("not everyone gets shield" is locked canon); a universal
   shield un-decides Jake's call.
2. **Blink** (universal long-range teleport ability) — the 940px/s dash
   already owns burst displacement; a teleport past it deletes the chase
   game. Paper Double's window-gated swap is the bounded version that
   survived.
3. **Little Brothers** (Orbiting Satellites rebirth as a pet card) — a
   new AI entity class plus silhouette pollution in a game that lives on
   silhouette reads. Parked, not dead: viable as a wizard exclusive in a
   later wave if the entity budget opens.
4. **Mana Leech** (drain enemy resource on hit) — each class's regen
   flavor IS its rotation tutorial; a card that attacks the resource
   attacks the teaching. Anti-fun in every playtest analogue we studied.
5. **Prism Cycle** (one card that cycles all five elements) — four
   readings per card is the law; four elements per card is zero readings.
   Violates one-card-one-fantasy and every legibility rule at once.
6. **Stopwatch** (time-slow bubble affecting players' action speed) —
   server-authority nightmare plus feel-killer at arena speed; Undertow's
   move/projectile drag is the honest, shippable version of the fantasy.
7. **True Veil** (Veil of Nought rebirth: full invisibility) — perma-
   ghost risk vs the legibility law ("at every point it should be clear
   what's going on"). The decoy deceives while staying spectator-legible;
   invisibility can't.
