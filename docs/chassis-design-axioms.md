# JAKESJAM — Chassis Design Axioms (generative, grounded in concept art)

**Status:** Canonical reasoning layer for chassis (class body/silhouette/
movement/weapon-verb) design specifically — a narrower sibling to
`docs/design-axioms.md` (mechanics/feel/balance/pacing/economy) and
`docs/visual-language-gnostic-vessel.md` (the broader visual doctrine: dual-
accent register, "withdraw not ascend," hard bans). This doc sits between
them: it's what a chassis pass (new class, new pose, new VFX read) should
reason from.

**Grounding.** Every axiom below is extracted directly from
`docs/class-inspiration/*-v2.jpg` — the four locked concept pieces
(Geometrician, Interstice, Kindled, Syzygist). These aren't aspirational;
they're already-approved art that the sim's actual mechanics should keep
reading as true to. Where an axiom names something the CURRENT
implementation doesn't yet do, that's flagged as an opening, not a rule
violation — see the per-class application section below.

---

## CA1. One body, four accents — the chassis is a register, not a costume.

**Observation:** all four pieces share the exact same underlying
architecture: black vessel-suit, faceless smooth ovoid-visored helmet,
glowing crystal/circuit seams at the joints. Nothing about the SILHOUETTE
material changes between classes — no class gets cloth, fur, exposed skin,
or a different body plan. The only things that change are accent color,
helmet shape, held-object language, and pose.

**Mechanism:** this is "vessel hull, not fantasy assassin costume"
(`visual-language-gnostic-vessel.md`) made literal — a shared chassis
grammar means every class reads as the SAME GAME instantly, and class
identity has to be carried by fewer, sharper signals (color + silhouette +
pose) instead of costume noise. It's also why a player can glance at a
teammate mid-fight and know their class without reading a nameplate.

**Opens:** any new class (or a 5th chassis, someday) starts from the SAME
black-vessel base — never a fresh material language. If a chassis pass
reaches for "let's give this class leather" or "this one should look
organic," that's the fantasy-costume failure this doctrine already rejects
elsewhere — stop and re-read this axiom.

---

## CA2. Color is earned, not assigned — cyan is conjured, gold is grown, white is measured.

**Observation:** Geometrician's crystal shards look SUMMONED — they erupt
from open palms, externally manifested ammunition, cyan (the reserved
combat/live-fire register). Kindled's gold isn't held, it's IN the body —
circuitry/vein-like lines running under the armor, glowing from the core
outward, self-sourced (the reserved house/Autogenes register). Syzygist's
white/cool ring and spine-conduit read as INSTRUMENT light — a dial, a
targeting ring, tick-marked and mechanical, not a body-glow at all.

**Mechanism:** the existing dual-accent rule (gold=house, cyan=combat) is
necessary but not sufficient — this art shows THREE distinct light
qualities doing THREE distinct jobs: cyan is projected/expended (you spend
it, it leaves your hand), gold is generated/carried (it's always there,
running under the skin), white is observed/measured (it's a ring you read,
not a light you emit). A class's resource fiction should match which of
these three a given effect is.

**Opens:** this settles the open "Syzygist cool-white vs. reserved violet"
question flagged earlier this session — the art already answered it: white
is Syzygist's real color, not a placeholder waiting for violet. It's not
"cyan, dimmed" — it's a THIRD register (measured/instrument), doing a job
neither gold nor cyan can: legible read-outs (Devotion, Ward absorb,
Regen/Haste windows) that need to look like information, not like combat or
like self-generated house-glow.

---

## CA3. Silhouette-first: readable in flat black alone.

**Observation:** strip all color and glow from these four images and you
can STILL tell them apart — Geometrician's finned/swept hood, Interstice's
raked sleek hood with a low forward-leaning stance, Kindled's tall conical
crown silhouette (the tallest, most vertical of the four), Syzygist's
smooth teardrop head with no crest at all (the quietest silhouette).
Helmet shape alone is a fingerprint.

