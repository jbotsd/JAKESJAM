# Classes — the chassis + spec combat rethink

**Status:** North star + staged build contract. Decided with Jake 2026-07-17
(four explicit calls, recorded below). Companion docs: `docs/emission-engine-goal.md`
(cards compose abilities — that direction is PRESERVED and becomes the spec
layer inside a chassis), `docs/venue-goal.md` (the venue grows team queues),
`docs/game-feel-tuning.md` + `docs/map-design.md` (movement numbers all kit
design must respect).

**One sentence:** combat reorganizes around four CLASS CHASSIS — the body,
movement feel, silhouette, and weapon VERB are the class — while the card
draft stays on top as the SPEC layer (mostly universal, some class-flavored),
so a player can main a class for identity and still build differently every
run.

## Decisions locked (Jake, 2026-07-17)

| # | Question | Call |
|---|---|---|
| 1 | Teams? | **Duos/teams come to the venue** — tank/Syzygist *peak* with allies; bell/queue matchmakes; **FFA remains alongside** and Syzygist must stay solo-viable (enemy entanglement), not duos-only |
| 2 | Class acquisition | **Chassis + spec hybrid** — class picked at the loadout station (body/verb); cards remain the build layer |
| 3 | First class shipped | **Ninja** — proves the melee verb end-to-end, maximum contrast with the existing (wizard) kit, clip-generator |
| 4 | Old archetypes | **Evolve, don't discard** — Heavy→Paladin, Sprinter→Ninja, Balanced→Wizard, Shielded→Priest; stats/movement feel carry as each class's body |

## Why this shape (market receipts, condensed)

- Hard-hero games (Marvel Rivals, Overwatch, MOBAs) prove *main-ability* is a
  top-tier retention hook — but demand teams and an endless hero cadence.
- Chassis+build games (Deadlock, The Finals, Battlerite) prove you can have
  matchup identity ("that silhouette = that threat") AND build variety.
- Draft-identity games (ROUNDS — our lineage) prove the combinatorial draft
  is magic worth keeping. We keep it as the spec layer.
- Pure pocket-healer is a dead class in FFA — healing converts to wins only
  through a teammate. Hence Syzygist is **not** a pure healer: solo floor is
  enemy entanglement (curse/lifesteal); teams are the *peak*. Call #1 still
  brings duos so tank/Syzygist peak is real; FFA stays and Syzygist must win
  there too.

## The four chassis (evolved from `characters.ts` archetypes)

Class = body (hp/speed/size from the archetype it evolves) + weapon verb +
one signature defensive/utility verb. Cards spec everything further via the
Emission Engine.

### Naming — dual layer (Jake 2026-07-17: gnostic names, esp. priest)

Specialization + catalog + six roles mean each chassis can carry a real
**identity name** without a medieval fantasy roster (Wizard / Ninja /
Paladin / Priest). Those four remain **internal/dev IDs** only.

| Layer | Where it shows | Rule |
|-------|----------------|------|
| **Dev ID** | code, docs, logs | `wizard` · `ninja` · `paladin` · `priest` — never rename without a migration |
| **Display name** | loadout station, draft chrome, killfeed optional, menus | Gnostic / vessel / technical-mystic — **sci-fi gnostic, not church** |
| **HUD-critical** | tiny combat chrome | Prefer short display name or sigil; no multi-word scripture |

**Hard bans on display names:** priest, cleric, paladin (as holy office),
crusader, monk, templar, saint, holy, divine, angel, church nouns. Lore
may use Autogenes as *source language*; do **not** name a class
`Autogenes` (already house/cosmetic tier + revelation hierarchy — never
print Kalyptos/Protophanes/Autogenes as class labels per
`docs/visual-language-gnostic-vessel.md`).

**Display set LOCKED (Jake 2026-07-17):**

