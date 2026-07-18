# Venue Lobby Tableau — gnostic composition + fully-working practice range

**Status:** Locked design + build contract (Jake, 2026-07-18: "full spec out
[the lobby screenshot] to be a gnostic last supper scene and fully enable
all of the abilities to work... with good and bad training arena target
dummies to test all abilities" — refined same session: "it's a gnostic
cathedral of sorts with a last supper scene where the user changes loadout
at the table," with two follow-up calls locked: (1) "cathedral" = a grand
crystal-tech hall reading like a cathedral's INTERIOR SPACE (tall vaulted
crystal ribs, dramatic light shafts, hangar-bay scale) — never literal
church architecture (no arches, stained glass, pews, altars); (2) the
loadout station becomes an actual long-table silhouette, crystal-plated,
not an abstract workbench console).
**Parents:** `docs/visual-language-gnostic-vessel.md` (the hard visual
doctrine this doc must pass), `docs/chassis-design-axioms.md` (silhouette/
color grammar), `docs/class-ability-catalogs-v1.md` (the 42 abilities this
room exists to let players test), `docs/venue-goal.md` /
`server/src/venueHost.ts` (the lobby's existing architecture — this doc
extends it, doesn't fork it).

---

## One sentence

The venue lobby's practice range becomes a grand, vaulted crystal-tech hall
— cathedral-SCALE, never cathedral-ICONOGRAPHY — where the loadout station
is a literal long table and figures gather along it symmetrically, a
**Last Supper compositional reference** told entirely in the game's
existing crystal/vessel grammar — and every one of the 42 catalog
abilities gets a real, correctly-typed target to prove itself against.

---

## Part 1 — Why "Last Supper," and the hard line around it

Jake's reference is **blocking, not iconography**: a row of figures along a
shared surface, evenly spaced, with one figure or object at the
compositional center that the eye and the group both orient toward. That
shape — symmetric row + one anchor — is a strong, free piece of
stage-craft this room currently has none of (see Part 3's "before" state).

This project has a standing hard rule that religious/Illuminati-adjacent
symbolism is a tender subject, and the game's own visual doctrine already
independently arrived at the same boundary:

> "If it reads as a cathedral, church, tarot deck, or 'ancient aliens
> History Channel,' it failed." — `docs/visual-language-gnostic-vessel.md`

> "Not this: Robes, halos, crosses, stained glass — wrong genre, this is
> **sci-fi** gnostic." — same doc

So this spec takes **composition and scale**, and leaves iconography
behind:

| Keep (staging + architecture) | Reject (iconography) |
|---|---|
| A symmetric row of figures along a long table | Bread, wine, a chalice, any vessel read as a ritual object |
| One central social anchor (the table itself) | Halos, crosses, robes, stained glass |
| Even spacing, eye-line toward center | Sainthood/villain iconography, literal "betrayer" staging |
| Tall, vaulted, dramatic hall — cathedral-SCALE | Church architecture — arches, pews, an altar, a nave |
| Warm vs. cool figure read (ally vs. hostile) | Any prop that reads as consecrated/sacred rather than manufactured |
| Existing crystal-tech props (crystal ribs, light shafts, target dummies) | — |

**The acceptance test (reuse CA6's own method, `docs/chassis-design-axioms.md`):**
strip the scene of everything except silhouettes and ask "does this read
as a fighting-game practice hall with a social center, or a religious
tableau?" If a screenshot needs the phrase "Last Supper" or "cathedral" to
explain itself, it failed. If a player who's never heard either reference
just sees "oh, a grand crystal hall with a long table and test dummies,"
it passed. **Scale and drama are welcome — sacred objects are not.**

**What's new here, concretely:** the loadout station's abstract totem ring
becomes a literal long table (crystal-plated, hull-panel construction,
same material language as the arena's platforms — see Part 3), the room's
backdrop gains vertical scale (tall crystal ribs, light shafts) instead of
the current flat gradient, and the practice dummies/ally NPCs arrange
along the table's length. No seated pose, no held ritual objects — every
figure keeps its existing standing/combat-ready stance.

---

## Part 2 — The functional problem (confirmed by direct code read, 2026-07-18)

The room's whole reason to exist is "try it on the dummies" (`HangoutScene.ts`'s
own `LOADOUT_HINT` copy). Today, several of the 42 catalog abilities do
**nothing** when tried there:

| Gap | Root cause | Affected |
|---|---|---|
| Ninja M1 (melee arc) hits nothing | `stepDestructibles` (`destructible.ts:77-197`) is the ONLY code in the repo that touches `destructible.health`, and it's driven exclusively by `state.projectiles` (sole call site `World.ts:5321`) — the melee arc hit-check (`World.ts` ninja block) only ever iterates player ids | Interstice's entire primary attack |
| Paladin M1 (Kindled Edge) hits nothing | Same root cause, same shape, separate block | Kindred's entire primary attack |
| 7 instant-AOE catalog abilities do nothing | Prism Fan, Lattice, Consecrated Field, Shock Ring, Flock Pulse, Shard Ring, Wall Bloom all resolve through one `pendingInstantAoe` loop (`World.ts:3520-3568`) that only iterates players and is skipped entirely in hangout mode | Geometrician x2, Kindred x2, Syzygist x2, Interstice x1 |
| Emission (E key) never fills | Deliberately gated (`World.ts:1991-1997`) — "hangout emits no combat events... keeps a future lobby damage source from quietly charging meters." This IS that future source, arriving now | Every class's Emission cast |
| 5 ally-targeted abilities never see a real ally | No lobby player ever has a `teamId` (`World.ts:2098-2103`'s own comment); `isAlly()` (`team.ts:31-33`) requires two players sharing one | Kindred's Aegis Share/Rally Light, Syzygist's Borrowed Time/Glass Ward/Haste Gift |

The fix (implemented alongside this doc, see the sibling plan) closes all
five gaps: destructible-hit resolution for melee arc and instant AOE,
emission charge wired to hangout-mode destructible damage, and one
stationary ally NPC sharing a `teamId` with every visitor so `isAlly()`
returns true for free — zero changes to any of the 5 ability
implementations themselves.

---

## Part 3 — Composition: before / after

**Before** (`server/src/venueHost.ts`'s current `venueLobbyMap()`):
loadout totem at 0.25 (an abstract glowing ring, `HangoutScene.ts`'s
`renderTotems`), two dummies almost stacked at 0.30/0.35 (150-300px apart
on a 3000px-wide map), a third dummy isolated at 0.65 with nothing near
it, bell totem at 0.75. No symmetry, no table, no relationship between the
dummies and the totem they're supposedly "beside," flat gradient backdrop
with no vertical scale.

**After:** the loadout station's ring becomes a **literal long table** — a
crystal-plated, hull-panel construction (same material language as
`PlatformLayer`'s existing platforms, just table-proportioned: long, low,
flat-topped) sitting where the totem used to be, still the interaction
trigger zone (walking up to it opens the loadout station exactly as
before — the table IS the totem now, not a separate prop next to it).
Five target figures flank it symmetrically along its length, three
"hostile" (damage-testing) and two "allied" (heal/buff-testing):

```
   bad        good       [ THE  TABLE ]         good        bad         bad
 (outer-L)  (inner-L)   (loadout anchor)     (inner-R)   (outer-R)   (far, near bell)
    ×           ◆        ═══════════            ◆           ×           ×
  ◄──90px──►◄──90px──►◄────center────►◄──90px──►◄──90px──►
```

Concretely (fractions of `vessel-nexus`'s 3000px width, same map the lobby
already uses):

| Figure | Kind | x (fraction) | Read |
|---|---|---|---|
| bad-outer-left | destructible, hostile-tinted | 0.19 | far flank |
| good-inner-left | ally NPC (vessel rig) | 0.22 | near flank |
| **the table** (loadout trigger) | *(new prop, replaces the ring)* | **0.25** | **anchor** |
| good-inner-right | ally NPC (vessel rig) | 0.28 | near flank |
| bad-inner-right | destructible, hostile-tinted | 0.31 | near flank |
| bad-outer-right | destructible, hostile-tinted | 0.35 | far flank |

This keeps every figure inside the existing "practice band" the loadout
station already claims (0.19–0.35, well clear of the center spawn at 0.5
and the bell at 0.75 — same clearance law `totem.ts`'s own comment already
states for the station). Two ally NPCs (not one) both because a
Last-Supper-evocative row reads better with the anchor flanked evenly on
BOTH sides, and because it gives ally-ability testing redundancy if a
player wants to try Rally Light's aura on two targets at once.

**Color read (reuses `docs/chassis-design-axioms.md` CA2 exactly — no new
palette invented):**
- Bad dummies: rose/copper tint (`docs/visual-language-gnostic-vessel.md`'s
  existing "danger/void element cousins" family) — reads hostile at a
  glance, distinct from incidental destructibles elsewhere in the game
  (which stay neutral tan).
- Ally NPCs: the SAME warm gold-adjacent accent the doctrine already
  reserves for "house/self-generated" (Autogenes gold family) — since
  these figures are permanent, always-there, non-combatant fixtures of the
  house itself, gold is the correct register (not a new color invented for
  "friendly").
- The table itself: cool instrument-panel white/cyan seam lines on a dark
  hull-plate surface (the SAME "sealed hull, thin filament seam" language
  `ShellFrame` UI already uses, `visual-language-gnostic-vessel.md` §
  Component grammar) — reads as ship furniture, not altar.

No new held objects, no seated poses. The ally NPCs render through the
EXACT same `ProceduralPlayerRig` every other player uses (CA1: one body,
four accents, never a new silhouette) — they read as "vessels standing
still," not mannequins or statues.

---

## Part 3b — The hall: cathedral SCALE, never cathedral ICONOGRAPHY

Today's backdrop (`HangoutScene.ts`'s `renderArena`) is a flat two-color
gradient fill behind the platforms — functional, but flat. The "cathedral
of sorts" call means adding **vertical drama**, not religious reading:

- **Tall crystal ribs**: vertical structural members receding up past the
  camera's frame at intervals along the hall, same material/line language
  `PlatformLayer` already paints platforms with (hull-plate + crystal
  seam), just oriented vertically and reaching higher than any existing
  arena geometry — the "vaulted ceiling" read comes from scale and
  repetition, not from an arch shape.
- **Light shafts**: soft vertical gradient beams (Phaser `fillGradientStyle`,
  the exact primitive `renderArena` already uses for its backdrop) falling
  from above onto the table specifically — reinforces the table as the
  compositional/lighting anchor, same "spark, not flood" discipline
  (`visual-language-gnostic-vessel.md` §2 — a FEW dramatic shafts, not a
  God-ray shader wash).
- **Hangar-bay scale, not nave proportions**: wide and tall, not
  narrow-and-long-with-a-center-aisle (the specific proportion that reads
  "church nave"). This is closer to a Warframe orbiter bay or a cargo
  cathedral than a chancel.

No arches, no pointed vaulting silhouettes, no rose window, no pews, no
center aisle. If in doubt while implementing, the CA6 test again: remove
color, look at silhouette alone — tall verticals + a long low table read
as "hangar with a workbench," not "nave with an altar."

---

## Part 4 — Ability coverage after this ships

| Role (of 6) | Count | Target type needed | Status after fix |
|---|---|---|---|
| offense | ~13 | enemy (destructible or player) | bad dummies ✅ |
| single | ~7 (incl. Borrowed Time, ally-single) | enemy or ally | bad + good dummies ✅ |
| aoe | ~8 | enemy (destructible or player) | bad dummies ✅ (was 7/8 broken) |
| defense | ~9 (incl. Aegis Share, ally-adjacent) | self or ally | self-fallback (existing) + good dummy for real behavior ✅ |
| buff | ~7 (incl. Rally Light, Haste Gift, ally) | self or ally | self-fallback (existing) + good dummy for real behavior ✅ |
| movement | ~9 | self, no target | already fully functional (self-contained) ✅ |

Net: all 42 catalog abilities across all 4 classes have a correctly-typed,
functional target in the lobby after this ships. Nothing in this room
"does nothing" when tried.

---

## Acceptance checklist

- [ ] Screenshot of the repositioned range fails to read as anything but a
      grand crystal-tech hall with a workbench-table social anchor (Part 1
      / Part 3b's strip test).
- [ ] No new prop, texture, or pose reads as bread/wine/chalice/halo/cross/
      robe/arch/pew/altar under isolation (CA6-style check on every new
      visual element, including the table and the hall's vertical ribs).
- [ ] Ninja and Paladin M1 visibly damage a bad dummy in the lobby.
- [ ] All 7 instant-AOE catalog abilities visibly damage a bad dummy.
- [ ] Emission (E) fills from dummy damage and casts once full, in hangout
      mode only — arena behavior unchanged.
- [ ] Aegis Share / Rally Light / Borrowed Time / Glass Ward / Haste Gift
      all visibly affect a good (ally) NPC differently than their
      documented solo-fallback behavior.
- [ ] Full test suites green (client + server), both workspaces typecheck
      clean.