**Mechanism:** a 64px-test-passing character (per the DI-anti-moodboard
discipline already governing every class's design) has to read at
gameplay distance, not portrait distance — color desaturates at range and
under motion blur far faster than silhouette does. If two classes are only
distinguishable by their glow color, they fail the 64px test the moment
the game is in motion or a colorblind player is looking.

**Opens:** any new chassis-level silhouette decision (helmet shape,
shoulder width, stance height) should be checkable with color removed —
literally desaturate the reference art and ask "can I still tell this
apart from the other three." Kindled's height/bulk (tallest, broadest) and
Interstice's compactness (smallest, most horizontal in motion) already do
double duty as GAMEPLAY signals too — see CA4.

---

## CA4. The pose IS the verb — no chassis needs a label to say what it does.

**Observation:** Geometrician is caught mid-cast, both palms open,
symmetrical — "I have two of everything, the full arsenal." Interstice is
mid-leap, both blades already swinging, body horizontal — "already in
range, the wave already proves it" (matches the character sheet's own
"Open fight: already in range" line). Kindled stands grounded, weapon AND
shield both raised, weight low — a ready stance, not an attack, because the
paladin's whole identity is "the line holds where he stands." Syzygist is
nearly still, hands extended puppeteer-style toward floating, tethered
fragments — not fighting the frame, CONDUCTING it.

**Mechanism:** the reference pose for a class should be extractable
directly from its locked one-line identity (`docs/classes-goal.md`'s
per-class summaries) without needing to see the ability list. If you had to
caption the pose to explain the class, the pose failed.

**Opens:** this is a design test for every future chassis-level animation
(idle pose, respawn pose, victory pose) — does it independently communicate
the class's verb, or does it just look "cool" in a class-agnostic way? A
Kindled idle that doesn't read as grounded/braced, or a Syzygist idle that
looks aggressive rather than composed, would be off-model even if the
silhouette and colors are correct.

---

## CA5. The tether/echo is the class's real innovation — visualize the verb that extends past the body.

**Observation:** two of the four pieces show something extending the
character's presence BEYOND their own silhouette. Interstice has a
translucent afterimage trailing the leap — a ghost double mid-motion.
Syzygist has literal glowing threads running from fingers to detached,
floating crystal fragments — puppet-strings to things not touching the
body. Geometrician and Kindled, by contrast, keep everything IN the body or
IN the held object — no tether, no echo.

**Mechanism:** this isn't decoration, it's the concept art already having
solved two mechanics the sim built independently and later: Interstice's
ghost-double IS Paper Double (the "input-echo lie" decoy — the art shipped
before the mechanic did; the sim mechanic itself shipped 2026-07-19,
`PaperDoubleEntity`/`state.paperDoubles`, still with only a placeholder
render, see the "Opens" note below) and Syzygist's finger-threads-to-
fragments ARE the "self-guiding tendril, auto-target the correct
destination" design Jake asked for this session, independently
re-arrived-at from the mechanics side. The art and the late-session
mechanics-design converged on the same idea without either referencing the
other — that's a strong signal it's the right read for both classes.

**Opens:** now that Paper Double's SIM is built (spawn/move/damageable/
expire/burst — the decoy-entity type this section originally flagged as
the blocker), its VFX still has a head start waiting to be spent: a
translucent afterimage, not a smoke-puff/vanish. The shipped v1 render is
a minimal placeholder only (sim-correctness pass, not a tactile VFX pass —
see `paperDouble.ts`'s header / types.ts's `PaperDoubleEntity` comment) —
the ghost-double-afterimage treatment this section describes is still a
genuinely open follow-up, not done. When Syzygist's ally-targeted
abilities get their VFX pass, the thread-to-target visual is already
canon, not a fresh design problem — draw the tendril literally, finger to
target, the way the concept art already does. Geometrician and Kindled
should NOT get tether/echo treatments — that visual vocabulary is
Interstice/Syzygist's alone (CA1's "accent, not universal template" logic
applied to VFX, not just color).

---

## CA6. Instrument rings pass the halo test; religious rings don't.

**Observation:** Syzygist's circular ring behind the head LOOKS like it
could be a halo at a glance — but on inspection it's tick-marked,
sub-dialed, has small geometric glyphs at measured intervals, and reads as
an astrolabe or targeting reticle, not an icon of sanctity. It's
positioned behind/around the head the way a halo would be, but every
detail on it is instrumentation, not iconography.

**Mechanism:** this is the closest this doctrine's hard ban (no
robes/halos/crosses) comes to being visually tested at the edge — a ring
around a head is genuinely ambiguous until you look at what's DRAWN ON the
ring. The test CA6 proposes: if you removed the character and left only
the ring, would a viewer read "instrument panel" or "religious icon"? Tick
marks, sub-circles, tiny geometric glyphs = instrument. Rays, a solid
glow-disc, or a crossbar = religious and out.

**Opens:** a concrete, checkable pass for any future halo-adjacent shape
(Syzygist's Ward absorb ring, a Devotion meter, any circular UI/VFX for
this class) — run CA6's isolation test before shipping it. This is more
useful than "no halos" alone because it tells you WHY Syzygist's own
concept art doesn't violate its own doctrine.

---

## Relationship to the rest of the doctrine