| Dev ID | Display | One-line why |
|--------|---------|--------------|
| **wizard** | **Geometrician** | Engineer of light — geometry, charge, angle; not elemental master |
| **ninja** | **Interstice** | Already between places; Paper Double / Read; not stealth assassin |
| **paladin** | **Kindled** | Self-light heaven tank; Kindling resource; not knight of a god |
| **priest** | **Syzygist** | From *syzygy* — paired/bound; power via others carrying your effects; not cleric |

**Syzygist visual:** **cool-white** base read (not violet, not Autogenes gold).
Wards/devotion aura/clinical gift — white-core filament. Violet stays
void-element + future Deluxe void cosmetics.

**How names appear:**
- Loadout: big display name + one-line fantasy + role-tag chips
- In-match nameplate / killfeed: display name (one word, glanceable)
- Code/docs may still say priest/ninja/etc. as dev IDs

### Catalog vs cards (LOCKED — Jake)

| System | Is | Is not |
|--------|-----|--------|
| **Class ability catalog** | The **buttons** you equip into keys 1–3 | Draft loot; emission riders |
| **Draft cards (C1 pool)** | **Specs / emission** on chassis verbs + equipped abilities — mutate, deepen, re-express | A second action bar of “more abilities” |

If a design feels like a new button, it goes in the **catalog**. If it
feels like “this button now does X differently / harder / with a rider,”
it is a **card**. Never ship two systems that both feel like ability bars.

### Chassis identity non-obsolescence (LOCKED — Jake)

Catalog movement/defense **must not replace** the always-on chassis verb:

| Chassis | Always-on that stays sacred | Catalog may **not** obsolete |
|---------|----------------------------|------------------------------|
| Kindled | Kindled Ward (directional hold) + Kindled Edge weight | “Just equip a better shield button and ignore ward” |
| Interstice | Dual-blade slash + short wave (tactile) + baseline dash | “Ignore slash; only catalog dashes and gadgets” |
| Geometrician | Projectile kit + parry | “Never shoot; only catalog gadgets” |
| Syzygist | Status/entanglement verb + baseline projectile | “Never curse/bind; only pure heal buttons” |

Catalog tools **extend** the chassis; they don’t let you skip it.

### Wizard (from Balanced) — the current game IS the wizard
- 100hp, current movement. **Verb: the existing projectile kit, unchanged** —
  crystal munitions, every current weapon card. The rebrand costs nothing;
  the entire existing arsenal becomes wizard canon.
- Signature: existing parry ("Return Unto Sender" doctrine).
- Ships: P1 (rename/reframe only).
- **Anti-moodboard (researched 2026-07-17): Diablo Immortal Wizard.**
  Immortal's Wizard is elemental MASTERY — fire/ice/lightning/arcane
  bent to the caster's will, deep inter-element synergy stacking (Lightning
  Nova, Arcane Torrent, Scorch, Ray of Frost), robe-and-staff spellcaster
  costuming, screen-filling multi-elemental spectacle. **The load-bearing
  distinction: our elements (Cinder/Hoarfrost/Stormseed) are UNIVERSAL
  spec cards any class can draft — not the wizard's domain.** The wizard's
  actual identity is the crystal-tech DISCIPLINE itself: geometry, charge
  timing, angle control — "I finished a sentence the crystal started,"
  not "I command fire." Craft worth stealing (inverted): charge-and-release
  channeling (Sunlance/Overchannel already do this, same shape as Ray of
  Frost/Arcane Torrent, no elemental flavor required). **Hard reject:**
  robe/staff/spellbook costuming, "bending nature's elements" mastery-
  over-nature flavor (ours is refined crystal light, not raw natural
  force), rainbow multi-elemental screen noise — doctrine's "one living
  light, not five" rule applies here specifically against DI's visual
  habit. 64px test: if it reads arcane-robe-mage, fail. Full table:
  `docs/character-sheets-v1.md` (Wizard).