| Doc | Owns | This doc's relation |
|-----|------|---------------------|
| `visual-language-gnostic-vessel.md` | The broad visual doctrine (dual-accent, hard bans, "withdraw not ascend") | This doc is the chassis-specific instance of it, grounded in the actual locked art rather than principle alone |
| `design-axioms.md` | Mechanics/feel/balance/pacing/economy reasoning | CA4/CA5 are where the two meet — a pose or a tether-VFX is downstream of a real mechanic (A1: "feel is authored per-mechanic") |
| `classes-goal.md` / `character-sheets-v1.md` | Per-class identity, DI anti-moodboards, locked stats | This doc explains WHY the art already committed to certain choices those docs describe in prose |

**These axioms are extracted from art that's already locked-in, not
proposed from scratch.** Where a current mechanic doesn't yet match what
the art already implies (Paper Double's VFX — the SIM shipped 2026-07-19,
the tactile ghost-double render didn't yet; Syzygist VFX), that's a
tracked gap to close toward the art — not a reason to redesign the art.

---

## Per-class chassis sheet (axioms applied, 2026-07-18)

Each sheet: silhouette read (CA3), color register (CA2), pose/verb (CA4),
tether/echo (CA5, where it applies), and current implementation status —
grounded in what's actually shipped this session, not aspiration.

### Geometrician (Wizard) — `geometrician-v2.jpg`

- **Silhouette:** finned, swept-back hood — the sharpest forward angle of
  the four, reads as an antenna/focusing array even in flat black.
- **Color (CA2 — conjured):** cyan crystal shards erupt from open palms —
  externally manifested, spent the moment they're cast. Gold trim on seams
  only (house-accent, minimal — per the doctrine's "gold almost absent
  from combat HUD" rule already governing this class).
- **Pose/verb:** symmetrical dual open-palm cast — "the full crystal
  arsenal, every weapon." No single signature weapon; the pose says
  *access*, not *mastery of one thing*.
- **Tether/echo:** none (CA5 — this vocabulary belongs to Interstice/
  Syzygist only). Geometrician's power stays IN the held crystal, never
  extends past the body.
- **Shipped:** 100hp, baseline speed/size (the "default" chassis
  silhouette other three are measured against). Full 10-ability catalog,
  7 spec cards, Prism Wall (shield) / Vector Charge (dash) named. Only
  class that never carried a `kitComing` flag — matches CA1's read of this
  chassis as the "home base" body.
- **Gap toward the art:** none structural — this is the most complete
  chassis/art match of the four. The open-palm dual-cast pose is a strong
  future idle/ready-stance reference if one doesn't exist yet.

### Kindred (Paladin) — `kindled-v2.jpg`

- **Silhouette:** tallest, broadest, most vertical — a conical crown
  helmet unlike any other class's hood shape. Reads as "the biggest thing
  in the room" in flat black alone, before any color.
- **Color (CA2 — grown):** gold circuitry runs FROM the body outward,
  vein-like, always-on rather than summoned — the doctrine's house/
  Autogenes register at its most literal. The held shield is a
  circuit-board slab (a "digital vessel," not a heraldic shield) with a
  glowing rune-screen center.
- **Pose/verb:** grounded, weapon AND shield both raised, weight low — a
  READY stance, not an attack. Matches "the line holds where he stands"
  (Bastion's own card-pool-v2 concept line) exactly.
- **Tether/echo:** none (CA5 doesn't apply here either) — Kindred's power
  is carried, not extended.
- **Shipped:** 125hp, 0.88 move speed, 1.18 size — the art's "biggest/
  slowest" read landed correctly in the stats before this session even
  started. Full 10-ability catalog, all 3 card-pool exclusives (Crater,
  Retort, Bastion), Kindled Edge/Ward/Charge named, Kindling resource,
  team-peel, Unveiling ultimate, a real gold-forward VFX pass on Ward/peel
  hits (`ward-absorbed`/`team-peel-absorbed` now flash `0xc9a84c`).
  `kitComing` correctly dropped.
- **Gap toward the art:** the concept art's circuit-board shield face
  (a literal readable screen/rune) is a striking, specific detail nothing
  in the current Kindled Ward VFX references yet — worth a fast-follow
  when Ward gets its own dedicated visual pass beyond the current flash.

### Interstice (Ninja) — `interstice-v2.jpg`

- **Silhouette:** the smallest, most horizontal-in-motion of the four —
  sleek raked hood, low crouched leap. Reads as "already moving" even in a
  static frame.
- **Color (CA2):** cyan, same register as Geometrician — but expressed
  differently: twin curved blades glow cyan (held, not conjured-and-spent),
  and a cyan-lit spine-conduit runs down the back like a nervous system
  made visible. Shares the combat-cyan family without competing with
  Geometrician's crystal-shard reading (blade vs. thrown shard keeps the
  two visually distinct despite the shared hue).
- **Pose/verb:** mid-leap, both blades already swinging — "already in
  range, the wave already proves it" (character-sheets-v1.md's own line
  for this class's Open-fight axis).
- **Tether/echo (CA5 — this class's signature use of it):** a translucent
  ghost-double trails the leap, mid-motion, same pose one beat behind.
  This is the concept-art-native visual for Paper Double, arrived at
  independently of the sim mechanic — the sim mechanic shipped 2026-07-19
  (spawn/move/damageable/expire/burst), the tactile afterimage render
  still hasn't — see gap below.
- **Shipped:** 85hp, fastest, smallest — matches CA3's silhouette read.
  Full 10-of-10 catalog abilities (Undercut, Edge Storm, Needle, Read Mark,
  Shard Ring, Wall Bloom, Ghost Guard, Second Wind, Razor Route, Paper
  Double), full melee/dash/energy chassis, Shield fixed this session to
  genuinely never-block (per character-sheets-v1.md's own "Dash i-frames
  only" line — Kindled Ward's structural sibling-branch, but the ninja
  branch's entire content IS "does nothing," matching CA4: the class's
  defense verb IS the dash, nothing else should visually or mechanically
  compete with that read). `kitComing` correctly still `true`.
- **Gap toward the art:** Paper Double's SIM is built now (own entity type,
  `PaperDoubleEntity`/`state.paperDoubles`, resolved the blocker this
  section originally named) but its RENDER is still just a minimal
  placeholder (sim-correctness pass only — see `paperDouble.ts`'s header
  comment). CA5's own visual is the ONE piece of this chassis the concept
  art already fully previsualized and the render still hasn't caught up
  to: translucent afterimage repeating the caster's last few inputs, not a
  smoke-puff/teleport-vanish (a WoW Rogue vanish read, which the class's
  own DI-anti-moodboard table already rejects). A real fast-follow now
  that nothing sim-side blocks it.

### Syzygist (Priest) — `syzygist-v2.jpg`

- **Silhouette:** smooth teardrop head, no crest, no crown, no fins — the
  quietest silhouette of the four by deliberate contrast (CA3: distinct
  BECAUSE it under-designs where the other three over-design).
- **Color (CA2 — measured, the third register):** cool white/blue-white
  throughout — a tick-marked instrument ring behind the head (passes the
  CA6 halo test: sub-dials and glyphs, not rays or a solid disc) and a
  white spine-conduit mirroring Interstice's cyan one but in the
  "observed" register instead of the "expended" one. This is the locked
  answer to the previously-open "cool-white vs. reserved violet" question
  — white is Syzygist's real color.
- **Pose/verb:** nearly still, hands extended puppeteer-style — CONDUCTING
  the frame, not fighting it. The stillest pose of the four, matching
  "measured pace" and the class's whole low-aim identity: the verb is
  direction, not force.
- **Tether/echo (CA5 — this class's signature use, the other half of it):**
  literal glowing threads run from fingers to floating, detached crystal
  fragments — puppet-strings to targets not touching the body. This is
  the exact visual language Jake asked for independently this session
  ("tendrils that ooze out and self-guide to its correct destination") —
  the concept art had already committed to it before the mechanic did.
- **Shipped:** 100hp, 0.96 move speed, 1.05 size — measured/middling on
  every axis, matching "measured pace, broad frame." Full 10-ability
  catalog (Bleed Tithe, Severance, Borrowed Time, Focus Hex, Contagion,
  Flock Pulse, Self-Lattice, Glass Ward, Haste Gift, Drift Step), Devotion
  resource, Syzygist Ward (Open Hand/Tethered Charge named), regen/haste
  substrate, most catalog abilities auto-target (no aim needed) matching
  the low-aim design direction. Bleed Tithe just upgraded from one-time
  auto-aim to genuine homing (2026-07-18) — the shard now curves to follow
  a moving target, which is the MECHANICAL version of what the concept
  art's finger-threads already show visually: the tendril doesn't just
  point once, it stays connected. `kitComing` correctly dropped.
- **Gap toward the art:** no VFX pass has been built yet for
  ally-targeted casts (Glass Ward, Haste Gift, Borrowed Time) — CA5 says
  these should draw as a literal thread from caster to target, matching
  the concept art exactly, not a generic particle burst. This is the
  single clearest "the art already solved this, the code hasn't caught up
  yet" gap across all four chassis.