### Ninja (from Sprinter) — FIRST NEW CLASS
- 85hp, 1.14x speed, small. **Verb: dual-blade slash — a melee arc that
  emits a short-range WAVE projectile off the swing** (the wave rides
  existing projectile tech; the arc is the new melee verb). Wave is
  **aftermath of contact**, not a free cast: spawns from a swing that
  had commit; short range; inherits swing direction.
- Signature: dash affinity (extra charge / reduced cooldown — dash tech
  exists; tune, don't build). Dash-through is a **body-cross** (hitbox
  intersection), not a fog.
- Melee sim requirements (FULL parity discipline, slopes-grade): arc hit
  detection vs player AABBs (lag-comp aware like projectiles), swing
  cooldown/commit frames, wave spawn. TS + Zig mirrored, bit-exact tests.
- Ships: P2 — the proof of the whole system.
- **Ability feel bar (Jake: "just the abilities should be good"):**
  tactile handfeel is the ship gate — WoW Rogue *contact weight*, not
  stealth fantasy. Contact first; commit frames; energy from hits/dash-
  through/wall-kick; finishers are cuts; no hard-CC job. Full table:
  `docs/character-sheets-v1.md` (Ninja § Tactile ability contract).
  Juice = render only.
- **Anti-moodboards (Jake, 2026-07-17): DI Tempest + WoW Rogue.**
  - *Tempest* — dual-edge mobility cousin: steal twin blades + wave off
    motion + dash identity; reject water/wind elemental, storm VFX,
    seafaring/art-nouveau, multi-Zephyr stage presence. Wave = **crystal
    munitions off a melee arc**, not surf.
  - *WoW Rogue* — dual-wield opener cousin: steal **tactile economy**
    (every button is a contact event) + "I already moved" feel; reject
    stealth/Vanish as identity, poison as brand, shadow-magic Subtlety,
    combo-point finisher HUD, kidney stunlock job, leather-assassin
    silhouette. Defense stays dash i-frames only. Aggression feeds
    energy (canon), not stealth.
  - Paper Double = input-echo **lie about commitment** — damageable
    runner with legs, not Zephyr ally, not Vanish untargetable. Thesis:
    **legibility as weapon** (Read tag), opposite of rogue "hide
    information." 64px test fails if Tempest *or* classic WoW rogue.

### Paladin (from Heavy) — REFRAMED 2026-07-17: self-enlightenment, not
### service. **Heaven-tank FEEL (DI Crusader), Autogenes SOURCE.**

Jake: "make the paladin more gnostic like self enlightenment holy." Then
(same day): **"heaven tank IS the right feel though."** Read together:
- **SOURCE** = Autogenes — self-begotten light, no god, no order, no oath
  (`docs/visual-language-gnostic-vessel.md` still bans robes/halos/crosses/
  temple/scripture). They shield because an awakened thing *is* the sun
  in the room — not because they were commanded.
- **FEEL** = Diablo Immortal Crusader heaven tank — fortress presence,
  radiant peel (Conjuration-of-Light weight), ground that becomes yours,
  board as fortress, big light punish windows, gold/white fire stage
  presence. **Do not under-cook radiance into quiet monk.**

**Bar (Jake: "just the abilities should be good"):** heaven-tank
*handfeel* is the ship gate — not costume essays. If Ward/Edge/peel/ult/
Kindling don't feel like a DI Crusader tank in the hands, fail. Per-ability
feel table: `docs/character-sheets-v1.md` (Paladin § Ability feel contract).
Source stays Autogenes (no god); juice is render-only.

- 125hp, 0.88x speed, large. **Verb: Kindled Edge** (tighter, harder melee
  arc — same melee core ninja proves; Sacred-Fire *weight*) **+ Kindled
  Ward** (directional frontal hold — existing shield/parry tech). Gold-
  forward on spine/ward/edge/peel/ult so the kit *reads* as radiant fortress
  in motion.
- Primary B (proposed): **Unbroken Seal** — committed overhead, big
  hit-stop + stagger. Alts: Full Temper / Aperture Lock.
- Ultimate (proposed): **Unveiling** / Full Presence — banked Kindling →
  full presence; allies under hard light window (Conjuration *feel*);
  release has punish weight. Light may flood vertical space; body does
  not sky-launch.
- Resource: **Kindling** from blocked damage; Bastion lets allies'
  endurance feed it. Defense *is* the engine.
- Signature: **peel** — block for teammates in ward shadow / presence
  aura; must be readable in a clip.
- Ships: P3 (reuses P2 melee + shield). Ability feel > naming polish.

### Priest / Syzygist (from Shielded) — entanglement buffer; **solo-viable**
- 100hp, 0.96x speed. **Verb: buffs/debuffs/heals** — extends the existing
  status-effect substrate (burn/freeze/slow → add regen, haste, weaken,
  curse). Baseline attack: modest projectile (wizard's starter, detuned).
  Display name **Syzygist**; cool-white visual (see § Naming).
- **Singular viability is a SHIP GATE:** Syzygist must be win-capable
  **alone** in FFA / solo queue. Entanglement with *other bodies* — allies
  in teams, **enemies** in singular (curses, lifesteal, Contagion). Gift
  polarity (teams) vs take polarity (solo). Pure pocket-healer = fail.
- **Solo floor:** curse + lifesteal + catalog paths that need no ally.
  Devotion from enemy DoTs/curses at a real rate; teams still peak higher.
- **Solo design note (Jake: unique / problematic encounter):** solo Syzygist
  is not “duos with bots as fake friends.” Author **unique problematic
  encounters** for singular — pressure that makes enemy-entanglement and
  take-polarity sing (e.g. multi-angle curse management, Contagion chains
  in crowded FFA, self-ward weakness as a real read). Accept that solo
  Syzygist is a distinct problem space; do not sand it into generic DPS.
- **Ships:** P4 with duos available for *peak*; FFA/solo always admit
  Syzygist.
- **Anti-moodboard (researched 2026-07-17): Diablo Immortal Monk** — the
  closest DI has to a support class, and DI never built a pure priest,
  which is itself the useful data point. Monk is melee martial-arts
  support/AoE-DPS hybrid (Seven-Sided Strike, Cyclone Strike, Wave of
  Light), holy+elemental fusion combat, high mobility, party buffs and
  damage-absorbing shields — explicitly **not forced into a healer role**,
  can flex to pure damage. **Craft worth stealing:** that exact non-forced-
  healer principle — our Priest already has this via the curses/lifesteal
  solo floor (call locked independently, DI's Monk confirms it's the
  right instinct for a support archetype that must also work alone).
  **Hard reject:** martial-arts costuming and melee-mobility identity —
  that's the Ninja's territory in this roster, not the Priest's; Monk's
  acrobatic Seven-Sided-Strike-across-the-room kit shape doesn't belong
  here. Our Priest reads as POSITIONED and calm (ranged/status, entanglement-
  powered via Devotion), never as a flanking brawler-in-robes. 64px test:
  if it reads combat-monk, fail. Full table: `docs/character-sheets-v1.md`
  (Priest).

## Cards under classes — GROUND-UP REDESIGN (Jake, 2026-07-17)

**Every card is redesigned from the ground up for the class era.** Four
locked calls:

| # | Call | Ruling |
|---|---|---|
| C1 | Pool size | **~30 deep cards at launch** — every card expresses per-class (30 × 4 chassis ≈ 120 effective identities via the Emission Engine); depth beats count |
| C2 | Survivors | **Concepts may survive, no card does** — beloved mechanics (bounce, homing, split) may be reborn inside the new frame, but every card is re-authored: stats, per-class expression, name. Nothing ports untouched |
| C3 | Expression | **Universal + exclusives mix** — most cards read differently on each chassis; a small set per class is exclusive ("main pride" cards) |
| C4 | Tone | **Not transgressive names.** Effects range devious ↔ benevolent — a deliberate balance of *insidious* and *epic*, weighted by class (priest skews unsettling-benevolent, ninja insidious-precise, paladin epic-settled / self-lit density — **not liturgical**, wizard technical-awesome). World-class spell/ability VFX + animations are part of the ambition — explicitly deferred to a later pass, but every card design must note its intended visual read so the VFX pass has a spec waiting. Paladin/ninja VFX must pass the 64px test (not DI Crusader, not DI Tempest, not WoW Rogue) |

- The draft persists structurally (between rounds, stacks, loser-first).
  Emission Engine composition (`docs/emission-engine-goal.md`) is HOW a card
  modifies chassis verbs — one card, four readings.
- COORDINATION: cards/emission is another session's active canon — this doc
  composes with it. Conflicts resolve toward emission-engine-goal.md for
  card mechanics, toward this doc for class/chassis structure and the C1-C4
  redesign contract.

## The Rotation system (Jake, 2026-07-17: "skill rotations too")

Classes have ACTIVE ABILITIES with cooldowns, and *sequencing them matters*
— a rotation in the arena register (seconds, not MMO minutes):

### Catalog > slots (Jake: "more class abilities than slots — pick and choose")

**Locked:** each chassis has more abilities designed than the player can
equip. Choice is identity. Shipping a kit where all class abilities fit
on the bar is a design fail.

| Layer | Count | Job |
|-------|------:|-----|
| **Chassis base** (always on) | fixed | M1 primary (one of two equipped), defense verb, movement, E ult/Emission |
| **Class ability catalog** | **8–12** per chassis at launch | Full menu of actives — first pass **10 each** in `docs/class-ability-catalogs-v1.md` |
| **Rack slots (keys 1–3)** | **exactly 3** | What you can press this run. Never 4. Never "all of them." |

- **Why 3 not 4 (Jake, soft lock 2026-07-17):** tighter pick-and-choose —
  catalog >> slots hurts more when you only keep three; rotation is a
  short chain you can master, not a full MMO bar; touch HUD is cleaner
  (three actives + E + defense). Six-axes still has five axes — scarcity
  on the bar is the point (you never cover every axis at once).
- **Pick and choose is mandatory.** A ninja with 10 catalog abilities
  brings only 3. A paladin with 10 brings only 3. Two players on the same
  chassis can have non-overlapping racks — that is the point.
- **Where you choose (LOCKED — Jake):**
  1. **Loadout station owns the 3 slots.** After class select, open the
     full catalog and **equip exactly your rack** (up to 3) before
     queue/bell. This is the specialization moment.
  2. **Catalog is full day one** — all 8–12 abilities available at loadout
     (no account grind unlock ladder for the launch catalog).
  3. **Recommend + pure freedom:** loadout shows optional recommended
     racks (by role tags / solo / duos) — player may ignore and pick any
     three. Never force a preset subclass.
  4. **Between-round draft:** primarily **specs** equipped abilities and
     chassis (emission riders, CD/resource, feel mods). Optional rare
     **swap** offers exist but are not how you first build the bar.
     Draft never creates a 4th slot.
- **Catalog is not the C1 card pool** — see § Catalog vs cards above.
- **Design rule for authors:** when adding a class ability, it goes into
  the catalog first. If the catalog is still ≤3, you have not designed
  enough tradeoffs — add until omit-pain is real (e.g. peel vs punish on
  paladin; gap-close vs execute on ninja).
- **Resonance** only chains across the **equipped** 3. Building a catalog
  full of resonance partners that never fit together on one rack is a
  deliberate multi-build split, not a bug.

### Specialization = which 3 you brought (Jake, 2026-07-17)

**Locked:** the 3-slot rack *is* the specialization system. No separate
talent tree, no subclass dropdown. Same chassis body/verb/defense; the
**three equipped catalog abilities** are the spec. Two ninjas with
different racks should play as different specializations (e.g.
execute-assassin vs gap-close skirmisher vs decoy controller).

| Spec shape (player-facing, not UI labels) | Typical rack mix |
|-------------------------------------------|------------------|
| **Offense / duel** | single + single + offense (execute, amp) |
| **AoE / chaos** | aoe + aoe + offense or defense |
| **Defense / peel** | defense + buff + offense finisher |
| **Buff / support** | buff + buff + offense or single (FFA needs teeth) |
| **Runner / skirmisher** | movement + movement + offense or single |
| **Chase** | movement + single + offense |
| **Planted** | defense + aoe/buff + offense — no movement slot |
| **Hybrid** | any three different roles — generalist |

Authors do **not** hardcode those shapes as official subclasses — they
emerge from catalog coverage + player pick. Loadout: **recommended racks
+ pure freedom** (soft tags + suggest; never force).

### Ability role range (every catalog must cover)

**Locked:** each class ability catalog is a **menu across roles**, not
eight flavors of the same button. A catalog that is all offense (or all
AoE) fails review. Every ability is tagged with **one primary role**
(and optional secondary):

**Role set (locked — exactly these six, Jake 2026-07-17):**

`defense` · `offense` · `buff` · `aoe` · `single` · `movement`

No seventh tag (no separate "utility"). Decoy / zone / info tools pick a
primary among the six (e.g. Paper Double → movement or defense; trap zone
→ aoe; Read mark → single or offense).

| Role | What it does on the bar | Examples (feel, not final names) |
|------|-------------------------|----------------------------------|
| **defense** | Survive / deny — personal (stacks with chassis defense verb, does not replace it) | Extra i-frame, absorb pulse, reflect window, damage gate |
| **offense** | Damage amp, execute, committed strike, burst window | Undercut-line, heavy overhead, empowered M1 window |
| **buff** | Self or ally uplift (haste, damage amp, peel aura, regen) | Team peel light, self haste, devotion aura |
| **aoe** | Best into groups / space control | Wave expand, consecration field, nova, multi-hit arc |
| **single** | Best into one target — duel / focus fire | Point-mark, precision cut, focus mark |
| **movement** | Relocate the body — dash, blink, leap, wall-route, chase/escape | Gap-close dash, retreat slide, wall-kick empower, short blink |

Always-on chassis movement (walk/jump/baseline dash) stays free;
**movement-tagged catalog abilities** cost a scarce slot. Taking two
movement abilities = skirmisher spec; taking zero = planted fortress.

**Catalog coverage floor (launch, per chassis):** ≥**2** of each of the
six roles. At least one burst-leaning and one execute/sustain-leaning
inside offense; gap-close *and* escape flavors preferred inside movement.

Overlap is fine (`movement+offense` damaging dash) — **one primary tag**
for loadout filters. Target catalog size **8–12**; multi-tags count once
toward size. Floor is a coverage checklist, not 12 isolated single-tag
buttons.

**Chassis flavor skew (not monopoly):** every class has all six roles;
**weight** differs:

| Chassis | Catalog skew | Still must include |
|---------|--------------|--------------------|
| **Wizard** | offense / aoe / single (angle control) | defense + buff + movement (reposition, not ninja-speed) |
| **Ninja** | single / movement / offense (tactile) | aoe + defense + buff |
| **Paladin** | defense / buff / aoe (heaven-tank peel + field) | single + offense + movement (short charge, not freeflow) |
| **Priest / Syzygist** | buff / single / aoe (curse + aura) | defense + offense + movement — **and** enough offense/single/defense catalog weight that a **solo 3-slot rack is real** (not buff-only) |

**Spec shapes (3 of 6):**

| Spec shape | Typical rack mix |
|------------|------------------|
| **Offense / duel** | single + single + offense |
| **AoE / chaos** | aoe + aoe + offense or defense |
| **Defense / peel** | defense + buff + offense |
| **Buff / support** | buff + buff + offense or single (FFA needs teeth) |
| **Runner / skirmisher** | movement + movement + offense or single |
| **Chase** | movement + single + offense |
| **Planted** | defense + aoe/buff + offense — zero movement |
| **Hybrid** | any three different roles — generalist |

**3-slot consequence:** six roles, three slots — you always omit half the
menu. That *is* the specialization. Draft swaps late-run pivot the spec
under fire.

### Slots + rotation loop

- **Slots**: chassis base kit (M1 verb + defense + movement + E ult) plus
  **exactly 3 rack slots on keys 1-3** — six-axes surface
  (`docs/six-axes-goal.md`, slot count updated here). Filled by loadout
  equip and/or draft fill/swap from the class catalog.
- **What makes it a ROTATION, not four buttons — Resonance**: every ability
  leaves a brief resonance state (on target or self, ~1.5-2.5s). Casting a
  DIFFERENT ability inside that window consumes the resonance for a bonus
  (empowered effect, partial cooldown refund, or an emission-flavored rider).
  Chaining unlike abilities is the reward loop; spamming one button is the
  weak line. This is Emission Engine grammar applied to time instead of
  stats — composition across the combo window.
- **Cooldown tuning**: short (3-9s), staggered per slot so a full chain has
  a natural loop order that a player can FEEL and optimize.
- **MANA (Jake, 2026-07-17: "mana balances things too")**: abilities cost a
  class resource on top of cooldowns — the second balancing axis (a strong
  effect can be cheap-CD/expensive-mana or the reverse; spam is bounded by
  the pool even when CDs align). Class-flavored regeneration so the resource
  itself teaches the rotation: **wizard** = mana, steady regen, weaving
  basic projectiles restores a tick (cast-weave loop made literal);
  **ninja** = energy, fast regen, melee hits restore (aggression feeds the
  rack); **paladin** = resolve, generated by BLOCKED damage (defense IS the
  engine); **priest** = devotion, generated by buff/heal uptime on others
  (teams-native) with a slow solo trickle. The existing `abilityCharge`
  field is the substrate — one f64 per player already in the sim/wire.
- **DEFENSE IS A CLASS PROPERTY (Jake: "not everyone gets shield")**: the
  universal shield retires. Each chassis gets its own defensive verb and
  ONLY that verb: **paladin** = the shield-board (directional block, the
  tank identity); **wizard** = parry (the existing "Return Unto Sender"
  doctrine — precise, high-skill, no sustained hold); **ninja** = evasion
  (dash i-frames — never blocks, only isn't there); **priest** = wards
  (small absorb barriers, castable on ALLIES — self-ward weak, team-ward
  real; teams-native like the rest of the kit). Defensive asymmetry is a
  core matchup texture, not a balance bug to sand off.
- **Per-class rotation feel** (design targets, not mechanics): wizard =
  cast-weaving (projectiles between ability casts extend resonance), ninja
  = melee strings into wave finishers (resonance rides the slash rhythm),
  paladin = block-punish windows (a blocked hit IS a resonance source),
  priest = uptime maintenance (buff refreshes + curse windows as the loop).
- **Parity note**: resonance state + cooldowns are sim state (predicted,
  wire-visible, Zig-mirrored if they cross the ABI — same discipline as
  everything else). Design for zero-or-minimal WorldState bytes where
  possible (cooldowns already exist per-player; resonance is one small
  tagged-state record).

### E-KEY RULING (Jake, 2026-07-17): the ult IS the Emission

The classes-canon charged ultimate and the emission-canon E-cast are ONE
mechanic: landing primary hits charges the meter (`abilityCharge`);
spending it casts your ULTIMATE — your primary attack transfigured THROUGH
your card hand via emission composition. A wizard holding fire+split cards
ults a splitting firestorm volley; the same meter on a ninja with the same
cards emits a splitting fire blade-tempest. Both canons survive as one
system; emission-engine-goal.md's composition machinery is the ult's
engine. **Defense verbs move OFF the E key** to their own input (hold /
right-click register, per class — exact binding decided at implementation
with mobile/touch parity in mind). Six-axes keys 1-3 (the equipped rack)
are unaffected.

### Diablo Immortal receipts (studied 2026-07-17 — adopt/reject on record)

- **ADOPTED — dual primaries**: each chassis gets TWO primary-attack
  options, equip one (Immortal's model). One extra authored attack per
  class doubles pre-card identity for minimal cost.
- **ADOPTED — the charged ultimate**: primaries have no cooldown; LANDING
  primary hits charges an ultimate that is an EMPOWERED VERSION of that
  primary (not a separate spell). Class-true spectacle, aggression-rewarded,
  and it lands on the existing `abilityCharge` sim field. Wizard →
  volley-storm of the current projectiles; ninja → blade-tempest string;
  paladin → block-window retribution burst; priest → mass aura surge.
- **REJECTED — no-mana/cooldown-only**: right for their touchscreen
  accessibility target, wrong here — Jake ruled mana in as the second
  balance axis, and class-flavored regen (block→resolve, hits→energy) gives
  rotation texture cooldown-only can't. Their lesson stands as a warning:
  without a resource, CDR/uptime stacking becomes the only build axis.
- Slot arithmetic: Immortal equips 4 skills; **we go 3** (Jake soft lock)
  for harder catalog tradeoffs + cleaner touch bar. **Catalog is larger
  than 3** either way — force the pick at loadout + draft swap.
- **THE JAKESJAM DIFFERENCE (Jake: "but with round by round cards")**:
  Immortal unlocks skills by grind then equips 4. We have a **class
  ability catalog (8–12)** and **3 slots**, with pick-and-choose at the
  **loadout station**, then **round-by-round draft** that fills empties,
  specs equipped abilities, or **swaps** catalog abilities mid-run —
  never a 4th button. Rotation is still assembled under fire when you
  leave slots open or accept swaps; a full locked loadout rack is a valid
  "I know my three" play style. Draft offer logic: empty slots early →
  specs mid → swap pressure late.

## Venue integration

- **Loadout station flow:** (1) pick chassis, (2) equip one of two
  primaries, (3) open that class's ability catalog (8–12) and **assign up
  to 3 into keys 1–3** — pick and choose; empty slots allowed for draft
  fill, (4) cosmetics/card bits that already lived here stay. Station is
  the pre-arena identity moment (replaced the join-modal).
- Duos queue: `VenueHost` bell admission gains a team variant (queue as
  pair / auto-pair). FFA bell unchanged. Elastic bots respect team floors.
- Scoreboard/kill-tally: team modes aggregate the existing per-player run
  records — no new scoring concept.

## Staging

- **P1 — Wizard reframe + class select at the station** (copy/UI + chassis
  plumbing; zero sim). Prove station flow; scaffold catalog UI even if
  wizard catalog is still thin.
- **P2 — Ninja + the melee core** (the big sim cut; slopes-grade parity;
  arc → wave → dash affinity). **Ship with catalog > 3** (target 8–10
  ninja abilities, equip 3) with **full role coverage** across the six
  tags (defense / offense / buff / aoe / single / movement) so specs are real.
- **P3 — Paladin** (melee reuse + shield-board; heaven-tank ability feel;
  catalog 8–10 role-spread, equip 3; first teams-flavored kit).
- **P4 — Syzygist + duos mode live** (status-effect extension + VenueHost
  team admission; catalog from `class-ability-catalogs-v1.md`). Solo/FFA
  ship gate + unique problematic solo encounters; duos is peak.
- Each phase: all suites green, parity tests for any sim surface, playtest
  gate = AWAITING JAKE evidence, never a loop-blocking condition.

## Anti-goals

- No role queue/enforcement — comps are emergent, floors handled by bots.
- No class-locked PAID anything (cosmetics stay cosmetic — standing rule).
- No hero-cadence treadmill promise — four chassis is the roster; depth
  comes from the card pool, not roster growth.
- Melee never becomes the majority verb — this stays a movement-shooter
  with melee classes in it, not a brawler.
